// Measure every enabled body in the character manifest with the same three.js GLTFLoader the game
// loads it with, so the roster audit can quote each fighter's real mesh, skeleton and clip counts
// instead of leaving them blank when the manifest entry does not record them.
//
//   node scripts/measure-roster-bodies.mjs > artifacts/roster-bodies.json
//
// scripts/report-roster-quality.mjs reads that file for the per-fighter matrix.
import './glb-node-compat.mjs';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';
import { resolveRig, CANONICAL_BONES } from '../public/js/anim/rig_map.js';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('public/models/characters/manifest.json', root), 'utf8'));

function parseGlb(buffer) {
  return new Promise((ok, fail) => {
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    new GLTFLoader().parse(arrayBuffer, '', ok, error => fail(new Error(String(error?.message || error))));
  });
}

const bodies = {};
for (const [slug, entry] of Object.entries(manifest.characters || {})) {
  const url = String(entry.url || '');
  if (entry.enabled !== true || !url) continue;
  const file = fileURLToPath(new URL(`public/${url.replace(/^\//, '').split('?')[0]}`, root));
  if (!existsSync(file)) {
    bodies[slug] = { url, measured: false, reason: 'file is not present' };
    continue;
  }
  try {
    const gltf = await parseGlb(readFileSync(file));
    const scene = gltf.scene || gltf.scenes[0];
    scene.updateMatrixWorld(true);
    let meshes = 0, skinnedMeshes = 0, triangles = 0, vertices = 0;
    const materials = new Set();
    const skeletons = new Set();
    scene.traverse(node => {
      if (!node.isMesh) return;
      meshes++;
      for (const mat of (Array.isArray(node.material) ? node.material : [node.material])) {
        if (mat) materials.add(mat.name || mat.uuid);
      }
      const geometry = node.geometry;
      if (geometry?.index) triangles += geometry.index.count / 3;
      else if (geometry?.attributes?.position) triangles += geometry.attributes.position.count / 3;
      if (geometry?.attributes?.position) vertices += geometry.attributes.position.count;
      if (node.isSkinnedMesh && node.skeleton) {
        skinnedMeshes++;
        skeletons.add(node.skeleton);
      }
    });
    const bones = [...skeletons].flatMap(skeleton => skeleton.bones).length;
    const rig = resolveRig(scene);
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    bodies[slug] = {
      url,
      measured: true,
      bytes: statSync(file).size,
      meshes, skinnedMeshes, vertices, triangles: Math.round(triangles),
      materials: materials.size,
      bones,
      canonicalBound: rig?.boundCount ?? 0,
      canonicalMissing: rig?.missing ?? CANONICAL_BONES.slice(),
      clips: (gltf.animations || []).length,
      clipNames: (gltf.animations || []).map(clip => clip.name),
      height: Number(size.y.toFixed(3)),
      feetY: Number(box.min.y.toFixed(3))
    };
  } catch (error) {
    bodies[slug] = { url, measured: false, reason: String(error?.message || error) };
  }
}

console.log(JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  measuredBy: 'node scripts/measure-roster-bodies.mjs',
  bodies
}, null, 2));
