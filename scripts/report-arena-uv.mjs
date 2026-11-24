// Reports the Great Hall's node names and whether their primitives carry UVs (TEXCOORD_0), which is
// what decides whether a marble map can legally be applied to the arena's stone.
import { readFile } from 'node:fs/promises';

const buffer = await readFile(process.argv[2] || 'public/assets/arenas/hogwarts.glb');
const gltf = JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString('utf8'));
const rows = [];
for (const node of gltf.nodes || []) {
  if (!/flagstone|Great_Hall|floor/i.test(node.name || '')) continue;
  const mesh = gltf.meshes?.[node.mesh];
  const attributes = Object.keys(mesh?.primitives?.[0]?.attributes || {});
  const material = gltf.materials?.[mesh?.primitives?.[0]?.material];
  rows.push({ node: node.name, mesh: mesh?.name || '(unnamed)', attributes, material: material?.name || '(none)', textured: Boolean(material?.pbrMetallicRoughness?.baseColorTexture) });
}
console.log(JSON.stringify({ meshes: gltf.meshes?.length || 0, images: gltf.images?.length || 0, matches: rows.slice(0, 10) }, null, 2));
