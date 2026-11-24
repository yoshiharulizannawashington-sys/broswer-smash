// Temporary probe: which meshes in a character GLB are actually bound to the skeleton?
// A part that exported as a plain (unskinned) mesh does not deform with the animation.
import './glb-node-compat.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const file = resolve(process.argv[2]);
const buf = readFileSync(file);
const gltf = await new Promise((ok, fail) => new GLTFLoader().parse(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', ok, error => fail(error)));

const scene = gltf.scene;
scene.updateMatrixWorld(true);
let skinned = 0;
let statics = 0;
const rows = [];
const staticsList = [];
scene.traverse(node => {
  if (!node.isMesh) return;
  const materials = (Array.isArray(node.material) ? node.material : [node.material])
    .map(m => m?.name).join('+');
  const row = [node.name, node.isSkinnedMesh ? 'SKIN  ' : 'STATIC', node.geometry?.attributes?.position?.count ?? 0, materials, node.parent?.name || '(root)'].join(' | ');
  rows.push(row);
  if (node.isSkinnedMesh) skinned++; else { statics++; staticsList.push(row); }
});
console.log('file:', file);
console.log('scene children:', scene.children.map(c => `${c.name}(${c.type})`).join(', '));
console.log(`meshes: ${rows.length}  skinned: ${skinned}  static: ${statics}`);
console.log('--- skinned ---');
console.log(rows.filter(r => r.includes('SKIN')).slice(0, 6).join('\n'));
console.log('--- static (these do NOT follow the animation) ---');
console.log(staticsList.slice(0, 40).join('\n'));
