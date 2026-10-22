// Turns a world's part descriptors into one merged draw call per material.
//
// The catalog builds each world from hundreds of small primitives (walls, catwalks, trees,
// consoles). Submitting those as hundreds of meshes would cost more than the fighters do, so
// every part sharing a material is merged into a single BufferGeometry. A whole world is
// therefore ~12-18 draw calls, switchable without rebuilding the rest of the game.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTES, WORLDS, WORLD_MATERIAL_SPECS, worldParts } from './world_catalog.js';

const materialCache = new Map();

/** Shared, cached material for one palette slot. Materials survive world switches. */
export function materialFor(paletteKey, matKey) {
  const cacheKey = `${paletteKey}:${matKey}`;
  const cached = materialCache.get(cacheKey);
  if (cached) return cached;

  const palette = PALETTES[paletteKey] || {};
  const spec = WORLD_MATERIAL_SPECS[matKey] || {};
  const color = new THREE.Color(palette[matKey] || '#8a8a8a');
  const emissive = spec.emissive ? color.clone() : new THREE.Color(0x000000);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: spec.roughness ?? .84,
    metalness: spec.metalness ?? .08,
    transparent: Boolean(spec.transparent),
    opacity: spec.opacity ?? 1,
    emissive,
    emissiveIntensity: spec.emissive ?? 1,
    // The arena sky is a bright image-based light source; on the large flat world surfaces
    // a full-strength environment washed every material toward white. A quarter strength
    // keeps sky colour in the shadows without flattening the palette.
    envMapIntensity: spec.emissive ? .35 : .28,
    side: matKey === 'water' || matKey === 'glass' ? THREE.DoubleSide : THREE.FrontSide
  });
  material.name = `${paletteKey}-${matKey}`;
  materialCache.set(cacheKey, material);
  return material;
}

function geometryFor(part) {
  let geometry;
  switch (part.t) {
    case 'box': geometry = new THREE.BoxGeometry(part.s[0], part.s[1], part.s[2]); break;
    case 'cyl': geometry = new THREE.CylinderGeometry(part.s[0], part.s[1], part.s[2], part.seg || 12); break;
    case 'cone': geometry = new THREE.ConeGeometry(part.s[0], part.s[1], part.seg || 8); break;
    case 'sphere': {
      const seg = part.seg || 12;
      geometry = new THREE.SphereGeometry(part.s[0], seg, Math.max(6, Math.round(seg * .7)));
      break;
    }
    case 'torus': geometry = new THREE.TorusGeometry(part.s[0], part.s[1], 8, 24); break;
    case 'plane': geometry = new THREE.PlaneGeometry(part.s[0], part.s[1]); break;
    default: return null;
  }

  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(part.rx || 0, part.ry || 0, part.rz || 0));
  if (part.t === 'plane') {
    // Planes are authored flat on the ground plane.
    quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)));
  }
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(part.p[0], part.p[1], part.p[2]),
    quaternion,
    new THREE.Vector3(part.sx || 1, part.sy || 1, part.sz || 1)
  );
  geometry.applyMatrix4(matrix);
  return geometry;
}

/**
 * Build one world as a static group. Deterministic: the same catalog always produces the
 * same geometry, which is what lets scripts/test-worlds.mjs assert on it without a GPU.
 */
export function buildWorldGroup(worldId) {
  const world = WORLDS[worldId];
  if (!world) return null;

  const group = new THREE.Group();
  group.name = `world-${worldId}`;
  const buckets = new Map();

  for (const part of worldParts(worldId)) {
    const geometry = geometryFor(part);
    if (!geometry) continue;
    if (!buckets.has(part.mat)) buckets.set(part.mat, []);
    buckets.get(part.mat).push(geometry);
  }

  for (const [matKey, geometries] of buckets) {
    const merged = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
    if (geometries.length > 1) for (const geometry of geometries) geometry.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, materialFor(world.paletteKey, matKey));
    mesh.name = `${worldId}-${matKey}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
  }

  group.userData.worldId = worldId;
  group.userData.drawCalls = group.children.length;
  group.userData.parts = worldParts(worldId).length;
  return group;
}

/** Free the merged geometry of a world that is being replaced. Materials stay cached. */
export function disposeWorldGroup(group) {
  if (!group) return;
  group.traverse(object => {
    if (object.geometry) object.geometry.dispose();
  });
  group.clear();
}
