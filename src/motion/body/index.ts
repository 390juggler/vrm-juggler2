import * as THREE from 'three';
import { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';

import { JugglingFrame } from '../juggling';
import { AvatarMetrics, LEFT, RIGHT, Tracks } from '../juggling/tracks';
import { planArmCycle, armPosePenalty, armPoseCandidates, ArmCycleFrame, ArmCyclePlanInfo, ArmAnatomy, armPosture, armPoseClear, armPairClear, underarmRelationsClear, ElbowCircle } from '../inspection';

/**
 * ジャグリング中の全身の動き。
 *
 * - 腕: 解析的な 2 関節 IK。ボール(クラブはハンドル、リングは縁)が手のひらに乗るように手首の位置と向きを決め、
 *       肘は体側の低い位置を基準にする。軸方向のひねりは前腕で受け、手首は投げ捕りの方向へ曲げる。
 * - 指: 持っている間は握り(クラブは握りこぶし)、投げた後は開く。
 * - 体: 投げるたびに、投げの速さに比例した勢いをばねに与える(膝の沈み込み・胸のひねり・肩・前傾)。
 *       ゆっくりした左右の重心移動と呼吸はいつも入れる。
 * - 頭: パターンの頂点付近を見る。目は次にキャッチするボールを追う。
 *
 * three-vrm の正規化ボーン(休止姿勢の回転がすべて 0)を動かす。回転はワールド(アバターが -Z を向く)の
 * 向きで決め、モデルの座標系(VRM 1.0 は +Z 向きのモデルを 180° 回して置いている)へ直して設定する。
 */

const Bone = VRMHumanBoneName;

// 前方(このライブラリではアバターは -Z を向く)
const FORWARD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);

// 腕
const ELBOW_POLE_BACK = 0.35; // 肘を後ろへ向ける強さ
// リングは肩の前で前腕を立てて持つので、肘を手首の下へ置く
const ELBOW_POLE_BACK_BY_PROP: { [propType: string]: number } = { ring: 0 };
const ELBOW_POLE_OUT_BASE = 0.25; // 肘を外へ向ける強さ(armAngle が加わる)
const FINGER_INWARD = 0.35; // 指先を体の内側へ向ける量
const PALM_GAP = 0.012; // ボール表面と手のひらのすき間

// 指
const GRIP_HOLDING = 1.0;
const GRIP_EMPTY = 0.35;
const GRIP_SMOOTH = 25; // 1/s
// Proximal, Intermediate, Distal(rad, grip = 1 の時)。クラブはハンドルを握りこみ、リングは縁をつかむ
const FINGER_CURL: { [propType: string]: number[] } = {
  ball: [0.35, 0.75, 0.55],
  club: [1.0, 1.3, 0.9],
  ring: [0.75, 1.1, 0.8],
  pancake: [0.75, 1.1, 0.8],
};
const FINGER_CURL_OPEN = [0.1, 0.2, 0.1];

// 体は「投げ」に反応して動く。投げるたびにばね(減衰振動)へ投げの速さに比例した勢いを与える。
// 一定周期の揺れと違い、投げの高さ・リズムに合った大きさで自然に収まる
const KNEE_BASE = 0.1; // rad(いつも軽く曲げておく)
const DIP_PER_SPEED = 0.03; // 投げの速さ 1 m/s あたり、腰を沈める勢い(m/s)
const DIP_SPRING = { period: 0.65, damping: 0.6 };
const TWIST_PER_SPEED = 0.07; // 投げた側の肩を前へ出す胸のひねり(rad/s)
const TWIST_SPRING = { period: 0.7, damping: 0.5 };
const SHOULDER_PER_SPEED = 0.22; // 投げた側の肩を上げる勢い(rad/s)
const SHOULDER_SPRING = { period: 0.4, damping: 0.6 };
const LEAN_PER_SPEED = 0.02; // 上へ強く投げるほど少し前傾する(rad/s)
const LEAN_SPRING = { period: 0.8, damping: 0.6 };

// 上半身
const SPINE_LEAN = 0.05; // rad(前傾)
const BREATH_AMPLITUDE = 0.012;
const BREATH_PERIOD = 3.6; // s
const SHOULDER_FORWARD = 0.08;
// ゆっくりした左右の重心移動(止まって見えないように)
const WEIGHT_SHIFT = [
  { amplitude: 0.008, period: 7.3, phase: 0 },
  { amplitude: 0.004, period: 3.1, phase: 1 },
];

/** 減衰振動するばね。kick() で勢いを与え、step() で進める */
class Spring {
  x = 0;
  v = 0;
  private omega: number;
  private zeta: number;

  constructor({ period, damping }: { period: number; damping: number }) {
    this.omega = (2 * Math.PI) / period;
    this.zeta = damping;
  }

  kick(dv: number) {
    this.v += dv;
  }

  step(delta: number) {
    // フレーム時間が長くても発散しないように細かく刻む
    const steps = Math.max(1, Math.ceil(delta / (1 / 240)));
    const dt = delta / steps;
    for (let i = 0; i < steps; i++) {
      const a = -this.omega * this.omega * this.x - 2 * this.zeta * this.omega * this.v;
      this.v += a * dt;
      this.x += this.v * dt;
    }
    return this.x;
  }
}

// 頭・視線
const HEAD_PITCH_MIN = -0.2;
const HEAD_PITCH_MAX = 0.4;
const NECK_SHARE = 0.4;
const HEAD_FOLLOW_X = 0.2; // 頭が目線の横位置を追う割合
const HEAD_FOLLOW_Y = 0.15; // 頭の上下が目線の高さを追う割合(残りはパターンの頂点)
const GAZE_SMOOTH = 8; // 1/s(目)
const HEAD_SMOOTH = 2.5; // 1/s(頭は目よりゆっくり追う)

interface ArmRig {
  side: number; // 左 -1, 右 +1(x 座標の符号)
  shoulder: THREE.Object3D | null;
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  hand: THREE.Object3D;
  upperLength: number;
  lowerLength: number;
  restUpperDir: THREE.Vector3;
  restLowerDir: THREE.Vector3;
  restFingerDir: THREE.Vector3;
  restPalmNormal: THREE.Vector3;
  palmOffset: THREE.Vector3; // 手首 → 手のひらの中心(休止姿勢のワールド座標)
  restWorld: { upper: THREE.Quaternion; lower: THREE.Quaternion; hand: THREE.Quaternion };
  fingers: { node: THREE.Object3D; joint: number }[];
  thumbs: { node: THREE.Object3D; euler: THREE.Euler }[];
  grip: number;
  lastForearmDir: THREE.Vector3;
}

function worldPosition(node: THREE.Object3D) {
  return node.getWorldPosition(new THREE.Vector3());
}

function worldQuaternion(node: THREE.Object3D) {
  return node.getWorldQuaternion(new THREE.Quaternion());
}

/** (a1, b1) の向きを (a2, b2) に移す回転。a を正確に合わせ、b は a に直交する成分だけ合わせる */
function frameRotation(a1: THREE.Vector3, b1: THREE.Vector3, a2: THREE.Vector3, b2: THREE.Vector3) {
  const basis = (a: THREE.Vector3, b: THREE.Vector3) => {
    const x = a.clone().normalize();
    const z = new THREE.Vector3().crossVectors(x, b).normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  };
  return basis(a2, b2).multiply(basis(a1, b1).conjugate());
}

/** Extract axial twist as a quaternion. Multiplying a wrapped angle by a partial
 * share made the forearm jump when that angle crossed ±PI. Full axial twist
 * belongs to the forearm; the hand keeps the remaining wrist bend. */
export function forearmTwist(q: THREE.Quaternion, axis: THREE.Vector3) {
  const projection = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  const twist = new THREE.Quaternion(axis.x*projection,axis.y*projection,axis.z*projection,q.w);
  return twist.lengthSq()>1e-12 ? twist.normalize() : new THREE.Quaternion();
}

export default class Body {
  private vrm: VRM;
  private arms: ArmRig[];
  private rest = new Map<THREE.Object3D, THREE.Quaternion>();
  private hips: THREE.Object3D | null;
  private hipsRestY = 0;
  private hipsRestX = 0;
  private legLength = 0;
  private eyePoint?: THREE.Vector3;
  private headPoint?: THREE.Vector3;
  private dip = new Spring(DIP_SPRING);
  private twist = new Spring(TWIST_SPRING);
  private lean = new Spring(LEAN_SPRING);
  private shoulders = [new Spring(SHOULDER_SPRING), new Spring(SHOULDER_SPRING)];
  private breathTime = 0;
  private lookTarget = new THREE.Object3D();
  private eyeY: number;
  private weightShift = 0;
  // ワールドの向きの回転 → モデルの座標系の回転(q → toModel * q * toWorld)
  private toWorld: THREE.Quaternion;
  private toModel: THREE.Quaternion;
  private modelXSign: number;

  public armAngle = 0.3;
  /** 体の動きの大きさ(0 で止める、1 が標準、2 で大きく) */
  public motionAmount = 1;
  private syncArmAngles: number[][] | null = null;
  private syncElbows: THREE.Vector3[][] | null = null;
  private syncKeyPhases: number[] | null = null;
  private syncReplayActive=false;
  syncPlanInfo: ArmCyclePlanInfo = {};

  /** Cheap rejection at the failed instant; acceptance still requires the full cycle. */
  inspectSyncPose(frame:JugglingFrame){
    const info:ArmCyclePlanInfo={};
    const sample:ArmCycleFrame={plans:this.arms.map((arm,h)=>this.planArm(arm,frame.hands[h],frame.propRadius,frame.propType)),
      balls:frame.ballPositions!.map(p=>p.clone()),upperHand:frame.armOrder,underarm:frame.underarm};
    const ok=!!(planArmCycle([sample],frame.propRadius,info)||planArmCycle([sample],frame.propRadius,info,1,undefined,72));
    info.phase=frame.phase;return {ok,info};
  }

  syncPosePenalty(frame:JugglingFrame){
    return armPosePenalty({plans:this.arms.map((arm,h)=>this.planArm(arm,frame.hands[h],frame.propRadius,frame.propType)),
      balls:frame.ballPositions!,upperHand:frame.armOrder,underarm:frame.underarm},frame.propRadius);
  }

  syncReachError(frame:Pick<JugglingFrame,'hands'|'propRadius'|'propType'>){
    return Math.max(...this.arms.map((arm,h)=>this.planArm(arm,frame.hands[h],frame.propRadius,frame.propType).reachError));
  }

  syncTracksReachError(tracks:Tracks,radius:number){
    let worst=0;
    for(let i=0;i<tracks.numSteps;i++){
      const hands=tracks.hands.map(t=>({position:t.positions[i],palmNormal:t.palmNormals[i],fingerDir:t.fingerDirs?.[i]||new THREE.Vector3(),holding:t.holding[i]}));
      worst=Math.max(worst,this.syncReachError({hands,propRadius:radius,propType:'ball'}));
    }
    return worst;
  }

  /** Project the working plane into the shared reach of both wrists. Only a
   * common Y/Z translation is allowed, so lanes and relative heights survive. */
  syncReachTranslation(tracks:Tracks,radius:number):[number,number]{
    const disks:{y:number;z:number;r:number}[]=[];
    for(let i=0;i<tracks.numSteps;i++)for(const [h,arm] of this.arms.entries()){
      const t=tracks.hands[h],plan=this.planArm(arm,{position:t.positions[i],palmNormal:t.palmNormals[i],
        fingerDir:t.fingerDirs?.[i]||new THREE.Vector3(),holding:t.holding[i]},radius,'ball');
      const v=plan.wristTarget.clone().sub(plan.shoulder),reach=arm.upperLength+arm.lowerLength-.004;
      disks.push({y:-v.y,z:-v.z,r:Math.sqrt(Math.max(0,reach*reach-v.x*v.x))});
    }
    let y=0,z=0;
    // Fixed projection passes, independent of the technique or cycle length.
    for(let pass=0;pass<12;pass++)for(const disk of disks){
      const dy=y-disk.y,dz=z-disk.z,d=Math.hypot(dy,dz);
      if(d>disk.r){const ratio=disk.r/d;y=disk.y+dy*ratio;z=disk.z+dz*ratio;}
    }
    return [y,z];
  }

  /** Search guidance includes the transfers between poses and the cycle seam. */
  syncCyclePenalty(sample:(phase:number)=>JugglingFrame,phases:number[],period:number){
    const nodes=phases.map(phase=>{
      const frame=sample(phase);
      return armPoseCandidates({plans:this.arms.map((arm,h)=>this.planArm(arm,frame.hands[h],frame.propRadius,frame.propType)),
        balls:frame.ballPositions!,upperHand:frame.armOrder,underarm:frame.underarm},frame.propRadius,8);
    });
    const sq=(v:number)=>Math.max(0,v)**2;
    const costs=nodes.map((row,t)=>{
      const previous=nodes[(t+nodes.length-1)%nodes.length],dt=(phases[t]-phases[(t+nodes.length-1)%nodes.length]+(t===0?1:0))*period;
      return row.map(b=>previous.map(a=>a.elbows.reduce((cost,e,h)=>{
        const speed=e.distanceTo(b.elbows[h])/dt;
        const angular=a.rotations&&b.rotations?Math.max(...a.rotations[h].map((q,j)=>q.angleTo(b.rotations![h][j])/dt)):0;
        return cost+sq((speed-6)*.025)+sq((angular-65)*.002);
      },0)));
    });
    let best=Infinity;
    for(let seed=0;seed<nodes[0].length;seed++){
      let distance=nodes[0].map((n,i)=>i===seed?n.cost:Infinity);
      for(let t=1;t<nodes.length;t++)distance=nodes[t].map((n,j)=>n.cost+Math.min(...distance.map((d,k)=>d+costs[t][j][k])));
      best=Math.min(best,...distance.map((d,k)=>d+costs[0][seed][k]));
    }
    return best/nodes.length+2*Math.max(...nodes.map(n=>n[0].cost));
  }

  prepareSyncCycle(sample: (phase: number) => JugglingFrame, period = 1) {
    this.syncReplayActive=false;
    this.syncArmAngles = null;
    this.syncElbows = null;
    this.syncKeyPhases = null;
    this.syncPlanInfo = {};
    const first = sample(0);
    const eventPhases=first.constraintPhases||[];
    this.update(first, 0);
    // Keep accepted cycles unchanged. A longer composed cycle may need more
    // keys before interpolation can satisfy the same posture/clearance limits.
    // Long sequences need the same temporal resolution as a short fast cycle.
    // Try the accepted grids first; only a failed interpolation reaches this
    // bounded final pass (at most 4096 keys, aiming at eight milliseconds).
    const denseCount=Math.min(4096,Math.ceil(period/.008/120)*120);
    for (const keyCount of [...new Set([120,240,480,...(denseCount>480?[denseCount]:[])])]) {
      this.syncPlanInfo = {};
      const phases=Array.from({length:keyCount},(_,i)=>i/keyCount);
      if(eventPhases.length){
        phases.push(...eventPhases);phases.sort((a,b)=>a-b);
        for(let i=phases.length-1;i>0;i--)if(phases[i]-phases[i-1]<1e-9)phases.splice(i,1);
        this.syncKeyPhases=phases;
      }
      this.syncPlanInfo.keyCount=phases.length;
      const frames: ArmCycleFrame[] = phases.map(phase => {
        const frame = sample(phase);
        return { plans: this.arms.map((arm,h)=>this.planArm(arm,frame.hands[h],frame.propRadius,frame.propType)),
          balls: frame.ballPositions!.map(p=>p.clone()), upperHand:frame.armOrder, underarm:frame.underarm };
      });
      this.syncArmAngles = planArmCycle(frames, first.propRadius, this.syncPlanInfo, period,this.syncKeyPhases||undefined);
      // A coarse elbow-angle lattice can disconnect a continuous corridor.
      // Refine angles without changing posture, separation or speed limits.
      if(!this.syncArmAngles&&['no-feasible-pose','no-continuous-path','no-closed-path'].includes(this.syncPlanInfo.reason||''))
        this.syncArmAngles=planArmCycle(frames,first.propRadius,this.syncPlanInfo,period,this.syncKeyPhases||undefined,72);
      if (!this.syncArmAngles) return false;
      this.syncElbows = this.syncArmAngles.map((angles,h) => angles.map((angle,i) => {
        const p = frames[i].plans[h];
        return p.center.clone().addScaledVector(p.pole.clone().applyAxisAngle(p.axis,angle),p.radius);
      }));
      // Validate the same interpolation used during playback, including the cycle seam.
      // Safe key poses alone do not make the path between them safe.
      if(this.syncElbows){
        const count=Math.max(480,Math.ceil(period/.003));
        for(const phase of [...Array.from({length:count},(_,i)=>i/count),...eventPhases]){
          const frame=sample(phase);
          const plans=this.arms.map((arm,h)=>this.planArm(arm,frame.hands[h],frame.propRadius,frame.propType));
          this.interpolateSyncElbows(plans,phase);
          if(!this.safeSyncPose(plans,frame)){
            this.syncPlanInfo={...this.syncPlanInfo,reason:'unsafe-interpolation',phase};
            this.syncArmAngles=null;this.syncElbows=null;break;
          }
        }
      }
      if(this.syncArmAngles){delete this.syncPlanInfo.reason;delete this.syncPlanInfo.phase;delete this.syncPlanInfo.details;return true;}
    }
    return !!this.syncArmAngles;
  }

  /** Fixed-size cyclic optimisation, with soft contact costs. It always finishes
   * after one lattice pass; no angle refinement or nested geometry search. */
  prepareConstructiveCycle(sample:(phase:number)=>JugglingFrame,period:number){
    this.syncReplayActive=false;this.syncArmAngles=null;this.syncElbows=null;
    const first=sample(0),count=Math.min(2048,Math.max(120,Math.ceil(period/.016)));
    this.update(first,0);
    const phases=[...new Set([...Array.from({length:count},(_,i)=>i/count),...(first.constraintPhases||[])])].sort((a,b)=>a-b);
    this.syncKeyPhases=phases;
    const nodes=phases.map(phase=>{
      const f=sample(phase);
      return armPoseCandidates({plans:this.arms.map((arm,h)=>this.planArm(arm,f.hands[h],f.propRadius,f.propType)),
        balls:f.ballPositions!,upperHand:f.armOrder,underarm:f.underarm},f.propRadius,6,12);
    });
    const moves=nodes.map((row,t)=>{
      const before=(t+nodes.length-1)%nodes.length,dt=(phases[t]-phases[before]+(t===0?1:0))*period;
      return row.map(b=>nodes[before].map(a=>a.elbows.reduce((cost,e,h)=>{
        const speed=e.distanceTo(b.elbows[h])/Math.max(dt,.001);
        const rotation=a.rotations&&b.rotations?Math.max(...a.rotations[h].map((q,j)=>q.angleTo(b.rotations![h][j]))):0;
        return cost+speed*speed*.00001+Math.max(0,speed-6)**2*.001+rotation*rotation*.015;
      },0)));
    });
    let best=Infinity,path:number[]=[];
    for(let seed=0;seed<nodes[0].length;seed++){
      let distance=nodes[0].map((n,i)=>i===seed?n.cost:Infinity);
      const parent:number[][]=[];
      for(let t=1;t<nodes.length;t++){
        parent[t]=[];
        distance=nodes[t].map((n,j)=>{
          const costs=distance.map((d,k)=>d+moves[t][j][k]),value=Math.min(...costs);
          parent[t][j]=costs.indexOf(value);return n.cost+value;
        });
      }
      for(let end=0;end<distance.length;end++){
        const cost=distance[end]+moves[0][seed][end];
        if(cost>=best)continue;best=cost;path=new Array(nodes.length);path[nodes.length-1]=end;
        for(let t=nodes.length-1;t>0;t--)path[t-1]=parent[t][path[t]];
      }
    }
    if(!Number.isFinite(best))throw new Error('腕の座標を計算できませんでした。');
    this.syncElbows=[0,1].map(h=>path.map((p,t)=>nodes[t][p].elbows[h].clone()));
    // Contact tolerance lets us round off lattice changes instead of spinning
    // the elbows to chase a different collision-free angle on every frame.
    // Filtering wraps around the seam, then projects back to each exact IK circle.
    for(let pass=0;pass<3;pass++){
      const previous=this.syncElbows;
      this.syncElbows=[0,1].map(h=>phases.map((phase,i)=>{
        const average=new THREE.Vector3();let weights=0;
        for(let delta=-6;delta<=6;delta++){
          const j=(i+delta+phases.length)%phases.length;
          const dt=Math.min(Math.abs(phases[j]-phase),1-Math.abs(phases[j]-phase))*period;
          const weight=Math.exp(-dt*dt/(2*.025**2));average.addScaledVector(previous[h][j],weight);weights+=weight;
        }
        average.divideScalar(weights);
        const frame=sample(phase),p=this.planArm(this.arms[h],frame.hands[h],frame.propRadius,frame.propType);
        const direction=average.sub(p.center);direction.addScaledVector(p.axis,-direction.dot(p.axis));
        if(direction.lengthSq()<1e-12)direction.copy(p.pole);
        return p.center.clone().addScaledVector(direction.normalize(),p.radius);
      }));
    }
    this.syncArmAngles=[new Array(nodes.length).fill(0),new Array(nodes.length).fill(0)];
    this.syncPlanInfo={contactFallback:true,keyCount:phases.length};
    return true;
  }

  private interpolateSyncElbows(plans:ElbowCircle[],fraction:number,elbowTracks=this.syncElbows!,keyPhases=this.syncKeyPhases) {
    const phase=fraction*elbowTracks[0].length;
    let k=Math.floor(phase),u=phase-k;
    if(keyPhases){
      const keys=keyPhases,next=keys.findIndex(t=>t>fraction+1e-10);
      k=next<0?keys.length-1:Math.max(0,next-1);
      const end=next<0?1:keys[next];u=THREE.MathUtils.clamp((fraction-keys[k])/(end-keys[k]),0,1);
    }
    plans.forEach((p,h)=>{
      const elbows=elbowTracks[h];
      const direction=elbows[k%elbows.length].clone().lerp(elbows[(k+1)%elbows.length],u).sub(p.center);
      direction.addScaledVector(p.axis,-direction.dot(p.axis)).normalize();
      p.elbow.copy(p.center).addScaledVector(direction,p.radius);
    });
  }

  private safeSyncPose(plans:ElbowCircle[],frame:JugglingFrame) {
    return plans.every(p=>armPoseClear(p,p.elbow,frame.ballPositions!,frame.propRadius)) &&
      armPairClear(plans,plans[0].elbow,plans[1].elbow,frame.armOrder) &&
      underarmRelationsClear(plans,plans.map(p=>p.elbow),frame.underarm);
  }

  get hasPlannedSyncCycle() { return !!this.syncArmAngles||this.syncReplayActive; }

  captureSyncPlanRestore(){
    const saved={syncArmAngles:this.syncArmAngles,syncElbows:this.syncElbows,syncKeyPhases:this.syncKeyPhases,
      syncReplayActive:this.syncReplayActive,syncPlanInfo:this.syncPlanInfo,motionAmount:this.motionAmount};
    return ()=>Object.assign(this,saved);
  }

  exportSyncPlan(){
    if(!this.syncArmAngles||!this.syncElbows)throw new Error('腕の周期が未検査です。');
    return {angles:structuredClone(this.syncArmAngles),elbows:this.syncElbows.map(row=>row.map(p=>p.toArray())),
      phases:this.syncKeyPhases?.slice()||null,info:structuredClone(this.syncPlanInfo)};
  }

  applySyncPlan(plan:ReturnType<Body['exportSyncPlan']>){
    this.syncArmAngles=structuredClone(plan.angles);
    this.syncElbows=plan.elbows.map(row=>row.map(p=>new THREE.Vector3(...p)));
    this.syncKeyPhases=plan.phases?.slice()||null;this.syncPlanInfo=structuredClone(plan.info);
    this.syncReplayActive=false;this.motionAmount=0;
  }

  /** Keep the accepted plan, including its interpolation, when another cycle is prepared. */
  captureSyncArmMotion(){
    if(!this.syncElbows||!this.syncArmAngles||this.motionAmount!==0)throw new Error('体の揺れを止め、腕の周期検査を通してから登録してください。');
    const elbows=this.syncElbows.map(h=>h.map(p=>p.clone())),phases=this.syncKeyPhases?.slice()||null;
    const shoulders=this.arms.map(a=>worldPosition(a.upper)),angle=this.armAngle;
    return (frame:JugglingFrame)=>{
      if(this.motionAmount!==0||angle!==this.armAngle||this.arms.some((a,i)=>worldPosition(a.upper).distanceTo(shoulders[i])>1e-8))
        throw new Error('モデルの姿勢が変わりました。接続部品を再検査してください。');
      const plans=this.arms.map((arm,h)=>this.planArm(arm,frame.hands[h],frame.propRadius,frame.propType));
      this.interpolateSyncElbows(plans,frame.phase!,elbows,phases);
      return plans.map(p=>p.elbow.clone());
    };
  }

  projectSyncElbows(frame:JugglingFrame,elbows:THREE.Vector3[]){
    return this.arms.map((arm,h)=>{
      const p=this.planArm(arm,frame.hands[h],frame.propRadius,frame.propType),direction=elbows[h].clone().sub(p.center);
      direction.addScaledVector(p.axis,-direction.dot(p.axis)).normalize();
      return p.center.clone().addScaledVector(direction,p.radius);
    });
  }

  /** Check a newly anchored path at the planner's interpolation resolution
   * and at every exact relation event, without solving a new elbow path. */
  validateSyncReplay(read:(seconds:number)=>JugglingFrame,period:number,allowContact=false){
    const first=read(0),count=Math.max(480,Math.ceil(period/.003));
    for(const phase of [...Array.from({length:count},(_,i)=>i/count),...(first.constraintPhases||[])]){
      const frame=read(phase*period),plans=this.arms.map((arm,h)=>this.planArm(arm,frame.hands[h],frame.propRadius,frame.propType));
      if(!this.assignFixedElbows(plans,frame)||!allowContact&&!this.safeSyncPose(plans,frame))return false;
    }
    return true;
  }

  private assignFixedElbows(plans:ElbowCircle[],frame:JugglingFrame){
    const elbows=frame.fixedElbows;
    if(!elbows||elbows.length!==2||elbows.some((e,h)=>!Number.isFinite(e.lengthSq())||
      Math.abs(e.distanceTo(plans[h].center)-plans[h].radius)>1e-7||Math.abs(e.clone().sub(plans[h].center).dot(plans[h].axis))>1e-7))return false;
    plans.forEach((p,h)=>p.elbow.copy(elbows[h]));return true;
  }

  set enableBodyMotion(value: boolean) {
    this.motionAmount = value ? 1 : 0;
  }
  public enableNeck = true;

  constructor(vrm: VRM, scene: THREE.Scene) {
    this.vrm = vrm;
    this.vrm.scene.updateMatrixWorld(true);
    this.toWorld = worldQuaternion(vrm.humanoid.normalizedHumanBonesRoot);
    this.toModel = this.toWorld.clone().invert();
    this.modelXSign = new THREE.Vector3(1, 0, 0).applyQuaternion(this.toModel).x < 0 ? -1 : 1;

    this.hips = this.node(Bone.Hips);
    if (this.hips) {
      this.hipsRestY = this.hips.position.y;
      this.hipsRestX = this.hips.position.x;
    }

    const upperLeg = this.node(Bone.LeftUpperLeg);
    const lowerLeg = this.node(Bone.LeftLowerLeg);
    const foot = this.node(Bone.LeftFoot);
    if (upperLeg && lowerLeg && foot) {
      this.legLength =
        worldPosition(upperLeg).distanceTo(worldPosition(lowerLeg)) +
        worldPosition(lowerLeg).distanceTo(worldPosition(foot));
    }

    const eye = this.node(Bone.LeftEye) || this.node(Bone.Head);
    this.eyeY = eye ? worldPosition(eye).y : 1.5;

    // 休止姿勢(T ポーズ)の回転を覚えておく
    Object.values(Bone).forEach((name) => {
      const node = this.node(name);
      if (node) this.rest.set(node, node.quaternion.clone());
    });

    this.arms = [this.createArm(LEFT), this.createArm(RIGHT)];

    scene.add(this.lookTarget);
    if (this.vrm.lookAt) this.vrm.lookAt.target = this.lookTarget;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.lookTarget);
  }

  private node(name: VRMHumanBoneName): THREE.Object3D | null {
    return this.vrm.humanoid.getNormalizedBoneNode(name);
  }

  /** ワールドの向きで表した回転を、モデルの座標系の回転にする */
  private toLocal(q: THREE.Quaternion) {
    return q.premultiply(this.toModel).multiply(this.toWorld);
  }

  get metrics(): AvatarMetrics {
    const arm = this.arms[RIGHT];
    const shoulder = worldPosition(arm.upper);
    return {
      shoulderY: shoulder.y,
      shoulderX: Math.abs(shoulder.x),
      shoulderZ: shoulder.z,
      upperArmLength: arm.upperLength,
      armLength: arm.upperLength + arm.lowerLength,
      gripOffset:{finger:arm.palmOffset.dot(arm.restFingerDir.clone().addScaledVector(arm.restPalmNormal,-arm.restFingerDir.dot(arm.restPalmNormal)).normalize()),
        normal:arm.palmOffset.dot(arm.restPalmNormal)+PALM_GAP},
    };
  }

  private createArm(h: number): ArmRig {
    const isLeft = h === LEFT;
    const pick = (left: VRMHumanBoneName, right: VRMHumanBoneName) =>
      this.node(isLeft ? left : right);

    const upper = pick(Bone.LeftUpperArm, Bone.RightUpperArm)!;
    const lower = pick(Bone.LeftLowerArm, Bone.RightLowerArm)!;
    const hand = pick(Bone.LeftHand, Bone.RightHand)!;
    const middle = pick(Bone.LeftMiddleProximal, Bone.RightMiddleProximal);

    const upperPos = worldPosition(upper);
    const lowerPos = worldPosition(lower);
    const handPos = worldPosition(hand);
    const side = Math.sign(handPos.x - upperPos.x) || (isLeft ? -1 : 1);

    const restUpperDir = lowerPos.clone().sub(upperPos).normalize();
    const restLowerDir = handPos.clone().sub(lowerPos).normalize();
    const middlePos = middle ? worldPosition(middle) : handPos.clone().addScaledVector(restLowerDir, 0.08);
    const restFingerDir = middlePos.clone().sub(handPos).normalize();
    // VRM の T ポーズは手のひらが下向き
    const restPalmNormal = new THREE.Vector3(0, -1, 0);
    // 手のひらの中心は手首と中指の付け根の間、少し手のひら側
    const palmOffset = middlePos.clone().sub(handPos).multiplyScalar(0.6).addScaledVector(restPalmNormal, 0.02);

    const fingers: ArmRig['fingers'] = [];
    const fingerNames = ['Index', 'Middle', 'Ring', 'Little'];
    const jointNames = ['Proximal', 'Intermediate', 'Distal'];
    fingerNames.forEach((finger) =>
      jointNames.forEach((joint, j) => {
        const name = `${isLeft ? 'left' : 'right'}${finger}${joint}` as VRMHumanBoneName;
        const node = this.node(name);
        if (node) fingers.push({ node, joint: j });
      })
    );

    // 親指は元の実装の角度を使う(軽く曲げて手のひら側へ)
    const thumbs: ArmRig['thumbs'] = [];
    // (VRM 0.x の Proximal は three-vrm では Metacarpal と呼ばれる)
    const thumbPose: [string, THREE.Euler][] = [
      ['Metacarpal', new THREE.Euler(0, (-side * Math.PI) / 12, (-side * Math.PI) / 12)],
      ['Distal', new THREE.Euler(0, (-side * Math.PI) / 3, 0)],
    ];
    thumbPose.forEach(([joint, euler]) => {
      const node = this.node(`${isLeft ? 'left' : 'right'}Thumb${joint}` as VRMHumanBoneName);
      if (node) thumbs.push({ node, euler });
    });

    return {
      side,
      shoulder: pick(Bone.LeftShoulder, Bone.RightShoulder),
      upper,
      lower,
      hand,
      upperLength: upperPos.distanceTo(lowerPos),
      lowerLength: lowerPos.distanceTo(handPos),
      restUpperDir,
      restLowerDir,
      restFingerDir,
      restPalmNormal,
      palmOffset,
      restWorld: { upper: worldQuaternion(upper), lower: worldQuaternion(lower), hand: worldQuaternion(hand) },
      fingers,
      thumbs,
      grip: GRIP_EMPTY,
      lastForearmDir: FORWARD.clone(),
    };
  }

  /** 休止姿勢の回転に、オイラー角(ワールドの向き: x 右、y 上、z 後ろ)の回転を掛けて設定する */
  private pose(name: VRMHumanBoneName, x: number, y: number, z: number) {
    const node = this.node(name);
    if (!node) return;
    this.setPose(node, new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)));
  }

  private setPose(node: THREE.Object3D, q: THREE.Quaternion) {
    const rest = this.rest.get(node);
    node.quaternion.copy(this.toLocal(q));
    if (rest) node.quaternion.premultiply(rest);
  }

  update(frame: JugglingFrame, delta: number) {
    this.breathTime += delta;
    this.updateSprings(frame, delta);

    this.updateLowerBody(frame);
    this.updateUpperBody(frame, delta);
    this.vrm.scene.updateMatrixWorld(true);

    const plans = this.arms.map((arm, h) => this.planArm(arm, frame.hands[h], frame.propRadius, frame.propType));
    if(frame.ballPositions){
      // Never replace a failed cyclic plan with unconstrained per-frame IK.
      this.syncReplayActive=false;
      if(frame.fixedElbows){
        if(!this.assignFixedElbows(plans,frame)){
          this.syncArmAngles=null;this.syncElbows=null;this.syncPlanInfo={reason:'unsafe-replay-pose',phase:frame.phase};return;
        }
      }else{
        if(!this.syncElbows || frame.phase===undefined)return;
        this.interpolateSyncElbows(plans,frame.phase);
      }
      if(!(frame.fixedElbows?frame.contactFallback:this.syncPlanInfo.contactFallback)&&!this.safeSyncPose(plans,frame)){
        this.syncPlanInfo={...this.syncPlanInfo,reason:'unsafe-playback-pose',phase:frame.phase};
        this.syncArmAngles=null;this.syncElbows=null;return;
      }
      this.syncReplayActive=!!frame.fixedElbows;
    }
    this.arms.forEach((arm, h) => {
      this.applyArm(arm, plans[h]);
      this.updateFingers(arm, frame.hands[h].holding, frame.propType, delta);
    });
  }

  /** 投げに反応してばねに勢いを与え、進める */
  private updateSprings(frame: JugglingFrame, delta: number) {
    const amount = this.motionAmount;
    frame.throws.forEach((t) => {
      const speed = t.velocity.length();
      const side = t.hand === LEFT ? -1 : 1;
      this.dip.kick(-DIP_PER_SPEED * speed * amount);
      this.twist.kick(side * TWIST_PER_SPEED * speed * amount);
      this.lean.kick(LEAN_PER_SPEED * Math.max(0, t.velocity.y) * amount);
      this.shoulders[t.hand].kick(SHOULDER_PER_SPEED * speed * amount);
    });
    this.dip.step(delta);
    this.twist.step(delta);
    this.lean.step(delta);
    this.shoulders.forEach((s) => s.step(delta));
  }

  private updateLowerBody(frame: JugglingFrame) {
    // 太ももの付け根から足首までの長さと曲げ角から、腰の高さが決まる
    const baseDrop = this.legLength * (1 - Math.cos(KNEE_BASE));
    const drop = THREE.MathUtils.clamp(baseDrop - this.dip.x, 0, this.legLength * 0.05);
    const knee = Math.acos(1 - drop / Math.max(this.legLength, 0.1));

    // 太もも前・すね後ろ・足首前に同じ角度だけ曲げると、足の位置がほぼ変わらずに腰が沈む
    [Bone.LeftUpperLeg, Bone.RightUpperLeg].forEach((b) => this.pose(b, knee, 0, 0));
    [Bone.LeftLowerLeg, Bone.RightLowerLeg].forEach((b) => this.pose(b, -2 * knee, 0, 0));
    [Bone.LeftFoot, Bone.RightFoot].forEach((b) => this.pose(b, knee, 0, 0));
    if (this.hips) {
      this.hips.position.y = this.hipsRestY - drop;
      const shift =
        WEIGHT_SHIFT.reduce(
          (sum, w) => sum + w.amplitude * Math.sin((2 * Math.PI * this.breathTime) / w.period + w.phase),
          0
        ) * Math.min(this.motionAmount, 1.5);
      this.weightShift = shift;
      // ワールドの x 方向へずらす(モデルが 180° 回っていれば逆向き)
      this.hips.position.x = this.hipsRestX + shift * this.modelXSign;
      // 重心を乗せた側へ腰が少し傾く
      this.pose(Bone.Hips, 0, 0, -shift * 2);
    }
  }

  private updateUpperBody(frame: JugglingFrame, delta: number) {
    const breath =
      BREATH_AMPLITUDE * Math.sin((2 * Math.PI * this.breathTime) / BREATH_PERIOD) * Math.min(this.motionAmount, 1.5);
    const smooth = (rate: number) => 1 - Math.exp(-rate * delta);
    const twist = this.twist.x;

    // 腰の傾きを背骨で打ち消して、上半身はまっすぐに保つ
    const hipsRoll = this.hips ? -this.weightShift * 2 : 0;
    this.pose(Bone.Spine, -SPINE_LEAN - this.lean.x, twist * 0.3, -hipsRoll * 0.7);
    this.pose(Bone.Chest, breath, twist * 0.4, -hipsRoll * 0.3);
    this.pose(Bone.UpperChest, breath * 0.5, twist * 0.3, 0);

    // 肩: 少し前へ出し、投げた側を少し上げる
    this.arms.forEach((arm, h) => {
      const raise = Math.max(0, this.shoulders[h].x);
      this.pose(
        h === LEFT ? Bone.LeftShoulder : Bone.RightShoulder,
        0,
        arm.side * SHOULDER_FORWARD,
        arm.side * raise
      );
    });

    // 視線: 目は次にキャッチするボールを追い、頭はパターンの頂点を中心に目線へ少し寄せる
    if (!this.eyePoint) this.eyePoint = frame.eyeTarget.clone();
    this.eyePoint.lerp(frame.eyeTarget, smooth(GAZE_SMOOTH));
    this.lookTarget.position.copy(this.eyePoint);
    if (!this.headPoint) this.headPoint = this.eyePoint.clone();
    this.headPoint.lerp(this.eyePoint, smooth(HEAD_SMOOTH));

    const target = frame.gazeTarget;

    if (!this.enableNeck) {
      this.pose(Bone.Neck, 0, 0, 0);
      this.pose(Bone.Head, 0, 0, 0);
      return;
    }
    const distance = Math.max(0.1, Math.abs(target.z));
    const headY = THREE.MathUtils.lerp(target.y, this.headPoint.y, HEAD_FOLLOW_Y);
    // 背骨の前傾と胸のひねりは首で打ち消し、顔はパターンへ向け続ける
    const pitch =
      THREE.MathUtils.clamp(Math.atan2(headY - this.eyeY, distance), HEAD_PITCH_MIN, HEAD_PITCH_MAX) +
      SPINE_LEAN +
      this.lean.x;
    const yaw = -Math.atan2(this.headPoint.x * HEAD_FOLLOW_X, distance) - this.twist.x;
    this.pose(Bone.Neck, pitch * NECK_SHARE, yaw * NECK_SHARE, 0);
    this.pose(Bone.Head, pitch * (1 - NECK_SHARE), yaw * (1 - NECK_SHARE), 0);
  }

  /** 実際に描画する骨の位置。目標点だけでIKの到達を判断しない。 */
  getArmPose(radius = 0.035) {
    return this.arms.map(arm => {
      const delta = worldQuaternion(arm.hand).multiply(arm.restWorld.hand.clone().conjugate());
      const grip = worldPosition(arm.hand).add(arm.palmOffset.clone().applyQuaternion(delta))
        .addScaledVector(arm.restPalmNormal.clone().applyQuaternion(delta), radius + PALM_GAP);
      return { shoulder: worldPosition(arm.upper).toArray(), elbow: worldPosition(arm.lower).toArray(),
        wrist: worldPosition(arm.hand).toArray(), grip: grip.toArray(),
        palmNormal:arm.restPalmNormal.clone().applyQuaternion(delta).toArray(),
        // Report the heading in the palm plane, as used by frameRotation.
        // The avatar's knuckle landmark can sit slightly above that plane.
        fingerDir:arm.restFingerDir.clone().addScaledVector(arm.restPalmNormal,-arm.restFingerDir.dot(arm.restPalmNormal)).normalize().applyQuaternion(delta).toArray() };
    });
  }

  private armAnatomy(arm:ArmRig,fingerDir:THREE.Vector3):ArmAnatomy {
    const shoulders=this.arms.map(a=>worldPosition(a.upper));
    const center=shoulders[0].clone().add(shoulders[1]).multiplyScalar(.5);
    const width=shoulders[0].distanceTo(shoulders[1])*.5;
    return {side:arm.side,centerX:center.x,shoulderZ:center.z,upperLength:arm.upperLength,
      torsoCenter:center.clone().add(new THREE.Vector3(0,-arm.upperLength*.72,.015)),
      torsoRadii:new THREE.Vector3(width*.85+arm.upperLength*.09,arm.upperLength*1.06,width*.60+arm.upperLength*.09),fingerDir};
  }

  getArmPosture() {
    return this.getArmPose().map((p,h)=>armPosture({shoulder:new THREE.Vector3().fromArray(p.shoulder),wrist:new THREE.Vector3().fromArray(p.wrist),
      anatomy:this.armAnatomy(this.arms[h],new THREE.Vector3().fromArray(p.fingerDir))},new THREE.Vector3().fromArray(p.elbow)));
  }

  private planArm(arm: ArmRig, hand: JugglingFrame['hands'][number], propRadius: number, propType: string) {
    const palmNormal = hand.palmNormal;

    // 指先の向き: 指定があればそれ(クラブのハンドルに巻き付く向きなど)。
    // なければ前方・少し内側と、前腕の向きの中間(手首の曲がりすぎを防ぐ)
    const fingerDir =
      hand.fingerDir.lengthSq() > 0.25
        ? hand.fingerDir.clone()
        : FORWARD.clone()
            .addScaledVector(new THREE.Vector3(1, 0, 0), -arm.side * FINGER_INWARD)
            .normalize()
            .add(arm.lastForearmDir)
            .normalize();

    // 手の向き(休止姿勢からの回転)。手のひらの向きを優先して合わせる
    const handDelta = frameRotation(arm.restPalmNormal, arm.restFingerDir, palmNormal, fingerDir);

    // 手のひらの中心がボールの真下に来るような手首の位置
    const palmTarget = hand.position.clone().addScaledVector(palmNormal, -(propRadius + PALM_GAP));
    const wristTarget = palmTarget.sub(arm.palmOffset.clone().applyQuaternion(handDelta));

    // 2 関節 IK
    const shoulder = worldPosition(arm.upper);
    const toWrist = wristTarget.clone().sub(shoulder);
    const L1 = arm.upperLength;
    const L2 = arm.lowerLength;
    const d = THREE.MathUtils.clamp(toWrist.length(), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
    const dir = toWrist.normalize();
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    const hgt = Math.sqrt(Math.max(L1 * L1 - a * a, 0));

    const poleBack = ELBOW_POLE_BACK_BY_PROP[propType] ?? ELBOW_POLE_BACK;
    const pole = hand.elbowPole?.clone() || new THREE.Vector3(arm.side * (ELBOW_POLE_OUT_BASE + this.armAngle), -1, poleBack).normalize();
    const polePerp = pole.clone().addScaledVector(dir, -pole.dot(dir));
    if (polePerp.lengthSq() < 1e-8) polePerp.set(0, -1, 0);
    polePerp.normalize();

    const elbow = shoulder.clone().addScaledVector(dir, a).addScaledVector(polePerp, hgt);
    const wrist = shoulder.clone().addScaledVector(dir, d);
    const preferredElbow = new THREE.Vector3(shoulder.x*.75,shoulder.y-L1*.92,shoulder.z-.025);
    return { handDelta, shoulder, elbow, wrist, wristTarget, reachError:wrist.distanceTo(wristTarget), preferredElbow, anatomy:this.armAnatomy(arm,fingerDir), pole: polePerp, axis: dir,
      rotationsAt:(e:THREE.Vector3)=>this.armRotations(arm,{shoulder,elbow:e,wrist,handDelta,pole:polePerp}),
      center: shoulder.clone().addScaledVector(dir, a), radius: hgt };
  }

  private armRotations(arm:ArmRig,plan:{shoulder:THREE.Vector3;elbow:THREE.Vector3;wrist:THREE.Vector3;handDelta:THREE.Quaternion;pole:THREE.Vector3}) {
    const { shoulder, elbow, wrist, handDelta, pole: polePerp } = plan;

    const upperDir = elbow.clone().sub(shoulder).normalize();
    const lowerDir = wrist.clone().sub(elbow).normalize();
    const hinge = new THREE.Vector3().crossVectors(upperDir, lowerDir);
    if (hinge.lengthSq() < 1e-8) hinge.crossVectors(upperDir, polePerp);
    hinge.normalize();

    const restUpperHinge = new THREE.Vector3().crossVectors(arm.restUpperDir, FORWARD).normalize();
    const restLowerHinge = new THREE.Vector3().crossVectors(arm.restLowerDir, FORWARD).normalize();

    // 上腕
    const upperWorld = frameRotation(arm.restUpperDir, restUpperHinge, upperDir, hinge).multiply(arm.restWorld.upper);

    // 前腕: 肘の曲げ + 手のひらを返す軸方向のひねり
    const lowerDelta = frameRotation(arm.restLowerDir, restLowerHinge, lowerDir, hinge);
    const relative = lowerDelta.clone().conjugate().multiply(handDelta);
    lowerDelta.multiply(forearmTwist(relative,arm.restLowerDir));
    const lowerWorld = lowerDelta.multiply(arm.restWorld.lower);

    // 手
    const handWorld = handDelta.clone().multiply(arm.restWorld.hand);
    return [upperWorld,lowerWorld,handWorld];
  }

  private applyArm(arm: ArmRig, plan: ReturnType<Body['planArm']>) {
    const [upperWorld,lowerWorld,handWorld]=this.armRotations(arm,plan);
    arm.lastForearmDir.copy(plan.wrist).sub(plan.elbow).normalize();
    const parentWorld=worldQuaternion(arm.upper.parent!);
    arm.upper.quaternion.copy(parentWorld.conjugate().multiply(upperWorld));
    arm.lower.quaternion.copy(upperWorld.clone().conjugate().multiply(lowerWorld));
    arm.hand.quaternion.copy(lowerWorld.clone().conjugate().multiply(handWorld));
  }

  private updateFingers(arm: ArmRig, holding: boolean, propType: string, delta: number) {
    const curl = FINGER_CURL[propType] || FINGER_CURL.ball;
    const target = holding ? GRIP_HOLDING : GRIP_EMPTY;
    arm.grip += (target - arm.grip) * (1 - Math.exp(-GRIP_SMOOTH * delta));

    // T ポーズ(手のひら下向き)で z 軸周りに回すと指が手のひら側に曲がる
    arm.fingers.forEach(({ node, joint }) => {
      const angle = FINGER_CURL_OPEN[joint] + (curl[joint] - FINGER_CURL_OPEN[joint]) * arm.grip;
      this.setPose(node, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -arm.side * angle));
    });
    arm.thumbs.forEach(({ node, euler }) => {
      this.setPose(node, new THREE.Quaternion().setFromEuler(euler));
    });
  }
}
