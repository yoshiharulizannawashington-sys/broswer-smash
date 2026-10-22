#!/usr/bin/env node
// Inspect an animation GLB and optionally install it as a runtime clip pack.
//
// Reads the GLB container directly (no Three.js, no DOM) so it works in CI and on a Chromebook.
// It reports the clips, their durations, the skeleton and which library ids the clips can
// satisfy, then can write the pack into public/models/animations/ and enable it in the manifest.
//
//   node scripts/inspect-animation-pack.mjs download.glb
//   node scripts/inspect-animation-pack.mjs download.glb --pack sketchfab-karate-boy --install
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '..');
const manifestPath = path.join(rootDir, 'public/data/animation-manifest.json');
const packDir = path.join(rootDir, 'public/models/animations');

const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Parse the JSON chunk of a binary glTF container. */
function readGlbJson(buffer) {
  const magic = buffer.readUInt32LE(0);
  if (magic !== 0x46546c67) throw new Error('not a GLB file (bad magic)');
  const version = buffer.readUInt32LE(4);
  const totalLength = buffer.readUInt32LE(8);
  let offset = 12;
  while (offset < Math.min(totalLength, buffer.length)) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (chunkType === 0x4e4f534a) {
      return {
        version,
        json: JSON.parse(buffer.slice(start, start + chunkLength).toString('utf8'))
      };
    }
    offset = start + chunkLength + ((4 - (chunkLength % 4)) % 4);
  }
  throw new Error('GLB has no JSON chunk');
}

function clipDurations(json) {
  const out = new Map();
  for (const [index, animation] of (json.animations || []).entries()) {
    let max = 0;
    for (const sampler of animation.samplers || []) {
      const accessor = json.accessors?.[sampler.input];
      if (accessor?.max?.length) max = Math.max(max, accessor.max[0]);
    }
    out.set(animation.name || `clip_${index}`, Number(max.toFixed(3)));
  }
  return out;
}

function classifyBone(rawName) {
  const raw = String(rawName || '').toLowerCase().replace(/^mixamorig:?/, '').replace(/[._:\-\s]/g, '');
  if (!raw) return null;
  const suffix = /[._\-]\s*([lr])$/i.exec(String(rawName))?.[1]?.toLowerCase();
  const side = raw.includes('left') ? 'left' : raw.includes('right') ? 'right'
    : suffix === 'l' ? 'left' : suffix === 'r' ? 'right' : null;
  if (!side) return null;
  if (/hand|wrist|palm|finger|thumb|index/.test(raw)) return side + 'Hand';
  if (/forearm|lowerarm|elbow/.test(raw)) return side + 'Fore';
  if (/shoulder|clavicle|upperarm|arm/.test(raw)) return side + 'Arm';
  if (/upleg|thigh|upperleg/.test(raw)) return side + 'Leg';
  if (/shin|calf|lowerleg|knee|leg/.test(raw)) return side + 'Shin';
  return null;
}

function mapClips(json, manifest, packId) {
  const names = (json.animations || []).map((a, i) => a.name || `clip_${i}`);
  const pool = names.map(name => ({ name, key: normalize(name) }));
  const wanted = {};
  for (const clip of manifest.clips || []) {
    wanted[clip.id] = [clip.id, ...(clip.mixamo || [])];
  }
  const packHint = (manifest.packs || []).find(p => p.id === packId)?.clips;
  const mapping = {};
  for (const [clipId, candidates] of Object.entries(packHint && Object.keys(packHint).length ? packHint : wanted)) {
    const list = Array.isArray(candidates) ? candidates : [candidates];
    let hit = null;
    for (const candidate of list) {
      const key = normalize(candidate);
      hit = pool.find(entry => entry.key === key);
      if (hit) break;
    }
    if (!hit) {
      for (const candidate of list) {
        const key = normalize(candidate);
        if (key.length < 3) continue;
        hit = pool.find(entry => entry.key.includes(key));
        if (hit) break;
      }
    }
    if (hit) mapping[clipId] = [hit.name];
  }
  return { mapping, names };
}

const args = process.argv.slice(2);
const fileArg = args.find(a => !a.startsWith('--'));
const packFlag = args.indexOf('--pack');
const packId = packFlag >= 0 ? args[packFlag + 1] : null;
const install = args.includes('--install');

if (!fileArg) {
  console.error('usage: node scripts/inspect-animation-pack.mjs <file.glb> [--pack <id>] [--install]');
  process.exit(2);
}

const filePath = path.resolve(process.cwd(), fileArg);
if (!existsSync(filePath)) {
  console.error(`missing file: ${filePath}`);
  process.exit(2);
}

const buffer = await readFile(filePath);
const { json, version } = readGlbJson(buffer);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const durations = clipDurations(json);
const nodes = json.nodes || [];
const bones = nodes.map(n => n.name).filter(n => classifyBone(n));
const skinned = (json.skins || []).length;
const { mapping, names } = mapClips(json, manifest, packId);

console.log('');
console.log('ANIMATION PACK INSPECTION');
console.log(`  file          ${path.relative(rootDir, filePath)} (${(buffer.length / 1048576).toFixed(2)} MB, glTF ${version})`);
console.log(`  meshes        ${(json.meshes || []).length}`);
console.log(`  skins         ${skinned} (${(json.skins || []).reduce((n, s) => n + (s.joints || []).length, 0)} joints)`);
console.log(`  bones matched ${bones.length}`);
if (bones.length) console.log(`                ${[...new Set(bones.map(classifyBone))].join(', ')}`);
console.log(`  animations    ${names.length}`);
for (const name of names) console.log(`                - ${name} (${durations.get(name) ?? '?'}s)`);
console.log(`  library ids   ${Object.keys(mapping).length} of ${(manifest.clips || []).length} mapped`);
for (const [clipId, [source]] of Object.entries(mapping)) console.log(`                ${clipId} <- ${source}`);

if (!names.length) {
  console.log('');
  console.log('  This GLB contains no animation clips. Sketchfab downloads often ship the mesh only;');
  console.log('  the animation has to be exported separately (glTF with animations) or taken from Mixamo.');
  process.exit(1);
}
if (!bones.length) {
  console.log('');
  console.log('  No humanoid bones were recognised, so clips from this file cannot be retargeted.');
  process.exit(1);
}

if (install) {
  if (!packId) {
    console.error('\n--install needs --pack <id> (an existing pack id in data/animation-manifest.json)');
    process.exit(2);
  }
  await mkdir(packDir, { recursive: true });
  const target = path.join(packDir, `${packId}.glb`);
  await copyFile(filePath, target);
  const pack = (manifest.packs || []).find(p => p.id === packId);
  if (!pack) {
    console.error(`\nno pack "${packId}" in the manifest; add one first`);
    process.exit(2);
  }
  pack.file = `/models/animations/${packId}.glb`;
  pack.enabled = true;
  pack.status = 'installed';
  pack.clips = mapping;
  pack.installedClips = names;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\ninstalled -> ${path.relative(rootDir, target)}`);
  console.log(`enabled pack "${packId}" with ${Object.keys(mapping).length} mapped clips`);
} else {
  console.log('');
  console.log('  Nothing was changed. Re-run with --pack <id> --install to enable it.');
}
