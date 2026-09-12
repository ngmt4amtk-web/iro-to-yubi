import {ERROR_WAIT_MS, frequencyFor, PitchDetector, GentleJudge, PracticeSession} from './engine.mjs?v=20260912-sensitive1';
const $=id=>document.getElementById(id);
const NAMES={fluffy:'ふわふわ',dino:'きょうりゅう',dog:'いぬ'};
let chosen='fluffy', count=1, game=null, running=false, starting=false, ticketId=0;
let context,stream,source,analyser,silentGain,detector,frame=0,lastAnalysis=0,mutedUntil=0;
let judge=new GentleJudge(), samples=new Float32Array(2048), voices=[];
const ui={card:$('card'),finger:$('finger'),string:$('stringLabel'),hint:$('fingerHint'),name:$('noteName'),status:$('status'),seconds:$('seconds'),progress:$('progress'),pause:$('pause'),volume:$('volume'),reaction:$('reaction')};
function text(el,value){if(el.textContent!==value)el.textContent=value;}
function screen(name){for(const id of ['setup','practice','finish'])$(id).hidden=id!==name;}
function art(kind,stage=1,happy=false){return `<div class="companion-dog" data-kind="${kind}" data-stage="${stage}"><div class="dog-portrait" data-mood="${happy?'happy':'idle'}"></div></div>`;}
function renderChoices(){document.querySelectorAll('[data-character]').forEach(button=>{button.querySelector('.choice-art').innerHTML=art(button.dataset.character);button.setAttribute('aria-pressed',String(button.dataset.character===chosen));});}
function stage(){return game.index%4+1;}
function renderStrip(){
 const first=Math.floor(game.index/4)*4;
 $('phraseStrip').innerHTML=game.notes.slice(first,first+4).map((note,i)=>{
  const index=first+i, state=index===game.index?'current':index<game.index?'done':'upcoming';
  const good=game.results[index]==='correct'||(index===game.index&&game.result==='correct');
  return `<div class="phrase-note ${note.color} ${state}${good?' good':''}" ${index===game.index?'aria-current="step"':''} aria-label="${i+1}音目、${note.string}の弦、${note.finger}、${note.name}${good?'、できた':''}"><strong>${note.finger}</strong><span>${note.name}</span>${good?'<b aria-hidden="true">✓</b>':''}</div>`;
 }).join('');
 $('phraseCount').textContent=`${Math.floor(game.index/4)+1} / ${game.count} フレーズ`;
}
function renderNote(){
 const note=game.current;ui.card.className=`card ${note.color}`;
 $('noteContent').setAttribute('aria-label',`${note.color==='red'?'赤':'緑'}、${note.string}の弦、${note.finger}、${note.name}`);
 ui.finger.textContent=note.finger;ui.name.textContent=note.name;ui.string.textContent=`${note.string}のげん`;
 ui.hint.textContent=note.finger===0?'ゆびを おかない':`${note.finger}の ゆび`;
 $('companion').innerHTML=art(chosen,stage());$('companion').className='companion entering';
 ui.reaction.className='reaction';text(ui.reaction,'ひいてみよう');text(ui.status,'おとを きいているよ');
 $('pace').hidden=true;ui.seconds.textContent='';renderStrip();judge.reset(performance.now());lastAnalysis=0;
}
function confetti(big=false){
 const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 if(reduced)return;
 const layer=$('confetti');layer.replaceChildren();
 const colors=['#f7ba21','#ed4678','#27a776','#5781ef','#e76c31'];
 const frag=document.createDocumentFragment();
 for(let i=0;i<(big?130:32);i++){
  const part=document.createElement('i');part.style.setProperty('--x',`${Math.random()*100}%`);part.style.setProperty('--drift',`${Math.random()*220-110}px`);part.style.setProperty('--delay',`${Math.random()*(big?1.4:.25)}s`);part.style.setProperty('--duration',`${(big?3:1.6)+Math.random()}s`);part.style.setProperty('--rotation',`${360+Math.random()*720}deg`);part.style.background=colors[i%colors.length];part.className=big?'big':'';
  part.addEventListener('animationend',()=>part.remove(),{once:true});frag.append(part);
 }
 layer.append(frag);
}
function celebrate(){
 $('companion').innerHTML=art(chosen,stage(),true);$('companion').className='companion cheering';
 ui.card.classList.add('celebrating');ui.reaction.className='reaction happy';
 const cheers=['やったー！','いいね！','できた！','さいこう！'];text(ui.reaction,cheers[game.index%4]);text(ui.status,'');$('pace').hidden=true;ui.seconds.textContent='';renderStrip();confetti();
}
function stopTone(){
 if(voices.length){mutedUntil=performance.now()+350;for(const voice of voices){try{voice.osc.stop();}catch{}try{voice.osc.disconnect();voice.gain.disconnect();}catch{}}voices=[];}
}
function referenceTone(){
 if(!running||context?.state!=='running')return;
 stopTone();const now=context.currentTime,duration=1.05,volume=Number(ui.volume.value)/100;
 for(const [harmonic,level] of [[1,.64],[2,.14],[3,.07]]){
  const osc=context.createOscillator(),gain=context.createGain();osc.type='sine';osc.frequency.value=frequencyFor(game.current.midi)*harmonic;
  gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(level*volume,now+.03);gain.gain.setValueAtTime(level*volume,now+duration-.15);gain.gain.linearRampToValueAtTime(0,now+duration);
  osc.connect(gain);gain.connect(context.destination);const voice={osc,gain};voices.push(voice);
  osc.onended=()=>{osc.disconnect();gain.disconnect();voices=voices.filter(v=>v!==voice);};osc.start(now);osc.stop(now+duration+.02);
 }
 mutedUntil=performance.now()+1400;text(ui.reaction,`この おとだよ：${game.current.name}`);text(ui.status,'いっしょに ひいてみよう');
}
function releaseMic(){
 if(stream){stream.getTracks().forEach(track=>{track.onended=null;track.stop();});stream=null;}
 for(const node of [source,analyser,silentGain]){try{node?.disconnect();}catch{}}source=null;analyser=null;silentGain=null;
}
function stop(){ticketId++;running=false;starting=false;cancelAnimationFrame(frame);stopTone();releaseMic();}
function pause(message='ひとやすみ'){
 stop();ui.pause.textContent='つづける';text(ui.reaction,message);text(ui.status,'マイクは おやすみ中');$('pace').hidden=true;ui.seconds.textContent='';
 if(game?.result==='correct'){const outcome=game.advance(performance.now(),true);if(outcome==='finished'){finish();return;}renderNote();text(ui.reaction,message);text(ui.status,'マイクは おやすみ中');}
 else game?.resumeNote();
}
function finish(){
 stop();screen('finish');$('finaleCharacter').innerHTML=art(chosen,5,true);
 $('finishTitle').textContent=game.results.every(result=>result==='correct')?'ぜんぶ できた！':'さいごまで できた！';
 $('finishDetail').textContent=`${game.count}フレーズ・${game.notes.length}音 おしまい！`;
 $('finishTitle').focus({preventScroll:true});confetti(true);
}
function nextNote(force=false){
 if(!game||game.done||starting)return;
 const outcome=game.advance(performance.now(),force);
 if(!outcome)return;
 stopTone();if(outcome==='finished'){finish();return;}
 renderNote();if(!running){text(ui.reaction,'ひとやすみ');text(ui.status,'「つづける」で はじめよう');}
}
function tick(now){
 if(!running)return;
 if(context.state!=='running'){pause('「つづける」で さいかいしよう');return;}
 if(game.deadline!==null&&now>=game.deadline){nextNote();if(!running)return;now=performance.now();}
 if(game.result==='waiting'){
  const remaining=Math.max(0,game.deadline-now);$('pace').hidden=false;ui.progress.style.transform=`scaleX(${remaining/ERROR_WAIT_MS})`;ui.seconds.textContent=`あと${Math.ceil(remaining/1000)}びょう`;
 }
 if(now-lastAnalysis>=60&&now>=mutedUntil){
  lastAnalysis=now;analyser.getFloatTimeDomainData(samples);const action=judge.observe(detector.detect(samples),game.current.midi,now);
  if(action==='accepted'&&game.correct(now))celebrate();
  else if(action==='reference'&&game.wrong(now))referenceTone();
 }
 frame=requestAnimationFrame(tick);
}
async function startAudio(fresh){
 if(starting){stop();$('begin').textContent='はじめる';text($('setupStatus'),'はじめるとマイクを使います。');return;}
 if(running)return;
 starting=true;const ticket=++ticketId;
 if(fresh){$('begin').textContent='やめる';text($('setupStatus'),'マイクを じゅんびしています');}
 else {text(ui.reaction,'マイクを じゅんびしています');ui.pause.textContent='やめる';}
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('unsupported');
  const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error('unsupported');
  if(!context||context.state==='closed')context=new AC();
  // ボタンを押した直後に再開し、iPhoneでもお手本を鳴らせるようにする。
  const resuming=context.resume();resuming.catch(()=>{});
  const incoming=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
  if(ticket!==ticketId){incoming.getTracks().forEach(t=>t.stop());return;}
  stream=incoming;await resuming;if(ticket!==ticketId)return;
  if(context.state!=='running')throw new Error('audio-suspended');
  source=context.createMediaStreamSource(stream);analyser=context.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=0;
  silentGain=context.createGain();silentGain.gain.value=0;source.connect(analyser);analyser.connect(silentGain);silentGain.connect(context.destination);
  detector=new PitchDetector(context.sampleRate);
  stream.getAudioTracks().forEach(track=>{track.onended=()=>{if(running)pause('マイクが とまったよ');};});
  if(fresh)game=new PracticeSession(count);else game.resumeNote();
  starting=false;running=true;ui.pause.textContent='やすむ';$('begin').textContent='はじめる';screen('practice');renderNote();frame=requestAnimationFrame(tick);
 }catch(error){
  if(ticket!==ticketId)return;
  stop();$('begin').textContent='もういちど';ui.pause.textContent='もういちど';
  const message=['NotAllowedError','PermissionDeniedError'].includes(error.name)?'マイクを許可して、もういちど始めてください。':error.message==='unsupported'?'SafariやChromeで、このページを開いてください。':'マイクを使えませんでした。もういちど試してください。';
  if(fresh){screen('setup');text($('setupStatus'),message);}else{text(ui.reaction,message);text(ui.status,'まだ練習は始まっていません。');}
 }
}
function toSetup(){stop();game=null;screen('setup');$('begin').textContent='はじめる';text($('setupStatus'),'マイクの音は端末の中だけで処理し、録音・保存・送信はしません。');$('confetti').replaceChildren();}
renderChoices();
document.querySelectorAll('[data-character]').forEach(button=>button.addEventListener('click',()=>{chosen=button.dataset.character;renderChoices();}));
document.querySelectorAll('[data-count]').forEach(button=>button.addEventListener('click',()=>{count=Number(button.dataset.count);document.querySelectorAll('[data-count]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.count)===count)));}));
$('begin').addEventListener('click',()=>startAudio(true));$('again').addEventListener('click',()=>{screen('setup');startAudio(true);});
ui.pause.addEventListener('click',()=>{if(running||starting)pause();else startAudio(false);});$('next').addEventListener('click',()=>nextNote(true));
$('home').addEventListener('click',toSetup);$('choose').addEventListener('click',toSetup);
ui.volume.addEventListener('input',()=>{$('volumeValue').textContent=`${ui.volume.value}%`;});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(running||starting)){if(game)pause();else{stop();$('begin').textContent='はじめる';text($('setupStatus'),'「はじめる」で再開できます。');}}});
window.addEventListener('pagehide',stop);
if(document.modelContext?.registerTool){
 const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
 try{Promise.resolve(document.modelContext.registerTool({name:'pause_violin_practice',title:'バイオリン練習を休む',description:'Pause this exercise and stop its microphone and reference sound. Does not start microphone access.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new Error('Expected an empty object');if(game&&!game.done)pause();else stop();return{paused:!running,microphoneActive:!!stream};}},{signal:lifecycle.signal})).catch(()=>{});}catch{}
}
