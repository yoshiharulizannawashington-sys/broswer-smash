// Shared flight locomotion for the flying roster.
//
// Gameplay already owns the physics in combat/flight.js. This module owns the part between that
// physics and a body: which flight phase is being flown, which clip should express it, how far the
// body banks, and how takeoff/landing transitions hand back to the ordinary grounded states.
//
// Two animation owners consume the same plan:
//   - human_fighter.js selects Goku's baked Goku_Fly* actions, and the iron_fly* supplement for
//     Iron Man, from `action`.
//   - animation_controller.js selects the generic or thruster clip family from `clip` for a
//     procedural/imported body that has no baked flight actions of its own.
// Presentation is applied after either owner has written the pose, so the plan is one source of
// truth and neither path needs a second controller.
import * as THREE from 'three';
import { flightFor } from '../combat/flight.js';

export const FLIGHT_LOCOMOTION_VERSION = 'browser-smash-flight-locomotion-v1-20261123';

const TAKEOFF_SECONDS = 0.55;
const LANDING_SECONDS = 0.62;
const HOVER_SPEED = 1.25;
const TURN_RATE = 1.35;
const MAX_BANK = 0.62;
const MAX_PITCH = 0.34;
const IRON_MAN = 'iron_man_tony_stark';

const stateByFighter = new WeakMap();

// Per-phase clip choices. The generic set exists for the whole roster; the thruster set is Iron
// Man's authored supplement and is used only when the body actually has those clips.
const GENERIC_CLIPS = Object.freeze({
  takeoff: 'fly_start',
  hover: 'fly_loop',
  forward: 'fly_loop',
  back: 'fly_loop',
  strafe_left: 'fly_loop',
  strafe_right: 'fly_loop',
  ascend: 'fly_loop',
  descend: 'fly_loop',
  turn: 'fly_turn',
  boost: 'fly_boost',
  landing: 'fly_land'
});
const THRUSTER_CLIPS = Object.freeze({
  takeoff: 'iron_fly_start',
  hover: 'iron_fly_loop',
  forward: 'iron_fly_loop',
  back: 'iron_fly_loop',
  strafe_left: 'iron_fly_loop',
  strafe_right: 'iron_fly_loop',
  ascend: 'iron_fly_climb',
  descend: 'iron_fly_dive',
  turn: 'iron_fly_turn',
  boost: 'iron_fly_boost',
  landing: 'iron_fly_land'
});
const GENERIC_FALLBACKS = Object.freeze({
  takeoff: 'fly_start',
  hover: 'fly_loop',
  forward: 'fly_loop',
  back: 'fly_loop',
  strafe_left: 'fly_loop',
  strafe_right: 'fly_loop',
  ascend: 'fly_loop',
  descend: 'fly_loop',
  turn: 'fly_turn',
  boost: 'fly_boost',
  landing: 'fly_land'
});

// Goku's baked clips are named actions, not library ids. Each phase names the action the legacy
// selector should prefer; `fallbackAction` is the old hover/forward pair so a body that only has
// those slots still flies.
const LEGACY_ACTIONS = Object.freeze({
  takeoff: 'flyTakeoffAction',
  hover: 'hoverAction',
  forward: 'flyForwardAction',
  back: 'flyBackAction',
  strafe_left: 'flyForwardAction',
  strafe_right: 'flyForwardAction',
  ascend: 'flyForwardAction',
  descend: 'flyForwardAction',
  turn: 'flyTurnAction',
  boost: 'flyForwardAction',
  landing: 'flyLandAction'
});
// Iron Man's supplied pack has fly/hover but no takeoff, bank, climb, dive, boost or flight-landing
// clips. The library supplement binds those authored actions into the same mixer; these targets
// are read by the legacy selector exactly like the Goku slots above.
const THRUSTER_ACTIONS = Object.freeze({
  takeoff: 'flyTakeoffAction',
  hover: 'flyLoopAction',
  forward: 'flyLoopAction',
  back: 'flyBackAction',
  strafe_left: 'flyLoopAction',
  strafe_right: 'flyLoopAction',
  ascend: 'flyClimbAction',
  descend: 'flyDiveAction',
  turn: 'flyTurnAction',
  boost: 'flyBoostAction',
  landing: 'flyLandAction'
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrapAngle = value => {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
};
const damp = (current, target, lambda, dt) => current + (target - current) * (1 - Math.exp(-lambda * Math.max(0, dt)));

function stateFor(fighter) {
  let state = stateByFighter.get(fighter);
  if (!state) {
    state = {
      wasFlying: false,
      takeoff: 0,
      landing: 0,
      groundedLanding: false,
      heading: null,
      turnRate: 0,
      bank: 0,
      pitch: 0,
      phase: null
    };
    stateByFighter.set(fighter, state);
  }
  return state;
}

/** Clear cached flight presentation state when a fighter is reset or its body is replaced. */
export function resetFlightLocomotion(fighter) {
  if (fighter) stateByFighter.delete(fighter);
}

function headingOf(fighter) {
  const x = Number(fighter?.facing);
  const z = Number(fighter?.facingZ);
  if (Number.isFinite(x) && Number.isFinite(z) && (Math.abs(x) + Math.abs(z)) > 1e-6) {
    return Math.atan2(x, z);
  }
  const yaw = Number(fighter?.model?.rotation?.y ?? fighter?.rotation?.y);
  return Number.isFinite(yaw) ? yaw : 0;
}

function phaseFor(fighter, state, speed, forwardSpeed, lateralSpeed, verticalSpeed, profile) {
  if (!fighter?.flightMode) {
    // A controlled descent disengages flight on the touchdown frame, so that one transition is
    // allowed to show its flight-landing clip on the ground. A landing that was already airborne
    // hands over to the ordinary ground land clip as soon as contact is made.
    if (fighter?.isGrounded && !state.groundedLanding) state.landing = 0;
    return state.landing > 0 ? 'landing' : null;
  }
  if (state.takeoff > 0) return 'takeoff';
  if (state.turnRate > TURN_RATE && speed > 1.5) return 'turn';
  if (Math.abs(lateralSpeed) > Math.max(1.1, speed * 0.5) && Math.abs(lateralSpeed) > Math.abs(forwardSpeed)) {
    return lateralSpeed > 0 ? 'strafe_right' : 'strafe_left';
  }
  if (forwardSpeed < -1.1 && Math.abs(forwardSpeed) > Math.abs(lateralSpeed)) return 'back';
  if (verticalSpeed > 0.65 && Math.abs(verticalSpeed) > Math.abs(forwardSpeed) * 0.8) return 'ascend';
  if (verticalSpeed < -0.65 && Math.abs(verticalSpeed) > Math.abs(forwardSpeed) * 0.8) return 'descend';
  if (speed < HOVER_SPEED && Math.abs(verticalSpeed) < 0.4) return 'hover';
  if (speed > profile.cruise * 1.08) return 'boost';
  return 'forward';
}

/**
 * Build the current flight plan. Pure read of the fighter plus a small per-fighter transition
 * cache; it never writes a bone. Call it from the clip selector and from the presentation layer.
 */
export function flightLocomotionFor(fighter, { dt = 1 / 60, speed = null, turnRate = null } = {}) {
  if (!fighter) return null;
  const state = stateFor(fighter);
  const flying = Boolean(fighter.flightMode);

  // A toggled flight mode is a transition, not a speed change. The timers live here so both the
  // legacy selector and the controller see the same takeoff/landing window on the same frame.
  if (flying && !state.wasFlying) {
    state.takeoff = TAKEOFF_SECONDS;
    state.landing = 0;
    state.groundedLanding = false;
  } else if (!flying && state.wasFlying) {
    state.landing = LANDING_SECONDS;
    state.takeoff = 0;
    state.groundedLanding = Boolean(fighter.isGrounded);
  }
  state.wasFlying = flying;

  const velocity = fighter.velocity || {};
  const horizontalSpeed = speed == null
    ? Math.hypot(Number(velocity.x) || 0, Number(velocity.z) || 0)
    : Number(speed) || 0;
  const verticalSpeed = Number(velocity.y) || 0;
  const fx = Number(fighter.facing) || 0;
  const fz = Number(fighter.facingZ) || 0;
  const magnitude = Math.hypot(fx, fz);
  const nx = magnitude > 1e-6 ? fx / magnitude : 0;
  const nz = magnitude > 1e-6 ? fz / magnitude : 0;
  const forwardSpeed = (Number(velocity.x) || 0) * nx + (Number(velocity.z) || 0) * nz;
  const lateralSpeed = (Number(velocity.x) || 0) * nz - (Number(velocity.z) || 0) * nx;
  const profile = flightFor(fighter);

  // A controller already measures its own smoothed heading rate; legacy bodies use the facing
  // delta measured here. Both end up signed, because the bank has to flip sides.
  const heading = headingOf(fighter);
  if (state.heading == null) state.heading = heading;
  const headingRate = turnRate == null
    ? (dt > 1e-5 ? wrapAngle(heading - state.heading) / dt : 0)
    : Number(turnRate) || 0;
  state.heading = heading;
  state.turnRate = damp(state.turnRate, headingRate, 12, dt);

  const phase = phaseFor(fighter, state, horizontalSpeed, forwardSpeed, lateralSpeed, verticalSpeed, profile);
  if (!phase) {
    state.phase = null;
    state.groundedLanding = false;
    state.bank = 0;
    state.pitch = 0;
    return null;
  }
  const thruster = String(fighter.identityKey || '').toLowerCase() === IRON_MAN;
  const clipSet = thruster ? THRUSTER_CLIPS : GENERIC_CLIPS;
  const clip = clipSet[phase] || GENERIC_CLIPS[phase];
  const clipFallback = GENERIC_FALLBACKS[phase] || 'fly_loop';
  const actions = thruster ? THRUSTER_ACTIONS : LEGACY_ACTIONS;
  const action = actions[phase] || 'flyAction';

  // Bank and pitch are targets; presentation smooths them so a one-frame heading jitter cannot
  // snap the torso. Bank follows a turn or a strafe, pitch follows climb/dive and boost.
  let bankTarget = clamp(state.turnRate * 0.13, -MAX_BANK, MAX_BANK);
  if (phase === 'strafe_left' || phase === 'strafe_right') {
    const strafeSign = phase === 'strafe_left' ? 1 : -1;
    bankTarget = clamp(bankTarget + strafeSign * clamp(Math.abs(lateralSpeed) * 0.028, 0.08, 0.3), -MAX_BANK, MAX_BANK);
  }
  if (!flying || phase === 'takeoff' || phase === 'landing') bankTarget = 0;
  let pitchTarget = 0;
  if (phase === 'ascend') pitchTarget = -0.2;
  else if (phase === 'descend') pitchTarget = 0.26;
  else if (phase === 'boost') pitchTarget = 0.18 + clamp(horizontalSpeed / Math.max(1, profile.boost), 0, 1) * 0.08;
  else if (phase === 'back') pitchTarget = -0.1;
  else if (phase === 'takeoff') pitchTarget = -0.12;
  if (!flying) pitchTarget = 0;
  state.bank = damp(state.bank, bankTarget, 8, dt);
  state.pitch = damp(state.pitch, clamp(pitchTarget, -MAX_PITCH, MAX_PITCH), 7, dt);
  state.phase = phase;

  const timeScale = phase === 'boost' ? 1.28
    : phase === 'turn' ? 1.12
      : phase === 'hover' ? 0.92
        : 1;

  return {
    version: FLIGHT_LOCOMOTION_VERSION,
    phase,
    body: thruster ? 'iron_man' : String(fighter.identityKey || '').toLowerCase() === 'goku' ? 'goku' : 'roster',
    style: thruster ? 'thruster' : 'authored',
    clip,
    clipFallback,
    action,
    fallbackAction: 'flyAction',
    bank: state.bank,
    bankTarget,
    pitch: state.pitch,
    pitchTarget,
    timeScale,
    boost: phase === 'boost' || horizontalSpeed > profile.cruise * 1.08,
    hover: phase === 'hover',
    strafe: phase === 'strafe_left' || phase === 'strafe_right' ? Math.sign(lateralSpeed) : 0,
    speed: horizontalSpeed,
    forwardSpeed,
    lateralSpeed,
    verticalSpeed,
    takeoffTimer: state.takeoff,
    landingTimer: state.landing,
    flying,
    turnRate: state.turnRate
  };
}

/** Advance transition timers once per frame, after the clip selector has read the plan. */
export function advanceFlightLocomotion(fighter, dt = 1 / 60) {
  if (!fighter) return null;
  const state = stateFor(fighter);
  const step = Math.max(0, Number(dt) || 0);
  state.takeoff = Math.max(0, state.takeoff - step);
  state.landing = Math.max(0, state.landing - step);
  return state;
}

/** Last plan, for a light read-only probe that does not create transition state. */
export function flightLocomotionState(fighter) {
  return stateByFighter.get(fighter) || null;
}

// A quaternion offset on top of the pose the mixer already wrote. It never resets the joint, so a
// baked landing or a controller clip keeps its own limb shape.
const _offsetEuler = new THREE.Euler();
const _offsetQuat = new THREE.Quaternion();
function addLocal(bone, x, y, z) {
  if (!bone) return;
  _offsetEuler.set(x, y, z, 'XYZ');
  _offsetQuat.setFromEuler(_offsetEuler);
  bone.quaternion.multiply(_offsetQuat);
  bone.updateMatrixWorld?.(false);
}

/**
 * Apply the body presentation after an animation owner's final pose write.
 *
 * Goku keeps his authored arms and legs; only the shared bank/pitch is added. Iron Man's thruster
 * silhouette lives in the `iron_fly_*` clips, so his overlay is deliberately the same shared bank.
 * The function is idempotent for a frame because every owner rewrites the clip pose before this
 * runs, and it does nothing outside flight and the landing window.
 */
export function applyFlightLocomotionPose(fighter, { dt = 1 / 60, root = null } = {}) {
  const model = root || fighter?.model;
  if (!model) return null;
  // The selector already built this frame's plan. Reuse it instead of measuring the heading a
  // second time, which would damp a real turn toward zero before the bank is painted.
  const stamp = fighter?.t ?? 0;
  const cached = model.userData?.flightLocomotionStamp === stamp;
  const plan = cached ? model.userData?.flightLocomotion || null : flightLocomotionFor(fighter, { dt });
  if (!plan) {
    if (model.userData) model.userData.flightLocomotion = null;
    return null;
  }
  if (model.userData) {
    model.userData.flightLocomotion = plan;
    model.userData.flightLocomotionStamp = stamp;
  }

  // Hit reactions and guard breaks own their body language. The flight bank is body language,
  // not a gameplay force, so it must not soften a flinch that happens to occur mid-air.
  if ((fighter?.hitstun || 0) > 0 || (fighter?.guardBreak || 0) > 0) return plan;
  // The presentation is a visual addition, never a gameplay writer. Skipped when no rig is bound
  // yet, so a body still loading keeps the old pose until its controller exists.
  const rig = fighter?.animationController?.rig || model.userData?.animationRig || null;
  const joints = rig?.joints || model.userData;
  if (!joints?.torso && !joints?.pelvis) return plan;

  const weight = plan.flying ? 1 : clamp((plan.landingTimer || 0) / LANDING_SECONDS, 0, 1);
  if (weight <= 0) return plan;
  const bank = plan.bank * weight;
  const pitch = plan.pitch * weight;
  addLocal(joints.pelvis, pitch * 0.18, 0, bank * 0.22);
  addLocal(joints.torso, pitch * 0.42, 0, bank * 0.58);
  addLocal(joints.head, -pitch * 0.2, 0, bank * 0.12);
  // Runtime proof that the report reached a real skeleton, not just a state machine.
  plan.presentation = {
    applied: Boolean(joints.torso && joints.pelvis),
    weight: Number(weight.toFixed(3)),
    bank: Number(bank.toFixed(3)),
    pitch: Number(pitch.toFixed(3))
  };
  return plan;
}
