// Objective quality metrics for every exported roster body, so a refinement pass can be shown to
// have improved something instead of asserted to have improved something.
//
//   node scripts/measure-model-refinement.mjs > artifacts/model-quality.json
//
// Every number comes out of the exported GLB through the game's own GLTFLoader. Two things this
// measurement is for:
//   1. direction - run it before and after a Blender pass and diff the reports,
//   2. regression - `--gate` exits non-zero when a body drops below the recorded floor, so a
//      refinement that quietly deletes geometry, materials, clips or UVs cannot pass unnoticed.
//
// It is a heuristic scoreboard, not a quality certificate: a high triangle count is not good art.
import './glb-node-compat.mjs';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';
import { resolveRig, CANONICAL_BONES } from '../public/js/anim/rig_map.js';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('public/models/characters/manifest.json', root), 'utf8'));
const gate = process.argv.includes('--gate');
// The same locomotion table the clip builder shapes poses from, so the report can show that each
// body's animation really does follow that body's own movement identity.
const locomotionSource = readFileSync(new URL('public/js/combat/locomotion.js', root), 'utf8')
  .split('ARCHETYPE_LOCOMOTION')[0];
const speedMultipliers = {};
for (const match of locomotionSource.matchAll(/^\s*([a-z0-9_]+):\s*profile\(\s*([0-9.]+)/gm)) {
  speedMultipliers[match[1]] = Number(match[2]);
}
const baselinePath = new URL('artifacts/model-quality.json', root);

function parseGlb(buffer) {
  return new Promise((ok, fail) => {
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    new GLTFLoader().parse(arrayBuffer, '', ok, error => fail(new Error(String(error?.message || error))));
  });
}

/**
 * Largest angular distance between any two keys of one quaternion track, in degrees.
 *
 * This must be a *deviation*, not the angle from identity: the glTF exporter writes each bone's
 * absolute node rotation (rest orientation included), so a shoulder at rest already reads ~170deg
 * from identity. Comparing keys against each other measures how far the clip actually moves that
 * bone and is independent of the rest pose. The exporter also bakes every deform bone into every
 * action, so "how many bones does the clip animate" is always 19 - the useful question is how many
 * of them it moves at all, which is what `movingBones` counts.
 */
function trackDeviation(values) {
  const count = Math.floor(values.length / 4);
  let max = 0;
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const dot = Math.abs(
        values[i * 4] * values[j * 4] + values[i * 4 + 1] * values[j * 4 + 1] +
        values[i * 4 + 2] * values[j * 4 + 2] + values[i * 4 + 3] * values[j * 4 + 3]
      );
      max = Math.max(max, 2 * Math.acos(Math.min(1, dot)) * (180 / Math.PI));
    }
  }
  return max;
}

/** Edge classification: open boundaries and non-manifold edges mean holes or T-junctions. */
function meshTopology(geometry) {
  const position = geometry?.attributes?.position;
  if (!position) return { boundaryEdges: 0, nonManifoldEdges: 0, degenerate: 0, openShellEdges: 0 };
  const index = geometry.index;
  const count = index ? index.count : position.count;
  const edges = new Map();
  const vertex = i => (index ? index.getX(i) : i);
  const key = (a, b) => (a < b ? a * 1000003 + b : b * 1000003 + a);
  let degenerate = 0;
  for (let f = 0; f < count; f += 3) {
    const a = vertex(f), b = vertex(f + 1), c = vertex(f + 2);
    if (a === b || b === c || a === c) { degenerate++; continue; }
    const pa = new THREE.Vector3().fromBufferAttribute(position, a);
    const pb = new THREE.Vector3().fromBufferAttribute(position, b);
    const pc = new THREE.Vector3().fromBufferAttribute(position, c);
    // Zero-area triangles shade badly and are the signature of a collapsed loft ring.
    if (pb.clone().sub(pa).cross(pc.clone().sub(pa)).length() < 1e-9) degenerate++;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = key(u, v);
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  let boundaryEdges = 0, nonManifoldEdges = 0;
  for (const uses of edges.values()) {
    if (uses === 1) boundaryEdges++;
    else if (uses > 2) nonManifoldEdges++;
  }
  // Second, welded pass. The glTF exporter splits vertices at UV seams, so the index-based count
  // above calls every seam an open boundary and cannot tell a hole from a texture seam: a Blender
  // torus reports 0 open edges in Blender yet contributes 64 here (two seam rings of 8 and 24 edges).
  // Welding by position first measures the surface's real openness. This is added as its own field
  // on purpose - `boundaryEdges` keeps its original definition so recorded history stays comparable.
  const weld = new Map();
  const canonical = i => {
    const k = Math.round(position.getX(i) * 1e5) + ':' + Math.round(position.getY(i) * 1e5) + ':' + Math.round(position.getZ(i) * 1e5);
    let id = weld.get(k);
    if (id === undefined) { id = weld.size; weld.set(k, id); }
    return id;
  };
  const welded = new Map();
  for (let f = 0; f < count; f += 3) {
    const a = canonical(vertex(f)), b = canonical(vertex(f + 1)), c = canonical(vertex(f + 2));
    if (a === b || b === c || a === c) continue;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = u < v ? u * 1000003 + v : v * 1000003 + u;
      welded.set(k, (welded.get(k) || 0) + 1);
    }
  }
  let openShellEdges = 0;
  for (const uses of welded.values()) if (uses === 1) openShellEdges++;
  return { boundaryEdges, nonManifoldEdges, degenerate, openShellEdges };
}

/** Silhouette and volume from the vertex cloud: catches paper-flat parts and wrong proportions. */
function silhouette(scene) {
  const points = [];
  scene.traverse(node => {
    const position = node.isMesh ? node.geometry?.attributes?.position : null;
    if (!position) return;
    for (let i = 0; i < position.count; i++) {
      points.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld));
    }
  });
  if (!points.length) return null;
  const box = new THREE.Box3();
  for (const p of points) box.expandByPoint(p);
  const height = box.max.y - box.min.y;
  // Per-band depth/width ratio: the original defect produced parts with width but ~0 depth at
  // several height bands, which this catches even in a body that otherwise measures fine.
  const bands = new Map();
  for (const p of points) {
    const band = Math.floor((p.y - box.min.y) * 10) / 10;
    const entry = bands.get(band) || { zMin: Infinity, zMax: -Infinity, xMin: Infinity, xMax: -Infinity, n: 0 };
    entry.zMin = Math.min(entry.zMin, p.z); entry.zMax = Math.max(entry.zMax, p.z);
    entry.xMin = Math.min(entry.xMin, p.x); entry.xMax = Math.max(entry.xMax, p.x);
    entry.n++;
    bands.set(band, entry);
  }
  let minDepthRatio = Infinity;
  for (const entry of bands.values()) {
    if (entry.n < 40) continue;
    const depth = entry.zMax - entry.zMin, width = entry.xMax - entry.xMin;
    if (width <= 0.12) continue;
    minDepthRatio = Math.min(minDepthRatio, depth / width);
  }
  // These are spans of the raw vertex cloud across height bands, not anatomical measurements:
  // `upperSpan` at 76-88% of height reads shoulders plus any pauldrons and hair, `midSpan` at
  // 48-56% reads the arms hanging beside the hips. They are here to catch a body that is obviously
  // out of proportion, not to certify anatomy.
  const upper = points.filter(p => p.y > box.min.y + height * 0.76 && p.y < box.min.y + height * 0.88);
  const mid = points.filter(p => p.y > box.min.y + height * 0.48 && p.y < box.min.y + height * 0.56);
  const span = list => (list.length ? Math.max(...list.map(p => p.x)) - Math.min(...list.map(p => p.x)) : 0);
  const depthSpan = list => (list.length ? Math.max(...list.map(p => p.z)) - Math.min(...list.map(p => p.z)) : 0);
  return {
    height: Number(height.toFixed(3)),
    upperSpan: Number(span(upper).toFixed(3)),
    midSpan: Number(span(mid).toFixed(3)),
    upperDepth: Number(depthSpan(upper).toFixed(3)),
    minBandDepthRatio: Number.isFinite(minDepthRatio) ? Number(minDepthRatio.toFixed(3)) : null
  };
}

/** Per-clip motion: how many bones actually move, and how far the busiest of them travels. */
function clipMetrics(animations) {
  return (animations || []).map(clip => {
    let movingBones = 0;
    let maxAngle = 0;
    let total = 0;
    let keys = 0;
    const deviations = [];
    for (const track of clip.tracks) {
      keys = Math.max(keys, track.times.length);
      if (!track.name.endsWith('quaternion')) continue;
      const deviation = trackDeviation(track.values);
      deviations.push(deviation);
      if (deviation > 2) movingBones++;
      maxAngle = Math.max(maxAngle, deviation);
      total += deviation;
    }
    return {
      name: clip.name,
      duration: Number(clip.duration.toFixed(2)),
      keyframes: keys,
      tracks: deviations.length,
      movingBones,
      maxAngle: Number(maxAngle.toFixed(1)),
      meanAngle: Number((total / Math.max(1, deviations.length)).toFixed(1))
    };
  });
}

const bodies = {};
for (const [slug, entry] of Object.entries(manifest.characters || {})) {
  const url = String(entry.url || '');
  if (entry.enabled !== true || !url) continue;
  const file = fileURLToPath(new URL(`public/${url.replace(/^\//, '').split('?')[0]}`, root));
  if (!existsSync(file)) continue;
  try {
    const gltf = await parseGlb(readFileSync(file));
    const scene = gltf.scene || gltf.scenes[0];
    scene.updateMatrixWorld(true);
    let meshes = 0, triangles = 0, vertices = 0, boundaryEdges = 0, nonManifoldEdges = 0, degenerate = 0, openShellEdges = 0;
    let uvCovered = 0;
    const materials = new Set();
    scene.traverse(node => {
      if (!node.isMesh) return;
      meshes++;
      const geometry = node.geometry;
      if (geometry?.attributes?.uv) uvCovered++;
      if (geometry?.index) triangles += geometry.index.count / 3;
      else if (geometry?.attributes?.position) triangles += geometry.attributes.position.count / 3;
      if (geometry?.attributes?.position) vertices += geometry.attributes.position.count;
      for (const mat of (Array.isArray(node.material) ? node.material : [node.material])) {
        if (mat) materials.add(mat.name || mat.uuid);
      }
      const topo = meshTopology(geometry);
      boundaryEdges += topo.boundaryEdges;
      nonManifoldEdges += topo.nonManifoldEdges;
      degenerate += topo.degenerate;
      openShellEdges += topo.openShellEdges;
    });
    const rig = resolveRig(scene);
    const clips = clipMetrics(gltf.animations);
    const shape = silhouette(scene);
    const movingBones = clips.length ? Math.max(...clips.map(c => c.movingBones)) : 0;
    const meanMovingBones = clips.length
      ? Number((clips.reduce((n, c) => n + c.movingBones, 0) / clips.length).toFixed(1)) : 0;
    const motionRange = clips.length
      ? Number((clips.reduce((n, c) => n + c.maxAngle, 0) / clips.length).toFixed(1)) : 0;
    const meanMotionPerBone = clips.length
      ? Number((clips.reduce((n, c) => n + c.meanAngle, 0) / clips.length).toFixed(1)) : 0;
    bodies[slug] = {
      url,
      triangles: Math.round(triangles), meshes, vertices, materials: materials.size,
      uvCoveredMeshes: uvCovered, boundaryEdges, nonManifoldEdges, degenerateTriangles: degenerate, openShellEdges,
      bones: rig?.boundCount ?? 0, canonicalMissing: rig?.missing ?? CANONICAL_BONES.slice(),
      clips: clips.length, clipMetrics: clips,
      movingBones, meanMovingBones, meanMotionRange: motionRange, meanMotionPerBone,
      // The fighter's own locomotion multiplier, and the stride its clips were built with.
      speedMultiplier: speedMultipliers[slug] ?? null,
      clipStride: Number(Math.min(1.28, Math.max(0.86, speedMultipliers[slug] ?? 1)).toFixed(3)),
      shape
    };
  } catch (error) {
    bodies[slug] = { url, error: String(error?.message || error) };
  }
}

const list = Object.values(bodies).filter(b => !b.error);
const sum = key => list.reduce((n, b) => n + (b[key] || 0), 0);
const round = (value, places = 2) => Number(value.toFixed(places));
const totals = {
  bodies: list.length,
  triangles: sum('triangles'),
  meanTriangles: list.length ? Math.round(sum('triangles') / list.length) : 0,
  meshes: sum('meshes'),
  meanMeshes: list.length ? round(sum('meshes') / list.length, 1) : 0,
  materials: list.length ? round(sum('materials') / list.length, 1) : 0,
  degenerateTriangles: sum('degenerateTriangles'),
  nonManifoldEdges: sum('nonManifoldEdges'),
  boundaryEdges: sum('boundaryEdges'),
  clipsPerBody: list.length ? round(sum('clips') / list.length, 2) : 0,
  meanMovingBonesPerClip: list.length ? round(sum('meanMovingBones') / list.length, 1) : 0,
  meanMotionRange: list.length ? round(sum('meanMotionRange') / list.length, 1) : 0,
  meanMotionPerBone: list.length ? round(sum('meanMotionPerBone') / list.length, 1) : 0,
  uvCoverage: sum('meshes') ? round((100 * sum('uvCoveredMeshes')) / sum('meshes'), 1) : 0,
  distinctSpeeds: new Set(list.map(b => b.speedMultiplier).filter(Number.isFinite)).size,
  distinctClipStrides: new Set(list.map(b => b.clipStride).filter(Number.isFinite)).size
};

// Per-clip coverage across the roster. A held clip that moves almost nothing is a static pose, not
// animation - the first measurement of this roster read the idle clip as moving zero bones - so the
// gate carries an absolute floor for held clips as well as the baseline comparison.
const perClip = {};
for (const body of list) {
  for (const clip of body.clipMetrics) {
    const entry = perClip[clip.name] || (perClip[clip.name] = { bodies: 0, movingBones: 0, maxAngle: 0, keyframes: 0 });
    entry.bodies++;
    entry.movingBones += clip.movingBones;
    entry.maxAngle += clip.maxAngle;
    entry.keyframes += clip.keyframes;
  }
}
const clipCoverage = Object.fromEntries(Object.entries(perClip).map(([name, entry]) => [name, {
  bodies: entry.bodies,
  meanMovingBones: round(entry.movingBones / entry.bodies, 1),
  meanMaxAngle: round(entry.maxAngle / entry.bodies, 1),
  meanKeyframes: Math.round(entry.keyframes / entry.bodies)
}]));
const HELD_FLOOR = 6;
const staticClips = Object.entries(clipCoverage)
  .filter(([, entry]) => entry.meanMovingBones < HELD_FLOOR)
  .map(([name]) => name);

// ---------------------------------------------------------------------------------------------
// The detail index is a direction indicator with a published formula, not a verdict:
//   triangles (25%) + meshes (15%) + materials (10%) + animated bones per clip (25%)
//   + motion range (15%) + band depth ratio (10%), each normalised against a reference value.
const REFERENCE = { triangles: 14000, meshes: 40, materials: 14, meanMovingBones: 17, meanMotionRange: 60, minBandDepthRatio: 0.5 };
const score = body => {
  const part = (value, ref) => Math.min(1, Math.max(0, (value || 0) / ref));
  const value =
    part(body.triangles, REFERENCE.triangles) * 0.25 +
    part(body.meshes, REFERENCE.meshes) * 0.15 +
    part(body.materials, REFERENCE.materials) * 0.10 +
    part(body.meanMovingBones, REFERENCE.meanMovingBones) * 0.25 +
    part(body.meanMotionRange, REFERENCE.meanMotionRange) * 0.15 +
    part(body.shape?.minBandDepthRatio, REFERENCE.minBandDepthRatio) * 0.10;
  return Number((value * 100).toFixed(1));
};
for (const body of list) body.detailIndex = score(body);
const meanDetailIndex = list.length ? round(list.reduce((n, b) => n + b.detailIndex, 0) / list.length, 1) : 0;

const report = {
  generated: new Date().toISOString().slice(0, 19).replace('T', ' '),
  measuredBy: 'node scripts/measure-model-refinement.mjs',
  reference: REFERENCE,
  clipCoverage,
  staticClips,
  note: 'Objective metrics from the exported GLBs. A higher triangle count is not better art; the detail index tracks direction between runs and the gate refuses regressions. Animation is measured as key-to-key deviation per bone, not as angle from identity: the glTF exporter writes absolute node rotations (rest orientation included) and bakes every deform bone into every action, so rest-relative angle and bone counts say nothing about how much a clip moves.',
  totals: { ...totals, meanDetailIndex },
  bodies
};

// Topology reference, measured from the pre-refinement GLBs (see scripts/diag-topology.mjs). Welded
// open-shell counts are what a hole looks like; boundaryEdges also carry UV-seam splits, so both are
// compared and neither may grow.
const topologyReferencePath = new URL('artifacts/model-topology.reference.json', root);
let topologyReference = null;
if (gate && existsSync(topologyReferencePath)) {
  try { topologyReference = JSON.parse(readFileSync(topologyReferencePath, 'utf8')); } catch { topologyReference = null; }
}
let baseline = null;
if (gate && existsSync(baselinePath)) {
  try { baseline = JSON.parse(readFileSync(baselinePath, 'utf8')); } catch { baseline = null; }
}

const failures = [];
// Absolute floor, checked whether or not a baseline exists: every clip (held or dynamic) must move
// at least this many bones on average across the roster. This is what stops a held pose shipping as
// animation just because the file loads.
if (staticClips.length) {
  failures.push(`clips below the ${HELD_FLOOR}-bone motion floor: ` +
    staticClips.map(name => `${name} (${clipCoverage[name].meanMovingBones} bones)`).join(', '));
}
if (gate && baseline) {
  const worse = (before, after, tolerance, label) => {
    if (!Number.isFinite(before) || !Number.isFinite(after)) return;
    if (after < before - tolerance) failures.push(`${label}: ${before} -> ${after}`);
  };
  for (const [slug, body] of Object.entries(bodies)) {
    const before = baseline.bodies?.[slug];
    if (!before || before.error) continue;
    if (body.error) { failures.push(`${slug}: no longer measurable (${body.error})`); continue; }
    worse(before.triangles, body.triangles, Math.ceil(before.triangles * 0.02), `${slug} triangles`);
    worse(before.meshes, body.meshes, 0, `${slug} meshes`);
    worse(before.materials, body.materials, 0, `${slug} materials`);
    worse(before.clips, body.clips, 0, `${slug} clips`);
    worse(before.bones, body.bones, 0, `${slug} bound canonical bones`);
    worse(before.uvCoveredMeshes, body.uvCoveredMeshes, 0, `${slug} UV-mapped meshes`);
    worse(before.degenerateTriangles, body.degenerateTriangles, 0, `${slug} degenerate triangles`);
    // Animation: a refinement that quietly weakens the motion of every clip is a regression even
    // though every file still loads. 5 degrees of slack absorbs deliberate damping in one clip.
    worse(before.meanMovingBones, body.meanMovingBones, 0.5, `${slug} bones moved per clip`);
    worse(before.meanMotionRange, body.meanMotionRange, 5, `${slug} motion range per clip`);
    if (body.nonManifoldEdges > (before.nonManifoldEdges || 0)) failures.push(`${slug} non-manifold edges: ${before.nonManifoldEdges} -> ${body.nonManifoldEdges}`);
    const reference = topologyReference?.bodies?.[slug];
    if (reference) {
      if (Number.isFinite(reference.openShellEdges) && body.openShellEdges > reference.openShellEdges) {
        failures.push(`${slug} open-shell edges (welded): ${reference.openShellEdges} -> ${body.openShellEdges}`);
      }
      // boundaryEdges is reported, not enforced: it counts UV-seam splits, so any new UV-mapped part
      // raises it without opening a hole. The welded count above is the topology signal.
      if (Number.isFinite(reference.boundaryEdges)) {
        console.error(`${slug}: boundary edges ${reference.boundaryEdges} -> ${body.boundaryEdges} (includes UV seams), open shells ${reference.openShellEdges} -> ${body.openShellEdges}`);
      }
    }
    if ((body.canonicalMissing || []).length > (before.canonicalMissing || []).length) failures.push(`${slug} unbound canonical bones`);
    if (body.shape && before.shape && body.shape.minBandDepthRatio !== null && before.shape.minBandDepthRatio !== null
      && body.shape.minBandDepthRatio < before.shape.minBandDepthRatio - 0.05) {
      failures.push(`${slug} flattest band depth ratio: ${before.shape.minBandDepthRatio} -> ${body.shape.minBandDepthRatio}`);
    }
  }
}

console.log(JSON.stringify(report, null, 2));

if (gate) {
  if (!baseline) console.error('refinement gate: no baseline at artifacts/model-quality.json to compare against');
  else if (failures.length) {
    console.error(`refinement gate FAILED (${failures.length} regressions):`);
    for (const failure of failures) console.error(`  ${failure}`);
  } else {
    console.error(`refinement gate passed against baseline ${baseline.generated}: no regression in geometry, materials, UVs or clips`);
    if (Number.isFinite(baseline.totals?.meanDetailIndex)) {
      console.error(`mean detail index ${baseline.totals.meanDetailIndex} -> ${report.totals.meanDetailIndex}`);
    }
  }
  process.exit(failures.length ? 1 : 0);
}
