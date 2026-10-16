import type {SyncBoxTracks,SyncMovementAdjustment} from './sync-box';

export type HandDetour = 'direct'|'circle'|'retract';

/** A fixed vocabulary of transfers, applied to states rather than technique names.
 * World-space offsets vanish with zero speed at release/catch. The upper hand
 * retreats before going down; its partner takes the opposite arc. */
export function constructiveMovements(tracks:SyncBoxTracks){
  const result:{kind:HandDetour;movement:SyncMovementAdjustment[]}[]=[{kind:'direct',movement:structuredClone(tracks.movement)}];
  const inline=[tracks.config,...(tracks.config.sets||[])].some(s=>s.arrangement==='inline'||'inlineBlend' in s&&s.inlineBlend===1);
  for(const kind of ['circle','retract'] as const)for(const direction of [1,-1]){
    const movement=tracks.transitions.filter(s=>!(inline&&s.kind==='carry')).map(s=>{
      const step=Math.round(s.from/tracks.period*tracks.numSteps)%tracks.numSteps;
      const other=tracks.hands[1-s.hand].positions[step];
      const upper=tracks.armOrders[step]??(s.start.y>=other.y?s.hand:1-s.hand);
      const sign=s.hand===upper?1:-1;
      // Short intervals use smaller arcs instead of speeding up a fixed detour.
      const radius=Math.min(.055,s.duration*.22);
      const via=[.25,.5,.75].map(at=>{
        const x=direction*sign*radius*Math.sin(2*Math.PI*at);
        const y=-sign*radius*(1-Math.cos(2*Math.PI*at));
        // +z is toward the performer: withdraw first, then insert underneath.
        const z=kind==='retract'?direction*sign*radius*(at===.25?1:at===.5?.3:-.5):0;
        return {at,offset:[kind==='circle'?x:0,y,z] as [number,number,number]};
      });
      return {hand:s.hand,from:s.from,offset:[0,0,0] as [number,number,number],via};
    });
    result.push({kind,movement});
  }
  return result;
}
