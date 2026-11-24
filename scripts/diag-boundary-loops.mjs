// Trace and describe every open boundary loop left on a GLB body.
//
//   node scripts/diag-boundary-loops.mjs <file.glb>
//
// This is a diagnostic companion to inspect-character-glb.mjs. It welds positions the same way
// the topology repair does, traces directed boundary edges into cycles/components, and prints the
// exact vertices a cap would have to consume. It is read-only.
import './glb-node-compat.mjs';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/diag-boundary-loops.mjs <file.glb>');
  process.exit(2);
}
const load = async source => new Promise((ok, fail) => {
  const b = readFileSync(source);
  new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', ok, fail);
});
const gltf = await load(file);
const scene = gltf.scene || gltf.scenes[0];
scene.updateMatrixWorld(true);

const keyOf = p => `${Math.round(p.x * 1e5)},${Math.round(p.y * 1e5)},${Math.round(p.z * 1e5)}`;
const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
const fmt = p => `[${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}]`;

for (const node of []) node.name;
const meshes = [];
scene.traverse(node => {
  if (!node.isMesh) return;
  const geometry = node.geometry;
  const position = geometry.attributes.position;
  const index = geometry.index;
  const positions = [];
  const world = [];
  for (let i = 0; i < position.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(position, i);
    positions.push(p);
    world.push(p.clone().applyMatrix4(node.matrixWorld));
  }
  const canonical = new Array(positions.length);
  const representative = [];
  const canonicalMap = new Map();
  for (let i = 0; i < positions.length; i++) {
    const key = keyOf(world[i]);
    let id = canonicalMap.get(key);
    if (id === undefined) {
      id = canonicalMap.size;
      canonicalMap.set(key, id);
      representative[id] = i;
    }
    canonical[i] = id;
  }
  const faces = [];
  const count = index ? index.count : position.count;
  for (let i = 0; i + 2 < count; i += 3) {
    const tri = [index ? index.getX(i) : i, index ? index.getX(i + 1) : i + 1, index ? index.getX(i + 2) : i + 2];
    const key = tri.map(v => canonical[v]);
    if (key[0] === key[1] || key[1] === key[2] || key[0] === key[2]) continue;
    faces.push({ tri, key });
  }
  meshes.push({ name: node.name, node, positions, world, canonical, representative, faces });
});

for (const mesh of meshes) {
  const edges = new Map();
  for (const face of mesh.faces) {
    for (let e = 0; e < 3; e++) {
      const a = face.key[e];
      const b = face.key[(e + 1) % 3];
      const key = edgeKey(a, b);
      const entry = edges.get(key) || { a: Math.min(a, b), b: Math.max(a, b), uses: 0, dir: [] };
      entry.uses++;
      entry.dir.push([a, b]);
      edges.set(key, entry);
    }
  }
  const boundary = [...edges.values()].filter(edge => edge.uses === 1).map(edge => edge.dir[0]);
  const bad = [...edges.values()].filter(edge => edge.uses > 2);
  console.log(`\n=== ${mesh.name}: ${boundary.length} open, ${bad.length} non-manifold, ${mesh.faces.length} tris`);
  if (!boundary.length) continue;

  const outgoing = new Map();
  const incoming = new Map();
  const undirected = new Map();
  boundary.forEach(([a, b], index) => {
    if (!outgoing.has(a)) outgoing.set(a, []);
    outgoing.get(a).push(index);
    if (!incoming.has(b)) incoming.set(b, []);
    incoming.get(b).push(index);
    for (const v of [a, b]) undirected.set(v, (undirected.get(v) || 0) + 1);
  });
  const odd = [...undirected].filter(([, degree]) => degree % 2);
  console.log(`  boundary verts ${undirected.size}; odd-degree ${odd.length}${odd.length ? ': ' + odd.map(([v, d]) => `${v}(d${d})`).join(' ') : ''}`);
  console.log(`  directed endpoints: no-outgoing ${[...incoming.keys()].filter(v => !outgoing.has(v)).length}, no-incoming ${[...outgoing.keys()].filter(v => !incoming.has(v)).length}`);

  // Connected components over boundary vertices.
  const adjacency = new Map();
  for (const [a, b] of boundary) {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a).add(b);
    adjacency.get(b).add(a);
  }
  const seen = new Set();
  const components = [];
  for (const start of adjacency.keys()) {
    if (seen.has(start)) continue;
    const comp = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const v = stack.pop();
      comp.push(v);
      for (const n of adjacency.get(v)) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
    components.push(comp);
  }
  console.log(`  components ${components.length}`);
  let compIndex = 0;
  for (const comp of components) {
    const compSet = new Set(comp);
    const compEdges = boundary.filter(([a, b]) => compSet.has(a) && compSet.has(b));
    const degree = comp.map(v => [v, (adjacency.get(v) || new Set()).size]);
    const points = comp.map(v => mesh.world[mesh.representative[v]]);
    const box = new THREE.Box3().setFromPoints(points);
    console.log(`  component ${compIndex++}: ${comp.length} verts, ${compEdges.length} edges, degree ${degree.map(([, d]) => d).join(',')}`);
    console.log(`    bbox ${box.min.toArray().map(n => n.toFixed(4))} .. ${box.max.toArray().map(n => n.toFixed(4))}`);

    // A simple directed cycle if each vertex in this component has exactly one outgoing boundary
    // edge and one incoming edge, and the edges form one cycle.
    const simple = comp.every(v => (outgoing.get(v) || []).length === 1 && (incoming.get(v) || []).length === 1);
    for (const [a, b] of compEdges) console.log(`      edge v${a} -> v${b}  ${fmt(mesh.world[mesh.representative[a]])} -> ${fmt(mesh.world[mesh.representative[b]])}`);
    if (simple) {
      const start = comp[0];
      const cycle = [];
      let current = start;
      let guard = 0;
      while (guard++ <= comp.length + 1) {
        cycle.push(current);
        const nextEdge = outgoing.get(current)[0];
        current = boundary[nextEdge][1];
        if (current === start) break;
      }
      console.log(`    simple cycle: ${cycle.length === comp.length && current === start ? 'yes' : 'no'} (${cycle.length} verts)`);
      const loop = cycle.slice(0, -1);
      let best = -1;
      for (let origin = 0; origin < loop.length; origin++) {
        let area = Infinity;
        const rotated = [...loop.slice(origin), ...loop.slice(0, origin)];
        for (let i = 1; i < rotated.length - 1; i++) {
          const a = mesh.world[mesh.representative[rotated[0]]];
          const b = mesh.world[mesh.representative[rotated[i + 1]]];
          const c = mesh.world[mesh.representative[rotated[i]]];
          area = Math.min(area, new THREE.Triangle(a, b, c).getArea());
        }
        if (area > 1e-9) { best = origin; break; }
      }
      console.log(`    fan-cap origin ${best >= 0 ? `${best} (min area ${(() => { const rotated = [...loop.slice(best), ...loop.slice(0, best)]; let min = Infinity; for (let i = 1; i < rotated.length - 1; i++) { const a = mesh.world[mesh.representative[rotated[0]]]; const b = mesh.world[mesh.representative[rotated[i + 1]]]; const c = mesh.world[mesh.representative[rotated[i]]]; min = Math.min(min, new THREE.Triangle(a, b, c).getArea()); } return min.toExponential(3); })()})` : 'NONE (degenerate fan at every origin)'}`);
      if (best >= 0) {
        const rotated = [...loop.slice(best), ...loop.slice(0, best)];
        const caps = [];
        for (let i = 1; i < rotated.length - 1; i++) {
          const a = mesh.representative[rotated[0]];
          const b = mesh.representative[rotated[i + 1]];
          const c = mesh.representative[rotated[i]];
          caps.push({ tri: [a, b, c], key: [rotated[0], rotated[i + 1], rotated[i]] });
        }
        const countNonManifold = faces => {
          const map = new Map();
          for (const face of faces) for (let e = 0; e < 3; e++) {
            const a = face.key[e], b = face.key[(e + 1) % 3];
            const key = edgeKey(a, b);
            map.set(key, (map.get(key) || 0) + 1);
          }
          return [...map.values()].filter(uses => uses > 2).length;
        };
        const before = countNonManifold(mesh.faces);
        mesh.faces.push(...caps);
        const after = countNonManifold(mesh.faces);
        mesh.faces.length -= caps.length;
        console.log(`    fan would add ${caps.length} tris; non-manifold ${before} -> ${after}`);
      }
      for (const v of loop) console.log(`      v${v} ${fmt(mesh.world[mesh.representative[v]])}`)
    } else {
      console.log('    branched boundary; edges:');
      for (const [a, b] of compEdges) console.log(`      v${a} ${fmt(mesh.world[mesh.representative[a]])} -> v${b} ${fmt(mesh.world[mesh.representative[b]])}`);
    }
  }
}
