// Temporary exact-cover experiment for the residual T-800 hand boundaries.
// Read-only: loads a GLB, solves each boundary component with existing vertices, and prints the
// triangles it would add without writing anything.
import './glb-node-compat.mjs';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const file = process.argv[2];
const load = async source => new Promise((ok, fail) => {
  const b = readFileSync(source);
  new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', ok, fail);
});
const gltf = await load(file);
const scene = gltf.scene || gltf.scenes[0];
scene.updateMatrixWorld(true);
const keyOf = p => `${Math.round(p.x * 1e5)},${Math.round(p.y * 1e5)},${Math.round(p.z * 1e5)}`;
const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;

for (const node of []) node.name;
scene.traverse(node => {
  if (!node.isMesh) return;
  const position = node.geometry.attributes.position;
  const index = node.geometry.index;
  const positions = [], world = [];
  for (let i = 0; i < position.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(position, i);
    positions.push(p); world.push(p.clone().applyMatrix4(node.matrixWorld));
  }
  const canonical = new Array(positions.length);
  const representative = [];
  const map = new Map();
  for (let i = 0; i < positions.length; i++) {
    const k = keyOf(world[i]);
    let id = map.get(k);
    if (id === undefined) { id = map.size; map.set(k, id); representative[id] = i; }
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
  const initialEdges = new Map();
  for (const face of faces) for (let e = 0; e < 3; e++) {
    const a = face.key[e], b = face.key[(e + 1) % 3];
    const k = edgeKey(a, b);
    const entry = initialEdges.get(k) || { a: Math.min(a, b), b: Math.max(a, b), count: 0, dirs: [] };
    entry.count++; entry.dirs.push([a, b]); initialEdges.set(k, entry);
  }
  const boundary = [...initialEdges.values()].filter(e => e.count === 1).map(e => e.dirs[0]);
  if (!boundary.length) return;
  const allAdded = [];
  const adjacency = new Map();
  for (const [a, b] of boundary) {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a).add(b); adjacency.get(b).add(a);
  }
  const seen = new Set(), components = [];
  for (const start of adjacency.keys()) {
    if (seen.has(start)) continue;
    const comp = [], stack = [start]; seen.add(start);
    while (stack.length) { const v = stack.pop(); comp.push(v); for (const n of adjacency.get(v)) if (!seen.has(n)) { seen.add(n); stack.push(n); } }
    components.push(comp);
  }
  console.log(`\n=== ${node.name}: ${boundary.length} open, ${components.length} components`);
  for (const [ci, comp] of components.entries()) {
    const compSet = new Set(comp);
    const compEdges = boundary.filter(([a, b]) => compSet.has(a) && compSet.has(b));
    const box = new THREE.Box3().setFromPoints(comp.map(v => world[representative[v]]));
    const min = box.min.clone().addScalar(-0.04), max = box.max.clone().addScalar(0.04);
    const candidates = [];
    for (let c = 0; c < representative.length; c++) {
      const p = world[representative[c]];
      if (p.x < min.x || p.y < min.y || p.z < min.z || p.x > max.x || p.y > max.y || p.z > max.z) continue;
      candidates.push(c);
    }
    const edgeState = new Map([...initialEdges].map(([k, e]) => [k, { count: e.count, dirs: e.dirs.slice() }]));
    const faceSet = new Set(faces.map(f => [...f.key].sort((a, b) => a - b).join(',')));
    const region = new Set(comp);
    const scopeBoundary = new Set();
    for (const [k, e] of edgeState) if (e.count === 1 && region.has(e.dirs[0][0]) && region.has(e.dirs[0][1])) scopeBoundary.add(k);
    const added = [];
    let nodes = 0, solved = false;
    const area = (a, b, c) => new THREE.Triangle(world[representative[a]], world[representative[b]], world[representative[c]]).getArea();
    const tryAdd = (a, c, b) => {
      if (a === c || c === b || a === b) return null;
      if (!(area(a, c, b) > 1e-9)) return null;
      const key = [a, c, b];
      if (faceSet.has([...key].sort((x, y) => x - y).join(','))) return null;
      const undo = [];
      const scopeUndo = [];
      const addedVertex = !region.has(c);
      if (addedVertex) region.add(c);
      let closes = 0;
      for (let e = 0; e < 3; e++) {
        const u = key[e], v = key[(e + 1) % 3];
        const k = edgeKey(u, v);
        const state = edgeState.get(k);
        if (!state) {
          edgeState.set(k, { count: 1, dirs: [[u, v]] });
          undo.push([k, null]);
          if (region.has(u) && region.has(v)) { scopeBoundary.add(k); scopeUndo.push([k, false]); }
          continue;
        }
        if (state.count >= 2) {
          for (const [x, s] of undo) { if (s) edgeState.set(x, s); else edgeState.delete(x); }
          for (const [x, had] of scopeUndo) { if (had) scopeBoundary.add(x); else scopeBoundary.delete(x); }
          if (addedVertex) region.delete(c);
          return null;
        }
        if (state.count === 1) {
          if (!state.dirs.some(([x, y]) => x === v && y === u)) {
            for (const [x, s] of undo) { if (s) edgeState.set(x, s); else edgeState.delete(x); }
            for (const [x, had] of scopeUndo) { if (had) scopeBoundary.add(x); else scopeBoundary.delete(x); }
            if (addedVertex) region.delete(c);
            return null;
          }
          closes++;
          undo.push([k, { count: state.count, dirs: state.dirs.slice() }]);
          state.count = 2; state.dirs.push([u, v]);
          if (scopeBoundary.has(k)) { scopeBoundary.delete(k); scopeUndo.push([k, true]); }
        }
      }
      return { closes, undo, scopeUndo, addedVertex };
    };
    const remove = record => {
      for (const [k, state] of record.undo.reverse()) {
        if (state) edgeState.set(k, state);
        else edgeState.delete(k);
      }
      for (const [k, had] of record.scopeUndo) {
        if (had) scopeBoundary.add(k);
        else scopeBoundary.delete(k);
      }
      if (record.addedVertex) region.delete(record.key?.[1]);
      // The apex is stored on the record for the region rollback.
      if (record.addedVertex) region.delete(record.apex);
    };
    const solve = (depth = 0) => {
      nodes++;
      if (nodes > 250000 || depth > 70) return false;
      const remaining = [...scopeBoundary];
      if (!remaining.length) return true;
      // Pick the edge with the fewest candidate apexes.
      let target = null, targetCandidates = null;
      for (const k of remaining) {
        const [a, b] = edgeState.get(k).dirs[0];
        const options = candidates.filter(c => area(a, c, b) > 1e-9);
        if (!target || options.length < targetCandidates.length) { target = [a, b]; targetCandidates = options; }
        if (!options.length) break;
      }
      const [a, b] = target;
      for (const c of targetCandidates) {
        const record = tryAdd(a, c, b);
        if (!record) continue;
        record.apex = c;
        const face = { tri: [a, c, b].map(v => representative[v]), key: [a, c, b] };
        added.push(face); faceSet.add([...face.key].sort((x, y) => x - y).join(','));
        if (solve(depth + 1)) return true;
        added.pop(); faceSet.delete([...face.key].sort((x, y) => x - y).join(','));
        remove(record);
      }
      return false;
    };
    solved = solve();
    console.log(`  component ${ci}: ${comp.length} verts, ${compEdges.length} edges, ${candidates.length} centers, nodes ${nodes}, solved ${solved}, added ${added.length}`);
    if (solved) for (const face of added) { console.log(`    tri ${face.key.join(',')}`); allAdded.push(face); }
  }
  const finalEdges = new Map();
  for (const face of faces.concat(allAdded)) for (let e = 0; e < 3; e++) {
    const a = face.key[e], b = face.key[(e + 1) % 3];
    const k = edgeKey(a, b);
    const entry = finalEdges.get(k) || { count: 0, dirs: [] };
    entry.count++; entry.dirs.push([a, b]); finalEdges.set(k, entry);
  }
  const open = [...finalEdges.values()].filter(e => e.count === 1).length;
  const nm = [...finalEdges.values()].filter(e => e.count > 2).length;
  console.log(`  FINAL: ${open} open, ${nm} non-manifold, ${allAdded.length} added faces`);
});
