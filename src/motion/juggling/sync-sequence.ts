import {SYNC_BOX_PRESETS,SyncBoxConfig,SyncSetMotion,HandGrip,syncBeat} from './sync-box';
import {shortDefinition,validateDefinition,MotionDefinition} from './sync-motion';

export interface SyncSequenceSet {
  /** Siteswap for the performer's left and right hand. x changes the receiver. */
  throws:[string,string];
  motion:SyncSetMotion;
  repeat:number;
  /** Display-only provenance; editing a row does not change its source. */
  sourceName?:string;
}
export interface SyncSequence {
  version:1;
  name:string;
  sets:SyncSequenceSet[];
  mirrorRepeat:boolean;
  beatDuration:number;
  /** Ball-ball contact is permitted; hand, arm and passage-order constraints remain hard. */
  allowBallContact?:boolean;
}
/** Editable coordinates before avatar scaling and arm-order offsets. */
export function sequenceHandDefinition(set:SyncSequenceSet,hand:number):MotionDefinition {
  const m=set.motion,h=m.hands?.[hand],crossing=(m.armOrder||'none')!=='none'||m.columns==='crossed';
  const switched=m.columns==='switched'||m.columns==='underarm';
  if(h?.definition)return structuredClone(h.definition);
  if(set.throws[hand]==='2'){
    const p={x:.22,y:0,z:m.columns==='crossed'?-.26:m.columns==='switched'||m.columns==='underarm'?-.27:-.30};
    return {release:{...p},catch:{...p},passage:{at:.5},carry:{route:'direct',amount:0}};
  }
  const inherited=m.shortMotions?.[0]||{};
  const options=h?.shortMotion||(h?.style?{...inherited,definition:undefined}:inherited);
  if(set.throws[hand].startsWith('2'))return shortDefinition(h?.style||m.short?.[0]||'normal',options,switched,crossing);
  if(m.columnMotion)return structuredClone(m.columnMotion);
  const x=switched||crossing?-.16:.19,z=m.columns==='crossed'?-.26:switched?-.27:-.30;
  return {release:{x,y:0,z},passage:{at:.5},catch:{x:set.throws[hand].endsWith('x')?-x:x,y:0,z},carry:{route:switched||options.lateral?'front':'direct',amount:.06}};
}
export interface SequenceIssue {set:number;hand?:number;message:string}
export interface SequenceAnalysis {
  ok:boolean;documentOK:boolean;issues:SequenceIssue[];inputSets:number;expandedSets:number;
  movementSets:number;identitySets:number;balls:number;siteswap:string;
  name:string;notation:string;canonical:string;
  code:string;
}
const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;
const lcm=(a:number,b:number)=>a*b/gcd(a,b);
const parseThrow=(s:string)=>/^(?:2T|(0|2|4|6|8|a|c)x?)$/.test(s)?{value:parseInt(s[0],36),cross:s.endsWith('x')}:null;
const canonicalize=(v:any):any=>Array.isArray(v)?v.map(canonicalize):v&&typeof v==='object'?
  Object.fromEntries(Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>[k,canonicalize(v[k])])):v;
const signature=(s:SyncSequenceSet)=>JSON.stringify(canonicalize({throws:s.throws,motion:s.motion}));
const materializeSequence=(s:SyncSequence)=>{
  const rows=s.sets.map(r=>({...structuredClone(r),sourceName:r.sourceName||s.name}));
  if(s.mirrorRepeat)rows.push(...rows.map(r=>({...structuredClone(r),throws:[r.throws[1],r.throws[0]] as [string,string],
    motion:{...structuredClone(r.motion),hands:r.motion.hands?structuredClone([r.motion.hands[1],r.motion.hands[0]] as SyncSetMotion['hands']):undefined}})));
  return rows;
};

export function expandSequence(sequence:SyncSequence):SyncSequenceSet[]{
  const result=sequence.sets.flatMap(s=>Array.from({length:s.repeat},()=>structuredClone({...s,repeat:1})));
  if(sequence.mirrorRepeat)result.push(...result.map(s=>({...structuredClone(s),throws:[s.throws[1],s.throws[0]] as [string,string],
    motion:{...structuredClone(s.motion),hands:s.motion.hands?[s.motion.hands[1],s.motion.hands[0]]:undefined} as SyncSetMotion})));
  return result;
}

/** Import one expanded set, retaining its motion and alternating-cross phase. */
export function extractSequenceSet(sequence:SyncSequence,index:number):SyncSequenceSet{
  if(!analyzeSequence(sequence).documentOK)throw new Error('取り込む見本の投げ・動作・回数を確認してください。');
  const rows=expandSequence(sequence);
  if(!Number.isInteger(index)||index<0||index>=rows.length)throw new Error('見本内のセットを選択してください。');
  const row=rows[index];
  row.sourceName=`${row.sourceName||sequence.name} / 見本のセット${index+1}`.slice(0,100);
  if(row.motion.armOrder==='alternate'&&row.motion.armPhase===undefined)row.motion.armPhase=index%2 as 0|1;
  return row;
}

/** Rebase a complete cycle without changing its cyclic order or hand motions. */
export function rotateSequenceStart(sequence:SyncSequence,index:number):SyncSequence{
  const analysis=analyzeSequence(sequence);
  if(!analysis.ok)throw new Error('開始セットを変える前に、元の列の受け渡しを成立させてください。');
  const rows=expandSequence(sequence);
  if(!Number.isInteger(index)||index<0||index>=rows.length)throw new Error('見本内の開始セットを選択してください。');
  if(index===0)return structuredClone(sequence);
  const automaticCross=rows.some(r=>r.motion.armOrder==='alternate'&&r.motion.armPhase===undefined);
  if(automaticCross&&analysis.movementSets%2!==0)
    throw new Error('奇数周期の上下交代クロスは、各セットのクロス開始側を指定してから開始位置を変えてください。');
  rows.forEach((r,i)=>{
    r.sourceName ||= sequence.name;
    if(r.motion.armOrder==='alternate'&&r.motion.armPhase===undefined)r.motion.armPhase=i%2 as 0|1;
  });
  const rotated=[...rows.slice(index),...rows.slice(0,index)],sets:SyncSequenceSet[]=[];
  for(const row of rotated){
    const last=sets[sets.length-1];
    if(last&&last.repeat<16&&last.sourceName===row.sourceName&&signature(last)===signature(row))last.repeat++;
    else sets.push(row);
  }
  if(sets.length>64)throw new Error('開始位置を展開すると64行を超えます。回数を減らしてから変更してください。');
  return {...structuredClone(sequence),sets,mirrorRepeat:false};
}

/** Append complete cycles, including each section's own mirrored half. */
export function appendSequence(current:SyncSequence,next:SyncSequence,matchTempo=true):{sequence?:SyncSequence;message:string;addedSets:number}{
  const a=analyzeSequence(current),b=analyzeSequence(next);
  if(!a.documentOK||!b.documentOK)return {message:'投げ・動作・回数の入力を修正してから追加してください。',addedSets:0};
  if(a.ok&&b.ok&&a.balls!==b.balls)return {message:`${a.balls}球と${b.balls}球は、そのまま受け渡しをつなげません。同じ球数の見本を選んでください。`,addedSets:0};
  const added=materializeSequence(next),sets=[...materializeSequence(current),...added];
  const addedSets=added.reduce((n,s)=>n+s.repeat,0);
  if(sets.length>64||sets.reduce((n,s)=>n+s.repeat,0)>128)
    return {message:'追加すると64行または展開後128セットを超えます。列を短くしてください。',addedSets:0};
  const beatDuration=matchTempo?Math.min(current.beatDuration,next.beatDuration):current.beatDuration;
  const sequence:SyncSequence={...structuredClone(current),allowBallContact:current.allowBallContact||next.allowBallContact||undefined,name:`${current.name} → ${next.name}`.slice(0,100),sets,mirrorRepeat:false,beatDuration};
  const tempo=beatDuration!==current.beatDuration?` 1セットを${Number((beatDuration*2).toFixed(5))}秒に揃えました。`:
    current.beatDuration!==next.beatDuration?` 1セットは現在の${Number((beatDuration*2).toFixed(5))}秒です。`:'';
  return {sequence,addedSets,message:`${next.name||'見本'}を${addedSets}セット追加しました。左右交代も各区間の中へ展開しています。${tempo} 最後から先頭への戻りも「接続して再生」で検査します。`};
}

/** Future arrivals at a cycle boundary. Two bits per set: left, then right. */
function arrivalState(rows:SyncSequenceSet[],horizon:number):number{
  let state=0;
  for(let past=-horizon;past<0;past++)for(let hand=0;hand<2;hand++){
    const t=parseThrow(rows[(past%rows.length+rows.length)%rows.length].throws[hand])!;
    const at=past+t.value/2;
    if(t.value&&at>=0)state|=1<<(at*2+(t.cross?1-hand:hand));
  }
  return state;
}

/** Breadth-first search of the finite, non-multiplex synchronous state graph. */
function transferBridge(from:number,to:number,horizon:number):SyncSequenceSet[]|undefined{
  if(from===to)return [];
  // Prefer short passes and columns to holds when several shortest paths exist.
  const choices=['2x','4','4x','2',...Array.from({length:Math.max(0,horizon-2)},(_,i)=>[(i*2+6).toString(36),(i*2+6).toString(36)+'x']).flat()]
    .filter(s=>parseThrow(s)!.value/2<=horizon);
  const queue=[from],seen=new Map<number,{previous:number;throws:[string,string]}>();
  seen.set(from,{previous:from,throws:['0','0']});
  for(let index=0;index<queue.length;index++){
    const state=queue[index],available=[state&1,state&2];
    for(const left of available[0]?choices:['0'])for(const right of available[1]?choices:['0']){
      // Equal opposing passes reach the same state as self throws, but their
      // default paths collide. The self-throw edge retains graph reachability.
      if(left===right&&left.endsWith('x'))continue;
      const pair:[string,string]=[left,right];let landing=state&~3,valid=true;
      for(let hand=0;hand<2;hand++){
        const t=parseThrow(pair[hand])!;if(!t.value)continue;
        const bit=1<<(t.value+(t.cross?1-hand:hand));
        if(landing&bit){valid=false;break;}landing|=bit;
      }
      if(!valid)continue;
      const next=landing>>>2;if(seen.has(next))continue;
      seen.set(next,{previous:state,throws:pair});
      if(next===to){
        const rows:SyncSequenceSet[]=[];let p=next;
        while(p!==from){const edge=seen.get(p)!;rows.push({throws:edge.throws,repeat:1,sourceName:'受け渡しのつなぎ',motion:{columns:'normal',short:['normal']}});p=edge.previous;}
        return rows.reverse();
      }
      queue.push(next);
    }
  }
  return undefined;
}

/** Preserve both cycles and insert throws for their boundary states in both directions.
 * This establishes ball scheduling only; the complete spatial/rig inspection still applies.
 */
export function connectSequenceCycles(current:SyncSequence,next:SyncSequence,matchTempo=true){
  const counts={bridgeSets:0,forwardSets:0,returnSets:0};
  const a=analyzeSequence(current),b=analyzeSequence(next);
  if(!a.ok||!b.ok)return {...counts,message:'受け渡しを補うには、追加する前の2つの列をそれぞれ成立させてください。',addedSets:0};
  const appended=appendSequence(current,next,matchTempo);
  if(!appended.sequence)return {...appended,...counts};
  const first=expandSequence(current),second=expandSequence(next);
  const horizon=Math.max(1,...[...first,...second].flatMap(r=>r.throws.map(t=>parseThrow(t)!.value/2)));
  const from=arrivalState(first,horizon),to=arrivalState(second,horizon);
  const forward=transferBridge(from,to,horizon),back=transferBridge(to,from,horizon);
  if(!forward||!back)return {...counts,message:'現在の投げの高さの範囲では、両方向の受け渡しをつなげませんでした。',addedSets:0};
  if(!forward.length&&!back.length)return {...appended,...counts};
  const sets=[...materializeSequence(current),...forward,...materializeSequence(next),...back];
  const sequence={...appended.sequence,sets};
  const result=analyzeSequence(sequence);
  if(!result.ok)return {...counts,message:'つなぎを加えると行数・周期の上限を超えるか、受け渡しが成立しません。元の列を保持しました。',addedSets:0};
  return {sequence,bridgeSets:forward.length+back.length,forwardSets:forward.length,returnSets:back.length,
    addedSets:appended.addedSets+forward.length+back.length,
    message:`${appended.message} 受け渡しのつなぎを区間の境目に${forward.length}セット、先頭への戻りに${back.length}セット補いました。位置と腕の動きは再生時に検査します。`};
}

/** Keep the requested set count whenever arrival schedules already match.
 * Only a mismatch in ball ownership can add short scheduling transfers. */
export function connectSequenceList(sequences:SyncSequence[],beatDuration:number){
  if(!sequences.length||sequences.length>16)throw new Error('技を1〜16個並べてください。');
  const analyses=sequences.map(analyzeSequence);
  if(analyses.some(a=>!a.ok||a.balls!==analyses[0].balls))throw new Error('各技の球数と受け渡しをそろえてください。');
  const rows=sequences.map((s,index)=>expandSequence(s).map(row=>({...row,sourceName:`${index+1}. ${s.name}`.slice(0,100)})));
  const horizon=Math.max(1,...rows.flat(2).flatMap(r=>r.throws.map(t=>parseThrow(t)!.value/2)));
  const sets:SyncSequenceSet[]=[],boundaries:{after:number;addedSets:number}[]=[];
  rows.forEach((part,i)=>{
    sets.push(...part);
    const bridge=transferBridge(arrivalState(part,horizon),arrivalState(rows[(i+1)%rows.length],horizon),horizon);
    if(!bridge)throw new Error('球の受け渡しをつなげませんでした。');
    boundaries.push({after:i,addedSets:bridge.length});
    sets.push(...bridge.map(row=>({...row,sourceName:'球の受け渡しを調整',motion:{...row.motion,transition:true}})));
  });
  const sequence:SyncSequence={version:1,name:sequences.map(s=>s.name).join(' → ').slice(0,100),sets,mirrorRepeat:false,beatDuration,
    allowBallContact:sequences.some(s=>s.allowBallContact)};
  const analysis=analyzeSequence(sequence);if(!analysis.ok)throw new Error(analysis.issues.map(i=>i.message).join('\n'));
  return {sequence,boundaries,addedSets:boundaries.reduce((n,b)=>n+b.addedSets,0),requestedSets:rows.flat().length};
}

export function analyzeSequence(sequence:SyncSequence):SequenceAnalysis{
  const issues:SequenceIssue[]=[];
  const base={ok:false,documentOK:false,issues,inputSets:0,expandedSets:0,movementSets:0,identitySets:0,balls:0,siteswap:'',name:sequence?.name||'',notation:'',canonical:'',code:''};
  if(!sequence||sequence.version!==1||!Array.isArray(sequence.sets)||sequence.sets.length<1||sequence.sets.length>64){
    issues.push({set:0,message:'セットを1〜64行で指定してください。'});return base;
  }
  if(!Number.isFinite(sequence.beatDuration)||sequence.beatDuration<.12||sequence.beatDuration>.40)
    issues.push({set:0,message:'1拍の時間は0.12〜0.40秒で指定してください。'});
  if(typeof sequence.name!=='string'||sequence.name.length>100||typeof sequence.mirrorRepeat!=='boolean')
    issues.push({set:0,message:'名前（100文字以内）と左右交代の設定を確認してください。'});
  if(sequence.allowBallContact!==undefined&&typeof sequence.allowBallContact!=='boolean')
    issues.push({set:0,message:'球同士の接触を許可する設定は true / false で指定してください。'});
  sequence.sets.forEach((s,i)=>{
    if(!s||!Number.isInteger(s.repeat)||s.repeat<1||s.repeat>16)issues.push({set:i,message:'繰り返しは1〜16回で指定してください。'});
    if(s?.sourceName!==undefined&&(typeof s.sourceName!=='string'||s.sourceName.length>100))issues.push({set:i,message:'元の見本名は100文字以内で指定してください。'});
    if(!s?.motion||!Array.isArray(s.throws)||s.throws.length!==2){issues.push({set:i,message:'左右の投げと動作を指定してください。'});return;}
    s.throws.forEach((t,h)=>{if(typeof t!=='string'||!parseThrow(t)||t==='0x')issues.push({set:i,hand:h,message:'投げは0・2・2T・2x・4・4x・6・6x・8・8x・a・ax・c・cxで指定してください。'});});
    const m=s.motion,styles=['normal','shuffle','reverse','inverted','vertical-up','vertical-down'];
    if(typeof m!=='object'||Array.isArray(m)||m.columns!==undefined&&!['normal','switched','crossed','underarm'].includes(m.columns)||
      m.armOrder!==undefined&&!['none','left-over','right-over','alternate'].includes(m.armOrder)||
      m.armPhase!==undefined&&(![0,1].includes(m.armPhase)||m.armOrder!=='alternate')||
      m.arrangement!==undefined&&!['columns','inline'].includes(m.arrangement)||
      m.inlineBlend!==undefined&&(!Number.isFinite(m.inlineBlend)||m.inlineBlend<0||m.inlineBlend>1)||
      m.transition!==undefined&&typeof m.transition!=='boolean'||
      m.short!==undefined&&(!Array.isArray(m.short)||!m.short.length||m.short.some(v=>!styles.includes(v)))||
      m.hands!==undefined&&(!Array.isArray(m.hands)||m.hands.length>2)||
      m.shortMotions!==undefined&&(!Array.isArray(m.shortMotions)||!m.shortMotions.length)){
      issues.push({set:i,message:'投げ方・腕の配置を確認してください。'});return;
    }
    try{
      if(m.columnMotion)validateDefinition(m.columnMotion);
      m.shortMotions?.forEach(o=>{if(o.definition)validateDefinition(o.definition);});
      m.hands?.forEach((h,hand)=>{
        if(!h)return;
        if(typeof h!=='object'||Array.isArray(h)){issues.push({set:i,hand,message:'手の動作の指定を確認してください。'});return;}
        if(h.style!==undefined&&!styles.includes(h.style)||h.heightOffset!==undefined&&(!Number.isFinite(h.heightOffset)||Math.abs(h.heightOffset)>.4))
          issues.push({set:i,hand,message:'投げ方、または高さ（±40cm）を確認してください。'});
        if([h.releaseGrip,h.catchGrip].some(g=>g!==undefined&&!['underhand','overhand'].includes(g)))
          issues.push({set:i,hand,message:'手の向きは下から支える、または上からつかむを指定してください。'});
        if(h.definition)validateDefinition(h.definition);
        if(h.shortMotion?.definition)validateDefinition(h.shortMotion.definition);
      });
    }catch{issues.push({set:i,message:'投げ・通過・捕球・運びの位置指定を確認してください。'});}
  });
  if(issues.length)return base;
  base.documentOK=true;
  const sets=expandSequence(sequence),n=sets.length;
  if(n>128){issues.push({set:0,message:'展開後は128セット以内にしてください。'});return base;}
  const throws=sets.map(s=>s.throws.map(t=>parseThrow(t)!));
  const incoming:number[][]=Array.from({length:n*2},()=>[]),next:number[]=new Array(n*2).fill(-1);
  let total=0;
  for(let i=0;i<n;i++)for(let h=0;h<2;h++){
    const t=throws[i][h];total+=t.value;if(!t.value)continue;
    const target=((i+t.value/2)%n)*2+(t.cross?1-h:h);
    incoming[target].push(i*2+h);next[i*2+h]=target;
  }
  incoming.forEach((arr,k)=>{
    const expected=throws[Math.floor(k/2)][k%2].value?1:0;
    if(arr.length!==expected)issues.push({set:Math.floor(k/2),hand:k%2,message:arr.length>expected?
      `この手に${arr.length}球が同時に戻ります。投げ先かセット順を変更してください。`:'この手が投げる球が戻ってきません。'});
  });
  const balls=total/(2*n);
  if(!Number.isInteger(balls)||balls<1||balls>9)issues.push({set:0,message:`この列の球数は${balls}球です。1〜9球の整数になる列にしてください。`});
  const siteswap=sets.map(s=>`(${s.throws.join(',')})`).join('');
  // Shape period may be shorter than the entered list. Include spatial stages,
  // hand roles and fixed arm order, so an odd list is not incorrectly closed.
  let movement=n;
  for(let d=1;d<=n;d++)if(n%d===0&&sets.every((s,i)=>signature(s)===signature(sets[i%d]))){movement=d;break;}
  let identity=0;
  if(!issues.length){
    // Each directed orbit winds around the sequence w times and contains w
    // distinct balls. Its identities return after w copies of the sequence.
    const seen=new Set<number>();let copies=1;
    for(let k=0;k<n*2;k++)if(next[k]>=0&&!seen.has(k)){
      let p=k,beats=0;
      do{seen.add(p);beats+=throws[Math.floor(p/2)][p%2].value/2;p=next[p];}while(p!==k&&!seen.has(p));
      copies=lcm(copies,beats/n);
    }
    identity=n*copies;
    // Recompute identity on the minimum spatial cycle instead of overstating it
    // when an identical block was entered several times.
    if(movement<n){const reduced={...sequence,sets:sets.slice(0,movement),mirrorRepeat:false};identity=analyzeSequence(reduced).identitySets;}
  }
  const notation=sets.slice(0,movement).map(s=>`(${s.throws.join(',')})`).join('');
  const canonical='SYNC1:'+JSON.stringify(canonicalize({beatDuration:sequence.beatDuration,allowBallContact:sequence.allowBallContact||undefined,sets:sets.slice(0,movement).map(s=>({throws:s.throws,motion:s.motion}))}));
  let hash=0x811c9dc5;for(const c of canonical){hash=Math.imul(hash^c.charCodeAt(0),0x01000193)>>>0;}
  const code=`${balls}B-S${movement}-C${identity}-${hash.toString(16).padStart(8,'0')}`;
  if(identity>128)issues.push({set:0,message:'同じ球まで戻る周期が128セットを超えます。列を短くしてください。'});
  return {...base,ok:!issues.length,inputSets:sequence.sets.reduce((a,s)=>a+s.repeat,0),expandedSets:n,movementSets:movement,identitySets:identity,balls,siteswap,notation,canonical,code};
}

export function compileSequence(sequence:SyncSequence):{config?:SyncBoxConfig;analysis:SequenceAnalysis}{
  const analysis=analyzeSequence(sequence);if(!analysis.ok)return {analysis};
  const sets=expandSequence(sequence).slice(0,analysis.movementSets);
  const first=sets[0].motion;
  const inline=sets.some(s=>s.motion.arrangement==='inline');
  const invalidInline=sets.findIndex(s=>(s.motion.arrangement==='inline'||(s.motion.inlineBlend||0)>0)&&
    (analysis.balls!==3||!['4,2x','2x,4'].includes(s.throws.join(','))||(s.motion.columns||'normal')!=='normal'||
      s.motion.armOrder&&s.motion.armOrder!=='none'||s.motion.short?.some(v=>v!==s.motion.short?.[0]||!['normal','inverted'].includes(v))||
      s.motion.hands?.some(h=>h?.heightOffset||h?.definition||h?.shortMotion||h?.style&&h.style!==s.motion.short?.[0])));
  if(invalidInline>=0){analysis.ok=false;analysis.issues.push({set:invalidInline,message:'In-line 3は3球の交互の4・2xで、通常コラムと同じ種類の2xを使います。個別の位置指定を外してください。'});return {analysis};}
  if(inline&&!sets.every(s=>s.motion.arrangement==='inline')){
    const rank=(s:SyncSequenceSet)=>s.motion.arrangement==='inline'?1:s.motion.inlineBlend||0;
    const firstUnsettled=sets.findIndex((s,i)=>s.motion.arrangement==='inline'&&[1,2].some(back=>rank(sets[(i-back+sets.length)%sets.length])<1));
    if(firstUnsettled>=0){analysis.ok=false;analysis.issues.push({set:firstUnsettled,message:'In-line 3の前に、3球を縦へ揃える入口が必要です。「In-lineの入口・出口を補う」で追加できます。'});return {analysis};}
  }
  return {analysis,config:{id:'sequence',name:sequence.name||analysis.notation,description:'セット列から接続した同期パターン。',
    // The source engine uses A (airborne) for a non-held 2. Keep the user's
    // conventional 2T spelling in the document, analysis and canonical name.
    siteswap:analysis.notation.replace(/2T/g,'2A'),short:first.short||['normal'],columns:first.columns||'normal',armOrder:first.armOrder,
    arrangement:first.arrangement,columnMotion:first.columnMotion,shortMotions:first.shortMotions,
    sets:sets.map(s=>({...s.motion,columns:s.motion.columns||'normal',short:s.motion.short||['normal'],
      arrangement:s.motion.arrangement||'columns',armOrder:s.motion.armOrder,
      columnMotion:s.motion.columnMotion,shortMotions:s.motion.shortMotions,inlineBlend:s.motion.inlineBlend})),
    beatDuration:sequence.beatDuration,allowBallContact:sequence.allowBallContact,experimental:true}};
}

/** Insert full synchronized pairs so the throw/catch graph keeps its phase. */
export function addInlineTransitions(sequence:SyncSequence):{sequence?:SyncSequence;message:string;addedSets:number}{
  const a=analyzeSequence(sequence);if(!a.ok)return {message:'球の受け渡しを先に成立させてください。',addedSets:0};
  const source=expandSequence(sequence);
  if(!source.some(s=>s.motion.arrangement==='inline')||source.every(s=>s.motion.arrangement==='inline'))
    return {sequence:structuredClone(sequence),message:'左右コラムとIn-line 3を同じ列に置いてから使います。',addedSets:0};
  const rank=(s:SyncSequenceSet)=>s.motion.arrangement==='inline'?1:s.motion.inlineBlend||0;
  if(source.every((s,i)=>{
    const previous=source[(i-1+source.length)%source.length];
    return s.motion.transition||previous.motion.transition||rank(s)===rank(previous);
  }))return {sequence:structuredClone(sequence),message:'入口・出口はすでにあります。追加しませんでした。',addedSets:0};
  if(source.some(s=>!['4,2x','2x,4'].includes(s.throws.join(','))||s.motion.columns!=='normal'||
      s.motion.armOrder&&s.motion.armOrder!=='none'||s.motion.short?.some(style=>style!=='normal')))
    return {message:'この入口は、通常のBoxと通常のIn-line 3の交互の4・2xに対応します。別の投げ列には受け渡しを変える遷移が必要です。',addedSets:0};
  const sets:SyncSequenceSet[]=[];
  source.forEach((s,i)=>{
    const previous=source[(i-1+source.length)%source.length];
    const q=s.motion.arrangement==='inline'?1:s.motion.inlineBlend||0;
    const prev=previous.motion.arrangement==='inline'?1:previous.motion.inlineBlend||0;
    if(!s.motion.transition&&!previous.motion.transition&&q!==prev){
      for(const blend of (q===1?[.25,.5,.75,.9,1]:[.9,.75,.5,.25,0]))for(let j=0;j<2;j++)sets.push({throws:j?[s.throws[1],s.throws[0]]:[...s.throws],repeat:1,
        motion:{columns:'normal',short:['normal'],arrangement:'columns',inlineBlend:blend,transition:true}});
    }
    sets.push(structuredClone(s));
  });
  if(sets.length>64)return {message:'入口を加えると64行を超えます。列を短くしてください。',addedSets:0};
  if(sets.length===source.length)return {sequence:structuredClone(sequence),message:'入口・出口はすでにあります。追加しませんでした。',addedSets:0};
  // Start at the user's first row; the cyclic exit can sit at the end.
  const start=sets.findIndex(s=>!s.motion.transition);
  sets.push(...sets.splice(0,start));
  const beatDuration=Math.min(sequence.beatDuration,syncBeat(SYNC_BOX_PRESETS.find(p=>p.id==='inline')!));
  return {sequence:{...sequence,sets,mirrorRepeat:false,beatDuration},addedSets:sets.length-source.length,
    message:`入口と出口を加えました。In-line 3の見本に合わせて、1セットを${(beatDuration*2).toFixed(3)}秒に揃えています。`};
}

export function sequenceFromPreset(id:string):SyncSequence{
  const p=SYNC_BOX_PRESETS.find(p=>p.id===id);if(!p)throw new Error('見本が見つかりません。');
  const pairs=[...p.siteswap.matchAll(/\(([^,]+),([^\)]+)\)/g)].map(m=>[m[1],m[2]] as [string,string]);
  if(p.siteswap.endsWith('*'))pairs.push(...pairs.map(([l,r])=>[r,l] as [string,string]));
  // Expand the source shape until alternating styles and arm order also close.
  const count=lcm(pairs.length,lcm(p.short.length,p.shortMotions?.length||1));
  const motion=(i:number):SyncSetMotion=>({profileId:p.id==='box-roll'?p.id:undefined,profileStep:p.id==='box-roll'?i:undefined,columns:p.columns,short:[p.short[i%p.short.length]],
    shortMotions:p.shortMotions?[structuredClone(p.shortMotions[i%p.shortMotions.length])]:undefined,
    columnMotion:structuredClone(p.columnMotion),armOrder:p.armOrder,arrangement:p.arrangement});
  return {version:1,name:p.name,mirrorRepeat:false,beatDuration:syncBeat(p),sets:Array.from({length:count},(_,i)=>({throws:pairs[i%pairs.length],motion:motion(i),repeat:1}))};
}

export type BasicShortStyle='normal'|'shuffle'|'reverse'|'inverted';
export type BasicColumnStyle='normal'|'switched'|'crossed'|'crossed-right'|'crossed-alternate'|'underarm';
export interface DoubleSequenceParts {
  crossSet:BasicShortStyle;selfSet:BasicShortStyle;
  columns?:BasicColumnStyle;
  crossReleaseGrip?:HandGrip;selfReleaseGrip?:HandGrip;
  crossCatchGrip?:HandGrip;selfCatchGrip?:HandGrip;
}
/** Double has two successive high throws per hand; styles belong to set phases. */
export function sequenceFromDoubleParts(parts:DoubleSequenceParts):SyncSequence{return applyDoubleParts(parts);}
/** Edit a Double's passes without replacing its authored high-ball layout. */
export function sequenceWithDoubleParts(source:SyncSequence,parts:DoubleSequenceParts):SyncSequence{return applyDoubleParts(parts,source);}
function applyDoubleParts(parts:DoubleSequenceParts,source?:SyncSequence):SyncSequence{
  const labels={normal:'下→下',shuffle:'上→下',reverse:'下→上',inverted:'上→上'};
  if(!parts||!Object.prototype.hasOwnProperty.call(labels,parts.crossSet)||!Object.prototype.hasOwnProperty.call(labels,parts.selfSet)||
    [parts.crossReleaseGrip,parts.selfReleaseGrip,parts.crossCatchGrip,parts.selfCatchGrip].some(g=>g!==undefined&&g!=='underhand'&&g!=='overhand'))
    throw new Error('Doubleの4x側とコラム4側の2xを確認してください。');
  if(source&&(source.sets.length!==4||!source.sets.some(row=>row.throws.includes('4x'))||!source.sets.some(row=>row.throws.includes('4'))||source.sets.some(row=>{
    const h=row.throws.indexOf('2x');return h<0||!['4','4x'].includes(row.throws[1-h]);
  })))throw new Error('編集元のDoubleは4または4xと2xの4セットで指定してください。');
  const s=source?structuredClone(source):sequenceFromPreset('double-box');
  s.sets.forEach(row=>{
    const hand=row.throws.indexOf('2x'),self=row.throws[1-hand]==='4',style=self?parts.selfSet:parts.crossSet;
    const releaseGrip=self?parts.selfReleaseGrip:parts.crossReleaseGrip,catchGrip=self?parts.selfCatchGrip:parts.crossCatchGrip;
    if(source){
      const current=row.motion.hands?.[hand],oldStyle=current?.style||row.motion.short?.[0]||'normal';
      if(style!==oldStyle){
        const options=structuredClone(current?.shortMotion||row.motion.shortMotions?.[0]||{});
        const authored=current?.definition||options.definition;
        if(authored){
          // A new height family must retain authored lanes (e.g. a centre
          // column). Replace its height/passage rule, not the whole base.
          const d=sequenceHandDefinition(row,hand),shape=shortDefinition(style,{},false,false);
          d.release.y=shape.release.y;d.catch.y=shape.catch.y;d.passage={at:.5};
          delete d.catchAtApex;delete d.flightFraction;
          options.definition=d;
        }
        options.ballOrder='style';
        row.motion.hands||=[];row.motion.hands[hand]={...current,style,shortMotion:options};
        delete row.motion.hands[hand]!.definition;
      }
      // Clearing a grip selection returns only this 2x to its automatic grip.
      if(row.motion.hands?.[hand]){delete row.motion.hands[hand]!.releaseGrip;delete row.motion.hands[hand]!.catchGrip;}
    }else row.motion.short=[style];
    if(releaseGrip||catchGrip){
      row.motion.hands||=[];
      row.motion.hands[hand]={...row.motion.hands[hand],...(releaseGrip?{releaseGrip}:{}),...(catchGrip?{catchGrip}:{})};
    }
  });
  const columnLabel={normal:'Normal',switched:'Switched',crossed:'Cross 左上','crossed-right':'Cross 右上','crossed-alternate':'Cross 上下交代',underarm:'Underarm'};
  const layout=parts.columns&&parts.columns!=='normal'?`｜配置 ${columnLabel[parts.columns]}`:'';
  s.name=`${source?source.name.split('｜配置 ')[0].split('｜2x ')[0]+layout+'｜2x ':'Double'+layout+' / '}4xと組む2x ${labels[parts.crossSet]}・4と組む2x ${labels[parts.selfSet]}`;
  if(parts.crossReleaseGrip||parts.selfReleaseGrip){
    const gripLabel=(g?:HandGrip)=>g==='underhand'?'下から':g==='overhand'?'クロー':'標準';
    s.name+=` / 手向き ${gripLabel(parts.crossReleaseGrip)}・${gripLabel(parts.selfReleaseGrip)}`;
  }
  if(parts.crossCatchGrip||parts.selfCatchGrip){
    const gripLabel=(g?:HandGrip)=>g==='underhand'?'下から':g==='overhand'?'クロー':'標準';
    s.name+=` / 捕り ${gripLabel(parts.crossCatchGrip)}・${gripLabel(parts.selfCatchGrip)}`;
  }
  return parts.columns===undefined?s:sequenceWithDoubleColumns(s,parts.columns);
}
/** Reassign the authored Double lanes without changing its throw schedule.
 * Switched moves the high throws across the body; Cross also crosses the 2x.
 * Underarm places the high throws as Switched does, with that arm beneath the
 * 2x arm; the layout then raises each crossing 2x as in Threaded Box.
 * Work relative to the current assignment so repeated edits do not accumulate. */
export function sequenceWithDoubleColumns(source:SyncSequence,columns:BasicColumnStyle):SyncSequence{
  if(!['normal','switched','crossed','crossed-right','crossed-alternate','underarm'].includes(columns))
    throw new Error('Doubleのコラム配置を選んでください。');
  const s=structuredClone(source),crossed=columns.startsWith('crossed');
  const order=crossed?(columns==='crossed-right'?'right-over':columns==='crossed-alternate'?'alternate':'left-over'):'none';
  s.sets.forEach((row,index)=>{
    const m=row.motion,oldCross=m.columns==='crossed',oldOrder=m.armOrder||(oldCross?'left-over':'none');
    const nextColumns=crossed?'crossed':columns as SyncSetMotion['columns'];
    if(m.columns===nextColumns&&oldOrder===order)return;
    const phase=m.armPhase??index%2;
    const sign=(o:string,h:number,step:number)=>o==='none'?0:h===(o==='right-over'?1:o==='alternate'?step%2:0)?1:-1;
    const oldSwitched=m.columns!=='normal',newSwitched=columns!=='normal';
    for(const hand of [0,1]){
      const short=row.throws[hand]==='2x',h=m.hands?.[hand],d=sequenceHandDefinition(row,hand);
      const vertical=short&&(h?.style||m.short?.[0]||'normal').startsWith('vertical-');
      // Across-body lanes use a narrower span, shared by both Double bases.
      // The centre stays at zero and undoing the assignment restores the span.
      const span=(across:boolean)=>across?-.6:1;
      // Named vertical 2x lanes (Outside/Center/Cross side) are anatomical.
      const ratio=vertical?1:span(short?crossed:newSwitched)/span(short?oldCross:oldSwitched);
      if(ratio!==1){
        d.release.x*=ratio;d.catch.x*=ratio;
        if(d.passage.point)d.passage.point[0]*=ratio;
      }
      // A 4x caught by the other arm must stay in its original depth plane.
      // Compensate only the receiver offset, retaining the chosen upper arm.
      if(!short||vertical){
        const receiver=row.throws[hand].endsWith('x')?1-hand:hand,steps=short?1:2;
        const correction=(o:string)=>(sign(o,receiver,phase+steps)-sign(o,hand,phase))*.02;
        d.catch.z+=correction(order)-correction(oldOrder);
      }
      m.hands||=[];
      if(short){
        const inherited=m.shortMotions?.[0]||{};
        const options=h?.shortMotion||(h?.style?{...inherited,definition:undefined}:inherited);
        m.hands[hand]={...h,shortMotion:{...structuredClone(options),definition:d}};
        delete m.hands[hand]!.definition;
      }else m.hands[hand]={...h,definition:d};
    }
    m.columns=nextColumns;m.armOrder=order;
    if(order==='alternate')m.armPhase=phase as 0|1;else delete m.armPhase;
  });
  return s;
}
export interface BasicSequenceParts {
  roles:'alternate'|'fixed';
  left:BasicShortStyle;
  right:BasicShortStyle;
  shortHand:0|1;
  columns?:BasicColumnStyle;
}
/** Four endpoint-height families; arm relations, grip and routes remain editable. */
export function sequenceFromBasicParts(parts:BasicSequenceParts):SyncSequence{
  const labels={normal:'下→下',shuffle:'上→下',reverse:'下→上',inverted:'上→上'};
  const columnLabels={normal:'通常',switched:'反対側を担当',crossed:'クロス左上','crossed-right':'クロス右上','crossed-alternate':'クロス上下交代',underarm:'コラムを腕の下で捕る'};
  const columns=parts?.columns||'normal';
  if(!parts||!['alternate','fixed'].includes(parts.roles)||![0,1].includes(parts.shortHand)||
    !Object.prototype.hasOwnProperty.call(labels,parts.left)||!Object.prototype.hasOwnProperty.call(labels,parts.right)||
    !Object.prototype.hasOwnProperty.call(columnLabels,columns)||parts.roles==='fixed'&&columns!=='normal')throw new Error('基本部品の左右、役割、投げ方を確認してください。');
  const s=sequenceFromPreset(parts.roles==='alternate'?'box':'shower');
  if(parts.roles==='fixed'&&parts.shortHand===0)s.sets.forEach(r=>r.throws.reverse());
  s.sets.forEach(r=>{r.motion.short=[r.throws[0]==='2x'?parts.left:parts.right];});
  const alternatingTransfer=columns==='crossed-alternate'&&[parts.left,parts.right].every(v=>v==='normal'||v==='inverted')&&
    (parts.left==='inverted'||parts.right==='inverted');
  const sharedPlane=columns==='switched'&&parts.left!==parts.right&&![parts.left,parts.right].every(v=>v==='normal'||v==='reverse') ||
    columns==='underarm'&&(parts.left!=='normal'||parts.right!=='normal')||alternatingTransfer;
  if(columns!=='normal')s.sets=s.sets.map((row,i)=>{
    const style=row.motion.short![0],id=columns==='switched'&&style!=='normal'&&!sharedPlane?`switched-${style}`:columns;
    const source=sequenceFromPreset(id),copy=structuredClone(source.sets[i%source.sets.length]);
    if(sharedPlane){
      // Keep the column and short-pass planes consistent across both halves.
      // Change the requested endpoint height without replacing a fitted path
      // by the generic short-throw coordinates.
      const d=copy.motion.shortMotions![0].definition!;
      if(style==='shuffle'||style==='inverted')d.release.y+=.18;
      if(style==='reverse'||style==='inverted')d.catch.y+=.18;
      if(alternatingTransfer){
        // Separate the short transfer from the columns while the hands trade
        // their upper/lower order. Both high transfers can use the lower
        // column plane; a mixed pair needs space above its low transfer.
        const bothHigh=parts.left==='inverted'&&parts.right==='inverted',column=copy.motion.columnMotion!;
        column.release.y+=bothHigh?-.16:.16;column.catch.y+=bothHigh?-.16:.16;
        d.release.z+=bothHigh?.08:-.08;d.catch.z+=bothHigh?.08:-.08;
      }
      if(columns==='underarm'){
        const column=copy.motion.columnMotion!;
        column.catch.relation='underarm';
        // The empty column hand returns to the descending Shuffle catch.
        // A small outward detour keeps its forearm away from the other column
        // without changing any release/catch endpoint or airborne trajectory.
        if(style==='shuffle')column.emptyReturn!.via=[{at:.5,offset:[.08,0,0]}];
        // An explicit underarm relation raises the layout base from .025 to
        // .085 arm units. Compensate so the existing column stays in place.
        for(const p of [column.release,column.catch,d.release,d.catch])p.y-=.06;
        copy.motion.hands=[];copy.motion.hands[copy.throws[0]==='4'?0:1]={definition:column};
      }
    }
    // An exact profile belongs to its own short style. Keep it when selected,
    // otherwise derive the new short path rather than silently retaining the old one.
    else if(copy.motion.short![0]!==style)copy.motion.shortMotions=copy.motion.shortMotions?.map(({definition,...options})=>options);
    copy.motion.short=[style];return copy;
  });
  for(const row of s.sets)row.motion.shortMotions=(row.motion.shortMotions||[{}]).map(o=>({...o,ballOrder:'style'}));
  s.name=parts.roles==='alternate'?`2xの組合せ / 左 ${labels[parts.left]}・右 ${labels[parts.right]}`:
    `2xの役割を固定 / ${parts.shortHand===0?'左':'右'} ${labels[parts.shortHand===0?parts.left:parts.right]}`;
  if(columns!=='normal')s.name=`${columnLabels[columns]} / 左 ${labels[parts.left]}・右 ${labels[parts.right]}`;
  return s;
}

export const SEQUENCE_EXAMPLES:SyncSequence[]=[
  sequenceFromPreset('box'),
  {version:1,name:'Box → Inverted → Box',mirrorRepeat:false,beatDuration:.205,
    sets:[...sequenceFromPreset('box').sets,...sequenceFromPreset('inverted').sets]},
  {version:1,name:'3種類の2xを左右交代',mirrorRepeat:true,beatDuration:.205,
    sets:['box','shuffle','reverse'].map((id,i)=>({...sequenceFromPreset(id).sets[i%2],repeat:1}))},
  {version:1,name:'High-Low Box / Swap Box',mirrorRepeat:false,beatDuration:.18,
    sets:([['6','2x'],['2x','2x'],['2x','6'],['2x','2x']] as [string,string][]).map((throws,i)=>({throws,motion:{columns:'normal',short:['normal'],
      hands:i%2?[{heightOffset:i===1?.10:-.10},{heightOffset:i===1?-.10:.10}]:undefined},repeat:1}))},
];

const definition=(x:number,y:number,endX=x,endY=y,z=-.30):MotionDefinition=>({
  release:{x,y,z},passage:{at:.5},catch:{x:endX,y:endY,z},carry:{route:'direct',amount:0},
});
const extended=sequenceFromPreset('double-box');
extended.name='Extended Box / 中央コラムを保つDouble Box';
extended.sets.forEach((s,i)=>{
  // The 4x stays on the centre line while the other 4 alternates outside.
  s.motion={columns:'normal',short:['normal'],columnMotion:definition(i%2?.30:0,0),
    shortMotions:[{definition:definition(i%2?0:.30,0,i%2?-.30:0)}]};
});
const trueBox=sequenceFromPreset('box');
trueBox.name='True Box / 蓋付きボックス';
trueBox.sets.push(...structuredClone(trueBox.sets));
trueBox.sets.forEach((s,i)=>{
  const shorts=[definition(.20,0,.20,.38,-.38),definition(-.20,.38,.20,.38,-.38),definition(-.20,.38,-.20,0,-.38),definition(.20,0,-.20,0,-.38)];
  const d=shorts[i];d.carry={route:'outside',amount:.02};d.emptyReturn={route:'front',amount:.12};
  const c=definition(i<2?.20:.084,0,undefined,undefined,-.38);c.emptyReturn={route:'back',amount:.04};
  s.motion={columns:'normal',short:[(['vertical-up','inverted','vertical-down','normal'] as const)[i]],
    columnMotion:c,shortMotions:[{definition:d}]};
});
const highLowInverted=structuredClone(SEQUENCE_EXAMPLES[3]);
highLowInverted.name='High-Low Inverted Box';
highLowInverted.sets.forEach(s=>{
  s.motion.short=['inverted'];s.motion.hands ||= [];
  s.throws.forEach((t,h)=>{if(t==='2x')s.motion.hands![h]={...s.motion.hands![h],heightOffset:(s.motion.hands![h]?.heightOffset||0)+.18};});
});
const fountain:SyncSequence={version:1,name:'4球の同期ファウンテン',beatDuration:.205,mirrorRepeat:false,
  sets:[{throws:['4','4'],repeat:1,motion:{columns:'normal',short:['normal'],columnMotion:definition(.14,0,.29,0)}}]};
SEQUENCE_EXAMPLES.push(extended,trueBox,highLowInverted,fountain);
const highLowAround=structuredClone(highLowInverted);
highLowAround.name='High-Low-Around Inverted Box';highLowAround.beatDuration=.15;
highLowAround.sets.forEach((s,i)=>s.throws.forEach((t,h)=>{
  if(t==='2x')s.motion.hands![h]={heightOffset:i%2 && h===(i===1?0:1)?.39:.05,shortMotion:{carry:'direct'}};
}));
SEQUENCE_EXAMPLES.push(highLowAround);
const inlineConnection=sequenceFromPreset('box');
inlineConnection.name='Box → In-line 3 → Box';inlineConnection.sets.push(...sequenceFromPreset('inline').sets);
SEQUENCE_EXAMPLES.push(addInlineTransitions(inlineConnection).sequence!);

// Bizarre Box: the 2T returns to its throwing hand after that hand crosses;
// the following 2 carries the same ball back before the ordinary 2x pass.
const bizarre:SyncSequence={version:1,name:'Bizarre Box',beatDuration:.18,mirrorRepeat:false,
  sets:([['4','2T'],['4x','2'],['4x','2x'],['2T','4'],['2','4x'],['2x','4x']] as [string,string][]).map((throws,i)=>{
    const stage=i%3,columnHand=i<3?0:1,shortHand=1-columnHand;
    const column=definition(stage===1?-.128:.128,.26,stage===1?-.128:.128,.26,-.32);
    column.emptyReturn={route:'front',amount:.02};
    const short=definition(stage===1?-.128:.128,.05,-.128,.05,-.32);
    short.emptyReturn={route:'front',amount:.02};
    if(stage===0){
      // Both empty hands descend: the column hand passes below the 2T,
      // while staying above the throwing hand on its way to the crossed catch.
      column.emptyReturn={route:'front',amount:.02,via:[{at:.5,offset:[0,-.30,0]}]};
      short.emptyReturn={route:'front',amount:.02,via:[{at:.5,offset:[0,-.18,0]}]};
      short.catch.relation='underarm';
      // The underarm preset layout raises its base by .085 arm units.
      for(const d of [column,short]){d.release.y-=.085;d.catch.y-=.085;}
    }
    if(stage===1)short.carry={route:'back',amount:.04};
    const hands:SyncSetMotion['hands']=[];hands[columnHand]={definition:column};hands[shortHand]={definition:short};
    return {throws,repeat:1,motion:{columns:'normal',short:['normal'],hands}};
  })};
const broken=sequenceFromPreset('box');broken.name='Broken Box / 右側のコラム';broken.beatDuration=.18;
broken.sets.forEach((s,i)=>{
  const column=definition(i===0?-.20:.04,i===0?.10:.28,i===0?-.20:.04,i===0?.10:.28,-.36);
  column.emptyReturn={route:'front',amount:i===0?.08:.02};
  const short=definition(i===0?.04:.20,i===0?.28:.14,i===0?-.20:-.04,i===0?.14:.28,-.36);
  short.emptyReturn={route:'front',amount:i===1?.08:.02};
  if(i===0){column.catch.relation='underarm';for(const d of [column,short]){d.release.y-=.085;d.catch.y-=.085;}}
  s.motion={columns:'normal',short:['normal'],hands:i===0?[{definition:column},{definition:short}]:[{definition:short},{definition:column}]};
});
SEQUENCE_EXAMPLES.push(bizarre,broken);
const karas=structuredClone(bizarre);karas.name="Karas' Box";
karas.sets.forEach((s,i)=>{
  if(i%3!==1)return;
  const shortHand=i<3?1:0;s.throws[shortHand]='2T';
  const short=s.motion.hands![shortHand]!.definition!;
  short.catch.x=-short.release.x;short.release.relation='underarm';short.carry={route:'direct',amount:0};
  s.motion.hands![1-shortHand]!.definition!.emptyReturn={route:'front',amount:.02,via:[{at:.5,offset:[0,-.30,0]}]};
  short.emptyReturn={route:'front',amount:.02,via:[{at:.5,offset:[0,-.18,0]}]};
  for(const h of s.motion.hands!){const d=h!.definition!;d.release.y-=.085;d.catch.y-=.085;}
});
SEQUENCE_EXAMPLES.push(karas);

// One Broken Box cycle on each side, joined by a normal Box transfer.
// All 4x flights remain vertical; only the receiving hand changes.
const burst:SyncSequence={version:1,name:'Burst Box',beatDuration:.18,mirrorRepeat:false,
  sets:([['4','2x'],['2x','4x'],['2x','4x'],['2x','4'],['4x','2x'],['4x','2x']] as [string,string][]).map((throws,i)=>{
    const stage=i%3,reflected=i>=3,columnHand=(stage===0?0:1)^(reflected?1:0),shortHand=1-columnHand;
    const column=definition(stage===0?.04:stage===1?-.20:.20,stage===0?.28:.10,undefined,undefined,-.36);
    const short=definition(stage===0?.20:.04,stage===0?.14:.28,stage===1?-.20:-.04,stage===1?.14:.28,-.36);
    column.emptyReturn={route:'front',amount:stage===1?.08:.02};
    short.emptyReturn={route:'front',amount:stage===0?.08:.02};
    if(stage===1)column.release.relation='underarm';
    if(stage===2)column.catch.relation='underarm';
    if(stage!==0)for(const d of [column,short]){d.release.y-=.085;d.catch.y-=.085;}
    const hands:SyncSetMotion['hands']=[];hands[columnHand]={definition:column};hands[shortHand]={definition:short};
    return {throws,repeat:1,motion:{columns:'normal',short:['normal'],hands}};
  })};
SEQUENCE_EXAMPLES.push(burst);

const penman:SyncSequence={version:1,name:"Penman's Box",beatDuration:.18,mirrorRepeat:false,
  sets:([['4x','2'],['4x','2x'],['2','4x'],['2x','4x']] as [string,string][]).map((throws,i)=>{
    const flourish=i%2===0,columnHand=i<2?0:1,shortHand=1-columnHand;
    const column=definition(flourish?-.19:.04,flourish?.06:.10,undefined,undefined,-.36);
    column.emptyReturn=flourish?{route:'front',amount:.04,via:[{at:.35,offset:[0,-.12,0]}]}:{route:'front',amount:.04};
    column.carry={route:'front',amount:.06};
    const short=flourish?definition(-.16,.20,undefined,undefined,-.36):definition(.24,.08,-.24,.08,-.36);
    short.emptyReturn={route:'front',amount:.04};
    short.carry=flourish?{route:'direct',amount:0,via:[{at:.28,offset:[.246,.34,.10]},{at:.58,offset:[-.02,.04,0]}]}:{route:'back',amount:.04};
    if(flourish){column.release.relation='underarm';for(const d of [column,short]){d.release.y-=.085;d.catch.y-=.085;}}
    const hands:SyncSetMotion['hands']=[];hands[columnHand]={definition:column};hands[shortHand]={definition:short};
    return {throws,repeat:1,motion:{columns:'normal',short:['normal'],hands}};
  })};
SEQUENCE_EXAMPLES.push(penman);

// Underarm Box omits Burst's underarm catch. After throwing the outer
// column under the arm, the hand uncrosses to receive the horizontal pass.
const underarmBox=structuredClone(burst);underarmBox.name='Underarm Box';
underarmBox.sets=underarmBox.sets.filter((_,i)=>i%3!==2);
SEQUENCE_EXAMPLES.push(underarmBox);

// Gilligan adds a held 2 between passes. Its 4s travel from the inside to
// the outside like a fountain; the 4x is caught by the other hand below it.
const gilligan:SyncSequence={version:1,name:"Gilligan's Box",beatDuration:.18,mirrorRepeat:false,
  sets:([['4','2x'],['4','2'],['2x','4x'],['2x','4'],['2','4'],['4x','2x']] as [string,string][]).map((throws,i)=>{
    const stage=i%3,columnHand=(stage===2?1:0)^(i>=3?1:0),shortHand=1-columnHand;
    const column=definition(.04,.28,.20,stage===2?.10:.28,-.36);
    column.emptyReturn={route:'front',amount:.02};
    const short=stage===1?definition(-.20,.10,undefined,undefined,-.36):definition(.20,stage===0?.14:.28,-.04,.28,-.36);
    short.emptyReturn={route:'front',amount:stage===0?.08:.02};
    if(stage===1)short.carry={route:'front',amount:.04};
    if(stage===2){column.catch.relation='underarm';for(const d of [column,short]){d.release.y-=.085;d.catch.y-=.085;}}
    const hands:SyncSetMotion['hands']=[];hands[columnHand]={definition:column};hands[shortHand]={definition:short};
    return {throws,repeat:1,motion:{columns:'normal',short:['normal'],hands}};
  })};
SEQUENCE_EXAMPLES.push(gilligan);

const fourBallBox:SyncSequence={version:1,name:'4球のBox',beatDuration:.16,mirrorRepeat:false,
  sets:([['6','2x'],['6','2x'],['2x','6'],['2x','6']] as [string,string][]).map((throws,i)=>{
    const column=definition(.09,0,.34,0,-.32),short=definition(.34,0,-.09,0,-.32);
    const hands:SyncSetMotion['hands']=i<2?[{definition:column},{definition:short}]:[{definition:short},{definition:column}];
    return {throws,repeat:1,motion:{columns:'normal',short:['normal'],hands}};
  })};
const stackedBox:SyncSequence={version:1,name:'4球のStacked Box',beatDuration:.14,mirrorRepeat:false,
  sets:([['8','2x'],['4','2x'],['2x','8'],['2x','4']] as [string,string][]).map((throws,i)=>{
    const column=definition(.22,0,undefined,undefined,-.32),short=definition(.22,0,-.22,0,-.32);
    const hands:SyncSetMotion['hands']=i<2?[{definition:column},{definition:short}]:[{definition:short},{definition:column}];
    return {throws,repeat:1,motion:{columns:'normal',short:['normal'],hands}};
  })};
const pistons:SyncSequence={version:1,name:'Synchronous Pistons',beatDuration:.205,mirrorRepeat:false,
  sets:[0,1].map(i=>({throws:['4','4'],repeat:1,motion:{columns:'normal',short:['normal'],
    hands:[{definition:definition(i?.10:.26,0)},{definition:definition(i?.26:.10,0)}]}}))};
const wimpy:SyncSequence={version:1,name:'Wimpy',beatDuration:.205,mirrorRepeat:false,
  sets:[{throws:['4x','4x'],repeat:1,motion:{columns:'normal',short:['normal'],
    hands:[{definition:definition(.12,.06,-.28,.06)},{definition:definition(.12,-.06,-.28,-.06)}]}}]};
SEQUENCE_EXAMPLES.push(fourBallBox,stackedBox,pistons,wimpy);

// Keep both ends of the Gilligan section adjacent to Underarm Box. A direct
// Gilligan -> basic Box return brings balls too close at the section boundary.
const boxConnections=[SEQUENCE_EXAMPLES[0],underarmBox,gilligan,underarmBox].reduce((a,b)=>appendSequence(a,b).sequence!);
boxConnections.name='Box → Underarm → Gilligan → Underarm → Box';
const fourBallConnection=appendSequence(fourBallBox,stackedBox).sequence!;
fourBallConnection.name='4球Box → Stacked Box → 4球Box';
SEQUENCE_EXAMPLES.push(boxConnections,fourBallConnection);

const reverseFountain=structuredClone(fountain);reverseFountain.name='4球の逆同期ファウンテン';
reverseFountain.sets[0].motion.columnMotion=definition(.29,0,.14,0);
SEQUENCE_EXAMPLES.push(reverseFountain);

// A direct reversal makes the old and new flight planes collide. Rotate the
// release/catch axis through depth, then return it to the original frontal plane.
const fountainReversal:SyncSequence={version:1,name:'同期ファウンテン → 逆回転 → 同期ファウンテン',beatDuration:.205,mirrorRepeat:false,
  sets:Array.from({length:12},(_,i)=>{
    const angle=i*Math.PI/6,d=definition(.215-.075*Math.cos(angle),0,.215+.075*Math.cos(angle));
    d.release.z=-.30+.075*Math.sin(angle);d.catch.z=-.30-.075*Math.sin(angle);
    return {throws:['4','4'],repeat:i===0||i===6?2:1,sourceName:i===0?fountain.name:i===6?reverseFountain.name:'つなぎ / 投げる方向を前後へ回す',
      motion:{columns:'normal',short:['normal'],columnMotion:d}};
  })};
SEQUENCE_EXAMPLES.push(fountainReversal);

const fixedReverse=sequenceFromBasicParts({roles:'fixed',left:'normal',right:'reverse',shortHand:1});
fixedReverse.name='同期シャワー / 2xは下→上';
const fixedInverted=sequenceFromBasicParts({roles:'fixed',left:'normal',right:'inverted',shortHand:1});
fixedInverted.name='同期シャワー / 2xは上→上';
SEQUENCE_EXAMPLES.push(fixedReverse,fixedInverted);

const fixedLeft=sequenceFromBasicParts({roles:'fixed',left:'normal',right:'normal',shortHand:0});
fixedLeft.name='左手の2xを固定';fixedLeft.sets[0].repeat=3;
const fixedRoleConnection=connectSequenceCycles(SEQUENCE_EXAMPLES[0],fixedLeft).sequence!;
fixedRoleConnection.name='Box → 左手の2xを固定 → Box';
SEQUENCE_EXAMPLES.push(fixedRoleConnection);

// Levels: low central 4x, outer 4 caught high, top-to-middle slam, then a
// middle-to-low drop. The source describes catching the outer throw at its apex.
const levels:SyncSequence={version:1,name:'Levels / 三段のExtended Box',beatDuration:.12,mirrorRepeat:false,
  sets:Array.from({length:4},(_,i)=>{
    const center=i%2===0,columnHand=i<2?0:1,shortHand=1-columnHand;
    const column=center?definition(0,-.10,0,.12,-.36):definition(.24,-.10,.24,.65,-.25);
    if(center)column.flightFraction=.85;else column.catchAtApex=true;
    const short=center?definition(.16,.12,-.24,-.10,-.25):definition(.24,.65,-.16,.12,-.25);
    if(!center)short.flightFraction=.55;
    const hands:SyncSetMotion['hands']=[];
    hands[columnHand]={definition:column,catchGrip:center?'overhand':'underhand'};
    hands[shortHand]={definition:short,style:center?'vertical-down':'shuffle',releaseGrip:'overhand',catchGrip:center?'underhand':'overhand'};
    return {throws:columnHand===0?[center?'4x':'4','2x']:['2x',center?'4x':'4'],repeat:1,motion:{columns:'normal',short:['normal'],hands}};
  })};
SEQUENCE_EXAMPLES.push(levels);

// Separate the central column in depth before moving the short passes through
// it. Change positions and catch timing on successive throws, not in mid-flight.
const levelsTransition=(amount:number):SyncSequenceSet[]=>extended.sets.map((row,i)=>{
  const target=levels.sets[i],hands:SyncSetMotion['hands']=[];
  for(let h=0;h<2;h++){
    const a=sequenceHandDefinition(row,h),b=sequenceHandDefinition(target,h),d=structuredClone(a);
    for(const point of ['release','catch'] as const){
      for(const axis of ['x','y'] as const)d[point][axis]=a[point][axis]*(1-amount)+b[point][axis]*amount;
      d[point].z=b[point].z;
    }
    const value=parseInt(row.throws[h][0],36);
    if(b.flightFraction!==undefined)d.flightFraction=(value-1.25)/value*(1-amount)+b.flightFraction*amount;
    hands[h]={definition:d};
    if(amount>0){
      hands[h]!.releaseGrip=target.motion.hands?.[h]?.releaseGrip;
      hands[h]!.catchGrip=target.motion.hands?.[h]?.catchGrip;
      hands[h]!.style=target.motion.hands?.[h]?.style;
    }
  }
  return {throws:[...row.throws],repeat:1,sourceName:amount?`つなぎ / 三段の配置へ ${Math.round(amount*100)}%`:'つなぎ / 中央コラムを前へ',
    motion:{columns:'normal',short:['normal'],hands}};
});
const levelsConnection:SyncSequence={version:1,name:'Extended Box → Levels → Extended Box',mirrorRepeat:false,beatDuration:levels.beatDuration,
  sets:[...extended.sets.map(s=>({...structuredClone(s),sourceName:extended.name})),
    ...[0,.2,.4,.6,.8].flatMap(levelsTransition),
    ...levels.sets.map(s=>({...structuredClone(s),sourceName:levels.name})),
    ...[.8,.6,.4,.2,0].flatMap(levelsTransition)]};
SEQUENCE_EXAMPLES.push(levelsConnection);

// Columns retain one vertical lane per ball. In the three-ball version the
// left hand alternates its outer and central balls; the other hand rests on 0.
const threeColumns:SyncSequence={version:1,name:'3球コラム / Columns',beatDuration:.205,mirrorRepeat:false,
  sets:[
    {throws:['4','4'],repeat:1,motion:{columns:'normal',short:['normal'],columnMotion:definition(.24,0)}},
    {throws:['4','0'],repeat:1,motion:{columns:'normal',short:['normal'],hands:[{definition:definition(0,0)}]}}
  ]};
// Both hands change lanes together, unlike Synchronous Pistons, where the
// inner lane on one side is paired with the outer lane on the other side.
const fourColumns:SyncSequence={version:1,name:'4球コラム / Four Ball Columns',beatDuration:.205,mirrorRepeat:false,
  sets:[.10,.28].map(x=>({throws:['4','4'],repeat:1,motion:{columns:'normal',short:['normal'],columnMotion:definition(x,0)}}))};
SEQUENCE_EXAMPLES.push(threeColumns,fourColumns);

const threeColumnsConnection=connectSequenceCycles(SEQUENCE_EXAMPLES[0],threeColumns).sequence!;
threeColumnsConnection.name='Box → 3球コラム → Box';
// This bridge ball becomes the central column. A default outer 4 would pass
// too close to the next outer throw; both original sections remain unchanged.
const centralEntry=threeColumnsConnection.sets[2];
centralEntry.motion.hands=[{definition:definition(0,0)}];
centralEntry.sourceName='つなぎ / 中央のコラムを作る';
const fourColumnsConnection=appendSequence(fountain,fourColumns).sequence!;
fourColumnsConnection.name='同期ファウンテン → 4球コラム → 同期ファウンテン';
SEQUENCE_EXAMPLES.push(threeColumnsConnection,fourColumnsConnection);

const rightHighCross=sequenceFromBasicParts({columns:'crossed-alternate',left:'normal',right:'inverted',roles:'alternate',shortHand:1});
const leftHighCross=sequenceFromBasicParts({columns:'crossed-alternate',left:'inverted',right:'normal',roles:'alternate',shortHand:1});
rightHighCross.name='クロス上下交代 / 右の2xを高く';
leftHighCross.name='クロス上下交代 / 左の2xを高く';
const alternatingHighCross=appendSequence(rightHighCross,leftHighCross).sequence!;
alternatingHighCross.name='クロス上下交代 / 右の2xを高く → 左の2xを高く';
SEQUENCE_EXAMPLES.push(alternatingHighCross);

// HF Crosses*: each high ball travels vertically to the opposite hand.
// The other hand keeps its ball through the upper crossing, returns to its
// own side, then moves below the opposite forearm for its next high throw.
const hfCrosses:SyncSequence={version:1,name:'HF / Crosses*',beatDuration:.25,mirrorRepeat:false,
  sets:([0,1] as const).map(h=>{
    const column=definition(-.20,-.085,-.20,-.005,-.30);
    column.release.relation='underarm';column.flightFraction=.6;
    column.carry={route:'outside',amount:.08};
    column.emptyReturn={route:'outside',amount:.04,via:[{at:.5,offset:[0,-.12,0]}]};
    const held=definition(-.20,.095,-.20,.095,-.30);
    held.carry={route:'outside',amount:.12,via:[{at:.5,offset:[.40,-.12,0]}]};
    return {throws:h===0?['4x','2']:['2','4x'],repeat:1,
      motion:{columns:'normal',short:['normal'],hands:h===0?[{definition:column},{definition:held}]:[{definition:held},{definition:column}]}};
  })};
SEQUENCE_EXAMPLES.push(hfCrosses);

// HF Under-Arm-Box*: self 4s start below the opposite forearm and come
// inward to the throwing hand. The short ball is passed above those hands.
// Keep automatic flight times so the 4 and 2x arrive together.
const hfUnderarm:SyncSequence={version:1,name:'HF / Under-Arm-Box*',beatDuration:.225,mirrorRepeat:false,
  sets:([0,1] as const).map(h=>{
    const column=definition(-.16,-.045,.04,.015,-.30);
    column.release.relation='underarm';
    column.carry={route:'back',amount:.06,via:[{at:.5,offset:[0,-.08,0]}]};
    column.emptyReturn={route:'outside',amount:.06,via:[{at:.5,offset:[0,-.08,0]}]};
    const short=definition(.04,.095,-.22,.095,-.30);
    short.carry={route:'outside',amount:.02};short.emptyReturn={route:'front',amount:.04};
    return {throws:h===0?['4','2x']:['2x','4'],repeat:1,
      motion:{columns:'normal',short:['normal'],hands:h===0?[{definition:column},{definition:short}]:[{definition:short},{definition:column}]}};
  })};
SEQUENCE_EXAMPLES.push(hfUnderarm);

// Move the high throws ahead of the short passes before crossing the hands.
// The intermediate rows have no underarm constraint, so compensate for the
// target's raised base explicitly. The two original cycles stay unchanged.
const hfUnderarmTransition=(amount:number):SyncSequenceSet[]=>SEQUENCE_EXAMPLES[0].sets.map((row,i)=>{
  const hands:SyncSetMotion['hands']=[];
  for(let h=0;h<2;h++){
    const a=sequenceHandDefinition(row,h),b=sequenceHandDefinition(hfUnderarm.sets[i],h),d=structuredClone(b);
    delete d.release.relation;
    for(const point of ['release','catch'] as const){
      d[point].x=a[point].x*(1-amount)+b[point].x*amount;
      d[point].y=a[point].y*(1-amount)+(b[point].y+.085)*amount;
      d[point].z=row.throws[h]==='4'?-.40:-.30;
    }
    hands[h]={definition:d};
  }
  return {throws:[...row.throws],repeat:1,
    sourceName:amount?'つなぎ / 腕下の投げ位置へ半分寄せる':'つなぎ / 4の軌道を前へ離す',
    motion:{columns:'normal',short:['normal'],hands}};
});
const hfUnderarmConnection:SyncSequence={version:1,name:'Box → HF Under-Arm-Box* → Box',beatDuration:hfUnderarm.beatDuration,mirrorRepeat:false,
  sets:[...SEQUENCE_EXAMPLES[0].sets.map(s=>({...structuredClone(s),sourceName:SEQUENCE_EXAMPLES[0].name})),
    ...[0,.5].flatMap(hfUnderarmTransition),
    ...hfUnderarm.sets.map(s=>({...structuredClone(s),sourceName:hfUnderarm.name})),
    ...[.5,0].flatMap(hfUnderarmTransition)]};
SEQUENCE_EXAMPLES.push(hfUnderarmConnection);

// HF Reverse-Under-Arm-Box*: the short transfer rises to the high hand;
// the opposite hand catches its descending self 4 below that forearm.
// The held high ball then lowers on its own side for the next short throw.
const hfReverseUnderarm:SyncSequence={version:1,name:'HF / Reverse-Under-Arm-Box*',beatDuration:.25,mirrorRepeat:false,
  sets:([0,1] as const).map(h=>{
    const column=definition(.04,.015,-.16,-.045,-.30);
    column.catch.relation='underarm';column.carry={route:'outside',amount:.06};
    column.emptyReturn={route:'back',amount:.04,via:[{at:.5,offset:[0,-.10,0]}]};
    const short=definition(.22,-.10,-.04,.34,-.30);
    short.carry={route:'outside',amount:.04};short.emptyReturn={route:'front',amount:.04};
    const hands:SyncSetMotion['hands']=h===0?[{definition:column},{definition:short,style:'reverse'}]:[{definition:short,style:'reverse'},{definition:column}];
    return {throws:h===0?['4','2x']:['2x','4'],repeat:1,motion:{columns:'normal',short:['reverse'],hands}};
  })};
SEQUENCE_EXAMPLES.push(hfReverseUnderarm);

const reverseShuffle=sequenceFromPreset('reverse');
const reverseUnderarmBridge=reverseShuffle.sets.map((row,i):SyncSequenceSet=>{
  const hands:SyncSetMotion['hands']=[];
  for(let h=0;h<2;h++){
    const from=sequenceHandDefinition(row,h),d=sequenceHandDefinition(hfReverseUnderarm.sets[i],h);
    delete d.catch.relation;
    for(const point of ['release','catch'] as const)d[point]={...from[point],z:row.throws[h]==='4'?-.38:-.30};
    hands[h]={definition:d};
  }
  return {throws:[...row.throws],repeat:1,sourceName:'つなぎ / 4と2xの前後間隔を作る',motion:{columns:'normal',short:['reverse'],hands}};
});
const reverseUnderarmConnection:SyncSequence={version:1,name:'Reverse Shuffle → HF Reverse-Under-Arm-Box* → Reverse Shuffle',beatDuration:hfReverseUnderarm.beatDuration,mirrorRepeat:false,
  sets:[...reverseShuffle.sets.map(s=>({...structuredClone(s),sourceName:reverseShuffle.name})),
    ...structuredClone(reverseUnderarmBridge),
    ...hfReverseUnderarm.sets.map(s=>({...structuredClone(s),sourceName:hfReverseUnderarm.name})),
    ...structuredClone(reverseUnderarmBridge)]};
SEQUENCE_EXAMPLES.push(reverseUnderarmConnection);

// HF Under-Arm-Claw-Box*: lift the short ball from below the opposite
// forearm to that hand's high claw catch. The 4 remains a self throw,
// released across the body and caught lower and closer to the centre.
const hfUnderarmClaw:SyncSequence={version:1,name:'HF / Under-Arm-Claw-Box*',beatDuration:.25,mirrorRepeat:false,
  sets:([0,1] as const).map(h=>{
    const column=definition(-.16,.08,-.04,-.08,-.30);
    column.carry={route:'outside',amount:.04};column.emptyReturn={route:'front',amount:.12};
    const short=definition(-.14,-.12,-.14,.28,-.22);
    short.release.relation='underarm';short.catch.z=-.30;
    short.carry={route:'outside',amount:.20,via:[{at:.5,offset:[0,-.18,0]}]};
    short.emptyReturn={route:'front',amount:.06};
    const c={definition:column,releaseGrip:'underhand' as const,catchGrip:'underhand' as const};
    const p={definition:short,releaseGrip:'underhand' as const,catchGrip:'overhand' as const};
    return {throws:h===0?['4','2x']:['2x','4'],repeat:1,
      motion:{columns:'normal',short:['vertical-up'],hands:h===0?[c,p]:[p,c]}};
  })};
SEQUENCE_EXAMPLES.push(hfUnderarmClaw);

// Keeping a ball on 2 gives the next hand room to enter and leave the
// underarm short throw. Preserve all four Box Roll rows and both claw rows;
// the six-set movement repeats three times before ball identities return.
const hfUnderarmClawConnection=appendSequence(sequenceFromPreset('box-roll'),hfUnderarmClaw,false).sequence!;
hfUnderarmClawConnection.beatDuration=hfUnderarmClaw.beatDuration;
hfUnderarmClawConnection.name='Box Roll → HF Under-Arm-Claw-Box* → Box Roll';
SEQUENCE_EXAMPLES.push(hfUnderarmClawConnection);

// The unstarred HF source keeps roles fixed: performer right throws the
// high 4x, performer left sends 2x up from below that forearm. The lower
// 4x catch sits farther across the body than the high claw catch.
const hfFixedUnderarmClaw:SyncSequence={version:1,name:'HF / Under-Arm-Claw-Box（役割固定）',beatDuration:.25,mirrorRepeat:false,sets:(()=>{
  const column=definition(-.12,.08,.22,-.08,-.30);column.catch.z=-.26;
  column.carry={route:'outside',amount:.04};column.emptyReturn={route:'front',amount:.12};
  const short=definition(-.10,-.12,-.10,.28,-.22);
  short.release.relation='underarm';short.catch.z=-.34;
  short.carry={route:'outside',amount:.20,via:[{at:.5,offset:[0,-.18,0]}]};
  short.emptyReturn={route:'front',amount:.06};
  return [{throws:['2x','4x'],repeat:1,motion:{columns:'normal',short:['vertical-up'],hands:[
    {definition:short,releaseGrip:'underhand',catchGrip:'overhand'},
    {definition:column,releaseGrip:'underhand',catchGrip:'underhand'}
  ]}}];
})()};
SEQUENCE_EXAMPLES.push(hfFixedUnderarmClaw);

// The Double source keeps the high-throw hand for two sets, first 4x then 4,
// before reflecting both sets. Its low catches stay near the centre, unlike
// the far cross-body catch in the standalone fixed-role source above.
const hfDoubleUnderarmClaw:SyncSequence={version:1,name:'HF / Double Under-Arm-Claw-Box',beatDuration:.25,mirrorRepeat:false,
  sets:([1,1,0,0] as const).map((hand,i)=>{
    const row=structuredClone(hfUnderarmClaw.sets[hand]);
    row.throws[hand]=i%2===0?'4x':'4';
    row.sourceName=`${hand===0?'左':'右'}の${row.throws[hand]} ＋ 腕下の2x・クロー捕球`;
    return row;
  })};
SEQUENCE_EXAMPLES.push(hfDoubleUnderarmClaw);

// Start the Double at its third set so both cycle boundaries share the
// same arrival state. No transfer throw or spatial adjustment is needed.
const hfDoubleClawFromLeft=rotateSequenceStart(hfDoubleUnderarmClaw,2);
const hfClawDoubleConnection=appendSequence(hfUnderarmClaw,hfDoubleClawFromLeft,false).sequence!;
hfClawDoubleConnection.name='HF Under-Arm-Claw-Box* → Double（セット3から） → Under-Arm-Claw-Box*';
SEQUENCE_EXAMPLES.push(hfClawDoubleConnection);

// Reverse-UAI keeps both self columns on the opposite side of the body.
// The empty column hand returns toward its own side before rising to the
// high 2x catch, leaving the descending opposite column clear of its forearm.
const hfReverseUnderarmInverted:SyncSequence={version:1,name:'HF / Reverse-Under-Arm-Inverted-Box*',beatDuration:.25,mirrorRepeat:false,
  sets:([0,1] as const).map(h=>{
    const column=definition(-.16,.08,-.16,-.08,-.30);
    column.catch.relation='underarm';
    column.carry={route:'inside',amount:.02,via:[{at:.5,offset:[0,-.02,0]}]};
    column.emptyReturn={route:'front',amount:.18,via:[{at:.4,offset:[.12,0,0]}]};
    const short=definition(.18,.50,-.08,.34,-.30);
    short.carry={route:'outside',amount:.04};
    short.emptyReturn={route:'back',amount:.04,via:[{at:.5,offset:[0,-.10,0]}]};
    const c={definition:column,releaseGrip:'underhand' as const,catchGrip:'underhand' as const};
    const p={definition:short,style:'inverted' as const,releaseGrip:'underhand' as const,catchGrip:'underhand' as const};
    return {throws:h===0?['4','2x']:['2x','4'],repeat:1,motion:{columns:'normal',short:['inverted'],hands:h===0?[c,p]:[p,c]}};
  })};
SEQUENCE_EXAMPLES.push(hfReverseUnderarmInverted);

const hfReverseUnderarmInvertedConnection=appendSequence(hfReverseUnderarm,hfReverseUnderarmInverted,false).sequence!;
hfReverseUnderarmInvertedConnection.name='HF Reverse-Under-Arm-Box* → Inverted型 → Reverse-Under-Arm-Box*';
SEQUENCE_EXAMPLES.push(hfReverseUnderarmInvertedConnection);

// The unstarred source fixes the left high 2x and right cross-body 4x.
// Its 4x travels across the body in flight; it is not a vertical self column.
// Source releases recur about every .6 seconds, with a short airborne pass
// and a longer low-to-high carry before the next synchronous release.
const hfFixedReverseUnderarmInverted:SyncSequence={version:1,name:'HF / Reverse-Under-Arm-Inverted-Box（役割固定）',beatDuration:.30,mirrorRepeat:false,
  sets:[(()=>{
    const column=definition(-.16,.08,.16,-.08,-.30);
    column.catch.relation='underarm';column.flightFraction=.625;
    column.carry={route:'outside',amount:.08,via:[{at:.5,offset:[0,-.10,0]}]};
    column.emptyReturn={route:'front',amount:.18,via:[{at:.4,offset:[.12,0,0]}]};
    const short=definition(.18,.30,-.08,.50,-.30);short.flightFraction=.25;
    short.carry={route:'outside',amount:.04};
    short.emptyReturn={route:'back',amount:.04,via:[{at:.5,offset:[0,-.10,0]}]};
    return {throws:['2x','4x'] as [string,string],repeat:1,motion:{columns:'normal' as const,short:['inverted' as const],hands:[
      {definition:short,style:'inverted' as const,releaseGrip:'underhand' as const,catchGrip:'underhand' as const},
      {definition:column,releaseGrip:'underhand' as const,catchGrip:'underhand' as const},
    ]}};
  })()]};
SEQUENCE_EXAMPLES.push(hfFixedReverseUnderarmInverted);

const hfFixedInvertedLeft=sequenceFromBasicParts({roles:'fixed',shortHand:0,left:'inverted',right:'inverted'});
// Separate the opposing 4x flights in depth while reversing their direction.
// Remove the event relation only on the bridge, and retain its physical height
// when leaving the explicit-underarm layout's raised reference plane.
const hfFixedUaiBridge:SyncSequenceSet={throws:['2x','4x'],repeat:1,motion:{columns:'normal',short:['inverted'],
  hands:([0,1] as const).map(h=>{
    const a=sequenceHandDefinition(hfFixedInvertedLeft.sets[0],h),d=sequenceHandDefinition(hfFixedReverseUnderarmInverted.sets[0],h);
    for(const point of ['release','catch'] as const){
      delete d[point].relation;
      d[point].x=(a[point].x+d[point].x)/2;
      d[point].y=(a[point].y+d[point].y+.085)/2;
      d[point].z=h===1?-.40:-.30;
    }
    return {definition:d,releaseGrip:'underhand' as const,catchGrip:'underhand' as const};
  }) as SyncSetMotion['hands']}};
const hfFixedUaiConnection:SyncSequence={version:1,name:'左2x固定のInverted → HF Reverse-UAI → 左2x固定のInverted',beatDuration:.30,mirrorRepeat:false,
  sets:[{...structuredClone(hfFixedInvertedLeft.sets[0]),sourceName:hfFixedInvertedLeft.name},
    {...structuredClone(hfFixedUaiBridge),sourceName:'4xを前へ分ける / 入り'},
    {...structuredClone(hfFixedReverseUnderarmInverted.sets[0]),sourceName:hfFixedReverseUnderarmInverted.name},
    {...structuredClone(hfFixedUaiBridge),sourceName:'4xを前へ分ける / 戻り'}]};
SEQUENCE_EXAMPLES.push(hfFixedUaiConnection);

const hfBasicDouble=sequenceFromPreset('double-box');
const hfBasicDoubleConnection=appendSequence(SEQUENCE_EXAMPLES[0],hfBasicDouble,false).sequence!;
hfBasicDoubleConnection.name='Box → Double Box（HF） → Box';
SEQUENCE_EXAMPLES.push(hfBasicDoubleConnection);

// HF box_inverted-box*: low 2x accompanies 4x; high 2x accompanies self 4.
// Both transfer styles occur in each hand before the four-set cycle closes.
const hfDoubleBoxInverted=sequenceFromDoubleParts({crossSet:'normal',selfSet:'inverted'});
hfDoubleBoxInverted.name='HF Double / Box + Inverted-Box*';
SEQUENCE_EXAMPLES.push(hfDoubleBoxInverted);
const hfDoubleBoxInvertedConnection=appendSequence(SEQUENCE_EXAMPLES[0],hfDoubleBoxInverted,false).sequence!;
hfDoubleBoxInvertedConnection.name='Box → HF Double（Box + Inverted） → Box';
SEQUENCE_EXAMPLES.push(hfDoubleBoxInvertedConnection);

const hfDoubleShuffleBox=sequenceFromDoubleParts({crossSet:'shuffle',selfSet:'normal',crossReleaseGrip:'underhand'});
hfDoubleShuffleBox.name='HF Double / Shuffle + Box*';
const hfDoubleBoxShuffle=sequenceFromDoubleParts({crossSet:'normal',selfSet:'shuffle',selfReleaseGrip:'underhand'});
hfDoubleBoxShuffle.name='HF Double / Box + Shuffle*';
SEQUENCE_EXAMPLES.push(hfDoubleShuffleBox,hfDoubleBoxShuffle);
const hfDoubleShuffleConnection=appendSequence(hfDoubleShuffleBox,hfDoubleBoxShuffle,false).sequence!;
hfDoubleShuffleConnection.name='HF Double / Shuffle+Box → Box+Shuffle → Shuffle+Box';
SEQUENCE_EXAMPLES.push(hfDoubleShuffleConnection);

const hfDoubleBoxReverse=sequenceFromDoubleParts({crossSet:'normal',selfSet:'reverse'});
hfDoubleBoxReverse.name='HF Double / Box + Reverse-Shuffle*';
const hfDoubleReverse=sequenceFromDoubleParts({crossSet:'reverse',selfSet:'reverse'});
hfDoubleReverse.name='HF Double / Reverse-Shuffle + Reverse-Shuffle*';
SEQUENCE_EXAMPLES.push(hfDoubleBoxReverse,hfDoubleReverse);
const hfDoubleReverseConnection=appendSequence(hfDoubleBoxReverse,hfDoubleReverse,false).sequence!;
hfDoubleReverseConnection.name='HF Double / Box+Reverse → Reverse+Reverse → Box+Reverse';
SEQUENCE_EXAMPLES.push(hfDoubleReverseConnection);

// Match the complete entered cycles, including repetition and tempo. A reduced
// movement-period key would also match a longer user sequence and discard rows.
const connectionSourceKey=(sequence:SyncSequence)=>JSON.stringify(canonicalize({
  beatDuration:sequence.beatDuration,
  sets:expandSequence(sequence).map(({throws,motion})=>({throws,motion})),
}));
const connectionRowKey=({throws,motion}:SyncSequenceSet)=>JSON.stringify(canonicalize({throws,motion}));
// Replay registration checks the current tempo and the exact physical ports.
// Select a known recipe by its complete cycle, permitting another start set but
// never reducing a longer repeated input to a shorter source definition.
const connectionReplayKey=(sequence:SyncSequence)=>{
  const rows=expandSequence(sequence).map(connectionRowKey);
  return rows.map((_,i)=>JSON.stringify([...rows.slice(i),...rows.slice(0,i)])).sort()[0];
};
const connectionExamples:[number,SyncSequence,SyncSequence][]=[
  [1,SEQUENCE_EXAMPLES[0],sequenceFromPreset('inverted')],
  [9,SEQUENCE_EXAMPLES[0],sequenceFromPreset('inline')],
  [22,fourBallBox,stackedBox],
  [24,fountain,reverseFountain],
  [27,SEQUENCE_EXAMPLES[0],fixedLeft],
  [29,extended,levels],
  [32,SEQUENCE_EXAMPLES[0],threeColumns],
  [33,fountain,fourColumns],
  [34,rightHighCross,leftHighCross],
  [37,SEQUENCE_EXAMPLES[0],hfUnderarm],
  [39,reverseShuffle,hfReverseUnderarm],
  [41,sequenceFromPreset('box-roll'),hfUnderarmClaw],
  [44,hfUnderarmClaw,hfDoubleUnderarmClaw],
  [46,hfReverseUnderarm,hfReverseUnderarmInverted],
  [48,hfFixedInvertedLeft,hfFixedReverseUnderarmInverted],
  [49,SEQUENCE_EXAMPLES[0],hfBasicDouble],
  [51,SEQUENCE_EXAMPLES[0],hfDoubleBoxInverted],
  [54,hfDoubleShuffleBox,hfDoubleBoxShuffle],
  [57,hfDoubleBoxReverse,hfDoubleReverse],
];
const connectionExampleMatches=connectionExamples.map(([exampleIndex,from,to])=>({
  exampleIndex,from:connectionSourceKey(from),to:connectionSourceKey(to),
  replayFrom:connectionReplayKey(from),replayTo:connectionReplayKey(to),
  sequence:structuredClone(SEQUENCE_EXAMPLES[exampleIndex]),
}));

/** Offer an existing complete connection without modifying either input.
 * Choosing it is explicit; loaded-avatar clearance must still be checked. */
export function findConnectionExamples(current:SyncSequence,next:SyncSequence):{exampleIndex:number;sequence:SyncSequence}[]{
  if(!analyzeSequence(current).ok||!analyzeSequence(next).ok)return [];
  const from=connectionSourceKey(current),to=connectionSourceKey(next);
  return connectionExampleMatches.filter(r=>r.from===from&&r.to===to)
    .map(({exampleIndex,sequence})=>({exampleIndex,sequence:structuredClone(sequence)}));
}

/** Keep an authored bridge and repeat its endpoint cycles so a standalone
 * source's complete flight/hand state can occur inside the candidate. These
 * are candidates only: registration must still inspect the loaded avatar and
 * match both directions before publishing any new segments. */
export function connectionReplayCandidates(current:SyncSequence,next:SyncSequence):SyncSequence[]{
  if(current.beatDuration!==next.beatDuration||!analyzeSequence(current).ok||!analyzeSequence(next).ok)return [];
  const from=connectionReplayKey(current),to=connectionReplayKey(next);
  const recipes=connectionExampleMatches.filter(r=>r.replayFrom===from&&r.replayTo===to||r.replayFrom===to&&r.replayTo===from);
  const sources=[current,next].map(s=>expandSequence(s).map(connectionRowKey)),candidates:SyncSequence[]=[];
  for(const recipe of recipes)for(const repeats of [2,4]){
    const rows=expandSequence(recipe.sequence),keys=rows.map(connectionRowKey),sets:SyncSequenceSet[]=[],found=new Set<number>();
    for(let i=0;i<rows.length;){
      let length=0;
      for(let source=0;source<sources.length&&!length;source++){
        const cycle=sources[source];
        for(let shift=0;shift<cycle.length;shift++)if(i+cycle.length<=rows.length&&cycle.every((_,j)=>keys[i+j]===cycle[(j+shift)%cycle.length])){
          length=cycle.length;found.add(source);break;
        }
      }
      if(length){
        for(let repeat=0;repeat<repeats;repeat++)sets.push(...structuredClone(rows.slice(i,i+length)));
        i+=length;
      }else sets.push(structuredClone(rows[i++]));
    }
    const sequence={...structuredClone(recipe.sequence),allowBallContact:current.allowBallContact||next.allowBallContact||undefined,beatDuration:current.beatDuration,mirrorRepeat:false,sets};
    if(found.size===2&&analyzeSequence(sequence).ok)candidates.push(sequence);
  }
  return candidates;
}
