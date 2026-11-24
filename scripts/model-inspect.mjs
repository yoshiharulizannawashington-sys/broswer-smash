// Deep inspection of a downloaded model, used by the preview pane, the import report and the
// "is this actually a character?" gate.
//
// GLB files are parsed with the same three.js GLTFLoader the game uses, so the numbers here are
// the numbers the browser will see. Other formats are reported as uninspected rather than guessed.
import { readFileSync } from 'node:fs';
import { dirname, extname, basename } from 'node:path';
import './glb-node-compat.mjs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

globalThis.self ||= globalThis;

const HUMANOID = /(hips|pelvis|spine|chest|neck|head|shoulder|clavicle|upperarm|lowerarm|forearm|hand|thigh|upleg|shin|calf|lowerleg|foot|ankle|toe)/i;

const empty = (file, reason) => ({
  file: basename(file), inspected: false, reason, triangles: null, meshes: null, materials: null,
  textures: null, skins: 0, joints: 0, humanoidJoints: 0, rig: 'unknown', clips: [],
  height: null, width: null, depth: null, upright: null, feetBelowOrigin: null
});

export async function inspectModel(file) {
  const ext = extname(file).toLowerCase();
  if (ext !== '.glb' && ext !== '.gltf') {
    return empty(file, `${ext || 'this format'} is converted by Blender during preparation; geometry is not inspected before that`);
  }
  if (ext === '.gltf') return empty(file, 'external-buffer glTF is inspected after Blender converts it to a single GLB');
  const buffer = readFileSync(file);
  if (buffer.subarray(0, 4).toString('utf8') !== 'glTF') return empty(file, 'not a GLB container');
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  let gltf;
  try {
    gltf = await new Promise((ok, bad) => new GLTFLoader().parse(data, dirname(file) + '/', ok, bad));
  } catch (error) {
    return empty(file, `GLB could not be parsed: ${String(error?.message || error).slice(0, 160)}`);
  }
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  let meshes = 0; let triangles = 0; let skinned = 0; let joints = 0; let humanoidJoints = 0;
  let materials = new Set(); let textures = new Set();
  scene.traverse(node => {
    if (node.isBone) {
      joints += 0;
      if (HUMANOID.test(node.name)) humanoidJoints++;
    }
    if (node.isSkinnedMesh) {
      skinned++;
      joints = Math.max(joints, node.skeleton?.bones?.length || 0);
    }
    if (!node.isMesh) return;
    meshes++;
    const geometry = node.geometry;
    const count = geometry?.index?.count ?? geometry?.attributes?.position?.count ?? 0;
    triangles += Math.floor(count / 3);
    for (const material of [].concat(node.material || [])) {
      if (!material) continue;
      materials.add(material.uuid);
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
        if (material[key]) textures.add(material[key].uuid);
      }
    }
  });
  const height = size.y;
  const clips = (gltf.animations || []).map(clip => ({ name: clip.name, duration: +clip.duration.toFixed(3) }));
  return {
    file: basename(file),
    inspected: true,
    triangles,
    meshes,
    materials: materials.size,
    textures: textures.size,
    skins: skinned,
    joints,
    humanoidJoints,
    rig: skinned > 0 ? 'yes' : 'no',
    rigDetail: skinned > 0 ? `${skinned} skinned mesh(es), ${joints} joints, ${humanoidJoints} humanoid-named bones` : 'no skin in the file',
    clips,
    height: +height.toFixed(3),
    width: +size.x.toFixed(3),
    depth: +size.z.toFixed(3),
    upright: height >= Math.max(size.x, size.z) * 0.55,
    feetBelowOrigin: +(-box.min.y).toFixed(3)
  };
}
