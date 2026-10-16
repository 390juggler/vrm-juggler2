import * as THREE from 'three';

export function pointSegmentDistance(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  const ab = b.clone().sub(a);
  const u = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / Math.max(1e-12, ab.lengthSq()), 0, 1);
  return p.distanceTo(a.clone().addScaledVector(ab, u));
}

export function segmentDistance(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) {
  const u = b.clone().sub(a), v = d.clone().sub(c), w = a.clone().sub(c);
  const aa = u.dot(u), bb = u.dot(v), cc = v.dot(v), dd = u.dot(w), ee = v.dot(w);
  if (aa < 1e-12) return pointSegmentDistance(a, c, d);
  if (cc < 1e-12) return pointSegmentDistance(c, a, b);
  const denom = aa * cc - bb * bb;
  let s = denom > 1e-12 ? THREE.MathUtils.clamp((bb * ee - cc * dd) / denom, 0, 1) : 0;
  let t = cc > 1e-12 ? (bb * s + ee) / cc : 0;
  if (t < 0) { t = 0; s = aa > 1e-12 ? THREE.MathUtils.clamp(-dd / aa, 0, 1) : 0; }
  else if (t > 1) { t = 1; s = aa > 1e-12 ? THREE.MathUtils.clamp((bb - dd) / aa, 0, 1) : 0; }
  return a.clone().addScaledVector(u, s).distanceTo(c.clone().addScaledVector(v, t));
}

export interface ElbowCircle {
  shoulder: THREE.Vector3;
  wrist: THREE.Vector3;
  center: THREE.Vector3;
  axis: THREE.Vector3;
  pole: THREE.Vector3;
  radius: number;
  elbow: THREE.Vector3;
  /** Restful elbow location; unlike a pole angle it is stable when the wrist crosses the body. */
  preferredElbow?: THREE.Vector3;
  anatomy?: ArmAnatomy;
  reachError?: number;
  /** The rig's actual upper/forearm/hand rotations for this elbow. */
  rotationsAt?:(elbow:THREE.Vector3)=>THREE.Quaternion[];
}

/** Conservative workspace for juggling in front of the body, scaled to the avatar. */
export interface ArmAnatomy {
  side: number;
  centerX: number;
  shoulderZ: number;
  upperLength: number;
  torsoCenter: THREE.Vector3;
  torsoRadii: THREE.Vector3;
  fingerDir: THREE.Vector3;
}

export function segmentEllipsoidDistance(a:THREE.Vector3,b:THREE.Vector3,center:THREE.Vector3,radii:THREE.Vector3) {
  const from=a.clone().sub(center).divide(radii),to=b.clone().sub(center).divide(radii);
  return pointSegmentDistance(new THREE.Vector3(),from,to);
}

export function armPosture(p:Pick<ElbowCircle,'shoulder'|'wrist'|'anatomy'>,elbow:THREE.Vector3,margin=0) {
  const a=p.anatomy;
  if(!a)return {ok:true,torso:Infinity,behind:Infinity,side:Infinity,height:Infinity,wristBend:0,elbowFlex:0};
  const upper=elbow.clone().sub(p.shoulder).normalize(),lower=p.wrist.clone().sub(elbow).normalize();
  const torso=Math.min(segmentEllipsoidDistance(p.shoulder,elbow,a.torsoCenter,a.torsoRadii),segmentEllipsoidDistance(elbow,p.wrist,a.torsoCenter,a.torsoRadii));
  const behind=a.shoulderZ+a.upperLength*.45-elbow.z;
  const side=(elbow.x-a.centerX)*a.side+a.upperLength*.12;
  const height=Math.max(p.shoulder.y-a.upperLength*.15,p.wrist.y-a.upperLength*.30)-elbow.y;
  const wristBend=lower.angleTo(a.fingerDir),elbowFlex=upper.angleTo(lower);
  return {ok:torso>=1+margin*4 && behind>=margin && side>=margin && height>=margin && wristBend<Math.PI*.48-margin*3 && elbowFlex<Math.PI*.86-margin*3,
    torso,behind,side,height,wristBend,elbowFlex};
}

export interface UnderarmConstraint { hand:number; position:THREE.Vector3 }
export interface ArmCycleFrame { plans: ElbowCircle[]; balls: THREE.Vector3[]; upperHand?:number|null; underarm?:UnderarmConstraint[] }

/** Smooth search objective, never an acceptance test. It evaluates BOTH arms
 * together, including their best compatible bend directions. Final planning
 * still checks the original anatomical, collision and continuity predicates. */
export function armPosePenalty(frame:ArmCycleFrame,ballRadius:number){
  return armPoseCandidates(frame,ballRadius,1)[0].cost;
}

export function armPoseCandidates(frame:ArmCycleFrame,ballRadius:number,limit=8,divisions=18){
  const sq=(v:number)=>Math.max(0,v)**2,plans=frame.plans;
  const candidates=plans.map(p=>Array.from({length:divisions},(_,i)=>{
    const elbow=p.center.clone().addScaledVector(p.pole.clone().applyAxisAngle(p.axis,i*2*Math.PI/divisions),p.radius);
    const posture=armPosture(p,elbow,.006),end=p.wrist.clone().lerp(elbow,.2);
    const distance=Math.min(...frame.balls.map(ball=>Math.min(pointSegmentDistance(ball,p.shoulder,elbow),pointSegmentDistance(ball,elbow,end))));
    const cost=sq((1.03-posture.torso)*.08)+sq(.009-posture.behind)+sq(.009-posture.side)+sq(.009-posture.height)+
      sq((posture.wristBend-Math.PI*.48+.024)*.12)+sq((posture.elbowFlex-Math.PI*.86+.024)*.12)+sq(ballRadius+.047-distance)+sq((p.reachError||0)-.004);
    return {elbow,cost,height:armCenterHeight(p.shoulder,elbow,p.wrist)};
  }));
  const pairs:{cost:number;elbows:THREE.Vector3[];rotations?:THREE.Quaternion[][]}[]=[];
  for(const a of candidates[0])for(const b of candidates[1]){
    if(pairs.length===limit&&a.cost+b.cost>=pairs[limit-1].cost)continue;
    const gap=Math.min(...[[plans[0].shoulder,a.elbow],[a.elbow,plans[0].wrist]].flatMap(l=>
      [[plans[1].shoulder,b.elbow],[b.elbow,plans[1].wrist]].map(r=>segmentDistance(l[0],l[1],r[0],r[1]))));
    const gapOrder=frame.upperHand==null?undefined:a.height!==null&&b.height!==null?
      (a.height-b.height)*(frame.upperHand===0?1:-1):armOrderGap(plans,a.elbow,b.elbow,frame.upperHand);
    const order=gapOrder===undefined?0:Math.max(0,.045-gapOrder);
    const elbows=[a.elbow,b.elbow];
    const under=(frame.underarm||[]).reduce((sum,r)=>{const other=1-r.hand,v=underForearm(r.position,elbows[other],plans[other].wrist);
      return sum+sq(v.horizontalDistance-.075)+sq(.05-v.verticalGap);},0);
    const cost=a.cost+b.cost+sq(.09-gap)+order*order+under;
    if(pairs.length<limit||cost<pairs[limit-1].cost){
      pairs.push({cost,elbows});pairs.sort((a,b)=>a.cost-b.cost);pairs.length=Math.min(limit,pairs.length);
    }
  }
  for(const pair of pairs)if(plans.every(p=>p.rotationsAt))pair.rotations=pair.elbows.map((e,h)=>plans[h].rotationsAt!(e));
  return pairs;
}

export function armPoseClear(p:ElbowCircle,e:THREE.Vector3,balls:THREE.Vector3[],ballRadius:number,margin=0) {
  if((p.reachError||0)>.008 || !armPosture(p,e,margin).ok)return false;
  const end=p.wrist.clone().lerp(e,.2);
  return balls.every(b=>Math.min(pointSegmentDistance(b,p.shoulder,e),pointSegmentDistance(b,e,end))>ballRadius+.03+margin);
}

export function armPairClear(p:ElbowCircle[],a:THREE.Vector3,b:THREE.Vector3,upperHand?:number|null,gap=.065) {
  for(const l of [[p[0].shoulder,a],[a,p[0].wrist]])for(const r of [[p[1].shoulder,b],[b,p[1].wrist]])
    if(segmentDistance(l[0],l[1],r[0],r[1])<gap)return false;
  if(upperHand!==undefined && upperHand!==null){
    const gap=armOrderGap(p,a,b,upperHand);
    if(gap!==undefined&&gap<.025)return false;
  }
  return true;
}

export function armCenterHeight(shoulder:THREE.Vector3,elbow:THREE.Vector3,wrist:THREE.Vector3) {
  for(const [a,b] of [[elbow,wrist],[shoulder,elbow]])
    if(a.x*b.x<=0 && Math.abs(a.x-b.x)>1e-6)return a.y+(b.y-a.y)*(-a.x/(b.x-a.x));
  return null;
}

/** Crossed columns can hand a vertical 2x to a wrist on the same side.
 * Check upper/lower order in the arms' shared horizontal span, not at a
 * compulsory x=0 crossing. With disjoint spans there is no crossing to rank;
 * the ordinary 3D separation and posture checks still apply to both arms. */
export function armOrderGap(p:Pick<ElbowCircle,'shoulder'|'wrist'>[],a:THREE.Vector3,b:THREE.Vector3,upperHand:number):number|undefined{
  const left=armCenterHeight(p[0].shoulder,a,p[0].wrist),right=armCenterHeight(p[1].shoulder,b,p[1].wrist);
  if(left!==null&&right!==null)return (left-right)*(upperHand===0?1:-1);
  const arms=[[p[0].shoulder,a,p[0].wrist],[p[1].shoulder,b,p[1].wrist]];
  const lo=Math.max(...arms.map(points=>Math.min(...points.map(v=>v.x))));
  const hi=Math.min(...arms.map(points=>Math.max(...points.map(v=>v.x))));
  if(lo>hi+1e-7)return undefined;
  const x=Math.max(lo,Math.min(hi,0));
  const height=(points:THREE.Vector3[])=>{
    for(const [s,e] of [[points[1],points[2]],[points[0],points[1]]]){
      if(x>=Math.min(s.x,e.x)-1e-7&&x<=Math.max(s.x,e.x)+1e-7&&Math.abs(e.x-s.x)>1e-8)
        return s.y+(e.y-s.y)*(x-s.x)/(e.x-s.x);
    }
    return points[2].y;
  };
  return (height(arms[0])-height(arms[1]))*(upperHand===0?1:-1);
}

/** Vertical distance below the other forearm, with a separate horizontal footprint check. */
export function underForearm(point:THREE.Vector3,elbow:THREE.Vector3,wrist:THREE.Vector3) {
  const dx=wrist.x-elbow.x,dz=wrist.z-elbow.z;
  const u=THREE.MathUtils.clamp(((point.x-elbow.x)*dx+(point.z-elbow.z)*dz)/Math.max(1e-12,dx*dx+dz*dz),0,1);
  const above=elbow.clone().lerp(wrist,u);
  return {horizontalDistance:Math.hypot(point.x-above.x,point.z-above.z),verticalGap:above.y-point.y};
}

export function underarmRelationsClear(plans:Pick<ElbowCircle,'wrist'>[],elbows:THREE.Vector3[],relations:UnderarmConstraint[]=[],margin=0){
  return relations.every(r=>{
    const other=1-r.hand,relation=underForearm(r.position,elbows[other],plans[other].wrist);
    return relation.horizontalDistance<.085-margin && relation.verticalGap>.04+margin;
  });
}

export interface ArmCyclePlanInfo {
  /** Bounded construction; collisions are measured and disclosed, not certified away. */
  contactFallback?:boolean;
  construction?:'direct'|'circle'|'retract';
  candidates?:number;
  reason?:string;phase?:number;wristStep?:number;keyCount?:number;
  details?:{
    clear:number[];
    posture:{counts:Record<string,number>;clear:number;deficit?:number}[];
    reachErrors:number[];wrists:number[][];balls:number[][];
    ballClearances?:number[];
    pair?:{requiredClearance:number;maxClearance:number|null;maxRelatedClearance:number|null;maxOrderDifference?:number|null;upperHand:number|null;underarm:boolean};
  };
}

/** A periodic shortest path through feasible pairs of elbow bend angles. */
export function planArmCycle(frames: ArmCycleFrame[], ballRadius: number, info: ArmCyclePlanInfo = {}, period = 1,phases?:number[],divisions=36,rotateStart=true): number[][] | null {
  const count = frames.length, states = divisions * divisions;
  const requiredClearance=.08,requiredOrder=.035;
  info.wristStep = Math.max(...frames.flatMap((f,i)=>f.plans.map((p,h)=>p.wrist.distanceTo(frames[(i+1)%count].plans[h].wrist))));
  const angle = (i: number) => (i <= divisions / 2 ? i : i - divisions) * 2 * Math.PI / divisions;
  const elbowAt = (p: ElbowCircle, i: number) => p.center.clone().addScaledVector(p.pole.clone().applyAxisAngle(p.axis, angle(i)), p.radius);
  const armClear = (p: ElbowCircle, e: THREE.Vector3, balls: THREE.Vector3[]) => {
    if((p.reachError||0)>.008 || !armPosture(p,e,.006).ok)return false;
    const end = p.wrist.clone().lerp(e, 0.2);
    return balls.every(b => Math.min(pointSegmentDistance(b, p.shoulder, e), pointSegmentDistance(b, e, end)) > ballRadius + 0.04);
  };
  const pairClear = (p: ElbowCircle[], a: THREE.Vector3, b: THREE.Vector3, upperHand?:number|null,underarm?:UnderarmConstraint[]) => {
    if(!underarmRelationsClear(p,[a,b],underarm,.004))return false;
    for (const l of [[p[0].shoulder,a],[a,p[0].wrist]]) for (const r of [[p[1].shoulder,b],[b,p[1].wrist]])
      if (segmentDistance(l[0],l[1],r[0],r[1]) < requiredClearance) return false;
    if(upperHand!==undefined && upperHand!==null){
      const gap=armOrderGap(p,a,b,upperHand);
      if(gap!==undefined&&gap<requiredOrder)return false;
    }
    return true;
  };
  const torsoCost = (p: ElbowCircle, e: THREE.Vector3) => p.preferredElbow ? .35*e.distanceToSquared(p.preferredElbow) : 0;
  const phaseAt=(i:number)=>phases?.[i]??i/count;
  const intervals=frames.map((_,i)=>phases?phaseAt(i)-phaseAt((i+count-1)%count)+(i===0?1:0):1/count);
  const maxStepSquared=intervals.map(dt=>(8*period*dt)**2);
  const turnsClear=(a:THREE.Quaternion[]|undefined,b:THREE.Quaternion[]|undefined,t:number)=>
    !a||!b||a.every((q,j)=>q.angleTo(b[j])<=80*period*intervals[t]);
  const moveClear=(t:number,h:number,e:THREE.Vector3,previous:THREE.Vector3)=>
    e.distanceToSquared(previous)<=maxStepSquared[t]&&turnsClear(frames[t].plans[h].rotationsAt?.(e),frames[(t+count-1)%count].plans[h].rotationsAt?.(previous),t);
  if (frames.every((f,i) => f.plans.every((p,h) => armClear(p,p.elbow,f.balls) &&
      moveClear((i+1)%count,h,frames[(i+1)%count].plans[h].elbow,p.elbow)) && pairClear(f.plans,f.plans[0].elbow,f.plans[1].elbow,f.upperHand,f.underarm)))
    return [new Array(count).fill(0), new Array(count).fill(0)];

  const elbows = frames.map(f => f.plans.map(p => Array.from({length:divisions},(_,i)=>elbowAt(p,i))));
  const rotations=frames.map((f,t)=>f.plans.map((p,h)=>elbows[t][h].map(e=>p.rotationsAt?.(e))));
  const costs = frames.map((f,t) => {
    const result = new Float64Array(states).fill(Infinity);
    const clear = f.plans.map((p,h) => elbows[t][h].map(e => armClear(p,e,f.balls)));
    for (let l=0;l<divisions;l++) for (let r=0;r<divisions;r++) {
      if (!clear[0][l] || !clear[1][r] || !pairClear(f.plans,elbows[t][0][l],elbows[t][1][r],f.upperHand,f.underarm)) continue;
      result[l*divisions+r] = .0001*(angle(l)**2+angle(r)**2) + torsoCost(f.plans[0],elbows[t][0][l]) + torsoCost(f.plans[1],elbows[t][1][r]);
    }
    return result;
  });
  const empty = costs.findIndex(c=>!c.some(Number.isFinite));
  if (empty>=0) { info.reason='no-feasible-pose';info.phase=phaseAt(empty);
    const f=frames[empty],available=f.plans.map((p,h)=>elbows[empty][h].filter(e=>armClear(p,e,f.balls)));
    let maxClearance:number|null=null,maxRelatedClearance:number|null=null,maxOrderDifference:number|null=null;
    // Only diagnose the rejected frame. The candidates, constraints and path
    // search above stay unchanged; a maximum over this grid is not an anatomy
    // impossibility proof and must not be presented as one.
    for(const a of available[0])for(const b of available[1]){
      const gap=Math.min(...[[f.plans[0].shoulder,a],[a,f.plans[0].wrist]].flatMap(l=>
        [[f.plans[1].shoulder,b],[b,f.plans[1].wrist]].map(r=>segmentDistance(l[0],l[1],r[0],r[1]))));
      maxClearance=Math.max(maxClearance??0,gap);
      if(!underarmRelationsClear(f.plans,[a,b],f.underarm,.004))continue;
      if(f.upperHand!==undefined&&f.upperHand!==null){
        const orderGap=armOrderGap(f.plans,a,b,f.upperHand);
        if(orderGap!==undefined)maxOrderDifference=Math.max(maxOrderDifference??-Infinity,orderGap);
        if(orderGap!==undefined&&orderGap<requiredOrder)continue;
      }
      maxRelatedClearance=Math.max(maxRelatedClearance??0,gap);
    }
    info.details={clear:available.map(e=>e.length),
      posture:f.plans.map((p,h)=>{
        const checks=elbows[empty][h].map(e=>armPosture(p,e,.006));
        return {counts:Object.fromEntries(['torso','behind','side','height','wristBend','elbowFlex'].map(k=>[k,checks.filter(c=>k==='torso'?c[k]>=1.024:k==='wristBend'?c[k]<Math.PI*.48-.018:k==='elbowFlex'?c[k]<Math.PI*.86-.018:c[k as 'behind']>=.006).length])),
          clear:checks.filter(c=>c.ok).length,
          deficit:Math.min(...checks.map(c=>Math.max(0,1.024-c.torso)*.1+Math.max(0,.006-c.behind)+Math.max(0,.006-c.side)+Math.max(0,.006-c.height)+
            Math.max(0,c.wristBend-Math.PI*.48+.018)*.1+Math.max(0,c.elbowFlex-Math.PI*.86+.018)*.1))};
      }),
      reachErrors:f.plans.map(p=>p.reachError||0),
      ballClearances:f.plans.map((p,h)=>Math.max(...elbows[empty][h].filter(e=>armPosture(p,e,.006).ok).map(e=>{
        const end=p.wrist.clone().lerp(e,.2);
        return Math.min(...f.balls.map(b=>Math.min(pointSegmentDistance(b,p.shoulder,e),pointSegmentDistance(b,e,end))));
      }),0)),
      wrists:f.plans.map(p=>p.wrist.toArray()),balls:f.balls.map(b=>b.toArray()),
      pair:{requiredClearance,maxClearance,maxRelatedClearance,maxOrderDifference,upperHand:f.upperHand??null,underarm:!!f.underarm?.length}};return null; }
  // Bound motion in world space: angle adjacency alone is meaningless when the
  // shoulder-to-wrist axis moves or the preferred pole passes near that axis.
  const transitions = elbows.map((hands,t) => hands.map((points,h) => points.map((e,k) =>
    elbows[(t+count-1)%count][h].map((previous,i) => ({ i, cost:e.distanceToSquared(previous) }))
      .filter(move=>move.cost <= maxStepSquared[t]&&turnsClear(rotations[t][h][k],rotations[(t+count-1)%count][h][move.i],t)))));
  const solve = (seed?:number) => {
    let distance = costs[0].slice();
    if(seed!==undefined) { distance.fill(Infinity); distance[seed]=costs[0][seed]; }
    const parents = Array.from({length:count},()=>new Int16Array(states).fill(-1));
    for(let t=1;t<count;t++) {
      const next = new Float64Array(states).fill(Infinity);
      // Each edge's motion limits/costs separate by arm; the previous and
      // current pair constraints remain in the two-dimensional state arrays.
      // Two min-plus passes give the same joint optimum in O(d^3), avoiding
      // O(d^4) enumeration at every key of a long composed cycle.
      const middle=new Float64Array(states).fill(Infinity),leftParent=new Int16Array(states).fill(-1);
      for(let l=0;l<divisions;l++)for(let r=0;r<divisions;r++){
        const m=l*divisions+r;
        for(const edge of transitions[t][0][l]){
          const value=distance[edge.i*divisions+r]+edge.cost;
          if(value<middle[m]){middle[m]=value;leftParent[m]=edge.i;}
        }
      }
      for(let s=0;s<states;s++){
        if(!Number.isFinite(costs[t][s]))continue;
        const l=Math.floor(s/divisions),r=s%divisions;
        for(const edge of transitions[t][1][r]){
          const m=l*divisions+edge.i,prev=leftParent[m]*divisions+edge.i;
          const value=middle[m]+edge.cost+costs[t][s];
          if(value<next[s]||Number.isFinite(value)&&value===next[s]&&prev<parents[t][s]){
            next[s]=value;parents[t][s]=prev;
          }
        }
      }
      distance=next;
      if(!distance.some(Number.isFinite)){info.phase=phaseAt(t);return null;}
    }
    let end=-1, score=Infinity;
    const ends=seed===undefined ? Array.from({length:states},(_,i)=>({i,cost:0})) :
      transitions[0][0][Math.floor(seed/divisions)].flatMap(left=>
        transitions[0][1][seed%divisions].map(right=>({i:left.i*divisions+right.i,cost:left.cost+right.cost})));
    for(const move of ends) {
      const value=distance[move.i]+move.cost;
      if(value<score) { score=value;end=move.i; }
    }
    if(end<0) return null;
    const path=new Array<number>(count); path[count-1]=end;
    for(let t=count-1;t>0;t--) path[t-1]=parents[t][path[t]];
    return path;
  };
  const first=solve();
  if(!first) { info.reason='no-continuous-path';return null; }
  const refine=(path:number[])=>{
    const result=frames.map((f,t)=>f.plans.map((p,h)=>elbows[t][h][h===0?Math.floor(path[t]/divisions):path[t]%divisions].clone()));
    // The angular grid finds a collision-free branch. Refine on each exact IK
    // circle so following that branch does not make the elbow hop in 10-degree steps.
    for(let iteration=0;iteration<32;iteration++)for(let parity=0;parity<2;parity++)for(let t=parity;t<count;t+=2){
      const f=frames[t],previous=result[(t+count-1)%count],next=result[(t+1)%count];
      const desired=f.plans.map((p,h)=>{
        const direction=(phases?previous[h].clone().lerp(next[h],intervals[t]/(intervals[t]+intervals[(t+1)%count])):previous[h].clone().add(next[h]).multiplyScalar(.5)).sub(p.center);
        direction.addScaledVector(p.axis,-direction.dot(p.axis)).normalize();
        return p.center.clone().addScaledVector(direction,p.radius);
      });
      for(const blend of [.6,.3,.15]){
        const candidate=f.plans.map((p,h)=>{
          const direction=result[t][h].clone().lerp(desired[h],blend).sub(p.center);
          direction.addScaledVector(p.axis,-direction.dot(p.axis)).normalize();
          return p.center.clone().addScaledVector(direction,p.radius);
        });
        if(candidate.every((e,h)=>armClear(f.plans[h],e,f.balls) && moveClear(t,h,e,previous[h]) && moveClear((t+1)%count,h,next[h],e)) &&
          pairClear(f.plans,candidate[0],candidate[1],f.upperHand,f.underarm)){result[t]=candidate;break;}
      }
    }
    return [0,1].map(h=>result.map((hands,t)=>{
      const p=frames[t].plans[h],d=hands[h].clone().sub(p.center).normalize();
      return Math.atan2(p.axis.dot(new THREE.Vector3().crossVectors(p.pole,d)),p.pole.dot(d));
    }));
  };
  const seeds=[first[0],first[count-1],...Array.from({length:divisions},(_,l)=> {
    const row=Array.from({length:divisions},(_,r)=>l*divisions+r).filter(s=>Number.isFinite(costs[0][s]));
    return row.sort((a,b)=>costs[0][a]-costs[0][b])[0];
  }).filter(s=>s!==undefined),...Array.from({length:divisions},(_,r)=>{
    const column=Array.from({length:divisions},(_,l)=>l*divisions+r).filter(s=>Number.isFinite(costs[0][s]));
    return column.sort((a,b)=>costs[0][a]-costs[0][b])[0];
  }).filter(s=>s!==undefined)];
  let tried=0;
  for(const seed of [...new Set(seeds)]) {
    const path=solve(seed);
    if(path) return refine(path);
    if(++tried===2&&rotateStart){
      // Closing at an arbitrary frame can require many redundant starts. The
      // narrowest part of the same cycle is a stronger boundary condition.
      const counts=costs.map(row=>row.reduce((sum,c)=>sum+Number(Number.isFinite(c)),0));
      const pivot=counts.indexOf(Math.min(...counts));
      if(pivot>0){
        const origin=phaseAt(pivot),order=frames.map((_,i)=>(i+pivot)%count);
        const shifted=order.map(i=>(phaseAt(i)-origin+1)%1);
        const result=planArmCycle(order.map(i=>frames[i]),ballRadius,info,period,shifted,divisions,false);
        if(info.phase!==undefined)info.phase=(info.phase+origin)%1;
        return result?.map(angles=>frames.map((_,i)=>angles[(i-pivot+count)%count]))||null;
      }
    }
  }
  info.reason='no-closed-path';return null;
}

/** Resolve both elbow bend planes together. Hand targets and bone lengths stay fixed. */
export function avoidArmCollisions(plans: ElbowCircle[], balls: THREE.Vector3[], ballRadius: number, previous: THREE.Vector3[] = []) {
  const ballGap = ballRadius + 0.045;
  const armGap = 0.09;
  const penalty = (gap: number, distance: number) => Math.max(0, gap - distance) ** 2 * 10000;
  const candidate = (plan: ElbowCircle, hand: number, angle: number) => {
    const elbow = plan.center.clone().addScaledVector(plan.pole.clone().applyAxisAngle(plan.axis, angle), plan.radius);
    if(!armPosture(plan,elbow).ok)return {elbow,angle,cost:Infinity};
    const forearmEnd = plan.wrist.clone().lerp(elbow, 0.2);
    let cost = 0.0003 * angle * angle;
    if (previous[hand]) cost += 10 * elbow.distanceToSquared(previous[hand]);
    for (const ball of balls) cost += penalty(ballGap, Math.min(
      pointSegmentDistance(ball, plan.shoulder, elbow), pointSegmentDistance(ball, elbow, forearmEnd)));
    // Keep the elbow outside the torso; crossing in front of the chest remains possible.
    for (const point of [elbow, elbow.clone().lerp(plan.wrist, 0.5)]) {
      if (point.y < plan.shoulder.y + 0.04 && point.y > plan.shoulder.y - 0.5 && Math.abs(point.x) < 0.1 && point.z > -0.10)
        cost += penalty(0.10, -point.z);
    }
    return { elbow, angle, cost };
  };
  type Candidate = ReturnType<typeof candidate>;
  const pairCost = (a: Candidate, b: Candidate) => {
    let cost = a.cost + b.cost;
    const left = [[plans[0].shoulder, a.elbow], [a.elbow, plans[0].wrist]];
    const right = [[plans[1].shoulder, b.elbow], [b.elbow, plans[1].wrist]];
    for (const l of left) for (const r of right) cost += penalty(armGap, segmentDistance(l[0], l[1], r[0], r[1]));
    return cost;
  };
  const candidates = plans.map((p, h) => Array.from({ length: 25 }, (_, i) => candidate(p, h, (i - 12) * Math.PI / 12))
    .sort((a, b) => a.cost - b.cost).slice(0, 10));
  let best = [candidates[0][0], candidates[1][0]], bestCost = Infinity;
  for (const a of candidates[0]) for (const b of candidates[1]) {
    const cost = pairCost(a, b);
    if (cost < bestCost) { best = [a, b]; bestCost = cost; }
  }
  // Refine the angular grid so a slow playback does not show 15-degree elbow steps.
  for (const step of [Math.PI / 24, Math.PI / 48, Math.PI / 96, Math.PI / 192]) {
    for (let h = 0; h < 2; h++) for (const direction of [-1, 1]) {
      const trial = [...best];
      trial[h] = candidate(plans[h], h, best[h].angle + direction * step);
      const cost = pairCost(trial[0], trial[1]);
      if (cost < bestCost) { best = trial; bestCost = cost; }
    }
  }
  if(!Number.isFinite(bestCost))return false;
  plans.forEach((p, h) => p.elbow.copy(best[h].elbow));
  return true;
}
