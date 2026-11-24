import './scripts/glb-node-compat.mjs';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
globalThis.self ||= globalThis;
const files = process.argv.slice(2);
for (const file of files) {
  try {
    const b = readFileSync(file);
    const gltf = await new Promise((ok, bad) => new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), './', ok, bad));
    const bones = []; gltf.scene.traverse(n => { if (n.isBone) bones.push(n.name); });
    const clips = gltf.animations || [];
    const counts = clips.map(c => new Set(c.tracks.map(t => t.name.slice(0, Math.max(0, t.name.lastIndexOf('.'))))).size);
    console.log(JSON.stringify({ file, bones: bones.length, boneSample: bones.slice(0, 12), clips: clips.length, tracks: counts, minTracks: Math.min(...counts), maxTracks: Math.max(...counts), clipSample: clips.slice(0,4).map(c=>c.name) }));
  } catch (e) { console.log(JSON.stringify({ file, error: String(e.message||e) })); }
}
