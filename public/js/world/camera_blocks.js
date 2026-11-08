// Camera collision volumes from the authored arena's own meshes.
//
// The duel camera already shortens its shot to the first solid volume (SmashCamera.obstruction),
// but it was only ever handed the layout's hand-authored `blocks` list. On a built world stage the
// buildings are meshes, not layout data, so the list said "plaza is open" while a 6 m house stood
// behind the fighters - and the shot opened inside its wall. This module derives the missing
// volumes from the meshes themselves.
//
// Only volumes that can actually occlude the shot are kept: floor slabs and trims are below
// `minTop`, lamp posts and window strips fail `minArea`, and anything outside the playable
// rectangle (plus `pad`) is dropped. The result is sorted by footprint and capped, because the
// obstruction test is linear in the number of blocks and runs every frame.
import * as THREE from 'three';

const BOX = new THREE.Box3();

// What the last call did with the cap, so the collider budget can be validated instead of assumed:
// 48 is the mesh-volume limit, and `truncated` says whether it actually bit.
export const blockStats = { considered: 0, kept: 0, truncated: 0, largestKeptArea: 0, largestDroppedArea: 0 };

/**
 * @param {THREE.Object3D|null} group authored arena group
 * @param {{x0:number,x1:number,z0:number,z1:number}|null} bounds playable rectangle
 * @returns {Array<{x0:number,x1:number,z0:number,z1:number,bottom:number,top:number}>}
 */
export function blocksFromGroup(group, bounds, { limit = 48, pad = 55, minArea = 6, minTop = 1.6, focus = null } = {}) {
  if (!group || !bounds) return [];
  group.updateMatrixWorld?.(true);
  const kept = [];
  group.traverse(node => {
    // Instanced sets stand for scenery at city scale; one AABB would swallow the whole stage.
    if (!node.isMesh || node.isInstancedMesh || !node.geometry) return;
    BOX.setFromObject(node);
    if (!Number.isFinite(BOX.min.x) || !Number.isFinite(BOX.max.y)) return;
    if (!(BOX.max.y > minTop)) return;
    const width = BOX.max.x - BOX.min.x;
    const depth = BOX.max.z - BOX.min.z;
    if (width * depth < minArea) return;
    if (BOX.max.x < bounds.x0 - pad || BOX.min.x > bounds.x1 + pad) return;
    if (BOX.max.z < bounds.z0 - pad || BOX.min.z > bounds.z1 + pad) return;
    kept.push({
      x0: BOX.min.x, x1: BOX.max.x, z0: BOX.min.z, z1: BOX.max.z,
      // `bottom` matters: SmashCamera's box test needs it, and a layout block without one is
      // silently skipped, which is why hand-authored blocks never stopped the camera.
      bottom: BOX.min.y, top: BOX.max.y, area: width * depth
    });
  });
  // Rank by relevance, not size alone. A 40 m palace roof far outside the fight used to win a slot
  // over the 6 m house standing between the camera and the pair, because the cap only ever saw
  // footprint area. Weighting by distance from the fight keeps nearby obstacles in the list.
  const fx = focus?.x ?? (bounds.x0 + bounds.x1) * .5;
  const fz = focus?.z ?? (bounds.z0 + bounds.z1) * .5;
  for (const block of kept) {
    const cx = (block.x0 + block.x1) * .5;
    const cz = (block.z0 + block.z1) * .5;
    block.relevance = Math.hypot(cx - fx, cz - fz) / Math.sqrt(Math.max(1, block.area));
  }
  kept.sort((a, b) => a.relevance - b.relevance);
  const chosen = kept.slice(0, Math.max(0, limit));
  const dropped = kept.slice(chosen.length);
  blockStats.considered = kept.length;
  blockStats.kept = chosen.length;
  blockStats.truncated = dropped.length;
  blockStats.largestKeptArea = chosen.length ? Math.max(...chosen.map(b => b.area)) : 0;
  blockStats.largestDroppedArea = dropped.length ? Math.max(...dropped.map(b => b.area)) : 0;
  return chosen.map(({ area, relevance, ...block }) => block);
}

// The mesh-volume limit itself, so the runtime report can show budget vs truncation.
blocksFromGroup.budget = { limit: 48 };
