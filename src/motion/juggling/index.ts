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
  buildTracks,
  makeTransform,
  sampleTrack,
  transformPoint,
} from './tracks';
import { SiteswapCheck, isVanilla, precheckSiteswap, translateGunswapError } from './validate';

export interface HandState {
  /** ボールを持っている時はボールの中心、持っていない時は手の基準位置(ワールド座標) */
  position: THREE.Vector3;
  /** 手のひらが向くべき方向(ワールド座標の単位ベクトル) */
  palmNormal: THREE.Vector3;
  holding: boolean;
}

export interface JugglingFrame {
  hands: HandState[]; // [LEFT, RIGHT]
  /** 経過拍数(整数部分が拍、小数部分が拍の中の位置) */
  beat: number;
  /** 視線を向ける先(パターンの頂点付近) */
  gazeTarget: THREE.Vector3;
  /** 小道具の半径(手のひらとボールの距離に使う) */
  propRadius: number;
  /** 一番高い位置にある小道具(目線で追う) */
  highestProp: THREE.Vector3;
}

const RANDOM_COLORS = ['red', 'blue', 'green', 'black', 'yellow', 'purple'];

// 視線はパターンの頂点より少し下を見る
const GAZE_BELOW_PEAK = 0.05;

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
        holding: false,
      })),
      beat: 0,
      gazeTarget: new THREE.Vector3(),
      propRadius: 0.05,
      highestProp: new THREE.Vector3(),
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

  get currentSiteswap() {
    return this.siteswapStr;
  }

  /**
   * パターンを切り替える。投げられないパターンの場合は何も変えずにエラー内容を返す。
   */
  setPattern(input: string, options: options): SiteswapCheck {
    const check = precheckSiteswap(input);
    if (!check.ok) return check;

    // gunswap は options.props をボールの数に合わせて増減させるので、再生中のパターンに影響しないようコピーを渡す
    const siteswap = CreateSiteswap(check.siteswap, {
      ...options,
      props: (options.props || []).map((prop) => ({ ...prop })),
    });
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
    this.tracks = buildTracks(this.siteswap, this.transform);
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

    this.siteswap.surfaces.forEach((a: any) => {
      const position = transformPoint(a.position, this.transform, new THREE.Vector3());
      const axis1 = new THREE.Vector3(a.axis1.x, a.axis1.y, a.axis1.z);
      const axis2 = new THREE.Vector3(a.axis2.x, a.axis2.y, a.axis2.z);

      const geometry = new THREE.Geometry();
      geometry.vertices.push(position.clone().add(axis1).add(axis2));
      geometry.vertices.push(position.clone().sub(axis1).add(axis2));
      geometry.vertices.push(position.clone().sub(axis1).sub(axis2));
      geometry.vertices.push(position.clone().add(axis1).sub(axis2));
      geometry.faces.push(new THREE.Face3(0, 1, 2));
      geometry.faces.push(new THREE.Face3(2, 0, 3));

      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ color: a.color ? a.color : 'grey', side: THREE.DoubleSide })
      );
      this.surfaceMeshes.push(mesh);
      this.group.add(mesh);
    });
  }

  private createPropGeometry(prop: any): THREE.Geometry {
    if (prop.type == 'club') {
      const geometry = new THREE.CylinderGeometry(0.008, 0.02, 0.02, 7, 5);
      geometry.vertices.forEach((v) => (v.y += 0.01));
      const clubHandle = new THREE.CylinderGeometry(0.015, 0.008, 0.18, 7, 5);
      clubHandle.vertices.forEach((v) => (v.y += 0.11));
      const clubBody1 = new THREE.CylinderGeometry(0.04, 0.015, 0.18, 7, 5);
      clubBody1.vertices.forEach((v) => (v.y += 0.29));
      const clubBody2 = new THREE.CylinderGeometry(0.02, 0.04, 0.11, 7, 5);
      clubBody2.vertices.forEach((v) => (v.y += 0.43));
      geometry.merge(clubHandle);
      geometry.merge(clubBody1);
      geometry.merge(clubBody2);
      // 重心が原点に来るように下げる
      geometry.vertices.forEach((v) => (v.y -= 0.2));
      return geometry;
    }
    if (prop.type == 'ring') {
      const points = [
        new THREE.Vector2(0.14, 0.01),
        new THREE.Vector2(0.18, 0.01),
        new THREE.Vector2(0.18, -0.01),
        new THREE.Vector2(0.14, -0.01),
        new THREE.Vector2(0.14, 0.01),
      ];
      return new THREE.LatheGeometry(points);
    }
    return new THREE.SphereGeometry(Number(prop.radius) || 0.05, 20, 16);
  }

  private drawProps() {
    this.propMeshes.forEach((meshes) =>
      meshes.forEach((mesh) => {
        this.group.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      })
    );
    this.propMeshes = [];

    const numTails = this.motionBlur ? 2 : 0;
    for (let i = 0; i < this.siteswap.numProps; i++) {
      const prop = this.siteswap.props[i];
      const color = prop.color == 'random' ? RANDOM_COLORS[i % RANDOM_COLORS.length] : prop.color;
      const meshes: THREE.Mesh[] = [];
      for (let j = 0; j <= numTails; j++) {
        const material = new THREE.MeshLambertMaterial(
          j == 0 ? { color } : { color, transparent: true, opacity: 1 - (1 / (numTails + 1)) * j }
        );
        const mesh = new THREE.Mesh(this.createPropGeometry(prop), material);
        this.group.add(mesh);
        meshes.push(mesh);
      }
      this.propMeshes.push(meshes);
    }

    const first = this.siteswap.props[0];
    this.frame.propRadius = first.type == 'ball' ? Number(first.radius) || 0.05 : 0.02;
  }

  /** 毎フレーム呼ぶ。delta は秒 */
  update(delta: number): JugglingFrame {
    const tracks = this.tracks;
    this.time = (this.time + delta * this.speed) % tracks.period;
    const stepFloat = (this.time / tracks.period) * tracks.numSteps;
    const step = Math.floor(stepFloat) % tracks.numSteps;

    this.updateProps(stepFloat);

    [LEFT, RIGHT].forEach((h) => {
      const hand = this.frame.hands[h];
      const track = tracks.hands[h];
      sampleTrack(track.positions, stepFloat, hand.position);
      sampleTrack(track.palmNormals, stepFloat, hand.palmNormal).normalize();
      hand.holding = track.holding[step];
    });

    this.frame.beat = this.time / this.siteswap.beatDuration;
    this.frame.gazeTarget.set(0, tracks.peakY - GAZE_BELOW_PEAK, tracks.centerZ);
    return this.frame;
  }

  private updateProps(stepFloat: number) {
    const tracks = this.tracks;
    const tailGap = Math.floor(this.siteswap.numStepsPerBeat / 8);
    const ringRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);

    for (let i = 0; i < this.propMeshes.length; i++) {
      for (let j = 0; j < this.propMeshes[i].length; j++) {
        const mesh = this.propMeshes[i][j];
        let s = stepFloat - j * tailGap;
        if (s < 0) s += tracks.numSteps;
        sampleTrack(tracks.props[i], s, mesh.position);

        const i0 = Math.floor(s) % tracks.numSteps;
        const i1 = (i0 + 1) % tracks.numSteps;
        this.tmpQuaternion
          .copy(this.siteswap.propRotations[i][i0])
          .slerp(this.siteswap.propRotations[i][i1], s - Math.floor(s));

        mesh.quaternion.set(1, 0, 0, 0);
        if (this.siteswap.props[i].type == 'ring') mesh.quaternion.multiply(ringRotation);
        mesh.quaternion.premultiply(this.tmpQuaternion);
      }
      const head = this.propMeshes[i][0];
      if (i === 0 || head.position.y > this.frame.highestProp.y) this.frame.highestProp.copy(head.position);
    }
  }

  dispose() {
    this.propMeshes.forEach((meshes) => meshes.forEach((m) => m.geometry.dispose()));
    this.surfaceMeshes.forEach((m) => m.geometry.dispose());
    this.scene.remove(this.group);
  }
}
