import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as engine from './dist/engine.mjs';

const {DEFAULT_MIC_PICKUP,MIC_PICKUP_LEVELS,getMicPickupSettings,NOTES,frequencyFor,PitchDetector,GentleJudge,pitchDistance}=engine;
const levels=['normal','high','ultra'];
const storageKey='iro-to-yubi:mic-pickup';
const appSource=readFileSync(new URL('./dist/app.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/,'');
const reading=(cents=0,overrides={})=>({frequency:frequencyFor(69)*2**(cents/1200),confidence:.99,rms:.15,...overrides});
function eventsFor(level,input){
 const judge=new GentleJudge(level),events=[];
 for(let now=240;now<2000;now+=60){const event=judge.observe(input,69,now);if(event)events.push(event);}
 return events;
}
function signal(frequency,sampleRate,amplitude=.2,harmonics=[1],noise=0){
 let seed=38;
 return Float32Array.from({length:2048},(_,i)=>{
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  return amplitude*harmonics.reduce((sum,weight,h)=>sum+weight*Math.sin(2*Math.PI*frequency*(h+1)*i/sampleRate),0)+(seed/2**32-.5)*noise;
 });
}

test('pickup profiles keep the previous normal thresholds and default safely to ultra',()=>{
 assert.deepEqual(MIC_PICKUP_LEVELS,{
  normal:{label:'ふつう',minRms:.002,minConfidence:.65,toleranceCents:100,acceptMs:180,referenceMs:480},
  high:{label:'高め',minRms:.001,minConfidence:.55,toleranceCents:125,acceptMs:120,referenceMs:480},
  ultra:{label:'超高め',minRms:.0005,minConfidence:.45,toleranceCents:150,acceptMs:60,referenceMs:480}
 });
 assert.equal(DEFAULT_MIC_PICKUP,'ultra');
 for(const invalid of [undefined,null,'','missing','__proto__','constructor']){
  assert.equal(getMicPickupSettings(invalid),MIC_PICKUP_LEVELS.ultra);
  assert.equal(new GentleJudge(invalid).settings,MIC_PICKUP_LEVELS.ultra);
  assert.equal(new PitchDetector(48000,invalid).settings,MIC_PICKUP_LEVELS.ultra);
 }
 assert.ok(Object.isFrozen(MIC_PICKUP_LEVELS));
 for(const level of levels)assert.ok(Object.isFrozen(MIC_PICKUP_LEVELS[level]));
});

for(const level of levels){
 const settings=MIC_PICKUP_LEVELS[level];
 test(`${level}: the judge rejects subthreshold volume or confidence and accepts their exact limits`,()=>{
  for(const cents of [0,300]){
   assert.deepEqual(eventsFor(level,reading(cents,{rms:settings.minRms*.99})),[]);
   assert.deepEqual(eventsFor(level,reading(cents,{confidence:settings.minConfidence-.001})),[]);
   assert.deepEqual(eventsFor(level,reading(cents,{rms:settings.minRms,confidence:settings.minConfidence})),[cents===0?'accepted':'reference']);
  }
 });
 test(`${level}: cents boundaries and octave tolerance follow the selected profile`,()=>{
  for(const sign of [-1,1])for(const octave of [-1200,0,1200]){
   assert.deepEqual(eventsFor(level,reading(octave+sign*settings.toleranceCents)),['accepted']);
   assert.deepEqual(eventsFor(level,reading(octave+sign*(settings.toleranceCents+.02))),['reference']);
  }
 });
 test(`${level}: acceptance timing changes while the reference hold and four-second advance stay unchanged`,()=>{
  for(const [cents,hold,event] of [[0,settings.acceptMs,'accepted'],[300,settings.referenceMs,'reference']]){
   const judge=new GentleJudge(level);
   for(let now=240;now<240+hold;now+=60)assert.equal(judge.observe(reading(cents),69,now),null);
   assert.equal(judge.observe(reading(cents),69,240+hold),event);
   assert.equal(judge.observe(reading(cents),69,300+hold),null);
   const session=new engine.PracticeSession(1,()=>0),detectedAt=240+hold;
   if(event==='reference'){
    assert.equal(session.wrong(detectedAt),true);
    assert.equal(session.advance(detectedAt+3999),null);
    assert.equal(session.advance(detectedAt+4000),'next');
    for(let elapsed=60;elapsed<settings.acceptMs;elapsed+=60)assert.equal(judge.observe(reading(),69,300+hold+elapsed),null);
    assert.equal(judge.observe(reading(),69,300+hold+settings.acceptMs),'accepted');
   }else{
    assert.equal(session.correct(detectedAt),true);
    assert.equal(session.advance(detectedAt+849),null);
    assert.equal(session.advance(detectedAt+850),'next');
   }
  }
 });
 test(`${level}: silence, DC, broadband noise and isolated pitch estimates never prompt or pass`,()=>{
  const detector=new PitchDetector(48000,level);
  for(const input of [new Float32Array(2048),new Float32Array(2048).fill(.15),signal(440,48000,0,[1],.25)]){
   const result=detector.detect(input);
   assert.equal(result.frequency,null);
   assert.deepEqual(eventsFor(level,result),[]);
  }
  const judge=new GentleJudge(level);
  for(let now=240;now<4000;now+=500)assert.equal(judge.observe(reading(),69,now),null);
 });
}

test('the detector volume floor switches for quiet waveforms at both sample rates',()=>{
 for(const sampleRate of [44100,48000])for(const [amplitude,acceptedLevels] of [[.001,['ultra']],[.002,['high','ultra']],[.004,levels]]){
  const input=signal(440,sampleRate,amplitude);
  for(const level of levels){
   const result=new PitchDetector(sampleRate,level).detect(input);
   assert.equal(result.frequency!==null,acceptedLevels.includes(level),`${sampleRate}/${amplitude}/${level}`);
   if(result.frequency)assert.ok(pitchDistance(result.frequency,69)<10);
  }
 }
});
test('the detector confidence floor switches for rough pitched waveforms at both sample rates',()=>{
 for(const sampleRate of [44100,48000])for(const [noise,acceptedLevels] of [[.05,levels],[.06,['high','ultra']],[.08,['ultra']]]){
  const input=signal(440,sampleRate,.02,[1],noise);
  for(const level of levels){
   const result=new PitchDetector(sampleRate,level).detect(input);
   assert.equal(result.frequency!==null,acceptedLevels.includes(level),`${sampleRate}/${noise}/${level}`);
   assert.deepEqual(eventsFor(level,result),acceptedLevels.includes(level)?['accepted']:[]);
  }
 }
});
test('all profiles retain the eight target notes, detuning and strong harmonic detection',()=>{
 let cases=0;
 for(const level of levels)for(const sampleRate of [44100,48000])for(const note of NOTES)for(const cents of [-60,0,60])for(const harmonics of [[1],[.35,1,.4,.15]]){
  const input=signal(frequencyFor(note.midi)*2**(cents/1200),sampleRate,.2,harmonics);
  const result=new PitchDetector(sampleRate,level).detect(input),judge=new GentleJudge(level),events=[];
  assert.ok(result.frequency,`${level}/${sampleRate}/${note.id}`);
  for(let now=240;now<1000;now+=60){const event=judge.observe(result,note.midi,now);if(event)events.push(event);}
  assert.deepEqual(events,['accepted']);cases++;
 }
 assert.equal(cases,288);
});
test('a quiet, rough or detuned performance reaches only the intended sensitivity levels',()=>{
 for(const [input,expected] of [
  [reading(0,{rms:.0015}),[[],['accepted'],['accepted']]],
  [reading(0,{confidence:.6}),[[],['accepted'],['accepted']]],
  [reading(110),[['reference'],['accepted'],['accepted']]],
  [reading(140,{rms:.00075,confidence:.5}),[[],[],['accepted']]]
 ])for(const [index,level] of levels.entries())assert.deepEqual(eventsFor(level,input),expected[index]);
});

// Run the real app module with a minimal DOM and an in-memory microphone; no device access.
function appHarness({saved=null,readFails=false,writeFails=false,values=new Map()}={}){
 if(saved!==null)values.set(storageKey,saved);
 const elements=new Map(),writes=[],mediaCalls=[];
 function element(id){
  if(!elements.has(id))elements.set(id,{
   value:id==='micPickup'?'2':id==='volume'?'85':'',textContent:'',listeners:new Map(),attributes:new Map(),
   addEventListener(type,handler){this.listeners.set(type,handler);},
   setAttribute(name,value){this.attributes.set(name,value);},
   replaceChildren(){},style:{},classList:{add(){}}
  });
  return elements.get(id);
 }
 const track={stop(){},onended:null};
 const node=()=>({connect(){},disconnect(){}});
 class AudioContext{
  state='running';sampleRate=48000;currentTime=0;destination={};
  async resume(){}
  createMediaStreamSource(){return node();}
  createAnalyser(){return node();}
  createGain(){return {...node(),gain:{value:1}};}
 }
 const sandbox=vm.createContext({
  ...engine,Float32Array,performance:{now:()=>1000},requestAnimationFrame:()=>1,cancelAnimationFrame(){},
  document:{getElementById:element,querySelectorAll:()=>[],addEventListener(){}},
  window:{AudioContext,addEventListener(){}},
  navigator:{mediaDevices:{async getUserMedia(constraints){mediaCalls.push(constraints);return {getTracks:()=>[track],getAudioTracks:()=>[track]};}}},
  localStorage:{
   getItem(key){if(readFails)throw new Error('Storage is blocked');return values.get(key)??null;},
   setItem(key,value){if(writeFails)throw new Error('Storage is full');writes.push([key,value]);values.set(key,value);}
  }
 });
 vm.runInContext(appSource,sandbox,{filename:'app.js'});
 return {element,values,writes,mediaCalls,run:source=>vm.runInContext(source,sandbox),
  select(index){element('micPickup').value=String(index);element('micPickup').listeners.get('input')();}};
}

test('the app shows ultra when storage is absent, invalid or blocked',()=>{
 for(const options of [{},{saved:'missing'},{saved:'__proto__'},{saved:'constructor'},{saved:''},{readFails:true}]){
  const app=appHarness(options);
  assert.equal(app.element('micPickup').value,'2');
  assert.equal(app.element('micPickupValue').textContent,'超高め');
  assert.equal(app.element('micPickup').attributes.get('aria-valuetext'),'超高め');
  assert.equal(app.run('judge.settings'),MIC_PICKUP_LEVELS.ultra);
  assert.equal(app.writes.length,0);
 }
});
test('every saved pickup level is restored to the slider, accessible label and judge',()=>{
 for(const [index,level] of levels.entries()){
  const app=appHarness({saved:level});
  assert.equal(app.element('micPickup').value,String(index));
  assert.equal(app.element('micPickupValue').textContent,MIC_PICKUP_LEVELS[level].label);
  assert.equal(app.element('micPickup').attributes.get('aria-valuetext'),MIC_PICKUP_LEVELS[level].label);
  assert.equal(app.run('judge.settings'),MIC_PICKUP_LEVELS[level]);
 }
});
test('slider input persists only the pickup setting and survives the next app load',()=>{
 const values=new Map([['existing-setting','keep']]),app=appHarness({values});
 for(const [index,level] of levels.entries()){
  app.select(index);
  assert.equal(app.run('judge.settings'),MIC_PICKUP_LEVELS[level]);
  assert.equal(values.get(storageKey),level);
  const reloaded=appHarness({values});
  assert.equal(reloaded.element('micPickup').value,String(index));
  assert.equal(reloaded.element('micPickupValue').textContent,MIC_PICKUP_LEVELS[level].label);
 }
 assert.deepEqual(app.writes,levels.map(level=>[storageKey,level]));
 assert.equal(values.get('existing-setting'),'keep');
 assert.equal(values.size,2);
 assert.equal(app.element('volume').value,'85');
});
test('a failed storage write still applies the pickup setting for the current session',()=>{
 const app=appHarness({readFails:true,writeFails:true});
 app.select(0);
 assert.equal(app.element('micPickupValue').textContent,'ふつう');
 assert.equal(app.run('judge.settings'),MIC_PICKUP_LEVELS.normal);
 assert.equal(app.writes.length,0);
});
test('microphone start, pause, resume and a new session apply the same profile to detector and judge',async()=>{
 const app=appHarness();
 for(const [index,level] of levels.entries()){
  app.run('toSetup()');app.select(index);
  await app.run('startAudio(true)');
  assert.equal(app.run('running'),true);
  assert.equal(app.run('detector.settings'),MIC_PICKUP_LEVELS[level]);
  assert.equal(app.run('judge.settings'),MIC_PICKUP_LEVELS[level]);
  app.run('pause()');await app.run('startAudio(false)');
  assert.equal(app.run('running'),true);
  assert.equal(app.run('detector.settings'),MIC_PICKUP_LEVELS[level]);
  assert.equal(app.run('judge.settings'),MIC_PICKUP_LEVELS[level]);
 }
 for(const call of app.mediaCalls)assert.equal(JSON.stringify(call),JSON.stringify({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false}));
 assert.equal(app.mediaCalls.length,6);
 app.run('stop()');
});
