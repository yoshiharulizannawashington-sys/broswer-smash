// A sampled walkable surface for imported island arenas.
//
// The authored Skyloft-style stages ship a detailed island mesh plus a flat plaza deck. Fighter
// ground resolution only knows the layout's numeric `ground` and its collision blocks, so on an
// imported island every step outside the deck stayed at the deck height and walked through the
// rising terrain. This module bakes the actual top surface into a small grid once, after the GLB
// mounts, and exposes a bilinear `heightAt(x, z)` sampler. It is intentionally built from raycasts
// only once: sampling a 100k-triangle island every frame would be far more expensive than the
// fighters themselves.
import * as THREE from 'three';

const DEFAULT_EXCLUDE = /(?:plaza|joint|(?:north|south|east|west)_rail|banner|brazier|compass)/i;

function collectMeshes(object, excludeNames) {
  const meshes = [];
  object.updateMatrixWorld(true);
  object.traverse(node => {
    if (!node.isMesh || !node.geometry) return;
    if (excludeNames && excludeNames.test(node.name || '')) return;
    meshes.push(node);
  });
  return meshes;
}

/**
 * Build a height grid over `bounds` from the topmost surface at or below `maxHeight`.
 *
 * `ground` is the fallback used where the imported mesh is below the authored deck (or missing),
 * so the plaza stays solid instead of becoming a hole. Points above `maxHeight` are ignored and
 * the ray continues to the next surface: this keeps tall roofs and tree canopies from becoming
 * walkable ground while still catching the grass and rock shelves around the plaza.
 */
export function buildTerrainHeightfield(object, {
  bounds,
  ground = 0,
  step = 2,
  maxHeight = ground + 6,
  excludeNames = DEFAULT_EXCLUDE
} = {}) {
  if (!object || !bounds) throw new Error('buildTerrainHeightfield needs a group and bounds');
  const x0 = Math.min(bounds.x0, bounds.x1);
  const x1 = Math.max(bounds.x0, bounds.x1);
  const z0 = Math.min(bounds.z0, bounds.z1);
  const z1 = Math.max(bounds.z0, bounds.z1);
  const cell = Math.max(0.25, step);
  const cols = Math.max(2, Math.round((x1 - x0) / cell) + 1);
  const rows = Math.max(2, Math.round((z1 - z0) / cell) + 1);
  const heights = new Float32Array(cols * rows);
  heights.fill(Number.NaN);

  const meshes = collectMeshes(object, excludeNames);
  if (!meshes.length) throw new Error('buildTerrainHeightfield found no terrain meshes');

  const ray = new THREE.Raycaster();
  ray.near = 0.02;
  ray.far = 400;
  const origin = new THREE.Vector3();
  const down = new THREE.Vector3(0, -1, 0);

  let valid = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let row = 0; row < rows; row += 1) {
    const z = z0 + row * cell;
    for (let col = 0; col < cols; col += 1) {
      const x = x0 + col * cell;
      origin.set(x, 200, z);
      ray.set(origin, down);
      const hits = ray.intersectObjects(meshes, false);
      let surface = null;
      for (const hit of hits) {
        const y = hit.point.y;
        if (y > maxHeight) continue;
        surface = y;
        break;
      }
      const index = row * cols + col;
      if (surface == null || !Number.isFinite(surface)) {
        heights[index] = ground;
        continue;
      }
      const value = Math.max(ground, surface);
      heights[index] = value;
      valid += 1;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }

  // Bilinear sampling keeps a 2 m grid from producing visible stair-steps under a walking fighter.
  // Outside the grid the authored deck height remains the safe fallback.
  const heightAt = (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return ground;
    if (x < x0 || x > x1 || z < z0 || z > z1) return ground;
    const gx = (x - x0) / cell;
    const gz = (z - z0) / cell;
    const cx = Math.min(cols - 1, Math.max(0, Math.floor(gx)));
    const cz = Math.min(rows - 1, Math.max(0, Math.floor(gz)));
    const nx = Math.min(cols - 1, cx + 1);
    const nz = Math.min(rows - 1, cz + 1);
    const tx = Math.min(1, Math.max(0, gx - cx));
    const tz = Math.min(1, Math.max(0, gz - cz));
    const h00 = heights[cz * cols + cx];
    const h10 = heights[cz * cols + nx];
    const h01 = heights[nz * cols + cx];
    const h11 = heights[nz * cols + nx];
    const top = (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
    return Number.isFinite(top) ? Math.max(ground, top) : ground;
  };

  return {
    bounds: { x0, x1, z0, z1 },
    step: cell,
    cols,
    rows,
    ground,
    heightAt,
    info: {
      bounds: { x0, x1, z0, z1 },
      step: cell,
      cols,
      rows,
      meshes: meshes.length,
      valid,
      samples: cols * rows,
      min: Number.isFinite(min) ? +min.toFixed(3) : null,
      max: Number.isFinite(max) ? +max.toFixed(3) : null
    }
  };
}
