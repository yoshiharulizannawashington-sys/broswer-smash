#!/usr/bin/env node
/**
 * Phase 22.3F — Wonder Woman shield ring correction.
 *
 * The authored shield has five parts. The three concentric "rings" are squashed icospheres
 * whose Z extent is larger than the rim slab they sit on, so each shell passes through both
 * faces of the rim. Opaque + depth-writing + double-sided means those intersections punch
 * holes through the shield face instead of blending: the shard pattern seen in game.
 *
 * This tool keeps every node, every material, every X/Y dimension, the boss, the rim and the
 * hand-grip offset untouched. It only re-authors the *depth* of the three ring shells so each
 * one rests on the rim's front face instead of piercing it:
 *
 *   - thickness shrinks to TARGET_THICKNESS (flatter emblem, same front-facing outline)
 *   - the back face rests on the rim's front face (no interpenetration, no air gap)
 *   - each ring gets a slightly different plane (no coplanar faces, so no z-fighting)
 *   - the front-most ring stays behind the boss dome, so total shield depth is unchanged
 *
 * The original file stays recoverable: `git checkout -- public/assets/character_weapons.glb`
 * restores the committed asset, and this script is idempotent (it recomputes from the rim and
 * the boss, so re-running it produces the same result).
 *
 * Usage: node scripts/fix-shield-rings.mjs [--apply]
 */
import { readFile, writeFile } from 'node:fs/promises';

const GLB = 'public/assets/character_weapons.glb';
const SHIELD_ROOT = 'weapon_wonder_woman_left';
const RING_NODES = ['Shield ring', 'Shield ring.001', 'Shield ring.002'];
const RIM_NODE = 'Shield rim';
const BOSS_NODE = 'Shield boss';

// Nested discs cannot avoid crossing each other in depth unless no two of them occupy the same
// depth range, so each ring is a shallow decal plate and each sits in its own slice.
const TARGET_THICKNESS = 0.005; // local units; the rim slab is ~0.08 thick
const BASE_GAP = 0.0005; // ring back rests on the rim front face: attached, never intersecting
const STACK_STEP = 0.007; // per-ring separation, inner rings slightly prouder
const BOSS_CLEARANCE = 0.002; // never exceed the boss dome's front, keeps total depth

const apply = process.argv.includes('--apply');

const buffer = await readFile(GLB);
if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
const chunks = [];
let offset = 12;
// A chunk header is 8 bytes (length + type); the 12-byte file header is only skipped once. Advancing
// by 12 per chunk silently shears 4 bytes off every chunk after the first, which truncates BIN and
// makes the whole library unloadable, so the walk is checked against the file length below.
while (offset + 8 <= buffer.length) {
  const length = buffer.readUInt32LE(offset);
  const type = buffer.readUInt32LE(offset + 4);
  chunks.push({ type, length, data: buffer.subarray(offset + 8, offset + 8 + length) });
  offset += 8 + length;
}
if (offset !== buffer.length) throw new Error(`GLB chunk table misparsed: ${buffer.length - offset} trailing bytes`);
if (buffer.readUInt32LE(8) !== buffer.length) throw new Error('GLB header length disagreees with the file size');
const jsonChunk = chunks.find((c) => c.type === 0x4e4f534a);
if (!jsonChunk) throw new Error('no JSON chunk');
const gltf = JSON.parse(jsonChunk.data.toString('utf8'));

const nodes = gltf.nodes || [];
const meshes = gltf.meshes || [];
const accessors = gltf.accessors || [];

/** Geometry-space Z extent of a node's mesh, taken from POSITION accessor bounds. */
function geometryZ(node) {
  const prims = meshes[node.mesh]?.primitives || [];
  let min = Infinity;
  let max = -Infinity;
  for (const prim of prims) {
    const acc = accessors[prim.attributes?.POSITION];
    if (!acc || !acc.min || !acc.max) throw new Error(`no POSITION bounds for ${node.name}`);
    min = Math.min(min, acc.min[2]);
    max = Math.max(max, acc.max[2]);
  }
  return { min, max, extent: max - min };
}

function depthOf(node, index) {
  const geom = geometryZ(node);
  const scaleZ = node.scale ? node.scale[2] : 1;
  const centre = node.translation ? node.translation[2] : 0;
  const back = centre + geom.min * scaleZ;
  const front = centre + geom.max * scaleZ;
  return { index, name: node.name, geom, scaleZ, centre, back, front, thickness: front - back };
}

const rootIndex = nodes.findIndex((n) => n.name === SHIELD_ROOT);
if (rootIndex < 0) throw new Error(`no ${SHIELD_ROOT} node`);
const children = nodes[rootIndex].children || [];
const byName = (name) => nodes.findIndex((n) => n.name === name);

const rim = depthOf(nodes[byName(RIM_NODE)], byName(RIM_NODE));
const boss = depthOf(nodes[byName(BOSS_NODE)], byName(BOSS_NODE));
const rings = RING_NODES.map((name) => depthOf(nodes[byName(name)], byName(name)));
if (!children.includes(byName(RIM_NODE))) throw new Error('rim is not a child of the shield root');

const fmt = (v) => v.toFixed(4);
const row = (d) =>
  `${d.name.padEnd(16)} back ${fmt(d.back)}  front ${fmt(d.front)}  thickness ${fmt(d.thickness)}  z-scale ${fmt(d.scaleZ)}  centre ${fmt(d.centre)}`;

console.log('Shield parts, geometry space (current):');
console.log(row(rim));
console.log(row(boss));
for (const r of rings) console.log(row(r));

const rimFront = rim.front;
const bossFront = boss.front;
const plan = [];
rings.forEach((ring, i) => {
  const wantedBack = rimFront + BASE_GAP + i * STACK_STEP;
  let thickness = TARGET_THICKNESS;
  if (wantedBack + thickness > bossFront - BOSS_CLEARANCE) {
    thickness = Math.max(0.002, bossFront - BOSS_CLEARANCE - wantedBack);
  }
  const scaleZ = thickness / ring.geom.extent;
  const centre = wantedBack - ring.geom.min * scaleZ;
  plan.push({ ring, wantedBack, thickness, scaleZ, centre,
    back: wantedBack, front: wantedBack + thickness });
});

console.log('\nPlanned correction (geometry space):');
console.log(`  rim front face          ${fmt(rimFront)}   rim thickness ${fmt(rim.thickness)}`);
console.log(`  boss front              ${fmt(bossFront)}   (unchanged)`);
for (const p of plan) {
  console.log(`  ${p.ring.name.padEnd(16)} back ${fmt(p.back)}  front ${fmt(p.front)}  thickness ${fmt(p.front - p.back)}  z-scale ${fmt(p.scaleZ)}  centre ${fmt(p.centre)}`);
}

// --- assertions: no interpenetration, rings still on the shield, total depth unchanged ---
const problems = [];
for (const p of plan) {
  if (p.back <= rimFront + 1e-6) problems.push(`${p.ring.name} still intersects the rim`);
  if (p.front > bossFront - BOSS_CLEARANCE + 1e-9) problems.push(`${p.ring.name} exceeds the boss front`);
  if (p.ring.geom.extent <= 0) problems.push(`${p.ring.name} has no geometry`);
}
for (let i = 0; i < plan.length; i += 1) {
  for (let j = i + 1; j < plan.length; j += 1) {
    if (Math.abs(plan[i].back - plan[j].back) < 1e-4) problems.push(`${plan[i].ring.name} and ${plan[j].ring.name} are coplanar`);
    // Overlapping depth ranges would let two nested shells cross each other again.
    if (plan[i].back < plan[j].front && plan[j].back < plan[i].front) problems.push(`${plan[i].ring.name} and ${plan[j].ring.name} still share a depth range`);
  }
}
if (problems.length) {
  console.error('\nRefusing to write:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

if (!apply) {
  console.log('\nDry run. Nothing written. Re-run with --apply.');
  process.exit(0);
}

for (const p of plan) {
  const node = nodes[p.ring.index];
  node.scale = [node.scale[0], node.scale[1], +p.scaleZ.toFixed(6)];
  node.translation = [node.translation[0], node.translation[1], +p.centre.toFixed(6)];
  const after = depthOf(node, p.ring.index);
  console.log(`  wrote ${after.name.padEnd(16)} back ${fmt(after.back)}  front ${fmt(after.front)}  thickness ${fmt(after.thickness)}`);
}

// Repack: JSON chunk padded with spaces, BIN chunk copied verbatim, header length fixed.
let jsonText = Buffer.from(JSON.stringify(gltf), 'utf8');
if (jsonText.length % 4 !== 0) {
  jsonText = Buffer.concat([jsonText, Buffer.alloc(4 - (jsonText.length % 4), 0x20)]);
}
const binChunk = chunks.find((c) => c.type !== 0x4e4f534a);
if (!binChunk) throw new Error('no BIN chunk: refusing to write a geometry-less file');
const newChunks = chunks.map((c) => (c.type === 0x4e4f534a ? { type: c.type, data: jsonText } : c));
const parts = [];
let total = 12;
for (const c of newChunks) {
  const head = Buffer.alloc(8);
  head.writeUInt32LE(c.data.length, 0);
  head.writeUInt32LE(c.type, 4);
  parts.push(head, c.data);
  total += 8 + c.data.length;
}
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(total, 8);
const out = Buffer.concat([header, ...parts]);
// Verify the container we are about to ship: BIN byte-for-byte, both chunks readable.
const checkOffset = 12 + 8 + jsonText.length;
const checkLen = out.readUInt32LE(checkOffset);
const checkType = out.readUInt32LE(checkOffset + 4);
if (checkLen !== binChunk.data.length) throw new Error(`BIN chunk length changed: ${binChunk.data.length} -> ${checkLen}`);
if (checkType !== binChunk.type) throw new Error('BIN chunk type changed');
for (let i = 0; i < binChunk.data.length; i += 1) {
  if (out[checkOffset + 8 + i] !== binChunk.data[i]) throw new Error(`BIN byte ${i} changed`);
}
await writeFile(GLB, out);
console.log(`\nWrote ${GLB} (${total} bytes). BIN chunk verified byte-for-byte; nodes, meshes and materials untouched.`);
