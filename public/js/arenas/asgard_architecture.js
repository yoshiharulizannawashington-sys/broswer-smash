// Real architectural detail for the Asgard palace.
//
// The palace GLB is boxes: 25 city-marble surfaces with flat panels, no mouldings and no silhouette
// breaks, which is why the city read as untextured slabs even after the marble maps landed. This
// module builds genuine geometry - plinths, cornices, corner pilasters, panel bands, fountain rim
// blocks, pier bases and capitals - onto the surfaces that already exist, using their measured world
// bounds. Nothing is painted onto the texture, no decal is used, and the bifrost crystal, gold,
// electrum, bronze and window materials are untouched.
//
// Draw-call discipline: every addition is a box merged into two meshes (projecting trim and recessed
// inset), so the whole city gains a few hundred boxes at the cost of two draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadMarble, createRockSurfaceMaterial, createElectrumAccentMaterial } from './asgard_materials.js';

const isCityMarble = material => /city marble/i.test(material?.name || '');
const BOX = 24; // vertex budget note only: BoxGeometry is shared cheaply per part

function boxInto(list, cx, cy, cz, sx, sy, sz, rotationY = 0) {
  const geometry = new THREE.BoxGeometry(sx, sy, sz);
  if (rotationY) geometry.rotateY(rotationY);
  geometry.translate(cx, cy, cz);
  list.push(geometry);
}

/** Moulded trim material: real marble maps, blue-grey tint, no glow. */
function trimMaterial(tint) {
  const maps = loadMarble();
  const material = new THREE.MeshStandardMaterial({
    color: tint,
    roughness: 0.62,
    metalness: 0.03,
    normalMap: maps.normalMap.clone(),
    roughnessMap: maps.roughnessMap.clone()
  });
  material.normalMap.needsUpdate = true;
  material.roughnessMap.needsUpdate = true;
  material.normalScale = new THREE.Vector2(0.75, 0.75);
  material.name = 'Asgard · carved marble trim';
  return material;
}

/**
 * Build the palace detail pass. Idempotent per mounted group: the report is cached on the group so
 * switching arenas cannot stack a second set of mouldings.
 *
 * @returns {{added:number, parts:number, meshCount:number, surfaces:number}}
 */
export function buildAsgardArchitecture(group) {
  if (!group?.traverse) return { added: 0, parts: 0, meshCount: 0, surfaces: 0 };
  if (group.userData.asgardArchitecture) return group.userData.asgardArchitecture;

  group.updateWorldMatrix(true, true);
  const groupInverse = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const trim = [];
  const inset = [];
  let surfaces = 0;
  const worldBox = new THREE.Box3();
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();

  group.traverse(node => {
    if (!node.isMesh || !node.material) return;
    const material = Array.isArray(node.material) ? node.material[0] : node.material;
    if (!isCityMarble(material)) return;
    surfaces += 1;
    worldBox.setFromObject(node);
    if (worldBox.isEmpty()) return;
    worldBox.getSize(size);
    worldBox.getCenter(centre);
    const w = size.x, h = size.y, d = size.z;
    const y0 = worldBox.min.y, y1 = worldBox.max.y;
    const name = node.name || '';

    // ---- Bifrost gate piers: stepped base and a capital, so the gateway reads as built.
    if (/bifrost_gate_pier/i.test(name)) {
      boxInto(trim, centre.x, y0 + 0.28, centre.z, w + 1.3, 0.56, d + 1.3);
      boxInto(trim, centre.x, y0 + 0.68, centre.z, w + 0.75, 0.24, d + 0.75);
      boxInto(trim, centre.x, y1 - 0.62, centre.z, w + 0.9, 0.34, d + 0.9);
      boxInto(trim, centre.x, y1 - 0.18, centre.z, w + 1.2, 0.36, d + 1.2);
      boxInto(inset, centre.x, y1 - 0.42, centre.z, w + 0.62, 0.12, d + 0.62);
      return;
    }

    // ---- Fountain basin: a ring of projecting rim blocks replaces the plain lip.
    if (/fountain/i.test(name)) {
      const radius = Math.max(1, Math.min(w, d) / 2 - 0.15);
      const blocks = 14;
      for (let i = 0; i < blocks; i += 1) {
        const angle = (i / blocks) * Math.PI * 2;
        boxInto(trim, centre.x + Math.cos(angle) * radius, y0 + h + 0.09, centre.z + Math.sin(angle) * radius,
          0.62, 0.2, 0.44, -angle);
      }
      boxInto(trim, centre.x, y0 + 0.1, centre.z, w + 0.4, 0.2, d + 0.4);
      return;
    }

    // ---- Market counters: a moulded top slab on short posts.
    if (/market_stall/i.test(name)) {
      boxInto(trim, centre.x, y1 + 0.06, centre.z, w + 0.22, 0.12, d + 0.22);
      boxInto(inset, centre.x, y1 - 0.08, centre.z, w + 0.1, 0.08, d + 0.1);
      boxInto(trim, centre.x, y0 + 0.08, centre.z, w + 0.12, 0.16, d + 0.12);
      return;
    }

    // ---- Halls and other large marble volumes.
    if (Math.max(w, d) < 4 || h < 3) return;
    // Plinth: two stepped bands, so the base casts a real shadow line.
    boxInto(trim, centre.x, y0 + 0.18, centre.z, w + 0.62, 0.36, d + 0.62);
    boxInto(trim, centre.x, y0 + 0.47, centre.z, w + 0.4, 0.2, d + 0.4);
    // Cornice: projecting cap plus a recessed shadow reveal just below it.
    boxInto(trim, centre.x, y1 - 0.16, centre.z, w + 0.56, 0.32, d + 0.56);
    boxInto(inset, centre.x, y1 - 0.38, centre.z, w + 0.34, 0.12, d + 0.34);
    // Corner pilasters: four square shafts that break the flat silhouette.
    const px = Math.max(0, w / 2 - 0.12);
    const pz = Math.max(0, d / 2 - 0.12);
    const shaft = Math.max(1, h - 1.4);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        boxInto(trim, centre.x + sx * px, y0 + 0.6 + shaft / 2, centre.z + sz * pz, 0.42, shaft, 0.42);
      }
    }
    // Panel divisions: two raised horizontal bands and two vertical reveals on every face. This is
    // the "panel" reading the flat boxes were missing, and it is geometry, not a painted line.
    const faces = [
      { nx: 1, nz: 0, span: d },
      { nx: -1, nz: 0, span: d },
      { nx: 0, nz: 1, span: w },
      { nx: 0, nz: -1, span: w }
    ];
    for (const face of faces) {
      const offsetX = face.nx * (w / 2);
      const offsetZ = face.nz * (d / 2);
      const bandLength = Math.max(1, face.span - 1.1);
      for (const t of [0.36, 0.66]) {
        boxInto(inset,
          centre.x + offsetX * 1.01, y0 + h * t, centre.z + offsetZ * 1.01,
          face.nx ? 0.12 : bandLength, 0.2, face.nz ? 0.12 : bandLength);
      }
      for (const t of [-0.26, 0.26]) {
        boxInto(inset,
          centre.x + offsetX * 1.01 + face.nz * t * face.span,
          y0 + h * 0.5,
          centre.z + offsetZ * 1.01 + face.nx * t * face.span,
          face.nx ? 0.1 : 0.16, Math.max(1, h * 0.42), face.nz ? 0.1 : 0.16);
      }
    }
  });

  const report = { added: trim.length + inset.length, parts: trim.length + inset.length, meshCount: 0, surfaces };
  if (!trim.length && !inset.length) { group.userData.asgardArchitecture = report; return report; }

  const meshes = [];
  const addMerged = (geometries, material, name) => {
    if (!geometries.length) return;
    const merged = mergeGeometries(geometries, false);
    geometries.forEach(geometry => geometry.dispose());
    if (!merged) return;
    merged.applyMatrix4(groupInverse);
    merged.computeVertexNormals();
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    meshes.push(mesh);
    report.meshCount += 1;
  };

  addMerged(trim, trimMaterial(0xb6c0cb), 'Asgard marble architecture · trim');
  addMerged(inset, trimMaterial(0x8f9aa7), 'Asgard marble architecture · panel reveals');
  // Kept on the group so a capture harness can hide the trim and shoot a true before/after at the
  // same camera, and so switching arenas can prove the detail is not rebuilt.
  group.userData.asgardArchitectureMeshes = meshes;
  group.userData.asgardArchitecture = report;
  return report;
}

// The courtyard rim is measured from Asgardian_town_square, not the gilt inlay.
export { buildCourtyardRim as buildAsgardCourtyard } from './asgard_courtyard_rim.js';
