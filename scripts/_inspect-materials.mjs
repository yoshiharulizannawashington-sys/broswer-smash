import './glb-node-compat.mjs';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const b = readFileSync(process.argv[2]);
const g = await new Promise((ok, bad) => new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', ok, bad));
const byMat = new Map();
g.scene.traverse(n => {
  if (!n.isMesh) return;
  for (const m of (Array.isArray(n.material) ? n.material : [n.material])) {
    if (!m || byMat.has(m.name)) continue;
    byMat.set(m.name, {
      mesh: n.name, type: m.type, color: m.color?.getHexString?.(), map: !!m.map,
      metalness: m.metalness, roughness: m.roughness, transparent: m.transparent,
      opacity: m.opacity, side: m.side, alphaTest: m.alphaTest, emissive: m.emissive?.getHexString?.(),
      normalMap: !!m.normalMap, depthWrite: m.depthWrite, vertexColors: m.vertexColors
    });
  }
});
console.log(JSON.stringify([...byMat.entries()].map(([name, v]) => ({ name, ...v })), null, 1));
