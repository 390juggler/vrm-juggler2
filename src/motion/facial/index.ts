import { VRMSchema } from '@pixiv/three-vrm';

interface emotion {
  [VRMSchema.BlendShapePresetName.Joy]: number;
  [VRMSchema.BlendShapePresetName.Angry]: number;
  [VRMSchema.BlendShapePresetName.Sorrow]: number;
  [VRMSchema.BlendShapePresetName.Fun]: number;
}

interface mouth {
  [VRMSchema.BlendShapePresetName.A]: number;
  [VRMSchema.BlendShapePresetName.I]: number;
  [VRMSchema.BlendShapePresetName.U]: number;
  [VRMSchema.BlendShapePresetName.E]: number;
  [VRMSchema.BlendShapePresetName.O]: number;
}

export default class Facial {
  private vrm?: any;
  public emotion!: emotion;
  public mouth!: mouth;

  constructor(options: { emotion: emotion; mouth: mouth }) {
    this.emotion = options.emotion;
    this.mouth = options.mouth;
  }

  init(vrm: object) {
    this.vrm = vrm;
  }

  // フレーム毎回に呼ばれる(反映は vrm.update() で行われる)
  update = () => {
    if (!this.vrm) return;
    this.vrm.blendShapeProxy.setValue(
      VRMSchema.BlendShapePresetName.Joy,
      this.emotion[VRMSchema.BlendShapePresetName.Joy]
    );
    this.vrm.blendShapeProxy.setValue(
      VRMSchema.BlendShapePresetName.Angry,
      this.emotion[VRMSchema.BlendShapePresetName.Angry]
    );
    this.vrm.blendShapeProxy.setValue(
      VRMSchema.BlendShapePresetName.Sorrow,
      this.emotion[VRMSchema.BlendShapePresetName.Sorrow]
    );
    this.vrm.blendShapeProxy.setValue(
      VRMSchema.BlendShapePresetName.Fun,
      this.emotion[VRMSchema.BlendShapePresetName.Fun]
    );
    this.vrm.blendShapeProxy.setValue(VRMSchema.BlendShapePresetName.A, this.mouth[VRMSchema.BlendShapePresetName.A]);
    this.vrm.blendShapeProxy.setValue(VRMSchema.BlendShapePresetName.I, this.mouth[VRMSchema.BlendShapePresetName.I]);
    this.vrm.blendShapeProxy.setValue(VRMSchema.BlendShapePresetName.U, this.mouth[VRMSchema.BlendShapePresetName.U]);
    this.vrm.blendShapeProxy.setValue(VRMSchema.BlendShapePresetName.E, this.mouth[VRMSchema.BlendShapePresetName.E]);
    this.vrm.blendShapeProxy.setValue(VRMSchema.BlendShapePresetName.O, this.mouth[VRMSchema.BlendShapePresetName.O]);
  };
}
