#!/usr/bin/env node
/**
 * Author Goku's full animation set as a clip-only GLB on his *actual* 73-joint skeleton.
 *
 * The game already had a Goku clip file, but it was authored on the 19-bone roster rig. The imported
 * Goku mounts a 73-joint Mixamo-derived skeleton (Hips/Spine/Chest/LeftArm/...), so none of those
 * tracks could bind: the body stood in its rest pose while the hits still registered. This script
 * writes a second clip-only GLB whose channels target the imported joints by name, so the same
 * runtime binder finds them.
 *
 * The body file is never touched. Every clip is authored here as node-local rotations
 * (restQuat * delta), which is exactly what a glTF animation channel stores, so no Blender
 * re-export can disturb the geometry, skin weights, inverse bind matrices, UVs or textures.
 *
 *   node scripts/author-goku-clips.mjs [--out public/models/characters/bespoke/goku_animated.glb]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const BODY = 'artifacts/goku-repair/repaired/goku.glb';
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1] : 'public/models/characters/bespoke/goku_animated.glb';

// ---------------------------------------------------------------- glTF reading
const bodyBuffer = readFileSync(BODY);
const jsonLength = bodyBuffer.readUInt32LE(12);
const bodyJson = JSON.parse(bodyBuffer.toString('utf8', 20, 20 + jsonLength));
const nodes = bodyJson.nodes;
const joints = bodyJson.skins[0].joints;
const jointSet = new Set(joints);
const parentOf = new Map();
nodes.forEach((node, index) => (node.children || []).forEach(child => parentOf.set(child, index)));
const byName = new Map(joints.map(index => [nodes[index].name, index]));

const rest = new Map();
for (const index of joints) {
  const node = nodes[index];
  rest.set(node.name, {
    index,
    parent: parentOf.has(index) ? nodes[parentOf.get(index)].name : null,
    t: node.translation || [0, 0, 0],
    r: node.rotation || [0, 0, 0, 1],
    s: node.scale || [1, 1, 1]
  });
}

// ---------------------------------------------------------------- quaternion maths
const DEG = Math.PI / 180;
function quatFromEulerXYZ([x, y, z]) {
  const c1 = Math.cos(x * DEG / 2), c2 = Math.cos(y * DEG / 2), c3 = Math.cos(z * DEG / 2);
  const s1 = Math.sin(x * DEG / 2), s2 = Math.sin(y * DEG / 2), s3 = Math.sin(z * DEG / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3
  ];
}
function mul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
  ];
}
const normalise = q => {
  const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return q.map(value => value / length);
};

// ---------------------------------------------------------------- pose vocabulary
// X bends a bone, Y twists it, Z swings it sideways. Values are degrees on top of the guard stance,
// the same convention the repo's Blender authoring tables use (bones run along +Y).
const BASE = {
  Hips: [0, 0, 0],
  Spine: [3, 0, 0], Chest: [2, 0, 0],
  Neck: [-3, 0, 0], Head: [-2, 0, 0],
  LeftShoulder: [0, 0, -3], RightShoulder: [0, 0, 3],
  LeftArm: [-59, -6, 0], RightArm: [-61, 6, 0],
  LeftForeArm: [-38, 0, 0], RightForeArm: [-40, 0, 0],
  LeftHand: [0, 0, 0], RightHand: [0, 0, 0],
  LeftUpLeg: [-5, 0, 0], RightUpLeg: [-5, 0, 0],
  LeftLeg: [11, 0, 0], RightLeg: [12, 0, 0],
  LeftFoot: [-5, 0, 0], RightFoot: [-6, 0, 0]
};

/** Guard stance plus per-bone deltas. */
function pose(changes = {}) {
  const out = {};
  for (const [bone, rotation] of Object.entries(BASE)) out[bone] = [...rotation];
  for (const [bone, delta] of Object.entries(changes)) {
    if (bone === '_lift') { out._lift = delta; continue; }
    const before = out[bone] || [0, 0, 0];
    out[bone] = [before[0] + delta[0], before[1] + delta[1], before[2] + delta[2]];
  }
  return out;
}

/** Mirror a pose's arms/legs (used for the alternating halves of a walk or run). */
function mirrored(changes) {
  const out = {};
  for (const [bone, delta] of Object.entries(changes)) {
    const flipped = bone.startsWith('Left') ? bone.replace('Left', 'Right') : bone.startsWith('Right') ? bone.replace('Right', 'Left') : bone;
    out[flipped] = [delta[0], -delta[1], -delta[2]];
  }
  return out;
}

// ---------------------------------------------------------------- forward kinematics
// Grounding is measured on the skeleton's own height axis. The rig is authored Z-up (the Hips rest
// at z = 0.962); the glTF wrapper rotates that frame into the renderer's Y-up world afterwards, so a
// pose comparison has to be made in rig space and written back on the Hips' local Z, not on local Y.
// The hierarchy below is the skin's own (joint -> joint); the wrappers above it are a constant
// transform for every pose, so they cancel out of a "lowest foot relative to the stance" measurement.
function rotateVector(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx)
  ];
}

const IDENTITY_Q = [0, 0, 0, 1];
const FOOT_JOINTS = ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'];

function skeletonPose(poseValues) {
  const worldPosition = new Map();
  const worldRotation = new Map();
  const visit = name => {
    if (worldPosition.has(name)) return;
    const info = rest.get(name);
    if (!info) return;
    const parent = info.parent && rest.has(info.parent) ? info.parent : null;
    if (parent) visit(parent);
    const parentRotation = parent ? worldRotation.get(parent) : IDENTITY_Q;
    const parentPosition = parent ? worldPosition.get(parent) : [0, 0, 0];
    const delta = poseValues[name] ? quatFromEulerXYZ(poseValues[name]) : IDENTITY_Q;
    const rotation = mul(info.r, delta);
    const local = rotateVector(parentRotation, info.t);
    worldPosition.set(name, [parentPosition[0] + local[0], parentPosition[1] + local[1], parentPosition[2] + local[2]]);
    worldRotation.set(name, mul(parentRotation, rotation));
  };
  for (const name of rest.keys()) visit(name);
  return { worldPosition, worldRotation };
}

/** Height of the lowest foot joint in rig space for one authored pose. */
function groundedFoot(poseValues) {
  const { worldPosition } = skeletonPose(poseValues);
  let lowest = Infinity;
  for (const name of FOOT_JOINTS) {
    const position = worldPosition.get(name);
    if (position) lowest = Math.min(lowest, position[2]);
  }
  return lowest;
}

// ---------------------------------------------------------------- clip catalogue
// Every clip starts and ends in the guard so it blends cleanly; attacks carry anticipation, contact
// and recovery rather than a single displaced frame.
const STANCE = pose();
const GROUND_BASELINE = groundedFoot(STANCE);
console.log('GROUND baseline=' + GROUND_BASELINE.toFixed(4));
const CLIPS = {
  // ---- locomotion ----------------------------------------------------------------------
  Goku_Idle: { dur: 2.0, loop: true, keys: [
    [0.0, pose({ Chest: [-1, 0, 0], Head: [1, 0, 0] })],
    [0.5, pose({ Chest: [1.5, 0, 0], Neck: [-1, 0, 0], LeftArm: [2, 0, 0], RightArm: [2, 0, 0] })],
    [1.0, pose({ Chest: [3, 0, 0], Head: [-1.5, 0, 0], Hips: [1, 0, 0] })],
    [1.5, pose({ Chest: [1.5, 0, 0], Neck: [-1, 0, 0], LeftArm: [2, 0, 0], RightArm: [2, 0, 0] })],
    [2.0, pose({ Chest: [-1, 0, 0], Head: [1, 0, 0] })]
  ] },
  Goku_Walk: { dur: 0.8, loop: true, keys: [
    [0.0, pose({ LeftUpLeg: [26, 0, 0], RightUpLeg: [-24, 0, 0], LeftLeg: [8, 0, 0], RightLeg: [30, 0, 0], LeftArm: [-18, 0, 0], RightArm: [16, 0, 0], Spine: [2, 4, 0] })],
    [0.2, pose({ LeftUpLeg: [6, 0, 0], RightUpLeg: [-6, 0, 0], LeftLeg: [18, 0, 0], RightLeg: [18, 0, 0], Hips: [0, 0, 0] })],
    [0.4, pose({ LeftUpLeg: [-24, 0, 0], RightUpLeg: [26, 0, 0], LeftLeg: [30, 0, 0], RightLeg: [8, 0, 0], LeftArm: [16, 0, 0], RightArm: [-18, 0, 0], Spine: [2, -4, 0] })],
    [0.6, pose({ LeftUpLeg: [-6, 0, 0], RightUpLeg: [6, 0, 0], LeftLeg: [18, 0, 0], RightLeg: [18, 0, 0] })],
    [0.8, pose({ LeftUpLeg: [26, 0, 0], RightUpLeg: [-24, 0, 0], LeftLeg: [8, 0, 0], RightLeg: [30, 0, 0], LeftArm: [-18, 0, 0], RightArm: [16, 0, 0], Spine: [2, 4, 0] })]
  ] },
  Goku_Run: { dur: 0.5, loop: true, keys: [
    [0.0, pose({ LeftUpLeg: [44, 0, 0], RightUpLeg: [-38, 0, 0], LeftLeg: [16, 0, 0], RightLeg: [58, 0, 0], LeftArm: [-34, 0, 0], RightArm: [30, 0, 0], Spine: [10, 6, 0], Chest: [4, 0, 0] })],
    [0.125, pose({ LeftUpLeg: [8, 0, 0], RightUpLeg: [-8, 0, 0], LeftLeg: [30, 0, 0], RightLeg: [34, 0, 0], Spine: [12, 0, 0] })],
    [0.25, pose({ LeftUpLeg: [-38, 0, 0], RightUpLeg: [44, 0, 0], LeftLeg: [58, 0, 0], RightLeg: [16, 0, 0], LeftArm: [30, 0, 0], RightArm: [-34, 0, 0], Spine: [10, -6, 0], Chest: [4, 0, 0] })],
    [0.375, pose({ LeftUpLeg: [-8, 0, 0], RightUpLeg: [8, 0, 0], LeftLeg: [34, 0, 0], RightLeg: [30, 0, 0], Spine: [12, 0, 0] })],
    [0.5, pose({ LeftUpLeg: [44, 0, 0], RightUpLeg: [-38, 0, 0], LeftLeg: [16, 0, 0], RightLeg: [58, 0, 0], LeftArm: [-34, 0, 0], RightArm: [30, 0, 0], Spine: [10, 6, 0], Chest: [4, 0, 0] })]
  ] },
  Goku_Turn: { dur: 0.45, loop: false, keys: [
    [0.0, pose({})],
    [0.2, pose({ Hips: [0, 26, 0], Spine: [0, 10, 0], Chest: [0, 8, 0], Head: [0, -14, 0] })],
    [0.45, pose({ Hips: [0, 40, 0], Spine: [0, 6, 0], Chest: [0, 4, 0], Head: [0, -8, 0] })]
  ] },
  Goku_Jump: { dur: 0.5, loop: false, translate: true, keys: [
    [0.0, pose({ LeftUpLeg: [18, 0, 0], RightUpLeg: [18, 0, 0], LeftLeg: [34, 0, 0], RightLeg: [34, 0, 0], Spine: [10, 0, 0], Hips: [0, 0, 0], _lift: -0.16 })],
    [0.18, pose({ LeftUpLeg: [-8, 0, 0], RightUpLeg: [-8, 0, 0], LeftLeg: [2, 0, 0], RightLeg: [2, 0, 0], LeftArm: [-30, 0, 0], RightArm: [-30, 0, 0], _lift: 0.22 })],
    [0.32, pose({ LeftUpLeg: [18, 0, 0], RightUpLeg: [10, 0, 0], LeftLeg: [26, 0, 0], RightLeg: [18, 0, 0], LeftArm: [-46, 0, 0], RightArm: [-46, 0, 0], _lift: 0.3 })],
    [0.5, pose({ LeftUpLeg: [10, 0, 0], RightUpLeg: [6, 0, 0], LeftLeg: [20, 0, 0], RightLeg: [14, 0, 0], LeftArm: [-34, 0, 0], RightArm: [-34, 0, 0], _lift: 0.2 })]
  ] },
  Goku_DoubleJump: { dur: 0.55, loop: false, translate: true, keys: [
    [0.0, pose({ LeftUpLeg: [10, 0, 0], RightUpLeg: [6, 0, 0], LeftLeg: [20, 0, 0], RightLeg: [14, 0, 0], _lift: 0.2 })],
    [0.2, pose({ LeftUpLeg: [30, 0, 0], RightUpLeg: [24, 0, 0], LeftLeg: [52, 0, 0], RightLeg: [46, 0, 0], Spine: [12, 0, 0], LeftArm: [-40, 0, 0], RightArm: [-40, 0, 0], _lift: 0.16 })],
    [0.4, pose({ Hips: [0, 40, 0], LeftUpLeg: [40, 0, 0], RightUpLeg: [34, 0, 0], LeftLeg: [60, 0, 0], RightLeg: [54, 0, 0], Spine: [16, 0, 0], _lift: 0.34 })],
    [0.55, pose({ LeftUpLeg: [16, 0, 0], RightUpLeg: [12, 0, 0], LeftLeg: [30, 0, 0], RightLeg: [26, 0, 0], Spine: [8, 0, 0], _lift: 0.24 })]
  ] },
  Goku_Fall: { dur: 0.9, loop: true, keys: [
    [0.0, pose({ LeftArm: [-52, 0, -18], RightArm: [-52, 0, 18], LeftForeArm: [10, 0, 0], RightForeArm: [10, 0, 0], LeftUpLeg: [-16, 0, 0], RightUpLeg: [-6, 0, 0], LeftLeg: [26, 0, 0], RightLeg: [16, 0, 0], Spine: [-4, 0, 0] })],
    [0.45, pose({ LeftArm: [-60, 0, -22], RightArm: [-60, 0, 22], LeftUpLeg: [-8, 0, 0], RightUpLeg: [-14, 0, 0], LeftLeg: [18, 0, 0], RightLeg: [24, 0, 0], Spine: [-2, 0, 0] })],
    [0.9, pose({ LeftArm: [-52, 0, -18], RightArm: [-52, 0, 18], LeftForeArm: [10, 0, 0], RightForeArm: [10, 0, 0], LeftUpLeg: [-16, 0, 0], RightUpLeg: [-6, 0, 0], LeftLeg: [26, 0, 0], RightLeg: [16, 0, 0], Spine: [-4, 0, 0] })]
  ] },
  Goku_Land: { dur: 0.35, loop: false, translate: true, keys: [
    [0.0, pose({ LeftUpLeg: [16, 0, 0], RightUpLeg: [16, 0, 0], LeftLeg: [30, 0, 0], RightLeg: [30, 0, 0], LeftArm: [-30, 0, 0], RightArm: [-30, 0, 0], _lift: 0.12 })],
    [0.1, pose({ LeftUpLeg: [34, 0, 0], RightUpLeg: [34, 0, 0], LeftLeg: [58, 0, 0], RightLeg: [58, 0, 0], Spine: [16, 0, 0], Chest: [8, 0, 0], LeftArm: [10, 0, -14], RightArm: [10, 0, 14], _lift: -0.22 })],
    [0.35, pose({ _lift: 0 })]
  ] },
  // ---- flight ---------------------------------------------------------------------------
  Goku_FlyTakeoff: { dur: 0.6, loop: false, translate: true, keys: [
    [0.0, pose({ LeftUpLeg: [20, 0, 0], RightUpLeg: [20, 0, 0], LeftLeg: [38, 0, 0], RightLeg: [38, 0, 0], Spine: [12, 0, 0], _lift: -0.12 })],
    [0.25, pose({ LeftArm: [-40, 0, -10], RightArm: [-40, 0, 10], Spine: [4, 0, 0], LeftUpLeg: [-6, 0, 0], RightUpLeg: [-6, 0, 0], _lift: 0.4 })],
    [0.6, pose({ LeftArm: [-30, 0, -8], RightArm: [-30, 0, 8], LeftUpLeg: [-14, 0, 0], RightUpLeg: [-14, 0, 0], LeftLeg: [18, 0, 0], RightLeg: [18, 0, 0], _lift: 0.6 })]
  ] },
  Goku_Hover: { dur: 1.4, loop: true, keys: [
    [0.0, pose({ LeftArm: [-26, 0, -10], RightArm: [-26, 0, 10], LeftUpLeg: [-10, 0, 0], RightUpLeg: [-6, 0, 0], LeftLeg: [22, 0, 0], RightLeg: [16, 0, 0], Spine: [2, 0, 0] })],
    [0.7, pose({ LeftArm: [-32, 0, -12], RightArm: [-32, 0, 12], LeftUpLeg: [-4, 0, 0], RightUpLeg: [-12, 0, 0], LeftLeg: [16, 0, 0], RightLeg: [22, 0, 0], Spine: [4, 0, 0] })],
    [1.4, pose({ LeftArm: [-26, 0, -10], RightArm: [-26, 0, 10], LeftUpLeg: [-10, 0, 0], RightUpLeg: [-6, 0, 0], LeftLeg: [22, 0, 0], RightLeg: [16, 0, 0], Spine: [2, 0, 0] })]
  ] },
  Goku_FlyForward: { dur: 0.7, loop: true, keys: [
    [0.0, pose({ Spine: [26, 0, 0], Chest: [10, 0, 0], Head: [-16, 0, 0], LeftArm: [-70, 0, -16], RightArm: [-70, 0, 16], LeftUpLeg: [-30, 0, 0], RightUpLeg: [-24, 0, 0], LeftLeg: [14, 0, 0], RightLeg: [10, 0, 0] })],
    [0.35, pose({ Spine: [30, 0, 0], Chest: [12, 0, 0], Head: [-18, 0, 0], LeftArm: [-76, 0, -18], RightArm: [-76, 0, 18], LeftUpLeg: [-26, 0, 0], RightUpLeg: [-30, 0, 0], LeftLeg: [10, 0, 0], RightLeg: [14, 0, 0] })],
    [0.7, pose({ Spine: [26, 0, 0], Chest: [10, 0, 0], Head: [-16, 0, 0], LeftArm: [-70, 0, -16], RightArm: [-70, 0, 16], LeftUpLeg: [-30, 0, 0], RightUpLeg: [-24, 0, 0], LeftLeg: [14, 0, 0], RightLeg: [10, 0, 0] })]
  ] },
  Goku_FlyBack: { dur: 0.7, loop: true, keys: [
    [0.0, pose({ Spine: [-14, 0, 0], Chest: [-6, 0, 0], Head: [8, 0, 0], LeftArm: [-20, 0, -24], RightArm: [-20, 0, 24], LeftUpLeg: [18, 0, 0], RightUpLeg: [12, 0, 0], LeftLeg: [30, 0, 0], RightLeg: [26, 0, 0] })],
    [0.35, pose({ Spine: [-18, 0, 0], Chest: [-8, 0, 0], Head: [10, 0, 0], LeftArm: [-14, 0, -28], RightArm: [-14, 0, 28], LeftUpLeg: [14, 0, 0], RightUpLeg: [18, 0, 0], LeftLeg: [26, 0, 0], RightLeg: [30, 0, 0] })],
    [0.7, pose({ Spine: [-14, 0, 0], Chest: [-6, 0, 0], Head: [8, 0, 0], LeftArm: [-20, 0, -24], RightArm: [-20, 0, 24], LeftUpLeg: [18, 0, 0], RightUpLeg: [12, 0, 0], LeftLeg: [30, 0, 0], RightLeg: [26, 0, 0] })]
  ] },
  Goku_FlyTurn: { dur: 0.8, loop: true, keys: [
    [0.0, pose({ Hips: [0, 18, 0], Spine: [16, 8, 0], LeftArm: [-60, 0, -20], RightArm: [-60, 0, 20], LeftUpLeg: [-18, 0, 0], RightUpLeg: [-12, 0, 0] })],
    [0.4, pose({ Hips: [0, -18, 0], Spine: [16, -8, 0], LeftArm: [-60, 0, -20], RightArm: [-60, 0, 20], LeftUpLeg: [-12, 0, 0], RightUpLeg: [-18, 0, 0] })],
    [0.8, pose({ Hips: [0, 18, 0], Spine: [16, 8, 0], LeftArm: [-60, 0, -20], RightArm: [-60, 0, 20], LeftUpLeg: [-18, 0, 0], RightUpLeg: [-12, 0, 0] })]
  ] },
  Goku_FlyLand: { dur: 0.7, loop: false, translate: true, keys: [
    [0.0, pose({ LeftUpLeg: [-10, 0, 0], RightUpLeg: [-6, 0, 0], LeftLeg: [18, 0, 0], RightLeg: [14, 0, 0], LeftArm: [-24, 0, -10], RightArm: [-24, 0, 10], _lift: 0.5 })],
    [0.3, pose({ LeftUpLeg: [24, 0, 0], RightUpLeg: [24, 0, 0], LeftLeg: [40, 0, 0], RightLeg: [40, 0, 0], Spine: [12, 0, 0], _lift: 0.12 })],
    [0.7, pose({ _lift: 0 })]
  ] },
  // ---- strikes ---------------------------------------------------------------------------
  // Straight lead jab toward the opponent. The arm swings forward on Z (measured: hand ends 0.35 m
  // in front of the hips, centred 0.04 m off the midline), the elbow stays bent at contact (the
  // forearm key keeps a clear angle instead of locking straight), the wrist rotates through the
  // strike, and the spine/chest/hips turn into the punch. Anticipation at 0.06 s, contact at
  // 0.13 s, short follow-through at 0.21 s, recovery at 0.34 s.
  Goku_Jab: { dur: 0.34, loop: false, keys: [
    [0.0, STANCE],
    [0.06, pose({ RightArm: [8, 10, -4], RightForeArm: [16, 0, 0], RightHand: [0, 10, -6], Spine: [0, -8, 0], Hips: [0, -6, 0] })],
    [0.13, pose({ RightArm: [-72, -28, 78], RightForeArm: [4, 0, 0], RightHand: [-10, -18, 24], RightShoulder: [0, -4, 10], Spine: [0, 18, 0], Chest: [0, 10, 0], Hips: [0, 14, 0], LeftArm: [6, 0, -10], LeftForeArm: [12, 0, 0] })],
    [0.21, pose({ RightArm: [-46, -12, 44], RightForeArm: [44, 0, 0], RightHand: [0, -6, 10], Spine: [0, 9, 0], Chest: [0, 5, 0], Hips: [0, 6, 0] })],
    [0.34, STANCE]
  ] },
  Goku_Cross: { dur: 0.4, loop: false, keys: [
    [0.0, STANCE],
    [0.08, pose({ LeftArm: [8, -12, 0], LeftForeArm: [10, 0, 0], Hips: [0, 15, 0], Spine: [0, 8, 0] })],
    [0.17, pose({ LeftArm: [-72, 28, -78], LeftForeArm: [42, 0, 0], Hips: [0, -18, 0], Spine: [0, -14, 0], LeftShoulder: [0, 0, -10] })],
    [0.28, pose({ LeftArm: [-28, -10, 0], LeftForeArm: [24, 0, 0], Hips: [0, -6, 0], Spine: [0, -4, 0] })],
    [0.4, STANCE]
  ] },
  Goku_Punch3: { dur: 0.44, loop: false, keys: [
    [0.0, STANCE],
    [0.1, pose({ Hips: [0, 20, 0], Spine: [0, 10, 0], RightArm: [-20, 20, 0], RightForeArm: [40, 0, 0] })],
    [0.2, pose({ Hips: [0, 24, 0], Spine: [0, 14, 0], RightArm: [-76, -24, 82], RightForeArm: [40, 0, 0], RightShoulder: [0, 0, 12] })],
    [0.32, pose({ Hips: [0, -10, 0], Spine: [0, -4, 0], RightArm: [-34, 0, 0] })],
    [0.44, STANCE]
  ] },
  Goku_Punch4: { dur: 0.46, loop: false, keys: [
    [0.0, STANCE],
    [0.1, pose({ Spine: [10, 0, 0], LeftArm: [-10, 0, -10], LeftForeArm: [20, 0, 0] })],
    [0.22, pose({ Spine: [16, -18, 0], LeftArm: [-68, 26, -74], LeftForeArm: [48, 0, 0], Hips: [0, -14, 0] })],
    [0.34, pose({ Spine: [8, -6, 0], LeftArm: [-20, -10, 0], LeftForeArm: [40, 0, 0] })],
    [0.46, STANCE]
  ] },
  Goku_Punch5: { dur: 0.55, loop: false, keys: [
    [0.0, STANCE],
    [0.12, pose({ Hips: [0, 40, 0], Spine: [0, 20, 0], RightArm: [-30, 40, 0], RightForeArm: [50, 0, 0] })],
    [0.26, pose({ Hips: [0, 40, 0], Spine: [0, 24, 0], RightArm: [-80, -22, 84], RightForeArm: [38, 0, 0], RightShoulder: [0, 0, 14] })],
    [0.4, pose({ Hips: [0, -30, 0], Spine: [0, -10, 0], RightArm: [-40, 0, 0] })],
    [0.55, STANCE]
  ] },
  Goku_Heavy: { dur: 0.62, loop: false, keys: [
    [0.0, STANCE],
    [0.14, pose({ Spine: [-14, 12, 0], Chest: [-8, 0, 0], RightArm: [30, 20, 0], RightForeArm: [70, 0, 0], LeftArm: [-20, -10, 0] })],
    [0.26, pose({ Spine: [18, -16, 0], Chest: [10, 0, 0], RightArm: [-70, -30, 76], RightForeArm: [48, 0, 0], RightShoulder: [0, 0, 16], LeftUpLeg: [10, 0, 0] })],
    [0.42, pose({ Spine: [12, -6, 0], RightArm: [-60, 0, 0], RightForeArm: [40, 0, 0] })],
    [0.62, STANCE]
  ] },
  Goku_Kick: { dur: 0.5, loop: false, keys: [
    [0.0, STANCE],
    [0.1, pose({ LeftUpLeg: [20, 0, 0], LeftLeg: [40, 0, 0], Spine: [-6, 0, 0] })],
    [0.22, pose({ LeftUpLeg: [-84, 0, 0], LeftLeg: [12, 0, 0], LeftFoot: [18, 0, 0], Spine: [-16, 0, 0], LeftArm: [-30, 0, -20], RightArm: [-20, 0, 20] })],
    [0.34, pose({ LeftUpLeg: [-50, 0, 0], LeftLeg: [30, 0, 0], Spine: [-8, 0, 0] })],
    [0.5, STANCE]
  ] },
  Goku_Launcher: { dur: 0.58, loop: false, keys: [
    [0.0, STANCE],
    [0.12, pose({ LeftUpLeg: [26, 0, 0], RightUpLeg: [26, 0, 0], LeftLeg: [50, 0, 0], RightLeg: [50, 0, 0], Spine: [18, 0, 0], RightArm: [20, 0, 0] })],
    [0.28, pose({ Hips: [0, 0, 0], Spine: [-18, 0, 0], LeftUpLeg: [-10, 0, 0], RightUpLeg: [-10, 0, 0], LeftLeg: [10, 0, 0], RightLeg: [10, 0, 0], RightArm: [-114, -26, 60], RightForeArm: [50, 0, 0], RightShoulder: [0, 0, 18] })],
    [0.42, pose({ Spine: [-10, 0, 0], RightArm: [-70, 0, 0] })],
    [0.58, STANCE]
  ] },
  Goku_AirPunch: { dur: 0.45, loop: false, keys: [
    [0.0, pose({ LeftUpLeg: [20, 0, 0], RightUpLeg: [12, 0, 0], LeftLeg: [40, 0, 0], RightLeg: [30, 0, 0], Spine: [10, 0, 0], LeftArm: [-30, 0, -16], RightArm: [-30, 0, 16] })],
    [0.14, pose({ LeftUpLeg: [26, 0, 0], RightUpLeg: [18, 0, 0], LeftLeg: [50, 0, 0], RightLeg: [40, 0, 0], Spine: [14, 0, 0], RightArm: [10, 14, 0], RightForeArm: [30, 0, 0] })],
    [0.26, pose({ LeftUpLeg: [10, 0, 0], RightUpLeg: [4, 0, 0], LeftLeg: [26, 0, 0], RightLeg: [20, 0, 0], Spine: [6, 14, 0], RightArm: [-72, -28, 78], RightForeArm: [44, 0, 0] })],
    [0.45, pose({ LeftUpLeg: [18, 0, 0], RightUpLeg: [10, 0, 0], LeftLeg: [34, 0, 0], RightLeg: [26, 0, 0], Spine: [8, 0, 0] })]
  ] },
  Goku_AirKick: { dur: 0.5, loop: false, keys: [
    [0.0, pose({ LeftUpLeg: [20, 0, 0], RightUpLeg: [12, 0, 0], LeftLeg: [40, 0, 0], RightLeg: [30, 0, 0], Spine: [8, 0, 0] })],
    [0.14, pose({ LeftUpLeg: [40, 0, 0], LeftLeg: [60, 0, 0], Spine: [16, 0, 0] })],
    [0.28, pose({ LeftUpLeg: [-70, 0, 0], LeftLeg: [10, 0, 0], LeftFoot: [20, 0, 0], Spine: [-14, 0, 0], LeftArm: [-30, 0, -24], RightArm: [-30, 0, 24] })],
    [0.4, pose({ LeftUpLeg: [-30, 0, 0], LeftLeg: [24, 0, 0], Spine: [0, 0, 0] })],
    [0.5, pose({ LeftUpLeg: [18, 0, 0], RightUpLeg: [10, 0, 0], LeftLeg: [34, 0, 0], RightLeg: [26, 0, 0], Spine: [8, 0, 0] })]
  ] },
  Goku_Slam: { dur: 0.7, loop: false, translate: true, keys: [
    [0.0, STANCE],
    [0.16, pose({ LeftArm: [-120, 0, -10], RightArm: [-120, 0, 10], LeftForeArm: [20, 0, 0], RightForeArm: [20, 0, 0], Spine: [-16, 0, 0], LeftUpLeg: [12, 0, 0], RightUpLeg: [12, 0, 0], _lift: 0.24 })],
    [0.34, pose({ LeftArm: [-10, 0, -6], RightArm: [-10, 0, 6], LeftForeArm: [-20, 0, 0], RightForeArm: [-20, 0, 0], Spine: [34, 0, 0], Chest: [14, 0, 0], LeftUpLeg: [26, 0, 0], RightUpLeg: [26, 0, 0], LeftLeg: [46, 0, 0], RightLeg: [46, 0, 0], _lift: -0.18 })],
    [0.5, pose({ Spine: [22, 0, 0], LeftArm: [-20, 0, -8], RightArm: [-20, 0, 8], LeftUpLeg: [18, 0, 0], RightUpLeg: [18, 0, 0], LeftLeg: [36, 0, 0], RightLeg: [36, 0, 0], _lift: -0.08 })],
    [0.7, STANCE]
  ] },
  Goku_Grab: { dur: 0.45, loop: false, keys: [
    [0.0, STANCE],
    [0.1, pose({ LeftArm: [-30, 0, -14], RightArm: [-30, 0, 14], LeftForeArm: [10, 0, 0], RightForeArm: [10, 0, 0], Spine: [6, 0, 0] })],
    [0.24, pose({ LeftArm: [-86, 0, -20], RightArm: [-86, 0, 20], LeftForeArm: [-18, 0, 0], RightForeArm: [-18, 0, 0], LeftHand: [0, 0, -18], RightHand: [0, 0, 18], Spine: [14, 0, 0] })],
    [0.45, pose({ LeftArm: [-70, 0, -16], RightArm: [-70, 0, 16], LeftForeArm: [-10, 0, 0], RightForeArm: [-10, 0, 0], Spine: [10, 0, 0] })]
  ] },
  Goku_Throw: { dur: 0.6, loop: false, keys: [
    [0.0, pose({ LeftArm: [-70, 0, -16], RightArm: [-70, 0, 16], LeftForeArm: [-10, 0, 0], RightForeArm: [-10, 0, 0], Spine: [10, 0, 0] })],
    [0.14, pose({ Hips: [0, 26, 0], Spine: [4, 16, 0], LeftArm: [-40, 20, -10], RightArm: [-40, 20, 10], LeftUpLeg: [14, 0, 0], RightUpLeg: [10, 0, 0] })],
    [0.3, pose({ Hips: [0, -34, 0], Spine: [22, -18, 0], Chest: [10, 0, 0], LeftArm: [-100, -20, 0], RightArm: [-100, -20, 0], LeftUpLeg: [-8, 0, 0], RightUpLeg: [-4, 0, 0] })],
    [0.45, pose({ Hips: [0, -12, 0], Spine: [10, -6, 0], LeftArm: [-50, 0, 0], RightArm: [-50, 0, 0] })],
    [0.6, STANCE]
  ] },
  Goku_Block: { dur: 0.9, loop: true, keys: [
    [0.0, pose({ LeftArm: [-58, 0, -26], RightArm: [-58, 0, 26], LeftForeArm: [40, 0, 0], RightForeArm: [40, 0, 0], Spine: [6, 0, 0], Chest: [4, 0, 0], LeftUpLeg: [8, 0, 0], RightUpLeg: [8, 0, 0] })],
    [0.45, pose({ LeftArm: [-62, 0, -28], RightArm: [-62, 0, 28], LeftForeArm: [44, 0, 0], RightForeArm: [44, 0, 0], Spine: [8, 0, 0], Chest: [5, 0, 0], LeftUpLeg: [10, 0, 0], RightUpLeg: [10, 0, 0] })],
    [0.9, pose({ LeftArm: [-58, 0, -26], RightArm: [-58, 0, 26], LeftForeArm: [40, 0, 0], RightForeArm: [40, 0, 0], Spine: [6, 0, 0], Chest: [4, 0, 0], LeftUpLeg: [8, 0, 0], RightUpLeg: [8, 0, 0] })]
  ] },
  Goku_Dodge: { dur: 0.4, loop: false, keys: [
    [0.0, STANCE],
    [0.1, pose({ Hips: [0, -30, 0], Spine: [-10, -14, 0], LeftUpLeg: [-14, 0, 0], RightUpLeg: [10, 0, 0], LeftLeg: [30, 0, 0], RightLeg: [20, 0, 0] })],
    [0.24, pose({ Hips: [0, -60, 0], Spine: [8, -20, 0], LeftUpLeg: [-20, 0, 0], RightUpLeg: [24, 0, 0], LeftLeg: [44, 0, 0], RightLeg: [30, 0, 0] })],
    [0.4, pose({ Hips: [0, -20, 0] })]
  ] },
  Goku_HitLight: { dur: 0.35, loop: false, keys: [
    [0.0, STANCE],
    [0.08, pose({ Spine: [-14, 0, 0], Chest: [-8, 0, 0], Neck: [10, 0, 0], Head: [12, 0, 0], LeftArm: [-16, 0, -18], RightArm: [-16, 0, 18] })],
    [0.2, pose({ Spine: [-6, 0, 0], Neck: [4, 0, 0], Head: [6, 0, 0] })],
    [0.35, STANCE]
  ] },
  Goku_HitHeavy: { dur: 0.6, loop: false, keys: [
    [0.0, STANCE],
    [0.1, pose({ Spine: [-30, 0, 0], Chest: [-16, 0, 0], Neck: [22, 0, 0], Head: [24, 0, 0], LeftArm: [-40, 0, -30], RightArm: [-40, 0, 30], LeftUpLeg: [12, 0, 0], RightUpLeg: [6, 0, 0], LeftLeg: [26, 0, 0], RightLeg: [20, 0, 0] })],
    [0.28, pose({ Spine: [-36, 0, 0], Chest: [-20, 0, 0], Neck: [26, 0, 0], Head: [28, 0, 0], LeftUpLeg: [26, 0, 0], RightUpLeg: [18, 0, 0], LeftLeg: [48, 0, 0], RightLeg: [40, 0, 0] })],
    [0.46, pose({ Spine: [-12, 0, 0], Neck: [10, 0, 0] })],
    [0.6, STANCE]
  ] },
  Goku_Knockdown: { dur: 0.85, loop: false, translate: true, keys: [
    [0.0, pose({ Spine: [-30, 0, 0], Chest: [-16, 0, 0], Head: [24, 0, 0], LeftArm: [-50, 0, -30], RightArm: [-50, 0, 30], _lift: 0.1 })],
    [0.24, pose({ Spine: [-50, 0, 0], Chest: [-24, 0, 0], Neck: [30, 0, 0], Head: [30, 0, 0], LeftUpLeg: [40, 0, 0], RightUpLeg: [30, 0, 0], LeftLeg: [70, 0, 0], RightLeg: [60, 0, 0], LeftArm: [-70, 0, -40], RightArm: [-70, 0, 40], _lift: 0.02 })],
    [0.5, pose({ Spine: [-70, 0, 0], Chest: [-30, 0, 0], Neck: [34, 0, 0], Head: [34, 0, 0], LeftUpLeg: [70, 0, 0], RightUpLeg: [56, 0, 0], LeftLeg: [60, 0, 0], RightLeg: [50, 0, 0], LeftArm: [-50, 0, -50], RightArm: [-50, 0, 50], _lift: -0.55 })],
    [0.85, pose({ Spine: [-66, 0, 0], Chest: [-28, 0, 0], Head: [30, 0, 0], LeftUpLeg: [56, 0, 0], RightUpLeg: [44, 0, 0], LeftLeg: [40, 0, 0], RightLeg: [34, 0, 0], _lift: -0.58 })]
  ] },
  Goku_GetUp: { dur: 0.8, loop: false, translate: true, keys: [
    [0.0, pose({ Spine: [-66, 0, 0], Chest: [-28, 0, 0], Head: [30, 0, 0], LeftUpLeg: [56, 0, 0], RightUpLeg: [44, 0, 0], LeftLeg: [40, 0, 0], RightLeg: [34, 0, 0], _lift: -0.58 })],
    [0.26, pose({ Spine: [-30, 0, 0], Chest: [-14, 0, 0], Head: [16, 0, 0], LeftUpLeg: [40, 0, 0], RightUpLeg: [30, 0, 0], LeftLeg: [70, 0, 0], RightLeg: [60, 0, 0], LeftArm: [-30, 0, -20], RightArm: [-30, 0, 20], _lift: -0.3 })],
    [0.5, pose({ Spine: [18, 0, 0], Chest: [8, 0, 0], LeftUpLeg: [22, 0, 0], RightUpLeg: [18, 0, 0], LeftLeg: [40, 0, 0], RightLeg: [36, 0, 0], _lift: -0.08 })],
    [0.8, STANCE]
  ] },
  Goku_Victory: { dur: 1.4, loop: false, keys: [
    [0.0, STANCE],
    [0.25, pose({ Spine: [-8, 0, 0], RightArm: [-150, 0, 10], RightForeArm: [0, 0, 0], LeftArm: [-20, 0, -10], Head: [-10, 0, 0] })],
    [0.6, pose({ Spine: [-10, 0, 0], RightArm: [-158, 0, 12], RightForeArm: [-6, 0, 0], LeftArm: [-30, 0, -14], Head: [-12, 0, 0], Chest: [-4, 0, 0] })],
    [1.0, pose({ Spine: [-6, 0, 0], RightArm: [-150, 0, 10], LeftArm: [-24, 0, -12], Head: [-8, 0, 0] })],
    [1.4, pose({ Spine: [-8, 0, 0], RightArm: [-150, 0, 10], LeftArm: [-24, 0, -12] })]
  ] },
  Goku_Defeat: { dur: 1.3, loop: false, translate: true, keys: [
    [0.0, STANCE],
    [0.3, pose({ Spine: [22, 0, 0], Chest: [10, 0, 0], Neck: [16, 0, 0], Head: [18, 0, 0], LeftArm: [6, 0, -8], RightArm: [6, 0, 8], LeftUpLeg: [14, 0, 0], RightUpLeg: [10, 0, 0], LeftLeg: [26, 0, 0], RightLeg: [22, 0, 0], _lift: -0.1 })],
    [0.7, pose({ Spine: [34, 0, 0], Chest: [14, 0, 0], Neck: [22, 0, 0], Head: [24, 0, 0], LeftArm: [10, 0, -6], RightArm: [10, 0, 6], LeftUpLeg: [30, 0, 0], RightUpLeg: [24, 0, 0], LeftLeg: [60, 0, 0], RightLeg: [54, 0, 0], _lift: -0.42 })],
    [1.3, pose({ Spine: [30, 0, 0], Chest: [12, 0, 0], Neck: [20, 0, 0], Head: [22, 0, 0], LeftUpLeg: [26, 0, 0], RightUpLeg: [20, 0, 0], LeftLeg: [52, 0, 0], RightLeg: [46, 0, 0], _lift: -0.46 })]
  ] },
  // ---- ki abilities ----------------------------------------------------------------------
  Goku_KiBlast: { dur: 0.55, loop: false, keys: [
    [0.0, STANCE],
    [0.12, pose({ RightArm: [10, 20, 0], RightForeArm: [50, 0, 0], Hips: [0, 18, 0], Spine: [0, 10, 0] })],
    [0.24, pose({ RightArm: [-72, -30, 76], RightForeArm: [44, 0, 0], RightHand: [0, 0, 10], Hips: [0, -16, 0], Spine: [0, -10, 0], LeftArm: [-24, 0, -18] })],
    [0.38, pose({ RightArm: [-60, -10, 0], RightForeArm: [10, 0, 0], Hips: [0, -8, 0] })],
    [0.55, STANCE]
  ] },
  // Two-handed charge. The arm solution was solved against the rig with scripts/probe-goku-pose.mjs:
  // this combination puts the palms 1.3 cm apart, 17.7 cm ahead of the chest and level with it
  // (measured), so the charge reads as a Kamehameha rather than two arms held out sideways.
  Goku_KamehamehaCharge: { dur: 1.1, loop: true, keys: [
    [0.0, pose({ Hips: [0, 20, 0], Spine: [4, 12, 0], Chest: [2, 0, 0], RightShoulder: [0, 0, 20], LeftShoulder: [0, 0, -20], RightArm: [-70, 0, 55], LeftArm: [-70, 0, -55], RightForeArm: [-40, 0, 0], LeftForeArm: [-40, 0, 0], LeftUpLeg: [16, 0, 0], RightUpLeg: [10, 0, 0], LeftLeg: [30, 0, 0], RightLeg: [22, 0, 0] })],
    [0.55, pose({ Hips: [0, 24, 0], Spine: [6, 14, 0], Chest: [2, 0, 0], RightShoulder: [0, 0, 22], LeftShoulder: [0, 0, -22], RightArm: [-72, 0, 56], LeftArm: [-72, 0, -56], RightForeArm: [-42, 0, 0], LeftForeArm: [-42, 0, 0], LeftUpLeg: [18, 0, 0], RightUpLeg: [12, 0, 0], LeftLeg: [34, 0, 0], RightLeg: [26, 0, 0] })],
    [1.1, pose({ Hips: [0, 20, 0], Spine: [4, 12, 0], Chest: [2, 0, 0], RightShoulder: [0, 0, 20], LeftShoulder: [0, 0, -20], RightArm: [-70, 0, 55], LeftArm: [-70, 0, -55], RightForeArm: [-40, 0, 0], LeftForeArm: [-40, 0, 0], LeftUpLeg: [16, 0, 0], RightUpLeg: [10, 0, 0], LeftLeg: [30, 0, 0], RightLeg: [22, 0, 0] })]
  ] },
  // Release: gather from the two-handed charge, then drive both palms forward. The thrust key keeps
  // the hands together and extends the elbows, which is what makes the fire read at gameplay distance.
  Goku_Kamehameha: { dur: 1.0, loop: false, keys: [
    [0.0, pose({ Hips: [0, 20, 0], Spine: [4, 12, 0], RightShoulder: [0, 0, 20], LeftShoulder: [0, 0, -20], RightArm: [-70, 0, 55], LeftArm: [-70, 0, -55], RightForeArm: [-40, 0, 0], LeftForeArm: [-40, 0, 0], LeftUpLeg: [16, 0, 0], RightUpLeg: [10, 0, 0] })],
    [0.18, pose({ Hips: [0, 26, 0], Spine: [-6, 16, 0], RightShoulder: [0, 0, 24], LeftShoulder: [0, 0, -24], RightArm: [-62, 0, 60], LeftArm: [-62, 0, -60], RightForeArm: [-58, 0, 0], LeftForeArm: [-58, 0, 0], LeftUpLeg: [20, 0, 0], RightUpLeg: [14, 0, 0] })],
    [0.38, pose({ Hips: [0, -14, 0], Spine: [-4, -12, 0], Chest: [-4, 0, 0], RightShoulder: [0, 0, 10], LeftShoulder: [0, 0, -10], RightArm: [-96, 0, 45], LeftArm: [-96, 0, -45], RightForeArm: [8, 0, 0], LeftForeArm: [8, 0, 0], LeftHand: [0, 0, -14], RightHand: [0, 0, 14], LeftUpLeg: [24, 0, 0], RightUpLeg: [10, 0, 0], LeftLeg: [40, 0, 0], RightLeg: [18, 0, 0] })],
    [0.62, pose({ Hips: [0, -10, 0], Spine: [-2, -8, 0], RightShoulder: [0, 0, 10], LeftShoulder: [0, 0, -10], RightArm: [-92, 0, 44], LeftArm: [-92, 0, -44], RightForeArm: [6, 0, 0], LeftForeArm: [6, 0, 0], LeftUpLeg: [20, 0, 0], RightUpLeg: [8, 0, 0], LeftLeg: [34, 0, 0], RightLeg: [16, 0, 0] })],
    [1.0, STANCE]
  ] },
  Goku_InstantTransmission: { dur: 0.7, loop: false, keys: [
    [0.0, STANCE],
    [0.16, pose({ RightArm: [-120, 0, 24], RightForeArm: [100, 0, 0], RightHand: [0, 0, 20], Spine: [4, 0, 0], Head: [-6, 0, 0] })],
    [0.34, pose({ RightArm: [-130, 0, 28], RightForeArm: [110, 0, 0], Spine: [10, 0, 0], Chest: [6, 0, 0], LeftUpLeg: [10, 0, 0], RightUpLeg: [6, 0, 0] })],
    [0.52, pose({ Spine: [16, 0, 0], Chest: [8, 0, 0], RightArm: [-100, 0, 20], RightForeArm: [80, 0, 0], LeftArm: [-30, 0, -20] })],
    [0.7, STANCE]
  ] },
  Goku_DragonFist: { dur: 0.9, loop: false, keys: [
    [0.0, STANCE],
    [0.18, pose({ Hips: [0, 34, 0], Spine: [-12, 20, 0], RightArm: [-10, 40, 0], RightForeArm: [100, 0, 0], LeftArm: [-40, 0, -18], LeftUpLeg: [18, 0, 0], RightUpLeg: [12, 0, 0], LeftLeg: [34, 0, 0], RightLeg: [26, 0, 0] })],
    [0.36, pose({ Hips: [0, -30, 0], Spine: [10, -26, 0], Chest: [6, 0, 0], RightArm: [-76, -24, 82], RightForeArm: [40, 0, 0], RightShoulder: [0, 0, 18], LeftArm: [10, 0, -24], LeftUpLeg: [-10, 0, 0], RightUpLeg: [-16, 0, 0], LeftLeg: [16, 0, 0], RightLeg: [22, 0, 0] })],
    [0.6, pose({ Hips: [0, -12, 0], Spine: [4, -10, 0], RightArm: [-70, -10, 0], RightForeArm: [16, 0, 0] })],
    [0.9, STANCE]
  ] },
  // DRAGON NOVA: the dragon-fist wind-up and launch, then both palms gather and fire the beam.
  // Four distinct beats so the ultimate reads as a sequence, not a held two-handed pose.
  Goku_Ultimate: { dur: 1.6, loop: false, keys: [
    [0.0, STANCE],
    [0.16, pose({ Hips: [0, 30, 0], Spine: [-12, 18, 0], Chest: [-6, 0, 0], RightArm: [12, 40, 0], RightForeArm: [102, 0, 0], LeftArm: [-40, 0, -18], LeftUpLeg: [20, 0, 0], RightUpLeg: [14, 0, 0], LeftLeg: [38, 0, 0], RightLeg: [30, 0, 0] })],
    [0.3, pose({ Hips: [0, 40, 0], Spine: [-18, 24, 0], Chest: [-10, 0, 0], RightArm: [18, 46, 0], RightForeArm: [108, 0, 0], LeftArm: [-46, 0, -22], Head: [-10, -14, 0], LeftUpLeg: [26, 0, 0], RightUpLeg: [18, 0, 0], LeftLeg: [46, 0, 0], RightLeg: [36, 0, 0] })],
    [0.46, pose({ Hips: [0, -34, 0], Spine: [12, -28, 0], Chest: [8, 0, 0], RightArm: [-96, -24, 0], RightForeArm: [0, 0, 0], RightShoulder: [0, 0, 20], LeftArm: [14, 0, -26], Head: [-6, 12, 0], LeftUpLeg: [-12, 0, 0], RightUpLeg: [-18, 0, 0], LeftLeg: [18, 0, 0], RightLeg: [24, 0, 0] })],
    [0.64, pose({ Hips: [0, 24, 0], Spine: [2, 16, 0], RightArm: [-18, 34, 0], RightForeArm: [92, 0, 0], LeftArm: [-22, 28, 0], LeftForeArm: [88, 0, 0], LeftUpLeg: [22, 0, 0], RightUpLeg: [14, 0, 0], LeftLeg: [42, 0, 0], RightLeg: [32, 0, 0] })],
    [0.86, pose({ Hips: [0, -18, 0], Spine: [-10, -18, 0], Chest: [-8, 0, 0], RightArm: [-92, -20, 0], RightForeArm: [0, 0, 0], LeftArm: [-96, -18, 0], LeftForeArm: [0, 0, 0], LeftHand: [0, 0, -16], RightHand: [0, 0, 16], Head: [-8, 0, 0], LeftUpLeg: [26, 0, 0], RightUpLeg: [8, 0, 0], LeftLeg: [44, 0, 0], RightLeg: [16, 0, 0] })],
    [1.15, pose({ Hips: [0, -12, 0], Spine: [-6, -10, 0], RightArm: [-88, -16, 0], LeftArm: [-92, -14, 0], LeftUpLeg: [22, 0, 0], RightUpLeg: [8, 0, 0], LeftLeg: [38, 0, 0], RightLeg: [16, 0, 0] })],
    [1.6, STANCE]
  ] },
  // ---- transformations --------------------------------------------------------------------
  Goku_FormSuperSaiyan: { dur: 1.2, loop: false, keys: [
    [0.0, STANCE],
    [0.22, pose({ Spine: [18, 0, 0], Chest: [10, 0, 0], Neck: [8, 0, 0], Head: [10, 0, 0], LeftArm: [-8, 0, -22], RightArm: [-8, 0, 22], LeftUpLeg: [22, 0, 0], RightUpLeg: [16, 0, 0], LeftLeg: [42, 0, 0], RightLeg: [34, 0, 0] })],
    [0.45, pose({ Spine: [-16, 0, 0], Chest: [-10, 0, 0], Neck: [-12, 0, 0], Head: [-14, 0, 0], LeftArm: [-46, 0, -34], RightArm: [-46, 0, 34], LeftForeArm: [20, 0, 0], RightForeArm: [20, 0, 0], LeftUpLeg: [-4, 0, 0], RightUpLeg: [-8, 0, 0] })],
    [0.7, pose({ Spine: [-22, 0, 0], Chest: [-12, 0, 0], Head: [-16, 0, 0], LeftArm: [-58, 0, -40], RightArm: [-58, 0, 40], LeftForeArm: [10, 0, 0], RightForeArm: [10, 0, 0] })],
    [1.2, pose({ Spine: [-6, 0, 0], Chest: [-2, 0, 0], LeftArm: [-30, 0, -16], RightArm: [-30, 0, 16] })]
  ] },
  Goku_FormSuperSaiyanBlue: { dur: 1.25, loop: false, keys: [
    [0.0, STANCE],
    [0.24, pose({ Hips: [0, -20, 0], Spine: [14, -12, 0], Chest: [8, 0, 0], RightArm: [-6, 30, 0], RightForeArm: [90, 0, 0], LeftArm: [-40, 0, -20], LeftUpLeg: [18, 0, 0], RightUpLeg: [24, 0, 0], LeftLeg: [34, 0, 0], RightLeg: [42, 0, 0] })],
    [0.5, pose({ Hips: [0, 0, 0], Spine: [-18, 0, 0], Chest: [-12, 0, 0], Neck: [-14, 0, 0], Head: [-16, 0, 0], LeftArm: [-60, 0, -44], RightArm: [-60, 0, 44], LeftForeArm: [0, 0, 0], RightForeArm: [0, 0, 0], LeftUpLeg: [-6, 0, 0], RightUpLeg: [-6, 0, 0] })],
    [0.78, pose({ Spine: [-24, 0, 0], Chest: [-14, 0, 0], Head: [-18, 0, 0], LeftArm: [-70, 0, -50], RightArm: [-70, 0, 50] })],
    [1.25, pose({ Spine: [-8, 0, 0], LeftArm: [-32, 0, -18], RightArm: [-32, 0, 18] })]
  ] },
  Goku_FormUltraInstinct: { dur: 1.4, loop: false, keys: [
    [0.0, STANCE],
    [0.3, pose({ Spine: [10, 0, 0], Chest: [6, 0, 0], Neck: [6, 0, 0], Head: [8, 0, 0], LeftArm: [-10, 0, -26], RightArm: [-10, 0, 26], LeftForeArm: [10, 0, 0], RightForeArm: [10, 0, 0], LeftUpLeg: [24, 0, 0], RightUpLeg: [18, 0, 0], LeftLeg: [46, 0, 0], RightLeg: [38, 0, 0] })],
    [0.6, pose({ Spine: [-14, 0, 0], Chest: [-8, 0, 0], Neck: [-10, 0, 0], Head: [-12, 0, 0], LeftArm: [-40, 0, -36], RightArm: [-40, 0, 36], LeftForeArm: [-6, 0, 0], RightForeArm: [-6, 0, 0], LeftUpLeg: [-2, 0, 0], RightUpLeg: [-6, 0, 0] })],
    [0.85, pose({ Spine: [-20, 0, 0], Chest: [-10, 0, 0], Head: [-14, 0, 0], LeftArm: [-52, 0, -42], RightArm: [-52, 0, 42] })],
    [1.4, pose({ Spine: [-4, 0, 0], LeftArm: [-28, 0, -14], RightArm: [-28, 0, 14] })]
  ] }
};

// The base stance was a near T-pose: the arms sat only 14-16 degrees below the rest pose, so every
// clip read as "standing still". The guard measured with scripts/probe-goku-pose.mjs lowers the hands
// to chest height about 0.57 m apart. Attack keys store absolute rotations, so each arm key is
// re-based by the same 45 degrees to keep the authored strike angles and only move the stance.
for (const clip of Object.values(CLIPS)) {
  for (const [, poseValues] of clip.keys) {
    for (const bone of ['LeftArm', 'RightArm']) {
      if (poseValues[bone]) poseValues[bone][0] += 45;
    }
  }
}

// Standing clips get measured grounding. Airborne clips, flight and the knockdown cycle keep their
// authored vertical motion, and a clip that already translates the hips is never re-grounded.
const AIRBORNE = /Jump|Land|Fly|Hover|Fall|Air|Slam|Knockdown|GetUp|Defeat/;
// REBASE grounded stance: idle/walk/run/turn keys set arm X absolutely, so they kept the raw
// T-pose. Lowering them by the measured guard angle (probe-goku-pose.mjs) gives a real fighting
// stance while leaving strike, block and Kamehameha keys untouched.
for (const [name, clip] of Object.entries(CLIPS)) {
  if (!/Idle|Walk|Run|Turn/.test(name) || /Fly|Hover/.test(name)) continue;
  for (const [, poseValues] of clip.keys) {
    for (const [bone, drop] of [['LeftArm', 57], ['RightArm', 59]]) {
      const value = poseValues[bone];
      if (value && Math.abs(value[0]) <= 38) value[0] = Math.max(-95, value[0] - drop);
    }
  }
}

for (const [name, clip] of Object.entries(CLIPS)) {
  if (!clip.translate && !AIRBORNE.test(name)) clip.ground = true;
}

// Legacy aliases the existing manifest already asks for.
CLIPS.Goku_Special = { ...CLIPS.Goku_Kamehameha };
CLIPS.Goku_Air = { ...CLIPS.Goku_AirPunch };
CLIPS.Goku_Heavy = { ...CLIPS.Goku_Heavy };

// ---------------------------------------------------------------- GLB writing
const gltf = {
  asset: { version: '2.0', generator: 'browser-smash goku clip authoring', copyright: 'Clip-only animation; body geometry untouched. Goku model by Oup77 (CC BY 4.0).' },
  scene: 0,
  scenes: [{ name: 'GokuClipRig', nodes: [0] }],
  nodes: [],
  animations: [],
  accessors: [],
  bufferViews: [],
  buffers: []
};

const nodeIndexByJoint = new Map();
const order = [];
(function walk(name) {
  const info = rest.get(name);
  if (!info) return;
  order.push(name);
  const index = gltf.nodes.length;
  nodeIndexByJoint.set(name, index);
  const node = { name };
  if (JSON.stringify(info.t) !== '[0,0,0]') node.translation = info.t;
  if (JSON.stringify(info.r) !== '[0,0,0,1]') node.rotation = info.r;
  if (JSON.stringify(info.s) !== '[1,1,1]') node.scale = info.s;
  gltf.nodes.push(node);
  const children = order.filter(child => rest.get(child)?.parent === name);
  if (children.length) node.children = [];
})(joints.length ? nodes[joints[0]].name : 'Hips');

// Build the hierarchy in a second pass so every child index exists.
for (const name of [...rest.keys()]) {
  if (!nodeIndexByJoint.has(name)) {
    const info = rest.get(name);
    const index = gltf.nodes.length;
    nodeIndexByJoint.set(name, index);
    const node = { name };
    if (JSON.stringify(info.t) !== '[0,0,0]') node.translation = info.t;
    if (JSON.stringify(info.r) !== '[0,0,0,1]') node.rotation = info.r;
    if (JSON.stringify(info.s) !== '[1,1,1]') node.scale = info.s;
    gltf.nodes.push(node);
  }
}
for (const [name, info] of rest) {
  const index = nodeIndexByJoint.get(name);
  if (!index && index !== 0) continue;
  const parentIndex = info.parent !== null ? nodeIndexByJoint.get(info.parent) : undefined;
  if (parentIndex === undefined) continue;
  const parentNode = gltf.nodes[parentIndex];
  parentNode.children = parentNode.children || [];
  if (!parentNode.children.includes(index)) parentNode.children.push(index);
}
// Root nodes are the joints whose parent is not part of the skin.
gltf.scenes[0].nodes = [...rest.entries()]
  .filter(([name, info]) => info.parent === null || !rest.has(info.parent))
  .map(([name]) => nodeIndexByJoint.get(name));

const binary = [];
let byteLength = 0;
function pushFloats(values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  while (byteLength % 4 !== 0) { binary.push(Buffer.from([0])); byteLength += 1; }
  const byteOffset = byteLength;
  binary.push(buffer);
  byteLength += buffer.length;
  return byteOffset;
}
function addAccessor(values, type, componentType, min, max) {
  const byteOffset = pushFloats(values);
  gltf.bufferViews.push({ buffer: 0, byteOffset, byteLength: values.length * 4, target: 34962 });
  gltf.accessors.push({ bufferView: gltf.bufferViews.length - 1, componentType, count: values.length / (type === 'VEC4' ? 4 : type === 'VEC3' ? 3 : 1), type, min, max });
  return gltf.accessors.length - 1;
}

const clipReport = [];
for (const [name, clip] of Object.entries(CLIPS)) {
  const times = clip.keys.map(([time]) => time);
  const duration = Math.max(clip.dur, times[times.length - 1]);
  const timeAccessor = addAccessor(times, 'SCALAR', 5126, [Math.min(...times)], [Math.max(...times)]);
  const samplers = [];
  const channels = [];
  const bones = new Set(clip.keys.flatMap(([, pose]) => Object.keys(pose).filter(bone => bone !== '_lift')));
  for (const bone of bones) {
    if (!rest.has(bone)) continue;
    const values = [];
    for (const [, clipPose] of clip.keys) {
      const delta = quatFromEulerXYZ(clipPose[bone] || [0, 0, 0]);
      values.push(...normalise(mul(rest.get(bone).r, delta)));
    }
    const output = addAccessor(values, 'VEC4', 5126, [-1, -1, -1, -1], [1, 1, 1, 1]);
    samplers.push({ input: timeAccessor, output, interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node: nodeIndexByJoint.get(bone), path: 'rotation' } });
  }
  if ((clip.translate || clip.ground) && rest.has('Hips')) {
    const values = [];
    for (const [, clipPose] of clip.keys) {
      // A grounded clip derives its vertical offset from the pose itself, so every key puts the
      // lowest foot on the idle ground line instead of hovering. A clip that already animates lift
      // (jump, slam, knockdown) keeps its authored value: those are deliberately airborne.
      // Authored lift and derived grounding are both rig-space metres on the Hips' local Z, which is
      // the axis the skeleton itself uses for height.
      const measured = clip.ground && !clip.translate
        ? GROUND_BASELINE - groundedFoot(clipPose)
        : (clipPose._lift || 0);
      // Guard against a degenerate axis: a wrong factor would multiply into an absurd hip offset,
      // which is worse than a few centimetres of hover.
      const lift = Number.isFinite(measured) ? Math.max(-0.6, Math.min(0.6, measured)) : 0;
      const base = rest.get('Hips').t;
      values.push(base[0], base[1], base[2] + lift);
    }
    const output = addAccessor(values, 'VEC3', 5126, [-10, -10, -10], [10, 10, 10]);
    samplers.push({ input: timeAccessor, output, interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node: nodeIndexByJoint.get('Hips'), path: 'translation' } });
  }
  gltf.animations.push({ name, samplers, channels });
  const maxDelta = Math.max(...clip.keys.flatMap(([, pose]) => Object.values(pose).flat().map(Math.abs)));
  clipReport.push({ name, duration, keys: clip.keys.length, bones: bones.size, loop: Boolean(clip.loop), maxDelta });
}

const bin = Buffer.concat(binary);
gltf.buffers.push({ byteLength: bin.length });
const jsonBuffer = Buffer.from(JSON.stringify(gltf), 'utf8');
const jsonPad = (4 - (jsonBuffer.length % 4)) % 4;
const binPad = (4 - (bin.length % 4)) % 4;
const total = 12 + 8 + jsonBuffer.length + jsonPad + 8 + bin.length + binPad;
const out = Buffer.alloc(total);
out.writeUInt32LE(0x46546c67, 0);
out.writeUInt32LE(2, 4);
out.writeUInt32LE(total, 8);
out.writeUInt32LE(jsonBuffer.length + jsonPad, 12);
out.writeUInt32LE(0x4e4f534a, 16);
jsonBuffer.copy(out, 20);
out.fill(0x20, 20 + jsonBuffer.length, 20 + jsonBuffer.length + jsonPad);
const binHeader = 20 + jsonBuffer.length + jsonPad;
out.writeUInt32LE(bin.length + binPad, binHeader);
out.writeUInt32LE(0x004e4942, binHeader + 4);
bin.copy(out, binHeader + 8);

mkdirSync(dirname(resolve(OUT)), { recursive: true });
writeFileSync(OUT, out);
writeFileSync('artifacts/goku-anim/clip-report.json', JSON.stringify({ source: BODY, output: OUT, bytes: out.length, clips: clipReport }, null, 2));
console.log(JSON.stringify({ ok: true, output: OUT, bytes: out.length, clips: clipReport.length, bones: rest.size, names: clipReport.map(clip => clip.name) }, null, 1));
