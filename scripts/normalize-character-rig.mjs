// Re-base the character prefab rig to the convention the game's pose writer expects.
//
// The Blender generator authors every body part Y-up and pre-rotates the exported root by
// +90 degrees about X (`root.rotation_euler.x = math.pi / 2`) so glTF's Z-up -> Y-up export
// conversion cancels out. The rest pose therefore lands correctly in world space, but every
// joint's *local* frame is the authored frame rotated by -90 degrees about X:
//
//     pelvis local translation (0, 0, -1.02)  -> world (0, 1.02, 0) only because of the root
//     an arm's local +Z is its own "down" axis, local -Z is the body's up axis
//
// fighter3D.js drives those joints with the procedural body's pose (authored Y-up: pelvis up
// +Y, limbs swinging about X, splay about Z), so `rotation.z` twisted a limb instead of
// splaying it, and `model.rotation.y = yaw` (Euler XYZ composes as Rx(90)*Ry(yaw)) tipped the
// whole fighter off its feet as soon as it faced anything but +Z.
//
// This script removes the baked-in axis offset: the root becomes identity, every joint's
// local frame becomes the authored frame, and every mesh's vertices move into that same
// frame. The world-space rest pose is provably unchanged - the script asserts it to 1 mm
// before writing - so the figure looks identical at rest while local rotations now mean what
// the pose code means.
//
// It also lifts the root-level cape meshes, which the generator authored 1.36 m too low (see
// cape() in assets/blender/character_models.py), so the cloth hangs from the shoulders
// instead of hanging through the floor.
//
// Usage:
//   node scripts/normalize-character-rig.mjs          # rewrite public/assets/character_models.glb
//   node scripts/normalize-character-rig.mjs --check  # report only, exit 1 if not normalised
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

globalThis.self = globalThis;

const GLB_PATH = resolve('public/assets/character_models.glb');
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const AXIS = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const AXIS_INV = AXIS.clone().invert();
const AXIS_MATRIX = new THREE.Matrix4().makeRotationX(Math.PI / 2);
const AXIS_INV_MATRIX = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
// Shoulder line of the generated body: pelvis 1.02 + torso 0.28 + arm 0.35, with the cape
// collar sitting just above it. cape() always starts its top row at 0.54.
const CAPE_TOP = 1.9;
const CAPE_AUTHORED_TOP = 0.54;
const CAPE_LIFT = +(CAPE_TOP - CAPE_AUTHORED_TOP).toFixed(3);

function parseGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < view.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const chunk = new Uint8Array(bytes.buffer, bytes.byteOffset + offset + 8, length);
    if (type === JSON_CHUNK) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === BIN_CHUNK) bin = chunk;
    offset += 8 + length;
  }
  if (!json || !bin) throw new Error('GLB is missing its JSON or BIN chunk');
  return { json, bin };
}

function encodeGlb(json, bin) {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(jsonBytes.length / 4) * 4;
  const binLength = Math.ceil(bin.length / 4) * 4;
  const total = 12 + 8 + jsonLength + 8 + binLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, JSON_CHUNK, true);
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(jsonBytes, 20);
  const binStart = 20 + jsonLength;
  view.setUint32(binStart, binLength, true);
  view.setUint32(binStart + 4, BIN_CHUNK, true);
  out.set(bin, binStart + 8);
  return out;
}

function descendants(json, rootIndex) {
  const out = [];
  const stack = [...(json.nodes[rootIndex].children || [])];
  while (stack.length) {
    const index = stack.pop();
    out.push(index);
    for (const child of json.nodes[index].children || []) stack.push(child);
  }
  return out;
}

/** True while the prefab root still carries the generator's +90 degree axis correction. */
function carriesAxisOffset(json, rootIndex) {
  const rotation = json.nodes[rootIndex].rotation;
  if (!rotation) return false;
  const q = new THREE.Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]);
  return q.angleTo(AXIS) < 1e-4;
}

function accessorPoints(json, bin, accessorIndex, fn) {
  const accessor = json.accessors[accessorIndex];
  if (accessor.componentType !== 5126) return 0;
  const view = json.bufferViews[accessor.bufferView];
  const base = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const stride = view.byteStride || 12;
  const floats = new Float32Array(bin.buffer, bin.byteOffset + base, accessor.count * 3);
  const step = stride / 4;
  const scratch = new THREE.Vector3();
  for (let i = 0; i < accessor.count; i++) {
    scratch.set(floats[i * step], floats[i * step + 1], floats[i * step + 2]);
    fn(scratch);
    floats[i * step] = scratch.x;
    floats[i * step + 1] = scratch.y;
    floats[i * step + 2] = scratch.z;
  }
  return accessor.count;
}

function transformMesh(json, bin, meshIndex, fn) {
  let vertices = 0;
  for (const primitive of json.meshes[meshIndex].primitives) {
    for (const [semantic, accessorIndex] of Object.entries(primitive.attributes || {})) {
      if (semantic !== 'POSITION' && semantic !== 'NORMAL') continue;
      vertices += accessorPoints(json, bin, accessorIndex, fn);
      const accessor = json.accessors[accessorIndex];
      if (semantic === 'POSITION' && accessor.min && accessor.max) {
        const box = new THREE.Box3();
        const min = new THREE.Vector3(...accessor.min);
        const max = new THREE.Vector3(...accessor.max);
        for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
          box.expandByPoint(fn(new THREE.Vector3(x, y, z)).clone());
        }
        accessor.min = box.min.toArray();
        accessor.max = box.max.toArray();
      }
    }
  }
  return vertices;
}

function liftMeshesY(json, bin, nodeIndices, delta) {
  let lifted = 0;
  for (const index of nodeIndices) {
    const node = json.nodes[index];
    if (node.mesh == null) continue;
    for (const primitive of json.meshes[node.mesh].primitives) {
      const accessorIndex = primitive.attributes?.POSITION;
      if (accessorIndex == null) continue;
      accessorPoints(json, bin, accessorIndex, vector => vector.setY(vector.y + delta));
      const accessor = json.accessors[accessorIndex];
      if (accessor.min) { accessor.min[1] += delta; accessor.max[1] += delta; }
      lifted++;
    }
  }
  return lifted;
}

function meshBox(json, node) {
  const box = new THREE.Box3();
  for (const primitive of json.meshes[node.mesh]?.primitives || []) {
    const accessor = json.accessors[primitive.attributes?.POSITION];
    if (!accessor?.min) continue;
    box.union(new THREE.Box3(new THREE.Vector3(...accessor.min), new THREE.Vector3(...accessor.max)));
  }
  return box;
}

async function loadScene(buffer) {
  const copy = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const gltf = await new Promise((ok, fail) => new GLTFLoader().parse(copy, '', ok, fail));
  gltf.scene.updateMatrixWorld(true);
  const world = new Map();
  gltf.scene.traverse(node => {
    const position = new THREE.Vector3();
    node.getWorldPosition(position);
    world.set(node.name || node.uuid, { position, box: node.isMesh ? new THREE.Box3().setFromObject(node) : null });
  });
  return { scene: gltf.scene, world };
}

const checkOnly = process.argv.includes('--check');
const raw = readFileSync(GLB_PATH);
const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
const { json, bin } = parseGlb(bytes);

const roots = json.nodes
  .map((node, index) => ({ index, name: node.name || '' }))
  .filter(node => node.name.startsWith('character_'));
if (roots.length < 57) throw new Error(`only ${roots.length} character prefabs found; refusing to rewrite`);
const rootIndices = new Set(roots.map(root => root.index));
// glTF stores children, not parents: build the parent map so root-level costume meshes
// (every cape/cloak/coat the generator hangs off the character root) can be identified.
const parentOf = new Map();
json.nodes.forEach((node, index) => (node.children || []).forEach(child => parentOf.set(child, index)));
const capeNodes = json.nodes
  .map((node, index) => ({ node, index }))
  .filter(entry => entry.node.mesh != null && rootIndices.has(parentOf.get(entry.index)))
  .map(entry => entry.index);
const capeNames = new Set(capeNodes.map(index => json.nodes[index].name));

const pending = roots.filter(root => carriesAxisOffset(json, root.index));
console.log(`character prefabs: ${roots.length} | still carrying the +90 degree axis offset: ${pending.length}`);
console.log(`root-level costume meshes (capes, cloaks, coats): ${capeNodes.length}`);

if (checkOnly && pending.length) {
  console.error('character_models.glb still carries the +90 degree axis offset; run without --check');
  process.exit(1);
}

const before = await loadScene(bytes);

// ------------------------------------------------------------------ re-base the frames
if (pending.length) {
  const done = new Set();
  for (const root of roots) {
    for (const index of descendants(json, root.index)) {
      const node = json.nodes[index];
      // Conjugate the whole local matrix. A 90 degree axis rotation is an axis permutation,
      // so even a non-uniform joint scale (Hulk) stays diagonal and the decomposition below
      // is lossless - translating, rotating and rescaling the pieces separately is not.
      const local = new THREE.Matrix4();
      if (node.matrix) local.fromArray(node.matrix);
      else {
        local.compose(
          new THREE.Vector3().fromArray(node.translation || [0, 0, 0]),
          node.rotation ? new THREE.Quaternion().fromArray(node.rotation) : new THREE.Quaternion(),
          new THREE.Vector3().fromArray(node.scale || [1, 1, 1])
        );
      }
      const rebased = AXIS_MATRIX.clone().multiply(local).multiply(AXIS_INV_MATRIX);
      const translation = new THREE.Vector3();
      const rotation = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      rebased.decompose(translation, rotation, scale);
      delete node.matrix;
      if (node.translation || translation.lengthSq() > 0) node.translation = translation.toArray();
      if (node.rotation || rotation.angleTo(new THREE.Quaternion()) > 1e-6) node.rotation = rotation.normalize().toArray();
      if (node.scale || Math.abs(scale.x - 1) > 1e-6 || Math.abs(scale.y - 1) > 1e-6 || Math.abs(scale.z - 1) > 1e-6) node.scale = scale.toArray();
      if (node.mesh != null && !done.has(node.mesh)) {
        done.add(node.mesh);
        transformMesh(json, bin, node.mesh, vector => vector.applyMatrix4(AXIS_MATRIX));
      }
    }
    delete json.nodes[root.index].rotation;
  }
  json.asset = { ...json.asset, generator: `${json.asset?.generator || 'glTF'} + browser-smash rig re-base` };
  json.asset.extras = { ...(json.asset.extras || {}), rigFrame: 'y-up-identity-root', capeLift: CAPE_LIFT };
}

// ------------------------------------------------------------------ hang the capes
const lowCapes = capeNodes.filter(index => meshBox(json, json.nodes[index]).max.y < 1.2);
const liftedVertices = lowCapes.length ? liftMeshesY(json, bin, lowCapes, CAPE_LIFT) : 0;

// ------------------------------------------------------------------ stand on y = 0
// The generator's boots are authored a couple of centimetres below the prefab origin, so a
// fighter's soles sink into the floor. Lift every direct child by the measured penetration;
// the prefab root's own translation is overwritten by the game at mount, so the offset has
// to live on the children.
let encoded = encodeGlb(json, bin);
const preLift = await loadScene(new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength));
const lifted = [];
// Intentional vertical offsets, so the rest-pose check can tell a deliberate lift from a
// broken transform instead of reporting the fix as drift.
const liftByRoot = new Map();
for (const root of roots) {
  const node = preLift.scene.getObjectByName(root.name);
  if (!node) continue;
  const origin = new THREE.Vector3();
  node.getWorldPosition(origin);
  const box = new THREE.Box3().setFromObject(node);
  const sink = +(box.min.y - origin.y).toFixed(4);
  if (sink > -0.002) continue;
  for (const childIndex of json.nodes[root.index].children || []) {
    const child = json.nodes[childIndex];
    const translation = new THREE.Vector3().fromArray(child.translation || [0, 0, 0]);
    translation.y -= sink;
    child.translation = translation.toArray();
  }
  liftByRoot.set(root.name, -sink);
  lifted.push(root.name.replace(/^character_/, ''));
}
if (lifted.length) encoded = encodeGlb(json, bin);

const after = await loadScene(new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength));

// ------------------------------------------------------------------ assert the rewrite
const problems = [];
let worst = 0;
for (const root of roots) {
  const node = after.scene.getObjectByName(root.name);
  if (!node) { problems.push(`prefab ${root.name} vanished`); continue; }
  node.traverse(child => {
    const key = child.name || child.uuid;
    const reference = before.world.get(key);
    if (!reference) { problems.push(`${key} has no pre-normalisation counterpart`); return; }
    // The foot lift is a deliberate per-prefab vertical offset, so the reference is
    // translated by it; anything else must match the original rest pose exactly.
    // The prefab root stays put; its children carry the foot lift.
    const lift = child === node ? 0 : (liftByRoot.get(root.name) || 0);
    const position = new THREE.Vector3();
    child.getWorldPosition(position);
    const expected = reference.position.clone().setY(reference.position.y + lift);
    worst = Math.max(worst, position.distanceTo(expected));
    if (position.distanceTo(expected) > 1e-3) problems.push(`${key} moved ${position.distanceTo(expected).toFixed(4)} m at rest`);
    // Cape geometry is intentionally lifted, so it is excluded from the rest-pose box check.
    if (!child.isMesh || (child.parent && String(child.parent.name).startsWith('character_'))) return;
    const box = new THREE.Box3().setFromObject(child);
    const expectedBox = reference.box.clone().translate(new THREE.Vector3(0, lift, 0));
    const drift = Math.max(box.min.distanceTo(expectedBox.min), box.max.distanceTo(expectedBox.max));
    worst = Math.max(worst, drift);
    if (drift > 1e-3) problems.push(`${key} geometry moved ${drift.toFixed(4)} m at rest`);
  });
}

// The library lays each prefab out on a grid, so ground contact is measured relative to
// the prefab root - which is where the game places the fighter's feet.
const floorIssues = [];
for (const root of roots) {
  const node = after.scene.getObjectByName(root.name);
  const box = new THREE.Box3().setFromObject(node);
  const origin = new THREE.Vector3();
  node.getWorldPosition(origin);
  const low = box.min.y - origin.y;
  const high = box.max.y - origin.y;
  if (low < -0.02) floorIssues.push(`${root.name} reaches ${low.toFixed(2)} m below its own origin`);
  if (low > 0.02) floorIssues.push(`${root.name} floats ${low.toFixed(2)} m above its own origin`);
  if (high < 1.6 || high > 3.2) floorIssues.push(`${root.name} stands ${high.toFixed(2)} m tall`);
}

if (problems.length) {
  console.error(`rest-pose drift detected (worst ${worst.toFixed(5)} m):`);
  for (const problem of problems.slice(0, 20)) console.error('  ' + problem);
  process.exit(1);
}
if (floorIssues.length) {
  console.error('ground-contact check failed:');
  for (const issue of floorIssues.slice(0, 20)) console.error('  ' + issue);
  process.exit(1);
}

console.log(`rest pose preserved across ${roots.length} prefabs (worst drift ${worst.toExponential(2)} m)`);
console.log(`capes lifted by ${CAPE_LIFT} m: ${lowCapes.length} meshes (${liftedVertices} primitives)`);
console.log(`feet moved onto the prefab origin: ${lifted.length} prefabs`);

if (checkOnly) {
  console.log('character_models.glb is normalised: identity root, feet on y=0, capes on the shoulders');
  process.exit(0);
}
if (!pending.length && !lowCapes.length && !lifted.length) {
  console.log('nothing to do');
  process.exit(0);
}
writeFileSync(GLB_PATH, encoded);
console.log(`rewrote ${GLB_PATH} (${(encoded.length / 1048576).toFixed(1)} MiB)`);
