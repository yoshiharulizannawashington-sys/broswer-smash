// Structural inventory of asgard.glb: every node whose name reads as stone architecture, with the
// material the exporter actually assigned. Used to judge "is this a stone surface?" per mesh.
import { readFile } from 'node:fs/promises';

const buffer = await readFile(process.argv[2] || 'public/assets/arenas/asgard.glb');
const jsonLength = buffer.readUInt32LE(12);
const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
const materials = (gltf.materials || []).map(m => m.name || '(unnamed)');
const meshMaterials = (gltf.meshes || []).map(mesh => {
  const names = [...new Set((mesh.primitives || []).map(p => materials[p.material] || '(unnamed)'))];
  return names.join(' + ');
});
const rows = [];
for (const node of gltf.nodes || []) {
  if (node.mesh === undefined || !node.name) continue;
  rows.push({ name: node.name, material: meshMaterials[node.mesh] });
}
const STONEISH = /(base|foundation|plinth|pier|pediment|step|stair|terrace|wall|square|paving|plaza|ground|block|column|column|shaft|capital|bridge|deck|hall|kerb|inlay|channel)/i;
const matched = rows.filter(r => STONEISH.test(r.name));
const byToken = new Map();
for (const r of matched) {
  const token = r.name.replace(/\d+$/, '');
  const key = token + ' :: ' + r.material;
  byToken.set(key, (byToken.get(key) || 0) + 1);
}
console.log('STONE-ISH STRUCTURAL MESHES');
for (const [key, count] of [...byToken.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(3)}  ${key}`);
}
console.log('\nMESHES IN THE SQUARE/TERRAIN FAMILY');
for (const r of rows.filter(r => /(square|terrain|ground|cliff|rock|slope|dirt|grass)/i.test(r.name))) {
  console.log(`  ${r.name} :: ${r.material}`);
}
