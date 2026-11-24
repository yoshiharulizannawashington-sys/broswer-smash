#!/usr/bin/env node
/**
 * Repair the supplied Iron Spider mechanical-arm mesh in the promoted runtime GLB.
 *
 * The runtime GLB still contains Object_122 as a detached node. Its POSITION accessor is about
 * 25x the body and sits below it, while its JOINTS_0/WEIGHTS_0 are valid and point at the
 * supplied spider-body/leg chains. This script:
 *
 *   1. fits one signed-permutation + uniform-scale transform from the arm's weighted joint
 *      clusters to those joints' inverse-bind positions;
 *   2. rewrites POSITION/NORMAL in place and reverses indices when the fit is a reflection;
 *   3. puts the single existing Object_122 node back under Object_5 in the render graph.
 *
 * It keeps the body, materials and all 57 clips untouched. It does not promote the result.
 *
 *   node scripts/repair_iron_spider_arms_glb.mjs <runtime.glb> <candidate.glb> <report.json>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const [sourceArg, outArg, reportArg] = process.argv.slice(2);
if (!sourceArg || !outArg || !reportArg) {
  console.error('usage: node scripts/repair_iron_spider_arms_glb.mjs <runtime.glb> <candidate.glb> <report.json>');
  process.exit(2);
}
const SOURCE = resolve(sourceArg);
const OUT = resolve(outArg);
const REPORT = resolve(reportArg);

function loadGlb(file) {
  const bytes = readFileSync(file);
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  let offset = 12;
  let json = null;
  let binary = null;
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) binary = chunk;
    offset += 8 + length;
  }
  if (!json || !binary) throw new Error('missing JSON or BIN chunk');
  return { json, binary };
}

const COMPONENT = {
  5120: { size: 1, read: (view, offset) => view.getInt8(offset), write: (view, offset, value) => view.setInt8(offset, value) },
  5121: { size: 1, read: (view, offset) => view.getUint8(offset), write: (view, offset, value) => view.setUint8(offset, value) },
  5122: { size: 2, read: (view, offset) => view.getInt16(offset, true), write: (view, offset, value) => view.setInt16(offset, value, true) },
  5123: { size: 2, read: (view, offset) => view.getUint16(offset, true), write: (view, offset, value) => view.setUint16(offset, value, true) },
  5125: { size: 4, read: (view, offset) => view.getUint32(offset, true), write: (view, offset, value) => view.setUint32(offset, value, true) },
  5126: { size: 4, read: (view, offset) => view.getFloat32(offset, true), write: (view, offset, value) => view.setFloat32(offset, value, true) },
};
const TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

const { json, binary } = loadGlb(SOURCE);
const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
const nodes = json.nodes || [];
const names = nodes.map(node => node.name || '');
const parents = [];
nodes.forEach((node, index) => (node.children || []).forEach(child => { parents[child] = index; }));

function readAccessor(index) {
  const accessor = json.accessors[index];
  const bufferView = json.bufferViews[accessor.bufferView];
  const format = COMPONENT[accessor.componentType];
  const width = TYPE_COUNT[accessor.type];
  const stride = bufferView.byteStride || format.size * width;
  const base = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const out = [];
  for (let i = 0; i < accessor.count; i += 1) {
    const row = [];
    for (let c = 0; c < width; c += 1) {
      const value = format.read(view, base + i * stride + c * format.size);
      row.push(accessor.normalized && accessor.componentType !== 5126
        ? value / (accessor.componentType === 5121 ? 255 : 65535)
        : value);
    }
    out.push(row);
  }
  return out;
}

function writeAccessor(index, rows) {
  const accessor = json.accessors[index];
  const bufferView = json.bufferViews[accessor.bufferView];
  const format = COMPONENT[accessor.componentType];
  const width = TYPE_COUNT[accessor.type];
  const stride = bufferView.byteStride || format.size * width;
  const base = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  for (let i = 0; i < rows.length; i += 1) {
    for (let c = 0; c < width; c += 1) {
      const value = rows[i][c];
      format.write(view, base + i * stride + c * format.size, accessor.normalized && accessor.componentType !== 5126
        ? Math.round(value * (accessor.componentType === 5121 ? 255 : 65535))
        : value);
    }
  }
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function compose(node) {
  if (node.matrix) return node.matrix.slice();
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}
function invert(m) {
  const a = m;
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  const inv = 1 / det;
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * inv, (a02 * b10 - a01 * b11 - a03 * b09) * inv,
    (a31 * b05 - a32 * b04 + a33 * b03) * inv, (a22 * b04 - a21 * b05 - a23 * b03) * inv,
    (a12 * b08 - a10 * b11 - a13 * b07) * inv, (a00 * b11 - a02 * b08 + a03 * b07) * inv,
    (a32 * b02 - a30 * b05 - a33 * b01) * inv, (a20 * b05 - a22 * b02 + a23 * b01) * inv,
    (a10 * b10 - a11 * b08 + a13 * b06) * inv, (a01 * b08 - a00 * b10 - a03 * b06) * inv,
    (a30 * b04 - a31 * b02 + a33 * b00) * inv, (a21 * b02 - a20 * b04 - a23 * b00) * inv,
    (a11 * b07 - a10 * b09 - a12 * b06) * inv, (a00 * b09 - a01 * b07 + a02 * b06) * inv,
    (a31 * b01 - a30 * b03 - a32 * b00) * inv, (a20 * b03 - a21 * b01 + a22 * b00) * inv,
  ];
}
function globalOf(index) {
  const chain = [];
  for (let cursor = index; cursor !== undefined; cursor = parents[cursor]) chain.unshift(cursor);
  return chain.reduce((matrix, nodeIndex) => multiply(matrix, compose(nodes[nodeIndex])), IDENTITY);
}
function transformPoint(matrix, point) {
  return [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  ];
}

const armNodeIndex = nodes.findIndex(node => node.name === 'Object_122' && node.mesh !== undefined);
if (armNodeIndex < 0) throw new Error('Object_122 mesh node not found');
const armNode = nodes[armNodeIndex];
if (armNode.skin === undefined) throw new Error('Object_122 is not skinned');
const armMesh = json.meshes[armNode.mesh];
const primitive = armMesh.primitives?.[0];
if (!primitive || primitive.attributes?.POSITION === undefined) throw new Error('arm primitive has no POSITION');
const skin = json.skins[armNode.skin];
const inverseBindMatrices = readAccessor(skin.inverseBindMatrices);
const armPositions = readAccessor(primitive.attributes.POSITION);
const armNormals = primitive.attributes.NORMAL !== undefined ? readAccessor(primitive.attributes.NORMAL) : null;
const armWeights = readAccessor(primitive.attributes.WEIGHTS_0);
const armJoints = readAccessor(primitive.attributes.JOINTS_0);
if (armWeights.length !== armPositions.length || armJoints.length !== armPositions.length) {
  throw new Error('arm weights/joints do not match vertex count');
}

const jointBySlot = skin.joints.map((node, slot) => {
  const inverse = invert(inverseBindMatrices[slot]);
  return {
    slot,
    node,
    name: names[node],
    bind: inverse ? [inverse[12], inverse[13], inverse[14]] : null,
    global: globalOf(node),
  };
});

const groups = new Map();
for (let i = 0; i < armPositions.length; i += 1) {
  let best = -1;
  let bestWeight = 0;
  for (let c = 0; c < 4; c += 1) {
    if (armWeights[i][c] > bestWeight) {
      bestWeight = armWeights[i][c];
      best = armJoints[i][c];
    }
  }
  const joint = jointBySlot[best];
  if (!joint?.bind) continue;
  const entry = groups.get(best) || { joint, sum: [0, 0, 0], count: 0 };
  const point = armPositions[i];
  entry.sum[0] += point[0];
  entry.sum[1] += point[1];
  entry.sum[2] += point[2];
  entry.count += 1;
  groups.set(best, entry);
}
const groupList = [...groups.values()].filter(entry => entry.count > 2);
if (groupList.length < 8) throw new Error('not enough arm groups with inverse-bind targets');

const sourcePoints = groupList.map(entry => entry.sum.map(value => value / entry.count));
const targetPoints = groupList.map(entry => entry.joint.bind);
const sourceMean = [0, 1, 2].map(axis => sourcePoints.reduce((sum, point) => sum + point[axis], 0) / sourcePoints.length);
const targetMean = [0, 1, 2].map(axis => targetPoints.reduce((sum, point) => sum + point[axis], 0) / targetPoints.length);
const sourceCentered = sourcePoints.map(point => point.map((value, axis) => value - sourceMean[axis]));
const targetCentered = targetPoints.map(point => point.map((value, axis) => value - targetMean[axis]));

const permutations = [];
function permute(values, index, used) {
  if (index === 3) { permutations.push(values.slice()); return; }
  for (let axis = 0; axis < 3; axis += 1) {
    if (used[axis]) continue;
    used[axis] = true;
    values[index] = axis;
    permute(values, index + 1, used);
    used[axis] = false;
  }
}
permute([0, 1, 2], 0, [false, false, false]);

function fitFor(rotation) {
  const q = sourceCentered.map(point => [
    rotation[0][0] * point[0] + rotation[0][1] * point[1] + rotation[0][2] * point[2],
    rotation[1][0] * point[0] + rotation[1][1] * point[1] + rotation[1][2] * point[2],
    rotation[2][0] * point[0] + rotation[2][1] * point[1] + rotation[2][2] * point[2],
  ]);
  const denominator = q.reduce((sum, point) => sum + point[0] ** 2 + point[1] ** 2 + point[2] ** 2, 0);
  if (denominator < 1e-12) return null;
  let numerator = 0;
  for (let i = 0; i < q.length; i += 1) {
    numerator += q[i][0] * targetCentered[i][0] + q[i][1] * targetCentered[i][1] + q[i][2] * targetCentered[i][2];
  }
  const scale = numerator / denominator;
  if (!(scale > 0)) return null;
  const translation = targetMean.map((value, axis) => value - scale * (rotation[axis][0] * sourceMean[0] + rotation[axis][1] * sourceMean[1] + rotation[axis][2] * sourceMean[2]));
  let squared = 0;
  let worst = 0;
  for (let i = 0; i < sourcePoints.length; i += 1) {
    const point = sourcePoints[i];
    const predicted = [0, 1, 2].map(axis => scale * (rotation[axis][0] * point[0] + rotation[axis][1] * point[1] + rotation[axis][2] * point[2]) + translation[axis]);
    const distance = Math.hypot(predicted[0] - targetPoints[i][0], predicted[1] - targetPoints[i][1], predicted[2] - targetPoints[i][2]);
    squared += distance * distance;
    worst = Math.max(worst, distance);
  }
  return { rotation, scale, translation, rms: Math.sqrt(squared / sourcePoints.length), worst };
}

let bestFit = null;
for (const permutation of permutations) {
  for (let bits = 0; bits < 8; bits += 1) {
    const rotation = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    for (let axis = 0; axis < 3; axis += 1) rotation[axis][permutation[axis]] = bits & (1 << axis) ? -1 : 1;
    const determinant = rotation[0][0] * (rotation[1][1] * rotation[2][2] - rotation[1][2] * rotation[2][1])
      - rotation[0][1] * (rotation[1][0] * rotation[2][2] - rotation[1][2] * rotation[2][0])
      + rotation[0][2] * (rotation[1][0] * rotation[2][1] - rotation[1][1] * rotation[2][0]);
    const fit = fitFor(rotation);
    if (!fit) continue;
    fit.determinant = determinant;
    if (!bestFit || fit.rms < bestFit.rms) bestFit = fit;
  }
}
if (!bestFit) throw new Error('no valid arm transform found');
if (bestFit.rms > 0.35) throw new Error(`arm bind fit is too loose: ${bestFit.rms.toFixed(3)} m RMS`);

const transformedPositions = armPositions.map(point => [0, 1, 2].map(axis => bestFit.scale * (bestFit.rotation[axis][0] * point[0] + bestFit.rotation[axis][1] * point[1] + bestFit.rotation[axis][2] * point[2]) + bestFit.translation[axis]));
const transformedNormals = armNormals
  ? armNormals.map(normal => {
      const out = [0, 1, 2].map(axis => bestFit.rotation[axis][0] * normal[0] + bestFit.rotation[axis][1] * normal[1] + bestFit.rotation[axis][2] * normal[2]);
      const length = Math.hypot(out[0], out[1], out[2]) || 1;
      return out.map(value => value / length);
    })
  : null;

writeAccessor(primitive.attributes.POSITION, transformedPositions);
if (transformedNormals && primitive.attributes.NORMAL !== undefined) writeAccessor(primitive.attributes.NORMAL, transformedNormals);
const positionAccessor = json.accessors[primitive.attributes.POSITION];
positionAccessor.min = [0, 1, 2].map(axis => Math.min(...transformedPositions.map(point => point[axis])));
positionAccessor.max = [0, 1, 2].map(axis => Math.max(...transformedPositions.map(point => point[axis])));

let reversedTriangles = false;
if (primitive.indices !== undefined && bestFit.determinant < 0) {
  const indexRows = readAccessor(primitive.indices).map(row => row[0]);
  for (let i = 0; i + 2 < indexRows.length; i += 3) {
    const swap = indexRows[i + 1];
    indexRows[i + 1] = indexRows[i + 2];
    indexRows[i + 2] = swap;
  }
  const indexAccessor = json.accessors[primitive.indices];
  const format = COMPONENT[indexAccessor.componentType];
  const bufferView = json.bufferViews[indexAccessor.bufferView];
  const stride = bufferView.byteStride || format.size;
  const base = (bufferView.byteOffset || 0) + (indexAccessor.byteOffset || 0);
  for (let i = 0; i < indexRows.length; i += 1) {
    format.write(view, base + i * stride, indexRows[i]);
  }
  reversedTriangles = true;
}

// The cleanup bake detached this node without deleting it. Put the one node back under Object_5;
// never duplicate it. The node has no transform and uses the existing skin.
const object5 = nodes.findIndex(node => node.name === 'Object_5');
if (object5 < 0) throw new Error('Object_5 hierarchy node not found');
nodes.forEach(node => {
  if (node.children) node.children = node.children.filter(child => child !== armNodeIndex);
});
nodes[object5].children = nodes[object5].children || [];
if (!nodes[object5].children.includes(armNodeIndex)) nodes[object5].children.push(armNodeIndex);
armNode.name = 'Object_122';
armNode.skin = armNode.skin;
armNode.mesh = armNode.mesh;

const newJson = JSON.stringify(json);
const jsonPadding = (4 - (newJson.length % 4)) % 4;
const jsonChunk = Buffer.from(newJson + ' '.repeat(jsonPadding), 'utf8');
const binPadding = (4 - (binary.length % 4)) % 4;
const binChunk = Buffer.concat([binary, Buffer.alloc(binPadding, 0)]);
const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
const out = Buffer.alloc(total);
out.writeUInt32LE(0x46546c67, 0);
out.writeUInt32LE(2, 4);
out.writeUInt32LE(total, 8);
out.writeUInt32LE(jsonChunk.length, 12);
out.writeUInt32LE(0x4e4f534a, 16);
jsonChunk.copy(out, 20);
out.writeUInt32LE(binChunk.length, 20 + jsonChunk.length);
out.writeUInt32LE(0x004e4942, 24 + jsonChunk.length);
binChunk.copy(out, 28 + jsonChunk.length);

mkdirSync(dirname(OUT), { recursive: true });
mkdirSync(dirname(REPORT), { recursive: true });
writeFileSync(OUT, out);
const report = {
  ok: true,
  source: SOURCE,
  output: OUT,
  bytes: out.length,
  armNode: armNodeIndex,
  vertices: armPositions.length,
  groups: groupList.length,
  fit: {
    scale: Number(bestFit.scale.toFixed(8)),
    translation: bestFit.translation.map(value => Number(value.toFixed(6))),
    rotation: bestFit.rotation,
    determinant: bestFit.determinant,
    rmsMeters: Number(bestFit.rms.toFixed(6)),
    worstMeters: Number(bestFit.worst.toFixed(6)),
  },
  reversedTriangles,
  bounds: {
    min: positionAccessor.min.map(value => Number(value.toFixed(5))),
    max: positionAccessor.max.map(value => Number(value.toFixed(5))),
    size: positionAccessor.max.map((value, axis) => Number((value - positionAccessor.min[axis]).toFixed(5))),
  },
  boneNames: groupList.map(entry => entry.joint.name),
};
writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
