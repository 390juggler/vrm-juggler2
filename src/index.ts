import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import GUI from 'lil-gui';

import Renderer from './classes/Renderer';
import Juggling from './motion/juggling';
import { SiteswapCheck } from './motion/juggling/validate';
import Body from './motion/body';
import Blink from './motion/blink';
import Facial from './motion/facial';

import Options from './options/index';

// モデルを指定しなかった時に読み込む VRM(ページからの相対パス)
const DEFAULT_MODEL_PATH = './models/default.vrm';

// フレームが大きく飛んだ時(タブを裏にした時など)に動きが暴れないようにする上限(秒)
const MAX_DELTA = 0.1;

export default class VRMJuggler {
  private selector!: string;
  private renderer!: Renderer;
  private timer = new THREE.Timer();
  private vrm?: VRM;
  private loadId = 0;
  private juggling!: Juggling;
  private body?: Body;
  private blink!: Blink;
  private facial!: Facial;
  private options!: Options;
  private showGui: boolean = false;
  private gui?: GUI;
  private message?: HTMLElement;
  private messageKind: 'none' | 'loading' | 'error' = 'none';
  private loggedError = false;

  constructor(selector: string = '', modelPath: string = DEFAULT_MODEL_PATH) {
    if (selector === '') return;
    this.selector = selector;

    this.options = new Options();
    this.renderer = new Renderer(this.selector);
    if (!this.renderer.container) {
      console.error(`VRMJuggler: ${selector} が見つかりません`);
      return;
    }
    this.createMessageArea(this.renderer.container);

    this.juggling = new Juggling(this.renderer.scene, this.options.siteswapNums, this.options.siteswap);
    this.juggling.visible = false;
    this.juggling.speed = this.options.speed;
    this.syncTempo();
    this.blink = new Blink();
    this.facial = new Facial(this.options.facial);

    this.createGUI();
    document.addEventListener('keyup', this.switchGUI, false);

    this.loadModel(modelPath || DEFAULT_MODEL_PATH);
    this.animate();
  }

  /**
   * VRM を読み込んで差し替える。何度呼んでもよい(前のモデルは破棄される)。
   */
  loadModel(modelPath: string): Promise<boolean> {
    const loadId = ++this.loadId;
    if (this.messageKind !== 'error') this.showMessage('モデルを読み込んでいます…');

    return new Promise((resolve) => {
      const onError = (error: any) => {
        if (loadId !== this.loadId) return resolve(false);
        console.error(error);
        this.showMessage(
          'VRM を読み込めませんでした。VRM ファイル(VRM 0.x / 1.0)か確認してください。' +
            (this.vrm ? '(前のモデルのまま続けます)' : ''),
          true
        );
        resolve(false);
      };

      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));
      loader.load(
        modelPath,
        (gltf) => {
          const vrm = gltf.userData.vrm as VRM | undefined;
          if (!vrm) return onError(new Error('VRM ではない glTF ファイルです'));
          // 読み込み中に別のモデルが指定された場合は捨てる
          if (loadId !== this.loadId) {
            VRMUtils.deepDispose(vrm.scene);
            return resolve(false);
          }
          VRMUtils.removeUnnecessaryVertices(gltf.scene);
          VRMUtils.combineSkeletons(gltf.scene);
          // VRM 1.0 は +Z、VRM 0.x は -Z を向いている。このライブラリは -Z を正面として扱うので 1.0 は半回転させる
          if (vrm.meta.metaVersion === '1') vrm.scene.rotation.y = Math.PI;
          this.setVRM(vrm);
          if (this.messageKind === 'loading') this.clearMessage();
          resolve(true);
        },
        (progress: ProgressEvent) => {
          if (loadId !== this.loadId || !progress.total || this.messageKind === 'error') return;
          const percent = Math.floor((progress.loaded / progress.total) * 100);
          this.showMessage(`モデルを読み込んでいます… ${percent}%`);
        },
        onError
      );
    });
  }

  private setVRM(vrm: VRM) {
    const scene = this.renderer.scene;
    if (this.vrm) {
      scene.remove(this.vrm.scene);
      this.body?.dispose(scene);
      VRMUtils.deepDispose(this.vrm.scene);
    }

    this.vrm = vrm;
    scene.add(vrm.scene);

    this.body = new Body(vrm, scene);
    this.body.armAngle = Number(this.options.siteswap.armAngle);
    this.body.motionAmount = this.options.bodyMotion;
    this.body.enableNeck = this.options.neck;
    this.juggling.setAvatarMetrics(this.body.metrics);
    this.juggling.visible = true;
    this.renderer.frameHeight(this.juggling.peakY);
    // 床にアバターの影を落とす(テクスチャの透明な部分は three.js が材質の alphaTest で抜く)
    vrm.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
    });

    this.blink.init(vrm);
    this.facial.init(vrm);
  }

  /**
   * サイトスワップを変更する。投げられないパターンの場合は今のパターンのまま、理由を画面に表示する。
   */
  setSiteswap(siteswap: string): SiteswapCheck {
    const result = this.juggling.setPattern(siteswap, this.options.siteswap);
    if (result.ok) {
      this.options.siteswapNums = result.siteswap;
      this.syncTempo();
      this.clearMessage();
      // ページ側の入力欄などが追従できるように通知する
      this.renderer.container?.dispatchEvent(
        new CustomEvent('siteswapchange', { detail: { siteswap: result.siteswap } })
      );
    } else {
      this.showSiteswapError(result);
    }
    this.gui?.controllersRecursive().forEach((c) => c.updateDisplay());
    return result;
  }

  private animate = (timestamp?: number) => {
    requestAnimationFrame(this.animate);
    const delta = Math.min(this.timer.update(timestamp).getDelta(), MAX_DELTA);

    try {
      if (this.vrm && this.body) {
        const frame = this.juggling.update(delta);
        this.body.update(frame, delta);
        this.blink.update(delta);
        this.facial.update();
        this.vrm.update(delta);
      }
      this.renderer.render(delta);
    } catch (e) {
      // 1 回のエラーでアニメーションが止まらないようにする
      if (!this.loggedError) console.error(e);
      this.loggedError = true;
    }
  };

  // ---- メッセージ表示 ----

  private createMessageArea(container: HTMLElement) {
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    const el = document.createElement('div');
    el.className = 'vrm-juggler-message';
    el.setAttribute('role', 'status');
    Object.assign(el.style, {
      position: 'absolute',
      left: '12px',
      bottom: '12px',
      maxWidth: 'calc(100% - 24px)',
      boxSizing: 'border-box',
      padding: '10px 14px',
      borderRadius: '8px',
      font: '14px/1.6 sans-serif',
      color: '#fff',
      background: 'rgba(40, 40, 40, 0.85)',
      display: 'none',
      zIndex: '10',
    });
    container.appendChild(el);
    this.message = el;
  }

  private showMessage(text: string, isError = false) {
    if (!this.message) return;
    this.messageKind = isError ? 'error' : 'loading';
    this.message.textContent = text;
    this.message.style.background = isError ? 'rgba(170, 40, 40, 0.9)' : 'rgba(40, 40, 40, 0.85)';
    this.message.style.display = 'block';
  }

  private clearMessage() {
    this.messageKind = 'none';
    if (this.message) this.message.style.display = 'none';
  }

  private showSiteswapError(result: SiteswapCheck) {
    if (!this.message) return;
    this.showMessage(`「${result.siteswap}」は投げられません: ${result.message}`, true);
    if (result.suggestions && result.suggestions.length > 0) {
      const line = document.createElement('div');
      line.style.marginTop = '6px';
      line.appendChild(document.createTextNode('近いパターン: '));
      result.suggestions.forEach((s) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = s;
        Object.assign(button.style, {
          margin: '0 4px',
          padding: '2px 10px',
          border: '1px solid #fff',
          borderRadius: '4px',
          background: 'transparent',
          color: '#fff',
          font: 'inherit',
          cursor: 'pointer',
        });
        button.addEventListener('click', () => this.setSiteswap(s));
        line.appendChild(button);
      });
      this.message.appendChild(line);
    }
    const note = document.createElement('div');
    note.style.opacity = '0.8';
    note.textContent = `いまは「${this.juggling.currentSiteswap}」を続けています。`;
    this.message.appendChild(note);
  }

  // ---- パラメータ調整 UI ----

  private setOptions() {
    const result = this.juggling.setPattern(this.juggling.currentSiteswap, this.options.siteswap);
    if (result.ok) this.syncTempo();
    else this.showSiteswapError(result);
  }

  /** 自動で決まったテンポを設定値(パネルの表示)に反映する */
  private syncTempo() {
    // パターンの高さが変わるので、頂点まで見えるようにカメラも合わせる
    this.renderer.frameHeight(this.juggling.peakY);
    const siteswapOptions = this.options.siteswap;
    siteswapOptions.beatDuration = this.juggling.beatDuration;
    siteswapOptions.beatDurationAltitude = this.juggling.beatDuration.toFixed(3);
  }

  /** 高さ(テンポ)を手で変えたら自動テンポをやめる */
  private setManualTempo(beatDuration: number) {
    this.options.siteswap.beatDuration = beatDuration;
    this.options.autoTempo = false;
    this.juggling.autoTempo = false;
    this.setOptions();
  }

  private createGUI() {
    const options = this.options;
    const siteswapOptions = options.siteswap as any;
    this.gui = new GUI({ title: '詳細設定(Esc で閉じる)' });

    const siteswap = this.gui.addFolder('ジャグリング');
    siteswap
      .add(options, 'siteswapNums')
      .name('サイトスワップ')
      .onFinishChange((value: string) => this.setSiteswap(value));

    siteswap
      .add(siteswapOptions, 'beatDuration', 0.05, 0.5)
      .name('高さ')
      .listen()
      .onFinishChange((value: number) => this.setManualTempo(Number(value)));

    siteswap
      .add(options, 'autoTempo')
      .name('高さを自動で決める')
      .listen()
      .onChange((value: boolean) => {
        this.juggling.autoTempo = value;
        this.setOptions();
      });

    siteswap
      .add(options, 'speed', 0.2, 1.5)
      .name('スピード')
      .onChange((value: number) => {
        this.juggling.speed = Number(value);
      });

    siteswap
      .add(siteswapOptions.props[0], 'type', { Ball: 'ball', Club: 'club', Ring: 'ring' })
      .name('小道具')
      .listen()
      .onFinishChange((value: string) => {
        siteswapOptions.props.forEach((prop: { type: string }) => (prop.type = value));
        this.setOptions();
      });

    siteswap
      .add(siteswapOptions, 'dwellPath', {
        Cascade: '(30,10)(10)',
        'Reverse Cascade': '(10)(30)',
        Shower: '(30)(10).(10)(30)',
        Windmill: '(-20)(20).(20)(-20)',
        'Mills Mess': '(2.5)(-30).(-2.5)(30).(0)(-30)',
      })
      .name('Dwell')
      .listen()
      .onFinishChange(() => this.setOptions());

    const advanced = this.gui.addFolder('ジャグリング(高度な設定)');
    advanced
      .add(siteswapOptions, 'beatDurationAltitude')
      .name('高さ')
      .listen()
      .onFinishChange((value: string) => {
        const beatDuration = Number(value);
        if (beatDuration > 0) this.setManualTempo(beatDuration);
      });

    advanced
      .addColor(siteswapOptions, 'propsColor')
      .name('小道具の色')
      .onChange((value: string) => {
        siteswapOptions.props.forEach((prop: { color: string }) => (prop.color = value));
        this.setOptions();
      });

    advanced
      .add(siteswapOptions, 'propsRadius')
      .name('小道具の大きさ')
      .onFinishChange((value: string) => {
        const radius = Number(value);
        if (!(radius > 0)) return;
        siteswapOptions.props.forEach((prop: { radius: number }) => (prop.radius = radius));
        this.setOptions();
      });

    advanced
      .add(siteswapOptions, 'dwellPath')
      .name('Dwell')
      .listen()
      .onFinishChange(() => this.setOptions());

    ['dwellRatio', 'dwellCatchScale', 'dwellTossScale', 'emptyCatchScale', 'emptyTossScale'].forEach((key) => {
      advanced.add(siteswapOptions, key).onFinishChange((value: string) => {
        siteswapOptions[key] = Number(value);
        this.setOptions();
      });
    });

    advanced
      .add(siteswapOptions, 'armAngle', 0.0, 0.5)
      .name('肘の開き')
      .onFinishChange((value: number) => {
        if (this.body) this.body.armAngle = Number(value);
        this.setOptions();
      });

    advanced
      .addColor(options, 'backgroundColor')
      .name('背景色')
      .onChange((value: string) => {
        this.renderer.scene.background = new THREE.Color(value);
      });

    const surfaces = advanced.addFolder('surfaces');
    const surface = siteswapOptions.surfaces[0];
    ['x', 'y', 'z'].forEach((axis) =>
      surfaces
        .add(surface.position, axis)
        .name(`position:${axis}`)
        .onFinishChange(() => this.setOptions())
    );
    ['x', 'y', 'z'].forEach((axis) =>
      surfaces
        .add(surface.normal, axis)
        .name(`normal:${axis}`)
        .onFinishChange(() => this.setOptions())
    );
    surfaces
      .add(surface, 'scale')
      .name('scale')
      .onFinishChange(() => this.setOptions());
    surfaces
      .addColor(surface, 'color')
      .name('color')
      .onChange(() => this.setOptions());

    const emotions = this.gui.addFolder('表情');
    // VRM 1.0 の表情名(VRM 0.x の joy / sorrow / fun は three-vrm が happy / sad / relaxed に読み替える)
    const emotionNames: [string, string][] = [
      ['happy', '喜'],
      ['angry', '怒'],
      ['sad', '哀'],
      ['relaxed', '楽'],
    ];
    emotionNames.forEach(([key, name]) => emotions.add(options.facial.emotion, key, 0.0, 1.0).name(name));

    const mouth = this.gui.addFolder('口の形');
    const mouthNames: [string, string][] = [
      ['aa', 'あ'],
      ['ih', 'い'],
      ['ou', 'う'],
      ['ee', 'え'],
      ['oh', 'お'],
    ];
    mouthNames.forEach(([key, name]) => mouth.add(options.facial.mouth, key, 0.0, 1.0).name(name));

    this.gui
      .add(options, 'blink')
      .name('まばたき')
      .onChange((value: boolean) => {
        this.blink.enable = value;
      });

    this.gui
      .add(options, 'neck')
      .name('首の動き')
      .onChange((value: boolean) => {
        if (this.body) this.body.enableNeck = value;
      });

    this.gui
      .add(options, 'bodyMotion', 0, 2)
      .name('体の動き')
      .onChange((value: number) => {
        if (this.body) this.body.motionAmount = Number(value);
      });

    // よく使う項目以外は閉じておく
    [advanced, surfaces, emotions, mouth].forEach((folder) => folder.close());
    if (!this.showGui) this.gui.hide();
  }

  private switchGUI = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' && e.keyCode !== 27) return;

    this.showGui = !this.showGui;

    if (this.showGui) {
      this.gui?.show();
    } else {
      this.gui?.hide();
    }
  };
}

declare global {
  interface Window {
    VRMJuggler: typeof VRMJuggler;
  }
}

window.VRMJuggler = window.VRMJuggler || VRMJuggler;
