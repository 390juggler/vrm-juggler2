import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** カメラの位置のプリセット。'free' はユーザーが視点を動かした後 */
export type CameraView = 'front' | 'diagonal' | 'side' | 'close' | 'free';

/** 背景: null(透明。ページの背景が見える)、色、上下 2 色のグラデーション */
export type Background = null | string | [string, string];

// 注視点からカメラへの向き(アバターは -Z を向いている)。close は front と同じ向きで上半身に寄る
const VIEW_DIRECTIONS: { [view: string]: THREE.Vector3 } = {
  front: new THREE.Vector3(0, 0, -1),
  diagonal: new THREE.Vector3(-0.7, 0.18, -0.7).normalize(),
  side: new THREE.Vector3(-1, 0.06, 0).normalize(),
  close: new THREE.Vector3(0, 0.08, -1).normalize(),
};

export default class Renderer {
  public container!: HTMLElement | null;
  private width!: number;
  private height!: number;
  private renderer!: THREE.WebGLRenderer;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private keyLight!: THREE.DirectionalLight;
  private framing?: { from: THREE.Vector3; to: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; t: number };
  private framedTop?: number;
  private backgroundTexture?: THREE.Texture;

  public scene!: THREE.Scene;
  public view: CameraView = 'front';
  /** ユーザーが視点を動かした時に呼ばれる */
  public onUserMove?: () => void;

  constructor(selector: string = '') {
    if (selector === '') return;

    this.container = document.querySelector<HTMLElement>(selector);

    this.init();
  }

  public init = () => {
    if (!this.container) return;
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(this.width, this.height);
    this.renderer.setClearColor(0x000000, 0.0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, this.width / this.height, 0.1, 1000);
    this.camera.position.set(0, 0.75, -3);
    this.camera.rotation.set(0, Math.PI, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target = new THREE.Vector3(0, 0.75, 0);
    // ユーザーが視点を動かしたら、自動の構図合わせはやめる
    this.controls.addEventListener('start', () => {
      this.framing = undefined;
      if (this.view === 'free') return;
      this.view = 'free';
      this.onUserMove?.();
    });

    this.scene = new THREE.Scene();

    // ライトの強さは物理単位(three.js r155 以降)。π 倍が以前の 1 に当たる
    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x606070, 0.5 * Math.PI);
    this.scene.add(hemisphereLight);

    // 正面やや上から当てる主光源。床に影を落とす
    this.keyLight = new THREE.DirectionalLight(0xffffff, 0.5 * Math.PI);
    this.keyLight.position.set(-1.2, 3.5, -2.5);
    this.keyLight.target.position.set(0, 0.8, 0);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.left = -1.5;
    this.keyLight.shadow.camera.right = 1.5;
    this.keyLight.shadow.camera.top = 2.5;
    this.keyLight.shadow.camera.bottom = -1.5;
    this.keyLight.shadow.camera.near = 0.5;
    this.keyLight.shadow.camera.far = 10;
    this.keyLight.shadow.bias = -0.0005;
    this.scene.add(this.keyLight, this.keyLight.target);

    // 影だけを映す床(背景はページの色がそのまま見える)
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(3, 48),
      new THREE.ShadowMaterial({ opacity: 0.18 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
  };

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** カメラをプリセットの位置へ動かす(パターンの高さに合わせて引く) */
  public setView = (view: CameraView) => {
    if (!VIEW_DIRECTIONS[view]) return;
    this.view = view;
    if (this.framedTop !== undefined) this.frameHeight(this.framedTop);
  };

  /** 背景を設定する。null で透明(録画では黒になる) */
  public setBackground = (background: Background) => {
    this.backgroundTexture?.dispose();
    this.backgroundTexture = undefined;
    if (!background) {
      this.scene.background = null;
      return;
    }
    if (typeof background === 'string') {
      this.scene.background = new THREE.Color(background);
      return;
    }
    // 縦のグラデーション(画面いっぱいに引き伸ばして描かれる)
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 256;
    const context = canvas.getContext('2d')!;
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, background[0]);
    gradient.addColorStop(1, background[1]);
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.backgroundTexture = texture;
    this.scene.background = texture;
  };

  /**
   * 足元からパターンの頂点までが入るようにカメラを引く/寄せる。
   * ユーザーが視点を動かした後は何もしない。
   */
  public frameHeight = (top: number) => {
    this.framedTop = top;
    if (this.view === 'free') return;
    // 寄りの時は腰から上。高いパターンでも頭の少し上までにする(ボールは画面の外へ出てよい)
    const close = this.view === 'close';
    const bottom = close ? 0.8 : -0.05;
    const height = (close ? THREE.MathUtils.clamp(top + 0.25, 1.75, 2.3) : Math.max(top + 0.25, 1.85)) - bottom;
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    // 縦長の画面では横幅(約 1.2m)も入るようにする
    const halfWidthFov = Math.atan(Math.tan(halfFov) * this.camera.aspect);
    const halfWidth = close ? 0.45 : 0.6;
    const distance = Math.max(height / 2 / Math.tan(halfFov), halfWidth / Math.tan(halfWidthFov)) * 1.05;
    const toTarget = new THREE.Vector3(0, bottom + height / 2, 0);
    this.framing = {
      from: this.camera.position.clone(),
      to: toTarget.clone().addScaledVector(VIEW_DIRECTIONS[this.view], distance),
      fromTarget: this.controls.target.clone(),
      toTarget,
      t: 0,
    };
  };

  public render = (delta = 1 / 60) => {
    this.resize();
    if (this.framing) {
      const f = this.framing;
      f.t = Math.min(1, f.t + delta / 0.8);
      const k = f.t * f.t * (3 - 2 * f.t);
      this.camera.position.lerpVectors(f.from, f.to, k);
      this.controls.target.lerpVectors(f.fromTarget, f.toTarget, k);
      if (f.t >= 1) this.framing = undefined;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  public resize = () => {
    if (!this.container) return;
    if (this.width === this.container.clientWidth && this.height === this.container.clientHeight) return;
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;

    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(this.width, this.height);

    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    if (this.framedTop !== undefined) this.frameHeight(this.framedTop);
  };
}
