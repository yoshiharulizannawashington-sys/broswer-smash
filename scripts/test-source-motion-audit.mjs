#!/usr/bin/env node
// Regression tests for scripts/audit-source-motion.mjs.
//
// Builds tiny self-authored glTF/GLB fixtures in a temporary directory: a genuinely moving clip,
// a one-key pose, a multi-key constant track, root-only motion, a cubic-spline clip, an empty
// animation and a broken target. No production model is required, and nothing is written into
// the repository.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { auditSourceMotionFile, auditSourceMotionPaths } from './audit-source-motion.mjs';

let checks = 0;
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ` — ${detail}` : ''}`);
  checks++;
  console.log(`  ok  ${name}${detail ? ` — ${detail}` : ''}`);
}

const align4 = n => (4 - (n % 4)) % 4;

function buildFixture() {
  const bufferViews = [];
  const accessors = [];
  let bin = Buffer.alloc(0);
  const addAccessor = (values, type) => {
    const width = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type];
    const bytes = Buffer.from(new Float32Array(values).buffer);
    const padding = align4(bin.length);
    if (padding) bin = Buffer.concat([bin, Buffer.alloc(padding)]);
    const view = { buffer: 0, byteOffset: bin.length, byteLength: bytes.length };
    bufferViews.push(view);
    bin = Buffer.concat([bin, bytes]);
    const accessor = {
      bufferView: bufferViews.length - 1,
      componentType: 5126,
      count: values.length / width,
      type
    };
    accessors.push(accessor);
    return accessors.length - 1;
  };

  const times = addAccessor([0, 0.5, 1], 'SCALAR');
  const oneTime = addAccessor([0], 'SCALAR');
  const movingRotation = addAccessor([
    0, 0, 0, 1,
    0.3826834, 0, 0, 0.9238795,
    0, 0, 0, 1
  ], 'VEC4');
  const oneRotation = addAccessor([0, 0, 0, 1], 'VEC4');
  const constantTranslation = addAccessor([
    0, 0, 0,
    0, 0, 0,
    0, 0, 0
  ], 'VEC3');
  const rootRotation = addAccessor([
    0, 0, 0, 1,
    0.7071068, 0, 0, 0.7071068,
    0.3826834, 0, 0, 0.9238795
  ], 'VEC4');
  // CUBICSPLINE stores an in-tangent, the value and an out-tangent for every key.
  const cubicRotation = addAccessor([
    0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0,
    0, 0, 0, 0, 0.3826834, 0, 0, 0.9238795, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0
  ], 'VEC4');

  const node = (name, extra = {}) => ({ name, ...extra });
  const document = {
    asset: { version: '2.0', generator: 'source-motion-audit test fixture' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      node('rig-root', { children: [1] }),
      node('hips')
    ],
    // The root is intentionally outside the skin: RootOnly is therefore not skeleton motion.
    skins: [{ name: 'test-skin', joints: [1] }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
    animations: [
      {
        name: 'Moving',
        samplers: [{ input: times, output: movingRotation }],
        channels: [{ sampler: 0, target: { node: 1, path: 'rotation' } }]
      },
      {
        name: 'OneKey',
        samplers: [{ input: oneTime, output: oneRotation }],
        channels: [{ sampler: 0, target: { node: 1, path: 'rotation' } }]
      },
      {
        name: 'Constant',
        samplers: [{ input: times, output: constantTranslation }],
        channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }]
      },
      {
        name: 'RootOnly',
        samplers: [{ input: times, output: rootRotation }],
        channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }]
      },
      {
        name: 'Cubic',
        samplers: [{ input: times, output: cubicRotation, interpolation: 'CUBICSPLINE' }],
        channels: [{ sampler: 0, target: { node: 1, path: 'rotation' } }]
      },
      { name: 'Empty', samplers: [], channels: [] },
      {
        name: 'MissingTarget',
        samplers: [{ input: times, output: movingRotation }],
        channels: [{ sampler: 0, target: { node: 99, path: 'rotation' } }]
      }
    ]
  };
  return { document, bin };
}

function glb(document, bin) {
  const json = Buffer.from(JSON.stringify(document), 'utf8');
  const paddedJson = Buffer.concat([json, Buffer.alloc(align4(json.length), 0x20)]);
  const paddedBin = Buffer.concat([bin, Buffer.alloc(align4(bin.length))]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + paddedJson.length + 8 + paddedBin.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(paddedJson.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(paddedBin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, paddedJson, binHeader, paddedBin]);
}

const dir = mkdtempSync(join(tmpdir(), 'source-motion-audit-'));
try {
  const fixture = buildFixture();
  const mixedGlb = join(dir, 'mixed.glb');
  writeFileSync(mixedGlb, glb(fixture.document, fixture.bin));

  console.log('\n[all clip classifications]');
  const report = auditSourceMotionFile(mixedGlb);
  const clips = new Map(report.clips.map(clip => [clip.name, clip]));
  check('the audit reads all seven clips', report.clipCount === 7, String(report.clipCount));
  check('a changing rotation is moving', clips.get('Moving')?.status === 'moving',
    JSON.stringify(clips.get('Moving')));
  check('a cubic-spline value is sampled at its central key', clips.get('Cubic')?.status === 'moving',
    JSON.stringify(clips.get('Cubic')));
  check('a one-key pose is static even though its channel exists', clips.get('OneKey')?.status === 'static',
    JSON.stringify(clips.get('OneKey')));
  check('a multi-key constant track is static', clips.get('Constant')?.status === 'static',
    JSON.stringify(clips.get('Constant')));
  check('motion on a non-joint root is skeleton-hollow', clips.get('RootOnly')?.status === 'skeleton-hollow',
    JSON.stringify(clips.get('RootOnly')));
  check('a named animation with no channels is empty', clips.get('Empty')?.status === 'empty',
    JSON.stringify(clips.get('Empty')));
  check('a missing target node is invalid', clips.get('MissingTarget')?.status === 'invalid',
    JSON.stringify(clips.get('MissingTarget')));
  check('the mixed fixture fails as a whole', report.ok === false);
  check('the summary counts every failure class',
    report.summary.moving === 2 && report.summary.static === 2
      && report.summary.empty === 1 && report.summary.skeletonHollow === 1
      && report.summary.invalid === 1,
    JSON.stringify(report.summary));
  check('moving joint motion is distinguished from non-joint motion',
    clips.get('Moving').movingJointChannels === 1 && clips.get('RootOnly').movingJointChannels === 0,
    JSON.stringify({ moving: clips.get('Moving').movingJointChannels, root: clips.get('RootOnly').movingJointChannels }));

  console.log('\n[a clean model passes]');
  const clean = buildFixture();
  clean.document.animations = clean.document.animations.filter(animation => animation.name === 'Moving');
  const cleanGlb = join(dir, 'clean.glb');
  writeFileSync(cleanGlb, glb(clean.document, clean.bin));
  const cleanReport = auditSourceMotionFile(cleanGlb);
  check('a model with real motion passes', cleanReport.ok === true && cleanReport.summary.moving === 1,
    JSON.stringify(cleanReport.summary));

  console.log('\n[explicit static waivers]');
  const staticOnly = buildFixture();
  staticOnly.document.animations = staticOnly.document.animations.filter(animation => animation.name === 'OneKey');
  const staticGlb = join(dir, 'static.glb');
  writeFileSync(staticGlb, glb(staticOnly.document, staticOnly.bin));
  check('a documented static pose fails without a waiver', auditSourceMotionFile(staticGlb).ok === false);
  const waived = auditSourceMotionFile(staticGlb, { allowStatic: ['OneKey'] });
  check('the exact clip name can be explicitly waived', waived.ok === true && waived.clips[0].waived === true,
    JSON.stringify(waived.clips[0]));
  const wrongWaiver = auditSourceMotionFile(staticGlb, { allowStatic: ['OneKeyTypo'] });
  check('a typo does not waive a static clip', wrongWaiver.ok === false);

  console.log('\n[external glTF buffer]');
  const gltfDir = join(dir, 'gltf');
  mkdirSync(gltfDir);
  const gltf = JSON.parse(JSON.stringify(clean.document));
  gltf.buffers = [{ uri: 'clean.bin', byteLength: clean.bin.length }];
  writeFileSync(join(gltfDir, 'clean.bin'), clean.bin);
  writeFileSync(join(gltfDir, 'clean.gltf'), JSON.stringify(gltf));
  const gltfReport = auditSourceMotionFile(join(gltfDir, 'clean.gltf'));
  check('external .gltf buffers are read relative to the model',
    gltfReport.ok === true && gltfReport.format === 'gltf' && gltfReport.summary.moving === 1,
    JSON.stringify({ ok: gltfReport.ok, format: gltfReport.format, summary: gltfReport.summary, error: gltfReport.error }));

  console.log('\n[path summary]');
  const pathsReport = auditSourceMotionPaths([dir]);
  check('directory audits aggregate file and clip totals',
    pathsReport.totals.files === 4 && pathsReport.totals.clips === 10,
    JSON.stringify(pathsReport.totals));
  check('the path report exposes failures with clip names',
    pathsReport.failures.some(failure => failure.clip === 'MissingTarget' && failure.status === 'invalid'),
    JSON.stringify(pathsReport.failures.slice(0, 3)));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${checks} checks passed`);
