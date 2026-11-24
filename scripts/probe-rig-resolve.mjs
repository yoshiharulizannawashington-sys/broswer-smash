// Print the rig the game's own resolver builds for a GLB: joint count, bound canonical slots,
// missing slots and the raw bone names it saw. Diagnostic only.
//   node scripts/probe-rig-resolve.mjs <glb> [glb...]
import { readFileSync } from 'node:fs';
import './glb-node-compat.mjs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { resolveRig } from '../public/js/anim/rig_map.js';

globalThis.self ||= globalThis;
for (const file of process.argv.slice(2)) {
  const b = readFileSync(file);
  const gltf = await new Promise((ok, bad) => new GLTFLoader().parse(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), './', ok, bad));
  gltf.scene.updateMatrixWorld(true);
  const names = [];
  let skinned = 0;
  gltf.scene.traverse(n => { if (n.isBone) names.push(n.name); if (n.isSkinnedMesh) skinned++; });
  const rig = resolveRig(gltf.scene);
  console.log(JSON.stringify({
    file, skinned, bonesSeen: names.length, boneNames: names.slice(0, 24),
    kind: rig?.kind, bound: rig?.boundCount, missing: rig?.missing,
    joints: rig ? Object.keys(rig.joints) : null
  }, null, 1));
}
