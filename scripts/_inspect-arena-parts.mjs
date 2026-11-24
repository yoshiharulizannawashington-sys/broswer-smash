import './glb-node-compat.mjs';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const b = readFileSync(process.argv[2]);
const g = await new Promise((ok, bad) => new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', ok, bad));
g.scene.updateMatrixWorld(true);
const rows = [];
g.scene.traverse(n => {
  if (!n.isMesh) return;
  const box = new THREE.Box3().setFromObject(n);
  const s = box.getSize(new THREE.Vector3());
  rows.push({ name: n.name, parent: n.parent?.name, tris: Math.round((n.geometry.index ? n.geometry.index.count : n.geometry.attributes.position.count) / 3), size: s.toArray().map(v => +v.toFixed(1)), min: box.min.toArray().map(v => +v.toFixed(1)), max: box.max.toArray().map(v => +v.toFixed(1)), mat: (Array.isArray(n.material) ? n.material : [n.material]).map(m => m.name).join('+') });
});
rows.sort((a, b) => b.size[0] * b.size[2] - a.size[0] * a.size[2]);
console.log(JSON.stringify(rows, null, 1));
