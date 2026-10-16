import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {VRMLoaderPlugin,VRM,VRMUtils} from '@pixiv/three-vrm';
import Body from '../src/motion/body';
import Juggling from '../src/motion/juggling';
import Options from '../src/options';
import VRMJuggler from '../src/index';
import {SyncReplayGraph} from '../src/motion/juggling/sync-replay';
import {SYNC_BOX_PRESETS,SYNC_DWELL,SYNC_RADIUS} from '../src/motion/juggling/sync-box';
import {pointSegmentDistance,segmentDistance,underForearm,armCenterHeight} from '../src/motion/inspection';
import type {ShortStyle} from '../src/motion/juggling/sync-motion';
import type {SyncBoxConfig} from '../src/motion/juggling/sync-box';
import {SEQUENCE_EXAMPLES,compileSequence,sequenceFromPreset,sequenceFromBasicParts,sequenceFromDoubleParts,extractSequenceSet,connectSequenceCycles,BasicShortStyle} from '../src/motion/juggling/sync-sequence';

// Load the real bundled avatar's skeleton, skin and rest transforms. Textures are
// irrelevant to IK; GPU appearance is verified separately in the running browser.
let body:Body,juggling:Juggling,vrm:VRM,api:VRMJuggler;
const reports:unknown[]=[];
beforeAll(async()=>{
  const loader=new GLTFLoader();
  loader.register(()=>({name:'TEST_TEXTURES',loadTexture:()=>Promise.resolve(new THREE.Texture())}));
  loader.register(parser=>new VRMLoaderPlugin(parser));
  const file=readFileSync('dist/models/default.vrm');
  const gltf=await loader.parseAsync(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength),'');
  vrm=gltf.userData.vrm;VRMUtils.removeUnnecessaryVertices(gltf.scene);VRMUtils.combineSkeletons(gltf.scene);
  const scene=new THREE.Scene();scene.add(vrm.scene);
  body=new Body(vrm,scene);body.motionAmount=0;
  juggling=new Juggling(scene,'3',new Options().siteswap);juggling.setAvatarMetrics(body.metrics);
  api=Object.create(VRMJuggler.prototype);
  Object.assign(api,{body,juggling,vrm,options:new Options(),paused:true,avatarTop:1.7,showGui:false,
    syncReplayGraph:new SyncReplayGraph(),syncReplaySources:[],renderer:{frameHeight:()=>{}},updateGui:()=>{},emitState:()=>{}});
},20000);
afterAll(()=>{
  if(process.env.SYNC_AUDIT_PATH)writeFileSync(process.env.SYNC_AUDIT_PATH,JSON.stringify(reports,null,2));
  juggling?.dispose();
});

it('不成立の配置と補間区間では、制約なしの腕へフォールバックしない',()=>{
  const config=SYNC_BOX_PRESETS[0];
  juggling.setPattern(config.siteswap,{...new Options().siteswap,syncBox:config,dwellRatio:SYNC_DWELL,
    props:[{type:'ball',color:'red',radius:SYNC_RADIUS,C:.9}]});
  const sample=(phase:number)=>{juggling.seek(phase);return juggling.update(0);};
  const period=juggling.getMotionSnapshot().period;
  expect(body.prepareSyncCycle(sample,period)).toBe(true);
  body.update(sample(0),0);vrm.update(0);
  const safe=body.getArmPose();
  const impossible=(phase:number)=>{
    const f=sample(phase);
    f.hands[0].position.set(0,1.2,.02);
    return f;
  };
  expect(body.prepareSyncCycle(impossible,period)).toBe(false);
  for(const phase of [0,.25,.5,.75])body.update(impossible(phase),0);
  vrm.update(0);
  expect(body.getArmPose()).toEqual(safe);
  // Deliberately invalid only BETWEEN the 120 key poses.
  expect(body.prepareSyncCycle(p=>Math.abs(p-1/480)<1e-7?impossible(p):sample(p),period)).toBe(false);
  // At denser retry resolution the same invalid intermediate pose is a key.
  expect(['unsafe-interpolation','no-feasible-pose']).toContain(body.syncPlanInfo.reason);
  expect(body.prepareSyncCycle(sample,period)).toBe(true);
  body.update(sample(0),0);vrm.update(0);
  const restored=body.getArmPose();
  body.update(impossible(.25),0);vrm.update(0);
  expect(body.hasPlannedSyncCycle).toBe(false);
  expect(body.syncPlanInfo.reason).toBe('unsafe-playback-pose');
  expect(body.getArmPose()).toEqual(restored);
});

const styles:ShortStyle[]=['normal','shuffle','reverse','inverted'];
it('均等な計算点の間にある腕の下の指定も、正確な時刻で検査する',()=>{
  const config=SYNC_BOX_PRESETS[0];
  juggling.setPattern(config.siteswap,{...new Options().siteswap,syncBox:config,dwellRatio:SYNC_DWELL,
    props:[{type:'ball',color:'red',radius:SYNC_RADIUS,C:.9}]});
  const eventPhase=.237,period=juggling.getMotionSnapshot().period;
  const sample=(phase:number)=>{
    juggling.seek(phase);const frame=juggling.update(0);
    return {...frame,constraintPhases:[eventPhase],underarm:Math.abs(phase-eventPhase)<1e-8?[{hand:0,position:new THREE.Vector3(3,3,3)}]:[]};
  };
  expect(body.prepareSyncCycle(sample,period)).toBe(false);
  expect(body.syncPlanInfo.reason).toBe('no-feasible-pose');
  expect(body.syncPlanInfo.phase).toBeCloseTo(eventPhase,9);
});
const combinations:SyncBoxConfig[]=styles.flatMap(a=>styles.map(b=>({...SYNC_BOX_PRESETS[0],id:`basic-${a}-${b}`,short:[a,b]})));
const sequences=SEQUENCE_EXAMPLES.map((s,i)=>({...compileSequence(s).config!,id:`sequence-${i}`}));
const doubleParts=(styles as BasicShortStyle[]).flatMap(crossSet=>(styles as BasicShortStyle[]).map(selfSet=>({
  ...compileSequence(sequenceFromDoubleParts({crossSet,selfSet})).config!,id:`double-parts-${crossSet}-${selfSet}`
})));
const doubleCatchParts=(['underhand','overhand'] as const).flatMap(crossCatchGrip=>(['underhand','overhand'] as const).map(selfCatchGrip=>({
  ...compileSequence(sequenceFromDoubleParts({crossSet:'reverse',selfSet:'reverse',crossCatchGrip,selfCatchGrip})).config!,id:`double-catch-${crossCatchGrip}-${selfCatchGrip}`
})));
const alternateSource=sequenceFromPreset('crossed-alternate');
const importedCross={...compileSequence({...alternateSource,sets:[extractSequenceSet(alternateSource,1),extractSequenceSet(alternateSource,0)]}).config!,id:'imported-cross-second-first'};
const switchedMixed=[['normal','reverse'],['reverse','normal']].map(([left,right])=>({
  ...compileSequence(sequenceFromBasicParts({columns:'switched',left:left as BasicShortStyle,right:right as BasicShortStyle,roles:'alternate',shortHand:1})).config!,id:`switched-parts-${left}-${right}`
}));
const routedParts=(['switched','underarm','crossed-alternate','crossed','crossed-right'] as const).flatMap(columns=>(['normal','shuffle','reverse','inverted'] as BasicShortStyle[]).flatMap(left=>(['normal','shuffle','reverse','inverted'] as BasicShortStyle[]).flatMap(right=>{
  const added=columns==='crossed'?left==='normal'&&right==='reverse':columns==='crossed-right'?left==='reverse'&&right==='normal':
    columns==='switched'?left!==right&&![left,right].every(s=>s==='normal'||s==='reverse'):
    columns==='underarm'?(left!=='normal'||right!=='normal'):
    [left,right].every(v=>v==='normal'||v==='inverted')&&(left==='inverted'||right==='inverted');
  return added?[{...compileSequence(sequenceFromBasicParts({columns,left,right,roles:'alternate',shortHand:1})).config!,id:`routed-parts-${columns}-${left}-${right}`}]:[];
})));
it.each([false,true])('Penmanの保持だけをクローに変えた干渉する経路を拒否する (mirror=%s)',mirror=>{
  const s=structuredClone(SEQUENCE_EXAMPLES[14]);
  for(const r of s.sets)r.throws.forEach((t,h)=>{if(t==='2'){r.motion.hands ||= [];r.motion.hands[h] ||= {};r.motion.hands[h]!.releaseGrip='overhand';}});
  const config={...compileSequence(s).config!,mirror};
  juggling.setPattern(config.siteswap,{...new Options().siteswap,syncBox:config,props:[{type:'ball',color:'red',radius:SYNC_RADIUS,C:.9}]});
  const period=juggling.getMotionSnapshot().period;
  expect(body.prepareSyncCycle(phase=>{juggling.seek(phase);return juggling.update(0);},period)).toBe(false);
  expect(body.syncPlanInfo.reason).toBe('no-feasible-pose');
});
const gripCases:SyncBoxConfig[]=['catch','release','both','hold'].map(kind=>{
  const s=kind==='hold'?sequenceFromPreset('box-roll'):structuredClone(SEQUENCE_EXAMPLES[0]);
  for(const row of s.sets)row.throws.forEach((t,h)=>{
    if(kind==='hold'&&t!=='2')return;
    row.motion.hands ||= [];row.motion.hands[h] ||= {};
    if(kind!=='catch')row.motion.hands[h]!.releaseGrip='overhand';
    if(kind==='catch'||kind==='both')row.motion.hands[h]!.catchGrip='overhand';
  });
  return {...compileSequence(s).config!,id:`grip-${kind}`};
});
const transferCases:SyncBoxConfig[]=(['normal','shuffle','reverse','inverted'] as BasicShortStyle[]).flatMap(style=>([0,1] as const).flatMap(shortHand=>{
  if(style==='normal'&&shortHand===0)return []; // Covered by sequence example 27.
  const fixed=sequenceFromBasicParts({roles:'fixed',left:style,right:style,shortHand});fixed.sets[0].repeat=3;
  const s=connectSequenceCycles(SEQUENCE_EXAMPLES[0],fixed).sequence!;
  return [{...compileSequence(s).config!,id:`transfer-${style}-${shortHand}`}];
}));
describe.each([...SYNC_BOX_PRESETS.flatMap(c=>[{...c,mirror:false},{...c,mirror:true}]),...combinations,
  ...[...sequences,...gripCases,...transferCases,...switchedMixed,...routedParts,...doubleParts,...doubleCatchParts,importedCross].flatMap(c=>[{...c,mirror:false},{...c,mirror:true}])])('$id (mirror=$mirror): 付属VRMの1周期',config=>{
  it('手と球が接続し、腕が干渉せず肘も連続する',()=>{
    const result=juggling.setPattern(config.siteswap,{...new Options().siteswap,syncBox:config,dwellRatio:SYNC_DWELL,
      props:[{type:'ball',color:'red',radius:SYNC_RADIUS,C:.9}]});
    expect(result.ok).toBe(true);
    let period=juggling.getMotionSnapshot().period;
    const sample=(phase:number)=>{juggling.seek(phase);return juggling.update(0);};
    let planned=body.prepareSyncCycle(sample,period);
    // Relative definitions are constraints for the production event planner.
    // Preserve the direct-path baseline whenever it already has a valid cycle;
    // otherwise exercise the same solver used by the UI before inspecting bones.
    const relative=[config,...(config.sets||[])].some(s=>s.shortMotions?.some(o=>o.ballOrder==='style')||
      ('hands' in s&&s.hands?.some(h=>h?.shortMotion?.ballOrder==='style')));
    if(!planned&&relative){
      const generated=api.setSyncBox(config);
      expect(generated.ok,JSON.stringify(generated)).toBe(true);
      planned=body.hasPlannedSyncCycle;period=juggling.getMotionSnapshot().period;
    }
    const count=Math.max(240,Math.ceil(period/.004));
    let grip=0,arm=Infinity,ball=Infinity,speed=0,orientationError=0;
    let armPhase=0,ballPhase=0,speedPhase=0,minCrossGap=Infinity,maxCrossGap=-Infinity;
    let previous:THREE.Vector3[]|undefined;
    let previousRotations:THREE.Quaternion[]|undefined;
    const angularSpeed=[0,0,0];let elbowOut=0,elbowRaise=-Infinity;
    let postureOK=true,torso=Infinity,behind=Infinity,side=Infinity,height=Infinity,wristBend=0,elbowFlex=0,posturePhase=0;
    for(let i=0;i<=count;i++){
      const frame=sample(i/count);body.update(frame,0);vrm.update(0);
      const poses=body.getArmPose(SYNC_RADIUS).map(p=>Object.fromEntries(Object.entries(p).map(([k,v])=>[k,new THREE.Vector3().fromArray(v)])) as Record<string,THREE.Vector3>);
      const rotations=['leftUpperArm','leftLowerArm','leftHand','rightUpperArm','rightLowerArm','rightHand'].map(name=>vrm.humanoid.getNormalizedBoneNode(name as any)!.getWorldQuaternion(new THREE.Quaternion()));
      rotations.forEach((q,j)=>{if(previousRotations)angularSpeed[j%3]=Math.max(angularSpeed[j%3],q.angleTo(previousRotations[j])/(period/count));});
      previousRotations=rotations;
      body.getArmPosture().forEach(p=>{
        if(!p.ok){postureOK=false;posturePhase=i/count;}
        torso=Math.min(torso,p.torso);behind=Math.min(behind,p.behind);side=Math.min(side,p.side);height=Math.min(height,p.height);
        wristBend=Math.max(wristBend,p.wristBend);elbowFlex=Math.max(elbowFlex,p.elbowFlex);
      });
      poses.forEach((p,h)=>{
        elbowOut=Math.max(elbowOut,Math.abs(p.elbow.x));elbowRaise=Math.max(elbowRaise,p.elbow.y-p.shoulder.y);
        grip=Math.max(grip,p.grip.distanceTo(frame.hands[h].position));
        orientationError=Math.max(orientationError,p.palmNormal.angleTo(frame.hands[h].palmNormal),p.fingerDir.angleTo(frame.hands[h].fingerDir));
        if(previous){const v=p.elbow.distanceTo(previous[h])/(period/count);if(v>speed){speed=v;speedPhase=i/count;}}
        frame.ballPositions!.forEach(b=>{const d=Math.min(pointSegmentDistance(b,p.shoulder,p.elbow),pointSegmentDistance(b,p.elbow,p.wrist.clone().lerp(p.elbow,.2)));if(d<ball){ball=d;ballPhase=i/count;}});
      });
      for(const a of [[poses[0].shoulder,poses[0].elbow],[poses[0].elbow,poses[0].wrist]])for(const b of [[poses[1].shoulder,poses[1].elbow],[poses[1].elbow,poses[1].wrist]]){
        const d=segmentDistance(a[0],a[1],b[0],b[1]);if(d<arm){arm=d;armPhase=i/count;}
      }
      previous=poses.map(p=>p.elbow);
      if(config.columns==='crossed'){
        const centers=poses.map(p=>{
          for(const [a,b] of [[p.elbow,p.wrist],[p.shoulder,p.elbow]])
            if(a.x*b.x<=0 && Math.abs(a.x-b.x)>1e-6)return a.clone().lerp(b,-a.x/(b.x-a.x));
          return null;
        });
        if(centers.every(Boolean)){const gap=centers[0]!.y-centers[1]!.y;minCrossGap=Math.min(minCrossGap,gap);maxCrossGap=Math.max(maxCrossGap,gap);}
      }
    }
    const relations:unknown[]=[],handoffOrders:number[]=[];
    for(const f of juggling.getSyncProgram()!.flights){
      for(const [kind,h] of [['release',f.hand],['catch',f.catchHand]] as const){
        const stage=f[kind];
        if(stage.relation!=='underarm' && !(config.armOrder==='alternate' && kind==='release' && f.value===2))continue;
        const frame=sample(stage.time/period);body.update(frame,0);vrm.update(0);
        const poses=body.getArmPose(SYNC_RADIUS).map(p=>Object.fromEntries(Object.entries(p).map(([k,v])=>[k,new THREE.Vector3().fromArray(v)])) as Record<string,THREE.Vector3>);
        if(stage.relation==='underarm'){
          const other=poses[1-h];relations.push({kind,hand:h,...underForearm(new THREE.Vector3().fromArray(stage.position),other.elbow,other.wrist)});
        }
        if(config.armOrder==='alternate') {
          const heights=poses.map(p=>armCenterHeight(p.shoulder,p.elbow,p.wrist));
          if(heights.every(y=>y!==null))handoffOrders.push(Math.sign(heights[0]!-heights[1]!));
        }
      }
    }
    const posture={ok:postureOK,torso,behind,side,height,wristBend,elbowFlex,phase:posturePhase};
    const report={id:config.id,mirror:config.mirror,planned,plan:body.syncPlanInfo,grip,orientationError,arm,ball,speed,angularSpeed,elbowOut,elbowRaise,armPhase,ballPhase,speedPhase,minCrossGap,maxCrossGap,relations,handoffOrders,posture};reports.push(report);
    expect(postureOK,JSON.stringify(report)).toBe(true);
    expect(planned && grip<.012 && arm>.065 && ball>.065 && speed<12,JSON.stringify(report)).toBe(true);
    expect(orientationError,JSON.stringify(report)).toBeLessThan(.001);
    expect(Math.max(...angularSpeed),JSON.stringify(report)).toBeLessThan(90);
    if(config.id==='switched'){
      expect(elbowOut,JSON.stringify(report)).toBeLessThan(.18);
      expect(elbowRaise,JSON.stringify(report)).toBeLessThan(-.20);
      expect(speed,JSON.stringify(report)).toBeLessThan(3.5);
      expect(Math.max(...angularSpeed),JSON.stringify(report)).toBeLessThan(35);
    }
    if(config.armOrder==='left-over' || config.armOrder==='right-over'){
      const leftAbove=(config.armOrder==='left-over')!==config.mirror;
      if(leftAbove)expect(minCrossGap,JSON.stringify(report)).toBeGreaterThan(.025);
      else expect(maxCrossGap,JSON.stringify(report)).toBeLessThan(-.025);
    }
    if(config.armOrder==='alternate'){
      expect(minCrossGap).toBeLessThan(-.035);expect(maxCrossGap).toBeGreaterThan(.035);
      expect(new Set(handoffOrders).size).toBe(2);
    }
    for(const r of relations as {horizontalDistance:number;verticalGap:number}[]){
      expect(r.horizontalDistance,JSON.stringify(report)).toBeLessThan(.085);
      expect(r.verticalGap,JSON.stringify(report)).toBeGreaterThan(.04);
    }
  },120000);
});
