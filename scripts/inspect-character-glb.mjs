// Inspect an exported character GLB the way the game will load it.
//
// This is the "confirm the exported file actually contains what you think" step: it parses the
// GLB with the same three.js GLTFLoader the browser uses, then reports meshes, materials,
// skins, the resolved canonical rig, animation clips and the model's real bounds.
//
//   node scripts/inspect-character-glb.mjs public/models/characters/kaze/kaze.glb
//
// Exit code is non-zero when the file is missing something a playable fighter needs: geometry,
// a skinned mesh, a resolvable eleven-joint rig, or at least one animation clip.
import './glb-node-compat.mjs';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { resolveRig, describeRig, CANONICAL_BONES } from '../public/js/anim/rig_map.js';

const file = resolve(process.argv[2] || 'public/models/characters/kaze/kaze.glb');

function parseGlb(buffer) {
  return new Promise((ok, fail) => {
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    new GLTFLoader().parse(arrayBuffer, '', ok, error => fail(new Error(String(error?.message || error))));
  });
}

const bytes = readFileSync(file);
const gltf = await parseGlb(bytes);
const scene = gltf.scene || gltf.scenes[0];
// Without this the exporter's Z-up root rotation is not applied to the children's world
// matrices, and every measurement below would be taken in the wrong frame.
scene.updateMatrixWorld(true);

const meshes = [];
const materials = new Set();
let skinnedMeshes = 0;
let triangles = 0;
let vertices = 0;
const skeletons = new Set();
// Per-primitive mesh quality. Every glTF primitive becomes its own mesh in three, usually one per
// material, which is exactly the granularity needed to talk about "the gi" or "the wrap".
//
// The kernel test (scripts/test-geometry-kernel.py) checks this while the model is being built;
// this one checks that the *export* still has it, because welding, quantisation and the exporter's
// triangulation are all places a clean mesh can pick up holes or inverted faces.
const quality = [];
const openBandMaterials = new Set(['kaze-sash', 'fighter-accent']);
scene.traverse(node => {
  if (!node.isMesh) return;
  meshes.push(node.name || '(unnamed)');
  const list = Array.isArray(node.material) ? node.material : [node.material];
  for (const mat of list) if (mat) materials.add(mat.name || mat.uuid);
  const geometry = node.geometry;
  if (geometry?.index) triangles += geometry.index.count / 3;
  else if (geometry?.attributes?.position) triangles += geometry.attributes.position.count / 3;
  if (geometry?.attributes?.position) vertices += geometry.attributes.position.count;
  if (node.isSkinnedMesh) {
    skinnedMeshes++;
    if (node.skeleton) skeletons.add(node.skeleton);
  }
  if (geometry?.attributes?.position) {
    quality.push(measurePrimitive(node, list.map(mat => mat?.name).filter(Boolean)));
  }
});

function measurePrimitive(node, materialNames) {
  const geometry = node.geometry;
  const position = geometry.attributes.position;
  const index = geometry.index;
  const count = index ? index.count : position.count;
  const get = i => (index ? index.getX(i) : i);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cross = new THREE.Vector3();
  let degenerate = 0;
  const edges = new Map();
  let faces = 0, volume = 0;
  for (let i = 0; i + 2 < count; i += 3) {
    const ia = get(i), ib = get(i + 1), ic = get(i + 2);
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    cross.crossVectors(ab, ac);
    const area = cross.length() * 0.5;
    if (area < 1e-9) degenerate++;
    for (const [p, q] of [[ia, ib], [ib, ic], [ic, ia]]) {
      const key = p < q ? p + ':' + q : q + ':' + p;
      const entry = edges.get(key) || { uses: 0, forward: 0, reverse: 0 };
      entry.uses++;
      if (p < q) entry.forward++; else entry.reverse++;
      edges.set(key, entry);
    }
    // Winding, and it takes two different tests.
    //
    // *Orientation* - is the part inside-out? - is a signed-volume question for a closed surface, so
    // it is decided by volume wherever the volume is measurable. A thin part (a lash, a brow, a
    // mouth line: a closed loft a few millimetres deep) encloses almost nothing, and float error
    // makes the sign of its volume meaningless, so this check only rules on parts whose volume is
    // unambiguous. Every part's orientation is additionally enforced at build time, per part, by the
    // kernel (assets/blender/build_anime_fighter.py, mesh_object()).
    //
    // The earlier version of this check compared every face's normal against the direction from the
    // primitive's own centroid. That is not a winding test: for a primitive that aggregates several
    // small flat pieces in different planes (the pupils, lashes and brows share one material) the
    // radial direction is nearly perpendicular to every face and the sign is a coin toss - it
    // reported a correctly wound body as 44% inside-out.
    //
    // *Consistency* - do the faces agree with each other? - is topological, and it can be tested
    // exactly: in a consistently wound surface every interior edge is traversed once in each
    // direction by the two faces sharing it. An edge used twice in the same direction means those
    // two faces disagree. That catches a flipped face or a flipped region in any mesh at all, solid
    // or flat, open or closed.
    faces++;
    volume += a.dot(cross.crossVectors(b, c)) / 6;
  }
  let boundaryEdges = 0;
  let inconsistentEdges = 0;
  for (const entry of edges.values()) {
    if (entry.uses === 1) boundaryEdges++;
    else if (entry.uses === 2 && (entry.forward === 2 || entry.reverse === 2)) inconsistentEdges++;
  }
  return {
    name: node.name || '(unnamed)',
    materials: materialNames,
    triangles: Math.round(count / 3),
    degenerate,
    edges,
    closed: boundaryEdges === 0,
    inconsistentEdges,
    signedVolume: +volume.toFixed(8),
    openBand: materialNames.some(name => openBandMaterials.has(name))
  };
}

// Watertightness has to be judged on the whole character, not per primitive: the exporter splits
// the joined body into one primitive per material, so every place two materials meet inside a
// single closed surface shows up as an open edge in that primitive alone. Welding positions across
// all primitives puts those seams back together. The sash and the two wrist wraps are deliberately
// open bands, so the budget below is their four hems plus a margin.
const BOUNDARY_BUDGET = 80;
const weldKey = point => `${Math.round(point.x * 1e5)},${Math.round(point.y * 1e5)},${Math.round(point.z * 1e5)}`;
const unionEdges = new Map();
scene.traverse(node => {
  if (!node.isMesh) return;
  const position = node.geometry?.attributes?.position;
  const index = node.geometry?.index;
  if (!position || !index) return;
  const ids = new Map();
  const keyFor = i => {
    if (!ids.has(i)) {
      const point = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld);
      ids.set(i, weldKey(point));
    }
    return ids.get(i);
  };
  for (let i = 0; i + 2 < index.count; i += 3) {
    const tri = [keyFor(index.getX(i)), keyFor(index.getX(i + 1)), keyFor(index.getX(i + 2))];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      if (a === b) continue;
      const key = a < b ? a + '|' + b : b + '|' + a;
      unionEdges.set(key, (unionEdges.get(key) || 0) + 1);
    }
  }
});
const unionBoundary = [...unionEdges.values()].filter(uses => uses === 1).length;
const unionNonManifold = [...unionEdges.values()].filter(uses => uses > 2).length;

// Layer separation only matters between garments that cover one another. Features that are *meant*
// to sit millimetres apart - iris on the eyeball, fringe over the brow - are not layers and are
// excluded, otherwise the check would fail on a correctly built face.
// Both naming schemes are listed deliberately. The reference fighter's materials are prefixed
// `kaze-`; the generated roster bodies use the `fighter-` names the form system matches on. A pipe
// that replaced one prefix with the other left this check silently covering nothing.
const GARMENT_LAYERS = new Set([
  'kaze-gi', 'kaze-gi-shade', 'kaze-undershirt', 'kaze-sash', 'kaze-trousers',
  'fighter-gi', 'fighter-gi-shade', 'fighter-undershirt', 'fighter-sash', 'fighter-trousers'
]);

// Coincident layers: two garment surfaces in the same place z-fight, which is what the stippled
// chest turned out to be. Sample vertices of each primitive and count how many land within 3 mm of
// a vertex belonging to a *different* material. Layer separation is a data property, so a failure
// here means the offset between the layers was lost, not that the renderer misbehaved.
const layerPoints = new Map();
scene.traverse(node => {
  if (!node.isMesh) return;
  const position = node.geometry?.attributes?.position;
  if (!position) return;
  const key = (Array.isArray(node.material) ? node.material : [node.material])
    .map(mat => mat?.name).filter(Boolean).join('+');
  const list = layerPoints.get(key) || [];
  for (let i = 0; i < position.count; i += 2) {
    list.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld));
  }
  layerPoints.set(key, list);
});
const coincidentLayers = [];
const layerKeys = [...layerPoints.keys()].filter(key => GARMENT_LAYERS.has(key));
for (let i = 0; i < layerKeys.length; i++) {
  for (let j = i + 1; j < layerKeys.length; j++) {
    const first = layerPoints.get(layerKeys[i]);
    const second = layerPoints.get(layerKeys[j]);
    // A grid hash keeps this linear; the models here have ~6k sampled vertices per layer at most.
    const cell = 0.003;
    const grid = new Map();
    for (const point of second) {
      const key = `${Math.floor(point.x / cell)},${Math.floor(point.y / cell)},${Math.floor(point.z / cell)}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(point); else grid.set(key, [point]);
    }
    let hits = 0;
    for (const point of first) {
      const gx = Math.floor(point.x / cell), gy = Math.floor(point.y / cell), gz = Math.floor(point.z / cell);
      let found = false;
      for (let dx = -1; dx <= 1 && !found; dx++)
        for (let dy = -1; dy <= 1 && !found; dy++)
          for (let dz = -1; dz <= 1 && !found; dz++) {
            const bucket = grid.get(`${gx + dx},${gy + dy},${gz + dz}`);
            if (!bucket) continue;
            for (const other of bucket) if (other.distanceToSquared(point) < cell * cell) { found = true; break; }
          }
      if (found) hits++;
    }
    const ratio = first.length ? hits / first.length : 0;
    if (hits) coincidentLayers.push({ layers: [layerKeys[i], layerKeys[j]], hits, of: first.length, ratio: +ratio.toFixed(3) });
  }
}

const boneNames = [...skeletons].flatMap(skeleton => skeleton.bones.map(bone => bone.name));
const rig = resolveRig(scene);
const box = new THREE.Box3().setFromObject(scene);
const size = box.getSize(new THREE.Vector3());

// Solidity: a body built from lofted volumes fills every horizontal slice. A part whose rings are
// stacked in a single vertical plane instead of across the body's width and depth collapses to
// one flat sheet, which reads as a paper cutout in game and z-fights against anything it is
// layered with. This walks 10 cm height bands and records how deep the geometry is in each, so
// that defect fails a check instead of waiting to be noticed in a screenshot.
const bands = new Map();
const probe = new THREE.Vector3();
scene.traverse(node => {
  if (!node.isMesh) return;
  const position = node.geometry?.attributes?.position;
  if (!position) return;
  for (let i = 0; i < position.count; i++) {
    probe.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld);
    const band = Math.floor(probe.y * 10) / 10;
    const entry = bands.get(band) || { count: 0, zMin: Infinity, zMax: -Infinity, xMin: Infinity, xMax: -Infinity };
    entry.count++;
    entry.zMin = Math.min(entry.zMin, probe.z);
    entry.zMax = Math.max(entry.zMax, probe.z);
    entry.xMin = Math.min(entry.xMin, probe.x);
    entry.xMax = Math.max(entry.xMax, probe.x);
    bands.set(band, entry);
  }
});
const flatBands = [...bands.entries()]
  .filter(([, entry]) => entry.count >= 40)
  .map(([band, entry]) => ({ band: +band.toFixed(2), count: entry.count,
    depth: +(entry.zMax - entry.zMin).toFixed(3), width: +(entry.xMax - entry.xMin).toFixed(3) }))
  .sort((a, b) => a.band - b.band);
const collapsed = flatBands.filter(entry => entry.depth < 0.04 && entry.width > 0.12);

const clips = (gltf.animations || []).map(clip => ({
  name: clip.name,
  duration: +clip.duration.toFixed(2),
  tracks: clip.tracks.length
}));

console.log(JSON.stringify({
  file,
  bytes: statSync(file).size,
  meshes: meshes.length,
  meshNames: meshes.slice(0, 8),
  skinnedMeshes,
  vertices,
  triangles: Math.round(triangles),
  materials: materials.size,
  materialNames: [...materials],
  bones: boneNames.length,
  boneNames,
  rig: { kind: rig?.kind, bound: rig?.boundCount, missing: rig?.missing,
    missingCore: rig?.missingCore,
    extensionGaps: (rig?.missing || []).filter(bone => !(rig?.missingCore || []).includes(bone)),
    description: describeRig ? describeRig(rig) : undefined },
  canonicalBones: CANONICAL_BONES,
  clips,
  quality,
  watertight: { boundaryEdges: unionBoundary, nonManifoldEdges: unionNonManifold, budget: BOUNDARY_BUDGET },
  coincidentLayers,
  solidity: { bands: flatBands, collapsedBands: collapsed },
  bounds: {
    height: +size.y.toFixed(3),
    width: +size.x.toFixed(3),
    depth: +size.z.toFixed(3),
    feetY: +box.min.y.toFixed(3)
  }
}, null, 2));

const problems = [];
if (meshes.length === 0) problems.push('no meshes');
if (skinnedMeshes === 0) problems.push('no skinned mesh (the model is not bound to a skeleton)');
// The runtime contract is the core eleven joints; rig_map reports the extension slots (neck,
// clavicles, wrists, ankles) as optional, so the gate enforces the same split instead of demanding
// bones a source rig never had. Core gaps still fail.
const missingCore = rig?.missingCore || rig?.missing || CANONICAL_BONES;
if (!rig || rig.kind !== 'bone' || missingCore.length > 0) {
  problems.push('rig does not resolve the core canonical bones: ' + JSON.stringify(missingCore));
} else if ((rig.missing || []).length) {
  console.log('[rig] optional extension bones absent: ' + rig.missing.join(', '));
}
if (clips.length === 0) problems.push('no animation clips');
if (size.y < 1.2 || size.y > 4) problems.push(`height ${size.y.toFixed(2)} m is outside the fighter range`);
if (Math.abs(box.min.y) > 0.25) problems.push(`feet sit ${box.min.y.toFixed(2)} m off the origin`);
if (collapsed.length) {
  problems.push('flat geometry: ' + collapsed.map(entry =>
    `${entry.depth} m deep across ${entry.width} m at y=${entry.band}`).join('; ') +
    ' (lofted parts must stack rings across the body, not inside one plane)');
}
// Below this a closed part's volume is indistinguishable from zero, so its sign says nothing.
const VOLUME_FLOOR = 1e-6;
for (const part of quality) {
  if (part.degenerate > 0) problems.push(`${part.name}: ${part.degenerate} zero-area triangle(s)`);
  // A closed surface with a measurable negative volume is inside-out: it still renders, because the
  // glTF materials are double-sided, but its normals point into the body.
  if (part.closed && part.signedVolume < -VOLUME_FLOOR) {
    problems.push(`${part.name}: closed surface encloses ${part.signedVolume} m3 of signed ` +
      'volume (inside-out mesh)');
  }
  // Faces that disagree with their neighbours, in any mesh at all.
  if (part.inconsistentEdges > 0) {
    problems.push(`${part.name}: ${part.inconsistentEdges} edge(s) traversed twice in the same ` +
      'direction (faces wind inconsistently)');
  }
}
if (unionBoundary > BOUNDARY_BUDGET) {
  problems.push(`${unionBoundary} open boundary edge(s) on the welded character ` +
    `(budget ${BOUNDARY_BUDGET}: the sash and two wrap hems are open by design)`);
}
// Non-manifold edges on the welded union are reported but not failed: this model is a union of
// separate closed parts, so two parts that touch at exactly one shared position (mirrored halves at
// x=0, an ear meeting the skull) weld into a T-junction that means nothing. Per-part manifoldness,
// where the part identity is known, is enforced by scripts/test-geometry-kernel.py instead.
if (unionNonManifold > 0) {
  console.log(`\nnote: ${unionNonManifold} welded edge(s) are shared by more than two faces ` +
    '(parts touching exactly; per-part manifoldness is checked by the Blender kernel test)');
}
for (const pair of coincidentLayers) {
  if (pair.ratio > 0.05) {
    problems.push(`coincident surfaces between ${pair.layers.join(' and ')}: ` +
      `${pair.hits} of ${pair.of} sampled vertices within 3 mm (layers lost their offset)`);
  }
}

if (problems.length) {
  console.error('\nFAILED: ' + problems.join('; '));
  process.exit(1);
}
console.log(`\nOK: ${meshes.length} mesh(es), ${skinnedMeshes} skinned, ${boneNames.length} bones, ` +
  `${clips.length} clips, ${Math.round(triangles)} triangles, ${size.y.toFixed(2)} m tall.`);
