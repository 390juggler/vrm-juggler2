import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {VRMLoaderPlugin,VRMUtils} from '@pixiv/three-vrm';
import VRMJuggler from '../src/index';
import Body from '../src/motion/body';
import Juggling from '../src/motion/juggling';
import Options from '../src/options';
import {SyncReplayGraph} from '../src/motion/juggling/sync-replay';
import {sequenceFromBasicParts,compileSequence} from '../src/motion/juggling/sync-sequence';
import {movementStateTransition} from '../src/motion/juggling/sync-transitions';

let api:any, juggling:Juggling, body:Body;
beforeAll(async()=>{
 const loader=new GLTFLoader();loader.register(()=>({name:'TEST_TEXTURES',loadTexture:()=>Promise.resolve(new THREE.Texture())}));
 loader.register(parser=>new VRMLoaderPlugin(parser));
 const f=readFileSync('dist/models/default.vrm'),gltf=await loader.parseAsync(f.buffer.slice(f.byteOffset,f.byteOffset+f.byteLength),'');
 const vrm=gltf.userData.vrm;VRMUtils.removeUnnecessaryVertices(gltf.scene);VRMUtils.combineSkeletons(gltf.scene);
 const scene=new THREE.Scene();scene.add(vrm.scene);body=new Body(vrm,scene);body.motionAmount=0;
 juggling=new Juggling(scene,'3',new Options().siteswap);juggling.setAvatarMetrics(body.metrics);
 api=Object.create(VRMJuggler.prototype);
 Object.assign(api,{body,juggling,vrm,options:new Options(),paused:true,avatarTop:1.7,showGui:false,
  syncReplayGraph:new SyncReplayGraph(),syncReplaySources:[],renderer:{frameHeight:()=>{}},updateGui:()=>{},emitState:()=>{}});

},20000);
afterAll(()=>juggling?.dispose());

it('connects solved cross events to Box, preserves both sources, and restores and reuses the route',()=>{
 const sequence=sequenceFromBasicParts({columns:'crossed',left:'normal',right:'shuffle',roles:'alternate',shortHand:1});
 sequence.allowBallContact=true;api.clearSyncSegments();
 const fixture=JSON.parse(readFileSync('test/fixtures/cross-generated-events.json','utf8').replace(/^\uFEFF/,''));
 const config=compileSequence(sequence).config!,v=fixture.values,timing:[number,number]=[v[12],v[13]];
 api.options.siteswap.syncBox=config;
 expect(juggling.setPattern(config.siteswap,{...new Options().siteswap,syncBox:config,props:[{type:'ball',color:'red',radius:.035,C:.9}]}).ok).toBe(true);
 const initial=juggling.replanSyncMovement([],[0,0],timing,0,fixture.flights);
 const movement=initial.transitions.map(s=>{const at=15+2*(s.hand*2+(s.kind==='carry'?1:0));
  return {hand:s.hand,from:s.from,offset:[0,v[at],v[at+1]] as [number,number,number]};});
 const tracks=juggling.replanSyncMovement(movement,[0,0],timing,0,fixture.flights);tracks.constraintPlanned=true;
 expect(juggling.getSyncBoxReport()!.geometryOK).toBe(true);
 expect(body.prepareSyncCycle(p=>{juggling.seek(p);return juggling.update(0);},tracks.period)).toBe(true);
 expect(api.inspectSyncCycle().skeletonOK).toBe(true);
 const source=juggling.captureSyncMotion();
 const registered=api.registerSyncSegments(sequence.name,sequence);
 const document=api.exportSyncSegments(registered.ids);
 expect(document.sources[0].resolved).toBeDefined();
 const restored=api.restoreSyncSegments(JSON.parse(JSON.stringify(document)));
 api.playSyncSegments(restored.ids);
 const replay=juggling.activeSyncReplay!;
 for(let i=0;i<240;i++){
  const a=source.sample(i/240*source.period),b=replay.sample(i/240*source.period);
  for(let h=0;h<2;h++)expect(a.hands[h].position.distanceTo(b.hands[h].position)).toBeLessThan(1e-7);
  a.ballPositions!.forEach((p,k)=>expect(p.distanceTo(b.ballPositions![k])).toBeLessThan(1e-7));
 }
 expect(api.inspectSyncCycle().skeletonOK).toBe(true);
 const normal=sequenceFromBasicParts({columns:'normal',left:'normal',right:'normal',roles:'alternate',shortHand:1});normal.allowBallContact=true;
 api.registerSyncSequence(normal);
 const originalSources=api.exportSyncSegments(api.syncReplaySources[0].ids).sources;
 if(process.env.SYNC_GENERATED_TRANSITION_AUDIT){
  const setSequence=api.setSyncSequence.bind(api);let attempt=0;
  api.setSyncSequence=(s:any,...args:any[])=>{
   const n=++attempt,start=Date.now();console.info(`Transition candidate ${n}: ${s.sets.length} sets`);
   const result=setSequence(s,...args);console.info(`Transition candidate ${n}: ${result.ok?'accepted':'rejected'} in ${Date.now()-start} ms`);return result;
  };
 }
 const connection=api.registerSyncTransition(0,1);expect(connection.forward.length).toBeGreaterThan(0);
 const before=api.exportSyncSegments(connection.route,'generated cross transition');
 expect(before.sources.slice(0,2)).toEqual(originalSources);
 api.playSyncSegments(connection.route);const skeleton=api.inspectSyncCycle();expect(skeleton.skeletonOK).toBe(true);
 const loaded=api.restoreSyncSegments(JSON.parse(JSON.stringify(before)));
 api.playSyncSegments(loaded.ids);expect(api.inspectSyncCycle().skeletonOK).toBe(true);
 const after=api.exportSyncSegments(loaded.ids,'generated cross transition');
 expect(after.sources.slice(0,2)).toEqual(before.sources.slice(0,2));
 const prepare=body.prepareSyncCycle;body.prepareSyncCycle=()=>{throw new Error('An accepted connection must be reused');};
 try{
  const reused=api.registerSyncTransition(0,1);expect(reused.added).toBe(false);
  api.playSyncSegments([...reused.route,...reused.route]);
  expect(api.inspectSyncCycle().skeletonOK).toBe(true);
 }finally{body.prepareSyncCycle=prepare;}
 if(process.env.SYNC_GENERATED_TRANSITION_AUDIT){
  writeFileSync(process.env.SYNC_GENERATED_TRANSITION_AUDIT,JSON.stringify({connection,skeleton,restored:true,reused:true},null,2));
  writeFileSync(process.env.SYNC_GENERATED_TRANSITION_AUDIT.replace(/\.json$/,'-route.json'),JSON.stringify(before,null,2));
 }
},1200000);
