// Infantry's imported combat clips, checked at the file level before anything renders.
//
// Proves, from the GLB's own accessors: all six clips exist, each drives the whole 24-bone rig,
// each keyframed bone actually rotates (not a rest-pose placeholder), and no two attacks are the
// same motion. A clip that only carries its name passes every "clip present" check and fails here.
//
//   node scripts/test-infantry-combat-clips.mjs
import fs from 'node:fs';

const FILE = 'public/models/characters/roster_hd/infantry_combat.glb';
const EXPECTED = [
  'Infantry_RifleButt',
  'Infantry_CombatCross',
  'Infantry_BootKick',
  'Infantry_ArmourBreaker',
  'Infantry_StockSlam',
  'Infantry_JumpKnee'
];
// Bones that must visibly move in a strike. A punch that never rotates an arm is the exact
// failure this test exists for.
const REQUIRED_MOVERS = ['RightArm', 'LeftArm', 'RightForeArm', 'LeftForeArm', 'Spine', 'Hips'];
const MIN_BONE_DEVIATION = 0.10; // radians (~5.7 degrees)

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
};

const buffer = fs.readFileSync(FILE);
if (buffer.subarray(0, 4).toString('utf8') !== 'glTF') {
  console.error('error: not a GLB: ' + FILE);
  process.exit(1);
}
const jsonLength = buffer.readUInt32LE(12);
const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
const binHeaderOffset = 20 + jsonLength;
const binLength = buffer.readUInt32LE(binHeaderOffset);
const bin = buffer.subarray(binHeaderOffset + 8, binHeaderOffset + 8 + binLength);

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function readAccessor(index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const components = COMPONENTS[accessor.type];
  const stride = view.byteStride || components * 4;
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const out = [];
  for (let i = 0; i < accessor.count; i += 1) {
    const offset = start + i * stride;
    const row = [];
    for (let c = 0; c < components; c += 1) row.push(bin.readFloatLE(offset + c * 4));
    out.push(components === 1 ? row[0] : row);
  }
  return out;
}
const nodeName = index => json.nodes[index]?.name || '#' + index;
const angleBetween = (a, b) => {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, Math.max(-1, dot)));
};

const clips = new Map();
for (const animation of json.animations || []) {
  const bones = new Map();
  let duration = 0;
  for (const channel of animation.channels || []) {
    if (channel.target?.path !== 'rotation') continue;
    const sampler = animation.samplers[channel.sampler];
    const times = readAccessor(sampler.input);
    const values = readAccessor(sampler.output);
    duration = Math.max(duration, times[times.length - 1] || 0);
    const first = values[0];
    const deviation = values.reduce((max, quat) => Math.max(max, angleBetween(first, quat)), 0);
    const name = nodeName(channel.target.node);
    bones.set(name, (bones.get(name) || 0) + deviation);
  }
  clips.set(animation.name, { bones, duration: +duration.toFixed(3), channels: (animation.channels || []).length });
}

check('the clip asset exists and parses', clips.size > 0, FILE + ' · ' + buffer.length + ' bytes');
check('all six imported attacks are present', EXPECTED.every(name => clips.has(name)),
  [...clips.keys()].join(', '));

for (const name of EXPECTED) {
  const clip = clips.get(name);
  if (!clip) {
    check(name + ' is authored on the real rig', false, 'missing');
    continue;
  }
  const movers = [...clip.bones.entries()].filter(([, deviation]) => deviation >= MIN_BONE_DEVIATION).map(([bone]) => bone);
  const rigWide = clip.bones.size === 24;
  const required = REQUIRED_MOVERS.every(bone => (clip.bones.get(bone) || 0) >= MIN_BONE_DEVIATION);
  check(name + ' is authored on the real rig',
    rigWide && required && movers.length >= 8,
    JSON.stringify({ bones: clip.bones.size, movers: movers.length, duration: clip.duration, channels: clip.channels }));
}

// Distinctness: two attacks that rotate the same bones by the same amounts are one animation
// under two names, which is exactly what the brief forbids.
let identicalPairs = 0;
const names = EXPECTED.filter(name => clips.has(name));
for (let i = 0; i < names.length; i += 1) {
  for (let j = i + 1; j < names.length; j += 1) {
    const a = clips.get(names[i]);
    const b = clips.get(names[j]);
    const allBones = new Set([...a.bones.keys(), ...b.bones.keys()]);
    let biggest = 0;
    let total = 0;
    for (const bone of allBones) {
      const delta = Math.abs((a.bones.get(bone) || 0) - (b.bones.get(bone) || 0));
      if (delta > biggest) biggest = delta;
      total += delta;
    }
    if (biggest < 0.15 && total < 1.2) {
      identicalPairs += 1;
      console.log('DUPLICATE ' + names[i] + ' vs ' + names[j] + ' · biggest=' + biggest.toFixed(3) + ' total=' + total.toFixed(3));
    }
  }
}
check('no two attacks are the same motion', identicalPairs === 0, identicalPairs + ' identical pair(s)');

const kinetic = names.filter(name => {
  const clip = clips.get(name);
  return [...clip.bones.values()].reduce((sum, value) => sum + value, 0) > 2.5;
});
check('every attack carries real total motion', kinetic.length === names.length,
  names.map(name => name + ':' + [...clips.get(name).bones.values()].reduce((s, v) => s + v, 0).toFixed(2)).join(' '));

const failed = checks.filter(c => !c.ok);
console.log('SUMMARY ' + JSON.stringify({ passed: checks.length - failed.length, total: checks.length, failures: failed.map(c => c.name) }));
process.exitCode = failed.length ? 1 : 0;
