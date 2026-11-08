// Phase 29.8 — the lasso haul, as an authored body pose rather than a slide.
//
// Phase 29.7 gave Wonder Woman 0.27-0.30 m of root translation during a reel, which reads as her
// sliding forward while the target is dragged in. This module supplies the missing half: a planted
// stance, a backward weight shift and a two-handed draw, written as additive LOCAL rotations on the
// bones the game's own pose writer has just filled in.
//
// Why it restores a captured rest pose before writing, exactly like `ultimate_choreography.js`:
// the first attempt multiplied its delta onto whatever the game had written that frame, on the
// assumption that the pose writer rebuilds every joint every frame. It does not — while she is
// casting, several joints (torso, arms) are left alone by the idle path — so the multiplication
// COMPOUNDED frame after frame and wound her limbs through tens of degrees per second. The
// measurement caught it as ~90-180 degree joint differences between an overlay run and a no-overlay
// run of the identical simulation. Restoring a captured rest and writing a fixed delta is
// idempotent however many times per frame it is called, which is what makes it safe.
//
// The angles follow the calibration notes in `ultimate_choreography.js`, measured on the live body:
//   arm x -1.1  -> hand forward at chest height        arm x -1.9 -> hand overhead
//   arm z +1.4  -> arm abducted out to the side        thigh x -0.7 -> knee forward
//   thigh x +0.7 -> knee back                          torso x negative -> lean forward
//
// Gated on the Phase 29.7 pull experiment: with no flag, `applyHaulPose` writes nothing and the
// shipped game is byte-for-byte what it was.
import * as THREE from 'three';
import { jointsOf } from './ultimate_choreography.js';
import { grabContinuityTuning } from './experiments.js';

/** Seconds the pose eases out into her normal stance after the reel releases. */
export const HAUL_RELEASE = .22;
/** Tugs per second while the target is actually travelling inward. */
export const HAUL_TUG_HZ = 1.6;
/** Seconds the plant takes to take hold at the start of a reel. */
export const HAUL_ENTRY = .10;
/**
 * Maximum tug change per second. Above the tug sine's own peak rate (`PI * HAUL_TUG_HZ` = 5.0/s), so
 * normal tugging is untouched and only a jump is limited - which is what crosses the keep-distance
 * branch: the value used to step 0 -> 0.974 in one frame and swing the forearm 30.9 deg.
 */
export const TUG_RATE = 7.5;

/**
 * Braced plant: front foot forward with the knee loaded, back leg extended behind with the heel
 * down, both hands on the line and the shoulders square to it. Nothing here moves the root.
 */
const PLANT = Object.freeze({
  pelvis: [0.06, -0.16, 0], torso: [0.10, -0.22, 0.04], head: [0.02, 0.20, 0],
  leftClavicle: [-0.06, 0, 0.10], rightClavicle: [-0.10, 0, -0.06],
  leftArm: [-0.86, 0, 0.26], leftFore: [-0.22, 0, 0], leftHand: [0.10, 0, 0],
  rightArm: [-0.58, -0.14, -0.30], rightFore: [-0.90, 0, -0.10], rightHand: [0.06, 0, 0],
  leftLeg: [-0.34, 0, 0.10], leftShin: [0.44, 0, 0], leftFoot: [-0.12, 0, 0],
  rightLeg: [0.26, 0, -0.12], rightShin: [0.52, 0, 0], rightFoot: [0.10, 0, 0]
});

/**
 * The haul: weight sits back over the rear leg, the torso rotates away from the target, the lead
 * arm straightens as the line comes taut and the rear hand draws to the hip. The back knee loads
 * because the force is going through the ground, not through a slide.
 */
const HAUL = Object.freeze({
  pelvis: [0.12, -0.28, 0], torso: [0.30, -0.34, 0.06], head: [0.06, 0.26, 0],
  leftClavicle: [-0.04, 0, 0.16], rightClavicle: [-0.16, 0, -0.10],
  leftArm: [-0.62, 0.10, 0.34], leftFore: [-0.55, 0, 0.04], leftHand: [0.12, 0, 0],
  rightArm: [-0.30, -0.26, -0.52], rightFore: [-1.45, 0, -0.16], rightHand: [0.12, 0, 0],
  leftLeg: [-0.42, 0, 0.10], leftShin: [0.62, 0, 0], leftFoot: [-0.18, 0, 0],
  rightLeg: [0.18, 0, -0.12], rightShin: [0.70, 0, 0], rightFoot: [0.16, 0, 0]
});

const BONES = Object.freeze([...new Set([...Object.keys(PLANT), ...Object.keys(HAUL)])]);
const EULER = new THREE.Euler();
const DELTA = new THREE.Quaternion();

const lerp = (a, b, t) => a + (b - a) * t;
// Named clockMs, not now: applyHaulPose already binds `now` to the record's elapsed time.
const clockMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** The blended, eased pose for this frame: PLANT -> HAUL by the tug phase, then scaled by entry. */
export function haulPose(state) {
  const t = Math.max(0, Math.min(1, state.tug));
  const scale = Math.max(0, Math.min(1, state.intensity));
  const out = {};
  for (const bone of BONES) {
    const a = PLANT[bone] || [0, 0, 0];
    const b = HAUL[bone] || [0, 0, 0];
    out[bone] = [lerp(a[0], b[0], t) * scale, lerp(a[1], b[1], t) * scale, lerp(a[2], b[2], t) * scale];
  }
  return out;
}

function trace(record, state) {
  if (typeof window === 'undefined') return;
  const log = window.__browserSmashHaulTrace;
  if (!Array.isArray(log) || log.length > 6000) return;
  const joints = jointsOf(record.owner);
  log.push({
    t: +(Number(record.t) || 0).toFixed(3), beat: state.beat,
    intensity: +state.intensity.toFixed(3), tug: +state.tug.toFixed(3),
    torsoX: joints.torso ? +joints.torso.rotation.x.toFixed(3) : null,
    rightForeX: joints.rightFore ? +joints.rightFore.rotation.x.toFixed(3) : null,
    rootX: +Number(record.owner?.position?.x || 0).toFixed(3)
  });
}

/**
 * Write this frame's haul pose. Returns the number of joints touched, so the caller can tell an
 * active overlay (and remember to release it) from an inactive one. Nothing is written unless the
 * pull experiment is enabled for this caster.
 */
export function applyHaulPose(record, dt = 1 / 60) {
  if (!record) return 0;
  const tune = grabContinuityTuning(record);
  if (!tune?.pull) return 0; // opt-in only: default play keeps the shipped pose
  // Measurement switch: the pose hook runs from two call sites per frame (the simulation band and
  // the render loop), so an A/B of the overlay's contribution needs a way to suppress it while the
  // simulation stays identical.
  if (globalThis.window?.__browserSmashNoHaul) return 0;
  const state = record.__haul ||= { intensity: 0, tug: 0, beat: 'plant', lastReelAt: -Infinity,
    releasedAt: null, base: null, rampAt: -1, tugAt: -1 };
  const reel = record.target?.grabReel?.record === record ? record.target.grabReel : null;
  const now = Number(record.t) || 0;
  if (reel) {
    state.lastReelAt = now;
    state.releasedAt = null;
    // Both pose call sites run inside the same simulation frame. The ramp belongs to the FRAME, not to
    // the call: advancing it on both made HAUL_ENTRY complete in half the authored time (measured at
    // 0.3333 per frame instead of 0.1667, i.e. 17.3 deg of forearm in one frame).
    if (now !== state.rampAt) {
      state.intensity = Math.min(1, state.intensity + dt / HAUL_ENTRY);
      state.rampAt = now;
    }
    // The tug alternates only while the line is actually paying in; once the target is inside the
    // keep distance the pose holds the plant instead of sawing at a slack rope.
    const gap = record.owner && record.target
      ? Math.hypot(record.owner.position.x - record.target.position.x, record.owner.position.z - record.target.position.z)
      : Infinity;
    const tugTarget = gap > reel.keep + .06
      ? .5 + .5 * Math.sin(now * Math.PI * 2 * HAUL_TUG_HZ)
      : 0;
    // Rate-limited rather than assigned. Crossing the keep distance used to step the whole
    // PLANT -> HAUL delta in one frame; now the pose relaxes over a few frames instead. Guarded per
    // frame for the same reason as the ramp.
    if (now !== state.tugAt) {
      const step = TUG_RATE * dt;
      state.tug += Math.max(-step, Math.min(step, tugTarget - state.tug));
      state.tugAt = now;
    }
    state.beat = state.tug > .5 ? 'haul' : 'plant';
  } else {
    if (state.intensity <= 0 && !state.release) { state.beat = 'settle'; return 0; }
    // Hand-back. The old code restored the pose captured at entry, which is a stale frame of her body:
    // the game then snapped from it to wherever she actually is now, one frame after the record ended
    // (measured at 99.9 deg/tick on the lead arm). Instead, keep the orientation this overlay last wrote
    // and BLEND into whatever the game writes each frame, so the overlay rides the live animation out
    // instead of fighting it. Wall-clock timed because this hook runs more than once per frame.
    const nowMs = clockMs();
    if (!state.release) {
      const last = new Map();
      for (const [bone, joint] of Object.entries(jointsOf(record.owner))) {
        if (state.base?.has(bone)) last.set(bone, joint.quaternion.clone());
      }
      state.release = { at: nowMs, last };
      state.intensity = 1;
    }
    const strength = Math.max(0, 1 - (nowMs - state.release.at) / (HAUL_RELEASE * 1000));
    state.intensity = strength;
    state.tug = Math.max(0, state.tug - dt * 4);
    state.beat = 'settle';
    if (strength <= 0) { record.__haul = null; return 0; }
    const live = jointsOf(record.owner);
    let blended = 0;
    for (const [bone, quaternion] of state.release.last) {
      const joint = live[bone];
      if (!joint) continue;
      // `joint.quaternion` is what the game wrote this frame; ease away from the overlay pose toward it.
      joint.quaternion.slerp(quaternion, strength);
      blended++;
    }
    if (blended) trace(record, state);
    return blended;
  }
  const pose = haulPose(state);
  const joints = jointsOf(record.owner);
  state.base ||= new Map();
  let written = 0;
  for (const [bone, joint] of Object.entries(joints)) {
    const euler = pose[bone];
    // Leave every bone this pose does not name exactly as the game wrote it. Freezing them at the
    // entry frame killed her idle and made the hand-back a bigger correction than it needed to be.
    if (!euler) continue;
    // Capture once, then always write from that base: two call sites per frame pose her, and the
    // second one must produce the same orientation as the first, not twice the rotation.
    if (!state.base.has(bone)) state.base.set(bone, joint.quaternion.clone());
    joint.quaternion.copy(state.base.get(bone));
    EULER.set(euler[0], euler[1], euler[2], 'XYZ');
    DELTA.setFromEuler(EULER);
    joint.quaternion.multiply(DELTA);
    written++;
  }
  trace(record, state);
  return written;
}

/**
 * Drop the overlay state. Nothing is restored here on purpose: the hand-back blend has already eased
 * her body into the game's own pose, and restoring the entry frame at this point is what produced the
 * one-frame snap this phase exists to remove.
 */
export function releaseHaulPose(record) {
  // Nothing is restored here on purpose: the hand-back blend has already eased her body into the
  // game's own pose, and restoring the entry frame at this point is exactly what produced the
  // one-frame snap this phase exists to remove.
  if (record?.__haul) record.__haul = null;
  return 1;
}

/** Current overlay state, for audits and tests. */
export function haulStateFor(record) {
  const state = record?.__haul;
  if (!state) return { active: false, beat: 'idle', intensity: 0, tug: 0 };
  return { active: state.intensity > 0, beat: state.beat, intensity: +state.intensity.toFixed(3), tug: +state.tug.toFixed(3) };
}

export const HAUL_POSES = Object.freeze({ plant: PLANT, haul: HAUL });
