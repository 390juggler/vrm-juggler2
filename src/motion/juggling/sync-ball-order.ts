import {GRAVITY} from './tracks';
import type {SyncFlight} from './sync-box';

export interface BallOrderConstraint {
  at:number;
  otherProp:number;
  above:boolean;
  height:number;
}

/** Intersections of horizontal lanes in space AND time. Depth separation does
 * not turn a pass above another ball into a pass below it. Vertical passes and
 * explicitly authored motions opt out; their passage has a different meaning. */
export function ballOrderConstraints(short:SyncFlight,flights:SyncFlight[],period:number):BallOrderConstraint[]{
  const constraints:BallOrderConstraint[]=[];
  for(const column of flights){
    if(column.value<=2||column.prop===short.prop)continue;
    for(const wrap of [-period,0,period]){
      const begin=column.release+wrap-short.release;
      const lo=Math.max(0,begin),hi=Math.min(short.duration,begin+column.duration);
      if(hi<lo-1e-8)continue;
      const speed=short.velocity.x-column.velocity.x;
      if(Math.abs(speed)<1e-8)continue;
      const t=(column.start.x-column.velocity.x*begin-short.start.x)/speed;
      if(t<lo-1e-8||t>hi+1e-8)continue;
      const local=t-begin,u=Math.max(0,Math.min(1,t/short.duration));
      const above=u<.5?['shuffle','inverted'].includes(short.style):['reverse','inverted'].includes(short.style);
      constraints.push({at:u,otherProp:column.prop,above,
        height:column.start.y+column.velocity.y*local-GRAVITY*local*local/2});
    }
  }
  constraints.sort((a,b)=>a.at-b.at);
  const order=[...new Set(constraints.map(c=>c.otherProp))];
  // A vertical/inside pass may never traverse both column lanes. Do not
  // mislabel its one encounter as the near or far member of a two-ball pass.
  if(order.length!==2)return [];
  if(order.length===2)for(const c of constraints)c.above=order.indexOf(c.otherProp)===0?
    ['shuffle','inverted'].includes(short.style):['reverse','inverted'].includes(short.style);
  return constraints;
}

/** Closest pair of endpoint heights satisfying all lane-order inequalities.
 * Ballistic gravity and flight time stay fixed. The carry is solved afterwards
 * from the corrected catch to the NEXT throw, so those positions need not match. */
export function resolveBallOrder(f:SyncFlight,constraints:BallOrderConstraint[],gap:number):[number,number]{
  const origin:[number,number]=[f.start.y,f.end.y];
  const planes=constraints.map(c=>{
    const sign=c.above?1:-1,u=c.at;
    return {a:sign*(1-u),b:sign*u,c:gap+sign*(c.height-GRAVITY*f.duration*f.duration*u*(1-u)/2)};
  });
  const candidates:[number,number][]=[origin];
  for(const p of planes){
    const d=(p.c-p.a*origin[0]-p.b*origin[1])/(p.a*p.a+p.b*p.b);
    candidates.push([origin[0]+d*p.a,origin[1]+d*p.b]);
  }
  for(let i=0;i<planes.length;i++)for(let j=i+1;j<planes.length;j++){
    const p=planes[i],q=planes[j],det=p.a*q.b-q.a*p.b;
    if(Math.abs(det)>1e-9)candidates.push([(p.c*q.b-q.c*p.b)/det,(p.a*q.c-q.a*p.c)/det]);
  }
  const feasible=candidates.filter(v=>planes.every(p=>p.a*v[0]+p.b*v[1]>=p.c-1e-9));
  feasible.sort((a,b)=>(a[0]-origin[0])**2+(a[1]-origin[1])**2-(b[0]-origin[0])**2-(b[1]-origin[1])**2);
  if(!feasible.length)throw new Error('この飛行時間では指定した球の上下関係を作れません。');
  return feasible[0];
}
