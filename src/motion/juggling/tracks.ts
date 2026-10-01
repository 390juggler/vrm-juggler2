import * as THREE from 'three';

/**
 * gunswap が計算した軌道(ボール・手)を、アバターの体格に合わせた座標に変換し、
 * 毎フレーム参照しやすい形(手のひらの向き・ボールを持っているか)に前計算する。
 */

export const LEFT = 0;
export const RIGHT = 1;

export const GRAVITY = 9.8;

// gunswap の想定する体格(Siteswap.js の getDwellPosition / getElbowPosition より)
const GUNSWAP_HAND_Y = 1.15;
const GUNSWAP_ARM_LENGTH = 0.6;

// 肘を垂らした高さから、手の基準位置をどれだけ上げるか(m)
const HAND_ABOVE_ELBOW = 0.03;

export interface AvatarMetrics {
  shoulderY: number;
  /** 肩(上腕の付け根)の体の中心からの横距離 */
  shoulderX: number;
  shoulderZ: number;
  upperArmLength: number;
  armLength: number;
}

// 変換が恒等になる体格(gunswap の元の体格)
export const DEFAULT_METRICS: AvatarMetrics = {
  shoulderY: GUNSWAP_HAND_Y + GUNSWAP_ARM_LENGTH / 2 - HAND_ABOVE_ELBOW,
  shoulderX: 0.225,
  shoulderZ: 0,
  upperArmLength: GUNSWAP_ARM_LENGTH / 2,
  armLength: GUNSWAP_ARM_LENGTH,
};

/**
 * 横方向(x,z)は腕の長さに合わせて縮尺し、縦方向は平行移動だけにする。
 * 縦を縮尺すると見かけの重力が変わってしまうが、横の縮尺と縦の平行移動なら放物線のまま保たれる。
 */
export interface SpaceTransform {
  horizontalScale: number;
  offsetY: number;
  /** 左右の肩の位置(ワールド座標)と、肩から手(ボールの中心)までの届く距離 */
  shoulders: THREE.Vector3[];
  reach: number;
}

// 肩から手(ボールの中心)までの距離の上限(腕の長さに対する割合)。伸び切ると手首の向きが不自然になる
const REACH_SHARE = 0.97;

/** ボールを持っていない時の手の基準の高さ(ワールド座標) */
export function handBaseY(metrics: AvatarMetrics): number {
  return metrics.shoulderY - metrics.upperArmLength + HAND_ABOVE_ELBOW;
}

export function makeTransform(metrics: AvatarMetrics): SpaceTransform {
  const horizontalScale = THREE.MathUtils.clamp(metrics.armLength / GUNSWAP_ARM_LENGTH, 0.7, 1.2);
  const offsetY = handBaseY(metrics) - GUNSWAP_HAND_Y;
  const shoulders = [-1, 1].map((side) => new THREE.Vector3(side * metrics.shoulderX, metrics.shoulderY, metrics.shoulderZ));
  return { horizontalScale, offsetY, shoulders, reach: metrics.armLength * REACH_SHARE };
}

/** 手の位置を肩から届く範囲に収める */
export function clampToReach(hand: number, p: THREE.Vector3, t: SpaceTransform) {
  const shoulder = t.shoulders[hand];
  const offset = p.clone().sub(shoulder);
  if (offset.length() > t.reach) p.copy(shoulder).addScaledVector(offset.normalize(), t.reach);
  return p;
}

export function transformPoint(p: { x: number; y: number; z: number }, t: SpaceTransform, out: THREE.Vector3) {
  return out.set(p.x * t.horizontalScale, p.y + t.offsetY, p.z * t.horizontalScale);
}

export interface HandTrack {
  positions: THREE.Vector3[];
  palmNormals: THREE.Vector3[];
  holding: boolean[];
  /** 指先の向き(クラブのハンドルを握る時など)。なければ体の側で決める */
  fingerDirs?: THREE.Vector3[];
}

export interface ThrowEvent {
  time: number; // 周期の中の時刻(秒)
  hand: number;
  prop: number;
  value: number; // 投げの高さ(サイトスワップの数字)
  velocity: THREE.Vector3; // リリース時のボールの速度
}

export interface Tracks {
  numSteps: number;
  stepDuration: number;
  period: number;
  props: THREE.Vector3[][];
  /** 小道具のモデルの回転(指定がなければ gunswap の回転 × 基準回転を使う) */
  propRotations?: THREE.Quaternion[][];
  hands: HandTrack[];
  /** 目で追う位置(次にキャッチするボールの、リリース点から頂点へ向かう途中) */
  gaze: THREE.Vector3[];
  /** 投げの一覧(体の動きに使う) */
  throws: ThrowEvent[];
  peakY: number;
  centerZ: number;
}

/** 小道具のモデルの基準の向き(gunswap の回転に掛ける) */
export function propBaseQuaternion(type: string): THREE.Quaternion {
  const q = new THREE.Quaternion(1, 0, 0, 0);
  if (type === 'ring') q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
  return q;
}

export function summarize(props: THREE.Vector3[][], transform: SpaceTransform) {
  let peakY = -Infinity;
  let sumZ = 0;
  let count = 0;
  props.forEach((track) =>
    track.forEach((p) => {
      peakY = Math.max(peakY, p.y);
      sumZ += p.z;
      count++;
    })
  );
  return { peakY, centerZ: count > 0 ? sumZ / count : -0.35 * transform.horizontalScale };
}

// 手のひらの傾き: 持っている時は手がボールに加える力(加速度 + 重力)の向きに手のひらを向ける
const PALM_TILT_GAIN_HOLDING = 0.55;
const PALM_TILT_GAIN_EMPTY = 0.35;
const PALM_MAX_TILT = 0.55; // rad
const ACCEL_SMOOTH_TIME = 0.03; // s
const NORMAL_SMOOTH_TIME = 0.08; // s

export function buildTracks(siteswap: any, transform: SpaceTransform): Tracks {
  const numSteps: number = siteswap.numSteps;
  const period: number = siteswap.states.length * siteswap.beatDuration;
  const stepDuration = period / numSteps;

  const props: THREE.Vector3[][] = siteswap.propPositions.map((track: any[]) =>
    track.map((p) => transformPoint(p, transform, new THREE.Vector3()))
  );

  const hands: HandTrack[] = [LEFT, RIGHT].map((hand) => {
    const raw: any[] = siteswap.jugglerHandPositions[0][hand];
    const positions = raw.map((p) => transformPoint(p, transform, new THREE.Vector3()));
    const holding = raw.map((p) => p.dwell === true);
    const palmNormals = computePalmNormals(positions, holding, stepDuration);
    return { positions, palmNormals, holding };
  });

  const inAir: boolean[][] = siteswap.propPositions.map((track: any[]) => track.map((p) => p.dwell !== true));
  const gaze = computeGazeTrack(inAir, props, numSteps);

  // 体の動き用: 手の中から空中に出たステップを投げとみなす
  const throws: ThrowEvent[] = [];
  inAir.forEach((air, i) =>
    air.forEach((flying, s) => {
      const prev = (s - 1 + numSteps) % numSteps;
      if (!flying || air[prev]) return;
      const next = (s + 1) % numSteps;
      const velocity = props[i][next].clone().sub(props[i][s]).multiplyScalar(1 / stepDuration);
      throws.push({ time: s * stepDuration, hand: props[i][s].x < 0 ? LEFT : RIGHT, prop: i, value: 0, velocity });
    })
  );
  throws.sort((a, b) => a.time - b.time);

  return { numSteps, stepDuration, period, props, hands, gaze, throws, ...summarize(props, transform) };
}

// 視線: 次にキャッチするボールについて、リリース点から頂点までの GAZE_TOWARD_APEX の位置を見る
// (siteswap-performer の方式: https://github.com/aratama-ship-it/siteswap-performer)
const GAZE_TOWARD_APEX = 0.78;

export function computeGazeTrack(inAir: boolean[][], props: THREE.Vector3[][], numSteps: number): THREE.Vector3[] {
  const gaze: (THREE.Vector3 | undefined)[] = new Array(numSteps).fill(undefined);
  const remaining: number[] = new Array(numSteps).fill(Infinity);

  inAir.forEach((air, i) => {
    const start = air.findIndex((flying) => !flying);
    if (start < 0) return;
    // start(手の中)から 1 周して、空中にある区間(フライト)ごとに処理する
    let k = 0;
    while (k < numSteps) {
      const s = (start + k) % numSteps;
      if (!air[s]) {
        k++;
        continue;
      }
      const flight: number[] = [];
      while (k < numSteps && air[(start + k) % numSteps]) {
        flight.push((start + k) % numSteps);
        k++;
      }
      const release = props[i][flight[0]];
      const apex = flight.reduce((best, f) => (props[i][f].y > best.y ? props[i][f] : best), release);
      const target = release.clone().lerp(apex, GAZE_TOWARD_APEX);
      flight.forEach((f, ix) => {
        const left = flight.length - ix;
        if (left < remaining[f]) {
          remaining[f] = left;
          gaze[f] = target;
        }
      });
    }
  });

  // 空中にボールがないステップは直前の値を使う
  const firstIndex = gaze.findIndex((g) => g !== undefined);
  if (firstIndex < 0) return new Array(numSteps).fill(null).map(() => new THREE.Vector3(0, 1.4, -0.3));
  let last = gaze[firstIndex]!;
  const result: THREE.Vector3[] = new Array(numSteps);
  for (let k = 0; k < numSteps; k++) {
    const s = (firstIndex + k) % numSteps;
    if (gaze[s]) last = gaze[s]!;
    result[s] = last;
  }
  return result;
}

function computePalmNormals(positions: THREE.Vector3[], holding: boolean[], dt: number): THREE.Vector3[] {
  const n = positions.length;
  const up = new THREE.Vector3(0, 1, 0);

  const accel = positions.map((p, i) => {
    const prev = positions[(i - 1 + n) % n];
    const next = positions[(i + 1) % n];
    return new THREE.Vector3()
      .copy(next)
      .addScaledVector(p, -2)
      .add(prev)
      .multiplyScalar(1 / (dt * dt));
  });
  const smoothAccel = boxSmooth(accel, Math.max(1, Math.round(ACCEL_SMOOTH_TIME / dt)));

  const axis = new THREE.Vector3();
  const raw = smoothAccel.map((a, i) => {
    const force = new THREE.Vector3(a.x, a.y + GRAVITY, a.z);
    if (force.lengthSq() < 1e-8) return up.clone();
    force.normalize();
    const tilt = Math.acos(THREE.MathUtils.clamp(force.dot(up), -1, 1));
    const gain = holding[i] ? PALM_TILT_GAIN_HOLDING : PALM_TILT_GAIN_EMPTY;
    const angle = Math.min(tilt * gain, PALM_MAX_TILT);
    axis.crossVectors(up, force);
    if (axis.lengthSq() < 1e-10) return up.clone();
    axis.normalize();
    return up.clone().applyAxisAngle(axis, angle);
  });

  return boxSmooth(raw, Math.max(1, Math.round(NORMAL_SMOOTH_TIME / dt))).map((v) => v.normalize());
}

// 周期的な配列に対する移動平均
export function boxSmooth(values: THREE.Vector3[], radius: number): THREE.Vector3[] {
  const n = values.length;
  const result: THREE.Vector3[] = [];
  const sum = new THREE.Vector3();
  for (let k = -radius; k <= radius; k++) sum.add(values[((k % n) + n) % n]);
  const count = 2 * radius + 1;
  for (let i = 0; i < n; i++) {
    result.push(sum.clone().multiplyScalar(1 / count));
    sum.sub(values[(((i - radius) % n) + n) % n]).add(values[(i + radius + 1) % n]);
  }
  return result;
}

/** 周期的な軌道から時刻 t の位置を線形補間で取り出す */
export function sampleTrack(track: THREE.Vector3[], stepFloat: number, out: THREE.Vector3) {
  const n = track.length;
  const i0 = Math.floor(stepFloat) % n;
  const i1 = (i0 + 1) % n;
  return out.copy(track[i0]).lerp(track[i1], stepFloat - Math.floor(stepFloat));
}
