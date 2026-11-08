// Architectural stone pass for the large authored maps (Hogwarts, Tournament, Death Star,
// Helicarrier/Stark, Final Valley). Those GLBs ship flat PBR factors with no images at all
// (Hogwarts: 603 meshes, 0 textures), so walls, floors and plazas read as untextured geometry up close.
//
// Uses the CC0 ambientCG Marble001 set already installed for Asgard, through the same cached loader,
// so there is exactly one decode of each map per page. Matching is by material name and deliberately
// narrow: gold, bronze, electrum, crystal, glass, window light, water and cloth never match, so the
// metal and emissive accents keep their identities.
import * as THREE from 'three';
import { loadMarble } from './asgard_materials.js';

const STONE = /(marble|stone|stonework|masonry|tile|paving|plaza|floor|wall|concrete|granite)/i;
const NOT_STONE = /(gold|bronze|brass|electrum|crystal|glass|window|light|lamp|water|river|banner|cloth|curtain|flame|glow)/i;
const TILE_METRES = 4;
// The authored arena is mounted asynchronously, so the first pass after a map switch usually sees an
// empty group. Without a late pass the Great Hall floor kept its flat grey factor forever.
const RETRY_INTERVAL_MS = 400;
const RETRY_ATTEMPTS = 30;
const retryTimers = new WeakMap();

function applyStonePass(group, key) {
  const tuned = [];
  const skipped = [];
  if (!group?.traverse) return { key, tuned, skipped };
  const maps = loadMarble();
  group.traverse(node => {
    if (!node.isMesh || !node.material) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material || material.userData?.archStone) continue;
      const name = material.name || '';
      if (!STONE.test(name) || NOT_STONE.test(name)) { if (name) skipped.push(name); continue; }
      const geometry = node.geometry;
      const uv = geometry?.getAttribute?.('uv');
      // Sampling albedo without UVs paints a single texel across the surface, which is worse than the
      // flat factor it replaces. Only texture geometry that can actually carry a map.
      if (!uv) { skipped.push(name + ' (no uv)'); continue; }
      if (!geometry.getAttribute('uv1')) geometry.setAttribute('uv1', uv);
      geometry.computeBoundingBox?.();
      const box = geometry.boundingBox;
      const repeat = [
        Math.max(1, Math.round((box ? box.max.x - box.min.x : 8) / TILE_METRES)),
        Math.max(1, Math.round((box ? box.max.z - box.min.z : 8) / TILE_METRES))
      ];
      const surface = texture => {
        const clone = texture.clone();
        clone.needsUpdate = true;
        clone.wrapS = clone.wrapT = THREE.RepeatWrapping;
        clone.repeat.set(repeat[0], repeat[1]);
        return clone;
      };
      // The map is albedo, not light. Forcing the factor to pure white blew interior floors out to a
      // featureless white plane under the Great Hall's exposure, so the tint stays slightly warm-grey.
      if (!material.map) { material.map = surface(maps.map); material.color?.setHex(0xded7cb); }
      if (!material.normalMap) { material.normalMap = surface(maps.normalMap); material.normalScale = new THREE.Vector2(0.6, 0.6); }
      if (!material.roughnessMap) { material.roughnessMap = surface(maps.roughnessMap); material.roughness = 1; }
      // Architectural stone is a dielectric: the authored GLBs leave metalness above zero on floors,
      // and that specular sheen is what hid the veining at gameplay distance.
      if ('metalness' in material) material.metalness = 0;
      material.userData = { ...(material.userData || {}), archStone: true };
      material.needsUpdate = true;
      tuned.push(name);
    }
  });
  return { key, tuned: [...new Set(tuned)], skipped: [...new Set(skipped)].slice(0, 24) };
}

function scheduleLatePass(group, key) {
  if (retryTimers.has(group)) return;
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    const result = applyStonePass(group, key);
    if (result.tuned.length > 0 || attempts >= RETRY_ATTEMPTS) {
      clearInterval(timer);
      retryTimers.delete(group);
      if (result.tuned.length > 0) {
        // Recorded so a screenshot can prove the late pass ran rather than the materials staying flat.
        globalThis.window && (globalThis.window.__browserSmashStoneLatePass = { key, attempts, materials: result.tuned.length });
      }
    }
  }, RETRY_INTERVAL_MS);
  timer.unref?.();
  retryTimers.set(group, timer);
}

/**
 * Apply marble colour, normal and roughness to stone-named materials inside a mounted arena.
 * Idempotent per material: `userData.archStone` guards re-entry, so switching arenas repeatedly
 * cannot stack tiling or duplicate maps. If the arena GLB has not finished mounting yet, a bounded
 * late pass applies the same treatment once its meshes exist.
 */
export function tuneArchitecturalStone(group, key = '') {
  const result = applyStonePass(group, key);
  if (result.tuned.length === 0) scheduleLatePass(group, key);
  return result;
}
