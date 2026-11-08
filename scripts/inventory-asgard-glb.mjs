// Complete mesh/material inventory straight from asgard.glb - no browser needed.
// Lists every material with its primitive count, and every distinct mesh-name token with the
// materials it uses, so "is there rock/cliff/wall geometry at all" is answered by the asset itself.
import { readFile } from 'node:fs/promises';

const buffer = await readFile(process.argv[2] || 'public/assets/arenas/asgard.glb');
const jsonLength = buffer.readUInt32LE(12);
const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));

const materials = (gltf.materials || []).map((m, i) => ({ i, name: m.name || `(mat ${i})` }));
const primsByMaterial = new Map();
for (const mesh of gltf.meshes || []) {
  for (const prim of mesh.primitives || []) {
    primsByMaterial.set(prim.material, (primsByMaterial.get(prim.material) || 0) + 1);
  }
}
console.log('MATERIALS');
for (const m of materials) console.log(`  ${String(primsByMaterial.get(m.i) || 0).padStart(4)}  ${m.name}`);

const nodeNames = (gltf.nodes || []).map(n => n.name || '').filter(Boolean);
const tokens = new Map();
for (const name of nodeNames) {
  const token = name.replace(/\d+$/, '');
  tokens.set(token, (tokens.get(token) || 0) + 1);
}
console.log(`\nMESH NAME TOKENS (${tokens.size} distinct, ${nodeNames.length} nodes)`);
for (const [token, count] of [...tokens.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(3)}  ${token}`);
}
const stoneish = nodeNames.filter(n => /(rock|cliff|boulder|stone|wall|foundation|terrain|ground|earth|slab|block|pillar|column|plinth|stair|step|bridge|path|dirt|soil)/i.test(n));
console.log(`\nSTONE-LIKE NAMES (${stoneish.length})`);
for (const n of [...new Set(stoneish.map(n => n.replace(/\d+$/, '')))]) console.log(`  ${n}`);
