// Shadow clones as real combat entities.
//
// A clone is a second skinned copy of the owner's own rig with its own mixer, its own position and
// its own attacks. It is deliberately not a decal or a projectile with a character sprite: it
// chases the nearest opponent, strikes with the game's own hit resolver (so guard, invulnerability
// and knockback are the real ones), and pops when it is hit or when its lifetime ends.
//
// Bounded by construction: `CLONE_LIMITS.alive` caps the roster at any moment, the lifetime is
// finite, and every clone is disposed from the scene graph on expiry so no skinned mesh leaks.
// Materials are cloned per clone (to fade them), geometry is shared with the owner and never
// disposed here.
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

export const CLONE_LIMITS = Object.freeze({
  alive: 3,          // hard cap on live clones, for any number of casters
  duration: 9,       // seconds a clone exists
  hp: 2,             // strikes it can eat before popping
  attackRange: 1.7,  // metres at which it starts swinging
  attackCooldown: .72,
  speed: 7.4,
  damage: 7,
  knockback: 6.4,
  stun: .42
});

const alive = [];

/**
 * One transparent copy of each source material, shared by every clone of that owner.
 *
 * Materials used to be cloned per clone, so one summon rebuilt all 18 of Naruto's materials and
 * their renderer state twice, and the second summon built 18 fresh ones again. Caching them per
 * owner makes the summon cost independent of how many times the jutsu is used.
 */
const materialCaches = new Map();

function materialCacheFor(owner) {
  let cache = materialCaches.get(owner);
  if (!cache) { cache = new Map(); materialCaches.set(owner, cache); }
  return cache;
}

function cloneMaterial(owner, source) {
  if (!source) return source;
  const cache = materialCacheFor(owner);
  let copy = cache.get(source);
  if (!copy) {
    copy = source.clone();
    copy.transparent = true;
    copy.opacity = .82;
    copy.userData.cloneOwned = true;
    cache.set(source, copy);
  }
  return copy;
}

export function cloneCount() {
  return alive.length;
}

/** Diagnostics for the harness: what is alive, for how long, and whose it is. */
export function cloneReport() {
  return alive.map(clone => ({
    owner: clone.owner?.identity || null,
    time: +clone.time.toFixed(2),
    hp: clone.hp,
    position: { x: +clone.root.position.x.toFixed(2), z: +clone.root.position.z.toFixed(2) }
  }));
}

/** Remove one clone's body. Its shared material copies outlive it; see clearClones(). */
function disposeClone(clone) {
  clone.root.parent?.remove(clone.root);
  clone.mixer?.stopAllAction();
}


/**
 * `SkeletonUtils.clone` runs `Object3D.copy`, which JSON-copies every node's `userData`. The
 * fighter's own `userData` holds live references (the weapon holder, joint handles, the last
 * action), so a plain clone throws "Converting circular structure to JSON".
 *
 * The old fix deep-serialised that data field by field. For a fighter's root that included the
 * live AnimationAction map, so every summon spent seconds stringifying animation internals. A
 * blank object satisfies `Object3D.copy` just as well and touches no live state: stash the real
 * object, hand the copier an empty one, then put it back exactly as it was.
 */
function sanitizeUserDataForClone(model) {
  const saved = [];
  model.traverse(node => {
    const original = node?.userData;
    if (!original || typeof original !== 'object') return;
    if (!Object.keys(original).length) return;
    saved.push([node, original]);
    node.userData = {};
  });
  return () => { for (const [node, original] of saved) node.userData = original; };
}

/**
 * Spawn up to `count` clones beside the owner. Returns how many were actually created after the
 * global cap was applied, so the caller can report a truthful result instead of a request count.
 */
export function spawnClones({ scene, owner, count = 2 } = {}) {
  if (!scene || !owner?.model) return 0;
  let created = 0;
  for (let index = 0; index < count && alive.length < CLONE_LIMITS.alive; index++) {
    const restoreUserData = sanitizeUserDataForClone(owner.model);
    let root;
    try {
      root = cloneSkeleton(owner.model);
    } finally {
      restoreUserData();
    }
    if (!root) continue;
    root.userData = {};
    root.traverse(node => {
      if (!node.isMesh) return;
      const source = Array.isArray(node.material) ? node.material : [node.material];
      const copies = source.map(material => cloneMaterial(owner, material));
      node.material = Array.isArray(node.material) ? copies : copies[0];
      node.castShadow = false;
      node.receiveShadow = false;
      // Clones were excluded from culling, so all 25 skinned meshes of every clone were submitted
      // even when off camera. Their geometry bounds are the owner's, which is correct at the pose
      // the clone is drawn in, so the renderer can skip the ones outside the frustum.
      node.frustumCulled = true;
    });
    const facing = owner.facing || 1;
    const side = index % 2 === 0 ? 1 : -1;
    root.position.set(
      owner.position.x - facing * (0.85 + index * 0.3),
      owner.position.y,
      owner.position.z + side * (0.85 + index * 0.25)
    );
    root.rotation.y = Math.atan2(owner.facing || 1, owner.facingZ || 0);
    scene.add(root);

    // The clone plays one of the owner's own clips, so it animates rather than sliding as a
    // mannequin. If the body has no bound action (a fallback body), it still moves and attacks.
    const clip = owner.model.userData?.lastMoveAction?.getClip?.()
      || owner.model.userData?.idle?.getClip?.()
      || null;
    let mixer = null;
    if (clip) {
      mixer = new THREE.AnimationMixer(root);
      mixer.clipAction(clip).play();
    }
    alive.push({
      owner, root, mixer,
      hp: CLONE_LIMITS.hp,
      time: CLONE_LIMITS.duration,
      cooldown: .18 + index * .12,
      popped: false
    });
    created++;
  }
  // Presentation is fired once for the pack, not once per body: three overlapping summon effects
  // would read as noise.
  if (created) {
    globalThis.window?.__browserSmashPresent?.('clone', {
      owner,
      label: 'SHADOW CLONE JUTSU',
      origin: owner.position
    });
  }
  return created;
}

/**
 * Advance every clone. `hit(owner, target, profile, kind)` must be the game's real hit resolver;
 * this module never applies damage itself.
 */
export function updateClones(dt, { fighters = [], hit } = {}) {
  for (let index = alive.length - 1; index >= 0; index--) {
    const clone = alive[index];
    clone.time -= dt;
    clone.mixer?.update(dt);
    if (clone.time <= 0 || clone.owner?.ko) {
      disposeClone(clone);
      alive.splice(index, 1);
      continue;
    }
    const target = fighters.find(fighter => fighter !== clone.owner && fighter.model?.visible !== false);
    if (!target) continue;

    const dx = target.position.x - clone.root.position.x;
    const dz = target.position.z - clone.root.position.z;
    const distance = Math.hypot(dx, dz) || 1;

    // An opponent's live strike pops the clone: clones are counterplay-able, not immortal.
    const strike = (target.attackQueue || []).find(attack => !attack.hit && attack.t >= attack.start && attack.t <= attack.end);
    if (strike && distance < (strike.radius || 1.3) + .55) {
      clone.hp -= strike.damage > 14 ? 2 : 1;
      if (clone.hp <= 0) {
        globalThis.window?.spawnImpact?.(clone.root.position.clone().add(new THREE.Vector3(0, 1.05, 0)), 13, 0xffc46a);
        disposeClone(clone);
        alive.splice(index, 1);
        continue;
      }
    }

    if (distance > CLONE_LIMITS.attackRange) {
      const step = Math.min(CLONE_LIMITS.speed * dt, distance - CLONE_LIMITS.attackRange * .82);
      clone.root.position.x += dx / distance * step;
      clone.root.position.z += dz / distance * step;
      clone.root.rotation.y = Math.atan2(dx, dz);
      clone.cooldown = Math.max(clone.cooldown, .12);
    } else {
      clone.root.rotation.y = Math.atan2(dx, dz);
      clone.cooldown -= dt;
      if (clone.cooldown <= 0) {
        clone.cooldown = CLONE_LIMITS.attackCooldown;
        hit?.(clone.owner, target, {
          label: 'SHADOW CLONE STRIKE',
          damage: CLONE_LIMITS.damage,
          knockback: CLONE_LIMITS.knockback,
          stun: CLONE_LIMITS.stun
        }, 'clone');
        globalThis.window?.spawnImpact?.(target.position.clone().add(new THREE.Vector3(0, 1.1, 0)), 8, 0xffc46a);
      }
    }
  }
}

/** Remove every clone (round end, character swap, rematch) and the shared material copies. */
export function clearClones() {
  while (alive.length) disposeClone(alive.pop());
  for (const cache of materialCaches.values()) {
    for (const copy of cache.values()) copy.dispose?.();
  }
  materialCaches.clear();
}
