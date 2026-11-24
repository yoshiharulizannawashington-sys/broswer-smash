#!/usr/bin/env node
// Locomotion phase probe: verifies that arms counter-swing the legs and that the hands are no
// longer parked at guard height. Prints world-space reach/height for each quarter of the cycle.
import './glb-node-compat.mjs';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
globalThis.self ||= globalThis;
const load = file => new Promise((ok, bad) => {
  const b = readFileSync(file);
  const d = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  new GLTFLoader().parse(d, './', ok, bad);
});
const body = await load('public/models/characters/bespoke/goku_body.glb');
const clips = await load('public/models/characters/bespoke/goku_animated.glb');
const scene = body.scene;
scene.updateMatrixWorld(true);
const byName = new Map();
scene.traverse(n => { if (n.isBone) byName.set(n.name, n); });
const at = new Map(clips.animations.map(c => [c.name, c]));
const mixer = new THREE.AnimationMixer(scene);
const rows = [];
for (const name of ['Goku_Walk', 'Goku_Run']) {
  const clip = at.get(name);
  if (!clip) { rows.push({ clip: name, missing: true }); continue; }
  for (const fraction of [0, 0.25, 0.5, 0.75]) {
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.reset().play();
    mixer.setTime(clip.duration * fraction);
    scene.updateMatrixWorld(true);
    const pos = bone => byName.get(bone).getWorldPosition(new THREE.Vector3());
    const chest = pos('Chest');
    const hips = pos('Hips');
    const lh = pos('LeftHand'), rh = pos('RightHand');
    const lf = pos('LeftFoot'), rf = pos('RightFoot');
    const le = pos('LeftForeArm'), re = pos('RightForeArm');
    rows.push({
      clip: name.replace('Goku_', ''), phase: fraction,
      chestY: +chest.y.toFixed(2), leftHandY: +lh.y.toFixed(2), rightHandY: +rh.y.toFixed(2),
      leftHandZ: +(lh.z - hips.z).toFixed(2), rightHandZ: +(rh.z - hips.z).toFixed(2),
      leftHandUp: +(lh.y - chest.y).toFixed(2), rightHandUp: +(rh.y - chest.y).toFixed(2),
      leftElbowUp: +(le.y - chest.y).toFixed(2), rightElbowUp: +(re.y - chest.y).toFixed(2),
      leftFootZ: +(lf.z - hips.z).toFixed(2), rightFootZ: +(rf.z - hips.z).toFixed(2),
      leftFootY: +lf.y.toFixed(2), rightFootY: +rf.y.toFixed(2)
    });
  }
}
console.table(rows);
