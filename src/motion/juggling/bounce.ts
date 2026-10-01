/**
 * 水平な床で跳ねる投げの縦の動きを解析的に求める。
 * 横の動きは等速なので、縦だけ「投げる縦の速さ」を探せばよい(跳ねるたびに速さが反発係数倍になる放物線のつながり)。
 * natural.ts と gunswap(Siteswap.js)の両方で使う。gunswap の遺伝的アルゴリズムより速く、解があれば必ず見つかる。
 */

/** 縦の動きの区間(床で跳ねるたびに区切る)。t0 からは y0、上向きの速さ vy の放物線 */
export interface BounceSegment {
  t0: number;
  y0: number;
  vy: number;
}

const SPEED_MAX = 12; // m/s(投げる縦の速さを探す範囲。強く床へ投げつけても 10m/s 前後)
const SCAN_STEPS = 400;
const BISECTION_STEPS = 40;
const TOLERANCE = 1e-3; // m

/** 縦の速さ vy で投げた時の縦の動き。床の高さ floors の順に跳ね、T 秒後の高さと速さを返す(跳ね方が合わなければ undefined) */
function simulate(y0: number, vy: number, T: number, floors: number[], restitution: number, gravity: number) {
  const segments: BounceSegment[] = [{ t0: 0, y0, vy }];
  let t = 0;
  let y = y0;
  let v = vy;
  for (const floor of floors) {
    const disc = v * v + 2 * gravity * (y - floor);
    if (disc < 0) return undefined;
    const fall = (v + Math.sqrt(disc)) / gravity;
    if (fall <= 1e-4 || t + fall >= T) return undefined;
    t += fall;
    v = restitution * Math.sqrt(disc);
    y = floor;
    segments.push({ t0: t, y0: y, vy: v });
  }
  const tau = T - t;
  const yT = y + v * tau - 0.5 * gravity * tau * tau;
  // 受ける前にもう一度床に着いてしまう
  if (yT < floors[floors.length - 1] - 1e-6) return undefined;
  return { segments, yT, vT: v - gravity * tau };
}

/**
 * 高さ y0 から投げ、floors の高さ(小道具の中心)で順に跳ねて、T 秒後に高さ yEnd に届く縦の動きを探す。
 * tossUp: 上へ投げる(リフトバウンス)か、下へ投げつける(フォースバウンス)か。
 * strict: 跳ね方が指定されている時は true。その向きで届かなければ undefined(呼び出し側でテンポを遅くして試す)。
 *         指定がない時は逆向きの投げ方も試す。
 * catchUp: 上がってくるところを受けるか。解が複数ある時は、これに合うもののうち受ける時の縦の速さが小さいものを選ぶ。
 */
export function solveBounce(
  y0: number,
  yEnd: number,
  T: number,
  floors: number[],
  restitution: number,
  tossUp: boolean,
  catchUp: boolean,
  strict: boolean,
  gravity = 9.8
): BounceSegment[] | undefined {
  const solveIn = (low: number, high: number) => {
    const f = (vy: number) => {
      const r = simulate(y0, vy, T, floors, restitution, gravity);
      return r ? r.yT - yEnd : undefined;
    };
    const roots: { segments: BounceSegment[]; vT: number }[] = [];
    let prevV = low;
    let prevF = f(low);
    for (let i = 1; i <= SCAN_STEPS; i++) {
      const v = low + ((high - low) * i) / SCAN_STEPS;
      const value = f(v);
      if (value !== undefined && prevF !== undefined && Math.sign(value) !== Math.sign(prevF)) {
        let a = prevV;
        let b = v;
        let fa = prevF;
        for (let k = 0; k < BISECTION_STEPS; k++) {
          const m = (a + b) / 2;
          const fm = f(m);
          if (fm === undefined) break;
          if (Math.sign(fm) === Math.sign(fa)) {
            a = m;
            fa = fm;
          } else b = m;
        }
        const r = simulate(y0, (a + b) / 2, T, floors, restitution, gravity);
        if (r && Math.abs(r.yT - yEnd) < TOLERANCE) roots.push(r);
      }
      prevV = v;
      prevF = value;
    }
    if (roots.length === 0) return undefined;
    const matching = roots.filter((r) => r.vT > 0 === catchUp);
    const candidates = matching.length > 0 ? matching : roots;
    return candidates.reduce((best, r) => (Math.abs(r.vT) < Math.abs(best.vT) ? r : best)).segments;
  };
  const up = () => solveIn(0, SPEED_MAX);
  const down = () => solveIn(-SPEED_MAX, 0);
  if (strict) return tossUp ? up() : down();
  return tossUp ? up() || down() : down() || up();
}

/** 区間の列から、時刻 t の縦の位置と速さ */
export function bounceHeightAt(segments: BounceSegment[], t: number, gravity = 9.8) {
  let segment = segments[0];
  for (const s of segments) if (s.t0 <= t) segment = s;
  const u = t - segment.t0;
  return { y: segment.y0 + segment.vy * u - 0.5 * gravity * u * u, vy: segment.vy - gravity * u };
}
