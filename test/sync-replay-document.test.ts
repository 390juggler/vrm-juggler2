import {it,expect} from 'vitest';
import {validateReplayDocument,replayDocumentIdentity,SyncReplayDocument,MAX_SYNC_REPLAY_SOURCES} from '../src/motion/juggling/sync-replay-document';
import {sequenceFromPreset} from '../src/motion/juggling/sync-sequence';

const document=():SyncReplayDocument=>({kind:'sync-segment-route',version:1,name:'途中の列',
  sources:[{name:'Box',sequence:sequenceFromPreset('box'),mirror:false}],route:[{source:0,set:0}]});

it('preserves a resolved definition without trusting its timing, ownership or permission',()=>{
 const input=document(),source=input.sources[0];source.resolved=structuredClone(source.sequence);
 const saved=validateReplayDocument(input);
 expect(saved.sources[0].resolved).toEqual(source.sequence);
 expect(replayDocumentIdentity(saved).canonical).not.toBe(replayDocumentIdentity(document()).canonical);
 for(const change of [
  (s:typeof source.resolved)=>{s!.allowBallContact=true;},
  (s:typeof source.resolved)=>{s!.beatDuration=.3;},
  (s:typeof source.resolved)=>{s!.sets[0].throws=['2x','4'];},
 ]){
  const invalid=structuredClone(saved);change(invalid.sources[0].resolved!);
  expect(()=>validateReplayDocument(invalid)).toThrow();
 }
});

it('retains ball-contact permission and distinguishes it from a strict saved route',()=>{
 const strict=document(),allowed=structuredClone(strict);allowed.sources[0].sequence.allowBallContact=true;
 const saved=validateReplayDocument(JSON.parse(JSON.stringify(allowed)));
 expect(saved.sources[0].sequence.allowBallContact).toBe(true);
 expect(replayDocumentIdentity(saved).canonical).not.toBe(replayDocumentIdentity(strict).canonical);
 allowed.sources[0].sequence.allowBallContact=false;
 expect(replayDocumentIdentity(allowed).canonical).toBe(replayDocumentIdentity(strict).canonical);
 (allowed.sources[0].sequence as any).allowBallContact='true';
 expect(()=>validateReplayDocument(allowed)).toThrow();
});

it('定義・左右反転・未完成の列を保持し、検査の自己申告や入力の参照を持ち込まない',()=>{
  const input={...document(),verified:true,poses:[1,2,3]},output=validateReplayDocument(input);
  expect(output).toEqual(document());expect(output).not.toHaveProperty('verified');expect(output).not.toHaveProperty('poses');
  input.sources[0].sequence.name='変更';expect(output.sources[0].sequence.name).not.toBe('変更');
  const empty=document();empty.route=[];expect(validateReplayDocument(empty).route).toEqual([]);
  const transition=document();transition.sources[0].purpose='transition';
  expect(validateReplayDocument(transition).sources[0].purpose).toBe('transition');
});

it.each([
  null,{}, {...document(),version:2}, {...document(),name:'a'.repeat(101)}, {...document(),sources:[]},
  {...document(),route:[{source:1,set:0}]}, {...document(),route:[{source:0,set:-1}]},
  {...document(),route:[{source:0,set:.5}]}, {...document(),route:Array(129).fill({source:0,set:0})},
  {...document(),sources:[{name:'invalid',sequence:{},mirror:false}]},
  {...document(),sources:[{...document().sources[0],mirror:'false'}]},
  {...document(),sources:[{...document().sources[0],purpose:'verified'}]},
])('不正な文書を動作の検査前に拒否する: %#',input=>expect(()=>validateReplayDocument(input)).toThrow());

it('異なるテンポや球数の登録を混ぜない',()=>{
  const d=document(),second=structuredClone(d.sources[0]);second.sequence.beatDuration=.3;d.sources.push(second);
  expect(()=>validateReplayDocument(d)).toThrow('球数とテンポ');
});

it('移行を含む256件までの登録元と、128番以降の接続列を保存して読み戻せる',()=>{
  const d=document();d.sources=Array.from({length:MAX_SYNC_REPLAY_SOURCES},(_,i)=>({...structuredClone(d.sources[0]),name:`部品${i+1}`}));
  d.sources[128].purpose='transition';d.route=[{source:128,set:0},{source:255,set:1}];
  const saved=validateReplayDocument(d),restored=validateReplayDocument(JSON.parse(JSON.stringify(saved)));
  expect(saved).toEqual(d);expect(restored).toEqual(d);expect(saved.sources).toHaveLength(256);
  expect(saved.sources[128].purpose).toBe('transition');
});

it('登録元257件と、128セットを超える接続列は引き続き拒否する',()=>{
  const d=document();d.sources=Array.from({length:MAX_SYNC_REPLAY_SOURCES+1},()=>structuredClone(d.sources[0]));
  expect(()=>validateReplayDocument(d)).toThrow('部品数');
  d.sources.length=MAX_SYNC_REPLAY_SOURCES;d.route=Array(129).fill({source:0,set:0});
  expect(()=>validateReplayDocument(d)).toThrow('部品数');
});

it('表示名・出典名・移行ラベルを変えても接続構成の識別は変わらない',()=>{
  const d=document(),before=structuredClone(d),identity=replayDocumentIdentity(d);
  expect(d).toEqual(before);expect(identity.canonical.startsWith('SYNC-ROUTE1:')).toBe(true);expect(identity.contentId).toMatch(/^[0-9a-f]{8}$/);
  d.name='好きな名前';d.sources[0].name='別名';d.sources[0].sequence.name='別の見本名';d.sources[0].purpose='transition';
  d.sources[0].sequence.sets[0].sourceName='参考資料の呼び方';
  expect(replayDocumentIdentity(d)).toEqual(identity);
  const shuffled=(v:any):any=>Array.isArray(v)?v.map(shuffled):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,shuffled(x)])):v;
  expect(replayDocumentIdentity(shuffled(d))).toEqual(identity);
});

const changes:[string,(d:SyncReplayDocument)=>void][]=[
  ['開始位置',d=>{d.route=[{source:0,set:1}];}],
  ['繰り返す回数',d=>{d.route.push(...structuredClone(d.route));}],
  ['テンポ',d=>{d.sources[0].sequence.beatDuration=.25;}],
  ['左右反転',d=>{d.sources[0].mirror=true;}],
  ['手の向き',d=>{d.sources[0].sequence.sets[0].motion.hands=[{releaseGrip:'overhand'}];}],
  ['手の運び',d=>{d.sources[0].sequence.sets[0].motion.shortMotions=[{carry:'front'}];}],
  ['登録した元周期の繰り返し',d=>{d.sources[0].sequence.sets.push(...structuredClone(d.sources[0].sequence.sets));}],
];
it.each(changes)('%s の変更を、同じ表示名でも接続構成で区別する',(_,change)=>{
  const d=document(),before=replayDocumentIdentity(d);change(d);
  expect(replayDocumentIdentity(d).canonical).not.toBe(before.canonical);expect(replayDocumentIdentity(d).contentId).not.toBe(before.contentId);
});

it('列に直接使わない登録元も、登録順と定義を接続構成に残す',()=>{
  const d=document();d.sources.push({name:'Inverted',sequence:sequenceFromPreset('inverted'),mirror:false});
  const before=replayDocumentIdentity(d),swapped=structuredClone(d);swapped.sources.reverse();swapped.route[0].source=1;
  expect(replayDocumentIdentity(swapped).canonical).not.toBe(before.canonical);
  d.sources[1].sequence.sets[0].motion.hands=[{releaseGrip:'overhand'}];
  expect(replayDocumentIdentity(d).canonical).not.toBe(before.canonical);
});

it('空の列にも構成IDを作るが、入力の周期・検査済み表示を信用しない',()=>{
  const d=document();d.route=[];
  const identity=replayDocumentIdentity({...d,code:'claimed',identitySets:1,verified:true});
  expect(identity.routeSets).toBe(0);expect(identity).not.toHaveProperty('identitySets');expect(identity).not.toHaveProperty('verified');
  expect(()=>replayDocumentIdentity({...d,route:[{source:4,set:0}]})).toThrow('参照');
});

it('同じ部品・同じセット数でも、並び順を変えた接続列は区別する',()=>{
  const d=document();d.route=[{source:0,set:0},{source:0,set:1}];
  const before=replayDocumentIdentity(d);d.route.reverse();
  const after=replayDocumentIdentity(d);expect(after.routeSets).toBe(before.routeSets);
  expect(after.canonical).not.toBe(before.canonical);expect(after.contentId).not.toBe(before.contentId);
});
