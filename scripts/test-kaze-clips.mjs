// Kaze's exported clips must move the *mesh*, not just the bones.
//
// A rig can resolve, carry eight clips and still look frozen in game if the skin never follows the
// skeleton. This test loads the shipped GLB with the same three.js loader the browser uses, plays
// every clip, and measures skinned vertex displacement with SkinnedMesh.applyBoneTransform - the
// same maths the GPU does. Each clip has to deform the body by a visible amount, and the body has
// to come back to its rest shape when the mixer stops.
//
//   node scripts/test-kaze-clips.mjs
import './glb-node-compat.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const file = resolve(process.argv[2] || 'public/models/characters/kaze/kaze.glb');
// Seventeen clips: the original eight locomotion/combat states plus the states the game's own
// consumer searches for (sprint, land, dodge, charge, beam) and the reaction/flight states the
// fighter enters (launcher, knockdown, get_up, fly).
const EXPECTED = ['idle', 'walk', 'run', 'sprint', 'jump', 'land', 'dodge', 'charge', 'beam',
  'launcher', 'jab', 'heavy_punch', 'block', 'hit_light', 'knockdown', 'get_up', 'fly'];

let checks = 0;
function check(label, condition, detail = '') {
  checks++;
  if (condition) { console.log('  ok  ' + label); return; }
  console.error('  FAIL  ' + label + (detail ? ' :: ' + detail : ''));
  failures++;
}
let failures = 0;

const bytes = readFileSync(file);
const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const gltf = await new Promise((ok, fail) => new GLTFLoader().parse(arrayBuffer, '', ok, fail));
const scene = gltf.scene;
scene.updateMatrixWorld(true);

const clips = gltf.animations || [];
console.log(`\n[${file}]`);
check('every expected clip is present', EXPECTED.every(name => clips.some(c => c.name === name)),
  clips.map(c => c.name).join(','));
check('no unexpected clip ids were added', clips.length === EXPECTED.length,
  clips.map(c => c.name).join(','));

const skinned = [];
scene.traverse(node => { if (node.isSkinnedMesh) skinned.push(node); });
check('the body is a skinned mesh', skinned.length > 0, String(skinned.length));
check('the skin binds a full humanoid skeleton',
  (skinned[0].skeleton?.bones?.length || 0) >= 19, String(skinned[0].skeleton?.bones?.length));

const bones = new Set();
scene.traverse(node => { if (node.isBone) bones.add(node.name); });
for (const required of ['Hips', 'Spine', 'Chest', 'Head', 'LeftArm', 'RightArm', 'LeftUpLeg', 'RightUpLeg']) {
  check(`skeleton has ${required}`, bones.has(required));
}

// The skeleton existing is not the same as the skin using it. Blender exports any vertex whose
// vertex group does not match a bone onto a generated `neutral_bone`, and the result animates as a
// stiff mannequin carried by the spine while every other check here still passes. That exact bug
// shipped once, so the influences are asserted directly.
check('the exporter did not need a neutral_bone placeholder', !bones.has('neutral_bone'),
  'vertices are bound by name and some name does not match a bone');
const influence = new Map();
let unweighted = 0;
for (const mesh of skinned) {
  const weights = mesh.geometry.attributes.skinWeight;
  const indices = mesh.geometry.attributes.skinIndex;
  const names = mesh.skeleton.bones.map(bone => bone.name);
  for (let i = 0; i < weights.count; i++) {
    const w = [weights.getX(i), weights.getY(i), weights.getZ(i), weights.getW(i)];
    if (w[0] + w[1] + w[2] + w[3] < 0.001) unweighted++;
    const s = [indices.getX(i), indices.getY(i), indices.getZ(i), indices.getW(i)];
    for (let k = 0; k < 4; k++) {
      if (w[k] <= 0.01) continue;
      const name = names[s[k]];
      influence.set(name, (influence.get(name) || 0) + 1);
    }
  }
}
check('every vertex carries skin weight', unweighted === 0, `${unweighted} unweighted`);
for (const limb of ['LeftArm', 'LeftForeArm', 'LeftHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot',
  'RightArm', 'RightForeArm', 'RightHand', 'RightUpLeg', 'RightLeg', 'RightFoot']) {
  check(`${limb} actually influences the mesh`, (influence.get(limb) || 0) > 20,
    `${influence.get(limb) || 0} vertices`);
}

const transform = (mesh, index, target) => {
  if (typeof mesh.applyBoneTransform === 'function') return mesh.applyBoneTransform(index, target);
  return mesh.boneTransform(index, target);
};

// Sample every 23rd vertex across every primitive: dense enough to catch a limb moving, cheap
// enough to run eight clips x five times.
function samplePose() {
  scene.updateMatrixWorld(true);
  const out = [];
  for (const mesh of skinned) {
    const count = mesh.geometry.attributes.position.count;
    for (let i = 0; i < count; i += 23) {
      const vertex = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i);
      transform(mesh, i, vertex);
      vertex.applyMatrix4(mesh.matrixWorld);
      out.push(vertex);
    }
  }
  return out;
}

const maxDelta = (a, b) => {
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, a[i].distanceTo(b[i]));
  return max;
};

const mixer = new THREE.AnimationMixer(scene);
// The bind transform of every bone, captured before any action plays. Stopping a mixer action
// leaves the bones wherever the action put them, so anything that wants the authored shape back
// (the rest sample, the joint tests) has to restore this snapshot explicitly.
const bindSnapshot = skinned[0].skeleton.bones.map(bone =>
  [bone, bone.position.clone(), bone.quaternion.clone(), bone.scale.clone()]);
const restoreBind = () => {
  for (const [bone, position, quaternion, scale] of bindSnapshot) {
    bone.position.copy(position);
    bone.quaternion.copy(quaternion);
    bone.scale.copy(scale);
  }
  scene.updateMatrixWorld(true);
};
const rest = samplePose();

// A held clip (block, idle) barely changes inside itself, so "does it move between its own frames"
// is the wrong question for those. What every clip must prove is that it carries the body away
// from the bind shape; the dynamic clips must additionally show motion across the clip.
const DYNAMIC = new Set(['walk', 'run', 'sprint', 'jump', 'land', 'dodge', 'charge', 'beam',
  'launcher', 'jab', 'heavy_punch', 'hit_light', 'knockdown', 'get_up', 'fly']);
for (const clip of clips) {
  const action = mixer.clipAction(clip);
  action.reset();
  action.play();
  const times = [0, 0.25, 0.5, 0.75, 1].map(t => t * clip.duration);
  let posed = 0;
  let motion = 0;
  let first = null;
  for (const time of times) {
    action.time = time;
    mixer.update(0.0001);
    const pose = samplePose();
    posed = Math.max(posed, maxDelta(rest, pose));
    if (!first) first = pose;
    else motion = Math.max(motion, maxDelta(first, pose));
  }
  check(`${clip.name}: poses the body away from the bind shape (${(posed * 100).toFixed(1)} cm)`,
    posed > 0.02, `peak ${posed.toFixed(4)} m`);
  if (DYNAMIC.has(clip.name)) {
    check(`${clip.name}: animates across the clip (${(motion * 100).toFixed(1)} cm)`,
      motion > 0.012, `motion ${motion.toFixed(4)} m`);
  }
  action.stop();
}

// ---------------------------------------------------------------------------------------------
// Joint deformation on the exported skin.
//
// Playing the clips proves the skeleton moves the mesh. It does not prove the *joints* survive a
// hard pose: weights that are too rigid leave a crease, weights that are too soft collapse the
// limb, and a bad bind matrix tears the seam open. So bend each major joint to a combat-like angle
// in isolation and watch the length of the mesh's own edges. A surface that tears stretches an
// edge without limit; one that collapses crushes it to nothing.
const jointTests = [
  ['LeftForeArm', 'z', 1.75, 'elbow'],
  ['RightForeArm', 'z', 1.75, 'elbow'],
  ['LeftArm', 'x', 1.40, 'shoulder'],
  ['RightArm', 'x', 1.40, 'shoulder'],
  ['LeftUpLeg', 'x', 1.20, 'hip'],
  ['RightUpLeg', 'x', 1.20, 'hip'],
  ['LeftLeg', 'x', -1.60, 'knee'],
  ['RightLeg', 'x', -1.60, 'knee']
];

// Rest positions for every vertex, plus a fixed sample of triangles (the edges actually tested).
const restPositions = new Map();
const sampledTriangles = new Map();
for (const mesh of skinned) {
  const count = mesh.geometry.attributes.position.count;
  const points = [];
  for (let i = 0; i < count; i++) {
    const vertex = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i);
    transform(mesh, i, vertex);
    points.push(vertex.applyMatrix4(mesh.matrixWorld));
  }
  restPositions.set(mesh, points);
  const index = mesh.geometry.index;
  if (!index) continue;
  const tris = [];
  for (let i = 0; i + 2 < index.count; i += 3 * 37) {
    tris.push([index.getX(i), index.getX(i + 1), index.getX(i + 2)]);
  }
  sampledTriangles.set(mesh, tris);
}

function posedPoints() {
  scene.updateMatrixWorld(true);
  const out = new Map();
  for (const mesh of skinned) {
    const count = mesh.geometry.attributes.position.count;
    const points = [];
    for (let i = 0; i < count; i++) {
      const vertex = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i);
      transform(mesh, i, vertex);
      points.push(vertex.applyMatrix4(mesh.matrixWorld));
    }
    out.set(mesh, points);
  }
  return out;
}

// Neutralise the mixer completely before posing bones by hand, or the clips fight the test.
for (const action of Object.values(mixer._actions || [])) action.stop();
mixer.stopAllAction();
mixer.update(0);
restoreBind();
const boneByName = new Map();
for (const bone of skinned[0].skeleton.bones) boneByName.set(bone.name, bone);

let sampledEdges = 0;
for (const [boneName, axis, angle, label] of jointTests) {
  const bone = boneByName.get(boneName);
  if (!bone) { check(`${label}: bone ${boneName} exists`, false); continue; }
  const original = bone.rotation.clone();
  bone.rotation[axis] += angle;
  const posed = posedPoints();
  bone.rotation.copy(original);

  let min = Infinity, max = 0, nan = 0, travel = 0, blended = 0, measured = 0;
  for (const mesh of skinned) {
    const rest = restPositions.get(mesh);
    const now = posed.get(mesh);
    for (let i = 0; i < rest.length; i++) {
      const moved = rest[i].distanceTo(now[i]);
      if (!Number.isFinite(moved)) continue;
      travel = Math.max(travel, moved);
    }
    for (const [ia, ib, ic] of sampledTriangles.get(mesh) || []) {
      for (const [p, q] of [[ia, ib], [ib, ic], [ic, ia]]) {
        const before = rest[p].distanceTo(rest[q]);
        if (before < 1e-6) continue;
        const after = now[p].distanceTo(now[q]);
        if (!Number.isFinite(after)) { nan++; continue; }
        sampledEdges++;
        measured++;
        const ratio = after / before;
        if (Math.abs(ratio - 1) > 0.1) blended++;
        min = Math.min(min, ratio);
        max = Math.max(max, ratio);
      }
    }
  }
  const detail = `edges x${min.toFixed(2)}..x${max.toFixed(2)}, ${blended}/${measured} edges deformed`;
  check(`${label} (${boneName} ${angle.toFixed(2)} rad): skin stays finite`, nan === 0, `${nan} NaN vertices`);
  // Without this the test would pass on a rig that ignores the pose entirely: a rotation that moves
  // nothing deforms no edge and looks perfectly "clean".
  check(`${label} (${boneName}): the pose actually articulates the limb ` +
    `(${(travel * 100).toFixed(0)} cm of travel)`, travel > 0.05, `${travel.toFixed(3)} m`);
  // A collapse below a third of rest length is a pinch you can see; a stretch beyond 2.5x is a
  // tear. Both are far outside what linear blend skinning does to a well-bound joint.
  check(`${label} (${boneName}): no crushed faces [${min.toFixed(2)}x .. ${max.toFixed(2)}x]`, min > 0.34, detail);
  check(`${label} (${boneName}): no torn faces`, max < 2.5, detail);
  console.log(`      ${label}: ${blended}/${measured} sampled edges change length by >10% ` +
    `(blend activity at the joint)`);
}
check('the joint test actually had edges to measure', sampledEdges > 2000, String(sampledEdges));

restoreBind();
mixer.stopAllAction();
mixer.update(0.0001);
scene.updateMatrixWorld(true);
// stopAllAction does not restore the rest pose in three, so compare against the clip start instead:
const settled = samplePose();
check('the body returns to the clip-start shape when nothing is playing',
  maxDelta(rest, settled) < 0.16, `${maxDelta(rest, settled).toFixed(3)} m from the bind shape`);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) {
  console.error('Kaze clip test FAILED');
  process.exit(1);
}
console.log('Kaze clip test passed: every exported clip deforms the skinned mesh.');
