import test from 'node:test';
import assert from 'node:assert/strict';
import {NOTES,frequencyFor,PitchDetector,GentleJudge,PracticeSession,pitchDistance} from './dist/engine.mjs';
function signal(f,sr=48000,harmonics=[1],amplitude=.2){return Float32Array.from({length:2048},(_,i)=>amplitude*harmonics.reduce((s,a,h)=>s+a*Math.sin(2*Math.PI*f*(h+1)*i/sr),0));}
function reading(midi){return {frequency:frequencyFor(midi),confidence:.99,rms:.15};}
test('8 target notes at 44.1k and 48k, including strong second harmonics and detuning',()=>{
 let cases=0;
 for(const sr of [44100,48000])for(const note of NOTES)for(const detune of [-60,0,60])for(const harmonics of [[1],[.35,1,.4,.15]]){
  const f=frequencyFor(note.midi)*2**(detune/1200),detector=new PitchDetector(sr),result=detector.detect(signal(f,sr,harmonics));
  assert.ok(result.frequency,`${note.id} ${sr}`);assert.ok(pitchDistance(result.frequency,note.midi)<75,JSON.stringify(result));cases++;
 }
 assert.equal(cases,96);
});
test('silence, DC and deterministic broadband noise never trigger a reference',()=>{
 const d=new PitchDetector(48000);let seed=38;
 const noise=Float32Array.from({length:2048},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed/2**32-.5)*.25;});
 for(const input of [new Float32Array(2048),new Float32Array(2048).fill(.15),noise])assert.equal(d.detect(input).frequency,null);
 const judge=new GentleJudge();for(let t=0;t<30000;t+=60)assert.equal(judge.observe({frequency:null,confidence:0,rms:0},69,t),null);
});
test('a near note and an octave estimate pass without playing a reference',()=>{
 for(const midi of [68.1,69,69.9,81]){
  const judge=new GentleJudge();const events=[];for(let t=0;t<1500;t+=60){const e=judge.observe(reading(midi),69,t);if(e)events.push(e);}
  assert.deepEqual(events,['accepted']);
 }
});
test('brief wrong onset is ignored; sustained wrong sound prompts once, then a correction can still pass',()=>{
 const j=new GentleJudge();for(let t=240;t<660;t+=60)assert.equal(j.observe(reading(73),69,t),null);
 assert.equal(j.observe({frequency:null,confidence:0,rms:0},69,660),null);
 const events=[];for(let t=720;t<2200;t+=60){const e=j.observe(reading(73),69,t);if(e)events.push(e);}
 assert.deepEqual(events,['reference']);
 const corrected=[];for(let t=3600;t<4500;t+=60){const e=j.observe(reading(69),69,t);if(e)corrected.push(e);}
 assert.deepEqual(corrected,['accepted']);
});
test('sparse isolated reads do not count as sustained performance',()=>{
 const j=new GentleJudge();for(let t=300;t<4000;t+=500)assert.equal(j.observe(reading(73),69,t),null);
});
test('silence waits indefinitely; wrong answer advances exactly four seconds after detection',()=>{
 const g=new PracticeSession(1,()=>0);assert.equal(g.advance(100000),null);assert.equal(g.index,0);
 assert.equal(g.wrong(110000),true);assert.equal(g.wrong(111000),false);assert.equal(g.deadline,114000);
 assert.equal(g.advance(113999),null);assert.equal(g.advance(114000),'next');assert.equal(g.index,1);assert.equal(g.deadline,null);
 assert.equal(g.advance(200000),null);
});
test('correct answer gives one celebration and advances after it; correction overrides error wait',()=>{
 const g=new PracticeSession(1,()=>0);g.wrong(1000);assert.equal(g.correct(2500),true);assert.equal(g.correct(2550),false);
 assert.equal(g.advance(3349),null);assert.equal(g.advance(3350),'next');assert.equal(g.results[0],'correct');
});
test('1, 3 and 5 phrases finish at exactly 4, 12 and 20 sounds; pause clears an old timer',()=>{
 for(const count of [1,3,5]){
  const g=new PracticeSession(count,()=>.25);assert.equal(g.notes.length,count*4);
  for(let i=0;i<count*4;i++){assert.ok(NOTES.includes(g.current));g.correct(i*2000);assert.equal(g.advance(i*2000+850),i===count*4-1?'finished':'next');}
  assert.equal(g.results.length,count*4);assert.ok(g.done);assert.equal(g.advance(999999,true),null);
 }
 const g=new PracticeSession(1);g.wrong(100);g.resumeNote();assert.equal(g.advance(50000),null);
 assert.throws(()=>new PracticeSession(2),RangeError);
});
