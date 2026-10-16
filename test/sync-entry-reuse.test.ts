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
  if(process.env.SYNC_ENTRY_AUDIT_PATH)writeFileSync(process.env.SYNC_ENTRY_AUDIT_PATH,JSON.stringify(reports,null,2));
  juggling?.dispose();
});
const pose=(frame:any):number[]=>[
  ...frame.ballPositions.flatMap((v:THREE.Vector3)=>v.toArray()),
  ...frame.fixedElbows.flatMap((v:THREE.Vector3)=>v.toArray()),
  ...frame.hands.flatMap((h:any)=>[...h.position.toArray(),...h.palmNormal.toArray(),...h.fingerDir.toArray(),Number(h.holding)]),
];

it.each([false,true])('開始セット別の往復を実測し、元の姿勢・球の対応を保って選択した入口を再利用する (mirror=%s)',mirror=>{
  const api:any=Object.create(VRMJuggler.prototype);
  Object.assign(api,{body,juggling,vrm,options:new Options(),paused:true,avatarTop:1.7,showGui:false,
    syncReplayGraph:new SyncReplayGraph(),syncReplaySources:[],renderer:{frameHeight:()=>{}},updateGui:()=>{},emitState:()=>{}});
  const ids=['box','box-roll'].map(name=>{
    const s=sequenceFromPreset(name);s.beatDuration=.25;return api.registerSyncSequence(s,mirror).ids as number[];
  });
  const before=api.getSyncSourceConnections(0);
  expect(before.connectedStarts).toBeLessThan(before.totalStarts);
  const missing=before.sources.flatMap((s:any)=>s.starts.filter((p:any)=>p.forwardSets===null).map((p:any)=>({source:s.index,start:p.startSet})));
  expect(missing.length).toBeGreaterThan(0);
  expect(()=>api.appendSyncSource(ids[0],missing[0].source,1,missing[0].start)).toThrow('移行がまだありません');
  api.registerSyncTransition(0,1);
  const saved=api.exportSyncSegments(ids[0],'元の動作'),prepare=body.prepareSyncCycle;
  const phases:any[]=[];let closed:number[]=[],construction:any;
  body.prepareSyncCycle=()=>{throw new Error('開始セットの選択で腕を再探索してはいけません');};
  try{
    expect(api.describeSyncSegments([])).toMatchObject({routeSets:0,identitySets:null});
    expect(api.describeSyncSegments(ids[0].slice(0,1)).code).toMatch(/^3B-R1-Cpending-/);
    expect(api.describeSyncSegments(ids[0]).code).toMatch(/^3B-R2-C2-/);
    const report=api.getSyncSourceConnections(0);
    expect(report.sources).toHaveLength(2);expect(report.totalStarts).toBe(ids.flat().length);
    expect(report.connectedStarts).toBe(report.totalStarts);
    for(const s of report.sources){
      const original=api.syncReplayGraph.compose(ids[s.index]);
      for(const start of s.starts){
        const appended=api.appendSyncSource(ids[0],s.index,1,start.startSet);
        expect(appended.bridge.length).toBe(start.forwardSets);
        const returning=api.syncReplayGraph.connect(appended.ids.at(-1),ids[0][0]);
        expect(returning.length).toBe(start.returnSets);
        expect(start.endSet).toBe((start.startSet+ids[s.index].length-1)%ids[s.index].length);
        const cycle=api.syncReplayGraph.compose([...appended.ids,...returning]);
        expect(body.validateSyncReplay(cycle.sample,cycle.period)).toBe(true);
        const rotated=api.syncReplayGraph.compose(api.appendSyncSource([],s.index,1,start.startSet).ids);
        expect(rotated.period).toBe(original.period);
        for(let i=0;i<24;i++){
          const time=(i+.37)/24*rotated.period,actual=pose(rotated.sample(time)),expected=pose(original.sample(time+start.startSet*.5));
          actual.forEach((v:number,j:number)=>expect(v).toBeCloseTo(expected[j],8));
        }
        phases.push({source:s.name,...start,sets:cycle.sets,identitySets:cycle.sets*cycle.identityRepeats});
      }
    }
    for(const invalid of [-1,ids[1].length,.5,NaN,Infinity])expect(()=>api.appendSyncSource(ids[0],1,1,invalid)).toThrow('開始セット');
    expect(api.appendSyncSource([],1).ids).toEqual(ids[1]);
    const twice=api.appendSyncSource([],1,2,2),once=api.appendSyncSource([],1,1,2);
    expect(twice.ids).toEqual([...once.ids,...once.ids]);
    expect(()=>api.appendSyncSource(ids[0],1,16,2)).toThrow('128セット');
    let route=api.appendSyncSource([],1,1,2).ids;
    route=api.appendSyncSource(route,0,1,1).ids;
    route=api.appendSyncSource(route,1,1,5).ids;
    closed=api.closeSyncSegments(route);
    const replay=api.syncReplayGraph.compose(closed);expect(body.validateSyncReplay(replay.sample,replay.period)).toBe(true);
    construction=api.describeSyncSegments(closed);
    expect(construction).toMatchObject({routeSets:38,identitySets:114});expect(construction.code).toMatch(/^3B-R38-C114-/);
    expect(api.describeSyncSegments(api.appendSyncSource([],1,1,2).ids).contentId).not.toBe(api.describeSyncSegments(ids[1]).contentId);
    expect(api.exportSyncSegments(ids[0],'元の動作')).toEqual(saved);
  }finally{body.prepareSyncCycle=prepare;}
  const document=api.exportSyncSegments(closed,'開始位置を変えた列'),original=api.syncReplayGraph.compose(closed);
  const poses=Array.from({length:240},(_,i)=>pose(original.sample(i/240*original.period)));
  const restored=api.restoreSyncSegments(JSON.parse(JSON.stringify(document))),replay=api.syncReplayGraph.compose(restored.ids);
  expect(api.exportSyncSegments(restored.ids,'開始位置を変えた列')).toEqual(document);
  expect(api.describeSyncSegments(restored.ids)).toEqual(construction);
  expect(replay.period).toBe(original.period);
  expect(Array.from({length:240},(_,i)=>pose(replay.sample(i/240*replay.period)))).toEqual(poses);
  reports.push({mirror,phases,armSearchesDuringReuse:0,sourceDefinitionsUnchanged:true,
    savedCycleSets:replay.sets,savedIdentitySets:replay.sets*replay.identityRepeats,restoredPoseSamplesUnchanged:240,
    constructionCode:construction.code,constructionRestored:true});
},120000);
