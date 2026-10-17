import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils, VRMHumanBoneName } from '@pixiv/three-vrm';
import GUI from 'lil-gui';

import Renderer, { Background, CameraView } from './classes/Renderer';
import { refineBundledFaceOutline } from './classes/bundledFaceOutline';
import {runSyncPlanner} from './classes/SyncPlannerClient';
import Juggling, {JugglingFrame} from './motion/juggling';
import {SyncReplayGraph} from './motion/juggling/sync-replay';
import {SyncReplayDocument,validateReplayDocument,replayDocumentIdentity,MAX_SYNC_REPLAY_SOURCES} from './motion/juggling/sync-replay-document';
import { SiteswapCheck } from './motion/juggling/validate';
import Body from './motion/body';
import Blink from './motion/blink';
import Facial from './motion/facial';

import Options from './options/index';
import { PATTERN_PRESETS } from './presets';
import { SYNC_BOX_PRESETS, SyncBoxConfig, syncDwell, SYNC_RADIUS } from './motion/juggling/sync-box';
import { analyzeSequence, compileSequence, sequenceFromPreset, sequenceFromBasicParts, sequenceFromDoubleParts, sequenceWithDoubleParts, sequenceHandDefinition, extractSequenceSet, rotateSequenceStart, expandSequence, addInlineTransitions, appendSequence, connectSequenceCycles, findConnectionExamples, connectionReplayCandidates, SEQUENCE_EXAMPLES, SyncSequence } from './motion/juggling/sync-sequence';
import {movementStateTransition,rankedMovementStateTransitions,columnReceiverHandoff,alternatingCrossTransition,mixedAlternatingCrossTransition,spatialLaneTransition,underarmCatchTransition,lateralShuffleTransition,upperInlineTransition,fixedUnderarmInvertedTransition} from './motion/juggling/sync-transitions';
import {planSyncMovement,MovementCheck} from './motion/juggling/sync-movement-planner';
import {constructiveMovements} from './motion/juggling/sync-constructive-planner';
import {resolvedSequence} from './motion/juggling/sync-resolved-sequence';
import {sequenceFromBaseParts,compileBaseRoute,directBoundarySequence} from './motion/juggling/sync-base-patterns';
import {buildSyncBoxTracks,syncBeat} from './motion/juggling/sync-box';
import {CreateSiteswap} from './motion/juggling/Siteswap';
import {planSyncConstraints} from './motion/juggling/sync-constraint-planner';
import {planSyncGeometry} from './motion/juggling/sync-spatial-planner';
import {basicNetworkPlan,underarmNetworkPlan,BasicNetworkProgress} from './motion/juggling/sync-basic-network';
import { pointSegmentDistance, segmentDistance } from './motion/inspection';
import {syncCycleFailure,sequenceLocationAtPhase,SyncCycleFailure} from './motion/juggling/sync-validation';

// モデルを指定しなかった時に読み込む VRM(ページからの相対パス)
const DEFAULT_MODEL_PATH = './models/default.vrm';

// フレームが大きく飛んだ時(タブを裏にした時など)に動きが暴れないようにする上限(秒)
const MAX_DELTA = 0.1;
// コマ送り 1 回で進める時間(秒)
const STEP_TIME = 1 / 30;

const PROP_TYPES = ['ball', 'club', 'ring', 'pancake'];
const CAMERA_VIEWS: CameraView[] = ['front', 'diagonal', 'side', 'close'];

/** getState() と statechange イベントで渡す、いまの状態 */
export interface JugglerState {
  siteswap: string;
  prop: string;
  speed: number;
  paused: boolean;
  bodyMotion: number;
  camera: CameraView;
  recording: boolean;
  syncBox: string | null;
}

export default class VRMJuggler {
  /** デモのパターン一覧(サイトスワップ・ボールの数・名前・説明) */
  static presets = PATTERN_PRESETS;
  static syncBoxPresets = SYNC_BOX_PRESETS;
  static syncSequenceExamples = SEQUENCE_EXAMPLES;
  static analyzeSyncSequence = analyzeSequence;
  static syncSequenceFromPreset = sequenceFromPreset;
  static syncSequenceFromBasicParts = sequenceFromBasicParts;
  static syncSequenceFromBaseParts = sequenceFromBaseParts;
  static compileSyncBaseRoute = compileBaseRoute;
  static syncSequenceFromDoubleParts = sequenceFromDoubleParts;
  static syncSequenceWithDoubleParts = sequenceWithDoubleParts;
  static syncSequenceHandDefinition = sequenceHandDefinition;
  static extractSyncSequenceSet = extractSequenceSet;
  static rotateSyncSequenceStart = rotateSequenceStart;
  static expandSyncSequence = expandSequence;
  static syncSequenceLocationAtPhase = sequenceLocationAtPhase;
  static addSyncInlineTransitions = addInlineTransitions;
  static appendSyncSequence = appendSequence;
  static connectSyncSequenceCycles = connectSequenceCycles;
  static findSyncConnectionExamples = findConnectionExamples;

  /** A texture-free copy of the actual avatar for a background planning worker. */
  static async createSyncPlanner(data:ArrayBuffer,armAngle=.3){
    const loader=new GLTFLoader();
    loader.register(()=>({name:'PLANNER_TEXTURES',loadTexture:()=>Promise.resolve(new THREE.Texture())}));
    loader.register(parser=>new VRMLoaderPlugin(parser));
    const gltf=await loader.parseAsync(data,''),vrm=gltf.userData.vrm as VRM;
    if(!vrm)throw new Error('VRMの骨格を読み込めませんでした。');
    VRMUtils.removeUnnecessaryVertices(gltf.scene);VRMUtils.combineSkeletons(gltf.scene);
    if(vrm.meta.metaVersion==='1')vrm.scene.rotation.y=Math.PI;
    const app=new VRMJuggler(),scene=new THREE.Scene();scene.add(vrm.scene);
    app.options=new Options();app.vrm=vrm;app.body=new Body(vrm,scene);app.body.armAngle=armAngle;app.body.motionAmount=0;
    app.juggling=new Juggling(scene,'3',app.options.siteswap);app.juggling.setAvatarMetrics(app.body.metrics);
    app.renderer={scene,frameHeight:()=>{}} as unknown as Renderer;app.paused=true;
    return app;
  }

  private selector!: string;
  private renderer!: Renderer;
  private timer = new THREE.Timer();
  private vrm?: VRM;
  private loadId = 0;
  private planningModelData?:Promise<ArrayBuffer>;
  private plannedSequences=new Map<string,{plan:ReturnType<VRMJuggler['exportSyncPlan']>;sequence:SyncSequence;redirectedThrows:number}>();
  onSyncPlanningProgress?:(state:{attempts:number;budget:number;bestCost?:number})=>void;
  syncPlanningMode:'strict'|'constructive'='strict';
  private juggling!: Juggling;
  private body?: Body;
  private syncReplayGraph=new SyncReplayGraph();
  private syncReplaySources:{name:string;sequence?:SyncSequence;resolved?:SyncSequence;mirror:boolean;ids:number[];purpose?:'transition';planning?:'constructive'}[]=[];
  private blink!: Blink;
  private avatarTop = 1.7;
  private facial!: Facial;
  private options!: Options;
  private showGui: boolean = false;
  private gui?: GUI;
  private message?: HTMLElement;
  private messageKind: 'none' | 'loading' | 'error' = 'none';
  private loggedError = false;
  private paused = false;
  private pendingStep = 0;
  private recorder?: { recorder: MediaRecorder; chunks: Blob[]; stream: MediaStream };

  constructor(selector: string = '', modelPath: string = DEFAULT_MODEL_PATH) {
    if (selector === '') return;
    this.selector = selector;

    this.options = new Options();
    this.renderer = new Renderer(this.selector);
    if (!this.renderer.container) {
      console.error(`VRMJuggler: ${selector} が見つかりません`);
      return;
    }
    this.createMessageArea(this.renderer.container);

    this.juggling = new Juggling(this.renderer.scene, this.options.siteswapNums, this.options.siteswap);
    this.juggling.visible = false;
    this.syncTempo();
    this.renderer.onUserMove = () => this.emitState();
    this.blink = new Blink();
    this.facial = new Facial(this.options.facial);

    this.createGUI();
    document.addEventListener('keyup', this.switchGUI, false);

    this.loadModel(modelPath || DEFAULT_MODEL_PATH);
    this.animate();
  }

  /**
   * VRM を読み込んで差し替える。何度呼んでもよい(前のモデルは破棄される)。
   */
  loadModel(modelPath: string): Promise<boolean> {
    const loadId = ++this.loadId;
    if (this.messageKind !== 'error') this.showMessage('モデルを読み込んでいます…');

    return new Promise((resolve) => {
      const onError = (error: any) => {
        if (loadId !== this.loadId) return resolve(false);
        console.error(error);
        this.showMessage(
          'VRM を読み込めませんでした。VRM ファイル(VRM 0.x / 1.0)か確認してください。' +
            (this.vrm ? '(前のモデルのまま続けます)' : ''),
          true
        );
        resolve(false);
      };

      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));
      loader.load(
        modelPath,
        (gltf) => {
          const vrm = gltf.userData.vrm as VRM | undefined;
          if (!vrm) return onError(new Error('VRM ではない glTF ファイルです'));
          // 読み込み中に別のモデルが指定された場合は捨てる
          if (loadId !== this.loadId) {
            VRMUtils.deepDispose(vrm.scene);
            return resolve(false);
          }
          VRMUtils.removeUnnecessaryVertices(gltf.scene);
          VRMUtils.combineSkeletons(gltf.scene);
          // VRM 1.0 は +Z、VRM 0.x は -Z を向いている。このライブラリは -Z を正面として扱うので 1.0 は半回転させる
          if (vrm.meta.metaVersion === '1') vrm.scene.rotation.y = Math.PI;
          if (modelPath === DEFAULT_MODEL_PATH) refineBundledFaceOutline(vrm.scene);
          this.setVRM(vrm);
          // Start while uploaded blob URLs are still alive; keep the bytes for
          // cancellation/retry without retaining textures in a second renderer.
          this.planningModelData=fetch(modelPath).then(response=>{
            if(!response.ok)throw new Error('計算用のモデルを読み込めませんでした。');return response.arrayBuffer();
          });
          this.planningModelData.catch(()=>{});this.plannedSequences.clear();
          if (this.messageKind === 'loading') this.clearMessage();
          resolve(true);
        },
        (progress: ProgressEvent) => {
          if (loadId !== this.loadId || !progress.total || this.messageKind === 'error') return;
          const percent = Math.floor((progress.loaded / progress.total) * 100);
          this.showMessage(`モデルを読み込んでいます… ${percent}%`);
        },
        onError
      );
    });
  }

  private setVRM(vrm: VRM) {
    const scene = this.renderer.scene;
    if (this.vrm) {
      scene.remove(this.vrm.scene);
      this.body?.dispose(scene);
      VRMUtils.deepDispose(this.vrm.scene);
    }

    this.vrm = vrm;
    scene.add(vrm.scene);
    this.avatarTop = new THREE.Box3().setFromObject(vrm.scene).max.y;

    this.body = new Body(vrm, scene);
    this.clearSyncSegments();
    this.body.armAngle = Number(this.options.siteswap.armAngle);
    this.body.motionAmount = this.options.bodyMotion;
    this.body.enableNeck = this.options.neck;
    this.juggling.setAvatarMetrics(this.body.metrics);
    if(!this.prepareSyncBody()){
      this.pause();
      this.showMessage('このモデルでは腕の姿勢を1周期につなげられません。配置を調整してください。',true);
    }
    this.juggling.visible = true;
    this.renderer.frameHeight(Math.max(this.juggling.peakY,this.avatarTop));
    // 床にアバターの影を落とす(テクスチャの透明な部分は three.js が材質の alphaTest で抜く)
    vrm.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
    });

    this.blink.init(vrm);
    this.facial.init(vrm);
  }

  /**
   * サイトスワップを変更する。投げられないパターンの場合は今のパターンのまま、理由を画面に表示する。
   */
  setSiteswap(siteswap: string): SiteswapCheck {
    const next = { ...this.options.siteswap, syncBox: undefined };
    const result = this.juggling.setPattern(siteswap, next);
    if (result.ok) {
      Object.assign(this.options.siteswap, next);
      this.options.siteswapNums = result.siteswap;
      this.syncTempo();
      this.clearMessage();
      // ページ側の入力欄などが追従できるように通知する
      this.renderer.container?.dispatchEvent(
        new CustomEvent('siteswapchange', { detail: { siteswap: result.siteswap } })
      );
      this.emitState();
    } else {
      this.showSiteswapError(result);
    }
    this.updateGui();
    return result;
  }

  /** コラムと短い側の空間動作を指定する、3ボール同期版。 */
  setSyncBox(pattern: string | SyncBoxConfig,lockLayout=false,refineBridge=false): SiteswapCheck & {failure?:SyncCycleFailure} {
    const config = typeof pattern === 'string' ? SYNC_BOX_PRESETS.find(p => p.id === pattern) : pattern;
    if (!config || !config.short?.length) return { ok: false, siteswap: '', message: '同期パターンが見つかりません。' };
    const next = { ...this.options.siteswap, syncBox: structuredClone(config), dwellRatio: syncDwell(config),
      props: [{ type: 'ball', color: 'random', radius: SYNC_RADIUS, C: 0.9 }] };
    const previous={options:structuredClone(this.options.siteswap),motion:this.options.bodyMotion};
    const restoreTracks=this.juggling.capturePlaybackRestore(),restoreArms=this.body?.captureSyncPlanRestore();
    const result = this.juggling.setPattern(config.siteswap, next);
    if (result.ok) {
      Object.assign(this.options.siteswap, next);
      this.setBodyMotion(0);
      this.juggling.seek(0);
      if(this.syncPlanningMode==='constructive'){
        try{
          const initial=this.juggling.getSyncMovement()!;
          const choices=lockLayout?[{kind:'direct' as const,movement:initial.movement}]:constructiveMovements(initial);
          let best=choices[0],bestCost=Infinity;
          const count=Math.min(80,Math.max(24,Math.ceil(initial.period*24)));
          for(const candidate of choices){
            this.juggling.replanSyncMovement(candidate.movement);
            const g=this.juggling.getSyncBoxReport()!;
            if(g.ownershipConflicts)throw new Error('球の受け渡しが重複しています。');
            let sum=0,max=0,reach=0;
            for(let i=0;i<count;i++){
              this.juggling.seek(i/count);const frame=this.juggling.update(0),cost=this.body!.syncPosePenalty(frame);sum+=cost;max=Math.max(max,cost);reach=Math.max(reach,this.body!.syncReachError(frame));
            }
            const cost=sum/count+2*max+Math.max(0,reach-.004)*10000;
            if(cost<bestCost){best=candidate;bestCost=cost;}
            if(bestCost<1e-9)break;
          }
          const tracks=this.juggling.replanSyncMovement(best.movement);
          tracks.constraintPlanned=best.movement.length>0;
          tracks.contactFallback=true;
          this.body!.prepareConstructiveCycle(p=>{this.juggling.seek(p);return this.juggling.update(0);},tracks.period);
          Object.assign(this.body!.syncPlanInfo,{construction:best.kind,candidates:choices.length});
          this.juggling.commitSyncPlan();this.options.siteswapNums=result.siteswap;this.juggling.seek(0);
          this.gui?.hide();this.showGui=false;this.syncTempo();this.clearMessage();this.updateGui();this.emitState();
          return result;
        }catch(error){
          Object.assign(this.options.siteswap,previous.options);this.options.siteswap.syncBox=previous.options.syncBox;
          this.setBodyMotion(previous.motion);restoreTracks();restoreArms?.();
          return {ok:false,siteswap:config.siteswap,message:(error as Error).message};
        }
      }
      const assess=(criticalPhase?:number):MovementCheck=>{
        const g=this.juggling.getSyncBoxReport();
        if(this.body&&g&&!g.geometryOK){
          const ball=g.ballContactAllowed?0:Math.max(0,-g.ballClearance),hand=Math.max(0,.09-g.minHandDistance),reach=Math.max(0,g.maxReachRatio-1);
          return {ok:false,phase:!g.ballOrderOK?g.ballOrderPhase:ball>0?g.ballPhase:hand>0?g.handPhase:g.reachPhase,score:10+100*(ball+hand+reach)+g.ownershipConflicts};
        }
        if(criticalPhase!==undefined&&this.body){this.juggling.seek(criticalPhase);}
        const probe=criticalPhase!==undefined?this.body?.inspectSyncPose(this.juggling.update(0)):undefined;
        if(probe?.ok!==false&&this.prepareSyncBody())return {ok:true,score:0};
        const info=probe?.ok===false?probe.info:this.body?.syncPlanInfo,detail=info?.details;
        const gap=detail?.pair?.maxRelatedClearance??detail?.pair?.maxClearance??0;
        const posture=detail?.posture.reduce((n,p)=>n+(p.deficit||0),0)||0;
        const reach=detail?.reachErrors.reduce((n,e)=>n+Math.max(0,e-.008),0)||0;
        const order=detail?.pair?.maxOrderDifference;
        const ball=detail?.ballClearances?.reduce((n,d)=>n+Math.max(0,SYNC_RADIUS+.04-d),0)||0;
        const deficit=Math.max(0,.08-gap)*10+100*(posture+reach+ball)+
          (order===null||order===undefined?0:Math.max(0,.035-order)*10)+(detail?.clear.filter(n=>!n).length||0);
        return {ok:false,phase:info?.phase,score:1+8*deficit/(1+deficit)};
      };
      let checked=assess();
      let tracks=this.juggling.getSyncMovement();
      let flightAdjustments=tracks?.flightAdjustments||[],baseMovement=tracks?.movement||[];
      if(!checked.ok&&!refineBridge&&tracks&&config.sets?.some(s=>s.transition)&&!this.juggling.getSyncBoxReport()?.geometryOK){
        const generated=planSyncGeometry(tracks,this.juggling.getSyncTransform(),plan=>
          this.juggling.replanSyncMovement(plan.hands,[0,0],[1,1],0,plan.flights),600);
        if(generated.plan){flightAdjustments=generated.plan.flights;baseMovement=generated.plan.hands;}
        tracks=this.juggling.replanSyncMovement(baseMovement,[0,0],[1,1],0,flightAdjustments);checked=assess();
      }
      const rebuild=(movement:typeof baseMovement,placement:[number,number]=[0,0],timing:[number,number]=[1,1],height=0)=>
        this.juggling.replanSyncMovement(movement,placement,timing,height,flightAdjustments);
      if(!checked.ok&&!refineBridge&&tracks){
        const planned=planSyncMovement(tracks,checked,(plan,phase)=>{rebuild(plan);return assess(phase);});
        if(planned.plan)checked={ok:true,score:0};
        else {rebuild(baseMovement);checked=assess();}
      }
      // Relative passes keep their meaning under a common translation. If an
      // endpoint is out of reach, move the working plane as a whole, then solve
      // the hand transfers again. Explicit old documents retain their frame.
      const relative=!lockLayout&&[config,...(config.sets||[])].some(s=>s.shortMotions?.some(o=>o.ballOrder==='style')||('hands' in s&&s.hands?.some(h=>h?.shortMotion?.ballOrder==='style')));
      const commonPlan=(budget=24000)=>{
        const initial=this.juggling.replanSyncMovement([],[0,0],[1,1],0,[]);
        const planned=planSyncConstraints(initial,this.juggling.getSyncTransform(),
          plan=>this.juggling.replanSyncMovement(plan.hands,[0,0],plan.timing,0,plan.flights),
          (phases,period)=>this.body!.syncCyclePenalty(phase=>{this.juggling.seek(phase);return this.juggling.update(0);},phases,period),()=>{
            // A small geometry deficit must not hide a second arm-path failure.
            if(!this.prepareSyncBody())return {ok:false,score:1,phase:this.body!.syncPlanInfo.phase};
            const geometry=this.juggling.getSyncBoxReport()!;
            if(!geometry.geometryOK)return {ok:false,score:1,phase:geometry.maxReachRatio>1?geometry.reachPhase:geometry.handPhase};
            const report=this.inspectSyncCycle();
            return report?.skeletonOK?{ok:true,score:0}:{ok:false,score:1,phase:report?.largestJump.phase};
          },budget,this.onSyncPlanningProgress);
        this.juggling.getSyncMovement()!.constraintSeed=planned.seed;
        if(planned.plan)this.juggling.getSyncMovement()!.constraintPlanned=true;
        return planned;
      };
      if(!checked.ok&&relative&&this.body){
        const restore=this.juggling.capturePlaybackRestore(),restoreBody=this.body.captureSyncPlanRestore();
        const proposed=commonPlan(0);
        if(proposed.plan)checked={ok:true,score:0};
        else {restore();restoreBody();}
      }
      let placementTiming:[number,number]=[1,1],bestPlacementScore=checked.score;
      if(!checked.ok&&relative){
        // Earlier catches create more time for the next held movement. Re-solve
        // the ballistic passes and their order at each candidate timing; never
        // pause a ball in the air or stretch an already captured segment.
        const timings:[number,number][]=[[.8,1],[1.2,1],[1,.9],[1,.8],[.8,.9],[1.2,.9],[.8,.8],[1.2,.8]];
        for(const timing of timings){
          try{
            const retimed=rebuild([],[0,0],timing);checked=assess();
            if(checked.score<bestPlacementScore){bestPlacementScore=checked.score;placementTiming=timing;}
            if(checked.ok)break;
            const planned=planSyncMovement(retimed,checked,(plan,phase)=>{rebuild(plan,[0,0],timing);return assess(phase);},36);
            if(planned.plan){checked={ok:true,score:0};break;}
          }catch{ /* A catch may overrun its next release; try another timing. */ }
        }
      }
      if(!checked.ok&&relative){
        // Column and short-pass heights are related variables. Moving only a
        // high catch cannot help when that catch must remain above a column.
        for(const columnHeight of [-.06,-.12,-.18]){
          for(const timing of [[1,1],placementTiming] as [number,number][]){
            try{
            const lowered=rebuild([],[0,0],timing,columnHeight);checked=assess();
            if(checked.ok)break;
            const planned=planSyncMovement(lowered,checked,(plan,phase)=>{rebuild(plan,[0,0],timing,columnHeight);return assess(phase);},36);
            if(planned.plan){checked={ok:true,score:0};break;}
            }catch{ /* This relative-height candidate has no ballistic solution. */ }
          }
          if(checked.ok)break;
        }
      }
      if(!checked.ok&&relative){
        const placements:[number,number][]=[];
        for(const y of [0,-.04,.04,-.08,.08,-.12])for(const z of [0,-.04,.04,-.08])if(y||z)placements.push([y,z]);
        placements.sort((a,b)=>Math.hypot(...a)-Math.hypot(...b));
        for(const placement of placements){
          try{
          const shifted=rebuild([],placement,placementTiming);checked=assess();
          if(checked.ok)break;
          const planned=planSyncMovement(shifted,checked,(plan,phase)=>{rebuild(plan,placement,placementTiming);return assess(phase);},36);
          if(planned.plan){checked={ok:true,score:0};break;}
          }catch{ /* Reject only this candidate, preserving the prior preview. */ }
        }
        if(!checked.ok){rebuild(baseMovement);checked=assess();}
      }
      if(!checked.ok&&relative&&tracks){
        const generated=planSyncGeometry(this.juggling.getSyncMovement()!,this.juggling.getSyncTransform(),plan=>
          this.juggling.replanSyncMovement(plan.hands,[0,0],[1,1],0,plan.flights),600,assess);
        if(generated.plan){
          flightAdjustments=generated.plan.flights;baseMovement=generated.plan.hands;
          rebuild(baseMovement);checked=assess();
        }else {
          if(generated.best){flightAdjustments=generated.best.plan.flights;baseMovement=generated.best.plan.hands;}
          rebuild(baseMovement);checked=assess();
        }
      }
      if(!checked.ok&&relative&&this.body){
        const planned=commonPlan();
        checked=planned.plan?{ok:true,score:0}:assess();
        if(!planned.plan&&checked.ok)checked={ok:false,score:1};
      }
      if(!checked.ok&&refineBridge&&this.body&&config.sets?.some(s=>s.transition)){
        // Preserve accepted source states while optimizing all movement
        // intervals in a bridge together; fixing only its first bad frame can
        // otherwise move the same conflict to the following set forever.
        const initial=this.juggling.getSyncMovement()!,count=Math.max(32,config.sets.length*4);
        const critical=new Set<number>(checked.phase===undefined?[]:[checked.phase]);
        const poseCosts=new Map<string,number>();
        const poseCost=(phase:number)=>{
          this.juggling.seek(phase);const frame=this.juggling.update(0);
          const key=JSON.stringify([frame.armOrder,frame.underarm,frame.hands.map(h=>[h.position.toArray(),h.palmNormal.toArray(),h.fingerDir.toArray(),h.elbowPole?.toArray()]),frame.ballPositions?.map(p=>p.toArray())]);
          const known=poseCosts.get(key);if(known!==undefined)return known;
          const cost=this.body!.syncPosePenalty(frame);
          if(poseCosts.size>50000)poseCosts.clear();poseCosts.set(key,cost);return cost;
        };
        const inspectBridge=(phase?:number)=>{const result=assess(phase);if(result.phase!==undefined)critical.add(result.phase);return result;};
        const generated=planSyncGeometry(initial,this.juggling.getSyncTransform(),plan=>
          this.juggling.replanSyncMovement(plan.hands,[0,0],[1,1],0,plan.flights),6000,inspectBridge,()=>{
            const g=this.juggling.getSyncBoxReport()!;
            const phases=[...Array.from({length:count},(_,i)=>i/count),...critical,g.handPhase,g.reachPhase];
            const costs=phases.map(poseCost);
            const maximum=Math.max(...costs);
            return {score:costs.reduce((a,b)=>a+b,0)/costs.length+2*maximum,phase:phases[costs.indexOf(maximum)]};
          });
        if(generated.plan){this.juggling.getSyncMovement()!.constraintPlanned=true;checked=assess();}
        else if(generated.best){
          const plan=generated.best.plan;
          this.juggling.replanSyncMovement(plan.hands,[0,0],[1,1],0,plan.flights);checked=assess();
        }
      }
      if(!checked.ok){
        const geometry=this.juggling.getSyncBoxReport();
        const failure=geometry?syncCycleFailure(geometry,geometry.geometryOK?this.body?.syncPlanInfo:undefined):undefined;
        Object.assign(this.options.siteswap,previous.options);
        this.options.siteswap.syncBox=previous.options.syncBox;
        this.setBodyMotion(previous.motion);
        restoreTracks();restoreArms?.();this.body?.update(this.juggling.update(0),0);
        return {ok:false,siteswap:config.siteswap,failure,message:'投げ・捕球と途中の手の移動を探索しましたが、現在の探索範囲では経路を見つけられませんでした。技が不可能という意味ではありません。直前の配置を保持しています。'};
      }
      this.juggling.commitSyncPlan();
      this.options.siteswapNums = result.siteswap;
      this.juggling.seek(0);
      this.gui?.hide();
      this.showGui = false;
      this.syncTempo();
      this.clearMessage();
      this.updateGui();
      this.emitState();
    }
    return result;
  }

  setMotionPaths(visible: boolean) { this.juggling.setPathsVisible(visible); }

  /** Resolve the complete ball schedule before joining catches to later releases. */
  setSyncSequence(sequence: SyncSequence, mirror = false,lockLayout=false,refineBridge=false) {
    const {config, analysis} = compileSequence(sequence);
    if (!config) return {ok:false, analysis, message:analysis.issues.map(i=>`セット${i.set+1}${i.hand===undefined?'':i.hand===0?' 左手':' 右手'}: ${i.message}`).join('\n')};
    const result = this.setSyncBox({...config,mirror},lockLayout,refineBridge);
    return {...result, analysis,...(result.failure?{failure:{...result.failure,issues:result.failure.issues.map(issue=>({...issue,
      location:issue.phase===undefined?undefined:sequenceLocationAtPhase(sequence,result.failure!.period,issue.phase)}))}}:{})};
  }

  exportSyncPlan(){
    const t=this.juggling.getSyncMovement();
    if(!t||!this.body?.hasPlannedSyncCycle)throw new Error('検査済みの動作がありません。');
    return {movement:structuredClone(t.movement),placement:t.placement,timing:t.timing,columnHeight:t.columnHeight,
      flights:structuredClone(t.flightAdjustments),constraintPlanned:t.constraintPlanned,contactFallback:t.contactFallback,
      transform:JSON.stringify(this.juggling.getSyncTransform()),arms:this.body.exportSyncPlan()};
  }

  /** Install only the checked result; the visible preview is untouched during search. */
  applySyncPlan(sequence:SyncSequence,mirror:boolean,plan:ReturnType<VRMJuggler['exportSyncPlan']>){
    const {config,analysis}=compileSequence(sequence);
    if(!config||!this.body||plan.transform!==JSON.stringify(this.juggling.getSyncTransform()))throw new Error('モデルが変わりました。もう一度再生してください。');
    const restore=this.juggling.capturePlaybackRestore(),restoreArms=this.body.captureSyncPlanRestore(),previous=structuredClone(this.options.siteswap),motion=this.options.bodyMotion;
    try{
      const next={...this.options.siteswap,syncBox:{...config,mirror},dwellRatio:syncDwell(config),props:[{type:'ball',color:'random',radius:SYNC_RADIUS,C:.9}]};
      const result=this.juggling.setPattern(config.siteswap,next);if(!result.ok)throw new Error(result.message);
      Object.assign(this.options.siteswap,next);this.setBodyMotion(0);
      const tracks=this.juggling.replanSyncMovement(plan.movement,plan.placement,plan.timing,plan.columnHeight,plan.flights);
      tracks.constraintPlanned=plan.constraintPlanned;tracks.contactFallback=plan.contactFallback;this.body.applySyncPlan(plan.arms);
      const g=this.juggling.getSyncBoxReport(),s=this.inspectSyncCycle();
      if(plan.contactFallback?this.syncPlanningMode!=='constructive'||!!g?.ownershipConflicts||!s?.playbackOK:!g?.geometryOK||!s?.skeletonOK)
        throw new Error('生成した動作と表示モデルの検査が一致しません。');
      this.juggling.commitSyncPlan();this.juggling.seek(0);this.options.siteswapNums=result.siteswap;
      this.syncTempo();this.clearMessage();this.updateGui();this.emitState();return {...result,analysis};
    }catch(error){Object.assign(this.options.siteswap,previous);this.options.siteswap.syncBox=previous.syncBox;this.setBodyMotion(motion);restore();restoreArms();throw error;}
  }

  prepareDirectSyncSequence(sequence:SyncSequence,mirror=false){
    const {config}=compileSequence(sequence);if(!config)throw new Error('球の受け渡しを確認してください。');
    const source=CreateSiteswap(config.siteswap,{...this.options.siteswap,beatDuration:syncBeat(config),dwellRatio:syncDwell(config),
      props:[{type:'ball',color:'red',radius:SYNC_RADIUS,C:.9}]});
    if(source.errorMessage)throw new Error(source.errorMessage);
    const transform=this.juggling.getSyncTransform(),tracks=buildSyncBoxTracks(source,transform,{...config,mirror});
    // One shared reach envelope: contract horizontal spacing and depth only.
    // Ball heights, encounter order, release times and tempo stay unchanged.
    let best=directBoundarySequence(sequence,tracks,transform,mirror),error=Infinity;
    for(const width of [1,.9,.8,.7,.6]){
      const candidate=directBoundarySequence(sequence,tracks,transform,mirror,width),next=compileSequence(candidate.sequence).config!;
      const resolved=buildSyncBoxTracks(source,transform,{...next,mirror}),reach=this.body!.syncTracksReachError(resolved,SYNC_RADIUS);
      if(reach<error){error=reach;best=candidate;}
      if(reach<.004)break;
    }
    return best;
  }

  async setSyncSequenceAsync(sequence:SyncSequence,mirror=false,options:{signal?:AbortSignal;onProgress?:(message:string)=>void;workerUrl?:string;directBoundaries?:boolean}={}){
    if(!this.planningModelData||!this.body)throw new Error('モデルの読み込みを待ってください。');
    const source=structuredClone(sequence),modelId=this.loadId,key=JSON.stringify([source,mirror,this.body.armAngle,this.syncPlanningMode,!!options.directBoundaries]);
    options.signal?.throwIfAborted();
    const cached=this.plannedSequences.get(key);
    if(cached)return {...this.applySyncPlan(cached.sequence,mirror,cached.plan),sequence:cached.sequence,redirectedThrows:cached.redirectedThrows};
    const model=await this.planningModelData;options.signal?.throwIfAborted();
    const worker=new Worker(options.workerUrl||new URL('./sync-planner-worker.js',document.baseURI));
    const {result,plan,sequence:prepared=source,redirectedThrows=0}=await runSyncPlanner(worker,{model,sequence:source,mirror,armAngle:this.body.armAngle,planning:this.syncPlanningMode,directBoundaries:!!options.directBoundaries},options.signal,options.onProgress);
    options.signal?.throwIfAborted();if(modelId!==this.loadId)throw new Error('モデルが変わりました。もう一度再生してください。');
    if(!result.ok)return result;
    const applied=this.applySyncPlan(prepared,mirror,plan);
    if(this.plannedSequences.size>=32)this.plannedSequences.delete(this.plannedSequences.keys().next().value!);
    this.plannedSequences.set(key,{plan,sequence:prepared,redirectedThrows});return {...applied,sequence:prepared,redirectedThrows};
  }

  seekPhase(fraction: number) {
    this.pause();
    this.pendingStep = 0;
    this.juggling.seek(fraction);
  }

  getSyncBoxReport() { return this.juggling.getSyncBoxReport(); }
  getSyncProgram() { return this.juggling.getSyncProgram(); }

  /** Register one checked cycle as reusable one-set intervals for this avatar. */
  private registerCurrentSyncSegments(name:string,graph:SyncReplayGraph){
    if(!this.body)throw new Error('モデルの読み込みを待ってください。');
    const source=this.juggling.captureSyncMotion(),arms=this.body.captureSyncArmMotion();
    const read=(time:number)=>{const frame=source.sample(time);return {...frame,fixedElbows:arms(frame)};};
    const geometry=this.juggling.getSyncBoxReport();
    const allowContact=this.juggling.getSyncMovement()?.contactFallback===true;
    const restoreArms=this.body.captureSyncPlanRestore();
    try{
      const ids=graph.addCycle(name,source,read,candidate=>
        (allowContact?!geometry?.ownershipConflicts:!!geometry?.geometryOK)&&this.body!.validateSyncReplay(candidate,source.period,allowContact)&&
        (allowContact?!!this.inspectSyncCycle(candidate)?.playbackOK:!!this.inspectSyncCycle(candidate)?.skeletonOK),
        (frame,elbows)=>this.body!.projectSyncElbows(frame,elbows));
      return {ids,...graph.summary};
    }catch(error){restoreArms();throw error;}
  }
  registerSyncSegments(name:string,sequence?:SyncSequence){
    const mirror=!!this.options.siteswap.syncBox?.mirror;
    if(this.syncReplaySources.length>=MAX_SYNC_REPLAY_SOURCES)throw new Error(`元の動作は${MAX_SYNC_REPLAY_SOURCES}件以内にしてください。`);
    if(sequence){
      validateReplayDocument({kind:'sync-segment-route',version:1,name:'',sources:[{name,sequence,mirror}],route:[]});
      const {config}=compileSequence(sequence),current=this.options.siteswap.syncBox;
      // Compare definitions rather than property insertion order.
      const stable=(v:any):any=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?
        Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,stable(v[k])])):v;
      if(!config||JSON.stringify(stable({...config,mirror}))!==JSON.stringify(stable({...current,mirror})))
        throw new Error('保存する定義と再生中の列が異なります。定義を検査してから登録してください。');
    }
    const result=this.registerCurrentSyncSegments(name,this.syncReplayGraph);
    const tracks=this.juggling.getSyncMovement();
    const resolved=sequence&&tracks?.constraintPlanned?resolvedSequence(sequence,tracks,this.juggling.getSyncTransform(),mirror,true):undefined;
    this.syncReplaySources.push({name,sequence:sequence?structuredClone(sequence):undefined,resolved,mirror,ids:result.ids.slice(),
      ...(tracks?.contactFallback?{planning:'constructive' as const}:{})});
    return result;
  }
  /** Source checks may temporarily replace the preview, but never its saved plan. */
  private withSyncPreviewRestored<T>(action:()=>T):T{
    if(!this.body)throw new Error('モデルの読み込みを待ってください。');
    const restoreMotion=this.juggling.capturePlaybackRestore(),restoreArms=this.body.captureSyncPlanRestore();
    const saved={siteswap:structuredClone(this.options.siteswap),siteswapNums:this.options.siteswapNums,
      bodyMotion:this.options.bodyMotion,paused:this.paused,showGui:this.showGui};
    this.paused=true;
    try{return action();}
    finally{
      Object.assign(this.options.siteswap,saved.siteswap);this.options.siteswap.syncBox=saved.siteswap.syncBox;
      this.options.siteswapNums=saved.siteswapNums;this.options.bodyMotion=saved.bodyMotion;
      restoreMotion();restoreArms();this.body.update(this.juggling.update(0),0);this.vrm?.update(0);
      this.paused=saved.paused;this.showGui=saved.showGui;
      if(saved.showGui)this.gui?.show();else this.gui?.hide();
      this.renderer.frameHeight(Math.max(this.juggling.peakY,this.avatarTop));this.updateGui();this.emitState();
    }
  }
  registerSyncSequence(sequence:SyncSequence,mirror=false){
    return this.withSyncPreviewRestored(()=>{
      const result=this.setSyncSequence(sequence,mirror);
      if(!result.ok)throw new Error(result.message);
      return this.registerSyncSegments(sequence.name||'セット列',sequence);
    });
  }
  exportSyncSegments(ids:number[],name='接続列'):SyncReplayDocument{
    this.syncReplayGraph.validatePath(ids);
    if(this.syncReplaySources.some(s=>!s.sequence))throw new Error('保存には元のセット定義が必要です。定義を指定して登録し直してください。');
    const refs=new Map<number,{source:number;set:number}>();
    this.syncReplaySources.forEach((s,source)=>s.ids.forEach((id,set)=>refs.set(id,{source,set})));
    return validateReplayDocument({kind:'sync-segment-route',version:1,name,
      sources:this.syncReplaySources.map(s=>({name:s.name,sequence:s.sequence!,mirror:s.mirror,
        ...(s.planning?{planning:s.planning}:{}),
        ...(s.resolved?{resolved:s.resolved}:{}),
        ...(s.purpose?{purpose:s.purpose}:{})})),
      route:ids.map(id=>refs.get(id))});
  }
  restoreSyncSegments(input:unknown){
    const document=validateReplayDocument(input),graph=new SyncReplayGraph();
    const sources:typeof this.syncReplaySources=[];
    return this.withSyncPreviewRestored(()=>{
      for(const source of document.sources){
        const previousMode=this.syncPlanningMode;let result:ReturnType<VRMJuggler['setSyncSequence']>;
        try{this.syncPlanningMode=source.planning||'strict';result=this.setSyncSequence(source.resolved||source.sequence,source.mirror,!!source.resolved);}
        finally{this.syncPlanningMode=previousMode;}
        if(!result.ok)throw new Error(`${source.name}: ${result.message}`);
        const registered=this.registerCurrentSyncSegments(source.name,graph);
        sources.push({...source,ids:registered.ids});
      }
      const ids=document.route.map(r=>sources[r.source].ids[r.set]);
      graph.validatePath(ids);
      // Publish only after every source and every adjacent boundary passes.
      this.syncReplayGraph=graph;this.syncReplaySources=sources;
      return {ids,name:document.name,sources:sources.length,...graph.summary};
    });
  }
  getSyncSegmentChoices(after?:number){return this.syncReplayGraph.choices(after);}
  getSyncSegmentContext(){return this.syncReplayGraph.contextInfo;}
  getSyncSegmentSources(){return this.syncReplaySources.map((s,index)=>({index,name:s.name,mirror:s.mirror,sets:s.ids.length,purpose:s.purpose}));}
  getSyncSourceConnections(anchorIndex:number){
    const anchor=this.syncReplaySources[anchorIndex];
    if(!Number.isInteger(anchorIndex)||!anchor)throw new Error('基準にする登録済みの動作を選んでください。');
    const distances=this.syncReplayGraph.connectionDistances(anchor.ids[anchor.ids.length-1],anchor.ids[0]);
    const sources=this.syncReplaySources.flatMap((s,index)=>{
      if(s.purpose==='transition')return [];
      // Rotate a complete checked cycle. Its last set is immediately before
      // the chosen start, so the return port must move with the entry port.
      const starts=s.ids.map((id,startSet)=>({startSet,endSet:(startSet+s.ids.length-1)%s.ids.length,
        forwardSets:distances.outgoing[id],returnSets:distances.incoming[s.ids[(startSet+s.ids.length-1)%s.ids.length]]}));
      return [{index,name:s.name,mirror:s.mirror,forwardSets:starts[0].forwardSets,returnSets:starts[0].returnSets,starts}];
    });
    const starts=sources.flatMap(s=>s.starts);
    return {anchor:anchorIndex,name:anchor.name,sources,connected:sources.filter(s=>s.forwardSets!==null&&s.returnSets!==null).length,
      totalStarts:starts.length,connectedStarts:starts.filter(s=>s.forwardSets!==null&&s.returnSets!==null).length};
  }
  /** Append a registered source using existing edges only. This is read-only:
   * choosing a destination must never trigger a new pose search or registration.
   */
  appendSyncSource(ids:number[],sourceIndex:number,repeats=1,startSet=0){
    this.syncReplayGraph.validatePath(ids);
    const source=this.syncReplaySources[sourceIndex];
    if(!Number.isInteger(sourceIndex)||!source)throw new Error('登録済みの動作を選んでください。');
    if(!Number.isInteger(repeats)||repeats<1||repeats>16)throw new Error('動作の繰り返しは1〜16回で指定してください。');
    if(!Number.isInteger(startSet)||startSet<0||startSet>=source.ids.length)throw new Error('開始セットを登録した動作の範囲内で選んでください。');
    const sourceIds=[...source.ids.slice(startSet),...source.ids.slice(0,startSet)];
    const sourceSets=source.ids.length,remaining=128-ids.length-sourceSets*repeats;
    if(remaining<0)throw new Error('移行を含む接続列を128セット以内にしてください。');
    const bridge=ids.length?this.syncReplayGraph.connect(ids[ids.length-1],sourceIds[0],remaining):[];
    const route=[...ids,...bridge,...Array.from({length:repeats},()=>sourceIds).flat()];
    this.syncReplayGraph.validatePath(route);
    return {ids:route,bridge:bridge.slice(),sourceSets,repeats,startSet,addedSets:route.length-ids.length};
  }
  /** Advance one bounded validation per next(). Yield with the original preview
   * and registry restored so the UI can paint progress or cancel with return().
   * A private facade stages definitions and edges; only success publishes them.
   */
  *prepareSyncBasicNetwork(mirror=false,family:'basic'|'hf-underarm'='basic'){
    if(!this.body)throw new Error('モデルの読み込みを待ってください。');
    if(family!=='basic'&&family!=='hf-underarm')throw new Error('準備する部品のグループを選んでください。');
    const original={graph:this.syncReplayGraph,sources:this.syncReplaySources,count:this.syncReplaySources.length,
      segments:this.syncReplayGraph.summary.segments,body:this.body,vrm:this.vrm,loadId:this.loadId};
    const context=original.graph.contextInfo;
    if(context&&context.balls!==3)throw new Error('基本部品の一括準備は3球用です。別の球数は登録部品をクリアしてから準備してください。');
    if(family==='hf-underarm'&&context&&Math.abs(context.secondsPerSet-.5)>1e-9)
      throw new Error('腕下・クロー・役割固定の11動作は1セット0.5秒で準備します。現在の接続列をJSON保存し、「登録部品をクリア」してから準備してください。');
    const plan=family==='hf-underarm'?underarmNetworkPlan():basicNetworkPlan(context?context.secondsPerSet/2:.205),worker=Object.create(this) as VRMJuggler;
    worker.syncReplayGraph=original.graph.fork();worker.syncReplaySources=original.sources.slice();
    const indices:number[]=[],connections:{from:number;to:number;added:boolean;via?:string}[]=[],total=plan.sources.length+plan.transitions.length;
    let completed=0,addedSources=0,addedTransitions=0;
    const unchanged=()=>{
      if(this.body!==original.body||this.vrm!==original.vrm||this.loadId!==original.loadId||
        this.syncReplayGraph!==original.graph||this.syncReplaySources!==original.sources||
        this.syncReplaySources.length!==original.count||this.syncReplayGraph.summary.segments!==original.segments)
        throw new Error('準備中にモデルまたは登録内容が変更されました。新しい状態で準備し直してください。');
    };
    // Bridge builders need each planned source's explicit one-set phases:
    // two for basic sources, four for Double. A longer repetition can share
    // its canonical motion code without being a usable substitute.
    const sourceKey=(s:SyncSequence)=>JSON.stringify([s.sets.length,analyzeSequence(s).canonical]);
    const existing=new Map(original.sources.flatMap((s,i)=>s.sequence&&s.mirror===mirror&&!s.sequence.mirrorRepeat&&
      s.sequence.sets.every(r=>r.repeat===1)?[[sourceKey(s.sequence),i] as const]:[]));
    const missing=plan.sources.filter(s=>!existing.has(sourceKey(s))).length;
    if(original.count+missing>MAX_SYNC_REPLAY_SOURCES)throw new Error(`基本部品を加えると登録上限${MAX_SYNC_REPLAY_SOURCES}件を超えます。接続列を保存し、登録部品を整理してください。`);
    const run=(progress:BasicNetworkProgress,action:()=>void)=>{
      unchanged();
      try{action();completed++;}
      catch(error){throw Object.assign(new Error(`${progress.name}: ${(error as Error).message}`),{progress});}
    };
    for(const sequence of plan.sources){
      const progress:BasicNetworkProgress={stage:'source',completed,total,name:sequence.name};
      unchanged();yield progress;
      run(progress,()=>{
        const found=existing.get(sourceKey(sequence));
        if(found!==undefined){
          // Reuse the existing certificate only while its avatar pose binding
          // is still valid. Sampling checks this without planning new arms.
          worker.syncReplayGraph.compose(worker.syncReplaySources[found].ids).sample(0);
          indices.push(found);return;
        }
        const index=worker.syncReplaySources.length;
        worker.registerSyncSequence(sequence,mirror);indices.push(index);addedSources++;
      });
    }
    for(const {from,to} of plan.transitions){
      const progress:BasicNetworkProgress={stage:'transition',completed,total,name:`${plan.sources[from].name} ↔ ${plan.sources[to].name}`};
      unchanged();yield progress;
      run(progress,()=>{
        const result=worker.registerSyncTransition(indices[from],indices[to]);
        if(result.added)addedTransitions++;
        connections.push({from:indices[from],to:indices[to],added:result.added,via:'via' in result?result.via:undefined});
      });
    }
    unchanged();
    // Check connectivity to the same base before making the new registry live.
    const first=worker.syncReplaySources[indices[0]].ids;
    for(const index of indices){const ids=worker.syncReplaySources[index].ids;
      worker.syncReplayGraph.connect(first[first.length-1],ids[0]);worker.syncReplayGraph.connect(ids[ids.length-1],first[0]);}
    this.syncReplayGraph=worker.syncReplayGraph;this.syncReplaySources=worker.syncReplaySources;
    return {sourceIndices:indices,ids:first.slice(),addedSources,addedTransitions,connections,total,...this.syncReplayGraph.summary};
  }
  /** Reuse existing routes; generate a missing connection to either component. */
  registerSyncTransition(from:number,to:number){
    const a=this.syncReplaySources[from],b=this.syncReplaySources[to];
    if(!Number.isInteger(from)||!Number.isInteger(to)||!a?.sequence||!b?.sequence)
      throw new Error('元のセット定義を持つ2つの動作を選んでください。');
    if(a.mirror!==b.mirror)throw new Error('移行を作る2つの動作の左右反転をそろえてください。');
    const paths=(graph:SyncReplayGraph)=>{
      const forward=graph.connect(a.ids[a.ids.length-1],b.ids[0]),backward=graph.connect(b.ids[b.ids.length-1],a.ids[0]);
      return {forward,backward,route:[...a.ids,...forward,...b.ids,...backward]};
    };
    try{return {...paths(this.syncReplayGraph),added:false,...this.syncReplayGraph.summary};}catch{}
    if(this.syncReplaySources.length>=MAX_SYNC_REPLAY_SOURCES)throw new Error(`元の動作は${MAX_SYNC_REPLAY_SOURCES}件以内にしてください。`);
    return this.withSyncPreviewRestored(()=>{
      if(this.syncPlanningMode==='constructive'){
        const state=(s:typeof a)=>{
          try{return resolvedSequence(s.sequence!,this.syncReplayGraph.sourceTracks(s.ids[0]),this.juggling.getSyncTransform(),s.mirror);}
          catch{return s.resolved||s.sequence!;}
        };
        const first=state(a),second=state(b);
        const candidates=(['retract','circle','direct'] as const).map(kind=>movementStateTransition(first,second,4,0,0,0,0,true,kind)).filter((s):s is SyncSequence=>!!s);
        if(!candidates.length){
          const result=connectSequenceCycles(first,second,false);if(result.sequence)candidates.push(result.sequence);
        }
        let reason='この投球周期をつなぐ受け渡しを作れませんでした。';
        for(const sequence of candidates){
          sequence.name=`移行 / ${a.name} ↔ ${b.name}`.slice(0,100);
          try{
            const result=this.setSyncSequence(sequence,a.mirror,true);
            if(!result.ok)throw new Error(result.message);
            const candidate=this.syncReplayGraph.fork(),registered=this.registerCurrentSyncSegments(sequence.name,candidate),joined=paths(candidate);
            this.syncReplayGraph=candidate;
            this.syncReplaySources.push({name:sequence.name,sequence,mirror:a.mirror,ids:registered.ids,purpose:'transition',planning:'constructive'});
            return {...joined,added:true,via:undefined,...candidate.summary};
          }catch(error){reason=(error as Error).message;}
        }
        throw new Error(reason);
      }
      let reason='',lastCandidate:SyncSequence|undefined,lastFailure:SyncCycleFailure|undefined;
      const scheduled=(x:SyncSequence,y:SyncSequence,via?:string)=>[2,4].map(repeats=>({via,build:()=>{
          // A stable interior cycle on each side supplies the same ball/hand
          // state as the already registered standalone motion.
          const repeat=(s:SyncSequence):SyncSequence=>({...structuredClone(s),mirrorRepeat:false,
            sets:Array.from({length:repeats},()=>expandSequence(s)).flat()});
          const connected=connectSequenceCycles(repeat(x),repeat(y),false);
          if(!connected.sequence)throw new Error(connected.message);
          return connected.sequence;
      }}));
      const builders:{build:()=>SyncSequence;via?:string}[]=scheduled(a.sequence!,b.sequence!);
      // Generic boundary-state corridors. Solved sources try them before the
      // legacy recipes; otherwise they follow the fitted recipes and relays,
      // because each failed corridor can take a minute.
      const corridors:typeof builders=a.resolved||b.resolved?builders:[];
      for(const [stages,separation,lift,stagger,travelDepth=0,anticipate=0] of [[2,0,0,0],[4,0,0,0],
        [2,0,0,1],[2,0,0,-1],[4,.12,0,0],[4,-.12,0,0],[4,0,.12,0],[4,0,-.12,0]]){
        try{
          const transform=this.juggling.getSyncTransform();
          const first=resolvedSequence(a.sequence!,this.syncReplayGraph.sourceTracks(a.ids[0]),transform,a.mirror);
          const second=resolvedSequence(b.sequence!,this.syncReplayGraph.sourceTracks(b.ids[0]),transform,b.mirror);
          const sequence=movementStateTransition(first,second,stages,separation,lift,stagger,travelDepth,!!anticipate);
          if(sequence)corridors.push({build:()=>sequence});
        }catch{ /* Holds and vertical stacks keep their existing state constructors. */ }
      }
      const spatial=(x:SyncSequence,y:SyncSequence)=>[columnReceiverHandoff,alternatingCrossTransition,mixedAlternatingCrossTransition,spatialLaneTransition,underarmCatchTransition,lateralShuffleTransition,upperInlineTransition]
        .flatMap(make=>{const sequence=make(x,y);return sequence?[sequence]:[];});
      for(const sequence of spatial(a.sequence!,b.sequence!))builders.push({build:()=>sequence});
      const reachable=(x:typeof a,y:typeof a)=>{
        try{this.syncReplayGraph.connect(x.ids[x.ids.length-1],y.ids[0]);this.syncReplayGraph.connect(y.ids[y.ids.length-1],x.ids[0]);return true;}
        catch{return false;}
      };
      // A requested pair need not have a bespoke bridge. If A already reaches
      // C, a supported C/B candidate can extend the same immutable component.
      // Require both A/B paths before publishing, as with direct candidates.
      for(const c of this.syncReplaySources){
        if(c===a||c===b||!c.sequence||c.mirror!==a.mirror)continue;
        const toB=spatial(c.sequence,b.sequence!),fromA=spatial(a.sequence!,c.sequence);
        if(toB.length&&reachable(a,c))for(const sequence of toB)builders.push({build:()=>sequence,via:c.name});
        if(fromA.length&&reachable(c,b))for(const sequence of fromA)builders.push({build:()=>sequence,via:c.name});
      }
      const sources=this.syncReplaySources;
      let ranked:SyncSequence[]|undefined;
      const rankCorridors=()=>{
        if(ranked)return ranked;
        const restore=this.juggling.capturePlaybackRestore(),restoreBody=this.body!.captureSyncPlanRestore();
        try{
          const transform=this.juggling.getSyncTransform();
          const first=resolvedSequence(a.sequence!,this.syncReplayGraph.sourceTracks(a.ids[0]),transform,a.mirror);
          const second=resolvedSequence(b.sequence!,this.syncReplayGraph.sourceTracks(b.ids[0]),transform,b.mirror);
          ranked=rankedMovementStateTransitions(first,second,sequence=>{
            const config=compileSequence(sequence).config;if(!config)return Infinity;
            const result=this.juggling.setPattern(config.siteswap,{...this.options.siteswap,syncBox:{...config,mirror:a.mirror},
              dwellRatio:syncDwell(config),props:[{type:'ball',radius:SYNC_RADIUS,color:'red',C:.9}]});
            if(!result.ok)return Infinity;
            const g=this.juggling.getSyncBoxReport()!;if(g.ownershipConflicts)return Infinity;
            const count=sequence.sets.length*4,phases=[...new Set([...Array.from({length:120},(_,i)=>i/120),...Array.from({length:count},(_,i)=>i/count)])];
            const costs=phases.map(phase=>{
              this.juggling.seek(phase);return this.body!.syncPosePenalty(this.juggling.update(0));
            }),sq=(n:number)=>Math.max(0,n)**2;
            return costs.reduce((x,y)=>x+y,0)/count+2*Math.max(...costs)+100*sq(g.maxReachRatio-1)+
              16*sq(.092-g.minHandDistance)+(g.ballContactAllowed?0:4*sq(-g.ballClearance));
          });
        }finally{restore();restoreBody();}
        return ranked||[];
      };
      const authored=(x:SyncSequence,y:SyncSequence,via?:string)=>connectionReplayCandidates(x,y).map(sequence=>({via,build:()=>sequence}));
      const stagedFixed=(x:SyncSequence,y:SyncSequence,via?:string)=>{
        const sequence=fixedUnderarmInvertedTransition(x,y);return sequence?[{via,build:()=>sequence}]:[];
      };
      function* candidates(){
        // Solved events may differ substantially from their original guesses.
        // Use their physical boundary states before trying legacy schedules.
        if(a.resolved||b.resolved)for(const sequence of rankCorridors())yield {build:()=>sequence};
        else yield* authored(a.sequence!,b.sequence!);
        yield* builders;
        if(a.resolved||b.resolved)yield* authored(a.sequence!,b.sequence!);
        yield* stagedFixed(a.sequence!,b.sequence!);
        // A checked A/C route plus a C/B bridge also connects A/B. Matching
        // throw schedules selects related intermediaries without enumerating
        // arbitrary chains; geometry and complete boundary states still decide
        // validity. Try these only after direct and specialized candidates.
        const schedule=(s:SyncSequence)=>JSON.stringify(expandSequence(s).map(row=>row.throws));
        const aSchedule=schedule(a.sequence!),bSchedule=schedule(b.sequence!);
        for(const c of sources){
          if(c===a||c===b||!c.sequence||c.mirror!==a.mirror||c.purpose==='transition')continue;
          const cSchedule=schedule(c.sequence);
          const toB=[...authored(c.sequence,b.sequence!,c.name),...stagedFixed(c.sequence,b.sequence!,c.name)],
            fromA=[...authored(a.sequence!,c.sequence,c.name),...stagedFixed(a.sequence!,c.sequence,c.name)];
          if((cSchedule===bSchedule||toB.length)&&reachable(a,c)){
            if(cSchedule===bSchedule)yield* scheduled(c.sequence,b.sequence!,c.name);
            yield* toB;
          }
          if((cSchedule===aSchedule||fromA.length)&&reachable(c,b)){
            if(cSchedule===aSchedule)yield* scheduled(a.sequence!,c.sequence,c.name);
            yield* fromA;
          }
        }
        if(!a.resolved&&!b.resolved){yield* corridors;for(const sequence of rankCorridors())yield {build:()=>sequence};}
      }
      for(const refineBridge of a.resolved||b.resolved?[true,false]:[false,true])for(const {build,via} of candidates()){
        try{
          let sequence=build();
          if(refineBridge&&!sequence.sets.some(s=>s.motion.transition))continue;
          if(sequence.sets.some(s=>s.motion.arrangement==='inline')){
            const inline=addInlineTransitions(sequence);
            if(!inline.sequence)throw new Error(inline.message);
            // The registry's timing is immutable. Inspect these spatial bridge
            // sets at its tempo rather than silently retiming accepted sources.
            sequence={...inline.sequence,beatDuration:sequence.beatDuration};
          }
          sequence.name=`移行 / ${a.name} ↔ ${b.name}${via?`（${via}経由）`:''}`.slice(0,100);
          lastCandidate=sequence;lastFailure=undefined;
          const candidate=this.syncReplayGraph.fork(),result=this.setSyncSequence(sequence,a.mirror,true,refineBridge);
          if(!result.ok){lastFailure='failure' in result?result.failure:undefined;throw new Error(result.message);}
          const registered=this.registerCurrentSyncSegments(sequence.name,candidate),joined=paths(candidate);
          this.syncReplayGraph=candidate;
          const tracks=this.juggling.getSyncMovement()!,resolved=tracks.constraintPlanned?
            resolvedSequence(sequence,tracks,this.juggling.getSyncTransform(),a.mirror,true):undefined;
          this.syncReplaySources.push({name:sequence.name,sequence,...(resolved?{resolved}:{}),mirror:a.mirror,ids:registered.ids,purpose:'transition'});
          return {...joined,added:true,via,...candidate.summary};
        }catch(error){reason=(error as Error).message;}
      }
      throw Object.assign(new Error('現在の探索では、腕の条件を守る移行をまだ生成できませんでした。技そのものが不可能という判定ではありません。 '+reason),
        {sequence:lastCandidate?structuredClone(lastCandidate):undefined,failure:lastFailure,mirror:a.mirror});
    });
  }
  clearSyncSegments(){this.syncReplayGraph.clear();this.syncReplaySources=[];}
  closeSyncSegments(ids:number[]){return this.syncReplayGraph.close(ids);}
  analyzeSyncSegments(ids:number[]){
    const route=this.syncReplayGraph.compose(ids);
    return {sets:route.sets,identitySets:route.sets*route.identityRepeats,period:route.period,
      secondsPerSet:route.beatDuration*2,segments:route.segments};
  }
  describeSyncSegments(ids:number[]){
    const identity=replayDocumentIdentity(this.exportSyncSegments(ids,''));
    let identitySets:number|null=null;
    try{identitySets=this.analyzeSyncSegments(ids).identitySets;}catch{/* An open or over-limit route has no confirmed period. */}
    return {...identity,identitySets,code:`${identity.balls}B-R${identity.routeSets}-C${identitySets??'pending'}-${identity.contentId}`};
  }
  playSyncSegments(ids:number[]){
    if(!this.body)throw new Error('モデルの読み込みを待ってください。');
    const replay=this.syncReplayGraph.compose(ids);
    let minBallDistance=Infinity;
    // Ball identities permute on later repeats; pair distances already repeat
    // after the movement period, so a long identity cycle adds no new evidence.
    const samples=Math.max(120,Math.ceil(replay.movementPeriod*240));
    for(let k=0;k<samples;k++){
      const balls=replay.sample(k*replay.movementPeriod/samples).ballPositions||[];
      for(let a=0;a<balls.length;a++)for(let b=a+1;b<balls.length;b++)minBallDistance=Math.min(minBallDistance,balls[a].distanceTo(balls[b]));
    }
    this.setBodyMotion(0);this.juggling.setSyncReplay(replay);
    this.body.update(this.juggling.update(0),0);this.play();
    return {...this.analyzeSyncSegments(ids),minBallDistance,ballContact:minBallDistance<=2*SYNC_RADIUS,contactFallback:replay.contactFallback,
      ballContactAllowed:replay.ballContactAllowed};
  }

  private prepareSyncBody() {
    if (!this.body || !this.options.siteswap.syncBox) return true;
    const phase = this.juggling.getMotionSnapshot().phase;
    const ok=this.body.prepareSyncCycle(p=> { this.juggling.seek(p); return this.juggling.update(0); }, this.juggling.getMotionSnapshot().period);
    this.juggling.seek(phase);
    this.body.update(this.juggling.update(0),0);
    return ok;
  }

  getMotionSnapshot() {
    return { ...this.juggling.getMotionSnapshot(), modelReady: !!this.vrm, arms: this.body?.getArmPose() || [] };
  }

  /** Inspect the actual loaded VRM's IK through a complete cycle, then restore the playhead. */
  inspectSyncCycle(readOverride?:(seconds:number)=>JugglingFrame) {
    if (!this.vrm || !this.body || !this.options.siteswap.syncBox&&!this.juggling.activeSyncReplay) return null;
    const saved = this.juggling.getMotionSnapshot();
    const samples = Math.max(240, Math.ceil(saved.period / 0.004));
    let maxGripError = 0, minArmDistance = Infinity, minBallArmDistance = Infinity;
    let maxJointAngularSpeed = 0;
    let postureOK=true,minTorsoClearance=Infinity,maxWristBend=0,maxElbowFlex=0,posturePhase=0;
    let previousRotations: THREE.Quaternion[] | undefined;
    let gripPhase = 0, armPhase = 0, ballArmPhase = 0;
    let closestBallArm: unknown;
    const elbows: THREE.Vector3[][] = [[], []];
    for (let i = -samples; i <= samples; i++) {
      const phase = ((i % samples) + samples) % samples / samples;
      if(!readOverride)this.juggling.seek(phase);
      const frame = readOverride?readOverride(phase*saved.period):this.juggling.update(0);
      this.body.update(frame, 0);
      this.vrm.update(0);
      const poses = this.body.getArmPose(SYNC_RADIUS).map(p => ({
        shoulder: new THREE.Vector3().fromArray(p.shoulder), elbow: new THREE.Vector3().fromArray(p.elbow),
        wrist: new THREE.Vector3().fromArray(p.wrist), grip: new THREE.Vector3().fromArray(p.grip),
      }));
      if (i < 0) continue; // settle the bend-plane history before measuring the periodic motion
      this.body.getArmPosture().forEach(p=>{
        if(!p.ok){postureOK=false;posturePhase=phase;}
        minTorsoClearance=Math.min(minTorsoClearance,p.torso);
        maxWristBend=Math.max(maxWristBend,p.wristBend);maxElbowFlex=Math.max(maxElbowFlex,p.elbowFlex);
      });
      const rotations = ['leftUpperArm','leftLowerArm','leftHand','rightUpperArm','rightLowerArm','rightHand'].map(name =>
        this.vrm!.humanoid.getNormalizedBoneNode(name as VRMHumanBoneName)!.getWorldQuaternion(new THREE.Quaternion()));
      if(previousRotations) rotations.forEach((q,j) => {
        maxJointAngularSpeed=Math.max(maxJointAngularSpeed,q.angleTo(previousRotations![j])/(saved.period/samples));
      });
      previousRotations=rotations;
      poses.forEach((p, h) => {
        elbows[h].push(p.elbow.clone());
        const error = p.grip.distanceTo(frame.hands[h].position);
        if (error > maxGripError) { maxGripError = error; gripPhase = phase; }
        frame.ballPositions!.forEach((point, ballId) => {
          const position=point.toArray();
          const ball = new THREE.Vector3().fromArray(position);
          const forearmEnd = p.wrist.clone().lerp(p.elbow, 0.2);
          // Exclude the wrist/hand contact region, where a held or just released ball belongs.
          const distance = Math.min(pointSegmentDistance(ball, p.shoulder, p.elbow), pointSegmentDistance(ball, p.elbow, forearmEnd));
          if (distance < minBallArmDistance) {
            minBallArmDistance = distance; ballArmPhase = phase;
            closestBallArm = { hand: h, ball: ballId, position, shoulder: p.shoulder.toArray(), elbow: p.elbow.toArray(), wrist: p.wrist.toArray(),
              handTarget: frame.hands[h].position.toArray(), heldHere: frame.hands[h].holding && ball.distanceTo(frame.hands[h].position) < 0.001 };
          }
        });
      });
      const left = poses[0], right = poses[1];
      for (const a of [[left.shoulder, left.elbow], [left.elbow, left.wrist]]) {
        for (const b of [[right.shoulder, right.elbow], [right.elbow, right.wrist]]) {
          const distance = segmentDistance(a[0], a[1], b[0], b[1]);
          if (distance < minArmDistance) { minArmDistance = distance; armPhase = phase; }
        }
      }
    }
    this.juggling.seek(saved.phase);
    const restored = this.juggling.update(0);
    this.body.update(restored, 0);
    this.vrm.update(0);
    const jumps = elbows.flatMap((points, hand) => points.slice(0, samples).map((p, i) => ({
      hand, phase: i / samples, distance: p.distanceTo(points[i + 1]), from: p.toArray(), to: points[i + 1].toArray(),
    })));
    const largestJump = jumps.reduce((a, b) => a.distance > b.distance ? a : b);
    const maxElbowJump = largestJump.distance;
    const maxElbowSpeed = maxElbowJump / (saved.period / samples);
    const skeletonOK=this.body.hasPlannedSyncCycle && postureOK && maxGripError < 0.012 && minArmDistance > 0.065 && minBallArmDistance > SYNC_RADIUS + 0.03 && maxElbowSpeed < 12 && maxJointAngularSpeed < 90;
    const contactFallback=this.juggling.activeSyncReplay?.contactFallback||this.juggling.getSyncMovement()?.contactFallback===true;
    const finite=[maxGripError,minArmDistance,minBallArmDistance,maxElbowSpeed,maxJointAngularSpeed].every(Number.isFinite);
    return { pattern: this.options.siteswap.syncBox?.id||'replay', mirror: !!this.options.siteswap.syncBox?.mirror,
      short: this.options.siteswap.syncBox?.short, samples, maxGripError, minArmDistance, minBallArmDistance, gripPhase, armPhase, ballArmPhase, closestBallArm, maxElbowJump, maxElbowSpeed, maxJointAngularSpeed, largestJump, plannedCycle: this.body.hasPlannedSyncCycle, planInfo: this.body.syncPlanInfo,
      postureOK,minTorsoClearance,maxWristBend,maxElbowFlex,posturePhase,
      // Bone segments and the torso envelope approximate the mesh. Appearance still needs visual inspection.
      skeletonOK,contactFallback,playbackOK:skeletonOK||contactFallback&&this.body.hasPlannedSyncCycle&&finite&&maxGripError<.012 };
  }

  /** 小道具を変える('ball' | 'club' | 'ring' | 'pancake'。pancake はリングを水平に回して投げる) */
  setProp(type: string) {
    if (this.options.siteswap.syncBox && type !== 'ball') return;
    if (!PROP_TYPES.includes(type)) return;
    this.options.siteswap.props!.forEach((prop) => (prop.type = type));
    this.setOptions();
    this.updateGui();
    this.emitState();
  }

  /** 再生速度(1 が実時間。0.05 〜 2) */
  setSpeed(speed: number) {
    if (!Number.isFinite(speed)) return;
    this.options.speed = THREE.MathUtils.clamp(speed, 0.05, 2);
    this.updateGui();
    this.emitState();
  }

  pause() {
    this.paused = true;
    this.emitState();
  }

  play() {
    this.paused = false;
    this.emitState();
  }

  /** 一時停止と再生を切り替え、一時停止中なら true を返す */
  togglePause() {
    if (this.paused) this.play();
    else this.pause();
    return this.paused;
  }

  /** 一時停止して、少しだけ(1/30 秒 × frames)進める */
  step(frames = 1) {
    this.paused = true;
    this.pendingStep += STEP_TIME * frames;
    this.emitState();
  }

  /** 体の動きの大きさ(0 で止める、1 が標準、2 で大きく) */
  setBodyMotion(amount: number) {
    if (!Number.isFinite(amount)) return;
    if (this.options.siteswap.syncBox) amount = 0;
    this.options.bodyMotion = THREE.MathUtils.clamp(amount, 0, 2);
    if (this.body) this.body.motionAmount = this.options.bodyMotion;
    this.updateGui();
    this.emitState();
  }

  /** カメラの位置: 'front'(正面)、'diagonal'(斜め)、'side'(横)、'close'(上半身に寄る) */
  setCameraView(view: CameraView) {
    if (!CAMERA_VIEWS.includes(view)) return;
    this.renderer.setView(view);
    this.emitState();
  }

  /** 背景: null で透明(ページの背景が見える)、'#rrggbb' で単色、['#上', '#下'] でグラデーション */
  setBackground(background: Background) {
    this.renderer.setBackground(background);
  }

  /** 描画している canvas(録画やスクリーンショットに使える) */
  get canvas(): HTMLCanvasElement {
    return this.renderer.canvas;
  }

  getState(): JugglerState {
    return {
      siteswap: this.juggling.currentSiteswap,
      prop: this.options.siteswap.props![0].type,
      speed: this.options.speed,
      paused: this.paused,
      bodyMotion: this.options.bodyMotion,
      camera: this.renderer.view,
      recording: !!this.recorder,
      syncBox: this.options.siteswap.syncBox?.id || null,
    };
  }

  /**
   * canvas の録画を始める(MediaRecorder が使えないブラウザでは false)。
   * 背景が透明だと、多くのブラウザでは録画の背景が黒になる。
   */
  startRecording(fps = 30): boolean {
    if (this.recorder) return true;
    const canvas = this.canvas;
    if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) return false;
    // SNS に載せやすい H.264 の mp4 を優先し、だめなら webm(Safari は mp4 だけ)
    const mimeType = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(
      (type) => MediaRecorder.isTypeSupported(type)
    );
    try {
      const stream = canvas.captureStream(fps);
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.start(250);
      this.recorder = { recorder, chunks, stream };
    } catch (e) {
      console.error(e);
      return false;
    }
    this.emitState();
    return true;
  }

  /** 録画を止めて動画(mp4 または webm)を返す */
  stopRecording(): Promise<Blob | null> {
    const current = this.recorder;
    if (!current) return Promise.resolve(null);
    this.recorder = undefined;
    return new Promise((resolve) => {
      current.recorder.onstop = () => {
        current.stream.getTracks().forEach((track) => track.stop());
        resolve(new Blob(current.chunks, { type: current.recorder.mimeType || 'video/webm' }));
        this.emitState();
      };
      current.recorder.stop();
    });
  }

  private emitState() {
    this.renderer.container?.dispatchEvent(new CustomEvent('statechange', { detail: this.getState() }));
  }

  private updateGui() {
    this.gui?.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  private animate = (timestamp?: number) => {
    requestAnimationFrame(this.animate);
    const realDelta = Math.min(this.timer.update(timestamp).getDelta(), MAX_DELTA);
    // ジャグリング・体・揺れもの・まばたきはスピードに合わせてゆっくり/止まる。カメラの動きは実時間
    let delta = this.paused ? 0 : realDelta * this.options.speed;
    if (this.pendingStep > 0) {
      delta += this.pendingStep;
      this.pendingStep = 0;
    }

    try {
      if (this.vrm && this.body) {
        const frame = this.juggling.update(delta);
        this.body.update(frame, delta);
        if(frame.ballPositions && !this.body.hasPlannedSyncCycle && !this.paused){
          this.pause();
          this.showMessage('このモデルでは腕の姿勢をつなげられないため停止しました。配置を調整してください。',true);
        }
        this.blink.update(delta);
        this.facial.update();
        this.vrm.update(delta);
      }
      this.renderer.render(realDelta);
    } catch (e) {
      // 1 回のエラーでアニメーションが止まらないようにする
      if (!this.loggedError) console.error(e);
      this.loggedError = true;
    }
  };

  // ---- メッセージ表示 ----

  private createMessageArea(container: HTMLElement) {
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    const el = document.createElement('div');
    el.className = 'vrm-juggler-message';
    el.setAttribute('role', 'status');
    Object.assign(el.style, {
      position: 'absolute',
      left: '50%',
      bottom: '12px',
      transform: 'translateX(-50%)',
      width: 'max-content',
      maxWidth: 'min(640px, calc(100% - 24px))',
      boxSizing: 'border-box',
      padding: '10px 14px',
      borderRadius: '8px',
      font: '14px/1.6 sans-serif',
      color: '#fff',
      background: 'rgba(40, 40, 40, 0.85)',
      display: 'none',
      zIndex: '10',
    });
    container.appendChild(el);
    this.message = el;
  }

  private showMessage(text: string, isError = false) {
    if (!this.message) return;
    this.messageKind = isError ? 'error' : 'loading';
    this.message.textContent = text;
    this.message.style.background = isError ? 'rgba(170, 40, 40, 0.9)' : 'rgba(40, 40, 40, 0.85)';
    this.message.style.display = 'block';
  }

  private clearMessage() {
    this.messageKind = 'none';
    if (this.message) this.message.style.display = 'none';
  }

  private showSiteswapError(result: SiteswapCheck) {
    if (!this.message) return;
    this.showMessage(`「${result.siteswap}」は投げられません: ${result.message}`, true);
    if (result.suggestions && result.suggestions.length > 0) {
      const line = document.createElement('div');
      line.style.marginTop = '6px';
      line.appendChild(document.createTextNode('近いパターン: '));
      result.suggestions.forEach((s) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = s;
        Object.assign(button.style, {
          margin: '0 4px',
          padding: '2px 10px',
          border: '1px solid #fff',
          borderRadius: '4px',
          background: 'transparent',
          color: '#fff',
          font: 'inherit',
          cursor: 'pointer',
        });
        button.addEventListener('click', () => this.setSiteswap(s));
        line.appendChild(button);
      });
      this.message.appendChild(line);
    }
    const note = document.createElement('div');
    note.style.opacity = '0.8';
    note.textContent = `いまは「${this.juggling.currentSiteswap}」を続けています。`;
    this.message.appendChild(note);
  }

  // ---- パラメータ調整 UI ----

  private setOptions() {
    const result = this.juggling.setPattern(this.juggling.currentSiteswap, this.options.siteswap);
    if (result.ok) { this.prepareSyncBody(); this.syncTempo(); }
    else this.showSiteswapError(result);
  }

  /** 自動で決まったテンポを設定値(パネルの表示)に反映する */
  private syncTempo() {
    // パターンの高さが変わるので、頂点まで見えるようにカメラも合わせる
    this.renderer.frameHeight(Math.max(this.juggling.peakY,this.avatarTop));
    const siteswapOptions = this.options.siteswap;
    siteswapOptions.beatDuration = this.juggling.beatDuration;
    siteswapOptions.beatDurationAltitude = this.juggling.beatDuration.toFixed(3);
  }

  /** 高さ(テンポ)を手で変えたら自動テンポをやめる */
  private setManualTempo(beatDuration: number) {
    this.options.siteswap.beatDuration = beatDuration;
    this.options.autoTempo = false;
    this.juggling.autoTempo = false;
    this.setOptions();
  }

  private createGUI() {
    const options = this.options;
    const siteswapOptions = options.siteswap as any;
    this.gui = new GUI({ title: '詳細設定(Esc で閉じる)' });

    const siteswap = this.gui.addFolder('ジャグリング');
    siteswap
      .add(options, 'siteswapNums')
      .name('サイトスワップ')
      .onFinishChange((value: string) => this.setSiteswap(value));

    siteswap
      .add(siteswapOptions, 'beatDuration', 0.05, 0.5)
      .name('高さ')
      .listen()
      .onFinishChange((value: number) => this.setManualTempo(Number(value)));

    siteswap
      .add(options, 'autoTempo')
      .name('高さを自動で決める')
      .listen()
      .onChange((value: boolean) => {
        this.juggling.autoTempo = value;
        this.setOptions();
      });

    siteswap
      .add(options, 'speed', 0.05, 2)
      .name('スピード')
      .onChange((value: number) => this.setSpeed(Number(value)));

    siteswap
      .add(siteswapOptions.props[0], 'type', { Ball: 'ball', Club: 'club', Ring: 'ring', 'Ring (pancake)': 'pancake' })
      .name('小道具')
      .listen()
      .onFinishChange((value: string) => this.setProp(value));

    siteswap
      .add(siteswapOptions, 'dwellPath', {
        Cascade: '(30,10)(10)',
        'Reverse Cascade': '(10)(30)',
        Shower: '(30)(10).(10)(30)',
        Windmill: '(-20)(20).(20)(-20)',
        'Mills Mess': '(2.5)(-30).(-2.5)(30).(0)(-30)',
      })
      .name('Dwell')
      .listen()
      .onFinishChange(() => this.setOptions());

    const advanced = this.gui.addFolder('ジャグリング(高度な設定)');
    advanced
      .add(siteswapOptions, 'beatDurationAltitude')
      .name('高さ')
      .listen()
      .onFinishChange((value: string) => {
        const beatDuration = Number(value);
        if (beatDuration > 0) this.setManualTempo(beatDuration);
      });

    advanced
      .addColor(siteswapOptions, 'propsColor')
      .name('小道具の色')
      .onChange((value: string) => {
        siteswapOptions.props.forEach((prop: { color: string }) => (prop.color = value));
        this.setOptions();
      });

    advanced
      .add(siteswapOptions, 'propsRadius')
      .name('小道具の大きさ')
      .onFinishChange((value: string) => {
        const radius = Number(value);
        if (!(radius > 0)) return;
        siteswapOptions.props.forEach((prop: { radius: number }) => (prop.radius = radius));
        this.setOptions();
      });

    advanced
      .add(siteswapOptions, 'dwellPath')
      .name('Dwell')
      .listen()
      .onFinishChange(() => this.setOptions());

    ['dwellRatio', 'dwellCatchScale', 'dwellTossScale', 'emptyCatchScale', 'emptyTossScale'].forEach((key) => {
      advanced.add(siteswapOptions, key).onFinishChange((value: string) => {
        siteswapOptions[key] = Number(value);
        this.setOptions();
      });
    });

    advanced
      .add(siteswapOptions, 'armAngle', 0.0, 0.5)
      .name('肘の開き')
      .onFinishChange((value: number) => {
        if (this.body) this.body.armAngle = Number(value);
        this.setOptions();
      });

    advanced
      .addColor(options, 'backgroundColor')
      .name('背景色')
      .onChange((value: string) => this.setBackground(value));

    const surfaces = advanced.addFolder('surfaces');
    const surface = siteswapOptions.surfaces[0];
    ['x', 'y', 'z'].forEach((axis) =>
      surfaces
        .add(surface.position, axis)
        .name(`position:${axis}`)
        .onFinishChange(() => this.setOptions())
    );
    ['x', 'y', 'z'].forEach((axis) =>
      surfaces
        .add(surface.normal, axis)
        .name(`normal:${axis}`)
        .onFinishChange(() => this.setOptions())
    );
    surfaces
      .add(surface, 'scale')
      .name('scale')
      .onFinishChange(() => this.setOptions());
    surfaces
      .addColor(surface, 'color')
      .name('color')
      .onChange(() => this.setOptions());

    const emotions = this.gui.addFolder('表情');
    // VRM 1.0 の表情名(VRM 0.x の joy / sorrow / fun は three-vrm が happy / sad / relaxed に読み替える)
    const emotionNames: [string, string][] = [
      ['happy', '喜'],
      ['angry', '怒'],
      ['sad', '哀'],
      ['relaxed', '楽'],
    ];
    emotionNames.forEach(([key, name]) => emotions.add(options.facial.emotion, key, 0.0, 1.0).name(name));

    const mouth = this.gui.addFolder('口の形');
    const mouthNames: [string, string][] = [
      ['aa', 'あ'],
      ['ih', 'い'],
      ['ou', 'う'],
      ['ee', 'え'],
      ['oh', 'お'],
    ];
    mouthNames.forEach(([key, name]) => mouth.add(options.facial.mouth, key, 0.0, 1.0).name(name));

    this.gui
      .add(options, 'blink')
      .name('まばたき')
      .onChange((value: boolean) => {
        this.blink.enable = value;
      });

    this.gui
      .add(options, 'neck')
      .name('首の動き')
      .onChange((value: boolean) => {
        if (this.body) this.body.enableNeck = value;
      });

    this.gui
      .add(options, 'bodyMotion', 0, 2)
      .name('体の動き')
      .onChange((value: number) => this.setBodyMotion(Number(value)));

    // よく使う項目以外は閉じておく
    [advanced, surfaces, emotions, mouth].forEach((folder) => folder.close());
    if (!this.showGui) this.gui.hide();
  }

  private switchGUI = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' && e.keyCode !== 27) return;
    if (this.options.siteswap.syncBox) return;

    this.showGui = !this.showGui;

    if (this.showGui) {
      this.gui?.show();
    } else {
      this.gui?.hide();
    }
  };
}

declare global {
  interface Window {
    VRMJuggler: typeof VRMJuggler;
  }
}

window.VRMJuggler = window.VRMJuggler || VRMJuggler;
