import {inspectSyncBox,syncBeat,type SyncBoxTracks,type SyncFlightAdjustment,type SyncMovementAdjustment} from './sync-box';
import type {SpaceTransform} from './tracks';
import type {MovementCheck} from './sync-movement-planner';
import {syncSearchSeeds} from './sync-search-seeds';

export interface SyncConstraintPlan {flights:SyncFlightAdjustment[];hands:SyncMovementAdjustment[];timing:[number,number]}
// Memoize solved geometry, never an unchecked validity certificate. The rig's
// current arm cycle is checked again on every reuse and model change.
const solvedPlans=new Map<string,SyncConstraintPlan>();
const proposals=new Map<number,number[][]>();
for(const seed of syncSearchSeeds)proposals.set(seed.length,[...(proposals.get(seed.length)||[]),seed]);

/** Joint search over free throw/catch events and the movements between them.
 * No technique-pair tables: repeated event definitions share variables. The
 * penalty guides proposals only; acceptance always runs the full arm cycle.
 * Runtime solutions seed later searches; saved sources retain resolved events.
 * Every proposal is rebuilt and checked against the requested constraints. */
export function planSyncConstraints(initial:SyncBoxTracks,transform:SpaceTransform,
  rebuild:(plan:SyncConstraintPlan)=>SyncBoxTracks,cyclePenalty:(phases:number[],period:number)=>number,
  validate:()=>MovementCheck,budget=24000,progress?:(state:{attempts:number;budget:number;bestCost?:number;seed?:number[]})=>void){
  const free=initial.flights.map(f=>{
    const rows=initial.config.sets,row=rows?.[Math.floor(f.release/(2*syncBeat(initial.config)))%rows.length]||initial.config;
    return row.arrangement!=='inline'&&!('inlineBlend' in row&&row.inlineBlend)&&
      ('transition' in row&&row.transition||row.shortMotions?.some(o=>o.ballOrder==='style')||
        row.short?.some(style=>style.startsWith('vertical-'))&&!row.shortMotions?.some(o=>o.definition)||
        'hands' in row&&row.hands?.some(h=>h?.shortMotion?.ballOrder==='style'));
  });
  if(!free.some(Boolean))return {attempts:0};
  const cacheKey=JSON.stringify([initial.config,transform,initial.flights.map(f=>[f.release,f.duration,f.preferredStart||f.start,f.preferredEnd||f.end])]);
  const cached=solvedPlans.get(cacheKey);
  if(cached){
    const tracks=rebuild(structuredClone(cached));
    if(inspectSyncBox(tracks,transform).geometryOK&&validate().ok)return {plan:structuredClone(cached),attempts:0};
    solvedPlans.delete(cacheKey);
  }
  const groups:{key:string;hand:number;launchHand:number;column:boolean;kind:string;y:number;z:number}[]=[],indices:number[][]=[];
  initial.flights.forEach((f,i)=>{
    if(!free[i]){indices.push([-1,-1]);return;}
    const start=f.preferredStart||f.start,end=f.preferredEnd||f.end;
    const event=(point:typeof start,hand:number,kind:string)=>{
      const key=JSON.stringify([hand,f.value,f.style,kind,...point.toArray().map(n=>Math.round(n*1e7))]);
      let index=groups.findIndex(g=>g.key===key);
      if(index<0){index=groups.length;groups.push({key,hand,launchHand:f.throwHand,column:f.style==='column',kind,y:point.y,z:point.z});}return index;
    };
    const a=event(start,f.throwHand,'release');indices.push([a,f.style==='column'?a:event(end,f.catchHand,'catch')]);
  });
  const n=groups.length,limits=[...groups.map(g=>[transform.shoulders[g.hand].y-.42,transform.shoulders[g.hand].y+.05]),
    ...groups.map(()=>[-.50,-.18]),[.65,1.22],[.65,1.05],[.45,1.35],...Array.from({length:12},(_,i)=>i%3?[-.16,.16]:[-.12,.12])];
  const encounters=initial.flights.map(f=>new Set(f.ballOrder?.map(c=>c.otherProp)).size);
  const preservesVertical=(tracks:SyncBoxTracks)=>tracks.flights.every(f=>
    !f.style.startsWith('vertical-')||(Math.abs(f.start.x-f.end.x)<1e-7&&Math.abs(f.start.z-f.end.z)<1e-7&&
      (f.style==='vertical-up'?f.end.y-f.start.y:f.start.y-f.end.y)>.035));
  const sq=(x:number)=>Math.max(0,x)**2;
  let seed=54321,attempts=0,epoch=0,lastValidation=-100;
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const phases=[...new Set([...Array.from({length:32},(_,i)=>i/32),...(initial.armOrderEvents||[]).map(e=>e.time/initial.period)])];
  let best:{values:number[];cost:number}|undefined,solved:SyncConstraintPlan|undefined;
  const plan=(values:number[])=>{
    const timing=[values[2*n],values[2*n+1]] as [number,number];
    const flights:SyncFlightAdjustment[]=initial.flights.flatMap((f,i)=>{
      if(!free[i])return [];
      const [a,b]=indices[i],start=f.preferredStart||f.start,end=f.preferredEnd||f.end;
      const vertical=f.style==='column'||f.style.startsWith('vertical-');
      return [{hand:f.throwHand,release:f.release,offset:[start.x*(values[2*n+2]-1),values[a]-start.y,values[n+a]-start.z],
        endOffset:[vertical?start.x*values[2*n+2]-end.x:end.x*(values[2*n+2]-1),values[b]-end.y,values[n+(vertical?a:b)]-end.z]}];
    });
    const tracks=rebuild({flights,hands:[],timing});
    const hands=tracks.transitions.filter(s=>{
      // Source A/B movements in a bridge remain immutable as well.
      const row=initial.config.sets?.[Math.floor(s.from/(2*syncBeat(initial.config)))%initial.config.sets.length];
      return !initial.config.sets?.some(r=>r.transition)||row?.transition;
    }).map(s=>{const i=2*n+3+3*(s.hand*2+(s.kind==='carry'?1:0));
      return {hand:s.hand,from:s.from,offset:[values[i],values[i+1],values[i+2]] as [number,number,number]};});
    return {flights,hands,timing};
  };
  const evaluate=(values:number[]):number=>{
    if(solved)return 0;
    attempts++;
    if(attempts%200===0)progress?.({attempts,budget,bestCost:best?.cost,seed:best?.values.map((v,j)=>(v-limits[j][0])/(limits[j][1]-limits[j][0]))});
    try{
      const candidate=plan(values),tracks=rebuild(candidate);
      if(!preservesVertical(tracks))return 1;
      // Near/far means encounter order, not a fixed colour/prop identity.
      // Retiming may change which flight supplies a column, but must not make
      // either of the two required encounters disappear.
      if(initial.flights.some((_,i)=>encounters[i]&&new Set(tracks.flights[i].ballOrder?.map(c=>c.otherProp)).size!==encounters[i]))return 1;
      const geometry=inspectSyncBox(tracks,transform);
      if(geometry.ownershipConflicts)return 1+geometry.ownershipConflicts;
      const events=tracks.transitions.flatMap(t=>[t.from,t.from+t.duration*.5,t.from+t.duration].map(time=>(time%tracks.period)/tracks.period));
      const keys=[...phases,...events,geometry.reachPhase,geometry.handPhase].sort((a,b)=>a-b).filter((p,i,all)=>!i||p-all[i-1]>1e-6);
      const cost=cyclePenalty(keys,tracks.period)+
        sq(geometry.maxReachRatio-1)*100+sq(.092-geometry.minHandDistance)*16+sq((geometry.maxHandSpeed-4)*.025)*2+
        (geometry.ballContactAllowed?0:sq(-geometry.ballClearance)*4);
      if(!best||cost<=best.cost){
        best={values:values.slice(),cost};
        // Eight-angle guidance can overestimate a feasible arm posture. Give
        // promising paths to the dense certificate instead of requiring the
        // coarse lattice itself to approach zero first.
        if(cost<.003&&attempts-lastValidation>=120){
          lastValidation=attempts;
          const checked=validate();
          if(checked.ok&&geometry.geometryOK)solved=candidate;
          else if(checked.phase!==undefined&&!phases.some(p=>Math.abs(p-checked.phase!)<.0001)){
            phases.push(checked.phase);epoch++;best=undefined;return evaluate(values);
          }
        }
      }
      return cost;
    }catch{return 10;}
  };
  const population=Array.from({length:64},()=>limits.map(([low,high])=>low+random()*(high-low)));
  // Seed broad working regions around the actual shoulders, including both
  // depth orders. This is independent of technique names and previous edits.
  const upper=initial.armOrders.find(h=>h!==null)??0;
  let region=0;
  for(const split of [-.12,0,.12])for(const depth of [-.10,0,.10])for(const columnTime of [.72,.95]){
    const values=[...groups.map(g=>transform.shoulders[g.hand].y-.22+(g.hand===upper?split:-split)),
      ...groups.map(g=>-.33+(g.hand===upper?depth:-depth)),1,columnTime,.9,...new Array(12).fill(0)];
    population[region++]=values.map((v,j)=>Math.max(limits[j][0],Math.min(limits[j][1],v)));
  }
  // Two passes use opposite depth corridors; the held/empty returns connect
  // them. Seed both corridor orders, regardless of the requested ball order.
  for(const split of [-.14,.14])for(const depthOrder of [-1,1])for(const depth of [-.30,-.34]){
    const values=[...groups.map(g=>transform.shoulders[g.hand].y-.16+(g.hand===upper?split:-split)),
      ...groups.map(g=>depth+(g.column?.06:(g.launchHand===upper?.04:-.07)*depthOrder)+(g.kind==='catch'?-.025:0)),
      1.2,.85,.9,...Array.from({length:12},(_,i)=>i%3===2?.05:0)];
    population[region++]=values.map((v,j)=>Math.max(limits[j][0],Math.min(limits[j][1],v)));
  }
  const seeds=proposals.get(limits.length)||[];
  const reflected=groups.map(g=>groups.findIndex(other=>other.hand===1-g.hand&&other.launchHand===1-g.launchHand&&other.kind===g.kind&&other.column===g.column));
  const reversed=groups.map(g=>groups.findIndex(other=>other.hand===g.hand&&other.column===g.column&&
    (g.column?other.kind===g.kind:other.kind!==g.kind&&other.launchHand!==g.launchHand)));
  const transformSeed=(seed:number[],map:number[],mirror=false)=>[
    ...map.map(j=>seed[j]),...map.map(j=>seed[n+j]),...seed.slice(2*n,2*n+3),
    ...(mirror?[...seed.slice(2*n+9,2*n+15),...seed.slice(2*n+3,2*n+9)].map((v,i)=>i%3?v:1-v):seed.slice(2*n+3))];
  // Spatial reflection and exchanging a hand's release/catch preferences are
  // generic proposals. They are not assumed to be feasible time reversals:
  // gravity, synchronous timing, palm orientation and the whole arm path are
  // checked again for the requested schedule.
  const guesses=seeds.slice(-16).flatMap(seed=>{
    const values=[seed];
    if(reversed.every(i=>i>=0))values.push(transformSeed(seed,reversed));
    // Event slots follow logical throws, while carry controls follow physical
    // hands. A mirrored input reverses the latter without reordering slots.
    const identity=groups.map((_,i)=>i);
    return [...values,...values.map(v=>transformSeed(v,identity,true)),
      ...(reflected.every(i=>i>=0)?values.flatMap(v=>[transformSeed(v,reflected,true),transformSeed(v,reflected)]):[])];
  });
  guesses.forEach((seed,i)=>population[region+i]=seed.map((v,j)=>limits[j][0]+v*(limits[j][1]-limits[j][0])));
  // The coarse search score is only a heuristic. A previously generated seed
  // may already pass the exact checks, even when the coarse lattice scores it
  // poorly. Check it directly before doing another numerical search.
  for(let i=region;i<region+guesses.length;i++){
    try{
      const candidate=plan(population[i]),tracks=rebuild(candidate);attempts++;
      if(!preservesVertical(tracks))continue;
      if(initial.flights.some((_,k)=>encounters[k]&&new Set(tracks.flights[k].ballOrder?.map(c=>c.otherProp)).size!==encounters[k]))continue;
      if(inspectSyncBox(tracks,transform).geometryOK&&validate().ok){
        if(solvedPlans.size>=32)solvedPlans.delete(solvedPlans.keys().next().value!);
        solvedPlans.set(cacheKey,structuredClone(candidate));rebuild(candidate);
        return {plan:candidate,attempts,seed:population[i].map((v,j)=>(v-limits[j][0])/(limits[j][1]-limits[j][0]))};
      }
    }catch{ /* A proposed event schedule still has to satisfy the requested throws. */ }
  }
  if(budget===0)return {attempts};
  const scores=population.map(evaluate);let previousEpoch=epoch,nextPolish=1000;
  while(attempts<budget&&!solved&&best){
   if(attempts>=nextPolish){
    for(const step of [.06,.02,.006])for(let j=0;j<limits.length&&!solved&&attempts<budget;j++)for(const sign of [-1,1]){
      const values=best!.values.slice();values[j]=Math.max(limits[j][0],Math.min(limits[j][1],values[j]+sign*step*(limits[j][1]-limits[j][0])));
      evaluate(values);
    }
    nextPolish=attempts+1000;
    if(best){const worst=scores.indexOf(Math.max(...scores));population[worst]=best.values.slice();scores[worst]=best.cost;}
   }
   for(let i=0;i<population.length&&attempts<budget&&!solved;i++){
    if(previousEpoch!==epoch){for(let k=0;k<population.length;k++)scores[k]=evaluate(population[k]);previousEpoch=epoch;}
    const pick=()=>Math.floor(random()*population.length);let a=pick(),b=pick();while(b===a||b===i)b=pick();
    const force=Math.floor(random()*limits.length),attract=random()<.7,anchor=attract?population[i]:population[pick()];
    const values=population[i].map((value,j)=>random()<.8||j===force?
      Math.max(limits[j][0],Math.min(limits[j][1],anchor[j]+(attract?.5*(best!.values[j]-anchor[j]):0)+.6*(population[a][j]-population[b][j]))):value);
    const score=evaluate(values);if(score<=scores[i]){scores[i]=score;population[i]=values;}
   }
  }
  if(solved){
    const normalized=best!.values.map((v,j)=>(v-limits[j][0])/(limits[j][1]-limits[j][0]));
    proposals.set(limits.length,[...seeds,normalized].slice(-16));
    if(solvedPlans.size>=32)solvedPlans.delete(solvedPlans.keys().next().value!);
    solvedPlans.set(cacheKey,structuredClone(solved));rebuild(solved);return {plan:solved,attempts,seed:normalized};
  }
  const candidate=best?plan(best.values):undefined;
  if(candidate)rebuild(candidate);
  return {attempts,bestCost:best?.cost,candidate,seed:best?.values.map((v,j)=>(v-limits[j][0])/(limits[j][1]-limits[j][0]))};
}
