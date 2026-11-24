#!/usr/bin/env node
// Static acceptance for merging Iron Spider's animation library onto Miles Morales.
//
// The runtime body is a copy of the promoted Miles GLB with only its animation list extended.
// This gate proves that the mesh/skin/node/material payload and all 26 original clips are
// unchanged, then checks that all 57 donor clips are present under the `IronSpider__` prefix,
// target the 19 canonical Miles joints and bind no missing node.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(process.cwd());
const backupPath = resolve(root, 'public/models/characters/imported/miles_morales/backup/miles_morales_pre_iron_spider_20261113.glb');
const bodyPath = resolve(root, 'public/models/characters/imported/miles_morales/miles_morales_animated.glb');
const donorPath = resolve(root, 'public/models/characters/iron_spider/iron_spider_source_animated.glb');
const outPath = resolve(root, 'artifacts/miles/iron-spider-animation-merge/verification.json');
const PREFIX = 'IronSpider__';
const ORIGINAL_CLIP_COUNT = 26;
const DONOR_CLIP_COUNT = 57;

function parseGlb(path) {
  const bytes = readFileSync(path);
  if (bytes.toString('ascii', 0, 4) !== 'glTF') throw new Error(`${path}: not a GLB`);
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
  if (!json) throw new Error(`${path}: no JSON chunk`);
  return { bytes, json, bin: Buffer.concat(bins) };
}
const stable = value => JSON.stringify(value);
const same = (a, b) => stable(a) === stable(b);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const targetNames = new Set([
  'pelvis_173_11',
  'thigh_l_155_155', 'calf_l_151_156', 'foot_l_144_157',
  'thigh_r_168_168', 'calf_r_164_169', 'foot_r_157_170',
  'spine_01_142_12', 'spine_02_141_13',
  'clavicle_l_81_56', 'upperarm_l_80_57', 'lowerarm_l_69_58', 'hand_l_62_59',
  'neck_01_36_19', 'head_34_21',
  'clavicle_r_124_99', 'upperarm_r_123_100', 'lowerarm_r_112_101', 'hand_r_105_102'
]);

const checks = [];
function check(name, ok, detail = null) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + JSON.stringify(detail) : ''}`);
}

let backup, body, donor;
try {
  backup = parseGlb(backupPath);
  body = parseGlb(bodyPath);
  donor = parseGlb(donorPath);
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}

const originalAnimations = backup.json.animations || [];
const mergedAnimations = body.json.animations || [];
const donorAnimations = donor.json.animations || [];
const originalNames = originalAnimations.map(animation => animation.name);
const mergedNames = mergedAnimations.map(animation => animation.name);
const addedNames = mergedNames.slice(ORIGINAL_CLIP_COUNT);
const addedSet = new Set(addedNames);
const donorNames = donorAnimations.map(animation => animation.name);

check('the Miles backup retains its original 26 clips', originalAnimations.length === ORIGINAL_CLIP_COUNT, { clips: originalAnimations.length });
check('the merged Miles body carries 26 original + 57 Iron Spider clips', mergedAnimations.length === ORIGINAL_CLIP_COUNT + DONOR_CLIP_COUNT, { clips: mergedAnimations.length });
check('all original Miles clip names are preserved at the front of the animation list', same(originalNames, mergedNames.slice(0, ORIGINAL_CLIP_COUNT)), { missing: originalNames.filter(name => !mergedNames.includes(name)) });
check('all original Miles clip JSON payloads are byte-for-byte unchanged', originalAnimations.every((animation, index) => same(animation, mergedAnimations[index])), { changed: originalAnimations.filter((animation, index) => !same(animation, mergedAnimations[index])).map(animation => animation.name) });
check('every donor clip was added exactly once under the Iron Spider prefix', donorAnimations.every(animation => addedSet.has(PREFIX + animation.name)) && addedNames.length === donorAnimations.length, { donor: donorAnimations.length, added: addedNames.length });
check('all added clip names are unique', new Set(mergedNames).size === mergedNames.length, { unique: new Set(mergedNames).size, total: mergedNames.length });
check('every added clip keeps the 19 canonical Miles joints plus pelvis translation', mergedAnimations.slice(ORIGINAL_CLIP_COUNT).every(animation => {
  const names = new Set(animation.channels.map(channel => body.json.nodes[channel.target.node]?.name).filter(Boolean));
  return names.size === 19 && [...targetNames].every(name => names.has(name));
}), { expected: targetNames.size });
check('no added clip targets a missing node', mergedAnimations.slice(ORIGINAL_CLIP_COUNT).every(animation => animation.channels.every(channel => body.json.nodes[channel.target.node])));
check('the donor still has its 57 source clips', donorAnimations.length === DONOR_CLIP_COUNT, { clips: donorAnimations.length });

const modelSections = ['asset', 'scene', 'scenes', 'nodes', 'meshes', 'skins', 'materials', 'textures', 'images', 'samplers'];
const changedModelSections = modelSections.filter(section => !same(backup.json[section], body.json[section]));
check('the exact model payload is unchanged (nodes, meshes, skins, materials, textures, images)', changedModelSections.length === 0, { changed: changedModelSections });
check('the original accessors and buffer views are unchanged in place', same(backup.json.accessors, body.json.accessors?.slice(0, backup.json.accessors?.length)) && same(backup.json.bufferViews, body.json.bufferViews?.slice(0, backup.json.bufferViews?.length)), {
  accessors: { before: backup.json.accessors?.length, now: body.json.accessors?.length },
  bufferViews: { before: backup.json.bufferViews?.length, now: body.json.bufferViews?.length }
});
check('the original binary payload is an exact prefix of the merged binary payload', backup.bin.equals(body.bin.subarray(0, backup.bin.length)), {
  before: backup.bin.length, after: body.bin.length
});
check('the body still has the original 3 skinned meshes, 178 bones and 14,356 triangles', body.json.meshes?.length === 3 && body.json.skins?.[0]?.joints?.length === 178, {
  meshes: body.json.meshes?.length, joints: body.json.skins?.[0]?.joints?.length
});

const report = {
  generatedAt: new Date().toISOString(),
  backup: { path: backupPath.slice(root.length + 1), bytes: statSync(backupPath).size, sha256: sha256(backup.bytes) },
  body: { path: bodyPath.slice(root.length + 1), bytes: statSync(bodyPath).size, sha256: sha256(body.bytes) },
  donor: { path: donorPath.slice(root.length + 1), bytes: statSync(donorPath).size, sha256: sha256(donor.bytes) },
  clips: {
    original: originalAnimations.length,
    added: addedNames.length,
    total: mergedAnimations.length,
    addedPrefix: PREFIX,
    originalNames,
    addedNames
  },
  model: { sections: modelSections, changed: changedModelSections, joints: body.json.skins?.[0]?.joints?.length, meshes: body.json.meshes?.length },
  checks,
  passed: checks.filter(entry => entry.ok).length,
  total: checks.length
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`\n${report.passed}/${report.total} checks passed`);
console.log(outPath);
if (report.passed !== report.total) process.exit(1);
