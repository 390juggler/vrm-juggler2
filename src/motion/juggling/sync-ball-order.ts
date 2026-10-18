import {GRAVITY} from './tracks';
import type {SyncFlight} from './sync-box';

export interface BallOrderConstraint {
  at:number;
  otherProp:number;
  above:boolean;
  height:number;
  /** An envelope of a high arc, rather than a ball's instantaneous height. */
  reference?:'trajectory';
}

/** A relative 2x uses the high arc's horizontal span. Extrapolating a short
 * pass far beyond a narrow arc multiplies the required endpoint heights.
 * Keep interior/central catches and the direction; only retract overhangs. */
export function arcPassLanes(short:SyncFlight,flights:SyncFlight[],period:number):[number,number]{
  const sLo=Math.min(short.start.x,short.end.x),sHi=Math.max(short.start.x,short.end.x);
  const arcs=flights.filter(f=>f.value>2&&f.prop!==short.prop&&Math.abs(f.end.x-f.start.x)>1e-7&&
    Math.min(sHi,Math.max(f.start.x,f.end.x))-Math.max(sLo,Math.min(f.start.x,f.end.x))>1e-7&&
    [-period,0,period].some(w=>f.release+w<=short.release+short.duration&&f.release+w+f.duration>=short.release));
  if(!arcs.length)return [short.start.x,short.end.x];
  const lo=Math.min(...arcs.flatMap(f=>[f.start.x,f.end.x])),hi=Math.max(...arcs.flatMap(f=>[f.start.x,f.end.x]));
  return [short.start.x,short.end.x].map(x=>Math.max(lo,Math.min(hi,x))) as [number,number];
}

/** Compare a pass with the high arc in the direction the 2x travels. Shuffle
 * crosses from above to below; Reverse crosses from below to above. For equal
 * signs, a tangent bounds the whole quadratic, not just its two endpoints. */
function arcOrderConstraints(short:SyncFlight,arc:SyncFlight):BallOrderConstraint[]{
  const dx=short.end.x-short.start.x,ax=arc.end.x-arc.start.x;
  if(Math.abs(dx)<1e-8||Math.abs(ax)<1e-8)return [];
  const ends=[(arc.start.x-short.start.x)/dx,(arc.end.x-short.start.x)/dx].sort((a,b)=>a-b);
  const lo=Math.max(0,ends[0]),hi=Math.min(1,ends[1]);
  if(hi-lo<1e-7)return [];
  const ratio=dx/ax,offset=(short.start.x-arc.start.x)/ax;
  const lift=(u:number)=>GRAVITY*short.duration**2*u*(1-u)/2;
  const reference=(u:number)=>{
    const v=offset+ratio*u;
    return arc.start.y+(arc.end.y-arc.start.y)*v+GRAVITY*arc.duration**2*v*(1-v)/2-lift(u);
  };
  const above=[['shuffle','inverted'].includes(short.style),['reverse','inverted'].includes(short.style)];
  const curvature=GRAVITY*(short.duration**2-arc.duration**2*ratio**2)/2;
  const mid=(lo+hi)/2,value=reference(mid),slope=(reference(hi)-reference(lo))/(hi-lo);
  const envelope=above[0]===above[1]&&(above[0]?curvature<0:curvature>0);
  return [lo,hi].map((u,i)=>({at:u,otherProp:arc.prop,above:above[i],reference:'trajectory',
    height:(envelope?value+slope*(u-mid):reference(u))+lift(u)}));
}

/** Vertical columns are encountered in space and time; a high crossing arc is
 * a spatial trajectory. Depth separation cannot reverse either relationship.
 * Vertical 2x and explicitly authored passages opt out at the caller. */
export function ballOrderConstraints(short:SyncFlight,flights:SyncFlight[],period:number):BallOrderConstraint[]{
  const constraints:BallOrderConstraint[]=[],arcs:BallOrderConstraint[]=[];
  for(const column of flights){
    if(column.value<=2||column.prop===short.prop)continue;
    let arcChecked=false;
    for(const wrap of [-period,0,period]){
      const begin=column.release+wrap-short.release;
      const lo=Math.max(0,begin),hi=Math.min(short.duration,begin+column.duration);
      if(hi<lo-1e-8)continue;
      if(Math.abs(column.end.x-column.start.x)>1e-7){
        if(!arcChecked)arcs.push(...arcOrderConstraints(short,column));
        arcChecked=true;continue;
      }
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
  if(arcs.length)return [...arcs,...constraints].sort((a,b)=>a.at-b.at);
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
