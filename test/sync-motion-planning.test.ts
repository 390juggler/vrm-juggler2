import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
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

it('persists generated cross events and replays them without another free-event search',()=>{
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
},30000);

const styles=['normal','shuffle','reverse','inverted'] as const;
it.each((['normal','switched','underarm'] as const).flatMap(columns=>styles.flatMap(left=>styles.map(right=>({columns,left,right})))))
('generates $columns / $left / $right from relative passages and hand movements',({columns,left,right})=>{
 const sequence=sequenceFromBasicParts({columns,left,right,roles:'alternate',shortHand:1});
 const before=JSON.stringify(sequence),result=api.setSyncSequence(sequence);
 expect(result.ok,JSON.stringify(result.failure)).toBe(true);expect(JSON.stringify(sequence)).toBe(before);
 const tracks=juggling.getSyncMovement()!,report=juggling.getSyncBoxReport()!;
 expect(report.geometryOK).toBe(true);expect(body.hasPlannedSyncCycle).toBe(true);
 for(const f of tracks.flights.filter(f=>f.value===2)){
  if(columns==='switched')expect(f.ballOrder).toHaveLength(2);
  for(const c of f.ballOrder||[]){
   const t=c.at*f.duration,y=f.start.y+f.velocity.y*t-9.8*t*t/2;
   expect((y-c.height)*(c.above?1:-1)).toBeGreaterThan(.0849);
  }
 }
},20000);

it.each([false,true])('moves the held hand without bending a flight; restores and reuses the solved cycle (mirror=%s)',mirror=>{
 const sequence=sequenceFromBasicParts({columns:'switched',left:'inverted',right:'shuffle',roles:'alternate',shortHand:1});
 expect(api.setSyncSequence(sequence,mirror).ok).toBe(true);
 const solved=juggling.getSyncMovement()!,restore=juggling.capturePlaybackRestore();
 expect(solved.movement.length).toBeGreaterThan(0);
 const initial=juggling.replanSyncMovement([]);
 solved.flights.forEach((f,i)=>{
  const g=initial.flights[i];expect(f.start.toArray()).toEqual(g.start.toArray());expect(f.end.toArray()).toEqual(g.end.toArray());
  expect(f.velocity.toArray()).toEqual(g.velocity.toArray());expect(f.duration).toBe(g.duration);
 });
 let heldMoved=false;
 solved.props.forEach((track,p)=>track.forEach((v,k)=>{
  if(solved.inAir[p][k])expect(v.distanceTo(initial.props[p][k])).toBeLessThan(1e-12);
  else if(v.distanceTo(initial.props[p][k])>.001)heldMoved=true;
 }));
 expect(heldMoved).toBe(true);restore();
 api.clearSyncSegments();const registered=api.registerSyncSequence(sequence,mirror);
 const ids=Array.from({length:6},()=>registered.ids).flat();
 const document=api.exportSyncSegments(ids,'repeated solved movement');
 const rebuild=api.restoreSyncSegments(document);expect(rebuild.ids).toHaveLength(ids.length);
 const prepare=body.prepareSyncCycle;
 body.prepareSyncCycle=()=>{throw new Error('Reuse must not search the arms again');};
 try{api.playSyncSegments(rebuild.ids);expect(api.analyzeSyncSegments(rebuild.ids).sets).toBe(ids.length);}
 finally{body.prepareSyncCycle=prepare;}
},30000);

it('generates intermediate throw positions for previously unnamed states',()=>{
 const a=sequenceFromBasicParts({columns:'switched',left:'inverted',right:'shuffle',roles:'alternate',shortHand:1});
 const b=structuredClone(a);b.name='A new boundary, not a preset';
 for(const r of b.sets){
  const c=r.motion.columnMotion!;c.release.x-=.015;c.catch.x-=.015;
  const s=r.motion.shortMotions![0].definition!;s.release.x+=.025;s.catch.x-=.025;
 }
 const input=JSON.stringify([a,b]),bridge=movementStateTransition(a,b,2)!;
 expect(bridge).toBeDefined();expect(bridge.sets.some(s=>s.motion.transition)).toBe(true);
 expect(JSON.stringify([a,b])).toBe(input);
 const result=api.setSyncSequence(bridge);expect(result.ok,JSON.stringify(result.failure)).toBe(true);
 expect(juggling.getSyncBoxReport()!.geometryOK).toBe(true);
 api.clearSyncSegments();api.registerSyncSequence(a);api.registerSyncSequence(b);
 const connection=api.registerSyncTransition(0,1);
 expect(connection.added).toBe(true);expect(connection.forward.length).toBeGreaterThan(0);
 expect(api.analyzeSyncSegments(connection.route).sets).toBe(connection.route.length);
},30000);

it.each([false,true])('connects Normal Box and Switched mixed passes without editing either registered state (mirror=%s)',mirror=>{
 const a=sequenceFromBasicParts({columns:'normal',left:'normal',right:'normal',roles:'alternate',shortHand:1});
 const b=sequenceFromBasicParts({columns:'switched',left:'inverted',right:'shuffle',roles:'alternate',shortHand:1});
 api.clearSyncSegments();const first=api.registerSyncSequence(a,mirror),second=api.registerSyncSequence(b,mirror);
 const before=[first,second].map(r=>api.syncReplayGraph.sourceTracks(r.ids[0]));
 const connection=api.registerSyncTransition(0,1);
 expect(connection.added).toBe(true);expect(connection.forward.length).toBeGreaterThan(0);expect(connection.backward.length).toBeGreaterThan(0);
 const after=[first,second].map(r=>api.syncReplayGraph.sourceTracks(r.ids[0]));
 for(let i=0;i<2;i++)expect(after[i].props).toEqual(before[i].props);
 const generated=api.syncReplayGraph.sourceTracks(api.syncReplaySources[2].ids[0]);
 expect(generated.flightAdjustments.length).toBeGreaterThan(0);
 for(const adjustment of generated.flightAdjustments){
  const row=Math.floor(adjustment.release/(2*a.beatDuration))%generated.config.sets!.length;
  expect(generated.config.sets![row].transition).toBe(true);
 }
 const document=api.exportSyncSegments(connection.route,'Normal to Switched and back');
 const restored=api.restoreSyncSegments(document);
 expect(api.analyzeSyncSegments(restored.ids).sets).toBe(restored.ids.length);
 const prepare=body.prepareSyncCycle;body.prepareSyncCycle=()=>{throw new Error('A checked transition must be reusable');};
 try{api.playSyncSegments([...restored.ids,...restored.ids]);}finally{body.prepareSyncCycle=prepare;}
},90000);

it.each([false,true])('solves coupled column and carry constraints for a high crossed catch (mirror=%s)',mirror=>{
 const sequence=sequenceFromBasicParts({columns:'crossed',left:'normal',right:'reverse',roles:'alternate',shortHand:1});
 const before=JSON.stringify(sequence),result=api.setSyncSequence(sequence,mirror);
 expect(result.ok,JSON.stringify(result.failure)).toBe(true);expect(JSON.stringify(sequence)).toBe(before);
 const tracks=juggling.getSyncMovement()!;
 expect(tracks.flightAdjustments.length).toBeGreaterThan(0);expect(tracks.movement.length).toBeGreaterThan(0);
 expect(juggling.getSyncBoxReport()!.geometryOK).toBe(true);expect(body.hasPlannedSyncCycle).toBe(true);
 for(const f of tracks.flights.filter(f=>f.value===2)){
  expect(f.ballOrder).toHaveLength(2);
  for(const c of f.ballOrder!){
   const t=c.at*f.duration,y=f.start.y+f.velocity.y*t-9.8*t*t/2;
   expect((y-c.height)*(c.above?1:-1)).toBeGreaterThan(.0849);
  }
 }
},20000);

it('permits ball contact in a reusable transition while keeping full arm validation and saved policy',()=>{
 const a=sequenceFromBasicParts({columns:'normal',left:'normal',right:'normal',roles:'alternate',shortHand:1});
 const b=sequenceFromBasicParts({columns:'switched',left:'inverted',right:'shuffle',roles:'alternate',shortHand:1});
 a.allowBallContact=b.allowBallContact=true;
 api.clearSyncSegments();api.registerSyncSequence(a);api.registerSyncSequence(b);
 const connection=api.registerSyncTransition(0,1),played=api.playSyncSegments(connection.route);
 expect(played.ballContactAllowed).toBe(true);expect(played.ballContact).toBe(true);
 expect(played.minBallDistance).toBeLessThan(.07);
 const document=api.exportSyncSegments(connection.route,'contact permitted');
 expect(document.sources.every((s:any)=>s.sequence.allowBallContact===true)).toBe(true);
 const restored=api.restoreSyncSegments(JSON.parse(JSON.stringify(document)));
 const replay=api.playSyncSegments(restored.ids);
 expect(replay.ballContact).toBe(true);expect(replay.minBallDistance).toBeCloseTo(played.minBallDistance,8);
 expect(api.inspectSyncCycle().skeletonOK).toBe(true);
 const invalid=structuredClone(a);
 invalid.sets.forEach(r=>{r.motion.columnMotion={release:{x:.19,y:1.4,z:-.3},catch:{x:.19,y:1.4,z:-.3},passage:{at:.5},carry:{route:'direct',amount:0}};});
 expect(api.setSyncSequence(invalid,false,true).ok).toBe(false);
},30000);
