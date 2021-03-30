import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { VRM, VRMSchema } from '@pixiv/three-vrm';
import * as dat from 'dat.gui';

import window from './interface/window';

import Renderer from './classes/Renderer';
//import VRMLoader from './classes/VRMLoader';
import Juggling from './motion/juggling';
import Blink from './motion/blink';
import Facial from './motion/facial';

import Options from './options/index';

export default class VRMJuggler {
  private selector!: string;
  private modelPath!: string;
  private renderer!: any;
  private animates!: any[];
  private juggling?: any;
  private blink?: any;
  private facial?: any;
  private options?: any;
  private showGui?: boolean = false;
  private gui?: any;

  constructor(selector: string = '', modelPath: string = '') {
    if (selector === '' || modelPath === '') return;
    this.selector = selector;
    this.modelPath = modelPath;

    this.animates = [];

    this.options = new Options();

    this.init();

    this.animate();
  }

  init() {
    this.renderer = new Renderer(this.selector);

    this.addAnimates(this.renderer.render);

    this.juggling = new Juggling(String(this.options.siteswapNums), this.options.siteswap);
    this.blink = new Blink();
    this.facial = new Facial(this.options.facial);
    this.loadModel();
    //this.renderer.scene.add(res.scene);

    this.createGUI();
 
    document.addEventListener('keyup', this.switchGUI.bind(this), false);
  }

  loadModel() {
    const loader = new GLTFLoader();
    loader.load(this.modelPath, async (gltf: any) => {
      VRM.from(gltf).then((vrm) => {
        this.renderer.scene.add(vrm.scene);

        this.juggling.init(vrm, this.renderer.scene, this.renderer.camera);
        this.addAnimates(this.juggling.update);

        this.blink.init(vrm);
        this.addAnimates(this.blink.update);

        this.facial.init(vrm);
        this.addAnimates(this.facial.update);
           this.gui.show();
      });
    });
  }

  addAnimates(fn: () => void) {
    this.animates.push(fn);
  }

  animate = () => {
    for (let i = 0; i < this.animates.length; i++) {
      this.animates[i]();
    }
    requestAnimationFrame(this.animate);
  };

  createGUI() {
    this.gui = new dat.GUI({});

    const siteswap = this.gui.addFolder('ジャグリング');
    siteswap
      .add(this.options, 'siteswapNums')
      .name('サイトスワップ数')
      .onFinishChange((value: string) => {
        this.setOptions();
      });

    siteswap
      .add(this.options.siteswap, 'beatDuration', 0.05, 0.5)
      .name('高さ')
      .listen()
      .onFinishChange((value: number) => {
        this.options.siteswap.beatDurationAltitude = String(value);
        this.setOptions();
      });

    siteswap
      .add(this.options.siteswap.props[0], 'type', { Ball: 'ball', Club: 'club', Ring: 'ring' })
      .name('小道具')
      .listen()
      .onFinishChange((value: string) => {
        this.options.siteswap.props.map((prop: { type: string; color: string; radius: number; C: number }) => {
          prop.type = value;
          return prop;
        });
        this.setOptions();
      });

    siteswap
      .add(this.options.siteswap, 'dwellPath', {
        Cascade: '(30)(10)',
        'Reverse Cascade': '(10)(30)',
        Shower: '(30)(10).(10)(30)',
        Windmill: '(-20)(20).(20)(-20)',
        'Mills Mess': '(2.5)(-30).(-2.5)(30).(0)(-30)',
      })
      .name('Dwell')
      .listen()
      .onFinishChange((value: string) => {
        this.setOptions();
      });

    const altitude = this.gui.addFolder('ジャグリング(高度な設定)');
    altitude
      .add(this.options.siteswap, 'beatDurationAltitude')
      .name('高さ')
      .listen()
      .onChange((value: string) => {
        this.options.siteswap.beatDuration = value;
        this.setOptions();
      });

    altitude
      .addColor(this.options.siteswap, 'propsColor')
      .name('小道具の色')
      .onChange((value: any) => {
        this.options.siteswap.props = this.options.siteswap.props.map((prop: { color: string }) => {
          prop.color = value;
          return prop;
        });
        this.setOptions();
      });

    altitude
      .add(this.options.siteswap, 'propsRadius')
      .name('小道具の大きさ')
      .onChange((value: any) => {
        this.options.siteswap.props = this.options.siteswap.props.map((prop: { radius: string }) => {
          prop.radius = value;
          return prop;
        });
        this.setOptions();
      });

    altitude
      .add(this.options.siteswap, 'dwellPath')
      .name('Dwell')
      .listen()
      .onChange((value: string) => {
        this.setOptions();
      });

    altitude.add(this.options.siteswap, 'dwellCatchScale').onChange((value: string) => {
      this.setOptions();
    });

    altitude.add(this.options.siteswap, 'dwellTossScale').onChange((value: string) => {
      this.setOptions();
    });

    altitude.add(this.options.siteswap, 'emptyCatchScale').onChange((value: string) => {
      this.setOptions();
    });

    altitude.add(this.options.siteswap, 'emptyTossScale').onChange((value: string) => {
      this.setOptions();
    });

    altitude.add(this.options.siteswap, 'armAngle', 0.0, 0.5).onChange((value: number) => {
      this.setOptions();
    });

    altitude.add(this.options.siteswap, 'dwellRatio').onChange((value: string) => {
      this.setOptions();
    });

    altitude
      .addColor(this.options, 'backgroundColor')
      .name('背景色')
      .onChange((value: string) => {
        this.renderer.scene.background = new THREE.Color(value);
      });
    const surfaces = altitude.addFolder('surfaces');
    surfaces
      .add(this.options.siteswap.surfaces[0].position, 'x')
      .name('position:x')
      .onChange((value: string) => {
        this.setOptions();
      });
    surfaces
      .add(this.options.siteswap.surfaces[0].position, 'y')
      .name('position:y')
      .onChange((value: string) => {
        this.setOptions();
      });
    surfaces
      .add(this.options.siteswap.surfaces[0].position, 'z')
      .name('position:z')
      .onChange((value: string) => {
        this.setOptions();
      });
    surfaces
      .add(this.options.siteswap.surfaces[0].normal, 'x')
      .name('normal:x')
      .onChange((value: string) => {
        this.setOptions();
      });
    surfaces
      .add(this.options.siteswap.surfaces[0].normal, 'y')
      .name('normal:y')
      .onChange((value: string) => {
        this.setOptions();
      });
    surfaces
      .add(this.options.siteswap.surfaces[0].normal, 'z')
      .name('normal:z')
      .onChange((value: string) => {
        this.setOptions();
      });
    surfaces
      .add(this.options.siteswap.surfaces[0], 'scale')
      .name('scale')
      .onChange((value: string) => {
        this.setOptions();
      });
    surfaces
      .addColor(this.options.siteswap.surfaces[0], 'color')
      .name('color')
      .onChange((value: string) => {
        this.setOptions();
      });

    const emotions = this.gui.addFolder('表情');
    emotions
      .add(this.options.facial.emotion, VRMSchema.BlendShapePresetName.Joy, 0.0, 1.0)
      .name('喜')
      .onChange((value: number) => {
        this.facial.emotion[VRMSchema.BlendShapePresetName.Joy] = value;
      });
    emotions
      .add(this.options.facial.emotion, VRMSchema.BlendShapePresetName.Angry, 0.0, 1.0)
      .name('怒')
      .onChange((value: number) => {
        this.facial.emotion[VRMSchema.BlendShapePresetName.Angry] = value;
      });
    emotions
      .add(this.options.facial.emotion, VRMSchema.BlendShapePresetName.Sorrow, 0.0, 1.0)
      .name('哀')
      .onChange((value: number) => {
        this.facial.emotion[VRMSchema.BlendShapePresetName.Sorrow] = value;
      });
    emotions
      .add(this.options.facial.emotion, VRMSchema.BlendShapePresetName.Fun, 0.0, 1.0)
      .name('楽')
      .onChange((value: number) => {
        this.facial.emotion[VRMSchema.BlendShapePresetName.Fun] = value;
      });

    const mouth = this.gui.addFolder('口の形');
    mouth
      .add(this.options.facial.mouth, VRMSchema.BlendShapePresetName.A, 0.0, 1.0)
      .name('あ')
      .onChange((value: number) => {
        this.facial.mouth[VRMSchema.BlendShapePresetName.A] = value;
      });
    mouth
      .add(this.options.facial.mouth, VRMSchema.BlendShapePresetName.I, 0.0, 1.0)
      .name('い')
      .onChange((value: number) => {
        this.facial.mouth[VRMSchema.BlendShapePresetName.I] = value;
      });
    mouth
      .add(this.options.facial.mouth, VRMSchema.BlendShapePresetName.U, 0.0, 1.0)
      .name('う')
      .onChange((value: number) => {
        this.facial.mouth[VRMSchema.BlendShapePresetName.U] = value;
      });
    mouth
      .add(this.options.facial.mouth, VRMSchema.BlendShapePresetName.E, 0.0, 1.0)
      .name('え')
      .onChange((value: number) => {
        this.facial.mouth[VRMSchema.BlendShapePresetName.E] = value;
      });
    mouth
      .add(this.options.facial.mouth, VRMSchema.BlendShapePresetName.O, 0.0, 1.0)
      .name('お')
      .onChange((value: number) => {
        this.facial.mouth[VRMSchema.BlendShapePresetName.O] = value;
      });

    this.gui
      .add(this.options, 'blink')
      .name('まばたき')
      .onChange((value: boolean) => {
        this.blink.enable = value;
      });

    this.gui
      .add(this.options, 'neck')
      .name('首振り')
      .onChange((value: boolean) => {
        this.juggling.enableNeck = value;
      });

    if (!this.showGui) this.gui.hide();
  }

  switchGUI(e: any) {
    if (e.keyCode !== 27) return;

    this.showGui = !this.showGui;

    if (this.showGui) {
      this.gui.show();
    } else {
      this.gui.hide();
    }
  }

  setOptions() {
    this.juggling.setOptions(String(this.options.siteswapNums), this.options.siteswap);
  }
}

window.VRMJuggler = window.VRMJuggler || VRMJuggler;
