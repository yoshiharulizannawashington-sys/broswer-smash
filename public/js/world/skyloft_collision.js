// Fighter collision for imported authored arenas (Skyloft, Konoha and Wuhu Island).
//
// The imported GLBs are merged meshes, so there are no building nodes to turn into layout blocks.
// Walkable ground is already baked by terrain_heightfield.js; this module adds the missing solid
// structures by rasterising faces into the same layout-block vocabulary used by arena_layouts.js.
// Buildings, tree trunks, rocks, posts and fence uprights are all caught by their vertical faces.
// On Wuhu this is what makes the cliffs and rock outcrops inside the expanded battlefield solid.
//
// A heightfield alone makes every surface walkable, including the side of a low boulder and a
// steep-but-not-vertical rock face. Those faces are steeper than a normal step but not vertical,
// so they used to fall between the two systems. The bake now marks three classes of obstacle:
//   * wall     — the original near-vertical faces (|normal.y| <= 0.5)
//   * steep    — rock faces steeper than ~39° from horizontal (|normal.y| <= 0.78)
//   * low      — faces whose top is at or below the fighter's 0.42 m step, which covers boulders
//                that a heightfield would otherwise let a fighter walk over.
// The block top is still raised to at least ground + 0.9 m for low faces, so the fighter collides
// with the boulder rather than stepping onto it. Named rails get an explicit raised top because
// their visible balustrade is also below the normal step threshold.
import * as THREE from 'three';

const STEP_HEIGHT = .42;
const NAME_COLLIDERS = /(?:^|_)(?:rail|post|banner|brazier)(?:_|$)/i;
const VERTICAL_FACE = .5; // |normal.y| at or below this is a wall, not a walkable slope.
const STEEP_FACE = .78; // |normal.y| at or below this is a rock face steeper than ~39°.
const MIN_FACE_RISE = .08;
const MIN_FACE_ABOVE_GROUND = .06;

const KIND_WALL = 1;
const KIND_STEEP = 2;
const KIND_LOW = 4;
const KIND_NAMED = 8;

const A = new THREE.Vector3();
const B = new THREE.Vector3();
const C = new THREE.Vector3();
const BOX = new THREE.Box3();

/**
 * @param {THREE.Object3D|null} group mounted Skyloft GLB group
 * @param {{bounds:{x0,x1,z0,z1}, ground:number, spawns?:Array<{x,z}>, cell?:number}} options
 * @returns {{blocks:Array<{x0,x1,z0,z1,top,bottom,wall?:boolean,steep?:boolean,lowBoulder?:boolean}>, info:Object}}
 */
export function buildSkyloftCollision(group, { bounds, ground = 0, spawns = [], cell = .75 } = {}) {
  if (!group || !bounds) return {
    blocks: [],
    info: {
      meshes: 0, triangles: 0, wallTriangles: 0, steepTriangles: 0,
      lowTriangles: 0, newWallCells: 0, newSteepCells: 0, newLowCells: 0,
      solidCells: 0, namedProps: 0, wallBlocks: 0, steepBlocks: 0,
      lowBoulderBlocks: 0, blocks: 0, cell
    }
  };
  const x0 = Math.min(bounds.x0, bounds.x1);
  const x1 = Math.max(bounds.x0, bounds.x1);
  const z0 = Math.min(bounds.z0, bounds.z1);
  const z1 = Math.max(bounds.z0, bounds.z1);
  const size = Math.max(.35, Number(cell) || .75);
  const cols = Math.max(1, Math.ceil((x1 - x0) / size));
  const rows = Math.max(1, Math.ceil((z1 - z0) / size));
  const tops = new Float32Array(cols * rows);
  const bottoms = new Float32Array(cols * rows);
  const kinds = new Uint8Array(cols * rows);
  tops.fill(-Infinity);
  bottoms.fill(Infinity);
  const clear = spawns.map(spawn => ({ x: Number(spawn.x), z: Number(spawn.z) })).filter(spawn => Number.isFinite(spawn.x) && Number.isFinite(spawn.z));
  let meshes = 0;
  let triangles = 0;
  let wallTriangles = 0;
  let steepTriangles = 0;
  let lowTriangles = 0;
  let newWallCells = 0;
  let newSteepCells = 0;
  let newLowCells = 0;
  let solidCells = 0;

  const mark = (minX, maxX, minZ, maxZ, minY, maxY, kind = 0) => {
    const ix0 = Math.max(0, Math.floor((Math.min(minX, maxX) - x0) / size));
    const ix1 = Math.min(cols - 1, Math.floor((Math.max(minX, maxX) - x0) / size));
    const iz0 = Math.max(0, Math.floor((Math.min(minZ, maxZ) - z0) / size));
    const iz1 = Math.min(rows - 1, Math.floor((Math.max(minZ, maxZ) - z0) / size));
    if (ix1 < ix0 || iz1 < iz0) return;
    const top = Math.max(maxY, ground + .9);
    const bottom = Math.max(ground, minY);
    for (let iz = iz0; iz <= iz1; iz += 1) {
      const cz = z0 + (iz + .5) * size;
      for (let ix = ix0; ix <= ix1; ix += 1) {
        const cellMinX = x0 + ix * size;
        const cellMaxX = cellMinX + size;
        const cellMinZ = z0 + iz * size;
        const cellMaxZ = cellMinZ + size;
        // Never bury a spawn: test the whole cell footprint, not just its centre, so a long
        // merged row cannot leave a collider clipping the fighter's start position.
        if (clear.some(spawn => {
          const nearestX = Math.max(cellMinX, Math.min(spawn.x, cellMaxX));
          const nearestZ = Math.max(cellMinZ, Math.min(spawn.z, cellMaxZ));
          return Math.hypot(nearestX - spawn.x, nearestZ - spawn.z) < 1.15;
        })) continue;
        const index = iz * cols + ix;
        const wasOccupied = Number.isFinite(tops[index]);
        if (!wasOccupied) {
          solidCells += 1;
          if (kind & KIND_WALL) newWallCells += 1;
          if (kind & KIND_STEEP) newSteepCells += 1;
          if (kind & KIND_LOW) newLowCells += 1;
        }
        if (top > tops[index]) tops[index] = top;
        if (bottom < bottoms[index]) bottoms[index] = bottom;
        kinds[index] |= kind;
      }
    }
  };

  group.updateMatrixWorld(true);
  group.traverse(node => {
    if (!node.isMesh || !node.geometry) return;
    meshes += 1;
    const geometry = node.geometry;
    const position = geometry.attributes?.position;
    if (!position) return;
    const index = geometry.index;
    const count = index ? index.count : position.count;
    const matrix = node.matrixWorld;
    for (let i = 0; i + 2 < count; i += 3) {
      const ia = index ? index.getX(i) : i;
      const ib = index ? index.getX(i + 1) : i + 1;
      const ic = index ? index.getX(i + 2) : i + 2;
      A.fromBufferAttribute(position, ia).applyMatrix4(matrix);
      B.fromBufferAttribute(position, ib).applyMatrix4(matrix);
      C.fromBufferAttribute(position, ic).applyMatrix4(matrix);
      triangles += 1;
      const abx = B.x - A.x, aby = B.y - A.y, abz = B.z - A.z;
      const acx = C.x - A.x, acy = C.y - A.y, acz = C.z - A.z;
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      const normalLength = Math.hypot(nx, ny, nz);
      if (normalLength < 1e-8) continue;
      const face = Math.abs(ny / normalLength);
      if (face > STEEP_FACE) continue;
      const minY = Math.min(A.y, B.y, C.y);
      const maxY = Math.max(A.y, B.y, C.y);
      const low = maxY <= ground + STEP_HEIGHT;
      const hasRealRise = maxY > ground + MIN_FACE_ABOVE_GROUND && maxY - minY > MIN_FACE_RISE;
      let kind = 0;
      if (face <= VERTICAL_FACE && !low) {
        // Preserve the original vertical-wall bake exactly. Many cliff strips are high above
        // the ground but only a few centimetres tall as individual triangles; filtering those
        // by their own rise would silently drop the existing cliff colliders.
        wallTriangles += 1;
        kind |= KIND_WALL;
      } else if (face > VERTICAL_FACE && !low && hasRealRise) {
        steepTriangles += 1;
        kind |= KIND_STEEP;
      }
      // Low faces are the boulders and low shelves the old maxY skip discarded. Include both
      // vertical and sloped sides, but require a little relief so a flat cell is not marked.
      if (low && hasRealRise) {
        lowTriangles += 1;
        kind |= KIND_LOW;
      }
      if (!kind) continue;
      mark(
        Math.min(A.x, B.x, C.x), Math.max(A.x, B.x, C.x),
        Math.min(A.z, B.z, C.z), Math.max(A.z, B.z, C.z),
        minY, maxY, kind
      );
    }
  });

  // The procedural balustrade is a low slab and would be below the normal step threshold. Give
  // rails, posts, banners and braziers explicit volumes so those visible props cannot be walked
  // through. This also covers rails whose horizontal bars are too thin for a centre-sampled grid.
  let namedProps = 0;
  group.traverse(node => {
    if (!node.isMesh || !node.geometry || !NAME_COLLIDERS.test(node.name || '')) return;
    BOX.setFromObject(node);
    if (!Number.isFinite(BOX.min.x) || !Number.isFinite(BOX.max.y)) return;
    if (BOX.max.x < x0 || BOX.min.x > x1 || BOX.max.z < z0 || BOX.min.z > z1) return;
    namedProps += 1;
    mark(BOX.min.x, BOX.max.x, BOX.min.z, BOX.max.z, BOX.min.y, BOX.max.y, KIND_NAMED);
  });

  // Merge occupied cells into row runs. A wall line becomes a handful of boxes rather than one
  // collider per 0.75 m cell; resolveCollision and groundHeightAt stay cheap every frame.
  const blocks = [];
  let wallBlocks = 0;
  let steepBlocks = 0;
  let lowBoulderBlocks = 0;
  for (let iz = 0; iz < rows; iz += 1) {
    let start = -1;
    for (let ix = 0; ix <= cols; ix += 1) {
      const occupied = ix < cols && Number.isFinite(tops[iz * cols + ix]);
      if (occupied && start < 0) start = ix;
      if (occupied || start < 0) continue;
      let top = -Infinity;
      let bottom = Infinity;
      let kind = 0;
      for (let run = start; run < ix; run += 1) {
        const index = iz * cols + run;
        top = Math.max(top, tops[index]);
        bottom = Math.min(bottom, bottoms[index]);
        kind |= kinds[index];
      }
      const block = {
        x0: +(x0 + start * size).toFixed(3),
        x1: +(x0 + ix * size).toFixed(3),
        z0: +(z0 + iz * size).toFixed(3),
        z1: +(z0 + (iz + 1) * size).toFixed(3),
        top: +top.toFixed(3),
        bottom: +bottom.toFixed(3)
      };
      if (kind & KIND_WALL) { block.wall = true; wallBlocks += 1; }
      if (kind & KIND_STEEP) { block.steep = true; steepBlocks += 1; }
      if (kind & KIND_LOW) { block.lowBoulder = true; lowBoulderBlocks += 1; }
      blocks.push(block);
      start = -1;
    }
  }

  return {
    blocks,
    info: {
      bounds: { x0, x1, z0, z1 },
      cell: size,
      meshes,
      triangles,
      wallTriangles,
      steepTriangles,
      lowTriangles,
      newWallCells,
      newSteepCells,
      newLowCells,
      solidCells,
      namedProps,
      wallBlocks,
      steepBlocks,
      lowBoulderBlocks,
      blocks: blocks.length,
      spawns: clear.length
    }
  };
}
