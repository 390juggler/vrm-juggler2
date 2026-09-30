import * as THREE from 'three';
import { VRMSchema } from '@pixiv/three-vrm';

import { JugglingFrame } from '../juggling';
import { AvatarMetrics, LEFT, RIGHT, handBaseY } from '../juggling/tracks';

/**
 * ジャグリング中の全身の動き。
 *
 * - 腕: 解析的な 2 関節 IK。ボールが手のひらに乗るように手首の位置と向きを決め、
 *       肘は「下・後ろ・少し外」に向けて安定させる。前腕のひねりは前腕と手首に分配する。
 * - 指: ボールを持っている間は握り、投げた後は開く。
 * - 下半身: 拍に合わせて膝を軽く曲げ伸ばしする(キャッチで沈み、投げで伸びる)。
 * - 上半身: 前傾・呼吸・左右の手に合わせた胸のひねり、投げる側の肩を少し上げる。
 * - 頭: パターンの頂点付近を見る。目線はボールを少し追う。
 */

const Bone = VRMSchema.HumanoidBoneName;

// 前方(VRM 0.x は -Z を向いている)
const FORWARD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);

// 腕
const ELBOW_POLE_BACK = 0.35; // 肘を後ろへ向ける強さ
const ELBOW_POLE_OUT_BASE = 0.25; // 肘を外へ向ける強さ(armAngle が加わる)
const FOREARM_TWIST_SHARE = 0.6; // 手のひらを上に向けるひねりのうち前腕が受け持つ割合
const FINGER_INWARD = 0.35; // 指先を体の内側へ向ける量
const PALM_GAP = 0.012; // ボール表面と手のひらのすき間

// 指
const GRIP_HOLDING = 1.0;
const GRIP_EMPTY = 0.35;
const GRIP_SMOOTH = 25; // 1/s
const FINGER_CURL = [0.35, 0.75, 0.55]; // Proximal, Intermediate, Distal(rad, grip = 1 の時)
const FINGER_CURL_OPEN = [0.1, 0.2, 0.1];

// 下半身
const KNEE_BASE = 0.1; // rad
const KNEE_BOUNCE = 0.035; // rad
const KNEE_BOUNCE_BEATS = 2; // 何拍で 1 回沈むか(毎拍だと小刻みに見えるので、左右 1 往復で 1 回)
const KNEE_BOUNCE_PHASE = 0.1; // 周期の中で一番沈むタイミング(キャッチ直後)

// 上半身
const SPINE_LEAN = 0.05; // rad(前傾)
const BREATH_AMPLITUDE = 0.012;
const BREATH_PERIOD = 3.6; // s
const CHEST_TWIST = 0.015;
const SHOULDER_FORWARD = 0.08;
const SHOULDER_RAISE_GAIN = 0.4;
const SHOULDER_RAISE_MAX = 0.06;
const SHOULDER_SMOOTH = 5; // 1/s(手の上下にそのまま反応するとピクピクするので遅らせる)

// 頭・視線
const HEAD_PITCH_MIN = -0.2;
const HEAD_PITCH_MAX = 0.4;
const NECK_SHARE = 0.4;
const HEAD_FOLLOW_X = 0.2; // 頭が目線の横位置を追う割合
const HEAD_FOLLOW_Y = 0.15; // 頭の上下が目線の高さを追う割合(残りはパターンの頂点)
const GAZE_SMOOTH = 8; // 1/s(目)
const HEAD_SMOOTH = 2.5; // 1/s(頭は目よりゆっくり追う)

interface ArmRig {
  side: number; // 左 -1, 右 +1(x 座標の符号)
  shoulder: THREE.Object3D | null;
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  hand: THREE.Object3D;
  upperLength: number;
  lowerLength: number;
  restUpperDir: THREE.Vector3;
  restLowerDir: THREE.Vector3;
  restFingerDir: THREE.Vector3;
  restPalmNormal: THREE.Vector3;
  palmOffset: THREE.Vector3; // 手首 → 手のひらの中心(休止姿勢のワールド座標)
  restWorld: { upper: THREE.Quaternion; lower: THREE.Quaternion; hand: THREE.Quaternion };
  fingers: { node: THREE.Object3D; joint: number }[];
  thumbs: { node: THREE.Object3D; rest: THREE.Quaternion; euler: THREE.Euler }[];
  grip: number;
  lastForearmDir: THREE.Vector3;
}

function worldPosition(node: THREE.Object3D) {
  return node.getWorldPosition(new THREE.Vector3());
}

function worldQuaternion(node: THREE.Object3D) {
  return node.getWorldQuaternion(new THREE.Quaternion());
}

/** (a1, b1) の向きを (a2, b2) に移す回転。a を正確に合わせ、b は a に直交する成分だけ合わせる */
function frameRotation(a1: THREE.Vector3, b1: THREE.Vector3, a2: THREE.Vector3, b2: THREE.Vector3) {
  const basis = (a: THREE.Vector3, b: THREE.Vector3) => {
    const x = a.clone().normalize();
    const z = new THREE.Vector3().crossVectors(x, b).normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  };
  return basis(a2, b2).multiply(basis(a1, b1).conjugate());
}

/** q の axis 周りのひねり角(swing-twist 分解) */
function twistAngle(q: THREE.Quaternion, axis: THREE.Vector3) {
  const projection = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  let angle = 2 * Math.atan2(projection, q.w);
  if (angle > Math.PI) angle -= 2 * Math.PI;
  if (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

export default class Body {
  private vrm: any;
  private arms: ArmRig[];
  private rest = new Map<THREE.Object3D, THREE.Quaternion>();
  private hips: THREE.Object3D | null;
  private hipsRestY = 0;
  private legLength = 0;
  private baseHandY: number;
  private eyePoint?: THREE.Vector3;
  private headPoint?: THREE.Vector3;
  private shoulderRaise = [0, 0];
  private breathTime = 0;
  private lookTarget = new THREE.Object3D();
  private eyeY: number;

  public armAngle = 0.3;
  public enableBodyMotion = true;
  public enableNeck = true;

  constructor(vrm: any, scene: THREE.Scene) {
    this.vrm = vrm;
    this.vrm.scene.updateMatrixWorld(true);

    this.hips = this.node(Bone.Hips);
    if (this.hips) this.hipsRestY = this.hips.position.y;

    const upperLeg = this.node(Bone.LeftUpperLeg);
    const lowerLeg = this.node(Bone.LeftLowerLeg);
    const foot = this.node(Bone.LeftFoot);
    if (upperLeg && lowerLeg && foot) {
      this.legLength =
        worldPosition(upperLeg).distanceTo(worldPosition(lowerLeg)) +
        worldPosition(lowerLeg).distanceTo(worldPosition(foot));
    }

    const eye = this.node(Bone.LeftEye) || this.node(Bone.Head);
    this.eyeY = eye ? worldPosition(eye).y : 1.5;

    // 休止姿勢(T ポーズ)の回転を覚えておく
    Object.values(Bone).forEach((name) => {
      const node = this.node(name as VRMSchema.HumanoidBoneName);
      if (node) this.rest.set(node, node.quaternion.clone());
    });

    this.arms = [this.createArm(LEFT), this.createArm(RIGHT)];
    this.baseHandY = handBaseY(this.metrics);

    scene.add(this.lookTarget);
    if (this.vrm.lookAt) this.vrm.lookAt.target = this.lookTarget;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.lookTarget);
  }

  private node(name: VRMSchema.HumanoidBoneName): THREE.Object3D | null {
    return this.vrm.humanoid.getBoneNode(name);
  }

  get metrics(): AvatarMetrics {
    const arm = this.arms[RIGHT];
    return {
      shoulderY: worldPosition(arm.upper).y,
      upperArmLength: arm.upperLength,
      armLength: arm.upperLength + arm.lowerLength,
    };
  }

  private createArm(h: number): ArmRig {
    const isLeft = h === LEFT;
    const pick = (left: VRMSchema.HumanoidBoneName, right: VRMSchema.HumanoidBoneName) =>
      this.node(isLeft ? left : right);

    const upper = pick(Bone.LeftUpperArm, Bone.RightUpperArm)!;
    const lower = pick(Bone.LeftLowerArm, Bone.RightLowerArm)!;
    const hand = pick(Bone.LeftHand, Bone.RightHand)!;
    const middle = pick(Bone.LeftMiddleProximal, Bone.RightMiddleProximal);

    const upperPos = worldPosition(upper);
    const lowerPos = worldPosition(lower);
    const handPos = worldPosition(hand);
    const side = Math.sign(handPos.x - upperPos.x) || (isLeft ? -1 : 1);

    const restUpperDir = lowerPos.clone().sub(upperPos).normalize();
    const restLowerDir = handPos.clone().sub(lowerPos).normalize();
    const middlePos = middle ? worldPosition(middle) : handPos.clone().addScaledVector(restLowerDir, 0.08);
    const restFingerDir = middlePos.clone().sub(handPos).normalize();
    // VRM の T ポーズは手のひらが下向き
    const restPalmNormal = new THREE.Vector3(0, -1, 0);
    // 手のひらの中心は手首と中指の付け根の間、少し手のひら側
    const palmOffset = middlePos.clone().sub(handPos).multiplyScalar(0.6).addScaledVector(restPalmNormal, 0.02);

    const fingers: ArmRig['fingers'] = [];
    const fingerNames = ['Index', 'Middle', 'Ring', 'Little'];
    const jointNames = ['Proximal', 'Intermediate', 'Distal'];
    fingerNames.forEach((finger) =>
      jointNames.forEach((joint, j) => {
        const name = `${isLeft ? 'left' : 'right'}${finger}${joint}` as VRMSchema.HumanoidBoneName;
        const node = this.node(name);
        if (node) fingers.push({ node, joint: j });
      })
    );

    // 親指は元の実装の角度を使う(軽く曲げて手のひら側へ)
    const thumbs: ArmRig['thumbs'] = [];
    const thumbPose: [string, THREE.Euler][] = [
      ['Proximal', new THREE.Euler(0, (-side * Math.PI) / 12, (-side * Math.PI) / 12)],
      ['Distal', new THREE.Euler(0, (-side * Math.PI) / 3, 0)],
    ];
    thumbPose.forEach(([joint, euler]) => {
      const node = this.node(`${isLeft ? 'left' : 'right'}Thumb${joint}` as VRMSchema.HumanoidBoneName);
      if (node) thumbs.push({ node, rest: node.quaternion.clone(), euler });
    });

    return {
      side,
      shoulder: pick(Bone.LeftShoulder, Bone.RightShoulder),
      upper,
      lower,
      hand,
      upperLength: upperPos.distanceTo(lowerPos),
      lowerLength: lowerPos.distanceTo(handPos),
      restUpperDir,
      restLowerDir,
      restFingerDir,
      restPalmNormal,
      palmOffset,
      restWorld: { upper: worldQuaternion(upper), lower: worldQuaternion(lower), hand: worldQuaternion(hand) },
      fingers,
      thumbs,
      grip: GRIP_EMPTY,
      lastForearmDir: FORWARD.clone(),
    };
  }

  /** 休止姿勢の回転に、ローカルのオイラー角を掛けて設定する */
  private pose(name: VRMSchema.HumanoidBoneName, x: number, y: number, z: number) {
    const node = this.node(name);
    if (!node) return;
    const rest = this.rest.get(node);
    node.quaternion.setFromEuler(new THREE.Euler(x, y, z));
    if (rest) node.quaternion.premultiply(rest);
  }

  update(frame: JugglingFrame, delta: number) {
    this.breathTime += delta;

    this.updateLowerBody(frame);
    this.updateUpperBody(frame, delta);
    this.vrm.scene.updateMatrixWorld(true);

    this.arms.forEach((arm, h) => {
      this.solveArm(arm, frame.hands[h], frame.propRadius);
      this.updateFingers(arm, frame.hands[h].holding, delta);
    });
  }

  private updateLowerBody(frame: JugglingFrame) {
    const phase = frame.beat / KNEE_BOUNCE_BEATS;
    const bounce = this.enableBodyMotion ? 0.5 * (1 + Math.cos(2 * Math.PI * (phase - KNEE_BOUNCE_PHASE))) : 0;
    const knee = KNEE_BASE + KNEE_BOUNCE * bounce;

    // 太もも前・すね後ろ・足首前に同じ角度だけ曲げると、足の位置がほぼ変わらずに腰が沈む
    [Bone.LeftUpperLeg, Bone.RightUpperLeg].forEach((b) => this.pose(b, knee, 0, 0));
    [Bone.LeftLowerLeg, Bone.RightLowerLeg].forEach((b) => this.pose(b, -2 * knee, 0, 0));
    [Bone.LeftFoot, Bone.RightFoot].forEach((b) => this.pose(b, knee, 0, 0));
    if (this.hips) {
      this.hips.position.y = this.hipsRestY - this.legLength * (1 - Math.cos(knee));
    }
  }

  private updateUpperBody(frame: JugglingFrame, delta: number) {
    const motion = this.enableBodyMotion ? 1 : 0;
    const breath = BREATH_AMPLITUDE * Math.sin((2 * Math.PI * this.breathTime) / BREATH_PERIOD) * motion;
    // 1 拍ごとに左右の手が交互に投げるので、胸のひねりは 2 拍で 1 往復
    const sway = Math.sin(Math.PI * frame.beat) * motion;
    const smooth = (rate: number) => 1 - Math.exp(-rate * delta);

    this.pose(Bone.Spine, -SPINE_LEAN, 0, 0);
    this.pose(Bone.Chest, breath, CHEST_TWIST * sway * 0.5, 0);
    this.pose(Bone.UpperChest, breath * 0.5, CHEST_TWIST * sway * 0.5, CHEST_TWIST * sway * 0.3);

    // 肩: 少し前へ、手が上がった時に少し上がる
    this.arms.forEach((arm, h) => {
      const hand = frame.hands[h];
      const target =
        THREE.MathUtils.clamp((hand.position.y - this.baseHandY) * SHOULDER_RAISE_GAIN, 0, SHOULDER_RAISE_MAX) *
        motion;
      this.shoulderRaise[h] += (target - this.shoulderRaise[h]) * smooth(SHOULDER_SMOOTH);
      const raise = this.shoulderRaise[h];
      this.pose(
        h === LEFT ? Bone.LeftShoulder : Bone.RightShoulder,
        0,
        arm.side * SHOULDER_FORWARD,
        arm.side * raise
      );
    });

    // 視線: 目は次にキャッチするボールを追い、頭はパターンの頂点を中心に目線へ少し寄せる
    if (!this.eyePoint) this.eyePoint = frame.eyeTarget.clone();
    this.eyePoint.lerp(frame.eyeTarget, smooth(GAZE_SMOOTH));
    this.lookTarget.position.copy(this.eyePoint);
    if (!this.headPoint) this.headPoint = this.eyePoint.clone();
    this.headPoint.lerp(this.eyePoint, smooth(HEAD_SMOOTH));

    const target = frame.gazeTarget;

    if (!this.enableNeck) {
      this.pose(Bone.Neck, 0, 0, 0);
      this.pose(Bone.Head, 0, 0, 0);
      return;
    }
    const distance = Math.max(0.1, Math.abs(target.z));
    const headY = THREE.MathUtils.lerp(target.y, this.headPoint.y, HEAD_FOLLOW_Y);
    const pitch =
      THREE.MathUtils.clamp(Math.atan2(headY - this.eyeY, distance), HEAD_PITCH_MIN, HEAD_PITCH_MAX) + SPINE_LEAN;
    const yaw = -Math.atan2(this.headPoint.x * HEAD_FOLLOW_X, distance);
    this.pose(Bone.Neck, pitch * NECK_SHARE, yaw * NECK_SHARE, 0);
    this.pose(Bone.Head, pitch * (1 - NECK_SHARE), yaw * (1 - NECK_SHARE), 0);
  }

  private solveArm(arm: ArmRig, hand: JugglingFrame['hands'][number], propRadius: number) {
    const palmNormal = hand.palmNormal;

    // 指先の向き: 前方・少し内側と、前腕の向きの中間(手首の曲がりすぎを防ぐ)
    const fingerDir = FORWARD.clone()
      .addScaledVector(new THREE.Vector3(1, 0, 0), -arm.side * FINGER_INWARD)
      .normalize()
      .add(arm.lastForearmDir)
      .normalize();

    // 手の向き(休止姿勢からの回転)。手のひらの向きを優先して合わせる
    const handDelta = frameRotation(arm.restPalmNormal, arm.restFingerDir, palmNormal, fingerDir);

    // 手のひらの中心がボールの真下に来るような手首の位置
    const palmTarget = hand.position.clone().addScaledVector(palmNormal, -(propRadius + PALM_GAP));
    const wristTarget = palmTarget.sub(arm.palmOffset.clone().applyQuaternion(handDelta));

    // 2 関節 IK
    const shoulder = worldPosition(arm.upper);
    const toWrist = wristTarget.clone().sub(shoulder);
    const L1 = arm.upperLength;
    const L2 = arm.lowerLength;
    const d = THREE.MathUtils.clamp(toWrist.length(), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
    const dir = toWrist.normalize();
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    const hgt = Math.sqrt(Math.max(L1 * L1 - a * a, 0));

    const pole = new THREE.Vector3(arm.side * (ELBOW_POLE_OUT_BASE + this.armAngle), -1, ELBOW_POLE_BACK).normalize();
    const polePerp = pole.clone().addScaledVector(dir, -pole.dot(dir));
    if (polePerp.lengthSq() < 1e-8) polePerp.set(0, -1, 0);
    polePerp.normalize();

    const elbow = shoulder.clone().addScaledVector(dir, a).addScaledVector(polePerp, hgt);
    const wrist = shoulder.clone().addScaledVector(dir, d);

    const upperDir = elbow.clone().sub(shoulder).normalize();
    const lowerDir = wrist.clone().sub(elbow).normalize();
    const hinge = new THREE.Vector3().crossVectors(upperDir, lowerDir);
    if (hinge.lengthSq() < 1e-8) hinge.crossVectors(upperDir, polePerp);
    hinge.normalize();
    arm.lastForearmDir.copy(lowerDir);

    const restUpperHinge = new THREE.Vector3().crossVectors(arm.restUpperDir, FORWARD).normalize();
    const restLowerHinge = new THREE.Vector3().crossVectors(arm.restLowerDir, FORWARD).normalize();

    // 上腕
    const upperWorld = frameRotation(arm.restUpperDir, restUpperHinge, upperDir, hinge).multiply(arm.restWorld.upper);
    const parentWorld = worldQuaternion(arm.upper.parent!);
    arm.upper.quaternion.copy(parentWorld.clone().conjugate().multiply(upperWorld));

    // 前腕: 肘の曲げ + 手のひらを返すひねりの一部
    const lowerDelta = frameRotation(arm.restLowerDir, restLowerHinge, lowerDir, hinge);
    const relative = lowerDelta.clone().conjugate().multiply(handDelta);
    const twist = twistAngle(relative, arm.restLowerDir) * FOREARM_TWIST_SHARE;
    lowerDelta.multiply(new THREE.Quaternion().setFromAxisAngle(arm.restLowerDir, twist));
    const lowerWorld = lowerDelta.multiply(arm.restWorld.lower);
    arm.lower.quaternion.copy(upperWorld.clone().conjugate().multiply(lowerWorld));

    // 手
    const handWorld = handDelta.multiply(arm.restWorld.hand);
    arm.hand.quaternion.copy(lowerWorld.clone().conjugate().multiply(handWorld));
  }

  private updateFingers(arm: ArmRig, holding: boolean, delta: number) {
    const target = holding ? GRIP_HOLDING : GRIP_EMPTY;
    arm.grip += (target - arm.grip) * (1 - Math.exp(-GRIP_SMOOTH * delta));

    // T ポーズ(手のひら下向き)で z 軸周りに回すと指が手のひら側に曲がる
    arm.fingers.forEach(({ node, joint }) => {
      const angle = FINGER_CURL_OPEN[joint] + (FINGER_CURL[joint] - FINGER_CURL_OPEN[joint]) * arm.grip;
      const rest = this.rest.get(node);
      node.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -arm.side * angle);
      if (rest) node.quaternion.premultiply(rest);
    });
    arm.thumbs.forEach(({ node, rest, euler }) => {
      node.quaternion.setFromEuler(euler).premultiply(rest);
    });
  }
}
