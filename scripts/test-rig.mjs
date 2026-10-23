// Structural tests for the character-rig gate.
//
// Two layers:
//   1. synthetic rigs, one defect each, so a regression names the check that stopped working;
//   2. every prefab shipped in public/assets/character_models.glb, loaded through the same
//      GLTFLoader the game uses and measured with the same validator.
//
// Run with: npm run test:rig
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bindRigJoints, validateFighterRig, describeRigValidation, isEquippedWeapon } from '../public/js/rig_validation.js';
import { mountImportedCharacter, facingYaw, TARGET_FIGHTER_HEIGHT } from '../public/js/fighter_model_placement.js';

globalThis.self = globalThis;

let failures = 0;
let checks = 0;
function check(name, condition, detail = '') {
  checks++;
  if (condition) {
    console.log(`ok   ${name}${detail ? ' — ' + detail : ''}`);
    return true;
  }
  failures++;
  console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`);
  return false;
}

const box = (w, h, d) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial());
const joint = (name, x, y, z) => {
  const node = new THREE.Group();
  node.name = name;
  node.position.set(x, y, z);
  return node;
};

/**
 * A miniature version of the real prefab: authored Y-up, identity root, feet on y = 0,
 * 11 bound joints, a chest and head mesh. Each test mutates one property.
 */
function makeRig({ cape = false, emptyMesh = false, skipHead = false } = {}) {
  const root = new THREE.Group();
  root.name = 'Blender fighter Test';
  const pelvis = joint('joint_test_pelvis', 0, 1.02, 0);
  const torso = joint('joint_test_torso', 0, 0.28, 0);
  const neck = joint('joint_test_neck', 0, 0.72, 0);
  const head = joint('joint_test_head', 0, 0.24, 0);
  const leftArm = joint('joint_test_leftArm', -0.54, 0.35, 0);
  const rightArm = joint('joint_test_rightArm', 0.54, 0.35, 0);
  const leftFore = joint('joint_test_leftFore', 0, -0.42, 0);
  const rightFore = joint('joint_test_rightFore', 0, -0.42, 0);
  const leftLeg = joint('joint_test_leftLeg', -0.22, -0.15, 0);
  const rightLeg = joint('joint_test_rightLeg', 0.22, -0.15, 0);
  const leftShin = joint('joint_test_leftShin', 0, -0.45, 0);
  const rightShin = joint('joint_test_rightShin', 0, -0.45, 0);
  root.add(pelvis);
  pelvis.add(torso, leftLeg, rightLeg);
  torso.add(neck, leftArm, rightArm);
  neck.add(head);
  leftArm.add(leftFore);
  rightArm.add(rightFore);
  leftLeg.add(leftShin);
  rightLeg.add(rightShin);

  const chest = box(0.8, 0.9, 0.45);
  chest.name = 'test Chest';
  chest.position.set(0, 0.3, 0);
  torso.add(chest);
  // Legs and arms need geometry of their own, or the measured silhouette is just the torso.
  for (const leg of [leftShin, rightShin]) {
    const boot = box(0.26, 0.22, 0.34);
    boot.name = 'test Boot';
    boot.position.set(0, -0.33, 0.06);
    leg.add(boot);
  }
  for (const arm of [leftArm, rightArm]) {
    const upper = box(0.22, 0.5, 0.24);
    upper.name = 'test Arm';
    upper.position.set(0, -0.2, 0);
    arm.add(upper);
  }
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 8), new THREE.MeshStandardMaterial());
  skull.name = 'test Head';
  head.add(skull);
  if (emptyMesh) {
    const blank = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    blank.name = 'test Empty';
    torso.add(blank);
  }
  if (cape) {
    const cape = box(0.9, 1.4, 0.1);
    cape.name = 'test Cape';
    cape.position.set(0, 1.0, -0.3);
    root.add(cape);
  }
  if (skipHead) head.name = 'head_unbound';
  bindRigJoints(root, 'test');
  root.updateMatrixWorld(true);
  return root;
}

console.log('Rig validator — synthetic rigs\n');

const healthy = validateFighterRig(makeRig());
check('a well-formed rig passes', healthy.ok, describeRigValidation(healthy));
check('measurement matches the model', Math.abs(healthy.metrics.height - 2.52) < 0.15, `${healthy.metrics.height} m`);
check('feet are measured on the floor', Math.abs(healthy.metrics.feetY) < 0.05, `${healthy.metrics.feetY} m`);
check('head clears the pelvis', healthy.metrics.headAbovePelvis > 0.9, `${healthy.metrics.headAbovePelvis} m`);

const legacyRoot = makeRig();
legacyRoot.rotation.x = Math.PI / 2;
legacyRoot.updateMatrixWorld(true);
const legacy = validateFighterRig(legacyRoot);
check('the legacy +90 degree root is rejected', !legacy.ok, legacy.issues.join('; '));
check('…and the message names the fix', legacy.issues.some(issue => issue.includes('normalize-character-rig')), 'points at the normaliser');

const sunkenCape = makeRig({ cape: true });
const badCape = sunkenCape.getObjectByName('test Cape');
badCape.position.y = -1.2;
sunkenCape.updateMatrixWorld(true);
const cape = validateFighterRig(sunkenCape);
check('a cape through the floor is rejected', !cape.ok && cape.issues.some(issue => issue.includes('below the floor')), cape.issues.join('; '));

const missingJoint = makeRig();
delete missingJoint.userData.head;
const missing = validateFighterRig(missingJoint);
check('a missing head joint is rejected', !missing.ok && missing.issues.some(issue => issue.includes('missing joints')), missing.issues.join('; '));

const squashed = makeRig();
squashed.scale.y = 0.15;
squashed.updateMatrixWorld(true);
const squash = validateFighterRig(squashed);
check('a squashed rig is rejected', !squash.ok, squash.issues.join('; '));

const flattened = makeRig();
flattened.scale.set(3, 1, 3);
flattened.updateMatrixWorld(true);
const flat = validateFighterRig(flattened);
check('a rig with a per-axis scale is rejected', !flat.ok && flat.issues.some(issue => issue.includes('not uniform')), flat.issues.join('; '));

const floating = makeRig();
floating.position.y = 0.9;
floating.updateMatrixWorld(true);
const float = validateFighterRig(floating, { ground: 0 });
check('a rig floating above its origin is rejected', !float.ok && float.issues.some(issue => issue.includes('float')), float.issues.join('; '));

const empty = validateFighterRig(makeRig({ emptyMesh: true }));
check('a mesh with no geometry is rejected', !empty.ok && empty.issues.some(issue => issue.includes('drawable geometry')), empty.issues.join('; '));

const headless = validateFighterRig(makeRig({ skipHead: true }));
check('a rig without a head node fails', !headless.ok, headless.issues.join('; '));

const notAModel = validateFighterRig(null);
check('a missing model fails instead of throwing', !notAModel.ok, notAModel.issues.join('; '));

console.log('\nRig validator — shipped prefab library\n');

const glbPath = resolve('public/assets/character_models.glb');
const raw = readFileSync(glbPath);
const bytes = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
const gltf = await new Promise((ok, fail) => new GLTFLoader().parse(bytes, '', ok, fail));
gltf.scene.updateMatrixWorld(true);

const roots = [];
gltf.scene.traverse(node => {
  if (String(node.name).startsWith('character_')) roots.push(node);
});
check('the library ships at least 57 prefabs', roots.length >= 57, `${roots.length} prefabs`);

const rejected = [];
let shortest = { name: '', height: Infinity };
let tallest = { name: '', height: 0 };
for (const root of roots) {
  const key = root.name.replace(/^character_/, '');
  const probe = root.clone(true);
  probe.position.set(0, 0, 0);
  const bound = bindRigJoints(probe, key);
  probe.updateMatrixWorld(true);
  const result = validateFighterRig(probe, { ground: 0, ignore: isEquippedWeapon });
  if (bound < 11) rejected.push({ key, issues: [`only ${bound} joints bound`] });
  else if (!result.ok) rejected.push({ key, issues: result.issues });
  else {
    if (result.metrics.height < shortest.height) shortest = { name: key, height: result.metrics.height };
    if (result.metrics.height > tallest.height) tallest = { name: key, height: result.metrics.height };
  }
  probe.removeFromParent();
}

check('every shipped prefab passes the gate', rejected.length === 0,
  rejected.length ? JSON.stringify(rejected.slice(0, 6), null, 1) : `shortest ${shortest.name} ${shortest.height} m, tallest ${tallest.name} ${tallest.height} m`);

// The specific defects this milestone fixed, asserted on the real asset.
const superman = roots.find(node => node.name === 'character_superman');
const rootRotation = superman.quaternion.angleTo(new THREE.Quaternion());
check('shipped prefabs have an identity root', rootRotation < 1e-3, `${(rootRotation * 180 / Math.PI).toFixed(2)} degrees`);

const capeMesh = [];
superman.traverse(node => { if (node.isMesh && node.parent === superman) capeMesh.push(node); });
const capeBox = new THREE.Box3();
for (const mesh of capeMesh) capeBox.union(new THREE.Box3().setFromObject(mesh));
check('the cape hangs from the shoulders, not the floor',
  capeBox.isEmpty() || (capeBox.min.y > 0.2 && capeBox.max.y > 1.7),
  capeBox.isEmpty() ? 'no root-level cape' : `y ${capeBox.min.y.toFixed(2)}…${capeBox.max.y.toFixed(2)}`);

const pelvis = superman.getObjectByName('joint_superman_pelvis');
check('joint offsets are authored Y-up', pelvis.position.y > 0.9 && Math.abs(pelvis.position.z) < 0.02,
  `pelvis local ${pelvis.position.toArray().map(value => value.toFixed(2)).join(', ')}`);

// ---------------------------------------------------------------------------- imported models
// A character model imported from outside the prefab library (a Sketchfab GLB, Goku's FBX)
// arrives at an arbitrary scale with its origin wherever the author put it. These are the
// placement rules the loader applies before the rig gate runs; they used to be inline and
// untested, which is how a stale variable in the import path went unnoticed.
console.log('\nImported-model placement');

function importedBody(heightMetres, centreY = 0, facing = 'Z') {
  const root = new THREE.Group();
  root.name = 'Imported';
  const mesh = box(0.6, heightMetres, 0.3);
  mesh.name = 'body';
  mesh.position.set(0, centreY, 0);
  root.add(mesh);
  if (facing === '-Z') root.rotation.y = Math.PI;
  root.updateMatrixWorld(true);
  return root;
}

{
  const hips = importedBody(1.8, 1.1);
  const stand = new THREE.Group();
  stand.position.set(-12, 0.18, 4);
  const { holder, placement } = mountImportedCharacter(hips, stand, { facing: 1, facingZ: 0 });
  holder.position.copy(stand.position);
  holder.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(holder);
  check('an imported model is scaled to the roster height', Math.abs(bounds.max.y - bounds.min.y - TARGET_FIGHTER_HEIGHT) < 0.02,
    `${(bounds.max.y - bounds.min.y).toFixed(3)} m from a ${placement.sourceHeight.toFixed(2)} m source`);
  check('an imported model lands its feet on the fighter origin', Math.abs(bounds.min.y - holder.position.y) < 0.02,
    `feet ${bounds.min.y.toFixed(3)} vs origin y ${holder.position.y.toFixed(3)}`);
  check('an imported model inherits the fighter position', holder.position.x === -12 && holder.position.z === 4,
    holder.position.toArray().join(', '));
  check('the imported root keeps its own transform', Math.abs(hips.rotation.x) < 1e-6, `root x rotation ${hips.rotation.x}`);
  check('the holder reads the imported userData', holder.userData === hips.userData,
    holder.userData === hips.userData ? 'shared' : 'copied');
}

{
  const centimetres = importedBody(180, 90);
  const stand = new THREE.Group();
  const { holder, placement } = mountImportedCharacter(centimetres, stand, {});
  holder.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(holder);
  check('a 180-unit (centimetre-authored) export is normalised', Math.abs(bounds.max.y - bounds.min.y - TARGET_FIGHTER_HEIGHT) < 0.02,
    `scale ${placement.scale.toFixed(4)} for a ${placement.sourceHeight} m source`);
  check('the normalised scale is recorded for diagnostics', placement.scale > 0.01 && placement.scale < 0.02, String(placement.scale));
}

{
  const up = new THREE.Vector3(0, 1, 0);
  for (const [facing, facingZ, expected] of [[1, 0, 'x+'], [-1, 0, 'x-'], [0, 1, 'z+'], [0, -1, 'z-']]) {
    const direction = new THREE.Vector3(0, 0, 1).applyAxisAngle(up, facingYaw(facing, facingZ));
    const wanted = new THREE.Vector3(facing, 0, facingZ);
    check(`a +Z model faces ${expected}`, direction.distanceTo(wanted) < 1e-6,
      `forward ${direction.toArray().map(v => v.toFixed(2)).join(', ')} vs wanted ${wanted.toArray().join(', ')}`);
  }
  // Sketchfab exports are frequently authored facing -Z: the manifest yawOffset corrects it.
  const back = importedBody(1.9, 0.95, '-Z');
  const flipped = mountImportedCharacter(back, new THREE.Group(), { facing: 1, facingZ: 0, yawOffset: Math.PI });
  const direction = new THREE.Vector3(0, 0, -1).applyAxisAngle(up, flipped.holder.rotation.y);
  check('a -Z model with a 180 degree offset faces the fighter direction',
    direction.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-6,
    `forward ${direction.toArray().map(v => v.toFixed(2)).join(', ')}`);
}

console.log(`\n${checks - failures}/${checks} rig checks passed`);
if (failures) {
  console.error(`${failures} rig check(s) failed`);
  process.exit(1);
}
