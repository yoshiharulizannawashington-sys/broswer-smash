#!/usr/bin/env node
/**
 * Author Saitama's motion on the real 158-joint body.
 *
 * WHY THIS EXISTS
 * ---------------
 * The shipped Saitama clips were retargeted from the roster's 19-bone canonical rig. Each clip has
 * 18 tracks on 17 joints of a 158-joint skeleton, so 141 joints - both hands' fingers, the whole
 * face, most of the seven-segment spine - never leave the bind pose. The result is a standing body
 * with one arm moving: jab, run and hover all read as the same idle.
 *
 * This is the Goku benchmark applied to a different skeleton family:
 *
 *   - the body is 158 joints, not 73; its bone names arrive sanitised from dotted Blender names
 *     (`spine.001_143` -> `spine001_143`, `shoulder.L_117` -> `shoulderL_117`)
 *   - it has no neck bone and seven spine segments; the head is `face_91`
 *   - it binds arms-down, not in a T-pose, and its arms are proportionally long (0.555 m shoulder
 *     to wrist on a 1.75 m body) with a 0.812 m hip-to-ankle leg
 *   - the whole skeleton hangs under a -90 deg Sketchfab wrapper with a 0.861 root scale
 *
 * The author therefore works in world space, reads the real rest metrics from the mounted skeleton,
 * and solves two-bone IK for hands/elbows and ankles/knees against positional targets. Every one of
 * the 158 joints is keyed in every clip, plus the root (`spine_156`) translation, so no strike or
 * gait can inherit a frozen limb from another layer. The source body, skin weights, textures and
 * inverse bind matrices are untouched: the output is a clip-only GLB.
 *
 *   node scripts/author-saitama-clips.mjs [--out public/models/characters/bespoke/saitama_animated.glb]
 */
import './glb-node-compat.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

globalThis.self ||= globalThis;

const BODY = 'public/models/characters/imported/saitama/saitama.glb';
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1] : 'public/models/characters/bespoke/saitama_animated.glb';
const DEG = Math.PI / 180;

const load = file => new Promise((ok, bad) => {
  const buffer = readFileSync(file);
  new GLTFLoader().parse(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '', ok, bad
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
const norm = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// GLTFLoader sanitises Blender's dotted names. Resolve roles by normalised name so the script does
// not depend on which exporter form is present.
const findBone = fragment => {
  const wanted = norm(fragment);
  return bones.find(bone => norm(bone.name) === wanted)
    || bones.find(bone => norm(bone.name).startsWith(wanted))
    || null;
};
const hips = findBone('spine_156');
const spineBones = bones
  .filter(bone => /^spine(00[1-6])/.test(norm(bone.name)))
  .sort((a, b) => norm(a.name).localeCompare(norm(b.name)));
const head = findBone('face_91');
const arm = side => ({
  shoulder: findBone(`shoulder${side}117`) || findBone(`shoulder${side}140`),
  upper: findBone(`upper_arm${side}116`) || findBone(`upper_arm${side}139`),
  fore: findBone(`forearm${side}115`) || findBone(`forearm${side}138`),
  hand: findBone(`hand${side}114`) || findBone(`hand${side}137`)
});
const LEG = side => ({
  thigh: findBone(`thigh${side}150`) || findBone(`thigh${side}155`),
  shin: findBone(`shin${side}149`) || findBone(`shin${side}154`),
  foot: findBone(`foot${side}148`) || findBone(`foot${side}153`),
  toe: findBone(`toe${side}146`) || findBone(`toe${side}151`)
});
const leftArm = arm('L'), rightArm = arm('R');
const leftLeg = LEG('L'), rightLeg = LEG('R');
for (const [label, node] of Object.entries({ hips, head, ...leftArm, ...rightArm, ...leftLeg, ...rightLeg })) {
  if (!node) throw new Error(`missing role ${label} on ${BODY}`);
}
if (spineBones.length !== 6) throw new Error(`expected six spine segments, found ${spineBones.length}`);

// Names are sanitised before matching: `f_index.01.L_97` arrives as `f_index01L_97`, whose
// normalised form has no underscore. Matching the raw spelling silently collected zero bones and
// left every hand open through every strike.
const fingerNames = bones
  .filter(bone => /^f(index|middle|ring|pinky)0[123][lr]/.test(norm(bone.name)))
  .map(bone => bone.name);
const thumbNames = bones
  .filter(bone => /^thumb0[123][lr]/.test(norm(bone.name)))
  .map(bone => bone.name);
if (!fingerNames.length || !thumbNames.length) {
  throw new Error(`finger chains not resolved: ${fingerNames.length} fingers, ${thumbNames.length} thumbs`);
}
const toeNames = [leftLeg.toe.name, rightLeg.toe.name];

// World-space rest metrics. Everything below is solved against these real lengths; no 73-joint
// Goku value is reused.
scene.updateMatrixWorld(true);
const wp = node => node.getWorldPosition(new THREE.Vector3());
const restHips = wp(hips);
const restHead = wp(head);
const restFootQuat = {
  L: leftLeg.foot.getWorldQuaternion(new THREE.Quaternion()),
  R: rightLeg.foot.getWorldQuaternion(new THREE.Quaternion())
};
const FOOT_Y = wp(leftLeg.foot).y;
const LENGTHS = {
  upperArmL: wp(leftArm.upper).distanceTo(wp(leftArm.fore)),
  lowerArmL: wp(leftArm.fore).distanceTo(wp(leftArm.hand)),
  upperArmR: wp(rightArm.upper).distanceTo(wp(rightArm.fore)),
  lowerArmR: wp(rightArm.fore).distanceTo(wp(rightArm.hand)),
  upperLegL: wp(leftLeg.thigh).distanceTo(wp(leftLeg.shin)),
  lowerLegL: wp(leftLeg.shin).distanceTo(wp(leftLeg.foot)),
  upperLegR: wp(rightLeg.thigh).distanceTo(wp(rightLeg.shin)),
  lowerLegR: wp(rightLeg.shin).distanceTo(wp(rightLeg.foot))
};
const hipsParent = hips.parent;
const hipsParentWorldQuat = hipsParent.getWorldQuaternion(new THREE.Quaternion());
const hipsUpLocal = new THREE.Vector3(0, 1, 0)
  .applyQuaternion(hipsParentWorldQuat.clone().invert()).normalize();

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

/**
 * Build a stable world rotation that points local Y along `direction` and local Z toward a
 * reference point. Unlike setFromUnitVectors, this cannot pick an arbitrary axis when the source and
 * target directions approach opposite: the reference resolves the roll every frame.
 */
function basisQuaternion(direction, reference) {
  const y = direction.clone().normalize();
  if (y.lengthSq() < 1e-8) return null;
  const z = reference.clone().addScaledVector(y, -reference.dot(y));
  if (z.lengthSq() < 1e-6) return null;
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  const matrix = new THREE.Matrix4().makeBasis(x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(matrix);
}

// Bind roll per limb bone, expressed as the bone's rest local X axis in its parent's space. The
// previous version derived roll from a world reference projected off the aim direction; when a
// punch aimed along that reference the projection collapsed and the bone flipped a half turn in one
// key. Inheriting the rest X through the parent instead is stable for every direction: at bind the
// basis reproduces the exact rest quaternion, and during a pose only the aim direction changes.
const limbAim = new Map();
for (const bone of [
  leftArm.upper, leftArm.fore, rightArm.upper, rightArm.fore,
  leftLeg.thigh, leftLeg.shin, rightLeg.thigh, rightLeg.shin
]) {
  const parentWorld = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const boneWorld = bone.getWorldQuaternion(new THREE.Quaternion());
  const xLocal = new THREE.Vector3(1, 0, 0).applyQuaternion(boneWorld)
    .applyQuaternion(parentWorld.clone().invert()).normalize();
  limbAim.set(bone, { xLocal });
}

function aimBone(bone, target) {
  scene.updateMatrixWorld(true);
  const origin = bone.getWorldPosition(new THREE.Vector3());
  const y = target.clone().sub(origin);
  if (y.lengthSq() < 1e-8) return;
  y.normalize();
  const parentWorld = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const x = limbAim.get(bone).xLocal.clone().applyQuaternion(parentWorld);
  x.addScaledVector(y, -x.dot(y));
  if (x.lengthSq() < 1e-8) return;
  x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  const basis = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  bone.quaternion.copy(parentWorld.clone().invert().multiply(basis));
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

/** Torso reference: the midpoint of the two upper-arm roots, not a guessed chest height. */
function shoulderMidpoint() {
  return wp(leftArm.upper).add(wp(rightArm.upper)).multiplyScalar(0.5);
}

/**
 * A pose spec is positional, not angular. Hand and elbow values are offsets from the shoulder
 * midpoint; feet and knees are world-space targets. `lift` moves the hips (and therefore the whole
 * body) up or down while grounded feet stay on the floor.
 */
function stance(overrides = {}) {
  const base = {
    lift: -0.035,
    hips: [1.5, 0, 0], spine: [2.5, 0, 0], head: [-2, 0, 0],
    hands: [[0.16, -0.25, 0.14], [-0.16, -0.25, 0.14]],
    elbows: [[0.30, -0.40, 0.04], [-0.30, -0.40, 0.04]],
    wrists: [[0, 0, 0], [0, 0, 0]],
    feet: [[0.105, FOOT_Y, 0.09], [-0.105, FOOT_Y, -0.075]],
    feetRot: [[0, 8, 0], [0, -10, 0]],
    knees: [[0.13, 0.55, 0.36], [-0.13, 0.55, 0.36]],
    fingers: 0.55,
    toes: 0
  };
  const merged = { ...base, ...overrides };
  for (const key of ['hips', 'spine', 'head', 'shoulders', 'hands', 'elbows', 'wrists',
    'feet', 'feetRot', 'knees']) {
    if (overrides[key]) merged[key] = overrides[key].map(value => Array.isArray(value) ? [...value] : value);
  }
  return merged;
}

function cloneSpec(spec) {
  const out = { ...spec };
  for (const key of ['hips', 'spine', 'head', 'shoulders', 'hands', 'elbows', 'wrists', 'feet', 'feetRot', 'knees']) {
    if (Array.isArray(spec[key])) {
      out[key] = spec[key].map(value => Array.isArray(value) ? [...value] : value);
    }
  }
  return out;
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

function cycle(duration, count, specFn) {
  return Array.from({ length: count }, (_, index) => {
    const t = index / (count - 1);
    return { time: +(t * duration).toFixed(4), spec: specFn(t) };
  });
}

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
 * Order: reset -> hips translation -> six spine segments -> head -> leg IK -> arm IK -> level
 * feet -> wrist -> finger curl -> toes. Each child solution reads the world transform its parent
 * just received.
 */
function solve(spec) {
  resetPose();
  hips.position.copy(rest.get(hips).position).addScaledVector(hipsUpLocal, spec.lift);
  setLocalEuler(hips, [spec.hips[0] * 0.35, spec.hips[1] * 0.35, spec.hips[2] * 0.35]);
  const spineWeights = [0.18, 0.18, 0.16, 0.16, 0.16, 0.16];
  spineBones.forEach((bone, index) => {
    const weight = spineWeights[index] || 0.16;
    setLocalEuler(bone, [spec.spine[0] * weight, spec.spine[1] * weight, spec.spine[2] * weight]);
  });
  setLocalEuler(head, [spec.head[0], spec.head[1], spec.head[2]]);
  scene.updateMatrixWorld(true);

  const yaw = (spec.hips[1] * 0.35 + spec.spine[1] * 0.65) * DEG;
  const pitch = (spec.hips[0] * 0.35 + spec.spine[0] * 0.65) * DEG;
  const bodyQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * 0.8, yaw, 0, 'YXZ'));
  const hipsWorld = wp(hips);

  // ---- legs ---------------------------------------------------------------------------------
  for (const [side, leg, index] of [['L', leftLeg, 0], ['R', rightLeg, 1]]) {
    const hipPos = wp(leg.thigh);
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
    const knee = solveTwoBone(hipPos, target, pole,
      LENGTHS[`upperLeg${side}`], LENGTHS[`lowerLeg${side}`]);
    aimBone(leg.thigh, knee);
    aimBone(leg.shin, target);
    // Level the sole against the real rest foot orientation. Without this the boot inherits the
    // solved shin roll and points sideways.
    const foot = leg.foot;
    const parentWorld = foot.parent.getWorldQuaternion(new THREE.Quaternion());
    const [footPitch, footYaw, footRoll] = spec.feetRot[index];
    const desiredWorld = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(footPitch * DEG, footYaw * DEG, footRoll * DEG, 'YXZ'))
      .multiply(restFootQuat[side]);
    foot.quaternion.copy(parentWorld.invert().multiply(desiredWorld));
    scene.updateMatrixWorld(true);
  }

  // ---- arms ---------------------------------------------------------------------------------
  const shoulderMid = shoulderMidpoint();
  for (const [side, chain, index] of [['L', leftArm, 0], ['R', rightArm, 1]]) {
    const shoulderPos = wp(chain.upper);
    const offset = new THREE.Vector3(...spec.hands[index]).applyQuaternion(bodyQuat);
    const target = shoulderMid.clone().add(offset);
    const elbowOffset = new THREE.Vector3(...spec.elbows[index]).applyQuaternion(bodyQuat);
    const pole = shoulderMid.clone().add(elbowOffset);
    const elbow = solveTwoBone(shoulderPos, target, pole,
      LENGTHS[`upperArm${side}`], LENGTHS[`lowerArm${side}`]);
    aimBone(chain.upper, elbow);
    aimBone(chain.fore, target);
    // The wrist correction keeps the palm from continuing along the forearm like a stick.
    const wristDelta = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      spec.wrists[index][0] * DEG, spec.wrists[index][1] * DEG, spec.wrists[index][2] * DEG, 'XYZ'
    ));
    chain.hand.quaternion.multiply(wristDelta);
    scene.updateMatrixWorld(true);
  }

  const curl = clamp(spec.fingers, 0, 1) * 65 * DEG;
  for (const name of fingerNames) {
    const bone = byName.get(name);
    if (!bone) continue;
    // Rigify finger chains run along local Y and bend around local X. The sign is body-specific:
    // this rig's +X closes the tip toward the palm, while -X hyperextends it (measured with
    // scripts/probe-saitama-fingers.mjs, not assumed from the Goku skeleton).
    bone.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(curl, 0, 0, 'XYZ')));
  }
  // The thumb folds across the palm as well as down, so it takes a smaller X curl and a Z roll.
  for (const name of thumbNames) {
    const bone = byName.get(name);
    if (!bone) continue;
    bone.quaternion.multiply(new THREE.Quaternion().setFromEuler(
      new THREE.Euler(curl * 0.55, 0, (name.includes('L') ? -1 : 1) * curl * 0.10, 'XYZ')
    ));
  }
  const toeAngle = clamp(spec.toes, 0, 1) * 34 * DEG;
  for (const name of toeNames) {
    const toe = byName.get(name);
    if (toe) toe.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-toeAngle, 0, 0, 'XYZ')));
  }
  scene.updateMatrixWorld(true);

  const snapshot = { quaternions: new Map(), hipsPosition: hips.position.clone() };
  for (const bone of bones) snapshot.quaternions.set(bone.name, bone.quaternion.clone());
  return snapshot;
}

// ---------------------------------------------------------------- clip catalogue
// Every clip keeps its shipped name and duration. Saitama's body has no neck and no separate
// clavicle controls, so the pose language uses the seven-spine chain and world-space arm targets.
const CLIPS = {};
// Prefix the authored clips. The mounted body already ships clips with the state names (`idle`,
// `walk`, ...), and the reaction binder treats a set whose every clip name is already present in
// the mounted bank as a fast path and never fetches an external file. A distinct prefix makes the
// authored set authoritative while the slots keep pointing at one honest clip per state.
const addClip = (name, duration, loop, keys) => { CLIPS[`Saitama_${name}`] = { duration, loop, keys }; };
const guard = () => stance({
  lift: -0.06,
  hips: [2, 0, 0], spine: [3, 0, 0], head: [-2, 0, 0],
  hands: [[0.13, -0.18, 0.30], [-0.13, -0.18, 0.30]],
  elbows: [[0.28, -0.30, 0.10], [-0.28, -0.30, 0.10]],
  fingers: 0.9
});

function idleSpec(t) {
  const phase = t * Math.PI * 2;
  const breathe = Math.sin(phase);
  const shift = Math.sin(phase * 0.5);
  return stance({
    lift: -0.04 + breathe * 0.006,
    hips: [1.5, shift * 1.2, 0],
    spine: [2.5 + breathe * 1.4, -shift * 1.4, 0],
    head: [-2 - breathe * 0.8, shift * 2.6, 0],
    hands: [
      [0.16 + breathe * 0.005, -0.25 + breathe * 0.007, 0.14 + breathe * 0.008],
      [-0.16 - breathe * 0.005, -0.25 - breathe * 0.006, 0.14 + breathe * 0.01]
    ],
    elbows: [
      [0.30 + breathe * 0.005, -0.40 + breathe * 0.004, 0.04],
      [-0.30 - breathe * 0.005, -0.40 + breathe * 0.004, 0.04]
    ],
    fingers: 0.75
  });
}
addClip('idle', 0.9833, true, cycle(0.9833, 19, idleSpec));

function walkSpec(t) {
  const phase = t * Math.PI * 2;
  const swing = Math.sin(phase);
  const leftLift = Math.max(0, Math.sin(phase)) * 0.10;
  const rightLift = Math.max(0, -Math.sin(phase)) * 0.10;
  const leftForward = swing * 0.22;
  const rightForward = -swing * 0.22;
  const armSwing = swing * 0.12;
  return stance({
    lift: -0.045 + Math.abs(Math.sin(phase * 2)) * 0.012,
    hips: [2, swing * 6, 0],
    spine: [3, -swing * 5, swing * 1.8],
    head: [-2, swing * 2.5, 0],
    hands: [
      [0.16 + swing * 0.008, -0.24, 0.13 + armSwing],
      [-0.16 + swing * 0.008, -0.24, 0.13 - armSwing]
    ],
    elbows: [
      [0.30, -0.39, 0.03 + armSwing * 0.5],
      [-0.30, -0.39, 0.03 - armSwing * 0.5]
    ],
    feet: [
      [0.105 + swing * 0.008, FOOT_Y + leftLift, 0.09 + leftForward],
      [-0.105 + swing * 0.008, FOOT_Y + rightLift, -0.075 + rightForward]
    ],
    feetRot: [
      [leftLift > 0.02 ? -24 : 0, 8 + swing * 6, 0],
      [rightLift > 0.02 ? -24 : 0, -10 - swing * 6, 0]
    ],
    knees: [
      [0.13, 0.55, 0.36 + leftForward * 0.8],
      [-0.13, 0.55, 0.36 + rightForward * 0.8]
    ],
    fingers: 0.85, toes: 0.18
  });
}
addClip('walk', 0.9833, true, cycle(0.9833, 21, walkSpec));

function runSpec(t) {
  const phase = t * Math.PI * 2;
  const swing = Math.sin(phase);
  const leftLift = Math.max(0, Math.sin(phase)) * 0.24;
  const rightLift = Math.max(0, -Math.sin(phase)) * 0.24;
  const leftForward = swing * 0.32;
  const rightForward = -swing * 0.32;
  return stance({
    lift: -0.06 + Math.abs(Math.sin(phase * 2)) * 0.05,
    hips: [12, swing * 9, 0],
    spine: [12, -swing * 7, swing * 2.6],
    head: [-14, swing * 2.5, 0],
    hands: [
      [0.16 + swing * 0.012, -0.22, 0.11 + swing * 0.24],
      [-0.16 - swing * 0.012, -0.22, 0.11 - swing * 0.24]
    ],
    elbows: [
      [0.30, -0.34, 0.03 + swing * 0.12],
      [-0.30, -0.34, 0.03 - swing * 0.12]
    ],
    feet: [
      [0.10, FOOT_Y + leftLift, 0.09 + leftForward],
      [-0.10, FOOT_Y + rightLift, -0.075 + rightForward]
    ],
    feetRot: [
      [leftLift > 0.04 ? -34 : 0, 8 + swing * 8, 0],
      [rightLift > 0.04 ? -34 : 0, -10 - swing * 8, 0]
    ],
    knees: [
      [0.13, 0.58, 0.44 + leftForward * 0.85],
      [-0.13, 0.58, 0.44 + rightForward * 0.85]
    ],
    fingers: 0.9, toes: 0.35
  });
}
addClip('run', 0.65, true, cycle(0.65, 19, runSpec));

function sprintSpec(t) {
  const phase = t * Math.PI * 2;
  const swing = Math.sin(phase);
  const leftLift = Math.max(0, Math.sin(phase)) * 0.34;
  const rightLift = Math.max(0, -Math.sin(phase)) * 0.34;
  const leftForward = swing * 0.40;
  const rightForward = -swing * 0.40;
  return stance({
    lift: -0.07 + Math.abs(Math.sin(phase * 2)) * 0.07,
    hips: [20, swing * 11, 0],
    spine: [16, -swing * 9, swing * 3],
    head: [-24, swing * 2, 0],
    hands: [
      [0.16 + swing * 0.014, -0.20, 0.08 + swing * 0.32],
      [-0.16 - swing * 0.014, -0.20, 0.08 - swing * 0.32]
    ],
    elbows: [
      [0.30, -0.30, 0.02 + swing * 0.16],
      [-0.30, -0.30, 0.02 - swing * 0.16]
    ],
    feet: [
      [0.095, FOOT_Y + leftLift, 0.09 + leftForward],
      [-0.095, FOOT_Y + rightLift, -0.075 + rightForward]
    ],
    feetRot: [
      [leftLift > 0.05 ? -40 : 0, 8 + swing * 10, 0],
      [rightLift > 0.05 ? -40 : 0, -10 - swing * 10, 0]
    ],
    knees: [
      [0.13, 0.60, 0.52 + leftForward * 0.9],
      [-0.13, 0.60, 0.52 + rightForward * 0.9]
    ],
    fingers: 0.95, toes: 0.45
  });
}
addClip('sprint', 0.5333, true, cycle(0.5333, 17, sprintSpec));

addClip('jump', 0.5167, false, timeline(0.5167, 15, [
  { time: 0, spec: stance({ lift: -0.04 }) },
  { time: 0.09, spec: stance({ lift: -0.16, hips: [10, 0, 0], spine: [16, 0, 0], head: [4, 0, 0],
    hands: [[0.16, -0.34, 0.06], [-0.16, -0.34, 0.06]], elbows: [[0.30, -0.46, 0.02], [-0.30, -0.46, 0.02]],
    feet: [[0.12, FOOT_Y, 0.05], [-0.12, FOOT_Y, -0.05]], knees: [[0.14, 0.44, 0.40], [-0.14, 0.44, 0.40]] }) },
  { time: 0.18, spec: stance({ lift: 0.08, hips: [-4, 0, 0], spine: [-2, 0, 0], head: [2, 0, 0],
    hands: [[0.18, -0.12, 0.14], [-0.18, -0.12, 0.14]], elbows: [[0.32, -0.30, 0.04], [-0.32, -0.30, 0.04]],
    feet: [[0.11, FOOT_Y + 0.12, 0.04], [-0.11, FOOT_Y + 0.12, -0.04]], feetRot: [[28, 8, 0], [28, -10, 0]] }) },
  { time: 0.30, spec: stance({ lift: 0.40, hips: [6, 0, 0], spine: [8, 0, 0], head: [-8, 0, 0],
    hands: [[0.18, -0.20, 0.16], [-0.18, -0.20, 0.16]], elbows: [[0.32, -0.36, 0.06], [-0.32, -0.36, 0.06]],
    feet: [[0.13, FOOT_Y + 0.24, 0.11], [-0.13, FOOT_Y + 0.26, -0.01]], feetRot: [[-22, 8, 0], [-20, -10, 0]],
    knees: [[0.16, 0.86, 0.44], [-0.16, 0.88, 0.42]] }) },
  { time: 0.42, spec: stance({ lift: 0.28, hips: [4, 0, 0], spine: [5, 0, 0],
    feet: [[0.12, FOOT_Y + 0.24, 0.10], [-0.12, FOOT_Y + 0.26, -0.03]], feetRot: [[-18, 8, 0], [-16, -10, 0]],
    knees: [[0.15, 0.90, 0.44], [-0.15, 0.92, 0.42]] }) },
  { time: 0.5167, spec: stance({ lift: 0.12, feet: [[0.11, FOOT_Y + 0.12, 0.08], [-0.11, FOOT_Y + 0.14, -0.03]],
    feetRot: [[-10, 8, 0], [-8, -10, 0]] }) }
]));

addClip('land', 0.4167, false, timeline(0.4167, 12, [
  { time: 0, spec: stance({ lift: 0.14, feet: [[0.11, FOOT_Y + 0.13, 0.08], [-0.11, FOOT_Y + 0.15, -0.03]],
    feetRot: [[-10, 8, 0], [-8, -10, 0]] }) },
  { time: 0.07, spec: stance({ lift: -0.17, hips: [10, 0, 0], spine: [18, 0, 0], head: [6, 0, 0],
    hands: [[0.18, -0.34, 0.22], [-0.18, -0.34, 0.22]], elbows: [[0.34, -0.44, 0.10], [-0.34, -0.44, 0.10]],
    feet: [[0.13, FOOT_Y, 0.03], [-0.13, FOOT_Y, -0.03]], knees: [[0.15, 0.42, 0.42], [-0.15, 0.42, 0.42]] }) },
  { time: 0.18, spec: stance({ lift: -0.10, hips: [5, 0, 0], spine: [9, 0, 0],
    hands: [[0.17, -0.28, 0.17], [-0.17, -0.28, 0.17]], knees: [[0.14, 0.50, 0.39], [-0.14, 0.50, 0.39]] }) },
  { time: 0.4167, spec: stance() }
]));

addClip('dodge', 0.45, false, timeline(0.45, 13, [
  { time: 0, spec: guard() },
  { time: 0.08, spec: stance({ lift: -0.09, hips: [2, -22, 0], spine: [4, -14, 0], head: [-2, 18, 0],
    hands: [[0.14, -0.20, 0.28], [-0.14, -0.18, 0.30]], elbows: [[0.30, -0.32, 0.10], [-0.30, -0.30, 0.12]],
    feet: [[0.14, FOOT_Y, 0.10], [-0.14, FOOT_Y, -0.06]], feetRot: [[0, 18, 0], [0, 0, 0]] }) },
  { time: 0.18, spec: stance({ lift: -0.03, hips: [2, -38, 0], spine: [5, -20, 0], head: [-2, 26, 0],
    hands: [[0.16, -0.20, 0.26], [-0.16, -0.18, 0.28]],
    feet: [[0.24, FOOT_Y, 0.02], [-0.06, FOOT_Y + 0.10, -0.12]], feetRot: [[-18, 26, 0], [0, 6, 0]],
    knees: [[0.26, 0.58, 0.38], [-0.06, 0.64, 0.32]] }) },
  { time: 0.30, spec: stance({ lift: -0.08, hips: [2, -26, 0], spine: [4, -14, 0], head: [-2, 18, 0],
    hands: [[0.15, -0.20, 0.28], [-0.15, -0.18, 0.30]],
    feet: [[0.22, FOOT_Y, 0.06], [-0.08, FOOT_Y, -0.10]], feetRot: [[0, 22, 0], [0, 4, 0]] }) },
  { time: 0.45, spec: guard() }
]));

function chargeSpec(t) {
  const phase = t * Math.PI * 2;
  const pulse = Math.sin(phase);
  return stance({
    lift: -0.14 + pulse * 0.008,
    hips: [10, pulse * 2, 0], spine: [14, -pulse * 1.5, 0], head: [2 + pulse, pulse * 1.5, 0],
    hands: [[0.20, -0.34, -0.02 + pulse * 0.006], [-0.20, -0.34, -0.02 - pulse * 0.006]],
    elbows: [[0.34, -0.40, -0.10], [-0.34, -0.40, -0.10]],
    knees: [[0.16, 0.44, 0.40], [-0.16, 0.44, 0.40]],
    fingers: 1, toes: 0.25
  });
}
addClip('charge', 0.8167, true, cycle(0.8167, 19, chargeSpec));

addClip('beam', 0.4833, false, timeline(0.4833, 15, [
  { time: 0, spec: guard() },
  { time: 0.10, spec: stance({ lift: -0.10, hips: [4, -34, 0], spine: [8, -20, 0], head: [-2, 22, 0],
    hands: [[0.15, -0.20, 0.26], [-0.18, -0.20, 0.02]], elbows: [[0.32, -0.32, 0.12], [-0.32, -0.32, -0.06]],
    feet: [[0.12, FOOT_Y, 0.08], [-0.13, FOOT_Y, -0.08]], feetRot: [[0, 20, 0], [0, -2, 0]], fingers: 1 }) },
  { time: 0.21, spec: stance({ lift: -0.07, hips: [2, 30, 0], spine: [5, 20, 0], head: [-2, -18, 0],
    hands: [[0.16, -0.22, 0.16], [-0.02, -0.04, 0.60]], elbows: [[0.32, -0.34, 0.06], [-0.30, -0.30, 0.30]],
    feet: [[0.13, FOOT_Y + 0.04, 0.10], [-0.13, FOOT_Y, -0.08]], feetRot: [[0, 20, 0], [0, 26, 0]],
    fingers: 1, toes: 0.4 }) },
  { time: 0.31, spec: stance({ lift: -0.09, hips: [2, 24, 0], spine: [5, 15, 0], head: [-2, -14, 0],
    hands: [[0.16, -0.24, 0.18], [-0.04, -0.06, 0.54]], elbows: [[0.32, -0.36, 0.06], [-0.32, -0.32, 0.26]],
    feet: [[0.13, FOOT_Y, 0.09], [-0.13, FOOT_Y, -0.08]], feetRot: [[0, 22, 0], [16, -2, 0]], fingers: 1 }) },
  { time: 0.4833, spec: guard() }
]));

addClip('launcher', 0.5833, false, timeline(0.5833, 16, [
  { time: 0, spec: guard() },
  { time: 0.10, spec: stance({ lift: -0.17, hips: [10, 0, 0], spine: [16, 0, 0], head: [4, 0, 0],
    hands: [[0.16, -0.32, 0.08], [-0.16, -0.32, 0.08]], elbows: [[0.32, -0.44, 0.02], [-0.32, -0.44, 0.02]],
    knees: [[0.15, 0.42, 0.42], [-0.15, 0.42, 0.42]], fingers: 1 }) },
  { time: 0.24, spec: stance({ lift: 0.04, hips: [-6, 10, 0], spine: [-8, 6, 0], head: [4, -4, 0],
    hands: [[0.16, -0.16, 0.18], [-0.04, 0.16, 0.34]], elbows: [[0.32, -0.30, 0.06], [-0.34, -0.04, 0.20]],
    feet: [[0.12, FOOT_Y + 0.05, 0.10], [-0.12, FOOT_Y, -0.06]], feetRot: [[0, 10, 0], [0, 22, 0]],
    fingers: 1, toes: 0.4 }) },
  { time: 0.38, spec: stance({ lift: -0.02, hips: [0, 6, 0], spine: [-2, 4, 0],
    hands: [[0.16, -0.18, 0.20], [-0.06, 0.02, 0.28]], elbows: [[0.32, -0.32, 0.08], [-0.34, -0.10, 0.16]],
    feet: [[0.12, FOOT_Y, 0.09], [-0.12, FOOT_Y, -0.06]], feetRot: [[0, 10, 0], [10, -6, 0]], fingers: 1 }) },
  { time: 0.5833, spec: guard() }
]));

addClip('jab', 0.3167, false, timeline(0.3167, 13, [
  { time: 0, spec: guard() },
  { time: 0.06, spec: stance({ lift: -0.065, hips: [2, -10, 0], spine: [3, -7, 0], head: [-2, 8, 0],
    hands: [[0.13, -0.18, 0.28], [-0.15, -0.19, 0.24]], elbows: [[0.28, -0.30, 0.10], [-0.29, -0.31, 0.06]],
    fingers: 0.95 }) },
  { time: 0.14, spec: stance({ lift: -0.075, hips: [2, 28, 0], spine: [5, 19, 0], head: [-2, -16, 0],
    hands: [[0.13, -0.14, 0.26], [-0.02, -0.04, 0.62]], elbows: [[0.29, -0.30, 0.12], [-0.28, -0.30, 0.30]],
    feet: [[0.12, FOOT_Y, 0.10], [-0.12, FOOT_Y + 0.045, -0.07]], feetRot: [[0, 12, 0], [0, 24, 0]],
    fingers: 1, toes: 0.4 }) },
  { time: 0.22, spec: stance({ lift: -0.07, hips: [2, 20, 0], spine: [4, 12, 0], head: [-2, -10, 0],
    hands: [[0.14, -0.20, 0.24], [-0.04, -0.06, 0.50]], elbows: [[0.28, -0.31, 0.08], [-0.30, -0.30, 0.20]],
    feet: [[0.12, FOOT_Y, 0.09], [-0.12, FOOT_Y + 0.02, -0.07]], feetRot: [[0, 12, 0], [12, -8, 0]], fingers: 1 }) },
  { time: 0.3167, spec: guard() }
]));

addClip('heavy_punch', 0.55, false, timeline(0.55, 17, [
  { time: 0, spec: guard() },
  { time: 0.14, spec: stance({ lift: -0.10, hips: [4, -38, 0], spine: [8, -24, 0], head: [-2, 26, 0],
    hands: [[0.15, -0.20, 0.24], [-0.18, -0.24, 0.02]], elbows: [[0.32, -0.34, 0.10], [-0.34, -0.36, -0.04]],
    feet: [[0.12, FOOT_Y, 0.06], [-0.13, FOOT_Y, -0.09]], feetRot: [[0, 18, 0], [0, -4, 0]], fingers: 1 }) },
  { time: 0.28, spec: stance({ lift: -0.09, hips: [2, 36, 0], spine: [7, 23, 0], head: [-2, -20, 0],
    hands: [[0.10, -0.06, 0.12], [-0.01, -0.02, 0.62]], elbows: [[0.30, -0.28, 0.02], [-0.28, -0.28, 0.30]],
    feet: [[0.13, FOOT_Y + 0.03, 0.11], [-0.13, FOOT_Y, -0.08]], feetRot: [[0, 20, 0], [0, 28, 0]],
    fingers: 1, toes: 0.5 }) },
  { time: 0.42, spec: stance({ lift: -0.08, hips: [2, 28, 0], spine: [6, 17, 0], head: [-2, -14, 0],
    hands: [[0.10, -0.08, 0.14], [-0.03, -0.04, 0.50]], elbows: [[0.30, -0.30, 0.02], [-0.30, -0.30, 0.22]],
    feet: [[0.13, FOOT_Y, 0.10], [-0.13, FOOT_Y, -0.08]], feetRot: [[0, 18, 0], [16, -6, 0]], fingers: 1 }) },
  { time: 0.55, spec: guard() }
]));

function blockSpec(t) {
  const phase = t * Math.PI * 2;
  const breathe = Math.sin(phase);
  return stance({
    lift: -0.09 + breathe * 0.004,
    hips: [3, 0, 0], spine: [5 + breathe * 0.8, 0, 0], head: [-3, 0, 0],
    hands: [[0.10 + breathe * 0.004, -0.10 + breathe * 0.006, 0.26 + breathe * 0.005],
      [-0.10 - breathe * 0.004, -0.10 + breathe * 0.006, 0.26 + breathe * 0.005]],
    elbows: [[0.26, -0.26, 0.10 + breathe * 0.006], [-0.26, -0.26, 0.10 + breathe * 0.006]],
    head: [-3 + breathe * 1.5, 0, 0],
    fingers: 1, toes: 0.1
  });
}
addClip('block', 0.45, true, cycle(0.45, 13, blockSpec));

addClip('hit_light', 0.3167, false, timeline(0.3167, 11, [
  { time: 0, spec: stance() },
  { time: 0.05, spec: stance({ lift: -0.06, hips: [-6, 12, 0], spine: [-12, 8, 0], head: [10, -10, 0],
    hands: [[0.20, -0.28, 0.08], [-0.20, -0.26, 0.10]], elbows: [[0.34, -0.40, 0.02], [-0.34, -0.38, 0.04]],
    feet: [[0.11, FOOT_Y, 0.05], [-0.12, FOOT_Y, -0.10]], fingers: 0.4 }) },
  { time: 0.16, spec: stance({ lift: -0.05, hips: [-2, 6, 0], spine: [-4, 4, 0], head: [4, -4, 0],
    hands: [[0.18, -0.26, 0.10], [-0.18, -0.26, 0.12]] }) },
  { time: 0.3167, spec: stance() }
]));

addClip('hit_heavy', 0.6167, false, timeline(0.6167, 15, [
  { time: 0, spec: stance() },
  { time: 0.09, spec: stance({ lift: -0.10, hips: [-10, 18, 0], spine: [-20, 12, 0], head: [16, -14, 0],
    hands: [[0.22, -0.32, 0.02], [-0.22, -0.30, 0.04]], elbows: [[0.36, -0.40, -0.02], [-0.36, -0.38, 0.0]],
    feet: [[0.11, FOOT_Y, 0.0], [-0.13, FOOT_Y, -0.16]], feetRot: [[-10, 10, 0], [-6, -14, 0]], fingers: 0.3 }) },
  { time: 0.26, spec: stance({ lift: -0.16, hips: [-4, 14, 0], spine: [-10, 8, 0], head: [10, -8, 0],
    hands: [[0.20, -0.34, 0.06], [-0.20, -0.32, 0.08]], feet: [[0.12, FOOT_Y, -0.04], [-0.14, FOOT_Y, -0.18]] }) },
  { time: 0.42, spec: stance({ lift: -0.09, hips: [2, 6, 0], spine: [2, 4, 0], head: [0, -4, 0],
    feet: [[0.12, FOOT_Y, 0.02], [-0.13, FOOT_Y, -0.12]] }) },
  { time: 0.6167, spec: stance() }
]));

const lying = () => stance({
  lift: -0.62,
  hips: [-78, 0, 0], spine: [-18, 0, 0], head: [34, 0, 0],
  hands: [[0.34, -0.28, -0.16], [-0.34, -0.28, -0.16]],
  elbows: [[0.46, -0.30, -0.10], [-0.46, -0.30, -0.10]],
  feet: [[0.15, FOOT_Y + 0.24, 0.40], [-0.15, FOOT_Y + 0.28, 0.38]],
  feetRot: [[-40, 8, 0], [-38, -10, 0]],
  knees: [[0.18, 0.55, 0.52], [-0.18, 0.58, 0.50]],
  fingers: 0.3
});
addClip('knockdown', 0.55, false, timeline(0.55, 17, [
  { time: 0, spec: stance() },
  { time: 0.10, spec: stance({ lift: -0.10, hips: [-22, 10, 0], spine: [-26, 6, 0], head: [24, -8, 0],
    hands: [[0.24, -0.34, 0.0], [-0.22, -0.32, 0.04]], feet: [[0.12, FOOT_Y, 0.02], [-0.14, FOOT_Y, -0.16]] }) },
  { time: 0.25, spec: stance({ lift: -0.36, hips: [-52, 6, 0], spine: [-30, 4, 0], head: [40, -4, 0],
    hands: [[0.32, -0.34, -0.10], [-0.30, -0.32, -0.08]], elbows: [[0.44, -0.34, -0.06], [-0.44, -0.34, -0.06]],
    feet: [[0.14, FOOT_Y + 0.16, 0.24], [-0.14, FOOT_Y + 0.18, 0.22]], feetRot: [[-34, 8, 0], [-32, -10, 0]],
    knees: [[0.18, 0.58, 0.48], [-0.18, 0.60, 0.46]] }) },
  { time: 0.40, spec: lying() },
  { time: 0.55, spec: lying() }
]));

addClip('get_up', 0.7833, false, timeline(0.7833, 17, [
  { time: 0, spec: lying() },
  { time: 0.18, spec: stance({ lift: -0.50, hips: [-48, 0, 0], spine: [-16, 0, 0], head: [28, 0, 0],
    hands: [[0.30, -0.40, 0.06], [-0.30, -0.40, 0.06]], elbows: [[0.44, -0.42, 0.04], [-0.44, -0.42, 0.04]],
    feet: [[0.15, FOOT_Y + 0.10, 0.30], [-0.16, FOOT_Y + 0.12, 0.26]], feetRot: [[-28, 8, 0], [-26, -10, 0]],
    knees: [[0.20, 0.52, 0.48], [-0.20, 0.54, 0.46]] }) },
  { time: 0.38, spec: stance({ lift: -0.36, hips: [24, 0, 0], spine: [18, 0, 0], head: [-8, 0, 0],
    hands: [[0.22, -0.48, 0.18], [-0.22, -0.48, 0.18]], elbows: [[0.38, -0.50, 0.10], [-0.38, -0.50, 0.10]],
    feet: [[0.14, FOOT_Y + 0.06, 0.18], [-0.15, FOOT_Y, -0.12]], feetRot: [[-16, 8, 0], [0, -8, 0]],
    knees: [[0.18, 0.40, 0.44], [-0.18, 0.40, 0.40]] }) },
  { time: 0.62, spec: stance({ lift: -0.16, hips: [10, 0, 0], spine: [10, 0, 0],
    hands: [[0.18, -0.34, 0.16], [-0.18, -0.34, 0.16]], feet: [[0.12, FOOT_Y, 0.08], [-0.12, FOOT_Y, -0.06]],
    knees: [[0.15, 0.46, 0.40], [-0.15, 0.46, 0.40]] }) },
  { time: 0.7833, spec: stance() }
]));

function flySpec(t) {
  const phase = t * Math.PI * 2;
  const drift = Math.sin(phase);
  return stance({
    lift: 0.24 + drift * 0.02,
    hips: [38, drift * 4, drift * 2], spine: [8, -drift * 2.5, drift * 2], head: [-34, drift * 6, 0],
    hands: [[0.16, -0.04 + drift * 0.02, 0.46], [-0.16, -0.02 - drift * 0.02, 0.46]],
    elbows: [[0.30, -0.16 + drift * 0.015, 0.28], [-0.30, -0.16 - drift * 0.015, 0.28]],
    feet: [[0.10, FOOT_Y + 0.18 + drift * 0.01, -0.12], [-0.10, FOOT_Y + 0.20 - drift * 0.01, -0.14 - drift * 0.03]],
    feetRot: [[-34, 8, 0], [-32, -10, 0]],
    knees: [[0.14, 0.74, 0.14], [-0.14, 0.76, 0.12]],
    fingers: 0.7
  });
}
addClip('fly', 0.7833, true, cycle(0.7833, 17, flySpec));

function hoverSpec(t) {
  const phase = t * Math.PI * 2;
  const drift = Math.sin(phase);
  return stance({
    lift: 0.40 + drift * 0.02,
    hips: [6, drift * 4, drift * 2], spine: [-4, -drift * 3, drift * 2], head: [2 + drift * 2, drift * 5, 0],
    hands: [[0.34 + drift * 0.02, -0.12 + drift * 0.015, 0.10], [-0.34 + drift * 0.02, -0.12 - drift * 0.015, 0.10]],
    elbows: [[0.44 + drift * 0.015, -0.26, 0.04], [-0.44 + drift * 0.015, -0.26, 0.04]],
    feet: [[0.13, FOOT_Y + 0.22, 0.14], [-0.13, FOOT_Y + 0.26, 0.08]],
    feetRot: [[-26, 8, 0], [-30, -10, 0]],
    knees: [[0.16, 0.82, 0.30], [-0.16, 0.84, 0.28]],
    fingers: 0.7
  });
}
addClip('hover', 0.7833, true, cycle(0.7833, 17, hoverSpec));

addClip('air_attack', 0.45, false, timeline(0.45, 14, [
  { time: 0, spec: stance({ lift: 0.32, hips: [14, 0, 0], spine: [8, 0, 0], head: [-16, 0, 0],
    hands: [[0.18, -0.20, 0.20], [-0.18, -0.20, 0.20]],
    feet: [[0.12, FOOT_Y + 0.22, 0.04], [-0.12, FOOT_Y + 0.24, 0.01]], feetRot: [[-22, 8, 0], [-20, -10, 0]],
    knees: [[0.16, 0.84, 0.32], [-0.16, 0.86, 0.30]] }) },
  { time: 0.12, spec: stance({ lift: 0.30, hips: [14, -18, 0], spine: [10, -10, 0], head: [-14, 14, 0],
    hands: [[0.18, -0.22, 0.16], [-0.18, -0.26, 0.10]], feet: [[0.12, FOOT_Y + 0.40, 0.08], [-0.12, FOOT_Y + 0.42, 0.04]],
    feetRot: [[-26, 8, 0], [-24, -10, 0]], fingers: 1 }) },
  { time: 0.24, spec: stance({ lift: 0.30, hips: [8, 22, 0], spine: [5, 15, 0], head: [-10, -16, 0],
    hands: [[0.16, -0.22, 0.18], [-0.02, -0.08, 0.58]], elbows: [[0.32, -0.32, 0.06], [-0.28, -0.30, 0.28]],
    feet: [[0.12, FOOT_Y + 0.38, 0.06], [-0.12, FOOT_Y + 0.40, 0.02]], feetRot: [[-24, 8, 0], [-22, -10, 0]],
    fingers: 1, toes: 0.3 }) },
  { time: 0.45, spec: stance({ lift: 0.32, hips: [14, 0, 0], spine: [8, 0, 0], head: [-16, 0, 0],
    hands: [[0.18, -0.20, 0.20], [-0.18, -0.20, 0.20]],
    feet: [[0.12, FOOT_Y + 0.32, 0.05], [-0.12, FOOT_Y + 0.34, 0.02]], feetRot: [[-24, 8, 0], [-22, -10, 0]] }) }
]));

addClip('parry', 0.35, false, timeline(0.35, 12, [
  { time: 0, spec: guard() },
  { time: 0.07, spec: stance({ lift: -0.07, hips: [3, 20, 0], spine: [4, 14, 0], head: [-2, -12, 0],
    hands: [[0.04, -0.12, 0.34], [-0.12, -0.16, 0.24]], elbows: [[0.26, -0.28, 0.14], [-0.28, -0.30, 0.08]],
    feet: [[0.12, FOOT_Y, 0.08], [-0.12, FOOT_Y, -0.07]], feetRot: [[0, 18, 0], [0, -6, 0]], fingers: 0.95 }) },
  { time: 0.16, spec: stance({ lift: -0.06, hips: [3, 14, 0], spine: [4, 10, 0], head: [-2, -8, 0],
    hands: [[0.02, -0.14, 0.30], [-0.14, -0.16, 0.26]], elbows: [[0.26, -0.30, 0.12], [-0.28, -0.30, 0.08]],
    feet: [[0.12, FOOT_Y, 0.08], [-0.12, FOOT_Y, -0.07]], feetRot: [[0, 16, 0], [0, -8, 0]], fingers: 0.95 }) },
  { time: 0.35, spec: guard() }
]));

function strafeSpec(t) {
  const phase = t * Math.PI * 2;
  const swing = Math.sin(phase);
  const liftL = Math.max(0, Math.sin(phase)) * 0.10;
  const liftR = Math.max(0, -Math.sin(phase)) * 0.10;
  return stance({
    lift: -0.05 + Math.abs(Math.sin(phase * 2)) * 0.008,
    hips: [2, swing * 4, 0], spine: [4, -swing * 3, swing * 3], head: [-2, -swing * 2, 0],
    hands: [[0.14, -0.18, 0.28], [-0.14, -0.18, 0.28]],
    elbows: [[0.28, -0.30, 0.10], [-0.28, -0.30, 0.10]],
    feet: [[0.18 + swing * 0.06, FOOT_Y + liftL, 0.08], [-0.18 + swing * 0.06, FOOT_Y + liftR, -0.07]],
    feetRot: [[liftL > 0.02 ? -20 : 0, 10, 0], [liftR > 0.02 ? -20 : 0, -10, 0]],
    knees: [[0.20, 0.55, 0.38], [-0.20, 0.55, 0.38]],
    fingers: 0.85
  });
}
addClip('strafe', 0.55, true, cycle(0.55, 15, strafeSpec));

addClip('throw', 0.5833, false, timeline(0.5833, 16, [
  { time: 0, spec: guard() },
  { time: 0.12, spec: stance({ lift: -0.08, hips: [4, 0, 0], spine: [6, 0, 0], head: [-2, 0, 0],
    hands: [[0.12, -0.14, 0.42], [-0.12, -0.14, 0.42]], elbows: [[0.30, -0.28, 0.20], [-0.30, -0.28, 0.20]],
    feet: [[0.12, FOOT_Y, 0.10], [-0.12, FOOT_Y, -0.08]], fingers: 1 }) },
  { time: 0.26, spec: stance({ lift: -0.10, hips: [4, 52, 0], spine: [6, 30, 0], head: [-2, -30, 0],
    hands: [[0.18, -0.16, 0.32], [-0.16, -0.16, 0.30]], elbows: [[0.32, -0.30, 0.16], [-0.32, -0.30, 0.14]],
    feet: [[0.12, FOOT_Y, 0.08], [-0.14, FOOT_Y, -0.10]], feetRot: [[0, 40, 0], [0, 20, 0]], fingers: 1 }) },
  { time: 0.40, spec: stance({ lift: -0.08, hips: [2, 82, 0], spine: [4, 34, 0], head: [-2, -36, 0],
    hands: [[0.20, -0.20, 0.18], [-0.18, -0.20, 0.16]], elbows: [[0.34, -0.32, 0.08], [-0.34, -0.32, 0.06]],
    feet: [[0.12, FOOT_Y, 0.06], [-0.14, FOOT_Y, -0.10]], feetRot: [[0, 62, 0], [0, 34, 0]], fingers: 0.5 }) },
  { time: 0.5833, spec: guard() }
]));

addClip('victory', 0.95, false, timeline(0.95, 20, [
  { time: 0, spec: stance() },
  { time: 0.18, spec: stance({ lift: -0.045, hips: [1, 0, 0], spine: [2, 0, 0], head: [-1, 0, 0],
    hands: [[0.02, -0.16, 0.26], [-0.02, -0.14, 0.26]], elbows: [[0.32, -0.34, 0.10], [-0.32, -0.34, 0.10]],
    fingers: 0.7 }) },
  { time: 0.34, spec: stance({ lift: -0.04, hips: [1, 0, 0], spine: [2, 0, 0], head: [-1, 8, 0],
    hands: [[-0.10, -0.12, 0.22], [0.10, -0.10, 0.24]], elbows: [[0.34, -0.30, 0.06], [-0.34, -0.30, 0.06]],
    fingers: 0.7 }) },
  { time: 0.62, spec: stance({ lift: -0.04, hips: [1, 0, 0], spine: [2, 0, 0], head: [-1, 10, 0],
    hands: [[-0.10, -0.12, 0.22], [0.10, -0.10, 0.24]], elbows: [[0.34, -0.30, 0.06], [-0.34, -0.30, 0.06]],
    fingers: 0.7 }) },
  { time: 0.78, spec: stance({ lift: -0.04, hips: [1, 0, 0], spine: [2, 0, 0], head: [-1, -6, 0],
    hands: [[-0.10, -0.13, 0.22], [0.10, -0.11, 0.24]], elbows: [[0.34, -0.31, 0.06], [-0.34, -0.31, 0.06]],
    fingers: 0.7 }) },
  { time: 0.95, spec: stance() }
]));

addClip('defeat', 0.85, false, timeline(0.85, 18, [
  { time: 0, spec: stance() },
  { time: 0.16, spec: stance({ lift: -0.08, hips: [-6, 10, 0], spine: [-10, 6, 0], head: [10, -8, 0],
    hands: [[0.20, -0.30, 0.08], [-0.20, -0.28, 0.10]], feet: [[0.12, FOOT_Y, 0.02], [-0.13, FOOT_Y, -0.14]] }) },
  { time: 0.40, spec: stance({ lift: -0.34, hips: [18, 0, 0], spine: [22, 0, 0], head: [-6, 0, 0],
    hands: [[0.22, -0.48, 0.18], [-0.22, -0.48, 0.18]], elbows: [[0.38, -0.50, 0.10], [-0.38, -0.50, 0.10]],
    feet: [[0.14, FOOT_Y, 0.06], [-0.16, FOOT_Y + 0.12, -0.16]], feetRot: [[0, 8, 0], [-30, -8, 0]],
    knees: [[0.18, 0.38, 0.42], [-0.20, 0.50, 0.30]], fingers: 0.2 }) },
  { time: 0.64, spec: stance({ lift: -0.42, hips: [26, 0, 0], spine: [28, 0, 0], head: [-10, 0, 0],
    hands: [[0.24, -0.52, 0.20], [-0.24, -0.52, 0.20]], elbows: [[0.40, -0.54, 0.12], [-0.40, -0.54, 0.12]],
    feet: [[0.15, FOOT_Y, 0.05], [-0.17, FOOT_Y + 0.10, -0.20]], feetRot: [[0, 8, 0], [-34, -8, 0]],
    knees: [[0.20, 0.34, 0.42], [-0.22, 0.46, 0.26]], fingers: 0.15 }) },
  { time: 0.85, spec: stance({ lift: -0.44, hips: [28, 0, 0], spine: [30, 0, 0], head: [-10, 0, 0],
    hands: [[0.24, -0.54, 0.20], [-0.24, -0.54, 0.20]], elbows: [[0.40, -0.56, 0.12], [-0.40, -0.56, 0.12]],
    feet: [[0.15, FOOT_Y, 0.05], [-0.17, FOOT_Y + 0.10, -0.20]], feetRot: [[0, 8, 0], [-34, -8, 0]],
    knees: [[0.20, 0.34, 0.42], [-0.22, 0.46, 0.26]], fingers: 0.15 }) }
]));

// ---------------------------------------------------------------- compile to GLB
const clipReport = [];
const glb = {
  asset: {
    version: '2.0',
    generator: 'browser-smash saitama IK clip authoring',
    copyright: 'Clip-only animation on the original body; geometry, weights and textures untouched. Saitama by Godfrey (SteamySenpai), CC BY 4.0.'
  },
  scene: 0,
  scenes: [{ name: 'SaitamaIKClipRig', nodes: [] }],
  nodes: [],
  animations: [],
  accessors: [],
  bufferViews: [],
  buffers: []
};

const boneIndex = new Map();
const boneParent = new Map();
for (const bone of bones) boneParent.set(bone.name, bone.parent?.isBone ? bone.parent.name : null);
const addNode = name => {
  if (boneIndex.has(name)) return boneIndex.get(name);
  const bone = byName.get(name);
  const index = glb.nodes.length;
  boneIndex.set(name, index);
  const bind = rest.get(bone);
  const node = { name };
  if (bind.position.lengthSq() > 1e-12) node.translation = bind.position.toArray();
  if (Math.abs(bind.quaternion.w - 1) > 1e-8
    || Math.abs(bind.quaternion.x) + Math.abs(bind.quaternion.y) + Math.abs(bind.quaternion.z) > 1e-8) {
    node.rotation = bind.quaternion.toArray();
  }
  if (bind.scale.distanceToSquared(new THREE.Vector3(1, 1, 1)) > 1e-12) node.scale = bind.scale.toArray();
  glb.nodes.push(node);
  return index;
};
for (const name of boneNames) addNode(name);
for (const name of boneNames) {
  const parent = boneParent.get(name);
  if (!parent) { glb.scenes[0].nodes.push(boneIndex.get(name)); continue; }
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
function addAccessor(values, type, min, max) {
  const byteOffset = pushFloats(values);
  glb.bufferViews.push({ buffer: 0, byteOffset, byteLength: values.length * 4, target: 34962 });
  glb.accessors.push({
    bufferView: glb.bufferViews.length - 1,
    componentType: 5126,
    count: values.length / (type === 'VEC4' ? 4 : type === 'VEC3' ? 3 : 1),
    type, min, max
  });
  return glb.accessors.length - 1;
}

for (const [name, clip] of Object.entries(CLIPS)) {
  const keys = clip.keys;
  const times = keys.map(key => key.time);
  const timeAccessor = addAccessor(times, 'SCALAR', [Math.min(...times)], [Math.max(...times)]);
  const samplers = [];
  const channels = [];
  const snapshots = keys.map(key => solve(key.spec));
  for (const boneName of boneNames) {
    const values = [];
    let previous = null;
    for (const snapshot of snapshots) {
      const quat = snapshot.quaternions.get(boneName).clone();
      if (previous && quat.dot(previous) < 0) quat.set(-quat.x, -quat.y, -quat.z, -quat.w);
      previous = quat;
      values.push(quat.x, quat.y, quat.z, quat.w);
    }
    const output = addAccessor(values, 'VEC4', [-1, -1, -1, -1], [1, 1, 1, 1]);
    samplers.push({ input: timeAccessor, output, interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node: boneIndex.get(boneName), path: 'rotation' } });
  }
  const hipsValues = [];
  for (const snapshot of snapshots) hipsValues.push(...snapshot.hipsPosition.toArray());
  const hipsAccessor = addAccessor(hipsValues, 'VEC3', [-10, -10, -10], [10, 10, 10]);
  samplers.push({ input: timeAccessor, output: hipsAccessor, interpolation: 'LINEAR' });
  channels.push({ sampler: samplers.length - 1, target: { node: boneIndex.get(hips.name), path: 'translation' } });

  glb.animations.push({ name, samplers, channels });
  clipReport.push({
    name, duration: clip.duration, loop: Boolean(clip.loop), keys: keys.length,
    tracks: channels.length, bones: boneNames.length
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
mkdirSync('artifacts/saitama-rebuild', { recursive: true });
writeFileSync('artifacts/saitama-rebuild/clip-report.json', JSON.stringify({
  body: BODY, output: OUT, bytes: output.length, joints: boneNames.length,
  metrics: {
    hips: restHips.toArray().map(v => +v.toFixed(4)),
    head: restHead.toArray().map(v => +v.toFixed(4)),
    footY: +FOOT_Y.toFixed(4),
    lengths: Object.fromEntries(Object.entries(LENGTHS).map(([key, value]) => [key, +value.toFixed(4)])),
    fingerJoints: fingerNames.length, thumbJoints: thumbNames.length
  },
  clips: clipReport
}, null, 2) + '\n');
console.log(JSON.stringify({
  ok: true, output: OUT, bytes: output.length, joints: boneNames.length,
  clips: clipReport.length, names: clipReport.map(clip => clip.name),
  metrics: {
    hips: restHips.toArray().map(v => +v.toFixed(3)),
    footY: +FOOT_Y.toFixed(3),
    arm: +(LENGTHS.upperArmL + LENGTHS.lowerArmL).toFixed(3),
    leg: +(LENGTHS.upperLegL + LENGTHS.lowerLegL).toFixed(3)
  }
}, null, 1));
