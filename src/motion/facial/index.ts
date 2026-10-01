import { VRM } from '@pixiv/three-vrm';

// 表情・口の形の名前は VRM 1.0 のプリセット名(VRM 0.x のモデルも three-vrm がこの名前に読み替える)
export interface Emotion {
  happy: number;
  angry: number;
  sad: number;
  relaxed: number;
}

export interface Mouth {
  aa: number;
  ih: number;
  ou: number;
  ee: number;
  oh: number;
}

export default class Facial {
  private vrm?: VRM;
  public emotion!: Emotion;
  public mouth!: Mouth;

  constructor(options: { emotion: Emotion; mouth: Mouth }) {
    this.emotion = options.emotion;
    this.mouth = options.mouth;
  }

  init(vrm: VRM) {
    this.vrm = vrm;
  }

  // フレーム毎回に呼ばれる(反映は vrm.update() で行われる)
  update = () => {
    const manager = this.vrm?.expressionManager;
    if (!manager) return;
    (Object.keys(this.emotion) as (keyof Emotion)[]).forEach((name) => manager.setValue(name, this.emotion[name]));
    (Object.keys(this.mouth) as (keyof Mouth)[]).forEach((name) => manager.setValue(name, this.mouth[name]));
  };
}
