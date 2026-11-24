// Measure each roster GLB's authored facing, and Voldemort's nose depth, straight from the files.
//
// The runtime measurement was unreliable: changing the selected fighter mid-match did not swap the
// mounted model, so every identity measured the same body. A GLB is static data, so the front can be
// read from it: the eye meshes sit on the front of the skull, so the horizontal angle from the model
// axis to their centroid IS the authored facing. 0 degrees = authored front along +Z (the game's
// convention), and that is the yaw offset a body needs.
//
//   node scripts/measure-glb-facing.mjs [--json]
import { readFile } from 'node:fs/promises';

function parseGLB(buffer) {
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  let binOffset = 20 + jsonLength;
  const binLength = buffer.readUInt32LE(binOffset);
  binOffset += 8;
  return { json, bin: buffer.subarray(binOffset, binOffset + binLength) };
}
function primitivePositions(glb, primitive) {
  const { json, bin } = glb;
  const accessor = json.accessors[primitive.attributes.POSITION];
  const view = json.bufferViews[accessor.bufferView];
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const stride = view.byteStride || 12;
  const out = [];
  for (let i = 0; i < accessor.count; i++) {
    const o = start + i * stride;
    out.push([bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)]);
  }
  return out;
}
function materialsOf(glb, primitive) {
  return [primitive.material].filter(v => v !== undefined).map(index => glb.json.materials[index]?.name || '');
}

export async function measure(file) {
  const glb = parseGLB(await readFile(file));
  const eye = [];
  const skin = [];
  for (const mesh of glb.json.meshes) {
    for (const primitive of mesh.primitives) {
      const names = materialsOf(glb, primitive);
      if (names.some(n => /fighter-eye|fighter-iris/.test(n))) eye.push(...primitivePositions(glb, primitive));
      if (names.some(n => /fighter-skin(?!-shade)/.test(n))) skin.push(...primitivePositions(glb, primitive));
    }
  }
  const centroid = points => {
    const sum = points.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
    return sum.map(v => v / Math.max(1, points.length));
  };
  const eyeCentre = eye.length ? centroid(eye) : null;
  const facing = eyeCentre ? Math.round(Math.atan2(eyeCentre[0], eyeCentre[2]) * 180 / Math.PI) : null;
  // Nose depth: the furthest point along the measured facing direction, at head height. Reported in
  // model units so the old and new Voldemort exports can be compared directly.
  let nose = null;
  if (facing !== null && skin.length) {
    const dir = [Math.sin(facing * Math.PI / 180), 0, Math.cos(facing * Math.PI / 180)];
    const heights = skin.map(p => p[1]);
    const lo = Math.min(...heights), hi = Math.max(...heights);
    const band = skin.filter(p => p[1] > lo + (hi - lo) * 0.82 && Math.abs(p[0] - eyeCentre[0]) < 0.06);
    const project = p => p[0] * dir[0] + p[2] * dir[2];
    nose = { band: band.length, front: band.length ? +Math.max(...band.map(project)).toFixed(4) : null, eyeFront: +project(eyeCentre).toFixed(4) };
  }
  return { file, facingDegrees: facing, eyes: eye.length, skin: skin.length, nose, eyeCentre: eyeCentre && eyeCentre.map(v => +v.toFixed(3)) };
}

const files = process.argv.slice(2).filter(a => a.endsWith('.glb'));
const targets = files.length ? files : [
  'public/models/characters/roster/superman.glb',
  'public/models/characters/roster/thor.glb',
  'public/models/characters/roster/naruto_uzumaki.glb',
  'public/models/characters/roster/captain_jack_sparrow.glb',
  'public/models/characters/roster/lord_voldemort.glb',
  'artifacts/backup/glb-pretricorn/lord_voldemort.glb'
];
for (const file of targets) {
  try {
    console.log('GLB_FACING', JSON.stringify(await measure(file)));
  } catch (error) {
    console.log('GLB_FACING_FAILED', file, String(error.message || error));
  }
}
