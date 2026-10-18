import * as THREE from 'three';

export type ShortStyle = 'normal' | 'shuffle' | 'reverse' | 'inverted' | 'vertical-up' | 'vertical-down';
/** Saved IDs: outside is displayed as Inside (own side), cross-side as Outside (opposite side). */
export type ShortLane = 'center' | 'outside' | 'cross-side';
export type ArmOrder = 'none' | 'left-over' | 'right-over' | 'alternate';
export type ArmRelation = 'free' | 'underarm';
export type CarryRoute = 'direct' | 'outside' | 'inside' | 'front' | 'back';

/** Coordinates in arm-length units, relative to the throwing hand's side and the low catch plane.
 * +x is that hand's anatomical side; -z is in front of the performer. Mirroring happens last. */
export interface MotionPoint { x: number; y: number; z: number; relation?: ArmRelation }
export interface CarryDefinition {
  route: CarryRoute;
  amount: number;
  /** Smooth free waypoint offset, zero position/velocity at both endpoints. */
  offset?: [number,number,number];
  /** Displacement from the smooth catch-to-release path, at a fraction of the carry interval. */
  via?: { at: number; offset: [number, number, number] }[];
  /** Independent smooth detours, so resolved movement preserves every knot exactly. */
  detours?: { at: number; offset: [number, number, number] }[][];
}
export interface MotionDefinition {
  release: MotionPoint;
  /** A passage constraint, not a bend inserted into an airborne trajectory. */
  passage: { at: number; point?: [number, number, number] };
  catch: MotionPoint;
  /** Set flight time from the vertical rise so the catch occurs at the apex. */
  catchAtApex?: boolean;
  /** Fraction of the time until this ball's next release spent in flight. */
  flightFraction?: number;
  carry: CarryDefinition;
  emptyReturn?: CarryDefinition;
  /** The return already includes every default dodge from a resolved state. */
  emptyReturnExact?: boolean;
}
export interface ShortMotionOptions {
  /** Resolve above/below against the other balls at lane crossings, not a fixed floor height. */
  ballOrder?: 'style';
  lane?: ShortLane;
  lateral?: boolean;
  releaseRelation?: ArmRelation;
  catchRelation?: ArmRelation;
  carry?: CarryRoute;
  /** Optional exact definition, using the same four stages as the visual controls. */
  definition?: MotionDefinition;
}

export function validateDefinition(d: MotionDefinition) {
  const points = [d.release, d.catch];
  if (points.some(p => !p || ![p.x,p.y,p.z].every(Number.isFinite) ||
      p.relation !== undefined && !['free','underarm'].includes(p.relation)) ||
      !(d.passage?.at > 0 && d.passage.at < 1) || d.catchAtApex!==undefined&&typeof d.catchAtApex!=='boolean' ||
      d.emptyReturnExact!==undefined&&typeof d.emptyReturnExact!=='boolean' ||
      d.flightFraction!==undefined&&(!Number.isFinite(d.flightFraction)||d.flightFraction<=0||d.flightFraction>=1||d.catchAtApex) ||
      !['direct','outside','inside','front','back'].includes(d.carry?.route) ||
      !Number.isFinite(d.carry.amount) || d.carry.amount < 0 || d.carry.amount > .5)
    throw new Error('投げ・通過・捕球・運びの指定を確認してください。');
  const carries=[d.carry,...(d.emptyReturn?[d.emptyReturn]:[])];
  if(carries.some(c=>!['direct','outside','inside','front','back'].includes(c.route) || !Number.isFinite(c.amount) || c.amount<0 || c.amount>.5))
    throw new Error('手の運びの方向と大きさを確認してください。');
  const curves=(c:CarryDefinition)=>[c.via||[],...(c.detours||[])];
  const vectors = [d.passage.point, ...carries.flatMap(c=>[c.offset,...curves(c).flat().map(v => v.offset)])].filter(Boolean);
  if (vectors.some(v => v!.length !== 3 || !v!.every(Number.isFinite)) ||
      carries.some(c=>curves(c).some(curve=>curve.some((v,i,a) => !(v.at > 0 && v.at < 1) || i > 0 && v.at <= a[i-1].at))))
    throw new Error('通過点は有限の座標、運びの経由点は時刻順に指定してください。');
}

export function shortDefinition(style: ShortStyle, options: ShortMotionOptions, switched: boolean, crossed: boolean): MotionDefinition {
  if (options.definition) { validateDefinition(options.definition); return structuredClone(options.definition); }
  const vertical = style.startsWith('vertical-');
  const lane = options.lane || 'center';
  const width = crossed ? -.13 : options.lateral ? .26 : switched ? .29 : .19;
  const x = lane === 'outside' ? .28 : lane === 'cross-side' ? -.24 : .065;
  const lateral = options.lateral ? -1 : 1;
  const startX = vertical ? x : width * lateral;
  const endX = vertical ? x : -width * lateral;
  const raisedRelease = ['shuffle','inverted','vertical-down'].includes(style);
  const raisedCatch = ['reverse','inverted','vertical-up'].includes(style);
  const z = vertical ? (lane==='center' ? switched ? -.37 : -.34 : -.17) : options.lateral ? -.14 : switched ? -.13 : style === 'normal' ? -.29 : -.21;
  return {
    release: {x:startX,y:raisedRelease ? style==='vertical-down' ? .28 : .40 : 0,z,relation:options.releaseRelation || 'free'},
    passage: {at:.5},
    catch: {x:endX,y:raisedCatch ? .40 : 0,z,relation:options.catchRelation || 'free'},
    // A generic outward flourish can take a crossed wrist back to its own
    // side. Explicit routes remain available; default crossed carries stay direct.
    carry: {route:options.carry || (crossed ? 'direct' : switched || options.lateral ? 'back' : raisedRelease || raisedCatch ? 'outside' : 'direct'),amount:vertical ? .06 : switched ? .08 : .12},
  };
}

/** A full orthogonal hand frame follows the outgoing velocity at release and the
 * incoming ball at catch. The support bias prevents a flat pass from twisting the wrist 90 degrees. */
export function handFrame(velocity: THREE.Vector3, release: boolean, overhand: boolean, handSide: number, reachDirection?:THREE.Vector3) {
  const direction = velocity.clone().multiplyScalar(release ? 1 : -1).normalize();
  const palm = direction.clone();
  const support = new THREE.Vector3(0, overhand ? -1 : 1, 0);
  if (!overhand && palm.y < -.15) palm.y = -.15;
  palm.multiplyScalar(.45).addScaledVector(support,.85).normalize();
  // The hand turns toward the outgoing ball, or toward where the incoming ball
  // arrives from. A small reach-aligned component gives vertical throws a stable
  // heading and keeps the wrist connected naturally when the hand moves sideways.
  const reach = reachDirection?.clone().normalize() || new THREE.Vector3(-handSide*.22,0,-1).normalize();
  reach.addScaledVector(palm,-reach.dot(palm)).normalize();
  const forward=reach.clone().multiplyScalar(.4).addScaledVector(direction,Math.hypot(direction.x,direction.z));
  const finger = forward.addScaledVector(palm,-forward.dot(palm)).normalize();
  // Turning toward the ball must not fold the fingers back along the forearm.
  // The palm still faces the ball; wrist heading stays within 45 degrees of reach.
  const turn=reach.angleTo(finger);
  if(turn>Math.PI/4){
    const axis=new THREE.Vector3().crossVectors(reach,finger).normalize();
    finger.copy(reach).applyAxisAngle(axis,Math.PI/4);
  }
  const z = finger.clone().negate();
  const x = new THREE.Vector3().crossVectors(palm,z).normalize();
  return {palm,rotation:new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,palm,z))};
}

export function carryOffset(carry: CarryDefinition, u: number, handSide: number, scale: number) {
  const hump = 16*u*u*(1-u)*(1-u);
  const offset = new THREE.Vector3();
  if (carry.route === 'outside') offset.x = handSide*carry.amount*hump;
  if (carry.route === 'inside') offset.x = -handSide*carry.amount*hump;
  if (carry.route === 'front') offset.z = -carry.amount*hump;
  if (carry.route === 'back') offset.z = carry.amount*hump;
  if(carry.offset)offset.add(new THREE.Vector3(...carry.offset).multiply(new THREE.Vector3(handSide,1,1)).multiplyScalar(hump));
  for (const curve of [carry.via||[],...(carry.detours||[])]) if(curve.length) {
    const nodes = [{at:0,offset:[0,0,0]}, ...curve, {at:1,offset:[0,0,0]}];
    const end = nodes.findIndex(n=>n.at >= u);
    const a=nodes[Math.max(0,end-1)], b=nodes[Math.max(1,end)];
    let t=(u-a.at)/(b.at-a.at); t=t*t*(3-2*t);
    offset.add(new THREE.Vector3().fromArray(a.offset).lerp(new THREE.Vector3().fromArray(b.offset),t).multiply(new THREE.Vector3(handSide,1,1)));
  }
  return offset.multiplyScalar(scale);
}

/** An up/down palm flip has two equally short paths. Choose the anatomically
 * inward-facing palm halfway through, leaving the wrist outside the ball. */
export function handRotationBetween(a:THREE.Quaternion,b:THREE.Quaternion,u:number,handSide:number) {
  const t=u*u*(3-2*u);
  const palmA=new THREE.Vector3(0,1,0).applyQuaternion(a),palmB=new THREE.Vector3(0,1,0).applyQuaternion(b);
  if(palmA.dot(palmB)>-.7)return a.clone().slerp(b,t);
  const finger=new THREE.Vector3(0,0,-1).applyQuaternion(a).add(new THREE.Vector3(0,0,-1).applyQuaternion(b)).normalize();
  if(finger.lengthSq()<.5)return a.clone().slerp(b,t);
  const palm=new THREE.Vector3(-handSide,0,0);
  palm.addScaledVector(finger,-palm.dot(finger)).normalize();
  const z=finger.clone().negate(),x=new THREE.Vector3().crossVectors(palm,z).normalize();
  const mid=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,palm,z));
  return a.clone().slerp(mid,t).slerp(mid.clone().slerp(b,t),t);
}
