import {it,expect} from 'vitest';
import {sequenceLocationAtPhase,syncCycleFailure} from '../src/motion/juggling/sync-validation';
import {sequenceFromPreset,compileSequence} from '../src/motion/juggling/sync-sequence';
import {buildSyncBoxTracks,inspectSyncBox,syncBeat,syncDwell,SYNC_RADIUS} from '../src/motion/juggling/sync-box';
import {CreateSiteswap} from '../src/motion/juggling/Siteswap';
import {makeTransform} from '../src/motion/juggling/tracks';
import Options from '../src/options';
import type {ArmCyclePlanInfo} from '../src/motion/inspection';

it('球と手が重なる列では、拒否した列の時刻と問題を返す',()=>{
  const s=sequenceFromPreset('box');
  for(const row of s.sets){
    const d={release:{x:0,y:0,z:-.3},catch:{x:0,y:0,z:-.3},passage:{at:.5},carry:{route:'direct' as const,amount:0}};
    row.motion.columnMotion=structuredClone(d);row.motion.shortMotions=[{definition:structuredClone(d)}];
  }
  const c=compileSequence(s).config!,transform=makeTransform({shoulderY:1.403,shoulderX:.137,shoulderZ:.021,upperArmLength:.278,armLength:.533});
  const source=CreateSiteswap(c.siteswap,{...new Options().siteswap,beatDuration:syncBeat(c),dwellRatio:syncDwell(c),props:[{type:'ball',color:'red',radius:SYNC_RADIUS,C:.9}]});
  const g=inspectSyncBox(buildSyncBoxTracks(source,transform,c),transform),failure=syncCycleFailure(g);
  expect(g.geometryOK).toBe(false);expect(failure.period).toBeCloseTo(.82);
  expect(failure.issues.map(i=>i.kind)).toContain('ball-spacing');expect(failure.issues.map(i=>i.kind)).toContain('hand-spacing');
  for(const issue of failure.issues){expect(issue.phase).toBeGreaterThanOrEqual(0);expect(issue.phase).toBeLessThan(1);expect(sequenceLocationAtPhase(s,failure.period,issue.phase!)!.rowIndex).toBeGreaterThanOrEqual(0);}
  const relaxed=inspectSyncBox(buildSyncBoxTracks(source,transform,{...c,allowBallContact:true}),transform);
  expect(relaxed.ballContact).toBe(true);expect(relaxed.geometryOK).toBe(false);
  expect(syncCycleFailure(relaxed).issues.map(i=>i.kind)).not.toContain('ball-spacing');
  expect(syncCycleFailure(relaxed).issues.map(i=>i.kind)).toContain('hand-spacing');
});

it('許可した球の接触と、2xの上下の取り違えを区別する',()=>{
  const c=compileSequence(sequenceFromPreset('box')).config!,transform=makeTransform({shoulderY:1.403,shoulderX:.137,shoulderZ:.021,upperArmLength:.278,armLength:.533});
  const source=CreateSiteswap(c.siteswap,{...new Options().siteswap,beatDuration:syncBeat(c),dwellRatio:syncDwell(c),props:[{type:'ball',color:'red',radius:SYNC_RADIUS,C:.9}]});
  const tracks=buildSyncBoxTracks(source,transform,c);
  tracks.props[0][0].copy(tracks.props[1][0]);
  expect(inspectSyncBox(tracks,transform).geometryOK).toBe(false);
  tracks.config={...c,allowBallContact:true};
  expect(inspectSyncBox(tracks,transform)).toMatchObject({geometryOK:true,ballContact:true});
  const flight=tracks.flights.find(f=>f.value===2)!;
  flight.ballOrder=[{at:0,otherProp:(flight.prop+1)%3,height:flight.start.y+.01,above:true}];
  const reversed=inspectSyncBox(tracks,transform);
  expect(reversed.geometryOK).toBe(false);expect(reversed.ballOrderOK).toBe(false);
  expect(syncCycleFailure(reversed).issues.map(i=>i.kind)).toContain('ball-order');
});

it('繰返し行・左右交代・同じ球までの複数周回を編集行へ戻す',()=>{
  const s=sequenceFromPreset('box');s.sets[0].repeat=2;s.mirrorRepeat=true;s.beatDuration=.25;
  // Six expanded sets take three seconds, repeated three times for ball identity.
  expect(sequenceLocationAtPhase(s,9,.75/9)).toMatchObject({rowIndex:0,repeatIndex:1,expandedSet:1,mirrored:false});
  expect(sequenceLocationAtPhase(s,9,.75/9)!.withinSet).toBeCloseTo(.5,12);
  expect(sequenceLocationAtPhase(s,9,1/9)).toMatchObject({rowIndex:1,repeatIndex:0,expandedSet:2,mirrored:false});
  expect(sequenceLocationAtPhase(s,9,1.75/9)).toMatchObject({rowIndex:0,repeatIndex:0,expandedSet:3,mirrored:true});
  expect(sequenceLocationAtPhase(s,9,7.75/9)).toMatchObject({rowIndex:0,repeatIndex:0,expandedSet:3,mirrored:true});
  expect(sequenceLocationAtPhase(s,9,8.75/9)).toMatchObject({rowIndex:1,repeatIndex:0,expandedSet:5,mirrored:true});
});

it('セットの境界と不正な時刻を取り違えない',()=>{
  const s=sequenceFromPreset('box');
  expect(sequenceLocationAtPhase(s,.82,0)).toMatchObject({rowIndex:0,withinSet:0});
  expect(sequenceLocationAtPhase(s,.82,.5)).toMatchObject({rowIndex:1,withinSet:0});
  expect(sequenceLocationAtPhase(s,.82,1)).toMatchObject({rowIndex:0,withinSet:0});
  expect(sequenceLocationAtPhase(s,.82,NaN)).toBeUndefined();
  expect(sequenceLocationAtPhase(s,0,.5)).toBeUndefined();
});

it('腕の検査時刻0を保持し、時刻が不明ならセットを推定しない',()=>{
  const g={period:.82,ballClearance:.05,minHandDistance:.15,maxReachRatio:.9,ownershipConflicts:0} as ReturnType<typeof inspectSyncBox>;
  expect(syncCycleFailure(g,{reason:'no-feasible-pose',phase:0}).issues[0]).toMatchObject({kind:'arm-path',phase:0});
  expect(syncCycleFailure(g,{reason:'unsafe-interpolation',phase:.375}).issues[0]).toMatchObject({kind:'arm-path',phase:.375});
  expect(syncCycleFailure(g,{reason:'no-closed-path'}).issues[0]).not.toHaveProperty('phase');
  expect(syncCycleFailure(g,{phase:NaN}).issues[0]).not.toHaveProperty('phase');
});

it('届かない位置と受け渡しの重複を区別し、入力を変更しない',()=>{
  const g={period:2,ballClearance:.05,minHandDistance:.15,maxReachRatio:1.1,reachPhase:.7,ownershipConflicts:1} as ReturnType<typeof inspectSyncBox>;
  const before=structuredClone(g),r=syncCycleFailure(g);
  expect(r.issues.map(i=>i.kind)).toEqual(['reach','ownership']);expect(r.issues[0].phase).toBe(.7);
  expect(r.issues[1]).not.toHaveProperty('phase');expect(g).toEqual(before);
});

const safeGeometry={period:.82,ballClearance:.05,minHandDistance:.15,maxReachRatio:.9,ownershipConflicts:0} as ReturnType<typeof inspectSyncBox>;
const armDetails=():NonNullable<ArmCyclePlanInfo['details']>=>({clear:[3,6],posture:[{counts:{},clear:9},{counts:{},clear:6}],reachErrors:[0,0],wrists:[],balls:[],
  pair:{requiredClearance:.08,maxClearance:.0664,maxRelatedClearance:.0664,upperHand:0,underarm:false}});

it('腕の間隔の不足を測定値つきで返し、拒否した時刻0を保持する',()=>{
  const plan:ArmCyclePlanInfo={reason:'no-feasible-pose',phase:0,details:armDetails()},before=structuredClone(plan);
  const issue=syncCycleFailure(safeGeometry,plan).issues[0];
  expect(issue).toMatchObject({phase:0,armConstraint:'arm-spacing',armClearance:{sampledMaximum:.0664,required:.08}});
  expect(issue.message).toContain('6.6cm');expect(issue.message).toContain('8.0cm');expect(plan).toEqual(before);
});

it.each([false,true])('両腕の間隔と、指定したクロス・腕下の関係の不成立を区別する (underarm=%s)',underarm=>{
  const details=armDetails();details.pair={...details.pair!,maxClearance:.12,maxRelatedClearance:null,underarm};
  const issue=syncCycleFailure(safeGeometry,{reason:'no-feasible-pose',phase:.25,details}).issues[0];
  expect(issue.armConstraint).toBe('arm-relation');expect(issue.message).toContain(underarm?'腕の下':'左腕');
  expect(issue.armClearance).toBeUndefined();
});

it.each(['reach','posture','ball-arm'] as const)('片腕の制約 %s を腕どうしの接触と区別する',constraint=>{
  const details=armDetails();details.clear[1]=0;details.pair!.maxClearance=null;details.pair!.maxRelatedClearance=null;
  if(constraint==='reach')details.reachErrors[1]=.02;
  if(constraint==='posture')details.posture[1].clear=0;
  const issue=syncCycleFailure(safeGeometry,{reason:'no-feasible-pose',phase:.25,details}).issues[0];
  expect(issue.armConstraint).toBe(constraint);expect(issue.message).toContain('右');expect(issue.armClearance).toBeUndefined();
});

it('経路がつながらない場合には、別時点の姿勢不足の数値を流用しない',()=>{
  const issue=syncCycleFailure(safeGeometry,{reason:'no-continuous-path',phase:.9,details:armDetails()}).issues[0];
  expect(issue.armConstraint).toBe('continuity');expect(issue.armClearance).toBeUndefined();expect(issue.phase).toBe(.9);
});
