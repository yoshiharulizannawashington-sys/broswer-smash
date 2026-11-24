#!/usr/bin/env node
// Register a prepared body as a playable character, without hand-editing several files.
//
//   node scripts/register-character.mjs --manifest-key foo --name "Foo" --archetype warrior \
//        --model /models/characters/imported/foo.glb [--label "FOO BLAST"]
//
// Writes, idempotently:
//   · public/models/characters/manifest.json        entry for the model itself
//   · public/js/main.js                            roster + display entries (allRoster and launch roster)
//   · public/js/combat/imported_profiles.js        signature special + combat multipliers
//   · public/js/combat/imported_movesets.js        moveset and ultimate for this identity
//
// Existing characters are never removed or reordered; a re-run updates that character's entry.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const manifestKey = arg('manifest-key');
const name = arg('name');
const archetype = arg('archetype', 'warrior');
const model = arg('model');
if (!manifestKey || !name || !model) {
  console.error('usage: node scripts/register-character.mjs --manifest-key <key> --name "Display" --model /models/... [--archetype warrior]');
  process.exit(1);
}
const slug = manifestKey.toLowerCase().replace(/[^a-z0-9]+/g, '_');
const archetypes = ['warrior', 'ninja', 'brawler', 'mage', 'cyborg'];
const kind = archetypes.includes(archetype) ? archetype : 'warrior';

// ------------------------------------------------------------------ manifest
const manifestPath = resolve(root, 'public/models/characters/manifest.json');
const manifestRaw = readFileSync(manifestPath, 'utf8');
const indent = (manifestRaw.match(/^\{\n( +)"/) || [])[1] || ' ';
const manifest = JSON.parse(manifestRaw);
manifest.characters ||= {};
manifest.characters[manifestKey] = {
  ...(manifest.characters[manifestKey] || {}),
  url: model,
  format: 'gltf',
  enabled: true,
  yawOffset: Number(arg('yaw', 0)),
  assetKind: 'imported',
  source: arg('source', 'Imported through scripts/prepare-character.mjs'),
  notes: arg('notes', 'Imported character. Licence metadata is optional and never gates loading.'),
  clips: ['Idle', 'Walk', 'Run', 'Jump', 'Punch', 'Kick', 'Kamehameha']
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, indent.length) + '\n');

// ------------------------------------------------------------------ roster (main.js)
const mainPath = resolve(root, 'public/js/main.js');
let main = readFileSync(mainPath, 'utf8');
const rosterEntry = `["${name}","${kind}"]`;
const alreadyInAll = new RegExp(`\\["${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}","`).test(main);
if (!alreadyInAll) {
  const allAnchor = /const allRoster=\[([\s\S]*?)\];/;
  if (!allAnchor.test(main)) { console.error('register: could not find the allRoster table in main.js'); process.exit(1); }
  main = main.replace(allAnchor, (match, body) => `const allRoster=[${body},${rosterEntry}];`);
  const launchAnchor = /const roster=\[([\s\S]*?)\];/;
  if (!launchAnchor.test(main)) { console.error('register: could not find the launch roster table in main.js'); process.exit(1); }
  main = main.replace(launchAnchor, (match, body) => `const roster=[${body},${rosterEntry}];`);
  writeFileSync(mainPath, main);
}

// ------------------------------------------------------------------ registry of imported characters
// The registry, not the generated modules, is the source of truth. Writing only the character
// being registered would delete every previously imported fighter's moveset, so each run merges
// this entry in and regenerates both modules from all of them.
const registryPath = resolve(root, 'assets/ingest/imported-registry.json');
mkdirSync(resolve(root, 'assets/ingest'), { recursive: true });
const registry = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, 'utf8')) : {};

const specialLabel = arg('label', `${name.toUpperCase()} BURST`);
const special = {
  label: specialLabel,
  type: arg('type', 'orb'),
  color: Number(arg('color', '0x6fe0ff')),
  damage: Number(arg('damage', 16)),
  speed: 30,
  cooldown: 0.82,
  stun: 0.44,
  knockback: 5.6
};
const combat = { damage: 1.02, knockback: 1, weight: 1, launch: 1 };
const moveset = {
  key: slug,
  style: arg('style', 'Imported fighter'),
  lights: [`${name} Jab`, `Rising Cross`, 'Turning Kick'],
  heavy: ['Charged Blow', 'Ground Breaker'],
  aerial: `${name} Drop`,
  ultimate: {
    label: specialLabel, behaviour: 'beam', beamStyle: 'twoHanded',
    damage: Number(arg('ultimate-damage', 29)), kbs: 112, launchY: 9.4, stun: 0.9,
    range: 28, width: 2.5, color: Number(arg('color', '0x6fe0ff')),
    startup: 0.62, active: 0.8, recovery: 0.62,
    note: 'Generated ultimate for an imported character: one beam down a lane, interruptible during the charge.'
  },
  note: 'Generated identity profile. Re-run registration to change it.'
};
registry[slug] = { name, special, combat, moveset };
const order = Object.keys(registry).sort();
writeFileSync(registryPath, JSON.stringify(Object.fromEntries(order.map(key => [key, registry[key]])), null, 1) + '\n');

const indentJson = value => JSON.stringify(value, null, 2).split('\n').join('\n  ');
const profileText = `// Generated by scripts/register-character.mjs — one entry per imported character.
// Source of truth: assets/ingest/imported-registry.json. Re-run registration to update it.
export const IMPORTED_SPECIAL_MOVES = Object.freeze({
${order.map(key => `  ${key}: ${indentJson(registry[key].special)}`).join(',\n')}
});

export const IMPORTED_COMBAT_PROFILES = Object.freeze({
${order.map(key => `  ${key}: ${JSON.stringify(registry[key].combat)}`).join(',\n')}
});
`;
writeFileSync(resolve(root, 'public/js/combat/imported_profiles.js'), profileText);

const movesetText = `// Generated by scripts/register-character.mjs — movesets for imported characters.
// Source of truth: assets/ingest/imported-registry.json. Re-run registration to update it.
export const IMPORTED_MOVESETS = Object.freeze({
${order.map(key => `  ${key}: Object.freeze(${indentJson(registry[key].moveset)})`).join(',\n')}
});
`;
writeFileSync(resolve(root, 'public/js/combat/imported_movesets.js'), movesetText);

console.log(JSON.stringify({
  registered: { manifestKey, slug, name, archetype: kind, model },
  wrote: ['public/models/characters/manifest.json', 'public/js/main.js', 'public/js/combat/imported_profiles.js', 'public/js/combat/imported_movesets.js', 'assets/ingest/imported-registry.json'],
  registryEntries: Object.keys(registry),
  rosterAlreadyHadEntry: alreadyInAll
}, null, 1));
