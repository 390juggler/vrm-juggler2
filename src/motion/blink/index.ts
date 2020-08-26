import * as THREE from 'three';

import { VRMSchema } from '@pixiv/three-vrm';

export default class Blink {
  private vrm!: any;
  private enable: boolean = true;
  private clock!: THREE.Clock;

  constructor() {
    this.clock = new THREE.Clock();
  }

  init(vrm: object) {
    this.vrm = vrm;
  }

  get blinkValue() {
    return Math.sin((this.clock.elapsedTime * 1) / 3) ** 1024 + Math.sin((this.clock.elapsedTime * 4) / 7) ** 1024;
  }

  // フレーム毎回に呼ばれる
  update = () => {
    if (!this.enable) return;
    const delta = this.clock.getDelta();

    this.vrm.blendShapeProxy.setValue(VRMSchema.BlendShapePresetName.Blink, this.blinkValue);
    this.vrm.update(delta);
  };
}
