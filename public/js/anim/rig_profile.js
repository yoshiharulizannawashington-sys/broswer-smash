// Scalable rig architecture: a shared animation interface, per-character capability declarations.
//
// The clip controller must not care how many bones a body has. It drives a small shared interface
// (the canonical names in rig_map.js) and asks this module what else a particular fighter can do.
// A rig may therefore have:
//   - the core eleven joints (required, or the clip layer refuses the body),
//   - the standard extensions (spine, clavicles, neck, wrists, ankles) - present on the authored
//     bodies, absent on a rig that has not been rebuilt yet,
//   - extra, character-specific bones (mechanical limbs, weapon mounts, tail, cape) that no shared
//     clip drives and that a character's own module owns.
//
// This is deliberately a declaration, not a second animation system: it says what exists, so
// reports and tests can state "19/19 bound, plus 12 appendage joints" instead of assuming one
// skeleton fits every fighter.
import { CANONICAL_BONES, CORE_BONES, EXTENSION_BONES } from './rig_map.js';

/**
 * Bone groups by role. Empty groups are declared so a later character can fill them without this
 * module changing shape (fingers and face are the documented next steps, not oversights).
 */
export const RIG_CAPABILITY_GROUPS = Object.freeze({
  core: CORE_BONES,
  spine: Object.freeze(['spine']),
  clavicles: Object.freeze(['leftClavicle', 'rightClavicle']),
  neck: Object.freeze(['neck']),
  hands: Object.freeze(['leftHand', 'rightHand']),
  feet: Object.freeze(['leftFoot', 'rightFoot']),
  fingers: Object.freeze([]),
  face: Object.freeze([])
});

/**
 * Character-specific rig extensions. These are owned by the character's own module (for example
 * anim/spider_legs.js), not by the shared clip library, so adding one cannot break another fighter.
 */
export const SPECIALIZED_RIGS = Object.freeze({
  iron_spider: Object.freeze({
    id: 'spider-appendages',
    owner: 'public/js/anim/spider_legs.js',
    dataPath: 'userData.spiderLegs',
    joints: 12,
    capabilities: Object.freeze(['appendage-articulation', 'appendage-sweep', 'appendage-tips'])
  }),
  iron_man_tony_stark: Object.freeze({
    id: 'repulsor-palm',
    owner: 'public/js/characters/sculpted.js',
    dataPath: 'repulsor-palm mesh',
    joints: 0,
    capabilities: Object.freeze(['palm-emitter', 'flight-thrusters'])
  })
});

/** Identity -> archetype -> shared-only. A character may add capability, never remove core. */
export const IDENTITY_RIG_PROFILES = Object.freeze({
  iron_spider: Object.freeze({ specialized: 'iron_spider' }),
  iron_man_tony_stark: Object.freeze({ specialized: 'iron_man_tony_stark' })
});

export const ARCHETYPE_RIG_PROFILES = Object.freeze({
  warrior: Object.freeze({}),
  ninja: Object.freeze({}),
  brawler: Object.freeze({}),
  mage: Object.freeze({}),
  cyborg: Object.freeze({})
});

export const DEFAULT_RIG_PROFILE = Object.freeze({ specialized: null, extraBones: Object.freeze([]) });

/** The rig profile for a fighter: identity first, then archetype, then the shared-only default. */
export function rigProfileFor(fighter) {
  const identity = String(fighter?.identityKey || '').toLowerCase();
  if (IDENTITY_RIG_PROFILES[identity]) return IDENTITY_RIG_PROFILES[identity];
  const archetype = String(fighter?.archetype || '').toLowerCase();
  if (ARCHETYPE_RIG_PROFILES[archetype]) return ARCHETYPE_RIG_PROFILES[archetype];
  return DEFAULT_RIG_PROFILE;
}

/**
 * Every bone the shared clip interface drives for this profile. Always the canonical set; a
 * profile can only add character-owned bones on top, never rename the shared ones.
 */
export function requiredBonesFor(profile = DEFAULT_RIG_PROFILE) {
  return [...CANONICAL_BONES, ...(profile.extraBones || [])];
}

/**
 * Report what a bound rig can actually do, per role. `rig` is the object resolveRig() returns.
 * Used by the asset report, the validators and the architecture test.
 */
export function describeRigCapabilities(rig, profile = DEFAULT_RIG_PROFILE) {
  const bound = new Set(rig ? Object.keys(rig.joints) : []);
  const groups = {};
  for (const [group, bones] of Object.entries(RIG_CAPABILITY_GROUPS)) {
    groups[group] = {
      total: bones.length,
      bound: bones.filter(bone => bound.has(bone)).length,
      complete: bones.length > 0 && bones.every(bone => bound.has(bone))
    };
  }
  const missing = CANONICAL_BONES.filter(bone => !bound.has(bone));
  const specialized = profile?.specialized ? SPECIALIZED_RIGS[profile.specialized] || null : null;
  return {
    rigKind: rig?.kind || 'none',
    boundJoints: bound.size,
    sharedInterface: CANONICAL_BONES.length,
    coreComplete: CORE_BONES.every(bone => bound.has(bone)),
    extensionsComplete: EXTENSION_BONES.every(bone => bound.has(bone)),
    missing,
    groups,
    specialized: specialized
      ? { id: specialized.id, owner: specialized.owner, joints: specialized.joints, capabilities: specialized.capabilities }
      : null,
    extraBones: (profile?.extraBones || []).filter(bone => bound.has(bone))
  };
}

/** True when the shared interface can drive this rig at all. */
export function isAnimationReady(capabilities) {
  return Boolean(capabilities?.coreComplete);
}
