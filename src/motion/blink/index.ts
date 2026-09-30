import { VRMSchema } from '@pixiv/three-vrm';

export default class Blink {
  private vrm?: any;
  private time = 0;
  public enable: boolean = true;

  init(vrm: object) {
    this.vrm = vrm;
  }

  get blinkValue() {
    return Math.sin(this.time / 3) ** 1024 + Math.sin((this.time * 4) / 7) ** 1024;
  }

  // フレーム毎回に呼ばれる(vrm.update() は呼び出し側でまとめて 1 回だけ行う)
  update = (delta: number) => {
    if (!this.vrm) return;
    this.time += delta;
    this.vrm.blendShapeProxy.setValue(VRMSchema.BlendShapePresetName.Blink, this.enable ? this.blinkValue : 0);
  };
}
