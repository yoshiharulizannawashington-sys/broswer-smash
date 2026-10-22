#!/usr/bin/env node
// Validates the game's real on-disk assets and the manifests that point at them.
//
// This project deliberately stages asset paths ahead of the binaries: Goku and Iron Man
// stay disabled until the user-supplied package is installed, and every optional model has
// a procedural fallback. The validator therefore separates three outcomes:
//
//   error  a file the game requires is missing, unreadable or malformed -> exit code 1
//   warn   an optional/disabled asset that is simply not installed yet  -> exit code 0
//   ok     the file parses and contains the structure the loader expects
//
// Run: npm run validate:assets
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');

const errors = [];
const warnings = [];

const ok = label => console.log(`  ok    ${label}`);
const warn = (label, detail) => {
  warnings.push(`${label}: ${detail}`);
  console.log(`  warn  ${label} — ${detail}`);
};
const fail = (label, detail) => {
  errors.push(`${label}: ${detail}`);
  console.log(`  ERROR ${label} — ${detail}`);
};

function humanSize(bytes) {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/** Reads the JSON chunk of a binary glTF container. Returns null if it is not a valid GLB. */
function readGlbJson(path) {
  const buffer = readFileSync(path);
  if (buffer.length < 20) return null;
  const magic = buffer.readUInt32LE(0);
  const version = buffer.readUInt32LE(4);
  const declaredLength = buffer.readUInt32LE(8);
  if (magic !== 0x46546c67) return null; // 'glTF'
  if (version !== 2) return null;
  if (declaredLength !== buffer.length) {
    throw new Error(`header declares ${declaredLength} bytes but the file is ${buffer.length}`);
  }
  const jsonLength = buffer.readUInt32LE(12);
  const chunkType = buffer.readUInt32LE(16);
  if (chunkType !== 0x4e4f534a) return null; // 'JSON'
  if (20 + jsonLength > buffer.length) throw new Error('JSON chunk runs past the end of the file');
  return JSON.parse(buffer.slice(20, 20 + jsonLength).toString('utf8'));
}

function nodeNames(gltf) {
  return (gltf.nodes || []).map(node => node.name).filter(Boolean);
}

function checkGlb(label, relativePath, { minMeshes = 1, requireNodePrefix = null, minNodes = 0 } = {}) {
  const full = join(PUBLIC, relativePath);
  if (!existsSync(full)) {
    fail(label, `missing ${relativePath}`);
    return null;
  }
  let gltf;
  try {
    gltf = readGlbJson(full);
  } catch (error) {
    fail(label, `${relativePath} is not a readable GLB (${error.message})`);
    return null;
  }
  if (!gltf) {
    fail(label, `${relativePath} is not a valid glTF 2.0 binary`);
    return null;
  }
  const meshes = (gltf.meshes || []).length;
  const nodes = (gltf.nodes || []).length;
  const materials = (gltf.materials || []).length;
  const animations = (gltf.animations || []).length;
  const size = humanSize(statSync(full).size);
  if (meshes < minMeshes) {
    fail(label, `${relativePath} has only ${meshes} meshes, expected at least ${minMeshes}`);
    return gltf;
  }
  if (nodes < minNodes) {
    fail(label, `${relativePath} has only ${nodes} nodes, expected at least ${minNodes}`);
    return gltf;
  }
  if (requireNodePrefix) {
    const named = nodeNames(gltf).filter(name => name.startsWith(requireNodePrefix));
    if (named.length === 0) {
      fail(label, `${relativePath} has no node starting with "${requireNodePrefix}"`);
      return gltf;
    }
  }
  ok(`${label} — ${relativePath}, ${size}, ${meshes} meshes, ${materials} materials, ${animations} clips`);
  return gltf;
}

console.log('Browser Smash asset validation\n');

// ---------------------------------------------------------------- character library
console.log('Character prefab library');
const characterLibrary = checkGlb('character_models.glb', 'assets/character_models.glb', {
  minMeshes: 100,
  requireNodePrefix: 'character_'
});
if (characterLibrary) {
  const prefabs = nodeNames(characterLibrary).filter(name => name.startsWith('character_'));
  // models.js treats >= 57 prefabs as "loaded" and fewer as "partial", so mirror that here.
  if (prefabs.length < 57) fail('character prefabs', `only ${prefabs.length} character_* prefabs, models.js needs 57`);
  else ok(`character prefabs — ${prefabs.length} rigged fighters available for the roster`);
}

// ---------------------------------------------------------------- weapon library
console.log('\nWeapon prefab library');
const weaponLibrary = checkGlb('character_weapons.glb', 'assets/character_weapons.glb', {
  minMeshes: 68,
  requireNodePrefix: 'weapon_'
});
if (weaponLibrary) {
  const prefabs = nodeNames(weaponLibrary).filter(name => name.startsWith('weapon_'));
  if (prefabs.length < 68) fail('weapon prefabs', `only ${prefabs.length} weapon_* prefabs, models.js needs 68`);
  else ok(`weapon prefabs — ${prefabs.length} signature weapons / offhands available`);
}

// ---------------------------------------------------------------- scene assets
console.log('\nScene assets');
checkGlb('final_valley.glb', 'assets/final_valley.glb', { minMeshes: 100 });

// The arena loader keeps its own mapping in public/js/arenas/cinematic_arenas.js. Read it
// from source so the validator cannot drift from what the game actually requests.
const arenaModulePath = join(PUBLIC, 'js', 'arenas', 'cinematic_arenas.js');
if (!existsSync(arenaModulePath)) {
  fail('arena loader', 'public/js/arenas/cinematic_arenas.js is missing');
} else {
  const source = readFileSync(arenaModulePath, 'utf8');
  const block = source.match(/const MODEL_PATHS = Object\.freeze\(\{([\s\S]*?)\}\)/);
  if (!block) {
    fail('arena loader', 'could not read MODEL_PATHS from cinematic_arenas.js');
  } else {
    // Each entry is `mapKey: { file: 'x.glb', marker: 'arena_y' }`. The marker is the node the
    // Blender export writes as the arena root; it is not always named after the map key.
    const entries = [...block[1].matchAll(/([a-z]+)\s*:\s*\{\s*file\s*:\s*'([^']+)'\s*,\s*marker\s*:\s*'([^']+)'/g)]
      .map(m => ({ key: m[1], file: m[2], marker: m[3] }));
    if (entries.length === 0) fail('arena loader', 'could not parse any { file, marker } entry from MODEL_PATHS');
    for (const { key, file, marker } of entries) {
      checkGlb(`arena ${key}`, `assets/arenas/${file}`, { minMeshes: 80, requireNodePrefix: marker });
    }
  }
}

// ---------------------------------------------------------------- character manifest
console.log('\nCharacter model manifest');
const manifestPath = join(PUBLIC, 'models', 'characters', 'manifest.json');
if (!existsSync(manifestPath)) {
  fail('character manifest', 'public/models/characters/manifest.json is missing');
} else {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail('character manifest', `is not valid JSON (${error.message})`);
  }
  const entries = Object.entries(manifest?.characters || {});
  if (entries.length === 0) fail('character manifest', 'declares no characters');
  const seen = new Set();
  for (const [slug, entry] of entries) {
    if (seen.has(slug)) fail(`character ${slug}`, 'duplicate manifest id');
    seen.add(slug);
    const urls = typeof entry === 'string'
      ? [entry]
      : Array.isArray(entry) ? entry
        : Array.isArray(entry?.urls) ? entry.urls
          : entry?.url ? [entry.url] : [];
    if (urls.length === 0) {
      fail(`character ${slug}`, 'has no url/urls entry');
      continue;
    }
    const enabled = typeof entry === 'string' ? true : entry?.enabled !== false;
    for (const url of urls) {
      const decoded = decodeURIComponent(String(url)).replace(/^\/+/, '');
      const onDisk = join(PUBLIC, decoded);
      if (existsSync(onDisk)) {
        ok(`character ${slug} — ${decoded} (${humanSize(statSync(onDisk).size)}${enabled ? '' : ', disabled'})`);
      } else if (enabled) {
        // An enabled entry pointing at nothing makes the game silently fall back, which is
        // exactly the failure this check exists to catch.
        fail(`character ${slug}`, `enabled but ${decoded} does not exist`);
      } else {
        warn(`character ${slug}`, `${decoded} not installed; the procedural fallback is used until the source package is added`);
      }
    }
  }
}

// ---------------------------------------------------------------- optional model folders
console.log('\nInstalled character packages');
const characterRoot = join(PUBLIC, 'models', 'characters');
const findModelFiles = dir => {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) found.push(...findModelFiles(full));
    else if (['.glb', '.gltf', '.fbx'].includes(extname(item.name).toLowerCase())) found.push(full);
  }
  return found;
};
const installed = findModelFiles(characterRoot);
if (installed.length === 0) {
  ok('no user-supplied Goku / Iron Man package installed — the game runs on its own rigged library');
} else {
  for (const file of installed) ok(`installed model — ${relative(PUBLIC, file)} (${humanSize(statSync(file).size)})`);
}

// ---------------------------------------------------------------- summary
console.log('');
if (warnings.length) {
  console.log(`${warnings.length} warning(s): optional assets that are not installed yet.`);
  for (const warning of warnings) console.log(`  · ${warning}`);
}
if (errors.length) {
  console.error(`${errors.length} error(s):`);
  for (const error of errors) console.error(`  · ${error}`);
  process.exit(1);
}
console.log('Asset validation passed. Fallbacks remain in place for every optional asset.');
