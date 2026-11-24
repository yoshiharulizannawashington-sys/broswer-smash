#!/usr/bin/env node
// Character sourcing: find and retrieve a model, then hand it to the prep pipeline.
//
//   node scripts/source-character.mjs --search "anime character" [--downloadable] [--limit 12]
//   node scripts/source-character.mjs --sketchfab <uid>          (needs SKETCHFAB_TOKEN)
//   node scripts/source-character.mjs --url <direct model url>
//   node scripts/source-character.mjs --file <path on disk>
//
// Downloads are never faked. A Sketchfab model that is view-only, or a download that would need a
// login/purchase we do not have, is reported as such with the exact reason, and nothing is written.
// Licence metadata is recorded when the source states it and is never used as a permission check.
import { mkdirSync, writeFileSync, copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const OUT = 'artifacts/dev/source';
mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const flag = name => args.includes(`--${name}`);

const FORMATS = ['.glb', '.gltf', '.fbx', '.obj', '.vrm', '.blend', '.zip'];
const slugify = value => String(value || 'character').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'character';

async function api(path) {
  const response = await fetch(`https://api.sketchfab.com/v3${path}`, { headers: { Accept: 'application/json' } });
  const body = await response.text();
  let json = null;
  try { json = JSON.parse(body); } catch { /* non-JSON error body */ }
  return { status: response.status, json, body };
}

/** List candidates. Public metadata only, no auth. */
async function search(query, { downloadable = false, limit = 12 } = {}) {
  const params = new URLSearchParams({ type: 'models', q: query, count: String(Math.min(24, Math.max(1, limit))) });
  if (downloadable) params.set('downloadable', 'true');
  const { status, json, body } = await api(`/search?${params}`);
  if (status !== 200 || !json) {
    console.error(`Sketchfab search failed (HTTP ${status}): ${body.slice(0, 200)}`);
    process.exit(1);
  }
  const rows = (json.results || []).map(model => ({
    uid: String(model.uid || ''),
    name: model.name || '',
    creator: model.user?.displayName || model.user?.username || '',
    downloadable: Boolean(model.isDownloadable),
    faces: model.faceCount ?? null,
    license: model.license?.label || null,
    page: model.viewerUrl || (model.uid ? `https://sketchfab.com/3d-models/${model.uid}` : '')
  }));
  console.log(JSON.stringify({ query, downloadableOnly: downloadable, count: rows.length, results: rows }, null, 1));
  return rows;
}

/** Download a Sketchfab model through the official download endpoint, if the account may. */
async function sketchfab(uid, name = null) {
  const token = process.env.SKETCHFAB_TOKEN || process.env.SKETCHFAB_API_TOKEN || '';
  const meta = await api(`/models/${uid}`);
  if (meta.status !== 200 || !meta.json) {
    console.error(`Cannot read model ${uid} (HTTP ${meta.status}). Nothing downloaded.`);
    process.exit(1);
  }
  const model = meta.json;
  const lic = model.license?.label || null;
  if (!token) {
    console.error(`REFUSED BY THE SOURCE, NOT BY THIS PIPELINE: downloading ${uid} needs an authenticated Sketchfab account.\n`
      + `  · set SKETCHFAB_TOKEN in the environment (Account → Settings → Password & API → API token), then re-run this command, or\n`
      + `  · download the model in a browser and pass the file with --file <path>.\n`
      + `  · licence recorded on the page: ${lic || 'none stated'} · downloadable: ${model.isDownloadable ? 'yes' : 'NO (view-only)'}`);
    process.exit(2);
  }
  if (!model.isDownloadable) {
    console.error(`Model ${uid} is view-only on Sketchfab (isDownloadable=false). There is no download to retrieve; nothing was written.`);
    process.exit(2);
  }
  const response = await fetch(`https://api.sketchfab.com/v3/models/${uid}/download`, {
    method: 'GET',
    headers: { Authorization: `Token ${token}`, Accept: 'application/json' }
  });
  if (!response.ok) {
    console.error(`Sketchfab download denied (HTTP ${response.status}). Nothing downloaded. The account may not own this download or the token may be invalid.`);
    process.exit(2);
  }
  const payload = await response.json();
  const urls = Object.values(payload || {}).map(v => (typeof v === 'string' ? v : v?.url)).filter(Boolean);
  if (!urls.length) {
    console.error('Sketchfab returned no download URLs. Nothing downloaded.');
    process.exit(2);
  }
  const chosen = urls.find(u => /\.glb(\?|$)/i.test(u)) || urls.find(u => /\.gltf(\?|$)|\.zip(\?|$)/i.test(u)) || urls[0];
  const stem = slugify(name || model.name || uid);
  const raw = join(OUT, `${stem}.download`);
  const file = await fetch(chosen);
  if (!file.ok) {
    console.error(`Fetching the archive failed (HTTP ${file.status}). Nothing written.`);
    process.exit(2);
  }
  writeFileSync(raw, Buffer.from(await file.arrayBuffer()));
  const extracted = extractIfArchive(raw, stem);
  return record(extracted, { source: 'sketchfab', uid, name: model.name || stem, license: lic, licenseUrl: model.license?.url || null, page: model.viewerUrl || null, creator: model.user?.displayName || null });
}

/** Unzip a Sketchfab/Fab archive into the source folder and return the model file inside it. */
function extractIfArchive(path, stem) {
  if (extname(path).toLowerCase() !== '.zip' && !path.endsWith('.download')) return path;
  const dir = join(OUT, stem);
  mkdirSync(dir, { recursive: true });
  const unzip = spawnSync('unzip', ['-o', '-q', path, '-d', dir], { encoding: 'utf8' });
  if (unzip.status !== 0) {
    console.error(`Archive could not be extracted (${unzip.stderr?.trim() || 'unzip failed'}). The archive is kept at ${path}.`);
    process.exit(2);
  }
  const models = [];
  const walk = folder => {
    for (const entry of readdirSync(folder)) {
      const full = join(folder, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (FORMATS.includes(extname(entry).toLowerCase()) && extname(entry).toLowerCase() !== '.zip') models.push(full);
    }
  };
  walk(dir);
  const preferred = models.find(f => /\.glb$/i.test(f)) || models.find(f => /\.(gltf|fbx|obj|vrm|blend)$/i.test(f));
  if (!preferred) {
    console.error(`No supported model file inside the archive (found: ${models.map(f => basename(f)).join(', ') || 'nothing'}).`);
    process.exit(2);
  }
  return preferred;
}

/** Copy a user-supplied file (or a direct URL) into the source folder. */
async function fromFile(path, extra = {}) {
  const full = resolve(path);
  if (!existsSync(full)) {
    console.error(`File not found: ${full}`);
    process.exit(1);
  }
  if (!FORMATS.includes(extname(full).toLowerCase())) {
    console.error(`Unsupported format "${extname(full)}" (supported: ${FORMATS.join(', ')}).`);
    process.exit(1);
  }
  const stem = slugify(extra.name || basename(full, extname(full)));
  const target = join(OUT, `${stem}${extname(full).toLowerCase()}`);
  copyFileSync(full, target);
  return record(target, { source: extra.source || 'file', name: extra.name || basename(full), ...extra });
}

async function fromUrl(url, name = null) {
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`URL fetch failed (HTTP ${response.status}). Nothing written.`);
    process.exit(2);
  }
  const disposition = response.headers.get('content-disposition') || '';
  const guessed = (disposition.match(/filename="?([^";]+)"?/i) || [])[1] || url.split('?')[0];
  const ext = FORMATS.includes(extname(guessed).toLowerCase()) ? extname(guessed).toLowerCase() : '.glb';
  const stem = slugify(name || basename(guessed, extname(guessed)));
  const target = join(OUT, `${stem}${ext}`);
  writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  return record(target, { source: 'url', url, name: name || stem });
}

/** Write the sidecar that records where the file came from; licence fields are optional metadata. */
function record(file, meta) {
  const info = {
    file: file.replace(/\\/g, '/'),
    format: extname(file).toLowerCase().replace('.', ''),
    bytes: statSync(file).size,
    retrievedAt: new Date().toISOString(),
    ...meta
  };
  const sidecar = file.replace(/\.[^.]+$/, '.source.json');
  writeFileSync(sidecar, JSON.stringify(info, null, 1) + '\n');
  console.log(JSON.stringify(info, null, 1));
  return info;
}

if (flag('search')) {
  await search(arg('search'), { downloadable: flag('downloadable'), limit: Number(arg('limit', 12)) });
} else if (arg('sketchfab')) {
  await sketchfab(arg('sketchfab'), arg('name'));
} else if (arg('url')) {
  await fromUrl(arg('url'), arg('name'));
} else if (arg('file')) {
  await fromFile(arg('file'), { name: arg('name'), license: arg('license'), creator: arg('creator') });
} else {
  console.error('Nothing to do. Use --search <query>, --sketchfab <uid>, --url <url> or --file <path>.');
  process.exit(1);
}
