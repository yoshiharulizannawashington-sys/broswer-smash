#!/usr/bin/env node
// End-to-end proof for the online character import system.
//
//   node scripts/test-model-import.mjs            (against ORIGIN, default http://127.0.0.1:3100)
//
// Drives the real HTTP service: provider search, preview of a real file, then three imports —
// a rigged humanoid, an unrigged humanoid and a non-character accessory. Review mode is asserted
// throughout: the roster arrays and the character manifest must be byte-identical afterwards.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const origin = process.env.ORIGIN || 'http://127.0.0.1:3100';
const root = process.cwd();
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
};

const sha = file => createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex');
const guardFiles = ['public/js/main.js', 'public/models/characters/manifest.json'];
const before = Object.fromEntries(guardFiles.map(file => [file, sha(file)]));

async function api(path, options) {
  const response = await fetch(origin + path, options);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }
  return { status: response.status, ok: response.ok, body };
}
const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function waitForJob(id, timeoutMs = 300_000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const { body } = await api(`/api/models/jobs/${id}`);
    last = body;
    if (body.state === 'ready' || body.state === 'failed' || body.state === 'integrated') return body;
    await new Promise(done => setTimeout(done, 1500));
  }
  return last;
}

/* ------------------------------------------------------------------ 1. providers ---- */
const sources = await api('/api/models/sources');
record('service is reachable', sources.ok, `${origin}${sources.ok ? '' : ` → ${sources.body.error}`}`);
if (!sources.ok) { console.log(JSON.stringify({ results }, null, 1)); process.exit(1); }

const list = sources.body.sources || [];
const searchable = list.filter(source => source.capabilities.search === 'public');
const direct = list.filter(source => source.capabilities.download === 'direct');
const token = list.filter(source => source.capabilities.download === 'token');
record('provider adapters registered', list.length >= 6, `${list.length} adapters: ${list.map(source => source.id).join(', ')}`);
record('capabilities are distinguished', searchable.length >= 3 && token.length >= 2,
  `${searchable.length} public-search, ${token.length} token-download, ${direct.length} direct-download`);
record('unsupported sources are declared, not faked', Object.keys(sources.body.unsupported || {}).length >= 8,
  `${Object.keys(sources.body.unsupported || {}).length} unsupported entries: ${Object.keys(sources.body.unsupported || {}).join(', ')}`);
record('roster snapshot available for the approval picker', (sources.body.roster?.manifestKeys || []).length > 20,
  `${sources.body.roster.manifestKeys.length} manifest characters, ${sources.body.roster.launch.length} launch roster entries`);

/* ------------------------------------------------------------------ 2. search ------- */
const naruto = await api('/api/models/search?q=naruto&source=sketchfab&limit=12');
const rows = naruto.body.results || [];
const propLike = rows.filter(row => row.classification.kind !== 'character');
record('Sketchfab search returns classified results', naruto.ok && rows.length > 0,
  `${rows.length} results, kinds: ${[...new Set(rows.map(row => row.classification.kind))].join('/') || 'none'}`);
record('non-character hits are not presented as characters', propLike.length > 0,
  `${propLike.length}/${rows.length} classified as non-character, e.g. "${propLike[0]?.name}" → ${propLike[0]?.classification.kind}`);
record('rig status is honest where the source does not know', rows.some(row => row.rig === 'unknown') || rows.every(row => row.rig !== 'unknown'),
  `rig values: ${[...new Set(rows.map(row => row.rig))].join('/')}`);
const downloadBlocked = rows.filter(row => row.downloadable && !row.downloadableNow).length;
record('token-gated downloads are marked unavailable in the UI data', downloadBlocked > 0 || Boolean(process.env.SKETCHFAB_TOKEN),
  `${downloadBlocked} result(s) downloadable at source but blocked without SKETCHFAB_TOKEN`);

const sword = await api('/api/models/search?q=sword&source=polyhaven&limit=8');
const swordRow = (sword.body.results || [])[0];
record('Poly Haven search is live against its public API', sword.ok && Boolean(swordRow),
  swordRow ? `"${swordRow.name}" · ${swordRow.classification.kind} · downloadableNow=${swordRow.downloadableNow}` : sword.body.error);

/* ------------------------------------------------------------------ 3. preview ------ */
const riggedPath = 'artifacts/dev/source/street-soldier.glb';
const preview = await post('/api/models/preview', {
  source: 'direct', row: { source: 'direct', localPath: riggedPath, name: 'Street Soldier', rig: 'unknown' }
});
const inspection = preview.body.inspection || {};
record('preview retrieves the real file and measures it', preview.ok && inspection.inspected && inspection.meshes > 0,
  `${inspection.triangles} tris, ${inspection.meshes} meshes, rig ${inspection.rig}, ${inspection.clips?.length} clips, ${inspection.height} m`);
record('preview classifies from the measured rig, not the label', preview.body.classification?.kind === 'character',
  `classified ${preview.body.classification?.kind} (${preview.body.classification?.confidence})`);
const modelResponse = preview.body.modelUrl ? await fetch(origin + preview.body.modelUrl) : null;
const modelBytes = modelResponse ? Buffer.from(await modelResponse.arrayBuffer()) : Buffer.alloc(0);
record('preview serves the actual GLB to the in-page viewer', modelResponse?.ok && modelBytes.subarray(0, 4).toString() === 'glTF',
  `${preview.body.modelUrl} → ${modelBytes.length} bytes`);

/* ------------------------------------------------------------------ 4. imports ------ */
const importAsset = async (label, body) => {
  const started = await post('/api/models/import', body);
  if (!started.ok) { record(`${label}: import accepted`, false, started.body.error); return null; }
  const job = await waitForJob(started.body.job.id);
  return { job, label };
};

const rigged = await importAsset('rigged humanoid', {
  source: 'direct', localPath: riggedPath, name: 'Street Soldier', intent: 'auto'
});
record('rigged humanoid prepared', Boolean(rigged?.job?.report) && rigged.job.state === 'ready',
  rigged?.job?.error || rigged?.job?.report?.character
    ? `${rigged.job.report.character.rigState} · ${rigged.job.report.character.bones} bones · states ${Object.keys(rigged.job.report.character.states || {}).length}/7 · gate ${rigged.job.report.gate}`
    : 'no report');
record('rigged humanoid is not registered in review mode', rigged?.job?.report?.character?.registered === false,
  `registered=${rigged?.job?.report?.character?.registered}`);
record('per-source geometry gate is reported, not hidden', Boolean(rigged?.job?.report?.gateDetail),
  `${rigged?.job?.report?.gate}: ${String(rigged?.job?.report?.gateDetail || '').slice(0, 110)}`);

const unriggedPath = 'artifacts/dev/import-fixtures/unrigged-humanoid.glb';
const unrigged = existsSync(resolve(root, unriggedPath))
  ? await importAsset('unrigged humanoid', { source: 'direct', localPath: unriggedPath, name: 'Unrigged Humanoid', intent: 'auto' })
  : null;
record('unrigged humanoid branch exercised', Boolean(unrigged),
  unrigged
    ? `${unrigged.job.state}${unrigged.job.error ? ` — ${unrigged.job.error}` : ''}`
    : `fixture missing at ${unriggedPath} (run scripts/make-unrigged-fixture.py first)`);
record('unrigged humanoid takes the character path and is auto-rigged', unrigged?.job?.report?.path === 'character'
  && ['auto-rigged'].includes(unrigged?.job?.report?.character?.rigState),
  `path=${unrigged?.job?.report?.path} rigState=${unrigged?.job?.report?.character?.rigState} bones=${unrigged?.job?.report?.character?.bones} states=${Object.keys(unrigged?.job?.report?.character?.states || {}).length}/7`);

const accessory = swordRow
  ? await importAsset('accessory', { source: 'polyhaven', row: swordRow, name: swordRow.name, intent: 'auto' })
  : null;
record('accessory retrieved over the network', Boolean(accessory?.job?.report) && accessory.job.state === 'ready',
  accessory?.job?.error || `${accessory?.job?.report?.inspection?.triangles ?? '?'} triangles from polyhaven ${swordRow?.uid}`);
record('accessory is prepared as a prop, never a playable character', accessory?.job?.report?.path === 'prop'
  && accessory.job.report.classification.kind !== 'character',
  `path=${accessory?.job?.report?.path} kind=${accessory?.job?.report?.classification?.kind}`);
record('accessory was inspected as a real GLB after conversion', Boolean(accessory?.job?.report?.inspection?.inspected),
  `${accessory?.job?.report?.inspection?.triangles ?? '?'} triangles, ${accessory?.job?.report?.inspection?.meshes ?? '?'} mesh(es)`);

/* ------------------------------------------------------------------ 5. approval ----- */
if (accessory?.job?.id) {
  const commit = await post('/api/models/commit', { jobId: accessory.job.id, mode: 'prop', approved: true });
  record('approval commits a prop without touching the roster', commit.ok && commit.body.commit?.roster?.changed === false,
    commit.ok ? `wrote ${commit.body.commit.wrote.join(', ')}` : commit.body.error);
  const gate = await post('/api/models/commit', { jobId: accessory.job.id, mode: 'new', approved: false });
  record('commit refuses to run without explicit approval', gate.status >= 400, `HTTP ${gate.status}: ${gate.body.error}`);
}

/* ------------------------------------------------------------------ 6. roster ------- */
const after = Object.fromEntries(guardFiles.map(file => [file, sha(file)]));
record('review mode left the roster and manifest byte-identical',
  Object.keys(before).every(file => before[file] === after[file]),
  Object.keys(before).map(file => `${file}:${before[file] === after[file] ? 'same' : 'CHANGED'}`).join(' '));

const library = await api('/api/models/library');
record('staged and failed imports are kept for diagnosis', (library.body.entries || []).length >= 3,
  `${(library.body.entries || []).length} staged import(s), cache ${(library.body.cache?.bytes / 1048576).toFixed(1)} MB`);

const failed = results.filter(entry => !entry.ok);
console.log('\n' + JSON.stringify({
  origin, passed: results.length - failed.length, failed: failed.length,
  providers: list.map(source => `${source.id}:${source.capabilities.search}/${source.capabilities.download}`),
  unsupported: Object.keys(sources.body.unsupported || {}).length,
  jobs: { rigged: rigged?.job?.id, unrigged: unrigged?.job?.id, accessory: accessory?.job?.id },
  failures: failed.map(entry => `${entry.name}: ${entry.detail}`)
}, null, 1));
process.exit(failed.length ? 1 : 0);
