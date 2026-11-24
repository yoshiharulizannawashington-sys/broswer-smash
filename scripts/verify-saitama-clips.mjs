#!/usr/bin/env node
// Verify the authored Saitama clip set on the real body.
//
// This is the node-side acceptance for the Goku-benchmark pass on a different skeleton family. It
// binds every authored clip with the production solo adapter (exact-name or explicit unresolved
// report), then samples nine phases on the mounted skeleton and measures:
//   - how many of the 158 joints actually rotate
//   - both ankle heights (planted support, lifted swing, airborne tuck)
//   - strike-hand reach relative to the shoulder midpoint
//   - the lowest skinned vertex, so a grounded clip cannot sink through the floor
// It also checks that all shipped names and durations were preserved.
//
//   node scripts/verify-saitama-clips.mjs
import './glb-node-compat.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { prepareSoloClip, unresolvedClipNodes } from '../public/js/anim/solo_rig_lanes.js';

globalThis.self ||= globalThis;
const BODY = 'public/models/characters/imported/saitama/saitama.glb';
const CLIPS = 'public/models/characters/bespoke/saitama_animated.glb';
const AIRBORNE = /jump|fly|hover|air|launch|fall|dive|takeoff|double|float/i;
const GROUND_SKIP = /jump|fly|hover|air|launch|fall|dive|takeoff|double|float|knockdown|get_up|victory|defeat/i;
const QUIET = /idle|block|charge|hover|fly|strafe|victory/i;

const load = file => new Promise((ok, bad) => {
  const bytes = readFileSync(file);
  new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', ok, bad);
});

const round = (value, digits = 3) => Number.isFinite(value) ? +value.toFixed(digits) : null;
const [bodyGltf, clipGltf] = await Promise.all([load(BODY), load(CLIPS)]);
const body = bodyGltf.scene;
body.updateMatrixWorld(true);
const bodyClips = new Map((bodyGltf.animations || []).map(clip => [clip.name, clip]));
const authored = new Map((clipGltf.animations || []).map(clip => [clip.name, clip]));
const bones = [];
body.traverse(node => { if (node.isBone) bones.push(node); });
const skinned = [];
body.traverse(node => { if (node.isSkinnedMesh) skinned.push(node); });

const at = name => body.getObjectByName(name);
const world = name => at(name)?.getWorldPosition(new THREE.Vector3());
const norm = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const findBone = fragment => {
  const wanted = norm(fragment);
  return bones.find(bone => norm(bone.name) === wanted)
    || bones.find(bone => norm(bone.name).startsWith(wanted)) || null;
};
const hips = findBone('spine_156');
const leftFoot = findBone('footl148');
const rightFoot = findBone('footr153');
const leftHand = findBone('handl114');
const rightHand = findBone('handr137');
const leftUpper = findBone('upper_arml116');
const rightUpper = findBone('upper_armr139');
const footY = world(leftFoot.name).y;

function snapshot() {
  const out = [];
  body.traverse(node => {
    if (!node.isBone && !node.isObject3D) return;
    out.push([node, node.position.clone(), node.quaternion.clone(), node.scale.clone()]);
  });
  return out;
}
function restore(state) {
  for (const [node, position, quaternion, scale] of state) {
    node.position.copy(position); node.quaternion.copy(quaternion); node.scale.copy(scale);
  }
  body.updateMatrixWorld(true);
}

const vertexStride = (() => {
  let total = 0;
  for (const mesh of skinned) total += mesh.geometry?.attributes?.position?.count || 0;
  return Math.max(1, Math.floor(total / 16000));
})();
function minSkinnedY() {
  let min = Infinity;
  let meshName = null;
  const point = new THREE.Vector3();
  for (const mesh of skinned) {
    const positions = mesh.geometry?.attributes?.position;
    if (!positions) continue;
    mesh.skeleton?.update?.();
    for (let i = 0; i < positions.count; i += vertexStride) {
      point.fromBufferAttribute(positions, i);
      if (typeof mesh.applyBoneTransform === 'function') mesh.applyBoneTransform(i, point);
      else if (typeof mesh.boneTransform === 'function') mesh.boneTransform(i, point);
      point.applyMatrix4(mesh.matrixWorld);
      if (Number.isFinite(point.y) && point.y < min) { min = point.y; meshName = mesh.name; }
    }
  }
  return { min, meshName };
}

const rest = snapshot();
const restQuats = new Map(rest.map(([node, , quaternion]) => [node.name, quaternion]));
const fingerBones = bones.filter(bone => /^f(index|middle|ring|pinky|thumb)0[123][lr]/.test(norm(bone.name)));
const baselineMinY = minSkinnedY();
const mixer = new THREE.AnimationMixer(body);
const report = [];
const missing = [];
const durationMismatch = [];
const unresolved = [];

for (const [name, source] of authored) {
  const shipped = bodyClips.get(name.replace(/^Saitama_/, ''));
  if (!shipped) missing.push(name);
  else if (Math.abs(shipped.duration - source.duration) > 0.0015) {
    durationMismatch.push({ name, shipped: round(shipped.duration), authored: round(source.duration) });
  }
  restore(rest);
  const prepared = prepareSoloClip(source, null, body, { name });
  if (prepared.mode !== 'exact') unresolved.push({ name, mode: prepared.mode, unresolved: prepared.unresolved?.slice(0, 4) });
  const clip = prepared.clip;
  mixer.stopAllAction();
  const action = mixer.clipAction(clip);
  action.reset(); action.setEffectiveWeight(1); action.play();
  const samples = [];
  for (let i = 0; i < 9; i++) {
    action.time = clip.duration * i / 8;
    action.paused = true;
    mixer.update(0);
    body.updateMatrixWorld(true);
    const snap = new Map();
    for (const bone of bones) snap.set(bone.name, bone.quaternion.clone());
    const shoulderMid = world(leftUpper.name).add(world(rightUpper.name)).multiplyScalar(0.5);
    samples.push({
      snap,
      handL: world(leftHand.name), handR: world(rightHand.name), shoulderMid,
      footL: world(leftFoot.name).y, footR: world(rightFoot.name).y,
      minY: (i === 0 || i === 4 || i === 8) ? minSkinnedY() : null
    });
  }
  let moved = 0, max = 0, worstBone = null;
  let maxStep = 0, stepBone = null, stepIndex = -1;
  for (const bone of bones) {
    const first = samples[0].snap.get(bone.name);
    if (!first) continue;
    let angle = 0;
    for (let i = 1; i < samples.length; i++) {
      const quat = samples[i].snap.get(bone.name);
      if (!quat) continue;
      const dot = Math.min(1, Math.abs(first.dot(quat)));
      angle = Math.max(angle, 2 * Math.acos(dot));
      const previous = samples[i - 1].snap.get(bone.name);
      if (previous) {
        const step = 2 * Math.acos(Math.min(1, Math.abs(previous.dot(quat))));
        if (step > maxStep) { maxStep = step; stepBone = bone.name; stepIndex = i; }
      }
    }
    if (angle > 0.02) moved++;
    if (angle > max) { max = angle; worstBone = bone.name; }
  }
  const mid = samples[4];
  let fingerCurl = 0, curlBone = null;
  for (const bone of fingerBones) {
    const before = restQuats.get(bone.name);
    const after = mid.snap.get(bone.name);
    if (!before || !after) continue;
    const angle = 2 * Math.acos(Math.min(1, Math.abs(before.dot(after))));
    if (angle > fingerCurl) { fingerCurl = angle; curlBone = bone.name; }
  }
  const reach = [mid.handL, mid.handR].map(hand => round(hand.z - mid.shoulderMid.z));
  const spread = round(mid.handL.distanceTo(mid.handR));
  const footHeights = [round(mid.footL), round(mid.footR)];
  const minYs = samples.filter(sample => sample.minY !== null).map(sample => round(sample.minY.min, 4));
  const lowest = Math.min(...samples.map(sample => sample.footL), ...samples.map(sample => sample.footR));
  const cleanMin = minYs.length ? Math.min(...minYs) : null;
  const worstMesh = samples.filter(sample => sample.minY !== null)
    .sort((a, b) => a.minY.min - b.minY.min)[0]?.minY.meshName || null;
  const problems = [];
  if (clip.tracks.length !== 159) problems.push(`${clip.tracks.length} tracks, expected 159`);
  if (moved < (QUIET.test(name) ? 4 : 10)) problems.push(`only ${moved} joints move`);
  if (fingerBones.length && fingerCurl < 0.15) problems.push(`fingers stay open (${round(fingerCurl, 3)} rad)`);
  if (!GROUND_SKIP.test(name) && footHeights[0] < footY - 0.03 && footHeights[1] < footY - 0.03) {
    problems.push('both feet below the planted ankle height');
  }
  report.push({
    clip: name, duration: round(clip.duration), shippedDuration: shipped ? round(shipped.duration) : null,
    tracks: clip.tracks.length, bones: new Set(clip.tracks.map(track => String(track.name).split('.')[0])).size,
    bindMode: prepared.mode, moved, maxDelta: round(max, 4), worstBone,
    maxStep: round(maxStep, 4), stepBone, stepIndex,
    fingerCurl: round(fingerCurl, 4), curlBone,
    footHeights, lowestFoot: round(lowest), handReach: reach, handSpread: spread,
    minSkinnedY: cleanMin, minMesh: worstMesh, grounded: !AIRBORNE.test(name), problems
  });
  mixer.stopAllAction(); mixer.uncacheRoot(body);
  restore(rest);
}

const summary = {
  generatedAt: new Date().toISOString(),
  body: BODY, clips: CLIPS, bodyJoints: bones.length,
  authoredClips: authored.size, shippedClips: bodyClips.size,
  missingClips: missing, durationMismatch, unresolved,
  trackCounts: [...new Set(report.map(row => row.tracks))],
  movedRange: [Math.min(...report.map(row => row.moved)), Math.max(...report.map(row => row.moved))],
  baselineMinY: round(baselineMinY.min, 4), baselineMesh: baselineMinY.meshName,
  minSkinnedY: Math.min(...report.map(row => Number.isFinite(row.minSkinnedY) ? row.minSkinnedY : 0)),
  failed: report.filter(row => row.problems.length).map(row => `${row.clip}: ${row.problems.join('; ')}`)
};
mkdirSync('artifacts/saitama-rebuild', { recursive: true });
writeFileSync(resolve('artifacts/saitama-rebuild/clip-verification.json'),
  JSON.stringify({ summary, clips: report }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 1));
for (const row of report) {
  console.log(`${row.clip.padEnd(13)} tracks=${row.tracks} moved=${String(row.moved).padStart(3)} max=${row.maxDelta} curl=${row.fingerCurl} feet=${row.footHeights.join('/')} reach=${row.handReach.join('/')} spread=${row.handSpread} minY=${row.minSkinnedY}`);
}
