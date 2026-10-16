import * as THREE from 'three';
import { MToonMaterial } from '@pixiv/three-vrm';

/** Only for the bundled avatar. Its soft outline mask leaves a thin inverted-hull
 * edge below the eyes when viewed from below. Tighten the existing inner-face
 * mask; white silhouette regions retain their authored width. No texture or
 * eye-line material is changed. */
export function refineBundledFaceOutline(scene: THREE.Object3D) {
  const seen = new Set<THREE.Material>();
  scene.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (seen.has(material)) continue;
      seen.add(material);
      const m = material as MToonMaterial;
      if (!m.isMToonMaterial || !m.isOutline || !m.outlineWidthMultiplyTexture ||
          m.name !== 'N00_000_00_Face_00_SKIN (Instance) (Outline)') continue;
      m.vertexShader = m.vertexShader.replace(
        'outlineOffset *= outlineTex;',
        'outlineOffset *= smoothstep(0.8, 1.0, outlineTex);'
      );
      m.needsUpdate = true;
    }
  });
}
