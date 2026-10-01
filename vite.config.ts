import { defineConfig } from 'vite';

// ライブラリとして 1 ファイル(dist/vrm-juggler.min.js)にまとめる。<script> で読み込むと window.VRMJuggler が使える
export default defineConfig(({ mode }) => ({
  publicDir: false,
  build: {
    outDir: 'dist',
    // dist には index.html やモデルも置いているので消さない
    emptyOutDir: false,
    sourcemap: mode === 'development',
    minify: mode !== 'development',
    lib: {
      entry: 'src/index.ts',
      name: 'VRMJuggler',
      formats: ['iife'],
      fileName: () => 'vrm-juggler.min.js',
    },
    rolldownOptions: {
      // 書き出すのはクラスだけにして、window.VRMJuggler がクラスそのものになるようにする
      output: { exports: 'default' },
    },
  },
}));
