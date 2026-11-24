// List the animations inside a GLB with their real channel counts, and the nodes they target.
//
// A GLB can carry an animation entry with zero channels: the clip name exists, the loop never
// moves, and every "clip present" check passes. This prints per-animation channel counts, the
// bones each clip drives, and the sampled duration, so a hollow clip is visible instead of implied.
//
//   node scripts/inspect-animation-glb.mjs public/models/characters/roster_hd/infantry_combat.glb
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/inspect-animation-glb.mjs <file.glb>');
  process.exit(1);
}
const buffer = fs.readFileSync(file);
if (buffer.subarray(0, 4).toString('utf8') !== 'glTF') {
  console.error('error: ' + file + ' is not a GLB (missing glTF magic)');
  process.exit(1);
}
// GLB layout: 12-byte header, then chunks of (length, type, data). The first chunk is the JSON.
const jsonLength = buffer.readUInt32LE(12);
const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
const nodes = json.nodes || [];
const nodeName = index => nodes[index]?.name || '#' + index;
const accessors = json.accessors || [];
const maxTime = accessorIndex => {
  const accessor = accessors[accessorIndex];
  const value = accessor?.max?.[0];
  return typeof value === 'number' ? +value.toFixed(3) : null;
};

const animations = (json.animations || []).map(animation => {
  const bones = new Set();
  let rotation = 0;
  let translation = 0;
  let scale = 0;
  let end = 0;
  for (const channel of animation.channels || []) {
    const name = nodeName(channel.target?.node);
    if (channel.target?.path === 'rotation') rotation += 1;
    else if (channel.target?.path === 'translation') translation += 1;
    else if (channel.target?.path === 'scale') scale += 1;
    // A bone's own keyframes only: the exporter may also emit a constant track for the armature.
    if (rotation || translation || scale) bones.add(name);
    const sampler = animation.samplers?.[channel.sampler];
    const time = sampler ? maxTime(sampler.input) : null;
    if (time && time > end) end = time;
  }
  return {
    name: animation.name,
    channels: (animation.channels || []).length,
    rotation,
    translation,
    scale,
    bones: [...bones].sort(),
    boneCount: bones.size,
    duration: end || null
  };
});

const report = {
  file,
  bytes: buffer.length,
  nodes: nodes.length,
  bones: nodes.filter(node => node.name && json.skins?.[0]?.joints?.includes(nodes.indexOf(node))).length,
  skins: (json.skins || []).length,
  meshes: (json.meshes || []).length,
  animations
};
console.log(JSON.stringify(report, null, 2));

const empty = animations.filter(animation => animation.channels === 0 || animation.rotation === 0);
if (!animations.length) {
  console.error('FAIL no animations in ' + file);
  process.exitCode = 1;
} else if (empty.length) {
  console.error('FAIL animations with no motion: ' + empty.map(a => a.name).join(', '));
  process.exitCode = 1;
}
