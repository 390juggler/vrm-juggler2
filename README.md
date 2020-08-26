# VRM Juggler

gunswap を流用して VRM 形式の 3D モデルにジャグリングをさせるライブラリ

> 参照
>
> - http://www.gunswap.co/about
> - https://github.com/yDgunz/gunswap/

## パッケージのインストール

事前に node.js のインストールをしてください。

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

dist ファルダ内の index.html を参考にしてください。

生成された js ファイルを html ファイルに読み込む。

```html
<script src="./vrm-juggler.min.js"></script>
```

生成された js ファイルを html ファイルに読み込む。

```html
<div id="vrm-juggler"></div>
```

js ファイルまたは `<script>`内に下記のコードを記述する。

```js
document.addEventListener('DOMContentLoaded', () => {
  new VRMJuggler('#vrm-juggler', 'VRMファイルのパス');
});
```

## パラメータ調整

Esc キー押下でパラメータ調整用の UI を開くことができます。

### パラメータ一覧

| グループ         | パラメータ名     | データ型 | 範囲                                                                     |
| :--------------- | :--------------- | :------- | :----------------------------------------------------------------------- |
| ジャグリング関係 | サイトスワップ数 | number   | 1 ～ 9                                                                   |
|                  | 投げる高さ       | number   | 0.05 ～ 0.5                                                              |
|                  | 小道具の種類     | string   | 'ball' or 'club' or 'ring'                                               |
|                  | Dwell(投げ方)    | string   | 'Cascade' or 'Reverse Cascade' or 'Shower' or 'Windmill' or 'Mills Mess' |
| 表情             | 喜               | number   | 0.0 ～ 1.0                                                               |
|                  | 怒               | number   | 0.0 ～ 1.0                                                               |
|                  | 哀               | number   | 0.0 ～ 1.0                                                               |
|                  | 楽               | number   | 0.0 ～ 1.0                                                               |
| 口の形           | 母音「あ」       | number   | 0.0 ～ 1.0                                                               |
|                  | 母音「い」       | number   | 0.0 ～ 1.0                                                               |
|                  | 母音「う」       | number   | 0.0 ～ 1.0                                                               |
|                  | 母音「え」       | number   | 0.0 ～ 1.0                                                               |
|                  | 母音「お」       | number   | 0.0 ～ 1.0                                                               |
| まばたき         | まばたき         | check    | true or false                                                            |
