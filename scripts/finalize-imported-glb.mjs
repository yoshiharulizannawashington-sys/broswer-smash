#!/usr/bin/env node
// Final export pass for imported character GLBs.
//
//   node scripts/finalize-imported-glb.mjs <input.glb> <output.glb> [height]
//
// Imported Sketchfab assets are not built by this repository's closed generated-body kernel:
// they can carry zero-area triangles and their root transform can be authored in a different
// unit scale. Removing the degenerate triangles in the index buffer leaves every skin weight,
// texture and animation untouched, and a single root scale/ground offset lands the rest body on
// the requested roster height without touching the baked clips.
import './glb-node-compat.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const [input, output, heightArg] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node scripts/finalize-imported-glb.mjs <input.glb> <output.glb> [height]');
  process.exit(1);
}
const targetHeight = heightArg ? Number(heightArg) : null;

function parseGlb(file) {
  const bytes = readFileSync(file);
  if (bytes.toString('ascii', 0, 4) !== 'glTF') throw new Error(`${file}: not a GLB`);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  const binHeader = 20 + jsonLength;
  const binLength = bytes.readUInt32LE(binHeader);
  const binStart = binHeader + 8;
  return { json, bin: Buffer.from(bytes.subarray(binStart, binStart + binLength)) };
}

function writeGlb(file, json, bin) {
  const jsonText = JSON.stringify(json);
  const jsonPad = (4 - (Buffer.byteLength(jsonText) % 4)) % 4;
  const jsonChunk = Buffer.from(jsonText + ' '.repeat(jsonPad));
  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad)]);
  json.buffers[0].byteLength = binChunk.length;
  const jsonText2 = JSON.stringify(json);
  const jsonPad2 = (4 - (Buffer.byteLength(jsonText2) % 4)) % 4;
  const jsonFinal = Buffer.from(jsonText2 + ' '.repeat(jsonPad2));
  const total = 12 + 8 + jsonFinal.length + 8 + binChunk.length;
  const out = Buffer.alloc(total);
  out.write('glTF', 0, 'ascii');
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonFinal.length, 12);
  out.write('JSON', 16, 'ascii');
  jsonFinal.copy(out, 20);
  out.writeUInt32LE(binChunk.length, 20 + jsonFinal.length);
  out.write('BIN\0', 24 + jsonFinal.length, 'binary');
  binChunk.copy(out, 28 + jsonFinal.length);
  writeFileSync(file, out);
}

const COMPONENTS = {
  5120: { size: 1, get: 'getInt8', set: 'setInt8' },
  5121: { size: 1, get: 'getUint8', set: 'setUint8' },
  5122: { size: 2, get: 'getInt16', set: 'setInt16' },
  5123: { size: 2, get: 'getUint16', set: 'setUint16' },
  5125: { size: 4, get: 'getUint32', set: 'setUint32' },
  5126: { size: 4, get: 'getFloat32', set: 'setFloat32' }
};
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function accessor(json, bin, index) {
  const a = json.accessors?.[index];
  if (!a || a.bufferView == null) return null;
  const bv = json.bufferViews?.[a.bufferView];
  if (!bv) return null;
  const type = COMPONENTS[a.componentType];
  if (!type) return null;
  const comps = TYPE_COMPONENTS[a.type] || 1;
  const view = new DataView(bin.buffer, bin.byteOffset, bin.length);
  return {
    a, bv, view, comps, type,
    base: (bv.byteOffset || 0) + (a.byteOffset || 0),
    stride: bv.byteStride || type.size * comps
  };
}

function vectorAt(acc, i, out = new THREE.Vector3()) {
  const offset = acc.base + i * acc.stride;
  return out.set(
    acc.view.getFloat32(offset, true),
    acc.view.getFloat32(offset + 4, true),
    acc.view.getFloat32(offset + 8, true)
  );
}

function readIndex(acc, i) {
  return acc.view[acc.type.get](acc.base + i * acc.stride, true);
}

function writeIndex(acc, i, value) {
  acc.view[acc.type.set](acc.base + i * acc.stride, value, true);
}

const first = parseGlb(input);
let removed = 0;
const seenAccessors = new Set();
for (const mesh of first.json.meshes || []) {
  for (const primitive of mesh.primitives || []) {
    if (primitive.mode !== undefined && primitive.mode !== 4) continue;
    if (primitive.indices == null || primitive.attributes?.POSITION == null) continue;
    if (seenAccessors.has(primitive.indices)) continue;
    const positions = accessor(first.json, first.bin, primitive.attributes.POSITION);
    const indices = accessor(first.json, first.bin, primitive.indices);
    if (!positions || !indices || positions.a.componentType !== 5126 || indices.a.type !== 'SCALAR') continue;
    if (indices.a.count % 3) continue;
    const kept = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3();
    for (let i = 0; i + 2 < indices.a.count; i += 3) {
      const ia = readIndex(indices, i), ib = readIndex(indices, i + 1), ic = readIndex(indices, i + 2);
      vectorAt(positions, ia, a); vectorAt(positions, ib, b); vectorAt(positions, ic, c);
      ab.subVectors(b, a); ac.subVectors(c, a);
      const area = ab.cross(ac).length() * 0.5;
      if (area < 1e-9) { removed++; continue; }
      kept.push(ia, ib, ic);
    }
    if (kept.length === indices.a.count) continue;
    for (let i = 0; i < kept.length; i++) writeIndex(indices, i, kept[i]);
    indices.a.count = kept.length;
    seenAccessors.add(primitive.indices);
  }
}

const temporary = output + '.tmp';
writeGlb(temporary, first.json, first.bin);
const { json: cleanedJson, bin: cleanedBin } = parseGlb(temporary);
const loader = new GLTFLoader();
const loaded = await new Promise((ok, bad) => {
  const bytes = readFileSync(temporary);
  loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', ok, bad);
});
const scene = loaded.scene;
scene.updateMatrixWorld(true);
let box = new THREE.Box3().setFromObject(scene);
let size = box.getSize(new THREE.Vector3());
let normalized = null;

if (targetHeight && Number.isFinite(targetHeight) && size.y > 1e-6) {
  const factor = targetHeight / size.y;
  const roots = cleanedJson.scenes?.[cleanedJson.scene ?? 0]?.nodes || [];
  if (roots.length !== 1) throw new Error(`expected one scene root, found ${roots.length}`);
  const root = cleanedJson.nodes[roots[0]];
  // Sketchfab wrappers carry the whole scene orientation as a matrix (`Sketchfab_model` is a
  // -90 degree X rotation on these models). Decompose it into TRS so the uniform roster scale and
  // the ground offset can be written without discarding the authored orientation.
  if (root.matrix) {
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scaling = new THREE.Vector3();
    new THREE.Matrix4().fromArray(root.matrix).decompose(position, quaternion, scaling);
    root.translation = position.toArray();
    root.rotation = quaternion.toArray();
    root.scale = scaling.toArray();
    delete root.matrix;
  }
  const scale = root.scale || [1, 1, 1];
  const translation = root.translation || [0, 0, 0];
  // The root has no rotation in these exports, so the vertical component of the rest bounds is
  // linear in the root scale. This preserves the skinned bind pose and all baked clips.
  const newMin = translation[1] + factor * (box.min.y - translation[1]);
  root.scale = scale.map(value => value * factor);
  root.translation = [translation[0], translation[1] - newMin, translation[2]];
  normalized = { factor, oldHeight: size.y, oldFeet: box.min.y };
  writeGlb(temporary, cleanedJson, cleanedBin);
  const check = await new Promise((ok, bad) => {
    const bytes = readFileSync(temporary);
    loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', ok, bad);
  });
  check.scene.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(check.scene);
  size = box.getSize(new THREE.Vector3());
}

writeFileSync(output, readFileSync(temporary));
await import('node:fs/promises').then(({ unlink }) => unlink(temporary));
console.log(JSON.stringify({
  input, output, degenerateRemoved: removed, targetHeight,
  height: +size.y.toFixed(4), feetY: +box.min.y.toFixed(4),
  normalized, animations: loaded.animations.length,
  bytes: readFileSync(output).length
}, null, 1));
