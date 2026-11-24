// Numerically solve the shoulder/elbow rotation that puts Goku's fist furthest in front of his
// chest, using the mounted body's own bones. Avoids guessing which local axis is "forward".
import './glb-node-compat.mjs';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
globalThis.self ||= globalThis;
const load = file => new Promise((ok, bad) => { const b = readFileSync(file); const d = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); new GLTFLoader().parse(d, './', ok, bad); });
const body = await load('public/models/characters/bespoke/goku_body.glb');
const scene = body.scene; scene.updateMatrixWorld(true);
const bone = name => { let hit = null; scene.traverse(n => { if (!hit && n.isBone && n.name === name) hit = n; }); return hit; };
const chest = bone('Chest'), arm = bone('RightArm'), fore = bone('RightForeArm'), shoulder = bone('RightShoulder'), hand = bone('RightHand');
const rest = new Map([[arm, arm.quaternion.clone()], [fore, fore.quaternion.clone()], [shoulder, shoulder.quaternion.clone()]]);
const DEG = Math.PI / 180;
const q = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x * DEG, y * DEG, z * DEG, 'XYZ'));
const chestPos = new THREE.Vector3(); chest.getWorldPosition(chestPos);
const rows = [];
for (let x = -140; x <= 20; x += 10) for (let y = -40; y <= 40; y += 20) for (let z = -30; z <= 90; z += 10) for (const elbow of [0, 10, 20, 30]) {
  arm.quaternion.copy(rest.get(arm)).multiply(q(x, y, z));
  fore.quaternion.copy(rest.get(fore)).multiply(q(elbow, 0, 0));
  shoulder.quaternion.copy(rest.get(shoulder));
  scene.updateMatrixWorld(true);
  const p = new THREE.Vector3(); hand.getWorldPosition(p);
  const forward = p.z - chestPos.z, lateral = p.x - chestPos.x, height = p.y - chestPos.y;
  rows.push({ x, y, z, elbow, forward: +forward.toFixed(3), lateral: +lateral.toFixed(3), height: +height.toFixed(3) });
}
rows.sort((a, b) => (b.forward - Math.abs(b.lateral) * .35 - Math.abs(b.height) * .5) - (a.forward - Math.abs(a.lateral) * .35 - Math.abs(a.height) * .5));
console.log('TOP');
for (const row of rows.slice(0, 12)) console.log(JSON.stringify(row));
console.log('MAX_FORWARD', JSON.stringify(rows.slice().sort((a, b) => b.forward - a.forward).slice(0, 4)));
