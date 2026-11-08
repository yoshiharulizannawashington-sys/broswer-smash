#!/usr/bin/env node
/**
 * Pose probe for the imported Goku rig.
 *
 * The canonical angle tables are readable, but whether a pair of palms actually meets in front of the
 * chest is a geometry question, not a naming one: this prints the measured hand separation and reach
 * for candidate arm angles so the Kamehameha pose can be authored from numbers.
 *
 *   node scripts/probe-goku-pose.mjs
 */
import './glb-node-compat.mjs';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

globalThis.self ||= globalThis;

const load = file => new Promise((ok, bad) => {
  const buffer = readFileSync(file);
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  new GLTFLoader().parse(data, './', ok, bad);
});

const body = await load('public/models/characters/bespoke/goku_body.glb');
const scene = body.scene;
scene.updateMatrixWorld(true);
const bones = new Map();
const rest = new Map();
scene.traverse(node => {
  if (!node.isBone) return;
  bones.set(node.name, node);
  rest.set(node.name, node.quaternion.clone());
});

const BASE = {
  Hips: [0, 0, 0], Spine: [3, 0, 0], Chest: [2, 0, 0], Neck: [-3, 0, 0], Head: [-2, 0, 0],
  LeftShoulder: [0, 0, -3], RightShoulder: [0, 0, 3],
  LeftArm: [-14, -6, 0], RightArm: [-16, 6, 0],
  LeftForeArm: [-38, 0, 0], RightForeArm: [-40, 0, 0],
  LeftHand: [0, 0, 0], RightHand: [0, 0, 0],
  LeftUpLeg: [-5, 0, 0], RightUpLeg: [-5, 0, 0],
  LeftLeg: [11, 0, 0], RightLeg: [12, 0, 0],
  LeftFoot: [-5, 0, 0], RightFoot: [-6, 0, 0]
};
const DEG = Math.PI / 180;
const quat = ([x, y, z]) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x * DEG, y * DEG, z * DEG, 'XYZ'));

function measure(changes) {
  const angles = {};
  for (const [bone, rotation] of Object.entries(BASE)) angles[bone] = [...rotation];
  for (const [bone, delta] of Object.entries(changes)) {
    const before = angles[bone] || [0, 0, 0];
    angles[bone] = [before[0] + delta[0], before[1] + delta[1], before[2] + delta[2]];
  }
  for (const [name, node] of bones) {
    node.quaternion.copy(rest.get(name)).multiply(quat(angles[name] || [0, 0, 0]));
  }
  scene.updateMatrixWorld(true);
  const at = name => {
    const node = bones.get(name);
    if (!node) return null;
    const v = new THREE.Vector3();
    node.getWorldPosition(v);
    return v;
  };
  const chest = at('Chest'), left = at('LeftHand'), right = at('RightHand');
  return {
    separation: +left.distanceTo(right).toFixed(3),
    reach: +(((left.z + right.z) / 2) - chest.z).toFixed(3),
    height: +(((left.y + right.y) / 2) - chest.y).toFixed(3),
    leftX: +left.x.toFixed(3), rightX: +right.x.toFixed(3)
  };
}

const rows = [];
const sweep = (armZ, shoulderZ, x, forearm, y = 0) => {
  rows.push({
    label: `armZ${armZ} shZ${shoulderZ} x${x} fore${forearm}`,
    ...measure({
      RightShoulder: [0, 0, shoulderZ], LeftShoulder: [0, 0, -shoulderZ],
      RightArm: [x, y, armZ], LeftArm: [x, -y, -armZ],
      RightForeArm: [forearm, 0, 0], LeftForeArm: [forearm, 0, 0]
    })
  });
};

// Search for a two-handed cast pose: palms close together, both hands ahead of the chest.
for (const x of [-70, -80, -90]) {
  for (const armZ of [10, 25, 40, 55]) {
    for (const shoulderZ of [0, 20]) {
      for (const forearm of [-40, -55]) {
        sweep(armZ, shoulderZ, x, forearm);
      }
    }
  }
}

// STANCE SEARCH: a fighting guard needs the hands low and close, not out at shoulder height.
const stanceRows = [];
for (const x of [20, 40, 60, 80]) {
  for (const y of [-30, 0, 30]) {
    for (const z of [-30, 0, 30]) {
      for (const forearm of [-30, 0, 30]) {
        const m = measure({
          RightArm: [x, y, z], LeftArm: [x, -y, -z],
          RightForeArm: [forearm, 0, 0], LeftForeArm: [forearm, 0, 0]
        });
        stanceRows.push({ label: `x${x} y${y} z${z} f${forearm}`, ...m });
      }
    }
  }
}
const stanceRanked = stanceRows
  .map(row => ({ ...row, score: Math.abs(row.separation - 0.62) + Math.abs(row.height + 0.22) * 1.5 + Math.abs(row.reach - 0.12) }))
  .sort((a, b) => a.score - b.score)
  .slice(0, 10);
console.log('STANCE SEARCH');
console.table(stanceRanked.map(({ score, ...row }) => ({ ...row, score: +score.toFixed(3) })));

// AXIS PROBE: which single rotation actually lowers the hand?
const axisRows = [];
for (const axis of ['X', 'Y', 'Z']) {
  for (const angle of [-90, -45, 45, 90]) {
    const delta = { RightArm: [0, 0, 0], LeftArm: [0, 0, 0] };
    delta.RightArm[['X', 'Y', 'Z'].indexOf(axis)] = angle;
    delta.LeftArm[['X', 'Y', 'Z'].indexOf(axis)] = angle;
    axisRows.push({ label: `both ${axis}${angle}`, ...measure(delta) });
  }
}
console.log('AXIS PROBE');
console.table(axisRows);

const ranked = rows
  .map(row => ({ ...row, score: row.separation + Math.max(0, 0.12 - row.reach) * 4 }))
  .sort((a, b) => a.score - b.score)
  .slice(0, 16);
console.table(ranked.map(({ score, ...row }) => ({ ...row, score: +score.toFixed(3) })));
console.log('PASS', JSON.stringify(rows.filter(row => row.separation < 0.14 && row.reach > 0.10)));
