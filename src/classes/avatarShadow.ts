import * as THREE from 'three';

// MToon の描画モード(three-vrm の MToonMaterialRenderMode)
const MTOON_CUTOUT = 1;
const MTOON_TRANSPARENT = 2;
const MTOON_TRANSPARENT_WITH_ZWRITE = 3;

/**
 * アバターの影を、テクスチャの透明な部分を抜いた形で落とす。
 *
 * three.js r118 の影の描画は材質のテクスチャや透明度のしきい値を見ないため、
 * 髪の毛先やスカートの端などが四角い板のまま影になってしまう。
 * また 1 つのメッシュに複数の材質(髪・服・肌…)が入っているので、メッシュ単位の影用材質も使えない。
 *
 * そこで材質ごとに「影武者」メッシュを作る。頂点データと骨は元のメッシュと共有し(メモリはほぼ増えない)、
 * その材質のテクスチャと透明度のしきい値を持った影用の材質を付ける。
 * 影武者は色も奥行きも書き込まない材質で描くので画面には映らない(r118 は影の計算でも画面のカメラの
 * レイヤーを使うため、レイヤーで隠すことはできない)。元のメッシュは影を落とさない。
 */
export function setupAvatarShadows(root: THREE.Object3D) {
  const masks = new Map<THREE.Texture, THREE.Texture>();
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
  });

  meshes.forEach((mesh) => {
    mesh.castShadow = false;

    // 揺れもの用の当たり判定(表示しない球)や、表情(モーフ)を持つ顔は影を落とさない。
    // 顔は影への影響が小さく、three.js r118 はモーフの付け外しで影の描画に失敗することがある
    const geometry = mesh.geometry as THREE.BufferGeometry;
    if (!geometry.isBufferGeometry || !geometry.index) return;
    if (/^vrmCollider/.test(mesh.name)) return;
    if (geometry.morphAttributes && Object.keys(geometry.morphAttributes).length > 0) return;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = geometry.groups.length > 0 ? geometry.groups : [{ start: 0, count: geometry.index.count, materialIndex: 0 }];

    groups.forEach((group) => {
      const material = materials[group.materialIndex || 0] as any;
      if (!material || material.visible === false || material.isOutline) return;

      const proxy = createShadowProxy(mesh, geometry, group.start, group.count, material, masks);
      if (proxy) mesh.add(proxy);
    });
  });
}

function createShadowProxy(
  mesh: THREE.Mesh,
  geometry: THREE.BufferGeometry,
  start: number,
  count: number,
  material: any,
  masks: Map<THREE.Texture, THREE.Texture>
): THREE.Mesh | null {
  // 半透明(Transparent)の材質は影を落とさない(目のハイライトなど)
  const blendMode = material.blendMode;
  if (blendMode === MTOON_TRANSPARENT || blendMode === MTOON_TRANSPARENT_WITH_ZWRITE) return null;

  // 頂点データは共有し、この材質の三角形だけを描くインデックスを作る
  const sub = new THREE.BufferGeometry();
  Object.keys(geometry.attributes).forEach((name) => sub.setAttribute(name, geometry.attributes[name]));
  const index = geometry.index!;
  sub.setIndex(new THREE.BufferAttribute((index.array as Uint32Array).slice(start, start + count), 1));
  sub.boundingSphere = geometry.boundingSphere;
  sub.boundingBox = geometry.boundingBox;

  const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh === true;
  const cutout = blendMode === MTOON_CUTOUT;
  const depthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: cutout && material.map ? alphaMask(material.map, masks) : null,
    alphaTest: cutout ? material.cutoff ?? 0.5 : 0,
  });
  (depthMaterial as any).skinning = skinned; // r118 の型定義にはないが、影の描画で骨の動きを反映するのに必要

  // 画面には何も書き込まない(影の計算だけに使う)。裏表の扱いは元の材質に合わせる
  const placeholder = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
    side: material.side,
  });
  placeholder.skinning = skinned;

  let proxy: THREE.Mesh;
  if (skinned) {
    const original = mesh as THREE.SkinnedMesh;
    const skinnedProxy = new THREE.SkinnedMesh(sub, placeholder);
    skinnedProxy.bindMode = original.bindMode;
    skinnedProxy.bind(original.skeleton, original.bindMatrix);
    proxy = skinnedProxy;
  } else {
    proxy = new THREE.Mesh(sub, placeholder);
  }
  proxy.name = `${mesh.name} (shadow)`;
  proxy.customDepthMaterial = depthMaterial;
  proxy.castShadow = true;
  proxy.receiveShadow = false;
  proxy.frustumCulled = false;
  proxy.renderOrder = -1;
  return proxy;
}

// 影の形を決めるだけなので、透明度のマスクは小さくてよい
const MASK_SIZE = 512;

/**
 * 影用の透明度マスク。GLTF から読み込んだテクスチャ(ImageBitmap)をそのまま影用の材質に使うと
 * アルファがすべて 0 として読まれて影が消えてしまうため、キャンバスに描き写したものを使う。
 */
function alphaMask(texture: THREE.Texture, masks: Map<THREE.Texture, THREE.Texture>): THREE.Texture | null {
  const cached = masks.get(texture);
  if (cached) return cached;
  const image = texture.image as CanvasImageSource & { width: number; height: number };
  if (!image || !image.width) return null;

  const canvas = document.createElement('canvas');
  canvas.width = Math.min(MASK_SIZE, image.width);
  canvas.height = Math.min(MASK_SIZE, image.height);
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const mask = new THREE.CanvasTexture(canvas);
  mask.flipY = texture.flipY;
  mask.wrapS = texture.wrapS;
  mask.wrapT = texture.wrapT;
  mask.offset.copy(texture.offset);
  mask.repeat.copy(texture.repeat);
  mask.rotation = texture.rotation;
  masks.set(texture, mask);
  return mask;
}
