import * as THREE from 'three';

import options from '../../interface/options';
import { CreateSiteswap } from './Siteswap';
import {
  AvatarMetrics,
  DEFAULT_METRICS,
  LEFT,
  RIGHT,
  SpaceTransform,
  Tracks,
  ThrowEvent,
  buildTracks,
  propBaseQuaternion,
  makeTransform,
  sampleTrack,
  transformPoint,
} from './tracks';
import { SiteswapCheck, isVanilla, precheckSiteswap, translateGunswapError } from './validate';
import { autoBeatDuration } from './tempo';
import { buildNaturalTracks, isNaturalSupported } from './natural';
import { buildSyncBoxTracks, inspectSyncBox, SyncBoxTracks, SyncMovementAdjustment, SyncFlightAdjustment, syncBeat, syncDwell } from './sync-box';
import {captureSyncTracks,SyncReplay} from './sync-replay';

export interface HandState {
  /** ボールを持っている時はボールの中心、持っていない時は手の基準位置(ワールド座標) */
  position: THREE.Vector3;
  /** 手のひらが向くべき方向(ワールド座標の単位ベクトル) */
  palmNormal: THREE.Vector3;
  holding: boolean;
  /** 指先の向きの指定(長さ 0 なら体の側で決める) */
  fingerDir: THREE.Vector3;
  elbowPole?: THREE.Vector3;
}

export interface JugglingFrame {
  contactFallback?:boolean;
  /** Previously checked elbow positions, used only by immutable segment replay. */
  fixedElbows?: THREE.Vector3[];
  /** 同期版の肘の経路を、実際の球の位置に合わせて解く。 */
  ballPositions?: THREE.Vector3[];
  phase?: number;
  armOrder?: number | null;
  underarm?: {hand:number;position:THREE.Vector3}[];
  constraintPhases?: number[];
  hands: HandState[]; // [LEFT, RIGHT]
  /** 経過拍数(整数部分が拍、小数部分が拍の中の位置) */
  beat: number;
  /** 視線を向ける先(パターンの頂点付近) */
  gazeTarget: THREE.Vector3;
  /** 小道具の半径(手のひらとボールの距離に使う) */
  propRadius: number;
  /** 目で追う位置(次にキャッチするボールの頂点付近) */
  eyeTarget: THREE.Vector3;
  /** 前のフレームからの間に行われた投げ */
  throws: ThrowEvent[];
  /** 小道具の種類('ball' | 'club' | 'ring' | 'pancake') */
  propType: string;
}

// 手のひらと握る位置の距離(クラブのハンドル・リングの縁の太さ)
const GRIP_RADIUS: { [type: string]: number } = { club: 0.018, ring: 0.01, pancake: 0.01 };

const RANDOM_COLORS = ['red', 'blue', 'green', 'black', 'yellow', 'purple'];

// 視線はパターンの頂点より少し下を見る
const GAZE_BELOW_PEAK = 0.05;

// 床で跳ねる時間が足りない時に、テンポをどこまで遅くして試すか(1.25 倍ずつ 6 回で約 3.8 倍)
const BOUNCE_ERROR = 'Unable to calculate bounce path';
const BOUNCE_TEMPO_STEP = 1.25;
const BOUNCE_TEMPO_TRIES = 6;

// リングを投げる時のテンポ(1 拍の長さ)の倍率。3 リングで頂点が肩の 60cm ほど上になる
const RING_TEMPO_SCALE = 1.2;

export default class Juggling {
  private scene: THREE.Scene;
  private siteswapStr: string;
  private options: options;
  private motionBlur: boolean;

  private siteswap: any;
  private tracks!: Tracks;
  private syncTracks?: SyncBoxTracks;
  private syncReplay?:SyncReplay;
  private pathGroup = new THREE.Group();
  private showPaths = false;
  private metrics: AvatarMetrics = DEFAULT_METRICS;
  private transform: SpaceTransform = makeTransform(DEFAULT_METRICS);

  private surfaceMeshes: THREE.Mesh[] = [];
  private propMeshes: THREE.Mesh[][] = [];
  private group: THREE.Group;

  private time = 0;
  public speed = 1;
  /** true の時はパターンに合わせてテンポ(1 拍の秒数)を自動で決める */
  public autoTempo = true;

  private frame: JugglingFrame;
  private tmpQuaternion = new THREE.Quaternion();

  constructor(scene: THREE.Scene, siteswapStr: string, options: options, motionBlur: boolean = false) {
    this.scene = scene;
    this.siteswapStr = siteswapStr;
    this.options = options;
    this.motionBlur = motionBlur;

    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.group.add(this.pathGroup);

    this.frame = {
      hands: [LEFT, RIGHT].map(() => ({
        position: new THREE.Vector3(),
        palmNormal: new THREE.Vector3(0, 1, 0),
        fingerDir: new THREE.Vector3(),
        holding: false,
      })),
      beat: 0,
      gazeTarget: new THREE.Vector3(),
      propRadius: 0.05,
      eyeTarget: new THREE.Vector3(),
      throws: [],
      propType: 'ball',
    };

    const result = this.setPattern(siteswapStr, options);
    if (!result.ok) {
      // 初期値が不正な場合は 3 ボールカスケードで始める
      this.setPattern('3', options);
    }
  }

  set visible(value: boolean) {
    this.group.visible = value;
  }

  /** パターンの一番高い位置(ワールド座標の y) */
  get peakY(): number {
    return this.syncReplay?.peakY??this.tracks.peakY;
  }

  get currentSiteswap() {
    return this.siteswapStr;
  }

  /** 再生中のパターンの 1 拍の秒数 */
  get beatDuration(): number {
    return this.siteswap.beatDuration;
  }

  /**
   * パターンを切り替える。投げられないパターンの場合は何も変えずにエラー内容を返す。
   */
  setPattern(input: string, options: options): SiteswapCheck {
    const check = precheckSiteswap(input);
    if (!check.ok) return check;

    // gunswap は options.props をボールの数に合わせて増減させるので、再生中のパターンに影響しないようコピーを渡す
    const create = (beatDuration: number) =>
      CreateSiteswap(check.siteswap, {
        ...options,
        beatDuration,
        dwellRatio:options.syncBox ? syncDwell(options.syncBox) : options.dwellRatio,
        props: (options.props || []).map((prop) => ({ ...prop })),
      });
    // リングは大きいので、ボールより高く(ゆっくり)投げる
    const propType = options.props?.[0]?.type;
    const tempoScale = propType === 'ring' || propType === 'pancake' ? RING_TEMPO_SCALE : 1;
    let beatDuration: number;
    try { beatDuration = options.syncBox ? syncBeat(options.syncBox) : this.autoTempo
      ? autoBeatDuration(check.siteswap, Number(options.dwellRatio)) * tempoScale
      : Number(options.beatDuration);
    } catch (error) { return {ok:false,siteswap:check.siteswap,message:(error as Error).message}; }
    let siteswap = create(beatDuration);
    // 自動テンポで床で跳ねる時間が足りない時(2 回跳ねる、上へ投げて跳ねさせる…)は、ゆっくりにして試す
    for (let i = 0; this.autoTempo && siteswap.errorMessage === BOUNCE_ERROR && i < BOUNCE_TEMPO_TRIES; i++) {
      beatDuration *= BOUNCE_TEMPO_STEP;
      siteswap = create(beatDuration);
    }
    if (siteswap.errorMessage || !siteswap.validPattern || !siteswap.propPositions) {
      const result: SiteswapCheck = {
        ok: false,
        siteswap: check.siteswap,
        message: translateGunswapError(siteswap.errorMessage || 'Invalid syntax'),
      };
      // "A" のように大文字で書かれた 10 以上の投げ
      const lower = check.siteswap.toLowerCase();
      if (lower !== check.siteswap && isVanilla(lower)) {
        const lowerCheck = precheckSiteswap(lower);
        result.message += ' 10 以上の投げのつもりなら小文字で書きます(a = 10, b = 11 …)。';
        result.suggestions = lowerCheck.ok ? [lower] : lowerCheck.suggestions;
      }
      return result;
    }

    let syncTracks: SyncBoxTracks | undefined;
    if (options.syncBox) {
      try { syncTracks = buildSyncBoxTracks(siteswap, makeTransform(this.metrics), options.syncBox); }
      catch (error) {
        return { ok: false, siteswap: check.siteswap, message: error instanceof Error ? error.message : '同期動作を作成できません。' };
      }
    }
    const changed = check.siteswap !== this.siteswapStr || !this.siteswap;
    this.siteswapStr = check.siteswap;
    this.options = options;
    this.siteswap = siteswap;
    this.rebuild(syncTracks);
    if (changed) this.time = 0;
    return { ok: true, siteswap: check.siteswap };
  }

  /** アバターの体格に合わせて軌道を変換し直す */
  setAvatarMetrics(metrics: AvatarMetrics) {
    this.metrics = metrics;
    this.rebuild();
  }

  private rebuild(prebuiltSync?: SyncBoxTracks) {
    this.syncReplay=undefined;
    this.transform = makeTransform(this.metrics);
    const prop = this.siteswap.props[0];
    const radius = Number(prop.radius) || 0.05;
    let tracks: Tracks | undefined;
    this.syncTracks = this.options.syncBox ? prebuiltSync || buildSyncBoxTracks(this.siteswap, this.transform, this.options.syncBox) : undefined;
    if (this.syncTracks) tracks = this.syncTracks;
    else if (isNaturalSupported(this.siteswap)) {
      try {
        tracks = buildNaturalTracks(this.siteswap, this.transform, prop.type, prop.type === 'ball' ? radius : 0.03);
      } catch (e) {
        // 自前で解けない軌道(跳ね方が合わないバウンドなど)は gunswap の軌道で表示する
        console.warn(e);
      }
    }
    this.tracks = tracks || buildTracks(this.siteswap, this.transform);
    this.drawProps();
    this.drawSurfaces();
    this.drawPaths();
  }

  setPathsVisible(visible: boolean) {
    this.showPaths = visible;
    this.pathGroup.visible = visible&&!this.syncReplay;
  }

  private drawPaths() {
    this.pathGroup.children.slice().forEach(object => {
      const line = object as THREE.Line;
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      this.pathGroup.remove(line);
    });
    // Plot flight segments only; connecting held segments disguises the column/2 distinction.
    this.syncTracks?.flights.forEach(f => {
      const points = Array.from({ length: 65 }, (_, k) => {
        const t = f.duration * k / 64;
        const p = f.start.clone().addScaledVector(f.velocity, t);
        p.y -= 9.8 * t * t / 2;
        return p;
      });
      this.pathGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({
        color: f.value === 4 ? '#536ac5' : '#e77728', transparent: true, opacity: 0.42,
      })));
    });
    this.pathGroup.visible = this.showPaths;
  }

  seek(fraction: number) {
    if (Number.isFinite(fraction)) this.time = ((fraction % 1) + 1) % 1 * (this.syncReplay?.period??this.tracks.period);
  }

  captureSyncMotion(){
    if(!this.syncTracks||this.syncReplay)throw new Error('通常のセット列を検査してから接続部品に登録してください。');
    return captureSyncTracks(this.syncTracks,this.siteswap.beatDuration,this.frame.propRadius);
  }

  setSyncReplay(replay:SyncReplay){
    if(replay.balls!==this.propMeshes.length)throw new Error('再生中の球数と接続部品の球数が異なります。');
    this.syncReplay=replay;this.time=0;this.pathGroup.visible=false;
  }
  get activeSyncReplay(){return this.syncReplay;}

  /** Restore a preview after checking candidate sources; retain its exact tracks. */
  capturePlaybackRestore(){
    const saved={siteswapStr:this.siteswapStr,options:structuredClone(this.options),siteswap:this.siteswap,
      tracks:this.tracks,syncTracks:this.syncTracks,syncReplay:this.syncReplay,time:this.time};
    return ()=>{
      Object.assign(this,saved);this.drawProps();this.drawSurfaces();this.drawPaths();
      this.pathGroup.visible=this.showPaths&&!this.syncReplay;this.update(0);
    };
  }

  getSyncBoxReport() {
    return this.syncTracks && !this.syncReplay ? inspectSyncBox(this.syncTracks, this.transform, this.frame.propRadius) : null;
  }

  /** Search the held/empty movements without replacing the user's throw definition. */
  replanSyncMovement(movement:SyncMovementAdjustment[],placement:[number,number]=[0,0],timing:[number,number]=[1,1],columnHeight=0,flightAdjustments:SyncFlightAdjustment[]=[]){
    if(!this.options.syncBox)throw new Error('同期動作がありません。');
    const tracks=buildSyncBoxTracks(this.siteswap,this.transform,this.options.syncBox,movement,placement,timing,columnHeight,flightAdjustments);
    this.syncTracks=tracks;this.tracks=tracks;this.syncReplay=undefined;
    return tracks;
  }
  getSyncMovement(){return this.syncTracks;}
  commitSyncPlan(){this.drawPaths();}
  getSyncTransform(){return makeTransform(this.metrics);}

  getSyncProgram() {
    if(this.syncReplay)return null;
    const t=this.syncTracks;
    if(!t) return null;
    const elapsed=(a:number,b:number)=>((a-b)%t.period+t.period)%t.period;
    return {period:t.period,flights:t.flights.map(f=>{
      const catchTime=(f.release+f.duration)%t.period;
      const next=t.flights.filter(n=>n.prop===f.prop && n.throwHand===f.catchHand).sort((a,b)=>elapsed(a.release,catchTime)-elapsed(b.release,catchTime))[0];
      return {prop:f.prop,hand:f.throwHand,catchHand:f.catchHand,value:f.value,style:f.style,
      release:{time:f.release,position:f.start.toArray(),relation:f.motion.release.relation||'free',grip:f.releaseGrip},
      passage:{time:f.passage.time,position:f.passage.position.toArray()},
      catch:{time:catchTime,position:f.end.toArray(),relation:f.motion.catch.relation||'free',grip:f.catchGrip},
      carry:next?{from:catchTime,duration:elapsed(next.release,catchTime),end:next.start.toArray(),route:f.motion.carry}:undefined
    };}).sort((a,b)=>a.release.time-b.release.time),transitions:t.transitions};
  }

  getMotionSnapshot() {
    const period=this.syncReplay?.period??this.tracks.period;
    return { phase: this.time / period, period,reusingSegments:!!this.syncReplay,
      balls: this.propMeshes.map(m => m[0].position.toArray()),
      hands: this.frame.hands.map(h => ({ position: h.position.toArray(), holding: h.holding })) };
  }

  private drawSurfaces() {
    this.surfaceMeshes.forEach((mesh) => {
      this.group.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
    this.surfaceMeshes = [];

    // 床(影を受ける面)は Renderer が用意している。バウンドするパターンの時だけ跳ねる面を表示する
    const bounces = this.siteswap.propOrbits.some((orbit: any[]) => orbit.some((toss) => toss.numBounces > 0));
    if (!bounces) return;

    this.siteswap.surfaces.forEach((a: any) => {
      const position = transformPoint(a.position, this.transform, new THREE.Vector3());
      const axis1 = new THREE.Vector3(a.axis1.x, a.axis1.y, a.axis1.z);
      const axis2 = new THREE.Vector3(a.axis2.x, a.axis2.y, a.axis2.z);

      const corners = [
        position.clone().add(axis1).add(axis2),
        position.clone().sub(axis1).add(axis2),
        position.clone().sub(axis1).sub(axis2),
        position.clone().add(axis1).sub(axis2),
      ];
      const geometry = new THREE.BufferGeometry().setFromPoints(corners);
      // 2 つの三角形の向きを揃え、表を跳ねる側(法線の向き)へ向ける(向きがばらばらだと法線が打ち消し合って暗く写る)
      const normal = new THREE.Vector3(a.normal.x, a.normal.y, a.normal.z);
      const face = new THREE.Vector3().crossVectors(corners[1].clone().sub(corners[0]), corners[2].clone().sub(corners[0]));
      geometry.setIndex(face.dot(normal) >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
      geometry.computeVertexNormals();

      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: a.color ? a.color : 'grey',
          side: THREE.DoubleSide,
          roughness: 0.9,
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
        })
      );
      mesh.receiveShadow = true;
      this.surfaceMeshes.push(mesh);
      this.group.add(mesh);
    });
  }

  /**
   * 小道具のモデル。クラブは白いハンドルと色付きの胴(2 つのメッシュ)、リングは薄く平たい輪、ボールは布っぽい質感。
   * クラブのモデル座標は重心が原点、ノブ側が -y(natural.ts の握る位置と合わせている)。
   */
  private createPropMesh(prop: any, color: string, opacity: number): THREE.Mesh {
    const transparent = opacity < 1;
    const material = (params: THREE.MeshStandardMaterialParameters) =>
      new THREE.MeshStandardMaterial({ ...params, transparent, opacity });

    if (prop.type == 'club') {
      const lathe = (points: [number, number][]) =>
        new THREE.LatheGeometry(
          points.map(([r, y]) => new THREE.Vector2(r, y)),
          20
        );
      // [半径, 高さ](m)。ノブ → ハンドル
      const handle = lathe([
        [0, -0.2],
        [0.02, -0.198],
        [0.023, -0.19],
        [0.02, -0.182],
        [0.012, -0.176],
        [0.012, -0.12],
        [0.014, -0.05],
        [0.016, -0.02],
      ]);
      // 胴 → 先端
      const body = lathe([
        [0.016, -0.02],
        [0.026, 0.03],
        [0.038, 0.1],
        [0.041, 0.15],
        [0.038, 0.21],
        [0.028, 0.27],
        [0.02, 0.3],
        [0, 0.302],
      ]);
      const mesh = new THREE.Mesh(body, material({ color, roughness: 0.35 }));
      const handleMesh = new THREE.Mesh(handle, material({ color: '#f4f4f4', roughness: 0.5 }));
      mesh.add(handleMesh);
      mesh.castShadow = handleMesh.castShadow = !transparent;
      return mesh;
    }
    // パンケーキもリングと同じ形(投げ方だけが違う)
    if (prop.type == 'ring' || prop.type == 'pancake') {
      const points = [
        [0.13, 0.003],
        [0.16, 0.003],
        [0.16, -0.003],
        [0.13, -0.003],
        [0.13, 0.003],
      ].map(([r, y]) => new THREE.Vector2(r, y));
      const mesh = new THREE.Mesh(
        new THREE.LatheGeometry(points, 64),
        material({ color, roughness: 0.45, side: THREE.DoubleSide })
      );
      mesh.castShadow = !transparent;
      return mesh;
    }
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(Number(prop.radius) || 0.05, 32, 20),
      material({ color, roughness: 0.85 })
    );
    mesh.castShadow = !transparent;
    return mesh;
  }

  private drawProps() {
    this.propMeshes.forEach((meshes) =>
      meshes.forEach((mesh) => {
        this.group.remove(mesh);
        mesh.geometry.dispose();
        mesh.traverse((object) => {
          const m = object as THREE.Mesh;
          if (!m.isMesh) return;
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        });
      })
    );
    this.propMeshes = [];

    const numTails = this.motionBlur ? 2 : 0;
    for (let i = 0; i < this.siteswap.numProps; i++) {
      const prop = this.siteswap.props[i];
      const color = prop.color == 'random' ? RANDOM_COLORS[i % RANDOM_COLORS.length] : prop.color;
      const meshes: THREE.Mesh[] = [];
      for (let j = 0; j <= numTails; j++) {
        const mesh = this.createPropMesh(prop, color, j == 0 ? 1 : 1 - (1 / (numTails + 1)) * j);
        this.group.add(mesh);
        meshes.push(mesh);
      }
      this.propMeshes.push(meshes);
    }

    const first = this.siteswap.props[0];
    this.frame.propType = first.type;
    this.frame.propRadius = first.type == 'ball' ? Number(first.radius) || 0.05 : GRIP_RADIUS[first.type] || 0.02;
  }

  /** 毎フレーム呼ぶ。delta は秒 */
  update(delta: number): JugglingFrame {
    if(this.syncReplay){
      this.time=((this.time+delta*this.speed)%this.syncReplay.period+this.syncReplay.period)%this.syncReplay.period;
      this.frame=this.syncReplay.sample(this.time);
      this.propMeshes.forEach((meshes,i)=>meshes.forEach(mesh=>{mesh.position.copy(this.frame.ballPositions![i]);}));
      return this.frame;
    }
    this.frame.fixedElbows=undefined;
    const tracks = this.tracks;
    const previousTime = this.time;
    const advance = delta * this.speed;
    this.time = (this.time + advance) % tracks.period;

    // この間に行われた投げ(周期の境目をまたぐ場合も含む)
    this.frame.throws = tracks.throws.filter((t) => {
      const since = (((t.time - previousTime) % tracks.period) + tracks.period) % tracks.period;
      return since > 0 && since <= advance;
    });
    const stepFloat = (this.time / tracks.period) * tracks.numSteps;
    const step = Math.floor(stepFloat) % tracks.numSteps;

    this.updateProps(stepFloat);
    this.frame.ballPositions = this.syncTracks ? this.propMeshes.map(meshes => meshes[0].position.clone()) : undefined;
    this.frame.phase = this.time / tracks.period;
    const orderEvents=this.syncTracks?.armOrderEvents||[];
    this.frame.armOrder = orderEvents.find(e=>Math.min(Math.abs(e.time-this.time),tracks.period-Math.abs(e.time-this.time))<1e-7)?.upperHand??this.syncTracks?.armOrders[step]??null;
    // These constraints apply at the event, not before the hand reaches it.
    // The body planner adds each exact event time to its pose keys.
    this.frame.constraintPhases=this.syncTracks?[...this.syncTracks.underarmEvents,...orderEvents].map(e=>e.time/tracks.period):undefined;
    this.frame.underarm=this.syncTracks?.underarmEvents.filter(e=>{
      const elapsed=Math.abs(e.time-this.time);
      return Math.min(elapsed,tracks.period-elapsed)<1e-7;
    });

    [LEFT, RIGHT].forEach((h) => {
      const hand = this.frame.hands[h];
      const track = tracks.hands[h];
      sampleTrack(track.positions, stepFloat, hand.position);
      sampleTrack(track.palmNormals, stepFloat, hand.palmNormal).normalize();
      hand.holding = track.holding[step];
      if (track.fingerDirs) {
        sampleTrack(track.fingerDirs, stepFloat, hand.fingerDir);
        // Independently interpolated axes can lose orthogonality during a fast
        // claw turn. Keep the requested hand frame consistent with the rig.
        hand.fingerDir.addScaledVector(hand.palmNormal,-hand.fingerDir.dot(hand.palmNormal)).normalize();
      }
      else hand.fingerDir.set(0, 0, 0);
      hand.elbowPole = track.elbowPoles ? sampleTrack(track.elbowPoles, stepFloat, hand.elbowPole || new THREE.Vector3()).normalize() : undefined;
    });

    this.frame.beat = this.time / this.siteswap.beatDuration;
    this.frame.gazeTarget.set(0, tracks.peakY - GAZE_BELOW_PEAK, tracks.centerZ);
    this.frame.eyeTarget.copy(tracks.gaze[step]);
    return this.frame;
  }

  private updateProps(stepFloat: number) {
    const tracks = this.tracks;
    const tailGap = Math.floor(this.siteswap.numStepsPerBeat / 8);
    const baseRotation = propBaseQuaternion(this.frame.propType);

    for (let i = 0; i < this.propMeshes.length; i++) {
      for (let j = 0; j < this.propMeshes[i].length; j++) {
        const mesh = this.propMeshes[i][j];
        let s = stepFloat - j * tailGap;
        if (s < 0) s += tracks.numSteps;
        sampleTrack(tracks.props[i], s, mesh.position);

        const i0 = Math.floor(s) % tracks.numSteps;
        const i1 = (i0 + 1) % tracks.numSteps;
        if (tracks.propRotations) {
          mesh.quaternion.copy(tracks.propRotations[i][i0]).slerp(tracks.propRotations[i][i1], s - Math.floor(s));
          continue;
        }
        this.tmpQuaternion
          .copy(this.siteswap.propRotations[i][i0])
          .slerp(this.siteswap.propRotations[i][i1], s - Math.floor(s));

        mesh.quaternion.copy(baseRotation).premultiply(this.tmpQuaternion);
      }
    }
  }

  dispose() {
    this.pathGroup.children.forEach(object => {
      const line = object as THREE.Line;
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    });
    this.propMeshes.forEach((meshes) => meshes.forEach((m) => m.geometry.dispose()));
    this.surfaceMeshes.forEach((m) => m.geometry.dispose());
    this.scene.remove(this.group);
  }
}
