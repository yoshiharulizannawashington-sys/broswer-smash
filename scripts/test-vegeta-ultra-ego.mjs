// Focused acceptance test for the supplied Ultra Ego Vegeta body.
//
//   node scripts/test-vegeta-ultra-ego.mjs
//
// This is not a screenshot test. It proves the promoted GLB still contains the supplied appearance
// (4 skinned meshes, 3 embedded textures, 311-joint skin) and the complete retargeted 25-clip
// animation set, and that the manifest/shared rig catalog point at that exact file. Visual and
// gameplay acceptance remains a separate in-game check.
import './glb-node-compat.mjs';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ROOT = resolve(import.meta.dirname, '..');
const URL = '/models/characters/roster/vegeta_ultra_ego.glb';
const FILE = resolve(ROOT, 'public' + URL);
const EXPECTED = [
  'idle', 'walk', 'run', 'sprint', 'jump', 'land', 'dodge', 'charge', 'beam', 'launcher',
  'jab', 'heavy_punch', 'block', 'hit_light', 'hit_heavy', 'knockdown', 'get_up', 'fly',
  'hover', 'air_attack', 'parry', 'strafe', 'throw', 'victory', 'defeat'
];

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

const manifest = JSON.parse(readFileSync(resolve(ROOT, 'public/models/characters/manifest.json'), 'utf8'));
check(manifest.characters?.vegeta?.url === URL, `manifest vegeta.url is ${manifest.characters?.vegeta?.url}`);
check(manifest.characters?.vegeta?.rollbackUrl === '/models/characters/roster/vegeta.glb',
  'manifest must retain the authored body as rollbackUrl');
check(manifest.characters?.vegeta?.license === 'CC BY 4.0', 'manifest licence is not CC BY 4.0');

const shared = readFileSync(resolve(ROOT, 'public/js/anim/shared_rig_family_data.js'), 'utf8');
check(shared.includes(`url: "${URL}"`), 'shared rig family catalog does not point at the promoted GLB');

const bytes = readFileSync(FILE);
check(bytes.subarray(0, 4).toString('ascii') === 'glTF', 'promoted asset is not a GLB');
const gltf = await new Promise((ok, fail) => new GLTFLoader().parse(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', ok,
  error => fail(new Error(String(error?.message || error)))));
const scene = gltf.scene || gltf.scenes[0];
scene.updateMatrixWorld(true);

let bones = 0, skinned = 0, staticMeshes = 0, triangles = 0;
scene.traverse(node => {
  if (node.isBone) bones += 1;
  if (node.isMesh) {
    if (node.isSkinnedMesh) skinned += 1;
    else staticMeshes += 1;
    const g = node.geometry;
    if (g?.index) triangles += g.index.count / 3;
    else if (g?.attributes?.position) triangles += g.attributes.position.count / 3;
  }
});
const clips = gltf.animations || [];
const names = clips.map(c => c.name);
const box = new THREE.Box3().setFromObject(scene);
const size = box.getSize(new THREE.Vector3());

check(bones >= 300, `skeleton has ${bones} bones, expected the supplied 311-joint rig`);
check(skinned === 4, `expected 4 skinned meshes, found ${skinned}`);
check(staticMeshes === 0, `${staticMeshes} static mesh(es) would not follow the skeleton`);
check(triangles >= 29000 && triangles <= 30000, `triangle count ${triangles} does not match the supplied body`);
check(clips.length === 25, `expected 25 clips, found ${clips.length}`);
for (const name of EXPECTED) check(names.includes(name), `missing clip ${name}`);
for (const clip of clips) {
  const rotations = clip.tracks.filter(t => /\.quaternion$/.test(t.name)).length;
  check(rotations >= 19, `${clip.name}: only ${rotations} rotation tracks`);
  check(clip.duration > 0.1, `${clip.name}: duration ${clip.duration}`);
}
check(size.y > 1.2 && size.y < 3.0, `height ${size.y.toFixed(3)} m is outside the fighter range`);
check(Math.abs(box.min.y) < 0.25, `feet sit ${box.min.y.toFixed(3)} m off the model origin`);

const textures = new Set();
scene.traverse(node => {
  for (const material of [].concat(node.material || [])) {
    for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap']) {
      if (material?.[key]) textures.add(material[key].uuid);
    }
  }
});
check(textures.size >= 3, `only ${textures.size} texture map(s) survived the bake`);

const retarget = JSON.parse(readFileSync(resolve(ROOT, 'artifacts/vegeta-ultra-ego/retarget-report.json'), 'utf8'));
check(retarget.clips === 25, `retarget report has ${retarget.clips} clips`);
check(retarget.unresolvedCount === 0, `retarget report has ${retarget.unresolvedCount} unresolved nodes`);
check(retarget.perClip.every(c => c.mapped === 19 && c.missing.length === 0), 'a baked clip is missing a canonical joint');

const bytesExpected = statSync(FILE).size;
check(manifest.characters.vegeta.verified.bytes === bytesExpected, 'manifest byte count is stale');

console.log(JSON.stringify({
  file: URL, bytes: bytesExpected, bones, skinnedMeshes: skinned, staticMeshes,
  triangles: Math.round(triangles), clips: clips.length, textures: textures.size,
  bounds: { height: +size.y.toFixed(3), feetY: +box.min.y.toFixed(3) },
  retarget: { clips: retarget.clips, mapped: retarget.perClip[0]?.mapped, unresolved: retarget.unresolvedCount }
}, null, 2));

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):`);
  for (const failure of failures) console.error('  - ' + failure);
  process.exit(1);
}
console.log('OK: Ultra Ego appearance and 25-clip retarget are present and bound.');
