#!/usr/bin/env node
/**
 * Install a prepared GLB as an existing roster character's model.
 *
 * This is a model/skin update, not a new fighter: the character id, roster position, moveset, powers and
 * statistics are untouched, and no roster entry is added. The previous file is copied aside first so the
 * upgrade can be rolled back. Usage:
 *
 *   node scripts/install-model-upgrade.mjs <characterId> <newGlb> --source "..." --license "..." --notes "..."
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const [characterId, newGlb, ...rest] = process.argv.slice(2);
if (!characterId || !newGlb) {
  console.error('usage: install-model-upgrade.mjs <characterId> <newGlb> [--source ...] [--license ...] [--notes ...]');
  process.exit(2);
}

const flags = {};
for (let i = 0; i < rest.length; i += 1) {
  if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[i + 1];
}

const manifestPath = 'public/models/characters/manifest.json';
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const entry = manifest.characters[characterId];
if (!entry) {
  console.error(`no manifest entry for "${characterId}"`);
  process.exit(1);
}
if (!existsSync(newGlb)) {
  console.error(`missing prepared model: ${newGlb}`);
  process.exit(1);
}

const target = path.join('public', entry.url.replace(/^\//, ''));
const backupDir = 'public/models/characters/original';
await mkdir(backupDir, { recursive: true });
const backup = path.join(backupDir, `${characterId}-original.glb`);

if (existsSync(target) && !existsSync(backup)) {
  await copyFile(target, backup);
}
await copyFile(newGlb, target);

entry.source = flags.source ?? entry.source;
entry.license = flags.license ?? entry.license;
entry.notes = flags.notes ?? entry.notes;
entry.assetKind = flags.kind ?? 'model-upgrade';
entry.backup = `/${backup.split(path.sep).join('/')}`;
entry.updated = new Date().toISOString().slice(0, 10);
manifest.characters[characterId] = entry;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`);

console.log(JSON.stringify({
  ok: true,
  characterId,
  target,
  backup,
  urlUnchanged: entry.url,
  rosterEntries: Object.keys(manifest.characters).length,
}, null, 2));
