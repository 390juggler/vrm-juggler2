# VRM Juggler

gunswap を流用して VRM 形式の 3D モデルにジャグリングをさせるライブラリ

> 参照
>
> - http://www.gunswap.co/about
> - https://github.com/yDgunz/gunswap/

## パッケージのインストール

事前に node.js (18 以上) をインストールしてください。

```cmd
npm i
```

yarn の場合は

```cmd
yarn install
```

## ライブラリのビルド

```cmd
npm run build
```

or

```cmd
yarn run build
```

ビルドが完了すると dist フォルダに vrm-juggler.min.js が生成されます。

## 利用方法

dist フォルダ内の index.html を参考にしてください。
ローカルで試す場合は `npx http-server dist` などでサーバーを立てて開いてください(ファイルを直接開くと VRM を読み込めません)。

生成された js ファイルを html ファイルに読み込む。

```html
<script src="./vrm-juggler.min.js"></script>
```

表示する場所を用意する。

```html
<div id="vrm-juggler"></div>
```

js ファイルまたは `<script>`内に下記のコードを記述する。

```js
document.addEventListener('DOMContentLoaded', () => {
  // モデルを省略すると ./models/default.vrm を読み込みます
  const juggler = new VRMJuggler('#vrm-juggler');

  // 別の VRM を指定する場合
  // const juggler = new VRMJuggler('#vrm-juggler', 'VRMファイルのパス');
});
```

### 操作用のメソッド

| メソッド                  | 内容                                                                                                   |
| :------------------------ | :----------------------------------------------------------------------------------------------------- |
| `loadModel(path)`         | VRM を読み込んで差し替えます(何度呼んでも OK)。ファイル選択の場合は `URL.createObjectURL(file)` を渡す |
| `setSiteswap('531')`      | サイトスワップを変更します。投げられないパターンの場合は今のパターンのまま、理由と近い候補を表示します |

`setSiteswap` の戻り値は `{ ok, siteswap, message, suggestions }` です。
パターンが変わると、表示場所の要素に `siteswapchange` イベント(`e.detail.siteswap`)が送られます。

### 投げられないサイトスワップ

- 数字の平均が整数にならない(例: `54`) → 合計と桁数を表示
- 同じタイミングに 2 つ落ちてくる(例: `432`) → どの投げ同士がぶつかるかを表示
- 書き方の誤り・同時投げ/マルチプレックスの不正 → gunswap の判定を日本語で表示
- 1 か所の変更・入れ替えで投げられる「近いパターン」を最大 3 つ提案(クリックで切り替え)
- 全角数字(`５３１`)も入力できます

## パラメータ調整

Esc キー押下でパラメータ調整用の UI を開くことができます。

### パラメータ一覧

| グループ         | パラメータ名   | データ型 | 範囲                                                                     |
| :--------------- | :------------- | :------- | :----------------------------------------------------------------------- |
| ジャグリング関係 | サイトスワップ | string   | 例: 3, 441, 531, 97531, (4,4), (6x,4)*, [43]23                            |
|                  | 高さ           | number   | 0.05 ～ 0.5 (1 拍の秒数。動かすと自動テンポは切れます)                   |
|                  | 高さを自動で決める | check | true or false (パターンに合わせてテンポを決める)                         |
|                  | スピード       | number   | 0.2 ～ 1.5 (1 が実時間)                                                  |
|                  | 小道具の種類   | string   | 'ball' or 'club' or 'ring'                                               |
|                  | Dwell(投げ方)  | string   | 'Cascade' or 'Reverse Cascade' or 'Shower' or 'Windmill' or 'Mills Mess' |
| 高度な設定       | 肘の開き       | number   | 0.0 ～ 0.5                                                               |
| 表情             | 喜             | number   | 0.0 ～ 1.0                                                               |
|                  | 怒             | number   | 0.0 ～ 1.0                                                               |
|                  | 哀             | number   | 0.0 ～ 1.0                                                               |
|                  | 楽             | number   | 0.0 ～ 1.0                                                               |
| 口の形           | 母音「あ」     | number   | 0.0 ～ 1.0                                                               |
|                  | 母音「い」     | number   | 0.0 ～ 1.0                                                               |
|                  | 母音「う」     | number   | 0.0 ～ 1.0                                                               |
|                  | 母音「え」     | number   | 0.0 ～ 1.0                                                               |
|                  | 母音「お」     | number   | 0.0 ～ 1.0                                                               |
| まばたき         | まばたき       | check    | true or false                                                            |
| 首の動き         | 首の動き       | check    | true or false                                                            |
| 体の動き         | 体の動き       | check    | true or false (膝・胸・肩の動き)                                         |

## 動きのしくみ

- ボールと手の軌道は gunswap (`src/motion/juggling/Siteswap.js`) で計算し、アバターの腕の長さ・肩の高さに合わせて変換しています(`tracks.ts`)
- 腕は 2 関節 IK で、手のひらの中心がボールの真下に来るように手首の位置と向きを決めています(`src/motion/body`)
- 手のひらは、手がボールに加える力(加速度 + 重力)の向きに傾きます
- ボールを持っている間は指を握り、投げた後は開きます
- 拍に合わせて膝を軽く曲げ伸ばしし、胸・肩・首もパターンに合わせて動きます
- 目は次にキャッチするボールを追います(リリース点から頂点へ 78% の位置)

### 参考にしたシミュレーター

- [Juggling Lab](https://github.com/jkboyce/jugglinglab)
  - テンポの自動決定(`calcBps`: 高さごとの 1 秒あたりの投げ数)
  - ボールを持つ時間の既定値 1.3 拍
  - どの投げも最低 0.3 拍は空中にいる('1' の投げを早める)
  - 使えない文字の位置を示すエラー
- [siteswap-performer](https://github.com/aratama-ship-it/siteswap-performer)
  - 実際のジャグラーの計測値(キャッチ位置はリリース位置より高い、持つ時間は手の周期の 6 割強)
  - 視線の決め方
- [gunswap](https://github.com/yDgunz/gunswap): 軌道計算の元

## 対応している VRM

VRM 0.x 形式(VRoid Studio の「VRM0.0」で書き出したもの)に対応しています。
