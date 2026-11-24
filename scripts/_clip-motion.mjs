// Per-clip motion, computed exactly the way scripts/measure-model-refinement.mjs computes it, but
// for one file and with the per-bone breakdown that the gate's summary throws away.
//
//   node scripts/_clip-motion.mjs public/models/characters/roster/goku.glb [--min 6]
//
// `movingBones` is the number of quaternion tracks whose largest key-to-key deviation exceeds 2
// degrees. The gate averages it across clips, so a clip that holds a pose drags the roster mean
// down even though every file still loads. Printing the bone list here answers "why is this clip
// 2 bones" without guessing: it shows which bones actually moved.
import './glb-node-compat.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const file = resolve(process.argv[2] || 'public/models/characters/roster/goku.glb');
const minIndex = process.argv.indexOf('--min');
const floor = minIndex > 0 ? Number(process.argv[minIndex + 1]) : 6;

function parseGlb(buffer) {
  return new Promise((ok, fail) => {
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    new GLTFLoader().parse(arrayBuffer, '', ok, error => fail(new Error(String(error?.message || error))));
  });
}

function trackDeviation(values) {
  const count = Math.floor(values.length / 4);
  let max = 0;
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const dot = Math.abs(
        values[i * 4] * values[j * 4] + values[i * 4 + 1] * values[j * 4 + 1] +
        values[i * 4 + 2] * values[j * 4 + 2] + values[i * 4 + 3] * values[j * 4 + 3]
      );
      max = Math.max(max, 2 * Math.acos(Math.min(1, dot)) * (180 / Math.PI));
    }
  }
  return max;
}

const gltf = await parseGlb(readFileSync(file));
const rows = [];
for (const clip of gltf.animations || []) {
  const moving = [];
  const idle = [];
  let keys = 0;
  for (const track of clip.tracks) {
    keys = Math.max(keys, track.times.length);
    if (!track.name.endsWith('quaternion')) continue;
    const bone = track.name.slice(0, track.name.lastIndexOf('.'));
    const deviation = trackDeviation(track.values);
    if (deviation > 2) moving.push(`${bone}:${deviation.toFixed(0)}°`);
    else idle.push(`${bone}:${deviation.toFixed(1)}°`);
  }
  rows.push({ name: clip.name, duration: +clip.duration.toFixed(2), keys, movingBones: moving.length, moving, idle });
}

const mean = rows.reduce((n, row) => n + row.movingBones, 0) / Math.max(1, rows.length);
for (const row of rows) {
  const flag = row.movingBones < floor ? '  <-- below floor' : '';
  console.log(`${row.name.padEnd(12)} ${String(row.movingBones).padStart(2)} bones` +
    `  ${String(row.keys).padStart(3)} keys  ${row.duration}s${flag}`);
  console.log(`   moved: ${row.moving.join(' ') || '(none)'}`);
  if (row.idle.length) console.log(`   still: ${row.idle.join(' ')}`);
}
console.log(`\n${rows.length} clips, mean moving bones ${mean.toFixed(2)} (gate baseline 14.4, floor ${floor})`);
process.exit(rows.length ? 0 : 1);
