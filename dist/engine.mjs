export const ERROR_WAIT_MS = 4000;
export const SUCCESS_MS = 850;
export const NOTES = Object.freeze([
  {id:'a0',color:'red',string:'ラ',finger:0,name:'ラ',midi:69},
  {id:'a1',color:'red',string:'ラ',finger:1,name:'シ',midi:71},
  {id:'a2',color:'red',string:'ラ',finger:2,name:'ド♯',midi:73},
  {id:'a3',color:'red',string:'ラ',finger:3,name:'レ',midi:74},
  {id:'e0',color:'green',string:'ミ',finger:0,name:'ミ',midi:76},
  {id:'e1',color:'green',string:'ミ',finger:1,name:'ファ♯',midi:78},
  {id:'e2',color:'green',string:'ミ',finger:2,name:'ソ♯',midi:80},
  {id:'e3',color:'green',string:'ミ',finger:3,name:'ラ',midi:81}
]);
export const frequencyFor = midi => 440 * 2 ** ((midi - 69) / 12);
export function shuffledNotes(previousId, random = Math.random) {
  const items = [...NOTES];
  for (let i=items.length-1;i>0;i--) {const j=Math.floor(random()*(i+1));[items[i],items[j]]=[items[j],items[i]];}
  if (items[0].id === previousId) [items[0],items[1]]=[items[1],items[0]];
  return items;
}
// YIN normalized difference. Work at half the input sample rate.
export class PitchDetector {
  constructor(sampleRate) {
    this.rate=sampleRate/2;
    this.samples=new Float32Array(1024);
    this.maxTau=Math.min(510,Math.ceil(this.rate/150));
    this.diff=new Float32Array(this.maxTau+1);
  }
  detect(input) {
    const x=this.samples, size=Math.min(x.length, Math.floor(input.length/2));
    let sum=0;
    for(let i=0;i<size;i++){x[i]=(input[i*2]+input[i*2+1])/2;sum+=x[i];}
    const mean=sum/size;
    let power=0;
    for(let i=0;i<size;i++){x[i]-=mean;power+=x[i]*x[i];}
    const rms=Math.sqrt(power/size);
    if(rms<0.007) return {frequency:null,confidence:0,rms};
    const n=size-this.maxTau, d=this.diff;
    let total=0;
    d[0]=1;
    for(let tau=1;tau<=this.maxTau;tau++){
      let v=0;
      for(let i=0;i<n;i++){const delta=x[i]-x[i+tau];v+=delta*delta;}
      total+=v;d[tau]=total>0?v*tau/total:1;
    }
    let tau=Math.max(2,Math.floor(this.rate/1500));
    for(;tau<this.maxTau;tau++){
      if(d[tau]<0.12){
        while(tau+1<this.maxTau && d[tau+1]<d[tau]) tau++;
        const denominator=2*(2*d[tau]-d[tau-1]-d[tau+1]);
        const shift=denominator ? (d[tau+1]-d[tau-1])/denominator : 0;
        return {frequency:this.rate/(tau+Math.max(-1,Math.min(1,shift))),confidence:1-d[tau],rms};
      }
    }
    return {frequency:null,confidence:0,rms};
  }
}
export function pitchDistance(frequency, targetMidi) {
  if(!Number.isFinite(frequency)||frequency<=0) return Infinity;
  const cents=1200*Math.log2(frequency/frequencyFor(targetMidi));
  // Octave forgiving: also prevents an overtone estimate from sounding a false correction.
  return Math.abs(((cents+600)%1200+1200)%1200-600);
}
export class GentleJudge {
  reset(start=0){this.start=start;this.last=null;this.good=0;this.wrong=0;this.accepted=false;this.prompted=false;}
  constructor(){this.reset();}
  observe(reading,targetMidi,now){
    if(this.accepted||now-this.start<200)return null;
    let dt=this.last===null?0:Math.max(0,Math.min(120,now-this.last));
    if(this.last!==null && now-this.last>180){this.good=0;this.wrong=0;dt=0;}
    this.last=now;
    if(!reading.frequency || reading.confidence<0.9 || reading.rms<0.007){this.good=0;this.wrong=0;return null;}
    const distance=pitchDistance(reading.frequency,targetMidi);
    if(distance<=100.01){this.good+=dt;this.wrong=0;if(this.good>=180){this.accepted=true;return 'accepted';}}
    else if(distance>150){this.wrong+=dt;this.good=0;if(this.wrong>=600&&!this.prompted){this.prompted=true;return 'reference';}}
    else {this.good=0;this.wrong=0;}
    return null;
  }
}

// 隣り合う音を中心にした4音。ひとまとまりとして弾ける形にする。
const PHRASES = [
 [0,1,2,3],[3,2,1,0],[4,5,6,7],[7,6,5,4],
 [0,1,2,0],[4,5,6,4],[2,3,4,5],[5,4,3,2],
 [0,2,1,0],[4,6,5,4],[1,2,3,2],[5,6,7,6]
];
export function makeSessionNotes(count,random=Math.random){
 if(![1,3,5].includes(count))throw new RangeError('Choose 1, 3 or 5 phrases');
 let previous=-1;const notes=[];
 for(let i=0;i<count;i++){
  let pick=Math.floor(random()*PHRASES.length);
  if(pick===previous)pick=(pick+1)%PHRASES.length;
  previous=pick;notes.push(...PHRASES[pick].map(index=>NOTES[index]));
 }
 return notes;
}
export class PracticeSession {
 constructor(count,random=Math.random){this.notes=makeSessionNotes(count,random);this.count=count;this.index=0;this.results=[];this.done=false;this.resetNote();}
 get current(){return this.notes[this.index];}
 resetNote(){this.deadline=null;this.result=null;}
 wrong(now){if(this.result==='correct'||this.deadline!==null||this.done)return false;this.deadline=now+ERROR_WAIT_MS;this.result='waiting';return true;}
 correct(now){if(this.result==='correct'||this.done)return false;this.result='correct';this.deadline=now+SUCCESS_MS;return true;}
 advance(now,force=false){
  if(this.done||(!force&&(this.deadline===null||now<this.deadline)))return null;
  this.results.push(this.result==='correct'?'correct':'passed');
  if(this.index+1>=this.notes.length){this.done=true;return 'finished';}
  this.index++;this.resetNote();return 'next';
 }
 resumeNote(){this.resetNote();}
}
