#!/usr/bin/env node
// Professional character ingestion: turn a third-party rigged character into a Browser Smash body.
//
// This is the "Blender as preparation studio" half of the pipeline. It deliberately does NOT
// generate geometry: it takes a model somebody else authored, applies a declared mapping, and
// proves the result satisfies the same contract the game's own fighters do.
//
// Everything it changes lives in the GLB's JSON chunk (node names, animation names, one extra root
// node for scale/ground). The binary chunk is copied byte for byte, so skin weights, UVs and
// textures survive untouched and nothing has to be re-exported or re-baked.
//
//   node scripts/ingest-character.mjs --profile assets/ingest/<name>.json
//   node scripts/ingest-character.mjs --profile ... --dry-run
//
// Licence metadata is OPTIONAL and informational. It is recorded when supplied (inside the GLB
// and in the .provenance.json sidecar) and it NEVER decides whether a model can be ingested.
// Only technical facts gate this pipeline: a parseable GLB, a resolvable rig, the seven game
// states, correct scale and grounded feet. Which characters get built is the project owner's
// decision, not a property of a metadata string.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import './glb-node-compat.mjs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { resolveRig, CANONICAL_BONES } from '../public/js/anim/rig_map.js';

const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const dryRun = args.includes('--dry-run');

const profilePath = arg('profile', 'assets/ingest/quaternius-base-character.json');
const profile = JSON.parse(readFileSync(resolve(profilePath), 'utf8'));

const fail = message => {
  console.error(`INGEST FAILED: ${message}`);
  process.exit(1);
};

// ---------------------------------------------------------------- profile gate
const required = ['id', 'source', 'clipMap', 'boneMap'];
for (const key of required) if (!profile[key]) fail(`profile is missing "${key}"`);
for (const key of ['clipMap', 'boneMap']) {
  if (typeof profile[key] !== 'object' || Object.keys(profile[key]).length === 0) fail(`profile.${key} is empty`);
}
// Informational only. Missing licence/provenance fields are recorded as absent, never rejected.
const provenance = profile.provenance || {};

const GAME_STATES = ['Idle', 'Walk', 'Run', 'Jump', 'Punch', 'Kick', 'Kamehameha'];
const missingStates = GAME_STATES.filter(state => !profile.clipMap[state]);
if (missingStates.length) fail(`clipMap does not cover ${missingStates.join(', ')}`);

const srcPath = resolve(profile.source);
if (!existsSync(srcPath)) fail(`source model not found: ${srcPath}`);
const outPath = resolve(profile.output);
const bytes = readFileSync(srcPath);

// ---------------------------------------------------------------- GLB container
function splitGlb(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67) fail('source is not a GLB (magic != glTF)');
  if (buffer.readUInt32LE(4) !== 2) fail('source is not glTF 2.0');
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== 0x4e4f534a) fail('first chunk is not JSON');
  const json = JSON.parse(buffer.slice(20, 20 + jsonLength).toString('utf8'));
  const binStart = 20 + jsonLength;
  const binLength = buffer.readUInt32LE(binStart);
  const binType = buffer.readUInt32LE(binStart + 4);
  const bin = binType === 0x004e4942 ? buffer.slice(binStart + 8, binStart + 8 + binLength) : null;
  return { json, bin };
}

function joinGlb(json, bin) {
  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
  const chunks = [Buffer.alloc(12), Buffer.alloc(8), jsonChunk];
  if (bin) {
    const binPad = (4 - (bin.length % 4)) % 4;
    chunks.push(Buffer.alloc(8), bin, Buffer.alloc(binPad, 0));
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  chunks[0].writeUInt32LE(0x46546c67, 0);
  chunks[0].writeUInt32LE(2, 4);
  chunks[0].writeUInt32LE(total, 8);
  chunks[1].writeUInt32LE(jsonChunk.length, 0);
  chunks[1].writeUInt32LE(0x4e4f534a, 4);
  if (bin) {
    const binHeader = chunks[3];
    binHeader.writeUInt32LE(bin.length + ((4 - (bin.length % 4)) % 4), 0);
    binHeader.writeUInt32LE(0x004e4942, 4);
  }
  return Buffer.concat(chunks);
}

const { json, bin } = splitGlb(bytes);
const nodes = json.nodes || [];
const nameOf = index => nodes[index]?.name || '';

async function loadScene(buffer) {
  return new Promise((ok, bad) => {
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    new GLTFLoader().parse(arrayBuffer, '', ok, error => bad(new Error(String(error?.message || error))));
  });
}

const before = await loadScene(bytes);
before.scene.updateMatrixWorld(true);
const boxBefore = new THREE.Box3().setFromObject(before.scene);
const sizeBefore = boxBefore.getSize(new THREE.Vector3());
const rigBefore = resolveRig(before.scene);

// ---------------------------------------------------------------- remap names
const unmappedBones = [];
let renamedBones = 0;
// Exporter dialects differ on punctuation: Rigify writes DEF-upper_arm.L where a hand-written map
// says DEF-upper_armL, and Mixamo writes mixamorig:LeftArm. Comparing on a stripped-down key means
// one profile covers those spellings, instead of silently mapping three bones and shipping the rest
// unbound (which is exactly what the first run did).
const boneKey = name => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const boneLookup = new Map();
for (const [source, target] of Object.entries(profile.boneMap)) {
  const key = boneKey(source);
  if (boneLookup.has(key)) fail(`boneMap declares "${source}" twice after normalisation`);
  boneLookup.set(key, target);
}
for (const node of nodes) {
  const target = boneLookup.get(boneKey(node.name));
  if (!target || node.name === target) continue;
  node.name = target;
  renamedBones++;
}
// Every canonical slot must now be present, or the rig gate below has nothing to bind.
const presentNames = new Set(nodes.map(node => node.name));
const missingCanonical = CANONICAL_BONES.filter(bone => !presentNames.has(bone));
if (missingCanonical.length) unmappedBones.push(...missingCanonical);

// ---------------------------------------------------------------- remap clips
const animations = json.animations || [];
// The profile maps GAME STATE -> source clip; the export needs the reverse lookup.
const statesForSource = new Map();
for (const [state, sourceClip] of Object.entries(profile.clipMap)) {
  const list = statesForSource.get(sourceClip) || [];
  list.push(state);
  statesForSource.set(sourceClip, list);
}
const kept = [];
const usedStates = new Set();
for (const animation of animations) {
  const states = statesForSource.get(animation.name) || [];
  // One source clip can serve several game states when a model ships fewer than seven clips. Each
  // state gets its own animation entry sharing the same samplers, so the mixer can bind both names.
  // The profile's clipNotes already record that this is a substitution, never a real match.
  for (const state of states) {
    if (usedStates.has(state)) fail(`clipMap maps two source clips onto "${state}"`);
    usedStates.add(state);
    kept.push(state === animation.name ? animation : { ...animation, name: state });
  }
}
const missingClips = GAME_STATES.filter(state => !usedStates.has(state));
if (missingClips.length) {
  const available = animations.map(animation => animation.name).join(', ');
  fail(`no source clip mapped for ${missingClips.join(', ')}. Available: ${available}`);
}
// Only the mapped clips survive: unmapped ones would be bound by the loader's substring match and
// could shadow a state (for example "Pistol_Aim" winning "idle" via "Idle_Torch").
json.animations = kept;

// ---------------------------------------------------------------- scale + ground
const targetHeight = Number(profile.targetHeight) || 1.78;
const measured = sizeBefore.y;
const scale = measured > 0.01 ? targetHeight / measured : 1;
// Feet go to y=0 after scaling. The body is parented to a single wrapper node so the source's own
// root transform survives untouched.
const liftY = -boxBefore.min.y * scale;
json.nodes = nodes;
const existingRoots = (json.scenes?.[json.scene ?? 0]?.nodes) || [];
if (existingRoots.length === 0) fail('source scene has no root nodes');
const wrapper = {
  name: 'ingest_root',
  scale: [scale, scale, scale],
  translation: [0, +liftY.toFixed(6), 0],
  children: existingRoots
};
const wrapperIndex = json.nodes.push(wrapper) - 1;
json.scenes = json.scenes || [{ nodes: [] }];
json.scenes[json.scene ?? 0] = { ...(json.scenes[json.scene ?? 0] || {}), nodes: [wrapperIndex] };

// ---------------------------------------------------------------- provenance in the file
json.asset = {
  ...(json.asset || {}),
  // Only written when the profile supplied something to write; no placeholder is invented.
  ...(profile.creator || profile.license
    ? { copyright: [profile.creator, profile.license].filter(Boolean).join(' — ') }
    : {}),
  extras: {
    ...(json.asset?.extras || {}),
    browserBrosIngest: {
      id: profile.id,
      ...(profile.creator ? { creator: profile.creator } : {}),
      ...(profile.license ? { license: profile.license } : {}),
      ...(provenance.sourceUrl ? { sourceUrl: provenance.sourceUrl } : {}),
      ...(provenance.licenseUrl ? { licenseUrl: provenance.licenseUrl } : {}),
      attribution: provenance.attribution || '',
      ingestedAt: new Date().toISOString().slice(0, 10),
      notes: provenance.notes || ''
    }
  }
};

const outBytes = joinGlb(json, bin);
const report = {
  profile: profilePath,
  id: profile.id,
  creator: profile.creator || null,
  license: profile.license || null,
  source: srcPath,
  output: outPath,
  scale: +scale.toFixed(4),
  liftY: +liftY.toFixed(4),
  renamedBones,
  bonesTotal: nodes.length,
  clipsIn: animations.length,
  clipsOut: kept.map(animation => animation.name),
  sourceHeight: +measured.toFixed(3),
  targetHeight,
  rigBefore: { bound: rigBefore?.boundCount ?? 0, missing: (rigBefore?.missing || []).length },
  sourceBytes: statSync(srcPath).size,
  outputBytes: outBytes.length
};

// ---------------------------------------------------------------- verify the export
const after = await loadScene(outBytes);
after.scene.updateMatrixWorld(true);
const boxAfter = new THREE.Box3().setFromObject(after.scene);
const rigAfter = resolveRig(after.scene);
const afterClips = (after.animations || []).map(clip => clip.name);
const problems = [];
if (!rigAfter || rigAfter.kind !== 'bone') problems.push('no bone rig resolved');
else if ((rigAfter.missing || []).length) problems.push(`canonical bones still unbound: ${rigAfter.missing.join(', ')}`);
if (Math.abs(boxAfter.min.y) > 0.02) problems.push(`feet sit ${boxAfter.min.y.toFixed(3)} m off the floor after ingest`);
if (Math.abs(boxAfter.getSize(new THREE.Vector3()).y - targetHeight) > 0.02) {
  problems.push(`height is ${boxAfter.getSize(new THREE.Vector3()).y.toFixed(3)} m, expected ${targetHeight}`);
}
for (const state of GAME_STATES) if (!afterClips.includes(state)) problems.push(`clip "${state}" missing from the export`);
if (after.animations.length !== GAME_STATES.length) problems.push(`${after.animations.length} clips exported, expected ${GAME_STATES.length}`);

report.verify = {
  height: +boxAfter.getSize(new THREE.Vector3()).y.toFixed(3),
  feetY: +boxAfter.min.y.toFixed(3),
  bonesBound: rigAfter?.boundCount ?? 0,
  clips: afterClips,
  problems
};

mkdirSync(dirname(outPath), { recursive: true });
if (!dryRun) writeFileSync(outPath, outBytes);
// The provenance sidecar is written next to the model so the licence travels with the asset.
if (!dryRun) {
  writeFileSync(outPath.replace(/\.glb$/i, '.provenance.json'), JSON.stringify({
    id: profile.id,
    // Optional metadata travels with the asset when it exists; absent fields are simply absent.
    ...(profile.creator ? { creator: profile.creator } : {}),
    ...(profile.license ? { license: profile.license } : {}),
    ...(provenance.sourceUrl ? { sourceUrl: provenance.sourceUrl } : {}),
    ...(provenance.licenseUrl ? { licenseUrl: provenance.licenseUrl } : {}),
    attribution: provenance.attribution || '', notes: provenance.notes || '',
    originalFile: profile.source, output: profile.output, scale: report.scale,
    clips: report.clipsOut, ingestedAt: new Date().toISOString()
  }, null, 2) + '\n');
}

console.log(JSON.stringify({ ...report, dryRun }, null, 1));
if (problems.length) {
  console.error(`\nINGEST GATE FAILED (${problems.length}):\n  · ${problems.join('\n  · ')}`);
  process.exit(1);
}
console.log('\nINGEST GATE PASSED: rig bound, feet grounded, all seven states present.');
