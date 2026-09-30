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
  computeGazeTrack,
  propBaseQuaternion,
  summarize,
  transformPoint,
} from './tracks';

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
 *
 * バウンド・複数人のパターンは対象外(null を返し、gunswap の軌道を使う)。
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

// 小道具が大きいほど幅を広く投げる(空中で重ならないように)
const PROP_WIDTH: { [type: string]: number } = { ball: 1, club: 1.15, ring: 1.3 };
// リングは同じ面を飛ぶと輪同士が交差するので、1 本ずつ奥行きをずらして平行な面を飛ばす
const RING_LAYER_GAP = 0.03; // m

// 小道具の握る位置
const CLUB_GRIP_LOCAL = new THREE.Vector3(0, -0.13, 0); // クラブのモデル座標(ノブ側)
const RING_GRIP_RADIUS = 0.145; // 輪の太さの中央

// クラブの向き: 前方からの仰角(度)。キャッチでほぼ真上、運ぶ間に斜め上まで前へ倒し、手首を返して投げる。
// 空中では「投げの高さ / 2 の整数部分」回転 + キャッチでほぼ縦になる分だけ回る('1' は回転せずに手渡す)
const CLUB_RELEASE_PITCH = 40;
const CLUB_CATCH_PITCH = 85;
const CLUB_LOW_PITCH = 15; // 運ぶ途中で一番前へ倒れる角度
const CLUB_LOW_AT = 0.65; // 手に持っている時間のうち、一番倒れるタイミング
const CLUB_INWARD_YAW = 12; // 体の内側へ向ける角度
const RING_SPIN_PER_FLIGHT = 0.5; // リングが 1 回のフライトで回る量(回転)

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
  velocity: THREE.Vector3;
  end: THREE.Vector3;
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

export function isNaturalSupported(siteswap: any): boolean {
  if (siteswap.numJugglers !== 1) return false;
  return siteswap.propOrbits.every((orbit: any[]) => orbit.every((toss) => !toss.numBounces));
}

export function buildNaturalTracks(
  siteswap: any,
  transform: SpaceTransform,
  propType: string,
  propRadius: number
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
    if (propType === 'ring') {
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
  const toWorld = (hand: number, p: { x: number; y: number; z: number }) =>
    transformPoint(
      { x: (hand === LEFT ? -1 : 1) * p.x * width, y: 1.15 + p.y, z: p.z - 0.35 },
      transform,
      new THREE.Vector3()
    );

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
    return toWorld(toss.hand, p);
  };
  const catchPoint = (toss: any, incomingValue: number) => {
    const pts = dwellPoints(toss.dwellPathIx);
    const p = { ...pts[0] };
    if (cascadeLike(toss.dwellPathIx)) {
      p.x = catchX(p.x, incomingValue);
      // '1' は横へ押し出す手渡しなので、投げた高さのまま受ける(手のひらが受け手の方へ横を向く)
      if (incomingValue === 1) p.y = pts[pts.length - 1].y;
    }
    return toWorld(toss.hand, p);
  };

  // ---- 出来事を集める ----
  const flights: Flight[] = [];
  const holdTosses: { hand: number; toss: any; next: any }[] = [];
  siteswap.propOrbits.forEach((orbit: any[], prop: number) => {
    orbit.forEach((toss, k) => {
      const next = orbit[(k + 1) % orbit.length];
      if (toss.hold) {
        holdTosses.push({ hand: toss.hand, toss, next });
        return;
      }
      const release = mod(toss.beat * beat + toss.dwellDuration, period);
      let duration = mod(next.beat * beat - release, period);
      if (duration < 1e-6) duration += period;
      flights.push({
        prop,
        release,
        duration,
        throwHand: toss.hand,
        catchHand: next.hand,
        value: toss.numBeats,
        start: throwPoint(toss, next.hand !== toss.hand),
        velocity: new THREE.Vector3(),
        end: catchPoint(next, toss.numBeats),
      });
    });
  });

  if (propType === 'club' || propType === 'ring') {
    orientations = buildOrientations(propType, flights, numProps, numSteps, period, siteswap);
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

  // 重心の放物線(握る位置のずれは、その時刻の小道具の向きから求める)
  const layer = (prop: number) => (propType === 'ring' ? (prop - (numProps - 1) / 2) * RING_LAYER_GAP : 0);
  flights.forEach((f) => {
    f.start.z += layer(f.prop);
    f.end.z += layer(f.prop);
    const releaseStep = stepOf(f.release);
    const catchStep = stepOf(f.release + f.duration);
    // throwPoint / catchPoint は手(握る位置)。重心はそこから握る位置のずれを引く
    f.start.x += releaseOffset.get(f)!;
    f.end.x += catchOffset.get(f)!;
    f.start.sub(gripOffset(f.prop, releaseStep));
    f.end.sub(gripOffset(f.prop, catchStep));
    const T = f.duration;
    f.velocity
      .copy(f.end)
      .sub(f.start)
      .multiplyScalar(1 / T);
    f.velocity.y += 0.5 * GRAVITY * T;
  });

  const flightAt = (f: Flight, tau: number, out = new THREE.Vector3()) =>
    out
      .copy(f.start)
      .addScaledVector(f.velocity, tau)
      .add(new THREE.Vector3(0, -0.5 * GRAVITY * tau * tau, 0));
  const flightVelocityAt = (f: Flight, tau: number) => f.velocity.clone().add(new THREE.Vector3(0, -GRAVITY * tau, 0));

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
    const handVelocity = vIncoming.clone().multiplyScalar(CATCH_ABSORB);
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
        position: e.position.clone().addScaledVector(followVelocity, followTime * ((1 + FOLLOW_END_SPEED) / 2)),
        velocityIn: followVelocity.clone().multiplyScalar(FOLLOW_END_SPEED),
        velocityOut: followVelocity.clone().multiplyScalar(FOLLOW_END_SPEED),
        palm: e.palm.clone(),
      });
      const available = mod(e.time - prev.time, period) || period;
      const speed = e.velocityIn.length();
      if (speed < 1e-3) return;
      const startSpeed = speed * THROW_STROKE_START_SPEED;
      let stroke = THREE.MathUtils.clamp((speed * speed) / (2 * THROW_ACCEL), THROW_STROKE_MIN, THROW_STROKE_MAX);
      let duration = stroke / ((speed + startSpeed) / 2);
      if (duration > available * THROW_STROKE_MAX_SHARE) {
        duration = available * THROW_STROKE_MAX_SHARE;
        stroke = ((speed + startSpeed) / 2) * duration;
      }
      const dir = e.velocityIn.clone().normalize();
      // 投げる区間の始まりは手の軌道の一番下。縦の速度は 0 にして、横は内側へすくう動きを続ける
      // (上向きの速度で到着させると、その手前で一度下へ潜ってしまう)
      const start = e.position.clone().addScaledVector(dir, -stroke);
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
  const restPosition = (hand: number) => toWorld(hand, { x: 0.2, y: 0, z: 0 });
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
      positions.push(hermite(a.position, a.velocityOut, b.position, b.velocityIn, T, u));

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
  // リングは手のひらを輪の中心側へ向ける
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
          n.lerp(toCenter, 0.6).normalize();
        }
      }
      // 持ち替えの瞬間に手首が跳ねないようにならす
      if (propType === 'club') {
        hands[hand].fingerDirs = boxSmooth(fingers, Math.max(1, Math.round(0.04 / dt))).map((v) => v.normalize());
      }
    });
  }

  // 体の動き用: 投げの一覧
  const throws: ThrowEvent[] = flights
    .map((f) => ({ time: f.release, hand: f.throwHand, value: f.value, velocity: f.velocity.clone() }))
    .sort((a, b) => a.time - b.time);

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

/**
 * クラブ・リングの向き(モデルの回転)を時刻ごとに作る。
 * クラブ: 手の内側へ少し向けた前方を基準に、仰角だけを変える(空中では横軸まわりに回転)。
 * リング: 輪を正面に向けて立て、車輪のように回す。
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
  const FORWARD = new THREE.Vector3(0, 0, -1);
  const rad = THREE.MathUtils.degToRad;
  const yawOf = (hand: number) => rad(CLUB_INWARD_YAW) * (hand === RIGHT ? 1 : -1);

  const clubQ = (pitch: number, yaw: number) =>
    new THREE.Quaternion()
      .setFromAxisAngle(Y, yaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(X, pitch - Math.PI / 2));
  const ringQ = (spin: number) =>
    new THREE.Quaternion()
      .setFromAxisAngle(FORWARD, spin)
      .multiply(new THREE.Quaternion().setFromAxisAngle(X, -Math.PI / 2));

  const release = rad(CLUB_RELEASE_PITCH);
  const low = rad(CLUB_LOW_PITCH);
  // 1 回のフライトで回る角度(リリース角からキャッチ角まで + 整数回転)
  const clubTurn = (f: Flight) => Math.floor(f.value / 2) * 2 * Math.PI + rad(CLUB_CATCH_PITCH - CLUB_RELEASE_PITCH);

  const result: THREE.Quaternion[][] = [];
  for (let prop = 0; prop < numProps; prop++) {
    const own = flights.filter((f) => f.prop === prop).sort((a, b) => a.release - b.release);
    const track: THREE.Quaternion[] = [];
    for (let s = 0; s < numSteps; s++) {
      const t = s * dt;
      if (own.length === 0) {
        const hand = siteswap.propOrbits[prop][0].hand;
        track.push(propType === 'club' ? clubQ(release, yawOf(hand)) : ringQ(0));
        continue;
      }
      const flying = own.find((f) => {
        const tau = since(t, f.release, period);
        return tau >= 0 && tau < f.duration - EPS;
      });
      if (flying) {
        const k = Math.max(0, since(t, flying.release, period)) / flying.duration;
        if (propType === 'club') {
          const yaw = THREE.MathUtils.lerp(yawOf(flying.throwHand), yawOf(flying.catchHand), k);
          track.push(clubQ(release + clubTurn(flying) * k, yaw));
        } else {
          track.push(ringQ(RING_SPIN_PER_FLIGHT * 2 * Math.PI * k));
        }
        continue;
      }
      // 手の中: キャッチ(リリース角 + 端数回転)→ 前へ倒す → リリース角
      const sinceCatch = (f: Flight) => since(t, f.release + f.duration, period);
      const untilRelease = (f: Flight) => since(f.release, t, period);
      const previous = own.reduce((best, f) => (sinceCatch(f) < sinceCatch(best) ? f : best));
      const next = own.reduce((best, f) => (untilRelease(f) < untilRelease(best) ? f : best));
      if (propType === 'ring') {
        track.push(ringQ(0));
        continue;
      }
      const held = sinceCatch(previous) + untilRelease(next) || period;
      const k = THREE.MathUtils.clamp(sinceCatch(previous) / held, 0, 1);
      const caught = rad(CLUB_CATCH_PITCH);
      const smooth = (x: number) => x * x * (3 - 2 * x);
      const pitch =
        k < CLUB_LOW_AT
          ? THREE.MathUtils.lerp(caught, low, smooth(k / CLUB_LOW_AT))
          : THREE.MathUtils.lerp(low, release, smooth((k - CLUB_LOW_AT) / (1 - CLUB_LOW_AT)));
      track.push(clubQ(pitch, yawOf(previous.catchHand)));
    }
    result.push(track);
  }
  return result;
}
