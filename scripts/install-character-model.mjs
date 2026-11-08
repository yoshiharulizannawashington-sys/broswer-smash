#!/usr/bin/env node
// Install one downloaded character model (a Sketchfab GLB, a glTF folder, or an FBX) into the
// game's manifest, safely and repeatably.
//
//   node scripts/install-character-model.mjs <file-or-folder> --identity "Iron Spider" \
//        [--facing 180] [--attribution "…"] [--license "CC BY 4.0"] [--source <url>] [--dry-run]
//
// What it does: checks the model actually contains geometry (and reports skins, bones, clips
// and measured height), copies it under public/models/characters/<slug>/, and merges a manifest
// entry pointing at it. It refuses to enable an entry whose files are missing, never deletes
// another character's registration, and prints the one-line roster change that is still needed.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

globalThis.self = globalThis;

const repoRoot = process.cwd();
const publicRoot = path.join(repoRoot, 'public');
const charactersRoot = path.join(publicRoot, 'models', 'characters');
const manifestPath = path.join(charactersRoot, 'manifest.json');

function fail(message) {
  console.error('error: ' + message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { source: null, identity: null, facing: 0, attribution: '', license: '', url: '', dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--identity') args.identity = argv[++i];
    else if (arg === '--facing') args.facing = Number(argv[++i]);
    else if (arg === '--attribution') args.attribution = argv[++i];
    else if (arg === '--license') args.license = argv[++i];
    else if (arg === '--source') args.url = argv[++i];
    else if (arg === '--dry-run') args.dryRun = true;
    else if (!args.source) args.source = arg;
    else fail('unexpected argument: ' + arg);
  }
  if (!args.source) fail('usage: node scripts/install-character-model.mjs <file-or-folder> --identity "Iron Spider"');
  if (!args.identity) fail('--identity is required, e.g. --identity "Iron Spider"');
  if (!Number.isFinite(args.facing)) fail('--facing must be a number of degrees');
  return args;
}

function slug(identity) {
  return String(identity).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Find the model inside a downloaded folder: prefer .glb, then .gltf, then .fbx. */
function locateModel(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return { kind: 'file', file: target };
  const found = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(glb|gltf|fbx)$/i.test(entry.name)) found.push(full);
    }
  };
  walk(target);
  if (!found.length) fail('no .glb, .gltf or .fbx file inside ' + target);
  const rank = file => (/\.glb$/i.test(file) ? 0 : /\.gltf$/i.test(file) ? 1 : 2);
  found.sort((a, b) => rank(a) - rank(b) || fs.statSync(b).size - fs.statSync(a).size);
  return { kind: 'directory', dir: target, file: found[0] };
}

function assertContained(baseDir, relative, description) {
  // Resolve the base first: the caller may hand us a relative glTF path (the fetch pipeline
  // passes one), and comparing an absolute resolution against a relative prefix rejected every
  // sibling buffer as an escape even when it sat exactly next to the glTF.
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, decodeURIComponent(relative.split(/[?#]/, 1)[0]));
  if (resolved !== base && !resolved.startsWith(base + path.sep)) fail('resource escapes its folder in ' + description + ': ' + relative);
  if (!fs.existsSync(resolved)) fail('missing referenced resource in ' + description + ': ' + relative);
  return resolved;
}

function validateGltf(gltfPath) {
  let document;
  try {
    document = JSON.parse(fs.readFileSync(gltfPath, 'utf8'));
  } catch (error) {
    fail('could not parse ' + gltfPath + ': ' + error.message);
  }
  for (const buffer of document.buffers || []) {
    if (buffer.uri && !buffer.uri.startsWith('data:')) assertContained(path.dirname(gltfPath), buffer.uri, gltfPath);
  }
  for (const image of document.images || []) {
    if (image.uri && !image.uri.startsWith('data:')) assertContained(path.dirname(gltfPath), image.uri, gltfPath);
  }
  return document;
}

async function inspectModel(file) {
  if (!/\.glb$/i.test(file) && !/\.gltf$/i.test(file)) {
    return { inspected: false, reason: 'FBX is normalised at runtime; geometry is not inspected here' };
  }
  const buffer = fs.readFileSync(file);
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const gltf = await new Promise((ok, bad) => new GLTFLoader().parse(data, path.dirname(file) + path.sep, ok, bad));
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  let meshes = 0;
  let vertices = 0;
  let skinned = 0;
  let bones = 0;
  scene.traverse(node => {
    if (node.isBone) bones++;
    if (node.isSkinnedMesh) skinned++;
    if (!node.isMesh) return;
    meshes++;
    vertices += node.geometry?.attributes?.position?.count || 0;
  });
  const height = size.y;
  return {
    inspected: true,
    meshes,
    vertices,
    skinned,
    bones,
    clips: (gltf.animations || []).map(clip => clip.name),
    height: +height.toFixed(3),
    width: +size.x.toFixed(3),
    depth: +size.z.toFixed(3),
    feetBelowOrigin: +(-box.min.y).toFixed(3),
    // A model whose height is not the largest dimension is authored lying down; the runtime
    // only rotates about Y, so this needs fixing in the exporter rather than at load time.
    upright: height >= Math.max(size.x, size.z) * 0.55
  };
}

const args = parseArgs(process.argv);
const identitySlug = slug(args.identity);
const located = locateModel(args.source);
const sourceFile = located.file;
const ext = path.extname(sourceFile).toLowerCase();

if (ext === '.gltf') validateGltf(sourceFile);
else if (ext === '.glb') {
  const head = fs.readFileSync(sourceFile).subarray(0, 4).toString('utf8');
  if (head !== 'glTF') fail(sourceFile + ' is not a GLB (missing glTF magic)');
}
const info = await inspectModel(sourceFile);
if (info.inspected && info.meshes === 0) fail('the model contains no meshes');
if (info.inspected && !info.upright) {
  fail(`the model measures ${info.width} x ${info.height} x ${info.depth} m - it is not standing upright; re-export it Y-up before installing`);
}

const targetDir = path.join(charactersRoot, identitySlug);
const targetName = identitySlug + ext;
const targetFile = path.join(targetDir, targetName);
const publicUrl = '/models/characters/' + path.posix.join(identitySlug, targetName);

console.log(`source    ${path.relative(repoRoot, sourceFile)}`);
console.log(`identity  ${args.identity} (${identitySlug})`);
if (info.inspected) {
  console.log(`geometry  ${info.meshes} meshes, ${info.vertices} vertices, ${info.skinned} skinned, ${info.bones} bones`);
  console.log(`height    ${info.height} m (x ${info.width}, z ${info.depth}); feet ${info.feetBelowOrigin} m below the origin`);
  console.log(`clips     ${info.clips.length ? info.clips.join(', ') : 'none (the controller will pose the skeleton procedurally)'}`);
} else {
  console.log('geometry  not inspected (' + info.reason + ')');
}

if (args.dryRun) {
  console.log('\nDry run: nothing written. Remove --dry-run to install.');
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });
if (located.kind === 'directory' && ext !== '.fbx') {
  // Copy the sibling buffers and textures a .gltf references, keeping relative paths.
  fs.cpSync(path.dirname(sourceFile), targetDir, { recursive: true, force: true, filter: file => !/\.(fbx|gltf|glb)$/i.test(file) });
}
fs.copyFileSync(sourceFile, targetFile);
if (ext === '.gltf') validateGltf(targetFile);

const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { version: 1, characters: {} };
manifest.version = Math.max(1, Number(manifest.version) || 1);
manifest.characters = manifest.characters && typeof manifest.characters === 'object' ? manifest.characters : {};
const previous = manifest.characters[identitySlug] || {};
manifest.characters[identitySlug] = {
  ...previous,
  url: publicUrl,
  format: ext === '.fbx' ? 'fbx' : 'gltf',
  enabled: true,
  yawOffset: Number(args.facing) || 0,
  ...(args.license ? { license: args.license } : {}),
  ...(args.attribution ? { attribution: args.attribution } : {}),
  ...(args.source ? { source: args.source } : {})
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

for (const [key, entry] of Object.entries(manifest.characters)) {
  if (!entry?.enabled || typeof entry.url !== 'string') continue;
  const resolved = path.resolve(publicRoot, decodeURIComponent(entry.url.replace(/^\/+/, '')));
  if (!fs.existsSync(resolved)) fail('manifest entry ' + key + ' points at a missing file: ' + entry.url);
}

console.log(`\ninstalled ${publicUrl}`);
console.log('manifest  ' + path.relative(repoRoot, manifestPath));
if (args.attribution) console.log('attribution recorded: ' + args.attribution);
console.log(
  '\nStill needed: the character must be selectable. Add it to the launch roster in\n' +
  'public/js/main.js (the `roster` array) as ["' + args.identity + '", "cyborg"], add a look in\n' +
  'public/js/models.js if the procedural fallback should match it, and give it a signature move\n' +
  'in SPECIAL_MOVES. Then run: npm run audit:roster && npm run build'
);
