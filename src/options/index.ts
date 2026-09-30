import options from '../interface/options';
import { VRMSchema } from '@pixiv/three-vrm';

export default class Options {
  public backgroundColor!: string;
  public siteswapNums!: string;
  public beatDuration!: options['beatDuration'];
  public propsType!: string;
  public dwellPath!: options['dwellPath'];
  public siteswap!: options;
  public blink!: boolean;
  public neck!: boolean;
  public bodyMotion!: boolean;
  public speed!: number;
  public autoTempo!: boolean;
  public facial!: any;

  constructor() {
    this.backgroundColor = '#ffffff';
    this.siteswapNums = '3';
    this.siteswap = {
      beatDuration: 0.28,
      beatDurationAltitude: '0.28',
      // ボールを持っている時間(拍)。Juggling Lab の既定値 1.3 に合わせた(実際のジャグラーの計測でも手の周期の 6 割強)
      dwellRatio: 1.3,
      props: [{ type: 'ball', color: 'random', radius: 0.05, C: 0.9 }],
      propsColor: '#ffffff',
      propsRadius: '0.05',
      // キャッチは外側・少し高い位置、投げは内側(実際のジャグラーはキャッチ位置の方が高い)
      dwellPath: '(30,10)(10)',
      matchVelocity: false,
      dwellCatchScale: 0.06,
      dwellTossScale: 0.06,
      emptyTossScale: 0.025,
      emptyCatchScale: 0.025,
      armAngle: 0.3,
      surfaces: [
        {
          position: {
            x: 0,
            y: 0,
            z: 0,
          },
          normal: {
            x: 0,
            y: 1,
            z: 0,
          },
          scale: 5,
          color: '#ffffff',
        },
      ],
      jugglers: [{ position: { x: 0, z: 0 }, rotation: 0, color: 'grey' }],
      startingHand: 'RIGHT',
    };
    this.blink = true;
    this.neck = true;
    this.bodyMotion = true;
    this.speed = 1.0;
    this.autoTempo = true;
    this.facial = {
      emotion: {
        [VRMSchema.BlendShapePresetName.Joy]: 0.0,
        [VRMSchema.BlendShapePresetName.Angry]: 0.0,
        [VRMSchema.BlendShapePresetName.Sorrow]: 0.0,
        [VRMSchema.BlendShapePresetName.Fun]: 0.0,
      },
      mouth: {
        [VRMSchema.BlendShapePresetName.A]: 0.0,
        [VRMSchema.BlendShapePresetName.I]: 0.0,
        [VRMSchema.BlendShapePresetName.U]: 0.0,
        [VRMSchema.BlendShapePresetName.E]: 0.0,
        [VRMSchema.BlendShapePresetName.O]: 0.0,
      },
    };
  }
}
