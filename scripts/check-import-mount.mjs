#!/usr/bin/env node
// Pre-flight gate: will this prepared GLB actually replace a fighter's body at runtime?
//
//   node scripts/check-import-mount.mjs <model.glb>
//
// Runs the game's own placement and rig-validation code against the file, without a browser.
// This catches the failure that matters for a replacement: a model whose skeleton and mesh live
// in different scales, which mounts at the wrong height and is then rejected by the runtime gate
// (the fighter silently keeps its procedural body). Output is MOUNT:{json} with the verdict.
import './glb-node-compat.mjs';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mountImportedCharacter } from '../public/js/fighter_model_placement.js';
import { validateFighterRig, describeRigValidation } from '../public/js/rig_validation.js';

globalThis.self ||= globalThis;

const file = process.argv[2];
if (!file) {
  console.log('MOUNT:' + JSON.stringify({ ok: false, error: 'usage: node scripts/check-import-mount.mjs <model.glb>' }));
  process.exit(0);
}

const buffer = readFileSync(file);
const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const gltf = await new Promise((ok, bad) => new GLTFLoader().parse(data, './', ok, bad));
const root = gltf.scene;

// Mirror the joint binding human_fighter.js performs before the gate runs, so the verdict matches
// the real runtime rather than a weaker test.
const joints = {};
let boneCount = 0;
root.traverse(node => {
  if (!node.isBone) return;
  boneCount++;
  const raw = String(node.name || '').toLowerCase();
  const compact = raw.replace(/[^a-z0-9]/g, '');
  const left = compact.includes('left') || /(?:^|[._:\-\s])l(?:$|[._:\-\s])/.test(raw);
  const right = compact.includes('right') || /(?:^|[._:\-\s])r(?:$|[._:\-\s])/.test(raw);
  const side = left ? 'L' : right ? 'R' : '';
  if (/arm|shoulder|clavicle|elbow|wrist|hand|palm|finger|thumb/.test(compact) && side && !/roll/.test(compact)) {
    const part = (/hand|wrist|palm|finger|thumb/.test(compact) ? 'hand'
      : /forearm|lowerarm|elbow/.test(compact) ? 'forearm'
        : /shoulder|clavicle/.test(compact) ? 'shoulder' : 'arm') + side;
    joints[part] ||= node;
  }
  if (/thigh|upperleg|upleg/.test(compact) && side) joints['leg' + side] ||= node;
  if (/spine|chest/.test(compact)) joints.torso ||= node;
  if (/hips|pelvis/.test(compact)) joints.pelvis ||= node;
  if (/head|neck/.test(compact)) joints.head ||= node;
});

// Measure the untouched file in its own hierarchy BEFORE mounting. Without this the scene graph's
// matrices are still identity, and the reported source height belongs to a different coordinate
// space than the one the placement scale is derived from - which is how this checker reported a
// 0.361 m body for a 1.80 m file and rejected models that mount perfectly in the game.
root.updateMatrixWorld(true);
const rawBox = new THREE.Box3().setFromObject(root);
const rawSize = rawBox.getSize(new THREE.Vector3());

const stand = new THREE.Group();
const { holder, placement } = mountImportedCharacter(root, stand, { facing: 1, facingZ: 0 });
holder.userData.pelvis = joints.pelvis || null;
holder.userData.head = joints.head || null;
holder.userData.leftLeg = joints.legL || null;
holder.userData.rightLeg = joints.legR || null;
holder.userData.leftArm = joints.armL || null;
holder.userData.rightArm = joints.armR || null;
holder.updateMatrixWorld(true);

const validation = validateFighterRig(holder, { ground: holder.position.y, requireJoints: false });
const hipY = joints.legL ? joints.legL.getWorldPosition(new THREE.Vector3()).y : null;
const result = {
  ok: validation.ok,
  file,
  bones: boneCount,
  joints: Object.keys(joints),
  clips: (gltf.animations || []).map(clip => clip.name),
  rawHeight: +rawSize.y.toFixed(3),
  rawMinY: +rawBox.min.y.toFixed(3),
  placement,
  hipJointHeight: hipY === null ? null : +hipY.toFixed(2),
  verdict: describeRigValidation(validation),
  issues: validation.issues,
  metrics: validation.metrics
};
console.log('MOUNT:' + JSON.stringify(result));
process.exit(validation.ok ? 0 : 1);
