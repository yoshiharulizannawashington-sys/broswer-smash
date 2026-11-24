import './glb-node-compat.mjs';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
globalThis.self ||= globalThis;
const load = file => new Promise((ok, bad) => { const b = readFileSync(file); const d = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); new GLTFLoader().parse(d, './', ok, bad); });
const body = await load('public/models/characters/bespoke/goku_body.glb');
const clips = await load('public/models/characters/bespoke/goku_animated.glb');
const scene = body.scene; scene.updateMatrixWorld(true);
const byName = new Map(); scene.traverse(n => { if (n.isBone) byName.set(n.name, n); });
const at = new Map(clips.animations.map(c => [c.name, c]));
const mixer = new THREE.AnimationMixer(scene);
const rows = [];
for (const [name, t] of [['Goku_Jab', 0.14], ['Goku_Cross', 0.17], ['Goku_Punch5', 0.26], ['Goku_Heavy', 0.26], ['Goku_KamehamehaCharge', 0.55], ['Goku_Kamehameha', 0.38]]) {
  const clip = at.get(name); if (!clip) { rows.push({ name, missing: true }); continue; }
  mixer.stopAllAction(); const a = mixer.clipAction(clip); a.reset().play(); mixer.setTime(t);
  scene.updateMatrixWorld(true);
  const chest = new THREE.Vector3(); byName.get('Chest').getWorldPosition(chest);
  const l = new THREE.Vector3(), r = new THREE.Vector3();
  byName.get('LeftHand').getWorldPosition(l); byName.get('RightHand').getWorldPosition(r);
  const fwd = v => +(v.z - chest.z).toFixed(3), up = v => +(v.y - chest.y).toFixed(3);
  rows.push({ clip: name, t, leftReach: fwd(l), rightReach: fwd(r), leftUp: up(l), rightUp: up(r), handsApart: +l.distanceTo(r).toFixed(3) });
}
console.table(rows);
