#!/usr/bin/env node
// Install the supplied character package without overwriting project docs or other manifest entries.
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const sourceRoot = path.resolve(process.argv[2] || repoRoot);
const sourceCandidates = [
  path.join(sourceRoot, 'public', 'models', 'characters'),
  path.join(sourceRoot, 'models', 'characters')
];
const sourceDir = sourceCandidates.find(candidate => fs.existsSync(path.join(candidate, 'goku', 'Goku.fbx')));
const targetDir = path.join(repoRoot, 'public', 'models', 'characters');
const required = [
  'goku/Goku.fbx',
  'goku/skin_c.webp',
  'goku/skin_n.webp',
  'goku/skin_ORM.webp',
  'goku/face_ss_c.webp',
  'goku/face_ss_n.webp',
  'goku/face_ss_ORM.webp',
  'goku/hair_c.webp',
  'goku/hair_ss_n.webp',
  'goku/cloth_c.webp',
  'goku/cloth_n.webp',
  'goku/cloth_ORM.webp',
  'iron-man-mark-v-rig/Iron Man Mark V Rig Materials.gltf',
  'iron-man-mark-v-rig/Iron Man Mark V Rig Materials.bin',
  'iron-man-mark-v-rig/Metal007_1K-JPG_NormalGL.jpg',
  'iron-man-mark-v-rig/Metal007_1K-JPG_Metalness_jpg-Metal007_1K-JPG_Roughness_jpg.png',
  'iron-man-mark-v-rig/Metal007_1K-JPG_Metalness-Metal007_1K-JPG_Roughness.png'
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function assertFile(filePath, description) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    fail('Character package is incomplete; missing file: ' + description);
  }
}

function resolveContained(baseDir, uri, description) {
  let decoded;
  try {
    decoded = decodeURIComponent(uri.split(/[?#]/, 1)[0]);
  } catch {
    fail('Invalid percent-encoded resource URI in ' + description + ': ' + uri);
  }
  if (!decoded || decoded.startsWith('data:') || /^[a-z]+:/i.test(decoded) || decoded.startsWith('//')) {
    fail('Character resources must be bundled as relative files; unsupported URI in ' + description + ': ' + uri);
  }
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, decoded);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    fail('Resource escapes its model folder in ' + description + ': ' + uri);
  }
  return resolved;
}

function validateGltfResources(gltfPath) {
  let document;
  try {
    document = JSON.parse(fs.readFileSync(gltfPath, 'utf8'));
  } catch (error) {
    fail('Could not parse glTF file ' + gltfPath + ': ' + error.message);
  }
  const resources = [
    ...(document.buffers || []).map(item => ({ ...item, kind: 'buffer' })),
    ...(document.images || []).map(item => ({ ...item, kind: 'image' }))
  ];
  for (const resource of resources) {
    if (!resource.uri || resource.uri.startsWith('data:')) continue;
    const resourcePath = resolveContained(path.dirname(gltfPath), resource.uri, gltfPath);
    assertFile(resourcePath, path.relative(path.dirname(gltfPath), resourcePath));
    if (resource.kind === 'buffer' && Number.isFinite(resource.byteLength)) {
      const actualBytes = fs.statSync(resourcePath).size;
      if (actualBytes < resource.byteLength) {
        fail('glTF buffer is truncated: ' + resourcePath + ' (expected at least ' + resource.byteLength + ' bytes, found ' + actualBytes + ')');
      }
    }
  }
}

if (!sourceDir) {
  fail('Could not find the extracted character package. Extract the ZIP, then run: node scripts/install-character-assets.mjs /path/to/extracted-package');
}
for (const relative of required) assertFile(path.join(sourceDir, relative), relative);
validateGltfResources(path.join(sourceDir, 'iron-man-mark-v-rig', 'Iron Man Mark V Rig Materials.gltf'));

fs.mkdirSync(targetDir, { recursive: true });
const manifestPath = path.join(targetDir, 'manifest.json');
const packageManifestPath = path.join(sourceDir, 'manifest.json');
const manifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  : fs.existsSync(packageManifestPath)
    ? JSON.parse(fs.readFileSync(packageManifestPath, 'utf8'))
    : { version: 1, characters: {} };

// Copy only model asset directories. Do not overwrite the game's existing README or manifest.
if (path.resolve(sourceDir) !== path.resolve(targetDir)) {
  for (const directory of ['goku', 'iron-man-mark-v-rig', 'animated']) {
    const sourcePath = path.join(sourceDir, directory);
    if (fs.existsSync(sourcePath)) {
      fs.cpSync(sourcePath, path.join(targetDir, directory), { recursive: true, force: true });
    }
  }
}

const gokuAnimated = fs.existsSync(path.join(targetDir, 'animated', 'goku-animated.glb'));
const ironAnimated = fs.existsSync(path.join(targetDir, 'animated', 'iron-man-animated.glb'));
manifest.version = Math.max(1, Number(manifest.version) || 1);
manifest.characters = manifest.characters && typeof manifest.characters === 'object' ? manifest.characters : {};
manifest.characters.goku = {
  url: gokuAnimated ? '/models/characters/animated/goku-animated.glb' : '/models/characters/goku/Goku.fbx',
  format: gokuAnimated ? 'gltf' : 'fbx',
  textureSet: 'goku',
  enabled: true
};
manifest.characters.iron_man_tony_stark = {
  url: ironAnimated
    ? '/models/characters/animated/iron-man-animated.glb'
    : '/models/characters/iron-man-mark-v-rig/Iron%20Man%20Mark%20V%20Rig%20Materials.gltf',
  format: 'gltf',
  enabled: true
};

for (const [identity, entry] of Object.entries(manifest.characters)) {
  if (!entry?.enabled || typeof entry.url !== 'string') continue;
  const publicRoot = path.resolve(repoRoot, 'public');
  const relativeUrl = decodeURIComponent(entry.url.split(/[?#]/, 1)[0].replace(/^\/+/, ''));
  const modelPath = path.resolve(publicRoot, relativeUrl);
  if (modelPath !== publicRoot && !modelPath.startsWith(publicRoot + path.sep)) {
    fail('Manifest path escapes public directory for ' + identity + ': ' + entry.url);
  }
  assertFile(modelPath, 'manifest target for ' + identity + ': ' + entry.url);
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log('Character assets installed and enabled.');
console.log('Goku: ' + manifest.characters.goku.url);
console.log('Iron Man: ' + manifest.characters.iron_man_tony_stark.url);
console.log(gokuAnimated && ironAnimated
  ? 'Both Blender-baked animation sets are registered.'
  : 'Source rigs are enabled. Run the Blender bake script to generate named animation clips.');
