import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export default class Renderer {
  public container!: HTMLElement | null;
  private width!: number;
  private height!: number;
  private renderer!: THREE.WebGLRenderer;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private keyLight!: THREE.DirectionalLight;
  private framing?: { from: THREE.Vector3; to: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; t: number };
  private userMovedCamera = false;
  private framedTop?: number;

  public scene!: THREE.Scene;

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
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, this.width / this.height, 0.1, 1000);
    this.camera.position.set(0, 0.75, -3);
    this.camera.rotation.set(0, Math.PI, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target = new THREE.Vector3(0, 0.75, 0);
    // ユーザーが視点を動かしたら、自動の構図合わせはやめる
    this.controls.addEventListener('start', () => {
      this.userMovedCamera = true;
      this.framing = undefined;
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

  /**
   * 足元からパターンの頂点までが入るようにカメラを引く/寄せる。
   * ユーザーが視点を動かした後は何もしない。
   */
  public frameHeight = (top: number) => {
    this.framedTop = top;
    if (this.userMovedCamera) return;
    const bottom = -0.05;
    const height = Math.max(top + 0.25, 1.85) - bottom;
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    // 縦長の画面では横幅(約 1.2m)も入るようにする
    const halfWidthFov = Math.atan(Math.tan(halfFov) * this.camera.aspect);
    const distance = Math.max(height / 2 / Math.tan(halfFov), 0.6 / Math.tan(halfWidthFov)) * 1.05;
    const toTarget = new THREE.Vector3(0, bottom + height / 2, 0);
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    this.framing = {
      from: this.camera.position.clone(),
      to: toTarget.clone().addScaledVector(direction, distance),
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
