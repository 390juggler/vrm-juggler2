import { expect, it } from 'vitest';
import * as THREE from 'three';
import { avoidArmCollisions, ElbowCircle, planArmCycle, pointSegmentDistance, segmentDistance,armPosture,segmentEllipsoidDistance,ArmAnatomy,underarmRelationsClear,ArmCyclePlanInfo,armOrderGap,armPairClear } from '../src/motion/inspection';
import {forearmTwist} from '../src/motion/body';
const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

it('keeps cross order at a sideways overlap without requiring both arms to cross the body centre',()=>{
 const p=[{shoulder:v(-.2,1.4),wrist:v(-.08,1.3,-.4)},{shoulder:v(.2,1.4),wrist:v(-.15,1.0,-.4)}] as ElbowCircle[];
 const a=v(-.25,1.3,-.2),b=v(.15,1.0,-.2);
 expect(armOrderGap(p,a,b,0)).toBeGreaterThan(.2);
 expect(armPairClear(p,a,b,0)).toBe(true);expect(armPairClear(p,a,b,1)).toBe(false);
 // Translation of the same crossing must not change its required upper arm.
 p.forEach(q=>{q.shoulder.x+=.15;q.wrist.x+=.15;});a.x+=.15;b.x+=.15;
 expect(armPairClear(p,a,b,0)).toBe(true);expect(armPairClear(p,a,b,1)).toBe(false);
});

it('rejects a rapid bone twist even when both elbow positions stay still',()=>{
 const frames=Array.from({length:2},(_,i)=>({balls:[],plans:[-1,1].map(side=>{
  const shoulder=v(side*.4,1.4),wrist=v(side*.4,1.1,-.3),axis=wrist.clone().sub(shoulder).normalize();
  const center=shoulder.clone().lerp(wrist,.5),pole=v(side,0,0),radius=.12;
  return {shoulder,wrist,axis,center,pole,radius,elbow:center.clone().addScaledVector(pole,radius),
   rotationsAt:()=>[new THREE.Quaternion().setFromAxisAngle(v(0,1),i*Math.PI)]};
 })}));
 const info:ArmCyclePlanInfo={};
 expect(planArmCycle(frames,.035,info,.02)).toBeNull();
 expect(info.reason).toBe('no-continuous-path');
});

it('腕の下の指定は前腕の足元と上下の両方を満たす',()=>{
  const plans=[{wrist:v(-.1,1.1,-.3)},{wrist:v(-.1,1.3,-.3)}],elbows=[v(-.2,1.0,-.2),v(.2,1.3,-.3)];
  expect(underarmRelationsClear(plans,elbows,[{hand:0,position:v(.05,1.2,-.3)}])).toBe(true);
  expect(underarmRelationsClear(plans,elbows,[{hand:0,position:v(.05,1.4,-.3)}])).toBe(false);
  expect(underarmRelationsClear(plans,elbows,[{hand:0,position:v(.05,1.2,-.5)}])).toBe(false);
});

it('端点が胴体の外でも、前腕の線分が胴体を通る場合を検出する',()=>{
  expect(segmentEllipsoidDistance(v(-2,0),v(2,0),v(0,0),v(1,1,1))).toBe(0);
  expect(segmentEllipsoidDistance(v(-2,2),v(2,2),v(0,0),v(1,1,1))).toBe(2);
});

it('球に届いても、肘の裏回り・逆側・過度な折り返しを許可しない',()=>{
  const anatomy:ArmAnatomy={side:1,centerX:0,shoulderZ:0,upperLength:.28,torsoCenter:v(0,1.15,0),torsoRadii:v(.12,.25,.10),fingerDir:v(0,0,-1)};
  const p={shoulder:v(.15,1.4),wrist:v(.15,1.15,-.25),anatomy};
  expect(armPosture(p,v(.18,1.15,-.02)).ok).toBe(true);
  expect(armPosture(p,v(.18,1.15,.20)).ok).toBe(false);
  expect(armPosture(p,v(-.20,1.15,-.20)).ok).toBe(false);
  expect(armPosture(p,v(.18,1.56,-.20)).ok).toBe(false);
  expect(armPosture(p,v(.18,1.15,-.50)).ok).toBe(false);
});

it('手のひらが半回転を越えても前腕のひねりが反転しない',()=>{
  const axis=v(1,0),before=new THREE.Quaternion().setFromAxisAngle(axis,Math.PI-.001),after=new THREE.Quaternion().setFromAxisAngle(axis,Math.PI+.001);
  expect(forearmTwist(before,axis).angleTo(forearmTwist(after,axis))).toBeCloseTo(.002,7);
  const swing=new THREE.Quaternion().setFromAxisAngle(v(0,1),.4);
  expect(forearmTwist(swing.clone().multiply(before),axis).angleTo(forearmTwist(swing.clone().multiply(after),axis))).toBeCloseTo(.002,7);
});

it('線分の距離は交差、平行、端点、長さゼロを区別する', () => {
  expect(segmentDistance(v(-1,0),v(1,0),v(0,-1),v(0,1))).toBeCloseTo(0);
  expect(segmentDistance(v(-1,0),v(1,0),v(-1,2),v(1,2))).toBeCloseTo(2);
  expect(segmentDistance(v(-1,0),v(1,0),v(3,2),v(3,4))).toBeCloseTo(Math.sqrt(8));
  expect(segmentDistance(v(-1,0),v(1,0),v(0,2),v(0,2))).toBeCloseTo(2);
  expect(segmentDistance(v(0,2),v(0,2),v(-1,0),v(1,0))).toBeCloseTo(2);
});

it('両腕単独では取れる姿勢があっても、手首同士が近すぎる場合は間隔の不足を測定する',()=>{
  const plans=[-1,1].map(side=>{
    const shoulder=v(side*.2,1.4),wrist=v(side*.01,1.1,-.25),axis=wrist.clone().sub(shoulder).normalize();
    const center=shoulder.clone().lerp(wrist,.5),radius=.18,pole=v(side,-1).addScaledVector(axis,-v(side,-1).dot(axis)).normalize();
    return {shoulder,wrist,axis,center,pole,radius,elbow:center.clone().addScaledVector(pole,radius)};
  });
  const info:ArmCyclePlanInfo={};
  expect(planArmCycle([{plans,balls:[]},{plans,balls:[]}],.025,info)).toBeNull();
  expect(info.reason).toBe('no-feasible-pose');expect(info.details!.clear.every(n=>n>0)).toBe(true);
  expect(info.details!.pair!.requiredClearance).toBe(.08);
  expect(info.details!.pair!.maxClearance).toBeCloseTo(.02,8);
  expect(info.details!.pair!.maxRelatedClearance).toBe(info.details!.pair!.maxClearance);
});

it('片腕にも球を避ける姿勢がない場合は、腕どうしの間隔を0と捏造しない',()=>{
  const plans=[-1,1].map(side=>{
    const shoulder=v(side*.2,1.4),wrist=v(side*.3,1.1,-.25),axis=wrist.clone().sub(shoulder).normalize();
    const center=shoulder.clone().lerp(wrist,.5),radius=.18,pole=v(side,-1).addScaledVector(axis,-v(side,-1).dot(axis)).normalize();
    return {shoulder,wrist,axis,center,pole,radius,elbow:center.clone().addScaledVector(pole,radius)};
  });
  const info:ArmCyclePlanInfo={};
  expect(planArmCycle([{plans,balls:[plans[0].shoulder.clone()]}],.025,info)).toBeNull();
  expect(info.details!.clear[0]).toBe(0);expect(info.details!.pair!.maxClearance).toBeNull();
});

it('肘の基準方向が反転しても、球を避けて同じ位置につながる周期を解く', () => {
  const count = 24;
  const frames = Array.from({length:count},(_,i)=> {
    const plans = [-1,1].map(side => {
      const shoulder=v(side*.2,1.4),wrist=v(side*.3,1.1,-.25);
      const axis=wrist.clone().sub(shoulder).normalize();
      const center=shoulder.clone().lerp(wrist,.5),radius=.18;
      const pole=v(side,-1,0).addScaledVector(axis,-v(side,-1,0).dot(axis)).normalize();
      if(i>=count/2) pole.negate();
      return {shoulder,wrist,axis,center,pole,radius,elbow:center.clone().addScaledVector(pole,radius)};
    });
    return {plans,balls:[v(-.35,1.20,-.1)]};
  });
  const angles=planArmCycle(frames,.035);
  expect(angles).not.toBeNull();
  const elbows=frames.map((f,i)=>f.plans.map((p,h)=>p.center.clone().addScaledVector(p.pole.clone().applyAxisAngle(p.axis,angles![h][i]),p.radius)));
  frames.forEach((f,i)=>f.plans.forEach((p,h)=> {
    const elbow=elbows[i][h],next=elbows[(i+1)%count][h];
    expect(elbow.distanceTo(next)/(1/count)).toBeLessThanOrEqual(8+1e-8);
    expect(elbow.distanceTo(p.shoulder)).toBeCloseTo(Math.hypot(p.shoulder.distanceTo(p.center),p.radius),8);
    expect(Math.min(pointSegmentDistance(f.balls[0],p.shoulder,elbow),pointSegmentDistance(f.balls[0],elbow,p.wrist.clone().lerp(elbow,.2)))).toBeGreaterThan(.075);
  }));
});

it('球が前腕上にある時、手首と骨の長さを変えずに肘の平面を変える', () => {
  function plan(shoulder: THREE.Vector3, wrist: THREE.Vector3, pole: THREE.Vector3): ElbowCircle {
    const axis = wrist.clone().sub(shoulder).normalize();
    const distance = wrist.distanceTo(shoulder);
    const along = (0.28 ** 2 - 0.26 ** 2 + distance ** 2) / (2 * distance);
    const radius = Math.sqrt(0.28 ** 2 - along ** 2);
    const center = shoulder.clone().addScaledVector(axis, along);
    pole.addScaledVector(axis, -pole.dot(axis)).normalize();
    return { shoulder, wrist, center, axis, pole, radius, elbow: center.clone().addScaledVector(pole, radius) };
  }
  const plans = [plan(v(-.136,1.4,0),v(.127,1.23,-.248),v(-.8,-.1,-.6)), plan(v(.136,1.4,0),v(-.127,1.08,-.20),v(.8,-1,.25))];
  const ball = plans[0].elbow.clone().lerp(plans[0].wrist, 0.5);
  const oldWrist = plans[0].wrist.clone();
  expect(pointSegmentDistance(ball, plans[0].elbow, plans[0].wrist)).toBeLessThan(1e-9);
  avoidArmCollisions(plans, [ball], 0.035);
  expect(pointSegmentDistance(ball, plans[0].elbow, plans[0].wrist)).toBeGreaterThan(0.07);
  for (const p of plans) {
    expect(p.elbow.distanceTo(p.shoulder)).toBeCloseTo(0.28, 8);
    expect(p.elbow.distanceTo(p.wrist)).toBeCloseTo(0.26, 8);
  }
  expect(plans[0].wrist.distanceTo(oldWrist)).toBe(0);
});
