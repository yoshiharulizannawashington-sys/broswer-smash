// Projectile origin resolution.
//
// Where a shot leaves a fighter is a per-identity decision, not a constant: an energy caster fires
// from the palm, a weapon fighter fires from the weapon, and a rig with no hand bone falls back to
// a body-relative point instead of producing NaN. main.js resolves every shot through this module,
// and the policy is tested outside the browser.
export const ORIGIN_POLICIES = Object.freeze({
  RIGHT_HAND: 'rightHand',
  LEFT_HAND: 'leftHand',
  WEAPON: 'weapon',
  CHEST: 'chest'
});

// Only identities whose shot genuinely does not leave the right hand belong here — and only
// identities that actually have a projectile signature. A DLC fighter with no moveset entry (for
// example Geralt of Rivia, who is outside the launch roster and has no SPECIAL_MOVES signature)
// gets no override: an entry nothing can reach is dead data, and the right-hand default is honest.
export const ORIGIN_OVERRIDES = Object.freeze({
  thor: ORIGIN_POLICIES.WEAPON,
  wonder_woman: ORIGIN_POLICIES.WEAPON,
  link: ORIGIN_POLICIES.WEAPON
});

export const DEFAULT_ORIGIN_POLICY = ORIGIN_POLICIES.RIGHT_HAND;

export function identityKeyOf(owner) {
  return String(owner?.identityKey || owner?.identity || '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** The policy a shot should use, before resolving an actual object. */
export function originPolicyFor(owner, options = {}) {
  if (options.source === 'weapon') return ORIGIN_POLICIES.WEAPON;
  // Kit abilities fire from the hand unless the ability declares itself weapon-borne. Without this
  // rule a kit cast inherited the identity's signature override: Thor's pick-up move resolved
  // through his hammer policy, inherited the equipped weapon's rest transform, and spawned 1.06 m
  // off the body axis at 2.38 m — high enough to fly over a fighter standing 1.5 m away.
  if (options.source === 'ability') {
    return options.origin === 'weapon' ? ORIGIN_POLICIES.WEAPON : DEFAULT_ORIGIN_POLICY;
  }
  return ORIGIN_OVERRIDES[identityKeyOf(owner)] || DEFAULT_ORIGIN_POLICY;
}

function worldPointOf(object) {
  if (!object?.isObject3D) return null;
  const out = object.position?.clone ? object.position.clone() : { x: 0, y: 0, z: 0 };
  if (typeof object.getWorldPosition === 'function') object.getWorldPosition(out);
  if (!Number.isFinite(out.x) || !Number.isFinite(out.y) || !Number.isFinite(out.z)) return null;
  return { x: out.x, y: out.y, z: out.z };
}

/** Objects a policy may use, in priority order, for this body. */
export function candidatesFor(userData = {}, policy) {
  if (policy === ORIGIN_POLICIES.WEAPON) {
    return [userData.equippedWeaponRight, userData.rightHand, userData.rightFore, userData.rightArm];
  }
  if (policy === ORIGIN_POLICIES.LEFT_HAND) return [userData.leftHand, userData.leftFore, userData.leftArm];
  if (policy === ORIGIN_POLICIES.RIGHT_HAND) return [userData.rightHand, userData.rightFore, userData.rightArm];
  return [];
}

/**
 * Resolve a shot origin. Never throws: a body with no usable reference falls back to the legacy
 * chest point, so a missing bone cannot produce NaN coordinates or a crash.
 * Returns { policy, objectName, point, usedFallback }.
 */
export function resolveProjectileOrigin({ owner, options = {}, direction = null } = {}) {
  const policy = originPolicyFor(owner, options);
  const userData = owner?.model?.userData || {};
  for (const candidate of candidatesFor(userData, policy)) {
    const point = worldPointOf(candidate);
    if (point) return { policy, objectName: candidate.name || null, point, usedFallback: false };
  }
  const base = owner?.position || { x: 0, y: 0, z: 0 };
  return {
    policy,
    objectName: null,
    point: {
      x: (base.x || 0) + (direction?.x || 0) * 1.05,
      y: (base.y || 0) + 1.5,
      z: (base.z || 0) + (direction?.z || 0) * 1.05
    },
    usedFallback: true
  };
}

/** Distance from a point to the fighter's own body axis, to detect a shot starting inside it. */
export function distanceFromBodyAxis(point, owner) {
  const base = owner?.position || { x: 0, y: 0, z: 0 };
  return Math.hypot(point.x - base.x, point.y - (base.y + 1.1), point.z - base.z);
}
