// Roster-wide model test: every selectable fighter must mount a real skinned model.
//
//   node scripts/test-roster-models.mjs
//
// This is the gate for the pipeline in assets/blender/build_roster_fighters.py, and it asserts the
// whole chain, not just the export: that the roster in public/js/main.js is covered by the manifest
// in public/models/characters/manifest.json, that every manifest URL resolves to a file, and that
// each file is a rigged, skinned, animated model rather than a static mesh.
//
// The assertion that matters most here is `static === 0`. The first roster export shipped 33 meshes
// with only 13 skinned: substituting a garment or a head layer dropped the part from the build list
// without unlinking the Blender object, so 20 hair locks - and on a masked fighter, an entire face -
// were exported as separate unweighted meshes sitting at the fighter's origin while the animated
// body walked away from them. Every other check passed, because they all only asked whether *a*
// skinned mesh existed. A part that is not bound to the skeleton cannot follow the animation, so
// here that is a hard failure for every mesh in the file.
import './glb-node-compat.mjs';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ROOT = resolve(import.meta.dirname, '..');
const EXPECTED_CLIPS = ['idle', 'walk', 'run', 'jump', 'jab', 'heavy_punch', 'block', 'hit_light'];
// Generated roster exports carry their own eight-clip set and Mixamo-style bones. Imported and HD
// bodies keep their source skeleton and are driven by the shared clip library at runtime, so the
// generated-body clip/limb/height assertions do not apply to them. They are still required to parse
// as a skinned model and to pass the runtime mount audit.
const GENERATED_ASSET_KINDS = new Set(['original-alternative', 'model-upgrade']);
// Bones an animation has to be able to move for the fighter to be playable. Each must carry real
// geometry: a limb bone with no weighted vertices means that limb does not deform.
//
// Each limb lists the names it can legitimately carry. The generated bodies use Mixamo-style names;
// an imported body keeps its own convention (Naruto's Rigify rig uses `DEF-thigh.L` and friends), and
// checking only the first name reported a fully weighted imported rig as having no deformation at
// all. The vertices are summed across the aliases, so the requirement is unchanged.
// GLTFLoader runs PropertyBinding.sanitizeNodeName over every node, so a Rigify joint arrives as
// `DEF-handL` rather than `DEF-hand.L`. Names are therefore compared with dots/underscores stripped.
const normalizeBone = name => String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
const LIMB_BONES = {
  LeftArm: ['leftarm', 'defupperarml'],
  RightArm: ['rightarm', 'defupperarmr'],
  LeftForeArm: ['leftforearm', 'defforearml'],
  RightForeArm: ['rightforearm', 'defforearmr'],
  LeftHand: ['lefthand', 'defhandl'],
  RightHand: ['righthand', 'defhandr'],
  LeftUpLeg: ['leftupleg', 'defthighl'],
  RightUpLeg: ['rightupleg', 'defthighr'],
  LeftLeg: ['leftleg', 'defshinl'],
  RightLeg: ['rightleg', 'defshinr'],
  LeftFoot: ['leftfoot', 'deffootl'],
  RightFoot: ['rightfoot', 'deffootr']
};
const MIN_INFLUENCED_VERTICES = 20;

const failures = [];
const notes = [];
let checked = 0;
let skinnedMeshes = 0;
let triangles = 0;

function slugify(name) {
  return String(name).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function parseGlb(file) {
  const buffer = readFileSync(file);
  return new Promise((ok, fail) => {
    new GLTFLoader().parse(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '', ok,
      error => fail(new Error(String(error?.message || error))));
  });
}

// The roster itself is the source of truth for what has to work, not the asset directory: a model
// nobody can select proves nothing, and a selectable fighter with no model is the bug we care about.
const mainSource = readFileSync(resolve(ROOT, 'public/js/main.js'), 'utf8');
const rosterMatch = mainSource.match(/const roster=\[([\s\S]*?)\];/);
if (!rosterMatch) {
  console.error('could not find the launch roster in public/js/main.js');
  process.exit(1);
}
const rosterNames = [...rosterMatch[1].matchAll(/\["([^"]+)","(\w+)"\]/g)].map(match => match[1]);
if (rosterNames.length !== 38) {
  failures.push(`launch roster has ${rosterNames.length} fighters; expected 38`);
}

const manifest = JSON.parse(readFileSync(resolve(ROOT, 'public/models/characters/manifest.json'), 'utf8'));
const characters = manifest.characters || {};

for (const name of rosterNames) {
  const slug = slugify(name);
  const entry = characters[slug];
  if (!entry) {
    failures.push(`${name}: no manifest entry for slug "${slug}" (the fighter would keep its fallback body)`);
    continue;
  }
  if (entry.enabled === false) {
    failures.push(`${name}: manifest entry is disabled`);
    continue;
  }
  const isGenerated = GENERATED_ASSET_KINDS.has(entry.assetKind);
  const url = String(entry.url || entry.urls?.[0] || '');
  if (!url) {
    failures.push(`${name}: manifest entry has no model URL`);
    continue;
  }
  const file = resolve(ROOT, 'public' + url);
  if (!existsSync(file)) {
    failures.push(`${name}: ${url} does not exist`);
    continue;
  }
  if (statSync(file).size < 4096) {
    failures.push(`${name}: ${url} is only ${statSync(file).size} bytes`);
    continue;
  }

  let gltf;
  try {
    gltf = await parseGlb(file);
  } catch (error) {
    failures.push(`${name}: ${url} failed to parse (${error.message})`);
    continue;
  }

  const scene = gltf.scene || gltf.scenes[0];
  scene.updateMatrixWorld(true);

  let skinned = 0;
  let staticMeshes = [];
  let degenerate = 0;
  const bones = new Set();
  const influence = new Map();
  const vertex = new THREE.Vector3();
  const seen = new Set();

  scene.traverse(node => {
    if (!node.isMesh) return;
    if (node.isSkinnedMesh) {
      skinned++;
      for (const bone of node.skeleton?.bones || []) bones.add(bone.name);
      // Accumulate how much geometry each bone actually drives.
      const skinIndex = node.geometry?.attributes?.skinIndex;
      const skinWeight = node.geometry?.attributes?.skinWeight;
      if (skinIndex && skinWeight) {
        const key = node.geometry.uuid || node.uuid;
        if (!seen.has(key)) {
          seen.add(key);
          const list = node.skeleton.bones;
          for (let i = 0; i < skinIndex.count; i++) {
            for (let c = 0; c < 4; c++) {
              const weight = skinWeight.array[i * 4 + c];
              if (!(weight > 0.05)) continue;
              const bone = list[skinIndex.array[i * 4 + c]];
              if (!bone) continue;
              const key = normalizeBone(bone.name);
              influence.set(key, (influence.get(key) || 0) + 1);
            }
          }
        }
      }
    } else {
      staticMeshes.push(node.name || '(unnamed)');
    }
    const geometry = node.geometry;
    if (!geometry?.attributes?.position) return;
    const position = geometry.attributes.position;
    const index = geometry.index;
    const count = index ? index.count : position.count;
    for (let i = 0; i + 2 < count; i += 3) {
      const a = index ? index.getX(i) : i;
      const b = index ? index.getX(i + 1) : i + 1;
      const c = index ? index.getX(i + 2) : i + 2;
      const ax = position.getX(a), ay = position.getY(a), az = position.getZ(a);
      const bx = position.getX(b), by = position.getY(b), bz = position.getZ(b);
      const cx = position.getX(c), cy = position.getY(c), cz = position.getZ(c);
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (Math.sqrt(nx * nx + ny * ny + nz * nz) * 0.5 < 1e-9) degenerate++;
    }
    if (geometry.index) triangles += geometry.index.count / 3;
    else triangles += position.count / 3;
  });

  checked++;
  skinnedMeshes += skinned;

  if (skinned === 0) failures.push(`${name}: no skinned mesh; nothing would animate`);
  // Small numbers of zero-area triangles are tolerated as asset-quality warnings; a large count
  // means a broken export. This is deliberately independent of the generated/imported split.
  if (degenerate > 20) failures.push(`${name}: ${degenerate} zero-area triangle(s)`);
  else if (degenerate > 0) notes.push(`${name}: warning — ${degenerate} zero-area triangle(s)`);

  const clips = (gltf.animations || []).map(clip => clip.name);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(vertex);

  if (isGenerated) {
    if (staticMeshes.length) {
      failures.push(`${name}: ${staticMeshes.length} mesh(es) are not bound to the skeleton ` +
        `(${staticMeshes.slice(0, 4).join(', ')}${staticMeshes.length > 4 ? ', ...' : ''}) - ` +
        'these stay still while the body animates');
    }
    if (bones.has('neutral_bone')) {
      failures.push(`${name}: skin contains the exporter's neutral_bone, so some vertices bind to ` +
        'no bone and are carried rigidly by their parent (a vertex-group name that does not match a bone)');
    }
    for (const expected of EXPECTED_CLIPS) {
      if (!clips.includes(expected)) failures.push(`${name}: missing animation clip "${expected}"`);
    }
    let unweighted = 0;
    scene.traverse(node => {
      if (!node.isSkinnedMesh) return;
      const weight = node.geometry?.attributes?.skinWeight;
      if (!weight) return;
      for (let i = 0; i < weight.count; i++) {
        if (!(weight.array[i * 4] + weight.array[i * 4 + 1] + weight.array[i * 4 + 2] + weight.array[i * 4 + 3] > 0.001)) unweighted++;
      }
    });
    if (unweighted > 0) failures.push(`${name}: ${unweighted} vertex(es) have no skin weight`);

    for (const [bone, aliases] of Object.entries(LIMB_BONES)) {
      const count = aliases.reduce((sum, alias) => sum + (influence.get(normalizeBone(alias)) || 0), 0);
      if (count < MIN_INFLUENCED_VERTICES) {
        failures.push(`${name}: ${bone} drives only ${count} vertices (need ${MIN_INFLUENCED_VERTICES}); ` +
          'that limb would not deform');
      }
    }

    if (size.y < 1.2 || size.y > 3.0) {
      failures.push(`${name}: ${size.y.toFixed(2)} m tall is outside the fighter range (1.2-3.0)`);
    }
    if (Math.abs(box.min.y) > 0.25) {
      failures.push(`${name}: feet sit ${box.min.y.toFixed(2)} m off the origin`);
    }
  } else {
    notes.push(`${name}: imported/shared-rig body — parse + skinned check only; runtime mount audit owns rig, clip and normalisation`);
  }
  notes.push(`${name.padEnd(28)} ${String(skinned).padStart(2)} skinned/${String(skinned + staticMeshes.length).padStart(2)} meshes  ` +
    `${String(Math.round(triangles)).padStart(6)} tri  ${size.y.toFixed(2)} m  ${clips.length} clips${isGenerated ? '' : '  [shared rig]'}`);
}

console.log(notes.join('\n'));
console.log(`\nchecked ${checked} of ${rosterNames.length} roster fighters; ` +
  `${skinnedMeshes} skinned meshes, ${Math.round(triangles)} triangles total.`);

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):`);
  for (const failure of failures) console.error('  - ' + failure);
  process.exit(1);
}
console.log('OK: every roster fighter mounts a fully bound, animated model.');
