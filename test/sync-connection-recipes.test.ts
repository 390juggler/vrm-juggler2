import {it,expect} from 'vitest';
import {connectionReplayCandidates,sequenceFromPreset,rotateSequenceStart,expandSequence,analyzeSequence,SEQUENCE_EXAMPLES} from '../src/motion/juggling/sync-sequence';
import {sequenceFromBasicParts} from '../src/motion/juggling/sync-sequence';
import {fixedUnderarmInvertedTransition} from '../src/motion/juggling/sync-transitions';
import {SYNC_DWELL} from '../src/motion/juggling/sync-box';
import {basicNetworkPlan} from '../src/motion/juggling/sync-basic-network';

it.each([[36,37,'box',16],[38,39,'reverse',12]] as const)('既存の腕下移行 %s は元の周期だけを増やし、投げと移行経路を保持する',(target,recipe,preset,count)=>{
  const a=sequenceFromPreset(preset),b=structuredClone(SEQUENCE_EXAMPLES[target]);a.beatDuration=b.beatDuration;
  const before=structuredClone([a,b,SEQUENCE_EXAMPLES[recipe]]),candidates=connectionReplayCandidates(a,b);
  expect(candidates).toHaveLength(2);expect(candidates[0].sets).toHaveLength(count);
  expect(connectionReplayCandidates(b,a)).toEqual(candidates);
  const sourceRows=[a,b].flatMap(expandSequence),originalRows=expandSequence(SEQUENCE_EXAMPLES[recipe]);
  for(const s of candidates){
    expect(analyzeSequence(s).ok).toBe(true);expect(s.beatDuration).toBe(a.beatDuration);
    const key=(r:any)=>JSON.stringify({throws:r.throws,motion:r.motion}),sourceKeys=sourceRows.map(key);
    expect(s.sets.filter(r=>!sourceKeys.includes(key(r)))).toEqual(originalRows.filter(r=>!sourceKeys.includes(key(r))));
    for(const row of s.sets)expect(originalRows).toContainEqual(row);
  }
  candidates[0].sets[0].throws=['0','0'];
  expect([a,b,SEQUENCE_EXAMPLES[recipe]]).toEqual(before);
});

it('開始セットと名前を変えても同じ完全周期なら候補を使い、長い入力を勝手に短縮しない',()=>{
  const a=sequenceFromPreset('box'),b=structuredClone(SEQUENCE_EXAMPLES[36]);a.beatDuration=b.beatDuration;
  const expected=connectionReplayCandidates(a,b);
  const shifted=rotateSequenceStart(b,1);shifted.name='ユーザーの名前';
  expect(connectionReplayCandidates(a,shifted)).toEqual(expected);
  const repeated={...b,sets:[...b.sets,...b.sets]};
  expect(connectionReplayCandidates(a,repeated)).toEqual([]);
});

it('モデルで再検査する候補は登録済みのテンポを保ち、位置や手向きの異なる同名の動作へ流用しない',()=>{
  const a=sequenceFromPreset('box'),b=structuredClone(SEQUENCE_EXAMPLES[36]);a.beatDuration=b.beatDuration=.205;
  expect(connectionReplayCandidates(a,b).map(s=>s.beatDuration)).toEqual([.205,.205]);
  const moved=structuredClone(b);moved.sets[0].motion.hands![0]!.definition!.release.x+=.01;
  expect(connectionReplayCandidates(a,moved)).toEqual([]);
  const grip=structuredClone(b);grip.sets[0].motion.hands![0]!.releaseGrip='overhand';
  expect(connectionReplayCandidates(a,grip)).toEqual([]);
  b.beatDuration=.225;expect(connectionReplayCandidates(a,b)).toEqual([]);
});

it('固定Reverse-UAIへの移行は両方の元周期を保ち、4xが逆向きになる間だけ前後へ分ける',()=>{
  const a=sequenceFromBasicParts({roles:'fixed',shortHand:0,left:'inverted',right:'inverted'}),b=structuredClone(SEQUENCE_EXAMPLES[47]);
  a.beatDuration=b.beatDuration=.25;const before=structuredClone([a,b]);
  const s=fixedUnderarmInvertedTransition(a,b)!;
  expect(fixedUnderarmInvertedTransition(b,a)).toEqual(s);
  expect(analyzeSequence(s)).toMatchObject({ok:true,movementSets:14,identitySets:42});
  expect(s.sets.slice(0,2)).toEqual([...a.sets,...a.sets]);expect(s.sets.slice(7,9)).toEqual([...b.sets,...b.sets]);
  const initial=s.sets[2].motion.hands!,middle=s.sets[4].motion.hands!;
  expect(initial[0]!.definition!.flightFraction).toBe(1-SYNC_DWELL/2);
  expect(initial[1]!.definition!.flightFraction).toBe(1-SYNC_DWELL/4);
  expect(middle[1]!.definition!.catch.z-middle[1]!.definition!.release.z).toBeCloseTo(.2);
  expect(middle[0]!.definition!.emptyReturn!.via!.every(v=>v.offset[2]<0)).toBe(true);
  s.sets[0].throws=['0','0'];expect([a,b]).toEqual(before);
});

it('固定型の移行は別の位置・手向き・反復数・テンポの入力を同名だけで一致させない',()=>{
  const a=sequenceFromBasicParts({roles:'fixed',shortHand:0,left:'inverted',right:'inverted'}),b=structuredClone(SEQUENCE_EXAMPLES[47]);
  a.beatDuration=b.beatDuration=.25;
  const moved=structuredClone(b);moved.sets[0].motion.hands![0]!.definition!.catch.x+=.01;
  expect(fixedUnderarmInvertedTransition(a,moved)).toBeUndefined();
  const grip=structuredClone(b);grip.sets[0].motion.hands![0]!.catchGrip='overhand';
  expect(fixedUnderarmInvertedTransition(a,grip)).toBeUndefined();
  expect(fixedUnderarmInvertedTransition({...a,sets:[...a.sets,...a.sets]},b)).toBeUndefined();
  expect(fixedUnderarmInvertedTransition({...a,beatDuration:.3},b)).toBeUndefined();
  expect(fixedUnderarmInvertedTransition({...sequenceFromPreset('box'),beatDuration:.25},b)).toBeUndefined();
});

it('固定型専用の移行を既存90動作へ適用しない',()=>{
  const plan=basicNetworkPlan(.25),target={...structuredClone(SEQUENCE_EXAMPLES[47]),beatDuration:.25};
  expect(plan.sources).toHaveLength(90);
  for(const source of plan.sources){
    expect(fixedUnderarmInvertedTransition(source,target)).toBeUndefined();
    expect(fixedUnderarmInvertedTransition(target,source)).toBeUndefined();
  }
});
