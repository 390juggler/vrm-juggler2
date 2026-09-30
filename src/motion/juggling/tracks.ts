import * as THREE from 'three';

/**
 * gunswap が計算した軌道(ボール・手)を、アバターの体格に合わせた座標に変換し、
 * 毎フレーム参照しやすい形(手のひらの向き・ボールを持っているか)に前計算する。
 */

export const LEFT = 0;
export const RIGHT = 1;

const GRAVITY = 9.8;

// gunswap の想定する体格(Siteswap.js の getDwellPosition / getElbowPosition より)
const GUNSWAP_HAND_Y = 1.15;
const GUNSWAP_ARM_LENGTH = 0.6;

// 肘を垂らした高さから、手の基準位置をどれだけ上げるか(m)
const HAND_ABOVE_ELBOW = 0.03;

export interface AvatarMetrics {
  shoulderY: number;
  upperArmLength: number;
  armLength: number;
}

// 変換が恒等になる体格(gunswap の元の体格)
export const DEFAULT_METRICS: AvatarMetrics = {
  shoulderY: GUNSWAP_HAND_Y + GUNSWAP_ARM_LENGTH / 2 - HAND_ABOVE_ELBOW,
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
}

/** ボールを持っていない時の手の基準の高さ(ワールド座標) */
export function handBaseY(metrics: AvatarMetrics): number {
  return metrics.shoulderY - metrics.upperArmLength + HAND_ABOVE_ELBOW;
}

export function makeTransform(metrics: AvatarMetrics): SpaceTransform {
  const horizontalScale = THREE.MathUtils.clamp(metrics.armLength / GUNSWAP_ARM_LENGTH, 0.7, 1.2);
  const offsetY = handBaseY(metrics) - GUNSWAP_HAND_Y;
  return { horizontalScale, offsetY };
}

export function transformPoint(p: { x: number; y: number; z: number }, t: SpaceTransform, out: THREE.Vector3) {
  return out.set(p.x * t.horizontalScale, p.y + t.offsetY, p.z * t.horizontalScale);
}

export interface HandTrack {
  positions: THREE.Vector3[];
  palmNormals: THREE.Vector3[];
  holding: boolean[];
}

export interface Tracks {
  numSteps: number;
  stepDuration: number;
  period: number;
  props: THREE.Vector3[][];
  hands: HandTrack[];
  peakY: number;
  centerZ: number;
}

// 手のひらの傾き: 持っている時は手がボールに加える力(加速度 + 重力)の向きに手のひらを向ける
const PALM_TILT_GAIN_HOLDING = 0.8;
const PALM_TILT_GAIN_EMPTY = 0.35;
const PALM_MAX_TILT = 0.75; // rad
const ACCEL_SMOOTH_TIME = 0.03; // s
const NORMAL_SMOOTH_TIME = 0.05; // s

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

  return {
    numSteps,
    stepDuration,
    period,
    props,
    hands,
    peakY,
    centerZ: count > 0 ? sumZ / count : -0.35 * transform.horizontalScale,
  };
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
function boxSmooth(values: THREE.Vector3[], radius: number): THREE.Vector3[] {
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
