import type {SyncBoxTracks,SyncMovementAdjustment} from './sync-box';

/** Local waypoint candidates for the two hands at the rejected instant.
 * The same search applies to every catch -> next release and release -> catch.
 * No technique names, row counts, or left/right style pairs are used here. */
export function movementCandidates(tracks:SyncBoxTracks,phase:number,plan:SyncMovementAdjustment[],distances=[.04,.08,.12]){
  const t=((phase%1)+1)%1*tracks.period;
  // A mixed sequence can enter In-line even when its top-level layout is
  // columns. Keep held paths fixed there too; empty hands may still detour.
  const hasInline=[tracks.config,...(tracks.config.sets||[])].some(s=>s.arrangement==='inline'||('inlineBlend' in s&&s.inlineBlend===1));
  const active=tracks.transitions.filter(s=>{
    const elapsed=((t-s.from)%tracks.period+tracks.period)%tracks.period,u=elapsed/s.duration;
    // An endpoint must be repaired in the throw constraints, never moved by
    // disguising it as a carry. In-line held balls stay on their vertical axis.
    return u>.08&&u<.92&&!(s.kind==='carry'&&hasInline);
  });
  const result:SyncMovementAdjustment[][]=[];
  for(const distance of distances)for(const axis of [2,1,0])for(const sign of [-1,1])for(const interval of active){
    const next=structuredClone(plan),previous=next.find(p=>p.hand===interval.hand&&Math.abs(p.from-interval.from)<1e-7);
    const offset=previous?.offset.slice() as [number,number,number]||[0,0,0] as [number,number,number];
    offset[axis]+=sign*distance*(axis===0?(interval.hand===0?-1:1):1);
    if(Math.hypot(...offset)>.21)continue;
    // Repeated boundary states share a proposal. This keeps a long repetition
    // from requiring one search per occurrence. The complete cycle is still
    // checked, including any different airborne neighbours at those intervals.
    const equivalent=tracks.transitions.filter(s=>s.hand===interval.hand&&s.kind===interval.kind&&
      Math.abs(s.duration-interval.duration)<1e-7&&s.start.distanceTo(interval.start)<1e-7&&
      s.end.distanceTo(interval.end)<1e-7&&s.via.distanceTo(interval.via)<1e-7);
    for(const s of equivalent){
      const entry=next.find(p=>p.hand===s.hand&&Math.abs(p.from-s.from)<1e-7);
      if(entry)entry.offset=offset.slice() as [number,number,number];
      else next.push({hand:s.hand,from:s.from,offset:offset.slice() as [number,number,number]});
    }
    result.push(next);
  }
  return result;
}

export interface MovementCheck {ok:boolean;phase?:number;score:number}

/** A bounded beam search. Exhaustion means no route found by this planner,
 * never a proof that the named juggling pattern is impossible. */
export function planSyncMovement(
  tracks:SyncBoxTracks,
  initial:MovementCheck,
  check:(plan:SyncMovementAdjustment[],phase?:number)=>MovementCheck,
  budget?:number,
){
  const states=new Set(tracks.transitions.map(s=>JSON.stringify([s.hand,s.kind,...s.start.toArray(),...s.end.toArray(),s.duration].map(v=>typeof v==='number'?Math.round(v*1e8)/1e8:v)))).size;
  budget??=Math.min(144,72+6*Math.max(0,states-8));
  let beam=[{plan:structuredClone(tracks.movement),result:initial}];
  const seen=new Set<string>();let attempts=0;
  for(let depth=0;depth<12&&attempts<budget;depth++){
    const candidates:typeof beam=[];
    for(const node of beam){
      if(node.result.phase===undefined)continue;
      for(const plan of movementCandidates(tracks,node.result.phase,node.plan)){
        const key=JSON.stringify(plan.map(p=>({...p,offset:p.offset.map(n=>Math.round(n*1e6))})).sort((a,b)=>a.hand-b.hand||a.from-b.from));
        if(seen.has(key))continue;seen.add(key);
        const result=check(plan,node.result.phase);attempts++;
        if(result.ok)return {plan,attempts};
        candidates.push({plan,result});
        if(attempts>=budget)break;
      }
      if(attempts>=budget)break;
    }
    candidates.sort((a,b)=>a.result.score-b.result.score);
    beam=candidates.slice(0,2);
    if(!beam.length)break;
  }
  return {attempts};
}
