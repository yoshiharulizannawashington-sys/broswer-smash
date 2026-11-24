// Verify the five solo rig lanes against their real production bodies and clip-only files.
//
// This is deliberately separate from the 55-fighter 19-bone matrix. Each lane is loaded from its
// own body URL, its clips come from the declared files, and every clip is bound on that body's own
// mixer. Exact-name tracks stay untouched; a differently named but semantically equivalent source
// (Spider-Man's 19-bone supplemental clips on his 66-joint Mixamo body) is retargeted through the
// production solo adapter and reported as such.
//
//   npm run test:rig-solo
//
// A passing runtime row is not a visual or gameplay acceptance. Those statuses stay false in the
// artifact until rendered evidence is captured.
import './glb-node-compat.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applySoloRigGrounding, prepareSoloClip, SOLO_RIG_LANES, soloLaneKey, unresolvedClipNodes } from '../public/js/anim/solo_rig_lanes.js';
import { computePlacement } from '../public/js/fighter_model_placement.js';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/rig-solo');
mkdirSync(outDir, { recursive: true });
const audit = JSON.parse(readFileSync(resolve(root, 'artifacts/rig-audit.json'), 'utf8'));
const publicPath = url => resolve(root, 'public', String(url).replace(/^\//, ''));
const loader = new GLTFLoader();
const cache = new Map();

function load(url) {
  if (cache.has(url)) return cache.get(url);
  const promise = new Promise((ok, fail) => {
    const path = publicPath(url);
    if (!existsSync(path)) return fail(new Error(`missing ${url}`));
    const bytes = readFileSync(path);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    loader.parse(buffer, '', ok, error => fail(new Error(`${url}: ${error?.message || error}`)));
  });
  cache.set(url, promise);
  return promise;
}

const round = (value, digits = 3) => Number.isFinite(value) ? +value.toFixed(digits) : null;

/** Mirror the production mount: normalise height and put the lowest mesh point on y=0. */
function placeBody(scene) {
  const bounds = new THREE.Box3().setFromObject(scene);
  const placement = computePlacement(bounds, { targetHeight: 2.05 });
  scene.scale.multiplyScalar(placement.scale);
  scene.position.y += placement.groundOffset;
  scene.updateMatrixWorld(true);
  return placement;
}

function transformPoint(mesh, index, out = new THREE.Vector3()) {
  out.fromBufferAttribute(mesh.geometry.attributes.position, index);
  if (typeof mesh.applyBoneTransform === 'function') mesh.applyBoneTransform(index, out);
  else if (typeof mesh.boneTransform === 'function') mesh.boneTransform(index, out);
  out.applyMatrix4(mesh.matrixWorld);
  return out;
}

function boneSnapshot(scene) {
  scene.updateMatrixWorld(true);
  const snapshot = [];
  scene.traverse(node => {
    if (!node.isBone && !node.isObject3D) return;
    snapshot.push([node, node.position.clone(), node.quaternion.clone(), node.scale.clone()]);
  });
  return snapshot;
}

function restoreBones(snapshot) {
  for (const [node, position, quaternion, scale] of snapshot) {
    node.position.copy(position);
    node.quaternion.copy(quaternion);
    node.scale.copy(scale);
  }
}

function prepare(scene) {
  scene.updateMatrixWorld(true);
  const skinned = [];
  const samples = [];
  const triangles = [];
  scene.traverse(node => {
    if (!node.isSkinnedMesh) return;
    skinned.push(node);
    const positions = node.geometry?.attributes?.position;
    if (!positions) return;
    const step = Math.max(1, Math.ceil(positions.count / 220));
    const indices = [];
    for (let i = 0; i < positions.count; i += step) indices.push(i);
    samples.push({ mesh: node, indices });
    const index = node.geometry.index;
    if (!index) return;
    const triStep = Math.max(3, Math.floor(index.count / (3 * 24)) * 3);
    for (let i = 0; i + 2 < index.count; i += triStep) {
      triangles.push({ mesh: node, a: index.getX(i), b: index.getX(i + 1), c: index.getX(i + 2) });
    }
  });
  const bones = [];
  scene.traverse(node => { if (node.isBone) bones.push(node); });
  return { skinned, samples, triangles, bones, snapshot: boneSnapshot(scene) };
}

function samplePose(scene, prepared, bindPoints = null) {
  scene.updateMatrixWorld(true);
  let minY = Infinity, maxY = -Infinity;
  const points = [];
  for (const { mesh, indices } of prepared.samples) {
    try { mesh.skeleton?.update?.(); } catch {}
    for (const index of indices) {
      const point = transformPoint(mesh, index);
      points.push(point);
      if (Number.isFinite(point.y)) {
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
    }
  }
  let movement = 0;
  if (bindPoints && bindPoints.length === points.length) {
    for (let i = 0; i < points.length; i++) movement = Math.max(movement, points[i].distanceTo(bindPoints[i]));
  }
  return { points, minY, maxY, movement };
}

function measureBindEdges(prepared) {
  const reference = [];
  for (const { mesh, a, b, c } of prepared.triangles) {
    const pa = transformPoint(mesh, a);
    const pb = transformPoint(mesh, b);
    const pc = transformPoint(mesh, c);
    reference.push([pa.distanceTo(pb), pb.distanceTo(pc), pc.distanceTo(pa)]);
    // control points for an explanatory worst-edge row
    reference[reference.length - 1].points = [pa.clone(), pb.clone(), pc.clone()];
  }
  return reference;
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
  let min = Infinity, max = 0, measured = 0;
  let worst = null;
  for (let i = 0; i < prepared.triangles.length; i++) {
    const { mesh, a, b, c } = prepared.triangles[i];
    const lengths = reference[i];
    if (!lengths) continue;
    const pa = transformPoint(mesh, a);
    const pb = transformPoint(mesh, b);
    const pc = transformPoint(mesh, c);
    const after = [pa.distanceTo(pb), pb.distanceTo(pc), pc.distanceTo(pa)];
    const seam = seams[i];
    for (let k = 0; k < 3; k++) {
      const before = lengths[k];
      if (!Number.isFinite(before) || before < 0.002) continue;
      if (seam === 'bridge' || seam === 'mouth') continue;
      const ratio = after[k] / before;
      if (!Number.isFinite(ratio)) continue;
      if (seam === 'crease' && ratio < 1) continue;
      measured++;
      min = Math.min(min, ratio);
      if (ratio > max) {
        max = ratio;
        worst = {
          mesh: mesh.name || '(unnamed)', triangle: i, edge: k,
          rest: round(before, 5), posed: round(after[k], 5),
          vertices: [a, b, c], at: round(after[k], 5)
        };
      }
    }
  }
  return { min: Number.isFinite(min) ? min : null, max, measured, worst };
}

function trackStats(clip, scene) {
  const names = new Set();
  scene.traverse(node => { if (node.name) names.add(node.name); });
  const unresolved = [];
  const properties = { quaternion: 0, position: 0, scale: 0, other: 0 };
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    const node = dot < 0 ? track.name : track.name.slice(0, dot);
    const property = dot < 0 ? 'other' : track.name.slice(dot + 1);
    properties[property] = (properties[property] || 0) + 1;
    if (!names.has(node)) unresolved.push(track.name);
  }
  return { tracks: clip.tracks.length, unresolved, properties };
}

const noFloorCheck = /jump|fly|air|fall|launch|dive|takeoff|double|float|hover|flight/i;
const downState = /knockdown|get_up|knockup|down|die|defeat/i;

function evaluateClip(scene, prepared, mixer, clip, lane, laneKey, bindPoints) {
  mixer.stopAllAction();
  restoreBones(prepared.snapshot);
  scene.updateMatrixWorld(true);
  const reference = measureBindEdges(prepared);
  const seams = classifySeams(prepared, reference);
  const action = mixer.clipAction(clip);
  action.reset();
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.setEffectiveWeight(1);
  action.play();
  mixer.update(0.0001);
  const running = action.isRunning();
  const stats = trackStats(clip, scene);
  const hips = scene.getObjectByName('Hips') || scene.getObjectByName('pelvis') || scene.getObjectByName('Bip001_Pelvis') || null;
  const bindHips = hips ? hips.getWorldPosition(new THREE.Vector3()) : null;
  const times = [0, 0.22, 0.44, 0.66, 0.86, 0.98].map(r => r * Math.max(0.01, clip.duration));
  let first = null, posed = 0, motion = 0, rootDrift = 0;
  let minY = Infinity, maxY = -Infinity;
  let edgeMin = Infinity, edgeMax = 0, edgeSamples = 0;
  let edgeWorst = null;
  let finite = true;
  for (const time of times) {
    action.time = Math.min(time, clip.duration);
    mixer.update(0.0001);
    scene.updateMatrixWorld(true);
    applySoloRigGrounding(scene, { identityKey: laneKey, isGrounded: true }, String(clip.name || ''));
    const pose = samplePose(scene, prepared, bindPoints);
    if (!Number.isFinite(pose.minY)) finite = false;
    minY = Math.min(minY, pose.minY);
    maxY = Math.max(maxY, pose.maxY);
    motion = Math.max(motion, pose.movement);
    if (!first) first = pose.points;
    else {
      const limit = Math.min(first.length, pose.points.length);
      for (let i = 0; i < limit; i++) posed = Math.max(posed, first[i].distanceTo(pose.points[i]));
    }
    if (hips && bindHips) {
      const at = hips.getWorldPosition(new THREE.Vector3());
      rootDrift = Math.max(rootDrift, Math.hypot(at.x - bindHips.x, at.z - bindHips.z));
    }
    const edges = edgeStats(prepared, reference, seams);
    if (edges.min !== null) edgeMin = Math.min(edgeMin, edges.min);
    if (edges.worst && edges.max >= edgeMax) edgeWorst = edges.worst;
    edgeMax = Math.max(edgeMax, edges.max);
    edgeSamples += edges.measured;
  }
  action.stop();
  mixer.stopAllAction();
  restoreBones(prepared.snapshot);
  scene.updateMatrixWorld(true);

  const state = String(clip.name || '');
  const problems = [];
  if (!running) problems.push('action did not start');
  if (!clip.tracks.length) problems.push('clip has no tracks');
  if (stats.unresolved.length) problems.push(`${stats.unresolved.length} unresolved tracks`);
  if (!finite) problems.push('non-finite skinned position');
  if (motion < 0.012) problems.push(`pose barely moves (${round(motion, 4)} m)`);
  if (posed < 0.012) problems.push(`pose does not differ across samples (${round(posed, 4)} m)`);
  if (rootDrift > 1.25) problems.push(`root drift ${round(rootDrift, 3)} m`);
  if (edgeMax > 6) problems.push(`severe edge stretch ${round(edgeMax, 2)}x`);
  if (edgeMin !== null && edgeMin < 0.15) problems.push(`severe edge compression ${round(edgeMin, 2)}x`);
  if (!noFloorCheck.test(state) && minY < (downState.test(state) ? -0.12 : -0.04)) {
    problems.push(`floor penetration ${round(minY, 4)} m`);
  }
  return {
    clip: clip.name, duration: round(clip.duration),
    tracks: stats.tracks, properties: stats.properties,
    unresolved: stats.unresolved,
    running, finite,
    minY: round(minY, 4), maxY: round(maxY, 4),
    motion: round(motion, 4), posed: round(posed, 4), rootDrift: round(rootDrift, 4),
    edgeMin: round(edgeMin, 3), edgeMax: round(edgeMax, 3), edgeSamples,
    edgeWorst,
    passed: problems.length === 0, problems
  };
}

const rows = [];
const laneReports = {};

for (const [key, lane] of Object.entries(SOLO_RIG_LANES)) {
  const member = (audit.groups || []).flatMap(g => g.members || []).find(m => m.slug === key);
  const bodyPromise = load(lane.body);
  const gltf = await bodyPromise;
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const placement = placeBody(scene);
  const prepared = prepare(scene);
  const bindPoints = samplePose(scene, prepared).points;
  const mixer = new THREE.AnimationMixer(scene);
  const sourceClips = new Map();
  const sourceSeen = [];
  for (const url of lane.clips) {
    const source = await load(url);
    sourceSeen.push({ url, clips: (source.animations || []).length, bones: countBones(source.scene) });
    for (const clip of source.animations || []) {
      // Body + supplemental files can share a name only when the supplemental has the useful copy.
      sourceClips.set(clip.name, { clip, source, url });
    }
  }
  const expected = member?.clipNames || [];
  const missingClips = expected.filter(name => !sourceClips.has(name));
  const extraClips = [...sourceClips.keys()].filter(name => !expected.includes(name));
  const clips = [];
  for (const name of expected.length ? expected : [...sourceClips.keys()]) {
    const entry = sourceClips.get(name);
    if (!entry) continue;
    const preparedClip = prepareSoloClip(entry.clip, entry.source.scene, scene, { name });
    const cinematic = /(?:^|@)(?:collection|.*_cam)$/i.test(name);
    const zeroDuration = Number(entry.clip.duration) <= 1e-4;
    if (cinematic || zeroDuration) {
      const unresolved = unresolvedClipNodes(preparedClip.clip, scene);
      const reason = cinematic
        ? 'camera/cinematic clip; not body animation'
        : 'zero-duration static clip; no runtime playback';
      clips.push({
        clip: name, body: false, applicable: false, passed: null,
        source: entry.url, bindMode: preparedClip.mode, tracks: entry.clip.tracks.length,
        unresolved, problems: [reason], duration: round(entry.clip.duration),
        motion: null, posed: null, minY: null, rootDrift: null, edgeMin: null, edgeMax: null
      });
      continue;
    }
    const row = evaluateClip(scene, prepared, mixer, preparedClip.clip, lane, key, bindPoints);
    row.body = true;
    row.applicable = true;
    row.source = entry.url;
    row.bindMode = preparedClip.mode;
    row.mappedBones = preparedClip.mappedBones || 0;
    row.retargetError = preparedClip.error || null;
    row.sourceTracks = entry.clip.tracks.length;
    clips.push(row);
  }
  const boneNames = [];
  scene.traverse(node => { if (node.isBone) boneNames.push(node.name); });
  const weaponBone = boneNames.find(name => lane.weaponBone.test(name)) || null;
  const structural = {
    boneCount: boneNames.length, expectedBones: lane.joints, boneCountOk: boneNames.length === lane.joints,
    skinnedMeshes: prepared.skinned.length,
    bindMatricesFinite: prepared.skinned.every(mesh => (mesh.skeleton?.boneInverses || []).every(m => m.elements.every(Number.isFinite))),
    weaponBone, weaponDeclared: lane.weapon
  };
  const integrated = missingClips.length === 0 && clips.length === expected.length
    && clips.every(row => row.tracks > 0 && row.unresolved.length === 0);
  const bodyClips = clips.filter(row => row.applicable !== false);
  const runtime = bodyClips.length > 0 && bodyClips.every(row => row.passed);
  const row = {
    key, name: lane.name, family: lane.id,
    body: lane.body,
    placement,
    sources: sourceSeen,
    structural,
    integrated,
    runtime,
    visual: false,
    gameplay: false,
    expectedClips: expected.length,
    boundClips: clips.length,
    bodyClips: bodyClips.length,
    nonBodyClips: clips.length - bodyClips.length,
    missingClips,
    extraClips,
    clips,
    failures: bodyClips.filter(c => c.passed === false).map(c => `${c.clip}: ${c.problems.join('; ')}`)
  };
  rows.push(row);
  laneReports[key] = row;
  console.log(`${lane.name}: ${clips.length}/${expected.length} clips, ${clips.filter(c => c.passed).length}/${clips.length} runtime-pass, ${clips.filter(c => !c.passed).length} findings`);
}

function countBones(scene) {
  let count = 0;
  scene?.traverse?.(node => { if (node.isBone) count++; });
  return count;
}

const summary = {
  generatedAt: new Date().toISOString(),
  lanes: rows.length,
  structurallyCompatible: rows.filter(r => r.structural.boneCountOk && r.structural.bindMatricesFinite).length,
  animationsIntegrated: rows.filter(r => r.integrated).length,
  runtimeVerified: rows.filter(r => r.runtime).length,
  visuallyVerified: 0,
  gameplayAccepted: 0,
  totalClips: rows.reduce((sum, r) => sum + r.boundClips, 0),
  bodyClips: rows.reduce((sum, r) => sum + r.bodyClips, 0),
  nonBodyClips: rows.reduce((sum, r) => sum + r.nonBodyClips, 0),
  passedClips: rows.reduce((sum, r) => sum + r.clips.filter(c => c.passed === true).length, 0),
  failedClips: rows.reduce((sum, r) => sum + r.clips.filter(c => c.passed === false).length, 0)
};
const artifact = { summary, lanes: rows };
writeFileSync(resolve(outDir, 'verification.json'), JSON.stringify(artifact, null, 2));

const md = [
  '# Solo rig lane verification',
  '',
  `Generated ${summary.generatedAt}.`,
  '',
  '| Lane | Family | Bones | Clips | Structural | Integrated | Runtime | Visual | Gameplay |',
  '|---|---|---:|---:|---|---|---|---|---|',
  ...rows.map(r => `| ${r.name} | ${r.family} | ${r.structural.boneCount}/${r.structural.expectedBones} | ${r.boundClips}/${r.expectedClips} | ${r.structural.boneCountOk ? 'yes' : 'NO'} | ${r.integrated ? 'yes' : 'NO'} | ${r.runtime ? 'yes' : 'NO'} | not checked | not accepted |`),
  '',
  `Body clips passed: **${summary.passedClips}/${summary.bodyClips}**; non-body cinematic/static clips: **${summary.nonBodyClips}**.`,
  '',
  '## Findings',
  '',
  ...rows.flatMap(r => r.failures.length ? [`### ${r.name}`, '', ...r.failures.map(f => `- ${f}`), ''] : [`### ${r.name}`, '', '- none', '']),
  'Visual verification and gameplay acceptance remain separate, unfulfilled milestones.'
].join('\n');
writeFileSync(resolve(outDir, 'verification.md'), md);
console.log(JSON.stringify(summary, null, 2));
const failed = summary.failedClips > 0 ? 1 : 0;
console.log(failed ? 'Solo rig lanes FAILED.' : 'Solo rig lanes runtime-verified; visual/gameplay acceptance is still not claimed.');
process.exit(failed);
