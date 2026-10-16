import {it,expect} from 'vitest';
import * as THREE from 'three';
import {rotateSequenceStart,sequenceFromPreset,expandSequence,analyzeSequence,compileSequence,appendSequence,connectSequenceCycles,SEQUENCE_EXAMPLES,SyncSequence} from '../src/motion/juggling/sync-sequence';
import {SYNC_BOX_PRESETS,SYNC_RADIUS,syncBeat,syncDwell,buildSyncBoxTracks,inspectSyncBox} from '../src/motion/juggling/sync-box';
import {CreateSiteswap} from '../src/motion/juggling/Siteswap';
import {makeTransform} from '../src/motion/juggling/tracks';
import Options from '../src/options';

const transform=makeTransform({shoulderY:1.403,shoulderX:.137,shoulderZ:.021,upperArmLength:.278,armLength:.533});
const mod=(n:number,d:number)=>(n%d+d)%d;
function tracks(sequence:SyncSequence){
  const config=compileSequence(sequence).config!;
  const source=CreateSiteswap(config.siteswap,{...new Options().siteswap,beatDuration:syncBeat(config),dwellRatio:syncDwell(config),props:[{type:'ball',color:'red',radius:SYNC_RADIUS,C:.9}]});
  return buildSyncBoxTracks(source,transform,config);
}
function at(points:THREE.Vector3[],time:number,period:number){
  const t=mod(time,period)/period*points.length,i=Math.floor(t);
  return points[i%points.length].clone().lerp(points[(i+1)%points.length],t-i);
}

const sources:[string,SyncSequence][]=[...SYNC_BOX_PRESETS.map(p=>[p.id,sequenceFromPreset(p.id)] as [string,SyncSequence]),...SEQUENCE_EXAMPLES.map((s,i)=>[`example:${i}`,s] as [string,SyncSequence])];
it.each(sources)('見本 %s の開始セット変更は一周の球と手の経路を保つ',(_id,original)=>{
  const saved=structuredClone(original),offset=1;
  if(expandSequence(original).length<2){expect(rotateSequenceStart(original,0)).toEqual(saved);expect(()=>rotateSequenceStart(original,1)).toThrow('開始セット');return;}
  const rotated=rotateSequenceStart(original,offset),before=tracks(original),after=tracks(rotated),shift=offset*2*original.beatDuration;
  expect(original).toEqual(saved);expect(after.period).toBeCloseTo(before.period,9);
  expect(analyzeSequence(rotated).balls).toBe(analyzeSequence(original).balls);
  for(const f of after.flights){
    const g=before.flights.find(g=>g.throwHand===f.throwHand&&g.value===f.value&&Math.abs(mod(g.release-shift,before.period)-f.release)<1e-8)!;
    expect(g).toBeDefined();expect(g.catchHand).toBe(f.catchHand);
    expect(f.start.distanceTo(g.start)).toBeLessThan(1e-9);expect(f.end.distanceTo(g.end)).toBeLessThan(1e-9);
    expect(f.duration).toBeCloseTo(g.duration,9);expect(f.releaseGrip).toBe(g.releaseGrip);expect(f.catchGrip).toBe(g.catchGrip);
  }
  for(let i=0;i<80;i++){
    const t=i/80*after.period;
    for(let h=0;h<2;h++)expect(at(after.hands[h].positions,t,after.period).distanceTo(at(before.hands[h].positions,t+shift,before.period))).toBeLessThan(1e-7);
    const unmatched=before.props.map(p=>at(p,t+shift,before.period));
    for(const p of after.props){
      const q=at(p,t,after.period),j=unmatched.findIndex(x=>x.distanceTo(q)<1e-7);
      expect(j).toBeGreaterThanOrEqual(0);unmatched.splice(j,1);
    }
  }
});

it('途中の回数と左右交代を展開し、1回分の位置から開始できる',()=>{
  const s=structuredClone(SEQUENCE_EXAMPLES[7]);s.sets[0].repeat=3;s.mirrorRepeat=true;
  s.sets[0].motion.hands=[{heightOffset:.03},{heightOffset:-.02}];
  const before=expandSequence(s),r=rotateSequenceStart(s,5),after=expandSequence(r);
  expect(r.mirrorRepeat).toBe(false);expect(after).toHaveLength(before.length);
  for(let i=0;i<after.length;i++){
    expect(after[i].throws).toEqual(before[(i+5)%before.length].throws);
    expect(after[i].motion).toEqual(before[(i+5)%before.length].motion);
  }
  expect(r.beatDuration).toBe(s.beatDuration);
});
it('上下交代クロスを回しても各投げの上側の腕を保ち、保存復元できる',()=>{
  const s=sequenceFromPreset('crossed-alternate'),r=rotateSequenceStart(s,1);
  expect(r.sets.map(x=>x.motion.armPhase)).toEqual([1,0]);
  const restored=JSON.parse(JSON.stringify(r));expect(analyzeSequence(restored).canonical).toBe(analyzeSequence(r).canonical);
  const fixed=structuredClone(s);fixed.sets[0].motion.armPhase=1;fixed.sets[1].motion.armPhase=0;
  expect(rotateSequenceStart(fixed,1).sets.map(x=>x.motion.armPhase)).toEqual([0,1]);
});
it('先頭の選択は回数と左右交代を変えず、返した値は元データと独立する',()=>{
  const s=structuredClone(SEQUENCE_EXAMPLES[2]),before=structuredClone(s),r=rotateSequenceStart(s,0);
  expect(r).toEqual(s);r.sets[0].throws[0]='0';expect(s).toEqual(before);
});
it('暗黙の上下交代が奇数周期にまたがる場合は黙って別の腕配置へ変えない',()=>{
  const s=structuredClone(SEQUENCE_EXAMPLES[7]);s.sets[0].repeat=3;s.sets[0].motion.armOrder='alternate';
  expect(analyzeSequence(s).ok).toBe(true);
  expect(()=>rotateSequenceStart(s,1)).toThrow('クロス開始側');
  s.sets[0].motion.armPhase=0;
  expect(analyzeSequence(rotateSequenceStart(s,1)).ok).toBe(true);
});
it('不正な開始位置と成立しない列を拒否し、入力を保持する',()=>{
  const s=SEQUENCE_EXAMPLES[43],before=structuredClone(s);
  for(const i of [-1,.5,4,NaN])expect(()=>rotateSequenceStart(s,i)).toThrow('開始セット');
  const invalid=structuredClone(s);invalid.sets[0].throws=['4','4'];
  expect(()=>rotateSequenceStart(invalid,1)).toThrow('受け渡し');expect(s).toEqual(before);
});
it('同じ行の回数をまとめて128セットを保持し、64行の制限を超える展開は拒否する',()=>{
  const s:SyncSequence={...sequenceFromPreset('shower'),sets:Array.from({length:8},()=>({...sequenceFromPreset('shower').sets[0],repeat:16}))};
  const r=rotateSequenceStart(s,57);expect(expandSequence(r)).toHaveLength(128);expect(r.sets).toHaveLength(8);
  const long:SyncSequence={...SEQUENCE_EXAMPLES[7],sets:Array.from({length:64},()=>({...structuredClone(SEQUENCE_EXAMPLES[7].sets[0]),repeat:2}))};
  // Give every row a distinct label so merging cannot erase provenance.
  long.sets.forEach((row,i)=>row.sourceName=String(i));
  expect(analyzeSequence(long).ok).toBe(true);expect(()=>rotateSequenceStart(long,1)).toThrow('64行');
});
it('腕下クローからダブルの3セット目へ入ると、つなぎなしの6セットで両方向が閉じる',()=>{
  const from=SEQUENCE_EXAMPLES[40],to=SEQUENCE_EXAMPLES[43],shifted=rotateSequenceStart(to,2),expected=SEQUENCE_EXAMPLES[44];
  const direct=appendSequence(from,to,false).sequence!;
  expect(analyzeSequence(direct).ok).toBe(false);
  const result=connectSequenceCycles(from,shifted,false);
  expect(result).toMatchObject({bridgeSets:0,forwardSets:0,returnSets:0});
  expect(analyzeSequence(result.sequence!).canonical).toBe(analyzeSequence(expected).canonical);
  expect(analyzeSequence(expected)).toMatchObject({ok:true,balls:3,movementSets:6,identitySets:6});
  const rows=expandSequence(expected);
  expect(rows.slice(0,2).map(r=>r.motion)).toEqual(from.sets.map(r=>r.motion));
  expect(rows.slice(2).map(r=>r.motion)).toEqual([2,3,0,1].map(i=>to.sets[i].motion));
  const t=tracks(expected);expect(t.period).toBeCloseTo(3,9);expect(t.underarmEvents).toHaveLength(6);
  expect(t.flights.filter(f=>f.value===2&&f.catchGrip==='overhand')).toHaveLength(6);
  expect(inspectSyncBox(t,transform)).toMatchObject({geometryOK:true,ownershipConflicts:0});
});
