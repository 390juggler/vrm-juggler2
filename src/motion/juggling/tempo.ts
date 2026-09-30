/**
 * パターンに合ったテンポ(1 拍の秒数)を決める。
 * Juggling Lab の calcBps() と同じ考え方:
 *   高さ 3 以上の投げについて、その高さの「1 秒あたりの投げ数」の平均を取り、
 *   一番高い投げの空中時間が長くなりすぎない(2.6 秒以内)ようにする。
 * https://github.com/jkboyce/jugglinglab (notation/MhnPattern.kt)
 */

// 投げの高さごとの 1 秒あたりの投げ数(index = 高さ、9 以上は 9 の値)
const THROWS_PER_SECOND = [2, 2, 2, 2.9, 3.4, 4.1, 4.25, 5, 5, 5.5];
const MAX_AIRTIME_SECONDS = 2.6;
const FALLBACK_BPS = 2.0;

export function throwValues(siteswap: string): number[] {
  // 数字と a〜w(10〜32)だけを拾う。同時投げの x や大文字の修飾子は無視する
  return (siteswap.match(/[0-9a-w]/g) || []).map((c) => {
    const code = c.charCodeAt(0);
    return code <= 57 ? code - 48 : code - 87;
  });
}

export function autoBeatDuration(siteswap: string, dwellBeats: number): number {
  const values = throwValues(siteswap);
  if (values.length === 0) return 1 / FALLBACK_BPS;

  const counted = values.filter((v) => v > 2);
  const bps =
    counted.length > 0
      ? counted.reduce((sum, v) => sum + THROWS_PER_SECOND[Math.min(v, 9)], 0) / counted.length
      : FALLBACK_BPS;
  const maxThrow = Math.max(...values);
  return 1 / Math.max(bps, (maxThrow - dwellBeats) / MAX_AIRTIME_SECONDS);
}
