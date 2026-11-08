#!/usr/bin/env node
/**
 * Report bind-pose integrity for a glTF/GLB character.
 *
 * A glTF skin is only valid when every joint's bind-time global transform equals the inverse of
 * its inverse bind matrix (IBM). When they disagree the file still renders correctly at rest,
 * because the renderer applies jointGlobal * IBM and the two errors cancel -- but every posed
 * joint then pivots around a point that is not inside the mesh, so rotations fling geometry by
 * metres. Blender's importer rebuilds the rest skeleton from the node transforms and drops the
 * IBMs, so a file like this shows a rig parked tens of metres from the body.
 *
 * This prints the single rigid correction that makes the rest skeleton match the skin, which is
 * what a repair has to apply. Read-only.
 *
 *   node scripts/analyze-bind-pose.mjs <model.gltf|model.glb> [--json out.json]
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const source = args.find((a) => !a.startsWith("--"));
const jsonIndex = args.indexOf("--json");
const jsonOut = jsonIndex >= 0 ? args[jsonIndex + 1] : null;

if (!source) {
  console.error("usage: node scripts/analyze-bind-pose.mjs <model.gltf|model.glb> [--json out.json]");
  process.exit(2);
}

// ---------------------------------------------------------------- glTF container

function loadGltf(file) {
  const bytes = readFileSync(file);
  if (bytes.readUInt32LE(0) !== 0x46546c67) {
    return { json: JSON.parse(bytes.toString("utf8")), baseDir: path.dirname(file), binary: null };
  }
  let offset = 12;
  let json = null;
  let binary = null;
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8"));
    else if (type === 0x004e4942) binary = chunk;
    offset += 8 + length;
  }
  return { json, baseDir: path.dirname(file), binary };
}

function readAccessorFloats(gltf, index) {
  const accessor = gltf.json.accessors[index];
  const view = gltf.json.bufferViews[accessor.bufferView];
  let buffer;
  if (gltf.binary) buffer = gltf.binary;
  else buffer = readFileSync(path.resolve(gltf.baseDir, gltf.json.buffers[view.buffer].uri));
  const componentCount = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type];
  const byteOffset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const out = [];
  for (let i = 0; i < accessor.count; i += 1) {
    const row = [];
    for (let c = 0; c < componentCount; c += 1) {
      row.push(buffer.readFloatLE(byteOffset + (i * componentCount + c) * 4));
    }
    out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------- mat4 (column-major, glTF order)

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function composeMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const out = [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
  return out;
}

function invert(m) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  const inv = 1 / det;
  const out = new Array(16);
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * inv;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * inv;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * inv;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * inv;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * inv;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * inv;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * inv;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * inv;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * inv;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * inv;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * inv;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * inv;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * inv;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * inv;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * inv;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * inv;
  return out;
}

function transformPoint(m, p) {
  const [x, y, z] = p;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function rotationAngle(m) {
  // Angle of the 3x3 rotation part, robust against a uniform scale.
  const cols = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]];
  const scales = cols.map((c) => Math.hypot(c[0], c[1], c[2]) || 1);
  const trace = (cols[0][0] / scales[0]) + (cols[1][1] / scales[1]) + (cols[2][2] / scales[2]);
  return (Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2))) * 180) / Math.PI;
}

function maxScale(m) {
  const cols = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]];
  return Math.max(...cols.map((c) => Math.hypot(c[0], c[1], c[2])));
}

// ---------------------------------------------------------------- main

const gltf = loadGltf(source);
const json = gltf.json;
const round = (v, d = 4) => Number.parseFloat(v.toFixed(d));

const parentOf = new Array(json.nodes.length).fill(-1);
json.nodes.forEach((node, index) => {
  (node.children || []).forEach((child) => { parentOf[child] = index; });
});

function globalOf(index) {
  let matrix = IDENTITY;
  let cursor = index;
  const chain = [];
  while (cursor >= 0) {
    chain.unshift(cursor);
    cursor = parentOf[cursor];
  }
  for (const nodeIndex of chain) matrix = multiply(matrix, composeMatrix(json.nodes[nodeIndex]));
  return matrix;
}

const report = { source, ok: true, skins: [] };

for (const [skinIndex, skin] of (json.skins || []).entries()) {
  if (skin.inverseBindMatrices === undefined) {
    report.skins.push({ skin: skinIndex, error: "no inverseBindMatrices" });
    continue;
  }
  const ibms = readAccessorFloats(gltf, skin.inverseBindMatrices);
  const joints = [];
  for (const [jointSlot, nodeIndex] of skin.joints.entries()) {
    const global = globalOf(nodeIndex);
    const ibm = ibms[jointSlot];
    const inverseIbm = invert(ibm);
    if (!inverseIbm) continue;
    const correction = multiply(inverseIbm, invert(global));
    joints.push({
      node: nodeIndex,
      name: json.nodes[nodeIndex].name || `joint_${jointSlot}`,
      globalTranslation: [round(global[12]), round(global[13]), round(global[14])],
      bindTranslation: [round(inverseIbm[12]), round(inverseIbm[13]), round(inverseIbm[14])],
      correction,
    });
  }
  // Average the correction's translation and compare each joint's rotation/offset spread.
  const first = joints[0].correction;
  let maxTranslationDelta = 0;
  let maxRotationDelta = 0;
  const anchor = [first[12], first[13], first[14]];
  for (const joint of joints) {
    const c = joint.correction;
    const delta = Math.hypot(c[12] - anchor[0], c[13] - anchor[1], c[14] - anchor[2]);
    maxTranslationDelta = Math.max(maxTranslationDelta, delta);
    const deltaMatrix = multiply(invert(first), c);
    maxRotationDelta = Math.max(maxRotationDelta, rotationAngle(deltaMatrix));
  }
  // Leaf `_end` joints exist only to give the last deform bone a length. Exporters frequently leave
  // them with a stale inverse bind matrix, which is harmless because no vertex is weighted to them.
  // Judging the whole file by those tails reported a perfectly sound skin as broken, so the verdict
  // is taken from deform joints and the tails are reported separately.
  const isHelper = (name) => /(^|[^a-z])end([^a-z]|$)|end[._]?\d+$|^end/i.test(String(name));
  // A skin's joint list also carries the file's structural wrappers (FBX `_rootJoint`, `Transform_01`,
  // an `Armature` node). They hold no vertices and legitimately sit in a different frame from the
  // deform bones, so counting them as a bind error reported a sound rig as broken.
  const isStructural = (name) => /^(?:root|rootjoint|skeleton|armature|transform|transform\d+|scene|reference)$/i
    .test(String(name).replace(/[^a-z0-9]/gi, ""));
  const deformJoints = joints.filter((joint) => !isHelper(joint.name) && !isStructural(joint.name));
  const helperJoints = joints.filter((joint) => isHelper(joint.name)).length;
  const structuralJoints = joints.length - deformJoints.length - helperJoints;
  const deformAnchor = deformJoints[0].correction;
  // Float32 quantisation in the buffer is worth ~1e-4 m and a few hundredths of a degree; anything
  // inside that is the file agreeing with itself, not a rig defect.
  const TRANSLATION_TOLERANCE = 1e-3;
  const ROTATION_TOLERANCE = 0.05;
  let deformSpread = 0;
  let deformRotationSpread = 0;
  const outlierJoints = [];
  for (const joint of deformJoints) {
    const delta = Math.hypot(joint.correction[12] - deformAnchor[12], joint.correction[13] - deformAnchor[13], joint.correction[14] - deformAnchor[14]);
    const angle = rotationAngle(multiply(invert(deformAnchor), joint.correction));
    deformSpread = Math.max(deformSpread, delta);
    deformRotationSpread = Math.max(deformRotationSpread, angle);
    if (delta > TRANSLATION_TOLERANCE || angle > ROTATION_TOLERANCE) {
      outlierJoints.push({ name: joint.name, translation: round(delta), rotationDegrees: round(angle, 3) });
    }
  }
  const sample = joints.reduce((best, joint) => (joint.name.toLowerCase().includes("pelvis") || joint.name.toLowerCase().includes("hips") ? joint : best), joints[0]);
  const rigid = deformSpread < TRANSLATION_TOLERANCE && deformRotationSpread < ROTATION_TOLERANCE;
  report.skins.push({
    skin: skinIndex,
    joints: joints.length,
    deformJoints: deformJoints.length,
    helperJoints,
    structuralJoints,
    deformJointsConsistent: rigid,
    outlierJoints,
    deformCorrection: {
      rotationDegrees: round(rotationAngle(deformAnchor), 2),
      translation: [round(deformAnchor[12]), round(deformAnchor[13]), round(deformAnchor[14])],
      spread: { translation: round(deformSpread), rotationDegrees: round(deformRotationSpread, 3) },
    },
    bindPoseConsistent: rigid,
    verdict: rigid
      ? "every joint's node transform matches its inverse bind matrix"
      : "joint node transforms disagree with the inverse bind matrices; the rest skeleton is not where the skin binds",
    correction: {
      rotationDegrees: round(rotationAngle(first), 2),
      scale: round(maxScale(first), 4),
      translation: [round(first[12]), round(first[13]), round(first[14])],
      matrix: first.map((v) => round(v, 5)),
    },
    maxCorrectionSpread: { translation: round(maxTranslationDelta), rotationDegrees: round(maxRotationDelta, 3) },
    sampleJoint: { name: sample.name, nodeTransform: sample.globalTranslation, bindPosition: sample.bindTranslation },
    jointSample: joints.slice(0, 6).map((joint) => ({
      name: joint.name,
      nodeTransform: joint.globalTranslation,
      bindPosition: joint.bindTranslation,
    })),
  });
}

console.log(JSON.stringify(report, null, 2));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
