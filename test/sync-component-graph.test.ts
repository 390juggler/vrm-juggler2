import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {VRMLoaderPlugin,VRM,VRMUtils} from '@pixiv/three-vrm';
import VRMJuggler from '../src/index';
import Body from '../src/motion/body';
import Juggling from '../src/motion/juggling';
import Options from '../src/options';
import {underForearm} from '../src/motion/inspection';
import {SYNC_BOX_PRESETS} from '../src/motion/juggling/sync-box';
import {SyncReplayGraph} from '../src/motion/juggling/sync-replay';
import {analyzeSequence,sequenceFromPreset,sequenceFromBasicParts,sequenceFromDoubleParts,rotateSequenceStart,SEQUENCE_EXAMPLES,SyncSequence,BasicColumnStyle,BasicShortStyle} from '../src/motion/juggling/sync-sequence';

let body:Body,juggling:Juggling,vrm:VRM;
const reports:any[]=[];
const transitionReports:any[]=[];
const familyReports:any[]=[];
const networkReports:any[]=[];
const mixedNetworkReports:any[]=[];
beforeAll(async()=>{
  const loader=new GLTFLoader();
  loader.register(()=>({name:'TEST_TEXTURES',loadTexture:()=>Promise.resolve(new THREE.Texture())}));
  loader.register(parser=>new VRMLoaderPlugin(parser));
  const f=readFileSync('dist/models/default.vrm');
  const gltf=await loader.parseAsync(f.buffer.slice(f.byteOffset,f.byteOffset+f.byteLength),'');
  vrm=gltf.userData.vrm;VRMUtils.removeUnnecessaryVertices(gltf.scene);VRMUtils.combineSkeletons(gltf.scene);
  const scene=new THREE.Scene();scene.add(vrm.scene);body=new Body(vrm,scene);body.motionAmount=0;
  juggling=new Juggling(scene,'3',new Options().siteswap);juggling.setAvatarMetrics(body.metrics);
},20000);
afterAll(()=>{
  if(process.env.SYNC_COMPONENT_AUDIT_PATH)writeFileSync(process.env.SYNC_COMPONENT_AUDIT_PATH,JSON.stringify({registries:reports,transitions:transitionReports,families:familyReports,networks:networkReports,mixedNetworks:mixedNetworkReports},null,2));
  juggling?.dispose();
});

// Cover the accepted spatial vocabulary plus primitives not in the 37 presets:
// 2T, held/empty-hand waypoints, higher throws, apex timing and empty hands.
const extraNames=['High-Low Box / Swap Box','High-Low Inverted Box','True Box / 蓋付きボックス',
  'Bizarre Box',"Penman's Box",'Underarm Box','4球の同期ファウンテン','Levels / 三段のExtended Box','3球コラム / Columns'];
const sources:SyncSequence[]=[...SYNC_BOX_PRESETS.map(p=>sequenceFromPreset(p.id)),
  ...extraNames.map(name=>{const s=SEQUENCE_EXAMPLES.find(s=>s.name===name);if(!s)throw new Error(name);return s;})];

it.each([false,true])('基本動作の登録庫で区間を保持し、接続可能な入口を実測する (mirror=%s)',mirror=>{
  const groups=new Map<string,{api:any;sources:{name:string;ids:number[]}[]}>(),results:any[]=[];
  for(const sequence of sources){
    const analysis=analyzeSequence(sequence),key=`${analysis.balls}B/${sequence.beatDuration}`;
    let group=groups.get(key);
    if(!group){
      const api:any=Object.create(VRMJuggler.prototype);
      Object.assign(api,{body,juggling,vrm,options:new Options(),paused:true,avatarTop:1.7,showGui:false,
        syncReplayGraph:new SyncReplayGraph(),syncReplaySources:[],renderer:{frameHeight:()=>{}},updateGui:()=>{},emitState:()=>{}});
      group={api,sources:[]};groups.set(key,group);
    }
    const row:any={name:sequence.name,context:key,mirror,sets:analysis.identitySets};results.push(row);
    try{
      const result=group.api.setSyncSequence(sequence,mirror);
      if(!result.ok)throw new Error(result.message);
      const registered=group.api.registerSyncSegments(sequence.name,sequence);
      const replay=group.api.syncReplayGraph.compose(registered.ids);
      expect(replay.period).toBeCloseTo(juggling.getMotionSnapshot().period,9);
      group.sources.push({name:sequence.name,ids:registered.ids});row.registered=true;row.ids=registered.ids;
    }catch(error){row.registered=false;row.reason=(error as Error).message;}
  }
  const contexts=[...groups].map(([key,g])=>{
    const sourceOf=new Map<number,string>();g.sources.forEach(s=>s.ids.forEach(id=>sourceOf.set(id,s.name)));
    const edges=g.api.getSyncSegmentChoices();
    const joins=edges.flatMap((e:any)=>g.api.getSyncSegmentChoices(e.id).filter((n:any)=>sourceOf.get(e.id)!==sourceOf.get(n.id))
      .map((n:any)=>({from:e.id,to:n.id,fromSource:sourceOf.get(e.id),toSource:sourceOf.get(n.id)})));
    // Exercise the existing immutable reader again after every other source has
    // been prepared; compilation of a later source must not mutate an old one.
    for(const s of g.sources){const route=g.api.syncReplayGraph.compose(s.ids);expect(body.validateSyncReplay(route.sample,route.period),s.name).toBe(true);}
    return {key,...g.api.syncReplayGraph.summary,sources:g.sources.length,joins};
  });
  reports.push({mirror,results,contexts});
  expect(results.filter(r=>!r.registered)).toEqual([]);
},120000);

const example=(name:string)=>structuredClone(SEQUENCE_EXAMPLES.find(s=>s.name===name)!);
// Boundary-state search can now bridge many pairs directly. Withhold only the
// direct x/y bridge so relays through a connected intermediary stay covered.
const withholdDirect=(api:any,x:string,y:string)=>{
  const set=api.setSyncSequence;
  api.setSyncSequence=function(s:SyncSequence,...rest:unknown[]){
    return s.name.startsWith('移行 / ')&&!s.name.includes('経由')&&[`${x} ↔ ${y}`,`${y} ↔ ${x}`].some(pair=>s.name.includes(pair))?
      {ok:false,message:'直接の移行を除外しました。'}:set.call(this,s,...rest);
  };
  return ()=>{api.setSyncSequence=set;};
};
const families=[
  {name:'fixed',a:sequenceFromPreset('box'),b:sequenceFromPreset('shower'),beat:.205},
  {name:'threaded',a:sequenceFromPreset('box'),b:sequenceFromPreset('underarm'),beat:.205},
  {name:'switched',a:sequenceFromPreset('box'),b:sequenceFromPreset('switched'),beat:.205},
  {name:'switched-shuffle',a:sequenceFromPreset('box'),b:sequenceFromPreset('switched-shuffle'),beat:.205},
  {name:'switched-inverted',a:sequenceFromPreset('box'),b:sequenceFromPreset('switched-inverted'),beat:.205},
  {name:'cross-left',a:sequenceFromPreset('box'),b:sequenceFromPreset('crossed'),beat:.205},
  {name:'cross-right',a:sequenceFromPreset('box'),b:sequenceFromPreset('crossed-right'),beat:.205},
  {name:'vertical-drop-lane',a:sequenceFromPreset('cross-side-vertical-down'),b:sequenceFromPreset('outside-vertical-down'),beat:.205},
  {name:'vertical-drop-handoff',a:sequenceFromPreset('outside-vertical-down'),b:sequenceFromPreset('switched-outside-vertical-down'),beat:.205},
  {name:'short-under-catch',a:sequenceFromPreset('box'),b:sequenceFromPreset('short-under-catch'),beat:.205},
  {name:'lateral-shuffle',a:sequenceFromPreset('lateral-inverted'),b:sequenceFromPreset('lateral-shuffle'),beat:.205},
  {name:'switched-cross-side-up',a:sequenceFromPreset('switched-center-vertical-up'),b:sequenceFromPreset('switched-cross-side-vertical-up'),beat:.205},
  {name:'switched-cross-side-down',a:sequenceFromPreset('switched-cross-side-vertical-up'),b:sequenceFromPreset('switched-cross-side-vertical-down'),beat:.205},
  {name:'cross-alternate',a:sequenceFromPreset('switched'),b:sequenceFromPreset('crossed-alternate'),beat:.205},
  {name:'cross-alternate-inverted',a:sequenceFromPreset('switched'),b:sequenceFromBasicParts({columns:'crossed-alternate',roles:'alternate',shortHand:1,left:'inverted',right:'inverted'}),beat:.205},
  ...(['normal','inverted'] as const).map(left=>({name:`cross-alternate-mixed-${left}`,a:sequenceFromPreset('crossed-alternate'),
    b:sequenceFromBasicParts({columns:'crossed-alternate',roles:'alternate',shortHand:1,left,right:left==='normal'?'inverted':'normal'}),beat:.205})),
  {name:'high-low',a:sequenceFromPreset('box'),b:example('High-Low Box / Swap Box'),beat:.18},
  {name:'high-low-inverted',a:sequenceFromPreset('inverted'),b:example('High-Low Inverted Box'),beat:.18},
  {name:'inline',a:sequenceFromPreset('box'),b:sequenceFromPreset('inline'),beat:sequenceFromPreset('inline').beatDuration},
  {name:'inline-upper',a:sequenceFromPreset('box'),b:sequenceFromPreset('inline-inverted'),beat:sequenceFromPreset('inline-inverted').beatDuration},
  {name:'claw',a:sequenceFromPreset('box-roll'),b:example('HF / Under-Arm-Claw-Box*'),beat:.25},
  {name:'hf-underarm-release',a:sequenceFromPreset('box'),b:example('HF / Under-Arm-Box*'),beat:.225},
  {name:'hf-underarm-catch',a:sequenceFromPreset('reverse'),b:example('HF / Reverse-Under-Arm-Box*'),beat:.25},
  ...[.25,.30].map(beat=>({name:`hf-fixed-uai-${beat}`,a:sequenceFromBasicParts({roles:'fixed',shortHand:0,left:'inverted',right:'inverted'}),b:SEQUENCE_EXAMPLES[47],beat})),
  {name:'columns',a:example('4球の同期ファウンテン'),b:example('4球コラム / Four Ball Columns'),beat:.205},
];
it.each(families.flatMap(f=>[false,true].map(mirror=>({...f,mirror}))))('$name: 移行を入口・出口の状態で接続し、元の動作とテンポを保持する (mirror=$mirror)',({name,a,b,beat,mirror})=>{
  const api:any=Object.create(VRMJuggler.prototype);
  Object.assign(api,{body,juggling,vrm,options:new Options(),paused:true,avatarTop:1.7,showGui:false,
    syncReplayGraph:new SyncReplayGraph(),syncReplaySources:[],renderer:{frameHeight:()=>{}},updateGui:()=>{},emitState:()=>{}});
  a=structuredClone(a);b=structuredClone(b);a.beatDuration=b.beatDuration=beat;
  const first=api.registerSyncSequence(a,mirror),second=api.registerSyncSequence(b,mirror);
  const before=api.exportSyncSegments(first.ids,'before');
  const transition=api.registerSyncTransition(0,1),replay=api.syncReplayGraph.compose(transition.route);
  expect(body.validateSyncReplay(replay.sample,replay.period)).toBe(true);
  const underarmRelations:{horizontalDistance:number;verticalGap:number}[]=[];
  if(name==='short-under-catch'){
    for(const phase of replay.sample(0).constraintPhases||[]){
      const frame=replay.sample(phase*replay.period);
      for(const relation of frame.underarm||[]){
        const other=1-relation.hand,measured=underForearm(relation.position,frame.fixedElbows![other],frame.hands[other].position);
        expect(measured.horizontalDistance).toBeLessThan(.085);expect(measured.verticalGap).toBeGreaterThan(.04);
        underarmRelations.push(measured);
      }
    }
    expect(underarmRelations.length).toBeGreaterThanOrEqual(4);
  }
  const saved=api.exportSyncSegments(transition.route,name);
  expect(saved.sources[0]).toEqual(before.sources[0]);expect(saved.sources[1]).toEqual(before.sources[1]);
  expect(saved.sources.every((s:any)=>s.sequence.beatDuration===beat)).toBe(true);
  expect(api.getSyncSegmentContext()).toEqual({balls:analyzeSequence(a).balls,secondsPerSet:2*beat});
  if(name==='threaded'||name==='short-under-catch'||name==='lateral-shuffle'||name==='switched-cross-side-down'||name==='inline-upper'){
    const restored=api.restoreSyncSegments(JSON.parse(JSON.stringify(saved))),restoredReplay=api.syncReplayGraph.compose(restored.ids);
    expect(body.validateSyncReplay(restoredReplay.sample,restoredReplay.period)).toBe(true);
    const count=api.getSyncSegmentSources().length,prepare=body.prepareSyncCycle;
    body.prepareSyncCycle=()=>{throw new Error('再利用時に腕を再計算してはいけません');};
    try{
      const reverse=api.registerSyncTransition(1,0);
      expect(reverse.added).toBe(false);expect(api.getSyncSegmentSources()).toHaveLength(count);
      const reused=api.syncReplayGraph.compose([...transition.route,...transition.route]);
      expect(body.validateSyncReplay(reused.sample,reused.period)).toBe(true);
    }finally{body.prepareSyncCycle=prepare;}
  }
  // Boundary matching cannot excuse changing the original held/flight path.
  for(const sourceIds of [first.ids,second.ids]){
    const original=api.syncReplayGraph.compose(sourceIds);
    expect(body.validateSyncReplay(original.sample,original.period)).toBe(true);
  }
  familyReports.push({name,mirror,beat,forward:transition.forward.length,backward:transition.backward.length,
    sets:replay.sets,identitySets:replay.sets*replay.identityRepeats,sourceDefinitionsUnchanged:true,
    ...(underarmRelations.length?{underarmRelations}:{})});
// Cold arm-path search includes both directions and the complete repeated
// cycle. Its computation budget is separate from every geometric assertion.
},300000);

it.each([false,true])('共通のBoxを経由して基本系統を巡回し、新しい腕の探索を行わない (mirror=%s)',mirror=>{
  const api:any=Object.create(VRMJuggler.prototype);
  Object.assign(api,{body,juggling,vrm,options:new Options(),paused:true,avatarTop:1.7,showGui:false,
    syncReplayGraph:new SyncReplayGraph(),syncReplaySources:[],renderer:{frameHeight:()=>{}},updateGui:()=>{},emitState:()=>{}});
  const names=['box','switched','crossed','crossed-right','underarm','crossed-alternate'];
  const sources=names.map(name=>{const s=sequenceFromPreset(name);s.beatDuration=.205;return s;});
  const ids=sources.map(s=>api.registerSyncSequence(s,mirror).ids);
  const before=api.exportSyncSegments(ids[0],'before').sources;
  const initialConnections=api.getSyncSourceConnections(0);
  expect(initialConnections.sources).toHaveLength(names.length);
  expect(initialConnections.connected).toBeLessThan(names.length);
  expect(()=>api.getSyncSourceConnections(-1)).toThrow('基準');
  for(let i=1;i<names.length-1;i++)expect(api.registerSyncTransition(0,i).added).toBe(true);
  expect(api.registerSyncTransition(1,5).added).toBe(true);
  const registered=api.getSyncSegmentSources().length,prepare=body.prepareSyncCycle,pairs:any[]=[];
  body.prepareSyncCycle=()=>{throw new Error('登録済み経路の再利用で腕を探索してはいけません');};
  let cycleSets=0,identitySets=0;
  try{
    const connections=api.getSyncSourceConnections(0);
    expect(connections.connected).toBe(names.length);
    expect(connections.sources).toHaveLength(names.length);
    for(const s of connections.sources){
      expect(s.forwardSets).toBe(api.syncReplayGraph.connect(ids[0].at(-1),ids[s.index][0]).length);
      expect(s.returnSets).toBe(api.syncReplayGraph.connect(ids[s.index].at(-1),ids[0][0]).length);
    }
    for(let from=0;from<names.length;from++)for(let to=0;to<names.length;to++)if(from!==to){
      const connection=api.registerSyncTransition(from,to);expect(connection.added).toBe(false);
      pairs.push({from:names[from],to:names[to],bridgeSets:connection.forward.length});
    }
    const order=[2,1,5,3,4,0],route=order.flatMap((source,i)=>[...ids[source],
      ...api.syncReplayGraph.connect(ids[source].at(-1),ids[order[(i+1)%order.length]][0])]);
    const replay=api.syncReplayGraph.compose(route);
    expect(body.validateSyncReplay(replay.sample,replay.period)).toBe(true);
    expect(api.getSyncSegmentSources()).toHaveLength(registered);
    expect(api.exportSyncSegments(route,'after').sources.slice(0,names.length)).toEqual(before);
    cycleSets=replay.sets;identitySets=replay.sets*replay.identityRepeats;
  }finally{body.prepareSyncCycle=prepare;}
  networkReports.push({mirror,beat:.205,sources:names,registeredTransitions:registered-names.length,pairs,
    cycleSets,identitySets,armSearchesDuringReuse:0,sourceDefinitionsUnchanged:true});
},300000);

it.each([false,true])('接続済みの中継動作だけを使い、経由する移行を保存復元できる (mirror=%s)',mirror=>{
  const api:any=Object.create(VRMJuggler.prototype);
  Object.assign(api,{body,juggling,vrm,options:new Options(),paused:true,avatarTop:1.7,showGui:false,
    syncReplayGraph:new SyncReplayGraph(),syncReplaySources:[],renderer:{frameHeight:()=>{}},updateGui:()=>{},emitState:()=>{}});
  const sources=['box','switched','switched-shuffle'].map(id=>sequenceFromPreset(id));
  const ids=sources.map(s=>api.registerSyncSequence(s,mirror).ids),before=api.exportSyncSegments(ids[0],'before');
  const allowDirect=withholdDirect(api,sources[1].name,sources[2].name);
  // Merely registering Box does not establish that Switched can reach it.
  expect(()=>api.registerSyncTransition(1,2)).toThrow('移行をまだ生成できませんでした');
  expect(api.exportSyncSegments(ids[0],'before')).toEqual(before);
  api.registerSyncTransition(0,1);
  const joined=api.registerSyncTransition(1,2);allowDirect();
  expect(joined.via).toBe(sources[0].name);expect(joined.added).toBe(true);
  const saved=api.exportSyncSegments(joined.route,'中継する往復'),restored=api.restoreSyncSegments(JSON.parse(JSON.stringify(saved)));
  const replay=api.syncReplayGraph.compose(restored.ids);expect(body.validateSyncReplay(replay.sample,replay.period)).toBe(true);
  expect(api.exportSyncSegments(restored.ids,'中継する往復')).toEqual(saved);
  const count=api.getSyncSegmentSources().length,prepare=body.prepareSyncCycle;
  body.prepareSyncCycle=()=>{throw new Error('中継経路の再利用で腕を探索してはいけません');};
  try{expect(api.registerSyncTransition(2,1).added).toBe(false);expect(api.getSyncSegmentSources()).toHaveLength(count);}
  finally{body.prepareSyncCycle=prepare;}
},300000);

it.each([false,true])('High-Lowを中継してAroundへ接続し、保存後も腕を再計算せず巡回する (mirror=%s)',mirror=>{
  const api:any=Object.create(VRMJuggler.prototype);
  Object.assign(api,{body,juggling,vrm,options:new Options(),paused:true,avatarTop:1.7,showGui:false,
    syncReplayGraph:new SyncReplayGraph(),syncReplaySources:[],renderer:{frameHeight:()=>{}},updateGui:()=>{},emitState:()=>{}});
  const sources=[sequenceFromPreset('box'),example('High-Low Box / Swap Box'),example('High-Low-Around Inverted Box')]
    .map(s=>({...s,beatDuration:.15}));
  const ids:number[][]=[],indices:number[]=[];
  // Around-first is the UI recipe for adopting its native 0.30-second set.
  for(const source of mirror?[2,1,0]:[0,1,2]){
    indices[source]=api.getSyncSegmentSources().length;
    ids[source]=api.registerSyncSequence(sources[source],mirror).ids;
  }
  const before=api.exportSyncSegments(ids[0],'before'),allowDirect=withholdDirect(api,sources[0].name,sources[2].name);
  // An unconnected intermediate does not justify claiming A can reach B.
  expect(()=>api.registerSyncTransition(indices[0],indices[2])).toThrow('移行をまだ生成できませんでした');
  expect(api.exportSyncSegments(ids[0],'before')).toEqual(before);
  api.registerSyncTransition(indices[0],indices[1]);
  // Generate the missing bridge on either side of the intermediary.
  const joined=api.registerSyncTransition(indices[mirror?2:0],indices[mirror?0:2]);allowDirect();
  expect(joined.added).toBe(true);expect(joined.via).toBe(sources[1].name);
  const saved=api.exportSyncSegments(joined.route,'High-Low中継');
  expect(saved.sources.slice(0,3)).toEqual(before.sources);
  expect(saved.sources.every((s:any)=>s.sequence.beatDuration===.15)).toBe(true);
  const restored=api.restoreSyncSegments(JSON.parse(JSON.stringify(saved)));
  expect(api.exportSyncSegments(restored.ids,'High-Low中継')).toEqual(saved);
  const count=api.getSyncSegmentSources().length,prepare=body.prepareSyncCycle,pairs:any[]=[];
  body.prepareSyncCycle=()=>{throw new Error('High-Lowの再利用で腕を探索してはいけません');};
  let cycleSets=0,identitySets=0;
  try{
    const replay=api.syncReplayGraph.compose(restored.ids);
    expect(body.validateSyncReplay(replay.sample,replay.period)).toBe(true);
    for(const [from,to] of [[0,2],[2,0],[1,2],[2,1]]){
      const result=api.registerSyncTransition(indices[from],indices[to]);expect(result.added).toBe(false);
      const route=api.syncReplayGraph.compose(result.route);
      expect(body.validateSyncReplay(route.sample,route.period)).toBe(true);
      pairs.push({from:sources[from].name,to:sources[to].name,bridgeSets:result.forward.length});
    }
    const open=[0,2,1].reduce((route:number[],source)=>api.appendSyncSource(route,indices[source]).ids,[]);
    const cycle=api.syncReplayGraph.compose(api.closeSyncSegments(open));
    expect(body.validateSyncReplay(cycle.sample,cycle.period)).toBe(true);
    expect(api.getSyncSegmentSources()).toHaveLength(count);
    cycleSets=cycle.sets;identitySets=cycle.sets*cycle.identityRepeats;
  }finally{body.prepareSyncCycle=prepare;}
  networkReports.push({name:'high-low-around',mirror,beat:.15,sources:sources.map(s=>s.name),
    registrationOrder:indices,registeredTransitions:count-sources.length,pairs,cycleSets,identitySets,
    armSearchesDuringReuse:0,sourceDefinitionsUnchanged:true});
},300000);

it.each([false,true])('HFの腕下・クロー・役割固定を共通の基準へつなぎ、別の巡回順と保存復元でも同じ接続を再利用する (mirror=%s)',mirror=>{
  const api:any=Object.create(VRMJuggler.prototype);
  Object.assign(api,{body,juggling,vrm,options:new Options(),paused:true,avatarTop:1.7,showGui:false,
    syncReplayGraph:new SyncReplayGraph(),syncReplaySources:[],renderer:{frameHeight:()=>{}},updateGui:()=>{},emitState:()=>{}});
  const sources=[sequenceFromPreset('box'),sequenceFromPreset('reverse'),...[36,38,45].map(i=>structuredClone(SEQUENCE_EXAMPLES[i]))];
  sources.push(...(['normal','inverted'] as const).map(style=>sequenceFromBasicParts({roles:'fixed',shortHand:0,left:style,right:style})),
    structuredClone(SEQUENCE_EXAMPLES[47]),sequenceFromPreset('box-roll'),structuredClone(SEQUENCE_EXAMPLES[40]),rotateSequenceStart(SEQUENCE_EXAMPLES[43],2));
  sources.forEach(s=>s.beatDuration=.25);
  const original=api.registerSyncSequence(sequenceFromPreset('box'),mirror),differentTempo=api.exportSyncSegments(original.ids);
  expect(()=>api.prepareSyncBasicNetwork(mirror,'hf-underarm').next()).toThrow('1セット0.5秒');
  expect(api.exportSyncSegments(original.ids)).toEqual(differentTempo);api.clearSyncSegments();
  const cancelled=api.prepareSyncBasicNetwork(mirror,'hf-underarm');cancelled.next();cancelled.next();cancelled.return();
  expect(api.getSyncSegmentSources()).toEqual([]);
  const preview=juggling.getMotionSnapshot(),batch=api.prepareSyncBasicNetwork(mirror,'hf-underarm');
  let step=batch.next(),steps=0;
  while(!step.done){
    expect(step.value.completed).toBe(steps++);expect(step.value.total).toBe(21);
    expect(api.getSyncSegmentSources()).toEqual([]);expect(juggling.getMotionSnapshot()).toEqual(preview);step=batch.next();
  }
  expect(step.value.addedSources).toBe(11);expect(step.value.addedTransitions).toBe(10);expect(steps).toBe(21);
  const ids=step.value.sourceIndices.map((i:number)=>api.syncReplaySources[i].ids),before=api.exportSyncSegments(ids[0]).sources.slice(0,11);
  expect(before.map((s:any)=>s.sequence)).toEqual(JSON.parse(JSON.stringify(sources)));
  const paths:any[]=[];
  for(const to of [1,2,3,4,5,6,7,8,9,10]){
    const t=api.registerSyncTransition(0,to),replay=api.syncReplayGraph.compose(t.route);
    expect(t.added).toBe(false);
    expect(body.validateSyncReplay(replay.sample,replay.period)).toBe(true);
    paths.push({to,via:step.value.connections.find((c:any)=>c.to===to).via,forward:t.forward.length,backward:t.backward.length,sets:replay.sets});
  }
  expect(paths[2].via).toBe(sources[1].name);expect(paths[3].via).toBe(sources[3].name);
  expect(api.getSyncSourceConnections(0).connected).toBe(11);
  const count=api.getSyncSegmentSources().length,prepare=body.prepareSyncCycle,inspect=api.inspectSyncCycle,cycles:any[]=[];
  let saved:any;
  body.prepareSyncCycle=api.inspectSyncCycle=()=>{throw new Error('接続網の組み替えで腕を再探索してはいけません');};
  try{
    const repeated=api.prepareSyncBasicNetwork(mirror,'hf-underarm');let reuse=repeated.next();while(!reuse.done)reuse=repeated.next();
    expect(reuse.value).toMatchObject({addedSources:0,addedTransitions:0});
    for(const order of [[2,4,3,1,0],[4,2,0,3,1],[7,9,0],[10,8,9]]){
      const open=order.reduce((route:number[],source)=>api.appendSyncSource(route,source).ids,[]),route=api.closeSyncSegments(open);
      const replay=api.syncReplayGraph.compose(route);
      expect(body.validateSyncReplay(replay.sample,replay.period)).toBe(true);
      cycles.push({order,sets:replay.sets,identitySets:replay.sets*replay.identityRepeats});
      saved=api.exportSyncSegments(route,'腕下の接続網');
    }
    expect(api.registerSyncTransition(2,4).added).toBe(false);
    expect(api.getSyncSegmentSources()).toHaveLength(count);
    expect(saved.sources.slice(0,11)).toEqual(before);
  }finally{body.prepareSyncCycle=prepare;api.inspectSyncCycle=inspect;}
  const restored=api.restoreSyncSegments(JSON.parse(JSON.stringify(saved))),replay=api.syncReplayGraph.compose(restored.ids);
  expect(body.validateSyncReplay(replay.sample,replay.period)).toBe(true);
  expect(api.exportSyncSegments(restored.ids,'腕下の接続網')).toEqual(saved);
  expect(api.getSyncSourceConnections(0).connected).toBe(11);
  networkReports.push({name:'hf-underarm',mirror,beat:.25,sources:sources.map(s=>s.name),paths,cycles,
    registeredTransitions:count-sources.length,armSearchesDuringReuse:0,sourceDefinitionsUnchanged:true,restoredSets:restored.ids.length,
    batchSteps:steps,batchPublishedAtomically:true,cancelPreservesRegistry:true,differentTempoPreservesRegistry:true,repeatedBatchAddedSources:0});
},600000);

it.each([false,true])('高低・空間経路・Doubleの90部品を基準へ往復接続し、混合した周期を既存区間だけで作る (mirror=%s)',mirror=>{
  const api:any=Object.create(VRMJuggler.prototype);
  Object.assign(api,{body,juggling,vrm,options:new Options(),paused:true,avatarTop:1.7,showGui:false,
    syncReplayGraph:new SyncReplayGraph(),syncReplaySources:[],renderer:{frameHeight:()=>{}},updateGui:()=>{},emitState:()=>{}});
  const columns:BasicColumnStyle[]=['normal','switched','crossed','crossed-right','underarm','crossed-alternate'];
  const styles:BasicShortStyle[]=['normal','shuffle','reverse','inverted'];
  const parts=columns.flatMap(columns=>styles.flatMap(left=>styles.map(right=>({columns,left,right})))).filter(p=>
    ['normal','switched','underarm'].includes(p.columns)||
    p.columns==='crossed'&&p.left==='normal'&&p.right==='reverse'||
    p.columns==='crossed-right'&&p.left==='reverse'&&p.right==='normal'||
    p.columns==='crossed-alternate'&&[p.left,p.right].every(s=>s==='normal'||s==='inverted')||p.left==='normal'&&p.right==='normal');
  // Register the six bases first. All later identifiers are real source indices,
  // so generated transition definitions cannot accidentally become source B.
  parts.sort((a,b)=>Number(b.left==='normal'&&b.right==='normal')-Number(a.left==='normal'&&a.right==='normal'));
  const spatial=['vertical-up','vertical-down','cross-side-vertical-up','cross-side-vertical-down',
    'lateral-normal','lateral-inverted','short-under-release','outside-vertical-up',
    'switched-outside-vertical-up','switched-center-vertical-up','switched-center-vertical-down','lateral-reverse',
    'outside-vertical-down','switched-outside-vertical-down','short-under-catch','lateral-shuffle','switched-cross-side-vertical-up','switched-cross-side-vertical-down'];
  const doubles=styles.flatMap(crossSet=>styles.map(selfSet=>({crossSet,selfSet})));
  const sources=[...parts.map(p=>sequenceFromBasicParts({...p,roles:'alternate',shortHand:1})),...spatial.map(sequenceFromPreset),...doubles.map(sequenceFromDoubleParts)];
  expect(sources).toHaveLength(90);
  expect(api.setSyncSequence(sources[0],mirror).ok).toBe(true);juggling.seek(.27);body.update(juggling.update(0),0);
  const preview=juggling.getMotionSnapshot(),batch=api.prepareSyncBasicNetwork(mirror);
  let step=batch.next(),steps=0;
  while(!step.done){
    expect(step.value.completed).toBe(steps++);expect(step.value.total).toBe(179);
    expect(api.getSyncSegmentSources()).toEqual([]);expect(api.getSyncSegmentChoices()).toEqual([]);
    expect(juggling.getMotionSnapshot()).toEqual(preview);
    step=batch.next();
  }
  expect(steps).toBe(179);expect(step.value.addedSources).toBe(90);
  const ids=step.value.sourceIndices.map((i:number)=>api.syncReplaySources[i].ids),additions=step.value.connections;
  const document=api.exportSyncSegments(ids[0],'before'),before=document.sources.slice(0,sources.length);
  expect(document.sources.length).toBeGreaterThan(128);
  const documentBytes=Buffer.byteLength(JSON.stringify(document),'utf8');expect(documentBytes).toBeLessThan(2_000_000);
  expect(before.map((s:any)=>s.sequence)).toEqual(JSON.parse(JSON.stringify(sources)));
  expect(additions.filter((r:any)=>r.via).length).toBeGreaterThanOrEqual(3);
  const registered=api.getSyncSegmentSources().length,prepare=body.prepareSyncCycle,paths:any[]=[],cycles:any[]=[];
  let connectionCoverage:any;
  body.prepareSyncCycle=()=>{throw new Error('登録済みの部品を組み直す際に腕を探索してはいけません');};
  try{
    const coverageStarted=performance.now();
    connectionCoverage=api.getSyncSourceConnections(0);
    connectionCoverage.milliseconds=performance.now()-coverageStarted;
    expect(connectionCoverage.connected).toBe(90);
    expect(connectionCoverage.sources).toHaveLength(90);
    const repeated=api.prepareSyncBasicNetwork(mirror);let reuse=repeated.next();
    while(!reuse.done)reuse=repeated.next();
    expect(reuse.value).toMatchObject({addedSources:0,addedTransitions:0,sourceIndices:step.value.sourceIndices});
    // Two directions per source prove every source reaches every other through
    // the common base. Do not enumerate every possible longer sequence.
    for(let i=1;i<sources.length;i++){
      const result=api.registerSyncTransition(0,i);expect(result.added).toBe(false);
      paths.push({source:i,out:result.forward.length,back:result.backward.length});
      expect(connectionCoverage.sources.find((s:any)=>s.index===i)).toMatchObject({forwardSets:result.forward.length,returnSets:result.backward.length});
    }
    const order=Array.from({length:sources.length},(_,i)=>(i*17)%sources.length);
    for(let start=0;start<order.length;start+=3){
      const appendStart=performance.now();
      const group=order.slice(start,start+3),open=group.reduce((route:number[],s)=>api.appendSyncSource(route,s).ids,[]);
      const route=api.closeSyncSegments(open);
      const appendMilliseconds=performance.now()-appendStart;
      const replay=api.syncReplayGraph.compose(route);
      expect(body.validateSyncReplay(replay.sample,replay.period),group.join(',')).toBe(true);
      cycles.push({sources:group,sets:replay.sets,identitySets:replay.sets*replay.identityRepeats,appendMilliseconds});
    }
    expect(api.getSyncSegmentSources()).toHaveLength(registered);
    expect(api.exportSyncSegments(ids[0],'after').sources.slice(0,sources.length)).toEqual(before);
  }finally{body.prepareSyncCycle=prepare;}
  mixedNetworkReports.push({mirror,beat:.205,parts,spatial,doubles,documentBytes,registeredSources:registered,registeredTransitions:registered-sources.length,additions,paths,cycles,
    armSearchesDuringReuse:0,sourceDefinitionsUnchanged:true,batchProgressSteps:steps,batchPublishedAtomically:true,repeatedBatchAddedSources:0,repeatedBatchAddedTransitions:0,connectionCoverage});
},300000);

it.each([false,true])('一括準備の中止・失敗・外部変更で仮の登録内容を公開しない (mirror=%s)',mirror=>{
  const restorePreview=juggling.capturePlaybackRestore(),restoreBody=body.captureSyncPlanRestore(),previousAngle=body.armAngle;
  try{
  const api:any=Object.create(VRMJuggler.prototype);
  Object.assign(api,{body,juggling,vrm,options:new Options(),paused:true,avatarTop:1.7,showGui:false,loadId:0,
    syncReplayGraph:new SyncReplayGraph(),syncReplaySources:[],renderer:{frameHeight:()=>{}},updateGui:()=>{},emitState:()=>{}});
  // The batch's first part is the relative-passage Box, not the absolute preset.
  const source=sequenceFromBasicParts({roles:'alternate',shortHand:1,left:'normal',right:'normal'});source.name='名前を変えた元の部品';
  const original=api.registerSyncSequence(source,mirror),saved=api.exportSyncSegments(original.ids,'残す列');
  api.playSyncSegments(original.ids);api.paused=true;juggling.seek(.37);body.update(juggling.update(0),0);
  const preview=juggling.getMotionSnapshot();
  let notifications=0;
  api.emitState=()=>{notifications++;expect(api.exportSyncSegments(original.ids,'残す列')).toEqual(saved);};
  const cancelled=api.prepareSyncBasicNetwork(mirror);
  expect(cancelled.next().value.completed).toBe(0);expect(cancelled.next().value.completed).toBe(1);
  expect(cancelled.next().value.completed).toBe(2); // One new source exists only in the private registry.
  expect(cancelled.return().done).toBe(true);
  expect(api.exportSyncSegments(original.ids,'残す列')).toEqual(saved);expect(juggling.getMotionSnapshot()).toEqual(preview);
  expect(notifications).toBeGreaterThan(0);
  const register=api.registerSyncSequence;let newSources=0;
  api.registerSyncSequence=function(s:SyncSequence,m:boolean){if(++newSources===2)throw new Error('registration failure');return register.call(this,s,m);};
  const rejected=api.prepareSyncBasicNetwork(mirror);let failure:any;
  try{while(!rejected.next().done){}}catch(error){failure=error;}
  expect(failure.message).toContain('registration failure');expect(failure.progress).toMatchObject({stage:'source',completed:2,total:179});
  expect(api.exportSyncSegments(original.ids,'残す列')).toEqual(saved);expect(juggling.getMotionSnapshot()).toEqual(preview);
  api.registerSyncSequence=register;api.emitState=()=>{};
  const changed=api.prepareSyncBasicNetwork(mirror);changed.next();changed.next();
  const extra=api.registerSyncSequence(sequenceFromPreset('inverted'),mirror),newDocument=api.exportSyncSegments(extra.ids,'外部からの追加');
  expect(()=>changed.next()).toThrow('準備中にモデルまたは登録内容が変更');
  expect(api.exportSyncSegments(extra.ids,'外部からの追加')).toEqual(newDocument);
  const changedModel=api.prepareSyncBasicNetwork(mirror);changedModel.next();api.loadId++;
  expect(()=>changedModel.next()).toThrow('準備中にモデルまたは登録内容が変更');
  expect(api.exportSyncSegments(extra.ids,'外部からの追加')).toEqual(newDocument);
  const changedPose=api.prepareSyncBasicNetwork(mirror),angle=body.armAngle;changedPose.next();body.armAngle+=.01;
  try{expect(()=>changedPose.next()).toThrow('モデルの姿勢が変わりました');}
  finally{body.armAngle=angle;}
  expect(api.exportSyncSegments(extra.ids,'外部からの追加')).toEqual(newDocument);
  }finally{
    // This fixture shares its VRM and juggling instance across API facades.
    // Do not leave a facade's active replay bound to the following test's body.
    body.armAngle=previousAngle;restoreBody();restorePreview();body.update(juggling.update(0),0);
  }
},30000);

it('同じ動きを繰り返した長い列を保ち、移行に使う2セットの基本部品を別に用意する',()=>{
  const api:any=Object.create(VRMJuggler.prototype);
  Object.assign(api,{body,juggling,vrm,options:new Options(),paused:true,avatarTop:1.7,showGui:false,
    syncReplayGraph:new SyncReplayGraph(),syncReplaySources:[],renderer:{frameHeight:()=>{}},updateGui:()=>{},emitState:()=>{}});
  const sequence=sequenceFromPreset('box');sequence.sets.push(...structuredClone(sequence.sets));
  const original=api.registerSyncSequence(sequence),saved=api.exportSyncSegments(original.ids,'長い列');
  const definitions:SyncSequence[]=[],register=api.registerSyncSequence;
  api.registerSyncSequence=function(s:SyncSequence,mirror:boolean){definitions.push(s);return register.call(this,s,mirror);};
  const batch=api.prepareSyncBasicNetwork();batch.next();expect(batch.next().value.completed).toBe(1);batch.return();
  expect(definitions).toHaveLength(1);expect(definitions[0].sets).toHaveLength(2);
  expect(api.exportSyncSegments(original.ids,'長い列')).toEqual(saved);
});

it('4球の登録庫に3球の一括準備を混ぜず、元の登録を保つ',()=>{
  const api:any=Object.create(VRMJuggler.prototype);
  Object.assign(api,{body,juggling,vrm,options:new Options(),paused:true,avatarTop:1.7,showGui:false,
    syncReplayGraph:new SyncReplayGraph(),syncReplaySources:[],renderer:{frameHeight:()=>{}},updateGui:()=>{},emitState:()=>{}});
  const original=api.registerSyncSequence(example('4球の同期ファウンテン')),saved=api.exportSyncSegments(original.ids,'4球');
  expect(()=>api.prepareSyncBasicNetwork().next()).toThrow('一括準備は3球用');
  expect(api.exportSyncSegments(original.ids,'4球')).toEqual(saved);
});

it.each([false,true])('不成立の移行は未登録の編集用候補と箇所を返し、元の登録庫と反転を保持する (mirror=%s)',mirror=>{
  const api:any=Object.create(VRMJuggler.prototype);
  Object.assign(api,{body,juggling,vrm,options:new Options(),paused:true,avatarTop:1.7,showGui:false,
    syncReplayGraph:new SyncReplayGraph(),syncReplaySources:[],renderer:{frameHeight:()=>{}},updateGui:()=>{},emitState:()=>{}});
  const a=sequenceFromPreset('box'),b=sequenceFromPreset('inline');a.beatDuration=b.beatDuration=.16;
  const first=api.registerSyncSequence(a,mirror);api.registerSyncSequence(b,mirror);
  const saved=api.exportSyncSegments(first.ids,'unchanged'),preview=juggling.getMotionSnapshot();
  // Boundary-state corridors now bridge this pair, and a genuine rejection
  // needs an exhaustive search. Fail every bridge's plan to check the payload.
  const setBox=api.setSyncBox;
  api.setSyncBox=(config:any)=>({ok:false,siteswap:config.siteswap,message:'経路を見つけられませんでした。',
    failure:{period:1,issues:[{kind:'arm-path',phase:.5,message:'腕の経路を見つけられませんでした。'}]}});
  let failure:any;
  try{api.registerSyncTransition(0,1);}catch(error){failure=error;}
  finally{api.setSyncBox=setBox;}
  expect(failure).toBeDefined();expect(failure.mirror).toBe(mirror);expect(failure.failure.issues.length).toBeGreaterThan(0);
  expect(analyzeSequence(failure.sequence).documentOK).toBe(true);
  expect(failure.sequence.beatDuration).toBe(.16);
  expect(failure.sequence.sets.some((r:any)=>r.motion.transition)).toBe(true);
  failure.sequence.sets[0].throws=['0','0'];
  expect(api.exportSyncSegments(first.ids,'unchanged')).toEqual(saved);
  expect(juggling.getMotionSnapshot()).toEqual(preview);
},300000);

it.each([false,true])('基本動作A/B/Cへ必要な移行だけを登録し、別の巡回順にも再利用する (mirror=%s)',mirror=>{
  const api:any=Object.create(VRMJuggler.prototype);
  Object.assign(api,{body,juggling,vrm,options:new Options(),paused:true,avatarTop:1.7,showGui:false,
    syncReplayGraph:new SyncReplayGraph(),syncReplaySources:[],renderer:{frameHeight:()=>{}},updateGui:()=>{},emitState:()=>{}});
  const ids=['box','inverted','reverse'].map(id=>api.registerSyncSequence(sequenceFromPreset(id),mirror).ids as number[]);
  const before=juggling.getMotionSnapshot();
  expect(()=>api.appendSyncSource(ids[0],1)).toThrow('移行がまだありません');
  expect(juggling.getMotionSnapshot()).toEqual(before);
  const graph=api.syncReplayGraph,inspect=api.inspectSyncCycle,set=api.setSyncSequence;let rejected=0;
  api.inspectSyncCycle=()=>{rejected++;return {skeletonOK:false};};
  // Two rejected candidates prove the rollback; do not plan every other bridge.
  api.setSyncSequence=function(...args:unknown[]){return rejected>=2?{ok:false,message:'検査を省略しました。'}:set.apply(this,args);};
  expect(()=>api.registerSyncTransition(0,1)).toThrow('移行をまだ生成できませんでした');
  expect(rejected).toBeGreaterThanOrEqual(2);expect(api.syncReplayGraph).toBe(graph);expect(api.getSyncSegmentSources()).toHaveLength(3);
  expect(juggling.getMotionSnapshot()).toEqual(before);api.inspectSyncCycle=inspect;api.setSyncSequence=set;
  const ab=api.registerSyncTransition(0,1),ac=api.registerSyncTransition(0,2);
  expect(ab.added).toBe(true);expect(ac.added).toBe(true);
  const count=api.getSyncSegmentSources().length;
  const bc=api.registerSyncTransition(1,2);expect(bc.added).toBe(false);
  expect(api.getSyncSegmentSources()).toHaveLength(count);
  expect(juggling.getMotionSnapshot()).toEqual(before);
  const prepare=body.prepareSyncCycle,verify=api.inspectSyncCycle,definitions=api.exportSyncSegments(ids[0]).sources;
  let appended:number[]=[];
  body.prepareSyncCycle=api.inspectSyncCycle=()=>{throw new Error('動作の追加で再検査してはいけません');};
  try{
    const first=api.appendSyncSource([],1,2);
    expect(first.bridge).toEqual([]);expect(first.ids).toEqual([...ids[1],...ids[1]]);
    const second=api.appendSyncSource(first.ids,2);
    expect(second.bridge).toEqual(bc.forward);expect(second.addedSets).toBe(bc.forward.length+ids[2].length);
    expect(first.ids).toEqual([...ids[1],...ids[1]]);
    appended=api.closeSyncSegments(api.appendSyncSource(second.ids,0).ids);
    expect(api.analyzeSyncSegments(appended).sets).toBe(appended.length);
    expect(api.getSyncSegmentSources().filter((s:any)=>s.purpose==='transition')).toHaveLength(2);
    expect(()=>api.appendSyncSource(ids[0],99)).toThrow('登録済み');
    expect(()=>api.appendSyncSource(ids[0],.5)).toThrow('登録済み');
    for(const repeats of [0,1.5,17,NaN])expect(()=>api.appendSyncSource(ids[0],1,repeats)).toThrow('1〜16回');
    expect(()=>api.appendSyncSource(Array(64).fill(ids[0]).flat(),0)).toThrow('128セット');
    expect(api.exportSyncSegments(ids[0]).sources).toEqual(definitions);
    expect(juggling.getMotionSnapshot()).toEqual(before);
  }finally{body.prepareSyncCycle=prepare;api.inspectSyncCycle=verify;}
  const appendedReplay=api.syncReplayGraph.compose(appended);
  expect(body.validateSyncReplay(appendedReplay.sample,appendedReplay.period)).toBe(true);
  // The third pair uses A as an intermediate state. No new arm plan is solved.
  const routes:any[]=[];
  for(const order of [[0,1,2],[2,1,0]]){
    const route=order.flatMap((source,i)=>[...ids[source],...api.syncReplayGraph.connect(ids[source][ids[source].length-1],ids[order[(i+1)%order.length]][0])]);
    const replay=api.syncReplayGraph.compose(route);
    expect(body.validateSyncReplay(replay.sample,replay.period)).toBe(true);
    routes.push({order,sets:route.length,identitySets:replay.sets*replay.identityRepeats});
  }
  const roundTrip=api.registerSyncTransition(1,2),saved=api.exportSyncSegments(roundTrip.route,'再利用した移行');
  const restored=api.restoreSyncSegments(JSON.parse(JSON.stringify(saved)));
  expect(api.getSyncSegmentSources().filter((s:any)=>s.purpose==='transition')).toHaveLength(2);
  expect(api.appendSyncSource([],1,2).ids).toEqual([...ids[1],...ids[1]]);
  expect(api.analyzeSyncSegments(restored.ids).sets).toBe(roundTrip.route.length);
  expect(body.validateSyncReplay(api.syncReplayGraph.compose(restored.ids).sample,api.syncReplayGraph.compose(restored.ids).period)).toBe(true);
  const unchanged=api.exportSyncSegments(restored.ids,'再利用した移行');
  expect(()=>api.registerSyncTransition(0,99)).toThrow('2つの動作');
  expect(api.exportSyncSegments(restored.ids,'再利用した移行')).toEqual(unchanged);
  transitionReports.push({mirror,ab:{forward:ab.forward.length,backward:ab.backward.length},
    ac:{forward:ac.forward.length,backward:ac.backward.length},bc:{forward:bc.forward.length,backward:bc.backward.length,added:bc.added},
    routes,restoredSets:restored.ids.length,failedCandidatesPreserveRegistry:rejected,
    sourceAppend:{viaExisting: true,repeats:2,sets:appended.length,noNewValidation:true,metadataRestored:true}});
},300000);
