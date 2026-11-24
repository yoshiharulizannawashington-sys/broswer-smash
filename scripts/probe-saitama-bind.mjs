#!/usr/bin/env node
// Bind-pose + old-clip audit for the 158-joint Saitama body.
//
// Prints the real world-space root, arm and leg positions and measures how many joints each shipped
// clip actually animates. Evidence only; it does not modify the body or its clips.
//
// GLTFLoader sanitises this body's dotted names (`spine.001_143` -> `spine001_143`), so bones are
// resolved by normalised name, which is also how the runtime addresses them.
//
//   node scripts/probe-saitama-bind.mjs
import './glb-node-compat.mjs';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

globalThis.self ||= globalThis;
const file = 'public/models/characters/imported/saitama/saitama.glb';
const bytes = readFileSync(file);
const gltf = await new Promise((ok, bad) => new GLTFLoader().parse(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', ok, bad));
const scene = gltf.scene;
scene.updateMatrixWorld(true);

const bones = [];
scene.traverse(node => { if (node.isBone) bones.push(node); });
const norm = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const findBone = fragment => {
  const wanted = norm(fragment);
  return bones.find(bone => norm(bone.name) === wanted)
    || bones.find(bone => norm(bone.name).startsWith(wanted))
    || null;
};

console.log('BONES', bones.length, bones.slice(0, 6).map(bone => bone.name).join(', '));
const roles = {
  hips: 'spine_156', spine1: 'spine001_143', spineTop: 'spine006_92', head: 'face_91',
  shoulderL: 'shoulderL117', upperArmL: 'upperarmL116', forearmL: 'forearmL115', handL: 'handL114',
  shoulderR: 'shoulderR140', upperArmR: 'upperarmR139', forearmR: 'forearmR138', handR: 'handR137',
  thighL: 'thighL150', shinL: 'shinL149', footL: 'footL148', toeL: 'toeL146',
  thighR: 'thighR155', shinR: 'shinR154', footR: 'footR153', toeR: 'toeR151'
};
const world = new Map();
for (const [role, fragment] of Object.entries(roles)) {
  const node = findBone(fragment);
  if (!node) { console.log(role, fragment, 'MISSING'); continue; }
  const position = node.getWorldPosition(new THREE.Vector3());
  world.set(role, position);
  console.log(role, node.name, 'world', position.toArray().map(v => +v.toFixed(4)),
    'localT', node.position.toArray().map(v => +v.toFixed(4)));
}
const box = new THREE.Box3().setFromObject(scene);
console.log('box', box.min.toArray().map(v => +v.toFixed(3)), box.max.toArray().map(v => +v.toFixed(3)));
const forward = world.get('toeL').clone().sub(world.get('footL')); forward.y = 0; forward.normalize();
console.log('forward(toe-foot)', forward.toArray().map(v => +v.toFixed(3)));
console.log('hips height', +world.get('hips').y.toFixed(3), 'head height', +world.get('head').y.toFixed(3),
  'left foot y', +world.get('footL').y.toFixed(3));

for (const name of ['idle', 'walk', 'run', 'sprint', 'jump', 'jab', 'heavy_punch', 'block', 'hover', 'air_attack']) {
  const clip = (gltf.animations || []).find(candidate => candidate.name === name);
  if (!clip) continue;
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip); action.play();
  const samples = [];
  for (let i = 0; i < 9; i += 1) {
    action.time = clip.duration * i / 8;
    mixer.update(0.00001); scene.updateMatrixWorld(true);
    const snap = new Map();
    for (const bone of bones) snap.set(bone.name, bone.quaternion.clone());
    samples.push({
      snap,
      handL: findBone('handL114').getWorldPosition(new THREE.Vector3()),
      handR: findBone('handR137').getWorldPosition(new THREE.Vector3()),
      footL: findBone('footL148').getWorldPosition(new THREE.Vector3()).y,
      footR: findBone('footR153').getWorldPosition(new THREE.Vector3()).y
    });
  }
  let moved = 0, max = 0;
  for (const [bone, quat] of samples[4].snap) {
    const first = samples[0].snap.get(bone);
    if (!first) continue;
    const angle = first.angleTo(quat);
    if (angle > 0.01) moved += 1;
    if (angle > max) max = angle;
  }
  mixer.stopAllAction(); mixer.uncacheRoot(scene);
  console.log('CLIP', name, 'dur', clip.duration, 'tracks', clip.tracks.length,
    'movedMid', moved, 'maxMid', +max.toFixed(4),
    'handY', [+samples[4].handL.y.toFixed(3), +samples[4].handR.y.toFixed(3)],
    'footY', [+samples[4].footL.toFixed(3), +samples[4].footR.toFixed(3)]);
}
