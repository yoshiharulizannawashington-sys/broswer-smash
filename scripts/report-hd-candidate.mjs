// Reports the facts a licensed body has to clear before it can join the roster: animation clips,
// textures, skins, bone count and height - read straight from the GLB container.
import { readFile } from 'node:fs/promises';

const path = process.argv[2];
const buffer = await readFile(path);
const jsonLength = buffer.readUInt32LE(12);
const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));

const accessor = index => gltf.accessors?.[index] || {};
let minY = Infinity, maxY = -Infinity;
for (const mesh of gltf.meshes || []) {
  for (const primitive of mesh.primitives || []) {
    const bounds = accessor(primitive.attributes?.POSITION);
    if (bounds.min && bounds.min[1] < minY) minY = bounds.min[1];
    if (bounds.max && bounds.max[1] > maxY) maxY = bounds.max[1];
  }
}
const animations = (gltf.animations || []).map(a => ({
  name: a.name || '(unnamed)',
  channels: a.channels?.length || 0,
  duration: Math.max(0, ...(a.samplers || []).map(s => accessor(s.input).max?.[0] ?? 0))
}));
const images = (gltf.images || []).map(i => ({ name: i.name || '', mime: i.mimeType || '', uri: i.uri || '(embedded bufferView)' }));
const joints = new Set();
for (const skin of gltf.skins || []) for (const joint of skin.joints || []) joints.add(joint);

console.log(JSON.stringify({
  file: path,
  bytes: buffer.length,
  meshes: (gltf.meshes || []).length,
  skins: (gltf.skins || []).length,
  joints: joints.size,
  materials: (gltf.materials || []).map(m => m.name),
  images,
  height: +(maxY - minY).toFixed(3),
  clipCount: animations.length,
  clips: animations,
  generator: gltf.asset?.generator || ''
}, null, 2));
