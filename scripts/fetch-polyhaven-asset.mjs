// Download a Poly Haven glTF asset (gltf+bin+textures) into the project and report its real cost.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
const [id, outDir, res = '1k'] = process.argv.slice(2);
if (!id || !outDir) { console.error('usage: node scripts/fetch-polyhaven-asset.mjs <id> <outDir> [res]'); process.exit(1); }
const meta = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
const set = meta.gltf?.[res];
if (!set?.gltf) { console.error(`NO_GLTF ${id} res=${res}`); process.exit(2); }
const entries = [[`${id}.gltf`, set.gltf]];
if (set.bin) entries.push([`${id}.bin`, set.bin]);
for (const [rel, entry] of Object.entries(set.include || {})) entries.push([rel, entry]);
let bytes = 0;
for (const [rel, entry] of entries) {
  const res2 = await fetch(entry.url);
  if (!res2.ok) { console.error(`FETCH_FAILED ${rel} ${res2.status}`); process.exit(2); }
  const buf = Buffer.from(await res2.arrayBuffer());
  const dest = join(outDir, rel);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  bytes += buf.length;
}
const gltf = JSON.parse(await readFile(join(outDir, `${id}.gltf`), 'utf8'));
let tris = 0, verts = 0;
for (const m of gltf.meshes || []) for (const p of m.primitives) {
  const idx = gltf.accessors[p.indices], pos = gltf.accessors[p.attributes.POSITION];
  tris += (idx ? idx.count : pos.count) / 3;
  verts += pos.count;
}
console.log(JSON.stringify({ id, res, outDir, files: entries.length, bytes, triangles: Math.round(tris), vertices: verts, meshes: (gltf.meshes || []).length, materials: (gltf.materials || []).length, images: (gltf.images || []).length }));
