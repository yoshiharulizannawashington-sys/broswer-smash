// Download a Sketchfab model through the official endpoint, preferring the GLB archive.
// The token is read from the environment; it is never printed, logged or written to disk.
import { mkdir, writeFile } from 'node:fs/promises';
const [uid, outFile] = process.argv.slice(2);
if (!uid || !outFile) { console.error('usage: node scripts/fetch-sketchfab-model.mjs <uid> <outFile.glb>'); process.exit(1); }
const token = process.env.SKETCHFAB_TOKEN;
if (!token) { console.error('SKETCHFAB_TOKEN is not set'); process.exit(1); }
const res = await fetch(`https://api.sketchfab.com/v3/models/${uid}/download`, { headers: { Authorization: `Token ${token}`, accept: 'application/json' } });
if (!res.ok) { console.error(`DOWNLOAD_REFUSED status=${res.status}`); process.exit(2); }
const body = await res.json();
const entry = body.glb || body.source;
if (!entry?.url) { console.error(`NO_ARCHIVE keys=${Object.keys(body).join(',')}`); process.exit(2); }
const file = await fetch(entry.url);
if (!file.ok) { console.error(`ARCHIVE_FETCH_FAILED status=${file.status}`); process.exit(2); }
const bytes = Buffer.from(await file.arrayBuffer());
await mkdir(outFile.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
await writeFile(outFile, bytes);
console.log(`FETCHED uid=${uid} bytes=${bytes.length} out=${outFile}`);
