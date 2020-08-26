export default interface options {
  beatDuration?: number;
  beatDurationAltitude?: string;
  dwellRatio?: number;
  props?: { type: string; color: string; radius: number; C: number }[];
  propsColor?: string;
  propsRadius?: string;
  dwellPath?: string;
  matchVelocity?: boolean;
  dwellCatchScale?: number;
  dwellTossScale?: number;
  emptyTossScale?: number;
  emptyCatchScale?: number;
  armAngle?: number;
  surfaces?: any[];
  jugglers?: { position: { x: number; z: number }; rotation: number; color: string }[];
  startingHand?: string;
}
