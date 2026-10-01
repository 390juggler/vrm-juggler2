import { VRM } from '@pixiv/three-vrm';

// まばたき: 人の自然なまばたきに合わせて、間隔をランダムにし、ときどき 2 回続ける
const INTERVAL_MIN = 2.0; // s
const INTERVAL_MAX = 6.0; // s
const DOUBLE_BLINK_CHANCE = 0.15;
const DOUBLE_BLINK_GAP = 0.25; // s
const CLOSE_TIME = 0.06; // s
const HOLD_TIME = 0.03; // s
const OPEN_TIME = 0.12; // s

export default class Blink {
  private vrm?: VRM;
  private time = 0;
  private nextBlink = 1.5;
  private blinkStart = -Infinity;
  public enable: boolean = true;

  init(vrm: VRM) {
    this.vrm = vrm;
  }

  get blinkValue() {
    const t = this.time - this.blinkStart;
    if (t < 0) return 0;
    if (t < CLOSE_TIME) return t / CLOSE_TIME;
    if (t < CLOSE_TIME + HOLD_TIME) return 1;
    if (t < CLOSE_TIME + HOLD_TIME + OPEN_TIME) return 1 - (t - CLOSE_TIME - HOLD_TIME) / OPEN_TIME;
    return 0;
  }

  // フレーム毎回に呼ばれる(vrm.update() は呼び出し側でまとめて 1 回だけ行う)
  update = (delta: number) => {
    if (!this.vrm) return;
    this.time += delta;
    if (this.time >= this.nextBlink) {
      this.blinkStart = this.time;
      this.nextBlink =
        Math.random() < DOUBLE_BLINK_CHANCE
          ? this.time + DOUBLE_BLINK_GAP
          : this.time + INTERVAL_MIN + Math.random() * (INTERVAL_MAX - INTERVAL_MIN);
    }
    this.vrm.expressionManager?.setValue('blink', this.enable ? this.blinkValue : 0);
  };
}
