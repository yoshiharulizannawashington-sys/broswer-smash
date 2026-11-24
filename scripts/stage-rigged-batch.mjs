#!/usr/bin/env node
// Stage the eight auto-rigged supplied bodies for Browser Bros without promoting them.
//
//   node scripts/stage-rigged-batch.mjs
//
// Copies the validated GLBs into public/models/characters/imported/<key>_rigged/, writes a
// provenance sidecar next to each one, and registers an enabled manifest entry under a new key.
// Deliberately does NOT touch the roster in public/js/main.js: the staged bodies are reachable with
// ?showcaseCharacter=<key>_rigged for review and remain outside launch/DLC selection until a visual
// acceptance pass promotes them.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const KEYS = ['wonder_woman', 'spider_man', 'light_yagami', 'madara', 'madara_alt', 'sasuke', 'thor', 'aang'];
const validationPath = resolve(ROOT, 'artifacts/rig-batch/validation.json');
if (!existsSync(validationPath)) {
  console.error('Run node scripts/validate-rig-batch.mjs first: validation.json is missing.');
  process.exit(1);
}
const validation = JSON.parse(readFileSync(validationPath, 'utf8'));
if (validation.failures?.length) {
  console.error(`Refusing to stage: ${validation.failures.length} validation failure(s) remain.`);
  process.exit(1);
}
const inventory = JSON.parse(readFileSync(resolve(ROOT, 'artifacts/asset-fetch/inventory.json'), 'utf8'));
const metaByKey = new Map((Array.isArray(inventory) ? inventory : []).map(item => [item.key, item]));

const manifestPath = resolve(ROOT, 'public/models/characters/manifest.json');
const manifestRaw = readFileSync(manifestPath, 'utf8');
const indent = (manifestRaw.match(/^\{\n( +)"/) || [])[1] || ' ';
const manifest = JSON.parse(manifestRaw);
manifest.characters ||= {};

const staged = [];
for (const key of KEYS) {
  const result = validation.results.find(item => item.key === key);
  if (!result) {
    console.error(`No validation result for ${key}`);
    process.exit(1);
  }
  const source = resolve(ROOT, 'artifacts/rig-batch/rigged', key, key + '.glb');
  if (!existsSync(source)) {
    console.error(`Missing rigged GLB for ${key}: ${source}`);
    process.exit(1);
  }
  const slug = key + '_rigged';
  const destDir = resolve(ROOT, 'public/models/characters/imported', slug);
  const dest = resolve(destDir, slug + '.glb');
  mkdirSync(destDir, { recursive: true });
  copyFileSync(source, dest);
  const bytes = statSync(dest).size;
  const meta = metaByKey.get(key) || {};
  const provenance = {
    id: slug,
    sourceModel: meta.name || key,
    sourceUid: meta.uid || null,
    creator: meta.author || null,
    license: meta.license || null,
    sourceFile: `artifacts/asset-fetch/${key}/${key}.glb`,
    notes: `Auto-rigged in Blender 4.2.23 by scripts/autorig_batch.py from the supplied unrigged body. `
      + `19 canonical bones, ${result.weights.vertices} vertices, ${result.weights.unweighted} unweighted, `
      + `${result.weights.maxInfluences} max influences. No authored animation clips; the game's procedural `
      + `motion drives the skeleton. Staged only: not on the launch roster.`,
    rig: {
      bones: result.bones, canonicalSlots: result.rigSlots,
      height: result.height, feetY: result.feetY,
      vertices: result.weights.vertices, unweighted: result.weights.unweighted,
      maxInfluences: result.weights.maxInfluences,
      armLength: result.armLength, legLength: result.legLength,
      joints: result.joints, symmetry: result.symmetry
    },
    validation: 'artifacts/rig-batch/validation.json',
    stagedAt: new Date().toISOString()
  };
  writeFileSync(resolve(destDir, slug + '.provenance.json'), JSON.stringify(provenance, null, 1) + '\n');

  manifest.characters[slug] = {
    url: `/models/characters/imported/${slug}/${slug}.glb`,
    format: 'gltf',
    enabled: true,
    yawOffset: 0,
    assetKind: 'imported-staged-rig',
    source: meta.uid
      ? `Sketchfab "${meta.name}" by ${meta.author || 'unknown author'} (uid ${meta.uid}), supplied as an unrigged body; auto-rigged in Blender 4.2.23 by scripts/autorig_batch.py.`
      : `Supplied unrigged body, auto-rigged in Blender 4.2.23 by scripts/autorig_batch.py.`,
    ...(meta.author ? { creator: meta.author } : {}),
    ...(meta.license ? { license: meta.license } : {}),
    notes: `STAGED RIG — not on the launch roster. 19/19 canonical slots, every vertex weighted, `
      + `symmetric joints verified on-body, pose-test deformation passed. No authored clips: the `
      + `existing procedural motion drives this skeleton. Review with `
      + `?showcaseCharacter=${slug}. Promote only after a live match visual acceptance.`,
    verified: {
      bytes,
      height: result.height,
      feetY: result.feetY,
      bones: result.bones,
      canonicalSlots: result.rigSlots,
      vertices: result.weights.vertices,
      unweighted: result.weights.unweighted,
      maxInfluences: result.weights.maxInfluences,
      armLength: result.armLength,
      legLength: result.legLength,
      validator: 'node scripts/validate-rig-batch.mjs',
      rigReport: `artifacts/rig-batch/rigged/${key}/rig-report.json`
    }
  };
  staged.push({ key, slug, url: manifest.characters[slug].url, bytes, result });
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, indent.length) + '\n');

const lines = [
  '# Auto-rigged supplied bodies — staged batch',
  '',
  `Generated ${new Date().toISOString().slice(0, 10)} with Blender 4.2.23 LTS (headless).`,
  '',
  'The eight supplied bodies without skeletons were normalised (upright, feet on Z=0, 1.72–1.88 m),',
  'rigged with a per-model 19-bone canonical humanoid skeleton, and skinned with gated distance',
  'weights, then smoothed, normalised, limited to four influences and validated. They are staged as',
  'manifest entries (`<key>_rigged`) and are **not** on the launch/DLC roster.',
  '',
  '| body | staged key | bytes | height | feet | skinned | slots | vertices | unweighted | bad sums | max inf | arm/H | leg/H |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...staged.map(item => {
    const r = item.result;
    return `| ${item.key} | ${item.slug} | ${item.bytes.toLocaleString()} | ${r.height} m | ${r.feetY} | ${r.skinnedMeshes}/${r.meshes} | ${r.rigSlots} | ${r.weights.vertices} | ${r.weights.unweighted} | ${r.weights.badSum} | ${r.weights.maxInfluences} | ${r.armLength} | ${r.legLength} |`;
  }),
  '',
  '## Review',
  '',
  'Open the game with `?showcaseCharacter=<staged key>`; the staged body replaces the player body for',
  'that match only. The opponent and the rest of the roster are unchanged. Nothing is added to',
  'character select until a live visual pass is completed.',
  '',
  '## Validation',
  '',
  '- `node scripts/validate-rig-batch.mjs` — 8/8 bodies, 19/19 slots, 0 unweighted vertices, 0 bad weight sums, max 4 influences, every joint within 0.20 m of the surface, left/right mirror error 0.',
  '- Blender pose test per body rotates arms, forearms, thighs, shins and spine; every tested bone moves sampled vertices.',
  '- No animation clips are included. The game procedurally animates canonical bones when a rig has no clips; authored clips remain a separate production pass.',
  '',
  '## Limits',
  '',
  '- Numeric and silhouette validation only. Playwright/Chromium is unavailable in this workspace, so no live in-game screenshot or hardware visual acceptance was possible.',
  '- The staged bodies are third-party source meshes; their recorded licence metadata is carried into provenance but is not a distribution clearance.',
  '- Source topology is unchanged, including open garment/scan boundaries that do not affect skinning.',
  ''
];
mkdirSync(resolve(ROOT, 'artifacts/rig-batch'), { recursive: true });
writeFileSync(resolve(ROOT, 'artifacts/rig-batch/STAGING.md'), lines.join('\n'));

console.log(JSON.stringify({
  staged: staged.map(item => ({ key: item.key, slug: item.slug, url: item.url, bytes: item.bytes })),
  manifest: manifestPath,
  report: 'artifacts/rig-batch/STAGING.md'
}, null, 1));
