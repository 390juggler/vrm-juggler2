import {analyzeSequence,expandSequence,SyncSequence} from './sync-sequence';

// Generated transitions are source definitions too. Leave room for additional
// user motions after preparing the shared basic network.
export const MAX_SYNC_REPLAY_SOURCES=256;

export interface SyncReplayDocument {
  kind:'sync-segment-route';version:1;name:string;
  /** Preserve registration order, including sources used only as elbow anchors. */
  sources:{name:string;sequence:SyncSequence;resolved?:SyncSequence;mirror:boolean;purpose?:'transition';planning?:'constructive'}[];
  route:{source:number;set:number}[];
}

/** Documents describe how to rebuild motion. They never certify stored poses. */
export function validateReplayDocument(input:unknown):SyncReplayDocument{
  const d=input as SyncReplayDocument;
  if(!d||d.kind!=='sync-segment-route'||d.version!==1||typeof d.name!=='string'||d.name.length>100||
    !Array.isArray(d.sources)||!d.sources.length||d.sources.length>MAX_SYNC_REPLAY_SOURCES||!Array.isArray(d.route)||d.route.length>128)
    throw new Error('接続列の形式・名前・部品数を確認してください。');
  const sources=d.sources.map((source,i)=>{
    if(!source||typeof source.name!=='string'||source.name.length>100||typeof source.mirror!=='boolean'||
      source.purpose!==undefined&&source.purpose!=='transition'||source.planning!==undefined&&source.planning!=='constructive')
      throw new Error(`元の動作${i+1}の名前と左右反転を確認してください。`);
    try{
      const a=analyzeSequence(source.sequence);
      if(!a.ok)throw new Error();
      if(source.resolved){
        const r=analyzeSequence(source.resolved),original=expandSequence(source.sequence),resolved=expandSequence(source.resolved);
        if(!r.ok||r.balls!==a.balls||r.identitySets!==a.identitySets||source.resolved.beatDuration!==source.sequence.beatDuration||
          !!source.resolved.allowBallContact!==!!source.sequence.allowBallContact||resolved.length%original.length||
          resolved.some((row,i)=>JSON.stringify(row.throws)!==JSON.stringify(original[i%original.length].throws)))throw new Error();
      }
      return {source,analysis:a};
    }catch{throw new Error(`元の動作${i+1}のセット定義が成立していません。`);}
  });
  if(sources.reduce((n,s)=>n+s.analysis.identitySets,0)>4096)
    throw new Error('登録部品は合計4096セット以内にしてください。');
  const first=sources[0];
  if(sources.some(s=>s.analysis.balls!==first.analysis.balls||s.source.sequence.beatDuration!==first.source.sequence.beatDuration))
    throw new Error('接続部品の球数とテンポをそろえてください。');
  for(const part of d.route){
    if(!part||!Number.isInteger(part.source)||part.source<0||part.source>=sources.length||
      !Number.isInteger(part.set)||part.set<0||part.set>=sources[part.source].analysis.identitySets)
      throw new Error('接続列が参照する元の動作とセット番号を確認してください。');
  }
  const result:SyncReplayDocument={kind:'sync-segment-route',version:1,name:d.name,
    sources:sources.map(({source})=>({name:source.name,sequence:source.sequence,mirror:source.mirror,
      ...(source.planning?{planning:source.planning}:{}),
      ...(source.resolved?{resolved:source.resolved}:{}),
      ...(source.purpose?{purpose:source.purpose}:{})})),
    route:d.route.map(r=>({source:r.source,set:r.set}))};
  // JSON also breaks aliases. Only definitions and references survive a round
  // trip; executable readers and claimed validation results are not imported.
  const json=JSON.stringify(result);
  if(json.length>2_000_000)throw new Error('接続列のファイルが大きすぎます。');
  return JSON.parse(json);
}

/** A construction identity, not a certificate of motion or anatomy validity.
 * Keep all source definitions in registration order: an unused earlier source
 * may supply an elbow anchor when rebuilding a later source. Display labels
 * and the UI-only transition flag do not change the construction identity.
 */
export function replayDocumentIdentity(input:unknown){
  const document=validateReplayDocument(input);
  const canonicalize=(v:any):any=>Array.isArray(v)?v.map(canonicalize):v&&typeof v==='object'?
    Object.fromEntries(Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>[k,canonicalize(v[k])])):v;
  const definition=(sequence:SyncSequence)=>({version:sequence.version,beatDuration:sequence.beatDuration,
    mirrorRepeat:sequence.mirrorRepeat,allowBallContact:sequence.allowBallContact||undefined,
    sets:sequence.sets.map(row=>({throws:row.throws,motion:row.motion,repeat:row.repeat}))});
  const sources=document.sources.map(s=>({mirror:s.mirror,...(s.planning?{planning:s.planning}:{}),...(s.resolved?{resolved:definition(s.resolved)}:{}),sequence:{version:s.sequence.version,
    beatDuration:s.sequence.beatDuration,mirrorRepeat:s.sequence.mirrorRepeat,allowBallContact:s.sequence.allowBallContact||undefined,
    sets:s.sequence.sets.map(row=>({throws:row.throws,motion:row.motion,repeat:row.repeat}))}}));
  const canonical='SYNC-ROUTE1:'+JSON.stringify(canonicalize({sources,route:document.route}));
  let hash=0x811c9dc5;for(const c of canonical)hash=Math.imul(hash^c.charCodeAt(0),0x01000193)>>>0;
  return {canonical,contentId:hash.toString(16).padStart(8,'0'),balls:analyzeSequence(document.sources[0].sequence).balls,
    routeSets:document.route.length,secondsPerSet:document.sources[0].sequence.beatDuration*2};
}
