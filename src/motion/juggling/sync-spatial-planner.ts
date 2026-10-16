import {inspectSyncBox,syncBeat,SYNC_RADIUS,type SyncBoxTracks,type SyncFlightAdjustment,type SyncMovementAdjustment} from './sync-box';
import type {SpaceTransform} from './tracks';
import {movementCandidates,type MovementCheck} from './sync-movement-planner';

interface Plan {flights:SyncFlightAdjustment[];hands:SyncMovementAdjustment[]}

/** Integrated constraint error makes progress when several repeated intervals
 * have the same worst collision. A single minimum distance cannot do that. */
function error(tracks:SyncBoxTracks,transform:SpaceTransform){
  let total=0;
  for(let k=0;k<tracks.numSteps;k++){
    if(!tracks.config.allowBallContact)for(let a=0;a<tracks.props.length;a++)for(let b=a+1;b<tracks.props.length;b++)
      total+=Math.max(0,2*SYNC_RADIUS+.002-tracks.props[a][k].distanceTo(tracks.props[b][k]))**2;
    total+=Math.max(0,.092-tracks.hands[0].positions[k].distanceTo(tracks.hands[1].positions[k]))**2;
    for(let h=0;h<2;h++){
      const hand=tracks.hands[h],wrist=hand.positions[k].clone().addScaledVector(hand.palmNormals[k],-(SYNC_RADIUS+transform.gripOffset.normal))
        .addScaledVector(hand.fingerDirs![k],-transform.gripOffset.finger);
      total+=Math.max(0,wrist.distanceTo(transform.shoulders[h])-transform.wristReach-.008)**2;
    }
  }
  return total/tracks.numSteps;
}

/** Adjust a candidate bridge or an explicitly relative basic layout.
 * Registered A/B cycles stay in the immutable replay graph; publication of a
 * bridge additionally requires matching their complete boundary states.
 * Ordinary columns translate as a unit; generated bridge throws can move
 * release and catch separately. Carries join the resulting actual events. */
export function planSyncGeometry(
  initial:SyncBoxTracks,transform:SpaceTransform,rebuild:(plan:Plan)=>SyncBoxTracks,budget=180,
  assess?:(phase?:number)=>MovementCheck,
  merit?:()=>{score:number;phase:number},
  progress?:(state:{attempts:number;score:number;phase?:number})=>void,
){
  const mutable=(t:SyncBoxTracks,f:SyncBoxTracks['flights'][number])=>{
    const sets=t.config.sets;if(!sets)return false;
    const row=sets[Math.floor(f.release/(2*syncBeat(t.config)))%sets.length];
    const relative=assess&&(row?.shortMotions?.some(o=>o.ballOrder==='style')||row?.hands?.some(h=>h?.shortMotion?.ballOrder==='style'));
    return (row?.transition||relative)&&row.arrangement!=='inline'&&!row.inlineBlend;
  };
  const empty:Plan={flights:structuredClone(initial.flightAdjustments),hands:structuredClone(initial.movement)};
  let evaluations=0,lastValidation=-100,lastPhase:number|undefined;
  const evaluate=(tracks:SyncBoxTracks,phase?:number)=>{
    evaluations++;
    const g=inspectSyncBox(tracks,transform);
    const guide=merit?.(),integrated=guide?guide.score+100*error(tracks,transform):undefined;
    if(!g.geometryOK)return {ok:false,score:integrated??10+100*Math.sqrt(error(tracks,transform)),phase:!g.ballOrderOK?g.ballOrderPhase:!g.ballContactAllowed&&g.ballClearance<=0?g.ballPhase:g.minHandDistance<=.09?g.handPhase:g.reachPhase};
    // Full cyclic IK is a certificate, not a score for every centimetre-sized
    // proposal. Recheck promising candidates periodically and always at exit.
    if(merit&&evaluations>1&&(integrated! > .005||evaluations-lastValidation<24))
      return {ok:false,score:integrated!,phase:guide!.score>0?guide!.phase:phase??lastPhase};
    lastValidation=evaluations;
    const checked=assess?.(phase)||{ok:true,score:0};
    if(checked.phase!==undefined)lastPhase=checked.phase;
    return {...checked,score:checked.ok?0:integrated??checked.score};
  };
  const samePassages=(tracks:SyncBoxTracks)=>initial.flights.every((f,i)=>!f.ballOrder?.length||
    JSON.stringify(f.ballOrder.map(c=>[c.otherProp,c.above]))===JSON.stringify(tracks.flights[i].ballOrder?.map(c=>[c.otherProp,c.above])));
  let beam=[{plan:empty,tracks:initial,result:evaluate(initial)}],attempts=0;
  let best=beam[0];
  const seen=new Set<string>();
  for(let depth=0;depth<(merit?80:24)&&attempts<budget;depth++){
    const next:typeof beam=[];
    for(const node of beam){
      const tracks=node.tracks;
      if(node.result.ok)return {plan:node.plan,tracks,attempts};
      const phase=node.result.phase;if(phase===undefined)continue;
      const time=phase*tracks.period,mod=(t:number)=>((t%tracks.period)+tracks.period)%tracks.period;
      const endpoints=tracks.transitions.filter(t=>mod(time-t.from)<t.duration)
        .flatMap(t=>[mod(t.from),mod(t.from+t.duration)]);
      const isEndpoint=(time:number)=>endpoints.some(t=>Math.min(mod(time-t),mod(t-time))<1e-7);
      const near=tracks.flights.filter(f=>mutable(tracks,f)&&
        (mod(time-f.release)<f.duration+.05||isEndpoint(f.release)||isEndpoint(f.release+f.duration)));
      const candidates:Plan[]=movementCandidates(tracks,phase,node.plan.hands,merit?[.01,.02,.04,.08]:undefined)
        .map(hands=>({flights:node.plan.flights,hands}));
      if(merit)for(const f of near){
        const row=tracks.config.sets?.[Math.floor(f.release/(2*syncBeat(tracks.config)))%tracks.config.sets.length];
        if(!row?.transition||f.style==='vertical-down'||f.motion.catchAtApex||f.motion.passage.point)continue;
        for(const step of [.025,.05,.1])for(const sign of [-1,1]){
          const flights=structuredClone(node.plan.flights),old=flights.find(a=>a.hand===f.throwHand&&Math.abs(a.release-f.release)<1e-7);
          const durationScale=(old?.durationScale||1)+step*sign;if(durationScale<.7||durationScale>1.3)continue;
          if(old)old.durationScale=durationScale;
          else flights.push({hand:f.throwHand,release:f.release,offset:[0,0,0],durationScale});
          candidates.push({flights,hands:node.plan.hands});
        }
      }
      // A hand's column, 2x release and 2x catch share a working region. Move
      // those EVENT positions together instead of rigidly translating a 2x
      // from one hand to the other. This also moves its preferred catch height
      // when the other ball is lowered; the relative inequality is re-solved.
      if(assess)for(const hand of [0,1]){
        for(const distance of merit?[.01,.02,.04]:[.04,.08])for(const axis of [1,2])for(const sign of [-1,1]){
          const flights=structuredClone(node.plan.flights);let valid=true;
          tracks.flights.filter(f=>mutable(tracks,f)).forEach(f=>{
            const old=flights.find(a=>a.hand===f.throwHand&&Math.abs(a.release-f.release)<1e-7);
            const offset=old?.offset.slice() as [number,number,number]||[0,0,0];
            const endOffset=(old?.endOffset||old?.offset||[0,0,0]).slice() as [number,number,number];
            if(f.throwHand===hand)offset[axis]+=distance*sign;
            if(f.catchHand===hand)endOffset[axis]+=distance*sign;
            if(Math.max(Math.hypot(...offset),Math.hypot(...endOffset))>.3)valid=false;
            if(old){old.offset=offset;old.endOffset=endOffset;}else flights.push({hand:f.throwHand,release:f.release,offset,endOffset});
          });
          if(valid)candidates.push({flights,hands:node.plan.hands});
        }
      }
      for(const distance of merit?[.002,.01,.04]:[.04,.08])for(const axis of [2,1,0])for(const sign of [-1,1])for(const f of near){
       const row=tracks.config.sets?.[Math.floor(f.release/(2*syncBeat(tracks.config)))%tracks.config.sets.length];
       for(const endpoint of merit&&row?.transition?['both','release','catch']:['both']){
        const flights=structuredClone(node.plan.flights),old=flights.find(a=>a.hand===f.throwHand&&Math.abs(a.release-f.release)<1e-7);
        const offset=old?.offset.slice() as [number,number,number]||[0,0,0];
        const endOffset=(old?.endOffset||old?.offset||[0,0,0]).slice() as [number,number,number];
        if(endpoint!=='catch')offset[axis]+=distance*sign;
        if(endpoint!=='release')endOffset[axis]+=distance*sign;
        if(Math.max(Math.hypot(...offset),Math.hypot(...endOffset))>.2)continue;
        if(old){old.offset=offset;old.endOffset=endOffset;}
        else flights.push({hand:f.throwHand,release:f.release,offset,...(endpoint==='both'?{}:{endOffset})});
        candidates.push({flights,hands:node.plan.hands});
       }
      }
      for(const plan of candidates){
        const key=JSON.stringify(plan);if(seen.has(key))continue;seen.add(key);
        try{
          const candidate=rebuild(plan);attempts++;
          if(!samePassages(candidate))continue;
          const result=evaluate(candidate,phase);
          if(result.ok)return {plan,tracks:candidate,attempts};
          next.push({plan,tracks:candidate,result});
          if(result.score<best.result.score)best={plan,tracks:candidate,result};
          next.sort((a,b)=>a.result.score-b.result.score);if(next.length>(merit?1:2))next.length=merit?1:2;
        }catch{attempts++;}
        if(attempts>=budget)break;
      }
      if(attempts>=budget)break;
    }
    next.sort((a,b)=>a.result.score-b.result.score);beam=next.slice(0,merit?1:2);if(!beam.length)break;
    progress?.({attempts,score:beam[0].result.score,phase:beam[0].result.phase});
  }
  if(merit){
    const tracks=rebuild(best.plan);
    if(inspectSyncBox(tracks,transform).geometryOK&&assess?.().ok)return {plan:best.plan,tracks,attempts};
  }
  return {attempts,best};
}
