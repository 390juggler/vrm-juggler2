import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {analyzeSequence,compileSequence,sequenceFromPreset,sequenceFromBasicParts,sequenceFromDoubleParts,sequenceWithDoubleParts,sequenceHandDefinition,extractSequenceSet,addInlineTransitions,appendSequence,connectSequenceCycles,expandSequence,SEQUENCE_EXAMPLES,SyncSequence,BasicShortStyle,BasicColumnStyle} from '../src/motion/juggling/sync-sequence';
import {SYNC_BOX_PRESETS,SYNC_RADIUS,syncBeat,syncDwell,buildSyncBoxTracks,inspectSyncBox,syncFlightAt} from '../src/motion/juggling/sync-box';
import {CreateSiteswap} from '../src/motion/juggling/Siteswap';
import Options from '../src/options';
import {columnReceiverHandoff,alternatingCrossTransition,mixedAlternatingCrossTransition,spatialLaneTransition,underarmCatchTransition,lateralShuffleTransition,upperInlineTransition} from '../src/motion/juggling/sync-transitions';
import {makeTransform} from '../src/motion/juggling/tracks';
const transform=makeTransform({shoulderY:1.403,shoulderX:.137,shoulderZ:.021,upperArmLength:.278,armLength:.533});
function build(config:any){
  const source=CreateSiteswap(config.siteswap,{...new Options().siteswap,beatDuration:syncBeat(config),dwellRatio:syncDwell(config),
    props:[{type:'ball',color:'red',radius:SYNC_RADIUS,C:.9}]});
  expect(source.errorMessage).toBeUndefined();
  return buildSyncBoxTracks(source,transform,config);
}
const basicStyles:BasicShortStyle[]=['normal','shuffle','reverse','inverted'];
const extraColumns:BasicColumnStyle[]=['switched','crossed','crossed-right','crossed-alternate','underarm'];
it('editing Double 2x preserves authored columns and changes the selected passage, including rotated sets',()=>{
  const source=structuredClone(SEQUENCE_EXAMPLES.find(s=>s.name.startsWith('Extended Box /'))!);
  const original=structuredClone(source);
  for(const crossSet of basicStyles)for(const selfSet of basicStyles){
    const edited=sequenceWithDoubleParts(source,{crossSet,selfSet}),before=build(compileSequence(source).config),after=build(compileSequence(edited).config);
    expect(edited.sets.map(r=>r.motion.columnMotion)).toEqual(source.sets.map(r=>r.motion.columnMotion));
    expect(edited.sets.map(r=>r.throws)).toEqual(source.sets.map(r=>r.throws));
    expect(edited.beatDuration).toBe(source.beatDuration);
    after.flights.forEach((f,i)=>{
      const old=before.flights[i];
      if(f.value===4){expect(f.start.distanceTo(old.start)).toBeLessThan(1e-9);expect(f.end.distanceTo(old.end)).toBeLessThan(1e-9);return;}
      const high=after.flights.find(g=>g.value===4&&Math.abs(g.release-f.release)<1e-9)!;
      expect(f.style).toBe(high.throwHand!==high.catchHand?crossSet:selfSet);
      expect(f.start.x).toBeCloseTo(old.start.x,9);expect(f.end.x).toBeCloseTo(old.end.x,9);
      if(f.style!=='normal')expect(Math.abs(f.start.y-old.start.y)+Math.abs(f.end.y-old.end.y)).toBeGreaterThan(.01);
    });
  }
  const rotated=structuredClone(source);rotated.sets.push(rotated.sets.shift()!);
  const changed=sequenceWithDoubleParts(rotated,{crossSet:'shuffle',selfSet:'inverted'});
  changed.sets.forEach(row=>{const h=row.throws.indexOf('2x');expect(row.motion.hands![h]!.style).toBe(row.throws[1-h]==='4x'?'shuffle':'inverted');});
  expect(source).toEqual(original);
  const box=sequenceFromPreset('box');box.sets.push(...structuredClone(box.sets));
  expect(()=>sequenceWithDoubleParts(box,{crossSet:'normal',selfSet:'normal'})).toThrow();
});
it('上側In-lineの往復でも元の2周期と、保持中を含む縦一列を保つ',()=>{
  const a=sequenceFromPreset('box'),b=sequenceFromPreset('inline-inverted');a.beatDuration=b.beatDuration;
  const before=structuredClone([a,b]),joined=upperInlineTransition(a,b)!;
  expect([a,b]).toEqual(before);expect(upperInlineTransition(b,a)).toEqual(joined);
  expect(analyzeSequence(joined)).toMatchObject({ok:true,balls:3,movementSets:44,identitySets:44});
  expect(joined.sets.slice(0,4)).toEqual([...a.sets,...a.sets]);
  expect(joined.sets.slice(22,26)).toEqual([...b.sets,...b.sets]);
  const tracks=build(compileSequence(joined).config),originals=[a,b].map(s=>build(compileSequence(s).config));
  expect(inspectSyncBox(tracks,transform).geometryOK).toBe(true);
  for(const f of tracks.flights){
    const row=Math.floor(f.release/(2*joined.beatDuration)+1e-9),source=row<4?0:row>=22&&row<26?1:-1;
    if(source<0)continue;
    const original=originals[source].flights.find(g=>g.throwHand===f.throwHand&&g.value===f.value)!;
    expect(f.start.distanceTo(original.start)).toBeLessThan(1e-12);
    expect(f.end.distanceTo(original.end)).toBeLessThan(1e-12);
    expect(f.velocity.distanceTo(original.velocity)).toBeLessThan(1e-10);
    expect(f.releaseGrip).toBe(original.releaseGrip);expect(f.catchGrip).toBe(original.catchGrip);
  }
  let frames=0,held=0;
  for(let k=0;k<tracks.numSteps;k++){
    const row=joined.sets[Math.floor(k*tracks.stepDuration/(2*joined.beatDuration)+1e-8)%joined.sets.length];
    if(row.motion.arrangement!=='inline')continue;
    frames++;
    tracks.props.forEach((p,j)=>{
      expect(p[k].x).toBeCloseTo(0,9);expect(p[k].z).toBeCloseTo(-.30*transform.horizontalScale,9);
      if(tracks.owners[j][k]>=0)held++;
    });
  }
  expect(frames).toBeGreaterThan(50);expect(held).toBeGreaterThan(10);
});
it('上側In-lineの既存移行は増殖せず、変更した見本に専用移行を流用しない',()=>{
  const a=sequenceFromPreset('box'),b=sequenceFromPreset('inline-inverted');a.beatDuration=b.beatDuration;
  const joined=upperInlineTransition(a,b)!;
  expect(addInlineTransitions(joined)).toMatchObject({sequence:joined,addedSets:0});
  expect(addInlineTransitions({...a,sets:[...a.sets,...b.sets]}).sequence).toBeUndefined();
  const changed=structuredClone(b);changed.sets[0].motion.hands=[{catchGrip:'overhand'}];
  expect(upperInlineTransition(a,changed)).toBeUndefined();
  expect(upperInlineTransition(a,{...b,beatDuration:b.beatDuration+.01})).toBeUndefined();
  expect(upperInlineTransition({...a,sets:[...a.sets,...a.sets]},b)).toBeUndefined();
});
it('Switchedの反対側縦上と縦下をつなぎ、元の投球と内向きの肘設定を保持する',()=>{
  const a=sequenceFromPreset('switched-cross-side-vertical-up'),b=sequenceFromPreset('switched-cross-side-vertical-down'),before=structuredClone([a,b]);
  const joined=spatialLaneTransition(a,b)!;
  expect(analyzeSequence(joined)).toMatchObject({ok:true,balls:3,movementSets:28,identitySets:28});
  expect(joined.sets.slice(0,4)).toEqual([...a.sets,...a.sets]);
  expect(joined.sets.slice(14,18)).toEqual([...b.sets,...b.sets]);
  expect(spatialLaneTransition(b,a)).toEqual(joined);
  expect(joined.sets.every(r=>r.motion.columns==='switched')).toBe(true);
  const tracks=build(compileSequence(joined).config),originals=[a,b].map(s=>build(compileSequence(s).config));
  expect(inspectSyncBox(tracks,transform).geometryOK).toBe(true);
  const styles=new Set<string>();
  for(const f of tracks.flights){
    expect(f.start.x).toBeCloseTo(f.end.x,12);expect(f.start.z).toBeCloseTo(f.end.z,12);
    const row=Math.floor(f.release/(2*joined.beatDuration)+1e-9),source=row<4?0:row>=14&&row<18?1:-1;
    if(source>=0){
      const original=originals[source].flights.find(g=>g.throwHand===f.throwHand&&g.value===f.value)!;
      expect(f.start.distanceTo(original.start)).toBeLessThan(1e-12);expect(f.end.distanceTo(original.end)).toBeLessThan(1e-12);
      expect(f.velocity.distanceTo(original.velocity)).toBeLessThan(1e-10);
      expect(f.releaseGrip).toBe(original.releaseGrip);
    }else if(f.value===2){styles.add(f.style!);expect(f.releaseGrip).toBe('overhand');}
    if(f.value===2&&f.style==='vertical-down')expect(f.velocity.length()).toBeLessThan(1e-12);
  }
  expect([...styles].sort()).toEqual(['normal','vertical-down','vertical-up']);
  joined.sets[4].motion.short![0]='inverted';joined.sets[0].motion.columnMotion!.release.y+=.1;
  expect([a,b]).toEqual(before);
});
it('Switchedの反対側の上下移行は、編集済みの位置や向き、別の配置へ流用しない',()=>{
  const a=sequenceFromPreset('switched-cross-side-vertical-up'),b=sequenceFromPreset('switched-cross-side-vertical-down');
  b.name='別名';expect(spatialLaneTransition(a,b)).toBeDefined();
  for(const change of [
    (s:SyncSequence)=>{s.sets[0].motion.columnMotion!.release.x+=.01;},
    (s:SyncSequence)=>{s.sets[0].motion.hands=[{releaseGrip:'underhand'},undefined];},
    (s:SyncSequence)=>{s.beatDuration+=.01;},
    (s:SyncSequence)=>{s.sets[0].repeat=2;},
  ]){const changed=structuredClone(b);change(changed);expect(spatialLaneTransition(a,changed)).toBeUndefined();}
  expect(spatialLaneTransition(sequenceFromPreset('switched-center-vertical-up'),b)).toBeUndefined();
  expect(spatialLaneTransition(sequenceFromPreset('cross-side-vertical-up'),b)).toBeUndefined();
});
it('Switchedの反対側縦上投げへの移行は、鉛直投げと元の周期を保ちながら途中の高さを分ける',()=>{
  const a=sequenceFromPreset('switched-center-vertical-up'),b=sequenceFromPreset('switched-cross-side-vertical-up'),before=structuredClone([a,b]);
  const joined=spatialLaneTransition(a,b)!;
  expect(analyzeSequence(joined)).toMatchObject({ok:true,balls:3,movementSets:28,identitySets:28});
  expect(joined.sets.slice(0,4)).toEqual([...a.sets,...a.sets]);
  expect(joined.sets.slice(14,18)).toEqual([...b.sets,...b.sets]);
  expect(spatialLaneTransition(b,a)).toEqual(joined);
  const tracks=build(compileSequence(joined).config),originals=[a,b].map(s=>build(compileSequence(s).config));
  expect(inspectSyncBox(tracks,transform).geometryOK).toBe(true);
  for(const f of tracks.flights){
    expect(f.start.x).toBeCloseTo(f.end.x,12);expect(f.start.z).toBeCloseTo(f.end.z,12);
    if(f.value===2){expect(f.style).toBe('vertical-up');expect(f.releaseGrip).toBe('underhand');expect(f.velocity.y).toBeGreaterThan(0);}
    const row=Math.floor(f.release/(2*joined.beatDuration)+1e-9),source=row<4?0:row>=14&&row<18?1:-1;
    if(source>=0){
      const original=originals[source].flights.find(g=>g.throwHand===f.throwHand&&g.value===f.value)!;
      expect(f.start.distanceTo(original.start)).toBeLessThan(1e-12);expect(f.end.distanceTo(original.end)).toBeLessThan(1e-12);
      expect(f.velocity.distanceTo(original.velocity)).toBeLessThan(1e-10);
    }
  }
  joined.sets[4].motion.short![0]='normal';joined.sets[0].motion.columnMotion!.release.x+=.1;
  expect([a,b]).toEqual(before);
});
it('Switchedの縦上移行は元の定義を照合し、縦下や編集済みの経路へ流用しない',()=>{
  const a=sequenceFromPreset('switched-center-vertical-up'),b=sequenceFromPreset('switched-cross-side-vertical-up');
  b.name='別名';expect(spatialLaneTransition(a,b)).toBeDefined();
  for(const change of [
    (s:SyncSequence)=>{s.sets[0].motion.columnMotion!.release.x+=.01;},
    (s:SyncSequence)=>{s.sets[0].motion.hands=[{releaseGrip:'overhand'},undefined];},
    (s:SyncSequence)=>{s.beatDuration+=.01;},
    (s:SyncSequence)=>{s.sets[0].repeat=2;},
  ]){const changed=structuredClone(b);change(changed);expect(spatialLaneTransition(a,changed)).toBeUndefined();}
  expect(spatialLaneTransition(a,sequenceFromPreset('switched-cross-side-vertical-down'))).toBeUndefined();
  expect(spatialLaneTransition(sequenceFromPreset('switched-center-vertical-down'),sequenceFromPreset('switched-cross-side-vertical-down'))).toBeUndefined();
});
it('横送りShuffleへの移行は空の手を分け、移行中の下手投げと元のクロー投げを使い分ける',()=>{
  const a=sequenceFromPreset('lateral-inverted'),b=sequenceFromPreset('lateral-shuffle'),before=structuredClone([a,b]);
  const joined=lateralShuffleTransition(a,b)!;
  expect(analyzeSequence(joined)).toMatchObject({ok:true,balls:3,movementSets:28,identitySets:28});
  expect(joined.sets.slice(0,4)).toEqual([...a.sets,...a.sets]);
  expect(joined.sets.slice(14,18)).toEqual([...b.sets,...b.sets]);
  expect(lateralShuffleTransition(b,a)).toEqual(joined);
  const tracks=build(compileSequence(joined).config),originals=[a,b].map(s=>build(compileSequence(s).config));
  expect(inspectSyncBox(tracks,transform).geometryOK).toBe(true);
  for(const f of tracks.flights){
    const row=Math.floor(f.release/(2*joined.beatDuration)+1e-9),source=row<4?0:row>=14&&row<18?1:-1;
    if(source>=0){
      const original=originals[source].flights.find(g=>g.throwHand===f.throwHand&&g.value===f.value)!;
      expect(f.start.distanceTo(original.start)).toBeLessThan(1e-12);expect(f.end.distanceTo(original.end)).toBeLessThan(1e-12);
      expect(f.velocity.distanceTo(original.velocity)).toBeLessThan(1e-10);expect(f.releaseGrip).toBe(original.releaseGrip);
    }
    if(f.value===2)expect(f.releaseGrip).toBe(source===1?'overhand':'underhand');
  }
  joined.sets[4].motion.short![0]='normal';joined.sets[0].motion.columnMotion!.release.x+=.1;
  expect([a,b]).toEqual(before);
});
it('横送りShuffleへの移行は異なる位置・手向き・テンポや周期へ流用しない',()=>{
  const a=sequenceFromPreset('lateral-inverted'),b=sequenceFromPreset('lateral-shuffle');
  a.name='別名';expect(lateralShuffleTransition(a,b)).toBeDefined();
  for(const change of [
    (s:SyncSequence)=>{s.sets[0].motion.shortMotions![0].definition!.catch.y+=.01;},
    (s:SyncSequence)=>{s.sets[0].motion.hands=[{releaseGrip:'underhand'},undefined];},
    (s:SyncSequence)=>{s.beatDuration+=.01;},
    (s:SyncSequence)=>{s.sets[0].repeat=2;},
  ]){const changed=structuredClone(b);change(changed);expect(lateralShuffleTransition(a,changed)).toBeUndefined();}
  expect(lateralShuffleTransition(sequenceFromPreset('inverted'),b)).toBeUndefined();
  expect(lateralShuffleTransition(a,sequenceFromPreset('shuffle'))).toBeUndefined();
});
it('腕下捕球の移行は元の周期を保ち、明示した捕球位置も元の実座標と一致する',()=>{
  const a=sequenceFromPreset('box'),b=sequenceFromPreset('short-under-catch'),before=structuredClone([a,b]);
  a.name='入口';b.name='出口';const joined=underarmCatchTransition(a,b)!;
  expect(analyzeSequence(joined)).toMatchObject({ok:true,balls:3,movementSets:32,identitySets:32});
  expect(joined.sets.slice(0,4)).toEqual([...a.sets,...a.sets]);
  expect(joined.sets.slice(16,20)).toEqual([...b.sets,...b.sets]);
  expect(underarmCatchTransition(b,a)).toEqual(joined);
  const original=build(compileSequence(b).config),tracks=build(compileSequence(joined).config);
  const catches=tracks.flights.filter(f=>f.motion.catch.relation==='underarm');
  expect(tracks.underarmEvents.length).toBe(4);expect(catches.length).toBeGreaterThan(4);
  for(const f of catches){
    const accepted=original.flights.find(g=>g.value===2&&g.throwHand===f.throwHand)!;
    expect(f.start.distanceTo(accepted.start)).toBeLessThan(1e-12);
    expect(f.end.distanceTo(accepted.end)).toBeLessThan(1e-12);
    expect(f.releaseGrip).toBe(accepted.releaseGrip);expect(f.catchGrip).toBe(accepted.catchGrip);
  }
  joined.sets[4].motion.short![0]='inverted';joined.sets[0].motion.short![0]='reverse';
  expect(a.sets).toEqual(before[0].sets);expect(b.sets).toEqual(before[1].sets);
});
it('腕下捕球の移行は編集済みの定義や別の腕下動作へ無条件に適用しない',()=>{
  const a=sequenceFromPreset('box'),b=sequenceFromPreset('short-under-catch');
  for(const change of [
    (s:SyncSequence)=>{s.sets[0].motion.shortMotions![0].catchRelation='free';},
    (s:SyncSequence)=>{s.sets[0].motion.hands=[{releaseGrip:'overhand'},undefined];},
    (s:SyncSequence)=>{s.beatDuration+=.01;},
    (s:SyncSequence)=>{s.sets[0].repeat=2;},
  ]){const changed=structuredClone(b);change(changed);expect(underarmCatchTransition(a,changed)).toBeUndefined();}
  expect(underarmCatchTransition(a,sequenceFromPreset('short-under-release'))).toBeUndefined();
  expect(underarmCatchTransition(sequenceFromPreset('switched'),b)).toBeUndefined();
});
it('縦下投げのレーン移行は元の周期と鉛直落下を保ち、手の運びを段階的に移す',()=>{
  const a=sequenceFromPreset('cross-side-vertical-down'),b=sequenceFromPreset('outside-vertical-down'),before=structuredClone([a,b]);
  a.name='入口';b.name='出口';const joined=spatialLaneTransition(a,b)!;
  expect(analyzeSequence(joined)).toMatchObject({ok:true,balls:3,movementSets:28,identitySets:28});
  expect(joined.sets.slice(0,4)).toEqual([...a.sets,...a.sets]);
  expect(joined.sets.slice(14,18)).toEqual([...b.sets,...b.sets]);
  expect(spatialLaneTransition(b,a)).toEqual(joined);
  expect(a.sets).toEqual(before[0].sets);expect(b.sets).toEqual(before[1].sets);
  const tracks=build(compileSequence(joined).config);
  for(const f of tracks.flights){
    expect(f.start.x).toBeCloseTo(f.end.x,12);expect(f.start.z).toBeCloseTo(f.end.z,12);
    if(f.value===2){expect(f.style).toBe('vertical-down');expect(f.velocity.length()).toBeLessThan(1e-12);expect(f.releaseGrip).toBe('overhand');}
  }
  joined.sets[4].motion.short![0]='normal';expect(a.sets).toEqual(before[0].sets);
});
it('レーン移行は名前で判定せず、編集済みの位置・手向き・テンポへ無条件に適用しない',()=>{
  const a=sequenceFromPreset('cross-side-vertical-down'),b=sequenceFromPreset('outside-vertical-down');
  for(const change of [
    (s:SyncSequence)=>{s.sets[0].motion.shortMotions![0].definition!.catch.x+=.01;},
    (s:SyncSequence)=>{s.sets[0].motion.hands=[{releaseGrip:'overhand'},undefined];},
    (s:SyncSequence)=>{s.beatDuration+=.01;},
    (s:SyncSequence)=>{s.sets[0].repeat=2;},
  ]){const changed=structuredClone(b);change(changed);expect(spatialLaneTransition(a,changed)).toBeUndefined();}
  expect(spatialLaneTransition(sequenceFromPreset('vertical-up'),b)).toBeUndefined();
});
it('外側縦下投げのSwitched移行は、鉛直落下と保持2での担当交替を保つ',()=>{
  const a=sequenceFromPreset('outside-vertical-down'),b=sequenceFromPreset('switched-outside-vertical-down'),before=structuredClone([a,b]);
  const joined=columnReceiverHandoff(a,b)!;
  expect(analyzeSequence(joined)).toMatchObject({ok:true,balls:3,movementSets:12,identitySets:12});
  expect(joined.sets.slice(0,4)).toEqual([...a.sets,...a.sets]);
  expect(joined.sets.slice(6,10)).toEqual([b.sets[1],b.sets[0],b.sets[1],b.sets[0]]);
  expect(joined.sets.filter(s=>s.throws.includes('2'))).toHaveLength(2);
  for(const f of build(compileSequence(joined).config).flights.filter(f=>f.value===2)){
    expect(f.style).toBe('vertical-down');expect(f.velocity.length()).toBeLessThan(1e-12);
    expect(f.releaseGrip).toBe('overhand');
  }
  expect(columnReceiverHandoff(b,a)).toEqual(joined);expect([a,b]).toEqual(before);
  const changed=structuredClone(b);changed.sets[0].motion.shortMotions![0].definition!.release.y+=.01;
  expect(columnReceiverHandoff(a,changed)).toBeUndefined();
  expect(columnReceiverHandoff(sequenceFromPreset('cross-side-vertical-down'),sequenceFromPreset('switched-cross-side-vertical-down'))).toBeUndefined();
});
it('コラムの担当交替は元の2周期を保ち、4xと保持2で往復する',()=>{
  const a=sequenceFromPreset('box'),b=sequenceFromPreset('underarm'),before=structuredClone([a,b]);
  a.name='任意の名前A';b.name='任意の名前B';
  const joined=columnReceiverHandoff(a,b)!;
  expect(analyzeSequence(joined)).toMatchObject({ok:true,movementSets:12,identitySets:12,balls:3});
  expect(joined.sets.slice(0,4)).toEqual([...a.sets,...a.sets]);
  expect(joined.sets.slice(6,10)).toEqual([b.sets[1],b.sets[0],b.sets[1],b.sets[0]]);
  expect(joined.sets.slice(4,6).map(s=>s.throws)).toEqual([['4x','2x'],['2','4x']]);
  expect(joined.sets.slice(10).map(s=>s.throws)).toEqual([['2x','4x'],['4x','2']]);
  expect(columnReceiverHandoff(b,a)).toEqual(joined);
  expect(a.sets).toEqual(before[0].sets);expect(b.sets).toEqual(before[1].sets);
});
it('コラム担当交替の候補は名前だけで適用せず、未対応の位置・手向き・時間を区別する',()=>{
  const a=sequenceFromPreset('box'),b=sequenceFromPreset('underarm');
  for(const change of [
    (s:SyncSequence)=>{s.sets[0].motion.columnMotion!.release.x+=.01;},
    (s:SyncSequence)=>{s.sets[0].motion.hands=[{releaseGrip:'overhand'},undefined];},
    (s:SyncSequence)=>{s.beatDuration+=.01;},
  ]){
    const changed=structuredClone(b);change(changed);expect(columnReceiverHandoff(a,changed)).toBeUndefined();
  }
  for(const id of ['underarm','switched','crossed','crossed-right'])expect(columnReceiverHandoff(a,sequenceFromPreset(id))).toBeDefined();
  expect(columnReceiverHandoff(a,sequenceFromPreset('crossed-alternate'))).toBeUndefined();
});
it('上下交代への移行は元の周期と開始側を保ち、未対応の編集に流用しない',()=>{
  const a=sequenceFromPreset('switched'),b=sequenceFromPreset('crossed-alternate'),before=structuredClone([a,b]);
  const joined=alternatingCrossTransition(a,b)!;
  expect(analyzeSequence(joined)).toMatchObject({ok:true,balls:3,movementSets:28,identitySets:28});
  expect(joined.sets.slice(0,4)).toEqual([...a.sets,...a.sets]);
  expect(joined.sets.slice(14,18)).toEqual([...b.sets,...b.sets]);
  expect(alternatingCrossTransition(b,a)).toEqual(joined);expect([a,b]).toEqual(before);
  const changed=structuredClone(b);changed.sets[0].motion.armPhase=1;
  expect(alternatingCrossTransition(a,changed)).toBeUndefined();
  expect(alternatingCrossTransition(sequenceFromPreset('box'),b)).toBeUndefined();
});
it('Switchedの担当交替でも上から投げる手向きを保持し、空の手を球から離す',()=>{
  const box=sequenceFromPreset('box');
  for(const style of ['shuffle','inverted']){
    const source=sequenceFromPreset(`switched-${style}`),before=structuredClone(source),joined=columnReceiverHandoff(box,source)!;
    const returning=joined.sets[10].motion.hands![0]!;
    expect(returning.style).toBe(style);expect(source).toEqual(before);
    if(style==='inverted')expect(returning.definition!.emptyReturn).toEqual({route:'front',amount:.14});
    const tracks=build(compileSequence(joined).config),flight=tracks.flights.find(f=>f.value===2&&f.throwHand===0&&f.release>10*box.beatDuration*2)!;
    expect(flight.releaseGrip).toBe(style==='shuffle'?'overhand':'underhand');
  }
});
it.each(['normal','inverted'] as const)('上下交代の混合2x (%s) は開始側を保持し、編集した定義を誤認しない',left=>{
  const a=sequenceFromPreset('crossed-alternate'),b=sequenceFromBasicParts({columns:'crossed-alternate',roles:'alternate',shortHand:1,left,right:left==='normal'?'inverted':'normal'});
  const before=structuredClone([a,b]),joined=mixedAlternatingCrossTransition(a,b)!;
  expect(analyzeSequence(joined)).toMatchObject({ok:true,movementSets:28,identitySets:28});
  const order=left==='normal'?[1,0]:[0,1];
  for(let i=0;i<4;i++){
    expect(joined.sets[i].throws).toEqual(a.sets[order[i%2]].throws);
    expect(joined.sets[14+i].throws).toEqual(b.sets[order[i%2]].throws);
    if(left==='normal')expect(joined.sets[14+i].motion.armPhase).toBe(order[i%2]);
  }
  expect(mixedAlternatingCrossTransition(b,a)).toEqual(joined);expect([a,b]).toEqual(before);
  for(const change of [
    (s:SyncSequence)=>{s.sets[0].motion.shortMotions![0].definition!.release.z-=.01;},
    (s:SyncSequence)=>{s.sets[0].motion.hands=[{catchGrip:'overhand'},undefined];},
    (s:SyncSequence)=>{s.beatDuration+=.01;},
  ]){const changed=structuredClone(b);change(changed);expect(mixedAlternatingCrossTransition(a,changed)).toBeUndefined();}
});
it('両手Invertedの上下交代への移行は、入口と出る準備のクロス指定を保持する',()=>{
  const a=sequenceFromPreset('switched'),b=sequenceFromBasicParts({columns:'crossed-alternate',roles:'alternate',shortHand:1,left:'inverted',right:'inverted'}),before=structuredClone([a,b]);
  const joined=alternatingCrossTransition(a,b)!;
  expect(analyzeSequence(joined)).toMatchObject({ok:true,movementSets:28,identitySets:28});
  expect(joined.sets.slice(12,18)).toEqual([...b.sets,...b.sets,...b.sets]);
  expect(joined.sets.slice(18,22).every(r=>r.motion.armOrder==='alternate')).toBe(true);
  expect(alternatingCrossTransition(b,a)).toEqual(joined);expect([a,b]).toEqual(before);
  const changed=structuredClone(b);changed.sets[0].motion.armPhase=1;
  expect(alternatingCrossTransition(a,changed)).toBeUndefined();
});
it('1セットの取り込みは腕下の投げと捕りを区別し、元の見本を変更しない',()=>{
  for(const index of [36,38]){
    const source=SEQUENCE_EXAMPLES[index],before=structuredClone(source),row=extractSequenceSet(source,1);
    expect(row.throws).toEqual(source.sets[1].throws);expect(row.motion).toEqual(source.sets[1].motion);expect(row.repeat).toBe(1);
    expect(row.sourceName).toContain('見本のセット2');
    row.motion.hands![1]!.definition!.catch.x=.3;
    expect(source).toEqual(before);
  }
});
it('1セットの取り込みは回数と左右交代を展開し、選んだ1回だけを返す',()=>{
  const s=structuredClone(SEQUENCE_EXAMPLES[2]);s.sets[0].repeat=2;
  const rows=expandSequence(s);expect(rows).toHaveLength(8);
  for(let i=0;i<rows.length;i++){
    const row=extractSequenceSet(s,i);expect(row.repeat).toBe(1);expect(row.throws).toEqual(rows[i].throws);expect(row.motion).toEqual(rows[i].motion);
  }
  for(const i of [-1,.5,8])expect(()=>extractSequenceSet(s,i)).toThrow('見本内のセット');
});
it('既存37見本を1セットずつ取り込んでも、球と手の全周期を保つ',()=>{
  for(const preset of SYNC_BOX_PRESETS){
    const s=sequenceFromPreset(preset.id),before=build(compileSequence(s).config);
    const after=build(compileSequence({...s,mirrorRepeat:false,sets:expandSequence(s).map((_,i)=>extractSequenceSet(s,i))}).config);
    expect(after.period,preset.id).toBeCloseTo(before.period,10);
    for(let h=0;h<2;h++)after.hands[h].positions.forEach((p,i)=>expect(p.distanceTo(before.hands[h].positions[i]),preset.id).toBeLessThan(1e-9));
    after.props.forEach((track,b)=>track.forEach((p,i)=>expect(p.distanceTo(before.props[b][i]),preset.id).toBeLessThan(1e-9)));
  }
});
it('上下交代クロスの2番目を先頭に取り込んでも、元の投球・捕球位置を保つ',()=>{
  const s=sequenceFromPreset('crossed-alternate'),before=build(compileSequence(s).config);
  const swapped={...s,sets:[extractSequenceSet(s,1),extractSequenceSet(s,0)]};
  expect(swapped.sets.map(r=>r.motion.armPhase)).toEqual([1,0]);
  const after=build(compileSequence(swapped).config);
  for(const f of after.flights){
    const original=before.flights.find(g=>g.throwHand===f.throwHand&&g.value===f.value)!;
    expect(f.start.distanceTo(original.start)).toBeLessThan(1e-9);expect(f.end.distanceTo(original.end)).toBeLessThan(1e-9);
    expect(f.duration).toBeCloseTo(original.duration,9);
  }
  expect(inspectSyncBox(after,transform).geometryOK).toBe(true);
  expect(analyzeSequence(JSON.parse(JSON.stringify(swapped))).canonical).toBe(analyzeSequence(swapped).canonical);
  const changed=structuredClone(swapped);changed.sets[0].motion.armPhase=0;
  expect(analyzeSequence(changed).canonical).not.toBe(analyzeSequence(swapped).canonical);
});
it('クロスの開始局面は上下交代の0または1だけを受け付ける',()=>{
  const s=sequenceFromPreset('crossed-alternate');s.sets[0].motion.armPhase=2 as 0;
  expect(analyzeSequence(s).documentOK).toBe(false);
  s.sets[0].motion.armPhase=0;s.sets[0].motion.armOrder='left-over';
  expect(analyzeSequence(s).documentOK).toBe(false);
});
it.each(extraColumns.flatMap(columns=>basicStyles.flatMap(left=>basicStyles.map(right=>({columns,left,right})))))('コラム部品 $columns / 左$left・右$right の指定が保存される',parts=>{
  const s=sequenceFromBasicParts({...parts,roles:'alternate',shortHand:1});
  expect(analyzeSequence(s)).toMatchObject({ok:true,balls:3,movementSets:2,identitySets:2});
  const t=build(compileSequence(s).config);
  for(const f of t.flights.filter(f=>f.value===2))expect(f.style).toBe(f.throwHand===0?parts.left:parts.right);
  expect(analyzeSequence(JSON.parse(JSON.stringify(s))).canonical).toBe(analyzeSequence(s).canonical);
});
it.each([
  ['switched','normal','switched'],['switched','shuffle','switched-shuffle'],['switched','reverse','switched-reverse'],['switched','inverted','switched-inverted'],
  ['crossed','normal','crossed'],['crossed-right','normal','crossed-right'],['crossed-alternate','normal','crossed-alternate'],['underarm','normal','underarm']
] as [BasicColumnStyle,BasicShortStyle,string][])('コラム %s と %s は見本 %s を初期位置として相対通過を指定する',(columns,style,id)=>{
  const s=sequenceFromBasicParts({columns,left:style,right:style,roles:'alternate',shortHand:1}),p=sequenceFromPreset(id);
  for(const r of s.sets)for(const o of r.motion.shortMotions!){expect(o.ballOrder).toBe('style');delete o.ballOrder;}
  expect(analyzeSequence(s).canonical).toBe(analyzeSequence(p).canonical);
});
it('コラム部品の2xを変えると旧プロファイルの高さを残さず、固定4xにはコラム指定を混ぜない',()=>{
  for(const columns of ['crossed','underarm'] as BasicColumnStyle[]){
    const s=sequenceFromBasicParts({columns,left:'shuffle',right:'reverse',roles:'alternate',shortHand:1});
    const t=build(compileSequence(s).config);
    for(const f of t.flights.filter(f=>f.value===2))expect(Math.sign(f.end.y-f.start.y)).toBe(f.throwHand===0?-1:1);
  }
  expect(()=>sequenceFromBasicParts({columns:'crossed',left:'normal',right:'normal',roles:'fixed',shortHand:1})).toThrow('基本部品');
});
it.each(basicStyles.flatMap(left=>basicStyles.map(right=>({left,right}))))('Switched 左$left・右$right は手前・奥の球との上下関係を解く',({left,right})=>{
  const s=sequenceFromBasicParts({columns:'switched',left,right,roles:'alternate',shortHand:1}),t=build(compileSequence(s).config);
  expect(inspectSyncBox(t,transform).ballOrderClearance).toBeGreaterThan(.014);
  for(const f of t.flights.filter(f=>f.value===2)){
    const style=f.throwHand===0?left:right;
    expect(f.ballOrder?.length).toBe(2);
    expect(f.ballOrder!.map(c=>c.above)).toEqual([['shuffle','inverted'].includes(style),['reverse','inverted'].includes(style)]);
  }
});
it.each(basicStyles.flatMap(left=>basicStyles.map(right=>({left,right}))).filter(p=>p.left!=='normal'||p.right!=='normal'))('腕下 左$left・右$right は元のコラム位置を保ち、捕球を腕下の制約に含める',({left,right})=>{
  const base=build(compileSequence(sequenceFromPreset('underarm')).config);
  const s=sequenceFromBasicParts({columns:'underarm',left,right,roles:'alternate',shortHand:1}),t=build(compileSequence(s).config);
  expect(inspectSyncBox(t,transform).ownershipConflicts).toBe(0);
  const columns=t.flights.filter(f=>f.value===4),before=base.flights.filter(f=>f.value===4);
  expect(t.underarmEvents).toHaveLength(columns.length);
  columns.forEach((f,i)=>{
    expect(f.start.distanceTo(before[i].start)).toBeLessThan(1e-9);
    expect(f.end.distanceTo(before[i].end)).toBeLessThan(1e-9);
    expect(f.motion.catch.relation).toBe('underarm');
    expect(t.underarmEvents.some(e=>e.hand===f.catchHand&&e.position.distanceTo(f.end)<1e-9)).toBe(true);
  });
  if(left==='shuffle'||right==='shuffle'){
    const previous=structuredClone(s);
    previous.sets.forEach(row=>{if(row.motion.short![0]==='shuffle')delete row.motion.columnMotion!.emptyReturn!.via;});
    const original=build(compileSequence(previous).config);
    expect(t.flights).toHaveLength(original.flights.length);
    t.flights.forEach((f,i)=>{
      const before=original.flights[i];
      expect(f.start.distanceTo(before.start)).toBeLessThan(1e-12);expect(f.end.distanceTo(before.end)).toBeLessThan(1e-12);
      expect(f.velocity.distanceTo(before.velocity)).toBeLessThan(1e-12);expect(f.duration).toBe(before.duration);
      expect(f.releaseGrip).toBe(before.releaseGrip);expect(f.catchGrip).toBe(before.catchGrip);
    });
    t.props.forEach((track,i)=>track.forEach((p,k)=>expect(p.distanceTo(original.props[i][k])).toBeLessThan(1e-12)));
    expect(t.hands.some((h,i)=>h.positions.some((p,k)=>p.distanceTo(original.hands[i].positions[k])>.001))).toBe(true);
  }
});
it.each((['crossed','crossed-right'] as const).flatMap(columns=>[false,true].map(mirror=>({columns,mirror}))))('固定クロスの高い捕球でも空の手と保持中の手首をクロス側に保つ: %j',({columns,mirror})=>{
  const left=columns==='crossed'?'normal':'reverse',right=columns==='crossed'?'reverse':'normal';
  const s=sequenceFromBasicParts({columns,left,right,roles:'alternate',shortHand:1});
  // This regression isolates the authored wrist route. Relative-ball planning
  // and the final rig are tested separately in sync-motion-planning.test.ts.
  s.sets.forEach(r=>r.motion.shortMotions?.forEach(o=>delete o.ballOrder));
  const t=build({...compileSequence(s).config!,mirror});
  const outside=structuredClone(s);
  for(const row of outside.sets)if(row.motion.short![0]==='reverse')row.motion.shortMotions![0].carry='outside';
  const previous=build({...compileSequence(outside).config!,mirror});
  expect(inspectSyncBox(t,transform).geometryOK).toBe(true);
  t.flights.forEach((f,i)=>{
    const before=previous.flights[i];
    expect(f.start.distanceTo(before.start)).toBeLessThan(1e-12);expect(f.end.distanceTo(before.end)).toBeLessThan(1e-12);
    expect(f.velocity.distanceTo(before.velocity)).toBeLessThan(1e-12);expect(f.duration).toBe(before.duration);
    expect(f.releaseGrip).toBe(before.releaseGrip);expect(f.catchGrip).toBe(before.catchGrip);
  });
  const crossedWrist=(tracks:typeof t,h:number,k:number)=>{
    const hand=tracks.hands[h],wrist=hand.positions[k].clone().addScaledVector(hand.palmNormals[k],-(SYNC_RADIUS+transform.gripOffset.normal))
      .addScaledVector(hand.fingerDirs![k],-transform.gripOffset.finger);
    return wrist.x*(h===0?-1:1)<0;
  };
  t.hands.forEach((hand,h)=>hand.positions.forEach((_,k)=>expect(crossedWrist(t,h,k)).toBe(true)));
  expect(previous.hands.some((hand,h)=>hand.positions.some((_,k)=>!crossedWrist(previous,h,k)))).toBe(true);
});
it('3球コラムは外側の同時投げと中央の1球を交代し、空の手に球を追加しない',()=>{
  const s=SEQUENCE_EXAMPLES[30],c=compileSequence(s),t=build(c.config);
  expect(c.analysis).toMatchObject({ok:true,balls:3,movementSets:2,identitySets:2,notation:'(4,4)(4,0)'});
  const lanes=new Set(t.flights.map(f=>Number(f.start.x.toFixed(6))));expect(lanes.size).toBe(3);
  for(const f of t.flights){
    expect(f.value).toBe(4);expect(f.throwHand).toBe(f.catchHand);
    expect(f.end.x).toBeCloseTo(f.start.x,9);expect(f.end.z).toBeCloseTo(f.start.z,9);
  }
  expect(t.flights.filter(f=>Math.abs(f.start.x)<1e-9).every(f=>f.throwHand===0)).toBe(true);
  const outer=t.flights.filter(f=>Math.abs(f.start.x)>1e-9);
  expect(outer.length).toBe(2);expect(outer[0].release).toBeCloseTo(outer[1].release,9);
  expect(t.flights).toHaveLength(3);
  for(const ball of t.props)for(const p of ball)expect(p.x).toBeCloseTo(ball[0].x,9);
  expect(inspectSyncBox(t,transform).geometryOK).toBe(true);
});
it.each([['normal','inverted'],['inverted','normal'],['inverted','inverted']] as [BasicShortStyle,BasicShortStyle][])('上下交代クロスの %s / %s は2xの高さと反対側のコラムを保つ',(left,right)=>{
  const s=sequenceFromBasicParts({columns:'crossed-alternate',left,right,roles:'alternate',shortHand:1}),t=build(compileSequence(s).config);
  const before=build(compileSequence(sequenceFromPreset('crossed-alternate')).config);
  expect(inspectSyncBox(t,transform).geometryOK).toBe(true);
  expect(s.sets.every(r=>r.motion.armOrder==='alternate')).toBe(true);
  for(const f of t.flights){
    const original=before.flights.find(g=>g.value===f.value&&g.throwHand===f.throwHand)!;
    expect(f.start.x).toBeCloseTo(original.start.x,9);expect(f.end.x).toBeCloseTo(original.end.x,9);
    expect(f.start.y).toBeCloseTo(f.end.y,9);
    if(f.value===2){
      const high=(f.throwHand===0?left:right)==='inverted';
      if(high)expect(f.start.y-original.start.y).toBeGreaterThan(.15);
      else expect(f.start.y).toBeCloseTo(original.start.y,9);
    }
  }
});
it('上下交代クロスで高い2xを右から左へ切り替え、両方の部品を保って4セットで閉じる',()=>{
  const s=SEQUENCE_EXAMPLES[34],a=analyzeSequence(s);
  expect(a).toMatchObject({ok:true,balls:3,movementSets:4,identitySets:4});
  const strip=(rows:SyncSequence['sets'])=>rows.map(({sourceName,...row})=>row);
  for(const [offset,left,right] of [[0,'normal','inverted'],[2,'inverted','normal']] as [number,BasicShortStyle,BasicShortStyle][]){
    const part=sequenceFromBasicParts({columns:'crossed-alternate',left,right,roles:'alternate',shortHand:1});
    expect(strip(s.sets.slice(offset,offset+2))).toEqual(strip(part.sets));
  }
  expect(inspectSyncBox(build(compileSequence(s).config),transform).geometryOK).toBe(true);
});
it('4球コラムは内側の2球と外側の2球を交代し、各球の縦線を保つ',()=>{
  const s=SEQUENCE_EXAMPLES[31],c=compileSequence(s),t=build(c.config);
  expect(c.analysis).toMatchObject({ok:true,balls:4,movementSets:2,identitySets:2});
  expect(new Set(t.flights.map(f=>Number(f.start.x.toFixed(6)))).size).toBe(4);
  for(const f of t.flights){
    expect(f.value).toBe(4);expect(f.throwHand).toBe(f.catchHand);
    expect(f.end.x).toBeCloseTo(f.start.x,9);expect(f.end.z).toBeCloseTo(f.start.z,9);
    const pair=t.flights.find(g=>g!==f&&Math.abs(g.release-f.release)<1e-9)!;
    expect(pair).toBeDefined();expect(pair.start.x).toBeCloseTo(-f.start.x,9);
  }
  for(const ball of t.props)for(const p of ball)expect(p.x).toBeCloseTo(ball[0].x,9);
  expect(inspectSyncBox(t,transform).geometryOK).toBe(true);
});
it('HF基本Double Boxは同じ高投げ手で4x・4を続け、左右交代する4セット',()=>{
  const s=sequenceFromPreset('double-box'),c=compileSequence(s),t=build(c.config);
  expect(c.analysis).toMatchObject({ok:true,balls:3,movementSets:4,identitySets:4,notation:'(4x,2x)(4,2x)(2x,4x)(2x,4)'});
  const high=t.flights.filter(f=>f.value===4).sort((a,b)=>a.release-b.release);
  expect(high.map(f=>[f.throwHand,f.catchHand])).toEqual([[0,1],[0,0],[1,0],[1,1]]);
  for(const f of high){
    if(f.throwHand===f.catchHand)expect(f.end.x).toBeCloseTo(f.start.x,9);
    else {expect(f.start.x*f.end.x).toBeLessThan(0);expect(Math.abs(f.end.x-f.start.x)).toBeGreaterThan(.30);}
    const p=t.flights.find(p=>p.value===2&&Math.abs(p.release-f.release)<1e-9)!;
    expect(p.throwHand).toBe(1-f.throwHand);expect(p.catchHand).toBe(f.throwHand);
    expect(p.start.y).toBeCloseTo(p.end.y,9);expect(p.releaseGrip).toBe('underhand');expect(p.catchGrip).toBe('underhand');
  }
  const extended=build(compileSequence(SEQUENCE_EXAMPLES[4]).config);
  for(const f of extended.flights.filter(f=>f.value===4&&f.throwHand!==f.catchHand)){
    expect(f.start.x).toBeCloseTo(0,9);expect(f.end.x).toBeCloseTo(0,9);
  }
});
it('BoxとHF基本Doubleを元の軌道定義のまま6セットで往復する',()=>{
  const s=SEQUENCE_EXAMPLES[49],from=SEQUENCE_EXAMPLES[0],to=sequenceFromPreset('double-box');
  const strip=(rows:SyncSequence['sets'])=>rows.map(({sourceName,...r})=>r);
  expect(analyzeSequence(s)).toMatchObject({ok:true,balls:3,movementSets:6,identitySets:6});
  expect(strip(s.sets.slice(0,2))).toEqual(strip(from.sets));expect(strip(s.sets.slice(2))).toEqual(strip(to.sets));
  expect(s.beatDuration).toBe(from.beatDuration);
  expect(inspectSyncBox(build(compileSequence(s).config),transform)).toMatchObject({geometryOK:true,ownershipConflicts:0});
});
it('HF Box＋InvertedのDoubleは4xに低い2x、自己4に高い2xを組み合わせる',()=>{
  const s=SEQUENCE_EXAMPLES[50],c=compileSequence(s),t=build(c.config);
  expect(c.analysis).toMatchObject({ok:true,balls:3,movementSets:4,identitySets:4,notation:'(4x,2x)(4,2x)(2x,4x)(2x,4)'});
  const highs=t.flights.filter(f=>f.value===4).sort((a,b)=>a.release-b.release);
  expect(highs.map(f=>[f.throwHand,f.catchHand])).toEqual([[0,1],[0,0],[1,0],[1,1]]);
  const passes=highs.map(f=>t.flights.find(p=>p.value===2&&Math.abs(p.release-f.release)<1e-9)!);
  expect(passes.map(f=>[f.throwHand,f.catchHand])).toEqual([[1,0],[1,0],[0,1],[0,1]]);
  for(let i=0;i<passes.length;i++){
    const p=passes[i];expect(p.start.y).toBeCloseTo(p.end.y,9);
    expect(p.releaseGrip).toBe('underhand');expect(p.catchGrip).toBe('underhand');
    if(i%2)expect(p.start.y-passes[i-1].start.y).toBeGreaterThan(.2);
  }
  expect(inspectSyncBox(t,transform)).toMatchObject({geometryOK:true,ownershipConflicts:0});
});
it('Boxと高低2xのDoubleを元の4セット定義のまま往復する',()=>{
  const s=SEQUENCE_EXAMPLES[51],from=SEQUENCE_EXAMPLES[0],to=SEQUENCE_EXAMPLES[50];
  const strip=(rows:SyncSequence['sets'])=>rows.map(({sourceName,...r})=>r);
  expect(analyzeSequence(s)).toMatchObject({ok:true,balls:3,movementSets:6,identitySets:6});
  expect(strip(s.sets.slice(0,2))).toEqual(strip(from.sets));expect(strip(s.sets.slice(2))).toEqual(strip(to.sets));
  expect(inspectSyncBox(build(compileSequence(s).config),transform)).toMatchObject({geometryOK:true,ownershipConflicts:0});
});
it.each([[52,'shuffle','normal'],[53,'normal','shuffle']] as const)('HF Double %i はShuffleを実演どおりの4x・4の局面に置く',(index,crossSet,selfSet)=>{
  const s=SEQUENCE_EXAMPLES[index],t=build(compileSequence(s).config);
  expect(analyzeSequence(s)).toMatchObject({ok:true,balls:3,movementSets:4,identitySets:4});
  const parts={crossSet,selfSet,crossReleaseGrip:crossSet==='shuffle'?'underhand' as const:undefined,selfReleaseGrip:selfSet==='shuffle'?'underhand' as const:undefined};
  expect(analyzeSequence(s).canonical).toBe(analyzeSequence(sequenceFromDoubleParts(parts)).canonical);
  for(const f of t.flights.filter(f=>f.value===2)){
    const high=t.flights.find(g=>g.value===4&&Math.abs(g.release-f.release)<1e-9)!;
    const isShuffle=(high.throwHand!==high.catchHand?crossSet:selfSet)==='shuffle';
    if(isShuffle)expect(f.start.y-f.end.y).toBeGreaterThan(.1);
    else expect(f.start.y).toBeCloseTo(f.end.y,9);
    expect(f.releaseGrip).toBe('underhand');expect(f.catchGrip).toBe('underhand');
  }
  expect(analyzeSequence(SEQUENCE_EXAMPLES[52]).canonical).not.toBe(analyzeSequence(SEQUENCE_EXAMPLES[53]).canonical);
});
it('2種類のShuffle Doubleを4セットずつ保って8セットで往復する',()=>{
  const s=SEQUENCE_EXAMPLES[54],strip=(rows:SyncSequence['sets'])=>rows.map(({sourceName,...r})=>r);
  expect(analyzeSequence(s)).toMatchObject({ok:true,balls:3,movementSets:8,identitySets:8});
  expect(strip(s.sets.slice(0,4))).toEqual(strip(SEQUENCE_EXAMPLES[52].sets));
  expect(strip(s.sets.slice(4))).toEqual(strip(SEQUENCE_EXAMPLES[53].sets));
  expect(inspectSyncBox(build(compileSequence(s).config),transform)).toMatchObject({geometryOK:true,ownershipConflicts:0});
});
it.each([[55,'normal'],[56,'reverse']] as const)('HF Double %i は上へ渡す2xを指定された4x・4の局面に置く',(index,crossSet)=>{
  const s=SEQUENCE_EXAMPLES[index],t=build(compileSequence(s).config);
  expect(analyzeSequence(s)).toMatchObject({ok:true,balls:3,movementSets:4,identitySets:4});
  expect(analyzeSequence(s).canonical).toBe(analyzeSequence(sequenceFromDoubleParts({crossSet,selfSet:'reverse'})).canonical);
  for(const f of t.flights.filter(f=>f.value===2)){
    const high=t.flights.find(g=>g.value===4&&Math.abs(g.release-f.release)<1e-9)!;
    const rising=high.throwHand===high.catchHand||crossSet==='reverse';
    if(rising)expect(f.end.y-f.start.y).toBeGreaterThan(.2);
    else expect(f.start.y).toBeCloseTo(f.end.y,9);
    expect(f.throwHand).toBe(1-high.throwHand);expect(f.catchHand).toBe(high.throwHand);
  }
});
it('2種類のReverse Doubleを元の捕球設定で8セット接続する',()=>{
  const s=SEQUENCE_EXAMPLES[57],strip=(rows:SyncSequence['sets'])=>rows.map(({sourceName,...r})=>r);
  expect(analyzeSequence(s)).toMatchObject({ok:true,balls:3,movementSets:8,identitySets:8});
  expect(strip(s.sets.slice(0,4))).toEqual(strip(SEQUENCE_EXAMPLES[55].sets));
  expect(strip(s.sets.slice(4))).toEqual(strip(SEQUENCE_EXAMPLES[56].sets));
  expect(inspectSyncBox(build(compileSequence(s).config),transform)).toMatchObject({geometryOK:true,ownershipConflicts:0});
});
it('HF Crossesは縦の4xと保持2を交代し、同じ球を3セット後に反対の手から投げる',()=>{
  const s=SEQUENCE_EXAMPLES[35],c=compileSequence(s),t=build(c.config);
  expect(c.analysis).toMatchObject({ok:true,balls:3,movementSets:2,identitySets:6,notation:'(4x,2)(2,4x)'});
  expect(t.flights).toHaveLength(6);expect(t.underarmEvents).toHaveLength(6);
  for(const f of t.flights){
    expect(f.value).toBe(4);expect(f.catchHand).toBe(1-f.throwHand);
    expect(f.start.x).toBeCloseTo(f.end.x,9);expect(f.start.z).toBeCloseTo(f.end.z,9);
    expect(f.motion.release.relation).toBe('underarm');
    const next=t.flights.find(g=>g.prop===f.prop&&g!==f)!;
    expect(next.throwHand).toBe(f.catchHand);
    expect((next.release-f.release+t.period)%t.period).toBeCloseTo(6*s.beatDuration,9);
  }
  const returns=t.transitions.filter(r=>r.kind==='carry'&&Math.abs(r.duration-2*s.beatDuration)<1e-9);
  expect(returns).toHaveLength(6);
  for(const r of returns)expect(r.start.x*r.via.x).toBeLessThan(0);
  expect(inspectSyncBox(t,transform).geometryOK).toBe(true);
});
it('HF Under-Arm-Boxは腕下から自分へ4を投げ、上の2xと同時に捕って2セットで戻る',()=>{
  const s=SEQUENCE_EXAMPLES[36],c=compileSequence(s),t=build(c.config);
  expect(c.analysis).toMatchObject({ok:true,balls:3,movementSets:2,identitySets:2,notation:'(4,2x)(2x,4)'});
  const columns=t.flights.filter(f=>f.value===4),passes=t.flights.filter(f=>f.value===2);
  expect(columns).toHaveLength(2);expect(passes).toHaveLength(2);expect(t.underarmEvents).toHaveLength(2);
  expect(new Set(columns.map(f=>f.prop)).size).toBe(2);expect(new Set(passes.map(f=>f.prop)).size).toBe(1);
  for(const f of columns){
    expect(f.throwHand).toBe(f.catchHand);expect(f.motion.release.relation).toBe('underarm');
    expect(f.motion.catch.relation).toBeUndefined();expect(f.motion.flightFraction).toBeUndefined();
    expect(f.motion.release.x).toBeLessThan(0);expect(f.motion.catch.x).toBeGreaterThan(0);
    const arrival=(f.release+f.duration)%t.period;
    const pass=passes.find(g=>Math.abs((g.release+g.duration)%t.period-arrival)<1e-9)!;
    expect(pass).toBeDefined();expect(pass.catchHand).toBe(1-f.catchHand);
    expect(pass.start.y).toBeGreaterThan(f.start.y);expect(pass.end.y).toBeGreaterThan(f.end.y);
    expect(t.underarmEvents.some(e=>e.hand===f.throwHand&&Math.abs(e.time-f.release)<1e-9)).toBe(true);
  }
  expect(inspectSyncBox(t,transform)).toMatchObject({geometryOK:true,ownershipConflicts:0});
});
it('HF腕下への往復は元の2種類を保ち、前後の間隔を作って12セットで閉じる',()=>{
  const s=SEQUENCE_EXAMPLES[37],a=analyzeSequence(s),strip=(rows:SyncSequence['sets'])=>rows.map(({sourceName,...r})=>r);
  expect(a).toMatchObject({ok:true,balls:3,movementSets:12,identitySets:12});
  expect(strip(s.sets.slice(0,2))).toEqual(strip(SEQUENCE_EXAMPLES[0].sets));
  expect(strip(s.sets.slice(6,8))).toEqual(strip(SEQUENCE_EXAMPLES[36].sets));
  for(const index of [2,10])s.sets.slice(index,index+2).forEach((r,i)=>r.throws.forEach((value,h)=>{
    const d=sequenceHandDefinition(r,h),before=sequenceHandDefinition(SEQUENCE_EXAMPLES[0].sets[i],h);
    for(const p of ['release','catch'] as const){
      expect(d[p].x).toBe(before[p].x);expect(d[p].y).toBe(before[p].y);
      expect(d[p].z).toBe(value==='4'?-.40:-.30);
    }
  }));
  expect(inspectSyncBox(build(compileSequence(s).config),transform).geometryOK).toBe(true);
  const direct=appendSequence(SEQUENCE_EXAMPLES[0],SEQUENCE_EXAMPLES[36]).sequence!;
  expect(inspectSyncBox(build(compileSequence(direct).config),transform).geometryOK).toBe(false);
});
it('HF Reverse-Under-Arm-Boxは上向き2xの捕球時に反対の手が自己投げ4を腕下で捕る',()=>{
  const s=SEQUENCE_EXAMPLES[38],c=compileSequence(s),t=build(c.config);
  expect(c.analysis).toMatchObject({ok:true,balls:3,movementSets:2,identitySets:2,notation:'(4,2x)(2x,4)'});
  const columns=t.flights.filter(f=>f.value===4),passes=t.flights.filter(f=>f.value===2);
  expect(columns).toHaveLength(2);expect(passes).toHaveLength(2);expect(t.underarmEvents).toHaveLength(2);
  expect(new Set(columns.map(f=>f.prop)).size).toBe(2);expect(new Set(passes.map(f=>f.prop)).size).toBe(1);
  for(const f of columns){
    expect(f.throwHand).toBe(f.catchHand);expect(f.motion.release.relation).toBeUndefined();
    expect(f.motion.catch.relation).toBe('underarm');expect(f.motion.release.x).toBeGreaterThan(0);expect(f.motion.catch.x).toBeLessThan(0);
    const arrival=(f.release+f.duration)%t.period;
    const pass=passes.find(g=>Math.abs((g.release+g.duration)%t.period-arrival)<1e-9)!;
    expect(pass).toBeDefined();expect(pass.catchHand).toBe(1-f.catchHand);
    expect(pass.end.y-pass.start.y).toBeGreaterThan(.35);expect(pass.end.y-f.end.y).toBeGreaterThan(.30);
    expect(t.underarmEvents.some(e=>e.hand===f.catchHand&&Math.abs(e.time-arrival)<1e-9)).toBe(true);
  }
  expect(inspectSyncBox(t,transform)).toMatchObject({geometryOK:true,ownershipConflicts:0});
});
it('HF Reverse-UAIは反対側の縦4を腕下で捕り、高い2xを下から支えて往復する',()=>{
  const s=SEQUENCE_EXAMPLES[45],c=compileSequence(s),t=build(c.config);
  expect(c.analysis).toMatchObject({ok:true,balls:3,movementSets:2,identitySets:2,notation:'(4,2x)(2x,4)'});
  const columns=t.flights.filter(f=>f.value===4),passes=t.flights.filter(f=>f.value===2);
  expect(columns).toHaveLength(2);expect(passes).toHaveLength(2);expect(t.underarmEvents).toHaveLength(2);
  expect(new Set(columns.map(f=>f.prop)).size).toBe(2);expect(new Set(passes.map(f=>f.prop)).size).toBe(1);
  for(const f of columns){
    const side=f.throwHand===0?-1:1;
    expect(f.throwHand).toBe(f.catchHand);expect(f.start.x*side).toBeLessThan(0);
    expect(f.end.x).toBeCloseTo(f.start.x,9);expect(f.end.z).toBeCloseTo(f.start.z,9);
    expect(f.motion.release.relation).toBeUndefined();expect(f.motion.catch.relation).toBe('underarm');
    const p=passes.find(g=>Math.abs(g.release-f.release)<1e-9)!;
    expect(p.throwHand).toBe(1-f.throwHand);expect(p.catchHand).toBe(f.throwHand);
    expect(p.start.y-f.start.y).toBeGreaterThan(.30);expect(p.end.y-f.end.y).toBeGreaterThan(.30);
    expect(p.start.y-p.end.y).toBeGreaterThan(.10);expect(p.start.x*p.end.x).toBeLessThan(0);
    expect(p.releaseGrip).toBe('underhand');expect(p.catchGrip).toBe('underhand');
  }
  expect(inspectSyncBox(t,transform)).toMatchObject({geometryOK:true,ownershipConflicts:0});
});
it('HF腕下のReverseとInvertedを元の各セットのまま4セットで往復する',()=>{
  const s=SEQUENCE_EXAMPLES[46],strip=(rows:SyncSequence['sets'])=>rows.map(({sourceName,...r})=>r);
  expect(analyzeSequence(s)).toMatchObject({ok:true,balls:3,movementSets:4,identitySets:4});
  expect(strip(s.sets.slice(0,2))).toEqual(strip(SEQUENCE_EXAMPLES[38].sets));
  expect(strip(s.sets.slice(2,4))).toEqual(strip(SEQUENCE_EXAMPLES[45].sets));
  const t=build(compileSequence(s).config);
  expect(t.underarmEvents).toHaveLength(4);
  expect(inspectSyncBox(t,transform)).toMatchObject({geometryOK:true,ownershipConflicts:0});
});
it('役割固定のHF Reverse-UAIは高い左2xと横移動する右4xを3球すべてが通る',()=>{
  const s=SEQUENCE_EXAMPLES[47],c=compileSequence(s),t=build(c.config);
  expect(c.analysis).toMatchObject({ok:true,balls:3,movementSets:1,identitySets:3,notation:'(2x,4x)'});
  expect(t.period).toBeCloseTo(1.8,9);
  const high=t.flights.filter(f=>f.value===4),passes=t.flights.filter(f=>f.value===2);
  expect(high).toHaveLength(3);expect(passes).toHaveLength(3);expect(t.underarmEvents).toHaveLength(3);
  for(const flights of [high,passes])expect(new Set(flights.map(f=>f.prop)).size).toBe(3);
  for(const f of high){
    expect(f.throwHand).toBe(1);expect(f.catchHand).toBe(0);
    expect(f.start.x).toBeLessThan(0);expect(f.end.x).toBeGreaterThan(0);
    expect(f.end.x-f.start.x).toBeGreaterThan(.25);
    expect(f.motion.catch.relation).toBe('underarm');expect(f.duration).toBeCloseTo(.75,9);
    const arrival=(f.release+f.duration)%t.period;
    const p=passes.find(p=>Math.abs((p.release+p.duration)%t.period-arrival)<1e-9)!;
    expect(p).toBeDefined();expect(p.throwHand).toBe(0);expect(p.catchHand).toBe(1);
    expect(p.duration).toBeCloseTo(.15,9);expect(p.end.y-p.start.y).toBeGreaterThan(.15);
    expect(p.end.y-f.end.y).toBeGreaterThan(.45);
    for(const ball of [f,p]){expect(ball.releaseGrip).toBe('underhand');expect(ball.catchGrip).toBe('underhand');}
  }
  expect(inspectSyncBox(t,transform)).toMatchObject({geometryOK:true,ownershipConflicts:0});
});
it('固定InvertedとHF Reverse-UAIを前後の4xでつなぎ、4セットの動きを3周して同じ球に戻る',()=>{
  const s=SEQUENCE_EXAMPLES[48],from=sequenceFromBasicParts({roles:'fixed',shortHand:0,left:'inverted',right:'inverted'}),to=SEQUENCE_EXAMPLES[47];
  const strip=({sourceName,...r}:SyncSequence['sets'][number])=>r;
  expect(analyzeSequence(s)).toMatchObject({ok:true,balls:3,movementSets:4,identitySets:12});
  expect(strip(s.sets[0])).toEqual(strip(from.sets[0]));expect(strip(s.sets[2])).toEqual(strip(to.sets[0]));
  expect(strip(s.sets[1])).toEqual(strip(s.sets[3]));
  const t=build(compileSequence(s).config);expect(t.period).toBeCloseTo(7.2,9);
  expect(t.underarmEvents).toHaveLength(3);
  expect(t.flights.filter(f=>f.value===4&&f.motion.catch.relation!=='underarm').some(f=>Math.abs(f.start.x-f.end.x)<.04)).toBe(true);
  expect(inspectSyncBox(t,transform)).toMatchObject({geometryOK:true,ownershipConflicts:0});
  const raw=appendSequence(from,to,false).sequence!;raw.beatDuration=.30;
  expect(inspectSyncBox(build(compileSequence(raw).config),transform).geometryOK).toBe(false);
});
it('Reverse ShuffleとHF腕下捕球は前後間隔を作って両方の技を保ち、8セットで戻る',()=>{
  const s=SEQUENCE_EXAMPLES[39],from=sequenceFromPreset('reverse'),to=SEQUENCE_EXAMPLES[38];
  const strip=(rows:SyncSequence['sets'])=>rows.map(({sourceName,...r})=>r);
  expect(analyzeSequence(s)).toMatchObject({ok:true,balls:3,movementSets:8,identitySets:8});
  expect(strip(s.sets.slice(0,2))).toEqual(strip(from.sets));expect(strip(s.sets.slice(4,6))).toEqual(strip(to.sets));
  for(const index of [2,6])s.sets.slice(index,index+2).forEach((row,i)=>row.throws.forEach((value,h)=>{
    const a=sequenceHandDefinition(from.sets[i],h),b=sequenceHandDefinition(row,h);
    for(const point of ['release','catch'] as const){
      expect(b[point].x).toBe(a[point].x);expect(b[point].y).toBe(a[point].y);
      expect(b[point].z).toBe(value==='4'?-.38:-.30);
    }
  }));
  expect(inspectSyncBox(build(compileSequence(s).config),transform).geometryOK).toBe(true);
  expect(inspectSyncBox(build(compileSequence(appendSequence(from,to).sequence!).config),transform).geometryOK).toBe(false);
});
it('HF腕下クローは2xを腕下から上げて反対の手でクロー捕球し、自己投げ4と区別する',()=>{
  const s=SEQUENCE_EXAMPLES[40],c=compileSequence(s),t=build(c.config);
  expect(c.analysis).toMatchObject({ok:true,balls:3,movementSets:2,identitySets:2,notation:'(4,2x)(2x,4)'});
  const columns=t.flights.filter(f=>f.value===4),passes=t.flights.filter(f=>f.value===2);
  expect(columns).toHaveLength(2);expect(passes).toHaveLength(2);expect(t.underarmEvents).toHaveLength(2);
  expect(new Set(passes.map(f=>f.prop)).size).toBe(1);
  for(const f of passes){
    expect(f.throwHand).not.toBe(f.catchHand);expect(f.motion.release.relation).toBe('underarm');
    expect(f.motion.catch.relation).toBeUndefined();expect(f.motion.release.x).toBeLessThan(0);
    expect(f.start.x).toBeCloseTo(f.end.x,9);expect(f.end.y-f.start.y).toBeGreaterThan(.35);
    expect(f.releaseGrip).toBe('underhand');expect(f.catchGrip).toBe('overhand');
    expect(t.underarmEvents.some(e=>e.hand===f.throwHand&&Math.abs(e.time-f.release)<1e-9)).toBe(true);
    const arrival=(f.release+f.duration)%t.period;
    const column=columns.find(g=>Math.abs((g.release+g.duration)%t.period-arrival)<1e-9)!;
    expect(column).toBeDefined();expect(column.catchHand).toBe(1-f.catchHand);
    expect(column.catchGrip).toBe('underhand');expect(column.throwHand).toBe(column.catchHand);
    expect(column.motion.release.relation).toBeUndefined();expect(column.motion.catch.relation).toBeUndefined();
  }
  expect(inspectSyncBox(t,transform)).toMatchObject({geometryOK:true,ownershipConflicts:0});
});
it('保持2を含むBox RollとHF腕下クローを6セットで接続し、18セットで同じ球まで戻る',()=>{
  const s=SEQUENCE_EXAMPLES[41],from=sequenceFromPreset('box-roll'),to=SEQUENCE_EXAMPLES[40];
  const strip=(rows:SyncSequence['sets'])=>rows.map(({sourceName,...r})=>r);
  expect(analyzeSequence(s)).toMatchObject({ok:true,balls:3,movementSets:6,identitySets:18});
  expect(strip(s.sets.slice(0,4))).toEqual(strip(expandSequence(from)));
  expect(strip(s.sets.slice(4))).toEqual(strip(to.sets));
  const assembled=connectSequenceCycles(from,to,false).sequence!;assembled.beatDuration=.25;
  expect(analyzeSequence(assembled).canonical).toBe(analyzeSequence(s).canonical);
  const t=build(compileSequence(s).config);
  expect(t.period).toBeCloseTo(9,9);expect(t.underarmEvents).toHaveLength(6);
  expect(t.flights.filter(f=>f.motion.release.relation==='underarm')).toHaveLength(6);
  expect(t.flights.filter(f=>f.value===2&&f.catchGrip==='overhand')).toHaveLength(6);
  expect(inspectSyncBox(t,transform)).toMatchObject({geometryOK:true,ownershipConflicts:0});
});
it('役割固定のHF腕下クローは全3球を4xと2xで受け渡し、1セットの動きを3周する',()=>{
  const s=SEQUENCE_EXAMPLES[42],c=compileSequence(s),t=build(c.config);
  expect(c.analysis).toMatchObject({ok:true,balls:3,movementSets:1,identitySets:3,notation:'(2x,4x)'});
  expect(t.period).toBeCloseTo(1.5,9);expect(t.underarmEvents).toHaveLength(3);
  const columns=t.flights.filter(f=>f.value===4),passes=t.flights.filter(f=>f.value===2);
  expect(columns).toHaveLength(3);expect(passes).toHaveLength(3);
  for(const prop of new Set(t.flights.map(f=>f.prop)))expect(new Set(t.flights.filter(f=>f.prop===prop).map(f=>f.value))).toEqual(new Set([4,2]));
  for(const f of columns){
    expect(f.throwHand).toBe(1);expect(f.catchHand).toBe(0);expect(f.catchGrip).toBe('underhand');
    expect(f.motion.release.x).toBeLessThan(0);expect(f.motion.catch.x).toBeGreaterThan(0);
    expect(f.motion.release.relation).toBeUndefined();expect(f.motion.catch.relation).toBeUndefined();
  }
  for(const f of passes){
    expect(f.throwHand).toBe(0);expect(f.catchHand).toBe(1);expect(f.releaseGrip).toBe('underhand');expect(f.catchGrip).toBe('overhand');
    expect(f.motion.release.relation).toBe('underarm');expect(f.start.x).toBeCloseTo(f.end.x,9);
    expect(f.end.y-f.start.y).toBeGreaterThan(.35);
    expect(t.underarmEvents.some(e=>e.hand===0&&Math.abs(e.time-f.release)<1e-9)).toBe(true);
  }
  expect(inspectSyncBox(t,transform)).toMatchObject({geometryOK:true,ownershipConflicts:0});
});
it('HFダブル腕下クローは右4x・右4・左4x・左4の4セットで同じ球まで戻る',()=>{
  const s=SEQUENCE_EXAMPLES[43],c=compileSequence(s),t=build(c.config);
  expect(c.analysis).toMatchObject({ok:true,balls:3,movementSets:4,identitySets:4,notation:'(2x,4x)(2x,4)(4x,2x)(4,2x)'});
  expect(t.period).toBeCloseTo(2,9);
  const columns=t.flights.filter(f=>f.value===4).sort((a,b)=>a.release-b.release);
  const passes=t.flights.filter(f=>f.value===2);
  expect(columns.map(f=>f.throwHand)).toEqual([1,1,0,0]);
  expect(columns.map(f=>f.catchHand)).toEqual([0,1,1,0]);
  expect(passes).toHaveLength(4);expect(t.underarmEvents).toHaveLength(4);
  for(const f of passes){
    expect(f.throwHand).not.toBe(f.catchHand);expect(f.motion.release.relation).toBe('underarm');
    expect(f.releaseGrip).toBe('underhand');expect(f.catchGrip).toBe('overhand');
    expect(f.start.x).toBeCloseTo(f.end.x,9);expect(f.end.y-f.start.y).toBeGreaterThan(.35);
  }
  for(const f of columns){
    expect(f.catchGrip).toBe('underhand');expect(f.motion.catch.x).toBe(-.04);
    expect(f.motion.release.relation).toBeUndefined();expect(f.motion.catch.relation).toBeUndefined();
  }
  expect(inspectSyncBox(t,transform)).toMatchObject({geometryOK:true,ownershipConflicts:0});
});
it('ダブル腕下クローを1セットずつ取り込んで並べても構成と周期を保つ',()=>{
  const s=SEQUENCE_EXAMPLES[43],before=structuredClone(s);
  const assembled={...structuredClone(s),sets:[0,1,2,3].map(i=>extractSequenceSet(s,i))};
  expect(analyzeSequence(assembled).canonical).toBe(analyzeSequence(s).canonical);
  expect(analyzeSequence(assembled)).toMatchObject({movementSets:4,identitySets:4});
  assembled.sets[0].motion.hands![0]!.definition!.release.x=0;
  expect(s).toEqual(before);
});
it('コラムの往復接続は元の技を保ち、中央の入口と球識別まで閉じる',()=>{
  const strip=(rows:SyncSequence['sets'])=>rows.map(({sourceName,...row})=>row);
  const three=SEQUENCE_EXAMPLES[32],four=SEQUENCE_EXAMPLES[33];
  expect(analyzeSequence(three)).toMatchObject({ok:true,balls:3,movementSets:6,identitySets:6});
  expect(strip(three.sets.slice(0,2))).toEqual(strip(SEQUENCE_EXAMPLES[0].sets));
  expect(strip(three.sets.slice(3,5))).toEqual(strip(SEQUENCE_EXAMPLES[30].sets));
  expect(three.sets[2].motion.hands![0]!.definition!.release.x).toBe(0);
  expect(analyzeSequence(four)).toMatchObject({ok:true,balls:4,movementSets:3,identitySets:6});
  expect(strip(four.sets.slice(0,1))).toEqual(strip(SEQUENCE_EXAMPLES[7].sets));
  expect(strip(four.sets.slice(1))).toEqual(strip(SEQUENCE_EXAMPLES[31].sets));
  for(const s of [three,four])expect(inspectSyncBox(build(compileSequence(s).config),transform).geometryOK).toBe(true);
  const raw=connectSequenceCycles(SEQUENCE_EXAMPLES[0],SEQUENCE_EXAMPLES[30]).sequence!;
  expect(inspectSyncBox(build(compileSequence(raw).config),transform).geometryOK).toBe(false);
});
it('Levelsへの48セットの往復は両方の技を保ち、中央の前後間隔を先に確保する',()=>{
  const s=SEQUENCE_EXAMPLES[29],from=SEQUENCE_EXAMPLES[4],to=SEQUENCE_EXAMPLES[28],a=analyzeSequence(s);
  expect(a).toMatchObject({ok:true,balls:3,movementSets:48,identitySets:48});
  const strip=(rows:SyncSequence['sets'])=>rows.map(({sourceName,...row})=>row);
  expect(strip(s.sets.slice(0,4))).toEqual(strip(from.sets));expect(strip(s.sets.slice(24,28))).toEqual(strip(to.sets));
  for(const index of [4,44])s.sets.slice(index,index+4).forEach((r,i)=>r.throws.forEach((t,h)=>{
    const d=r.motion.hands![h]!.definition!,original=sequenceHandDefinition(from.sets[i],h);
    for(const key of ['release','catch'] as const){expect(d[key].x).toBe(original[key].x);expect(d[key].y).toBe(original[key].y);expect(d[key].z).toBe(t==='4x'?-.36:-.25);}
  }));
  expect(s.sets[8].sourceName).toContain('20%');expect(s.sets[20].sourceName).toContain('80%');
  expect(s.sets[28].sourceName).toContain('80%');expect(s.sets[40].sourceName).toContain('20%');
});
it('Levelsへの単純な直接接続は手が届く範囲または速度の検査を通らない',()=>{
  const direct=appendSequence(SEQUENCE_EXAMPLES[4],SEQUENCE_EXAMPLES[28]).sequence!;
  const report=inspectSyncBox(build(compileSequence(direct).config),transform);
  expect(report.geometryOK&&report.maxHandSpeed<12).toBe(false);
});
it('Levelsは三段の受け渡しと中央のクロー捕球を保ち、外側の4を頂点で捕る',()=>{
  const s=SEQUENCE_EXAMPLES[28],c=compileSequence(s),t=build(c.config);
  expect(c.analysis).toMatchObject({ok:true,balls:3,movementSets:4,identitySets:4,notation:'(4x,2x)(4,2x)(2x,4x)(2x,4)'});
  const columns=t.flights.filter(f=>f.value===4),outer=columns.filter(f=>f.throwHand===f.catchHand),center=columns.filter(f=>f.throwHand!==f.catchHand);
  for(const f of outer){
    expect(f.motion.catchAtApex).toBe(true);expect(f.velocity.y-9.8*f.duration).toBeCloseTo(0,9);
    expect(f.end.x).toBeCloseTo(f.start.x,9);expect(f.end.y-f.start.y).toBeGreaterThan(.6);
    expect(f.catchGrip).toBe('underhand');
  }
  for(const f of center){expect(f.start.x).toBeCloseTo(0,9);expect(f.end.x).toBeCloseTo(0,9);expect(f.catchGrip).toBe('overhand');expect(f.duration).toBeCloseTo(4*s.beatDuration*.85,9);}
  const top=Math.min(...outer.map(f=>f.end.y));
  expect(Math.max(...center.map(f=>f.start.y+f.velocity.y**2/(2*9.8)))).toBeLessThan(top-.25);
  for(const f of t.flights.filter(f=>f.value===2)){
    expect(f.start.y).toBeGreaterThan(f.end.y);
    if(f.style==='vertical-down')expect(f.velocity.y).toBeCloseTo(0,9);
    else {expect(f.duration).toBeCloseTo(2*s.beatDuration*.55,9);expect(f.releaseGrip).toBe('overhand');}
  }
});
it('頂点捕球はモデルの尺度に合わせて飛行時間を変え、指定した位置で捕る',()=>{
  const c=compileSequence(SEQUENCE_EXAMPLES[28]).config!;
  for(const armLength of [.46,.60]){
    const other=makeTransform({shoulderY:1.403,shoulderX:.137,shoulderZ:.021,upperArmLength:armLength*.52,armLength});
    const source=CreateSiteswap(c.siteswap,{...new Options().siteswap,beatDuration:syncBeat(c),dwellRatio:syncDwell(c),props:[{type:'ball',color:'red',radius:SYNC_RADIUS,C:.9}]});
    const t=buildSyncBoxTracks(source,other,c);
    for(const f of t.flights.filter(f=>f.motion.catchAtApex)){
      expect(f.velocity.y-9.8*f.duration).toBeCloseTo(0,9);expect(syncFlightAt(f,f.duration).distanceTo(f.end)).toBeLessThan(1e-9);
    }
  }
});
it('捕球時刻を保存し、不正値・下投げとの併用・不足する受け渡し時間を拒否する',()=>{
  const base=structuredClone(SEQUENCE_EXAMPLES[28]),s=JSON.parse(JSON.stringify(base)) as SyncSequence;
  expect(analyzeSequence(s).canonical).toBe(analyzeSequence(base).canonical);
  const d=s.sets[1].motion.hands![0]!.definition!;
  d.flightFraction=.7;expect(analyzeSequence(s).documentOK).toBe(false);delete d.flightFraction;
  (d as any).catchAtApex='yes';expect(analyzeSequence(s).documentOK).toBe(false);d.catchAtApex=true;
  d.catch.y=d.release.y;expect(()=>build(compileSequence(s).config)).toThrow('捕球位置');
  d.catch.y=10;expect(()=>build(compileSequence(s).config)).toThrow('時間が足りません');
  d.catch.y=.65;
  const drop=s.sets[0].motion.hands![1]!.definition!;drop.flightFraction=.5;
  expect(()=>build(compileSequence(s).config)).toThrow('割合指定');
  for(const value of [0,1,NaN,Infinity]){drop.flightFraction=value;expect(analyzeSequence(s).documentOK).toBe(false);}
  const held=sequenceFromPreset('box-roll'),row=held.sets.find(s=>s.throws.includes('2'))!,h=row.throws.indexOf('2');row.motion.hands=[];
  row.motion.hands[h]={definition:{release:{x:.2,y:0,z:-.3},catch:{x:.2,y:.2,z:-.3},catchAtApex:true,passage:{at:.5},carry:{route:'direct',amount:0}}};
  expect(()=>build(compileSequence(held).config)).toThrow('持ったまま');
});
describe.each(basicStyles.flatMap(crossSet=>basicStyles.map(selfSet=>({crossSet,selfSet}))))('Double部品 4x=$crossSet / 4=$selfSet',parts=>{
  it('4セットの同じ球を保ち、手ごとでなく4x・4の局面へ2xを割り当てる',()=>{
    const s=sequenceFromDoubleParts(parts),c=compileSequence(s),t=build(c.config);
    expect(c.analysis).toMatchObject({ok:true,balls:3,movementSets:4,identitySets:4});
    for(const f of t.flights.filter(f=>f.value===2)){
      const high=t.flights.find(g=>g.value===4&&Math.abs(g.release-f.release)<1e-9)!;
      expect(f.style).toBe(high.throwHand===high.catchHand?parts.selfSet:parts.crossSet);
      expect(f.catchHand).toBe(high.throwHand);expect(f.throwHand).toBe(1-high.throwHand);
    }
    expect(inspectSyncBox(t,transform)).toMatchObject({geometryOK:true,ownershipConflicts:0});
  });
});
it('Double部品は不正入力を拒否し、別の列や元の見本を変更しない',()=>{
  for(const parts of [undefined,{crossSet:'toString',selfSet:'normal'},{crossSet:'normal',selfSet:'up'},
    {crossSet:'normal',selfSet:'normal',crossReleaseGrip:'claw'},
    {crossSet:'normal',selfSet:'normal',selfReleaseGrip:null},
    {crossSet:'normal',selfSet:'normal',crossCatchGrip:'claw'},
    {crossSet:'normal',selfSet:'normal',selfCatchGrip:null}])expect(()=>sequenceFromDoubleParts(parts as any)).toThrow('Double');
  const parts={crossSet:'normal',selfSet:'inverted'} as const,before=structuredClone(parts),a=sequenceFromDoubleParts(parts),b=sequenceFromDoubleParts(parts);
  a.sets[1].motion.short![0]='shuffle';a.sets[0].throws[0]='6';
  expect(parts).toEqual(before);expect(b.sets[1].motion.short).toEqual(['inverted']);expect(b.sets[0].throws[0]).toBe('4x');
  const same=sequenceFromDoubleParts({crossSet:'normal',selfSet:'normal'}),original=sequenceFromPreset('double-box');
  expect(same.sets).toEqual(original.sets);expect(same.beatDuration).toBe(original.beatDuration);
});
it.each((['underhand','overhand'] as const).flatMap(crossReleaseGrip=>(['underhand','overhand'] as const).map(selfReleaseGrip=>({crossReleaseGrip,selfReleaseGrip}))))('Doubleの手向き $crossReleaseGrip / $selfReleaseGrip は2xの投球だけに反映する',grips=>{
  const parts={crossSet:'shuffle',selfSet:'inverted'} as const,source=sequenceFromDoubleParts(parts),s=sequenceFromDoubleParts({...parts,...grips});
  const before=build(compileSequence(source).config),after=build(compileSequence(s).config);
  expect(s.sets.map(r=>r.throws)).toEqual(source.sets.map(r=>r.throws));
  after.flights.forEach((f,i)=>{
    const original=before.flights[i];expect(f.catchGrip).toBe(original.catchGrip);
    if(f.value===4){expect(f.releaseGrip).toBe(original.releaseGrip);return;}
    const high=after.flights.find(g=>g.value===4&&Math.abs(g.release-f.release)<1e-9)!;
    expect(f.releaseGrip).toBe(high.throwHand!==high.catchHand?grips.crossReleaseGrip:grips.selfReleaseGrip);
  });
  for(let i=0;i<after.numSteps;i++){
    after.props.forEach((p,h)=>expect(p[i].distanceTo(before.props[h][i])).toBeLessThan(1e-9));
    after.hands.forEach((h,j)=>expect(h.positions[i].distanceTo(before.hands[j].positions[i])).toBeLessThan(1e-9));
  }
});
it.each((['underhand','overhand'] as const).flatMap(crossCatchGrip=>(['underhand','overhand'] as const).map(selfCatchGrip=>({crossCatchGrip,selfCatchGrip}))))('Doubleの捕球 $crossCatchGrip / $selfCatchGrip は対応する2xの受け手へ反映する',grips=>{
  const parts={crossSet:'reverse',selfSet:'reverse',crossReleaseGrip:'overhand',selfReleaseGrip:'underhand'} as const;
  const source=sequenceFromDoubleParts(parts),s=sequenceFromDoubleParts({...parts,...grips});
  const before=build(compileSequence(source).config),after=build(compileSequence(s).config);
  after.flights.forEach((f,i)=>{
    const original=before.flights[i];expect(f.releaseGrip).toBe(original.releaseGrip);
    if(f.value===4){expect(f.catchGrip).toBe(original.catchGrip);return;}
    const high=after.flights.find(g=>g.value===4&&Math.abs(g.release-f.release)<1e-9)!;
    expect(f.catchHand).toBe(high.throwHand);
    expect(f.catchGrip).toBe(high.throwHand!==high.catchHand?grips.crossCatchGrip:grips.selfCatchGrip);
  });
  for(let i=0;i<after.numSteps;i++){
    after.props.forEach((p,h)=>expect(p[i].distanceTo(before.props[h][i])).toBeLessThan(1e-9));
    after.hands.forEach((h,j)=>expect(h.positions[i].distanceTo(before.hands[j].positions[i])).toBeLessThan(1e-9));
  }
});
describe.each(basicStyles.flatMap(left=>basicStyles.map(right=>({left,right}))))('基本部品 左$left / 右$right',({left,right})=>{
  it('左右の2xの相対通過を解き、コラムの飛行を保持する',()=>{
    const s=sequenceFromBasicParts({roles:'alternate',left,right,shortHand:1}),c=compileSequence(s),t=build(c.config);
    expect(c.analysis).toMatchObject({ok:true,balls:3,movementSets:2,identitySets:2});
    const before=build({...SYNC_BOX_PRESETS[0],short:[right,left]});
    for(const f of t.flights.filter(f=>f.value===2))expect(f.style).toBe(f.throwHand===0?left:right);
    expect(inspectSyncBox(t,transform).ballOrderClearance).toBeGreaterThan(0);
    t.flights.forEach((f,i)=>{if(f.value===4){expect(f.start.distanceTo(before.flights[i].start)).toBeLessThan(1e-9);expect(f.velocity.distanceTo(before.flights[i].velocity)).toBeLessThan(1e-9);}});
  });
});
describe.each(basicStyles.flatMap(style=>([0,1] as const).map(shortHand=>({style,shortHand}))))('固定部品 $style / 2x=$shortHand',({style,shortHand})=>{
  it('指定した手だけが2xを投げ続け、反対の手へ4xを返す',()=>{
    const s=sequenceFromBasicParts({roles:'fixed',left:style,right:style,shortHand}),c=compileSequence(s),t=build(c.config);
    expect(c.analysis).toMatchObject({ok:true,balls:3,movementSets:1,identitySets:3});
    for(const f of t.flights){expect(f.catchHand).toBe(1-f.throwHand);expect(f.value).toBe(f.throwHand===shortHand?2:4);if(f.value===2)expect(f.style).toBe(style);}
    expect(inspectSyncBox(t,transform).geometryOK).toBe(true);
  });
});
it('基本部品の不正な種類を拒否し、繰り返し生成した列を独立して編集できる',()=>{
  expect(()=>sequenceFromBasicParts({roles:'fixed',left:'toString',right:'normal',shortHand:1} as any)).toThrow();
  const parts={roles:'alternate',left:'normal',right:'normal',shortHand:1} as const;
  const a=sequenceFromBasicParts(parts),b=sequenceFromBasicParts(parts);a.sets[0].motion.short![0]='shuffle';
  expect(b.sets[0].motion.short![0]).toBe('normal');expect(SEQUENCE_EXAMPLES[0].sets[0].motion.short![0]).toBe('normal');
});
it('左右交代の3セットは6セットで閉じる',()=>{
  const a=analyzeSequence(SEQUENCE_EXAMPLES[2]);
  expect(a.ok,JSON.stringify(a)).toBe(true);expect(a.inputSets).toBe(3);expect(a.movementSets).toBe(6);expect(a.identitySets).toBe(6);
});
it('追加元と追加先の左右交代をそれぞれ閉じてから接続する',()=>{
  const a=structuredClone(SEQUENCE_EXAMPLES[2]),b=structuredClone(SEQUENCE_EXAMPLES[2]);
  a.sets[0].motion.hands=[{heightOffset:.01},{heightOffset:-.01}];
  b.name='後半';b.sets[0].motion.hands=[{heightOffset:.03},{heightOffset:-.02}];
  const before=structuredClone([a,b]),joined=appendSequence(a,b).sequence!;
  expect(joined.mirrorRepeat).toBe(false);expect(joined.sets).toHaveLength(12);
  expect(expandSequence(joined).map(({sourceName,...s})=>s)).toEqual([...expandSequence(a),...expandSequence(b)]);
  expect(joined.sets[3].motion.hands?.map(h=>h?.heightOffset)).toEqual([-.01,.01]);
  expect(joined.sets[9].motion.hands?.map(h=>h?.heightOffset)).toEqual([-.02,.03]);
  joined.sets[0].motion.hands![0]!.heightOffset=.2;
  expect([a,b]).toEqual(before);expect(joined.sets[3].motion.hands![1]!.heightOffset).toBe(.01);
});
it('未完成の左右1セットずつを追加して成立する列にできる',()=>{
  const a=sequenceFromPreset('box'),b=structuredClone(a);a.sets.splice(1);b.sets.splice(0,1);
  expect(analyzeSequence(a).ok).toBe(false);expect(analyzeSequence(b).ok).toBe(false);
  expect(analyzeSequence(appendSequence(a,b).sequence!).ok).toBe(true);
});
it('Boxと左手固定の2xの間に必要な投げを両方向へ1セットずつ補う',()=>{
  const a=sequenceFromPreset('box'),b=sequenceFromBasicParts({roles:'fixed',left:'normal',right:'normal',shortHand:0});
  expect(analyzeSequence(appendSequence(a,b).sequence!).ok).toBe(false);
  const before=structuredClone([a,b]),r=connectSequenceCycles(a,b),s=r.sequence!;
  expect(r).toMatchObject({bridgeSets:2,forwardSets:1,returnSets:1,addedSets:3});
  expect(s.sets.map(row=>row.throws)).toEqual([['4','2x'],['2x','4'],['4','2x'],['2x','4x'],['2x','4']]);
  expect(s.sets.filter(row=>row.sourceName==='受け渡しのつなぎ')).toHaveLength(2);
  expect(analyzeSequence(s)).toMatchObject({ok:true,balls:3,movementSets:5,identitySets:15});
  expect(inspectSyncBox(build(compileSequence(s).config),transform).geometryOK).toBe(true);
  s.sets[0].motion.short![0]='shuffle';expect([a,b]).toEqual(before);
});
it('基本24種類の全576接続で両区間を保持し、同じ球数の周期を閉じる',()=>{
  const parts=[...basicStyles.flatMap(left=>basicStyles.map(right=>sequenceFromBasicParts({roles:'alternate',left,right,shortHand:1}))),
    ...basicStyles.flatMap(style=>([0,1] as const).map(shortHand=>sequenceFromBasicParts({roles:'fixed',left:style,right:style,shortHand})))];
  for(const a of parts)for(const b of parts){
    const r=connectSequenceCycles(a,b),s=r.sequence!;expect(s,`${a.name} / ${b.name}`).toBeDefined();
    expect(analyzeSequence(s)).toMatchObject({ok:true,balls:3});
    const strip=(rows:SyncSequence['sets'])=>rows.map(({sourceName,...row})=>row);
    expect(strip(s.sets.slice(0,a.sets.length))).toEqual(strip(a.sets));
    expect(strip(s.sets.slice(a.sets.length+r.forwardSets,a.sets.length+r.forwardSets+b.sets.length))).toEqual(strip(b.sets));
    if(!r.bridgeSets)expect(s).toEqual(appendSequence(a,b).sequence);
  }
});
describe.each(basicStyles.flatMap(style=>([0,1] as const).map(shortHand=>({style,shortHand}))))('役割の切替 $style / 2x=$shortHand',({style,shortHand})=>{
  it('固定役割を3回続けてBoxへ戻り、全周期の球と手が接続する',()=>{
    const fixed=sequenceFromBasicParts({roles:'fixed',left:style,right:style,shortHand});fixed.sets[0].repeat=3;
    const s=connectSequenceCycles(sequenceFromPreset('box'),fixed).sequence!,c=compileSequence(s);
    const t=build(c.config),report=inspectSyncBox(t,transform);
    expect(report.geometryOK,JSON.stringify(report)).toBe(true);expect(report.maxHandSpeed).toBeLessThan(12);
    expect(c.analysis).toMatchObject({balls:3,movementSets:shortHand===0?7:5,identitySets:shortHand===0?7:5});
  });
});
it('空の手を含む列と高い投げの状態も接続できる',()=>{
  const make=(pairs:[string,string][]):SyncSequence=>({version:1,name:'投げ列',mirrorRepeat:false,beatDuration:.205,
    sets:pairs.map(throws=>({throws,repeat:1,motion:{columns:'normal',short:['normal']}}))});
  for(const [a,b] of [[make([['4','4']]),make([['8','0'],['0','8']])],
    [make([['c','6']]),make([['6','c']])],[make([['6','2']]),make([['4','4']])]]){
    const balls=analyzeSequence(a).balls;expect(analyzeSequence(b)).toMatchObject({ok:true,balls});
    const r=connectSequenceCycles(a,b);expect(r.sequence,r.message).toBeDefined();
    expect(r.bridgeSets).toBeGreaterThan(0);expect(analyzeSequence(r.sequence!)).toMatchObject({ok:true,balls});
    const originalMax=Math.max(...[...a.sets,...b.sets].flatMap(s=>s.throws.map(t=>parseInt(t,36))));
    expect(Math.max(...r.sequence!.sets.flatMap(s=>s.throws.map(t=>parseInt(t[0],36))))).toBeLessThanOrEqual(originalMax);
  }
  const symmetric=connectSequenceCycles(make([['2','2'],['4','4'],['6','6']]),make([['4','4']]));
  expect(symmetric.sequence!.sets[3].throws).toEqual(['2','2']);
  expect(analyzeSequence(symmetric.sequence!).ok).toBe(true);
});
it('自動のつなぎも左右交代と回数を保ち、成立しない入力と上限超過を変更しない',()=>{
  const a=structuredClone(SEQUENCE_EXAMPLES[2]),b=sequenceFromBasicParts({roles:'fixed',left:'normal',right:'normal',shortHand:0});
  b.sets[0].repeat=3;const r=connectSequenceCycles(a,b);expect(r.sequence).toBeDefined();
  expect(r.sequence!.sets.slice(0,6).map(s=>s.repeat)).toEqual([1,1,1,1,1,1]);
  expect(r.sequence!.sets[6+r.forwardSets].repeat).toBe(3);
  expect(analyzeSequence(r.sequence!).ok).toBe(true);
  const invalid=sequenceFromPreset('box');invalid.sets.pop();
  expect(connectSequenceCycles(invalid,b).sequence).toBeUndefined();
  expect(connectSequenceCycles(SEQUENCE_EXAMPLES[7],b).sequence).toBeUndefined();
  const full=sequenceFromPreset('box');full.sets=Array.from({length:62},(_,i)=>structuredClone(full.sets[i%2]));
  const saved=structuredClone(full);expect(connectSequenceCycles(full,b).sequence).toBeUndefined();expect(full).toEqual(saved);
});
it('異なる球数を連結せず、元の列を保つ',()=>{
  const a=structuredClone(SEQUENCE_EXAMPLES[0]),before=structuredClone(a),r=appendSequence(a,SEQUENCE_EXAMPLES[7]);
  expect(r.sequence).toBeUndefined();expect(r.message).toContain('3球と4球');expect(a).toEqual(before);
});
it('セット時間を明示的に揃えるか維持でき、元の見本名は構造コードに影響しない',()=>{
  const a=SEQUENCE_EXAMPLES[0],b=SEQUENCE_EXAMPLES[15];
  const joined=appendSequence(a,b).sequence!,kept=appendSequence(a,b,false).sequence!;
  expect(joined.beatDuration).toBe(.18);expect(kept.beatDuration).toBe(.205);
  const original=analyzeSequence(joined).canonical;
  joined.sets.forEach(s=>{s.sourceName='任意の参照名';});
  expect(analyzeSequence(joined).canonical).toBe(original);
});
it('繰り返しを保ち、行数と展開後セット数の上限では追加を拒む',()=>{
  const a=sequenceFromPreset('shower');a.sets[0].repeat=16;
  expect(appendSequence(a,a).sequence!.sets.map(s=>s.repeat)).toEqual([16,16]);
  a.sets=Array.from({length:8},()=>structuredClone(a.sets[0]));
  expect(appendSequence(a,sequenceFromPreset('shower')).sequence).toBeUndefined();
  a.sets=Array.from({length:64},()=>({...structuredClone(a.sets[0]),repeat:1}));
  expect(appendSequence(a,sequenceFromPreset('shower')).sequence).toBeUndefined();
});
it('Underarmを介した往復と4球の往復を区間付きの周期として保存する',()=>{
  const three=SEQUENCE_EXAMPLES[21],four=SEQUENCE_EXAMPLES[22];
  expect(three.sets.map(s=>s.sourceName)).toEqual([
    ...Array(2).fill(SEQUENCE_EXAMPLES[0].name),...Array(4).fill('Underarm Box'),...Array(6).fill("Gilligan's Box"),...Array(4).fill('Underarm Box')]);
  expect(analyzeSequence(three)).toMatchObject({ok:true,balls:3,movementSets:16,identitySets:16});
  expect(analyzeSequence(four)).toMatchObject({ok:true,balls:4,movementSets:8,identitySets:16});
});
it('投げと捕りのクローを別々に選び、球と手の位置は変えない',()=>{
  const base=structuredClone(SEQUENCE_EXAMPLES[0]),before=build(compileSequence(base).config);
  const phaseIndex=(t:ReturnType<typeof build>,time:number)=>Math.round(((time%t.period+t.period)%t.period)/t.stepDuration)%t.numSteps;
  for(const key of ['releaseGrip','catchGrip'] as const){
    const s=structuredClone(base);s.sets[0].motion.hands=[{[key]:'overhand'}];
    const t=build(compileSequence(s).config),f=t.flights.find(f=>f.value===4&&f.throwHand===0)!;
    for(let k=0;k<t.numSteps;k++){
      t.props.forEach((p,j)=>expect(p[k].distanceTo(before.props[j][k])).toBeLessThan(1e-9));
      t.hands.forEach((h,j)=>expect(h.positions[k].distanceTo(before.hands[j].positions[k])).toBeLessThan(1e-9));
    }
    expect(t.hands[f.throwHand].palmNormals[phaseIndex(t,f.release)].y).toBeCloseTo(key==='releaseGrip'?-1:1,5);
    expect(t.hands[f.catchHand].palmNormals[phaseIndex(t,f.release+f.duration)].y).toBeLessThan(key==='catchGrip'?-.9:1.01);
    if(key==='releaseGrip')expect(t.hands[f.catchHand].palmNormals[phaseIndex(t,f.release+f.duration)].y).toBeGreaterThan(.9);
  }
});
it('反対の手への投げにも捕る手の向きを指定し、左右反転で入れ替わる',()=>{
  const s=structuredClone(SEQUENCE_EXAMPLES[0]);s.sets[0].motion.hands=[undefined,{catchGrip:'overhand'}];
  const c=compileSequence(s).config!;
  for(const mirror of [false,true]){
    const t=build({...c,mirror}),f=t.flights.find(f=>f.value===2&&f.throwHand===(mirror?0:1))!;
    expect(f.catchHand).toBe(mirror?1:0);expect(f.catchGrip).toBe('overhand');expect(f.releaseGrip).toBe('underhand');
    const k=Math.round(((f.release+f.duration)%t.period)/t.stepDuration)%t.numSteps;
    expect(t.hands[f.catchHand].palmNormals[k].y).toBeLessThan(-.8);
  }
});
it('不正な手の向きを読み込み時に拒否し、向きの指定を構造コードへ含める',()=>{
  const s=structuredClone(SEQUENCE_EXAMPLES[0]),before=analyzeSequence(s).canonical;
  s.sets[0].motion.hands=[{catchGrip:'overhand'}];expect(analyzeSequence(s).canonical).not.toBe(before);
  (s.sets[0].motion.hands[0] as any).catchGrip='sideways';expect(analyzeSequence(s).documentOK).toBe(false);
});
it('In-lineでも手の向きを指定でき、保持中を含む縦一列を変えない',()=>{
  const s=sequenceFromPreset('inline'),before=build(compileSequence(s).config);
  s.sets[0].motion.hands=[{catchGrip:'overhand'}];
  const c=compileSequence(s);expect(c.analysis.ok).toBe(true);const after=build(c.config);
  for(let k=0;k<after.numSteps;k++)after.props.forEach((p,j)=>{
    expect(p[k].distanceTo(before.props[j][k])).toBeLessThan(1e-9);expect(p[k].x).toBeCloseTo(0,9);
  });
});
it('逆同期ファウンテンは両手の外から内へ、同じ手で捕る',()=>{
  const s=SEQUENCE_EXAMPLES[23],a=analyzeSequence(s),t=build(compileSequence(s).config);
  expect(a).toMatchObject({balls:4,movementSets:1,identitySets:2});
  for(const f of t.flights){expect(f.throwHand).toBe(f.catchHand);expect(f.value).toBe(4);expect(Math.abs(f.start.x)-Math.abs(f.end.x)).toBeGreaterThan(.1);}
  const times=new Set(t.flights.map(f=>f.release));for(const time of times)expect(t.flights.filter(f=>f.release===time)).toHaveLength(2);
});
it('ファウンテンの正逆を前後の経路でつなぎ、両端の技を同じ正面の平面へ戻す',()=>{
  const s=SEQUENCE_EXAMPLES[24],a=analyzeSequence(s),rows=expandSequence(s),t=build(compileSequence(s).config);
  expect(a).toMatchObject({ok:true,balls:4,movementSets:14,identitySets:14});
  for(const [start,sign] of [[0,1],[7,-1]])for(const row of rows.slice(start,start+2)){
    const d=row.motion.columnMotion!;expect((d.catch.x-d.release.x)*sign).toBeCloseTo(.15,9);
    expect(d.release.z).toBeCloseTo(-.3,9);expect(d.catch.z).toBeCloseTo(-.3,9);
  }
  expect(t.flights.some(f=>f.end.z-f.start.z>.1)).toBe(true);
  expect(t.flights.some(f=>f.end.z-f.start.z<-.1)).toBe(true);
  expect(inspectSyncBox(t,transform).minBallDistance).toBeGreaterThan(.09);
});
it('見た目の周期と球の識別の周期を分ける',()=>{
  const s=sequenceFromPreset('shower'),a=analyzeSequence(s);
  expect(a.ok).toBe(true);expect(a.movementSets).toBe(1);expect(a.identitySets).toBe(3);expect(a.balls).toBe(3);
});
it('同じ手への二重到着をセット位置付きで報告する',()=>{
  const s=sequenceFromPreset('box');s.sets.splice(1);
  const a=analyzeSequence(s);expect(a.ok).toBe(false);expect(a.documentOK).toBe(true);expect(a.issues.some(i=>i.hand===0&&i.message.includes('2球'))).toBe(true);
});
it('左右の同時パスを含むハイローの受け渡しが閉じる',()=>{
  const a=analyzeSequence(SEQUENCE_EXAMPLES[3]);expect(a.ok,JSON.stringify(a)).toBe(true);expect(a.balls).toBe(3);
  expect(a.notation).toContain('(2x,2x)');
});
it('繰り返し入力を最短の動作周期へ縮め、名前と保存内容を分ける',()=>{
  const s=sequenceFromPreset('box'),a=analyzeSequence(s);
  s.sets.push(...structuredClone(s.sets));s.name='好きな名前';
  const b=analyzeSequence(s);expect(b.movementSets).toBe(2);expect(b.identitySets).toBe(2);expect(b.canonical).toBe(a.canonical);
});
it('4xでも中央コラムを縦のまま別の手へ渡せる',()=>{
  const t=build(compileSequence(SEQUENCE_EXAMPLES[4]).config);
  for(const f of t.flights.filter(f=>f.value===4)){
    expect(f.start.x).toBeCloseTo(f.end.x,9);
    if(f.throwHand!==f.catchHand)expect(f.start.x).toBeCloseTo(0,9);
  }
});
it('High-Low Invertedの2xは同時に投げた6を上から越す',()=>{
  const t=build(compileSequence(SEQUENCE_EXAMPLES[6]).config);
  for(const high of t.flights.filter(f=>f.value===6)){
    const pass=t.flights.find(f=>f.value===2&&Math.abs(f.release-high.release)<1e-7)!;
    expect(pass).toBeDefined();expect(pass.end.y-syncFlightAt(high,pass.duration).y).toBeGreaterThan(.03);
  }
});
it('Aroundでは同時2xが飛行中の6を上下から挟む',()=>{
  const t=build(compileSequence(SEQUENCE_EXAMPLES[8]).config),beat=SEQUENCE_EXAMPLES[8].beatDuration;
  const mod=(v:number)=>((v%t.period)+t.period)%t.period;
  for(const high of t.flights.filter(f=>f.value===6)){
    const passes=t.flights.filter(f=>f.value===2&&Math.abs(mod(f.release-high.release)-2*beat)<1e-7);
    expect(passes.length).toBe(2);
    const ys=passes.map(p=>syncFlightAt(p,p.duration/2).y).sort((a,b)=>a-b);
    const highY=syncFlightAt(high,2*beat+passes[0].duration/2).y;
    expect(ys[0]).toBeLessThan(highY-.03);expect(ys[1]).toBeGreaterThan(highY+.03);
  }
});
it('True Boxは縦上げ、高い横パス、縦下ろし、低い横パスで閉じる',()=>{
  const t=build(compileSequence(SEQUENCE_EXAMPLES[5]).config),short=t.flights.filter(f=>f.value===2).sort((a,b)=>a.release-b.release);
  expect(short.map(f=>f.style)).toEqual(['vertical-up','inverted','vertical-down','normal']);
  expect(short[0].start.x).toBeCloseTo(short[0].end.x,9);expect(short[0].end.y).toBeGreaterThan(short[0].start.y);
  expect(short[1].start.y).toBeCloseTo(short[1].end.y,9);
  expect(short[2].start.x).toBeCloseTo(short[2].end.x,9);expect(short[2].start.y).toBeGreaterThan(short[2].end.y);
  expect(short[3].start.y).toBeLessThan(short[1].start.y);
  expect(t.flights.every(f=>Math.abs(f.start.z-f.end.z)<1e-10)).toBe(true);
});
it('空の手は球を増やさず待機し、読み込み不正値は再生前に拒否する',()=>{
  const s=sequenceFromPreset('box');s.sets=[{throws:['4','0'],repeat:1,motion:{columns:'normal',short:['normal'],columnMotion:{release:{x:.14,y:0,z:-.3},catch:{x:.29,y:0,z:-.3},passage:{at:.5},carry:{route:'direct',amount:0}}}}];
  const {analysis,config}=compileSequence(s);expect(analysis.balls).toBe(2);const t=build(config);
  expect(t.hands[1].holding.some(Boolean)).toBe(false);expect(t.props.length).toBe(2);
  expect(t.hands[1].positions.every(p=>p.equals(t.hands[1].positions[0]))).toBe(true);
  s.sets[0].motion.hands=[{heightOffset:NaN}];expect(analyzeSequence(s).ok).toBe(false);
});
it('クロスを別のセットにつないでも、固定した腕の上下を消さない',()=>{
  const s=sequenceFromPreset('crossed');s.sets.push(...sequenceFromPreset('box').sets);
  const t=build(compileSequence(s).config);
  expect(t.armOrders.some(h=>h===0)).toBe(true);expect(t.armOrders.some(h=>h===null)).toBe(true);
});
it('In-lineの入口と出口を補い、再実行しても二重に追加しない',()=>{
  const s=sequenceFromPreset('box');s.sets.push(...sequenceFromPreset('inline').sets);
  expect(compileSequence(s).analysis.ok).toBe(false);
  const result=addInlineTransitions(s),connected=result.sequence!;
  expect(result.addedSets).toBe(20);expect(connected.sets[0]).toEqual(s.sets[0]);
  expect(compileSequence(connected).analysis.ok).toBe(true);
  expect(addInlineTransitions(connected).sequence).toEqual(connected);
  expect(s.sets.length).toBe(4);
});
it('接続後のIn-line区間は保持中も3球が同じ縦線にある',()=>{
  const s=SEQUENCE_EXAMPLES[9],t=build(compileSequence(s).config);
  let frames=0,held=0;
  for(let k=0;k<t.numSteps;k++){
    const row=s.sets[Math.floor(k*t.stepDuration/(2*s.beatDuration)+1e-8)%s.sets.length];
    if(row.motion.arrangement!=='inline')continue;
    frames++;
    t.props.forEach((p,j)=>{expect(p[k].x).toBeCloseTo(0,9);expect(p[k].z).toBeCloseTo(-.30*transform.horizontalScale,9);if(t.owners[j][k]>=0)held++;});
  }
  expect(frames).toBeGreaterThan(50);expect(held).toBeGreaterThan(10);
  for(const f of t.flights){expect(syncFlightAt(f,f.duration).distanceTo(f.end)).toBeLessThan(1e-9);}
});
it('先頭セットの配置や位置指定を、指定のない別セットへ引き継がない',()=>{
  const s=structuredClone(SEQUENCE_EXAMPLES[9]);
  const inline=s.sets.findIndex(r=>r.motion.arrangement==='inline');s.sets.push(...s.sets.splice(0,inline));
  const box=s.sets.findIndex(r=>!r.motion.transition&&r.motion.arrangement!=='inline');s.sets[box].motion={};
  const result=compileSequence(s);expect(result.analysis.ok).toBe(true);
  expect(result.config!.sets![box]).toMatchObject({arrangement:'columns',columns:'normal',short:['normal']});
  expect(result.config!.sets![box].columnMotion).toBeUndefined();
});
it('In-lineに4xや個別の位置指定を与えても、無視して再生しない',()=>{
  const s=sequenceFromPreset('inline');s.sets=[{...s.sets[0],throws:['4x','2x']}];
  expect(analyzeSequence(s).ok).toBe(true);expect(compileSequence(s).analysis.ok).toBe(false);
  const custom=sequenceFromPreset('inline');custom.sets[0].motion.hands=[{heightOffset:.1}];
  expect(compileSequence(custom).analysis.ok).toBe(false);
});
it('2Tは同じ手へ飛び、続く2では同じ球を持ったまま運ぶ',()=>{
  const s=SEQUENCE_EXAMPLES[10],compiled=compileSequence(s),t=build(compiled.config);
  expect(compiled.analysis.notation).toContain('2T');expect(compiled.config!.siteswap).toContain('2A');
  const self=t.flights.filter(f=>f.value===2&&f.throwHand===f.catchHand);
  expect(self.length).toBe(2);expect(t.flights.filter(f=>f.value===2&&f.throwHand!==f.catchHand).length).toBe(2);
  const mod=(v:number)=>((v%t.period)+t.period)%t.period;
  for(const f of self){
    expect(f.start.x*f.end.x).toBeLessThan(0);expect(Math.abs(f.start.x-f.end.x)).toBeGreaterThan(.15);
    const next=t.flights.filter(n=>n.prop===f.prop).sort((a,b)=>mod(a.release-f.release-f.duration)-mod(b.release-f.release-f.duration))[0];
    expect(mod(next.release-f.release)).toBeCloseTo(4*s.beatDuration);
    for(let k=0;k<t.numSteps;k++)if(mod(k*t.stepDuration-f.release-f.duration)<mod(next.release-f.release-f.duration)-1e-8){
      expect(t.owners[f.prop][k]).toBe(f.catchHand);expect(t.inAir[f.prop][k]).toBe(false);
    }
  }
  for(const f of t.flights.filter(f=>f.value===4))expect(f.start.x).toBeCloseTo(f.end.x,9);
});
it('Broken Boxは左右の手が同じ側の異なる縦コラムを担当する',()=>{
  const t=build(compileSequence(SEQUENCE_EXAMPLES[11]).config),columns=t.flights.filter(f=>f.value===4);
  expect(new Set(columns.map(f=>f.throwHand)).size).toBe(2);
  for(const f of columns){expect(f.start.x).toBeGreaterThan(0);expect(f.end.x).toBeCloseTo(f.start.x,9);expect(f.throwHand).toBe(f.catchHand);}
  expect(Math.abs(columns[0].start.x-columns[1].start.x)).toBeGreaterThan(.12);
  expect(columns.some(f=>f.motion.catch.relation==='underarm')).toBe(true);
});
it.each([10,12])('見本%sの2Tは反対の空の手の上を通る',index=>{
  const t=build(compileSequence(SEQUENCE_EXAMPLES[index]).config);
  for(const f of t.flights.filter(f=>f.value===2&&f.throwHand===f.catchHand)){
    const k=Math.round(f.passage.time/t.stepDuration)%t.numSteps;
    const other=t.hands[1-f.throwHand];
    expect(other.holding[k]).toBe(false);
    expect(f.passage.position.y-other.positions[k].y).toBeGreaterThan(.05);
    expect(Math.hypot(f.passage.position.x-other.positions[k].x,f.passage.position.z-other.positions[k].z)).toBeLessThan(.06);
  }
});
it('Swap Boxの同時パスは、飛行中の6の下を通る',()=>{
  const s=SEQUENCE_EXAMPLES[3],t=build(compileSequence(s).config);
  const mod=(v:number)=>((v%t.period)+t.period)%t.period;
  for(const high of t.flights.filter(f=>f.value===6)){
    const passes=t.flights.filter(f=>f.value===2&&Math.abs(mod(f.release-high.release)-2*s.beatDuration)<1e-7);
    expect(passes.length).toBe(2);
    for(const pass of passes)expect(syncFlightAt(pass,pass.duration/2).y).toBeLessThan(syncFlightAt(high,2*s.beatDuration+pass.duration/2).y-.03);
  }
});
it('Karasは2Tで交差と解除を往復し、Bizarreの保持と区別できる',()=>{
  const s=SEQUENCE_EXAMPLES[12],a=analyzeSequence(s),t=build(compileSequence(s).config);
  expect(a.movementSets).toBe(6);expect(a.canonical).not.toBe(analyzeSequence(SEQUENCE_EXAMPLES[10]).canonical);
  const self=t.flights.filter(f=>f.value===2&&f.throwHand===f.catchHand);
  expect(self.length).toBe(4);
  for(const h of [0,1]){
    const own=self.filter(f=>f.throwHand===h);expect(own.length).toBe(2);
    expect((own[0].end.x-own[0].start.x)*(own[1].end.x-own[1].start.x)).toBeLessThan(0);
    expect(own.some(f=>f.motion.release.relation==='underarm')).toBe(true);
    expect(own.some(f=>f.motion.catch.relation==='underarm')).toBe(true);
  }
  for(const f of t.flights.filter(f=>f.value===4))expect(f.start.x).toBeCloseTo(f.end.x,9);
});
it('Burst Boxは縦コラムを保ち、左右それぞれのBrokenを横パスでつなぐ',()=>{
  const s=SEQUENCE_EXAMPLES[13],a=analyzeSequence(s),t=build(compileSequence(s).config);
  expect(a.movementSets).toBe(6);expect(a.identitySets).toBe(6);
  const columns=t.flights.filter(f=>f.value===4).sort((a,b)=>a.release-b.release);
  const xs=[-.04,-.20,.20,.04,.20,-.20];
  columns.forEach((f,i)=>{expect(f.start.x).toBeCloseTo(xs[i]*transform.horizontalScale,9);expect(f.end.x).toBeCloseTo(f.start.x,9);});
  for(const f of t.flights.filter(f=>f.value===2))expect(f.start.x*f.end.x).toBeLessThan(0);
  expect(columns.filter(f=>f.motion.release.relation==='underarm').length).toBe(2);
  expect(columns.filter(f=>f.motion.catch.relation==='underarm').length).toBe(2);
});
it('Penmanは保持球で降下中の内側コラムを越え、外側へ回してから渡す',()=>{
  const s=SEQUENCE_EXAMPLES[14],a=analyzeSequence(s),t=build(compileSequence(s).config);
  expect(a.movementSets).toBe(4);expect(a.identitySets).toBe(4);
  expect(t.flights.filter(f=>f.value===2).length).toBe(2);
  for(const f of t.flights.filter(f=>f.value===4))expect(f.start.x).toBeCloseTo(f.end.x,9);
  const mod=(v:number)=>((v%t.period)+t.period)%t.period;
  const flourishes=t.transitions.filter(c=>c.kind==='carry'&&c.route.via?.length===2);
  expect(flourishes.length).toBe(2);
  for(const c of flourishes){
    const prop=t.owners.findIndex(owners=>owners[Math.round(c.from/t.stepDuration)%t.numSteps]===c.hand);
    expect(prop).toBeGreaterThanOrEqual(0);
    const sign=c.hand===0?-1:1;
    const inner=t.flights.find(f=>f.value===4&&f.throwHand===c.hand&&f.motion.release.relation!=='underarm')!;
    const outer=t.flights.find(f=>f.value===4&&f.throwHand!==c.hand&&f.motion.release.relation==='underarm')!;
    let over=false,outside=false;
    for(let k=0;k<t.numSteps;k++){
      const time=k*t.stepDuration;
      if(mod(time-c.from)>=c.duration-1e-8)continue;
      expect(t.owners[prop][k]).toBe(c.hand);expect(t.inAir[prop][k]).toBe(false);
      const p=t.props[prop][k],ti=mod(time-inner.release),to=mod(time-outer.release);
      if(ti<inner.duration){const q=syncFlightAt(inner,ti);over ||= p.y>q.y+.07&&Math.abs(p.x-q.x)<.04&&Math.abs(p.z-q.z)<.11;}
      if(to<outer.duration){const q=syncFlightAt(outer,to);outside ||= (p.x-q.x)*sign>.035&&p.y<q.y-.05;}
    }
    expect(over).toBe(true);expect(outside).toBe(true);
  }
});
it('Underarm Boxは腕の下から投げた手を戻し、縦球を腕の下では捕らない',()=>{
  const s=SEQUENCE_EXAMPLES[15],a=analyzeSequence(s),t=build(compileSequence(s).config);
  expect(a.movementSets).toBe(4);expect(a.identitySets).toBe(4);
  const columns=t.flights.filter(f=>f.value===4),under=columns.filter(f=>f.motion.release.relation==='underarm');
  expect(columns.length).toBe(4);expect(under.length).toBe(2);
  expect(columns.some(f=>f.motion.catch.relation==='underarm')).toBe(false);
  for(const f of columns)expect(f.end.x).toBeCloseTo(f.start.x,9);
  for(const f of under){
    expect(f.throwHand).not.toBe(f.catchHand);
    const pass=t.flights.find(p=>p.value===2&&Math.abs(p.release-f.release)<1e-8)!;
    expect(pass.catchHand).toBe(f.throwHand);
    expect(pass.end.x*f.start.x).toBeLessThan(0);
  }
});
it('Gilliganは内から外へのファウンテン、腕の下の捕球、保持で戻る局面を持つ',()=>{
  const s=SEQUENCE_EXAMPLES[16],a=analyzeSequence(s),t=build(compileSequence(s).config);
  expect(a.movementSets).toBe(6);expect(a.identitySets).toBe(6);
  const columns=t.flights.filter(f=>f.value===4);
  expect(columns.length).toBe(6);expect(t.flights.filter(f=>f.value===2).length).toBe(4);
  for(const f of columns){
    const side=f.throwHand===0?-1:1;
    expect((f.end.x-f.start.x)*side).toBeGreaterThan(.12);
    expect(f.start.x*f.end.x).toBeGreaterThan(0);
  }
  const catches=columns.filter(f=>f.motion.catch.relation==='underarm');expect(catches.length).toBe(2);
  const mod=(v:number)=>((v%t.period)+t.period)%t.period;
  for(const f of catches){
    expect(f.catchHand).not.toBe(f.throwHand);
    const caught=mod(f.release+f.duration);
    const next=t.flights.filter(n=>n.prop===f.prop).sort((x,y)=>mod(x.release-caught)-mod(y.release-caught))[0];
    expect(mod(next.release-caught)).toBeGreaterThan(2*s.beatDuration);
    expect(next.start.x*f.end.x).toBeLessThan(0);
    for(let k=0;k<t.numSteps;k++)if(mod(k*t.stepDuration-caught)<mod(next.release-caught)-1e-8){
      expect(t.owners[f.prop][k]).toBe(f.catchHand);expect(t.inAir[f.prop][k]).toBe(false);
    }
  }
});
it('4球Boxは同じ向きに2回ずつ渡し、6を内から外へ回す',()=>{
  const s=SEQUENCE_EXAMPLES[17],a=analyzeSequence(s),t=build(compileSequence(s).config);
  expect(a.balls).toBe(4);expect(a.movementSets).toBe(4);expect(a.identitySets).toBe(8);
  const passes=t.flights.filter(f=>f.value===2).sort((x,y)=>x.release-y.release);
  expect(passes.map(f=>f.throwHand)).toEqual([1,1,0,0,1,1,0,0]);
  for(const f of t.flights.filter(f=>f.value===6)){
    expect(f.catchHand).toBe(f.throwHand);
    expect((f.end.x-f.start.x)*(f.throwHand===0?-1:1)).toBeGreaterThan(.20);
  }
});
it('Stacked Boxは同じ縦線の8と4が同時に頂点へ達する',()=>{
  const s=SEQUENCE_EXAMPLES[18],a=analyzeSequence(s),t=build(compileSequence(s).config);
  expect(a.balls).toBe(4);expect(a.movementSets).toBe(4);expect(a.identitySets).toBe(4);
  for(const high of t.flights.filter(f=>f.value===8)){
    const low=t.flights.find(f=>f.value===4&&f.throwHand===high.throwHand)!;
    expect(low.release-high.release).toBeCloseTo(2*s.beatDuration,9);
    expect(high.release+high.duration/2).toBeCloseTo(low.release+low.duration/2,9);
    expect(high.start.x).toBeCloseTo(high.end.x,9);expect(low.start.x).toBeCloseTo(low.end.x,9);
    expect(low.start.x).toBeCloseTo(high.start.x,9);
    expect(syncFlightAt(high,high.duration/2).y-syncFlightAt(low,low.duration/2).y).toBeGreaterThan(.8);
  }
});
it('Synchronous Pistonsは同時に上がる2組が交互に並ぶ4本の縦線',()=>{
  const s=SEQUENCE_EXAMPLES[19],a=analyzeSequence(s),t=build(compileSequence(s).config);
  expect(a.balls).toBe(4);expect(a.movementSets).toBe(2);expect(a.identitySets).toBe(2);
  const columns=[...t.flights].sort((x,y)=>x.start.x-y.start.x),first=Math.min(...columns.map(f=>f.release));
  expect(columns.length).toBe(4);
  expect(columns.map(f=>Math.abs(f.release-first)<1e-9?0:1)).toEqual([0,1,0,1]);
  for(const f of columns){expect(f.value).toBe(4);expect(f.catchHand).toBe(f.throwHand);expect(f.start.x).toBeCloseTo(f.end.x,9);}
});
it('Wimpyは同時の4xを反対の手へ渡し、中央で高さを分ける',()=>{
  const s=SEQUENCE_EXAMPLES[20],a=analyzeSequence(s),t=build(compileSequence(s).config);
  expect(a.balls).toBe(4);expect(a.movementSets).toBe(1);expect(a.identitySets).toBe(4);
  for(const left of t.flights.filter(f=>f.throwHand===0)){
    const right=t.flights.find(f=>f.throwHand===1&&Math.abs(f.release-left.release)<1e-9)!;
    for(const f of [left,right]){expect(f.value).toBe(4);expect(f.catchHand).toBe(1-f.throwHand);expect(f.start.x*f.end.x).toBeLessThan(0);}
    const cross=-left.start.x/left.velocity.x,p=syncFlightAt(left,cross),q=syncFlightAt(right,cross);
    expect(p.x).toBeCloseTo(q.x,9);expect(p.z).toBeCloseTo(q.z,9);expect(p.y-q.y).toBeGreaterThan(.1);
  }
});
describe.each(SYNC_BOX_PRESETS)('$id: 見本をセットへ分解',p=>{
  it('元の球・手の軌道を保持する',()=>{
    const sequence=sequenceFromPreset(p.id),compiled=compileSequence(sequence);
    expect(compiled.analysis.ok,JSON.stringify(compiled.analysis)).toBe(true);
    const before=build(p),after=build(compiled.config);
    expect(after.period).toBeCloseTo(before.period,9);
    expect(after.props.length).toBe(before.props.length);
    for(let i=0;i<before.numSteps;i++){
      before.props.forEach((b,j)=>expect(after.props[j][i].distanceTo(b[i]),`${p.id} ball ${j} frame ${i}`).toBeLessThan(1e-9));
      before.hands.forEach((h,j)=>expect(after.hands[j].positions[i].distanceTo(h.positions[i]),`${p.id} hand ${j} frame ${i}`).toBeLessThan(1e-9));
    }
  });
});
describe.each(SEQUENCE_EXAMPLES)('$name: 接続した周期',s=>{
  it('同じ球を保持したまま、境目と飛行を連続させる',()=>{
    const {config,analysis}=compileSequence(s);expect(analysis.ok).toBe(true);
    const t=build(config);
    expect(t.period/(2*s.beatDuration)).toBeCloseTo(analysis.identitySets);
    for(let k=0;k<t.numSteps;k++){
      for(const positions of [...t.props,...t.hands.map(h=>h.positions)])expect(positions[k].distanceTo(positions[(k+1)%t.numSteps])/t.stepDuration).toBeLessThan(12);
      for(let p=0;p<t.props.length;p++)if(t.owners[p][k]>=0)expect(t.props[p][k].distanceTo(t.hands[t.owners[p][k]].positions[k])).toBeLessThan(1e-10);
    }
    expect(inspectSyncBox(t,transform).geometryOK,JSON.stringify(inspectSyncBox(t,transform))).toBe(true);
  });
});
