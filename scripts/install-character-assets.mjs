#!/usr/bin/env node
// Install the supplied character ZIP after extracting it, then safely enable its manifest entries.
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
  'goku/face_ss_c.webp',
  'goku/face_ss_n.webp',
  'goku/hair_c.webp',
  'goku/cloth_c.webp',
  'goku/cloth_n.webp',
  'iron-man-mark-v-rig/Iron Man Mark V Rig Materials.gltf',
  'iron-man-mark-v-rig/Iron Man Mark V Rig Materials.bin',
  'iron-man-mark-v-rig/Metal007_1K-JPG_NormalGL.jpg'
];
if (!sourceDir) {
  console.error('Could not find the extracted character package.');
  console.error('Extract the ZIP, then run: node scripts/install-character-assets.mjs /path/to/extracted-package');
  process.exit(1);
}
for (const relative of required) {
  if (!fs.existsSync(path.join(sourceDir, relative))) {
    console.error('Character package is incomplete; missing: ' + relative);
    process.exit(1);
  }
}
fs.mkdirSync(targetDir, { recursive: true });
const sameDirectory = fs.realpathSync(sourceDir) === (fs.existsSync(targetDir) ? fs.realpathSync(targetDir) : null);
if (!sameDirectory) fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });

const manifestPath = path.join(targetDir, 'manifest.json');
const manifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  : { version: 1, characters: {} };
const gokuAnimated = fs.existsSync(path.join(targetDir, 'animated', 'goku-animated.glb'));
const ironAnimated = fs.existsSync(path.join(targetDir, 'animated', 'iron-man-animated.glb'));
manifest.version = 1;
manifest.characters = manifest.characters || {};
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
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
for (const entry of Object.values(manifest.characters)) {
  if (entry?.enabled && !fs.existsSync(path.join(repoRoot, 'public', entry.url.replace(/^\//, '').replace(/%20/g, ' ')))) {
    console.error('Manifest points to a missing file: ' + entry.url);
    process.exit(1);
  }
}
console.log('Character assets installed and enabled.');
console.log('Goku: ' + manifest.characters.goku.url);
console.log('Iron Man: ' + manifest.characters.iron_man_tony_stark.url);
console.log(gokuAnimated && ironAnimated
  ? 'Both Blender-baked animation sets are registered.'
  : 'Source rigs are enabled. Run the Blender bake script to generate named animation clips.');
