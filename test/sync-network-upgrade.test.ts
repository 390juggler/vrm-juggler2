import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {VRMLoaderPlugin,VRM,VRMUtils} from '@pixiv/three-vrm';
import VRMJuggler from '../src/index';
import Body from '../src/motion/body';
import Juggling from '../src/motion/juggling';
import Options from '../src/options';
import {SyncReplayGraph} from '../src/motion/juggling/sync-replay';
import {sequenceFromPreset,SEQUENCE_EXAMPLES} from '../src/motion/juggling/sync-sequence';

let body:Body,juggling:Juggling,vrm:VRM;
const reports:any[]=[];
beforeAll(async()=>{
  const loader=new GLTFLoader();loader.register(()=>({name:'TEST_TEXTURES',loadTexture:()=>Promise.resolve(new THREE.Texture())}));
  loader.register(parser=>new VRMLoaderPlugin(parser));
  const file=readFileSync('dist/models/default.vrm'),gltf=await loader.parseAsync(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength),'');
  vrm=gltf.userData.vrm;VRMUtils.removeUnnecessaryVertices(gltf.scene);VRMUtils.combineSkeletons(gltf.scene);
  const scene=new THREE.Scene();scene.add(vrm.scene);body=new Body(vrm,scene);body.motionAmount=0;
  juggling=new Juggling(scene,'3',new Options().siteswap);juggling.setAvatarMetrics(body.metrics);
},20000);
afterAll(()=>{
  if(process.env.SYNC_UPGRADE_AUDIT_PATH)writeFileSync(process.env.SYNC_UPGRADE_AUDIT_PATH,JSON.stringify(reports,null,2));
  juggling?.dispose();
});

it.each([false,true])('保存済みの腕下5動作へ追加し、元の接続列と姿勢を保って11動作に拡張する (mirror=%s)',mirror=>{
  const api:any=Object.create(VRMJuggler.prototype);
  Object.assign(api,{body,juggling,vrm,options:new Options(),paused:true,avatarTop:1.7,showGui:false,
    syncReplayGraph:new SyncReplayGraph(),syncReplaySources:[],renderer:{frameHeight:()=>{}},updateGui:()=>{},emitState:()=>{}});
  const oldSources=[sequenceFromPreset('box'),sequenceFromPreset('reverse'),...[36,38,45].map(i=>structuredClone(SEQUENCE_EXAMPLES[i]))];
  oldSources.forEach(s=>{s.beatDuration=.25;api.registerSyncSequence(s,mirror);});
  for(const to of [1,2,3,4])api.registerSyncTransition(0,to);
  const originalRoute=api.closeSyncSegments([2,4,0].reduce((route:number[],index)=>api.appendSyncSource(route,index).ids,[]));
  const oldDocument=api.exportSyncSegments(originalRoute,'以前の腕下5動作');expect(oldDocument.sources).toHaveLength(9);
  const restored=api.restoreSyncSegments(JSON.parse(JSON.stringify(oldDocument))),before=api.syncReplayGraph.compose(restored.ids);
  const snapshot=(replay:any)=>Array.from({length:240},(_,i)=>{
    const f=replay.sample(i/240*replay.period);
    return {balls:f.ballPositions.map((v:THREE.Vector3)=>v.toArray()),elbows:f.fixedElbows.map((v:THREE.Vector3)=>v.toArray()),
      hands:f.hands.map((h:any)=>[...h.position.toArray(),...h.palmNormal.toArray(),...h.fingerDir.toArray(),h.holding])};
  });
  const poses=snapshot(before),batch=api.prepareSyncBasicNetwork(mirror,'hf-underarm');let step=batch.next();
  while(!step.done){
    expect(api.exportSyncSegments(restored.ids,'以前の腕下5動作')).toEqual(oldDocument);step=batch.next();
  }
  expect(step.value).toMatchObject({addedSources:6,addedTransitions:6,total:21});
  expect(step.value.sourceIndices.slice(0,5)).toEqual([0,1,2,3,4]);
  expect(step.value.sourceIndices.slice(5)).toEqual([9,10,11,12,13,14]);
  const after=api.syncReplayGraph.compose(restored.ids);
  expect(after.period).toBe(before.period);expect(snapshot(after)).toEqual(poses);
  expect(body.validateSyncReplay(after.sample,after.period)).toBe(true);
  expect(api.exportSyncSegments(restored.ids,'以前の腕下5動作').sources.slice(0,9)).toEqual(oldDocument.sources);
  expect(api.getSyncSourceConnections(0).connected).toBe(11);
  const extended=api.exportSyncSegments(restored.ids,'以前の腕下5動作'),again=api.restoreSyncSegments(JSON.parse(JSON.stringify(extended)));
  expect(api.exportSyncSegments(again.ids,'以前の腕下5動作')).toEqual(extended);
  expect(api.getSyncSourceConnections(0).connected).toBe(11);
  reports.push({mirror,oldSources:9,addedSources:6,addedTransitions:6,newSources:extended.sources.length,
    connectedMotions:11,oldCycleSets:after.sets,oldCyclePoseSamplesUnchanged:240,restoredAfterUpgrade:true});
},180000);
