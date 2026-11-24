// Per-move attack motion, authored as joint curves on the fighter's own rig.
//
// The roster GLBs ship one `jab`, one `heavy_punch` and one `air_attack`, so a five-hit chain and
// three heavies all look the same even though their damage and timing differ. Rather than bolt on
// eight more near-identical baked clips, this module drives the procedural joints that every
// fighter already exposes (rightArm/leftArm/forearm/torso/pelvis/legs/head) with a distinct
// keyframed motion per move: a straight punch leads with the right arm, the reverse punch with the
// left, the spinning kick rotates the pelvis, the launcher rises, the slam drives both arms down.
//
// Frames are (time 0..1, joint deltas in radians) relative to the rig's rest pose. Deltas are added
// to a captured base each frame, so animation never accumulates drift, and when no attack is active
// the base is restored exactly - a stuck pose would be worse than no animation.
//
// Sampling is exported so coverage can be measured without a browser: eight motions that sample to
// the same rotations would be renamed clips in disguise, and the test rejects that.

import { NARUTO_MOTIONS } from './attack_motions_naruto.js';
import { GOKU_MOTIONS } from './attack_motions_goku.js';
import { ROSTER_MOTIONS, ROSTER_MOTION_BY_IDENTITY } from './attack_motions_roster.js';

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));

// Joints are addressed by the names human_fighter.js already assigns on model.userData.
const JOINTS = [
  'torso', 'pelvis', 'head',
  'rightArm', 'leftArm', 'rightFore', 'leftFore', 'rightHand', 'leftHand',
  'rightLeg', 'leftLeg', 'rightShin', 'leftShin', 'rightFoot', 'leftFoot'
];

/** Keyframed motions. Each joint entry is [x, y, z] radians added to the rest pose. */
export const MOTIONS = Object.freeze({
  light1: [
    { t: 0, torso: [0, .28, 0], rightArm: [0, 0, -.15], rightFore: [0, 0, .2] },
    { t: .35, torso: [0, -.32, 0], rightArm: [-1.15, 0, -.35], rightFore: [0, 0, .15] },
    { t: .6, torso: [0, -.22, 0], rightArm: [-.75, 0, -.2], rightFore: [0, 0, .35] },
    { t: 1, torso: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0] }
  ],
  light2: [
    { t: 0, torso: [0, -.26, 0], leftArm: [0, 0, .12] },
    { t: .35, torso: [0, .34, 0], leftArm: [-1.1, 0, .4], leftFore: [0, 0, -.2] },
    { t: .6, torso: [0, .24, 0], leftArm: [-.7, 0, .25] },
    { t: 1, torso: [0, 0, 0], leftArm: [0, 0, 0], leftFore: [0, 0, 0] }
  ],
  light3: [
    { t: 0, pelvis: [0, -.35, 0], torso: [0, -.25, 0], rightLeg: [.25, 0, 0] },
    { t: .3, pelvis: [0, 1.25, 0], torso: [0, .5, -.2], rightLeg: [-.55, 0, -.45], leftLeg: [.2, 0, .1] },
    { t: .55, pelvis: [0, 2.1, 0], torso: [0, .65, -.25], rightLeg: [-1.0, 0, -.2] },
    { t: 1, pelvis: [0, 0, 0], torso: [0, 0, 0], rightLeg: [0, 0, 0], leftLeg: [0, 0, 0] }
  ],
  light4: [
    { t: 0, pelvis: [0, .1, 0], rightLeg: [.2, 0, 0], leftLeg: [-.15, 0, 0] },
    { t: .3, pelvis: [-.18, .1, 0], torso: [-.2, 0, 0], rightLeg: [-1.5, 0, 0], rightShin: [0, 0, 0] },
    { t: .55, pelvis: [-.1, .1, 0], torso: [-.1, 0, 0], rightLeg: [-1.15, 0, 0], leftArm: [-.35, 0, .2] },
    { t: 1, pelvis: [0, 0, 0], torso: [0, 0, 0], rightLeg: [0, 0, 0], leftLeg: [0, 0, 0], leftArm: [0, 0, 0] }
  ],
  light5: [
    { t: 0, torso: [.12, .3, 0], rightArm: [-.35, 0, -.3], leftArm: [-.25, 0, .3] },
    { t: .28, torso: [-.28, -.2, 0], head: [-.15, 0, 0], rightArm: [-1.45, 0, -.15], leftArm: [-1.35, 0, .15], rightFore: [0, 0, .1], leftFore: [0, 0, -.1] },
    { t: .62, torso: [-.2, -.15, 0], rightArm: [-1.0, 0, -.2], leftArm: [-.95, 0, .2] },
    { t: 1, torso: [0, 0, 0], head: [0, 0, 0], rightArm: [0, 0, 0], leftArm: [0, 0, 0], rightFore: [0, 0, 0], leftFore: [0, 0, 0] }
  ],
  heavy: [
    { t: 0, torso: [.18, .38, 0], rightArm: [.35, 0, -.35], leftArm: [.3, 0, .35] },
    { t: .4, torso: [-.42, -.28, 0], rightArm: [-1.5, 0, -.1], leftArm: [-1.2, 0, .1], rightLeg: [.35, 0, 0] },
    { t: .7, torso: [-.3, -.18, 0], rightArm: [-1.0, 0, -.15], leftArm: [-.8, 0, .15] },
    { t: 1, torso: [0, 0, 0], rightArm: [0, 0, 0], leftArm: [0, 0, 0], rightLeg: [0, 0, 0] }
  ],
  heavyLauncher: [
    { t: 0, pelvis: [.1, 0, 0], torso: [.35, 0, 0], rightArm: [.55, 0, -.4] },
    { t: .3, pelvis: [-.2, 0, 0], torso: [-.35, 0, 0], rightArm: [-2.25, 0, -.25], rightFore: [0, 0, .25], rightLeg: [-.3, 0, 0] },
    { t: .6, pelvis: [-.15, 0, 0], torso: [-.25, 0, 0], rightArm: [-1.8, 0, -.2], head: [-.25, 0, 0] },
    { t: 1, pelvis: [0, 0, 0], torso: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], rightLeg: [0, 0, 0], head: [0, 0, 0] }
  ],
  heavySlam: [
    { t: 0, pelvis: [-.35, 0, 0], torso: [-.5, 0, 0], rightArm: [-2.6, 0, -.25], leftArm: [-2.6, 0, .25], rightLeg: [-.4, 0, 0], leftLeg: [-.4, 0, 0] },
    { t: .35, pelvis: [.55, 0, 0], torso: [.55, 0, 0], rightArm: [-.15, 0, -.1], leftArm: [-.15, 0, .1], rightLeg: [.5, 0, 0], leftLeg: [.5, 0, 0], head: [.3, 0, 0] },
    { t: .6, pelvis: [.35, 0, 0], torso: [.4, 0, 0], rightArm: [-.25, 0, -.1], leftArm: [-.25, 0, .1] },
    { t: 1, pelvis: [0, 0, 0], torso: [0, 0, 0], rightArm: [0, 0, 0], leftArm: [0, 0, 0], rightLeg: [0, 0, 0], leftLeg: [0, 0, 0], head: [0, 0, 0] }
  ],
  special: [
    { t: 0, torso: [.1, .5, 0], rightArm: [.4, 0, -.5], rightFore: [0, 0, .5], leftArm: [-.9, 0, .35] },
    { t: .3, torso: [-.2, -.4, 0], rightArm: [-1.5, 0, -.15], rightFore: [0, 0, .1], leftArm: [-1.0, 0, .4] },
    { t: .7, torso: [-.12, -.3, 0], rightArm: [-1.1, 0, -.2] },
    { t: 1, torso: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], leftArm: [0, 0, 0] }
  ]
});

export const MOTION_KINDS = Object.freeze(Object.keys(MOTIONS));

/**
 * Per-identity motion sets. `default` is the shared humanoid set every fighter used before this
 * existed; a named set replaces it for that identity only, so a fighter with no entry animates
 * exactly as it did.
 */
export const MOTION_SETS = Object.freeze({
  default: MOTIONS,
  naruto: NARUTO_MOTIONS,
  goku: GOKU_MOTIONS,
  ...ROSTER_MOTIONS
});

/** Identity -> motion set. Only a fighter proven in a match gets an entry. */
export const MOTION_SET_BY_IDENTITY = Object.freeze({
  naruto_uzumaki: 'naruto',
  goku: 'goku',
  ...ROSTER_MOTION_BY_IDENTITY
});

// Diagnostics: which identities have their own authored set, and which slots that set covers.
if (typeof window !== 'undefined') {
  // Bridge for systems that pose the body directly (the ultimate choreography) and must layer the
  // fighter's own authored motion instead of a hand-authored beat.
  window.__browserSmashSampleMotion = (identity, slot, t) => {
    const set = motionSetFor({ identityKey: identity });
    if (!set.strict || !set.motions?.[slot]) return null;
    return sampleMotion(slot, t, set.motions);
  };
  window.__browserSmashMotionSets = () => ({
    sets: Object.fromEntries(Object.entries(MOTION_SETS).map(([name, table]) => [name, Object.keys(table)])),
    identities: { ...MOTION_SET_BY_IDENTITY }
  });
}

/**
 * Move id -> motion slot. This is the mapping that makes a move's *animation* addressable: before
 * it, the resolver matched on `attack.kind`, which is `'melee' | 'heavy' | 'slam' | 'anti-air'` and
 * can never equal a motion slot like `heavySlam`, so every heavy and every finisher silently played
 * the current light step. Now an unmapped move is a visible hole instead of a silent duplicate.
 */
export const MOVE_MOTION = Object.freeze({
  light1: 'light1',
  light2: 'light2',
  light3: 'light3',
  light4: 'light4',
  finisher: 'light5',
  heavy: 'heavy',
  heavyLauncher: 'heavyLauncher',
  heavySlam: 'heavySlam',
  antiAir: 'heavyLauncher',
  dive: 'light4',
  air: 'light3',
  airFinisher: 'light5',
  counter: 'light5',
  grab: 'special',
  throw: 'special',
  special: 'special',
  ultimate: 'ultimate'
});

/** The motion set a fighter draws from, with an id for reporting. */
export function motionSetFor(fighter) {
  const identity = String(fighter?.identityKey || fighter?.name || '').toLowerCase();
  const name = MOTION_SET_BY_IDENTITY[identity] || 'default';
  return { id: name, motions: MOTION_SETS[name] || MOTIONS, strict: name !== 'default' };
}

/**
 * Slots a set must provide for the moves a match can actually throw. `ultimate` is excluded: an
 * ultimate is presented by the cinematic director, not queued as an attack, so demanding the slot
 * would fail a set for a move the attack path never asks for. A set may still author one.
 */
export const REQUIRED_MOTION_SLOTS = Object.freeze(
  [...new Set(Object.values(MOVE_MOTION))].filter(slot => slot !== 'ultimate')
);

/** Report which required slots a set is missing. Empty means complete. */
export function validateMotionVocabulary(motions = MOTIONS) {
  return REQUIRED_MOTION_SLOTS.filter(slot => !motions?.[slot]);
}

function recordMotionMiss(fighter, moveId, set) {
  if (typeof window === 'undefined') return;
  window.__browserSmashMotionErrors = window.__browserSmashMotionErrors || [];
  window.__browserSmashMotionErrors.push({
    identity: fighter?.identityKey || fighter?.name || 'unknown',
    moveId: moveId || null,
    set: set.id,
    at: performance.now?.() || 0
  });
}

/** Blend two keyframes for one joint. */
function sampleJoint(frames, key, t) {
  let previous = frames[0];
  let next = frames[frames.length - 1];
  for (let index = 0; index < frames.length; index++) {
    if (frames[index].t <= t) previous = frames[index];
    if (frames[index].t >= t) { next = frames[index]; break; }
  }
  const a = previous[key] || [0, 0, 0];
  const b = next[key] || [0, 0, 0];
  const span = Math.max(1e-4, next.t - previous.t);
  const mix = clamp01((t - previous.t) / span);
  return [a[0] + (b[0] - a[0]) * mix, a[1] + (b[1] - a[1]) * mix, a[2] + (b[2] - a[2]) * mix];
}

/** Pure sampling, used by the coverage test and by the runtime applicator. */
export function sampleMotion(kind, t, motions = MOTIONS) {
  const frames = motions[kind] || MOTIONS.light1;
  const progress = clamp01(t);
  const out = {};
  for (const joint of JOINTS) out[joint] = sampleJoint(frames, joint, progress);
  return out;
}

/**
 * Pick the motion slot for a live attack: move id first (the only value that distinguishes a heavy
 * from a light), then the chain step.
 *
 * Returns null when a fighter with an authored set has no motion for the move and no usable chain
 * step. The caller records the miss and leaves the rest pose intact rather than playing a
 * different move's motion and calling it coverage.
 */
export function motionKindFor(attack, fighter) {
  const set = motionSetFor(fighter);
  const moveId = attack?.id || null;
  // An explicit slot name (a clip id such as `light5` or `special`) wins: that is what the animation
  // tooling and the director pass when they already know which pose they want.
  const named = attack?.kind && set.motions[attack.kind] && !MOVE_MOTION[attack.kind] ? attack.kind : null;
  const slot = MOVE_MOTION[moveId] || MOVE_MOTION[attack?.kind] || named || null;
  if (slot && set.motions[slot]) return slot;
  const step = Math.min(5, Math.max(1, Number(fighter?.comboStep) || 1));
  const fallback = `light${step}`;
  if (set.motions[fallback] && !set.strict) return fallback;
  return null;
}

export function applyAttackMotion(fighter) {
  const model = fighter?.model;
  const joints = model?.userData;
  if (!model || !joints?.torso) return false;
  const attack = fighter.attackQueue?.[0] || null;

  // The base pose must belong to the body currently mounted. A fighter's model is replaced when the
  // procedural startup body is upgraded to its prefab/GLB, and caching the base once per fighter
  // kept the OLD bones in `attackMotionBase`: every attack then posed orphaned geometry, reported a
  // pose id, and changed nothing on the rendered skeleton (measured: 0.0000 max quaternion delta
  // across all eight moves). Re-capture whenever the model instance changes.
  if (!fighter.attackMotionBase || fighter.attackMotionModel !== model) {
    fighter.attackMotionModel = model;
    const base = {};
    for (const key of ['torso', 'pelvis', 'head', 'rightArm', 'leftArm', 'rightFore', 'leftFore', 'rightLeg', 'leftLeg', 'rightShin', 'leftShin']) {
      const bone = joints[key];
      if (bone?.rotation) base[key] = { bone, rotation: bone.rotation.clone() };
    }
    fighter.attackMotionBase = base;
  }

  if (!attack) {
    if (fighter.attackMotionPose) {
      for (const key of Object.keys(fighter.attackMotionBase)) {
        const entry = fighter.attackMotionBase[key];
        entry.bone.rotation.copy(entry.rotation);
      }
      fighter.attackMotionPose = null;
    }
    return false;
  }

  const total = Number(attack.total ?? attack.duration ?? .3) || .3;
  const progress = clamp01((Number(attack.t) || 0) / total);
  const kind = motionKindFor(attack, fighter);
  if (!kind) {
    // Fail visibly: restore the rest pose and record the hole instead of animating the wrong move.
    recordMotionMiss(fighter, attack.id || attack.kind, motionSetFor(fighter));
    for (const key of Object.keys(fighter.attackMotionBase)) {
      const entry = fighter.attackMotionBase[key];
      entry.bone.rotation.copy(entry.rotation);
    }
    fighter.attackMotionPose = null;
    return null;
  }
  const pose = sampleMotion(kind, progress, motionSetFor(fighter).motions);
  for (const key of Object.keys(fighter.attackMotionBase)) {
    const entry = fighter.attackMotionBase[key];
    const delta = pose[key] || [0, 0, 0];
    entry.bone.rotation.set(entry.rotation.x + delta[0], entry.rotation.y + delta[1], entry.rotation.z + delta[2]);
  }
  fighter.attackMotionPose = kind;
  return kind;
}

export function attackMotionReport(fighter) {
  const set = motionSetFor(fighter);
  return {
    base: Boolean(fighter?.attackMotionBase),
    pose: fighter?.attackMotionPose || null,
    attack: fighter?.attackQueue?.[0]?.kind || null,
    moveId: fighter?.attackQueue?.[0]?.id || null,
    set: set.id,
    slots: Object.keys(set.motions).length
  };
}
