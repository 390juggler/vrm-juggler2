import * as THREE from 'three';

import { VRMSchema } from '@pixiv/three-vrm';
import { IK, IKChain, IKJoint, IKHelper } from 'three-ik';

import options from '../../interface/options';
import { CreateSiteswap } from './Siteswap';

interface siteswap {
  siteswap: string;
  validSyntax: boolean;
  validPattern: boolean;
  collision: any;
  multiplex: any;
  sync: any;
  pass: any;
  startingHand: number;
  numJugglers: any;
  numProps: any;
  maxHeight: any;
  tosses: any;
  beats: any;
  states: any;
  propOrbits: any;
  propPositions: any;
  propRotations: any;
  jugglerHandPositions: any;
  jugglerElbowPositions: any;
  jugglers: any;
  validationOnly: any;
  numStepsPerBeat: any;
  numSteps: any;
  beatDuration: any;
  dwellDuration: any;
  props: any;
  dwellPath: any;
  tossMatchVelocity: any;
  catchMatchVelocity: any;
  dwellCatchScale: any;
  dwellTossScale: any;
  emptyTossScale: any;
  emptyCatchScale: any;
  armAngle: any;
  surfaces: any;
  errorMessage: any;
  stateDiagram: any;
  maxVertex: any;
}

export default class Juggling {
  private vrm!: any;
  private scene!: THREE.Scene;
  private siteswapNums?: string;
  private options: options;
  private motionBlur: boolean;

  private randomColors: string[] = ['red', 'blue', 'green', 'black', 'yellow', 'purple'];
  private siteswap!: siteswap;
  private surfaceMeshes: any[] = [];
  private propMeshes: any[] = [];
  private step!: number;
  private startTime!: number;
  private lookAt!: THREE.Object3D;
  private clock!: THREE.Clock;

  public ik!: any;

  private enableNeck: boolean = true;
  private left: boolean = true;

  constructor(siteswapNums: string, options: options, motionBlur: boolean = false) {
    this.siteswapNums = siteswapNums;
    this.options = options;
    this.motionBlur = motionBlur ?? false;

    this.step = 0;
    this.startTime = 0;

    this.setSiteswap();

    this.lookAt = new THREE.Object3D();
    this.clock = new THREE.Clock();

    // IKの準備
    this.ik = {
      left_arm: {
        ik: <any>new IK(),
        chain: <any>new IKChain(),
        pivot: null,
        boneNames: [
          VRMSchema.HumanoidBoneName.LeftUpperArm,
          VRMSchema.HumanoidBoneName.LeftLowerArm,
          VRMSchema.HumanoidBoneName.LeftHand,
          //VRMSchema.HumanoidBoneName.LeftMiddleProximal,
        ],
        bones: [],
        nodes: [],
      },
      right_arm: {
        ik: <any>new IK(),
        chain: <any>new IKChain(),
        pivot: null,
        boneNames: [
          VRMSchema.HumanoidBoneName.RightUpperArm,
          VRMSchema.HumanoidBoneName.RightLowerArm,
          VRMSchema.HumanoidBoneName.RightHand,
          //VRMSchema.HumanoidBoneName.RightMiddleProximal,
        ],
        bones: [],
        nodes: [],
      },
    };
  }

  setSiteswap() {
    this.siteswap = CreateSiteswap(this.siteswapNums, this.options);
  }

  setOptions(siteswapNums: string, options: options) {
    this.siteswapNums = siteswapNums;
    this.options = options;
    this.setSiteswap();
    this.drawProps();
    this.drawSurfaces();
  }

  init(vrm: object, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.vrm = vrm;
    camera.add(this.lookAt);
    this.scene = scene;
    this.vrm.lookAt.target = this.lookAt;
    //右人差し指第三指骨
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.RightIndexDistal).rotation.z = -Math.PI / 18;
    //右人差し指第二指骨
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.RightIndexIntermediate).rotation.z = -Math.PI / 3.6;
    //右人差し指第一指骨
    //this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.RightIndexProximal).rotation.z = -Math.PI / 6;
    //右小指第三指骨
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.RightLittleDistal).rotation.z = -Math.PI / 18;
    //右小指第二指骨
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.RightLittleIntermediate).rotation.z = -Math.PI / 3.6;
    //右小指第一指骨
    //this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.RightLittleProximal).rotation.z = -Math.PI / 6;
    //右中指第三指骨
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.RightMiddleDistal).rotation.z = -Math.PI / 18;
    //右中指第二指骨
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.RightMiddleIntermediate).rotation.z = -Math.PI / 3.6;
    //右中指第一指骨
    //this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.RightMiddleProximal).rotation.z = -Math.PI / 6;
    //右薬指第三指骨
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.RightRingDistal).rotation.z = -Math.PI / 18;
    //右薬指第二指骨
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.RightRingIntermediate).rotation.z = -Math.PI / 3.6;
    //右薬指第一指骨
    //this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.RightRingProximal).rotation.z = -Math.PI / 6;
    //右親指第三指骨
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.RightThumbDistal).rotation.y = -Math.PI / 3;
    //this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.RightThumbDistal).rotation.y = -Math.PI / 3;
    //右親指第二指骨
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.RightThumbDistal).rotation.y = -Math.PI / 3;
    //this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.RightThumbIntermediate).rotation.z = -Math.PI / 3.6;
    //右親指第一指骨
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.LeftThumbProximal).rotation.y = Math.PI / 12;
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.LeftThumbProximal).rotation.z = Math.PI / 12;

    //左人差し指第三指骨
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.LeftIndexDistal).rotation.z = Math.PI / 18;
    //左人差し指第二指骨
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.LeftIndexIntermediate).rotation.z = Math.PI / 3.6;
    //左人差し指第一指骨
    //this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.LeftIndexProximal).rotation.z = Math.PI / 6;
    //左小指第三指骨
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.LeftLittleDistal).rotation.z = Math.PI / 18;
    //左小指第二指骨
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.LeftLittleIntermediate).rotation.z = Math.PI / 3.6;
    //左小指第一指骨
    //this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.LeftLittleProximal).rotation.z = Math.PI / 6;
    //左中指第三指骨
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.LeftMiddleDistal).rotation.z = Math.PI / 18;
    //左中指第二指骨
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.LeftMiddleIntermediate).rotation.z = Math.PI / 3.6;
    //左中指第一指骨
    //this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.LeftMiddleProximal).rotation.z = Math.PI / 6;
    //左薬指第三指骨
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.LeftRingDistal).rotation.z = Math.PI / 18;
    //左薬指第二指骨
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.LeftRingIntermediate).rotation.z = Math.PI / 3.6;
    //左薬指第一指骨
    //this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.LeftRingProximal).rotation.z = Math.PI / 6;
    //左親指第三指骨
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.LeftThumbDistal).rotation.y = Math.PI / 3;
    //this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.LeftThumbDistal).rotation.y = Math.PI / 3;
    //左親指第二指骨
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.LeftThumbDistal).rotation.y = Math.PI / 3;
    //this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.LeftThumbIntermediate).rotation.z = Math.PI / 3.6;
    //左親指第一指骨
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.LeftThumbProximal).rotation.y = Math.PI / 12;
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.LeftThumbProximal).rotation.z = Math.PI / 12;

    this.drawProps();

    this.drawSurfaces();

    for (let section in this.ik) {
      this.ik[section].ik.isIK = true;

      // ターゲットの生成
      const movingTarget = new THREE.Mesh(
        new THREE.SphereGeometry(0.05),
        new THREE.MeshBasicMaterial({ color: 0xff0000, visible: false })
      );
      //movingTarget.position.z = -0.3;

      const pivot = new THREE.Object3D();
      pivot.add(movingTarget);
      //pivot.position.x = section == 'left_arm' ? -0.25 : 0.25;
      //pivot.position.y = 1.3;
      //pivot.position.z = -0.3;
      this.scene.add(pivot);
      this.ik[section].pivot = pivot;

      // チェーンの生成
      this.ik[section].boneNames.forEach((boneName: string, index: number) => {
        // ボーンとノードの生成
        const bone = new THREE.Bone();
        const node = this.vrm.humanoid!.getBoneNode(boneName);
        if (node === null) return;

        if (index == 0) {
          node.getWorldPosition(bone.position);
        } else {
          bone.position.set(node.position.x, node.position.y, node.position.z);
          this.ik[section].bones[index - 1].add(bone);
        }
        this.ik[section].bones.push(bone);
        this.ik[section].nodes.push(node);

        // チェーンに追加
        const target = index === this.ik[section].boneNames.length - 1 ? movingTarget : null;
        this.ik[section].chain.add(<any>new IKJoint(bone, {}), { target });
      });

      // IKシステムにチェーン追加
      this.ik[section].ik.add(this.ik[section].chain);

      // ルートボーンの追加
      this.scene.add(this.ik[section].ik.getRootBone());

      // ヘルパーの追加
      //const helper = <any>new IKHelper(ikList[j]);
      //scene.add(helper);
    }
  }

  drawSurfaces = () => {
    if (this.surfaceMeshes.length !== 0) {
      this.surfaceMeshes.forEach((mesh, index) => {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      });
      this.surfaceMeshes.splice(0);
    }

    this.siteswap.surfaces.map((a: any) => {
      var surface = {
        position: new THREE.Vector3(a.position.x, a.position.y, a.position.z),
        normal: new THREE.Vector3(a.normal.x, a.normal.y, a.normal.z),
        axis1: new THREE.Vector3(a.axis1.x, a.axis1.y, a.axis1.z),
        axis2: new THREE.Vector3(a.axis2.x, a.axis2.y, a.axis2.z),
        scale: a.scale,
      };
      var surfaceGeom = new THREE.Geometry();
      surfaceGeom.vertices.push(
        new THREE.Vector3().copy(surface.position).add(new THREE.Vector3().add(surface.axis1).add(surface.axis2))
      );
      surfaceGeom.vertices.push(
        new THREE.Vector3()
          .copy(surface.position)
          .add(new THREE.Vector3().add(surface.axis1).negate().add(surface.axis2))
      );
      surfaceGeom.vertices.push(
        new THREE.Vector3()
          .copy(surface.position)
          .add(new THREE.Vector3().add(surface.axis1).add(surface.axis2).negate())
      );
      surfaceGeom.vertices.push(
        new THREE.Vector3()
          .copy(surface.position)
          .add(new THREE.Vector3().add(surface.axis2).negate().add(surface.axis1))
      );

      surfaceGeom.faces.push(new THREE.Face3(0, 1, 2));
      surfaceGeom.faces.push(new THREE.Face3(2, 0, 3));

      var surfaceMesh = new THREE.Mesh(
        surfaceGeom,
        new THREE.MeshBasicMaterial({ color: a.color ? a.color : 'grey', side: THREE.DoubleSide })
      );
      this.surfaceMeshes.push(surfaceMesh);
      this.scene.add(surfaceMesh);
    });
  };

  drawProps = () => {
    if (this.propMeshes.length !== 0) {
      this.propMeshes.forEach((mesh, index) => {
        this.scene.remove(mesh[0]);
        mesh[0].geometry.dispose();
        mesh[0].material.dispose();
      });
      this.propMeshes.splice(0);
    }
    /* create each prop and add to empty this.propMeshes array */
    for (let i = 0; i < this.siteswap.numProps; i++) {
      let geometry;

      if (this.siteswap.props[i].type == 'ball') {
        geometry = new THREE.SphereGeometry(this.siteswap.props[i].radius, 20);
      } else if (this.siteswap.props[i].type == 'club') {
        geometry = new THREE.CylinderGeometry(0.008, 0.02, 0.02, 7, 5);
        geometry.vertices.map(function (v) {
          v.y += 0.01;
        });
        const clubHandle = new THREE.CylinderGeometry(0.015, 0.008, 0.18, 7, 5);
        clubHandle.vertices.map(function (v) {
          v.y += 0.11;
        });
        const clubBody1 = new THREE.CylinderGeometry(0.04, 0.015, 0.18, 7, 5);
        clubBody1.vertices.map(function (v) {
          v.y += 0.29;
        });
        const clubBody2 = new THREE.CylinderGeometry(0.02, 0.04, 0.11, 7, 5);
        clubBody2.vertices.map(function (v) {
          v.y += 0.43;
        });
        THREE.GeometryUtils.merge(geometry, clubHandle);
        THREE.GeometryUtils.merge(geometry, clubBody1);
        THREE.GeometryUtils.merge(geometry, clubBody2);
        // move entire club down to correct center of gravity
        geometry.vertices.map(function (v) {
          v.y -= 0.2;
        });
      } else if (this.siteswap.props[i].type == 'ring') {
        // ring meshes
        var points = [];
        points.push(new THREE.Vector2(0.14, 0.01));
        points.push(new THREE.Vector2(0.18, 0.01));
        points.push(new THREE.Vector2(0.18, -0.01));
        points.push(new THREE.Vector2(0.14, -0.01));
        points.push(new THREE.Vector2(0.14, 0.01));
        geometry = new THREE.LatheGeometry(points);
      }

      const numTails = this.motionBlur ? 2 : 0;

      const tmpPropMeshes = [];

      const propColor =
        this.siteswap.props[i].color == 'random'
          ? this.randomColors[i % this.randomColors.length]
          : this.siteswap.props[i].color;

      for (let j = 0; j <= numTails; j++) {
        let material;

        if (j == 0) {
          material = new THREE.MeshLambertMaterial({
            color: propColor,
          });
          //material = new THREE.MeshBasicMaterial( { color: propColor, wireframe: true } );
        } else {
          material = new THREE.MeshLambertMaterial({
            color: propColor,
            transparent: true,
            opacity: 1 - (1 / (numTails + 1)) * j,
          });
        }
        const mesh = new THREE.Mesh(geometry, material);

        this.scene.add(mesh);

        tmpPropMeshes.push(mesh);
      }

      this.propMeshes.push(tmpPropMeshes);
    }
  };

  // フレーム毎回に呼ばれる
  update = () => {
    this.updateProps();

    // 目線
    this.lookAt.position.x = 0;
    if (this.enableNeck) {
      //const lookAt = this.propMeshes.reduce((prev, current) => Math.max(prev, current[0].position.y), 0);
      //this.lookAt.position.y = this.siteswap.maxVertex - lookAt < 0.1 ? lookAt : this.siteswap.maxVertex - 0.1;
      if (this.left) {
        this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.Head).rotation.z += Math.random() * 0.01;
        this.left = this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.Head).rotation.z <= 0.1;
      } else {
        this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.Head).rotation.z -= Math.random() * 0.01;
        this.left = this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.Head).rotation.z <= -0.1;
      }
    } else {
      //this.lookAt.position.y = this.siteswap.maxVertex;
    }
    this.lookAt.position.y = this.siteswap.maxVertex;
    this.lookAt.position.z = this.propMeshes[0][0].position.z;

    // 首、頭の角度
    const rad = Math.atan2(this.lookAt.position.y - 1.6, this.lookAt.position.z * -1);
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.Neck).rotation.x = rad / 2;
    this.vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.Head).rotation.x = rad / 2;

    this.vrm.update(this.clock.getDelta());

    // ターゲットの移動
    this.updateTargets();

    // IKの更新
    this.ik.left_arm.ik.solve();
    this.ik.right_arm.ik.solve();

    // 腕の更新
    this.updateArm(this.ik.left_arm.bones, this.ik.left_arm.nodes, Math.PI / 2);
    this.updateArm(this.ik.right_arm.bones, this.ik.right_arm.nodes, -Math.PI / 2);
  };

  updateProps = () => {
    if (this.startTime === 0) {
      this.startTime = new Date().getTime();
    }
    const timeElapsed = (new Date().getTime() - this.startTime) * 0.6;
    const t = timeElapsed % (this.siteswap.states.length * this.siteswap.beatDuration * 1000); // need to *1000 b/c timeElapsed is in ms
    this.step = Math.floor(
      (t / (this.siteswap.states.length * this.siteswap.beatDuration * 1000)) * this.siteswap.numSteps
    );

    /* update prop mesh positions and rotations */
    for (let i = 0; i < this.propMeshes.length; i++) {
      if (!this.siteswap.propPositions || this.siteswap.propPositions[i] === undefined) return;
      for (let j = 0; j < this.propMeshes[i].length; j++) {
        let stepIx = this.step - j * Math.floor(this.siteswap.numStepsPerBeat / 8); // the 10 here is the tail length factor

        if (stepIx < 0) stepIx += this.siteswap.numSteps;
        const correction = {
          x: 0,
          y: -1 * (-0.04 + this.siteswap.armAngle * 0.12),
          z: -1 * (0.075 - this.siteswap.armAngle * 0.05),
        };
        this.propMeshes[i][j].position.x = this.siteswap.propPositions[i][stepIx].x + correction.x;
        this.propMeshes[i][j].position.y = this.siteswap.propPositions[i][stepIx].y + correction.y;
        this.propMeshes[i][j].position.z = this.siteswap.propPositions[i][stepIx].z + correction.z;
        /* apply current rotation */
        this.propMeshes[i][j].quaternion.set(1, 0, 0, 0);

        // rotate rings so they are in correct position by default
        if (this.siteswap.props[i].type == 'ring') {
          const rotateRing = new THREE.Quaternion();
          rotateRing.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
          this.propMeshes[i][j].quaternion.multiply(rotateRing);
        }

        const q = this.siteswap.propRotations[i][stepIx];
        this.propMeshes[i][j].quaternion.multiplyQuaternions(q, this.propMeshes[i][j].quaternion);
      }
    }
  };

  updateTargets = () => {
    if (this.siteswap.jugglerHandPositions === undefined) return;
    this.ik.left_arm.pivot.position.x = this.siteswap.jugglerHandPositions[0][0][this.step].x;
    this.ik.left_arm.pivot.position.y = this.siteswap.jugglerHandPositions[0][0][this.step].y;
    this.ik.left_arm.pivot.position.z = this.siteswap.jugglerHandPositions[0][0][this.step].z;
    this.ik.right_arm.pivot.position.x = this.siteswap.jugglerHandPositions[0][1][this.step].x;
    this.ik.right_arm.pivot.position.y = this.siteswap.jugglerHandPositions[0][1][this.step].y;
    this.ik.right_arm.pivot.position.z = this.siteswap.jugglerHandPositions[0][1][this.step].z;
  };

  // 腕の更新
  updateArm = (bones: any, nodes: any, offset: number) => {
    const q = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
    const armAngle = [new THREE.Quaternion(), new THREE.Quaternion()];
    q[0].setFromAxisAngle(new THREE.Vector3(0, 1, 0), offset);
    q[1].setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 3);
    q[2].setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 3);

    armAngle[0].setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      offset > 0 ? this.siteswap.armAngle : -this.siteswap.armAngle
    );
    armAngle[1].setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      offset > 0 ? -this.siteswap.armAngle : this.siteswap.armAngle
    );

    nodes[0].setRotationFromQuaternion(bones[0].quaternion.multiply(q[0]).multiply(armAngle[0]));
    nodes[1].setRotationFromQuaternion(bones[1].quaternion.multiply(armAngle[1]).multiply(q[1]));
    nodes[2].setRotationFromQuaternion(bones[2].quaternion.multiply(q[2]));
    //nodes[3].setRotationFromQuaternion(bones[3].quaternion);
  };
}
