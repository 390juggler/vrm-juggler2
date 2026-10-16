import {sequenceFromBasicParts,sequenceFromPreset,analyzeSequence,connectSequenceList,
  type SyncSequence,type SyncSequenceSet,type BasicColumnStyle,type BasicShortStyle} from './sync-sequence';
import {shortDefinition,type ShortStyle,type ShortMotionOptions} from './sync-motion';
import type {SyncBoxTracks} from './sync-box';
import type {SpaceTransform} from './tracks';

export interface BasePatternParts {
  base:'box'|'high-low'|'shower'|'double';
  columns:BasicColumnStyle;
  passes:string[];
  highHand:0|1;
  alternateHigh:boolean;
  swap:'left-over'|'right-over'|'alternate';
  highPath:'vertical'|'shower';
}
export interface BaseRouteDocument {
  kind:'sync-base-route';version:1;beatDuration:number;mirror:boolean;
  blocks:{parts:BasePatternParts;repeats:number}[];
}
const basic=['normal','shuffle','reverse','inverted'];
const labels:Record<string,string>={normal:'Normal',shuffle:'Shuffle',reverse:'Reverse Shuffle',inverted:'Inverted'};
export function parseShortPart(key:string):{style:ShortStyle;options:ShortMotionOptions;name:string}{
  if(basic.includes(key))return {style:key as ShortStyle,options:{ballOrder:'style'},name:labels[key]};
  if(key.startsWith('lateral-')&&basic.includes(key.slice(8)))return {style:key.slice(8) as ShortStyle,
    options:{ballOrder:'style',lateral:true},name:labels[key.slice(8)]+' Lateral'};
  const vertical=/^(outside|center|cross-side)-vertical-(up|down)$/.exec(key);
  if(vertical)return {style:('vertical-'+vertical[2]) as ShortStyle,options:{lane:vertical[1] as ShortMotionOptions['lane']},
    name:`${vertical[1]==='cross-side'?'Cross side':vertical[1]==='center'?'Center':'Outside'} column ${vertical[2]==='up'?'Up':'Down'}`};
  throw new Error('2xの投げ方を選んでください。');
}
const columnName:Record<BasicColumnStyle,string>={normal:'Normal',switched:'Switched',crossed:'Cross左上','crossed-right':'Cross右上','crossed-alternate':'Cross上下交代',underarm:'Underarm'};

export function sequenceFromBaseParts(parts:BasePatternParts,beatDuration=.205):SyncSequence{
  if(!parts||!['box','high-low','shower','double'].includes(parts.base)||!Object.prototype.hasOwnProperty.call(columnName,parts.columns)||
    ![0,1].includes(parts.highHand)||typeof parts.alternateHigh!=='boolean'||!['left-over','right-over','alternate'].includes(parts.swap)||
    !['vertical','shower'].includes(parts.highPath)||!Array.isArray(parts.passes)||parts.passes.length>4)throw new Error('ベースパターンの設定を確認してください。');
  const expected=parts.base==='double'?4:parts.base==='box'?2:1;
  if(parts.passes.length!==expected)throw new Error(`このベースには2xの指定が${expected}個必要です。`);
  const passes=parts.passes.map(parseShortPart);
  const setShort=(row:SyncSequenceSet,h:number,key:number)=>{
    row.motion.hands||=[];
    row.motion.hands[h]={...row.motion.hands[h],style:passes[key].style,definition:undefined,shortMotion:structuredClone(passes[key].options)};
  };
  const columnRow=(highHand:number)=>{
    const base=sequenceFromBasicParts({roles:'alternate',columns:parts.columns,shortHand:1,left:'normal',right:'normal'});
    return structuredClone(base.sets.find(s=>s.throws[highHand]==='4')!);
  };
  let s:SyncSequence;
  if(parts.base==='box'){
    s=sequenceFromBasicParts({roles:'alternate',columns:parts.columns,shortHand:1,
      left:(basic.includes(parts.passes[0])?parts.passes[0]:'normal') as BasicShortStyle,
      right:(basic.includes(parts.passes[1])?parts.passes[1]:'normal') as BasicShortStyle});
    s.sets.forEach(row=>{const h=row.throws.indexOf('2x');if(!basic.includes(parts.passes[h]))setShort(row,h,h);});
    s.name=`Box / ${columnName[parts.columns]} / 左 ${passes[0].name}・右 ${passes[1].name}`;
  }else if(parts.base==='high-low'){
    const sets:SyncSequenceSet[]=[];
    // A fixed high hand needs 6x: the other hand receives the long throw while
    // its partner can keep launching the next one. Alternating highs use 6.
    for(let pair=0;pair<2;pair++){
      const high=parts.alternateHigh?(parts.highHand+pair)%2:parts.highHand;
      const row=columnRow(high);row.throws[high]=parts.alternateHigh?'6':'6x';setShort(row,1-high,0);sets.push(row);
      const upper=parts.swap==='alternate'?pair%2:parts.swap==='left-over'?0:1;
      sets.push({throws:['2x','2x'],repeat:1,motion:{columns:'normal',short:['normal'],
        hands:[{heightOffset:upper===0?.10:-.10},{heightOffset:upper===1?.10:-.10}]}});
    }
    s={version:1,name:`High-Low / ${columnName[parts.columns]} / ${passes[0].name} / ハイ${parts.alternateHigh?'左右交代':parts.highHand?'右固定':'左固定'}`,
      sets,mirrorRepeat:false,beatDuration};
  }else if(parts.base==='shower'){
    s=sequenceFromPreset('shower');const high=parts.highHand,low=1-high;
    s.sets=[{throws:high===0?['4x','2x']:['2x','4x'],repeat:1,motion:{columns:'normal',short:[passes[0].style]}}];
    const row=s.sets[0];setShort(row,low,0);
    // Shower has an arc paired with the pass, not two independent columns.
    // Keep their shared endpoints rather than solving a column pass against
    // an arc whose endpoints would subsequently move again.
    row.motion.hands![low]!.shortMotion!.ballOrder=undefined;
    const d=shortDefinition(passes[0].style,passes[0].options,false,false);
    // The long throw starts at the short pass's arrival, and lands at its
    // next departure. Lateral reverses both lanes together.
    row.motion.hands![high]={definition:{release:{...d.catch,x:-d.catch.x},catch:{...d.release,x:-d.release.x},
      passage:{at:.5},carry:{route:'direct',amount:0},emptyReturn:{route:'direct',amount:0}}};
    s.name=`Shower / ハイ${high?'右':'左'} / ${passes[0].name}`;
  }else{
    s=sequenceFromPreset('double-box');
    s.sets.forEach((row,i)=>{
      const low=row.throws.indexOf('2x'),high=1-low;setShort(row,low,i);
      // Consecutive high throws use alternating spatial lanes even while the
      // same hand throws twice. This keeps the two standing columns distinct.
      const crossing=row.throws[high].endsWith('x');
      const x=parts.highPath==='vertical'?(i%2===0?-.19:.19)*(high===0?-1:1):.19,end=parts.highPath==='shower'&&crossing?-x:x;
      row.motion.hands![high]={definition:{release:{x,y:0,z:-.30},catch:{x:end,y:0,z:-.30},passage:{at:.5},
        carry:{route:'direct',amount:0},emptyReturn:{route:'direct',amount:0}}};
    });
    s.name=`Double Box / ${parts.highPath==='vertical'?'全コラム縦':'Showerを挟む'} / ${passes.map(p=>p.name).join('・')}`;
  }
  s.beatDuration=beatDuration;s.allowBallContact=true;s.name=s.name.slice(0,100);
  const a=analyzeSequence(s);if(!a.ok)throw new Error(a.issues.map(i=>i.message).join('\n'));
  return s;
}

export function compileBaseRoute(input:unknown){
  const d=input as BaseRouteDocument;
  if(!d||d.kind!=='sync-base-route'||d.version!==1||typeof d.mirror!=='boolean'||!Number.isFinite(d.beatDuration)||d.beatDuration<.12||d.beatDuration>.4||
    !Array.isArray(d.blocks)||!d.blocks.length||d.blocks.length>16)throw new Error('技の並び・テンポを確認してください。');
  const sequences=d.blocks.map(b=>{
    if(!b||!Number.isInteger(b.repeats)||b.repeats<1||b.repeats>8)throw new Error('繰り返しは1〜8回です。');
    const s=sequenceFromBaseParts(b.parts,d.beatDuration);
    s.sets=Array.from({length:b.repeats},()=>structuredClone(s.sets)).flat();return s;
  });
  return {...connectSequenceList(sequences,d.beatDuration),document:structuredClone(d)};
}

/** Redirect airborne throws across a section boundary to the receiver's next
 * release position. The set count and every release time remain unchanged. */
export function directBoundarySequence(sequence:SyncSequence,tracks:SyncBoxTracks,transform:SpaceTransform,mirror=false,width=1){
  const s=structuredClone(sequence),rows=s.sets,scale=transform.horizontalScale,beat=s.beatDuration;
  let changed=0;const mod=(n:number,d:number)=>(n%d+d)%d,physical=(h:number)=>mirror?1-h:h;
  rows.forEach((row,index)=>{
    const flights=[0,1].map(h=>tracks.flights.find(f=>f.throwHand===physical(h)&&Math.floor((f.release+1e-8)/(2*beat))===index));
    if(flights.some(f=>!f))return; // Scheduling-only holds retain their original definition.
    const order=row.motion.armOrder||(row.motion.columns==='crossed'?'left-over':'none');
    const armPhase=order==='alternate'?row.motion.armPhase??index%2:undefined;
    const upper=(i:number)=>order==='right-over'?1:order==='alternate'?mod(i,2):0;
    const under=flights.some(f=>f!.motion.release.relation==='underarm'||f!.motion.catch.relation==='underarm');
    const base=1.15+transform.offsetY+(under?.085:order!=='none'?.08:0)*scale;
    const hands=flights.map((flight,h)=>{
      const f=flight!,d=structuredClone(f.motion),target=rows[(index+f.value/2)%rows.length];
      const nextTime=mod(f.release+f.value*beat,tracks.period);
      const next=tracks.flights.find(g=>g.throwHand===f.catchHand&&Math.abs(g.release-nextTime)<1e-7);
      const redirect=row.sourceName!==target.sourceName&&!!next;
      for(const key of ['release','catch'] as const){
        const p=key==='release'?f.start:redirect?next!.start:f.end;
        const hand=key==='release'?h:physical(f.catchHand),set=(armPhase??index)+(key==='release'?0:f.value/2);
        const sign=order==='none'?0:hand===upper(set)?1:-1;
        d[key]={x:width*(mirror?-p.x:p.x)/(h===0?-1:1)/scale,y:(p.y-base)/scale-sign*.07,z:width*p.z/scale+sign*.02,relation:d[key].relation};
      }
      if(redirect){changed++;d.catch.relation=next!.motion.release.relation;}
      d.passage={at:.5};delete d.catchAtApex;
      d.flightFraction=f.duration/(f.value*beat);
      // A redirected downward pass becomes a transition arc, so its flight
      // time remains fixed even if its new destination is above its release.
      const style=f.style==='vertical-down'&&redirect?'normal':f.style;
      if(style==='vertical-down')delete d.flightFraction;
      return {definition:d,...(f.value===2?{style:style as ShortStyle}:{}),releaseGrip:f.releaseGrip,catchGrip:redirect?next!.releaseGrip:f.catchGrip};
    });
    row.motion={columns:order==='none'?'normal':'crossed',armOrder:order,short:row.motion.short,
      ...(armPhase===undefined?{}:{armPhase:armPhase as 0|1}),hands:hands as SyncSequenceSet['motion']['hands']};
  });
  return {sequence:s,redirectedThrows:changed};
}
