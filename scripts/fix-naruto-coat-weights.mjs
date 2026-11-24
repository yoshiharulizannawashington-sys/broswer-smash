// Repair the two Naruto Sage coat panels that fold through the torso in Naruto_defeat.
//
// The auto-rig gave the coat panels limb weights (LeftShoulder/LeftUpLeg). In the defeat clip one
// panel follows the arm while the other follows the thigh, collapsing a ~10 cm seam to ~0.9 cm.
// The two panels are reweighted to the torso chain only, using the same blend at every vertex in
// their connected components. That keeps every seam edge inside the 0.15x compression gate without
// weakening the gate.
//
// This is an asset repair, not a runtime hack. Run it after rebuilding the Sage GLB:
//
//   node scripts/fix-naruto-coat-weights.mjs
//
// The seeds are stable for the checked-in 5,248-vertex Sage asset. The script verifies the mesh,
// accessor layout and component membership before writing anything.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve('public/models/characters/imported/naruto_sage/naruto_sage_animated.glb');
const buffer = readFileSync(file);
if (buffer.toString('ascii', 0, 4) !== 'glTF') throw new Error(`${file} is not a GLB`);

const jsonLength = buffer.readUInt32LE(12);
const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
const binStart = 20 + jsonLength + 8;

function accessorData(accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  const types = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const components = types[accessor.type];
  const bytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[accessor.componentType];
  if (!bytes || !components) throw new Error(`unsupported accessor ${accessorIndex}`);
  const start = binStart + (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const stride = view.byteStride || bytes * components;
  return { accessor, view, start, stride, bytes, components };
}

function readIndex(accessorIndex, i) {
  const a = accessorData(accessorIndex);
  const offset = a.start + i * a.stride;
  if (a.accessor.componentType === 5121) return buffer.readUInt8(offset);
  if (a.accessor.componentType === 5123) return buffer.readUInt16LE(offset);
  if (a.accessor.componentType === 5125) return buffer.readUInt32LE(offset);
  throw new Error(`unsupported index type ${a.accessor.componentType}`);
}

function readFloat(accessorIndex, i, component) {
  const a = accessorData(accessorIndex);
  if (a.accessor.componentType !== 5126) throw new Error(`accessor ${accessorIndex} is not float`);
  return buffer.readFloatLE(a.start + i * a.stride + component * 4);
}

function writeFloat(accessorIndex, i, component, value) {
  const a = accessorData(accessorIndex);
  if (a.accessor.componentType !== 5126) throw new Error(`accessor ${accessorIndex} is not float`);
  buffer.writeFloatLE(value, a.start + i * a.stride + component * 4);
}

function writeJoint(accessorIndex, i, component, value) {
  const a = accessorData(accessorIndex);
  const offset = a.start + i * a.stride + component * a.bytes;
  if (a.accessor.componentType === 5121) buffer.writeUInt8(value, offset);
  else if (a.accessor.componentType === 5123) buffer.writeUInt16LE(value, offset);
  else throw new Error(`unsupported joint type ${a.accessor.componentType}`);
}

const meshIndex = json.meshes.findIndex(mesh => mesh.primitives.some(primitive => {
  const material = json.materials[primitive.material];
  return material?.name === 'nr2_tex01.png';
}));
if (meshIndex < 0) throw new Error('Naruto Sage coat mesh (nr2_tex01.png) not found');
const mesh = json.meshes[meshIndex];
if (mesh.primitives.length !== 1) throw new Error(`expected one coat primitive, found ${mesh.primitives.length}`);
const primitive = mesh.primitives[0];
const { POSITION, JOINTS_0, WEIGHTS_0 } = primitive.attributes;
if (!POSITION || !JOINTS_0 || !WEIGHTS_0) throw new Error('coat primitive is not skinned');
const positions = json.accessors[POSITION];
const indices = json.accessors[primitive.indices];
if (positions.count !== 1889 || indices.count !== 1836 * 3) {
  throw new Error(`unexpected coat topology ${positions.count} vertices / ${indices.count / 3} triangles`);
}

const node = json.nodes.find(item => item.mesh === meshIndex && item.skin != null);
if (!node) throw new Error('coat mesh has no skin node');
const skin = json.skins[node.skin];
const boneNames = skin.joints.map(joint => json.nodes[joint].name);
const boneByName = Object.fromEntries(boneNames.map((name, i) => [name, i]));

const adjacency = Array.from({ length: positions.count }, () => new Set());
for (let i = 0; i < indices.count; i += 3) {
  const a = readIndex(primitive.indices, i);
  const b = readIndex(primitive.indices, i + 1);
  const c = readIndex(primitive.indices, i + 2);
  for (const [x, y] of [[a, b], [b, c], [c, a]]) {
    adjacency[x].add(y);
    adjacency[y].add(x);
  }
}

function component(start) {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const vertex = stack.pop();
    for (const next of adjacency[vertex]) {
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return seen;
}

// Diagnostic seeds: the left coat seam that collapses in Naruto_defeat. Both panels are repaired;
// changing only one moves the pinch to the adjacent panel.
const seeds = [1642, 723];
const targets = new Set();
for (const seed of seeds) {
  if (seed >= positions.count) throw new Error(`coat seed ${seed} is outside the primitive`);
  for (const vertex of component(seed)) targets.add(vertex);
}

const blendFor = y => {
  if (y < 1.0) return [['Spine', 0.50], ['Hips', 0.25], ['Chest', 0.25]];
  if (y < 1.25) return [['Chest', 0.45], ['Spine', 0.35], ['Neck', 0.20]];
  return [['Neck', 0.55], ['Chest', 0.30], ['Head', 0.15]];
};

for (const vertex of targets) {
  const y = readFloat(POSITION, vertex, 1);
  const blend = blendFor(y);
  let total = 0;
  for (const [, weight] of blend) total += weight;
  for (let k = 0; k < 4; k++) {
    const entry = blend[k];
    const joint = entry ? boneByName[entry[0]] : 0;
    if (entry && joint == null) throw new Error(`coat bone ${entry[0]} is not in the skin`);
    writeJoint(JOINTS_0, vertex, k, joint || 0);
    writeFloat(WEIGHTS_0, vertex, k, entry ? entry[1] / total : 0);
  }
}

writeFileSync(file, buffer);
const sha256 = createHash('sha256').update(buffer).digest('hex');
console.log(JSON.stringify({
  file,
  mesh: mesh.name,
  vertices: positions.count,
  repairedVertices: targets.size,
  repairedPanels: seeds.map(seed => component(seed).size),
  bytes: buffer.length,
  sha256
}, null, 2));
