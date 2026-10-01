import { describe, expect, it } from 'vitest';

import { normalizeSiteswap, precheckSiteswap, translateGunswapError } from '../src/motion/juggling/validate';

describe('サイトスワップの判定', () => {
  it.each(['3', '441', '531', '97531', '12345', '423', 'b', '1', '51'])('%s は投げられる', (s) => {
    expect(precheckSiteswap(s).ok).toBe(true);
  });

  it('平均が整数にならないと理由と候補を返す', () => {
    const r = precheckSiteswap('54');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('4.5');
    expect(r.suggestions).toEqual(expect.arrayContaining(['55']));
  });

  it('同じタイミングに落ちてくる投げを指摘する', () => {
    const r = precheckSiteswap('432');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('1 番目の「4」');
    expect(r.message).toContain('2 番目の「3」');
    // 候補はどれも投げられるパターン
    r.suggestions!.forEach((s) => expect(precheckSiteswap(s).ok).toBe(true));
  });

  it('全角や空白を受け付ける', () => {
    expect(normalizeSiteswap(' ５３１ ')).toBe('531');
    expect(precheckSiteswap('６４５').ok).toBe(true);
  });

  it('使えない文字は位置を示す', () => {
    const r = precheckSiteswap('5・3・1');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('2 文字目');
    expect(r.suggestions).toEqual(['531']);
  });

  it('空の入力・すべて 0', () => {
    expect(precheckSiteswap('').ok).toBe(false);
    expect(precheckSiteswap('0').ok).toBe(false);
  });

  it('gunswap のエラーを日本語にする', () => {
    expect(translateGunswapError('Invalid syntax')).toContain('書き方');
    expect(translateGunswapError('Prop landing on 0 toss at beat 3')).toContain('0');
  });
});
