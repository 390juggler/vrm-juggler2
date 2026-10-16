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
const reports:any[]=[];afterAll(()=>{if(process.env.SYNC_CROSS_AUDIT_PATH)writeFileSync(process.env.SYNC_CROSS_AUDIT_PATH,JSON.stringify(reports,null,2));juggling?.dispose();});

const styles=['normal','shuffle','reverse','inverted'] as const;
const cases=(['crossed','crossed-right'] as const).flatMap(columns=>styles.flatMap(left=>styles.flatMap(right=>[false,true].map(mirror=>({columns,left,right,mirror})))));
it.each(cases)('$columns / $left / $right (mirror=$mirror) has a connected arm cycle and preserves relative passes',({columns,left,right,mirror})=>{
 const sequence=sequenceFromBasicParts({columns,left,right,roles:'alternate',shortHand:1});sequence.allowBallContact=true;
 const original=JSON.stringify(sequence),start=Date.now(),result=api.setSyncSequence(sequence,mirror);
 expect(result.ok,JSON.stringify(result.failure)).toBe(true);expect(JSON.stringify(sequence)).toBe(original);
 const geometry=juggling.getSyncBoxReport()!,skeleton=api.inspectSyncCycle();
 reports.push({columns,left,right,mirror,milliseconds:Date.now()-start,geometry,skeleton});
 expect(geometry.geometryOK).toBe(true);expect(geometry.ballOrderChecks).toBeGreaterThan(0);expect(geometry.ballOrderOK).toBe(true);
 expect(skeleton.skeletonOK,JSON.stringify(skeleton)).toBe(true);
},120000);
