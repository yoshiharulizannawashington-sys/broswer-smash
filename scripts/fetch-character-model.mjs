#!/usr/bin/env node
// Download a downloadable Sketchfab model and stage it through the normal character installer.
//
// Sketchfab's documented Download API requires an authenticated account:
//   "Downloading models requires users to be authenticated with a Sketchfab account."
//   https://sketchfab.com/developers/download-api/guidelines
//
// This script does not bypass that. It reads a personal API token from the environment (the account
// owner authorises the download), verifies the model really is freely downloadable and CC licensed,
// fetches the archive, and then hands the extracted folder to scripts/install-character-model.mjs so
// the asset lands in the manifest with its attribution intact.
//
//   export SKETCHFAB_TOKEN=…            # project secret / shell environment only; never written here
//   node scripts/fetch-character-model.mjs --check-auth
//   node scripts/fetch-character-model.mjs --uid <sketchfab-model-uid> --identity "Goku" [--stage-only]
//
// `--check-auth` validates the secret and prints the account without downloading anything.
// `--stage-only` stops after saving the archive and report, before the installer runs.
// Without a token the script stops after the public metadata check and says what is missing; it
// never falls back to scraping, embed ripping or unauthenticated endpoints.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const DEFAULT_API = 'https://api.sketchfab.com/v3';
// Test seam only: honoured under NODE_ENV=test so a stray variable cannot redirect a real token.
const API = process.env.NODE_ENV === 'test' && process.env.SKETCHFAB_API_BASE
  ? process.env.SKETCHFAB_API_BASE.replace(/\/+$/, '')
  : DEFAULT_API;
const LICENSE_OK = /^(CC0|CC Attribution|CC BY)/i;
const RIPPED = /ultimate ninja storm|mobile game|xenoverse|kakarot|sparking|mugen|ripped|extracted from/i;
const MODEL_EXTENSIONS = ['.glb', '.gltf', '.fbx', '.vrm'];

function parseArgs(argv) {
  const args = {
    uid: null, identity: null, facing: 0, install: false, stageOnly: false,
    checkAuth: false, dir: 'artifacts/asset-fetch'
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--uid') args.uid = argv[++i];
    else if (arg === '--identity') args.identity = argv[++i];
    else if (arg === '--facing') args.facing = Number(argv[++i]);
    else if (arg === '--dir') args.dir = argv[++i];
    else if (arg === '--install') args.install = true;
    else if (arg === '--stage-only') args.stageOnly = true;
    else if (arg === '--check-auth') args.checkAuth = true;
    else throw new Error('unexpected argument: ' + arg);
  }
  if (!args.checkAuth) {
    if (!args.uid) throw new Error('--uid is required (the Sketchfab model id)');
    if (!args.identity) throw new Error('--identity is required, e.g. --identity "Goku"');
  }
  if (args.install && args.stageOnly) throw new Error('--install and --stage-only are mutually exclusive');
  if (!Number.isFinite(args.facing)) throw new Error('--facing must be a number of degrees');
  return args;
}

/** A uid may be given as a bare id or as a pasted model URL. It is never used as a path unchecked. */
function normalizeUid(value) {
  const match = String(value).match(/([0-9a-f]{32})/i);
  if (!match) throw new Error('--uid must be a 32-character Sketchfab model id or model URL');
  return match[1].toLowerCase();
}

let args;
try {
  args = parseArgs(process.argv);
} catch (error) {
  console.error('error: ' + error.message);
  process.exit(1);
}

// Environment variable names are case-sensitive on Linux, but this project's secret store
// exposes the configured SKETCHFAB_TOKEN as `sketchfab_token`. Resolve the documented names
// case-insensitively so the same secret works in either form; the value is never printed.
const tokenSource = ['SKETCHFAB_TOKEN', 'SKETCHFAB_API_TOKEN']
  .map(name => Object.keys(process.env).find(key => key.toUpperCase() === name))
  .find(key => key && String(process.env[key] || '').trim()) || null;
const token = String(tokenSource ? process.env[tokenSource] : '').trim();
const redact = value => {
  const text = String(value ?? '');
  return token ? text.split(token).join('[REDACTED]') : text;
};
const summarize = body => redact(typeof body === 'string' ? body : JSON.stringify(body)).slice(0, 300);

// The token is needed by this process only. Do not hand it to unzip or to a model installer.
const childEnv = { ...process.env };
delete childEnv.SKETCHFAB_TOKEN;
delete childEnv.SKETCHFAB_API_TOKEN;

async function getJson(url, authToken) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(authToken ? { Authorization: 'Token ' + authToken } : {})
      }
    });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
    return { status: response.status, body };
  } catch (error) {
    return { status: 0, body: { error: redact(error?.message || error) } };
  }
}

function missingTokenMessage() {
  return '\nblocked: this model is downloadable, but Sketchfab requires an authenticated account for\n' +
    'the download endpoint. No token is present in this environment.\n\n' +
    '  1. Sign in to Sketchfab as the account owner.\n' +
    '  2. Create an API token for that account (Settings → Password & API → API token).\n' +
    '  3. Add it to this project as the secret SKETCHFAB_TOKEN (never in a tracked file).\n' +
    '  4. Run `node scripts/fetch-character-model.mjs --check-auth` to verify the secret.\n' +
    '  5. Re-run this command; it will download, hash and stage the model.\n\n' +
    'metadata-only check complete: the model itself is eligible, access is what is missing.';
}

async function main() {
  if (args.checkAuth) {
    if (!token) {
      console.error('blocked: no Sketchfab token is present in this environment.\n' +
        'Add the account API token as the project secret SKETCHFAB_TOKEN (never a tracked file), then re-run.');
      process.exit(2);
    }
    const me = await getJson(`${API}/me`, token);
    if (me.status !== 200) {
      console.error(`error: Sketchfab rejected the token (HTTP ${me.status}): ${summarize(me.body)}`);
      console.error('The secret is present but not accepted; create a fresh API token for the account.');
      process.exit(1);
    }
    console.log('token      accepted (from ' + tokenSource + ')');
    console.log('account    ' + (me.body.displayName || me.body.username || 'authenticated account'));
    console.log('access     authenticated download requests are allowed; nothing was downloaded');
    return;
  }

  const uid = normalizeUid(args.uid);
  // Metadata is public, so licensing can be audited before any credential is used.
  const meta = await getJson(`${API}/models/${uid}`);
  if (meta.status !== 200) {
    console.error(`error: could not read model metadata (HTTP ${meta.status}): ${summarize(meta.body)}`);
    process.exit(1);
  }
  const model = meta.body;
  const license = model.license?.label || 'unknown';
  const url = model.viewerUrl || `https://sketchfab.com/3d-models/${uid}`;
  const author = model.user?.displayName || model.user?.username || 'unknown';
  const description = String(model.description || '');
  const faces = model.faceCount ?? null;

  console.log('model      ' + model.name);
  console.log('author     ' + author + ' (' + (model.user?.profileUrl || 'no profile url') + ')');
  console.log('license    ' + license + (model.license?.url ? ' — ' + model.license.url : ''));
  console.log('geometry   ' + (faces ?? '?') + ' triangles, ' + (model.vertexCount ?? '?') + ' vertices');
  console.log('clips      ' + (model.animationCount ?? '?') + ' shipped animations');
  console.log('shareable  isDownloadable=' + model.isDownloadable + ', isProtected=' + Boolean(model.isProtected));
  console.log('source     ' + url);

  if (!model.isDownloadable) {
    console.error('\nerror: the author has not enabled downloads for this model; nothing can be fetched legally.');
    process.exit(1);
  }
  if (!LICENSE_OK.test(license)) {
    console.error(`\nerror: license "${license}" is not a licence this pipeline accepts. Refusing to install.`);
    process.exit(1);
  }
  if (RIPPED.test(description)) {
    console.error('\nerror: the description states this model is extracted from a commercial game. Ripped assets are refused.');
    process.exit(1);
  }

  const attribution = `${model.name} by ${author} on Sketchfab (${url}), ${license}`;
  console.log('attribution ' + attribution);

  if (!token) {
    console.error(missingTokenMessage());
    process.exit(2);
  }

  const download = await getJson(`${API}/models/${uid}/download`, token);
  if (download.status !== 200) {
    console.error(`error: download endpoint refused (HTTP ${download.status}): ${summarize(download.body)}`);
    if (download.status === 401 || download.status === 403) {
      console.error('The token is present but the account is not authorised for this download, or the token is invalid/expired.');
    }
    process.exit(1);
  }
  const archiveUrl = download.body.gltf?.url || download.body.source?.url || download.body.usdz?.url;
  if (!archiveUrl) {
    console.error('error: download response contained no usable archive: ' + summarize(download.body));
    process.exit(1);
  }

  let archive;
  try {
    archive = new URL(archiveUrl);
  } catch {
    console.error('error: download response contained an invalid archive URL.');
    process.exit(1);
  }
  const archiveExtension = path.extname(archive.pathname).toLowerCase();
  const directFile = MODEL_EXTENSIONS.includes(archiveExtension);
  // Signed CDN URLs carry credentials in their query string. Log and store only origin + path.
  const displayUrl = archive.origin + archive.pathname + (archive.search ? ' (signed query redacted)' : '');

  const outDir = path.join(args.dir, uid);
  fs.mkdirSync(outDir, { recursive: true });
  const archivePath = path.join(outDir, directFile ? 'model' + archiveExtension : 'model.zip');

  console.log('\ndownloading ' + displayUrl + '…');
  let fileResponse;
  try {
    fileResponse = await fetch(archiveUrl);
  } catch (error) {
    console.error('error: archive download failed: ' + redact(error?.message || error));
    process.exit(1);
  }
  if (!fileResponse.ok) {
    console.error('error: archive download failed (HTTP ' + fileResponse.status + ')');
    process.exit(1);
  }
  const bytes = Buffer.from(await fileResponse.arrayBuffer());
  if (!bytes.length) {
    console.error('error: archive download returned zero bytes.');
    process.exit(1);
  }
  fs.writeFileSync(archivePath, bytes);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  console.log('saved      ' + archivePath + ' (' + bytes.length + ' bytes)');

  let extracted = archivePath;
  if (!directFile) {
    const extractedDir = path.join(outDir, 'extracted');
    fs.rmSync(extractedDir, { recursive: true, force: true });
    fs.mkdirSync(extractedDir, { recursive: true });
    try {
      execFileSync('unzip', ['-o', '-q', archivePath, '-d', extractedDir], { stdio: 'inherit', env: childEnv });
    } catch (error) {
      console.error('error: archive could not be extracted (' + redact(error?.message || error) + '); archive kept at ' + archivePath);
      process.exit(1);
    }
    extracted = extractedDir;
    console.log('extracted  ' + extracted);
  }

  const relative = value => path.relative(process.cwd(), value).split(path.sep).join('/');
  const report = {
    uid,
    name: model.name,
    author,
    license,
    licenseUrl: model.license?.url || null,
    faces,
    vertices: model.vertexCount ?? null,
    animations: model.animationCount ?? null,
    sourcePage: url,
    attribution,
    retrievedAt: new Date().toISOString(),
    tokenSource,
    downloadHost: archive.host,
    downloadPath: archive.pathname,
    archive: relative(archivePath),
    archiveBytes: bytes.length,
    archiveSha256: sha256,
    extracted: relative(extracted),
    install: args.stageOnly ? 'staged-only' : 'not-run'
  };
  const reportPath = path.join(outDir, 'fetch-report.json');
  const writeReport = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  writeReport();
  console.log('sha256     ' + sha256);
  console.log('report     ' + reportPath);

  if (args.stageOnly) {
    console.log('\nstaged only — inspect it with scripts/install-character-model.mjs --dry-run, then install.');
    return;
  }

  const installArgs = [
    'scripts/install-character-model.mjs',
    extracted,
    '--identity', args.identity,
    '--facing', String(args.facing),
    '--attribution', attribution,
    '--license', license,
    '--source', url
  ];
  if (!args.install) installArgs.push('--dry-run');
  try {
    execFileSync(process.execPath, installArgs, { stdio: 'inherit', env: childEnv });
    report.install = args.install ? 'installed' : 'dry-run-passed';
  } catch (error) {
    report.install = 'failed';
    writeReport();
    console.error('\nerror: the character installer failed (exit ' + (error.status ?? 1) + '); report updated at ' + reportPath);
    process.exit(error.status || 1);
  }
  writeReport();
  console.log(args.install
    ? '\ninstalled. Run npm run audit:roster && npm run build'
    : '\ndry run only — re-run with --install to write the model into the roster');
}

main().catch(error => {
  console.error('error: ' + redact(error?.message || error));
  process.exit(1);
});
