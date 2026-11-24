// Verify the 55-fighter shared animation batch against the actual production GLBs.
//
// This is intentionally a node/three test, not a manifest audit: it loads every body with the same
// GLTFLoader the browser uses, binds every one of the 17 common clips to that body's own mixer,
// evaluates real skinned vertices, and repeats the binding with Kaze's shared source clip. A row is
// only marked passed when the clip loads, resolves its tracks, runs on the mixer, deforms the mesh,
// stays finite and does not drive the body through the floor.
//
//   npm run test:rig-batch
//
// The result is written to artifacts/rig-batch/verification.json. It is a runtime/structural
// result, not a visual acceptance or gameplay acceptance result.
import './glb-node-compat.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SHARED_RIG_CLIPS, SHARED_RIG_FAMILY } from '../public/js/anim/shared_rig_family_data.js';
import { applySharedRigGrounding, bindSharedRigFamily, calibrateSharedSourceClip } from '../public/js/anim/shared_rig_family.js';

const root = process.cwd();
const audit = JSON.parse(readFileSync(resolve(root, 'artifacts/rig-audit.json'), 'utf8'));
const auditGroup = (audit.groups || []).find(group => group.id === SHARED_RIG_FAMILY.id);
if (!auditGroup) throw new Error(`audit does not contain ${SHARED_RIG_FAMILY.id}`);
if (auditGroup.size !== 55) throw new Error(`expected 55 audit members, got ${auditGroup.size}`);
if (auditGroup.joints !== 19) throw new Error(`expected 19 joints, got ${auditGroup.joints}`);
if (!auditGroup.hasCore) throw new Error('the audit family does not bind the core roles');

const auditMembers = new Map(auditGroup.members.map(member => [member.slug, member]));
if (auditMembers.size !== 55) throw new Error('audit member keys are not unique');
if (SHARED_RIG_FAMILY.members.length !== 55) throw new Error('runtime registry does not contain 55 members');
const registryKeys = new Set(SHARED_RIG_FAMILY.members.map(member => member.key));
const auditKeys = new Set(auditMembers.keys());
for (const key of auditKeys) if (!registryKeys.has(key)) throw new Error(`runtime registry is missing ${key}`);
for (const key of registryKeys) if (!auditKeys.has(key)) throw new Error(`runtime registry contains a stranger: ${key}`);
for (const member of SHARED_RIG_FAMILY.members) {
  const auditMember = auditMembers.get(member.key);
  if (!auditMember) throw new Error(`audit member missing for ${member.name}`);
  if (auditMember.url !== member.url) throw new Error(`${member.name} URL drifted from the audit`);
  for (const clip of SHARED_RIG_CLIPS) {
    if (!(auditMember.clipNames || []).includes(clip)) throw new Error(`${member.name} does not audit-contain ${clip}`);
  }
}
const sourceMember = SHARED_RIG_FAMILY.members.find(member => member.key === 'kaze');
if (!sourceMember || sourceMember.url !== SHARED_RIG_FAMILY.source) throw new Error('shared source is not Kaze');

const loader = new GLTFLoader();
const parseCache = new Map();
const publicPath = url => resolve(root, 'public', String(url).replace(/^\//, ''));

function parseGlb(url) {
  if (parseCache.has(url)) return parseCache.get(url);
  const promise = new Promise((ok, fail) => {
    const bytes = readFileSync(publicPath(url));
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    loader.parse(arrayBuffer, '', ok, error => fail(new Error(`${url}: ${error?.message || error}`)));
  });
  parseCache.set(url, promise);
  return promise;
}

function boneSnapshot(scene) {
  scene.updateMatrixWorld(true);
  const snapshot = [];
  scene.traverse(node => {
    if (node.isBone) snapshot.push([node, node.position.clone(), node.quaternion.clone(), node.scale.clone()]);
  });
  return snapshot;
}

function restoreBones(snapshot) {
  for (const [bone, position, quaternion, scale] of snapshot) {
    bone.position.copy(position);
    bone.quaternion.copy(quaternion);
    bone.scale.copy(scale);
  }
}

function topology(scene) {
  const names = [];
  const edges = [];
  scene.updateMatrixWorld(true);
  scene.traverse(node => {
    if (!node.isBone) return;
    names.push(node.name);
    edges.push(`${node.parent?.isBone ? node.parent.name : 'ROOT'}>${node.name}`);
  });
  return { names: names.sort(), edges: edges.sort() };
}

function prepare(scene, sourceTopology) {
  scene.updateMatrixWorld(true);
  const skinned = [];
  const samples = [];
  const triangles = [];
  scene.traverse(node => {
    if (!node.isSkinnedMesh) return;
    skinned.push(node);
    const count = node.geometry?.attributes?.position?.count || 0;
    if (!count) return;
    const maxPoints = 220;
    const step = Math.max(1, Math.ceil(count / maxPoints));
    const indices = [];
    for (let i = 0; i < count; i += step) indices.push(i);
    samples.push({ mesh: node, indices });
    const index = node.geometry.index;
    if (!index) return;
    const maxTriangles = 24;
    const triStep = Math.max(3, Math.floor(index.count / (3 * maxTriangles)) * 3);
    for (let i = 0; i + 2 < index.count; i += triStep) {
      triangles.push({ mesh: node, a: index.getX(i), b: index.getX(i + 1), c: index.getX(i + 2) });
    }
  });
  const rig = topology(scene);
  const sameTopology = rig.names.length === sourceTopology.names.length
    && rig.names.every((name, index) => name === sourceTopology.names[index])
    && rig.edges.length === sourceTopology.edges.length
    && rig.edges.every((edge, index) => edge === sourceTopology.edges[index]);
  return { skinned, samples, triangles, rig, sameTopology, snapshot: boneSnapshot(scene) };
}

function transformPoint(mesh, index, out = new THREE.Vector3()) {
  out.fromBufferAttribute(mesh.geometry.attributes.position, index);
  if (typeof mesh.applyBoneTransform === 'function') mesh.applyBoneTransform(index, out);
  else if (typeof mesh.boneTransform === 'function') mesh.boneTransform(index, out);
  out.applyMatrix4(mesh.matrixWorld);
  return out;
}

function samplePose(scene, prepared) {
  scene.updateMatrixWorld(true);
  const points = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { mesh, indices } of prepared.samples) {
    mesh.skeleton?.update?.();
    for (const index of indices) {
      const point = transformPoint(mesh, index);
      points.push(point);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
  }
  return { points, minY, maxY };
}

function significantBones(mesh, vertex, minimum = 0.05) {
  const index = mesh.geometry?.attributes?.skinIndex;
  const weight = mesh.geometry?.attributes?.skinWeight;
  if (!index || !weight) return [];
  const bones = [];
  for (let k = 0; k < 4; k++) {
    const w = [weight.getX, weight.getY, weight.getZ, weight.getW][k].call(weight, vertex);
    if (w < minimum) continue;
    const bone = mesh.skeleton?.bones?.[[index.getX, index.getY, index.getZ, index.getW][k].call(index, vertex)];
    if (bone) bones.push(bone);
  }
  return bones;
}

function boneSide(name) {
  const n = String(name || '').toLowerCase();
  if (/left|(?:^|[._:\-\s])l(?:$|[._:\-\s])/.test(n)) return 'left';
  if (/right|(?:^|[._:\-\s])r(?:$|[._:\-\s])/.test(n)) return 'right';
  return null;
}

function isAncestor(a, b) {
  for (let node = b; node; node = node.parent) if (node === a) return true;
  return false;
}

/** Cross-limb garment bridges, mouth interiors and joint creases are not surface tears. */
function classifySeams(prepared, reference) {
  const out = [];
  for (let i = 0; i < prepared.triangles.length; i++) {
    const { mesh, a, b, c } = prepared.triangles[i];
    const points = reference[i]?.points;
    if (!points) { out.push(null); continue; }
    const area = new THREE.Vector3().subVectors(points[1], points[0])
      .cross(new THREE.Vector3().subVectors(points[2], points[0])).length() / 2;
    const maxEdge = Math.max(reference[i][0], reference[i][1], reference[i][2]);
    const bones = [a, b, c].flatMap(v => significantBones(mesh, v));
    const names = [...new Set(bones.map(bone => String(bone.name || '')))];
    if (!names.length) { out.push(null); continue; }
    if (names.some(name => /mouth|jaw|teeth|tongue/i.test(name))) { out.push('mouth'); continue; }
    const sides = new Set(names.map(boneSide).filter(Boolean));
    // Only a small triangle qualifies as a garment bridge; a large tear is still reported
    // even when its vertices carry opposite-limb influence.
    if (area < 0.001 && maxEdge < 0.05 && sides.size > 1) { out.push('bridge'); continue; }
    if (area < 0.001 && maxEdge < 0.05 && bones.length >= 2 && bones.every(bone => bones.some(other => bone === other || isAncestor(bone, other) || isAncestor(other, bone)))) {
      out.push('crease');
      continue;
    }
    out.push(null);
  }
  return out;
}

function edgeStats(prepared, reference, seams = []) {
  let min = Infinity;
  let max = 0;
  let measured = 0;
  let worst = null;
  const counts = { bridge: 0, mouth: 0, crease: 0 };
  for (let i = 0; i < prepared.triangles.length; i++) {
    const { mesh, a, b, c } = prepared.triangles[i];
    const lengths = reference[i];
    if (!lengths) continue;
    const pa = transformPoint(mesh, a);
    const pb = transformPoint(mesh, b);
    const pc = transformPoint(mesh, c);
    const seam = seams[i];
    if (seam in counts) counts[seam] += 1;
    for (const [edge, p, q, before] of [
      [0, pa, pb, lengths[0]], [1, pb, pc, lengths[1]], [2, pc, pa, lengths[2]]
    ]) {
      if (!before || !Number.isFinite(before) || before < 0.002) continue;
      if (seam === 'bridge' || seam === 'mouth') continue;
      const after = p.distanceTo(q);
      if (!Number.isFinite(after)) continue;
      const ratio = after / before;
      if (seam === 'crease' && ratio < 1) continue;
      min = Math.min(min, ratio);
      if (ratio > max) {
        max = ratio;
        worst = {
          mesh: mesh.name || '(unnamed)', triangle: i, edge,
          rest: Number(before.toFixed(5)), posed: Number(after.toFixed(5)),
          vertices: [a, b, c], seam, at: Number(after.toFixed(5))
        };
      }
      measured += 1;
    }
  }
  return { min, max, measured, worst, counts };
}

function measureBindEdges(prepared) {
  const reference = [];
  for (const { mesh, a, b, c } of prepared.triangles) {
    const pa = transformPoint(mesh, a);
    const pb = transformPoint(mesh, b);
    const pc = transformPoint(mesh, c);
    reference.push([pa.distanceTo(pb), pb.distanceTo(pc), pc.distanceTo(pa)]);
    reference[reference.length - 1].points = [pa.clone(), pb.clone(), pc.clone()];
  }
  return reference;
}

function trackStats(clip, scene) {
  const nodes = new Set();
  scene.traverse(node => { if (node.name) nodes.add(node.name); });
  const unresolved = [];
  const properties = { rotation: 0, translation: 0, scale: 0, other: 0 };
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    const node = dot < 0 ? track.name : track.name.slice(0, dot);
    const property = dot < 0 ? 'other' : track.name.slice(dot + 1);
    if (property in properties) properties[property] += 1;
    else properties.other += 1;
    if (!nodes.has(node)) unresolved.push(track.name);
  }
  return { tracks: clip.tracks.length, unresolved, properties };
}

function measureClip(scene, prepared, mixer, clip, label, fighter, state) {
  mixer.stopAllAction();
  restoreBones(prepared.snapshot);
  scene.updateMatrixWorld(true);
  const bindPose = samplePose(scene, prepared);
  const edgeReference = measureBindEdges(prepared);
  const seams = classifySeams(prepared, edgeReference);
  const action = mixer.clipAction(clip);
  action.reset();
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.setEffectiveWeight(1);
  action.play();
  mixer.update(0.0001);
  const running = action.isRunning();
  const times = [0, 0.22, 0.44, 0.66, 0.86, 0.98].map(ratio => ratio * Math.max(0.01, clip.duration));
  let first = null;
  let posed = 0;
  let motion = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  let rootDrift = 0;
  let edgeMin = Infinity;
  let edgeMax = 0;
  let edgeSamples = 0;
  let edgeWorst = null;
  const edgeSeams = { bridge: 0, mouth: 0, crease: 0 };
  let maxFloorLift = 0;
  let finite = true;
  const hips = scene.getObjectByName('Hips');
  const bindHips = hips ? hips.getWorldPosition(new THREE.Vector3()) : null;

  for (const time of times) {
    action.time = Math.min(time, clip.duration);
    mixer.update(0.0001);
    scene.updateMatrixWorld(true);
    const floorLift = applySharedRigGrounding(scene, fighter, state);
    const pose = samplePose(scene, prepared);
    if (!Number.isFinite(pose.minY)) finite = false;
    minY = Math.min(minY, pose.minY);
    maxY = Math.max(maxY, pose.maxY);
    if (!first) first = pose.points;
    else motion = Math.max(motion, maxPairDistance(first, pose.points));
    posed = Math.max(posed, maxPairDistance(bindPose.points, pose.points));
    if (hips && bindHips) {
      const at = hips.getWorldPosition(new THREE.Vector3());
      rootDrift = Math.max(rootDrift, Math.hypot(at.x - bindHips.x, at.z - bindHips.z));
    }
    const edges = edgeStats(prepared, edgeReference, seams);
    edgeMin = Math.min(edgeMin, edges.min);
    edgeMax = Math.max(edgeMax, edges.max);
    edgeSamples += edges.measured;
    if (edges.worst && (!edgeWorst || edges.worst.posed > edgeWorst.posed)) edgeWorst = edges.worst;
    for (const kind of Object.keys(edgeSeams)) edgeSeams[kind] += edges.counts[kind];
    if (floorLift > 0) maxFloorLift = Math.max(maxFloorLift, floorLift);
  }
  action.stop();
  mixer.stopAllAction();
  restoreBones(prepared.snapshot);
  scene.updateMatrixWorld(true);

  return {
    label,
    clip: clip.name,
    duration: +clip.duration.toFixed(3),
    trackStats: trackStats(clip, scene),
    running,
    finite,
    posed: +posed.toFixed(5),
    motion: +motion.toFixed(5),
    minY: +minY.toFixed(5),
    maxY: +maxY.toFixed(5),
    rootDrift: +rootDrift.toFixed(5),
    edgeMin: Number.isFinite(edgeMin) ? +edgeMin.toFixed(3) : null,
    edgeMax: Number.isFinite(edgeMax) ? +edgeMax.toFixed(3) : null,
    edgeWorst,
    edgeSeams,
    edgeSamples,
    floorLift: +maxFloorLift.toFixed(4)
  };
}

function maxPairDistance(a, b) {
  let max = 0;
  const count = Math.min(a.length, b.length);
  for (let i = 0; i < count; i++) max = Math.max(max, a[i].distanceTo(b[i]));
  return max;
}

const sourceGltf = await parseGlb(SHARED_RIG_FAMILY.source);
const sourceTopology = topology(sourceGltf.scene);
const sourceClips = new Map((sourceGltf.animations || []).map(clip => [clip.name.toLowerCase(), clip]));
if (sourceClips.size !== 17) throw new Error(`shared source must contain 17 clips, got ${sourceClips.size}`);

const rows = [];
const failures = [];
const bodyCache = new Map();
let clippedBodies = 0;

for (const member of SHARED_RIG_FAMILY.members) {
  let gltf = bodyCache.get(member.url);
  if (!gltf) {
    gltf = await parseGlb(member.url);
    bodyCache.set(member.url, gltf);
  }
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const prepared = prepare(scene, sourceTopology);
  if (!prepared.sameTopology) failures.push(`${member.name}: body topology differs from Kaze`);
  if (!prepared.skinned.length) failures.push(`${member.name}: no skinned mesh`);

  const mixer = new THREE.AnimationMixer(scene);
  scene.userData.humanMixer = mixer;
  scene.userData.animationActions = {};
  for (const clip of gltf.animations || []) {
    scene.userData.animationActions[clip.name.toLowerCase()] = mixer.clipAction(clip);
  }
  const batch = bindSharedRigFamily(scene, { identityKey: member.key, identity: member.name, name: member.name, archetype: 'warrior' }, mixer);
  if (!batch || batch.native !== 17 || batch.fallback || batch.status !== 'ready') {
    failures.push(`${member.name}: shared batch did not resolve 17 native states (${JSON.stringify({ native: batch?.native, fallback: batch?.fallback, missing: batch?.missing, status: batch?.status })})`);
  }
  const bodyClips = new Map((gltf.animations || []).map(clip => [clip.name.toLowerCase(), clip]));

  for (const state of SHARED_RIG_CLIPS) {
    const nativeClip = bodyClips.get(state);
    const sharedClip = sourceClips.get(state);
    if (!nativeClip) {
      failures.push(`${member.name}/${state}: native clip missing`);
      continue;
    }
    if (!sharedClip) {
      failures.push(`${member.name}/${state}: shared source clip missing`);
      continue;
    }
    const fighter = { identityKey: member.key, identity: member.name, name: member.name, archetype: 'warrior', isGrounded: true };
    const native = measureClip(scene, prepared, mixer, nativeClip, 'native', fighter, state);
    const shared = measureClip(scene, prepared, mixer, calibrateSharedSourceClip(sharedClip), 'shared', fighter, state);
    const errors = [];
    if (!prepared.sameTopology) errors.push('topology');
    if (!native.running) errors.push('native mixer action did not run');
    if (!shared.running) errors.push('shared mixer action did not run');
    if (native.trackStats.unresolved.length) errors.push(`native unresolved tracks: ${native.trackStats.unresolved.slice(0, 3).join(', ')}`);
    if (shared.trackStats.unresolved.length) errors.push(`shared unresolved tracks: ${shared.trackStats.unresolved.slice(0, 3).join(', ')}`);
    if (!native.finite || !shared.finite) errors.push('non-finite vertex');
    if (native.posed < 0.001) errors.push('native clip does not deform the skinned mesh');
    if (shared.posed < 0.001) errors.push('shared clip does not deform the skinned mesh');
    if (native.edgeSamples && (native.edgeMin < 0.24 || native.edgeMax > 3.5)) errors.push(`native edge deformation ${native.edgeMin}..${native.edgeMax}`);
    if (shared.edgeSamples && (shared.edgeMin < 0.24 || shared.edgeMax > 3.5)) errors.push(`shared edge deformation ${shared.edgeMin}..${shared.edgeMax}`);
    // A body root is allowed to translate for a jump/flight/knockdown. The horizontal threshold
    // is deliberately broad; it catches a clip authored for a different origin, not normal aerial motion.
    if (native.rootDrift > 1.25) errors.push(`native Hips drift ${native.rootDrift} m`);
    if (shared.rootDrift > 1.25) errors.push(`shared Hips drift ${shared.rootDrift} m`);
    if (native.minY < -0.16) errors.push(`native floor penetration ${native.minY} m`);
    if (shared.minY < -0.16) errors.push(`shared floor penetration ${shared.minY} m`);
    const row = {
      fighter: member.name,
      key: member.key,
      url: member.url,
      clip: state,
      topology: prepared.rig.names.length,
      skinnedMeshes: prepared.skinned.length,
      native,
      shared,
      status: errors.length ? 'failed' : 'passed',
      errors
    };
    rows.push(row);
    if (errors.length) failures.push(`${member.name}/${state}: ${errors.join('; ')}`);
  }
  clippedBodies += 1;
  process.stdout.write(`\r${clippedBodies}/${SHARED_RIG_FAMILY.members.length} bodies verified`);
}
process.stdout.write('\n');

const combinations = rows.length;
const nativePassed = rows.filter(row => row.status === 'passed').length;
const summary = {
  family: SHARED_RIG_FAMILY.id,
  source: SHARED_RIG_FAMILY.source,
  members: SHARED_RIG_FAMILY.members.length,
  clipsPerFighter: SHARED_RIG_CLIPS.length,
  combinations,
  passed: nativePassed,
  failed: combinations - nativePassed,
  nativeActionPassed: rows.filter(row => !row.errors.some(error => /native mixer|native unresolved|native clip|native edge|native Hips|native floor/.test(error))).length,
  sharedSourcePassed: rows.filter(row => !row.errors.some(error => /shared mixer|shared unresolved|shared edge|shared Hips|shared floor|shared clip/.test(error))).length,
  topologyMatched: rows.filter(row => row.topology === 19).length,
  failures: failures.slice(0, 80),
  failureCount: failures.length
};

mkdirSync(resolve(root, 'artifacts/rig-batch'), { recursive: true });
writeFileSync(resolve(root, 'artifacts/rig-batch/verification.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  summary,
  rows
}, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (failures.length) {
  console.error(`\nRig-family batch FAILED: ${failures.length} finding(s). See artifacts/rig-batch/verification.json`);
  process.exit(1);
}
console.log(`\nRig-family batch passed: ${combinations}/${combinations} fighter/clip combinations (native + shared source).`);
