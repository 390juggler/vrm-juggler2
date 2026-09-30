/**
 * サイトスワップ入力のチェックと、エラーメッセージ(日本語)の生成。
 *
 * 通常の非同期サイトスワップ(数字と a〜w だけのもの)はここで詳しく検査し、
 * どこが悪いのか・近い正しいパターンの候補を返す。
 * 同時投げ・マルチプレックス・パッシングなどの記法は gunswap の検査結果を日本語に置き換えて使う。
 */

export interface SiteswapCheck {
  ok: boolean;
  siteswap: string;
  message?: string;
  suggestions?: string[];
}

const VANILLA_RE = /^[0-9a-w]+$/;
// 数字・英字(修飾子を含む)と、同時投げ・マルチプレックス・パッシング・バウンド指定に使う記号以外
const INVALID_CHAR_RE = /[^0-9a-zA-Z()[\],*<>|{}.\-:]/;
const MAX_THROW = 32; // 'w'
const MAX_SUGGESTIONS = 3;
const MAX_LENGTH_FOR_SUGGESTIONS = 12;
const MAX_LENGTH_FOR_TWO_CHANGES = 8;

/** 全角→半角、空白除去 */
export function normalizeSiteswap(input: string): string {
  return String(input)
    .normalize('NFKC')
    .replace(/\s/g, '');
}

function throwValue(c: string): number {
  const code = c.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  return code - 87; // 'a' = 10
}

function throwChar(v: number): string {
  return v < 10 ? String(v) : String.fromCharCode(v + 87);
}

export function isVanilla(siteswap: string): boolean {
  return VANILLA_RE.test(siteswap);
}

interface VanillaProblem {
  message: string;
}

/** 非同期サイトスワップが投げられるかを検査する。問題なければ null */
function findVanillaProblem(values: number[]): VanillaProblem | null {
  const n = values.length;
  const sum = values.reduce((a, b) => a + b, 0);

  if (sum === 0) {
    return { message: '投げるものがありません(すべて 0 です)。' };
  }

  if (sum % n !== 0) {
    const avg = Math.round((sum / n) * 100) / 100;
    return {
      message:
        `数字の平均が整数になりません(合計 ${sum} ÷ ${n} 個 = ${avg})。` +
        'サイトスワップの平均はボールの数なので、合計が桁数で割り切れる必要があります。',
    };
  }

  // (位置 + 投げの高さ) を桁数で割った余りがすべて異なれば、同じタイミングに 2 つ落ちてこない
  const landedBy: number[] = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const landing = (i + values[i]) % n;
    if (landedBy[landing] !== -1) {
      const j = landedBy[landing];
      return {
        message:
          `${j + 1} 番目の「${throwChar(values[j])}」と ${i + 1} 番目の「${throwChar(values[i])}」が` +
          '同じタイミングで同じ手に落ちてきて、ぶつかってしまいます。',
      };
    }
    landedBy[landing] = i;
  }

  return null;
}

function canonicalRotation(values: number[]): string {
  const s = values.map(throwChar).join('');
  let best = s;
  for (let i = 1; i < s.length; i++) {
    const r = s.slice(i) + s.slice(0, i);
    if (r > best) best = r;
  }
  return best;
}

/**
 * 1 か所だけ数字を変える / 隣同士を入れ替える / サイトスワップ操作(隣の投げの着地を入れ替える)
 * で投げられるパターンになるものを候補として返す。
 */
function suggestFixes(values: number[]): string[] {
  const n = values.length;
  if (n > MAX_LENGTH_FOR_SUGGESTIONS) return [];

  const original = values.map(throwChar).join('');
  const maxValue = Math.min(MAX_THROW, Math.max(9, ...values) + 1);
  const found = new Map<string, { text: string; cost: number }>();

  const consider = (candidate: number[], cost: number) => {
    if (candidate.some((v) => v < 0 || v > MAX_THROW)) return;
    if (findVanillaProblem(candidate)) return;
    const text = candidate.map(throwChar).join('');
    if (text === original) return;
    const key = canonicalRotation(candidate);
    const existing = found.get(key);
    if (!existing || existing.cost > cost) found.set(key, { text, cost });
  };

  const sum = values.reduce((a, b) => a + b, 0);
  const targetProps = Math.round(sum / n);

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (n > 1) {
      // 隣同士の入れ替え
      const swapped = values.slice();
      [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
      consider(swapped, 1);
      // サイトスワップ操作: a b → (b+1) (a-1)
      const op = values.slice();
      op[i] = values[j] + 1;
      op[j] = values[i] - 1;
      consider(op, 1);
    }
    // 1 か所だけ別の数字に変える(ボールの数が変わらないものを優先)
    for (let v = 0; v <= maxValue; v++) {
      if (v === values[i]) continue;
      const changed = values.slice();
      changed[i] = v;
      const props = changed.reduce((a, b) => a + b, 0) / n;
      consider(changed, 2 + Math.abs(props - targetProps) + Math.abs(v - values[i]) * 0.1);
    }
  }

  // 足りなければ、合計(= ボールの数)を変えずに 2 か所を変えたものも探す
  if (found.size < MAX_SUGGESTIONS && n <= MAX_LENGTH_FOR_TWO_CHANGES) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        for (let d = -3; d <= 3; d++) {
          if (d === 0) continue;
          const changed = values.slice();
          changed[i] += d;
          changed[j] -= d;
          consider(changed, 3 + Math.abs(d) * 0.1);
        }
      }
    }
  }

  return Array.from(found.values())
    .sort((a, b) => a.cost - b.cost)
    .slice(0, MAX_SUGGESTIONS)
    .map((c) => c.text);
}

export function checkVanilla(siteswap: string): SiteswapCheck {
  const values = siteswap.split('').map(throwValue);
  const problem = findVanillaProblem(values);
  if (!problem) return { ok: true, siteswap };
  return { ok: false, siteswap, message: problem.message, suggestions: suggestFixes(values) };
}

/** 入力を正規化し、書式として受け付けられるかの一次チェックをする */
export function precheckSiteswap(input: string): SiteswapCheck {
  const siteswap = normalizeSiteswap(input);
  if (siteswap === '') {
    return { ok: false, siteswap, message: 'サイトスワップを入力してください(例: 3, 441, 531)。' };
  }
  // 使えない文字があれば、その文字と位置を示す
  const badIndex = siteswap.search(INVALID_CHAR_RE);
  if (badIndex >= 0) {
    const cleaned = siteswap.replace(new RegExp(INVALID_CHAR_RE.source, 'g'), '');
    const cleanedCheck = cleaned === '' ? undefined : precheckSiteswap(cleaned);
    return {
      ok: false,
      siteswap,
      message: `「${siteswap[badIndex]}」(${badIndex + 1} 文字目)はサイトスワップに使えない文字です。`,
      suggestions: cleanedCheck && cleanedCheck.ok ? [cleaned] : cleanedCheck?.suggestions,
    };
  }
  if (isVanilla(siteswap)) return checkVanilla(siteswap);
  return { ok: true, siteswap };
}

/** gunswap(Siteswap.js)のエラーメッセージを日本語にする */
export function translateGunswapError(message: string): string {
  if (message === 'Invalid syntax') {
    return (
      '書き方が正しくありません。使える書き方の例: 3 / 441 / 10 以上は a, b … / ' +
      '同時投げ (4,4) (6x,4)* / 複数同時 [33]3。'
    );
  }
  if (message === 'Cannot determine number of props') {
    return '数字の平均が整数にならないため、ボールの数が決まりません。';
  }
  if (/^Prop landing on 0 toss/.test(message)) {
    return '「0」(空の手)のタイミングにボールが落ちてきてしまいます。';
  }
  if (/^No prop available to toss/.test(message)) {
    return '投げるタイミングに手の中にボールがありません。落ちてくるタイミングが重なっていないか確認してください。';
  }
  if (/more than 1000 beats/.test(message)) {
    return 'パターンが長すぎて計算できません(1000 拍以内で繰り返しになりません)。';
  }
  if (/'1' toss with a dwellRatio/.test(message)) {
    return '「1」を投げるには、持つ時間の割合(dwellRatio)を 1 より小さくしてください。';
  }
  if (message === 'Unable to calculate bounce path') {
    return 'バウンドの軌道が計算できませんでした。高さや床の設定を見直してください。';
  }
  if (message === 'Invalid custom dwell path') {
    return 'Dwell(手の動き)の書き方が正しくありません。例: (30)(10)';
  }
  return `このパターンは再生できません(${message})。`;
}
