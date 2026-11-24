// Signature ultimate choreography: the per-beat body pose that makes an ultimate read as a MOVE
// rather than a buff.
//
// Why this is an overlay and not a clip: the roster bodies are 19-bone rigs whose animation comes
// from clip_library.js, and neither Goku nor Iron Man has a baked "Kamehameha" or "repulsor" clip.
// Authoring two new clips would mean re-exporting both models; instead this module writes additive
// LOCAL rotations onto the exact bones the clips already drive, every rendered frame, AFTER the
// animation controller has run. It restores the captured rest pose before writing, so it can never
// accumulate, and releases the rest pose when the cast ends.
//
// The angles are MEASURED, not guessed. A calibration pass on the live Goku body
// (`leftArm` rotated about each local axis, hand joint read in world space) gave:
//
//   arm x -1.1  ->  hand forward 0.33-0.57 m, hand height 1.50-1.56 m (head is 1.55 m)
//   arm x -1.9  ->  hand lifted to 1.88 m, i.e. overhead
//   arm z +1.4  ->  hand 0.75 m out to the side, 1.50 m up (abduction)
//   thigh x -0.7 -> knee 0.18 m forward;  thigh x +0.7 -> knee 0.26 m back
//
// So a Kamehameha firing line is arm x around -1.1 with the forearms nearly straight, and an
// overhead pose (the earlier, wrong reading) is -1.9. Legs step with negative x, knees bend with
// positive shin x.
import * as THREE from 'three';
import { sampleClipPose } from '../anim/clip_library.js';

const IDENTITY = new THREE.Quaternion();

/**
 * The authored, character-specific clip each identity performs for its ultimate.
 *
 * These are real keyframed sequences in the clip library (gather and cup the palms, thrust, sustain,
 * recover), and they are what the cinematic now plays. The static per-beat poses below stay as the
 * fallback for every identity without an authored move.
 */
const SIGNATURE_CLIP = Object.freeze({
  goku: 'goku_kamehameha',
  iron_man: 'iron_man_repulsor'
});

/** Where the authored clip's strike peak sits inside its own timeline (clip_library `peak`). */
const SIGNATURE_PEAK = 0.4;

/**
 * Map the ultimate's own clock onto the authored clip's timeline.
 *
 * The clip's peak (the thrust / palm discharge) is pinned to the moment the ultimate goes active, so
 * the discharge lands on the move's active window instead of drifting with the cinematic length.
 */
function cinematicClipFraction(record) {
  const total = Math.max(.001, Number(record.total) || 1);
  const startup = Math.min(total, Math.max(.001, Number(record.startup) || total * .4));
  const u = Math.min(1, Math.max(0, (Number(record.t) || 0) / total));
  const pivot = Math.min(1, startup / total);
  if (u <= pivot) return (u / pivot) * SIGNATURE_PEAK;
  return SIGNATURE_PEAK + ((u - pivot) / Math.max(1e-6, 1 - pivot)) * (1 - SIGNATURE_PEAK);
}

/**
 * The pose the cinematic writes this frame: the authored clip when the fighter has one, so hands,
 * shoulders and knees actually travel through the move, plus a small recoil while the beam is live.
 */
function cinematicPose(record, beat) {
  const key = choreographyKey(record?.owner);
  const clipId = key && SIGNATURE_CLIP[key];
  if (!clipId) return null;
  const sampled = sampleClipPose(clipId, cinematicClipFraction(record));
  if (!sampled) return null;
  if (record.phase === 'active') {
    // Recoil rides on top of the held firing pose: the body is pushed back by its own discharge
    // instead of freezing mid-beam. Small and quickly damped so it reads as force, not shivering.
    const firing = (Number(record.t) || 0) - (Number(record.startup) || 0);
    const decay = Math.exp(-firing * 2.2);
    const push = Math.sin(firing * 26) * .045 * decay + .05 * decay;
    const add = (bone, dx) => { if (sampled[bone]) sampled[bone] = [sampled[bone][0] + dx, sampled[bone][1], sampled[bone][2]]; };
    add('torso', push * .5);
    add('leftArm', push);
    add('rightArm', push);
    add('head', -push * .6);
  }
  return sampled;
}

/** Joints this module is allowed to touch, mapped to the rig's userData slot. */
const JOINT_SLOTS = Object.freeze({
  pelvis: 'pelvis', torso: 'torso', head: 'head',
  leftClavicle: 'leftClavicle', rightClavicle: 'rightClavicle',
  leftArm: 'leftArm', leftFore: 'leftFore', leftHand: 'leftHand',
  rightArm: 'rightArm', rightFore: 'rightFore', rightHand: 'rightHand',
  leftLeg: 'leftLeg', leftShin: 'leftShin', leftFoot: 'leftFoot',
  rightLeg: 'rightLeg', rightShin: 'rightShin', rightFoot: 'rightFoot'
});

const CHOREO = Object.freeze({
  goku: Object.freeze({
    // Squares up: weight settled, hands loose at chest height.
    intro: Object.freeze({
      pelvis: [0.05, 0.10, 0], torso: [-0.06, 0.16, 0], head: [-0.04, -0.12, 0],
      leftArm: [-0.38, 0, 0.26], leftFore: [-0.55, 0, 0.05],
      rightArm: [-0.42, 0, -0.26], rightFore: [-0.58, 0, -0.05],
      leftLeg: [-0.22, 0, 0.06], leftShin: [0.30, 0, 0],
      rightLeg: [0.12, 0, -0.06], rightShin: [0.18, 0, 0]
    }),
    // Knees bend, weight drops, both hands pull together beside the hip: the gathering stance.
    clash: Object.freeze({
      pelvis: [0.14, 0.28, 0], torso: [0.06, 0.44, 0], head: [0.14, -0.34, 0],
      leftArm: [-0.62, -0.20, -0.46], leftFore: [-1.46, 0, 0.16], leftHand: [-0.16, 0, 0.10],
      rightArm: [-0.70, 0.22, 0.54], rightFore: [-1.54, 0, -0.18], rightHand: [-0.16, 0, -0.10],
      leftLeg: [-0.42, 0, 0.10], leftShin: [0.62, 0, 0], leftFoot: [-0.20, 0, 0],
      rightLeg: [-0.26, 0, -0.10], rightShin: [0.50, 0, 0], rightFoot: [-0.14, 0, 0]
    }),
    // Both arms drive forward at chest height with the elbows nearly straight: the firing line.
    finisher: Object.freeze({
      pelvis: [-0.04, 0.10, 0], torso: [-0.14, 0.08, 0], head: [0.04, -0.05, 0],
      leftClavicle: [-0.10, 0, 0.06], rightClavicle: [-0.10, 0, -0.06],
      leftArm: [-1.12, 0.04, 0.10], leftFore: [-0.18, 0, 0], leftHand: [-0.04, 0, 0],
      rightArm: [-1.12, -0.04, -0.10], rightFore: [-0.20, 0, 0], rightHand: [-0.04, 0, 0],
      leftLeg: [-0.36, 0, 0.08], leftShin: [0.30, 0, 0],
      rightLeg: [0.28, 0, -0.08], rightShin: [0.22, 0, 0]
    }),
    // Beam out: hold the line, shoulders pushed back by the discharge.
    impact: Object.freeze({
      pelvis: [0, 0.08, 0], torso: [-0.05, 0.06, 0], head: [0.02, -0.03, 0],
      leftClavicle: [-0.08, 0, 0.05], rightClavicle: [-0.08, 0, -0.05],
      leftArm: [-1.00, 0.04, 0.12], leftFore: [-0.28, 0, 0],
      rightArm: [-1.00, -0.04, -0.12], rightFore: [-0.30, 0, 0],
      leftLeg: [-0.30, 0, 0.08], leftShin: [0.26, 0, 0],
      rightLeg: [0.24, 0, -0.08], rightShin: [0.20, 0, 0]
    }),
    // Settles back to a stable stance.
    recover: Object.freeze({
      pelvis: [0.03, 0.04, 0], torso: [0.02, 0.02, 0], head: [-0.02, 0, 0],
      leftArm: [-0.22, 0, 0.20], leftFore: [-0.36, 0, 0.04],
      rightArm: [-0.24, 0, -0.20], rightFore: [-0.38, 0, -0.04],
      leftLeg: [-0.10, 0, 0.05], rightLeg: [0.06, 0, -0.05]
    })
  }),
  iron_man: Object.freeze({
    // Thrusters on: upright torso, knees tucked into a hover, arms slightly back.
    intro: Object.freeze({
      pelvis: [0.08, 0, 0], torso: [-0.10, 0, 0], head: [-0.05, 0, 0],
      leftArm: [0.18, 0, 0.30], leftFore: [-0.32, 0, 0.06],
      rightArm: [0.18, 0, -0.30], rightFore: [-0.32, 0, -0.06],
      leftLeg: [-0.50, 0, 0.10], leftShin: [0.80, 0, 0], leftFoot: [0.14, 0, 0],
      rightLeg: [-0.42, 0, -0.10], rightShin: [0.74, 0, 0], rightFoot: [0.12, 0, 0]
    }),
    // Turns to the target and swings both arms up and out into the firing line.
    clash: Object.freeze({
      pelvis: [0.06, 0.16, 0], torso: [-0.04, 0.20, 0], head: [-0.03, -0.14, 0],
      leftClavicle: [-0.08, 0, 0.08], rightClavicle: [-0.08, 0, -0.08],
      leftArm: [-0.42, 0.06, 0.86], leftFore: [-0.50, 0, 0.10],
      rightArm: [-0.42, -0.06, -0.86], rightFore: [-0.50, 0, -0.10],
      leftLeg: [-0.48, 0, 0.10], leftShin: [0.78, 0, 0],
      rightLeg: [-0.40, 0, -0.10], rightShin: [0.72, 0, 0]
    }),
    // Both palms face the opponent at chest height, elbows unlocked.
    finisher: Object.freeze({
      pelvis: [0.04, 0.10, 0], torso: [-0.08, 0.12, 0], head: [-0.02, -0.09, 0],
      leftClavicle: [-0.10, 0, 0.05], rightClavicle: [-0.10, 0, -0.05],
      leftArm: [-1.05, 0.08, 0.36], leftFore: [-0.24, 0, 0.04], leftHand: [0.08, 0, 0.05],
      rightArm: [-1.05, -0.08, -0.36], rightFore: [-0.24, 0, -0.04], rightHand: [0.08, 0, -0.05],
      leftLeg: [-0.52, 0, 0.10], leftShin: [0.80, 0, 0],
      rightLeg: [-0.42, 0, -0.10], rightShin: [0.72, 0, 0]
    }),
    // Repulsors discharging: palms held, shoulders rocked back.
    impact: Object.freeze({
      pelvis: [0.06, 0.08, 0], torso: [-0.03, 0.10, 0], head: [0, -0.07, 0],
      leftClavicle: [-0.07, 0, 0.04], rightClavicle: [-0.07, 0, -0.04],
      leftArm: [-0.95, 0.07, 0.40], leftFore: [-0.18, 0, 0.04], leftHand: [0.05, 0, 0.05],
      rightArm: [-0.95, -0.07, -0.40], rightFore: [-0.18, 0, -0.04], rightHand: [0.05, 0, -0.05],
      leftLeg: [-0.48, 0, 0.10], leftShin: [0.76, 0, 0],
      rightLeg: [-0.38, 0, -0.10], rightShin: [0.68, 0, 0]
    }),
    // Arms lower, legs extend, the flight posture lets go.
    recover: Object.freeze({
      pelvis: [0.03, 0.04, 0], torso: [-0.02, 0.04, 0],
      leftArm: [-0.12, 0, 0.22], leftFore: [-0.42, 0, 0.04],
      rightArm: [-0.12, 0, -0.22], rightFore: [-0.42, 0, -0.04],
      leftLeg: [-0.18, 0, 0.06], leftShin: [0.30, 0, 0],
      rightLeg: [-0.12, 0, -0.06], rightShin: [0.24, 0, 0]
    })
  })
});

/** Identity key for a fighter, matching the ultimate runner's own normalisation. */
export function choreographyKey(owner) {
  const id = String(owner?.identityKey || owner?.identity || '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
  if (id.includes('goku')) return 'goku';
  if (id.includes('ironman')) return 'iron_man';
  return null;
}

/** Pose data for an owner, or null when this fighter has no authored choreography. */
export function choreographyFor(owner) {
  const key = choreographyKey(owner);
  return key ? CHOREO[key] : null;
}

/** The joints an owner's body actually exposes, keyed by the names used above. */
export function jointsOf(owner) {
  const userData = owner?.model?.userData || {};
  const out = {};
  for (const [name, slot] of Object.entries(JOINT_SLOTS)) {
    const joint = userData[slot];
    if (joint?.quaternion) out[name] = joint;
  }
  return out;
}

/**
 * Write one beat's pose onto the body, as an additive local rotation on top of the clip pose.
 *
 * The rest quaternion is captured the first time a record is posed and restored before every
 * write, so repeated calls are idempotent and the overlay cannot accumulate. `blend` eases a beat
 * in over its first ~0.1 s so beats do not snap. Returns the number of joints written.
 */
export function applyChoreography(record, beat, blend = 1) {
  const owner = record?.owner;
  const pose = choreographyFor(owner);
  if (!pose) return 0;
  const offsets = cinematicPose(record, beat) || pose[beat] || pose.intro;
  const joints = jointsOf(owner);
  // A fighter with an authored motion set drives this cinematic from that set: the beat poses still
  // select timing and camera, but the body follows the character's own ultimate motion. Fighters
  // without a set keep the authored choreography exactly as before.
  const identity = owner?.identityKey || owner?.identity || '';
  const total = Math.max(.05, (Number(record?.startup) || 0) + (Number(record?.active) || 0) + (Number(record?.recover) || .4));
  const progress = Math.min(1, Math.max(0, (Number(record?.t) || 0) / total));
  const authored = typeof window !== 'undefined' && window.__browserSmashSampleMotion
    ? window.__browserSmashSampleMotion(identity, 'ultimate', progress)
    : null;
  record.__cinematicPose ||= new Map();
  let written = 0;
  for (const [name, joint] of Object.entries(joints)) {
    const rest = record.__cinematicPose.get(name) || joint.quaternion.clone();
    if (!record.__cinematicPose.has(name)) record.__cinematicPose.set(name, rest);
    // Start from the clip's pose every frame, then layer this beat on top.
    joint.quaternion.copy(rest);
    const euler = authored?.[name] || offsets[name];
    if (!euler) continue;
    const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(euler[0], euler[1], euler[2], 'XYZ'));
    const delta = new THREE.Quaternion().slerpQuaternions(IDENTITY, target, Math.max(0, Math.min(1, blend)));
    joint.quaternion.multiply(delta);
    written++;
  }
  record.__cinematicPoseBeat = beat;
  record.__cinematicMotionSource = authored ? 'authored-set' : 'choreography';
  // Diagnostics for capture probes: which pose source the cinematic is driving right now.
  if (typeof window !== 'undefined') window.__browserSmashCinematicPoseSource = record.__cinematicMotionSource;
  return written;
}

/** Hand the body back to the animation controller. Safe to call more than once. */
export function releaseChoreography(record) {
  const joints = jointsOf(record?.owner);
  let restored = 0;
  if (record?.__cinematicPose) {
    for (const [name, quaternion] of record.__cinematicPose) {
      const joint = joints[name];
      if (!joint) continue;
      joint.quaternion.copy(quaternion);
      restored++;
    }
    record.__cinematicPose = null;
    record.__cinematicPoseBeat = null;
  }
  return restored;
}

/**
 * Which authored beat an ultimate record is in, derived from its own phase clock rather than the
 * presentation director, so the pose is defined even when the cinematic is not running.
 */
export function beatForRecord(record) {
  if (!record) return 'recover';
  const t = Number(record.t) || 0;
  const startup = Number(record.startup) || 0;
  const active = Number(record.active) || 0;
  if (record.phase === 'startup') return t < startup * .45 ? 'intro' : 'clash';
  if (record.phase === 'active') return t < startup + active * .55 ? 'finisher' : 'impact';
  return 'recover';
}

/** True when this owner has choreography at all (used by tests and the asset report). */
export function hasChoreography(owner) {
  return Boolean(choreographyFor(owner));
}
