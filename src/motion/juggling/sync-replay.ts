import * as THREE from 'three';
import type {JugglingFrame} from './index';
import type {SyncBoxTracks} from './sync-box';
import {sampleTrack} from './tracks';

const mod=(n:number,d:number)=>((n%d)+d)%d;
const copy=<T>(v:T):T=>v instanceof THREE.Vector3||v instanceof THREE.Quaternion?v.clone() as T:
  Array.isArray(v)?v.map(copy) as T:v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,copy(x)])) as T:v;

/** An immutable copy of the actual playback tracks; no new motion is solved. */
export function captureSyncTracks(input:SyncBoxTracks,beatDuration:number,propRadius:number){
  const tracks=copy(input),period=tracks.period;
  const sample=(seconds:number):JugglingFrame=>{
    const time=mod(seconds,period),stepFloat=time/period*tracks.numSteps,step=Math.floor(stepFloat)%tracks.numSteps;
    return {phase:time/period,beat:time/beatDuration,propRadius,propType:'ball',throws:[],contactFallback:tracks.contactFallback,
      ballPositions:tracks.props.map(p=>sampleTrack(p,stepFloat,new THREE.Vector3())),
      armOrder:tracks.armOrderEvents?.find(e=>Math.min(Math.abs(e.time-time),period-Math.abs(e.time-time))<1e-7)?.upperHand??tracks.armOrders[step]??null,
      underarm:tracks.underarmEvents.filter(e=>Math.min(Math.abs(e.time-time),period-Math.abs(e.time-time))<1e-7).map(copy),
      constraintPhases:[...tracks.underarmEvents,...(tracks.armOrderEvents||[])].map(e=>e.time/period),
      gazeTarget:new THREE.Vector3(0,tracks.peakY-.05,tracks.centerZ),eyeTarget:tracks.gaze[step].clone(),
      hands:tracks.hands.map(h=>{
        const palmNormal=sampleTrack(h.palmNormals,stepFloat,new THREE.Vector3()).normalize();
        const fingerDir=h.fingerDirs?sampleTrack(h.fingerDirs,stepFloat,new THREE.Vector3()):new THREE.Vector3();
        if(h.fingerDirs)fingerDir.addScaledVector(palmNormal,-fingerDir.dot(palmNormal)).normalize();
        return {position:sampleTrack(h.positions,stepFloat,new THREE.Vector3()),palmNormal,fingerDir,holding:h.holding[step],
          elbowPole:h.elbowPoles?sampleTrack(h.elbowPoles,stepFloat,new THREE.Vector3()).normalize():undefined};
      })};
  };
  const obligations=(seconds:number)=>{
    const time=mod(seconds,period),step=Math.floor(time/period*tracks.numSteps)%tracks.numSteps;
    return tracks.props.map((_,prop)=>{
      const flights=tracks.flights.filter(f=>f.prop===prop),flight=flights.find(f=>mod(time-f.release,period)<f.duration-1e-9);
      const next=flights.reduce<typeof flights[number]|undefined>((best,f)=>!best||mod(f.release-time,period)<mod(best.release-time,period)?f:best,undefined);
      const sinceCatch=(f:typeof flights[number])=>{const elapsed=mod(time-f.release-f.duration,period);return period-elapsed<1e-9?0:elapsed;};
      const previous=flights.reduce<typeof flights[number]|undefined>((best,f)=>!best||sinceCatch(f)<sinceCatch(best)?f:best,undefined);
      return {owner:flight?-1:previous?.catchHand??tracks.owners[prop][step],receiver:flight?.catchHand??-1,
        catchIn:flight?mod(flight.release+flight.duration-time,period):0,
        releaseHand:next?.throwHand??tracks.owners[prop][step],releaseIn:next?mod(next.release-time,period):0};
    });
  };
  return {sample,obligations,snapshot:()=>copy(tracks),period,beatDuration,propRadius,balls:tracks.props.length,peakY:tracks.peakY,ballContactAllowed:tracks.config.allowBallContact===true,contactFallback:tracks.contactFallback};
}

type MotionSource=ReturnType<typeof captureSyncTracks>;
interface Port {hands:number[];motion:number[];balls:{values:number[];owner:number;receiver:number;releaseHand:number}[];}
interface Segment {id:number;name:string;from:number;to:number;duration:number;source:MotionSource;start:number;
  read:(seconds:number)=>JugglingFrame;entry:Port;exit:Port;}
export interface SyncReplay {period:number;movementPeriod:number;identityRepeats:number;sets:number;balls:number;
  ballContactAllowed:boolean;
  contactFallback?:boolean;
  peakY:number;beatDuration:number;sample:(seconds:number)=>JugglingFrame;segments:{id:number;name:string}[];}

const vector=(v:THREE.Vector3)=>v.toArray();
const handValues=(f:JugglingFrame,arms=true)=>f.hands.flatMap((h,i)=>[...vector(h.position),...vector(h.palmNormal),
  ...vector(h.fingerDir),...(arms?f.fixedElbows?.[i]?.toArray()||[]:[]),h.holding?1:0]);
const near=(a:number[],b:number[],eps:number)=>a.length===b.length&&a.every((x,i)=>Number.isFinite(x)&&Number.isFinite(b[i])&&Math.abs(x-b[i])<=eps);

/** Ports include both one-sided velocities, not just a quantized position key. */
function portAt(source:MotionSource,read:Segment['read'],time:number):Port{
  const at=(t:number)=>{
    const f=read(t),obligations=source.obligations(t);
    // At an exact catch, floating-point floor(trackStep) can select the last
    // pre-catch sample. Use the event ownership for the boundary contract.
    f.hands.forEach((h,i)=>h.holding=obligations.some(b=>b.owner===i));return f;
  };
  const dt=1e-4,frame=at(time),before=at(time-dt),after=at(time+dt);
  const values=handValues(frame),a=handValues(before),b=handValues(after);
  const hands=[...values,...values.map((x,i)=>(x-a[i])/dt),...values.map((x,i)=>(b[i]-x)/dt),frame.armOrder??-1];
  for(const relation of frame.underarm||[])hands.push(relation.hand,...relation.position.toArray());
  const motionValues=handValues(frame,false),ma=handValues(before,false),mb=handValues(after,false);
  const motion=[...motionValues,...motionValues.map((x,i)=>(x-ma[i])/dt),...motionValues.map((x,i)=>(mb[i]-x)/dt),frame.armOrder??-1];
  for(const relation of frame.underarm||[])motion.push(relation.hand,...relation.position.toArray());
  const obligations=source.obligations(time);
  const balls=frame.ballPositions!.map((p,i)=>({
    values:[...p.toArray(),...p.clone().sub(before.ballPositions![i]).divideScalar(dt).toArray(),
      ...after.ballPositions![i].clone().sub(p).divideScalar(dt).toArray(),obligations[i].catchIn,obligations[i].releaseIn],
    owner:obligations[i].owner,receiver:obligations[i].receiver,releaseHand:obligations[i].releaseHand}));
  return {hands,motion,balls};
}

/** Full state comparison permits only numerical roundoff; ball identities may permute. */
function matchPorts(a:Port,b:Port,arms=true):number[]|undefined{
  if(!near(arms?a.hands:a.motion,arms?b.hands:b.motion,1e-7)||a.balls.length!==b.balls.length)return;
  const used=new Set<number>(),mapping:number[]=[];
  for(const ball of b.balls){
    const i=a.balls.findIndex((other,j)=>!used.has(j)&&ball.owner===other.owner&&ball.receiver===other.receiver&&
      ball.releaseHand===other.releaseHand&&near(ball.values,other.values,1e-7));
    if(i<0)return;used.add(i);mapping.push(i);
  }
  return mapping;
}

function permutationOrder(permutation:number[]):number{
  const seen=new Set<number>(),gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;
  let order=1;
  for(let i=0;i<permutation.length;i++)if(!seen.has(i)){
    let length=0,j=i;
    do{seen.add(j);length++;j=permutation[j];}while(j!==i);
    order=order/gcd(order,length)*length;
  }
  return order;
}

/** In-memory graph of immutable, checked playback segments for one avatar.
 * Registration must follow the loaded avatar's full-cycle checks. Serialized
 * user documents never carry certificates or replay functions into this graph.
 */
export class SyncReplayGraph {
  private nodes:{port:Port;read:Segment['read'];time:number}[]=[];
  private edges:Segment[]=[];
  private context?:{beat:number;radius:number;balls:number};
  clear(){this.nodes=[];this.edges=[];this.context=undefined;}
  sourceTracks(id:number){
    if(!Number.isInteger(id)||!this.edges[id])throw new Error('登録済みの動作を選んでください。');
    return this.edges[id].source.snapshot();
  }
  fork(){
    const graph=new SyncReplayGraph();
    graph.nodes=this.nodes.slice();graph.edges=this.edges.slice();graph.context=this.context?{...this.context}:undefined;
    return graph;
  }
  /** Shortest checked bridge after `from` and before `to`; endpoints are excluded. */
  connect(from:number,to:number,maxSets=128):number[]{
    if(!Number.isInteger(from)||!Number.isInteger(to)||!this.edges[from]||!this.edges[to]||
      !Number.isInteger(maxSets)||maxSets<0||maxSets>128)throw new Error('登録済みの部品と移行セット数を確認してください。');
    const queue:{id:number;path:number[]}[]=[{id:from,path:[]}],seen=new Set<number>([from]);
    for(let i=0;i<queue.length;i++){
      const item=queue[i];
      if(matchPorts(this.edges[item.id].exit,this.edges[to].entry))return item.path;
      if(item.path.length>=maxSets)continue;
      for(const next of this.choices(item.id))if(!seen.has(next.id)){
        seen.add(next.id);queue.push({id:next.id,path:[...item.path,next.id]});
      }
    }
    throw new Error('登録済みの部品だけでは、この入口への移行がまだありません。');
  }
  validatePath(ids:number[]){
    if(!Array.isArray(ids)||ids.length>128||ids.some(id=>!Number.isInteger(id)||id<0||id>=this.edges.length))
      throw new Error('現在のモデルで登録した接続部品を128セット以内で選んでください。');
    for(let i=1;i<ids.length;i++)if(!matchPorts(this.edges[ids[i-1]].exit,this.edges[ids[i]].entry))
      throw new Error(`セット${i}から${i+1}へ移る球・手・腕の状態が一致しません。`);
  }
  get summary(){return {states:this.nodes.length,segments:this.edges.length};}
  get contextInfo(){return this.context?{balls:this.context.balls,secondsPerSet:2*this.context.beat}:undefined;}
  /** Reachability uses the same full port comparison as connect(), never names
   * or representative node IDs. Distances count only intervening sets. This
   * does not certify a complete route's length or ball-identity period. */
  connectionDistances(from:number,to:number,maxSets=128){
    if(!Number.isInteger(from)||!Number.isInteger(to)||!this.edges[from]||!this.edges[to]||
      !Number.isInteger(maxSets)||maxSets<0||maxSets>128)throw new Error('登録済みの部品と移行セット数を確認してください。');
    const forward:number[][]=this.edges.map(()=>[]),backward:number[][]=this.edges.map(()=>[]);
    for(const a of this.edges)for(const b of this.edges)if(matchPorts(a.exit,b.entry)){
      forward[a.id].push(b.id);backward[b.id].push(a.id);
    }
    const walk=(start:number,links:number[][])=>{
      const result:(number|null)[]=this.edges.map(()=>null),seen=new Set([start]),queue=[{id:start,sets:0}];
      for(let i=0;i<queue.length;i++){
        const {id,sets}=queue[i];
        for(const next of links[id]){
          if(result[next]===null)result[next]=sets;
          if(sets<maxSets&&!seen.has(next)){seen.add(next);queue.push({id:next,sets:sets+1});}
        }
      }
      return result;
    };
    return {outgoing:walk(from,forward),incoming:walk(to,backward)};
  }
  choices(after?:number){
    if(after!==undefined&&(!Number.isInteger(after)||after<0||after>=this.edges.length))return [];
    const previous=after===undefined?undefined:this.edges[after];
    if(after!==undefined&&!previous)return [];
    return this.edges.filter(e=>!previous||matchPorts(previous.exit,e.entry)).map(e=>({id:e.id,name:e.name,from:e.from,to:e.to}));
  }
  /** The verifier executes before registration; failed cycles leave no edges. */
  addCycle(name:string,source:MotionSource,original:Segment['read'],verify:(read:Segment['read'])=>boolean,
    project?:(frame:JugglingFrame,elbows:THREE.Vector3[])=>THREE.Vector3[]){
    const context={beat:source.beatDuration,radius:source.propRadius,balls:source.balls};
    if(this.context&&JSON.stringify(context)!==JSON.stringify(this.context))throw new Error('球数・テンポ・球の大きさが異なります。接続部品をクリアしてから登録してください。');
    const count=Math.round(source.period/(2*source.beatDuration));
    if(count<1||Math.abs(count*2*source.beatDuration-source.period)>1e-8||this.edges.length+count>4096)
      throw new Error('登録する動作のセット数が上限を超えるか、周期が不正です。');
    // Existing nodes supply fixed boundary poses. Only the new source is
    // adjusted, and its entire adjusted path is checked before publishing.
    const anchorPool=this.nodes.slice();
    const anchors=project?Array.from({length:count},(_,i)=>{
      const time=i*2*source.beatDuration,port=portAt(source,original,time);
      const anchor=anchorPool.find(n=>matchPorts(n.port,port,false));
      if(!anchor)anchorPool.push({port,read:original,time});
      return anchor&&!matchPorts(anchor.port,port)?{time,anchor}:undefined;
    }).filter((a):a is NonNullable<typeof a>=>!!a):[];
    const window=Math.min(.08,source.beatDuration*.5);
    const read:Segment['read']=seconds=>{
      const frame=original(seconds),time=mod(seconds,source.period);
      for(const {time:at,anchor} of anchors){
        const offset=mod(time-at+source.period/2,source.period)-source.period/2;
        if(Math.abs(offset)>=window)continue;
        const target=anchor.read(anchor.time+offset).fixedElbows!;
        const u=Math.max(0,(Math.abs(offset)-.001)/(window-.001)),blend=1-10*u**3+15*u**4-6*u**5;
        frame.fixedElbows=project!(frame,frame.fixedElbows!.map((p,i)=>p.clone().lerp(target[i],blend)));
      }
      return frame;
    };
    if(!verify(read))throw new Error('球と腕の周期検査を通った動作だけを登録できます。');
    const ports=Array.from({length:count+1},(_,i)=>portAt(source,read,i*2*source.beatDuration));
    if(!matchPorts(ports[0],ports[count]))throw new Error('元の動作の最後から先頭への状態が一致しません。');
    const node=(port:Port,time:number)=>{const i=this.nodes.findIndex(n=>matchPorts(n.port,port));if(i>=0)return i;this.nodes.push({port,read,time});return this.nodes.length-1;};
    const ids:number[]=[];
    for(let i=0;i<count;i++){
      const id=this.edges.length,entry=ports[i],exit=ports[i+1];ids.push(id);
      this.edges.push({id,name:`${name} / セット${i+1}`,from:node(entry,i*2*source.beatDuration),to:node(exit,(i+1)*2*source.beatDuration),duration:2*source.beatDuration,
        source,start:i*2*source.beatDuration,read,entry,exit});
    }
    this.context=context;
    return ids;
  }
  close(ids:number[]){
    if(!ids.length||ids.some(id=>!Number.isInteger(id)||!this.edges[id]))throw new Error('接続部品を選んでください。');
    if(ids.length>128)throw new Error('1〜128セットの接続部品を選んでください。');
    const first=this.edges[ids[0]],last=this.edges[ids[ids.length-1]];
    let balls=Array.from({length:first.source.balls},(_,i)=>i);
    for(let i=1;i<ids.length;i++){
      const mapping=matchPorts(this.edges[ids[i-1]].exit,this.edges[ids[i]].entry);
      if(!mapping)throw new Error('途中の球・手・腕の状態が一致しません。');
      balls=mapping.map(j=>balls[j]);
    }
    // The first geometrically closed route can require too many repetitions
    // to restore ball identities. Continue through checked segments with a
    // different ball permutation instead of rejecting every return path.
    const key=(id:number,map:number[])=>`${id}:${map.join(',')}`;
    const queue=[{id:last.id,path:[] as number[],balls}],seen=new Set([key(last.id,balls)]);
    const links=new Map<number,{id:number;mapping:number[]}[]>();
    let overLimit=false;
    for(let i=0;i<queue.length;i++){
      const item=queue[i],length=ids.length+item.path.length;
      const back=matchPorts(this.edges[item.id].exit,first.entry);
      if(back){
        if(length*permutationOrder(back.map(j=>item.balls[j]))<=128){
          const route=[...ids,...item.path];this.compose(route);return route;
        }
        overLimit=true;
      }
      if(length>=128)continue;
      if(!links.has(item.id))links.set(item.id,this.edges.flatMap(edge=>{
        const mapping=matchPorts(this.edges[item.id].exit,edge.entry);
        return mapping?[{id:edge.id,mapping}]:[];
      }));
      for(const edge of links.get(item.id)!){
        const balls=edge.mapping.map(j=>item.balls[j]),state=key(edge.id,balls);
        if(seen.has(state))continue;
        seen.add(state);queue.push({id:edge.id,path:[...item.path,edge.id],balls});
      }
    }
    if(overLimit)throw new Error('同じ球まで戻る周期が128セットを超えます。');
    throw new Error('登録した接続部品の中には、先頭へ戻れる経路がありません。');
  }
  compose(ids:number[]):SyncReplay{
    if(!ids.length||ids.length>128)throw new Error('1〜128セットの接続部品を選んでください。');
    if(ids.some(id=>!Number.isInteger(id)||id<0||id>=this.edges.length))throw new Error('現在のモデルで登録した接続部品を選んでください。');
    const edges=ids.map(id=>this.edges[id]);
    if(edges.some(e=>!e))throw new Error('現在のモデルで登録した接続部品を選んでください。');
    const balls=edges[0].source.balls,initial=Array.from({length:balls},(_,i)=>i),maps=[initial];
    let next=initial;
    for(let i=0;i<edges.length;i++){
      const mapping=matchPorts(edges[i].exit,edges[(i+1)%edges.length].entry);
      if(!mapping)throw new Error(i===edges.length-1?'最後から先頭へ戻る球・手・腕の状態が一致しません。':`セット${i+1}から${i+2}へ移る球・手・腕の状態が一致しません。`);
      next=mapping.map(j=>next[j]);if(i<edges.length-1)maps.push(next);
    }
    const permutation=next;
    const identityRepeats=permutationOrder(permutation);
    if(identityRepeats*ids.length>128)throw new Error('同じ球まで戻る周期が128セットを超えます。');
    const duration=edges[0].duration,movementPeriod=duration*ids.length,period=movementPeriod*identityRepeats;
    const roundMaps=[initial];
    for(let r=1;r<identityRepeats;r++)roundMaps.push(permutation.map(p=>roundMaps[r-1][p]));
    const constraintPhases=roundMaps.flatMap((_,r)=>edges.flatMap((edge,i)=>(edge.source.sample(0).constraintPhases||[])
      .map(p=>p*edge.source.period-edge.start).filter(t=>t>=-1e-9&&t<edge.duration-1e-9)
      .map(t=>(r*movementPeriod+i*duration+Math.max(0,t))/period)));
    return {period,movementPeriod,identityRepeats,sets:ids.length,balls,beatDuration:edges[0].source.beatDuration,ballContactAllowed:edges.some(e=>e.source.ballContactAllowed),contactFallback:edges.some(e=>e.source.contactFallback),
      peakY:Math.max(...edges.map(e=>e.source.peakY)),segments:edges.map(e=>({id:e.id,name:e.name})),
      sample:(seconds:number)=>{
        const time=mod(seconds,period),round=Math.min(identityRepeats-1,Math.floor(time/movementPeriod));
        const within=time-round*movementPeriod,index=Math.min(edges.length-1,Math.floor(within/duration));
        const edge=edges[index],frame=edge.read(edge.start+within-index*duration);
        const positions=frame.ballPositions!.map(p=>p.clone()),globalMap=maps[index].map(p=>roundMaps[round][p]);
        const remapped=positions.map(p=>p.clone());positions.forEach((p,i)=>remapped[globalMap[i]]=p);
        return {...frame,ballPositions:remapped,phase:time/period,constraintPhases};
      }};
  }
}
