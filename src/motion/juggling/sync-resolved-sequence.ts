import type {SyncSequence} from './sync-sequence';
import {expandSequence} from './sync-sequence';
import type {SyncBoxTracks} from './sync-box';
import type {SpaceTransform} from './tracks';
import type {CarryDefinition} from './sync-motion';

/** A bridge starts from the solved physical states, including catch timing
 * and held/empty waypoints. Reusing the original guesses would silently undo
 * the solver and prevent the registered boundary states from matching. */
export function resolvedSequence(sequence:SyncSequence,tracks:SyncBoxTracks,transform:SpaceTransform,mirror=false,retainBallOrder=false):SyncSequence{
 const rows=expandSequence(sequence),beat=sequence.beatDuration,scale=transform.horizontalScale;
 const mod=(n:number,d:number)=>((n%d)+d)%d,side=(h:number)=>h===0?-1:1;
 const physical=(h:number)=>mirror?1-h:h;
 const sets=Array.from({length:Math.round(tracks.period/(2*beat))},(_,i)=>{
  const row=structuredClone(rows[i%rows.length]),order=row.motion.armOrder||'none';
  const armPhase=order==='alternate'?row.motion.armPhase??i%2:undefined;
  const flights=[0,1].map(h=>tracks.flights.find(f=>f.throwHand===physical(h)&&Math.floor((f.release+1e-8)/(2*beat))===i));
  if(flights.some(f=>!f))throw new Error('この移行は左右の投球イベントを必要とします。');
  const under=flights.some(f=>f!.motion.release.relation==='underarm'||f!.motion.catch.relation==='underarm');
  const base=1.15+transform.offsetY+(under?.085:order!=='none'?.08:0)*scale;
  const upper=(set:number)=>order==='right-over'?1:order==='alternate'?mod(set,2):0;
  const hands=flights.map((flight,h)=>{
   const f=flight!,d=structuredClone(f.motion);
   for(const key of ['release','catch'] as const){
    const p=key==='release'?f.start:f.end,hand=key==='release'?h:physical(f.catchHand),set=(armPhase??i)+(key==='release'?0:f.value/2);
    const sign=order==='none'?0:hand===upper(set)?1:-1;
    d[key]={x:(mirror?-p.x:p.x)/side(h)/scale,y:(p.y-base)/scale-sign*.07,z:p.z/scale+sign*.02,relation:d[key].relation};
   }
   d.passage={at:d.passage.at};delete d.catchAtApex;
   d.flightFraction=f.duration/(f.value*beat);
   const carry=(c:CarryDefinition|undefined,time:number,hand:number)=>{
    const event=tracks.transitions.find(t=>t.hand===hand&&Math.min(mod(t.from-time,tracks.period),mod(time-t.from,tracks.period))<1e-7);
    const result:CarryDefinition=structuredClone(event?.route||c||{route:'direct',amount:0});
    const m=tracks.movement.find(m=>m.hand===hand&&Math.min(mod(m.from-time,tracks.period),mod(time-m.from,tracks.period))<1e-7);
    if(m){
     const offset:[number,number,number]=[m.offset[0]/side(hand)/scale,m.offset[1]/scale,m.offset[2]/scale];
     result.offset=offset.map((v,i)=>v+(result.offset?.[i]||0)) as [number,number,number];
     if(m.via?.length){
      result.detours=[...(result.detours||[]),m.via.map(v=>({at:v.at,
       offset:[v.offset[0]/side(hand)/scale,v.offset[1]/scale,v.offset[2]/scale]}))];
     }
    }
    return result;
   };
   d.carry=carry(d.carry,f.release+f.duration,f.catchHand);d.emptyReturn=carry(d.emptyReturn,f.release,f.throwHand);
   d.emptyReturnExact=true;
   return {definition:d,...(f.value===2?{style:f.style as NonNullable<typeof row.motion.short>[number]}:{}),
     ...(retainBallOrder&&f.ballOrder?{shortMotion:{ballOrder:'style' as const}}:{}),releaseGrip:f.releaseGrip,catchGrip:f.catchGrip};
  }) as typeof row.motion.hands;
  return {...row,repeat:1,motion:{columns:order==='none'?'normal' as const:'crossed' as const,short:row.motion.short,armOrder:order,
    ...(armPhase===undefined?{}:{armPhase:armPhase as 0|1}),hands}};
 });
 return {...structuredClone(sequence),mirrorRepeat:false,sets};
}
