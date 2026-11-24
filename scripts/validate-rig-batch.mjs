#!/usr/bin/env node
// Acceptance gate for the eight auto-rigged supplied bodies.
//
//   node scripts/validate-rig-batch.mjs
//
// It loads the shipped GLBs with the same three.js loader the game uses and checks what a playable
// Browser Bros body needs: a resolved 19-slot canonical rig, fully weighted vertices, every deform
// bone carrying geometry, joints inside the body, left/right symmetry, fighter-scale bounds, feet on
// the floor, and real deformation from the Blender pose test. It deliberately does not require
// source animation clips or watertight third-party topology.
import './glb-node-compat.mjs';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { resolveRig, CANONICAL_BONES } from '../public/js/anim/rig_map.js';

const ROOT = resolve(import.meta.dirname, '..');
const KEYS = ['wonder_woman', 'spider_man', 'light_yagami', 'madara', 'madara_alt', 'sasuke', 'thor', 'aang'];
const EXPECTED_BONES = 19;
const results = [];
const failures = [];

const load = async file => {
  const bytes = readFileSync(file);
  const gltf = await new Promise((ok, bad) => new GLTFLoader().parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', ok, bad));
  gltf.scene.updateMatrixWorld(true);
  return gltf;
};

for (const key of KEYS) {
  const dir = resolve(ROOT, 'artifacts/rig-batch/rigged', key);
  const file = resolve(dir, key + '.glb');
  const reportFile = resolve(dir, 'rig-report.json');
  const problems = [];
  if (!existsSync(file)) {
    failures.push(`${key}: missing ${file}`);
    continue;
  }
  if (!existsSync(reportFile)) problems.push('missing rig-report.json');
  const gltf = await load(file);
  const scene = gltf.scene;
  const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : null;

  const meshes = [];
  scene.traverse(node => { if (node.isMesh) meshes.push(node); });
  const skinned = meshes.filter(node => node.isSkinnedMesh);
  if (!meshes.length) problems.push('no meshes');
  if (skinned.length !== meshes.length) problems.push(`${meshes.length - skinned.length} static mesh(es) would not animate`);

  const bones = new Map();
  scene.traverse(node => { if (node.isBone) bones.set(node.name, node); });
  const rig = resolveRig(scene);
  if (!rig || rig.kind !== 'bone') problems.push('rig did not resolve to bones');
  if (!rig || rig.boundCount !== EXPECTED_BONES) problems.push(`rig has ${rig?.boundCount ?? 0}/${EXPECTED_BONES} canonical slots`);
  if (rig?.missingCore?.length) problems.push(`missing core joints: ${rig.missingCore.join(',')}`);

  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  if (size.y < 1.2 || size.y > 2.4) problems.push(`height ${size.y.toFixed(2)} m outside fighter range`);
  if (Math.abs(box.min.y) > 0.02) problems.push(`feet sit ${box.min.y.toFixed(3)} m off the floor`);

  // Skin weights: every vertex covered, sums normalised, at most four influences, every bone used.
  const coverage = new Map();
  let vertices = 0, unweighted = 0, badSum = 0, maxInfluences = 0;
  for (const mesh of skinned) {
    const skinIndex = mesh.geometry?.attributes?.skinIndex;
    const skinWeight = mesh.geometry?.attributes?.skinWeight;
    if (!skinIndex || !skinWeight) { problems.push(`${mesh.name}: no skin attributes`); continue; }
    const list = mesh.skeleton?.bones || [];
    for (let i = 0; i < skinIndex.count; i++) {
      let sum = 0, influences = 0;
      for (let c = 0; c < 4; c++) {
        const w = skinWeight.array[i * 4 + c];
        if (!(w > 0.0005)) continue;
        sum += w;
        influences++;
        const bone = list[skinIndex.array[i * 4 + c]];
        if (bone) coverage.set(bone.name, (coverage.get(bone.name) || 0) + 1);
      }
      vertices++;
      if (influences === 0) unweighted++;
      if (Math.abs(sum - 1) > 0.02) badSum++;
      maxInfluences = Math.max(maxInfluences, influences);
    }
  }
  // The glTF exporter splits vertices at UV/material seams, so the shipped count is a little
  // higher than Blender's. Only a large divergence means geometry was lost.
  const reportedVertices = report?.weights?.vertices;
  if (reportedVertices && Math.abs(vertices - reportedVertices) > Math.max(64, reportedVertices * 0.03)) {
    problems.push(`vertex count ${vertices} differs from Blender report ${reportedVertices}`);
  }
  if (unweighted) problems.push(`${unweighted} unweighted vertex(es)`);
  if (badSum) problems.push(`${badSum} vertex weight sum(s) outside 1±0.02`);
  if (maxInfluences > 4) problems.push(`${maxInfluences} influences on a vertex (max 4)`);
  // coverage is keyed by the actual bone names (Hips/LeftArm/...), while CANONICAL_BONES uses the
  // game's slot ids (pelvis/leftArm/...). Resolve each slot through the rig before measuring.
  const weightless = CANONICAL_BONES.filter(name => {
    const boneName = rig?.joints?.[name]?.name;
    return !boneName || (coverage.get(boneName) || 0) < 20;
  });
  if (weightless.length) problems.push(`bones driving <20 vertices: ${weightless.join(',')}`);

  // Joints: actual world bone heads must sit on the body and mirror across X.
  const positions = new Map();
  for (const name of CANONICAL_BONES) {
    const bone = bones.get({
      pelvis: 'Hips', spine: 'Spine', torso: 'Chest', neck: 'Neck', head: 'Head',
      leftClavicle: 'LeftShoulder', rightClavicle: 'RightShoulder',
      leftArm: 'LeftArm', leftFore: 'LeftForeArm', leftHand: 'LeftHand',
      rightArm: 'RightArm', rightFore: 'RightForeArm', rightHand: 'RightHand',
      leftLeg: 'LeftUpLeg', leftShin: 'LeftLeg', leftFoot: 'LeftFoot',
      rightLeg: 'RightUpLeg', rightShin: 'RightLeg', rightFoot: 'RightFoot'
    }[name]);
    if (!bone) continue;
    positions.set(name, new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld));
  }

  const points = [];
  const vertex = new THREE.Vector3();
  for (const mesh of meshes) {
    const position = mesh.geometry?.attributes?.position;
    if (!position) continue;
    const stride = Math.max(1, Math.floor(position.count / 12000));
    for (let i = 0; i < position.count; i += stride) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      points.push(vertex.clone());
    }
  }
  const surface = {};
  for (const [name, point] of positions) {
    let nearest = Infinity;
    for (const p of points) nearest = Math.min(nearest, p.distanceTo(point));
    surface[name] = +nearest.toFixed(4);
    if (nearest > 0.20) problems.push(`${name} joint is ${nearest.toFixed(3)} m from the nearest surface vertex`);
    if (point.x < box.min.x - 0.03 || point.x > box.max.x + 0.03
      || point.z < box.min.z - 0.03 || point.z > box.max.z + 0.03
      || point.y < box.min.y - 0.03 || point.y > box.max.y + 0.03) {
      problems.push(`${name} joint sits outside the mesh bounds`);
    }
  }

  const symmetry = {};
  for (const [a, b] of [['leftArm', 'rightArm'], ['leftFore', 'rightFore'], ['leftHand', 'rightHand'],
    ['leftLeg', 'rightLeg'], ['leftShin', 'rightShin'], ['leftFoot', 'rightFoot']]) {
    if (!positions.has(a) || !positions.has(b)) continue;
    const pa = positions.get(a), pb = positions.get(b);
    const mirrored = new THREE.Vector3(-pb.x, pb.y, pb.z);
    symmetry[a] = +pa.distanceTo(mirrored).toFixed(4);
    if (symmetry[a] > 0.015) problems.push(`${a}/${b} are ${symmetry[a]} m from mirrored`);
  }

  const armLength = positions.has('leftHand') ? positions.get('leftHand').distanceTo(positions.get('leftClavicle')) / size.y : 0;
  const legLength = positions.has('leftFoot') ? positions.get('leftFoot').distanceTo(positions.get('leftLeg')) / size.y : 0;
  if (armLength < 0.24 || armLength > 0.46) problems.push(`arm length ${armLength.toFixed(3)} H outside 0.24-0.46`);
  if (legLength < 0.30 || legLength > 0.62) problems.push(`leg length ${legLength.toFixed(3)} H outside 0.30-0.62`);

  // The Blender pose test is the deformation proof; without it, weights are only a data claim.
  if (report?.deformation) {
    for (const [bone, moved] of Object.entries(report.deformation)) {
      if (!(moved.moved > 0)) problems.push(`pose test ${bone} moved no sampled vertices`);
      if (!(moved.max > 0.02 && moved.max < 1.5)) problems.push(`pose test ${bone} max ${moved.max} m is implausible`);
    }
  } else {
    problems.push('no Blender deformation report');
  }

  results.push({
    key, file: file.replace(ROOT + '/', ''), bytes: readFileSync(file).length,
    height: +size.y.toFixed(3), feetY: +box.min.y.toFixed(3),
    width: +size.x.toFixed(3), depth: +size.z.toFixed(3),
    meshes: meshes.length, skinnedMeshes: skinned.length,
    bones: bones.size, rigSlots: rig?.boundCount ?? 0,
    weights: { vertices, unweighted, badSum, maxInfluences, minCoverage: Math.min(...coverage.values()) },
    joints: surface, symmetry, armLength: +armLength.toFixed(4), legLength: +legLength.toFixed(4),
    problems
  });
  failures.push(...problems.map(p => `${key}: ${p}`));
}

const outDir = resolve(ROOT, 'artifacts/rig-batch');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'validation.json'), JSON.stringify({ checked: results.length, failures, results }, null, 1) + '\n');
const lines = [
  '| body | height | feet | skinned | bones | verts | unweighted | bad sums | max inf | min bone | arm/H | leg/H |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
];
for (const r of results) {
  lines.push(`| ${r.key} | ${r.height} m | ${r.feetY} | ${r.skinnedMeshes}/${r.meshes} | ${r.rigSlots} | ${r.weights.vertices} | ${r.weights.unweighted} | ${r.weights.badSum} | ${r.weights.maxInfluences} | ${r.weights.minCoverage} | ${r.armLength} | ${r.legLength} |`);
}
writeFileSync(resolve(outDir, 'validation.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
if (failures.length) {
  console.error(`\nRIG BATCH FAILED (${failures.length}):`);
  for (const failure of failures) console.error('  - ' + failure);
  process.exit(1);
}
console.log(`\nRIG BATCH PASSED: ${results.length}/8 bodies, 19/19 slots, every vertex weighted, joints on-body and symmetric.`);
