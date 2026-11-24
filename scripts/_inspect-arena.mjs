import './glb-node-compat.mjs';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const f = process.argv[2];
const b = readFileSync(f);
const g = await new Promise((ok, bad) => new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', ok, bad));
g.scene.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(g.scene);
const size = box.getSize(new THREE.Vector3());
let meshes = 0, tris = 0, verts = 0, materials = new Set(), textures = new Set();
const roots = new Set();
g.scene.traverse(n => {
  if (n.isMesh) {
    meshes++;
    const pos = n.geometry.attributes.position;
    verts += pos.count;
    tris += (n.geometry.index ? n.geometry.index.count : pos.count) / 3;
    for (const m of (Array.isArray(n.material) ? n.material : [n.material])) { materials.add(m.name); for (const k of ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap']) if (m[k]) textures.add(m[k].uuid); }
  }
});
for (const c of g.scene.children) roots.add(c.name + ' [' + c.type + ']');
console.log(JSON.stringify({ file: f, bytes: b.length, meshes, verts, tris: Math.round(tris), materials: [...materials].slice(0, 12), materialCount: materials.size, textures: textures.size, animations: g.animations.length, bounds: { min: box.min.toArray().map(v => +v.toFixed(2)), max: box.max.toArray().map(v => +v.toFixed(2)), size: size.toArray().map(v => +v.toFixed(2)) }, roots: [...roots] }, null, 1));
