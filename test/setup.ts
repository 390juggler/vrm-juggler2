// gunswap の util.js はブラウザ前提で window に関数を登録するので、Node では globalThis を window とみなす
(globalThis as any).window = globalThis;
