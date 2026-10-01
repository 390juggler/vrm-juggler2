import * as THREE from 'three';

import {
  GRAVITY,
  LEFT,
  RIGHT,
  HandTrack,
  SpaceTransform,
  ThrowEvent,
  Tracks,
  boxSmooth,
  clampToReach,
  computeGazeTrack,
  propBaseQuaternion,
  summarize,
  transformPoint,
} from './tracks';
import { BounceSegment, bounceHeightAt, solveBounce } from './bounce';

/**
 * ジャグラーの手の動きを「投げ」と「キャッチ」の出来事から組み立てる。
 *
 * gunswap はパターンの構造(どの拍にどちらの手が何を投げるか)の計算にだけ使い、
 * ボールの放物線と手の軌道はここで作り直す。
 *
 * - 投げる瞬間は手の速度をボールの速度に一致させる(Juggling Lab と同じ考え方)。
 *   それまでの gunswap の軌道は、ほぼ止まった手からボールが飛び出していた。
 * - キャッチでは落ちてくるボールの速さの一部で受けて沈み込む(実測: 約 4 割)。
 * - 手の中の動きは「運ぶ」区間と、短く速い「投げる」区間に分ける(実際のジャグラーの手の動き)。
 * - 投げる/受ける横位置は投げの高さで変える(Juggling Lab の表を元にした)。'1' は中央近くで手渡す。
 * - クラブはハンドル、リングは縁を握る。手の軌道はその握る位置で計算する。
 * - 空中でボール同士がぶつかるパターンでは、投げの形(柱のように上げる・少し外で受ける…)を選び直す。
 * - 床で跳ねる投げ(バウンド)は、水平な面なら跳ねる軌道を解いて同じように手を動かす(bounce.ts)。
 *
 * 複数人のパターンと、傾いた面で跳ねるパターンは対象外(gunswap の軌道を使う)。
 */

// 横位置(cm)の表: Juggling Lab (notation/MhnPattern.kt)。3 の値を基準にした比率で使う
const JL_CATCH_X = [0, 17, 25, 30, 40, 45, 45, 50, 50]; // 飛んでくる投げの高さごと
const JL_CROSSING_THROW_X = [0, 17, 17, 7, 10, 14, 25, 24, 30];
const JL_SAME_THROW_X = [0, 20, 25, 12, 7, 7.5, 5, 5, 5];
const WIDTH_BLEND_CATCH = 0.6; // 表の比率をどれだけ反映するか(小柄なアバターで広がりすぎないように)
const WIDTH_BLEND_THROW = 0.5;

// '1' は手渡しなので中央近くで投げて、中央寄りで受ける(m, gunswap 座標)
const ONE_THROW_X = 0.06;
const ONE_CATCH_X = 0.15;

// フォロースルーの横方向の伸び(手渡しの '1' で反対の手にぶつからないように縦方向を主にする)
const FOLLOW_HORIZONTAL = 0.3;

// キャッチ: 落ちてくる速さの何割で受けるか(siteswap-performer の catchAbsorptionRatio 0.42)と上限
const CATCH_ABSORB = 0.35;
const CATCH_HAND_SPEED_MAX = 1.5; // m/s
const CATCH_HORIZONTAL = 0.3; // 受けた後の横への流れ(縦は沈み込み、横はあまり流れない)

// 投げる区間: 一定の加速度で加速すると考えて長さを決める
const THROW_ACCEL = 40; // m/s^2(約 4G)
const THROW_STROKE_MIN = 0.05; // m
const THROW_STROKE_MAX = 0.14; // m(深く沈みすぎると腕が届かない)
const THROW_STROKE_START_SPEED = 0.3; // 投げる区間の始まりの速さ(リリースの速さに対する割合)。底で止まらないように
const THROW_STROKE_MAX_SHARE = 0.6; // 手に持っている時間のうち、投げる区間に使える割合

// 投げた後、手はボールについて行きながら短い時間で減速する(フォロースルー)。速度が途切れないようにする
const FOLLOW_TIME = 0.06; // s
const FOLLOW_END_SPEED = 0.1; // フォロースルーの終わりの速さ(リリースの速さに対する割合)
const FOLLOW_DISTANCE_MAX = 0.1; // m

// 手のひらの向き
const PALM_MAX_TILT = THREE.MathUtils.degToRad(80);
const PALM_CATCH_TILT_SHARE = 0.5; // キャッチでは飛んできた方向へ半分だけ向ける
const PALM_SNAP_ANGLE = THREE.MathUtils.degToRad(18); // 投げた直後の手首のスナップ(速い投げの時)
const PALM_SNAP_SPEED_MIN = 2; // m/s(これより遅い投げはスナップを小さく)
const PALM_SNAP_SPEED_MAX = 6; // m/s
const PALM_STROKE_SHARE = 0.8; // 投げる区間の始まりで、手のひらをどれだけ投げる方向へ向けておくか
const PALM_SNAP_TIME = 0.06; // s

// 小道具の種類。pancake はリングを水平に持ち、クラブのように縦に回して投げる(パンケーキ)
const isRingType = (propType: string) => propType === 'ring' || propType === 'pancake';

// 小道具が大きいほど幅を広く投げる(空中で重ならないように)
const PROP_WIDTH: { [type: string]: number } = { ball: 1, club: 1.15, ring: 1.3, pancake: 1.3 };
// パンケーキは水平に持った輪が横に 30cm ほど広がるので、手を体の中心へ寄せすぎない(左右の輪が重ならないように)
const PANCAKE_MIN_X = 0.17; // m

// 小道具の握る位置
const CLUB_GRIP_LOCAL = new THREE.Vector3(0, -0.13, 0); // クラブのモデル座標(ノブ側)
const RING_GRIP_RADIUS = 0.145; // 輪の太さの中央
// パンケーキは手前の縁を握る(リングのモデル座標。輪の面は xz、+z が手前になる向きで持つ)
const PANCAKE_GRIP_LOCAL = new THREE.Vector3(0, 0, RING_GRIP_RADIUS);

// クラブ・パンケーキの向き: 前方からの仰角(度)。空中では横軸まわりに
// 「投げの高さ / 2 の整数部分」回転 + キャッチの角度になる分だけ回る('1' は回転せずに手渡す)
// - クラブ: キャッチでほぼ真上、運ぶ間に斜め上まで前へ倒し、手首を返して投げる
// - パンケーキ: 輪をほぼ水平に受け、少し下げてから、手首を返して手前の縁から跳ね上げる
interface Spin {
  release: number;
  catch: number;
  low: number; // 運ぶ途中で一番前へ倒れる角度
  lowAt: number; // 手に持っている時間のうち、一番倒れるタイミング
  inwardYaw: number; // 体の内側へ向ける角度
}
const CLUB_SPIN: Spin = { release: 40, catch: 85, low: 15, lowAt: 0.65, inwardYaw: 12 };
const PANCAKE_SPIN: Spin = { release: 25, catch: 0, low: -10, lowAt: 0.6, inwardYaw: 0 };
// リング同士は、すれ違う時に輪が同じ面に重なると交差してしまう(パンケーキは回る途中で正面を向いて立つ)。
// 交差する時は、投げごとに飛ぶ面の奥行きを少しずらす(手は持っている間に奥行きを持ち替える)
const RING_DEPTH_OPTIONS = [0, -0.05, 0.05, -0.09, 0.09]; // m
const RING_CHECK_INTERVAL = 0.005; // s(交差を調べる時刻の間隔)
const RING_CIRCLE_POINTS = 32;
const RING_TOUCH = 0.015; // m(輪の幅の半分。これより近いと交差している)
const RING_DEPTH_ROUNDS = 3;

// ふつうのリング: 輪の面を体の横向き(横から見ると丸く、正面からは細く見える)にして、
// 前の縁を少し内側へ向ける。空中では輪の面の中で少し回る
const RING_INWARD_YAW = 10;
const RING_SPIN_PER_FLIGHT = 0.5; // 回転
// ふつうのリングは手を高く上げて扱う。前腕がほぼ縦になる高さで受け、肩の高さまで持ち上げてから腕全体で投げる
// (ボールのように胸より下で持つと、輪が体の前で低く小さく見えてしまう)
// 下げすぎると肘より手が下がって前腕が寝てしまうので、投げる区間の沈み込みは浅くする
const RING_CATCH_LIFT = 0.3; // m(ボールの受ける高さから)
const RING_THROW_LIFT = 0.28; // m(ボールの投げる高さから)
const RING_STROKE_MAX = 0.1; // m
const RING_CLOSER = 0.12; // m(手を体へ近づけ、肩の前で前腕を立てる)
const RING_MIN_X = 0.15; // m(顔の高さで持つので、輪が頭に近づきすぎないよう肩の前で扱う)
// 握り方: 親指を輪の内側、ほかの指を外側にかけ、人差し指の付け根(手のひら側)に縁を乗せる。手のひらは内側斜め上を向く
const RING_PALM_INWARD = 0.8;

// 投げの形。ふだんは normal(内側で投げて外側で受ける)。空中で小道具同士がぶつかるパターンでは、投げの高さごとに
// 形を選び直す(実際のジャグラーも 423 や 534 の 4 は柱のようにまっすぐ上げ、53 の 3 は少し外で受ける)
// - 同じ手に戻る偶数の投げ: column(投げる位置と受ける位置を揃えてまっすぐ上下)
// - 反対の手へ渡る投げ: wideCatch(少し外で受ける)、innerThrow(少し内側で投げる)、その両方
type ThrowStyle = 'normal' | 'columnMid' | 'columnOut' | 'wideCatch' | 'innerThrow' | 'innerWide';
const SAME_HAND_STYLES: ThrowStyle[] = ['normal', 'columnMid', 'columnOut'];
const CROSSING_STYLES: ThrowStyle[] = ['normal', 'wideCatch', 'innerThrow', 'innerWide'];
const WIDE_CATCH_SCALE = 1.2;
const INNER_THROW_SCALE = 0.65;
const INNER_THROW_MIN_X = 0.07; // m
// 空中の小道具同士の中心の距離がこれより近いパターンは、投げの形を選び直す
const SAFE_DISTANCE = 0.14; // m(ボールの直径 + 4cm)
const COLLISION_SAMPLES = 360;
const REACH_MARGIN = 0.95; // 腕の届く範囲のうち、投げる位置に使ってよい割合
const MAX_STYLE_KEYS = 4; // 形を選び直す投げの種類の上限(組み合わせは多くて 4^4 = 256 通り)

type EventKind = 'catch' | 'throw' | 'stroke' | 'follow' | 'hold' | 'rest';

interface HandEvent {
  time: number;
  kind: EventKind;
  position: THREE.Vector3; // 手(握る位置)
  velocityIn: THREE.Vector3; // この時刻に到着する時の速度
  velocityOut: THREE.Vector3; // この時刻から出発する時の速度
  palm: THREE.Vector3;
}

interface Flight {
  prop: number;
  release: number; // 時刻
  duration: number;
  throwHand: number;
  catchHand: number;
  value: number;
  start: THREE.Vector3; // 重心
  velocity: THREE.Vector3; // リリースの速度
  end: THREE.Vector3;
  /** 床で跳ねる投げ: 跳ねる面の高さ(重心)と、上へ投げる(リフト)か下へ投げる(フォース)か */
  bounce?: { floors: number[]; restitution: number; tossUp: boolean; catchUp: boolean; strict: boolean };
  segments: BounceSegment[];
}

const UP = new THREE.Vector3(0, 1, 0);

function mod(a: number, n: number) {
  return ((a % n) + n) % n;
}

// 周期上で t0 から t までの経過時間。ちょうど同じ時刻が浮動小数点誤差で 1 周ずれないように、わずかな負の値を許す
const EPS = 1e-7;
function since(t: number, t0: number, period: number) {
  return mod(t - t0 + EPS, period) - EPS;
}

function hermite(p0: THREE.Vector3, v0: THREE.Vector3, p1: THREE.Vector3, v1: THREE.Vector3, T: number, s: number) {
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  return new THREE.Vector3()
    .addScaledVector(p0, h00)
    .addScaledVector(v0, h10 * T)
    .addScaledVector(p1, h01)
    .addScaledVector(v1, h11 * T);
}

/** 上向きから最大 maxTilt までに傾きを制限する */
function limitTilt(n: THREE.Vector3, maxTilt: number) {
  const v = n.clone().normalize();
  const tilt = Math.acos(THREE.MathUtils.clamp(v.dot(UP), -1, 1));
  if (tilt <= maxTilt) return v;
  const axis = new THREE.Vector3().crossVectors(UP, v);
  if (axis.lengthSq() < 1e-10) return UP.clone();
  return UP.clone().applyAxisAngle(axis.normalize(), maxTilt);
}

function tiltToward(from: THREE.Vector3, toward: THREE.Vector3, share: number) {
  const target = limitTilt(toward, PALM_MAX_TILT);
  return from.clone().lerp(target, share).normalize();
}

const isHorizontal = (surface: any) => surface && Math.abs(surface.normal.y) > 0.999;

export function isNaturalSupported(siteswap: any): boolean {
  if (siteswap.numJugglers !== 1) return false;
  // 跳ねる投げは水平な面で跳ねる場合だけ
  return siteswap.propOrbits.every((orbit: any[]) =>
    orbit.every(
      (toss) =>
        !toss.numBounces || (toss.bounceOrder || []).every((ix: number) => isHorizontal(siteswap.surfaces[ix]))
    )
  );
}

export function buildNaturalTracks(
  siteswap: any,
  transform: SpaceTransform,
  propType: string,
  propRadius: number,
  ringDepths?: number[]
): Tracks {
  const beat: number = siteswap.beatDuration;
  const period: number = siteswap.states.length * beat;
  const numSteps: number = siteswap.numSteps;
  const dt = period / numSteps;
  const numProps: number = siteswap.numProps;
  const stepOf = (time: number) => Math.round(mod(time, period) / dt) % numSteps;

  // 小道具の向き(クラブ・リングは下で自前の回転を作る。ボールは gunswap の回転のまま)
  const baseQ = propBaseQuaternion(propType);
  let orientations: THREE.Quaternion[][] | undefined;
  const meshQ = (prop: number, step: number) =>
    orientations ? orientations[prop][step] : siteswap.propRotations[prop][step].clone().multiply(baseQ);
  const gripOffset = (prop: number, step: number, out = new THREE.Vector3()) => {
    const q = meshQ(prop, step);
    if (propType === 'club') return out.copy(CLUB_GRIP_LOCAL).applyQuaternion(q);
    if (propType === 'pancake') return out.copy(PANCAKE_GRIP_LOCAL).applyQuaternion(q);
    if (propType === 'ring') {
      // 輪の一番下を握る
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const down = new THREE.Vector3(0, -1, 0);
      out.copy(down).addScaledVector(axis, -axis.dot(down));
      if (out.lengthSq() < 0.01) out.set(1, 0, 0).applyQuaternion(q);
      return out.normalize().multiplyScalar(RING_GRIP_RADIUS);
    }
    return out.set(0, 0, 0);
  };

  // ---- 位置(gunswap 座標で計算してからアバターの体格に合わせて変換) ----
  const dwellPoints = (ix: number) => (siteswap.dwellPath[ix] as any[]).filter((p) => !p.empty);
  const cascadeLike = (ix: number) => {
    const pts = dwellPoints(ix);
    return pts[0].x > pts[pts.length - 1].x && pts[pts.length - 1].x > 0;
  };
  const width = PROP_WIDTH[propType] || 1;
  // lift > 0(リングを肩の高さで扱う)の時は手を体へ寄せる
  const toWorld = (hand: number, p: { x: number; y: number; z: number }, lift = 0) =>
    transformPoint(
      { x: (hand === LEFT ? -1 : 1) * p.x * width, y: 1.15 + p.y + lift, z: p.z - 0.35 + (lift > 0 ? RING_CLOSER : 0) },
      transform,
      new THREE.Vector3()
    );

  // '1'(手渡し)は胸の前を低く渡す(顔の高さで渡すと輪が顔に当たる)
  const throwLift = (value: number) => (propType === 'ring' && value > 1 ? RING_THROW_LIFT : 0);
  const catchLift = (incomingValue: number) => (propType === 'ring' && incomingValue > 1 ? RING_CATCH_LIFT : 0);
  // 手(握る位置)を体の中心から離す(リング・パンケーキ)
  const minX = propType === 'pancake' ? PANCAKE_MIN_X : propType === 'ring' ? RING_MIN_X : 0;
  const keepOut = (hand: number, p: THREE.Vector3) => {
    const side = hand === RIGHT ? 1 : -1;
    if (p.x * side < minX) p.x = side * minX;
    return p;
  };
  const catchX = (baseX: number, incomingValue: number) => {
    if (incomingValue === 1) return ONE_CATCH_X;
    const v = Math.min(incomingValue, 8);
    return baseX * THREE.MathUtils.clamp(1 + (JL_CATCH_X[v] / 30 - 1) * WIDTH_BLEND_CATCH, 0.5, 2);
  };
  const throwPoint = (toss: any, crossing: boolean) => {
    const pts = dwellPoints(toss.dwellPathIx);
    const p = { ...pts[pts.length - 1] };
    if (cascadeLike(toss.dwellPathIx)) {
      const v = Math.min(toss.numBeats, 8);
      if (toss.numBeats === 1) p.x = ONE_THROW_X;
      else {
        // 同じ手に戻る投げも内側で投げて外側で受ける(ファウンテンの小さな輪。上りと下りがぶつからない)
        const table = crossing ? JL_CROSSING_THROW_X : JL_SAME_THROW_X;
        p.x *= THREE.MathUtils.clamp(1 + (table[v] / 7 - 1) * WIDTH_BLEND_THROW, 0.5, 2);
      }
    }
    return clampToReach(toss.hand, keepOut(toss.hand, toWorld(toss.hand, p, throwLift(toss.numBeats))), transform);
  };
  const catchPoint = (toss: any, incomingValue: number) => {
    const pts = dwellPoints(toss.dwellPathIx);
    const p = { ...pts[0] };
    if (cascadeLike(toss.dwellPathIx)) {
      p.x = catchX(p.x, incomingValue);
      // '1' は横へ押し出す手渡しなので、投げた高さのまま受ける(手のひらが受け手の方へ横を向く)
      if (incomingValue === 1) p.y = pts[pts.length - 1].y;
    }
    return clampToReach(toss.hand, toWorld(toss.hand, p, catchLift(incomingValue)), transform);
  };

  // ---- 出来事を集める ----
  // 形を選べる投げの種類('4'、'5'、'6x' …)。内側で投げて外側で受けるパターン(カスケード系)の 3 以上の投げだけ
  const styleKey = (toss: any, next: any): string | undefined =>
    toss.numBeats >= 3 && !toss.numBounces && cascadeLike(toss.dwellPathIx) && cascadeLike(next.dwellPathIx)
      ? `${toss.numBeats}${next.hand === toss.hand ? '' : 'x'}`
      : undefined;

  const makeFlights = (styles: Map<string, ThrowStyle>) => {
    const result: Flight[] = [];
    const holds: { hand: number; toss: any; next: any }[] = [];
    // 腕が届かずに位置を詰めた投げの数(詰めると投げる瞬間の手が遅くなる)
    let outOfReach = 0;
    siteswap.propOrbits.forEach((orbit: any[], prop: number) => {
      orbit.forEach((toss, k) => {
        const next = orbit[(k + 1) % orbit.length];
        if (toss.hold) {
          holds.push({ hand: toss.hand, toss, next });
          return;
        }
        const release = mod(toss.beat * beat + toss.dwellDuration, period);
        let duration = mod(next.beat * beat - release, period);
        if (duration < 1e-6) duration += period;
        const start = throwPoint(toss, next.hand !== toss.hand);
        const end = catchPoint(next, toss.numBeats);
        const key = styleKey(toss, next);
        const style = (key && styles.get(key)) || 'normal';
        if (style === 'columnOut') start.x = end.x;
        if (style === 'columnMid') start.x = end.x = (start.x + end.x) / 2;
        if (style === 'wideCatch' || style === 'innerWide') end.x *= WIDE_CATCH_SCALE;
        if (style === 'innerThrow' || style === 'innerWide')
          start.x = Math.sign(start.x) * Math.max(Math.abs(start.x) * INNER_THROW_SCALE, INNER_THROW_MIN_X);
        const flight: Flight = {
          prop,
          release,
          duration,
          throwHand: toss.hand,
          catchHand: next.hand,
          value: toss.numBeats,
          start: clampToReach(toss.hand, keepOut(toss.hand, start), transform),
          velocity: new THREE.Vector3(),
          end: clampToReach(next.hand, keepOut(next.hand, end), transform),
          segments: [],
        };
        if (toss.numBounces > 0) {
          flight.bounce = {
            floors: (toss.bounceOrder as number[]).map(
              (ix) => transformPoint(siteswap.surfaces[ix].position, transform, new THREE.Vector3()).y + propRadius
            ),
            restitution: Number(siteswap.props[prop]?.C) || 0.9,
            // gunswap と同じ決まり: L / HL は上へ投げ、L / HF は上がってくるところを受ける
            tossUp: toss.bounceType === 'L' || toss.bounceType === 'HL',
            catchUp: toss.bounceType === 'L' || toss.bounceType === 'HF',
            strict: !toss.bounceTypeAuto,
          };
        }
        solveFlight(flight);
        result.push(flight);
        if (start.distanceTo(transform.shoulders[toss.hand]) > transform.reach * REACH_MARGIN) outOfReach++;
      });
    });
    return { flights: result, holds, outOfReach };
  };

  // 空中の小道具同士がいちばん近づく距離(重心の軌道で見積もる)
  const closestApproach = (candidates: Flight[]) => {
    let closest = Infinity;
    for (let i = 0; i < COLLISION_SAMPLES; i++) {
      const t = (i / COLLISION_SAMPLES) * period;
      const positions: THREE.Vector3[] = [];
      candidates.forEach((f) => {
        const tau = since(t, f.release, period);
        if (tau < 0 || tau >= f.duration) return;
        const p = flightAt(f, tau);
        positions.forEach((q) => (closest = Math.min(closest, q.distanceTo(p))));
        positions.push(p);
      });
    }
    return closest;
  };

  // いつもの形でぶつかりそうなら、投げの種類ごとに形を変えて、いちばん離れる組み合わせを選ぶ
  let styles = new Map<string, ThrowStyle>();
  const keys = [
    ...new Set(
      siteswap.propOrbits.flatMap((orbit: any[]) =>
        orbit.map((toss, k) => (toss.hold ? undefined : styleKey(toss, orbit[(k + 1) % orbit.length])))
      )
    ),
  ].filter((key): key is string => key !== undefined);
  const normal = makeFlights(styles);
  let best = closestApproach(normal.flights);
  if (best < SAFE_DISTANCE && keys.length > 0 && keys.length <= MAX_STYLE_KEYS) {
    const combos = keys.reduce<Map<string, ThrowStyle>[]>(
      (list, key) =>
        list.flatMap((m) =>
          (key.endsWith('x') ? CROSSING_STYLES : SAME_HAND_STYLES).map((style) => new Map(m).set(key, style))
        ),
      [new Map()]
    );
    combos.forEach((combo) => {
      const candidate = makeFlights(combo);
      // いつもより腕を伸ばさないと届かない形は選ばない
      if (candidate.outOfReach > normal.outOfReach) return;
      const distance = closestApproach(candidate.flights);
      // 少しよくなるだけなら、いつもの形のまま
      if (distance > best + 0.01) {
        best = distance;
        styles = combo;
      }
    });
  }
  const { flights, holds: holdTosses } = makeFlights(styles);

  if (propType === 'club' || isRingType(propType)) {
    orientations = buildOrientations(propType, flights, numProps, numSteps, period, siteswap);
  }

  // リング同士が交差しないように選んだ、投げごとの面の奥行き(下で選び、もう一度作り直す)
  if (ringDepths) {
    flights.forEach((f, i) => {
      if (!ringDepths[i]) return;
      f.start.z += ringDepths[i];
      f.end.z += ringDepths[i];
      clampToReach(f.throwHand, f.start, transform);
      clampToReach(f.catchHand, f.end, transform);
    });
  }

  // 同じ手・同じ時刻の投げ/キャッチ(マルチプレックス)は横に並べる
  const spread = (key: (f: Flight) => string, apply: (f: Flight, offset: number) => void) => {
    const groups = new Map<string, Flight[]>();
    flights.forEach((f) => {
      const k = key(f);
      groups.set(k, [...(groups.get(k) || []), f]);
    });
    groups.forEach((group) => group.forEach((f, i) => apply(f, (i - (group.length - 1) / 2) * propRadius * 2.1)));
  };
  const releaseOffset = new Map<Flight, number>();
  const catchOffset = new Map<Flight, number>();
  spread(
    (f) => `${f.throwHand}:${Math.round(f.release * 1000)}`,
    (f, o) => releaseOffset.set(f, o)
  );
  spread(
    (f) => `${f.catchHand}:${Math.round(mod(f.release + f.duration, period) * 1000)}`,
    (f, o) => catchOffset.set(f, o)
  );

  // 重心の軌道(握る位置のずれは、その時刻の小道具の向きから求める)
  flights.forEach((f) => {
    const releaseStep = stepOf(f.release);
    const catchStep = stepOf(f.release + f.duration);
    // throwPoint / catchPoint は手(握る位置)。重心はそこから握る位置のずれを引く
    f.start.x += releaseOffset.get(f)!;
    f.end.x += catchOffset.get(f)!;
    f.start.sub(gripOffset(f.prop, releaseStep));
    f.end.sub(gripOffset(f.prop, catchStep));
    solveFlight(f);
  });

  // ---- 手ごとの出来事 ----
  const handEvents: HandEvent[][] = [[], []];
  const addOrMerge = (hand: number, e: HandEvent) => {
    const same = handEvents[hand].find((x) => x.kind === e.kind && Math.abs(x.time - e.time) < 1e-6);
    if (same) {
      // マルチプレックス: 速度は平均する(位置は同じ)
      same.velocityIn.add(e.velocityIn).multiplyScalar(0.5);
      same.velocityOut.add(e.velocityOut).multiplyScalar(0.5);
      return;
    }
    handEvents[hand].push(e);
  };

  flights.forEach((f) => {
    const vRelease = f.velocity.clone();
    const dir = vRelease.clone().normalize();
    const releaseStep = stepOf(f.release);
    const handAtRelease = f.start
      .clone()
      .add(gripOffset(f.prop, releaseStep))
      .add(new THREE.Vector3(-releaseOffset.get(f)!, 0, 0));
    addOrMerge(f.throwHand, {
      time: f.release,
      kind: 'throw',
      position: handAtRelease,
      velocityIn: vRelease.clone(),
      velocityOut: vRelease.clone(),
      palm: limitTilt(dir, PALM_MAX_TILT),
    });

    const catchTime = mod(f.release + f.duration, period);
    const vIncoming = flightVelocityAt(f, f.duration);
    const handVelocity = vIncoming
      .clone()
      .multiplyScalar(CATCH_ABSORB)
      .multiply(new THREE.Vector3(CATCH_HORIZONTAL, 1, CATCH_HORIZONTAL));
    if (handVelocity.length() > CATCH_HAND_SPEED_MAX) handVelocity.setLength(CATCH_HAND_SPEED_MAX);
    const handAtCatch = f.end
      .clone()
      .add(gripOffset(f.prop, stepOf(catchTime)))
      .add(new THREE.Vector3(-catchOffset.get(f)!, 0, 0));
    addOrMerge(f.catchHand, {
      time: catchTime,
      kind: 'catch',
      position: handAtCatch,
      velocityIn: handVelocity.clone(),
      velocityOut: handVelocity.clone(),
      palm: tiltToward(UP, vIncoming.clone().negate(), PALM_CATCH_TILT_SHARE),
    });
  });

  // '2'(持ったまま): 手はリズムを保って小さく投げる/受ける動きをする。
  // 同じ手がその時刻に本当の投げ/キャッチをする場合は、そちらを優先する
  const HOLD_MIN_GAP = 0.05; // s
  const busy = (hand: number, time: number) =>
    handEvents[hand].some(
      (e) =>
        Math.abs(since(e.time, time, period)) < HOLD_MIN_GAP || Math.abs(since(time, e.time, period)) < HOLD_MIN_GAP
    );
  holdTosses.forEach(({ hand, toss, next }) => {
    const holdTime = mod(toss.beat * beat + toss.dwellDuration, period);
    const regripTime = mod(next.beat * beat, period);
    if (!busy(hand, holdTime))
      addOrMerge(hand, {
        time: holdTime,
        kind: 'hold',
        position: throwPoint(toss, false),
        velocityIn: new THREE.Vector3(0, 0.4, 0),
        velocityOut: new THREE.Vector3(0, 0.2, 0),
        palm: UP.clone(),
      });
    if (!busy(hand, regripTime))
      addOrMerge(hand, {
        time: regripTime,
        kind: 'hold',
        position: catchPoint(next, 2),
        velocityIn: new THREE.Vector3(0, -0.3, 0),
        velocityOut: new THREE.Vector3(0, -0.3, 0),
        palm: UP.clone(),
      });
  });

  // 投げる区間の始まり(ストローク)を投げの前に、フォロースルーの終わりを投げの後に入れる
  [LEFT, RIGHT].forEach((hand) => {
    const events = handEvents[hand].sort((a, b) => a.time - b.time);
    const strokes: HandEvent[] = [];
    events.forEach((e, i) => {
      if (e.kind !== 'throw') return;
      const prev = events[(i - 1 + events.length) % events.length];
      const following = events[(i + 1) % events.length];
      const gapAfter = mod(following.time - e.time, period) || period;
      const releaseSpeed = e.velocityIn.length();
      const followTime = Math.min(
        FOLLOW_TIME,
        gapAfter * 0.4,
        FOLLOW_DISTANCE_MAX / Math.max(1e-3, releaseSpeed * ((1 + FOLLOW_END_SPEED) / 2))
      );
      const followVelocity = e.velocityIn.clone().multiply(new THREE.Vector3(FOLLOW_HORIZONTAL, 1, FOLLOW_HORIZONTAL));
      strokes.push({
        time: mod(e.time + followTime, period),
        kind: 'follow',
        position: clampToReach(
          hand,
          e.position.clone().addScaledVector(followVelocity, followTime * ((1 + FOLLOW_END_SPEED) / 2)),
          transform
        ),
        velocityIn: followVelocity.clone().multiplyScalar(FOLLOW_END_SPEED),
        velocityOut: followVelocity.clone().multiplyScalar(FOLLOW_END_SPEED),
        palm: e.palm.clone(),
      });
      const available = mod(e.time - prev.time, period) || period;
      const speed = e.velocityIn.length();
      if (speed < 1e-3) return;
      const startSpeed = speed * THROW_STROKE_START_SPEED;
      const strokeMax = propType === 'ring' ? RING_STROKE_MAX : THROW_STROKE_MAX;
      let stroke = THREE.MathUtils.clamp((speed * speed) / (2 * THROW_ACCEL), THROW_STROKE_MIN, strokeMax);
      let duration = stroke / ((speed + startSpeed) / 2);
      if (duration > available * THROW_STROKE_MAX_SHARE) {
        duration = available * THROW_STROKE_MAX_SHARE;
        stroke = ((speed + startSpeed) / 2) * duration;
      }
      const dir = e.velocityIn.clone().normalize();
      // 投げる区間の始まりは手の軌道の一番下。縦の速度は 0 にして、横は内側へすくう動きを続ける
      // (上向きの速度で到着させると、その手前で一度下へ潜ってしまう)
      const start = clampToReach(hand, e.position.clone().addScaledVector(dir, -stroke), transform);
      const scoop = start.clone().sub(prev.position).multiplyScalar(1 / Math.max(available - duration, 1e-3));
      scoop.y = 0;
      const startVelocity = dir.clone().multiplyScalar(startSpeed).setY(0).add(scoop).multiplyScalar(0.5);
      strokes.push({
        time: mod(e.time - duration, period),
        kind: 'stroke',
        position: start,
        velocityIn: startVelocity.clone(),
        velocityOut: startVelocity.clone(),
        palm: tiltToward(UP, dir, PALM_STROKE_SHARE),
      });
    });
    handEvents[hand] = events.concat(strokes).sort((a, b) => a.time - b.time);
  });

  // ---- 手の軌道 ----
  const restPosition = (hand: number) => toWorld(hand, { x: 0.2, y: 0, z: 0 }, throwLift(3));
  const hands: HandTrack[] = [LEFT, RIGHT].map((hand) => {
    const events = handEvents[hand];
    const positions: THREE.Vector3[] = [];
    const palmNormals: THREE.Vector3[] = [];
    for (let s = 0; s < numSteps; s++) {
      const t = s * dt;
      if (events.length === 0) {
        positions.push(restPosition(hand));
        palmNormals.push(UP.clone());
        continue;
      }
      // t を含む区間 [a, b)
      let bIndex = events.findIndex((e) => e.time > t);
      if (bIndex < 0) bIndex = 0;
      const a = events[(bIndex - 1 + events.length) % events.length];
      const b = events[bIndex];
      const T = mod(b.time - a.time, period) || period;
      const u = mod(t - a.time, period) / T;
      // 投げた後(手が空の間)は中心へ寄ってよい
      const p = hermite(a.position, a.velocityOut, b.position, b.velocityIn, T, u);
      positions.push(clampToReach(hand, a.kind === 'throw' || a.kind === 'follow' ? p : keepOut(hand, p), transform));

      // 手のひら: 区間の両端の向きをなめらかに補間。投げた直後は手首のスナップを足す
      const eased = u * u * (3 - 2 * u);
      const palm = a.palm.clone().lerp(b.palm, eased).normalize();
      const lastThrow = a.kind === 'follow' ? events[(events.indexOf(a) - 1 + events.length) % events.length] : a;
      const sinceThrow = mod(t - lastThrow.time, period);
      if (lastThrow.kind === 'throw' && sinceThrow < PALM_SNAP_TIME * 2) {
        const strength = THREE.MathUtils.clamp(
          (lastThrow.velocityIn.length() - PALM_SNAP_SPEED_MIN) / (PALM_SNAP_SPEED_MAX - PALM_SNAP_SPEED_MIN),
          0.25,
          1
        );
        const snap = Math.sin((Math.PI * sinceThrow) / (PALM_SNAP_TIME * 2)) * PALM_SNAP_ANGLE * strength;
        const axis = new THREE.Vector3().crossVectors(UP, lastThrow.palm);
        if (axis.lengthSq() > 1e-6) palm.applyAxisAngle(axis.normalize(), snap);
      }
      palmNormals.push(palm);
    }
    return { positions, palmNormals, holding: new Array(numSteps).fill(false) };
  });

  // ---- 小道具の位置 ----
  const props: THREE.Vector3[][] = [];
  const inAir: boolean[][] = [];
  for (let prop = 0; prop < numProps; prop++) {
    const own = flights.filter((f) => f.prop === prop).sort((a, b) => a.release - b.release);
    const track: THREE.Vector3[] = [];
    const air: boolean[] = [];
    for (let s = 0; s < numSteps; s++) {
      const t = s * dt;
      const flying = own.find((f) => {
        const tau = since(t, f.release, period);
        return tau >= 0 && tau < f.duration - EPS;
      });
      if (flying) {
        track.push(flightAt(flying, Math.max(0, since(t, flying.release, period))));
        air.push(true);
        continue;
      }
      air.push(false);
      // 手の中: 直前にキャッチした手(投げたことがなければ最初の投げの手)
      let hand = siteswap.propOrbits[prop][0].hand;
      let startOffset = 0;
      let endOffset = 0;
      let heldFrom = 0;
      let heldFor = period;
      if (own.length > 0) {
        const sinceCatch = (f: Flight) => since(t, f.release + f.duration, period);
        const untilRelease = (f: Flight) => since(f.release, t, period);
        const previous = own.reduce((best, f) => (sinceCatch(f) < sinceCatch(best) ? f : best));
        const nextFlight = own.reduce((best, f) => (untilRelease(f) < untilRelease(best) ? f : best));
        hand = previous.catchHand;
        startOffset = catchOffset.get(previous)!;
        endOffset = releaseOffset.get(nextFlight)!;
        heldFrom = mod(previous.release + previous.duration, period);
        heldFor = mod(nextFlight.release - heldFrom, period) || period;
      }
      hands[hand].holding[s] = true;
      const k = THREE.MathUtils.clamp(mod(t - heldFrom, period) / heldFor, 0, 1);
      const position = hands[hand].positions[s]
        .clone()
        .add(new THREE.Vector3(THREE.MathUtils.lerp(startOffset, endOffset, k), 0, 0))
        .sub(gripOffset(prop, s));
      track.push(position);
    }
    props.push(track);
    inAir.push(air);
  }

  // クラブは握ったハンドルに垂直な向きへ手のひらを向け、指はハンドルに巻き付く向きにする。
  // リングは手のひらを輪の中心側へ向け、指は握った縁に巻き付く向きにする
  if (propType !== 'ball') {
    [LEFT, RIGHT].forEach((hand) => {
      const side = hand === RIGHT ? 1 : -1;
      const defaultFinger = new THREE.Vector3(-side * 0.35, 0, -1).normalize();
      const fingers: THREE.Vector3[] = [];
      for (let s = 0; s < numSteps; s++) {
        fingers.push(defaultFinger.clone());
        if (!hands[hand].holding[s]) continue;
        const prop = props.findIndex((track, i) => !inAir[i][s] && track[s].distanceTo(hands[hand].positions[s]) < 0.3);
        if (prop < 0) continue;
        const n = hands[hand].palmNormals[s];
        if (propType === 'club') {
          const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(meshQ(prop, s));
          const orth = n.clone().addScaledVector(axis, -n.dot(axis));
          if (orth.lengthSq() > 0.05) n.copy(orth.normalize());
          const wrap = new THREE.Vector3().crossVectors(n, axis).normalize();
          if (wrap.x * side > 0) wrap.negate();
          fingers[s].copy(wrap);
        } else {
          const toCenter = props[prop][s].clone().sub(hands[hand].positions[s]).normalize();
          // 握った所の縁の向き(輪の接線)
          const ringNormal = new THREE.Vector3(0, 1, 0).applyQuaternion(meshQ(prop, s));
          const edge = new THREE.Vector3().crossVectors(ringNormal, toCenter).normalize();
          n.lerp(toCenter, 0.6);
          if (propType === 'ring') n.add(new THREE.Vector3(-side * RING_PALM_INWARD, 0, 0)).normalize();
          const orth = n.clone().addScaledVector(edge, -n.dot(edge));
          n.copy(orth.lengthSq() > 0.05 ? orth : n).normalize();
          const wrap = new THREE.Vector3().crossVectors(n, edge).normalize();
          if (wrap.dot(defaultFinger) < 0) wrap.negate();
          fingers[s].copy(wrap);
        }
      }
      // 持ち替えの瞬間に手首が跳ねないようにならす
      hands[hand].fingerDirs = boxSmooth(fingers, Math.max(1, Math.round(0.04 / dt))).map((v) => v.normalize());
    });
  }

  // 体の動き用: 投げの一覧
  const throws: ThrowEvent[] = flights
    .map((f) => ({ time: f.release, hand: f.throwHand, prop: f.prop, value: f.value, velocity: f.velocity.clone() }))
    .sort((a, b) => a.time - b.time);

  // リング同士が交差していたら、投げごとに飛ぶ面の奥行きを選び直して作り直す
  if (isRingType(propType) && !ringDepths && orientations && flights.every((f) => !f.bounce)) {
    const depths = chooseRingDepths(flights, period, dt, props, orientations);
    if (depths.some((d) => d !== 0)) return buildNaturalTracks(siteswap, transform, propType, propRadius, depths);
  }

  const gaze = computeGazeTrack(inAir, props, numSteps);
  return {
    numSteps,
    stepDuration: dt,
    period,
    props,
    propRotations: orientations,
    hands,
    gaze,
    throws,
    ...summarize(props, transform),
  };
}

/** 2 つの輪(中心・法線)が交差しているか。輪 a の上の点から輪 b までの距離で調べる */
function ringsTouch(ca: THREE.Vector3, na: THREE.Vector3, cb: THREE.Vector3, nb: THREE.Vector3) {
  const u = new THREE.Vector3().crossVectors(na, Math.abs(na.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : UP).normalize();
  const v = new THREE.Vector3().crossVectors(na, u);
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (let i = 0; i < RING_CIRCLE_POINTS; i++) {
    const angle = (2 * Math.PI * i) / RING_CIRCLE_POINTS;
    p.copy(ca)
      .addScaledVector(u, RING_GRIP_RADIUS * Math.cos(angle))
      .addScaledVector(v, RING_GRIP_RADIUS * Math.sin(angle));
    // 輪 b の上で p にいちばん近い点
    q.copy(p).sub(cb);
    q.addScaledVector(nb, -q.dot(nb));
    if (q.lengthSq() < 1e-10) continue;
    q.setLength(RING_GRIP_RADIUS).add(cb);
    if (p.distanceTo(q) < RING_TOUCH) return true;
  }
  return false;
}

/**
 * リング同士が交差しないように、投げごとに飛ぶ面の奥行き(z のずれ)を選ぶ。
 * 一度作った軌道(輪の中心と向き)で交差している時刻を数え、交差が減るように 1 本ずつ奥行きを選び直す。
 * 奥行きをずらすと、空中ではその投げの分だけ、手の中では受けた投げから次の投げへ徐々にずれるとみなす。
 */
function chooseRingDepths(
  flights: Flight[],
  period: number,
  dt: number,
  props: THREE.Vector3[][],
  rotations: THREE.Quaternion[][]
): number[] {
  const numSteps = props[0].length;
  const stride = Math.max(1, Math.round(RING_CHECK_INTERVAL / dt));
  // 時刻ごと・輪ごとに: 中心、法線、どの投げの奥行きをどれだけ使うか
  type Sample = { center: THREE.Vector3; normal: THREE.Vector3; a: number; b: number; w: number };
  const samples: Sample[][] = [];
  for (let step = 0; step < numSteps; step += stride) {
    const t = step * dt;
    const row: Sample[] = [];
    props.forEach((track, prop) => {
      const own = flights.map((f, ix) => ({ f, ix })).filter(({ f }) => f.prop === prop);
      if (own.length === 0) return;
      const center = track[step];
      const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(rotations[prop][step]);
      const flying = own.find(({ f }) => {
        const tau = since(t, f.release, period);
        return tau >= 0 && tau < f.duration;
      });
      if (flying) {
        row.push({ center, normal, a: flying.ix, b: flying.ix, w: 0 });
        return;
      }
      const sinceCatch = (f: Flight) => since(t, f.release + f.duration, period);
      const untilRelease = (f: Flight) => since(f.release, t, period);
      const previous = own.reduce((best, x) => (sinceCatch(x.f) < sinceCatch(best.f) ? x : best));
      const next = own.reduce((best, x) => (untilRelease(x.f) < untilRelease(best.f) ? x : best));
      const held = sinceCatch(previous.f) + untilRelease(next.f) || period;
      const w = THREE.MathUtils.clamp(sinceCatch(previous.f) / held, 0, 1);
      row.push({ center, normal, a: previous.ix, b: next.ix, w: w * w * (3 - 2 * w) });
    });
    samples.push(row);
  }

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const touching = (depths: number[]) => {
    let count = 0;
    samples.forEach((row) => {
      for (let i = 0; i < row.length; i++) {
        const A = row[i];
        a.copy(A.center).setZ(A.center.z + depths[A.a] * (1 - A.w) + depths[A.b] * A.w);
        for (let j = i + 1; j < row.length; j++) {
          const B = row[j];
          b.copy(B.center).setZ(B.center.z + depths[B.a] * (1 - B.w) + depths[B.b] * B.w);
          if (a.distanceTo(b) > 2 * RING_GRIP_RADIUS + RING_TOUCH) continue;
          if (ringsTouch(a, A.normal, b, B.normal)) count++;
        }
      }
    });
    return count;
  };

  // まず左右の手ごとに投げの面をずらす(カスケードですれ違う輪は投げた手が違う)。次に 1 本ずつ選び直す
  let depths = flights.map(() => 0);
  let best = touching(depths);
  RING_DEPTH_OPTIONS.forEach((left) =>
    RING_DEPTH_OPTIONS.forEach((right) => {
      if (best === 0) return;
      const candidate = flights.map((f) => (f.throwHand === LEFT ? left : right));
      const count = touching(candidate);
      if (count < best) {
        best = count;
        depths = candidate;
      }
    })
  );
  for (let round = 0; round < RING_DEPTH_ROUNDS && best > 0; round++) {
    let improved = false;
    flights.forEach((_, i) => {
      let chosen = depths[i];
      RING_DEPTH_OPTIONS.forEach((depth) => {
        if (depth === chosen || best === 0) return;
        depths[i] = depth;
        const count = touching(depths);
        if (count < best) {
          best = count;
          chosen = depth;
          improved = true;
        }
        depths[i] = chosen;
      });
    });
    if (!improved) break;
  }
  return depths;
}

/** start から end へ duration 秒で届く速度と縦の動きを決める(跳ねる投げは床で跳ねる動きを解く) */
function solveFlight(f: Flight) {
  const T = f.duration;
  f.velocity
    .copy(f.end)
    .sub(f.start)
    .multiplyScalar(1 / T);
  if (f.bounce) {
    const { floors, restitution, tossUp, catchUp, strict } = f.bounce;
    const segments = solveBounce(f.start.y, f.end.y, T, floors, restitution, tossUp, catchUp, strict, GRAVITY);
    // 解けない跳ね方は、gunswap の軌道で表示する(呼び出し側で切り替える)
    if (!segments) throw new Error('バウンドの軌道を解けませんでした');
    f.segments = segments;
    f.velocity.y = segments[0].vy;
    return;
  }
  f.velocity.y += 0.5 * GRAVITY * T;
  f.segments = [{ t0: 0, y0: f.start.y, vy: f.velocity.y }];
}

function flightAt(f: Flight, tau: number, out = new THREE.Vector3()) {
  return out.copy(f.start).addScaledVector(f.velocity, tau).setY(bounceHeightAt(f.segments, tau, GRAVITY).y);
}

function flightVelocityAt(f: Flight, tau: number) {
  return f.velocity.clone().setY(bounceHeightAt(f.segments, tau, GRAVITY).vy);
}

/**
 * クラブ・リングの向き(モデルの回転)を時刻ごとに作る。
 * クラブ・パンケーキ: 手の内側へ少し向けた前方を基準に、仰角だけを変える(空中では横軸まわりに回転)。
 * リング: 輪の面を体の横向きに立て、空中では面の中で少し回す。
 */
function buildOrientations(
  propType: string,
  flights: Flight[],
  numProps: number,
  numSteps: number,
  period: number,
  siteswap: any
): THREE.Quaternion[][] {
  const dt = period / numSteps;
  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3(0, 0, 1);
  const rad = THREE.MathUtils.degToRad;
  const smooth = (x: number) => x * x * (3 - 2 * x);

  const spin = propType === 'pancake' ? PANCAKE_SPIN : CLUB_SPIN;
  const inwardYaw = propType === 'ring' ? RING_INWARD_YAW : spin.inwardYaw;
  const yawOf = (hand: number) => rad(inwardYaw) * (hand === RIGHT ? 1 : -1);

  // クラブのモデルは y 軸が柄の向き。pitch = 90° で真上、0° で前を向く
  const clubQ = (pitch: number, yaw: number) =>
    new THREE.Quaternion()
      .setFromAxisAngle(Y, yaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(X, pitch - Math.PI / 2));
  // リングのモデルは y 軸が輪の面の法線。パンケーキは「握る縁 → 中心」をクラブの柄と同じ向きにする(pitch = 0 で水平)
  const pancakeBase = new THREE.Quaternion().setFromAxisAngle(X, Math.PI / 2);
  const spinnerQ = (pitch: number, yaw: number) =>
    propType === 'pancake' ? clubQ(pitch, yaw).multiply(pancakeBase) : clubQ(pitch, yaw);
  // ふつうのリング: 法線を体の横(x)へ向け、x 軸まわりに面の中で回す
  const ringBase = new THREE.Quaternion().setFromAxisAngle(Z, -Math.PI / 2);
  const ringQ = (angle: number, yaw: number) =>
    new THREE.Quaternion()
      .setFromAxisAngle(Y, yaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(X, angle))
      .multiply(ringBase);

  const release = rad(spin.release);
  const low = rad(spin.low);
  const caught = rad(spin.catch);
  // 1 回のフライトで回る角度(リリース角からキャッチ角まで + 整数回転)
  const turn = (f: Flight) => Math.floor(f.value / 2) * 2 * Math.PI + caught - release;

  const result: THREE.Quaternion[][] = [];
  for (let prop = 0; prop < numProps; prop++) {
    const own = flights.filter((f) => f.prop === prop).sort((a, b) => a.release - b.release);
    const track: THREE.Quaternion[] = [];
    for (let s = 0; s < numSteps; s++) {
      const t = s * dt;
      if (own.length === 0) {
        const hand = siteswap.propOrbits[prop][0].hand;
        track.push(propType === 'ring' ? ringQ(0, yawOf(hand)) : spinnerQ(release, yawOf(hand)));
        continue;
      }
      const flying = own.find((f) => {
        const tau = since(t, f.release, period);
        return tau >= 0 && tau < f.duration - EPS;
      });
      if (flying) {
        const k = Math.max(0, since(t, flying.release, period)) / flying.duration;
        const yaw = THREE.MathUtils.lerp(yawOf(flying.throwHand), yawOf(flying.catchHand), k);
        track.push(
          propType === 'ring'
            ? ringQ(RING_SPIN_PER_FLIGHT * 2 * Math.PI * k, yaw)
            : spinnerQ(release + turn(flying) * k, yaw)
        );
        continue;
      }
      // 手の中: キャッチの角度 → 前へ倒す → リリース角
      const sinceCatch = (f: Flight) => since(t, f.release + f.duration, period);
      const untilRelease = (f: Flight) => since(f.release, t, period);
      const previous = own.reduce((best, f) => (sinceCatch(f) < sinceCatch(best) ? f : best));
      const next = own.reduce((best, f) => (untilRelease(f) < untilRelease(best) ? f : best));
      const yaw = yawOf(previous.catchHand);
      if (propType === 'ring') {
        // 輪は回しても形が変わらないので、手の中では回転を 0 に戻してよい
        track.push(ringQ(0, yaw));
        continue;
      }
      const held = sinceCatch(previous) + untilRelease(next) || period;
      const k = THREE.MathUtils.clamp(sinceCatch(previous) / held, 0, 1);
      const pitch =
        k < spin.lowAt
          ? THREE.MathUtils.lerp(caught, low, smooth(k / spin.lowAt))
          : THREE.MathUtils.lerp(low, release, smooth((k - spin.lowAt) / (1 - spin.lowAt)));
      track.push(spinnerQ(pitch, yaw));
    }
    result.push(track);
  }
  return result;
}
