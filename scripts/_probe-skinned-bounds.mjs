// Probe: measure the real skinned bounds of a character GLB at rest and under named clips.
import './glb-node-compat.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const file = resolve(process.argv[2]);
const clipFilter = process.argv[3] ? process.argv[3].split(',') : ['idle'];
const times = (process.argv[4] || '0,0.5').split(',').map(Number);

const buf = readFileSync(file);
const gltf = await new Promise((ok, bad) => new GLTFLoader().parse(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', ok, bad));
const scene = gltf.scene;
scene.updateMatrixWorld(true);
const skinned = [];
scene.traverse(n => { if (n.isSkinnedMesh) skinned.push(n); });
const bones = new Set();
for (const m of skinned) for (const b of m.skeleton.bones) bones.add(b);

function measure() {
  scene.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const box = new THREE.Box3();
  let verts = 0;
  if (!skinned.length) {
    box.setFromObject(scene);
    return { box, verts: 0 };
  }
  for (const m of skinned) {
    m.skeleton.update();
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i);
      m.applyBoneTransform(i, v);
      v.applyMatrix4(m.matrixWorld);
      box.expandByPoint(v);
      verts += 1;
    }
  }
  return { box, verts };
}

const s = (box) => ({
  width: +(box.max.x - box.min.x).toFixed(3),
  height: +(box.max.y - box.min.y).toFixed(3),
  depth: +(box.max.z - box.min.z).toFixed(3),
  feetY: +box.min.y.toFixed(3),
  top: +box.max.y.toFixed(3)
});

const out = {
  file, bones: bones.size, skinnedMeshes: skinned.length,
  clips: gltf.animations.map(a => a.name)
};
const rest = measure();
out.rest = s(rest.box);
out.restVerts = rest.verts;

const byName = new Map(gltf.animations.map(a => [a.name, a]));
const results = [];
for (const name of clipFilter) {
  const clip = byName.get(name) || gltf.animations.find(a => a.name.toLowerCase().includes(name.toLowerCase()));
  if (!clip) { results.push({ clip: name, missing: true }); continue; }
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip);
  action.play();
  const samples = [];
  for (const t of times) {
    mixer.setTime(Math.min(t, clip.duration - 1e-4));
    samples.push({ t, ...s(measure().box) });
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
  results.push({ clip: clip.name, duration: +clip.duration.toFixed(3), samples });
}
out.samples = results;
console.log(JSON.stringify(out, null, 1));
