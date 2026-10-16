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
import {sequenceFromPreset} from '../src/motion/juggling/sync-sequence';

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
  if(process.env.SYNC_FAILURE_AUDIT_PATH)writeFileSync(process.env.SYNC_FAILURE_AUDIT_PATH,JSON.stringify(reports,null,2));
  juggling?.dispose();
});

it.each([false,true])('拒否したクロスの間隔不足・経路不足を区別し、復元したプレビューの値に置き換えない (mirror=%s)',mirror=>{
  const api:any=Object.create(VRMJuggler.prototype);
  Object.assign(api,{body,juggling,vrm,options:new Options(),paused:true,avatarTop:1.7,showGui:false,
    syncReplayGraph:new SyncReplayGraph(),syncReplaySources:[],renderer:{frameHeight:()=>{}},updateGui:()=>{},emitState:()=>{}});
  const base=sequenceFromPreset('box');expect(api.setSyncSequence(base,mirror).ok).toBe(true);
  const original=api.registerSyncSequence(base,mirror),saved=api.exportSyncSegments(original.ids,'残す列');
  const snapshot=()=>{
    const source=juggling.captureSyncMotion(),arms=body.captureSyncArmMotion();
    return Array.from({length:240},(_,i)=>{
      const f=source.sample(i/240*source.period);
      return [...f.ballPositions!.flatMap(v=>v.toArray()),...arms(f).flatMap(v=>v.toArray()),
        ...f.hands.flatMap(h=>[...h.position.toArray(),...h.palmNormal.toArray(),...h.fingerDir.toArray()])];
    });
  };
  const before=snapshot(),preview=juggling.getMotionSnapshot();
  const compact=sequenceFromPreset('crossed');
  for(const row of compact.sets){
    const short=row.throws[0]==='2x'?0:1,d=row.motion.shortMotions![0].definition!,column=row.motion.columnMotion!;
    row.motion.short=[short===0?'shuffle':'normal'];if(short===0)d.release.y+=.18;
    for(const p of [d.release,d.catch,column.release,column.catch]){p.z+=.12;p.y-=.04;}
  }
  const rejected=api.setSyncSequence(compact,mirror);expect(rejected.ok).toBe(false);
  const issue=rejected.failure.issues[0];
  expect(issue).toMatchObject({kind:'arm-path',armConstraint:'arm-spacing',armClearance:{required:.08},location:{rowIndex:0}});
  expect(issue.armClearance.sampledMaximum).toBeGreaterThan(.06);expect(issue.armClearance.sampledMaximum).toBeLessThan(.07);
  expect(issue.phase).toBeGreaterThan(.3);expect(issue.phase).toBeLessThan(.4);
  expect(juggling.getMotionSnapshot()).toEqual(preview);expect(snapshot()).toEqual(before);
  // Inject a path-search failure into an otherwise valid layout to test the
  // diagnostic and rollback contract without declaring a real technique
  // impossible merely because an older search could not construct it.
  const prepare=body.prepareSyncCycle;
  body.prepareSyncCycle=()=>{body.syncPlanInfo={reason:'no-continuous-path',phase:.5};return false;};
  let continuity:any;
  try{continuity=api.setSyncSequence(base,mirror,true);}finally{body.prepareSyncCycle=prepare;}
  expect(continuity.ok).toBe(false);expect(continuity.failure.issues[0].armConstraint).toBe('continuity');
  expect(continuity.failure.issues[0].armClearance).toBeUndefined();
  expect(snapshot()).toEqual(before);expect(api.exportSyncSegments(original.ids,'残す列')).toEqual(saved);
  reports.push({mirror,rejectedSpacing:issue,rejectedContinuity:continuity.failure.issues[0],restoredPoseSamplesUnchanged:240,registryUnchanged:true});
},30000);
