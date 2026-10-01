/** デモのパターン一覧。VRMJuggler.presets で参照できる */
export interface PatternPreset {
  siteswap: string;
  /** ボールの数 */
  balls: number;
  name: string;
  description: string;
}

export const PATTERN_PRESETS: PatternPreset[] = [
  { siteswap: '40', balls: 2, name: '片手 2 ボール', description: '片手だけで 2 個を回す。もう片方の手は休み' },
  { siteswap: '31', balls: 2, name: '31', description: '3 で山なりに投げ、1 で反対の手へすっと渡す' },
  { siteswap: '3', balls: 3, name: 'カスケード', description: 'いちばん基本の 3 ボール。左右交互に同じ高さで投げる' },
  { siteswap: '423', balls: 3, name: '423', description: '4 は同じ手へ戻し、2 はちょっと持ち、3 は反対の手へ' },
  { siteswap: '441', balls: 3, name: '441', description: '高めの 4 を 2 つ投げてから、1 で手渡しする' },
  { siteswap: '531', balls: 3, name: '531', description: '高い 5、ふつうの 3、手渡しの 1 を順に投げる' },
  { siteswap: '51', balls: 3, name: 'シャワー', description: '片手は高く投げ上げ、もう片手は横へ渡して輪のように回す' },
  { siteswap: '52512', balls: 3, name: '52512', description: '5 を 2 つ高く投げ、その間に 2 と 1 でつなぐ' },
  { siteswap: '55500', balls: 3, name: 'フラッシュ', description: '3 つを高く続けて投げ、両手が一瞬からになる' },
  { siteswap: '(4,2x)*', balls: 3, name: '(4,2x)*', description: '両手同時に、片手は高く、片手は反対の手へ渡す' },
  { siteswap: '4', balls: 4, name: 'ファウンテン', description: '左右の手でそれぞれ 2 個ずつ回す(左右で交差しない)' },
  { siteswap: '53', balls: 4, name: '53', description: '5 と 3 を交互に。高い投げと低い投げが入れ替わる' },
  { siteswap: '534', balls: 4, name: '534', description: '5・3・4 の繰り返し。4 ボールの定番' },
  { siteswap: '7441', balls: 4, name: '7441', description: '高い 7 のあとに 4・4、最後に手渡しの 1' },
  { siteswap: '(4,4)', balls: 4, name: 'シンクロ', description: '両手同時に投げる 4 ボール' },
  { siteswap: '5', balls: 5, name: '5 カスケード', description: '5 個のカスケード。高く速い' },
  { siteswap: '645', balls: 5, name: '645', description: '6・4・5 の繰り返し' },
  { siteswap: '744', balls: 5, name: '744', description: '高い 7 と 4・4 の繰り返し' },
  { siteswap: '97531', balls: 5, name: '97531', description: '9 7 5 3 1 と高い順に投げ、ボールが山のように並ぶ' },
  { siteswap: '(6x,4)*', balls: 5, name: '(6x,4)*', description: '両手同時に、交差する高い 6 と同じ手への 4' },
];
