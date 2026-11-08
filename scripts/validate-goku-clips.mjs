#!/usr/bin/env node
/**
 * Prove the authored Goku clips actually bind to the imported body.
 *
 *   node scripts/validate-goku-clips.mjs [clipGlb]
 *
 * Loads the body and the clip-only GLB with the same three.js loader the browser uses, then checks
 * every animation track resolves to a joint on the body by name, that each clip animates a
 * meaningful number of bones with a readable range, and that no value is NaN. A clip whose tracks
 * target the old 19-bone roster rig fails here exactly as it would in the game.
 */
import './glb-node-compat.mjs';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  IMPORTED_ATTACK_CLIP_SETS, IMPORTED_REACTION_CLIP_SETS,
  IMPORTED_AUTHORED_CLIP_SETS, IMPORTED_ABILITY_CLIP_SETS
} from '../public/js/anim/animation_manifest.js';

globalThis.self ||= globalThis;

const BODY = 'artifacts/goku-repair/repaired/goku.glb';
const CLIPS = process.argv[2] || 'public/models/characters/bespoke/goku_animated.glb';

const load = file => new Promise((ok, bad) => {
  const buffer = readFileSync(file);
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  new GLTFLoader().parse(data, './', ok, bad);
});

const body = await load(BODY);
const clips = await load(CLIPS);

const bodyNames = new Set();
const restQuat = new Map();
body.scene.traverse(node => {
  bodyNames.add(node.name);
  if (node.isBone || node.type === 'Bone') restQuat.set(node.name, node.quaternion.clone());
});

const results = [];
const allBound = new Set();
let failures = 0;
for (const clip of clips.animations) {
  const bound = new Set();
  const missing = new Set();
  let maxAngle = 0;
  let nan = false;
  for (const track of clip.tracks) {
    const [nodeName, property] = track.name.split('.');
    if (!bodyNames.has(nodeName)) { missing.add(nodeName); continue; }
    bound.add(nodeName);
    allBound.add(nodeName);
    if (property === 'quaternion') {
      // Measure the authored delta from the body's own rest rotation. Absolute quaternion angle only
      // says where the bone sits in bind pose, not how far the clip moves it.
      const restInverse = (restQuat.get(nodeName) || new THREE.Quaternion()).clone().invert();
      for (let i = 0; i < track.values.length; i += 4) {
        const q = new THREE.Quaternion(track.values[i], track.values[i + 1], track.values[i + 2], track.values[i + 3]);
        if (!Number.isFinite(q.x + q.y + q.z + q.w)) nan = true;
        const rel = restInverse.clone().multiply(q);
        maxAngle = Math.max(maxAngle, 2 * Math.acos(Math.min(1, Math.abs(rel.w))));
      }
    }
    for (const value of track.values) if (!Number.isFinite(value)) nan = true;
  }
  const angleDeg = +(maxAngle * 180 / Math.PI).toFixed(1);
  const ok = missing.size === 0 && bound.size >= 4 && angleDeg >= 8 && !nan && clip.duration > 0.1;
  if (!ok) failures += 1;
  results.push({ name: clip.name, duration: +clip.duration.toFixed(2), tracks: clip.tracks.length, bound: bound.size, missing: [...missing].slice(0, 4), maxAngleDeg: angleDeg, nan, ok });
}

const named = new Set(results.map(result => result.name));
const required = [
  'Goku_Idle', 'Goku_Walk', 'Goku_Run', 'Goku_Turn', 'Goku_Jump', 'Goku_DoubleJump', 'Goku_Fall', 'Goku_Land',
  'Goku_FlyTakeoff', 'Goku_Hover', 'Goku_FlyForward', 'Goku_FlyBack', 'Goku_FlyTurn', 'Goku_FlyLand',
  'Goku_Jab', 'Goku_Cross', 'Goku_Punch3', 'Goku_Punch4', 'Goku_Punch5', 'Goku_Heavy', 'Goku_Kick',
  'Goku_Launcher', 'Goku_AirPunch', 'Goku_AirKick', 'Goku_Slam', 'Goku_Grab', 'Goku_Throw',
  'Goku_Block', 'Goku_Dodge', 'Goku_HitLight', 'Goku_HitHeavy', 'Goku_Knockdown', 'Goku_GetUp',
  'Goku_Victory', 'Goku_Defeat', 'Goku_KiBlast', 'Goku_KamehamehaCharge', 'Goku_Kamehameha',
  'Goku_InstantTransmission', 'Goku_DragonFist', 'Goku_Ultimate',
  'Goku_FormSuperSaiyan', 'Goku_FormSuperSaiyanBlue', 'Goku_FormUltraInstinct'
];
const absent = required.filter(name => !named.has(name));

// Manifest cross-check: every clip the manifest can ask Goku for must exist in this GLB. A stale
// slot name does not fail a load - it binds nothing and leaves the body frozen - so it is checked
// here rather than discovered in a match.
const manifestNames = [
  ...Object.values(IMPORTED_ATTACK_CLIP_SETS.goku?.slots || {}),
  ...Object.values(IMPORTED_REACTION_CLIP_SETS.goku?.slots || {}),
  ...Object.values(IMPORTED_AUTHORED_CLIP_SETS.goku?.strikes || {}),
  ...Object.values(IMPORTED_AUTHORED_CLIP_SETS.goku?.forms || {}),
  ...Object.values(IMPORTED_ABILITY_CLIP_SETS.goku?.slots || {})
];
const manifestMissing = [...new Set(manifestNames)].filter(name => !named.has(name));
const manifestUrls = [
  IMPORTED_ATTACK_CLIP_SETS.goku?.url,
  IMPORTED_REACTION_CLIP_SETS.goku?.url,
  IMPORTED_AUTHORED_CLIP_SETS.goku?.url,
  IMPORTED_ABILITY_CLIP_SETS.goku?.url
];
const urlMismatch = manifestUrls.filter(url => url !== `/${CLIPS.replace(/^public\//, '')}`);

console.log(JSON.stringify({
  ok: failures === 0 && absent.length === 0 && manifestMissing.length === 0 && urlMismatch.length === 0,
  manifest: { slots: new Set(manifestNames).size, missing: manifestMissing, urls: [...new Set(manifestUrls)], urlMismatch },
  bodyJoints: bodyNames.size,
  clips: results.length,
  failures: results.filter(result => !result.ok),
  absent,
  totalBones: allBound.size,
  bones: [...allBound].sort(),
  sample: results.slice(0, 6)
}, null, 1));
process.exitCode = failures === 0 && absent.length === 0 && manifestMissing.length === 0 && urlMismatch.length === 0 ? 0 : 1;
