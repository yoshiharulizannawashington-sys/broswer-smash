// Repair the promoted Vegeta and T-800 source GLBs without moving or adding vertices.
//
// The strategy is deliberately conservative:
//   * remove exact duplicate triangles;
//   * delete the minimum faces needed to bring each edge back to two users;
//   * close remaining boundary loops with fans built from vertices already on the loop;
//   * remove the fully transparent Vegeta face overlay (every one of its 2,629 triangles is an
//     exact duplicate of a body triangle);
//   * separate the flat Vegeta eye/belt overlays from the body by 0.2 mm so their coincident rims
//     stop welding into non-manifold junctions in the character-level union check.
//
// No vertex is created. The skinned attributes, materials, skins, animations and node hierarchy
// are left in place; only index accessors and the two overlay POSITION accessors are rewritten.
//
//   node scripts/repair-source-topology.mjs <src.glb> <out.glb> [--drop Object_9]
//     [--offset Object_11:0.0002,Object_13:0.0002]
import './glb-node-compat.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const args = process.argv.slice(2);
const src = args[0];
const out = args[1];
if (!src || !out) {
  console.error('usage: node scripts/repair-source-topology.mjs <src.glb> <out.glb> [--drop names] [--offset name:mm,...]');
  process.exit(2);
}
const option = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};
const dropped = new Set(option('--drop').split(',').filter(Boolean));
const offsets = new Map(option('--offset').split(',').filter(Boolean).map(part => {
  const [name, value] = part.split(':');
  return [name, Number(value)];
}));

const glb = readFileSync(src);
if (glb.toString('utf8', 0, 4) !== 'glTF') throw new Error('not a GLB: ' + src);
const jsonLength = glb.readUInt32LE(12);
const json = JSON.parse(glb.toString('utf8', 20, 20 + jsonLength).replace(/\0+$/u, '').trim());
const binStart = 20 + jsonLength + 8;
const binLength = glb.readUInt32LE(20 + jsonLength);
const originalBin = Buffer.from(glb.subarray(binStart, binStart + binLength));
const binParts = [originalBin];
let binSize = originalBin.length;
const pad4 = value => (value + 3) & ~3;

function readAccessor(accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  const base = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const components = accessor.type === 'SCALAR' ? 1 : accessor.type === 'VEC2' ? 2 : accessor.type === 'VEC3' ? 3 : accessor.type === 'VEC4' ? 4 : 0;
  if (!components) throw new Error('unsupported accessor type ' + accessor.type);
  if (accessor.sparse) throw new Error('sparse accessors are not supported');
  const componentSize = accessor.componentType === 5121 ? 1 : accessor.componentType === 5123 ? 2 : 4;
  const stride = view.byteStride || componentSize * components;
  return { accessor, view, base, components, stride, componentSize, count: accessor.count };
}

function appendBuffer(bytes, target) {
  const offset = pad4(binSize);
  if (offset > binSize) { binParts.push(Buffer.alloc(offset - binSize)); binSize = offset; }
  binParts.push(bytes);
  binSize += bytes.length;
  json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
  return json.bufferViews.length - 1;
}

function originalIndices(primitive) {
  if (primitive.indices === undefined) throw new Error('primitive has no index accessor');
  const accessor = json.accessors[primitive.indices];
  const read = readAccessor(primitive.indices);
  const values = [];
  const size = read.componentSize;
  for (let i = 0; i < accessor.count; i++) {
    const at = read.base + i * read.stride;
    values.push(size === 1 ? originalBin.readUInt8(at) : size === 2 ? originalBin.readUInt16LE(at) : originalBin.readUInt32LE(at));
  }
  return { values, componentType: accessor.componentType };
}

function writeIndices(primitive, values) {
  const max = values.reduce((a, b) => Math.max(a, b), 0);
  const componentType = max > 65535 ? 5125 : 5123;
  const bytes = Buffer.alloc(values.length * (componentType === 5125 ? 4 : 2));
  values.forEach((value, i) => {
    if (componentType === 5125) bytes.writeUInt32LE(value, i * 4);
    else bytes.writeUInt16LE(value, i * 2);
  });
  const view = appendBuffer(bytes, 34963);
  json.accessors.push({
    bufferView: view,
    componentType,
    count: values.length,
    type: 'SCALAR',
    min: [0],
    max: [max]
  });
  primitive.indices = json.accessors.length - 1;
}

function readPositions(primitive) {
  const accessorIndex = primitive.attributes.POSITION;
  const accessor = json.accessors[accessorIndex];
  if (accessor.componentType !== 5126 || accessor.type !== 'VEC3') throw new Error('POSITION must be float VEC3');
  const read = readAccessor(accessorIndex);
  const positions = [];
  for (let i = 0; i < accessor.count; i++) {
    const at = read.base + i * read.stride;
    positions.push(new THREE.Vector3(originalBin.readFloatLE(at), originalBin.readFloatLE(at + 4), originalBin.readFloatLE(at + 8)));
  }
  return { accessorIndex, accessor, positions };
}

function writePositions(primitive, positions) {
  const bytes = Buffer.alloc(positions.length * 12);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  positions.forEach((p, i) => {
    bytes.writeFloatLE(p.x, i * 12);
    bytes.writeFloatLE(p.y, i * 12 + 4);
    bytes.writeFloatLE(p.z, i * 12 + 8);
    min[0] = Math.min(min[0], p.x); min[1] = Math.min(min[1], p.y); min[2] = Math.min(min[2], p.z);
    max[0] = Math.max(max[0], p.x); max[1] = Math.max(max[1], p.y); max[2] = Math.max(max[2], p.z);
  });
  const view = appendBuffer(bytes, 34962);
  json.accessors.push({
    bufferView: view,
    componentType: 5126,
    count: positions.length,
    type: 'VEC3',
    min,
    max
  });
  primitive.attributes.POSITION = json.accessors.length - 1;
}

const load = file => new Promise((ok, fail) => {
  const b = readFileSync(file);
  new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', ok, fail);
});
const gltf = await load(src);
const scene = gltf.scene;
scene.updateMatrixWorld(true);

const keyOf = p => `${Math.round(p.x * 1e5)},${Math.round(p.y * 1e5)},${Math.round(p.z * 1e5)}`;
const edgeKey = (a, b) => a < b ? a + ':' + b : b + ':' + a;

const nodeByName = new Map(json.nodes.map((node, index) => [node.name, { node, index }]));
const meshes = [];
scene.traverse(node => {
  if (!node.isMesh || dropped.has(node.name)) return;
  const found = nodeByName.get(node.name);
  if (!found || found.node.mesh === undefined) throw new Error('cannot map mesh node ' + node.name);
  const meshDef = json.meshes[found.node.mesh];
  if (meshDef.primitives.length !== 1) throw new Error(node.name + ' has more than one primitive');
  const primitive = meshDef.primitives[0];
  const { values, componentType } = originalIndices(primitive);
  if (componentType !== 5123 && componentType !== 5125) throw new Error('unexpected index type');
  const { positions } = readPositions(primitive);
  const world = positions.map(p => p.clone().applyMatrix4(node.matrixWorld));
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
  for (let i = 0; i + 2 < values.length; i += 3) {
    const tri = [values[i], values[i + 1], values[i + 2]];
    const key = [canonical[tri[0]], canonical[tri[1]], canonical[tri[2]]];
    if (key[0] === key[1] || key[1] === key[2] || key[0] === key[2]) continue;
    faces.push({ tri, key });
  }
  const rawCopies = Array.from({ length: canonicalMap.size }, () => []);
  for (let i = 0; i < positions.length; i++) rawCopies[canonical[i]].push(i);
  meshes.push({ name: node.name, node, primitive, positions, world, canonical, representative, rawCopies, faces });
});

const edgeMap = faces => {
  const map = new Map();
  for (const face of faces) {
    for (let e = 0; e < 3; e++) {
      const a = face.key[e];
      const b = face.key[(e + 1) % 3];
      const key = edgeKey(a, b);
      const entry = map.get(key) || { a: Math.min(a, b), b: Math.max(a, b), uses: 0, dir: [] };
      entry.uses++;
      entry.dir.push([a, b]);
      map.set(key, entry);
    }
  }
  return map;
};
const countNonManifold = faces => {
  let count = 0;
  for (const edge of edgeMap(faces).values()) if (edge.uses > 2) count++;
  return count;
};
const countOpen = faces => {
  let count = 0;
  for (const edge of edgeMap(faces).values()) if (edge.uses === 1) count++;
  return count;
};

function removeExactDuplicates(mesh) {
  const seen = new Set();
  const before = mesh.faces.length;
  mesh.faces = mesh.faces.filter(face => {
    const key = [...face.key].sort((a, b) => a - b).join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return before - mesh.faces.length;
}

function resolveNonManifold(mesh) {
  let removed = 0;
  for (let iteration = 0; iteration < 20000; iteration++) {
    const bad = new Set();
    for (const edge of edgeMap(mesh.faces).values()) if (edge.uses > 2) bad.add(edgeKey(edge.a, edge.b));
    if (!bad.size) break;
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < mesh.faces.length; i++) {
      let score = 0;
      const key = mesh.faces[i].key;
      for (let e = 0; e < 3; e++) if (bad.has(edgeKey(key[e], key[(e + 1) % 3]))) score++;
      if (score > bestScore) { best = i; bestScore = score; }
    }
    if (best < 0) break;
    mesh.faces.splice(best, 1);
    removed++;
  }
  return removed;
}

function traceBoundaryLoops(mesh) {
  const boundary = [];
  for (const edge of edgeMap(mesh.faces).values()) {
    if (edge.uses === 1) boundary.push(edge.dir[0]);
  }
  const outgoing = new Map();
  boundary.forEach(([a], index) => {
    if (!outgoing.has(a)) outgoing.set(a, []);
    outgoing.get(a).push(index);
  });
  const visited = new Set();
  const loops = [];
  const direction = (a, b) => new THREE.Vector3().subVectors(mesh.world[mesh.representative[b]], mesh.world[mesh.representative[a]]).normalize();
  for (let i = 0; i < boundary.length; i++) {
    if (visited.has(i)) continue;
    const start = boundary[i][0];
    let current = i;
    const loop = [start];
    const local = new Set();
    let ok = true;
    let guard = 0;
    while (!visited.has(current) && guard++ < boundary.length + 1) {
      const [a, b] = boundary[current];
      local.add(current);
      loop.push(b);
      if (b === start) break;
      const candidates = (outgoing.get(b) || []).filter(index => !visited.has(index) && !local.has(index));
      if (!candidates.length) { ok = false; break; }
      const incoming = direction(a, b);
      let next = -1;
      let best = -2;
      for (const candidate of candidates) {
        const [c, d] = boundary[candidate];
        const dot = incoming.dot(direction(c, d));
        if (dot > best) { best = dot; next = candidate; }
      }
      current = next;
    }
    for (const index of local) visited.add(index);
    if (ok && loop.length >= 4 && loop[loop.length - 1] === start) loops.push(loop.slice(0, -1));
  }
  return loops;
}

function splitRepeated(loop) {
  const result = [];
  const stack = [];
  const positions = new Map();
  for (const vertex of loop) {
    if (positions.has(vertex)) {
      const at = positions.get(vertex);
      const cycle = stack.slice(at);
      if (cycle.length >= 3) result.push(cycle);
      for (const removed of cycle.slice(1)) positions.delete(removed);
      stack.length = at + 1;
    } else {
      positions.set(vertex, stack.length);
      stack.push(vertex);
    }
  }
  if (stack.length >= 3) result.push(stack);
  return result;
}

function addCap(mesh, loop) {
  const caps = [];
  for (let i = 1; i < loop.length - 1; i++) {
    const a = mesh.representative[loop[0]];
    const b = mesh.representative[loop[i + 1]];
    const c = mesh.representative[loop[i]];
    if (a === b || b === c || a === c) continue;
    const area = new THREE.Triangle(mesh.world[a], mesh.world[b], mesh.world[c]).getArea();
    if (area < 1e-9) return 0;
    caps.push({ tri: [a, b, c], key: [loop[0], loop[i + 1], loop[i]] });
  }
  if (!caps.length) return 0;
  const before = countNonManifold(mesh.faces);
  mesh.faces.push(...caps);
  if (countNonManifold(mesh.faces) > before) {
    mesh.faces.length -= caps.length;
    return 0;
  }
  return caps.length;
}

function removeDegenerate(mesh) {
  const before = mesh.faces.length;
  mesh.faces = mesh.faces.filter(face => {
    const [a, b, c] = face.tri;
    return new THREE.Triangle(mesh.world[a], mesh.world[b], mesh.world[c]).getArea() >= 1e-9;
  });
  return before - mesh.faces.length;
}

function capAll(mesh) {
  let caps = 0;
  for (let pass = 0; pass < 8; pass++) {
    const loops = traceBoundaryLoops(mesh);
    let added = 0;
    for (const raw of loops) {
      for (const loop of splitRepeated(raw)) {
        for (let origin = 0; origin < loop.length; origin++) {
          const rotated = [...loop.slice(origin), ...loop.slice(0, origin)];
          const made = addCap(mesh, rotated);
          if (made) { caps += made; added++; break; }
        }
      }
    }
    if (!added) break;
  }
  return caps;
}

/**
 * Close a boundary component with one triangle per open edge, fanned from a single existing
 * non-boundary vertex. A component with only degree-2 boundary vertices becomes a clean fan: each
 * radial edge is used by the two adjacent rim triangles. A degree-4 pinched rim (two finger strips
 * meeting at one joint vertex) still becomes closed, but the apex radial edge is shared by four
 * triangles; that is the smallest patch without inventing a vertex. Branched boundaries cannot be
 * capped by a single polygon fan, which is why the earlier loop tracer left them open.
 */
function capResidual(mesh) {
  const rawEdgeState = new Map();
  const rawEdge = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
  for (const face of mesh.faces) {
    for (let e = 0; e < 3; e++) {
      const a = face.tri[e], b = face.tri[(e + 1) % 3];
      const key = rawEdge(a, b);
      const entry = rawEdgeState.get(key) || { uses: 0, dir: [] };
      entry.uses++;
      entry.dir.push([a, b]);
      rawEdgeState.set(key, entry);
    }
  }
  const vertexCount = mesh.representative.length;
  const position = id => mesh.world[mesh.representative[id]];

  // The cap only has to be closed on the welded character, but each raw primitive still has to
  // wind consistently. UV seams give most boundary positions several raw copies. Pick copies that
  // do not create a same-direction raw edge; their positions still match the rim exactly.
  const pickRawFace = (a, c, b) => {
    const alts = mesh.rawCopies[a] || [mesh.representative[a]];
    const centers = mesh.rawCopies[c] || [mesh.representative[c]];
    const blts = mesh.rawCopies[b] || [mesh.representative[b]];
    let fallback = null;
    for (const ra of alts) for (const rc of centers) for (const rb of blts) {
      if (ra === rc || rc === rb || ra === rb) continue;
      let bad = false;
      let shared = 0;
      for (const [u, v] of [[ra, rc], [rc, rb], [rb, ra]]) {
        const entry = rawEdgeState.get(rawEdge(u, v));
        if (!entry) continue;
        shared++;
        if (entry.uses >= 2) { bad = true; break; }
        if (entry.uses === 1 && !entry.dir.some(([x, y]) => x === v && y === u)) { bad = true; break; }
      }
      if (bad) continue;
      const candidate = { tri: [ra, rc, rb], shared };
      if (candidate.shared === 0) return candidate;
      if (!fallback) fallback = candidate;
    }
    return fallback;
  };

  let caps = 0;
  for (let pass = 0; pass < 6; pass++) {
    const edges = edgeMap(mesh.faces);
    const boundary = [...edges.values()].filter(edge => edge.uses === 1).map(edge => edge.dir[0]);
    if (!boundary.length) break;
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
      const component = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const vertex = stack.pop();
        component.push(vertex);
        for (const next of adjacency.get(vertex)) {
          if (!seen.has(next)) { seen.add(next); stack.push(next); }
        }
      }
      components.push(component);
    }

    const chooseApex = (rim, set, used = new Set()) => {
      const box = new THREE.Box3().setFromPoints(rim.flatMap(([a, b]) => [position(a), position(b)]));
      const grow = Math.max(0.04, box.getSize(new THREE.Vector3()).length() * 0.5);
      const min = box.min.clone().addScalar(-grow);
      const max = box.max.clone().addScalar(grow);
      const center = box.getCenter(new THREE.Vector3());
      let best = null;
      for (let c = 0; c < vertexCount; c++) {
        if (set.has(c) || used.has(c)) continue;
        const point = position(c);
        if (point.x < min.x || point.y < min.y || point.z < min.z ||
            point.x > max.x || point.y > max.y || point.z > max.z) continue;
        let conflict = 0;
        let minArea = Infinity;
        for (const [a, b] of rim) {
          const area = new THREE.Triangle(position(a), point, position(b)).getArea();
          if (!(area > 1e-8)) { minArea = 0; break; }
          minArea = Math.min(minArea, area);
          for (const [u, v] of [[a, c], [c, b]]) {
            const edge = edges.get(edgeKey(u, v));
            if (edge && edge.uses >= 2) conflict++;
            else if (edge && edge.uses === 1 && !edge.dir.some(([x, y]) => x === v && y === u)) conflict++;
          }
        }
        if (!(minArea > 1e-8)) continue;
        const distance = point.distanceTo(center);
        if (!best || conflict < best.conflict ||
            (conflict === best.conflict && distance < best.distance)) {
          best = { c, conflict, distance };
        }
      }
      return best;
    };

    const addFan = (rim, apex, set) => {
      for (const [a, b] of rim) {
        const key = [a, apex, b];
        const picked = pickRawFace(a, apex, b);
        if (!picked) {
          console.warn(`[cap] no seam-safe raw triangle for ${mesh.name} rim ${a}-${b}`);
          continue;
        }
        mesh.faces.push({ tri: picked.tri, key });
        for (let e = 0; e < 3; e++) {
          const u = key[e], v = key[(e + 1) % 3];
          const k = edgeKey(u, v);
          const edge = edges.get(k) || { a: Math.min(u, v), b: Math.max(u, v), uses: 0, dir: [] };
          edge.uses++;
          edge.dir.push([u, v]);
          edges.set(k, edge);
          const ru = picked.tri[e], rv = picked.tri[(e + 1) % 3];
          const rk = rawEdge(ru, rv);
          const raw = rawEdgeState.get(rk) || { uses: 0, dir: [] };
          raw.uses++;
          raw.dir.push([ru, rv]);
          rawEdgeState.set(rk, raw);
        }
        caps++;
      }
    };

    let progress = 0;
    for (const component of components) {
      const set = new Set(component);
      const rim = boundary.filter(([a, b]) => set.has(a) && set.has(b));
      if (!rim.length) continue;

      // A pinched degree-4 rim is two boundary loops meeting at one joint vertex. Fanning both
      // loops from one apex closes both but makes the apex-to-joint edge four-manifold. Split the
      // rim into the two loops and give each its own apex: each radial edge is then used twice.
      const incident = new Map();
      rim.forEach(([a, b], index) => {
        for (const vertex of [a, b]) {
          if (!incident.has(vertex)) incident.set(vertex, []);
          incident.get(vertex).push(index);
        }
      });
      const odd = [...incident].filter(([, list]) => list.length !== 2);
      let groups = [rim];
      if (odd.length === 1 && odd[0][1].length === 4) {
        const joint = odd[0][0];
        const subIndices = rim.map((_, index) => index).filter(index => {
          const [a, b] = rim[index];
          return a !== joint && b !== joint;
        });
        const adjacent = new Map();
        for (const index of subIndices) {
          const [a, b] = rim[index];
          if (!adjacent.has(a)) adjacent.set(a, new Set());
          if (!adjacent.has(b)) adjacent.set(b, new Set());
          adjacent.get(a).add(b);
          adjacent.get(b).add(a);
        }
        const visited = new Set();
        const split = [];
        let valid = true;
        for (const start of adjacent.keys()) {
          if (visited.has(start)) continue;
          const vertices = new Set();
          const stack = [start];
          visited.add(start);
          while (stack.length) {
            const vertex = stack.pop();
            vertices.add(vertex);
            for (const next of adjacent.get(vertex)) {
              if (!visited.has(next)) { visited.add(next); stack.push(next); }
            }
          }
          const groupIndices = subIndices.filter(index => {
            const [a, b] = rim[index];
            return vertices.has(a) && vertices.has(b);
          });
          const jointIndices = odd[0][1].filter(index => {
            const [a, b] = rim[index];
            return vertices.has(a === joint ? b : a);
          });
          if (jointIndices.length !== 2) { valid = false; break; }
          split.push([...jointIndices, ...groupIndices]);
        }
        if (valid) {
          const assigned = new Set(split.flat());
          if (assigned.size === rim.length) groups = split.map(indices => indices.map(index => rim[index]));
          else valid = false;
        }
        if (!valid) groups = [rim];
      }

      const used = new Set();
      const apexes = groups.map(group => chooseApex(group, set, used));
      if (groups.length > 1 && apexes.every(Boolean)) {
        apexes.forEach(apex => used.add(apex.c));
        groups.forEach((group, index) => {
          const apex = apexes[index];
          addFan(group, apex.c, set);
          progress += group.length;
          console.log(`[cap] ${mesh.name}: closed ${group.length} edge(s) with split fan apex ${apex.c} ` +
            `(conflicts ${apex.conflict}, distance ${apex.distance.toFixed(4)} m)`);
        });
      } else {
        const apex = chooseApex(rim, set);
        if (!apex) {
          console.warn(`[cap] no fan apex for ${mesh.name} component (${component.length} verts)`);
          continue;
        }
        addFan(rim, apex.c, set);
        progress += rim.length;
        console.log(`[cap] ${mesh.name}: closed ${rim.length} edge(s) with fan apex ${apex.c} ` +
          `(conflicts ${apex.conflict}, distance ${apex.distance.toFixed(4)} m)`);
      }
    }
    if (!progress) break;
  }
  return caps;
}

const report = {};
for (const mesh of meshes) {
  const beforeFaces = mesh.faces.length;
  const duplicateFaces = removeExactDuplicates(mesh);
  const nonManifoldFaces = resolveNonManifold(mesh);
  let capFaces = capAll(mesh);
  const residualFaces = capResidual(mesh);
  capFaces += residualFaces;
  let degenerateFaces = 0;
  for (let pass = 0; pass < 4; pass++) {
    const removed = removeDegenerate(mesh);
    degenerateFaces += removed;
    const recapped = removed ? capAll(mesh) : 0;
    capFaces += recapped;
    if (!removed && !recapped) break;
  }
  const finalPositions = mesh.positions.slice();
  if (offsets.has(mesh.name)) {
    const amount = offsets.get(mesh.name);
    const rotation = new THREE.Matrix3().setFromMatrix4(mesh.node.matrixWorld).invert();
    const localDelta = new THREE.Vector3(0, 0, amount).applyMatrix3(rotation).normalize().multiplyScalar(amount);
    for (const p of finalPositions) p.add(localDelta);
    writePositions(mesh.primitive, finalPositions);
  }
  writeIndices(mesh.primitive, mesh.faces.flatMap(face => face.tri));
  report[mesh.name] = {
    facesBefore: beforeFaces,
    facesAfter: mesh.faces.length,
    duplicateFacesRemoved: duplicateFaces,
    nonManifoldFacesRemoved: nonManifoldFaces,
    degenerateFacesRemoved: degenerateFaces,
    capFaces,
    residualCapFaces: residualFaces,
    openEdgesAfter: countOpen(mesh.faces),
    nonManifoldEdgesAfter: countNonManifold(mesh.faces),
    offsetM: offsets.get(mesh.name) || 0
  };
}

// Remove dropped nodes from the scene graph. Their orphan accessors/meshes are left in the JSON;
// GLTFLoader never instantiates an unreachable node, so no geometry is exported or rendered.
for (const name of dropped) {
  const found = nodeByName.get(name);
  if (!found) continue;
  for (const node of json.nodes) {
    if (node.children) {
      const at = node.children.indexOf(found.index);
      if (at >= 0) node.children.splice(at, 1);
    }
  }
  for (const sceneDef of json.scenes || []) {
    if (!sceneDef.nodes) continue;
    const at = sceneDef.nodes.indexOf(found.index);
    if (at >= 0) sceneDef.nodes.splice(at, 1);
  }
}

// Union watertightness, measured exactly the way inspect-character-glb.mjs measures it, against
// the positions that will actually be written.
const union = new Map();
for (const mesh of meshes) {
  const amount = offsets.get(mesh.name) || 0;
  const rotation = new THREE.Matrix3().setFromMatrix4(mesh.node.matrixWorld).invert();
  const localDelta = new THREE.Vector3(0, 0, amount).applyMatrix3(rotation).normalize().multiplyScalar(amount);
  for (const face of mesh.faces) {
    const points = face.tri.map(index => mesh.positions[index].clone().add(localDelta));
    for (let e = 0; e < 3; e++) {
      const a = keyOf(points[e]);
      const b = keyOf(points[(e + 1) % 3]);
      if (a === b) continue;
      const key = a < b ? a + '|' + b : b + '|' + a;
      union.set(key, (union.get(key) || 0) + 1);
    }
  }
}
const unionValues = [...union.values()];
const unionOpen = unionValues.filter(uses => uses === 1).length;
const unionNonManifold = unionValues.filter(uses => uses > 2).length;

json.buffers[0].byteLength = pad4(binSize);
const bin = Buffer.concat(binParts);
if (bin.length < json.buffers[0].byteLength) binParts.push(Buffer.alloc(json.buffers[0].byteLength - bin.length));
const finalBin = Buffer.concat(binParts);
const jsonText = JSON.stringify(json);
const jsonPad = pad4(Buffer.byteLength(jsonText));
const jsonChunk = Buffer.alloc(jsonPad, 0x20);
jsonChunk.write(jsonText, 0, 'utf8');
const binChunk = Buffer.alloc(pad4(finalBin.length));
finalBin.copy(binChunk);
const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
const output = Buffer.alloc(total);
output.write('glTF', 0, 'ascii');
output.writeUInt32LE(2, 4);
output.writeUInt32LE(total, 8);
output.writeUInt32LE(jsonChunk.length, 12);
output.write('JSON', 16, 'ascii');
jsonChunk.copy(output, 20);
output.writeUInt32LE(binChunk.length, 20 + jsonChunk.length);
output.write('BIN\0', 24 + jsonChunk.length, 'ascii');
binChunk.copy(output, 28 + jsonChunk.length);
writeFileSync(out, output);
console.log('REPAIR_REPORT:' + JSON.stringify({
  file: out,
  bytes: output.length,
  dropped: [...dropped],
  meshes: report,
  union: { openEdges: unionOpen, nonManifoldEdges: unionNonManifold, budget: 80 }
}, null, 1));
