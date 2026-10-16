import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {VRMLoaderPlugin,VRM,VRMUtils} from '@pixiv/three-vrm';
import Body from '../src/motion/body';
import Juggling,{JugglingFrame} from '../src/motion/juggling';
import Options from '../src/options';
import {SYNC_RADIUS} from '../src/motion/juggling/sync-box';
import {sequenceFromPreset,compileSequence,appendSequence,SyncSequence,SEQUENCE_EXAMPLES} from '../src/motion/juggling/sync-sequence';
import {SyncReplayGraph} from '../src/motion/juggling/sync-replay';
import {pointSegmentDistance,segmentDistance} from '../src/motion/inspection';

let body:Body,juggling:Juggling,vrm:VRM;
const reports:unknown[]=[];
beforeAll(async()=>{
  const loader=new GLTFLoader();
  loader.register(()=>({name:'TEST_TEXTURES',loadTexture:()=>Promise.resolve(new THREE.Texture())}));
  loader.register(parser=>new VRMLoaderPlugin(parser));
  const file=readFileSync('dist/models/default.vrm');
  const gltf=await loader.parseAsync(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength),'');
  vrm=gltf.userData.vrm;VRMUtils.removeUnnecessaryVertices(gltf.scene);VRMUtils.combineSkeletons(gltf.scene);
  const scene=new THREE.Scene();scene.add(vrm.scene);body=new Body(vrm,scene);body.motionAmount=0;
  juggling=new Juggling(scene,'3',new Options().siteswap);juggling.setAvatarMetrics(body.metrics);
},20000);
afterAll(()=>{if(process.env.SYNC_REPLAY_AUDIT_PATH)writeFileSync(process.env.SYNC_REPLAY_AUDIT_PATH,JSON.stringify(reports,null,2));juggling?.dispose();});

function prepare(sequence:SyncSequence,mirror=false){
  const compiled=compileSequence(sequence);expect(compiled.analysis.ok,JSON.stringify(compiled.analysis.issues)).toBe(true);
  const config={...compiled.config!,mirror};
  expect(juggling.setPattern(config.siteswap,{...new Options().siteswap,syncBox:config,
    props:[{type:'ball',color:'red',radius:SYNC_RADIUS,C:.9}]}).ok).toBe(true);
  const period=juggling.getMotionSnapshot().period;
  const sample=(phase:number)=>{juggling.seek(phase);return juggling.update(0);};
  expect(juggling.getSyncBoxReport()?.geometryOK).toBe(true);
  expect(body.prepareSyncCycle(sample,period)).toBe(true);
  body.update(sample(0),0);vrm.update(0);
  const source=juggling.captureSyncMotion(),arms=body.captureSyncArmMotion();
  const read=(time:number)=>{const frame=source.sample(time);return {...frame,fixedElbows:arms(frame)};};
  return {source,read,sample,period};
}

function inspect(read:(t:number)=>JugglingFrame,period:number){
  expect(body.validateSyncReplay(read,period)).toBe(true);
  const count=Math.ceil(period/.004);
  let arm=Infinity,ball=Infinity,grip=0,speed=0,angular=0;
  let previous:THREE.Vector3[]|undefined,rotations:THREE.Quaternion[]|undefined;
  for(let i=0;i<=count;i++){
    const frame=read(i/count*period);body.update(frame,0);vrm.update(0);
    expect(body.hasPlannedSyncCycle).toBe(true);
    expect(body.getArmPosture().every(p=>p.ok)).toBe(true);
    const poses=body.getArmPose(SYNC_RADIUS).map(p=>({shoulder:new THREE.Vector3().fromArray(p.shoulder),
      elbow:new THREE.Vector3().fromArray(p.elbow),wrist:new THREE.Vector3().fromArray(p.wrist),grip:new THREE.Vector3().fromArray(p.grip)}));
    poses.forEach((p,h)=>{
      grip=Math.max(grip,p.grip.distanceTo(frame.hands[h].position));
      if(previous)speed=Math.max(speed,p.elbow.distanceTo(previous[h])/(period/count));
      for(const b of frame.ballPositions!)ball=Math.min(ball,pointSegmentDistance(b,p.shoulder,p.elbow),pointSegmentDistance(b,p.elbow,p.wrist.clone().lerp(p.elbow,.2)));
    });
    for(const l of [[poses[0].shoulder,poses[0].elbow],[poses[0].elbow,poses[0].wrist]])
      for(const r of [[poses[1].shoulder,poses[1].elbow],[poses[1].elbow,poses[1].wrist]])arm=Math.min(arm,segmentDistance(l[0],l[1],r[0],r[1]));
    const now=['leftUpperArm','leftLowerArm','leftHand','rightUpperArm','rightLowerArm','rightHand'].map(n=>vrm.humanoid.getNormalizedBoneNode(n as any)!.getWorldQuaternion(new THREE.Quaternion()));
    if(rotations)now.forEach((q,j)=>angular=Math.max(angular,q.angleTo(rotations![j])/(period/count)));
    previous=poses.map(p=>p.elbow);rotations=now;
  }
  expect(grip).toBeLessThan(.012);expect(arm).toBeGreaterThan(.065);expect(ball).toBeGreaterThan(.065);
  expect(speed).toBeLessThan(12);expect(angular).toBeLessThan(90);
  reports.push({period,arm,ball,grip,speed,angular});
  return {arm,ball,grip,speed,angular};
}

it('実際の再生軌道と腕経路を保持し、別の列を準備しても変わらない',()=>{
  const captured=prepare(sequenceFromPreset('box'));
  for(let i=0;i<80;i++){
    const live=captured.sample(i/80);body.update(live,0);vrm.update(0);
    const frozen=captured.read(i/80*captured.period);
    live.hands.forEach((h,j)=>{
      expect(h.position.distanceTo(frozen.hands[j].position)).toBeLessThan(1e-9);
      expect(h.palmNormal.distanceTo(frozen.hands[j].palmNormal)).toBeLessThan(1e-9);
    });
    live.ballPositions!.forEach((p,j)=>expect(p.distanceTo(frozen.ballPositions![j])).toBeLessThan(1e-9));
    body.getArmPose().forEach((p,j)=>expect(new THREE.Vector3().fromArray(p.elbow).distanceTo(frozen.fixedElbows![j])).toBeLessThan(1e-8));
  }
  const before=captured.read(.123);
  prepare(sequenceFromPreset('inverted'));
  const after=captured.read(.123);
  expect(after).toEqual(before);
});

it('同じ状態に戻る接続部品を別の順序と回数で組み、元の腕経路を再計算しない',()=>{
  const captured=prepare(sequenceFromPreset('box')),graph=new SyncReplayGraph();
  let verified=0;
  const ids=graph.addCycle('Box',captured.source,captured.read,read=>{inspect(read,captured.period);verified++;return true;});
  expect(graph.summary.segments).toBe(2);
  const route=graph.compose([...ids,...ids,...ids]);
  expect(route.sets).toBe(6);expect(route.identityRepeats).toBe(1);
  const before=body.syncPlanInfo;
  inspect(route.sample,route.period);
  expect(body.syncPlanInfo).toBe(before);expect(verified).toBe(1);
  for(let i=0;i<83;i++){
    const time=i/83*route.period,a=route.sample(time),b=captured.read(time);
    a.fixedElbows!.forEach((p,h)=>expect(p.distanceTo(b.fixedElbows![h])).toBeLessThan(1e-8));
  }
  expect(()=>graph.compose([ids[0]])).toThrow('最後から先頭');
  expect(()=>graph.compose([ids[0],ids[0]])).toThrow('セット1から2');
  expect(graph.close([ids[0]])).toEqual(ids);
  expect(graph.close(ids)).toEqual(ids);
});

it('検査に落ちた動作・異なるテンポ・不明な部品は登録や接続に使わない',()=>{
  const captured=prepare(sequenceFromPreset('box')),graph=new SyncReplayGraph();
  expect(()=>graph.addCycle('失敗',captured.source,captured.read,()=>false)).toThrow('周期検査');
  expect(graph.summary).toEqual({states:0,segments:0});
  graph.addCycle('Box',captured.source,captured.read,()=>true);
  const before=graph.summary;
  expect(()=>graph.addCycle('別テンポ',{...captured.source,beatDuration:.3},captured.read,()=>true)).toThrow('テンポ');
  expect(graph.summary).toEqual(before);
  expect(()=>graph.compose([999])).toThrow('登録した');
  graph.clear();expect(graph.summary).toEqual({states:0,segments:0});
});

it('接続範囲は同じ技名でも境界状態が違う周期を分け、移行の上限を守る',()=>{
  const graph=new SyncReplayGraph(),a=prepare(sequenceFromPreset('box'));
  const first=graph.addCycle('同じ名前',a.source,a.read,read=>body.validateSyncReplay(read,a.period));
  const b=prepare(sequenceFromPreset('inverted'));
  const second=graph.addCycle('同じ名前',b.source,b.read,read=>body.validateSyncReplay(read,b.period));
  const before=graph.summary;
  for(const limit of [0,1,128]){
    const distances=graph.connectionDistances(first[0],first[1],limit);
    for(const edge of graph.choices()){
      const length=(from:number,to:number)=>{try{return graph.connect(from,to,limit).length;}catch{return null;}};
      expect(distances.outgoing[edge.id]).toBe(length(first[0],edge.id));
      expect(distances.incoming[edge.id]).toBe(length(edge.id,first[1]));
    }
    for(const id of second){expect(distances.outgoing[id]).toBeNull();expect(distances.incoming[id]).toBeNull();}
  }
  expect(graph.connectionDistances(first[0],first[1],0).outgoing[first[0]]).toBeNull();
  expect(graph.connectionDistances(first[0],first[1],1).outgoing[first[0]]).toBe(1);
  expect(graph.summary).toEqual(before);
  expect(()=>graph.connectionDistances(999,first[0])).toThrow('登録済み');
  expect(()=>graph.connectionDistances(first[0],first[0],129)).toThrow('移行セット数');
});

it.each([false,true])('異なる動作を含む2つの周期から、共有する状態を通って未登録の長い列を組む (mirror=%s)',mirror=>{
  const base=sequenceFromPreset('box');base.sets=Array.from({length:4},()=>structuredClone(base.sets)).flat();
  const a=appendSequence(base,sequenceFromPreset('inverted'),false).sequence!;
  const b=appendSequence(base,sequenceFromPreset('reverse'),false).sequence!;
  const graph=new SyncReplayGraph(),aa=prepare(a,mirror);
  const first=graph.addCycle('Box / Inverted',aa.source,aa.read,read=>{inspect(read,aa.period);return true;});
  const bb=prepare(b,mirror),second=graph.addCycle('Box / Reverse',bb.source,bb.read,read=>{inspect(read,bb.period);return true;},
    (frame,elbows)=>body.projectSyncElbows(frame,elbows));
  const distances=graph.connectionDistances(first[first.length-1],first[0]);
  for(const id of [...first,...second]){
    expect(distances.outgoing[id]).toBe(graph.connect(first[first.length-1],id).length);
    expect(distances.incoming[id]).toBe(graph.connect(id,first[0]).length);
  }
  const links=first.flatMap(id=>graph.choices(id).filter(e=>second.includes(e.id)).map(e=>({from:id,to:e.id})));
  expect(links.length).toBeGreaterThan(0);
  let joined:number[]|undefined;
  for(const link of links){
    const ai=first.indexOf(link.from),bi=second.indexOf(link.to);
    const candidate=[...first.slice(ai+1),...first.slice(0,ai+1),...second.slice(bi),...second.slice(0,bi)];
    try{graph.compose(candidate);joined=candidate;break;}catch{}
  }
  expect(joined).toBeDefined();
  const route=graph.compose(joined!);inspect(route.sample,route.period);
},20000);

it.each(['crossed-alternate','underarm','inline','high-low'])('%sの途中の制約も元の区間に保持して再生する',id=>{
  const captured=prepare(id==='high-low'?SEQUENCE_EXAMPLES[3]:sequenceFromPreset(id)),graph=new SyncReplayGraph();
  const ids=graph.addCycle(id,captured.source,captured.read,read=>{inspect(read,captured.period);return true;},
    (frame,elbows)=>body.projectSyncElbows(frame,elbows));
  const route=graph.compose([...ids,...ids]);inspect(route.sample,route.period);
});

it('1セットの役割固定では、球の入れ替わりを引き継いで3セット後に同じ球へ戻る',()=>{
  const captured=prepare(sequenceFromPreset('shower')),graph=new SyncReplayGraph();
  const ids=graph.addCycle('固定',captured.source,captured.read,read=>{inspect(read,captured.period);return true;},
    (frame,elbows)=>body.projectSyncElbows(frame,elbows));
  const route=graph.compose([ids[0]]);
  expect(route.identityRepeats).toBe(3);expect(route.period).toBeCloseTo(captured.period,9);
  for(let i=0;i<99;i++){
    const time=i/99*route.period,a=route.sample(time),b=captured.read(time);
    a.ballPositions!.forEach((p,j)=>expect(p.distanceTo(b.ballPositions![j])).toBeLessThan(1e-8));
  }
  inspect(route.sample,route.period);
  juggling.setSyncReplay(route);
  for(const phase of [0,.1,.49,.9]){
    juggling.seek(phase);const frame=juggling.update(0),expected=route.sample(phase*route.period);
    frame.ballPositions!.forEach((p,i)=>expect(p.distanceTo(expected.ballPositions![i])).toBeLessThan(1e-8));
  }
  expect(juggling.getMotionSnapshot().reusingSegments).toBe(true);
  expect(juggling.getSyncBoxReport()).toBeNull();expect(juggling.getSyncProgram()).toBeNull();
  expect(()=>juggling.captureSyncMotion()).toThrow('通常のセット列');
  prepare(sequenceFromPreset('box'));expect(juggling.getMotionSnapshot().reusingSegments).toBe(false);
});

it('最初の戻り道が球識別の周期上限を超えても、登録済み区間で閉じられる経路を探す',()=>{
  const captured=prepare(sequenceFromPreset('shower')),graph=new SyncReplayGraph();
  const ids=graph.addCycle('固定',captured.source,captured.read,read=>body.validateSyncReplay(read,captured.period),
    (frame,elbows)=>body.projectSyncElbows(frame,elbows));
  const prefix=Array.from({length:43},()=>ids[0]);
  expect(()=>graph.compose(prefix)).toThrow('同じ球まで戻る周期が128');
  const before=graph.summary,prepareArm=body.prepareSyncCycle;
  body.prepareSyncCycle=()=>{throw new Error('戻り道の探索で腕を再計算してはいけません');};
  try{
    const closed=graph.close(prefix),route=graph.compose(closed);
    expect(closed.slice(0,prefix.length)).toEqual(prefix);expect(closed).toHaveLength(45);
    expect(route.identityRepeats).toBe(1);expect(body.validateSyncReplay(route.sample,route.period)).toBe(true);
    expect(graph.summary).toEqual(before);
    expect(()=>graph.close(Array.from({length:127},()=>ids[0]))).toThrow('同じ球まで戻る周期が128');
    expect(()=>graph.close(Array.from({length:129},()=>ids[0]))).toThrow('1〜128セット');
  }finally{body.prepareSyncCycle=prepareArm;}
});

it('同じ球の位置でも手向きや到着の残り時間が異なる入口を同一扱いしない',()=>{
  const captured=prepare(sequenceFromPreset('box')),graph=new SyncReplayGraph();
  const first=graph.addCycle('元',captured.source,captured.read,()=>true);
  const changed={...captured.source,obligations:(t:number)=>captured.source.obligations(t).map(b=>({...b,releaseIn:b.releaseIn+.1}))};
  const second=graph.addCycle('時間違い',changed,captured.read,()=>true);
  expect(first.flatMap(id=>graph.choices(id)).some(e=>second.includes(e.id))).toBe(false);
  const turned=(t:number)=>{const f=captured.read(t);f.hands[0].fingerDir.applyAxisAngle(new THREE.Vector3(0,1,0),.1);return f;};
  const third=graph.addCycle('手向き違い',captured.source,turned,()=>true);
  expect(first.flatMap(id=>graph.choices(id)).some(e=>third.includes(e.id))).toBe(false);
  expect(()=>graph.close([first[0],second[1]])).toThrow('途中');
});

it('登録後に体の設定を変えたり、保存した肘を骨の長さから外した場合は再利用しない',()=>{
  const captured=prepare(sequenceFromPreset('box'));
  const angle=body.armAngle;body.armAngle+=.1;expect(()=>captured.read(0)).toThrow('姿勢が変わり');body.armAngle=angle;
  const frame=captured.read(.1);frame.fixedElbows![0].y+=.1;body.update(frame,0);
  expect(body.hasPlannedSyncCycle).toBe(false);expect(body.syncPlanInfo.reason).toBe('unsafe-replay-pose');
});

it('アプリの登録・再生APIは実VRMを検査し、不成立の通常列から再利用中の列へ戻す',async()=>{
  const {default:VRMJuggler}=await import('../src/index');
  const sequence=sequenceFromPreset('box');prepare(sequence);
  // Renderer/UI notifications are irrelevant here; the motion, rig, graph and
  // production registration/inspection APIs are real.
  const api:any=Object.create(VRMJuggler.prototype),options=new Options();
  options.siteswap.syncBox=compileSequence(sequence).config!;
  Object.assign(api,{body,juggling,vrm,options,syncReplayGraph:new SyncReplayGraph(),syncReplaySources:[],updateGui:()=>{},emitState:()=>{}});
  const registered=api.registerSyncSegments('Box');expect(registered.ids).toHaveLength(2);
  const plan=body.syncPlanInfo;
  const route=api.playSyncSegments([...registered.ids,...registered.ids]);expect(route.sets).toBe(4);
  expect(body.syncPlanInfo).toBe(plan);expect(juggling.getMotionSnapshot().reusingSegments).toBe(true);
  expect(api.inspectSyncCycle().skeletonOK).toBe(true);
  expect(()=>api.registerSyncSegments('再登録')).toThrow('通常のセット列');
  const bad=structuredClone(sequence);
  for(const row of bad.sets)row.motion.hands=[0,1].map(()=>({definition:{release:{x:0,y:0,z:0},catch:{x:0,y:0,z:0},passage:{at:.5},carry:{route:'direct',amount:0}}})) as any;
  expect(api.setSyncSequence(bad).ok).toBe(false);
  expect(juggling.getMotionSnapshot().reusingSegments).toBe(true);
  expect(juggling.getMotionSnapshot().period).toBe(route.period);
  expect(api.inspectSyncCycle().skeletonOK).toBe(true);
});

it('均等な検査点の間にある不成立の腕下イベントを接続部品に登録しない',()=>{
  const captured=prepare(sequenceFromPreset('box')),graph=new SyncReplayGraph(),phase=.237;
  const read=(t:number)=>{
    const f=captured.read(t);
    return {...f,constraintPhases:[phase],underarm:Math.abs(t/captured.period-phase)<1e-8?[{hand:0,position:new THREE.Vector3(3,3,3)}]:[]};
  };
  expect(()=>graph.addCycle('不成立',captured.source,read,candidate=>body.validateSyncReplay(candidate,captured.period))).toThrow('周期検査');
  expect(graph.summary.segments).toBe(0);
});

it.each([false,true])('接続列を再検査して復元し、元の経路と球識別、プレビューを保つ: mirror=%s',async mirror=>{
  const {default:VRMJuggler}=await import('../src/index');
  const base=sequenceFromPreset('box');prepare(base,mirror);
  const api:any=Object.create(VRMJuggler.prototype),options=new Options();
  options.siteswap.syncBox={...compileSequence(base).config!,mirror};
  Object.assign(api,{body,juggling,vrm,options,paused:true,avatarTop:1.7,showGui:false,
    syncReplayGraph:new SyncReplayGraph(),syncReplaySources:[],renderer:{frameHeight:()=>{}},updateGui:()=>{},emitState:()=>{}});
  const ids=api.registerSyncSegments('Box',base).ids;
  api.playSyncSegments([...ids,...ids]);api.seekPhase(.237);
  body.update(juggling.update(0),0);vrm.update(0);
  const before=juggling.activeSyncReplay!,phase=juggling.getMotionSnapshot().phase,plan=body.syncPlanInfo;
  const oldPose=body.getArmPose(),oldOptions=structuredClone(options.siteswap);
  // A second source is checked without replacing the replay or changing its phase.
  const repeated=structuredClone(base);repeated.sets=Array.from({length:4},()=>structuredClone(base.sets)).flat();
  const longer=appendSequence(repeated,sequenceFromPreset('inverted'),false).sequence!;longer.name='Box / Inverted';
  const next=api.registerSyncSequence(longer,mirror);
  expect(juggling.activeSyncReplay).toBe(before);expect(juggling.getMotionSnapshot().phase).toBeCloseTo(phase,12);
  expect(body.syncPlanInfo).toBe(plan);expect(body.getArmPose()).toEqual(oldPose);expect(api.paused).toBe(true);
  expect(options.siteswap).toEqual(oldOptions);
  // Retain the first source even when its segments only provide elbow anchors.
  const route=next.ids;const expected=api.syncReplayGraph.compose(route);
  const saved=api.exportSyncSegments(route,'保存した列');
  longer.name='changed after registration';expect(saved.sources[1].sequence.name).toBe('Box / Inverted');
  const doc=JSON.parse(JSON.stringify(saved));doc.verified=true;
  let inspections=0;const inspectCycle=api.inspectSyncCycle.bind(api);
  api.inspectSyncCycle=(...args:any[])=>{inspections++;return inspectCycle(...args);};
  api.clearSyncSegments();const restored=api.restoreSyncSegments(doc);
  expect(inspections).toBe(2);expect(restored.name).toBe('保存した列');expect(restored.ids).toHaveLength(route.length);
  expect(juggling.activeSyncReplay).toBe(before);expect(body.getArmPose()).toEqual(oldPose);
  expect(juggling.getMotionSnapshot().phase).toBeCloseTo(phase,12);expect(api.paused).toBe(true);
  const actual=api.syncReplayGraph.compose(restored.ids);
  for(let i=0;i<61;i++){
    const a:JugglingFrame=actual.sample(i/61*actual.period),b:JugglingFrame=expected.sample(i/61*expected.period);
    a.ballPositions!.forEach((p,h)=>expect(p.distanceTo(b.ballPositions![h])).toBeLessThan(1e-8));
    a.fixedElbows!.forEach((p,h)=>expect(p.distanceTo(b.fixedElbows![h])).toBeLessThan(1e-8));
  }
  expect(api.exportSyncSegments(restored.ids,'保存した列')).toEqual(saved);
  // An open route is a valid draft and can be closed after restoration.
  const open=api.exportSyncSegments([restored.ids[0]],'途中');
  const unfinished=api.restoreSyncSegments(open);expect(unfinished.ids).toHaveLength(1);
  expect(()=>api.analyzeSyncSegments(unfinished.ids)).toThrow('最後から先頭');
  expect(api.closeSyncSegments(unfinished.ids).length).toBeGreaterThan(1);
  // A later invalid source must not publish an earlier partially rebuilt registry.
  const registry=api.exportSyncSegments(unfinished.ids,'途中'),bad=structuredClone(saved);
  for(const row of bad.sources[1].sequence.sets)row.motion.hands=[0,1].map(()=>({definition:{release:{x:0,y:0,z:0},catch:{x:0,y:0,z:0},passage:{at:.5},carry:{route:'direct',amount:0}}})) as any;
  expect(()=>api.restoreSyncSegments(bad)).toThrow();
  expect(api.exportSyncSegments(unfinished.ids,'途中')).toEqual(registry);
  expect(juggling.activeSyncReplay).toBe(before);expect(body.getArmPose()).toEqual(oldPose);
  expect(juggling.getMotionSnapshot().phase).toBeCloseTo(phase,12);expect(api.paused).toBe(true);
  const mismatched=structuredClone(base);mismatched.name='different definition';
  expect(()=>api.registerSyncSegments('mismatched',mismatched)).toThrow();
},30000);
