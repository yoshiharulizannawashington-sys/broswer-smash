// Which local axis actually curls Saitama's fingers? The glove is skinned to the finger chains, so a
// wrong axis splays the hand instead of closing it. Measure fingertip travel toward the palm.
import './glb-node-compat.mjs';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
globalThis.self ||= globalThis;
const b = readFileSync('public/models/characters/imported/saitama/saitama.glb');
const g = await new Promise((ok, bad) => new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', ok, bad));
const s = g.scene; s.updateMatrixWorld(true);
const bones = []; s.traverse(n => { if (n.isBone) bones.push(n); });
const norm = v => String(v).toLowerCase().replace(/[^a-z0-9]/g, '');
const find = f => bones.find(n => norm(n.name) === norm(f)) || bones.find(n => norm(n.name).startsWith(norm(f)));
const wp = n => n.getWorldPosition(new THREE.Vector3());
for (const side of ['L', 'R']) {
  const chain = ['f_index01', 'f_index02', 'f_index03'].map(f => find(f + side));
  const hand = find('hand' + side), palm = find('palm01' + side) || hand;
  const rest = chain.map(n => n.quaternion.clone());
  const base = wp(chain[2]).distanceTo(wp(palm));
  const rows = [];
  for (const axis of ['x', 'y', 'z']) for (const sign of [-1, 1]) for (const deg of [35, 65]) {
    chain.forEach((n, i) => n.quaternion.copy(rest[i]).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(axis === 'x' ? sign * deg * Math.PI / 180 : 0, axis === 'y' ? sign * deg * Math.PI / 180 : 0, axis === 'z' ? sign * deg * Math.PI / 180 : 0))));
    s.updateMatrixWorld(true);
    const tip = wp(chain[2]);
    rows.push({ axis, sign, deg, tipToPalm: +(tip.distanceTo(wp(palm))).toFixed(4), closesBy: +(base - tip.distanceTo(wp(palm))).toFixed(4), tipY: +tip.y.toFixed(3) });
    chain.forEach((n, i) => n.quaternion.copy(rest[i]));
    s.updateMatrixWorld(true);
  }
  rows.sort((a, b) => b.closesBy - a.closesBy);
  console.log(side, 'rest tip-to-palm', +base.toFixed(4), rows.slice(0, 5));
}
