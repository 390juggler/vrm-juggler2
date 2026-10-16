import { describe, expect, it } from 'vitest';
import { CreateSiteswap } from '../src/motion/juggling/Siteswap';
import { makeTransform, sampleTrack, GRAVITY } from '../src/motion/juggling/tracks';
import { buildSyncBoxTracks, inspectSyncBox, SYNC_BOX_PRESETS, SYNC_BEAT, SYNC_DWELL, SYNC_RADIUS, syncBeat, syncDwell, syncFlightAt, SyncBoxConfig } from '../src/motion/juggling/sync-box';
import * as THREE from 'three';
import Juggling from '../src/motion/juggling';
import Options from '../src/options';
import {shortDefinition} from '../src/motion/juggling/sync-motion';
import {movementCandidates} from '../src/motion/juggling/sync-movement-planner';
import {captureSyncTracks} from '../src/motion/juggling/sync-replay';

const metrics = { shoulderY: 1.403, shoulderX: 0.137, shoulderZ: 0.021, upperArmLength: 0.278, armLength: 0.533 };
const transform = makeTransform(metrics);
function build(config: SyncBoxConfig) {
  const source = CreateSiteswap(config.siteswap, {
    beatDuration: syncBeat(config), dwellRatio: syncDwell(config),
    props: [{ type: 'ball', color: 'random', radius: SYNC_RADIUS, C: 0.9 }],
    dwellPath: '(30,10)(10)', armAngle: 0.3,
    surfaces: [{ position: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, scale: 5 }],
    jugglers: [{ position: { x: 0, z: 0 }, rotation: 0, color: 'grey' }], startingHand: 'RIGHT',
  });
  expect(source.errorMessage).toBeUndefined();
  return buildSyncBoxTracks(source, transform, config);
}

it.each([false,true])('keeps alternating cross order as exact replay events (mirror=%s)',mirror=>{
 const config={...SYNC_BOX_PRESETS.find(p=>p.id==='crossed-alternate')!,mirror};
 const tracks=build(config),source=captureSyncTracks(tracks,syncBeat(config),SYNC_RADIUS);
 expect(new Set(tracks.armOrderEvents!.map(e=>e.upperHand)).size).toBe(2);
 for(const event of tracks.armOrderEvents!){
  const expected=Math.floor(event.time/(2*syncBeat(config)))%2;
  expect(event.upperHand).toBe(mirror?1-expected:expected);
  expect(source.sample(event.time).armOrder).toBe(event.upperHand);
  expect(source.sample(0).constraintPhases).toContain(event.time/tracks.period);
  expect(source.sample(event.time+.001).armOrder).toBeNull();
 }
 const pinned=build({...config,sets:[{armOrder:'alternate',armPhase:1},{armOrder:'alternate',armPhase:0}]});
 pinned.armOrderEvents!.forEach((e,i)=>expect(e.upperHand).toBe(1-tracks.armOrderEvents![i].upperHand));
});

describe.each(SYNC_BOX_PRESETS)('$name', config => {
  const tracks = build(config);
  it('3球が別々の担当を保ち、球と手が届く空間で衝突しない', () => {
    const report = inspectSyncBox(tracks, transform);
    expect(report.geometryOK, JSON.stringify({ id: config.id, ...report })).toBe(true);
    for (let s = 0; s < tracks.numSteps; s++) for (let p = 0; p < 3; p++) {
      expect(tracks.props[p][s].toArray().every(Number.isFinite)).toBe(true);
      const owner = tracks.owners[p][s];
      if (owner >= 0) expect(tracks.props[p][s].distanceTo(tracks.hands[owner].positions[s])).toBeLessThan(1e-9);
    }
  });
  it('飛行は重力に従い、投げと取りで手と球が接続する', () => {
    for (const f of tracks.flights) {
      expect(syncFlightAt(f, f.duration).distanceTo(f.end)).toBeLessThan(1e-8);
      for (const [time, hand, point] of [[f.release, f.throwHand, f.start], [f.release + f.duration, f.catchHand, f.end]] as const) {
        const phase = (time % tracks.period) / tracks.stepDuration;
        expect(sampleTrack(tracks.hands[hand].positions, phase, new THREE.Vector3()).distanceTo(point)).toBeLessThan(0.002);
        expect(sampleTrack(tracks.props[f.prop], phase, new THREE.Vector3()).distanceTo(point)).toBeLessThan(0.002);
      }
      const t = f.duration * 0.4, h = f.duration * 0.1;
      const accel = syncFlightAt(f, t + h).add(syncFlightAt(f, t - h)).addScaledVector(syncFlightAt(f, t), -2).divideScalar(h * h);
      expect(accel.distanceTo(new THREE.Vector3(0, -GRAVITY, 0))).toBeLessThan(1e-8);
      if (f.style === 'column' || f.style.startsWith('vertical-')) {
        expect(Math.hypot(f.end.x - f.start.x, f.end.z - f.start.z)).toBeLessThan(1e-8);
      }
      if (f.value === 2) expect(f.throwHand).not.toBe(f.catchHand);
      expect(f.duration).toBeLessThan(f.value * SYNC_BEAT);
      if (f.style === 'vertical-down') expect(f.velocity.y).toBeCloseTo(0, 8);
    }
  });
  it('周期の境界を含め球と手に瞬間移動がない', () => {
    for (const points of [...tracks.props, ...tracks.hands.map(h => h.positions)]) {
      for (let k = 0; k < tracks.numSteps; k++)
        expect(points[k].distanceTo(points[(k + 1) % tracks.numSteps]) / tracks.stepDuration).toBeLessThan(12);
    }
  });
  it('手を返す途中も、指と手のひらの向きが直交して連続する', () => {
    for (const hand of tracks.hands) for (let k = 0; k < tracks.numSteps; k++) {
      expect(Math.abs(hand.palmNormals[k].dot(hand.fingerDirs![k]))).toBeLessThan(1e-8);
      for (const vectors of [hand.palmNormals, hand.fingerDirs!])
        expect(vectors[k].angleTo(vectors[(k+1)%tracks.numSteps]) / tracks.stepDuration).toBeLessThan(85);
    }
  });
  it('左右反転で球の軌道と担当する手が対応する', () => {
    const mirrored = build({ ...config, mirror: true });
    for (let k = 0; k < tracks.numSteps; k += 7) {
      for (let p = 0; p < 3; p++) {
        expect(tracks.props[p][k].clone().multiply(new THREE.Vector3(-1, 1, 1)).distanceTo(mirrored.props[p][k])).toBeLessThan(1e-8);
        const owner = tracks.owners[p][k];
        expect(mirrored.owners[p][k]).toBe(owner < 0 ? -1 : 1 - owner);
      }
    }
  });
});

describe.each(SYNC_BOX_PRESETS.filter(c=>c.arrangement==='inline'))('$name: 縦一列の意味', config=>{
  it.each([false,true])('保持・飛行の全周期で3球が同じ縦線上にあり、上下順を保つ (mirror=%s)', mirror=>{
    const t=build({...config,mirror});
    const ranks=t.props.map((p,i)=>({i,y:p[0].y})).sort((a,b)=>a.y-b.y).map(p=>p.i);
    for(let k=0;k<t.numSteps;k++){
      const balls=t.props.map(p=>p[k]);
      expect(Math.max(...balls.map(p=>p.x))-Math.min(...balls.map(p=>p.x))).toBeLessThan(1e-10);
      expect(Math.max(...balls.map(p=>p.z))-Math.min(...balls.map(p=>p.z))).toBeLessThan(1e-10);
      expect(balls[0].x).toBeCloseTo(0,10);
      expect(balls[0].z).toBeCloseTo(-.30*transform.horizontalScale,10);
      for(let i=1;i<3;i++)expect(balls[ranks[i]].y-balls[ranks[i-1]].y).toBeGreaterThan(2*SYNC_RADIUS);
    }
    const short=t.flights.find(f=>f.value===2)!;
    expect(ranks.indexOf(short.prop)).toBe(config.short[0]==='inverted'?2:1);
  });
  it('保持中の球を列から外す編集を拒否する',()=>{
    const changed=structuredClone(config);
    changed.shortMotions![0].definition!.carry={route:'front',amount:.1};
    expect(()=>build(changed)).toThrow('保持中の球も縦一列');
  });
  it('自由経由位置でも保持球を縦一列から外さない',()=>{
    const changed=structuredClone(config);
    changed.shortMotions![0].definition!.carry={route:'direct',amount:0,offset:[0,0,.04]};
    expect(()=>build(changed)).toThrow('保持中の球も縦一列');
    const tracks=build({...config,arrangement:'columns',sets:[{arrangement:'inline'},{arrangement:'inline'}]});
    let count=0;
    for(const interval of tracks.transitions){
      const candidates=movementCandidates(tracks,(interval.from+interval.duration/2)/tracks.period,[]);
      count+=candidates.length;
      for(const plan of candidates)for(const move of plan)
        expect(tracks.transitions.find(s=>s.hand===move.hand&&s.from===move.from)!.kind).toBe('empty');
    }
    expect(count).toBeGreaterThan(0);
  });
});

describe('通常コラムで2側を組み合わせる', () => {
  const styles = ['normal', 'shuffle', 'reverse', 'inverted'] as const;
  for (const outward of styles) for (const returning of styles) {
    it(`${outward} / ${returning}: 3球と到達範囲を保つ`, () => {
      const tracks = build({ ...SYNC_BOX_PRESETS[0], id: 'custom', short: [outward, returning] });
      expect(inspectSyncBox(tracks, transform).geometryOK).toBe(true);
    });
  }
});

it('2側の四種が同じサイトスワップでも異なる動作になる', () => {
  const levels: Record<string, [boolean, boolean]> = { box: [false, false], shuffle: [true, false], reverse: [false, true], inverted: [true, true] };
  for (const [id, expected] of Object.entries(levels)) {
    const t = build(SYNC_BOX_PRESETS.find(p => p.id === id)!);
    const floor = t.flights.find(f => f.value === 4)!.start.y;
    t.flights.filter(f => f.value === 2).forEach(f => {
      expect([f.start.y > floor + 0.2, f.end.y > floor + 0.2]).toEqual(expected);
    });
  }
});

it('スイッチドはコラムだけを反対の手が担当し、クロスとは手の移動が異なる', () => {
  const switched = build(SYNC_BOX_PRESETS.find(p => p.id === 'switched')!);
  switched.flights.filter(f => f.value === 4).forEach(f => expect(f.start.x * (f.throwHand === 0 ? -1 : 1)).toBeLessThan(0));
  for (const h of switched.hands) {
    expect(Math.min(...h.positions.map(p => p.x))).toBeLessThan(-0.1);
    expect(Math.max(...h.positions.map(p => p.x))).toBeGreaterThan(0.1);
  }
});

it('不正な同期指定を拒否しても直前の動作を保ち、通常版にも戻れる', () => {
  const options = new Options().siteswap;
  const juggling = new Juggling(new THREE.Scene(), '3', options);
  const config = SYNC_BOX_PRESETS[0];
  const syncOptions = { ...options, syncBox: config, dwellRatio: SYNC_DWELL,
    props: [{ type:'ball', color:'red', radius:SYNC_RADIUS, C:0.9 }] };
  expect(juggling.setPattern(config.siteswap,syncOptions).ok).toBe(true);
  juggling.seek(.27);
  juggling.update(0);
  const before = juggling.getMotionSnapshot();
  expect(juggling.setPattern('3',syncOptions).ok).toBe(false);
  expect(juggling.setPattern(config.siteswap,{...syncOptions,syncBox:{...config,short:[]}}).ok).toBe(false);
  expect(juggling.getMotionSnapshot()).toEqual(before);
  expect(juggling.currentSiteswap).toBe(config.siteswap);
  expect(juggling.setPattern('3',options).ok).toBe(true);
  expect(juggling.getSyncBoxReport()).toBeNull();
  expect(juggling.update(0).ballPositions).toBeUndefined();
  juggling.dispose();
});

it('捕ってからの運びを変えても、投げた球の経路は変わらない', () => {
  const config=SYNC_BOX_PRESETS[0];
  const a=build({...config,shortMotions:[{carry:'direct'}]});
  const b=build({...config,shortMotions:[{carry:'front'}]});
  a.flights.forEach((f,i)=>{
    expect(syncFlightAt(f,f.duration*.37).distanceTo(syncFlightAt(b.flights[i],f.duration*.37))).toBeLessThan(1e-9);
  });
  const carries=b.transitions.filter(t=>t.kind==='carry');
  expect(carries.some(t=>a.transitions.find(s=>s.hand===t.hand && s.from===t.from)!.via.distanceTo(t.via)>.04)).toBe(true);
});

it('放物線上にない通過点と、時刻が逆転する運びは拒否する', () => {
  const definition=shortDefinition('normal',{},false,false);
  definition.passage.point=[0,2,0];
  expect(()=>build({...SYNC_BOX_PRESETS[0],shortMotions:[{definition}]})).toThrow('放物線上');
  delete definition.passage.point;
  definition.emptyReturn={route:'front',amount:.1,via:[{at:.8,offset:[0,0,0]},{at:.2,offset:[0,0,0]}]};
  expect(()=>build({...SYNC_BOX_PRESETS[0],shortMotions:[{definition}]})).toThrow('時刻順');
});

it('3種類以上の指定も省略せず、色と手の担当がつながる周期に展開する', () => {
  const tracks=build({...SYNC_BOX_PRESETS[0],short:['normal','shuffle','reverse'],shortMotions:[{carry:'front'},{carry:'back'}]});
  const shorts=tracks.flights.filter(f=>f.value===2).sort((a,b)=>a.release-b.release);
  expect(new Set(shorts.map(f=>f.style))).toEqual(new Set(['normal','shuffle','reverse']));
  expect(new Set(shorts.map(f=>f.motion.carry.route))).toEqual(new Set(['front','back']));
  expect(tracks.period).toBeCloseTo(SYNC_BEAT*12);
  for(const path of tracks.props)expect(path[0].distanceTo(path[path.length-1])/tracks.stepDuration).toBeLessThan(12);
});

it('縦2xの外側・中央・反対側と、lateralの担当を区別する', () => {
  for(const id of ['outside-vertical-up','vertical-up','cross-side-vertical-up']){
    const tracks=build(SYNC_BOX_PRESETS.find(p=>p.id===id)!);
    const f=tracks.flights.find(f=>f.value===2)!;
    const x=f.start.x*(f.throwHand===0?-1:1);
    if(id==='outside-vertical-up')expect(x).toBeGreaterThan(.15);
    if(id==='vertical-up')expect(Math.abs(x)).toBeLessThan(.08);
    if(id==='cross-side-vertical-up')expect(x).toBeLessThan(-.08);
  }
  const lateral=build(SYNC_BOX_PRESETS.find(p=>p.id==='lateral-normal')!);
  for(const f of lateral.flights)expect(Math.sign(f.start.x*(f.throwHand===0?-1:1))).toBe(f.value===4?1:-1);
});

it('上昇中の2xは下向きの手で受け、下降中の球は上向きに受ける', () => {
  for(const id of ['box','vertical-up','cross-side-vertical-up','switched-cross-side-vertical-up']){
    const tracks=build(SYNC_BOX_PRESETS.find(p=>p.id===id)!);
    for(const f of tracks.flights){
      const v=f.velocity.clone().add(new THREE.Vector3(0,-GRAVITY*f.duration,0));
      const palm=sampleTrack(tracks.hands[f.catchHand].palmNormals,(f.release+f.duration)/tracks.stepDuration,new THREE.Vector3());
      expect(palm.dot(v)).toBeLessThan(0);
      expect(Math.sign(palm.y)).toBe(v.y>.1?-1:1);
    }
  }
});

it('4段階の「次の投げ」は、保持する2を挟んでも同じ球の次の投げへつながる', () => {
  const config=SYNC_BOX_PRESETS.find(p=>p.id==='box-roll')!;
  const juggling=new Juggling(new THREE.Scene(),'3',new Options().siteswap);
  expect(juggling.setPattern(config.siteswap,{...new Options().siteswap,syncBox:config,dwellRatio:SYNC_DWELL}).ok).toBe(true);
  const program=juggling.getSyncProgram()!;
  for(const f of program.flights){
    expect(f.carry).toBeDefined();
    const next=program.flights.find(n=>n.prop===f.prop && Math.abs(((f.carry!.from+f.carry!.duration)%program.period)-n.release.time)<1e-8);
    expect(next).toBeDefined();
    expect(f.carry!.end).toEqual(next!.release.position);
  }
  juggling.dispose();
});
