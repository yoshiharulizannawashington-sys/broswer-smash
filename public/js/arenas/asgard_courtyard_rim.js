// The real Asgard courtyard rim.
//
// The previous band used Plaza_gilt_inlay (46 x 46 m) as its boundary. That mesh is an interior
// floor motif: it sits 40 m inside the actual platform's east and west edges. The platform itself
// is Asgardian_town_square (126 x 90 m, top y = 0.03), measured from the mounted GLB at build time.
//
// This builds on that measured edge, not on guessed coordinates:
//   · a stepped warm-stone retaining wall on the platform's outer face, so it never covers the
//     playable floor;
//   · the south run opens for the 12 m Bifrost avenue;
//   · the north run is a 0.22 m gate threshold because the playable rectangle extends 2 m past the
//     platform there - a full wall would stand inside gameplay;
//   · corner pylons and four courses give silhouette and depth at gameplay distance;
//   · a hairline electrum seam is the only gold.
//
// No collision is created and world/arena_layouts.js is untouched.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadMarble, createElectrumAccentMaterial } from './asgard_materials.js';

/** Measured from asgard.glb if the node is present; this is the verified fallback. */
const FALLBACK = Object.freeze({ x0: -63, x1: 63, z0: -46, z1: 44, y: 0.03 });

function boxInto(list, cx, cy, cz, sx, sy, sz) {
  const geometry = new THREE.BoxGeometry(sx, sy, sz);
  geometry.translate(cx, cy, cz);
  list.push(geometry);
}

function warmStone(tint) {
  const maps = loadMarble();
  const material = new THREE.MeshStandardMaterial({
    color: tint, roughness: 0.74, metalness: 0.02,
    normalMap: maps.normalMap?.clone() || null,
    roughnessMap: maps.roughnessMap?.clone() || null
  });
  if (material.normalMap) material.normalScale = new THREE.Vector2(0.55, 0.55);
  material.name = 'Asgard · warm rim stone';
  return material;
}

const COURSES = Object.freeze([
  { depth: 2.30, height: 0.55, tint: 0xb9a98f },
  { depth: 2.00, height: 0.48, tint: 0xcabb9f },
  { depth: 1.70, height: 0.40, tint: 0xded0b5 },
  { depth: 1.35, height: 0.28, tint: 0xeee3cd }
]);

/** @returns {{sourceMesh:string|null, bounds:object, elevation:number, parts:number, meshes:number, segments:number}} */
export function buildCourtyardRim(group) {
  if (!group?.traverse) return { sourceMesh: null, bounds: null, parts: 0, meshes: 0, segments: 0 };
  if (group.userData.asgardCourtyard) return group.userData.asgardCourtyard;
  group.updateWorldMatrix(true, true);
  const groupInverse = new THREE.Matrix4().copy(group.matrixWorld).invert();

  const measured = new THREE.Box3();
  const inlayBox = new THREE.Box3();
  let sourceMesh = null;
  let plaza = { ...FALLBACK };
  let inlay = null;
  group.traverse(node => {
    if (!node.isMesh) return;
    const name = node.name || '';
    if (/asgardian_town_square/i.test(name)) {
      measured.setFromObject(node);
      if (!measured.isEmpty()) {
        sourceMesh = name;
        plaza = {
          x0: +measured.min.x.toFixed(3), x1: +measured.max.x.toFixed(3),
          z0: +measured.min.z.toFixed(3), z1: +measured.max.z.toFixed(3),
          y: +measured.max.y.toFixed(3)
        };
      }
    }
    if (/plaza_gilt_inlay/i.test(name)) {
      inlayBox.setFromObject(node);
      if (!inlayBox.isEmpty()) inlay = { x0: inlayBox.min.x, x1: inlayBox.max.x, z0: inlayBox.min.z, z1: inlayBox.max.z };
    }
  });

  const baseY = plaza.y;
  const base = [], mid = [], cap = [], gold = [], lists = [base, mid, cap, cap];

  // One run of courses along an edge. `outward` leaves the platform, so the wall's mass sits outside
  // the playable surface while its inner face meets the rim exactly.
  const run = (axis, fixed, from, to, outward, low = false) => {
    const length = to - from;
    if (length <= 1.0) return 0;
    const cx = axis === 'x' ? (from + to) / 2 : fixed;
    const cz = axis === 'x' ? fixed : (from + to) / 2;
    const place = (depth, height, y, list) => {
      const offset = outward * (depth / 2 - 0.14);
      const sx = axis === 'x' ? length : depth;
      const sz = axis === 'x' ? depth : length;
      boxInto(list, axis === 'x' ? cx : fixed + offset, y, axis === 'x' ? fixed + offset : cz, sx, height, sz);
    };
    if (low) {
      place(0.90, 0.22, baseY + 0.11, cap);
      place(0.62, 0.04, baseY + 0.24, gold);
      return 1;
    }
    let y = baseY - 0.10;
    COURSES.forEach((course, index) => {
      place(course.depth, course.height, y + course.height / 2, lists[index]);
      y += course.height;
    });
    // Hairline electrum seam at the first course joint, on the outward face only.
    const seamOffset = outward * (2.15 + 0.02);
    boxInto(gold, axis === 'x' ? cx : fixed + seamOffset, baseY + 0.56,
      axis === 'x' ? fixed + seamOffset : cz,
      axis === 'x' ? length : 0.03, 0.035, axis === 'x' ? 0.03 : length);
    // Pilasters break the flat silhouette every ~11 m.
    const shaftH = 1.50;
    for (let at = from + 4; at < to - 3; at += 11) {
      const px = axis === 'x' ? at : fixed + outward * 1.55;
      const pz = axis === 'x' ? fixed + outward * 1.55 : at;
      boxInto(mid, px, baseY + 0.55 + shaftH / 2, pz, 0.72, shaftH, 0.72);
      boxInto(cap, px, baseY + 0.55 + shaftH + 0.10, pz, 0.96, 0.20, 0.96);
    }
    return 1;
  };

  const trim = 1.25;
  let segments = 0;
  // South: open for the crystal avenue (x -7..7).
  segments += run('x', plaza.z0, plaza.x0 + trim, -7, -1);
  segments += run('x', plaza.z0, 7, plaza.x1 - trim, -1);
  // North: the Bifrost gate stays open; remaining spans are a low threshold, not a wall.
  segments += run('x', plaza.z1, plaza.x0 + trim, -13, 1, true);
  segments += run('x', plaza.z1, 13, plaza.x1 - trim, 1, true);
  // East and west: continuous retaining walls.
  segments += run('z', plaza.x0, plaza.z0 + trim, plaza.z1 - trim, -1);
  segments += run('z', plaza.x1, plaza.z0 + trim, plaza.z1 - trim, 1);

  // Corner pylons mark the platform's four real corners.
  const pylon = (x, z) => {
    boxInto(base, x, baseY + 0.22, z, 2.8, 0.44, 2.8);
    boxInto(mid, x, baseY + 0.60, z, 2.30, 0.32, 2.30);
    boxInto(cap, x, baseY + 0.94, z, 1.90, 0.24, 1.90);
    boxInto(cap, x, baseY + 1.16, z, 1.40, 0.20, 1.40);
    boxInto(gold, x, baseY + 0.43, z, 2.36, 0.035, 2.36);
    boxInto(gold, x, baseY + 1.28, z, 1.46, 0.04, 1.46);
  };
  for (const x of [plaza.x0, plaza.x1]) {
    for (const z of [plaza.z0, plaza.z1]) pylon(x, z);
  }

  // Avenue pylons: monumental flanks on the south opening.
  for (const x of [-7.45, 7.45]) {
    boxInto(base, x, baseY + 0.24, plaza.z0 - 0.95, 1.9, 0.48, 1.9);
    boxInto(mid, x, baseY + 0.94, plaza.z0 - 0.95, 1.35, 1.10, 1.35);
    boxInto(cap, x, baseY + 1.64, plaza.z0 - 0.95, 1.65, 0.24, 1.65);
    boxInto(gold, x, baseY + 1.50, plaza.z0 - 0.95, 1.40, 0.05, 1.40);
  }

  const parts = base.length + mid.length + cap.length + gold.length;
  const report = {
    sourceMesh, bounds: plaza, elevation: baseY, inlay,
    inlayInsidePlaza: Boolean(inlay && inlay.x0 > plaza.x0 && inlay.x1 < plaza.x1 && inlay.z0 > plaza.z0 && inlay.z1 < plaza.z1),
    parts, meshes: 0, segments,
    openings: { south: 'x -7..7 (crystal avenue)', north: 'x -13..13 (Bifrost gate)' },
    northThreshold: 0.22
  };
  group.userData.asgardCourtyard = report;
  if (!parts) return report;

  const meshes = [];
  const add = (geometries, material, name) => {
    if (!geometries.length) return;
    const merged = mergeGeometries(geometries, false);
    geometries.forEach(geometry => geometry.dispose());
    if (!merged) return;
    // applyMatrix4 transforms authored box normals correctly; recomputing after the transform
    // previously inverted them and rendered the whole band near-black.
    merged.applyMatrix4(groupInverse);
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    meshes.push(mesh);
    report.meshes += 1;
  };
  add(base, warmStone(0xc4b096), 'Asgard courtyard rim · base course');
  add(mid, warmStone(0xd6c3a6), 'Asgard courtyard rim · mid course');
  add(cap, warmStone(0xeadcc2), 'Asgard courtyard rim · capstones');
  add(gold, createElectrumAccentMaterial(), 'Asgard courtyard rim · electrum seam');

  group.userData.asgardCourtyardMeshes = meshes;
  return report;
}
