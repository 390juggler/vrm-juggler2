import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { bounceHeightAt, solveBounce } from '../src/motion/juggling/bounce';
import Juggling from '../src/motion/juggling';
import Options from '../src/options';

describe('床で跳ねる軌道', () => {
  const floor = 0.05; // ボールの中心が床から半径の高さで跳ねる

  it('下へ投げつけて 1 回跳ね、決めた時刻に受ける高さへ届く', () => {
    const segments = solveBounce(1.15, 1.2, 0.6, [floor], 0.9, false, false, true)!;
    expect(segments).toBeDefined();
    expect(segments[0].vy).toBeLessThan(0);
    expect(segments).toHaveLength(2);
    expect(bounceHeightAt(segments, segments[1].t0).y).toBeCloseTo(floor, 6);
    expect(bounceHeightAt(segments, 0.6).y).toBeCloseTo(1.2, 2);
  });

  it('跳ねると速さが反発係数倍になる', () => {
    const segments = solveBounce(1.15, 1.0, 0.7, [floor], 0.8, false, false, true)!;
    const before = bounceHeightAt(segments, segments[1].t0 - 1e-9).vy;
    expect(segments[1].vy).toBeCloseTo(-before * 0.8, 3);
  });

  it('上へ投げる時間がなければ、指定どおりの向きでは解けない', () => {
    expect(solveBounce(1.15, 1.15, 0.6, [floor], 0.9, true, true, true)).toBeUndefined();
    // 向きの指定がなければ下へ投げる
    expect(solveBounce(1.15, 1.15, 0.6, [floor], 0.9, true, true, false)![0].vy).toBeLessThan(0);
  });

  it('2 回跳ねる', () => {
    const segments = solveBounce(1.15, 1.15, 2.5, [floor, floor], 0.9, false, true, true)!;
    expect(segments).toHaveLength(3);
    expect(bounceHeightAt(segments, 2.5).y).toBeCloseTo(1.15, 2);
  });
});

describe('バウンドのパターン', () => {
  const options = new Options();
  const juggling = new Juggling(new THREE.Scene(), '3', options.siteswap);

  it.each(['3B', '4B{2}', '3B{L1}', '3B{2}', '(4B,4B)', '5B3'])(
    '%s: 自動テンポで再生でき、ボールが床で跳ねる',
    (siteswap) => {
      const result = juggling.setPattern(siteswap, options.siteswap);
      expect(result.ok).toBe(true);
      const tracks = (juggling as any).tracks;
      const lowest = Math.min(...tracks.props.flat().map((p: THREE.Vector3) => p.y));
      expect(lowest).toBeLessThan(0.1);
      expect(lowest).toBeGreaterThan(0.03);
    }
  );

  it('上へ投げる指定(L)は、時間が足りなければテンポを遅くして上へ投げる', () => {
    juggling.setPattern('3B{L1}', options.siteswap);
    const tracks = (juggling as any).tracks;
    expect(juggling.beatDuration).toBeGreaterThan(0.4);
    expect(tracks.throws.every((t: any) => t.velocity.y > 0)).toBe(true);
  });
});
