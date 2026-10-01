import { describe, expect, it } from 'vitest';

import { autoBeatDuration, throwValues } from '../src/motion/juggling/tempo';

describe('テンポの自動決定(Juggling Lab の calcBps)', () => {
  it('3 ボールカスケードは 2.9 拍/秒', () => {
    expect(1 / autoBeatDuration('3', 1.3)).toBeCloseTo(2.9, 5);
  });

  it('441 は 3.4 拍/秒', () => {
    expect(1 / autoBeatDuration('441', 1.3)).toBeCloseTo(3.4, 5);
  });

  it('3 より低い投げだけなら 2 拍/秒', () => {
    expect(1 / autoBeatDuration('1', 1.3)).toBeCloseTo(2, 5);
  });

  it('高い投げは空中時間が 2.6 秒を超えないように速くする', () => {
    const beat = autoBeatDuration('b', 1.3);
    expect((11 - 1.3) * beat).toBeLessThanOrEqual(2.6 + 1e-9);
  });

  it('同時投げの x や修飾子は無視する', () => {
    expect(throwValues('(6x,4)*')).toEqual([6, 4]);
  });
});
