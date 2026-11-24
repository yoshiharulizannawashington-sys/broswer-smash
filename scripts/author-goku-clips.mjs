#!/usr/bin/env node
/**
 * Author Goku's motion on the real 73-joint body.
 *
 * WHY THIS EXISTS
 * ---------------
 * The previous clip authoring keyed 19 joints with hand-guessed local Euler angles. On this rig the
 * arm bones are not aligned so that +X always means "punch forward", so several clips technically had
 * 20 tracks while the actual hands stayed behind the torso. It also keyed only 20 joints, and the
 * legacy runtime layered those clips over idle, so attacks never owned the body.
 *
 * This authoring pass works in the opposite direction. It places hands and feet where they need to
 * be in model space, then solves two-bone IK against the real skeleton:
 *
 *   - shoulders / elbows / wrists and hips / knees / ankles are solved from target positions
 *   - torso, neck and head keep expressive local rotations
 *   - every one of the body's joints is keyed in every clip, including clavicles, fingers and toes,
 *     so a strike cannot inherit a frozen arm or a walking leg from an unrelated layer
 *   - feet are solved to planted ankle positions and a level sole, not left to the leg rotation
 *   - every pose is sampled at a stable cadence so accelerations and follow-through exist in the
 *     curves rather than appearing as a single teleporting "contact" key
 *
 * No geometry, skin weights, inverse bind matrices, textures or materials are modified. The output
 * is a clip-only GLB, which the existing runtime binds by node name at runtime.
 *
 *   node scripts/author-goku-clips.mjs [--out public/models/characters/bespoke/goku_animated.glb]
 */
import './glb-node-compat.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

globalThis.self ||= globalThis;

const BODY = 'public/models/characters/bespoke/goku_body_face_rigged.glb';
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1] : 'public/models/characters/bespoke/goku_animated.glb';
const DEG = Math.PI / 180;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const load = file => new Promise((ok, bad) => {
  const buffer = readFileSync(file);
  new GLTFLoader().parse(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), './', ok, bad
  );
});

const gltf = await load(BODY);
const scene = gltf.scene;
scene.updateMatrixWorld(true);

const bones = [];
const byName = new Map();
const rest = new Map();
scene.traverse(node => {
  if (!node.isBone) return;
  bones.push(node);
  byName.set(node.name, node);
  rest.set(node, {
    position: node.position.clone(),
    quaternion: node.quaternion.clone(),
    scale: node.scale.clone()
  });
});
const boneNames = bones.map(bone => bone.name);

// The body source expresses its transforms as matrices. GLTFLoader has already decomposed them to
// local TRS. Capture the local values once so every solved pose can start from the true bind pose.
const hips = byName.get('Hips');
const hipsRestWorld = hips.getWorldPosition(new THREE.Vector3());
const hipsParent = hips.parent;
const hipsParentWorldQuat = new THREE.Quaternion().copy(hipsParent.getWorldQuaternion(new THREE.Quaternion()));
const hipsUpLocal = new THREE.Vector3(0, 1, 0).applyQuaternion(hipsParentWorldQuat.clone().invert()).normalize();

const restFootQuat = byName.get('LeftFoot').getWorldQuaternion(new THREE.Quaternion());
const restRightFootQuat = byName.get('RightFoot').getWorldQuaternion(new THREE.Quaternion());

// Finger chains, grouped by hand. The body has five articulated chains per hand, so a fist is real
// joint motion rather than a hand-scale trick.
const leftFingers = boneNames.filter(name => name.startsWith('DEF_FingerL') && !name.endsWith('_end'));
const rightFingers = boneNames.filter(name => name.startsWith('DEF_FingerR') && !name.endsWith('_end'));
const toeBones = ['DEF_ToeL_049', 'DEF_ToeR_054'].filter(name => byName.has(name));

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const smooth = t => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

function resetPose() {
  for (const bone of bones) {
    const bind = rest.get(bone);
    bone.position.copy(bind.position);
    bone.quaternion.copy(bind.quaternion);
    bone.scale.copy(bind.scale);
  }
  scene.updateMatrixWorld(true);
}

function setLocalEuler(bone, [x, y, z]) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x * DEG, y * DEG, z * DEG, 'XYZ'));
  bone.quaternion.copy(rest.get(bone).quaternion).multiply(q);
}

/** Rotate a bone so its child points at a world-space target. Keeps bone roll stable. */
function aimBone(bone, child, target) {
  scene.updateMatrixWorld(true);
  const origin = bone.getWorldPosition(new THREE.Vector3());
  const current = child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
  const desired = target.clone().sub(origin).normalize();
  if (current.lengthSq() < 1e-8 || desired.lengthSq() < 1e-8) return;
  const delta = new THREE.Quaternion().setFromUnitVectors(current, desired);
  const currentWorld = bone.getWorldQuaternion(new THREE.Quaternion());
  const wantedWorld = delta.multiply(currentWorld);
  const parentWorld = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parentWorld.invert().multiply(wantedWorld));
  scene.updateMatrixWorld(true);
}

/** Analytical two-bone solve: returns the elbow/knee position on the side of `pole`. */
function solveTwoBone(root, target, pole, upperLength, lowerLength) {
  const reach = upperLength + lowerLength;
  const toTarget = target.clone().sub(root);
  let distance = toTarget.length();
  if (distance < 1e-5) distance = 1e-5;
  const direction = toTarget.clone().multiplyScalar(1 / distance);
  const solvedDistance = clamp(distance, Math.abs(upperLength - lowerLength) + 0.002, reach - 0.002);
  const along = (solvedDistance * solvedDistance + upperLength * upperLength - lowerLength * lowerLength)
    / (2 * solvedDistance);
  const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
  const poleDirection = pole.clone().sub(root);
  poleDirection.addScaledVector(direction, -poleDirection.dot(direction));
  if (poleDirection.lengthSq() < 1e-7) poleDirection.set(0, 1, 0);
  poleDirection.normalize();
  return root.clone()
    .addScaledVector(direction, along)
    .addScaledVector(poleDirection, height);
}

/**
 * A pose spec is deliberately positional, not angular: the author says where the hands, elbows,
 * ankles and knees go. The solver owns joint axes and bone roll.
 */
function stance(overrides = {}) {
  const base = {
    lift: -0.075,
    hips: [0, 0, 0], spine: [3, 0, 0], chest: [2, 0, 0], neck: [-3, 0, 0], head: [-2, 0, 0],
    shoulders: [[0, 0, -3], [0, 0, 3]],
    hands: [[0.235, 1.315, 0.255], [-0.225, 1.35, 0.19]],
    elbows: [[0.32, 1.045, 0.10], [-0.32, 1.06, 0.08]],
    wrists: [[0, 0, -14], [0, 0, 14]],
    feet: [[0.18, 0.05, 0.07], [-0.18, 0.05, -0.075]],
    feetRot: [[0, 8, 0], [0, -12, 0]],
    knees: [[0.21, 0.53, 0.43], [-0.21, 0.53, 0.43]],
    fingers: 0.95,
    toes: 0
  };
  const merged = { ...base, ...overrides };
  for (const key of ['hips', 'spine', 'chest', 'neck', 'head', 'shoulders', 'hands', 'elbows',
    'wrists', 'feet', 'feetRot', 'knees']) {
    if (overrides[key]) merged[key] = overrides[key];
  }
  return merged;
}

function cloneSpec(spec) {
  return {
    ...spec,
    hips: [...spec.hips], spine: [...spec.spine], chest: [...spec.chest],
    neck: [...spec.neck], head: [...spec.head],
    shoulders: [spec.shoulders[0].slice(), spec.shoulders[1].slice()],
    hands: [spec.hands[0].slice(), spec.hands[1].slice()],
    elbows: [spec.elbows[0].slice(), spec.elbows[1].slice()],
    wrists: [spec.wrists[0].slice(), spec.wrists[1].slice()],
    feet: [spec.feet[0].slice(), spec.feet[1].slice()],
    feetRot: [spec.feetRot[0].slice(), spec.feetRot[1].slice()],
    knees: [spec.knees[0].slice(), spec.knees[1].slice()]
  };
}

function lerpValue(a, b, t) {
  if (Array.isArray(a)) return a.map((value, index) => lerpValue(value, b[index], t));
  return a + (b - a) * t;
}
function lerpSpec(a, b, t) {
  const out = cloneSpec(a);
  for (const key of Object.keys(a)) out[key] = lerpValue(a[key], b[key], t);
  return out;
}

/** A cycle sampled at a fixed cadence; the actual clip curve is these solved poses. */
function cycle(duration, count, specFn) {
  return Array.from({ length: count }, (_, index) => {
    const t = index / (count - 1);
    return { time: +(t * duration).toFixed(4), spec: specFn(t) };
  });
}

/** A pose timeline sampled at a fixed cadence between authored beats. */
function timeline(duration, count, beats, ease = smooth) {
  const sorted = beats.slice().sort((a, b) => a.time - b.time);
  return Array.from({ length: count }, (_, index) => {
    const time = duration * index / (count - 1);
    let left = sorted[0], right = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length - 1; i++) {
      if (time >= sorted[i].time && time <= sorted[i + 1].time) {
        left = sorted[i]; right = sorted[i + 1]; break;
      }
    }
    const span = Math.max(1e-5, right.time - left.time);
    const local = ease((time - left.time) / span);
    return { time: +time.toFixed(4), spec: lerpSpec(left.spec, right.spec, local) };
  });
}

/**
 * Solve one spec into a full-body joint snapshot.
 *
 * Steps: reset -> hips translation -> spine/chest/neck/head -> clavicles -> leg IK -> arm IK ->
 * level feet -> hand/wrist -> finger curl -> toes. The order matters because each child solution
 * uses the world transform of its parent.
 */
function solve(spec) {
  resetPose();
  const hipsBone = hips;
  hipsBone.position.copy(rest.get(hipsBone).position).addScaledVector(hipsUpLocal, spec.lift);
  setLocalEuler(hipsBone, spec.hips);
  setLocalEuler(byName.get('Spine'), spec.spine);
  setLocalEuler(byName.get('Chest'), spec.chest);
  setLocalEuler(byName.get('Neck'), spec.neck);
  setLocalEuler(byName.get('Head'), spec.head);
  setLocalEuler(byName.get('LeftShoulder'), spec.shoulders[0]);
  setLocalEuler(byName.get('RightShoulder'), spec.shoulders[1]);
  scene.updateMatrixWorld(true);

  const yaw = ((spec.hips[1] + spec.spine[1] * 0.55 + spec.chest[1] * 0.35) * DEG);
  const pitch = ((spec.hips[0] + spec.spine[0] * 0.45 + spec.chest[0] * 0.25) * DEG);
  const bodyQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  const hipsWorld = hipsBone.getWorldPosition(new THREE.Vector3());
  const chestWorld = byName.get('Chest').getWorldPosition(new THREE.Vector3());

  // ---- legs ---------------------------------------------------------------------------------
  const legData = {
    Left: { hip: 'LeftUpLeg', knee: 'LeftLeg', ankle: 'LeftFoot', upper: 'LeftLeg', lower: 'LeftFoot' },
    Right: { hip: 'RightUpLeg', knee: 'RightLeg', ankle: 'RightFoot', upper: 'RightLeg', lower: 'RightFoot' }
  };
  for (const [side, index] of [['Left', 0], ['Right', 1]]) {
    const data = legData[side];
    const hipBone = byName.get(data.hip);
    const kneeBone = byName.get(data.knee);
    const ankleBone = byName.get(data.ankle);
    const hipPos = hipBone.getWorldPosition(new THREE.Vector3());
    const target = new THREE.Vector3(
      hipsWorld.x + spec.feet[index][0],
      spec.feet[index][1],
      hipsWorld.z + spec.feet[index][2]
    );
    const pole = new THREE.Vector3(
      hipsWorld.x + spec.knees[index][0],
      spec.knees[index][1],
      hipsWorld.z + spec.knees[index][2]
    );
    const upperLength = kneeBone.position.length();
    const lowerLength = ankleBone.position.length();
    const kneePos = solveTwoBone(hipPos, target, pole, upperLength, lowerLength);
    aimBone(hipBone, kneeBone, kneePos);
    aimBone(kneeBone, ankleBone, target);
    // Level the sole. A solved leg otherwise inherits its parent's roll and the boot points sideways.
    const foot = byName.get(data.ankle);
    const footParentWorld = foot.parent.getWorldQuaternion(new THREE.Quaternion());
    const restWorld = side === 'Left' ? restFootQuat : restRightFootQuat;
    const [footPitch, footYaw, footRoll] = spec.feetRot[index];
    const desiredFootWorld = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(footPitch * DEG, footYaw * DEG, footRoll * DEG, 'YXZ'))
      .multiply(restWorld);
    foot.quaternion.copy(footParentWorld.invert().multiply(desiredFootWorld));
    scene.updateMatrixWorld(true);
  }

  // ---- arms ---------------------------------------------------------------------------------
  for (const [side, index] of [['Left', 0], ['Right', 1]]) {
    const shoulder = byName.get(side + 'Shoulder');
    const upper = byName.get(side + 'Arm');
    const forearm = byName.get(side + 'ForeArm');
    const hand = byName.get(side + 'Hand');
    if (!upper || !forearm || !hand) continue;
    const shoulderPos = upper.getWorldPosition(new THREE.Vector3());
    // Target heights are authored against the grounded stance. When the hips lift for a jump,
    // hover or flight, the shoulders lift with them; keeping the old absolute hand height would
    // leave the arms hanging below the chest. Carry the lift into both hand and elbow targets.
    const liftOffset = spec.lift + 0.075;
    const offset = new THREE.Vector3(...spec.hands[index]).applyQuaternion(bodyQuat);
    const target = new THREE.Vector3(
      chestWorld.x + offset.x, spec.hands[index][1] + liftOffset, chestWorld.z + offset.z
    );
    const elbowOffset = new THREE.Vector3(...spec.elbows[index]).applyQuaternion(bodyQuat);
    const pole = new THREE.Vector3(
      chestWorld.x + elbowOffset.x, spec.elbows[index][1] + liftOffset, chestWorld.z + elbowOffset.z
    );
    const upperLength = forearm.position.length();
    const lowerLength = hand.position.length();
    const elbow = solveTwoBone(shoulderPos, target, pole, upperLength, lowerLength);
    aimBone(upper, forearm, elbow);
    aimBone(forearm, hand, target);
    // A small wrist correction keeps the palm/fist from pointing along the forearm like a stick.
    const wrist = byName.get(side + 'Hand');
    const wristDelta = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      spec.wrists[index][0] * DEG, spec.wrists[index][1] * DEG, spec.wrists[index][2] * DEG, 'XYZ'
    ));
    wrist.quaternion.multiply(wristDelta);
    scene.updateMatrixWorld(true);
  }

  const fingerNames = [...leftFingers, ...rightFingers];
  const curl = clamp(spec.fingers, 0, 1) * 65 * DEG;
  for (const name of fingerNames) {
    const bone = byName.get(name);
    if (!bone) continue;
    // The knuckle chains run along local Y and bend around local X, the same convention as the
    // generic fist pose. A Z rotation splayed the fingers sideways instead of closing them.
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-curl, 0, 0, 'XYZ'));
    bone.quaternion.multiply(q);
  }
  const toeAngle = clamp(spec.toes, 0, 1) * 38 * DEG;
  for (const name of toeBones) {
    const toe = byName.get(name);
    if (toe) toe.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-toeAngle, 0, 0, 'XYZ')));
  }
  scene.updateMatrixWorld(true);

  const snapshot = {
    quaternions: new Map(),
    hipsPosition: hipsBone.position.clone()
  };
  for (const bone of bones) snapshot.quaternions.set(bone.name, bone.quaternion.clone());
  return snapshot;
}

// ---------------------------------------------------------------- clip catalogue
const CLIPS = {};

function addClip(name, duration, loop, keys, extras = {}) {
  CLIPS[name] = { duration, loop, keys, ...extras };
}

function idleSpec(t) {
  const phase = t * Math.PI * 2;
  const breathe = Math.sin(phase);
  const shift = Math.sin(phase * 0.5);
  const s = stance({
    lift: -0.075 + breathe * 0.008,
    hips: [0, shift * 1.2, 0],
    spine: [3 + breathe * 1.6, -shift * 1.4, 0],
    chest: [2 + breathe * 2.2, -shift * 0.8, 0],
    neck: [-3 - breathe * 1.1, shift * 1.8, 0],
    head: [-2 - breathe * 0.8, shift * 3.6, 0],
    hands: [[0.235 + breathe * 0.005, 1.315 + breathe * 0.006, 0.255 + breathe * 0.009],
      [-0.225 - breathe * 0.004, 1.35 - breathe * 0.005, 0.19 + breathe * 0.011]],
    elbows: [
      [0.32 + breathe * 0.006, 1.045 + breathe * 0.005, 0.10],
      [-0.32 - breathe * 0.006, 1.06 + breathe * 0.005, 0.08]
    ]
  });
  s.fingers = 0.96;
  return s;
}
addClip('Goku_Idle', 2.0, true, cycle(2.0, 17, idleSpec));

function walkSpec(t) {
  const phase = t * Math.PI * 2;
  const swing = Math.sin(phase);
  const leftLift = Math.max(0, Math.sin(phase)) * 0.13;
  const rightLift = Math.max(0, -Math.sin(phase)) * 0.13;
  const leftForward = swing * 0.30;
  const rightForward = -swing * 0.30;
  // Arms swing opposite the legs. The previous same-side swing plus chest-high hands read as a
  // guarded shuffle: the hands never left the guard and moved with the same leg that stepped.
  const armSwing = swing * 0.24;
  return stance({
    lift: -0.082 + Math.abs(Math.sin(phase * 2)) * 0.016,
    hips: [3, Math.sin(phase) * 7, 0],
    spine: [4, -Math.sin(phase) * 6, Math.sin(phase) * 2.2],
    chest: [2, Math.sin(phase) * 3, -Math.sin(phase) * 1.4],
    neck: [-4, Math.sin(phase) * 4.5, 0],
    head: [-2, Math.sin(phase) * 3.0, 0],
    hands: [
      [0.235 + Math.sin(phase) * 0.012, 1.02, 0.04 - armSwing],
      [-0.225 + Math.sin(phase) * 0.012, 1.02, 0.04 + armSwing]
    ],
    elbows: [
      [0.32, 1.12, -armSwing * 0.45], [-0.32, 1.12, armSwing * 0.45]
    ],
    feet: [
      [0.18 + Math.sin(phase) * 0.012, 0.05 + leftLift, leftForward],
      [-0.18 + Math.sin(phase) * 0.012, 0.05 + rightLift, rightForward]
    ],
    feetRot: [[leftLift > 0.02 ? -24 : 5, 5 + swing * 7, 0], [rightLift > 0.02 ? -24 : 5, -5 - swing * 7, 0]],
    knees: [[0.22, 0.56, 0.42 + leftForward * 0.8], [-0.22, 0.56, 0.42 + rightForward * 0.8]],
    toes: 0.18
  });
}
addClip('Goku_Walk', 0.8, true, cycle(0.8, 19, walkSpec));

function runSpec(t) {
  const phase = t * Math.PI * 2;
  const swing = Math.sin(phase);
  const leftLift = Math.max(0, Math.sin(phase)) * 0.34;
  const rightLift = Math.max(0, -Math.sin(phase)) * 0.34;
  const leftForward = swing * 0.46;
  const rightForward = -swing * 0.46;
  // Both feet leave the floor at the crossing point. Without this the run kept one foot planted
  // through the whole cycle and read as a fast walk.
  const flight = Math.max(0, Math.cos(phase * 2)) * 0.07;
  return stance({
    lift: -0.11 + Math.abs(Math.sin(phase * 2)) * 0.06,
    hips: [20, Math.sin(phase) * 13, 0],
    spine: [14, -Math.sin(phase) * 10, Math.sin(phase) * 3.5],
    chest: [6, Math.sin(phase) * 4, 0],
    neck: [-16, Math.sin(phase) * 5, 0],
    head: [-6, Math.sin(phase) * 2, 0],
    hands: [
      [0.235 + swing * 0.016, 1.02 + Math.max(0, -swing) * 0.12, 0.04 - swing * 0.34],
      [-0.225 - swing * 0.016, 1.02 + Math.max(0, swing) * 0.12, 0.04 + swing * 0.34]
    ],
    elbows: [
      [0.32, 1.12, -swing * 0.14], [-0.32, 1.12, swing * 0.14]
    ],
    feet: [
      [0.17, 0.05 + leftLift + flight, leftForward],
      [-0.17, 0.05 + rightLift + flight, rightForward]
    ],
    feetRot: [[leftLift > 0.04 ? -34 : 8, 6 + swing * 10, 0], [rightLift > 0.04 ? -34 : 8, -6 - swing * 10, 0]],
    knees: [[0.19, 0.58, 0.64 + leftForward * 0.85], [-0.19, 0.58, 0.64 + rightForward * 0.85]],
    toes: 0.4
  });
}
addClip('Goku_Run', 0.5, true, cycle(0.5, 17, runSpec));

addClip('Goku_Turn', 0.45, false, timeline(0.45, 11, [
  { time: 0, spec: stance({ hips: [0, 0, 0], spine: [4, -6, 0], chest: [2, -3, 0], head: [-2, 6, 0] }) },
  { time: 0.16, spec: stance({ hips: [0, 22, 0], spine: [6, 14, 0], chest: [3, 8, 0], head: [-2, -8, 0],
    feet: [[0.17, 0.07, 0.03], [-0.17, 0.05, -0.03]], feetRot: [[0, 24, 0], [0, 2, 0]] }) },
  { time: 0.3, spec: stance({ hips: [0, 42, 0], spine: [5, 16, 0], chest: [2, 9, 0], head: [-2, -16, 0],
    feet: [[0.17, 0.05, 0.05], [-0.17, 0.05, -0.05]], feetRot: [[0, 40, 0], [0, 22, 0]] }) },
  { time: 0.45, spec: stance({ hips: [0, 38, 0], spine: [4, 10, 0], chest: [2, 5, 0], head: [-2, -8, 0],
    feetRot: [[0, 34, 0], [0, 22, 0]] }) }
]));

// ---- airborne / flight -----------------------------------------------------------------------
addClip('Goku_Jump', 0.5, false, timeline(0.5, 14, [
  { time: 0, spec: stance({ lift: -0.075 }) },
  { time: 0.09, spec: stance({ lift: -0.20, hips: [8, 0, 0], spine: [15, 0, 0], chest: [6, 0, 0],
    hands: [[0.18, 1.06, 0.20], [-0.18, 1.08, 0.18]], elbows: [[0.50, 0.86, 0.10], [-0.50, 0.86, 0.10]],
    feet: [[0.18, 0.05, 0.02], [-0.18, 0.05, -0.02]], knees: [[0.22, 0.42, 0.38], [-0.22, 0.42, 0.38]] }) },
  { time: 0.20, spec: stance({ lift: 0.16, hips: [-4, 0, 0], spine: [-4, 0, 0], chest: [-2, 0, 0],
    hands: [[0.20, 1.40, 0.12], [-0.20, 1.42, 0.10]], elbows: [[0.44, 1.18, 0.02], [-0.44, 1.18, 0.02]],
    feet: [[0.16, 0.12, 0.02], [-0.16, 0.12, -0.02]], feetRot: [[30, 0, 0], [30, 0, 0]] }) },
  { time: 0.32, spec: stance({ lift: 0.46, hips: [4, 0, 0], spine: [8, 0, 0], chest: [4, 0, 0],
    hands: [[0.19, 1.35, 0.18], [-0.19, 1.37, 0.16]], elbows: [[0.44, 1.15, 0.06], [-0.44, 1.15, 0.06]],
    feet: [[0.18, 0.35, 0.12], [-0.18, 0.38, -0.02]], feetRot: [[-26, 0, 0], [-22, 0, 0]],
    knees: [[0.24, 0.68, 0.44], [-0.24, 0.68, 0.44]] }) },
  { time: 0.5, spec: stance({ lift: 0.38, hips: [2, 0, 0], spine: [4, 0, 0], chest: [2, 0, 0],
    hands: [[0.18, 1.28, 0.22], [-0.18, 1.30, 0.20]], feet: [[0.18, 0.28, 0.10], [-0.18, 0.30, -0.04]],
    feetRot: [[-18, 0, 0], [-16, 0, 0]] }) }
]));

addClip('Goku_DoubleJump', 0.55, false, timeline(0.55, 15, [
  { time: 0, spec: stance({ lift: 0.18, feet: [[0.18, 0.22, 0.08], [-0.18, 0.24, -0.04]],
    feetRot: [[-16, 0, 0], [-14, 0, 0]], hands: [[0.18, 1.30, 0.20], [-0.18, 1.32, 0.18]] }) },
  { time: 0.16, spec: stance({ lift: 0.30, hips: [8, 0, 0], spine: [14, 0, 0], chest: [7, 0, 0],
    hands: [[0.18, 1.12, 0.20], [-0.18, 1.14, 0.18]], elbows: [[0.48, 0.92, 0.10], [-0.48, 0.92, 0.10]],
    feet: [[0.17, 0.40, 0.05], [-0.17, 0.42, -0.02]], knees: [[0.22, 0.72, 0.40], [-0.22, 0.72, 0.40]] }) },
  { time: 0.3, spec: stance({ lift: 0.54, hips: [0, 68, 0], spine: [8, 20, 0], chest: [4, 12, 0],
    hands: [[0.18, 1.26, 0.24], [-0.18, 1.28, 0.22]], feet: [[0.16, 0.48, 0.14], [-0.16, 0.50, -0.02]],
    feetRot: [[-80, 0, 0], [-80, 0, 0]] }) },
  { time: 0.42, spec: stance({ lift: 0.50, hips: [0, 118, 0], spine: [6, 16, 0], chest: [3, 8, 0],
    hands: [[0.18, 1.30, 0.22], [-0.18, 1.32, 0.20]], feet: [[0.16, 0.38, 0.10], [-0.16, 0.40, -0.04]],
    feetRot: [[-60, 0, 0], [-60, 0, 0]] }) },
  { time: 0.55, spec: stance({ lift: 0.40, hips: [0, 150, 0], spine: [4, 8, 0], chest: [2, 4, 0],
    hands: [[0.18, 1.28, 0.22], [-0.18, 1.30, 0.20]], feet: [[0.18, 0.30, 0.08], [-0.18, 0.32, -0.04]] }) }
]));

addClip('Goku_Fall', 0.9, true, cycle(0.9, 15, t => {
  const phase = t * Math.PI * 2;
  const sway = Math.sin(phase);
  return stance({
    lift: 0.34 + sway * 0.015,
    hips: [4, sway * 4, 0], spine: [-2, -sway * 3, sway * 2], chest: [-2, sway * 2, 0],
    neck: [4, sway * 3, 0], head: [3, sway * 4, 0],
    hands: [[0.24 + sway * 0.015, 1.30, 0.10], [-0.24 + sway * 0.015, 1.32, 0.08]],
    elbows: [[0.48, 1.04, 0.02], [-0.48, 1.04, 0.02]],
    feet: [[0.17, 0.34 + sway * 0.01, 0.10], [-0.17, 0.30 - sway * 0.01, -0.08]],
    feetRot: [[-20, 0, 0], [-16, 0, 0]],
    knees: [[0.22, 0.68, 0.44], [-0.22, 0.68, 0.44]]
  });
}));

addClip('Goku_Land', 0.35, false, timeline(0.35, 11, [
  { time: 0, spec: stance({ lift: 0.18, feet: [[0.18, 0.22, 0.08], [-0.18, 0.24, -0.04]],
    feetRot: [[-16, 0, 0], [-14, 0, 0]] }) },
  { time: 0.08, spec: stance({ lift: -0.22, hips: [10, 0, 0], spine: [20, 0, 0], chest: [8, 0, 0],
    hands: [[0.22, 1.04, 0.26], [-0.22, 1.06, 0.24]], elbows: [[0.52, 0.84, 0.16], [-0.52, 0.84, 0.16]],
    feet: [[0.20, 0.05, 0.02], [-0.20, 0.05, -0.02]], knees: [[0.25, 0.40, 0.42], [-0.25, 0.40, 0.42]] }) },
  { time: 0.2, spec: stance({ lift: -0.13, hips: [4, 0, 0], spine: [10, 0, 0], chest: [5, 0, 0],
    hands: [[0.18, 1.15, 0.24], [-0.18, 1.17, 0.22]], feet: [[0.18, 0.05, 0.03], [-0.18, 0.05, -0.03]] }) },
  { time: 0.35, spec: stance() }
]));

function hoverSpec(t) {
  const phase = t * Math.PI * 2;
  const drift = Math.sin(phase);
  return stance({
    lift: 0.40 + drift * 0.018,
    hips: [5, drift * 5, 0], spine: [-6, -drift * 4, drift * 2], chest: [-3, drift * 2, 0],
    neck: [6, drift * 4, 0], head: [4, drift * 5, 0],
    hands: [[0.30, 1.36, 0.08], [-0.30, 1.38, 0.06]],
    elbows: [[0.50, 1.08, 0.04], [-0.50, 1.08, 0.04]],
    feet: [[0.18, 0.78 + drift * 0.012, 0.18], [-0.18, 0.81 - drift * 0.012, 0.10]],
    feetRot: [[-38, 0, 0], [-42, 0, 0]],
    knees: [[0.26, 1.22, 0.30], [-0.26, 1.22, 0.30]],
    // Flight carries clenched fists. The half-curl read as splayed claws at chest height in the
    // live FlyForward frame; the final finger correction is just as valid in the air.
    fingers: 1
  });
}
addClip('Goku_Hover', 1.4, true, cycle(1.4, 17, hoverSpec));
addClip('Goku_FlyForward', 0.7, true, cycle(0.7, 15, t => {
  const s = hoverSpec(t);
  s.hips = [18, Math.sin(t * Math.PI * 2) * 4, 0];
  s.spine = [24, -Math.sin(t * Math.PI * 2) * 3, 0];
  s.chest = [6, 0, 0];
  s.neck = [-22, 0, 0];
  s.head = [-12, 0, 0];
  s.hands = [[0.24, 1.28, 0.02], [-0.24, 1.30, 0.0]];
  s.feet = [[0.16, 0.24, -0.12], [-0.16, 0.26, -0.14]];
  return s;
}));
addClip('Goku_FlyBack', 0.7, true, cycle(0.7, 15, t => {
  const s = hoverSpec(t);
  s.hips = [-12, Math.sin(t * Math.PI * 2) * 3, 0];
  s.spine = [-16, 0, 0];
  s.chest = [-6, 0, 0];
  s.neck = [14, 0, 0];
  s.head = [8, 0, 0];
  s.hands = [[0.26, 1.30, 0.18], [-0.26, 1.32, 0.16]];
  s.feet = [[0.17, 0.28, 0.18], [-0.17, 0.30, 0.16]];
  return s;
}));
addClip('Goku_FlyTurn', 0.8, true, cycle(0.8, 15, t => {
  const s = hoverSpec(t);
  const phase = t * Math.PI * 2;
  s.hips = [4, Math.sin(phase) * 26, 0];
  s.spine = [2, Math.sin(phase) * 14, Math.cos(phase) * 6];
  s.chest = [2, Math.sin(phase) * 7, 0];
  s.head = [0, -Math.sin(phase) * 14, 0];
  s.feet = [[0.18, 0.30, 0.04], [-0.18, 0.32, 0.02]];
  return s;
}));
addClip('Goku_FlyTakeoff', 0.6, false, timeline(0.6, 15, [
  { time: 0, spec: stance({ lift: -0.12, hips: [6, 0, 0], spine: [12, 0, 0] }) },
  { time: 0.16, spec: stance({ lift: -0.20, hips: [12, 0, 0], spine: [18, 0, 0], chest: [8, 0, 0],
    hands: [[0.20, 1.06, 0.22], [-0.20, 1.08, 0.20]] }) },
  { time: 0.34, spec: stance({ lift: 0.24, hips: [-4, 0, 0], spine: [-4, 0, 0], chest: [-2, 0, 0],
    hands: [[0.28, 1.38, 0.06], [-0.28, 1.40, 0.04]], feet: [[0.16, 0.20, 0.02], [-0.16, 0.20, -0.02]],
    feetRot: [[-20, 0, 0], [-20, 0, 0]] }) },
  { time: 0.6, spec: hoverSpec(0) }
]));
addClip('Goku_FlyLand', 0.7, false, timeline(0.7, 15, [
  { time: 0, spec: hoverSpec(0) },
  { time: 0.24, spec: stance({ lift: 0.22, hips: [8, 0, 0], spine: [8, 0, 0], chest: [4, 0, 0],
    hands: [[0.24, 1.22, 0.18], [-0.24, 1.24, 0.16]],
    feet: [[0.18, 0.18, 0.02], [-0.18, 0.18, -0.02]], feetRot: [[-10, 0, 0], [-10, 0, 0]] }) },
  { time: 0.42, spec: stance({ lift: -0.18, hips: [8, 0, 0], spine: [16, 0, 0], chest: [7, 0, 0],
    feet: [[0.19, 0.05, 0.02], [-0.19, 0.05, -0.02]], knees: [[0.24, 0.42, 0.42], [-0.24, 0.42, 0.42]] }) },
  { time: 0.7, spec: stance() }
]));

// ---- strikes ---------------------------------------------------------------------------------
// The hand path is authored as a spatial target. The elbow pole is authored too, so the elbow leads
// and trails the fist instead of collapsing into the chest or locking straight.
const guard = () => stance();
function strike(side, target, overrides = {}) {
  const index = side === 'L' ? 0 : 1;
  const s = stance(overrides);
  s.hands[index] = target;
  s.fingers = 0.95;
  return s;
}

addClip('Goku_Jab', 0.34, false, timeline(0.34, 13, [
  { time: 0, spec: guard() },
  { time: 0.055, spec: stance({ hips: [0, -9, 0], spine: [4, -8, 0], chest: [2, -5, 0],
    hands: [[0.18, 1.33, 0.17], [-0.20, 1.34, 0.10]], elbows: [[0.29, 1.05, 0.06], [-0.30, 1.08, 0.0]],
    fingers: 0.96 }) },
  { time: 0.13, spec: strike('R', [-0.015, 1.35, 0.64], {
    lift: -0.11, hips: [0, 28, 0], spine: [8, 18, 0], chest: [4, 10, 0],
    head: [-1, -12, 0],
    hands: [[0.20, 1.36, 0.07], [-0.015, 1.35, 0.64]],
    elbows: [[0.31, 1.10, 0.03], [-0.29, 1.09, 0.28]],
    feet: [[0.18, 0.05, 0.13], [-0.18, 0.105, -0.075]],
    feetRot: [[0, 8, 0], [26, -12, 0]], toes: 0.45
  })} ,
  { time: 0.21, spec: strike('R', [-0.035, 1.33, 0.50], {
    lift: -0.09, hips: [0, 20, 0], spine: [6, 11, 0], chest: [3, 6, 0],
    hands: [[0.15, 1.37, 0.10], [-0.035, 1.33, 0.50]],
    elbows: [[0.28, 1.10, 0.04], [-0.31, 1.06, 0.18]],
    feet: [[0.18, 0.05, 0.10], [-0.18, 0.07, -0.07]], feetRot: [[0, 8, 0], [14, -12, 0]]
  }) },
  { time: 0.34, spec: guard() }
]));

addClip('Goku_Cross', 0.4, false, timeline(0.4, 14, [
  { time: 0, spec: guard() },
  { time: 0.07, spec: stance({ hips: [0, 14, 0], spine: [4, 10, 0], chest: [2, 6, 0],
    hands: [[0.20, 1.34, 0.10], [-0.18, 1.33, 0.17]], elbows: [[0.30, 1.08, 0.0], [-0.29, 1.05, 0.06]],
    fingers: 0.96 }) },
  { time: 0.17, spec: strike('L', [0.015, 1.36, 0.66], {
    lift: -0.12, hips: [0, -32, 0], spine: [8, -21, 0], chest: [4, -12, 0],
    head: [-1, 14, 0],
    hands: [[0.015, 1.36, 0.66], [-0.20, 1.37, 0.06]],
    elbows: [[0.29, 1.10, 0.30], [-0.31, 1.11, 0.03]],
    feet: [[0.18, 0.11, 0.13], [-0.18, 0.05, -0.075]],
    feetRot: [[26, 8, 0], [0, -12, 0]], toes: 0.45
  }) },
  { time: 0.27, spec: strike('L', [0.035, 1.33, 0.52], {
    lift: -0.10, hips: [0, -22, 0], spine: [6, -12, 0], chest: [3, -7, 0],
    hands: [[0.035, 1.33, 0.52], [-0.15, 1.37, 0.10]],
    elbows: [[0.31, 1.07, 0.19], [-0.28, 1.10, 0.04]],
    feet: [[0.18, 0.07, 0.10], [-0.18, 0.05, -0.07]]
  }) },
  { time: 0.4, spec: guard() }
]));

// Alternating hooks: the fist travels laterally across the centre line, the elbow stays outside it,
// and the far shoulder closes the distance. This is what makes a hook read differently from a jab.
addClip('Goku_Punch3', 0.44, false, timeline(0.44, 15, [
  { time: 0, spec: guard() },
  { time: 0.09, spec: stance({ hips: [0, 24, 0], spine: [4, 14, 0], chest: [2, 8, 0],
    hands: [[0.08, 1.27, 0.13], [-0.19, 1.31, 0.24]], elbows: [[0.48, 1.08, 0.0], [-0.48, 1.07, 0.10]],
    fingers: 0.96 }) },
  { time: 0.2, spec: strike('R', [-0.03, 1.34, 0.43], {
    hips: [0, -7, 0], spine: [4, -4, 0], chest: [2, -2, 0],
    hands: [[0.20, 1.36, 0.08], [-0.03, 1.34, 0.43]],
    elbows: [[0.31, 1.10, 0.04], [-0.32, 1.08, 0.38]],
    feet: [[0.18, 0.05, 0.05], [-0.18, 0.05, -0.05]]
  }) },
  { time: 0.31, spec: strike('R', [-0.07, 1.31, 0.36], {
    hips: [0, 2, 0], spine: [4, 4, 0], chest: [2, 2, 0],
    hands: [[0.20, 1.36, 0.08], [-0.07, 1.31, 0.36]],
    elbows: [[0.31, 1.10, 0.04], [-0.34, 1.06, 0.30]]
  }) },
  { time: 0.44, spec: guard() }
]));

addClip('Goku_Punch4', 0.46, false, timeline(0.46, 15, [
  { time: 0, spec: guard() },
  { time: 0.1, spec: stance({ hips: [0, -20, 0], spine: [6, -12, 0], chest: [3, -7, 0],
    hands: [[0.20, 1.31, 0.24], [-0.09, 1.28, 0.12]], elbows: [[0.48, 1.07, 0.1], [-0.48, 1.08, 0.0]],
    fingers: 0.96 }) },
  { time: 0.22, spec: strike('L', [0.04, 1.35, 0.45], {
    hips: [0, 8, 0], spine: [6, 5, 0], chest: [3, 3, 0],
    hands: [[0.04, 1.35, 0.45], [-0.20, 1.36, 0.08]],
    elbows: [[0.32, 1.08, 0.38], [-0.31, 1.10, 0.04]],
    feet: [[0.18, 0.05, 0.055], [-0.18, 0.05, -0.04]]
  }) },
  { time: 0.34, spec: strike('L', [0.08, 1.32, 0.37], {
    hips: [0, -2, 0], spine: [6, -4, 0], chest: [3, -2, 0],
    hands: [[0.08, 1.32, 0.37], [-0.20, 1.36, 0.08]],
    elbows: [[0.34, 1.06, 0.3], [-0.31, 1.10, 0.04]]
  }) },
  { time: 0.46, spec: guard() }
]));

addClip('Goku_Punch5', 0.55, false, timeline(0.55, 17, [
  { time: 0, spec: guard() },
  { time: 0.12, spec: stance({ hips: [0, -34, 0], spine: [2, -20, 0], chest: [1, -12, 0],
    hands: [[0.18, 1.29, 0.24], [-0.06, 1.30, 0.10]], elbows: [[0.48, 1.02, 0.1], [-0.52, 1.0, 0.0]],
    fingers: 1 }) },
  { time: 0.26, spec: strike('R', [-0.02, 1.36, 0.58], {
    hips: [0, 30, 0], spine: [2, 20, 0], chest: [1, 12, 0],
    hands: [[0.20, 1.36, 0.08], [-0.02, 1.36, 0.58]],
    elbows: [[0.31, 1.10, 0.04], [-0.30, 1.08, 0.36]],
    feet: [[0.18, 0.05, 0.06], [-0.18, 0.05, -0.06]]
  }) },
  { time: 0.4, spec: strike('R', [-0.06, 1.31, 0.46], {
    hips: [0, 24, 0], spine: [4, 14, 0], chest: [2, 8, 0],
    hands: [[0.20, 1.36, 0.08], [-0.06, 1.31, 0.46]],
    elbows: [[0.31, 1.10, 0.04], [-0.34, 1.05, 0.28]]
  }) },
  { time: 0.55, spec: guard() }
]));

addClip('Goku_Heavy', 0.62, false, timeline(0.62, 18, [
  { time: 0, spec: guard() },
  { time: 0.14, spec: stance({ lift: -0.13, hips: [0, -36, 0], spine: [0, -22, 0], chest: [0, -12, 0],
    hands: [[0.17, 1.25, 0.18], [-0.16, 1.40, -0.02]], elbows: [[0.48, 1.0, 0.1], [-0.50, 1.12, 0.02]],
    feet: [[0.18, 0.05, -0.02], [-0.18, 0.05, -0.08]], fingers: 1 }) },
  { time: 0.26, spec: strike('R', [-0.01, 1.34, 0.66], {
    lift: -0.16, hips: [0, 36, 0], spine: [8, 24, 0], chest: [4, 15, 0],
    hands: [[0.14, 1.24, 0.22], [-0.01, 1.34, 0.66]],
    elbows: [[0.46, 0.98, 0.08], [-0.28, 1.06, 0.38]],
    feet: [[0.19, 0.05, 0.09], [-0.19, 0.05, -0.08]],
    toes: 0.5
  }) },
  { time: 0.4, spec: strike('R', [-0.04, 1.30, 0.52], {
    lift: -0.12, hips: [0, 26, 0], spine: [6, 16, 0], chest: [3, 10, 0],
    hands: [[0.14, 1.25, 0.22], [-0.04, 1.30, 0.52]],
    elbows: [[0.46, 0.98, 0.08], [-0.32, 1.04, 0.30]]
  }) },
  { time: 0.62, spec: guard() }
]));

addClip('Goku_Kick', 0.5, false, timeline(0.5, 16, [
  { time: 0, spec: guard() },
  { time: 0.1, spec: stance({ lift: -0.16, hips: [0, -10, 0], spine: [2, 8, 0], chest: [1, 5, 0],
    hands: [[0.18, 1.34, 0.20], [-0.17, 1.38, 0.18]], elbows: [[0.30, 1.06, 0.09], [-0.30, 1.06, 0.09]],
    feet: [[0.18, 0.22, 0.08], [-0.18, 0.05, -0.09]], feetRot: [[-34, 0, 0], [0, -8, 0]],
    knees: [[0.22, 0.68, 0.48], [-0.22, 0.42, 0.42]] }) },
  { time: 0.22, spec: stance({     lift: -0.12, hips: [3, 10, 0], spine: [5, -6, 0], chest: [2, -3, 0],
    head: [-2, -6, 0],
    hands: [[0.23, 1.37, 0.12], [-0.21, 1.40, 0.10]], elbows: [[0.33, 1.08, 0.02], [-0.33, 1.10, 0.02]],
    feet: [[0.24, 0.60, 0.90], [-0.18, 0.05, -0.10]], feetRot: [[-72, 0, 0], [0, -8, 0]],
    knees: [[0.27, 0.95, 1.02], [-0.22, 0.42, 0.42]], toes: 0.4
  }) },
  { time: 0.34, spec: stance({     lift: -0.13, hips: [2, 7, 0], spine: [3, -4, 0], chest: [1, -2, 0],
    hands: [[0.23, 1.36, 0.17], [-0.21, 1.39, 0.15]], elbows: [[0.32, 1.07, 0.05], [-0.32, 1.09, 0.05]],
    feet: [[0.22, 0.38, 0.66], [-0.18, 0.05, -0.10]], feetRot: [[-52, 0, 0], [0, -8, 0]],
    knees: [[0.25, 0.80, 0.82], [-0.22, 0.42, 0.42]] }) },
  { time: 0.5, spec: guard() }
]));

addClip('Goku_Launcher', 0.58, false, timeline(0.58, 17, [
  { time: 0, spec: guard() },
  { time: 0.12, spec: stance({ lift: -0.18, hips: [10, 0, 0], spine: [14, 0, 0], chest: [6, 0, 0],
    hands: [[0.18, 1.04, 0.20], [-0.18, 1.08, 0.18]], elbows: [[0.48, 0.84, 0.12], [-0.48, 0.86, 0.12]],
    feet: [[0.18, 0.05, 0.02], [-0.18, 0.05, -0.04]], knees: [[0.22, 0.42, 0.4], [-0.22, 0.42, 0.4]] }) },
  { time: 0.28, spec: strike('R', [-0.03, 1.70, 0.30], {
    lift: 0.06, hips: [-4, 10, 0], spine: [-10, 6, 0], chest: [-6, 4, 0],
    hands: [[0.16, 1.30, 0.20], [-0.03, 1.70, 0.30]],
    elbows: [[0.48, 1.04, 0.1], [-0.36, 1.36, 0.2]],
    feet: [[0.19, 0.09, 0.02], [-0.19, 0.05, -0.04]], toes: 0.4
  }) },
  { time: 0.42, spec: strike('R', [-0.05, 1.55, 0.30], {
    lift: -0.02, hips: [0, 6, 0], spine: [-2, 2, 0],
    hands: [[0.16, 1.28, 0.20], [-0.05, 1.55, 0.30]],
    elbows: [[0.48, 1.04, 0.1], [-0.38, 1.28, 0.2]]
  }) },
  { time: 0.58, spec: guard() }
]));

addClip('Goku_AirPunch', 0.45, false, timeline(0.45, 14, [
  { time: 0, spec: stance({ lift: 0.28, feet: [[0.18, 0.28, 0.08], [-0.18, 0.30, -0.02]],
    feetRot: [[-20, 0, 0], [-18, 0, 0]], hands: [[0.18, 1.28, 0.20], [-0.18, 1.30, 0.18]] }) },
  { time: 0.12, spec: stance({ lift: 0.22, hips: [6, -16, 0], spine: [8, -10, 0],
    hands: [[0.20, 1.30, 0.12], [-0.20, 1.24, 0.06]], feet: [[0.18, 0.38, 0.10], [-0.18, 0.36, -0.04]],
    fingers: 0.96 }) },
  { time: 0.26, spec: strike('R', [-0.02, 1.34, 0.56], {
    lift: 0.26, hips: [2, 20, 0], spine: [4, 12, 0], chest: [2, 7, 0],
    hands: [[0.16, 1.26, 0.2], [-0.02, 1.34, 0.56]],
    elbows: [[0.46, 1.02, 0.1], [-0.32, 1.06, 0.32]],
    feet: [[0.18, 0.34, 0.08], [-0.18, 0.32, -0.04]], feetRot: [[-22, 0, 0], [-20, 0, 0]]
  }) },
  { time: 0.45, spec: stance({ lift: 0.28, feet: [[0.18, 0.28, 0.08], [-0.18, 0.30, -0.02]],
    feetRot: [[-20, 0, 0], [-18, 0, 0]] }) }
]));

addClip('Goku_AirKick', 0.5, false, timeline(0.5, 15, [
  { time: 0, spec: stance({ lift: 0.30, feet: [[0.18, 0.30, 0.08], [-0.18, 0.32, -0.02]],
    feetRot: [[-20, 0, 0], [-18, 0, 0]] }) },
  { time: 0.14, spec: stance({ lift: 0.24, hips: [8, -5, 0], spine: [12, 4, 0],
    feet: [[0.18, 0.45, 0.10], [-0.18, 0.40, -0.02]], feetRot: [[-30, 0, 0], [-24, 0, 0]],
    knees: [[0.24, 0.74, 0.45], [-0.24, 0.70, 0.42]] }) },
  { time: 0.28, spec: stance({ lift: 0.18, hips: [-8, 22, 0], spine: [-14, -12, 0], chest: [-7, -7, 0],
    hands: [[0.20, 1.38, 0.12], [-0.16, 1.40, 0.10]], elbows: [[0.46, 1.12, 0.02], [-0.46, 1.14, 0.02]],
    feet: [[0.24, 0.66, 0.52], [-0.18, 0.36, -0.04]], feetRot: [[-62, 0, 0], [-24, 0, 0]],
    knees: [[0.26, 0.92, 0.68], [-0.24, 0.68, 0.42]] }) },
  { time: 0.5, spec: stance({ lift: 0.30, feet: [[0.18, 0.30, 0.08], [-0.18, 0.32, -0.02]],
    feetRot: [[-20, 0, 0], [-18, 0, 0]] }) }
]));

addClip('Goku_Slam', 0.7, false, timeline(0.7, 18, [
  { time: 0, spec: guard() },
  { time: 0.16, spec: stance({ lift: 0.24, hips: [-12, 0, 0], spine: [-16, 0, 0], chest: [-8, 0, 0],
    hands: [[0.22, 1.84, 0.12], [-0.22, 1.86, 0.10]], elbows: [[0.42, 1.62, 0.02], [-0.42, 1.62, 0.02]],
    feet: [[0.18, 0.18, 0.02], [-0.18, 0.18, -0.02]], fingers: 0.1 }) },
  { time: 0.34, spec: stance({ lift: -0.24, hips: [20, 0, 0], spine: [28, 0, 0], chest: [12, 0, 0],
    hands: [[0.26, 0.55, 0.32], [-0.26, 0.57, 0.30]], elbows: [[0.50, 0.72, 0.2], [-0.50, 0.72, 0.2]],
    feet: [[0.20, 0.05, 0.03], [-0.20, 0.05, -0.03]], feetRot: [[12, 0, 0], [12, 0, 0]],
    knees: [[0.26, 0.4, 0.42], [-0.26, 0.4, 0.42]], fingers: 1, toes: 0.5 }) },
  { time: 0.5, spec: stance({ lift: -0.18, hips: [12, 0, 0], spine: [20, 0, 0], chest: [8, 0, 0],
    hands: [[0.24, 0.76, 0.30], [-0.24, 0.78, 0.28]], feet: [[0.2, 0.05, 0.03], [-0.2, 0.05, -0.03]] }) },
  { time: 0.7, spec: guard() }
]));

addClip('Goku_Grab', 0.45, false, timeline(0.45, 13, [
  { time: 0, spec: guard() },
  { time: 0.1, spec: stance({ hips: [0, -12, 0], spine: [5, 12, 0], hands: [[0.18, 1.30, 0.30], [-0.18, 1.32, 0.28]],
    elbows: [[0.48, 1.05, 0.16], [-0.48, 1.05, 0.16]], fingers: 0.35 }) },
  { time: 0.24, spec: stance({ hips: [0, 6, 0], spine: [7, 4, 0], hands: [[0.12, 1.34, 0.53], [-0.12, 1.36, 0.51]],
    elbows: [[0.42, 1.04, 0.26], [-0.42, 1.04, 0.26]], fingers: 0.9 }) },
  { time: 0.45, spec: stance({ hands: [[0.13, 1.34, 0.50], [-0.13, 1.36, 0.48]],
    elbows: [[0.44, 1.03, 0.24], [-0.44, 1.03, 0.24]], fingers: 0.9 }) }
]));

addClip('Goku_Throw', 0.6, false, timeline(0.6, 16, [
  { time: 0, spec: stance({ hands: [[0.13, 1.34, 0.50], [-0.13, 1.36, 0.48]],
    elbows: [[0.44, 1.03, 0.24], [-0.44, 1.03, 0.24]], fingers: 0.9 }) },
  { time: 0.14, spec: stance({ hips: [0, 34, 0], spine: [4, 20, 0], chest: [2, 12, 0],
    hands: [[0.18, 1.46, 0.34], [-0.16, 1.48, 0.30]], elbows: [[0.48, 1.16, 0.16], [-0.48, 1.16, 0.16]],
    fingers: 0.8, feet: [[0.18, 0.05, -0.01], [-0.18, 0.05, -0.06]] }) },
  { time: 0.32, spec: stance({ hips: [0, -42, 0], spine: [18, -25, 0], chest: [9, -14, 0],
    hands: [[0.08, 1.22, 0.58], [-0.10, 1.24, 0.56]], elbows: [[0.38, 0.96, 0.32], [-0.38, 0.96, 0.32]],
    fingers: 0.15, feet: [[0.19, 0.05, 0.08], [-0.19, 0.05, -0.08]] }) },
  { time: 0.46, spec: stance({ hips: [0, -18, 0], spine: [8, -10, 0],
    hands: [[0.14, 1.24, 0.40], [-0.14, 1.26, 0.38]], fingers: 0.25 }) },
  { time: 0.6, spec: guard() }
]));

// ---- defence / reactions --------------------------------------------------------------------
addClip('Goku_Block', 0.9, true, cycle(0.9, 13, t => {
  const phase = t * Math.PI * 2;
  const brace = Math.sin(phase);
  return stance({
    lift: -0.11 + brace * 0.006,
    hips: [2, brace * 1.2, 0], spine: [10 + brace * 1.2, 0, 0], chest: [6 + brace, 0, 0],
    neck: [-7, 0, 0], head: [-3, 0, 0],
    hands: [[0.225, 1.42 + brace * 0.006, 0.31], [-0.215, 1.43 - brace * 0.005, 0.29]],
    elbows: [[0.33, 1.16, 0.20], [-0.33, 1.16, 0.19]],
    wrists: [[0, 0, -20], [0, 0, 20]],
    feet: [[0.19, 0.05, 0.02], [-0.19, 0.05, -0.03]],
    feetRot: [[0, 8, 0], [0, -8, 0]],
    knees: [[0.23, 0.43, 0.42], [-0.23, 0.43, 0.42]],
    fingers: 1
  });
}));

addClip('Goku_Dodge', 0.4, false, timeline(0.4, 13, [
  { time: 0, spec: guard() },
  { time: 0.08, spec: stance({ lift: -0.15, hips: [0, -30, 0], spine: [2, -15, 0], chest: [1, -8, 0],
    hands: [[0.20, 1.20, 0.22], [-0.20, 1.24, 0.20]], feet: [[0.20, 0.14, 0.02], [-0.12, 0.05, -0.03]] }) },
  { time: 0.2, spec: stance({ lift: -0.16, hips: [0, -54, 0], spine: [0, -24, 0], chest: [0, -12, 0],
    hands: [[0.20, 1.16, 0.20], [-0.20, 1.20, 0.18]],
    feet: [[0.24, 0.07, 0.12], [-0.06, 0.05, -0.16]], feetRot: [[0, -30, 0], [0, -16, 0]] }) },
  { time: 0.3, spec: stance({ lift: -0.11, hips: [0, -18, 0], spine: [3, -8, 0],
    feet: [[0.19, 0.05, 0.03], [-0.16, 0.05, -0.03]] }) },
  { time: 0.4, spec: guard() }
]));

addClip('Goku_HitLight', 0.35, false, timeline(0.35, 12, [
  { time: 0, spec: guard() },
  { time: 0.07, spec: stance({ lift: -0.11, hips: [-4, 8, 0], spine: [-16, 4, 0], chest: [-9, 2, 0],
    neck: [12, -3, 0], head: [10, -6, 0],
    hands: [[0.24, 1.22, 0.16], [-0.22, 1.24, 0.14]], elbows: [[0.50, 1.0, 0.06], [-0.50, 1.0, 0.06]],
    feet: [[0.18, 0.05, 0.0], [-0.18, 0.05, -0.06]], fingers: 0.5 }) },
  { time: 0.2, spec: stance({ hips: [0, 4, 0], spine: [-6, 1, 0], chest: [-3, 0, 0],
    neck: [5, 0, 0], head: [4, 0, 0] }) },
  { time: 0.35, spec: guard() }
]));

addClip('Goku_HitHeavy', 0.6, false, timeline(0.6, 15, [
  { time: 0, spec: guard() },
  { time: 0.1, spec: stance({ lift: -0.17, hips: [-10, 16, 0], spine: [-30, 8, 0], chest: [-17, 4, 0],
    neck: [22, -6, 0], head: [18, -10, 0],
    hands: [[0.30, 1.15, 0.06], [-0.28, 1.18, 0.04]], elbows: [[0.52, 0.92, 0.0], [-0.52, 0.92, 0.0]],
    feet: [[0.20, 0.05, -0.04], [-0.16, 0.12, -0.12]], feetRot: [[0, 0, 0], [0, -10, 0]],
    fingers: 0.3 }) },
  { time: 0.28, spec: stance({ lift: -0.2, hips: [-14, 20, 0], spine: [-36, 10, 0], chest: [-20, 5, 0],
    neck: [26, -8, 0], head: [22, -12, 0],
    hands: [[0.34, 1.08, 0.02], [-0.30, 1.12, 0.0]], feet: [[0.21, 0.05, -0.06], [-0.15, 0.18, -0.18]] }) },
  { time: 0.46, spec: stance({ lift: -0.13, hips: [-4, 8, 0], spine: [-12, 3, 0], chest: [-6, 2, 0],
    neck: [10, -2, 0], head: [8, -4, 0] }) },
  { time: 0.6, spec: guard() }
]));

addClip('Goku_Knockdown', 0.85, false, timeline(0.85, 18, [
  { time: 0, spec: stance({ lift: -0.12, hips: [-8, 12, 0], spine: [-26, 4, 0], chest: [-14, 2, 0],
    hands: [[0.30, 1.18, 0.06], [-0.28, 1.2, 0.04]], feet: [[0.19, 0.05, -0.02], [-0.17, 0.1, -0.1]] }) },
  { time: 0.24, spec: stance({ lift: -0.45, hips: [-28, 16, 0], spine: [-50, 8, 0], chest: [-26, 4, 0],
    neck: [30, -4, 0], head: [26, -8, 0],
    hands: [[0.36, 0.48, 0.18], [-0.34, 0.50, 0.16]], elbows: [[0.54, 0.34, 0.12], [-0.54, 0.34, 0.12]],
    feet: [[0.20, 0.05, 0.16], [-0.18, 0.06, -0.22]], feetRot: [[-20, 0, 0], [-16, 0, 0]], fingers: 0.3 }) },
  { time: 0.5, spec: stance({ lift: -0.57, hips: [-46, 14, 0], spine: [-66, 6, 0], chest: [-30, 3, 0],
    neck: [32, -2, 0], head: [30, -4, 0],
    hands: [[0.38, 0.16, 0.34], [-0.36, 0.18, 0.30]], feet: [[0.2, 0.05, 0.24], [-0.18, 0.06, -0.28]] }) },
  { time: 0.85, spec: stance({ lift: -0.55, hips: [-40, 10, 0], spine: [-58, 4, 0], chest: [-26, 2, 0],
    feet: [[0.2, 0.05, 0.22], [-0.18, 0.06, -0.26]] }) }
]));

addClip('Goku_GetUp', 0.8, false, timeline(0.8, 16, [
  { time: 0, spec: stance({ lift: -0.55, hips: [-40, 10, 0], spine: [-58, 4, 0], chest: [-26, 2, 0],
    feet: [[0.2, 0.05, 0.22], [-0.18, 0.06, -0.26]] }) },
  { time: 0.28, spec: stance({ lift: -0.36, hips: [-16, 8, 0], spine: [-26, 3, 0], chest: [-12, 2, 0],
    hands: [[0.26, 0.72, 0.30], [-0.26, 0.74, 0.28]], feet: [[0.2, 0.05, 0.14], [-0.18, 0.05, -0.16]] }) },
  { time: 0.52, spec: stance({ lift: -0.18, hips: [4, 4, 0], spine: [12, 1, 0], chest: [6, 0, 0],
    hands: [[0.2, 1.06, 0.24], [-0.2, 1.08, 0.22]] }) },
  { time: 0.8, spec: guard() }
]));

addClip('Goku_Victory', 1.4, false, timeline(1.4, 22, [
  { time: 0, spec: guard() },
  { time: 0.25, spec: stance({ lift: -0.06, hips: [-4, -12, 0], spine: [-10, -6, 0], chest: [-5, -3, 0],
    hands: [[0.18, 1.30, 0.18], [-0.06, 1.80, 0.12]], elbows: [[0.48, 1.03, 0.08], [-0.36, 1.55, 0.04]],
    head: [-8, 10, 0], fingers: 1 }) },
  { time: 0.55, spec: stance({ lift: -0.04, hips: [-6, -6, 0], spine: [-12, -3, 0], chest: [-6, -2, 0],
    hands: [[0.18, 1.31, 0.18], [-0.05, 1.84, 0.14]], elbows: [[0.48, 1.03, 0.08], [-0.34, 1.58, 0.04]],
    head: [-10, 8, 0], fingers: 1 }) },
  { time: 1.0, spec: stance({ lift: -0.06, hips: [-4, -10, 0], spine: [-8, -5, 0],
    hands: [[0.18, 1.29, 0.18], [-0.06, 1.78, 0.12]], head: [-7, 10, 0], fingers: 1 }) },
  { time: 1.4, spec: stance({ lift: -0.06, hips: [-4, -8, 0], spine: [-8, -4, 0],
    hands: [[0.18, 1.29, 0.18], [-0.06, 1.78, 0.12]], head: [-7, 8, 0], fingers: 1 }) }
]));

addClip('Goku_Defeat', 1.3, false, timeline(1.3, 20, [
  { time: 0, spec: guard() },
  { time: 0.3, spec: stance({ lift: -0.18, hips: [16, 0, 0], spine: [22, 0, 0], chest: [10, 0, 0],
    neck: [12, 0, 0], head: [14, 0, 0], hands: [[0.22, 1.02, 0.22], [-0.22, 1.04, 0.20]],
    elbows: [[0.50, 0.82, 0.12], [-0.50, 0.82, 0.12]],
    feet: [[0.18, 0.05, 0.02], [-0.18, 0.05, -0.04]], fingers: 0.3 }) },
  { time: 0.7, spec: stance({ lift: -0.44, hips: [26, 0, 0], spine: [36, 0, 0], chest: [16, 0, 0],
    neck: [20, 0, 0], head: [22, 0, 0], hands: [[0.24, 0.50, 0.22], [-0.24, 0.52, 0.20]],
    feet: [[0.18, 0.05, 0.04], [-0.18, 0.05, -0.06]], knees: [[0.24, 0.38, 0.4], [-0.24, 0.38, 0.4]] }) },
  { time: 1.3, spec: stance({ lift: -0.48, hips: [24, 0, 0], spine: [32, 0, 0], chest: [14, 0, 0],
    neck: [18, 0, 0], head: [20, 0, 0], hands: [[0.24, 0.46, 0.22], [-0.24, 0.48, 0.20]],
    feet: [[0.18, 0.05, 0.04], [-0.18, 0.05, -0.06]] }) }
]));

// ---- ki / signature abilities ----------------------------------------------------------------
addClip('Goku_KiBlast', 0.55, false, timeline(0.55, 16, [
  { time: 0, spec: guard() },
  { time: 0.1, spec: stance({ hips: [0, -24, 0], spine: [4, -14, 0], chest: [2, -8, 0],
    hands: [[0.18, 1.3, 0.2], [-0.18, 1.22, 0.08]], elbows: [[0.48, 1.03, 0.08], [-0.50, 1.02, 0.0]],
    fingers: 0.8 }) },
  { time: 0.23, spec: strike('R', [-0.02, 1.32, 0.60], {
    hips: [0, 20, 0], spine: [4, 12, 0], chest: [2, 7, 0],
    hands: [[0.15, 1.27, 0.22], [-0.02, 1.32, 0.60]],
    elbows: [[0.46, 1.02, 0.09], [-0.32, 1.06, 0.3]],
    fingers: 0.2, wrists: [[0, 0, 0], [0, 0, 20]]
  }) },
  { time: 0.35, spec: strike('R', [-0.04, 1.3, 0.52], {
    hips: [0, 16, 0], spine: [4, 9, 0], chest: [2, 5, 0],
    hands: [[0.15, 1.26, 0.22], [-0.04, 1.3, 0.52]], fingers: 0.15
  }) },
  { time: 0.55, spec: guard() }
]));

addClip('Goku_KamehamehaCharge', 1.1, true, cycle(1.1, 18, t => {
  const phase = t * Math.PI * 2;
  const pulse = Math.sin(phase);
  return stance({
    lift: -0.16 + pulse * 0.012,
    hips: [0, 26 + pulse * 3, 0], spine: [2, 15 + pulse * 2, 0], chest: [0, 8, 0],
    neck: [-6, -16, 0], head: [-4, -14, 0],
    hands: [[0.055, 1.03 + pulse * 0.018, 0.34], [-0.055, 1.05 + pulse * 0.018, 0.34]],
    elbows: [[0.38, 0.92, 0.22], [-0.38, 0.92, 0.22]],
    wrists: [[0, 0, -30], [0, 0, 30]],
    feet: [[0.21, 0.05, 0.06], [-0.21, 0.05, -0.06]],
    feetRot: [[0, 12, 0], [0, -10, 0]],
    knees: [[0.25, 0.42, 0.44], [-0.25, 0.42, 0.44]],
    fingers: 0.06, toes: 0.25
  });
}));

addClip('Goku_Kamehameha', 1.0, false, timeline(1.0, 20, [
  { time: 0, spec: stance({ lift: -0.16, hips: [0, 26, 0], spine: [2, 15, 0], chest: [0, 8, 0],
    hands: [[0.055, 1.03, 0.34], [-0.055, 1.05, 0.34]], elbows: [[0.38, 0.92, 0.22], [-0.38, 0.92, 0.22]],
    wrists: [[0, 0, -30], [0, 0, 30]], feet: [[0.21, 0.05, 0.06], [-0.21, 0.05, -0.06]],
    fingers: 0.06 }) },
  { time: 0.18, spec: stance({ lift: -0.19, hips: [0, 18, 0], spine: [-4, 10, 0], chest: [-2, 5, 0],
    hands: [[0.06, 0.98, 0.28], [-0.06, 1.0, 0.28]], elbows: [[0.4, 0.88, 0.18], [-0.4, 0.88, 0.18]],
    wrists: [[0, 0, -34], [0, 0, 34]], fingers: 0.04 }) },
  { time: 0.38, spec: stance({ lift: -0.08, hips: [0, -18, 0], spine: [10, -14, 0], chest: [6, -8, 0],
    neck: [-10, 8, 0], head: [-6, 6, 0],
    hands: [[0.065, 1.20, 0.66], [-0.065, 1.22, 0.66]],
    elbows: [[0.33, 1.16, 0.12], [-0.33, 1.16, 0.12]],
    wrists: [[0, 0, -22], [0, 0, 22]],
    feet: [[0.21, 0.05, 0.12], [-0.21, 0.05, -0.08]], feetRot: [[0, -18, 0], [0, -20, 0]],
    fingers: 0.04, toes: 0.35
  }) },
  { time: 0.62, spec: stance({ lift: -0.09, hips: [0, -14, 0], spine: [8, -10, 0], chest: [5, -6, 0],
    hands: [[0.065, 1.19, 0.63], [-0.065, 1.21, 0.63]], elbows: [[0.34, 1.15, 0.12], [-0.34, 1.15, 0.12]],
    wrists: [[0, 0, -20], [0, 0, 20]], feet: [[0.21, 0.05, 0.1], [-0.21, 0.05, -0.08]], fingers: 0.04 }) },
  { time: 1.0, spec: guard() }
]));

addClip('Goku_InstantTransmission', 0.7, false, timeline(0.7, 17, [
  { time: 0, spec: guard() },
  { time: 0.15, spec: stance({ lift: -0.14, hips: [0, -10, 0], spine: [8, -8, 0], chest: [4, -5, 0],
    hands: [[0.16, 1.26, 0.22], [-0.16, 1.55, 0.20]], elbows: [[0.46, 1.0, 0.1], [-0.44, 1.38, 0.1]],
    wrists: [[0, 0, 0], [0, 0, -28]], fingers: 0.15 }) },
  { time: 0.33, spec: stance({ lift: -0.04, hips: [0, -18, 0], spine: [12, -10, 0], chest: [6, -6, 0],
    hands: [[0.18, 1.3, 0.18], [-0.04, 1.80, 0.10]], elbows: [[0.48, 1.02, 0.08], [-0.36, 1.55, 0.04]],
    fingers: 0.2, head: [-6, 8, 0] }) },
  { time: 0.52, spec: stance({ lift: -0.06, hips: [0, 4, 0], spine: [4, 2, 0], chest: [2, 1, 0],
    hands: [[0.18, 1.3, 0.2], [-0.18, 1.42, 0.18]], elbows: [[0.48, 1.02, 0.1], [-0.46, 1.2, 0.08]],
    fingers: 0.3 }) },
  { time: 0.7, spec: guard() }
]));

addClip('Goku_DragonFist', 0.9, false, timeline(0.9, 19, [
  { time: 0, spec: guard() },
  { time: 0.18, spec: stance({ lift: -0.13, hips: [0, -32, 0], spine: [6, -20, 0], chest: [3, -12, 0],
    hands: [[0.18, 1.3, 0.2], [-0.16, 1.12, 0.0]], elbows: [[0.48, 1.02, 0.1], [-0.48, 0.94, 0.08]],
    feet: [[0.19, 0.05, 0.02], [-0.19, 0.05, -0.06]], fingers: 1 }) },
  { time: 0.4, spec: strike('R', [-0.01, 1.36, 0.72], {
    lift: -0.02, hips: [0, 32, 0], spine: [10, 22, 0], chest: [5, 14, 0],
    hands: [[0.16, 1.24, 0.2], [-0.01, 1.36, 0.72]],
    elbows: [[0.46, 0.98, 0.08], [-0.28, 1.06, 0.4]],
    feet: [[0.2, 0.05, 0.1], [-0.2, 0.05, -0.08]], fingers: 1, toes: 0.4
  }) },
  { time: 0.58, spec: strike('R', [-0.04, 1.32, 0.58], {
    hips: [0, 24, 0], spine: [8, 14, 0], chest: [4, 8, 0],
    hands: [[0.16, 1.24, 0.2], [-0.04, 1.32, 0.58]], fingers: 0.9
  }) },
  { time: 0.9, spec: guard() }
]));

addClip('Goku_Ultimate', 1.6, false, timeline(1.6, 26, [
  { time: 0, spec: guard() },
  { time: 0.16, spec: stance({ lift: -0.16, hips: [0, -36, 0], spine: [4, -22, 0], chest: [2, -13, 0],
    hands: [[0.18, 1.28, 0.18], [-0.18, 1.10, 0.0]], elbows: [[0.48, 1.0, 0.1], [-0.48, 0.92, 0.08]],
    fingers: 1, feet: [[0.19, 0.05, 0.02], [-0.19, 0.05, -0.06]] }) },
  { time: 0.3, spec: stance({ lift: -0.2, hips: [0, -46, 0], spine: [8, -28, 0], chest: [4, -16, 0],
    hands: [[0.18, 1.26, 0.16], [-0.17, 1.08, -0.02]], fingers: 1, head: [-4, 16, 0] }) },
  { time: 0.46, spec: strike('R', [-0.02, 1.38, 0.78], {
    lift: -0.02, hips: [0, 34, 0], spine: [12, 24, 0], chest: [6, 15, 0],
    hands: [[0.16, 1.23, 0.18], [-0.02, 1.38, 0.78]],
    elbows: [[0.46, 0.98, 0.08], [-0.26, 1.06, 0.42]],
    feet: [[0.2, 0.05, 0.12], [-0.2, 0.05, -0.08]], fingers: 1, toes: 0.5
  }) },
  { time: 0.64, spec: stance({ lift: -0.12, hips: [0, 20, 0], spine: [6, 14, 0], chest: [3, 8, 0],
    hands: [[0.08, 1.18, 0.48], [-0.08, 1.2, 0.48]], elbows: [[0.34, 1.0, 0.28], [-0.34, 1.0, 0.28]],
    fingers: 0.05 }) },
  { time: 0.84, spec: stance({ lift: -0.06, hips: [0, -24, 0], spine: [12, -18, 0], chest: [6, -10, 0],
    hands: [[0.06, 1.3, 0.74], [-0.06, 1.32, 0.74]], elbows: [[0.24, 1.14, 0.4], [-0.24, 1.14, 0.4]],
    wrists: [[0, 0, -18], [0, 0, 18]], fingers: 0.03, feet: [[0.21, 0.05, 0.12], [-0.21, 0.05, -0.09]] }) },
  { time: 1.12, spec: stance({ lift: -0.08, hips: [0, -18, 0], spine: [10, -12, 0], chest: [5, -7, 0],
    hands: [[0.07, 1.26, 0.68], [-0.07, 1.28, 0.68]], elbows: [[0.26, 1.1, 0.38], [-0.26, 1.1, 0.38]],
    fingers: 0.03 }) },
  { time: 1.6, spec: guard() }
]));

// ---- transformations ------------------------------------------------------------------------
function formSpec(t, color = 0) {
  const phase = t * Math.PI * 2;
  const surge = Math.sin(phase) * 0.5 + 0.5;
  return stance({
    lift: -0.1 - surge * 0.08,
    hips: [4, Math.sin(phase) * 4, 0], spine: [-4 - surge * 8, 0, 0], chest: [-2 - surge * 4, 0, 0],
    neck: [6 + surge * 4, 0, 0], head: [4 + surge * 3, 0, 0],
    hands: [[0.30, 1.24 - surge * 0.1, 0.10], [-0.30, 1.26 - surge * 0.1, 0.08]],
    elbows: [[0.52, 1.0, 0.02], [-0.52, 1.0, 0.02]],
    wrists: [[0, 0, -20], [0, 0, 20]],
    feet: [[0.22, 0.05, 0.02], [-0.22, 0.05, -0.02]],
    feetRot: [[0, 12 + color * 4, 0], [0, -12 - color * 4, 0]],
    knees: [[0.26, 0.4, 0.42], [-0.26, 0.4, 0.42]],
    fingers: 1, toes: 0.3
  });
}
addClip('Goku_FormSuperSaiyan', 1.2, false, timeline(1.2, 17, [
  { time: 0, spec: guard() },
  { time: 0.2, spec: formSpec(0.05, 0) },
  { time: 0.45, spec: formSpec(0.4, 1) },
  { time: 0.75, spec: formSpec(0.7, 1) },
  { time: 1.2, spec: formSpec(1, 1) }
]));
addClip('Goku_FormSuperSaiyanBlue', 1.25, false, timeline(1.25, 18, [
  { time: 0, spec: guard() },
  { time: 0.22, spec: formSpec(0.05, 1) },
  { time: 0.5, spec: formSpec(0.5, 2) },
  { time: 0.82, spec: formSpec(0.75, 2) },
  { time: 1.25, spec: formSpec(1, 2) }
]));
addClip('Goku_FormUltraInstinct', 1.4, false, timeline(1.4, 20, [
  { time: 0, spec: guard() },
  { time: 0.25, spec: formSpec(0.05, 3) },
  { time: 0.55, spec: formSpec(0.45, 3) },
  { time: 0.9, spec: formSpec(0.8, 3) },
  { time: 1.4, spec: formSpec(1, 3) }
]));

// The manifest already points at these legacy names. They are real full-body aliases, not empty
// placeholders: the alias shares the solved motion curves with its canonical clip.
addClip('Goku_Special', 1.0, false, CLIPS.Goku_Kamehameha.keys.slice());
addClip('Goku_Air', 0.45, false, CLIPS.Goku_AirPunch.keys.slice());

// ---------------------------------------------------------------- compile to GLB
const clipReport = [];
const glb = {
  asset: {
    version: '2.0',
    generator: 'browser-smash goku IK clip authoring',
    copyright: 'Clip-only animation on the original body; geometry, weights and textures untouched. Goku model by Oup77 (CC BY 4.0).'
  },
  scene: 0,
  scenes: [{ name: 'GokuIKClipRig', nodes: [] }],
  nodes: [],
  animations: [],
  accessors: [],
  bufferViews: [],
  buffers: []
};

// Build the clip-only node tree from the actual body bones. Translation/rotation/scale are the bind
// values, so the clip asset cannot shift the mount even when it is parsed on its own.
const boneIndex = new Map();
const boneParent = new Map();
for (const bone of bones) {
  boneParent.set(bone.name, bone.parent?.isBone ? bone.parent.name : null);
}
const addNode = name => {
  if (boneIndex.has(name)) return boneIndex.get(name);
  const bone = byName.get(name);
  const index = glb.nodes.length;
  boneIndex.set(name, index);
  const bind = rest.get(bone);
  const node = { name };
  if (bind.position.lengthSq() > 1e-12) node.translation = bind.position.toArray();
  if (Math.abs(bind.quaternion.w - 1) > 1e-8 || Math.abs(bind.quaternion.x) + Math.abs(bind.quaternion.y) + Math.abs(bind.quaternion.z) > 1e-8) {
    node.rotation = bind.quaternion.toArray();
  }
  if (bind.scale.distanceToSquared(new THREE.Vector3(1, 1, 1)) > 1e-12) node.scale = bind.scale.toArray();
  glb.nodes.push(node);
  return index;
};
for (const name of boneNames) addNode(name);
for (const name of boneNames) {
  const parent = boneParent.get(name);
  if (!parent) {
    glb.scenes[0].nodes.push(boneIndex.get(name));
    continue;
  }
  const parentNode = glb.nodes[boneIndex.get(parent)];
  parentNode.children = parentNode.children || [];
  parentNode.children.push(boneIndex.get(name));
}

const binary = [];
let byteLength = 0;
function pushFloats(values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  while (byteLength % 4 !== 0) { binary.push(Buffer.from([0])); byteLength++; }
  const byteOffset = byteLength;
  binary.push(buffer);
  byteLength += buffer.length;
  return byteOffset;
}
function addAccessor(values, type, componentType, min, max) {
  const byteOffset = pushFloats(values);
  glb.bufferViews.push({ buffer: 0, byteOffset, byteLength: values.length * 4, target: 34962 });
  glb.accessors.push({
    bufferView: glb.bufferViews.length - 1,
    componentType,
    count: values.length / (type === 'VEC4' ? 4 : type === 'VEC3' ? 3 : 1),
    type, min, max
  });
  return glb.accessors.length - 1;
}

for (const [name, clip] of Object.entries(CLIPS)) {
  const keys = clip.keys;
  const times = keys.map(key => key.time);
  const timeAccessor = addAccessor(times, 'SCALAR', 5126, [Math.min(...times)], [Math.max(...times)]);
  const samplers = [];
  const channels = [];

  // Every bone is keyed in every clip. This is the animation-side half of full-body ownership: a
  // strike cannot leave a bone on the idle layer because the strike supplies its own curve for it.
  const snapshots = keys.map(key => solve(key.spec));
  for (const boneName of boneNames) {
    const node = byName.get(boneName);
    const values = [];
    let previous = null;
    for (const snapshot of snapshots) {
      const quat = snapshot.quaternions.get(boneName).clone();
      if (previous && quat.dot(previous) < 0) quat.set(-quat.x, -quat.y, -quat.z, -quat.w);
      previous = quat;
      values.push(quat.x, quat.y, quat.z, quat.w);
    }
    const output = addAccessor(values, 'VEC4', 5126, [-1, -1, -1, -1], [1, 1, 1, 1]);
    samplers.push({ input: timeAccessor, output, interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node: boneIndex.get(boneName), path: 'rotation' } });
  }

  // Hips translation is keyed for every pose. Grounded clips inherit the solver's planted feet;
  // airborne clips use the authored lift. Keeping it on every clip also stops a previous jump
  // from leaving the next idle hovering.
  const hipsValues = [];
  for (const snapshot of snapshots) hipsValues.push(...snapshot.hipsPosition.toArray());
  const hipsAccessor = addAccessor(hipsValues, 'VEC3', 5126, [-10, -10, -10], [10, 10, 10]);
  samplers.push({ input: timeAccessor, output: hipsAccessor, interpolation: 'LINEAR' });
  channels.push({ sampler: samplers.length - 1, target: { node: boneIndex.get('Hips'), path: 'translation' } });

  glb.animations.push({ name, samplers, channels });
  clipReport.push({
    name, duration: clip.duration, loop: Boolean(clip.loop), keys: keys.length,
    tracks: channels.length, bones: boneNames.length,
    handTravel: (() => {
      const first = snapshots[0];
      const last = snapshots[snapshots.length - 1];
      return +Math.max(...['LeftHand', 'RightHand'].map(boneName => {
        const values = snapshots.map(snapshot => {
          // The snapshot stores local quats; world positions are measured live in the capture audit.
          return snapshot.hipsPosition;
        });
        return 0;
      })).toFixed(3);
    })(),
    authoredBy: 'two-bone IK + positional pose specs'
  });
}

const bin = Buffer.concat(binary);
glb.buffers.push({ byteLength: bin.length });
const jsonBuffer = Buffer.from(JSON.stringify(glb), 'utf8');
const jsonPad = (4 - (jsonBuffer.length % 4)) % 4;
const binPad = (4 - (bin.length % 4)) % 4;
const total = 12 + 8 + jsonBuffer.length + jsonPad + 8 + bin.length + binPad;
const output = Buffer.alloc(total);
output.writeUInt32LE(0x46546c67, 0);
output.writeUInt32LE(2, 4);
output.writeUInt32LE(total, 8);
output.writeUInt32LE(jsonBuffer.length + jsonPad, 12);
output.writeUInt32LE(0x4e4f534a, 16);
jsonBuffer.copy(output, 20);
output.fill(0x20, 20 + jsonBuffer.length, 20 + jsonBuffer.length + jsonPad);
const binHeader = 20 + jsonBuffer.length + jsonPad;
output.writeUInt32LE(bin.length + binPad, binHeader);
output.writeUInt32LE(0x004e4942, binHeader + 4);
bin.copy(output, binHeader + 8);

mkdirSync(dirname(resolve(OUT)), { recursive: true });
writeFileSync(OUT, output);
mkdirSync('artifacts/goku-rebuild', { recursive: true });
writeFileSync('artifacts/goku-rebuild/clip-report.json', JSON.stringify({
  body: BODY, output: OUT, bytes: output.length, joints: boneNames.length, clips: clipReport
}, null, 2) + '\n');
console.log(JSON.stringify({
  ok: true, output: OUT, bytes: output.length, joints: boneNames.length,
  clips: clipReport.length, names: clipReport.map(clip => clip.name)
}, null, 1));
