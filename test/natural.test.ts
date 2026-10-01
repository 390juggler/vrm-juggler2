import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { CreateSiteswap } from '../src/motion/juggling/Siteswap';
import { buildNaturalTracks, isNaturalSupported } from '../src/motion/juggling/natural';
import { autoBeatDuration } from '../src/motion/juggling/tempo';
import { LEFT, RIGHT, Tracks, makeTransform } from '../src/motion/juggling/tracks';
import { PATTERN_PRESETS } from '../src/presets';

/**
 * 動きの品質のテスト。見た目で気づいた不自然さ(手が止まったままボールが飛ぶ、ボールの瞬間移動、
 * 手同士がぶつかる、腕が届かない…)を数値で確かめ、調整で崩れないようにする。
 */

// デフォルトモデル(VRoid)の体格
const METRICS = { shoulderY: 1.403, shoulderX: 0.137, shoulderZ: 0.021, upperArmLength: 0.278, armLength: 0.533 };
const SHOULDERS = [new THREE.Vector3(-0.137, 1.403, 0.021), new THREE.Vector3(0.137, 1.403, 0.021)];

function build(siteswap: string, prop = 'ball'): { tracks: Tracks; source: any } {
  const source = CreateSiteswap(siteswap, {
    beatDuration: autoBeatDuration(siteswap, 1.3),
    dwellRatio: 1.3,
    props: [{ type: prop, color: 'random', radius: 0.05, C: 0.9 }],
    dwellPath: '(30,10)(10)',
    armAngle: 0.3,
    surfaces: [{ position: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, scale: 5, color: '#fff' }],
    jugglers: [{ position: { x: 0, z: 0 }, rotation: 0, color: 'grey' }],
    startingHand: 'RIGHT',
  });
  expect(source.errorMessage).toBeUndefined();
  expect(isNaturalSupported(source)).toBe(true);
  const tracks = buildNaturalTracks(source, makeTransform(METRICS), prop, prop === 'ball' ? 0.05 : 0.03);
  return { tracks, source };
}

// 動きの調整で崩れやすいパターンと、デモのパターン一覧
const PATTERNS = [
  ...new Set([
    ...['3', '1', '31', '51', '441', '531', '5', '423', '42', '(4,4)', '(6x,4)*', '(4,2x)*', '501', '2', 'b'],
    // 床で跳ねる投げ
    ...['3B', '4B', '5B3', '53B', '(4B,4B)'],
    ...PATTERN_PRESETS.map((p) => p.siteswap),
  ]),
];
const PROPS = ['ball', 'club', 'ring', 'pancake'];

describe.each(PROPS)('%s', (prop) => {
  it.each(PATTERNS)('%s: 軌道に異常値・瞬間移動がない', (siteswap) => {
    const { tracks } = build(siteswap, prop);
    const n = tracks.numSteps;
    tracks.props.forEach((track) =>
      track.forEach((p, k) => {
        expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
        // 1 ステップ(約 5ms)で 6cm 以上動くのは瞬間移動(最速の投げでも 5cm 未満)
        expect(p.distanceTo(track[(k + 1) % n])).toBeLessThan(0.06);
      })
    );
  });

  it.each(PATTERNS.filter((p) => p !== '2'))('%s: 投げる瞬間に手がボールと同じ速さ・向きで動いている', (siteswap) => {
    const { tracks } = build(siteswap, prop);
    const n = tracks.numSteps;
    const dt = tracks.stepDuration;
    tracks.throws.forEach((t) => {
      const k = Math.round(t.time / dt) % n;
      const hand = tracks.hands[t.hand].positions;
      const velocity = hand[k].clone().sub(hand[(k - 1 + n) % n]).divideScalar(dt);
      expect(velocity.length() / t.velocity.length()).toBeGreaterThan(0.85);
      expect(velocity.angleTo(t.velocity)).toBeLessThan(THREE.MathUtils.degToRad(15));
    });
  });

  it.each(PATTERNS)('%s: 手が肩から届く範囲にあり、左右の手がぶつからない', (siteswap) => {
    const { tracks } = build(siteswap, prop);
    for (let k = 0; k < tracks.numSteps; k++) {
      [LEFT, RIGHT].forEach((h) => {
        expect(tracks.hands[h].positions[k].distanceTo(SHOULDERS[h])).toBeLessThan(METRICS.armLength + 0.02);
      });
      // 手の中心(ボールの中心)同士。手の幅は 8cm ほど
      expect(tracks.hands[LEFT].positions[k].distanceTo(tracks.hands[RIGHT].positions[k])).toBeGreaterThan(0.11);
    }
  });
});

describe('ボール同士', () => {
  it.each(PATTERN_PRESETS.map((p) => p.siteswap))('%s: 空中ですれ違うボールがぶつからない', (siteswap) => {
    const { tracks } = build(siteswap);
    let closest = Infinity;
    for (let k = 0; k < tracks.numSteps; k++)
      for (let a = 0; a < tracks.props.length; a++)
        for (let b = a + 1; b < tracks.props.length; b++)
          closest = Math.min(closest, tracks.props[a][k].distanceTo(tracks.props[b][k]));
    // ボールの直径は 10cm
    expect(closest).toBeGreaterThan(0.11);
  });
});

describe('手首', () => {
  it("'1' を投げる時は手のひらが受け手の方へ横を向く", () => {
    // 31 は左手が 1 を投げる
    const { tracks } = build('31');
    const maxTilt = Math.max(...tracks.hands[LEFT].palmNormals.map((v) => Math.acos(Math.min(1, v.y))));
    expect(THREE.MathUtils.radToDeg(maxTilt)).toBeGreaterThan(55);
  });

  it('3 ボールカスケードでは手のひらはおおむね上を向く', () => {
    const { tracks } = build('3');
    const maxTilt = Math.max(...tracks.hands[RIGHT].palmNormals.map((v) => Math.acos(Math.min(1, v.y))));
    expect(THREE.MathUtils.radToDeg(maxTilt)).toBeLessThan(35);
  });
});

describe('手の動きのなめらかさ', () => {
  it('3 ボールで手の速度が 1 ステップで 2 倍以上跳ねない', () => {
    const { tracks } = build('3');
    const P = tracks.hands[RIGHT].positions;
    const n = P.length;
    const speed = P.map((p, k) => P[(k + 1) % n].distanceTo(p) / tracks.stepDuration);
    let spikes = 0;
    for (let k = 0; k < n; k++) {
      const a = speed[(k - 1 + n) % n];
      const b = speed[k];
      if (Math.max(a, b) > 0.3 && Math.max(a, b) / Math.max(1e-6, Math.min(a, b)) > 2) spikes++;
    }
    expect(spikes / n).toBeLessThan(0.02);
  });
});

// 輪同士が交差している時刻の割合(輪の上の点から相手の輪までの距離が輪の幅の半分より近い)
function ringTouchShare(tracks: Tracks) {
  const R = 0.145;
  let touching = 0;
  let samples = 0;
  for (let k = 0; k < tracks.numSteps; k += 2) {
    samples++;
    const rings = tracks.props.map((track, i) => ({
      c: track[k],
      n: new THREE.Vector3(0, 1, 0).applyQuaternion(tracks.propRotations![i][k]),
    }));
    const hit = rings.some((A, a) =>
      rings.some((B, b) => {
        if (b <= a || A.c.distanceTo(B.c) > 2 * R + 0.03) return false;
        const u = new THREE.Vector3().crossVectors(A.n, Math.abs(A.n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
        const v = new THREE.Vector3().crossVectors(A.n, u);
        for (let i = 0; i < 36; i++) {
          const angle = (2 * Math.PI * i) / 36;
          const p = A.c.clone().addScaledVector(u, R * Math.cos(angle)).addScaledVector(v, R * Math.sin(angle));
          const q = p.clone().sub(B.c);
          q.addScaledVector(B.n, -q.dot(B.n));
          if (q.lengthSq() < 1e-9) continue;
          if (p.distanceTo(q.setLength(R).add(B.c)) < 0.012) return true;
        }
        return false;
      })
    );
    if (hit) touching++;
  }
  return touching / samples;
}

describe('リング', () => {
  const inFlight = (tracks: Tracks, prop: number, k: number) =>
    !tracks.hands.some((hand) => hand.holding[k] && hand.positions[k].distanceTo(tracks.props[prop][k]) < 0.3);

  it('ふつうの投げは輪の面が体の横を向く(横から見ると丸く、正面からは細く見える)', () => {
    const { tracks } = build('3', 'ring');
    for (let k = 0; k < tracks.numSteps; k += 5) {
      tracks.props.forEach((_, prop) => {
        const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(tracks.propRotations![prop][k]);
        expect(Math.abs(normal.x)).toBeGreaterThan(0.95);
      });
    }
  });

  it('パンケーキは水平に投げて受け、空中でクラブのように 1 回転する', () => {
    const { tracks } = build('3', 'pancake');
    const normalAt = (prop: number, time: number) => {
      const k = Math.round(time / tracks.stepDuration) % tracks.numSteps;
      return new THREE.Vector3(0, 1, 0).applyQuaternion(tracks.propRotations![prop][k]);
    };
    tracks.throws.forEach((t) => {
      // 投げる時はほぼ水平(少し手前を上げる)
      expect(normalAt(t.prop, t.time).y).toBeGreaterThan(0.85);
      // 空中の真ん中あたりで裏返っている
      let k = Math.round(t.time / tracks.stepDuration);
      let steps = 0;
      while (inFlight(tracks, t.prop, (k + 1) % tracks.numSteps)) {
        k++;
        steps++;
      }
      expect(normalAt(t.prop, t.time + (steps / 2) * tracks.stepDuration).y).toBeLessThan(-0.8);
      // 受ける時はほぼ水平
      expect(normalAt(t.prop, k * tracks.stepDuration).y).toBeGreaterThan(0.85);
    });
  });

  it.each(['ring', 'pancake'])('%s: 基本のパターンでは輪同士が交差しない', (prop) => {
    ['3', '4', '423', '441', '531', '51', '(4,4)'].forEach((siteswap) => {
      expect(ringTouchShare(build(siteswap, prop).tracks)).toBe(0);
    });
  });

  it.each(['ring', 'pancake'])('%s: パターン一覧のどれでも、輪がかすめる時間はわずか', (prop) => {
    PATTERN_PRESETS.forEach(({ siteswap }) => {
      expect(ringTouchShare(build(siteswap, prop).tracks)).toBeLessThan(0.02);
    });
  });
});

describe('クラブ', () => {
  it('放す瞬間は斜め上(約 40°)を向き、1 回転と少し回ってほぼ縦で受ける', () => {
    const { tracks } = build('3', 'club');
    const pitchAt = (prop: number, time: number) => {
      const k = Math.round(time / tracks.stepDuration) % tracks.numSteps;
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(tracks.propRotations![prop][k]);
      return THREE.MathUtils.radToDeg(Math.atan2(axis.y, -axis.z));
    };
    tracks.throws.forEach((t) => {
      expect(Math.abs(pitchAt(t.prop, t.time) - 40)).toBeLessThan(5);
    });
  });
});
