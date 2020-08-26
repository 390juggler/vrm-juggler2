import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export default class Renderer {
  private container!: Element | null;
  private width!: number;
  private height!: number;
  private renderer!: THREE.WebGLRenderer;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;

  public scene!: THREE.Scene;

  constructor(selector: string = '') {
    if (selector === '') return;

    this.container = document.querySelector(selector);

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
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, this.width / this.height, 0.1, 1000);
    this.camera.position.set(0, 0.75, -3);
    this.camera.rotation.set(0, Math.PI, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target = new THREE.Vector3(0, 0.75, 0);

    this.scene = new THREE.Scene();

    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x080820, 1);
    this.scene.add(hemisphereLight);

    const pointLight = new THREE.PointLight(0xffffff, 1, 100);
    pointLight.position.set(0, 0, -2);
    this.scene.add(pointLight);

    //const light = new THREE.DirectionalLight(0xffffff);
    //light.position.set(2, 2, -2).normalize();
    //this.scene.add(light);
  };

  public animate = () => {
    requestAnimationFrame(this.animate);
    this.render();
  };

  public render = () => {
    this.resize();
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
  };
}
