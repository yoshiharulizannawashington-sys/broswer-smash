#!/usr/bin/env node
// Fetch a downloadable Sketchfab environment asset through the official download API.
//
// Sketchfab requires an authenticated account for downloads. This script never bypasses that:
// it reads SKETCHFAB_TOKEN from the environment, verifies the public licence metadata, refuses
// non-commercial/no-derivatives licences, downloads the archive, extracts it and records the
// attribution and hashes. Source archives stay under artifacts/asset-fetch and are not edited.
//
//   node scripts/fetch-environment-asset.mjs --uid <uid> --slug konoha-village
//   node scripts/fetch-environment-asset.mjs --uid <uid> --slug hokage-office --max-mb 200
//
// Output:
//   artifacts/asset-fetch/<uid>/model.zip        (or model.glb if the API returns a GLB)
//   artifacts/asset-fetch/<uid>/extracted/...    (when the archive is a zip)
//   artifacts/asset-fetch/<uid>/metadata.json
//   artifacts/asset-fetch/<uid>/fetch-report.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const API = 'https://api.sketchfab.com/v3';
const ROOT = 'artifacts/asset-fetch';
const TOKEN = String(process.env.SKETCHFAB_TOKEN || process.env.SKETCHFAB_API_TOKEN || '').trim();
const ACCEPTED_LICENCES = /^(CC0|CC Attribution|CC BY|Free Standard)/i;
const BLOCKED_LICENCES = /NonCommercial|NoDerivatives/i;
const RIPPED = /ultimate ninja storm|mobile game|xenverse|xenoverse|kakarot|sparking|mugen|ripped|extracted from/i;

function args(argv) {
  const out = { uid: null, slug: null, maxMb: 300 };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--uid') out.uid = argv[++i];
    else if (argv[i] === '--slug') out.slug = argv[++i];
    else if (argv[i] === '--max-mb') out.maxMb = Number(argv[++i]);
    else throw new Error(`unexpected argument: ${argv[i]}`);
  }
  if (!out.uid || !out.slug) throw new Error('--uid and --slug are required');
  if (!Number.isFinite(out.maxMb) || out.maxMb <= 0) throw new Error('--max-mb must be positive');
  const match = String(out.uid).match(/([0-9a-f]{32})/i);
  if (!match) throw new Error('--uid must be a 32-character Sketchfab model id');
  out.uid = match[1].toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(out.slug)) throw new Error('--slug must be lowercase letters, digits and hyphens');
  return out;
}

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = async (url, token) => {
  const response = await fetch(url, { headers: { Accept: 'application/json', ...(token ? { Authorization: `Token ${token}` } : {}) } });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 400) }; }
  return { status: response.status, body };
};

async function main() {
  let options;
  try { options = args(process.argv); } catch (error) { console.error('error: ' + error.message); process.exit(1); }
  if (!TOKEN) {
    console.error('blocked: no Sketchfab token is present. Add the account API token as SKETCHFAB_TOKEN, then re-run.');
    process.exit(2);
  }

  const meta = await readJson(`${API}/models/${options.uid}`, null);
  if (meta.status !== 200) {
    console.error(`error: model metadata request failed (HTTP ${meta.status})`);
    process.exit(1);
  }
  const model = meta.body;
  const licence = model.license?.label || 'unknown';
  const description = String(model.description || '');
  const source = model.viewerUrl || `https://sketchfab.com/3d-models/${options.uid}`;
  const author = model.user?.displayName || model.user?.username || 'unknown';
  const attribution = `${model.name} by ${author} on Sketchfab (${source}), ${licence}`;

  console.log(`model    ${model.name}`);
  console.log(`author   ${author}`);
  console.log(`licence  ${licence}`);
  console.log(`geometry ${model.faceCount ?? '?'} triangles, ${model.vertexCount ?? '?'} vertices`);
  console.log(`source   ${source}`);
  if (!model.isDownloadable) { console.error('error: author has not enabled downloads; nothing fetched.'); process.exit(1); }
  if (BLOCKED_LICENCES.test(licence)) { console.error(`error: licence "${licence}" is not compatible with this project's distribution.`); process.exit(1); }
  if (!ACCEPTED_LICENCES.test(licence)) { console.error(`error: licence "${licence}" is not on the accepted list.`); process.exit(1); }
  if (RIPPED.test(description)) { console.error('error: description states this is ripped from a commercial game; refused.'); process.exit(1); }

  const download = await readJson(`${API}/models/${options.uid}/download`, TOKEN);
  if (download.status !== 200) {
    console.error(`DOWNLOAD_REFUSED status=${download.status}`);
    process.exit(2);
  }
  const entry = download.body.glb || download.body.source;
  if (!entry?.url) { console.error(`NO_ARCHIVE keys=${Object.keys(download.body).join(',')}`); process.exit(2); }

  const response = await fetch(entry.url);
  if (!response.ok) { console.error(`ARCHIVE_FETCH_FAILED status=${response.status}`); process.exit(2); }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > options.maxMb * 1024 * 1024) {
    console.error(`archive is ${(bytes.length / 1048576).toFixed(1)} MiB, above --max-mb ${options.maxMb}`);
    process.exit(2);
  }

  const dir = path.join(ROOT, options.uid);
  fs.mkdirSync(dir, { recursive: true });
  const isGlb = bytes.subarray(0, 4).toString('ascii') === 'glTF';
  const archive = path.join(dir, isGlb ? 'model.glb' : 'model.zip');
  fs.writeFileSync(archive, bytes);

  let extracted = null;
  if (!isGlb) {
    extracted = path.join(dir, 'extracted');
    fs.rmSync(extracted, { recursive: true, force: true });
    fs.mkdirSync(extracted, { recursive: true });
    try {
      execFileSync('unzip', ['-q', '-o', archive, '-d', extracted], { stdio: 'pipe' });
    } catch (error) {
      console.error('error: unzip failed; archive retained at ' + archive);
      console.error(String(error.stderr || error.message).slice(0, 300));
      process.exit(2);
    }
  }

  const report = {
    slug: options.slug,
    uid: options.uid,
    name: model.name,
    author,
    licence,
    licenceUrl: model.license?.url || null,
    licenceRequirements: model.license?.requirements || null,
    source,
    attribution,
    downloadedAt: new Date().toISOString(),
    bytes: bytes.length,
    sha256: sha256(bytes),
    archive: path.relative(process.cwd(), archive),
    extracted: extracted ? path.relative(process.cwd(), extracted) : null,
    downloadable: Boolean(model.isDownloadable),
    faceCount: model.faceCount ?? null,
    vertexCount: model.vertexCount ?? null,
    animationCount: model.animationCount ?? 0,
    status: 'downloaded'
  };
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ model, report }, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'fetch-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`saved    ${report.archive} (${(bytes.length / 1048576).toFixed(1)} MiB)`);
  if (extracted) console.log(`extracted ${report.extracted}`);
  console.log(`sha256   ${report.sha256}`);
}

main().catch(error => { console.error('error: ' + (error?.message || error)); process.exit(1); });
