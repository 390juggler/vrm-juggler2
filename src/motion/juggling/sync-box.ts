import * as THREE from 'three';
import { GRAVITY, LEFT, RIGHT, SpaceTransform, Tracks, HandTrack, computeGazeTrack } from './tracks';
import { ShortStyle, ShortMotionOptions, ArmOrder, MotionDefinition, CarryDefinition, shortDefinition, handFrame, handRotationBetween, carryOffset, validateDefinition } from './sync-motion';
import { SYNC_SPATIAL_PROFILES } from './sync-spatial-presets';
import {arcPassLanes,ballOrderConstraints,resolveBallOrder,BallOrderConstraint} from './sync-ball-order';
export type { ShortStyle, ShortMotionOptions, MotionDefinition } from './sync-motion';

export type ColumnMode = 'normal' | 'switched' | 'crossed' | 'underarm';
export type HandGrip = 'underhand' | 'overhand';
export interface SyncHandMotion {
  style?: ShortStyle;
  shortMotion?: ShortMotionOptions;
  definition?: MotionDefinition;
  /** Vertical translation of release and catch, in metres. Does not change gravity. */
  heightOffset?: number;
  /** Orientation at this throw's release and at its receiving hand's catch. */
  releaseGrip?: HandGrip;
  catchGrip?: HandGrip;
}
export interface SyncSetMotion {
  profileId?: string;
  profileStep?: number;
  columns?: ColumnMode;
  short?: ShortStyle[];
  shortMotions?: ShortMotionOptions[];
  columnMotion?: MotionDefinition;
  armOrder?: ArmOrder;
  /** Upper hand at this set's release when importing one alternating-cross phase. */
  armPhase?: 0 | 1;
  arrangement?: 'columns' | 'inline';
  /** A transition's endpoint layout. Each flight stays ballistic at this fixed blend. */
  inlineBlend?: number;
  transition?: boolean;
  hands?: [SyncHandMotion?,SyncHandMotion?];
}
export interface SyncBoxConfig {
  id: string;
  name: string;
  siteswap: string;
  short: ShortStyle[];
  columns: ColumnMode;
  description: string;
  source?: string;
  experimental?: boolean;
  mirror?: boolean;
  shortMotions?: ShortMotionOptions[];
  columnMotion?: MotionDefinition;
  armOrder?: ArmOrder;
  arrangement?: 'columns' | 'inline';
  /** Apex above equal-height column release/catch points, in metres. */
  columnRise?: number;
  /** One entry per simultaneous pair. Flights are solved before connecting the hands. */
  sets?: SyncSetMotion[];
  /** Fixed global beat; individual high/low throws keep their own flight durations. */
  beatDuration?: number;
  /** Does not permit ball-arm contact, hand overlap or a reversed passage order. */
  allowBallContact?: boolean;
}

const loj = 'https://libraryofjuggling.com/Tricks/3balltricks/';
const preset = (id: string, name: string, short: ShortStyle[], description: string, extra: Partial<SyncBoxConfig> = {}): SyncBoxConfig =>
  ({ id, name, siteswap: '(4,2x)*', columns: 'normal', short, description, ...extra });

export const SYNC_BOX_PRESETS: SyncBoxConfig[] = [
  preset('box', 'ボックス', ['normal'], '縦のコラムと、下から下への2x。', { source: loj + 'Box.html' }),
  preset('shuffle', "Luke's Shuffle / シャッフル往復", ['shuffle'], '左右とも、2xを上から下へ投げ込む。', { source: loj + "Luke%27sShuffle.html" }),
  preset('n-box', 'N-Box', ['reverse', 'shuffle'], '斜め上の2xと、斜め下の2xを交互に繰り返す。', { source: loj + 'N-Box.html' }),
  preset('reverse', 'リバースシャッフル往復', ['reverse'], '左右とも下から上への2x。組合せ候補。', { experimental: true }),
  preset('inverted', 'インバーテッド', ['inverted'], '高い投げ位置から高い捕球位置へ2xを送る。', { source: loj + 'InvertedBox.html' }),
  preset('switched', 'スイッチド', ['normal'], '反対の手がコラムを担当し、両手が左右へ移動する。', { columns: 'switched', source: loj + 'SwitchedBox.html' }),
  preset('crossed', 'クロス（左腕が上）', ['normal'], '両手が反対側を担当。左腕が上の状態を保つ。', { columns: 'crossed', armOrder:'left-over', experimental: true }),
  preset('underarm', 'アンダーアーム / Threaded Box', ['normal'], 'コラムを反対の腕の下で取り、上の手を外へ運ぶ。', { columns: 'underarm', source: loj + 'ThreadedBox.html' }),
  preset('vertical-up', '中央の縦2x・上投げ', ['vertical-up'], '中央で短い球を真上へ投げ、反対の手が取りに行く。', { experimental: true }),
  preset('vertical-down', '中央の縦2x・下投げ', ['vertical-down'], '中央で短い球を縦に下ろし、反対の手が下で取る。', { experimental: true }),
  preset('shower', '同期シャワー', ['normal'], '高い4xと低い2xを反対向きに送り続ける。', { siteswap: '(4x,2x)', source: loj + 'Shower.html' }),
  preset('shower-shuffle', '同期シャワー × シャッフル', ['shuffle'], '高い4xと上から下への2x。', { siteswap: '(4x,2x)', experimental: true }),
  preset('double-box', 'Double Box', ['normal'], '4xとコラム4の役割を周期内で切り替える。', { siteswap: '(4x,2x)(4,2x)*', source: 'https://henfish.github.io/juggling-database/tricks.html' }),
  preset('box-roll', 'コラムと2の保持 / Box Roll', ['normal'], 'コラム4、2x、保持する2の接続。', { siteswap: '(4,2x)(4,2)*', experimental: true }),
];

// Spatial variants are combinations of independent stages, rather than special-case trajectories.
for (const switched of [false,true]) {
  for (const [style,label] of [['shuffle','Slam'],['reverse','Reverse Slam'],['inverted','Inverted switched']] as const)
    if (switched) SYNC_BOX_PRESETS.push(preset('switched-'+style,label,[style],'反対の手がコラムを担当する'+label+'。',{columns:'switched'}));
  for (const [lane,label] of [['outside','Inside（投げ手と同じ側の外側）'],['center','Center（2本の縦軌道の間）'],['cross-side','Outside（投げ手と反対側の外側）']] as const)
    for (const [style,direction] of [['vertical-up','上投げ'],['vertical-down','下投げ']] as const)
      if(switched || lane!=='center') SYNC_BOX_PRESETS.push(preset(`${switched?'switched-':''}${lane}-${style}`,`${switched?'Switched / ':''}${label}の縦2x・${direction}`,[style],`${label}を通る縦2x。投げと捕球の場所を同じ縦線上に置く。`,{columns:switched?'switched':'normal',shortMotions:[{lane}],experimental:true}));
}
for (const [style,label] of [['normal','Normal'],['shuffle','Shuffle'],['reverse','Reverse'],['inverted','Inverted']] as const)
  SYNC_BOX_PRESETS.push(preset('lateral-'+style,label+' lateral',[style],'2xを投げる手が体の反対側へ入り、そこから送り返す。',{shortMotions:[{lateral:true}],experimental:true}));
SYNC_BOX_PRESETS.push(
  preset('crossed-right','クロス（右腕が上）',['normal'],'右腕が上の状態を保つ。',{columns:'crossed',armOrder:'right-over',experimental:true}),
  preset('crossed-alternate','クロス（上下を交代）',['normal'],'左右の上側を交互に切り替え、間の手の運びもつなぐ。',{columns:'crossed',armOrder:'alternate',experimental:true}),
  preset('short-under-catch','2xを腕の下で捕る',['normal'],'2xの捕球を反対の腕の下に置く。',{shortMotions:[{catchRelation:'underarm'}],experimental:true}),
  preset('short-under-release','2xを腕の下から投げる',['normal'],'2xの投げを反対の腕の下に置く。',{shortMotions:[{releaseRelation:'underarm'}],experimental:true}),
  preset('inline','In-line 3',['normal'],'3球を常に同じ縦線上に保つ。中央の2xと上下の4。空の手だけが列の外を回る。',{arrangement:'inline',columnRise:.24,experimental:true}),
  preset('inline-inverted','In-line 3 / 上の2x（候補）',['inverted'],'3球を常に同じ縦線上に保ち、2xを一番上に置く配置候補。',{arrangement:'inline',columnRise:.24,experimental:true}),
);
for(const config of SYNC_BOX_PRESETS) {
  const profile=SYNC_SPATIAL_PROFILES[config.id];
  if(profile) {
    config.columnMotion=profile.column;
    config.shortMotions=profile.short.map((definition,i)=>({...config.shortMotions?.[i],definition}));
  }
}

export const SYNC_BEAT = 0.205;
export const SYNC_DWELL = 1.25;
export const SYNC_RADIUS = 0.035;
const EPS = 1e-8;
const mod = (n: number, d: number) => {const r=((n%d)+d)%d;return r<EPS || d-r<EPS ? 0 : r;};
const side = (h: number) => h === LEFT ? -1 : 1;
// A vertical stack needs time for the empty hand to pass the intervening levels.
// Release sooner after the catch; do not move a held ball out of the column.
export const syncDwell = (config:SyncBoxConfig & SyncSetMotion) => config.arrangement==='inline' ? .5 :
  SYNC_DWELL+(.5-SYNC_DWELL)*Math.min(1,2*(config.inlineBlend||0));
export function syncBeat(config: SyncBoxConfig) {
  if(config.beatDuration!==undefined){
    if(!Number.isFinite(config.beatDuration)||config.beatDuration<.12||config.beatDuration>.40)
      throw new Error('1拍の時間は0.12〜0.40秒で指定してください。');
    return config.beatDuration;
  }
  const rise=config.columnRise ?? (config.arrangement==='inline' ? .24 : undefined);
  if (rise === undefined) return SYNC_BEAT;
  if (!Number.isFinite(rise) || rise < .24 || rise > .60)
    throw new Error('コラムの上がり幅は24〜60cmで指定してください。');
  return Math.sqrt(8*rise/GRAVITY)/(4-syncDwell(config));
}

export interface SyncFlight {
  prop: number;
  throwHand: number;
  catchHand: number;
  value: number;
  style: ShortStyle | 'column' | 'arc';
  release: number;
  duration: number;
  start: THREE.Vector3;
  end: THREE.Vector3;
  velocity: THREE.Vector3;
  motion: MotionDefinition;
  releaseGrip: HandGrip;
  catchGrip: HandGrip;
  passage: {time:number; position:THREE.Vector3};
  ballOrder?: BallOrderConstraint[];
  /** Endpoint preferences before the relative passage solver moves their heights. */
  preferredStart?:THREE.Vector3;
  preferredEnd?:THREE.Vector3;
}

interface HandEvent {
  time: number;
  p: THREE.Vector3;
  v: THREE.Vector3;
  palm: THREE.Vector3;
  kind: 'release' | 'catch' | 'hold';
  role?: SyncFlight['style'];
  rotation?: THREE.Quaternion;
  carry?: CarryDefinition;
  overhand?: boolean;
  fixedCrossing?: boolean;
  movement?: SyncMovementAdjustment;
}

export interface SyncTransition {
  hand:number;
  kind:'carry' | 'empty';
  from:number;
  duration:number;
  start:THREE.Vector3;
  end:THREE.Vector3;
  via:THREE.Vector3;
  route:CarryDefinition;
}

/** A free intermediate hand position, in metres, with zero displacement and
 * velocity at catch/release. Airborne balls are never affected. */
export interface SyncMovementAdjustment {hand:number;from:number;offset:[number,number,number];via?:CarryDefinition['via']}
/** Adjust free event positions; separate catch offsets are used for hand-offs. */
export interface SyncFlightAdjustment {hand:number;release:number;offset:[number,number,number];endOffset?:[number,number,number];durationScale?:number}

export interface SyncBoxTracks extends Tracks {
  /** Constructive playback can retain measured contacts; it is not a clearance certificate. */
  contactFallback?:boolean;
  /** Free events solved together; persist the resulting definition on registration. */
  constraintPlanned?:boolean;
  constraintSeed?:number[];
  flights: SyncFlight[];
  owners: number[][];
  inAir: boolean[][];
  config: SyncBoxConfig;
  transitions: SyncTransition[];
  armOrders: (number | null)[];
  armOrderEvents?:{time:number;upperHand:number}[];
  underarmEvents: {time:number;hand:number;position:THREE.Vector3}[];
  movement:SyncMovementAdjustment[];
  flightAdjustments:SyncFlightAdjustment[];
  placement:[number,number];
  timing:[number,number];
  columnHeight:number;
}

export function syncFlightAt(f: SyncFlight, time: number): THREE.Vector3 {
  const t = THREE.MathUtils.clamp(time, 0, f.duration);
  const p = f.start.clone().addScaledVector(f.velocity, t);
  p.y -= GRAVITY * t * t / 2;
  return p;
}

function hermite(a: HandEvent, b: HandEvent, t: number, duration: number) {
  const u = t / duration;
  return a.p.clone().multiplyScalar(2 * u ** 3 - 3 * u ** 2 + 1)
    .addScaledVector(a.v, (u ** 3 - 2 * u ** 2 + u) * duration)
    .addScaledVector(b.p, -2 * u ** 3 + 3 * u ** 2)
    .addScaledVector(b.v, (u ** 3 - u ** 2) * duration);
}

// Catch deceleration and release acceleration have short strokes. A single cubic across the
// entire dwell exaggerates those velocities into an arm-length-deep scoop.
function handBetween(a: HandEvent, b: HandEvent, t: number, duration: number, hand: number, scale: number) {
  const ta = Math.min(0.045, duration * 0.22, 0.09 / Math.max(a.v.length(), 1e-6));
  const tb = Math.min(0.045, duration * 0.22, 0.09 / Math.max(b.v.length(), 1e-6));
  const after = { ...a, p: a.p.clone().addScaledVector(a.v, ta / 2), v: new THREE.Vector3() };
  const before = { ...b, p: b.p.clone().addScaledVector(b.v, -tb / 2), v: new THREE.Vector3() };
  const middleT = t - ta, middleDuration = duration - ta - tb;
  const p = t < ta ? hermite(a,after,t,ta) : t > duration-tb ? hermite(before,b,t-duration+tb,tb) : hermite(after, before, middleT, middleDuration);
  const u = THREE.MathUtils.clamp(t/duration,0,1);
  const hump = 16 * u * u * (1 - u) * (1 - u);
  p.add(carryOffset(a.carry || {route:'direct',amount:0},u,side(hand),scale));
  if(a.movement){
    p.addScaledVector(new THREE.Vector3(...a.movement.offset),hump);
    if(a.movement.via)p.add(carryOffset({route:'direct',amount:0,via:a.movement.via},u,1,1));
  }
  // The ordinary outward dodge would uncross a fixed-cross hand on its way
  // to a high catch. Its explicit empty-return route already defines the path.
  if (!a.fixedCrossing && a.kind==='release' && a.role==='column' && Math.abs(a.p.x-b.p.x)<.10*scale && b.p.y>a.p.y+.18*scale)
    p.x+=side(hand)*.13*scale*hump;
  // Empty hands return independently; neither their path nor a held ball bends an airborne ball.
  // Depth routing belongs to the explicit carry/empty-return definition. Adding
  // a second height-dependent weave here used to pull the wrist through the torso.
  return p;
}

function syncLayout(config:SyncBoxConfig & SyncSetMotion,transform:SpaceTransform,placement:[number,number]=[0,0]){
  const scale=transform.horizontalScale;
  const shortOptions=[...(config.shortMotions||[])];
  const ownHands=config.hands||[];
  shortOptions.push(...ownHands.flatMap(h=>h?.shortMotion?[h.shortMotion]:[]));
  const hasUnder=shortOptions.some(m=>m&&(m.releaseRelation==='underarm'||m.catchRelation==='underarm'||m.definition?.release.relation==='underarm'||m.definition?.catch.relation==='underarm'))||
    ownHands.some(h=>h?.definition?.release.relation==='underarm'||h?.definition?.catch.relation==='underarm');
  const low = 1.15 + transform.offsetY + placement[0] + (hasUnder ? .085*scale : config.columns==='crossed' || config.armOrder && config.armOrder!=='none' ? .08*scale : config.columns==='switched' || config.columns==='underarm' ? .025*scale : 0);
  const depth = (config.columns === 'crossed' ? -0.26 : config.columns==='switched' || config.columns==='underarm' ? -.27 : -0.30) * scale;
  const armOrder = config.armOrder || (config.columns === 'crossed' ? 'left-over' : 'none');
  if (!['none','left-over','right-over','alternate'].includes(armOrder) ||
      config.arrangement && !['columns','inline'].includes(config.arrangement)) throw new Error('腕の上下または球の配置を確認してください。');
  const crossing = armOrder !== 'none';
  const switched = config.columns === 'switched' || config.columns === 'underarm';
  const inline = config.arrangement === 'inline';
  const reflectedHand = (h: number) => config.mirror ? 1 - h : h;
  const upperAt = (beatIndex:number) => armOrder === 'right-over' ? RIGHT : armOrder === 'alternate' ? Math.floor(beatIndex/2)%2 : LEFT;
  const point = (hand: number, x: number, y: number, z = depth, beatIndex=0) => {
    if (crossing) { const sign=hand===upperAt(beatIndex)?1:-1; y += sign*.07*scale; z -= sign*.02*scale; }
    return new THREE.Vector3(config.mirror ? -x : x, y, z+placement[1]);
  };
  return {low,depth,armOrder,crossing,switched,inline,reflectedHand,upperAt,point};
}

/** Geometry is chosen before solving ballistic flights. Never clamp a solved column or a hand away from its ball. */
export function buildSyncBoxTracks(source: any, transform: SpaceTransform, config: SyncBoxConfig, movement:SyncMovementAdjustment[]=[],placement:[number,number]=[0,0],timing:[number,number]=[1,1],columnHeight=0,flightAdjustments:SyncFlightAdjustment[]=[]): SyncBoxTracks {
  const styles: ShortStyle[] = ['normal','shuffle','reverse','inverted','vertical-up','vertical-down'];
  if (!config.short?.length || config.short.some(style=>!styles.includes(style)) ||
      !['normal','switched','crossed','underarm'].includes(config.columns))
    throw new Error('同期ボックスの動作指定が不正です。');
  if (!config.sets && source.numProps !== 3) throw new Error('同期ボックスは3ボール用です。');
  if(config.sets && (!config.sets.length||config.sets.length>128))throw new Error('セット数を確認してください。');
  const beat: number = source.beatDuration;
  const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;
  const lcm=(a:number,b:number)=>a*b/gcd(a,b);
  const sequence=lcm(config.sets?.length||1,lcm(config.short.length,config.shortMotions?.length || 1));
  const repeats=lcm(source.states.length,sequence*2)/source.states.length;
  if(repeats>32)throw new Error('動作の組合せが長すぎます。周期を短くしてください。');
  const period = source.states.length * repeats * beat;
  const numSteps: number = source.numSteps * repeats;
  const dt = period / numSteps;
  const scale = transform.horizontalScale;
  const baseConfig=config;
  const setConfigs=(config.sets||[{}]).map(set=>({...config,...set,id:set.profileId||config.id,sets:undefined}));
  const layouts=setConfigs.map(c=>syncLayout(c,transform,placement));
  const atSet=(i:number)=>mod(i,setConfigs.length);
  const {depth,inline,crossing}=syncLayout(config,transform);
  if (inline && ((!config.sets && config.siteswap !== '(4,2x)*') || config.columns !== 'normal' || crossing ||
      !config.short.every(s=>s===config.short[0]) || !['normal','inverted'].includes(config.short[0])))
    throw new Error('In-line 3は通常コラムと、往復ともNormalまたはInvertedの2xで指定してください。');
  const events: HandEvent[][] = [[], []];
  const flights: SyncFlight[] = [];
  const underarmEvents:SyncBoxTracks['underarmEvents']=[];
  const holds: { prop: number; hand: number; from: number; duration: number }[] = [];
  const transitions: SyncTransition[]=[];
  const finishFlights:(()=>void)[]=[];
  const orderedFlights:SyncFlight[]=[];

  const orbits=source.propOrbits.map((orbit:any[])=>Array.from({length:repeats},(_,i)=>orbit.map(t=>({...t,beat:t.beat+i*source.states.length}))).flat());
  orbits.forEach((orbit: any[], prop: number) => orbit.forEach((toss, k) => {
    const step=Math.floor(toss.beat/2),set=atSet(step),config=setConfigs[set];
    const {low,depth,switched,crossing,inline,reflectedHand,point}=layouts[set];
    const next = orbit[(k + 1) % orbit.length];
    const localDwell=baseConfig.sets?syncDwell(config)*beat:toss.dwellDuration;
    const nextConfig=setConfigs[atSet(Math.floor(next.beat/2))];
    const nextDwell=baseConfig.sets?syncDwell(nextConfig)*beat:next.dwellDuration;
    const release = mod(toss.beat * beat + localDwell, period);
    let duration = mod(next.beat * beat - release, period) || period;
    const th = reflectedHand(toss.hand);
    const ch = reflectedHand(next.hand);
    const handMotion=config.hands?.[toss.hand];
    const pinnedArmPhase=config.armOrder==='alternate'&&config.armPhase!==undefined;
    const releaseBeat=pinnedArmPhase?config.armPhase!*2:toss.beat;
    const catchBeat=pinnedArmPhase?releaseBeat+toss.numBeats:next.beat;
    if([handMotion?.releaseGrip,handMotion?.catchGrip].some(g=>g!==undefined&&!['underhand','overhand'].includes(g)))
      throw new Error('手の向きは動作に合わせる、下から支える、上からつかむのいずれかを指定してください。');
    const offset=handMotion?.heightOffset||0;
    if(!Number.isFinite(offset)||Math.abs(offset)>.4)throw new Error('手の高さの変更は±40cm以内にしてください。');
    if (toss.hold) {
      const heldMotion=handMotion?.definition;
      if(heldMotion)validateDefinition(heldMotion);
      if(heldMotion?.catchAtApex||heldMotion?.flightFraction!==undefined)throw new Error('持ったままの2には飛行時間の指定を使えません。');
      const p=heldMotion?point(toss.hand,side(toss.hand)*heldMotion.release.x*scale,low+heldMotion.release.y*scale,heldMotion.release.z*scale,releaseBeat):point(toss.hand,side(toss.hand)*.22*scale,low,undefined,pinnedArmPhase?releaseBeat:0);
      p.y+=offset;
      holds.push({ prop, hand: th, from: mod(toss.beat * beat, period), duration: toss.numBeats * beat });
      // An explicitly positioned hold may cross the body. Turn the fingers
      // with that reach instead of forcing the wrist to face straight ahead.
      const shoulder=transform.shoulders[th];
      const overhand=handMotion?.releaseGrip==='overhand';
      const heldFrame=heldMotion||handMotion?.releaseGrip?handFrame(new THREE.Vector3(),false,overhand,side(th),new THREE.Vector3(p.x-shoulder.x*.75,0,p.z-shoulder.z)): {palm:new THREE.Vector3(0,1,0)};
      events[th].push({ time: release, p, v: new THREE.Vector3(), ...heldFrame, kind: 'hold',carry:heldMotion?.carry,overhand });
      return;
    }
    if (!(baseConfig.sets?[2,4,6,8,10,12]:[2,4]).includes(toss.numBeats)) throw new Error('対応する同期投げを指定してください。');
    const short = toss.numBeats === 2;
    const style: SyncFlight['style'] = short ? handMotion?.style || config.short[step % config.short.length] : th === ch ? 'column' : 'arc';
    const baseOptions=config.shortMotions?.[step%config.shortMotions.length] || {};
    // Choosing a hand's style replaces an imported exact definition of the old
    // style; an explicit per-hand definition still takes priority below.
    const options=handMotion?.shortMotion || (handMotion?.style ? {...baseOptions,definition:undefined} : baseOptions);
    if (options.ballOrder!==undefined&&options.ballOrder!=='style' || options.lane && !['center','outside','cross-side'].includes(options.lane) ||
        [options.releaseRelation,options.catchRelation].some(r=>r!==undefined && !['free','underarm'].includes(r)) ||
        options.carry && !['direct','outside','inside','front','back'].includes(options.carry)) throw new Error('2xの経路・腕の関係・運びを確認してください。');
    const columnWidth=(switched||crossing ? -.16 : .19);
    const motion:MotionDefinition=handMotion?.definition ? structuredClone(handMotion.definition) : short ? shortDefinition(style as ShortStyle,options,switched,crossing) :
      structuredClone(config.columnMotion || {release:{x:columnWidth,y:0,z:depth/scale},passage:{at:.5},
        catch:{x:columnWidth*(toss.hand===next.hand?1:-1),y:0,z:depth/scale},carry:{route:switched||options.lateral?'front':'direct',amount:.06}});
    validateDefinition(motion);
    const resolve=(p:MotionDefinition['release'],h:number,b:number) => point(h,side(toss.hand)*p.x*scale,low+p.y*scale,p.z*scale,b);
    let start=resolve(motion.release,toss.hand,releaseBeat);
    let end=resolve(motion.catch,next.hand,catchBeat);
    if(short&&style.startsWith('vertical-')&&!handMotion?.definition&&!options.definition){
      // Arm-order depth offsets must not tilt a named vertical throw.
      motion.catch.z+=(start.z-end.z)/scale;end.z=start.z;end.x=start.x;
    }
    const adjustment=flightAdjustments.find(a=>a.hand===th&&Math.abs(a.release-release)<1e-7);
    if(adjustment){
      const relative=config.shortMotions?.some(o=>o.ballOrder==='style')||config.hands?.some(h=>h?.shortMotion?.ballOrder==='style')||
        config.short?.some(s=>s.startsWith('vertical-'))&&!config.shortMotions?.some(o=>o.definition);
      if((!config.transition&&!relative)||config.arrangement==='inline'||config.inlineBlend)throw new Error('移行途中または相対指定の投球位置だけを変更できます。');
      if(!config.transition&&!short&&start.x*(start.x+adjustment.offset[0])<0)throw new Error('コラムの担当側を保って位置を変更してください。');
      const endOffset=adjustment.endOffset||adjustment.offset;
      if(!config.transition&&style==='column'&&adjustment.offset.some((v,i)=>Math.abs(v-endOffset[i])>1e-9))throw new Error('コラムの投球位置と捕球位置は一緒に移動してください。');
      start.add(new THREE.Vector3(...adjustment.offset));end.add(new THREE.Vector3(...endOffset));
      for(const [p,delta] of [[motion.release,adjustment.offset],[motion.catch,endOffset]] as const){
        p.x+=delta[0]/(side(th)*scale);p.y+=delta[1]/scale;p.z+=delta[2]/scale;
      }
    }
    start.y+=offset;end.y+=offset;
    if (!short) {
      start.y+=columnHeight;end.y+=columnHeight;
      motion.release.y+=columnHeight/scale;motion.catch.y+=columnHeight/scale;
      if (config.id === 'box-roll') {
        const lane = ((config.profileStep ?? step) % 2 === 0 ? 0.14 : 0.32) * scale;
        start.x = side(th) * lane;
        end.x = side(ch) * lane;
      }
    }
    // A named vertical 2x keeps its lane and height. Only an arcing 2x rises
    // over the under arm to a central catch.
    if (short && config.columns === 'underarm' && !style.startsWith('vertical-')) { start.y+=.24*scale;end.y+=.24*scale;end.x=side(ch)*.025*scale*(options.lateral?-1:1); }
    // Underarm is an event constraint: it can apply to release, catch, or both.
    if (short && motion.release.relation==='underarm' && !handMotion?.definition) { start.x=-side(th)*.18*scale;start.y-=.16*scale;start.z=-.18*scale+placement[1]; }
    if (short && motion.catch.relation==='underarm' && !handMotion?.definition) { end.x=-side(ch)*.18*scale;end.y-=.16*scale;end.z=-.18*scale+placement[1]; }
    const inlineBlend=inline?1:config.inlineBlend||0;
    if (inlineBlend>0) {
      // In-line 3 has one vertical line throughout flight AND possession.
      // The two 4s keep separate vertical ranks. Their closest approach occurs
      // during the overlap of flights, not at either column's apex. The extra
      // gap includes room for catch deceleration / release acceleration below
      // the endpoints, and for the middle 2x when it occupies that rank.
      const columnDuration=(4-.5)*beat;
      const overlapLift=GRAVITY*(2*beat)*(columnDuration-2*beat)/2;
      const columnGap=overlapLift+(config.short[0]==='inverted'?.14:.30);
      const bottom=low-.08*scale;
      const middle=bottom+(columnGap+overlapLift)/2;
      const top=bottom+columnGap;
      const y=short ? config.short[0]==='inverted' ? top+GRAVITY*columnDuration**2/8+.105 : middle : toss.hand===LEFT ? top : bottom;
      const target=new THREE.Vector3(0,y,-.30*scale+placement[1]);
      // Establish the vertical ranks before merging the horizontal lanes. This
      // keeps the lower column clear of the wrist holding the middle ball.
      const verticalBlend=Math.min(1,2*inlineBlend);
      const startY=THREE.MathUtils.lerp(start.y,y,verticalBlend),endY=THREE.MathUtils.lerp(end.y,y,verticalBlend);
      start.lerp(target,inlineBlend);end.lerp(target,inlineBlend);
      start.y=startY;end.y=endY;
      // The short ball changes vertical rank during entry/exit. Move that
      // entire ballistic pass in front of the columns until the rank swap is
      // complete; a flat morph would make the balls pass through each other.
      if(short&&inlineBlend<1){const forward=.22*scale*Math.sin(Math.PI*inlineBlend);start.z-=forward;end.z-=forward;}
      if(short&&inlineBlend<1&&!motion.emptyReturn)motion.emptyReturn={route:'front',amount:.12};
      if (inlineBlend===1 && (motion.carry.route !== 'direct' || [motion.carry.via||[],...(motion.carry.detours||[])].flat().some(v=>v.offset[0]!==0 || v.offset[2]!==0) || motion.carry.offset?.some((v,i)=>i!==1&&v!==0)))
        throw new Error('In-line 3では保持中の球も縦一列です。球を持つ手を横・前後へ運ぶ指定は使えません。');
    }
    // A vertical drop starts with zero vertical speed. Catching need not be simultaneous:
    // both release times stay synchronous, and the remaining part of the interval is the dwell.
    const deadline=mod(next.beat*beat + nextDwell-release,period)||period;
    if (style === 'vertical-down') {
      if(motion.flightFraction!==undefined)throw new Error('下投げの飛行時間は落下する高さで決まります。割合指定を外してください。');
      if (start.y<=end.y) throw new Error('下投げの捕球位置は投げ位置より低くしてください。');
      duration = Math.sqrt(2 * (start.y - end.y) / GRAVITY);
    }
    if(motion.catchAtApex){
      if(style==='vertical-down'||end.y<=start.y)throw new Error('頂点で捕るには、捕球位置を投げ位置より高くしてください。下投げとは併用できません。');
      duration=Math.sqrt(2*(end.y-start.y)/GRAVITY);
    }
    if(motion.flightFraction!==undefined)duration=deadline*motion.flightFraction;
    if(style!=='vertical-down'&&!motion.catchAtApex&&!motion.passage.point)duration*=timing[short?0:1];
    if(adjustment?.durationScale!==undefined){
      if(!config.transition||style==='vertical-down'||motion.catchAtApex||motion.passage.point||
        !Number.isFinite(adjustment.durationScale)||adjustment.durationScale<.7||adjustment.durationScale>1.3)
        throw new Error('移行途中の自由な投球だけ、捕球時刻を調整できます。');
      duration*=adjustment.durationScale;
    }
    if (!(duration>0 && duration<deadline-.015)) throw new Error('捕球から次の投げまでの時間が足りません。高さか経路を調整してください。');
    const velocity = end.clone().sub(start).divideScalar(duration);
    velocity.y += GRAVITY * duration / 2;
    const passageTime=duration*motion.passage.at;
    const passagePosition=start.clone().addScaledVector(velocity,passageTime).add(new THREE.Vector3(0,-GRAVITY*passageTime**2/2,0));
    if (motion.passage.point) {
      const p=motion.passage.point;
      const target=point(toss.hand,side(toss.hand)*p[0]*scale,low+p[1]*scale,p[2]*scale,releaseBeat);
      if (target.distanceTo(passagePosition)>.005) throw new Error('指定した通過点は、この投げ・捕り・飛行時間の放物線上にありません。');
    }
    const releaseGrip:HandGrip=handMotion?.releaseGrip||(['shuffle','vertical-down'].includes(style)?'overhand':'underhand');
    const catchGrip:HandGrip=handMotion?.catchGrip||(velocity.y-GRAVITY*duration>.1?'overhand':'underhand');
    const flight:SyncFlight = { prop, throwHand: th, catchHand: ch, value: toss.numBeats, style, release, duration, start, end, velocity, motion,releaseGrip,catchGrip,
      passage:{time:mod(release+passageTime,period),position:passagePosition} };
    flights.push(flight);
    if(short&&options.ballOrder==='style'&&!inlineBlend&&!style.startsWith('vertical-')&&!motion.passage.point)orderedFlights.push(flight);
    finishFlights.push(()=>{
    // Endpoint velocities and frames must follow the resolved ball trajectory.
    if(!handMotion?.catchGrip)flight.catchGrip=velocity.y-GRAVITY*duration>.1?'overhand':'underhand';
    if(motion.release.relation==='underarm')underarmEvents.push({time:release,hand:th,position:start});
    if(motion.catch.relation==='underarm')underarmEvents.push({time:mod(release+duration,period),hand:ch,position:end});
    const catchVelocity = velocity.clone().add(new THREE.Vector3(0, -GRAVITY * duration, 0));
    const reachHeading=(p:THREE.Vector3,h:number)=>{
      const shoulder=transform.shoulders[h];
      const raised=THREE.MathUtils.smoothstep(p.y,shoulder.y+.02,shoulder.y+.22)*
        (1-THREE.MathUtils.smoothstep(Math.abs(p.x),.07*scale,.18*scale));
      // Raised central catches use a lateral elbow. Keeping the low tucked-elbow
      // heading here forced the wrist backwards and made IK rotate behind the body.
      return new THREE.Vector3(p.x-shoulder.x*(.75+raised*1.75),0,p.z-shoulder.z+raised*.05);
    };
    const outgoing=handFrame(velocity,true,releaseGrip==='overhand',side(th),reachHeading(start,th));
    const incoming=handFrame(catchVelocity,false,flight.catchGrip==='overhand',side(ch),reachHeading(end,ch));
    const weaveY=(config.short[step%config.short.length]==='shuffle' ? 1 : -1)*(short?1:-1);
    const empty:CarryDefinition=switched || options.lateral ? {route:'direct',amount:0,via:[
      {at:.22,offset:[0,weaveY*.035,short?.10:-.10]},
      {at:.50,offset:[0,weaveY*.10,0]},
      {at:.78,offset:[0,weaveY*.035,short?-.10:.10]},
    ]} : {route:crossing?'front':'direct',amount:.04};
    if(config.columns==='underarm' && short && !options.definition && !options.carry) motion.carry={route:'outside',amount:.12};
    events[th].push({ time: release, p: start, v: velocity, ...outgoing, kind: 'release', role: style,carry:motion.emptyReturn || empty,
      fixedCrossing:crossing&&config.armOrder!=='alternate'||motion.emptyReturnExact });
    events[ch].push({ time: mod(release + duration, period), p: end, v: catchVelocity, ...incoming, kind: 'catch', role: style, carry:motion.carry });
    });
  }));

  // Solve against the complete flight schedule, including columns thrown in
  // the previous set. A style is a relative passage, not an absolute y offset.
  for(const f of orderedFlights){
    const [startX,endX]=arcPassLanes(f,flights,period);
    f.motion.release.x+=(startX-f.start.x)/(side(f.throwHand)*scale);
    f.motion.catch.x+=(endX-f.end.x)/(side(f.throwHand)*scale);
    f.start.x=startX;f.end.x=endX;f.velocity.x=(endX-startX)/f.duration;
    f.preferredStart=f.start.clone();f.preferredEnd=f.end.clone();
    f.ballOrder=ballOrderConstraints(f,flights,period);
    // Contact permission removes the diameter requirement, not the above/below
    // ordering. Keep a signed margin so the named passage cannot flip sides.
    const [startY,endY]=resolveBallOrder(f,f.ballOrder,baseConfig.allowBallContact ? .015 : 2*SYNC_RADIUS+.015);
    f.motion.release.y+=(startY-f.start.y)/scale;f.motion.catch.y+=(endY-f.end.y)/scale;
    f.start.y=startY;f.end.y=endY;
    f.velocity.copy(f.end).sub(f.start).divideScalar(f.duration);f.velocity.y+=GRAVITY*f.duration/2;
    f.passage.position.copy(syncFlightAt(f,f.duration*f.motion.passage.at));
  }
  finishFlights.forEach(finish=>finish());

  const hands: HandTrack[] = events.map((list, hand) => {
    // A zero-throw hand waits at its normal low position instead of inventing a
    // ball or a throw. It still participates in the arm clearance checks.
    if(!list.length){
      const l=layouts[0],h=l.reflectedHand(hand),p=l.point(h,side(h)*.22*scale,l.low);
      return {positions:Array.from({length:numSteps},()=>p.clone()),palmNormals:Array.from({length:numSteps},()=>new THREE.Vector3(0,1,0)),
        fingerDirs:Array.from({length:numSteps},()=>new THREE.Vector3(0,0,-1)),elbowPoles:Array.from({length:numSteps},()=>new THREE.Vector3(side(hand)*.08,-1,.18).normalize()),holding:new Array(numSteps).fill(false)};
    }
    list.sort((a, b) => a.time - b.time);
    for(const e of list)e.movement=movement.find(m=>m.hand===hand&&Math.abs(m.from-e.time)<1e-7);
    const rotations = new Map(list.map(e => {
      const y=e.palm.clone().normalize();
      const z=new THREE.Vector3(0,0,1).addScaledVector(y,-y.z).normalize();
      const x=new THREE.Vector3().crossVectors(y,z).normalize();
      return [e,e.rotation || new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z))] as const;
    }));
    list.forEach((a,i)=>{
      const b=list[(i+1)%list.length], span=mod(b.time-a.time,period)||period;
      const route=structuredClone(a.carry||{route:'direct' as const,amount:0});
      if(!a.fixedCrossing&&a.kind==='release'&&a.role==='column'&&Math.abs(a.p.x-b.p.x)<.10*scale&&b.p.y>a.p.y+.18*scale){
        route.offset=[(route.offset?.[0]||0)+.13,route.offset?.[1]||0,route.offset?.[2]||0];
      }
      transitions.push({hand,kind:a.kind==='release'?'empty':'carry',from:a.time,duration:span,start:a.p,end:b.p,
        via:handBetween(a,b,span/2,span,hand,scale),route});
    });
    const positions: THREE.Vector3[] = [], palmNormals: THREE.Vector3[] = [], elbowPoles: THREE.Vector3[] = [], fingerDirs: THREE.Vector3[] = [];
    for (let s = 0; s < numSteps; s++) {
      const t = s * dt;
      const set=atSet(Math.floor(t/(2*beat))),config=setConfigs[set];
      const {low,crossing,switched}=layouts[set];
      let bi = list.findIndex(e => e.time > t + EPS);
      if (bi < 0) bi = 0;
      const a = list[mod(bi - 1, list.length)], b = list[bi];
      const span = mod(b.time - a.time, period) || period;
      const local = mod(t - a.time, period);
      const u = THREE.MathUtils.clamp(local / span, 0, 1);
      const position = handBetween(a, b, local, span, hand, scale);
      positions.push(position);
      // Interpolate a full hand frame. A fixed forward finger direction becomes singular
      // while the palm turns through forward during a slam or claw release.
      const orientation = handRotationBetween(rotations.get(a)!,rotations.get(b)!,u,side(hand));
      if(a.kind==='hold' && a.carry?.via?.length){
        // During a held flourish the hand follows its changing reach. Keep
        // the exact endpoint frames for the adjoining catch/release strokes.
        const shoulder=transform.shoulders[hand];
        const frame=handFrame(new THREE.Vector3(),false,!!a.overhand,side(hand),new THREE.Vector3(position.x-shoulder.x*.75,0,position.z-shoulder.z));
        orientation.slerp(frame.rotation,16*u*u*(1-u)*(1-u));
      }
      palmNormals.push(new THREE.Vector3(0,1,0).applyQuaternion(orientation));
      fingerDirs.push(new THREE.Vector3(0,0,-1).applyQuaternion(orientation));
      let lift = crossing ? THREE.MathUtils.smoothstep(position.y,low-.03*scale,low+.07*scale) : 0;
      if (config.columns === 'underarm') {
        lift = THREE.MathUtils.smoothstep(position.y, low + 0.09 * scale, low + 0.26 * scale);
      }
      const elbow = new THREE.Vector3(side(hand) * (switched ? -.35 : .08), -1, .18);
      if (crossing) { elbow.y += lift * .5; elbow.z -= lift * .3; }
      else if (config.columns === 'underarm') { elbow.y += lift * 0.4; elbow.z += lift * 0.75; }
      if (config.short.includes('vertical-down')) {
        const raised = THREE.MathUtils.smoothstep(position.y, low + 0.1 * scale, low + 0.35 * scale);
        elbow.z += raised * 0.8;
      }
      elbowPoles.push(elbow.normalize());
    }
    return { positions, palmNormals, elbowPoles, fingerDirs, holding: new Array(numSteps).fill(false) };
  });

  const props: THREE.Vector3[][] = [], owners: number[][] = [], inAir: boolean[][] = [];
  for (let prop = 0; prop < source.numProps; prop++) {
    const own = flights.filter(f => f.prop === prop);
    const positions: THREE.Vector3[] = [], heldBy: number[] = [], air: boolean[] = [];
    for (let s = 0; s < numSteps; s++) {
      const t = s * dt;
      const f = own.find(f => mod(t - f.release, period) < f.duration - EPS);
      if (f) { positions.push(syncFlightAt(f, mod(t - f.release, period))); heldBy.push(-1); air.push(true); continue; }
      const previous = own.reduce<SyncFlight | undefined>((best, f) => !best || mod(t - f.release - f.duration, period) < mod(t - best.release - best.duration, period) ? f : best, undefined);
      const held = holds.find(h => h.prop === prop && mod(t - h.from, period) < h.duration);
      const hand = previous?.catchHand ?? held?.hand;
      if (hand === undefined) throw new Error('球の担当が見つかりません。');
      positions.push(hands[hand].positions[s].clone());
      hands[hand].holding[s] = true;
      heldBy.push(hand); air.push(false);
    }
    props.push(positions); owners.push(heldBy); inAir.push(air);
  }
  const peakY = Math.max(...props.flatMap(p => p.map(v => v.y)));
  const armOrders=Array.from({length:numSteps},(_,s)=>{
    const layout=layouts[atSet(Math.floor(s*dt/(2*beat)))];
    const {crossing,armOrder,reflectedHand,upperAt}=layout;
    // Fixed order is a pose constraint. Alternating order is a cycle constraint:
    // allow the crossing phase to emerge continuously, then verify both orders at handoffs.
    if(!crossing || armOrder==='alternate')return null;
    return reflectedHand(upperAt(s*dt/beat));
  });
  const armOrderEvents=flights.filter(f=>f.value===2).flatMap(f=>{
    const set=atSet(Math.floor(f.release/(2*beat))),layout=layouts[set],phase=setConfigs[set].armPhase;
    return layout.crossing&&layout.armOrder==='alternate'?[{time:f.release,upperHand:layout.reflectedHand(layout.upperAt(phase===undefined?f.release/beat:phase*2))}]:[];
  });
  return { config, flights, transitions, armOrders, armOrderEvents, underarmEvents, owners, inAir, movement, flightAdjustments, placement, timing, columnHeight, numSteps, stepDuration: dt, period, props, hands,
    propRotations: props.map(p => p.map(() => new THREE.Quaternion())),
    throws: flights.map(f => ({ time: f.release, hand: f.throwHand, prop: f.prop, value: f.value, velocity: f.velocity.clone() })).sort((a, b) => a.time - b.time),
    gaze: computeGazeTrack(inAir, props, numSteps), peakY, centerZ: depth };
}

/** Sampled geometric checks. They do not certify a named human technique or arm clearance. */
export function inspectSyncBox(tracks: SyncBoxTracks, transform: SpaceTransform, radius = SYNC_RADIUS) {
  const passages=tracks.flights.flatMap(f=>(f.ballOrder||[]).map(c=>({
    gap:(syncFlightAt(f,c.at*f.duration).y-c.height)*(c.above?1:-1),phase:mod(f.release+c.at*f.duration,tracks.period)/tracks.period,
  })));
  const order=passages.reduce((a,b)=>b.gap<a.gap?b:a,{gap:Infinity,phase:0});
  let minBallDistance = Infinity, minHandDistance = Infinity, maxReachRatio = 0, maxHandSpeed = 0, ownershipConflicts = 0;
  let ballPhase=0,handPhase=0,reachPhase=0;
  for (let s = 0; s < tracks.numSteps; s++) {
    for (let a = 0; a < tracks.props.length; a++) for (let b = a + 1; b < tracks.props.length; b++)
      if (tracks.props[a][s].distanceTo(tracks.props[b][s]) < minBallDistance) {minBallDistance=tracks.props[a][s].distanceTo(tracks.props[b][s]);ballPhase=s/tracks.numSteps;}
    if (tracks.hands[0].positions[s].distanceTo(tracks.hands[1].positions[s])<minHandDistance) {minHandDistance=tracks.hands[0].positions[s].distanceTo(tracks.hands[1].positions[s]);handPhase=s/tracks.numSteps;}
    [LEFT, RIGHT].forEach(h => {
      // The tracked point is the BALL center. Arm reach ends at the WRIST;
      // account for palm orientation and the avatar's measured grip offset first.
      const wrist=tracks.hands[h].positions[s].clone().addScaledVector(tracks.hands[h].palmNormals[s],-(radius+transform.gripOffset.normal))
        .addScaledVector(tracks.hands[h].fingerDirs![s],-transform.gripOffset.finger);
      const reach=wrist.distanceTo(transform.shoulders[h])/(transform.wristReach+.008);
      if(reach>maxReachRatio){maxReachRatio=reach;reachPhase=s/tracks.numSteps;}
      maxHandSpeed = Math.max(maxHandSpeed, tracks.hands[h].positions[s].distanceTo(tracks.hands[h].positions[(s + 1) % tracks.numSteps]) / tracks.stepDuration);
      if (tracks.owners.filter(p => p[s] === h).length > 1) ownershipConflicts++;
    });
  }
  const ballContactAllowed=tracks.config.allowBallContact===true,ballContact=minBallDistance<=2*radius;
  const ballOrderOK=order.gap>=(ballContactAllowed ? .001 : 2*radius);
  return { balls: tracks.props.length, minBallDistance, minHandDistance, maxReachRatio, maxHandSpeed, ownershipConflicts,
    ballContactAllowed,ballContact,ballOrderOK,
    ballOrderClearance:order.gap-2*radius,ballOrderPhase:order.phase,ballOrderChecks:passages.length,
    ballClearance: minBallDistance - 2 * radius, period: tracks.period, ballPhase,handPhase,reachPhase,peakY:tracks.peakY,
    geometryOK: (ballContactAllowed||!ballContact) && ballOrderOK && minHandDistance > 0.09 && maxReachRatio <= 1 && ownershipConflicts === 0 };
}
