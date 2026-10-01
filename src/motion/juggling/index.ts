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

export interface HandState {
  /** ボールを持っている時はボールの中心、持っていない時は手の基準位置(ワールド座標) */
  position: THREE.Vector3;
  /** 手のひらが向くべき方向(ワールド座標の単位ベクトル) */
  palmNormal: THREE.Vector3;
  holding: boolean;
  /** 指先の向きの指定(長さ 0 なら体の側で決める) */
  fingerDir: THREE.Vector3;
}

export interface JugglingFrame {
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

export default class Juggling {
  private scene: THREE.Scene;
  private siteswapStr: string;
  private options: options;
  private motionBlur: boolean;

  private siteswap: any;
  private tracks!: Tracks;
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
    return this.tracks.peakY;
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
        props: (options.props || []).map((prop) => ({ ...prop })),
      });
    let beatDuration = this.autoTempo
      ? autoBeatDuration(check.siteswap, Number(options.dwellRatio))
      : Number(options.beatDuration);
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

    const changed = check.siteswap !== this.siteswapStr || !this.siteswap;
    this.siteswapStr = check.siteswap;
    this.options = options;
    this.siteswap = siteswap;
    this.rebuild();
    if (changed) this.time = 0;
    return { ok: true, siteswap: check.siteswap };
  }

  /** アバターの体格に合わせて軌道を変換し直す */
  setAvatarMetrics(metrics: AvatarMetrics) {
    this.metrics = metrics;
    this.rebuild();
  }

  private rebuild() {
    this.transform = makeTransform(this.metrics);
    const prop = this.siteswap.props[0];
    const radius = Number(prop.radius) || 0.05;
    let tracks: Tracks | undefined;
    if (isNaturalSupported(this.siteswap)) {
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

    [LEFT, RIGHT].forEach((h) => {
      const hand = this.frame.hands[h];
      const track = tracks.hands[h];
      sampleTrack(track.positions, stepFloat, hand.position);
      sampleTrack(track.palmNormals, stepFloat, hand.palmNormal).normalize();
      hand.holding = track.holding[step];
      if (track.fingerDirs) sampleTrack(track.fingerDirs, stepFloat, hand.fingerDir).normalize();
      else hand.fingerDir.set(0, 0, 0);
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
    this.propMeshes.forEach((meshes) => meshes.forEach((m) => m.geometry.dispose()));
    this.surfaceMeshes.forEach((m) => m.geometry.dispose());
    this.scene.remove(this.group);
  }
}
