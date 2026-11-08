// Per-mesh open-boundary diagnostic.
//
// The refinement report only totals boundary edges per body, so a new part that ships as an open
// shell is indistinguishable from the hair cards and cloth panels that were always open. This
// prints the count per mesh node so a regression can be traced to the part that caused it.
//
//   node scripts/diag-topology.mjs <file.glb> [more.glb ...]
import './glb-node-compat.mjs';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

function parseGlb(buffer) {
  return new Promise((ok, fail) => {
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    new GLTFLoader().parse(arrayBuffer, '', ok, error => fail(new Error(String(error?.message || error))));
  });
}

/** Same classification the refinement report uses: used once = open boundary, >2 = non-manifold. */
function topology(geometry) {
  const position = geometry?.attributes?.position;
  if (!position) return { boundaryEdges: 0, nonManifoldEdges: 0, triangles: 0 };
  const index = geometry.index;
  const count = index ? index.count : position.count;
  const uses = new Map();
  const key = (a, b) => (a < b ? a + ':' + b : b + ':' + a);
  for (let i = 0; i + 2 < count; i += 3) {
    const a = index ? index.getX(i) : i;
    const b = index ? index.getX(i + 1) : i + 1;
    const c = index ? index.getX(i + 2) : i + 2;
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const k = key(p, q);
      uses.set(k, (uses.get(k) || 0) + 1);
    }
  }
  let boundaryEdges = 0, nonManifoldEdges = 0;
  for (const n of uses.values()) {
    if (n === 1) boundaryEdges++;
    else if (n > 2) nonManifoldEdges++;
  }
  // Welded pass: ignores UV-seam vertex splits, so what remains is a real hole in the surface.
  const weld = new Map();
  const canonical = i => {
    const k = Math.round(position.getX(i) * 1e5) + ':' + Math.round(position.getY(i) * 1e5) + ':' + Math.round(position.getZ(i) * 1e5);
    let id = weld.get(k);
    if (id === undefined) { id = weld.size; weld.set(k, id); }
    return id;
  };
  const welded = new Map();
  for (let i = 0; i + 2 < count; i += 3) {
    const a = canonical(index ? index.getX(i) : i);
    const b = canonical(index ? index.getX(i + 1) : i + 1);
    const c = canonical(index ? index.getX(i + 2) : i + 2);
    if (a === b || b === c || a === c) continue;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = u < v ? u * 1000003 + v : v * 1000003 + u;
      welded.set(k, (welded.get(k) || 0) + 1);
    }
  }
  let openShellEdges = 0;
  for (const n of welded.values()) if (n === 1) openShellEdges++;
  return { boundaryEdges, nonManifoldEdges, openShellEdges, triangles: Math.round(count / 3) };
}

for (const file of process.argv.slice(2)) {
  const gltf = await parseGlb(readFileSync(file));
  const scene = gltf.scene || gltf.scenes[0];
  scene.updateMatrixWorld(true);
  const rows = [];
  let totalB = 0, totalN = 0, totalT = 0, totalOpen = 0, meshes = 0;
  scene.traverse(node => {
    if (!node.isMesh) return;
    meshes++;
    const t = topology(node.geometry);
    totalB += t.boundaryEdges; totalN += t.nonManifoldEdges; totalT += t.triangles; totalOpen += t.openShellEdges;
    if (t.boundaryEdges || t.nonManifoldEdges) rows.push({ name: node.name || '(unnamed)',
      material: (Array.isArray(node.material) ? node.material.map(m => m?.name).join('+') : node.material?.name) || '', ...t });
  });
  rows.sort((a, b) => b.boundaryEdges - a.boundaryEdges);
  console.log(`\n=== ${file}`);
  console.log(`meshes ${meshes}  triangles ${totalT}  boundaryEdges ${totalB}  nonManifoldEdges ${totalN}  openShellEdges ${totalOpen}`);
  for (const row of rows.slice(0, 12)) {
    console.log(`  ${String(row.boundaryEdges).padStart(5)} open  ${String(row.nonManifoldEdges).padStart(4)} non-manifold  ${String(row.triangles).padStart(6)} tris  ${row.name}  [${row.material}]`);
  }
}
