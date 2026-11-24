// Generates a small, self-authored skinned GLB used to verify the animation pipeline.
//
// This is a TEST FIXTURE, not a character asset. It exists so the loader, rig binding,
// retargeting and clip controller can be exercised against a real skinned glTF instead of
// mocks: eleven joints named the way Mixamo names them, a skinned box, and two clips.
//
// It is written to public/models/characters/_fixture/ and is deliberately NOT registered in
// characters/manifest.json, so no fighter can select it.
//
//   node scripts/make-rig-fixture.mjs            # writes the fixture
//   node scripts/make-rig-fixture.mjs --stdout   # prints where it is
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const JOINTS = [
  { name: 'mixamorig:Hips', parent: -1, t: [0, 1.0, 0] },
  { name: 'mixamorig:Spine', parent: 0, t: [0, 0.3, 0] },
  { name: 'mixamorig:Head', parent: 1, t: [0, 0.35, 0] },
  { name: 'mixamorig:LeftArm', parent: 1, t: [0.25, 0.25, 0] },
  { name: 'mixamorig:LeftForeArm', parent: 3, t: [0.35, 0, 0] },
  { name: 'mixamorig:RightArm', parent: 1, t: [-0.25, 0.25, 0] },
  { name: 'mixamorig:RightForeArm', parent: 5, t: [-0.35, 0, 0] },
  { name: 'mixamorig:LeftUpLeg', parent: 0, t: [0.12, -0.05, 0] },
  { name: 'mixamorig:LeftLeg', parent: 7, t: [0, -0.45, 0] },
  { name: 'mixamorig:RightUpLeg', parent: 0, t: [-0.12, -0.05, 0] },
  { name: 'mixamorig:RightLeg', parent: 9, t: [0, -0.45, 0] },
  // Extension joints: a neck, a wrist per arm and an ankle per leg. They are appended so every
  // existing parent index and the skin weights stay valid, and they make the fixture cover the
  // whole canonical contract instead of only its core.
  { name: 'mixamorig:Neck', parent: 1, t: [0, 0.18, 0] },
  { name: 'mixamorig:LeftHand', parent: 4, t: [0.28, 0, 0] },
  { name: 'mixamorig:RightHand', parent: 6, t: [-0.28, 0, 0] },
  { name: 'mixamorig:LeftFoot', parent: 8, t: [0, -0.42, 0] },
  { name: 'mixamorig:RightFoot', parent: 10, t: [0, -0.42, 0] },
  // Upper spine and clavicles: the fixture covers a multi-segment spine and independent shoulders
  // too, so the whole canonical contract is exercised rather than only its core eleven.
  { name: 'mixamorig:Spine2', parent: 1, t: [0, 0.14, 0] },
  { name: 'mixamorig:LeftShoulder', parent: 1, t: [0.06, 0.2, 0] },
  { name: 'mixamorig:RightShoulder', parent: 1, t: [-0.06, 0.2, 0] }
];

// Bind-pose world positions, resolved in hierarchy order (parents are always earlier entries).
const worldPositions = [];
for (const joint of JOINTS) {
  const parent = joint.parent >= 0 ? worldPositions[joint.parent] : [0, 0, 0];
  worldPositions.push([parent[0] + joint.t[0], parent[1] + joint.t[1], parent[2] + joint.t[2]]);
}

const clamped = (n, min, max) => Math.min(max, Math.max(min, n));

function quatTrack(times, values) {
  return { times, values };
}

function buildBuffers() {
  // One box body, fully weighted to the Hips joint: enough to be a real skinned mesh.
  const positions = [
    -0.25, 0, -0.25, 0.25, 0, -0.25, 0.25, 0, 0.25, -0.25, 0, 0.25,
    -0.25, 2, -0.25, 0.25, 2, -0.25, 0.25, 2, 0.25, -0.25, 2, 0.25
  ];
  const indices = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7
  ];
  const joints = [];
  const weights = [];
  for (let i = 0; i < 8; i++) {
    joints.push(0, 0, 0, 0);
    weights.push(1, 0, 0, 0);
  }
  const inverseBind = [];
  for (const position of worldPositions) {
    // Column-major identity with the negated joint position as translation.
    inverseBind.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -position[0], -position[1], -position[2], 1);
  }
  return { positions, indices, joints, weights, inverseBind };
}

function pad4(n) { return (4 - (n % 4)) % 4; }

/** Build the GLB as a Buffer. */
export function buildRigGlb() {
  const { positions, indices, joints, weights, inverseBind } = buildBuffers();
  const chunks = [];
  let byteLength = 0;
  const push = (array, TypedArray) => {
    const typed = new TypedArray(array);
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = pad4(byteLength);
    if (pad) { chunks.push(Buffer.alloc(pad)); byteLength += pad; }
    const view = { byteOffset: byteLength, byteLength: bytes.length };
    chunks.push(bytes);
    byteLength += bytes.length;
    return view;
  };

  const viewPositions = push(positions, Float32Array);
  const viewIndices = push(indices, Uint16Array);
  const viewJoints = push(joints, Uint16Array);
  const viewWeights = push(weights, Float32Array);
  const viewIbm = push(inverseBind, Float32Array);

  const idleTimes = [0, 0.5, 1];
  const idleValues = [];
  const half = Math.sin(Math.PI / 8), cos = Math.cos(Math.PI / 8);
  for (const angle of [0, 0.35, 0]) {
    idleValues.push(Math.sin(angle / 2), 0, 0, Math.cos(angle / 2));
  }
  const idleHead = [];
  for (const angle of [0, 0.18, 0]) idleHead.push(0, Math.sin(angle / 2), 0, Math.cos(angle / 2));
  const viewIdleTimes = push(idleTimes, Float32Array);
  const viewIdleArm = push(idleValues, Float32Array);
  const viewIdleHead = push(idleHead, Float32Array);

  const punchTimes = [0, 0.22, 0.6];
  const punchValues = [];
  for (const angle of [0, 1.5, 0]) punchValues.push(Math.sin(angle / 2), 0, 0, Math.cos(angle / 2));
  const viewPunchTimes = push(punchTimes, Float32Array);
  const viewPunchArm = push(punchValues, Float32Array);

  const accessors = [
    { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-0.25, 0, -0.25], max: [0.25, 2, 0.25] },
    { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' },
    { bufferView: 2, componentType: 5123, count: 8, type: 'VEC4' },
    { bufferView: 3, componentType: 5126, count: 8, type: 'VEC4' },
    { bufferView: 4, componentType: 5126, count: JOINTS.length, type: 'MAT4' },
    { bufferView: 5, componentType: 5126, count: 3, type: 'SCALAR', min: [0], max: [1] },
    { bufferView: 6, componentType: 5126, count: 3, type: 'VEC4' },
    { bufferView: 7, componentType: 5126, count: 3, type: 'VEC4' },
    { bufferView: 8, componentType: 5126, count: 3, type: 'SCALAR', min: [0], max: [0.6] },
    { bufferView: 9, componentType: 5126, count: 3, type: 'VEC4' }
  ];
  const bufferViews = [
    viewPositions, viewIndices, viewJoints, viewWeights, viewIbm,
    viewIdleTimes, viewIdleArm, viewIdleHead, viewPunchTimes, viewPunchArm
  ].map(view => ({ buffer: 0, byteOffset: view.byteOffset, byteLength: view.byteLength }));

  const json = {
    asset: { version: '2.0', generator: 'Browser Smash rig fixture (original, MIT-licensed geometry)' },
    scene: 0,
    // The skin root is a scene node as well as the skinned body: a joint hierarchy that is not
    // reachable from the scene cannot be traversed or animated.
    scenes: [{ name: 'fixture', nodes: [0, JOINTS.length] }],
    nodes: [
      ...JOINTS.map((joint, index) => ({
        name: joint.name,
        translation: joint.t,
        ...(joint.parent >= 0 ? {} : {})
      })),
      { name: 'fixture-body', mesh: 0, skin: 0 }
    ],
    skins: [{ name: 'fixture-rig', joints: JOINTS.map((_, index) => index), inverseBindMatrices: 4, skeleton: 0 }],
    meshes: [{
      name: 'fixture-box',
      primitives: [{
        attributes: { POSITION: 0, JOINTS_0: 2, WEIGHTS_0: 3 },
        indices: 1,
        material: 0
      }]
    }],
    materials: [{ name: 'fixture-skin', pbrMetallicRoughness: { baseColorFactor: [0.72, 0.75, 0.8, 1], metallicFactor: 0.1, roughnessFactor: 0.7 } }],
    animations: [
      {
        name: 'Idle',
        samplers: [
          { input: 5, output: 6, interpolation: 'LINEAR' },
          { input: 5, output: 7, interpolation: 'LINEAR' }
        ],
        channels: [
          { sampler: 0, target: { node: 3, path: 'rotation' } },
          { sampler: 1, target: { node: 2, path: 'rotation' } }
        ]
      },
      {
        name: 'Punch',
        samplers: [{ input: 8, output: 9, interpolation: 'LINEAR' }],
        channels: [{ sampler: 0, target: { node: 5, path: 'rotation' } }]
      }
    ],
    accessors,
    bufferViews,
    buffers: [{ byteLength }]
  };
  // Children lists keep the bone hierarchy real rather than flat.
  for (let index = 0; index < JOINTS.length; index++) {
    const children = JOINTS.map((joint, child) => (joint.parent === index ? child : -1)).filter(child => child >= 0);
    if (children.length) json.nodes[index].children = children;
  }

  const bin = Buffer.concat(chunks);
  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = pad4(jsonBytes.length);
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = pad4(bin.length);
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad)]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // 'BIN'
  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]);
}

export const FIXTURE_PATH = 'public/models/characters/_fixture/rig-test.glb';
export const FIXTURE_JOINTS = JOINTS.length;

if (import.meta.url === `file://${process.argv[1]}`) {
  const glb = buildRigGlb();
  const target = resolve(FIXTURE_PATH);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, glb);
  console.log(`wrote ${FIXTURE_PATH} (${(glb.length / 1024).toFixed(1)} KiB, ${JOINTS.length} joints)`);
}
