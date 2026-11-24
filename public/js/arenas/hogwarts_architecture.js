// Real architectural detail for the Hogwarts Great Hall.
//
// hogwarts.glb ships 603 meshes and 11 materials but zero texture images, so the hall reads as
// smooth grey geometry with no mouldings and no silhouette breaks. The stone-material pass
// (`architectural_materials.js`) fixed the surface; it cannot add an edge. This module builds
// genuine geometry onto the hall's own named stone parts, measured from their world bounds exactly
// like the Asgard palace pass:
//
//   Carved wall pier  -> stepped plinth, moulded capital, panel reveals
//   Gothic arch       -> keystone, springer blocks, jamb plinths
//   Carved rib        -> ceiling boss, wall corbel
//   tall capital      -> abacus slab and necking band
//   lancet window     -> sill and hood mould
//   keystone          -> proud carved slab
//   stone wall panels -> recessed frame (four ribs, not a painted line)
//
// Nothing is painted, decalled or faked, and the brass, candle wax, flame, banner and enchanted
// ceiling materials are never touched. Draw-call discipline matches Asgard: every addition is a box
// merged into two meshes, so the whole hall gains a few hundred boxes for two draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadMarble } from './asgard_materials.js';

// Only these two materials are masonry in this file. Brass, wax, flame, banners and the enchanted
// night ceiling must not sprout mouldings.
const isStone = material => /(old stone|worn stone)/i.test(material?.name || '');

function boxInto(list, cx, cy, cz, sx, sy, sz, rotationY = 0) {
  const geometry = new THREE.BoxGeometry(sx, sy, sz);
  if (rotationY) geometry.rotateY(rotationY);
  geometry.translate(cx, cy, cz);
  list.push(geometry);
}

/** Carved-stone trim: the same CC0 marble set the hall's surfaces use, so the edges match. */
function trimMaterial(tint) {
  const maps = loadMarble();
  const material = new THREE.MeshStandardMaterial({
    color: tint,
    roughness: 0.74,
    metalness: 0.02,
    normalMap: maps.normalMap.clone(),
    roughnessMap: maps.roughnessMap.clone()
  });
  for (const map of [material.normalMap, material.roughnessMap]) {
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(2, 2);
    map.needsUpdate = true;
  }
  material.normalScale = new THREE.Vector2(0.7, 0.7);
  material.name = 'Hogwarts · carved stone trim';
  return material;
}

/**
 * Build the Great Hall detail pass. Idempotent per mounted group: the report is cached on the group,
 * so arena switching cannot stack a second set of mouldings on a cached arena.
 *
 * @returns {{added:number, parts:number, meshCount:number, surfaces:number, kinds:object}}
 */
export function buildHogwartsArchitecture(group) {
  const empty = { added: 0, parts: 0, meshCount: 0, surfaces: 0, kinds: {} };
  if (!group?.traverse) return empty;
  if (group.userData.hogwartsArchitecture) return group.userData.hogwartsArchitecture;

  group.updateWorldMatrix(true, true);
  const groupInverse = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const trim = [];
  const reveal = [];
  const kinds = { piers: 0, arches: 0, ribs: 0, capitals: 0, windows: 0, keystones: 0, panels: 0 };
  let surfaces = 0;

  const worldBox = new THREE.Box3();
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();

  group.traverse(node => {
    if (!node.isMesh || !node.material) return;
    const material = Array.isArray(node.material) ? node.material[0] : node.material;
    if (!isStone(material)) return;
    worldBox.setFromObject(node);
    if (worldBox.isEmpty()) return;
    worldBox.getSize(size);
    worldBox.getCenter(centre);
    const w = size.x, h = size.y, d = size.z;
    const y0 = worldBox.min.y, y1 = worldBox.max.y;
    const name = node.name || '';
    // One ordered classifier, because this export embeds several keywords in one name
    // ("Gothic_arch_carved_rib", "Tall_gothic_capital"): a chain of independent /tests/ lets the
    // arch branch swallow ribs and capitals, and a negative guard then drops them entirely.
    const kind = /keystone/i.test(name) ? 'keystone'
      : /capital/i.test(name) ? 'capital'
      : /rib/i.test(name) ? 'rib'
      : /pier/i.test(name) ? 'pier'
      : /arch/i.test(name) ? 'arch'
      : /lancet|mullion/i.test(name) ? 'window'
      : /wall|panel/i.test(name) ? 'panel'
      : 'generic';

    // ---- Nave piers: the vertical members the whole hall reads by.
    // three.js GLTFLoader sanitises node names, so "Carved wall pier" arrives as
    // "Carved_wall_pier.001". Every pattern below therefore tolerates underscores.
    if (kind === 'pier') {
      surfaces += 1;
      kinds.piers += 1;
      boxInto(trim, centre.x, y0 + 0.14, centre.z, w + 0.36, 0.28, d + 0.36);
      boxInto(trim, centre.x, y0 + 0.36, centre.z, w + 0.2, 0.16, d + 0.2);
      boxInto(trim, centre.x, y1 - 0.5, centre.z, w + 0.3, 0.22, d + 0.3);
      boxInto(trim, centre.x, y1 - 0.22, centre.z, w + 0.46, 0.26, d + 0.46);
      boxInto(reveal, centre.x, y1 - 0.66, centre.z, w + 0.14, 0.08, d + 0.14);
      // Recessed panel frames on the two long faces: proud ribs, real edges.
      for (const side of [-1, 1]) {
        const cz = centre.z + side * (d / 2 + 0.02);
        const span = Math.max(0.8, h - 2.2);
        for (const t of [-0.3, 0.3]) {
          boxInto(trim, centre.x + t * Math.max(w, 0.6), y0 + 0.8 + span * 0.5, cz, 0.11, span, 0.1);
        }
        boxInto(trim, centre.x, y0 + 0.8, cz, Math.max(0.5, w * 0.7), 0.1, 0.1);
        boxInto(trim, centre.x, y0 + 0.8 + span, cz, Math.max(0.5, w * 0.7), 0.1, 0.1);
      }
      return;
    }

    // ---- Pointed arches: keystone at the apex, springers where the curve leaves the pier.
    // Ribs and capitals are named "Gothic arch carved rib" / "Tall gothic capital" in this export,
    // so the arch branch must not swallow them before their own branches are reached.
    if (kind === 'arch') {
      surfaces += 1;
      kinds.arches += 1;
      const apexY = y1 - Math.max(0.12, h * 0.06);
      boxInto(trim, centre.x, apexY, centre.z, Math.max(0.34, w * 0.16), Math.max(0.3, h * 0.05), d + 0.18);
      boxInto(reveal, centre.x, apexY - Math.max(0.22, h * 0.05), centre.z, Math.max(0.22, w * 0.1), 0.08, d + 0.1);
      for (const side of [-1, 1]) {
        boxInto(trim, centre.x + side * w * 0.46, y0 + h * 0.42, centre.z,
          Math.max(0.24, w * 0.1), Math.max(0.22, h * 0.07), d + 0.16);
        boxInto(trim, centre.x + side * w * 0.46, y0 + 0.12, centre.z,
          Math.max(0.3, w * 0.14), 0.24, d + 0.2);
      }
      return;
    }

    // ---- Vault ribs: a boss at the crown and a corbel where the rib meets the wall.
    if (kind === 'rib') {
      surfaces += 1;
      kinds.ribs += 1;
      boxInto(trim, centre.x, y1 - 0.18, centre.z, 0.46, 0.36, 0.46);
      boxInto(reveal, centre.x, y1 - 0.4, centre.z, 0.3, 0.1, 0.3);
      boxInto(trim, centre.x, y0 + 0.3, centre.z, w + 0.22, 0.24, d + 0.22);
      boxInto(trim, centre.x, y0 + 0.52, centre.z, w + 0.1, 0.14, d + 0.1);
      return;
    }

    // ---- Column capitals: a moulded abacus and a necking band, above the existing carving.
    if (kind === 'capital') {
      surfaces += 1;
      kinds.capitals += 1;
      boxInto(trim, centre.x, y1 + 0.1, centre.z, w + 0.34, 0.2, d + 0.34);
      boxInto(trim, centre.x, y1 + 0.26, centre.z, w + 0.18, 0.12, d + 0.18);
      boxInto(reveal, centre.x, y0 + 0.08, centre.z, w + 0.06, 0.1, d + 0.06);
      return;
    }

    // ---- Lancet windows: a projecting sill and a hood mould, so the opening reads as framed.
    if (kind === 'window') {
      surfaces += 1;
      kinds.windows += 1;
      boxInto(trim, centre.x, y0 + 0.1, centre.z, w + 0.34, 0.2, d + 0.34);
      boxInto(reveal, centre.x, y0 - 0.04, centre.z, w + 0.18, 0.08, d + 0.18);
      boxInto(trim, centre.x, y1 - 0.12, centre.z, w + 0.3, 0.18, d + 0.3);
      return;
    }

    // ---- Separate keystone meshes: a proud carved slab on the arch face.
    if (kind === 'keystone') {
      surfaces += 1;
      kinds.keystones += 1;
      boxInto(trim, centre.x, centre.y, centre.z, w + 0.22, h + 0.18, d + 0.22);
      boxInto(reveal, centre.x, centre.y - h * 0.32, centre.z, w + 0.1, 0.06, d + 0.3);
      return;
    }

    // ---- Wall panels: four proud ribs framing a recess, on both long faces.
    if (kind === 'panel' && h > 2 && Math.max(w, d) > 1.5) {
      surfaces += 1;
      kinds.panels += 1;
      // The nave's long walls run along Z, so their visible faces are ±X. Framing the ±Z ends of a
      // long wall - what the first version did - put every rib on a face the camera never sees, and
      // the A/B pair came back visually identical. Frame the broad faces instead.
      const alongX = w >= d;
      const faceSpan = Math.max(alongX ? w : d, 1);
      const span = Math.max(0.7, faceSpan * 0.62);
      const height = Math.max(0.8, h * 0.52);
      const midY = y0 + h * 0.48;
      for (const side of [-1, 1]) {
        for (const t of [-1, 1]) {
          if (alongX) {
            boxInto(trim, centre.x + t * span / 2, midY, centre.z + side * (d / 2 + 0.04), 0.1, height, 0.12);
          } else {
            boxInto(trim, centre.x + side * (w / 2 + 0.04), midY, centre.z + t * span / 2, 0.12, height, 0.1);
          }
        }
      }
      // Recessed frame rails, then a projecting cornice and plinth so the wall reads as built.
      if (alongX) {
        for (const t of [-1, 1]) {
          boxInto(reveal, centre.x, midY + t * height / 2, centre.z + (d / 2 + 0.01), span, 0.08, 0.06);
          boxInto(reveal, centre.x, midY + t * height / 2, centre.z - (d / 2 + 0.01), span, 0.08, 0.06);
        }
        boxInto(trim, centre.x, y1 - 0.18, centre.z, w + 0.34, 0.3, d + 0.34);
        boxInto(trim, centre.x, y0 + 0.16, centre.z, w + 0.26, 0.3, d + 0.26);
      } else {
        for (const t of [-1, 1]) {
          boxInto(reveal, centre.x + (w / 2 + 0.01), midY + t * height / 2, centre.z, 0.06, 0.08, span);
          boxInto(reveal, centre.x - (w / 2 + 0.01), midY + t * height / 2, centre.z, 0.06, 0.08, span);
        }
        boxInto(trim, centre.x, y1 - 0.18, centre.z, w + 0.34, 0.3, d + 0.34);
        boxInto(trim, centre.x, y0 + 0.16, centre.z, w + 0.26, 0.3, d + 0.26);
      }
      return;
    }

    // ---- Anything else stone and large: plinth and cornice only. No indiscriminate dressing.
    if (h < 2.5 || Math.max(w, d) < 2) return;
    surfaces += 1;
    kinds.panels += 1;
    boxInto(trim, centre.x, y0 + 0.16, centre.z, w + 0.5, 0.32, d + 0.5);
    boxInto(trim, centre.x, y1 - 0.14, centre.z, w + 0.44, 0.28, d + 0.44);
    boxInto(reveal, centre.x, y1 - 0.32, centre.z, w + 0.3, 0.1, d + 0.3);
  });

  const report = { added: trim.length + reveal.length, parts: trim.length + reveal.length, meshCount: 0, surfaces, kinds };
  if (!report.added) { group.userData.hogwartsArchitecture = report; return report; }

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

  addMerged(trim, trimMaterial(0xb9b4a8), 'Hogwarts stone architecture · mouldings');
  addMerged(reveal, trimMaterial(0x8f8b81), 'Hogwarts stone architecture · recesses');
  // Kept on the group so the capture harness can hide the detail and shoot a true before/after at
  // the same camera, and so arena switching can prove it is built once.
  group.userData.hogwartsArchitectureMeshes = meshes;
  group.userData.hogwartsArchitecture = report;
  return report;
}
