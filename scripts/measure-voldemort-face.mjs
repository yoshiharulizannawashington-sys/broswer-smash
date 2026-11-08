// Voldemort's muzzle: where it is, how far it projects, and whether it is below the eyes.
//
// Two earlier versions produced invalid numbers and both were discarded:
//  1. y bands copied from the Blender sculpt (1.545-1.620) while the exported GLB sits 0.105 m higher
//     (shipped eye bottom 1.6782), so the sampled "nose tip" at 1.6833 was brow geometry;
//  2. a topology flood-fill that seeded on the chin, because a lateral |x| band low on a rounded head
//     is the jawline, not a comparable cheek surface.
//
// This version measures per horizontal row, against the plane sampled in THAT row, and reports the
// muzzle's height relative to the eye bottom - so a muzzle authored level with the eyes fails instead
// of reading as a tip. It reports vertex counts, because a snout needs geometry to exist at all.
//
//   node scripts/measure-voldemort-face.mjs <file.glb> [...]
import { readFileSync } from 'node:fs';

const ROW = 0.002;
const MIDLINE = 0.018;        // the nose column
const PLANE_LO = 0.026, PLANE_HI = 0.055;   // the face plane either side of the nose column
const SEARCH_BELOW = 0.072;   // a nose lives in the 72 mm below the eyes, not on the jaw
const SEARCH_ABOVE = 0.030;
const PROUD = 0.003;          // 3 mm proud of the local plane counts as muzzle

function readGlb(file) {
  const data = readFileSync(file);
  let offset = 12, json = null, bin = null;
  while (offset < data.length) {
    const length = data.readUInt32LE(offset);
    const type = data.readUInt32LE(offset + 4);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4E4F534A) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004E4942) bin = chunk;
    offset += 8 + length;
  }
  return { json, bin };
}

function points(glb, index) {
  const accessor = glb.json.accessors[index];
  const view = glb.json.bufferViews[accessor.bufferView];
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const stride = view.byteStride || 12;
  const out = [];
  for (let i = 0; i < accessor.count; i++) {
    const o = start + i * stride;
    out.push({ x: glb.bin.readFloatLE(o), y: glb.bin.readFloatLE(o + 4), z: glb.bin.readFloatLE(o + 8) });
  }
  return out;
}

function indices(glb, index) {
  const accessor = glb.json.accessors[index];
  const view = glb.json.bufferViews[accessor.bufferView];
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  // Indices ship as uint16 in these exports. Reading them as uint32 returned meaningless values,
  // which is why the seam check reported "no triangles" instead of measuring them.
  const component = accessor.componentType || 5125;
  const size = component === 5121 ? 1 : component === 5123 ? 2 : 4;
  const stride = view.byteStride || size;
  const out = [];
  for (let i = 0; i < accessor.count; i++) {
    const at = start + i * stride;
    out.push(size === 1 ? glb.bin.readUInt8(at) : size === 2 ? glb.bin.readUInt16LE(at) : glb.bin.readUInt32LE(at));
  }
  return out;
}

function faceCloud(file) {
  const glb = readGlb(file);
  const skin = [], eye = [], tris = [];
  for (const mesh of glb.json.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      const name = glb.json.materials?.[primitive.material]?.name || '';
      const pts = points(glb, primitive.attributes.POSITION);
      if (/^fighter-skin$/.test(name)) {
        const base = skin.length;
        skin.push(...pts);
        if (primitive.indices !== undefined) {
          const idx = indices(glb, primitive.indices);
          for (let i = 0; i < idx.length; i += 3) tris.push([idx[i] + base, idx[i + 1] + base, idx[i + 2] + base]);
        } else {
          // Non-indexed primitives still describe triangles, three vertices at a time. Treating the
          // absence of indices as "no triangles" produced a false 0 boundary edges earlier.
          for (let i = 0; i + 2 < pts.length; i += 3) tris.push([base + i, base + i + 1, base + i + 2]);
        }
      }
      if (/^fighter-(eye|iris|pupil)$/.test(name)) eye.push(...pts);
    }
  }
  return { skin, eye, tris };
}

/** Seams from unwelded geometry show up as boundary edges: an edge used by only one triangle. */
function boundaryEdgesInBand(tris, skin, lo, hi) {
  const uses = new Map();
  const inBand = i => {
    const p = skin[i];
    return p && p.y >= lo && p.y <= hi && Math.abs(p.x) < 0.06;
  };
  for (const [a, b, c] of tris) {
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      if (!inBand(u) || !inBand(v)) continue;
      const key = u < v ? u + ':' + v : v + ':' + u;
      uses.set(key, (uses.get(key) || 0) + 1);
    }
  }
  let boundary = 0;
  for (const count of uses.values()) if (count === 1) boundary++;
  return { boundary, edges: uses.size };
}

const pct = (values, p) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

function measureCloud({ skin, eye, tris = [] }) {
  const eyeBottom = Math.min(...eye.map(p => p.y));
  const eyeTop = Math.max(...eye.map(p => p.y));
  const eyeFront = Math.max(...eye.map(p => p.z));
  const lo = eyeBottom - SEARCH_BELOW, hi = eyeBottom + SEARCH_ABOVE;
  const head = skin.filter(p => Math.abs(p.x) < 0.10 && p.y >= lo && p.y <= hi);
  const rows = new Map();
  for (const p of head) {
    const key = Math.round(p.y / ROW);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(p);
  }
  const table = [];
  for (const [key, pts] of [...rows].sort((a, b) => b[0] - a[0])) {
    const y = key * ROW;
    const midline = pts.filter(p => Math.abs(p.x) <= MIDLINE);
    const plane = pts.filter(p => Math.abs(p.x) >= PLANE_LO && Math.abs(p.x) <= PLANE_HI);
    if (!midline.length || plane.length < 4) continue;
    const midMax = Math.max(...midline.map(p => p.z));
    const planeZ = pct(plane.map(p => p.z), 0.75);
    table.push({
      y, midMax, planeZ, proud: midMax - planeZ,
      midVerts: midline.length, planeVerts: plane.length,
      leftPlane: plane.filter(p => p.x < 0).length, rightPlane: plane.filter(p => p.x > 0).length,
      muzzleVerts: pts.filter(p => Math.abs(p.x) <= 0.030 && p.z > planeZ + PROUD).length,
      pts
    });
  }
  if (!table.length) return { ok: false, reason: 'no row has both a nose column and a plane reference' };
  const tipRow = table.reduce((best, r) => (r.proud > best.proud ? r : best), table[0]);
  // Muzzle extent: the contiguous run of proud rows through the tip.
  const idx = table.indexOf(tipRow);
  let top = idx, bottom = idx;
  while (top > 0 && table[top - 1].proud > PROUD) top--;
  while (bottom < table.length - 1 && table[bottom + 1].proud > PROUD) bottom++;
  const run = table.slice(top, bottom + 1);
  const muzzleVerts = run.reduce((sum, r) => sum + r.muzzleVerts, 0);
  const nearTip = run.filter(r => Math.abs(r.y - tipRow.y) <= 0.006);
  const tipPts = nearTip.flatMap(r => r.pts);
  // Nostril recess is measured against its own surrounding surface, not against the tip plane:
  // using the plane reported 41 mm, which was the step down to the face, not a hole.
  const sideVerts = tipPts.filter(p => Math.abs(p.x) >= 0.005 && Math.abs(p.x) <= 0.022 && p.z > tipRow.planeZ);
  const ringZ = sideVerts.length > 3 ? pct(sideVerts.map(p => p.z), 0.75) : null;
  const nostrilDepth = ringZ === null ? null : +(ringZ - Math.min(...sideVerts.map(p => p.z))).toFixed(4);
  // Cap metrics over the WHOLE proud run, not a +/-3 mm band around the most-proud row: that row sits
  // on the cap's lower edge, so the old sampling measured two vertices and reported a 3 mm cap.
  const runPts = run.flatMap(r => r.pts).filter(p => Math.abs(p.x) <= 0.030);
  const capVerts = runPts.filter(p => p.z >= tipRow.midMax - 0.003);
  const capHalfWidth = capVerts.length ? Math.max(...capVerts.map(p => Math.abs(p.x))) : null;
  const capFlatness = capVerts.length > 2 ? +(Math.max(...capVerts.map(p => p.z)) - Math.min(...capVerts.map(p => p.z))).toFixed(4) : null;
  const seams = tris.length ? boundaryEdgesInBand(tris, skin, lo, eyeBottom) : null;
  const seamMeasured = Boolean(seams && seams.edges > 0);
  return {
    ok: true,
    eyeBottomY: +eyeBottom.toFixed(4),
    eyeTopY: +eyeTop.toFixed(4),
    eyeFrontZ: +eyeFront.toFixed(4),
    searchBand: [+lo.toFixed(4), +hi.toFixed(4)],
    rowsMeasured: table.length,
    tipY: +tipRow.y.toFixed(4),
    tipZ: +tipRow.midMax.toFixed(4),
    planeAtTipZ: +tipRow.planeZ.toFixed(4),
    tipProjection: +tipRow.proud.toFixed(4),
    tipBelowEye: +(eyeBottom - tipRow.y).toFixed(4),
    muzzleSpanY: [+run[run.length - 1].y.toFixed(4), +run[0].y.toFixed(4)],
    muzzleHeight: +(run[0].y - run[run.length - 1].y).toFixed(4),
    muzzleRows: run.length,
    muzzleVerts,
    humpAboveEyes: +(Math.max(0, ...table.filter(r => r.y > eyeBottom + 0.004).map(r => r.proud))).toFixed(4),
    tipCapVerts: capVerts.length,
    tipCapHalfWidth: capHalfWidth === null ? null : +capHalfWidth.toFixed(4),
    tipCapFlatness: capFlatness,
    seamBoundaryEdges: seamMeasured ? seams.boundary : null,
    seamMeasured,
    seamEdgesInBand: seams ? seams.edges : null,
    nostrilVerts: sideVerts.length,
    nostrilDepth,
    planeSamplesAtTip: tipRow.planeVerts,
    bothPlaneSidesAtTip: tipRow.leftPlane >= 2 && tipRow.rightPlane >= 2
  };
}

function validate(m) {
  const problems = [];
  if (!m.ok) return [m.reason];
  if (m.tipBelowEye < 0.006) problems.push(`nose tip is ${(m.tipBelowEye * 1000).toFixed(1)} mm below the eye bottom - level with the eyes`);
  if (m.tipProjection < 0.012) problems.push(`tip projects only ${(m.tipProjection * 1000).toFixed(1)} mm past the face plane`);
  if (m.muzzleHeight < 0.018) problems.push(`muzzle run is only ${(m.muzzleHeight * 1000).toFixed(1)} mm tall`);
  if (m.muzzleRows < 5) problems.push(`muzzle has only ${m.muzzleRows} measured rows - too coarse to read`);
  if (m.muzzleVerts < 24) problems.push(`muzzle owns only ${m.muzzleVerts} vertices above the plane`);
  if (!m.bothPlaneSidesAtTip) problems.push('plane reference missing on one side at the tip');
  if (m.nostrilDepth === null) problems.push('no nostril recess found beside the tip');
  else if (m.nostrilDepth < 0.004) problems.push(`nostril recess is only ${(m.nostrilDepth * 1000).toFixed(1)} mm`);
  if (m.humpAboveEyes > 0.014) problems.push(`face still bulges ${(m.humpAboveEyes * 1000).toFixed(1)} mm proud above the eye line`);
  if (m.tipCapFlatness !== null && m.tipCapFlatness > 0.004) problems.push(`tip cap is a dome, not flat (${(m.tipCapFlatness * 1000).toFixed(1)} mm of z spread)`);
  if (m.seamMeasured === false) problems.push('seam check could not see triangles - not measured');
  if (m.seamBoundaryEdges !== null && m.seamBoundaryEdges > 0) problems.push(`${m.seamBoundaryEdges} boundary edges in the muzzle band - unwelded seam`);
  return problems;
}

function selfTest(cloud) {
  const base = measureCloud(cloud);
  const fork = () => ({ skin: cloud.skin.map(p => ({ ...p })), eye: cloud.eye.map(p => ({ ...p })) });
  const brow = fork();
  for (const p of brow.skin) if (p.y >= base.eyeBottomY && Math.abs(p.x) <= 0.05) p.z += 0.010;
  const browShift = +(measureCloud(brow).tipProjection - base.tipProjection).toFixed(4);
  const muzzle = fork();
  for (const p of muzzle.skin) {
    if (p.y >= base.muzzleSpanY[0] - 0.002 && p.y <= base.muzzleSpanY[1] + 0.002 && Math.abs(p.x) <= 0.030) p.z += 0.006;
  }
  const muzzleShift = +(measureCloud(muzzle).tipProjection - base.tipProjection).toFixed(4);
  const repeatable = JSON.stringify(measureCloud(cloud)) === JSON.stringify(base);
  return {
    browShift, muzzleShift, repeatable,
    pass: Math.abs(browShift) <= 0.0006 && Math.abs(muzzleShift - 0.006) <= 0.0015 && repeatable
  };
}

let failures = 0;
for (const file of process.argv.slice(2)) {
  const cloud = faceCloud(file);
  const m = measureCloud(cloud);
  const tests = selfTest(cloud);
  const problems = validate(m);
  if (problems.length || !tests.pass) failures++;
  console.log('MUZZLE', JSON.stringify({ file, ...m, selfTest: tests }));
  for (const p of problems) console.log('FAIL', p);
  console.log(tests.pass ? 'OK   metric ignores brow edits and tracks muzzle edits' : 'FAIL metric self-test');
}
process.exit(failures ? 1 : 0);
