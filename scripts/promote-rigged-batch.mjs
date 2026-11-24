#!/usr/bin/env node
// Promote an animated, auto-rigged batch into the live roster without changing the roster list.
//
//   node scripts/promote-rigged-batch.mjs --batch=1
//   node scripts/promote-rigged-batch.mjs --batch=2
//
// The animated GLBs are produced separately with:
//   node scripts/rig-clips-to-body.mjs retarget public/models/characters/roster/thor.glb \
//     public/models/characters/imported/<key>_rigged/<key>_rigged.glb \
//     artifacts/rig-batch/animated/<key>.glb
//
// This script copies those files over the staged rig, records the old live URL as rollbackUrl,
// updates the existing manifest identity in place, and keeps `madara_alt` as a variant. It never
// edits the roster arrays in public/js/main.js.
import { readFileSync, writeFileSync, copyFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = new Map(process.argv.slice(2).map(arg => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.join('=') || true];
}));
const batch = Number(args.get('batch'));
if (![1, 2].includes(batch)) {
  console.error('usage: node scripts/promote-rigged-batch.mjs --batch=1|2');
  process.exit(2);
}

// The donor clip set is the 25-clip, 19-bone roster export. Every target was fitted to the same
// canonical 19-bone contract by scripts/autorig_batch.py.
const DONOR = 'public/models/characters/roster/thor.glb';
const BATCHES = {
  1: {
    keys: ['wonder_woman', 'spider_man', 'thor', 'aang'],
    live: {
      wonder_woman: 'wonder_woman',
      spider_man: 'spider_man',
      thor: 'thor',
      aang: 'aang'
    }
  },
  2: {
    keys: ['sasuke', 'madara', 'light_yagami', 'madara_alt'],
    live: {
      sasuke: 'sasuke_uchiha',
      madara: 'madara_uchiha',
      light_yagami: 'l_death_note_style'
    }
  }
};
const plan = BATCHES[batch];
const ROOT = resolve(import.meta.dirname, '..');
const manifestPath = resolve(ROOT, 'public/models/characters/manifest.json');
const raw = readFileSync(manifestPath, 'utf8');
const indent = (raw.match(/^\{\n( +)"/) || [])[1] || ' ';
const manifest = JSON.parse(raw);
manifest.characters ||= {};

mkdirSync(resolve(ROOT, 'artifacts/rig-batch'), { recursive: true });
const before = resolve(ROOT, `artifacts/rig-batch/manifest-before-promotion-${batch}.json`);
if (!existsSync(before)) writeFileSync(before, raw);

const rows = [];
for (const key of plan.keys) {
  const stagedKey = `${key}_rigged`;
  const staged = manifest.characters[stagedKey];
  if (!staged) throw new Error(`manifest has no staged key ${stagedKey}`);
  const animated = resolve(ROOT, 'artifacts/rig-batch/animated', `${key}.glb`);
  if (!existsSync(animated)) throw new Error(`missing animated GLB ${animated}`);
  const retargetPath = resolve(ROOT, 'artifacts/rig-batch/animated', `${key}-retarget.json`);
  if (!existsSync(retargetPath)) throw new Error(`missing retarget report ${retargetPath}`);
  const retarget = JSON.parse(readFileSync(retargetPath, 'utf8'));
  if (retarget.clips !== 25 || retarget.unresolvedCount !== 0) {
    throw new Error(`${key}: retarget did not produce 25 resolved clips`);
  }
  const dest = resolve(ROOT, 'public/models/characters/imported', stagedKey, `${stagedKey}.glb`);
  copyFileSync(animated, dest);
  const bytes = statSync(dest).size;
  const provenancePath = resolve(ROOT, 'public/models/characters/imported', stagedKey, `${stagedKey}.provenance.json`);
  const provenance = existsSync(provenancePath) ? JSON.parse(readFileSync(provenancePath, 'utf8')) : {};
  provenance.animation = {
    clips: 25,
    donor: DONOR,
    retarget: 'scripts/rig-clips-to-body.mjs retarget',
    approach: 'bind-pose retarget at 30 fps; grounded clips lifted once at the Hips, root motion omitted',
    report: `artifacts/rig-batch/animated/${key}-retarget.json`
  };
  provenance.notes = String(provenance.notes || '').replace('No authored animation clips; the game\'s procedural motion drives the skeleton. ', '')
    + ' 25-clip roster animation set retargeted onto the exact 19-bone rig.';
  writeFileSync(provenancePath, JSON.stringify(provenance, null, 1) + '\n');

  const verified = {
    ...(staged.verified || {}),
    bytes,
    clips: 25,
    bones: 19,
    canonicalSlots: 19,
    animationSet: '25 clips; bind-pose retarget from public/models/characters/roster/thor.glb',
    retargetReport: `artifacts/rig-batch/animated/${key}-retarget.json`
  };
  const source = staged.source || `Auto-rigged supplied body ${key}`;
  const creator = staged.creator;
  const license = staged.license;
  const stagedNotes = `ANIMATED RIG — exact supplied body, 19-bone auto-rig, 25-clip roster animation set. `
    + `Retarget report: artifacts/rig-batch/animated/${key}-retarget.json.`;
  manifest.characters[stagedKey] = {
    ...staged,
    url: `/models/characters/imported/${stagedKey}/${stagedKey}.glb`,
    format: 'gltf',
    enabled: true,
    yawOffset: 0,
    assetKind: key === 'madara_alt' ? 'imported-rigged-variant' : 'imported-rigged-animated',
    ...(key === 'madara_alt' ? { variantOf: 'madara_uchiha' } : {}),
    source,
    ...(creator ? { creator } : {}),
    ...(license ? { license } : {}),
    notes: stagedNotes,
    verified
  };

  const liveKey = plan.live[key];
  if (liveKey) {
    const live = manifest.characters[liveKey];
    if (!live) throw new Error(`manifest has no live identity ${liveKey}`);
    const oldUrl = live.url;
    manifest.characters[liveKey] = {
      ...live,
      url: manifest.characters[stagedKey].url,
      format: 'gltf',
      enabled: true,
      yawOffset: 0,
      assetKind: 'imported-rigged-promoted',
      promotedFrom: stagedKey,
      rollbackUrl: oldUrl,
      source,
      ...(creator ? { creator } : {}),
      ...(license ? { license } : {}),
      notes: `PROMOTED ${key === 'light_yagami' ? 'Light Yagami body into the L (Death Note Style) slot' : 'exact rigged supplied body'} — 19/19 canonical bones, `
        + `25-clip animation set, 0 unweighted vertices, live-match evidence required before release. `
        + `Rollback body: ${oldUrl}. Source: ${source}`,
      verified
    };
  }
  rows.push({ key, stagedKey, liveKey: liveKey || null, bytes, clips: 25, url: manifest.characters[stagedKey].url });
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, indent.length) + '\n');

const report = [
  `# Rigged promotion — batch ${batch}`,
  '',
  `Promoted ${rows.length} exact rigged bodies on ${new Date().toISOString().slice(0, 10)}.`,
  '',
  '| body | staged key | live identity | clips | bytes |',
  '| --- | --- | --- | ---: | ---: |',
  ...rows.map(row => `| ${row.key} | ${row.stagedKey} | ${row.liveKey || '(variant only)'} | ${row.clips} | ${row.bytes.toLocaleString()} |`),
  '',
  'All uploaded bodies use the 25-clip, 19-bone donor set retargeted in bind pose by `scripts/rig-clips-to-body.mjs`. The live roster arrays in `public/js/main.js` were not edited. `madara_alt` remains a variant because there is one Madara Uchiha roster identity.',
  ''
];
const reportJson = resolve(ROOT, `artifacts/rig-batch/promotion-batch-${batch}.json`);
const reportMd = resolve(ROOT, `artifacts/rig-batch/PROMOTION-batch-${batch}.md`);
writeFileSync(reportJson, JSON.stringify({ batch, donor: DONOR, rows, manifestBefore: before }, null, 1) + '\n');
writeFileSync(reportMd, report.join('\n'));
console.log(JSON.stringify({ batch, rows, report: reportMd, manifestBefore: before }, null, 1));
