#!/usr/bin/env node
// Put the roster's clips on an imported body WITHOUT re-exporting its geometry.
//
// Imported Sketchfab bodies bind in their own rest pose; Blender re-exports that bind as a
// T-pose, which is why the earlier baked files render with both arms straight out. This script
// never touches vertices, skin weights, inverse bind matrices, materials or textures: it solves
// the roster clips onto the mounted skeleton with the project's own bind-pose retargeter and
// appends them to the GLB's animation list as new accessors.
//
//   node scripts/rig-clips-to-body.mjs retarget <donor.glb> <target.glb> <out.glb> [--calibrate-arms]
//   node scripts/rig-clips-to-body.mjs ground <in.glb> <out.glb>
//
// `--calibrate-arms` is for a target bound in a strict T-pose: it lowers the upper arms before the
// donor delta is applied, so a donor idle that only lowers its arms 25 degrees does not leave the
// target standing in a T-pose. It is animation-side only; the bind pose and skin weights are untouched.
//
// `retarget` copies every donor clip onto the target skeleton. `ground` keeps the target's own
// clips and lifts/lowers each grounded clip by one constant so its lowest skinned point sits on
// y=0 (imported auto-rigs sink a few centimetres in idle).
import './glb-node-compat.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildBoneMap, retargetClipBindPose } from '../public/js/anim/bind_pose_retargeter.js';

const [mode, a, b, c] = process.argv.slice(2);
const calibrateArms = process.argv.includes('--calibrate-arms');
const appendAnimations = process.argv.includes('--append');
// A prefix keeps a supplemental set from overwriting the target's own clips when the donor
// happens to use generic names such as idle/walk/run. It is part of the clip's runtime name.
const clipPrefix = process.argv.find(arg => arg.startsWith('--prefix='))?.slice('--prefix='.length) || '';
if (!mode || !a || !b) {
  console.error('usage: rig-clips-to-body.mjs retarget <donor> <target> <out> | ground <in> <out>');
  process.exit(2);
}
const AIRBORNE = /^(jump|fly|hover|air_attack)$/i;
const HIPS_NAME = /hips|pelvis/i;

// ---------------------------------------------------------------- GLB container
function parseGlb(file) {
  const bytes = readFileSync(file);
  if (bytes.toString('ascii', 0, 4) !== 'glTF') throw new Error(`${file}: not a GLB`);
  let offset = 12, json = null;
  const bins = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) bins.push(Buffer.from(chunk));
    offset += 8 + length;
  }
  return { json, bin: Buffer.concat(bins) };
}

function writeGlb(file, json, bin) {
  json.buffers = json.buffers || [{}];
  json.buffers[0] = { ...json.buffers[0], byteLength: bin.length };
  const pad = n => (4 - (n % 4)) % 4;
  const text = JSON.stringify(json);
  const jsonChunk = Buffer.from(text + ' '.repeat(pad(Buffer.byteLength(text))));
  const binChunk = Buffer.concat([bin, Buffer.alloc(pad(bin.length))]);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const out = Buffer.alloc(total);
  out.write('glTF', 0, 'ascii');
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonChunk.length, 12);
  out.write('JSON', 16, 'ascii');
  jsonChunk.copy(out, 20);
  out.writeUInt32LE(binChunk.length, 20 + jsonChunk.length);
  out.write('BIN\0', 24 + jsonChunk.length, 'binary');
  binChunk.copy(out, 28 + jsonChunk.length);
  writeFileSync(file, out);
}

function bufferState(bin) {
  return { bin, chunks: [bin], length: bin.length };
}
function appendFloats(json, state, data, type) {
  const comps = type === 'SCALAR' ? 1 : type === 'VEC3' ? 3 : type === 'VEC4' ? 4 : 0;
  if (!comps) throw new Error(`unsupported accessor type ${type}`);
  const bytes = Buffer.alloc(data.length * 4);
  for (let i = 0; i < data.length; i += 1) bytes.writeFloatLE(data[i], i * 4);
  const pad = (4 - (state.length % 4)) % 4;
  if (pad) { state.chunks.push(Buffer.alloc(pad)); state.length += pad; }
  json.bufferViews = json.bufferViews || [];
  json.bufferViews.push({ buffer: 0, byteOffset: state.length, byteLength: bytes.length });
  json.accessors = json.accessors || [];
  const accessor = {
    bufferView: json.bufferViews.length - 1, componentType: 5126,
    count: data.length / comps, type
  };
  if (type === 'SCALAR') {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < data.length; i += 1) { if (data[i] < min) min = data[i]; if (data[i] > max) max = data[i]; }
    accessor.min = [min]; accessor.max = [max];
  }
  json.accessors.push(accessor);
  state.chunks.push(bytes);
  state.length += bytes.length;
  return json.accessors.length - 1;
}

// ---------------------------------------------------------------- model helpers
async function loadGlb(file) {
  const buf = readFileSync(file);
  const gltf = await new Promise((ok, bad) => new GLTFLoader().parse(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', ok, bad));
  gltf.scene.updateMatrixWorld(true);
  return gltf;
}

function snapshotPose(root) {
  const out = [];
  root.traverse(node => {
    if (node.isBone || node.isObject3D) out.push([node, node.position.clone(), node.quaternion.clone(), node.scale.clone()]);
  });
  return out;
}
function restorePose(snapshot) {
  for (const [node, p, q, s] of snapshot) { node.position.copy(p); node.quaternion.copy(q); node.scale.copy(s); }
}

function skinnedMeshes(root) {
  const out = [];
  root.traverse(n => { if (n.isSkinnedMesh) out.push(n); });
  return out;
}

function measureMinY(root, meshes, stride) {
  root.updateMatrixWorld(true);
  const point = new THREE.Vector3();
  let min = Infinity;
  for (const mesh of meshes) {
    const positions = mesh.geometry?.attributes?.position;
    if (!positions) continue;
    mesh.skeleton.update();
    for (let i = 0; i < positions.count; i += stride) {
      point.fromBufferAttribute(positions, i);
      mesh.applyBoneTransform(i, point);
      point.applyMatrix4(mesh.matrixWorld);
      if (Number.isFinite(point.y) && point.y < min) min = point.y;
    }
  }
  return min;
}

/** The same whole-body joint the retargeter maps to `pelvis`; the lift is applied there. */
function hipsBone(root) {
  const mapped = buildBoneMap(root, root).targetByKey.get('pelvis');
  if (mapped) return mapped;
  let found = null;
  root.traverse(node => {
    if (found || !(node.isBone || node.isObject3D)) return;
    if (HIPS_NAME.test(node.name)) found = node;
  });
  return found;
}

function sampleTimes(clip, fps = 30) {
  const steps = Math.max(1, Math.round(clip.duration * fps));
  const times = [];
  for (let i = 0; i <= steps; i += 1) times.push(Math.min(clip.duration * i / steps, clip.duration - 1e-4));
  return times;
}

/** World +Y lift -> the Hips bone's local translation space. */
function localLift(hips, dy) {
  const linear = new THREE.Matrix3().setFromMatrix4(hips.parent.matrixWorld);
  return new THREE.Vector3(0, dy, 0).applyMatrix3(linear.clone().invert());
}

function buildNameIndex(json, scene) {
  const index = new Map();
  const dup = new Set();
  const nodes = json.nodes || [];
  const bySerialized = new Map();
  nodes.forEach((node, i) => {
    const name = THREE.PropertyBinding.sanitizeNodeName(node.name || '');
    if (!name) return;
    if (index.has(name)) dup.add(name);
    else index.set(name, i);
    bySerialized.set(i, name);
  });
  if (dup.size) throw new Error(`duplicate node names cannot be addressed by track: ${[...dup].slice(0, 6).join(', ')}`);
  return index;
}

const strideFor = count => Math.max(1, Math.floor(count / 20000));

// ---------------------------------------------------------------- main
const t0 = Date.now();
if (mode === 'retarget') {
  const donor = await loadGlb(a);
  const target = await loadGlb(b);
  const targetJson = parseGlb(b).json;
  const targetBin = parseGlb(b).bin;
  const nameIndex = buildNameIndex(targetJson, target.scene);
  const meshes = skinnedMeshes(target.scene);
  let vertexTotal = 0;
  for (const mesh of meshes) vertexTotal += mesh.geometry?.attributes?.position?.count || 0;
  const stride = strideFor(vertexTotal);
  const rest = snapshotPose(target.scene);
  const hips = hipsBone(target.scene);
  if (!hips || !hips.isBone) throw new Error('target has no bone-mapped pelvis');
  const hipsRest = hips.position.clone();
  const clips = [];
  const perClip = [];

  for (const source of donor.animations) {
    restorePose(rest);
    target.scene.updateMatrixWorld(true);
    const clipName = clipPrefix ? `${clipPrefix}${source.name}` : source.name;
    const { clip, report } = retargetClipBindPose(source, donor.scene, target.scene, { fps: 30, name: clipName, calibrateArms });
    restorePose(rest);
    target.scene.updateMatrixWorld(true);
    const times = sampleTimes(clip);
    const mixer = new THREE.AnimationMixer(target.scene);
    mixer.clipAction(clip).play();
    let minY = Infinity;
    for (const t of times) { mixer.setTime(t); minY = Math.min(minY, measureMinY(target.scene, meshes, stride)); }
    mixer.stopAllAction();
    mixer.uncacheRoot(target.scene);
    restorePose(rest);
    target.scene.updateMatrixWorld(true);
    const grounded = !AIRBORNE.test(clip.name);
    const lift = grounded && Number.isFinite(minY)? -minY : 0;
    const local = localLift(hips, lift);
    const values = new Float32Array(times.length * 3);
    for (let i = 0; i < times.length; i += 1) {
      values[i * 3] = hipsRest.x + local.x;
      values[i * 3 + 1] = hipsRest.y + local.y;
      values[i * 3 + 2] = hipsRest.z + local.z;
    }
    clip.tracks.push(new THREE.VectorKeyframeTrack(`${hips.name}.position`, new Float32Array(times), values));
    clips.push(clip);
    perClip.push({
      clip: clip.name, duration: +clip.duration.toFixed(3), tracks: clip.tracks.length,
      mapped: report.mappedBones, missing: report.missingTargets, maxStepDeg: +(report.maxStepRadians * 180 / Math.PI).toFixed(1),
      minBefore: +minY.toFixed(4), lift: +lift.toFixed(4), grounded
    });
  }

  // Append clips as glTF animations: one shared time accessor per clip, one output per channel.
  // Preserve the target's shipped clips when adding a supplemental set. Without --append the
  // established behaviour is a full retarget/replacement.
  targetJson.animations = appendAnimations ? (targetJson.animations || []) : [];
  const state = bufferState(targetBin);
  const unresolved = new Set();
  for (const clip of clips) {
    const times = clip.tracks[0].times;
    const input = appendFloats(targetJson, state, times, 'SCALAR');
    const samplers = [], channels = [];
    for (const track of clip.tracks) {
      const dot = track.name.lastIndexOf('.');
      const nodeName = track.name.slice(0, dot);
      const path = track.name.slice(dot + 1);
      const node = nameIndex.get(nodeName);
      if (node === undefined) { unresolved.add(nodeName); continue; }
      const type = track.getValueSize() === 4 ? 'VEC4' : track.getValueSize() === 3 ? 'VEC3' : null;
      if (!type) { unresolved.add(track.name); continue; }
      const output = appendFloats(targetJson, state, track.values, type);
      samplers.push({ input, output, interpolation: 'LINEAR' });
      const gltfPath = path === 'quaternion' ? 'rotation' : path === 'position' ? 'translation' : path === 'scale' ? 'scale' : null;
      if (!gltfPath) { unresolved.add(track.name); continue; }
      channels.push({ sampler: samplers.length - 1, target: { node, path: gltfPath } });
    }
    targetJson.animations.push({ name: clip.name, samplers, channels });
  }
  writeGlb(c, targetJson, Buffer.concat(state.chunks));
  console.log(JSON.stringify({
    mode, donor: a, target: b, out: c, clips: clips.length, vertexTotal, stride,
    unresolvedNodes: [...unresolved].slice(0, 12), unresolvedCount: unresolved.size,
    perClip, ms: Date.now() - t0
  }, null, 1));
} else if (mode === 'ground') {
  const gltf = await loadGlb(a);
  const parsed = parseGlb(a);
  const json = parsed.json;
  let bin = parsed.bin;
  const nameIndex = buildNameIndex(json, gltf.scene);
  const meshes = skinnedMeshes(gltf.scene);
  let vertexTotal = 0;
  for (const mesh of meshes) vertexTotal += mesh.geometry?.attributes?.position?.count || 0;
  const stride = strideFor(vertexTotal);
  const rest = snapshotPose(gltf.scene);
  const hips = hipsBone(gltf.scene);
  if (!hips || !hips.isBone) throw new Error('model has no bone-mapped pelvis');
  const hipsNode = nameIndex.get(hips.name);
  const clips = new Map(gltf.animations.map(clip => [clip.name, clip]));
  const report = [];

  for (const [name, clip] of clips) {
    restorePose(rest);
    gltf.scene.updateMatrixWorld(true);
    const times = sampleTimes(clip);
    const mixer = new THREE.AnimationMixer(gltf.scene);
    mixer.clipAction(clip).play();
    let minY = Infinity;
    for (const t of times) { mixer.setTime(t); minY = Math.min(minY, measureMinY(gltf.scene, meshes, stride)); }
    mixer.stopAllAction();
    mixer.uncacheRoot(gltf.scene);
    restorePose(rest);
    gltf.scene.updateMatrixWorld(true);
    const grounded = !AIRBORNE.test(name);
    const lift = grounded && Number.isFinite(minY)? -minY : 0;
    const local = localLift(hips, lift);
    const animation = (json.animations || []).find(anim => anim.name === name);
    const channel = animation?.channels?.find(ch => ch.target?.node === hipsNode && ch.target?.path === 'translation');
    if (channel) {
      const sampler = animation.samplers[channel.sampler];
      const accessor = json.accessors[sampler.output];
      if (accessor?.componentType !== 5126 || accessor.type !== 'VEC3') throw new Error(`${name}: hips translation is not float VEC3`);
      const view = json.bufferViews[accessor.bufferView];
      const base = (view.byteOffset || 0) + (accessor.byteOffset || 0);
      const step = view.byteStride ? view.byteStride / 4 : 3;
      for (let i = 0; i < accessor.count; i += 1) {
        const at = base + i * step * 4;
        bin.writeFloatLE(bin.readFloatLE(at) + local.x, at);
        bin.writeFloatLE(bin.readFloatLE(at + 4) + local.y, at + 4);
        bin.writeFloatLE(bin.readFloatLE(at + 8) + local.z, at + 8);
      }
    } else if (!animation) {
      throw new Error(`${name}: animation not found in JSON`);
    } else {
      // No hips translation channel: append a constant one carrying the lift.
      animation.samplers = animation.samplers || [];
      animation.channels = animation.channels || [];
      const state = bufferState(bin);
      const timesArray = new Float32Array([0, clip.duration]);
      const inputAcc = appendFloats(json, state, timesArray, 'SCALAR');
      const restPos = hips.position;
      const output = new Float32Array(6);
      for (let i = 0; i < 2; i += 1) {
        output[i * 3] = restPos.x + local.x;
        output[i * 3 + 1] = restPos.y + local.y;
        output[i * 3 + 2] = restPos.z + local.z;
      }
      const outputAcc = appendFloats(json, state, output, 'VEC3');
      animation.samplers.push({ input: inputAcc, output: outputAcc, interpolation: 'LINEAR' });
      animation.channels.push({ sampler: animation.samplers.length - 1, target: { node: hipsNode, path: 'translation' } });
      // appendFloats keeps its own chunk list; fold it back into the shared buffer.
      const added = Buffer.concat(state.chunks);
      bin = Buffer.concat([bin, added.subarray(bin.length)]);
    }
    report.push({ clip: name, minBefore: +minY.toFixed(4), lift: +lift.toFixed(4), grounded });
  }
  restorePose(rest);
  writeGlb(b, json, bin);
  console.log(JSON.stringify({ mode, input: a, out: b, hips: hips.name, stride, report, ms: Date.now() - t0 }, null, 1));
} else {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}
