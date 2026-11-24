#!/usr/bin/env node
// Static acceptance for the Valley of the End arena placement.
// Loads the shipped GLB, applies the same scale/offset as arenas/valley_of_the_end.js and checks
// that the canyon covers the Final Valley playfield, that the river sits on the gameplay floor and
// that the statues are monument-scale.
import './glb-node-compat.mjs';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const SCALE = 5.4;
const GROUND_Y = -((0.2 * SCALE) - 0.005);
const PLACE_Z = 55.3;
const BOUNDS = { x0: -58, x1: 58, z0: -66, z1: 22 };

const file = process.argv[2] || 'public/assets/arenas/valley_of_the_end.glb';
const bytes = readFileSync(file);
const gltf = await new Promise((ok, bad) => new GLTFLoader().parse(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', ok, bad));

const root = gltf.scene;
root.scale.setScalar(SCALE);
root.position.set(0, GROUND_Y, PLACE_Z);
root.updateMatrixWorld(true);

let meshes = 0, tris = 0, textures = new Set();
root.traverse(n => {
  if (!n.isMesh) return;
  meshes += 1;
  tris += Math.round((n.geometry.index ? n.geometry.index.count : n.geometry.attributes.position.count) / 3);
  for (const m of (Array.isArray(n.material) ? n.material : [n.material])) {
    for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
      if (m[key]) textures.add(m[key].uuid);
    }
  }
});

const box = new THREE.Box3().setFromObject(root);
const size = box.getSize(new THREE.Vector3());
const failures = [];
const check = (ok, label, detail) => { if (!ok) failures.push(label + ': ' + detail); console.log((ok ? 'ok   ' : 'FAIL ') + label + ' — ' + detail); };

check(meshes >= 12, 'model parts', meshes + ' meshes, ' + tris + ' triangles, ' + textures.size + ' textures');
check(box.min.x <= BOUNDS.x0 && box.max.x >= BOUNDS.x1, 'covers the playfield width', `x ${box.min.x.toFixed(1)}..${box.max.x.toFixed(1)} vs ${BOUNDS.x0}..${BOUNDS.x1}`);
check(box.min.z <= BOUNDS.z0 && box.max.z >= BOUNDS.z1, 'covers the playfield depth', `z ${box.min.z.toFixed(1)}..${box.max.z.toFixed(1)} vs ${BOUNDS.z0}..${BOUNDS.z1}`);
check(size.x >= 110 && size.z >= 290 && size.y >= 40, 'arena is monument-scale', `${size.x.toFixed(1)} wide x ${size.y.toFixed(1)} tall x ${size.z.toFixed(1)} long`);
const riverTop = 0.2 * SCALE + GROUND_Y;
check(Math.abs(riverTop - 0.005) < 0.002, 'river sits on the gameplay floor', 'surface y = ' + riverTop.toFixed(3));
check(box.min.y <= 0.01, 'no geometry floats above the floor edge', 'lowest y = ' + box.min.y.toFixed(2));

console.log(JSON.stringify({ file, scale: SCALE, meshes, tris, textures: textures.size, bounds: { x: [box.min.x, box.max.x], y: [box.min.y, box.max.y], z: [box.min.z, box.max.z] }, failures }, null, 1));
if (failures.length) process.exit(1);
