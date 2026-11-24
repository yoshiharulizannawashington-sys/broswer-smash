// Temporary experiment: can each residual boundary component be capped by a fan from an existing
// interior vertex? Read-only; prints component-by-component feasibility.
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
  const getEdges = faceList => {
    const edges = new Map();
    for (const face of faceList) for (let e = 0; e < 3; e++) {
      const a = face.key[e], b = face.key[(e + 1) % 3];
      const k = edgeKey(a, b);
      const entry = edges.get(k) || { a: Math.min(a, b), b: Math.max(a, b), uses: 0, dir: [] };
      entry.uses++; entry.dir.push([a, b]); edges.set(k, entry);
    }
    return edges;
  };
  const baseEdges = getEdges(faces);
  const boundary = [...baseEdges.values()].filter(e => e.uses === 1).map(e => e.dir[0]);
  if (!boundary.length) return;
  const adjacency = new Map();
  for (const [a, b] of boundary) {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a).add(b); adjacency.get(b).add(a);
  }
  const seen = new Set();
  const components = [];
  for (const start of adjacency.keys()) {
    if (seen.has(start)) continue;
    const comp = []; const stack = [start]; seen.add(start);
    while (stack.length) {
      const v = stack.pop(); comp.push(v);
      for (const n of adjacency.get(v)) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
    components.push(comp);
  }
  console.log(`\n=== ${node.name}: ${boundary.length} open, ${components.length} components`);
  components.forEach((comp, ci) => {
    const compSet = new Set(comp);
    const compEdges = boundary.filter(([a, b]) => compSet.has(a) && compSet.has(b));
    const box = new THREE.Box3().setFromPoints(comp.map(v => world[representative[v]]));
    const min = box.min.clone().addScalar(-0.04), max = box.max.clone().addScalar(0.04);
    const candidates = [];
    for (let c = 0; c < representative.length; c++) {
      if (compSet.has(c)) continue;
      const p = world[representative[c]];
      if (p.x < min.x || p.y < min.y || p.z < min.z || p.x > max.x || p.y > max.y || p.z > max.z) continue;
      candidates.push(c);
    }
    let successes = 0, closest = null;
    for (const c of candidates) {
      const facesToAdd = [];
      let okay = true;
      const trial = faces.slice();
      for (const [a, b] of compEdges) {
        const cpos = world[representative[c]];
        const tri = [a, c, b];
        const area = new THREE.Triangle(world[representative[a]], cpos, world[representative[b]]).getArea();
        if (!(area > 1e-9)) { okay = false; break; }
        facesToAdd.push({ tri: tri.map(v => representative[v]), key: tri });
      }
      if (!okay) continue;
      // Evaluate all fan faces together, and require every component boundary edge to be used once
      // by the fan and all other edges to be used at most twice, with opposite orientation.
      const trialEdges = getEdges(faces.concat(facesToAdd));
      for (const [a, b] of compEdges) {
        const e = trialEdges.get(edgeKey(a, b));
        if (!e || e.uses !== 2) { okay = false; break; }
      }
      if (!okay) continue;
      for (const e of trialEdges.values()) {
        if (e.uses > 2) { okay = false; break; }
        if (e.uses === 2 && e.dir[0][0] === e.dir[1][0] && e.dir[0][1] === e.dir[1][1]) { okay = false; break; }
      }
      if (!okay) continue;
      successes++;
      const center = world[representative[c]];
      if (!closest || center.distanceTo(box.getCenter(new THREE.Vector3())) < closest.distance) {
        closest = { c, distance: center.distanceTo(box.getCenter(new THREE.Vector3())), center };
      }
    }
    console.log(`  component ${ci}: ${comp.length} verts, ${compEdges.length} edges, ${candidates.length} candidate centers, fan successes ${successes}${closest ? `; nearest c${closest.c} d=${closest.distance.toFixed(4)}` : ''}`);
  });
});
