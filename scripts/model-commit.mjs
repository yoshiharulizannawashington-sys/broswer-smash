#!/usr/bin/env node
// Apply one prepared import to the game, in exactly one of four ways.
//
//   node scripts/model-commit.mjs --job artifacts/dev/imports/<id> --mode replace --target link --approved
//   node scripts/model-commit.mjs --job ... --mode variant --target link --approved --name "Link (Alt 1)"
//   node scripts/model-commit.mjs --job ... --mode new --approved --name "Kaze Alt" --archetype warrior
//   node scripts/model-commit.mjs --job ... --mode prop --approved
//
// replace: swaps the manifest url for an existing character. Identity, roster slot, moveset,
//          abilities and stats are untouched; the previous url is recorded in importHistory.
// variant: registers a separately selectable alternate skin for an existing character.
// new:     registers a new playable character through scripts/register-character.mjs.
// prop:    installs a model under public/models/props/ and never touches roster or manifest.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const fail = message => { console.error(JSON.stringify({ ok: false, error: message })); process.exit(1); };
const jobPath = arg('job');
const mode = arg('mode');
if (!jobPath) fail('--job <staged import folder> is required');
if (!args.includes('--approved')) fail('refusing to change the game without --approved');
if (!['replace', 'variant', 'new', 'prop', 'rollback'].includes(mode)) fail('--mode must be replace, variant, new, prop or rollback');

const reportPath = resolve(root, jobPath, 'report.json');
if (!existsSync(reportPath)) fail(`no report at ${jobPath}/report.json`);
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
if (report.failed) fail(`that import failed (${report.error}); nothing to apply`);
if (!report.prepared) fail('the report has no prepared file');
const prepared = resolve(root, report.prepared);
if (!existsSync(prepared)) fail(`prepared file is missing: ${report.prepared}`);

const slug = value => String(value).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const manifestPath = join(root, 'public/models/characters/manifest.json');
const manifestRaw = readFileSync(manifestPath, 'utf8');
const indent = (manifestRaw.match(/^\{\n( +)"/) || [])[1] || ' ';
const manifest = JSON.parse(manifestRaw);
manifest.characters ||= {};

const rosterNames = () => {
  const main = readFileSync(join(root, 'public/js/main.js'), 'utf8');
  const parse = name => {
    const match = main.match(new RegExp(`const ${name}=\\[([\\s\\S]*?)\\];`));
    try { return match ? JSON.parse(`[${match[1]}]`) : []; } catch { return []; }
  };
  return { launch: parse('roster'), all: parse('allRoster') };
};
const before = rosterNames();

const copyInto = (folder, fileName) => {
  mkdirSync(folder, { recursive: true });
  const target = join(folder, fileName);
  copyFileSync(prepared, target);
  return target;
};

const publicPathOf = url => (typeof url === 'string' && url.startsWith('/') ? join(root, 'public', url.replace(/^\//, '')) : null);

let result = { ok: true, mode };
if (mode === 'replace') {
  const target = arg('target');
  if (!target) fail('--target <manifest key> is required for replace');
  const entry = manifest.characters[target];
  if (!entry) fail(`manifest has no character "${target}"`);
  const folder = join(root, 'public/models/characters', target);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `${slug(target)}-import-${Date.now().toString(36)}${extname(prepared) || '.glb'}`;
  copyInto(folder, name);
  const publicUrl = `/models/characters/${target}/${name}`;

  // Preserve the outgoing model as a restorable version: copy the file itself, not just its URL,
  // so a rollback still works after the new import is the active model.
  const versions = Array.isArray(entry.versions) ? [...entry.versions] : [];
  const previousUrl = entry.url || null;
  let backupFile = null;
  if (previousUrl) {
    const sourceFile = publicPathOf(previousUrl);
    if (sourceFile && existsSync(sourceFile)) {
      const versionFolder = join(folder, 'versions');
      mkdirSync(versionFolder, { recursive: true });
      const backupName = `${stamp}-${basename(sourceFile)}`;
      copyFileSync(sourceFile, join(versionFolder, backupName));
      backupFile = `public/models/characters/${target}/versions/${backupName}`;
    }
    versions.push({
      id: `v${versions.length + 1}`, url: previousUrl, file: backupFile,
      at: new Date().toISOString(), source: entry.importSource || entry.source || null,
      licence: entry.importLicence || entry.license || null
    });
  }

  entry.url = publicUrl;
  entry.format = 'gltf';
  entry.enabled = true;
  entry.assetKind = entry.assetKind || 'imported-skin';
  entry.importedAt = new Date().toISOString();
  entry.importSource = report.origin?.page || report.source || null;
  entry.importLicence = report.origin?.licence || null;
  entry.versions = versions.slice(-10);
  entry.activeModel = publicUrl;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, indent.length) + '\n');
  result = {
    ...result, url: publicUrl, manifestKey: target, identity: entry.name || target,
    kept: ['identity', 'roster slot', 'moveset', 'abilities', 'stats'],
    previousUrl, backupFile, restorableVersions: entry.versions.length - 1,
    wrote: [`public/models/characters/${target}/${name}`, backupFile, 'public/models/characters/manifest.json'].filter(Boolean)
  };
} else if (mode === 'rollback') {
  const target = arg('target');
  if (!target) fail('--target <manifest key> is required for rollback');
  const entry = manifest.characters[target];
  if (!entry) fail(`manifest has no character "${target}"`);
  const versions = Array.isArray(entry.versions) ? [...entry.versions] : [];
  const current = entry.url;
  if (!versions.length) fail(`${target} has no previous model version to restore`);
  let restored = null;
  while (versions.length) {
    const candidate = versions.pop();
    const file = candidate.file ? join(root, candidate.file) : publicPathOf(candidate.url);
    if (file && existsSync(file)) { restored = { ...candidate, file }; break; }
  }
  if (!restored) fail(`${target} has version records but none of the files still exist`);
  // Push the model being replaced onto the stack so a rollback can itself be rolled back.
  let currentBackup = null;
  const currentFile = publicPathOf(current);
  if (currentFile && existsSync(currentFile)) {
    const versionFolder = join(root, 'public/models/characters', target, 'versions');
    mkdirSync(versionFolder, { recursive: true });
    const backupName = `${new Date().toISOString().replace(/[:.]/g, '-')}-${basename(currentFile)}`;
    copyFileSync(currentFile, join(versionFolder, backupName));
    currentBackup = `public/models/characters/${target}/versions/${backupName}`;
  }
  versions.push({ id: `v${versions.length + 2}`, url: current, file: currentBackup, at: new Date().toISOString(), source: 'rollback snapshot' });
  entry.url = restored.url;
  entry.enabled = true;
  entry.activeModel = restored.url;
  entry.versions = versions.slice(-10);
  entry.rolledBackAt = new Date().toISOString();
  writeFileSync(manifestPath, JSON.stringify(manifest, null, indent.length) + '\n');
  result = {
    ...result, url: restored.url, manifestKey: target, restoredFrom: restored.url,
    wrote: ['public/models/characters/manifest.json'],
    restorableVersions: entry.versions.length - 1
  };
} else if (mode === 'variant') {
  const target = arg('target') || fail('--target <manifest key> is required for variant');
  const base = manifest.characters[target];
  if (!base) fail(`manifest has no character "${target}"`);
  const roster = before.all.find(([name]) => name === arg('baseName')) || null;
  const n = Object.keys(manifest.characters).filter(key => key.startsWith(`${target}__alt`)).length + 1;
  const key = `${target}__alt${n}`;
  const displayName = (arg('name') || `${target} Alt ${n}`).slice(0, 40);
  const folder = join(root, 'public/models/characters', key);
  const name = `${key}.glb`;
  copyInto(folder, name);
  const publicUrl = `/models/characters/${key}/${name}`;
  const archetype = arg('archetype') || roster?.[1] || 'warrior';
  execFileSync(process.execPath, ['scripts/register-character.mjs', '--manifest-key', key, '--name', displayName,
    '--archetype', archetype, '--model', publicUrl, '--source', report.origin?.page || report.source || 'Imported model'], { cwd: root, stdio: 'ignore' });
  result = { ...result, url: publicUrl, manifestKey: key, displayName, archetype, wrote: [`public/models/characters/${key}/${name}`, 'public/js/main.js', 'public/models/characters/manifest.json'] };
} else if (mode === 'new') {
  const displayName = (arg('name') || report.name || 'Imported Character').slice(0, 40);
  const key = slug(displayName).replace(/_/g, '-');
  if (manifest.characters[key]) fail(`a character named "${displayName}" already exists; use replace or variant`);
  const folder = join(root, 'public/models/characters', key);
  const name = `${key}.glb`;
  copyInto(folder, name);
  const publicUrl = `/models/characters/${key}/${name}`;
  execFileSync(process.execPath, ['scripts/register-character.mjs', '--manifest-key', key, '--name', displayName,
    '--archetype', arg('archetype') || 'warrior', '--model', publicUrl,
    '--source', report.origin?.page || report.source || 'Imported model'], { cwd: root, stdio: 'ignore' });
  result = { ...result, url: publicUrl, manifestKey: key, displayName, wrote: [`public/models/characters/${key}/${name}`, 'public/js/main.js', 'public/models/characters/manifest.json', 'assets/ingest/imported-registry.json'] };
} else {
  const displayName = report.name || 'Prop';
  const key = slug(displayName);
  const folder = join(root, 'public/models/props');
  const name = `${key}${extname(prepared) || '.glb'}`;
  copyInto(folder, name);
  const index = join(folder, 'index.json');
  const list = existsSync(index) ? JSON.parse(readFileSync(index, 'utf8')) : { props: [] };
  // Replace any earlier entry for the same prop, whatever extension an earlier run left behind.
  const stem = key.toLowerCase();
  const sameProp = item => String(item.file || '').replace(/^props\//, '').replace(/\.[^.]+$/, '').toLowerCase() === stem;
  list.props = [...(list.props || []).filter(item => !sameProp(item)), {
    name: displayName, file: `props/${name}`, source: report.origin?.page || report.source || null,
    licence: report.origin?.licence || null, kind: report.classification?.kind || 'prop',
    triangles: report.inspection?.triangles ?? null, sizeBytes: statSync(prepared).size,
    addedAt: new Date().toISOString()
  }];
  writeFileSync(index, JSON.stringify(list, null, 1) + '\n');
  result = { ...result, url: `/models/props/${name}`, wrote: [`public/models/props/${name}`, 'public/models/props/index.json'], rosterUntouched: true };
}

const after = rosterNames();
result.roster = {
  changed: mode === 'variant' || mode === 'new',
  launchAdded: after.launch.filter(([name]) => !before.launch.some(([old]) => old === name)).map(([name]) => name),
  launchRemoved: before.launch.filter(([name]) => !after.launch.some(([old]) => old === name)).map(([name]) => name)
};
result.previousRosterPreserved = result.roster.launchRemoved.length === 0;
console.log(JSON.stringify(result, null, 1));
