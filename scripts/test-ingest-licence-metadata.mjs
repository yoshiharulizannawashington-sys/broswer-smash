#!/usr/bin/env node
// Proves that licence metadata cannot decide whether a character model is ingestible.
//
// The same technically valid GLB is ingested five times, with five different metadata states:
// CC0, CC BY, CC BY-SA, Proprietary, and no licence metadata at all. All five must behave
// identically. A sixth case proves the TECHNICAL gate is still real: a malformed file must still
// fail, and fail with a technical reason rather than a licence one.
//
//   node scripts/test-ingest-licence-metadata.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CANONICAL_BONES } from '../public/js/anim/rig_map.js';

const root = resolve(import.meta.dirname, '..');
const SOURCE = 'public/models/characters/ingested/quaternius_base.glb';
const OUT_DIR = 'artifacts/dev/ingest-licence';
mkdirSync(resolve(root, OUT_DIR), { recursive: true });
const temp = mkdtempSync(join(tmpdir(), 'ingest-licence-'));

// An already-canonical body: every bone maps to itself, and the seven game states are the clip
// names it already carries. Nothing here is licence-dependent.
const boneMap = Object.fromEntries(CANONICAL_BONES.map(bone => [bone, bone]));
const clipMap = { Idle: 'Idle', Walk: 'Walk', Run: 'Run', Jump: 'Jump', Punch: 'Punch', Kick: 'Kick', Kamehameha: 'Kamehameha' };

const cases = [
  { name: 'CC0', license: 'CC0 1.0', creator: 'Example Author', provenance: { sourceUrl: 'https://example.test/cc0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' } },
  { name: 'CC BY', license: 'CC BY 4.0', creator: 'Example Author', provenance: { sourceUrl: 'https://example.test/by', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', attribution: 'Example Author' } },
  { name: 'CC BY-SA', license: 'CC BY-SA 4.0', creator: 'Example Author', provenance: { sourceUrl: 'https://example.test/by-sa', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' } },
  { name: 'Proprietary', license: 'Proprietary — all rights reserved', creator: 'Rights Holder', provenance: { sourceUrl: 'https://example.test/proprietary', licenseUrl: 'https://example.test/eula' } },
  { name: 'Unknown/none', license: null, creator: null, provenance: {} }
];

const results = [];
let failures = 0;

for (const [index, testCase] of cases.entries()) {
  const profile = {
    id: `licence-case-${index}`,
    source: SOURCE,
    output: `${OUT_DIR}/${testCase.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.glb`,
    targetHeight: 1.78,
    boneMap,
    clipMap,
    ...(testCase.creator ? { creator: testCase.creator } : {}),
    ...(testCase.license ? { license: testCase.license } : {}),
    ...(testCase.provenance ? { provenance: testCase.provenance } : {})
  };
  const profilePath = join(temp, `case-${index}.json`);
  writeFileSync(profilePath, JSON.stringify(profile, null, 1));

  let status = 0;
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync(process.execPath, ['scripts/ingest-character.mjs', '--profile', profilePath, '--dry-run'], { cwd: root, encoding: 'utf8' });
  } catch (error) {
    status = error.status ?? 1;
    stdout = String(error.stdout || '');
    stderr = String(error.stderr || '');
  }
  const ok = status === 0;
  if (!ok) failures++;
  let report = null;
  if (ok) {
    try { report = JSON.parse(stdout.slice(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1)); } catch { /* reported below */ }
    if (!report) { failures++; }
  }
  results.push({
    licence: testCase.name,
    exit: status,
    accepted: ok && Boolean(report),
    bones: report?.verify?.bonesBound ?? null,
    clips: report?.verify?.clips?.length ?? null,
    reportedLicense: report?.license ?? null,
    error: ok ? null : (stderr.trim().split('\n').pop() || 'no stderr')
  });
}

// ------------------------------------------------------------------ negative control
// The technical gate must still bite. A file that is not a GLB has to be refused, and the reason
// must be technical, not a licence classification.
const badFile = join(temp, 'not-a-model.glb');
writeFileSync(badFile, 'this is not a glb');
const badProfile = join(temp, 'case-bad.json');
writeFileSync(badProfile, JSON.stringify({
  id: 'technical-negative-control', source: badFile, output: `${OUT_DIR}/should-not-exist.glb`,
  targetHeight: 1.78, boneMap, clipMap, creator: 'Example', license: 'CC0 1.0',
  provenance: { sourceUrl: 'https://example.test/x', licenseUrl: 'https://example.test/y' }
}, null, 1));
let badStatus = 0;
let badStderr = '';
try {
  execFileSync(process.execPath, ['scripts/ingest-character.mjs', '--profile', badProfile, '--dry-run'], { cwd: root, encoding: 'utf8' });
} catch (error) {
  badStatus = error.status ?? 1;
  badStderr = String(error.stderr || '');
}
const badRejected = badStatus !== 0;
const badReasonIsTechnical = /not a GLB|glTF/i.test(badStderr);
if (!badRejected || !badReasonIsTechnical) failures++;

// ------------------------------------------------------------------ report
const identical = new Set(results.filter(r => r.accepted).map(r => `${r.bones}/${r.clips}`)).size === 1;
if (!identical) failures++;
if (results.some(result => !result.accepted)) failures++;

for (const result of results) {
  console.log(`${result.accepted ? 'PASS' : 'FAIL'}  ${result.licence.padEnd(14)} exit=${result.exit} bones=${result.bones} clips=${result.clips}`);
}
console.log(`${badRejected && badReasonIsTechnical ? 'PASS' : 'FAIL'}  technical negative control   exit=${badStatus} reason="${(badStderr.trim().split('\n').pop() || '').slice(0, 80)}"`);
console.log(`\nlicence classifications treated identically: ${identical ? 'yes' : 'no'}`);
console.log(`licence checks: ${results.filter(r => r.accepted).length}/${results.length} accepted · technical gate still enforced: ${badRejected && badReasonIsTechnical ? 'yes' : 'no'}`);

if (failures) {
  console.error(`\nINGEST LICENCE TEST FAILED (${failures})`);
  process.exit(1);
}
console.log('INGEST LICENCE TEST PASSED: licence metadata does not gate character ingestion.');
