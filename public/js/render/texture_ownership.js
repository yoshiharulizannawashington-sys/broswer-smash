// Texture ownership and reference counting for character models.
//
// renderer.info.memory.textures used to climb on every character swap: replacing a body freed its
// geometry but every material map - including the maps the surface-detail pass had cloned onto it -
// stayed resident for the rest of the session. This module makes ownership explicit:
//
//   * a model claims every texture its materials mount, when it is mounted;
//   * releasing that model drops its claim;
//   * a texture is disposed only when no live model still claims it;
//   * generated detail patterns are marked shared, because they are one fixed set reused by every
//     fighter, so a swap must never dispose them;
//   * a texture that was never claimed (a body built before this module existed) is treated as
//     owned by the model that carries it, unless a surviving model in `keep` still uses it.
//
// It is deliberately dependency-free: anything with `traverse` whose nodes expose `material` and
// whose maps expose `isTexture` works, so the rule is unit-testable without WebGL.

const owners = new WeakMap();   // texture -> Set<root> live owners
const shared = new WeakSet();   // process-wide textures that outlive any one model
const released = new WeakSet(); // roots that already handed their maps back
const totals = { claimed: 0, released: 0, disposed: 0, boneTextures: 0, sharedSkips: 0, inUseSkips: 0, otherOwnerSkips: 0 };
let disposeCalls = 0;

function materialsOf(node) {
  const material = node?.material;
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
}

// A skinned body owns one more GPU texture than its materials: three builds a DataTexture from the
// bone matrices (Skeleton.computeBoneTexture) the first time the skeleton is uploaded, and keeps it
// on the skeleton rather than in any material. Swapping the body out therefore stranded exactly one
// texture per character selection, which is what made the leak invisible to the material scan.
function boneTextureOf(node) {
  const texture = node?.skeleton?.boneTexture;
  return texture && texture.isTexture ? texture : null;
}

function collectTextures(root) {
  const textures = new Set();
  if (!root || typeof root.traverse !== 'function') return textures;
  root.traverse(node => {
    const boneTexture = boneTextureOf(node);
    if (boneTexture) textures.add(boneTexture);
    for (const material of materialsOf(node)) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value && value.isTexture) textures.add(value);
      }
    }
  });
  return textures;
}

/** Mark a texture that must outlive every model (the generated surface-detail patterns). */
export function markSharedTexture(texture) {
  if (texture) shared.add(texture);
  return texture;
}

export function isSharedTexture(texture) {
  return shared.has(texture);
}

/** Register `root` as an owner of every texture its materials use. */
export function claimModelTextures(root) {
  if (root && typeof root === 'object') released.delete(root);
  const textures = collectTextures(root);
  for (const texture of textures) {
    if (shared.has(texture)) continue;
    let set = owners.get(texture);
    if (!set) { set = new Set(); owners.set(texture, set); }
    set.add(root);
  }
  totals.claimed += textures.size;
  return textures.size;
}

/**
 * Drop `root`'s claims and dispose every texture left with no owner.
 * `keep` lists roots that survive the swap (the fighter container and the other fighter); any
 * texture they still mount is never disposed, so a shared map cannot blank a visible character.
 */
export function releaseModelTextures(root, { keep = [] } = {}) {
  if (!root || typeof root.traverse !== 'function') return { released: 0, disposed: 0, skipped: 0 };
  // A body can be released by two teardown paths (a swap and a scene clear). The second pass must
  // not re-dispose maps the first already freed, so a released root is remembered until re-claimed.
  if (released.has(root)) return { released: 0, disposed: 0, skipped: 0 };
  released.add(root);
  const inUse = new Set();
  for (const other of keep) {
    if (!other || other === root) continue;
    for (const texture of collectTextures(other)) inUse.add(texture);
  }
  // Bone textures live on skeletons, not materials, so they are recorded here to be cleared off the
  // skeleton when (and only when) they are actually disposed. A live skeleton must never be left
  // pointing at a freed GL texture - three would keep sampling it instead of rebuilding one.
  const boneOwners = new Map();
  root.traverse(node => {
    const boneTexture = boneTextureOf(node);
    if (!boneTexture) return;
    let set = boneOwners.get(boneTexture);
    if (!set) { set = new Set(); boneOwners.set(boneTexture, set); }
    set.add(node.skeleton);
  });
  let releasedCount = 0, disposed = 0, skipped = 0, boneTextures = 0;
  for (const texture of collectTextures(root)) {
    const set = owners.get(texture);
    if (set) { set.delete(root); releasedCount++; }
    if (shared.has(texture)) { totals.sharedSkips++; skipped++; continue; }
    if (inUse.has(texture)) { totals.inUseSkips++; skipped++; continue; }
    if (set && set.size > 0) { totals.otherOwnerSkips++; skipped++; continue; }
    try {
      texture.dispose?.();
      disposeCalls++;
      disposed++;
      totals.disposed++;
      const skeletons = boneOwners.get(texture);
      if (skeletons) {
        for (const skeleton of skeletons) if (skeleton.boneTexture === texture) skeleton.boneTexture = null;
        boneTextures++;
      }
    } catch (_error) { /* already disposed */ }
    owners.delete(texture);
  }
  totals.released += releasedCount;
  totals.boneTextures += boneTextures;
  return { released: releasedCount, disposed, skipped, boneTextures };
}

/**
 * Counters for the resource probe. A WeakMap cannot be enumerated, so the module keeps the
 * lifetime totals instead of a live texture list: the probe measures renderer.info for the live
 * count and reads these to prove the disposals actually happened.
 */
export function textureOwnershipReport() {
  return { ...totals, disposeCalls };
}

// Tooling handle: the resource probe reads the lifetime totals without importing the module.
if (typeof window !== 'undefined') window.__browserSmashTextureOwnership = textureOwnershipReport;
