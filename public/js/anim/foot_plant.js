// Ground-contact presentation layer.
//
// Gameplay movement owns the fighter root: this module never writes velocity, position or facing.
// It runs after the mixer has written the pose and adds three small presentation corrections:
//
//   1. Two-bone leg IK that holds a stance ankle at the world point where it touched down. The
//      clip can keep swinging through its cycle while the root travels; the planted foot does not
//      slide with it.
//   2. Input-driven start steps and stop braces, a turn-in-place pivot that anchors one foot and
//      swings the other, and a two-foot landing replant, all applied before the IK so the feet are
//      solved against the final pelvis pose.
//   3. A per-rig locomotion report for the browser probes (contact feet, slide, cadence).
//
// It is deliberately conservative: a rig without both hip/knee/ankle chains, an airborne or
// action state, or a foot that is not near the floor simply receives no correction.
import * as THREE from 'three';
import { calibrationFor, footPlacementFor } from './rig_calibration.js';
import { FOOT_ACCEPTANCE_ACCEPTED } from './foot_acceptance_data.js';
import { groundHeightAt } from '../world/arena_layouts.js';

const LOCOMOTION = /idle|stand|walk|run|sprint|turn|stop|land|locomotion/i;
const NON_LOCOMOTION = /attack|hit|block|guard|jump|fall|fly|air|dodge|knock|throw|swing|victory|defeat|(?:^|[_\s])ko(?:$|[_\s])|get.?up|dead|cast|special|form|web|flip|stagger|stun|grapple|launch/i;
const FEET = [
  { side: 'left', hip: 'leftLeg', knee: 'leftShin', ankle: 'leftFoot' },
  { side: 'right', hip: 'rightLeg', knee: 'rightShin', ankle: 'rightFoot' }
];
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _f = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _target = new THREE.Vector3();
const _knee = new THREE.Vector3();
const _g = new THREE.Vector3();
const _h = new THREE.Vector3();
const _hip = new THREE.Vector3();
const _qParent = new THREE.Quaternion();
const _qDesired = new THREE.Quaternion();
const _qFoot = new THREE.Quaternion();
const _qWorld = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

const states = new WeakMap();
// Every grounded body reads its own measured contact height and thresholds, but only identities
// that passed the live grounded-locomotion sweep enroll in the foot layer. A rejected or
// unmeasured rig keeps its authored clip feet. The pilot switch is only the before/after capture
// bypass; normal play uses the acceptance gate.
let pilotEnabled = true;
// The roster sweep must be able to remeasure a rig the current table rejects. This is a probe-only
// bypass, not a gameplay option; the shipped default is the table gate.
let acceptanceEnabled = true;

function fighterKey(fighter) {
  return String(fighter?.identityKey || fighter?.identity || fighter?.name || '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function footAccepted(fighter) {
  if (!acceptanceEnabled) return true;
  return FOOT_ACCEPTANCE_ACCEPTED.includes(fighterKey(fighter));
}

/** Probe-only bypass used by the grounded-locomotion sweep. */
export function setFootAcceptanceEnabled(enabled = true) {
  acceptanceEnabled = Boolean(enabled);
  return acceptanceEnabled;
}

/** Test/authoring bypass used by the before/after capture. */
export function setLocomotionPilotEnabled(enabled = true) {
  pilotEnabled = Boolean(enabled);
  return pilotEnabled;
}

export function locomotionPilotEnabled() {
  return pilotEnabled;
}

function joint(root, fighter, key) {
  return root?.userData?.[key]
    || fighter?.animationController?.rig?.joints?.[key]
    || root?.userData?.animationRig?.joints?.[key]
    || root?.userData?.skeleton?.joints?.[key]
    || null;
}

function measure(root, fighter) {
  const chains = [];
  let total = 0;
  let count = 0;
  for (const spec of FEET) {
    const hip = joint(root, fighter, spec.hip);
    const knee = joint(root, fighter, spec.knee);
    const ankle = joint(root, fighter, spec.ankle);
    if (!hip || !knee || !ankle || !hip.parent || !knee.parent) {
      return { chains: [], legLength: 0 };
    }
    const a = hip.getWorldPosition(_a).distanceTo(knee.getWorldPosition(_b));
    const b = knee.getWorldPosition(_b).distanceTo(ankle.getWorldPosition(_c));
    if (!(a > 0.03) || !(b > 0.03)) return { chains: [], legLength: 0 };
    chains.push({
      ...spec, hip, knee, ankle, upper: a, lower: b, reach: (a + b) * 0.98,
      baseUpper: a, baseLower: b, baseReach: (a + b) * 0.98
    });
    total += a + b;
    count++;
  }
  return { chains, legLength: count ? total / count : 0, baseLegLength: count ? total / count : 0 };
}

/** Use the rig's measured limb lengths as the authoritative foot/cadence scale. */
function applyCalibration(rig, calibration) {
  if (rig.calibration === calibration && rig.foot) return;
  const legReach = calibration?.leg?.reach;
  const base = rig.baseLegLength || rig.legLength;
  if (legReach > 0.05 && base > 0.05) {
    const ratio = legReach / base;
    for (const chain of rig.chains) {
      chain.upper = (chain.baseUpper || chain.upper) * ratio;
      chain.lower = (chain.baseLower || chain.lower) * ratio;
      chain.reach = (chain.baseReach || chain.reach) * ratio;
    }
    rig.legLength = legReach;
  }
  rig.calibration = calibration;
  rig.foot = footPlacementFor(calibration);
}

function footState() {
  return {
    target: null, targetReason: null, holdTarget: false, residual: null,
    weight: 0, cooldown: 0, age: 0, wasY: null, reason: null
  };
}

function stateFor(root, fighter) {
  let state = states.get(root);
  if (state) return state;
  const rig = measure(root, fighter);
  applyCalibration(rig, calibrationFor(root, fighter?.animationController?.rig, fighterKey(fighter)));
  state = {
    rig,
    feet: { left: footState(), right: footState() },
    start: 0,
    stop: 0,
    startTimer: 0,
    stopTimer: 0,
    startStepSide: null,
    startStepTarget: null,
    stopTargets: null,
    stopFront: null,
    land: 0,
    landingReplantTimer: 0,
    pivot: 0,
    pivotTimer: 0,
    pivotSide: null,
    pivotStepSide: null,
    pivotAnchor: null,
    pivotStepTarget: null,
    pivotStepTimer: 0,
    turnDir: 0,
    lastHeading: null,
    lastClip: '',
    lastGrounded: true,
    lastInputMoving: false,
    lastMoveX: 0,
    lastMoveZ: 0
  };
  states.set(root, state);
  return state;
}

/** Rotate `bone` so its child points at `target`, without creating a new object per frame. */
function aimBoneAt(bone, child, target, weight = 1) {
  if (!bone || !child || weight <= 0.001 || !bone.parent) return;
  bone.updateWorldMatrix(true, false);
  child.updateWorldMatrix(true, false);
  const origin = bone.getWorldPosition(_a);
  const from = child.getWorldPosition(_b).sub(origin);
  const to = _c.copy(target).sub(origin);
  if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
  from.normalize();
  to.normalize();
  const delta = _q.setFromUnitVectors(from, to);
  const world = bone.getWorldQuaternion(_qp);
  const parentWorld = bone.parent.getWorldQuaternion(_qParent);
  const desiredLocal = _qDesired.copy(parentWorld).invert().multiply(delta.multiply(world));
  bone.quaternion.slerp(desiredLocal, Math.min(1, weight));
  bone.updateWorldMatrix(true, true);
}

/** Solve one leg toward a world-space ankle target; returns the residual (or false when unusable). */
function solveLeg(chain, target, weight) {
  if (!chain || !target) return false;
  const hip = chain.hip;
  const knee = chain.knee;
  const ankle = chain.ankle;
  hip.updateWorldMatrix(true, false);
  const hipPos = hip.getWorldPosition(_d);
  const toTarget = _e.copy(target).sub(hipPos);
  const distance = toTarget.length();
  if (!(distance > 1e-4)) return false;
  const reach = chain.reach;
  const clamped = Math.min(distance, reach);
  const dir = toTarget.normalize();
  const kneePos = knee.getWorldPosition(_f).sub(hipPos);
  // Keep the current knee bend plane. If the knee is nearly straight, pick the fighter's forward
  // axis as the pole so the leg bends forward rather than collapsing to an arbitrary side.
  const along = kneePos.dot(dir);
  const pole = _g.copy(kneePos).addScaledVector(dir, -along);
  if (pole.lengthSq() < 1e-8) {
    const forward = _h.set(0, 0, 1).applyQuaternion(hip.getWorldQuaternion(_q));
    pole.copy(forward).addScaledVector(dir, -forward.dot(dir));
  }
  if (pole.lengthSq() < 1e-8) pole.set(0, 0, 1);
  pole.normalize();
  const a = (chain.upper * chain.upper - chain.lower * chain.lower + clamped * clamped) / (2 * clamped);
  const h = Math.sqrt(Math.max(0, chain.upper * chain.upper - a * a));
  _knee.copy(hipPos).addScaledVector(dir, a).addScaledVector(pole, h);
  _target.copy(hipPos).addScaledVector(dir, clamped);
  aimBoneAt(hip, knee, _knee, weight);
  aimBoneAt(knee, ankle, _target, weight);
  // The clamp above can make the requested world point unreachable. Report the residual after the
  // write so the caller can release a foot instead of stretching the leg toward a stale plant.
  ankle.updateWorldMatrix(true, false);
  return ankle.getWorldPosition(_a).distanceTo(target);
}

function release(foot, reason = 'state') {
  foot.target = null;
  foot.holdTarget = false;
  foot.cooldown = 0.07;
  foot.age = 0;
  foot.reason = reason;
  foot.targetReason = null;
  foot.residual = null;
}

function groundTarget(point, ground, contactHeight) {
  return new THREE.Vector3(point.x, ground + contactHeight, point.z);
}

/** The physical feet plane under this fighter, not a single arena-wide constant. */
function rootGroundFor(fighter) {
  const positionY = Number(fighter?.position?.y);
  if (Number.isFinite(positionY)) return positionY;
  const groundLevel = Number(fighter?.groundLevel);
  return Number.isFinite(groundLevel) ? groundLevel : 0;
}

/**
 * Resolve the walkable surface at one foot/target column. The root height is the feasibility
 * limit: an upper deck is only sampled when it is within one step of the body, while slopes and
 * terrain are sampled by the layout's own height function. A layout-free body keeps the root
 * height so synthetic/test rigs behave exactly as before.
 */
function groundAt(fighter, x, z, rootGround) {
  const layout = fighter?.layout;
  if (!layout) return rootGround;
  const sampled = groundHeightAt(x, z, layout, rootGround);
  return Number.isFinite(sampled) ? sampled : rootGround;
}

/** Pull a floor target under the hip if the turn has carried it outside the leg's reach. */
function reachableTarget(chain, target) {
  const hip = chain.hip.getWorldPosition(_g);
  const dy = target.y - hip.y;
  const horizontal = Math.sqrt(Math.max(0, (chain.reach * 0.92) ** 2 - dy * dy));
  const dx = target.x - hip.x;
  const dz = target.z - hip.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= horizontal || distance < 1e-4) return target;
  return _h.set(hip.x + dx / distance * horizontal, target.y, hip.z + dz / distance * horizontal);
}

/** The chain whose ankle is furthest along a transition direction. */
function leadingChain(chains, origin, direction) {
  let lead = null;
  let best = -Infinity;
  for (const chain of chains) {
    const p = chain.ankle.getWorldPosition(_g);
    const dot = (p.x - origin.x) * direction.x + (p.z - origin.z) * direction.z;
    if (dot > best) {
      best = dot;
      lead = chain;
    }
  }
  return lead;
}

/** The lower ankle is the foot that should carry the pivot. */
function lowestChain(chains) {
  let low = null;
  let lowY = Infinity;
  for (const chain of chains) {
    const y = chain.ankle.getWorldPosition(_g).y;
    if (y < lowY) {
      lowY = y;
      low = chain;
    }
  }
  return low;
}

function moveDirection(fighter, x, z) {
  let dx = Number(x) || 0;
  let dz = Number(z) || 0;
  let length = Math.hypot(dx, dz);
  if (length < 0.01) {
    dx = Number(fighter?.facing) || 0;
    dz = Number(fighter?.facingZ) || 1;
    length = Math.hypot(dx, dz) || 1;
  }
  return { x: dx / length, z: dz / length };
}

function footYaw(chain) {
  const foot = chain?.ankle;
  if (!foot) return 0;
  const direction = _h.set(0, 0, 1).applyQuaternion(foot.getWorldQuaternion(_qFoot));
  return Math.atan2(direction.x, direction.z);
}

/** Rotate a planted ankle around world up without moving its solved position. */
function turnFoot(chain, yaw, weight = 0.7) {
  const foot = chain?.ankle;
  if (!foot?.parent || Math.abs(yaw) < 1e-4) return;
  foot.updateWorldMatrix(true, false);
  const parentWorld = foot.parent.getWorldQuaternion(_qParent).invert();
  const world = foot.getWorldQuaternion(_qWorld);
  const desired = _qDesired.copy(parentWorld).multiply(_qYaw.setFromAxisAngle(UP, yaw)).multiply(world);
  foot.quaternion.slerp(desired, Math.min(1, weight));
  foot.updateWorldMatrix(true, true);
}


function allowed(fighter, clip) {
  if (!fighter || fighter.isGrounded === false) return false;
  if (fighter.flightMode || fighter.webSwinging || fighter.casting) return false;
  if ((fighter.hitstun || 0) > 0 || (fighter.guardBreak || 0) > 0 || (fighter.dodgeTimer || 0) > 0) return false;
  if (fighter.attackQueue?.length) return false;
  const name = String(clip || '');
  return LOCOMOTION.test(name) && !NON_LOCOMOTION.test(name);
}

/**
 * Apply the grounded locomotion layer. Safe to call once per rendered frame; a controller-driven
 * body should call it after its mixer update, while a legacy body calls it after its own pose pass.
 */
export function applyLocomotionPresentation(root, fighter, dt = 1 / 60) {
  if (!root?.userData || !fighter) return null;
  if (!pilotEnabled) {
    root.userData.locomotionReport = null;
    return null;
  }
  const state = stateFor(root, fighter);
  // The first call can land before an asynchronously mounted GLB has bound its skeleton. Retry
  // the measurement once the bones appear instead of caching an empty rig for the whole match.
  if (!state.rig.chains.length) {
    state.rig = measure(root, fighter);
  }
  applyCalibration(state.rig, calibrationFor(root, fighter?.animationController?.rig, fighterKey(fighter)));
  const clip = String(fighter.animationController?._active || root.userData.currentClip || '');
  if (!footAccepted(fighter)) {
    // Do not apply any correction to a rejected rig. The mixer's authored clip pose is the final
    // foot pose; the report is diagnostic only. legLength stays populated so the live probes can
    // still confirm that the body mounted before deciding whether to remeasure it.
    const calibration = state.rig.calibration;
    root.userData.locomotionReport = {
      clip,
      state: 'authored',
      accepted: false,
      reason: 'not accepted by the grounded-locomotion sweep',
      legLength: state.rig.legLength || 0,
      calibration: calibration ? {
        source: calibration.source,
        armReach: calibration.arm.reach,
        legReach: calibration.leg.reach,
        foot: state.rig.foot
      } : null,
      feet: []
    };
    return null;
  }
  if (!state.rig.chains.length) return null;
  const speed = Math.hypot(fighter.velocity?.x || 0, fighter.velocity?.z || 0);
  const heading = Number.isFinite(fighter.facingZ) && Number.isFinite(fighter.facing)
    ? Math.atan2(fighter.facingZ, fighter.facing || 1)
    : Number(root.rotation?.y) || 0;
  let headingDelta = state.lastHeading === null ? 0 : heading - state.lastHeading;
  while (headingDelta > Math.PI) headingDelta -= Math.PI * 2;
  while (headingDelta < -Math.PI) headingDelta += Math.PI * 2;
  state.lastHeading = heading;
  state.turnDir = Math.abs(headingDelta) > 1e-4 ? Math.sign(headingDelta) : state.turnDir;
  const grounded = fighter.isGrounded !== false;
  const justLanded = grounded && state.lastGrounded === false;
  state.lastGrounded = grounded;
  const stateChanged = clip !== state.lastClip;
  if (!allowed(fighter, clip)) {
    for (const foot of Object.values(state.feet)) release(foot);
    // Airborne/attack frames must not carry a pivot or start/stop pulse back into the next
    // grounded state; otherwise a jump after a turn can land with both feet released.
    state.pivotTimer = 0;
    state.pivot = 0;
    state.startTimer = 0;
    state.stopTimer = 0;
    state.landingReplantTimer = 0;
    state.start = 0;
    state.stop = 0;
    state.land = 0;
    state.lastClip = clip;
    if (stateChanged) state.lastInputMoving = false;
    root.userData.locomotionReport = { clip, state: 'inactive', feet: [] };
    return null;
  }

  const ground = rootGroundFor(fighter);
  const surfaceAt = (x, z) => groundAt(fighter, x, z, ground);
  root.updateMatrixWorld(true);
  // A walk/run clip owns its own foot floor. The idle band can sit below the walk clip (Hulk,
  // Vegeta, Mario); snapping the walk target to that lower value forces the IK to over-extend the
  // stance leg, which is the slide this split removes. Idle, stand, turn and landing keep the idle
  // contact height.
  const walkCycle = /walk|run|sprint/i.test(clip);
  const footCalibration = state.rig.foot;
  const contactHeight = walkCycle && Number.isFinite(footCalibration.walkContactHeight)
    ? footCalibration.walkContactHeight
    : footCalibration.contactHeight;
  // The acquisition and release bands are absolute heights for this rig, not offsets from the
  // clip's contact height. Shifting the band up with the walk floor would acquire a foot tens of
  // millimetres above the floor and then snap it down, over-extending the leg; the idle band is
  // already above the walk floor on every measured rig.
  const contactLimit = Number.isFinite(footCalibration.contactLimit)
    ? footCalibration.contactLimit : contactHeight + 0.06;
  const releaseHeight = Number.isFinite(footCalibration.releaseHeight)
    ? footCalibration.releaseHeight : contactHeight + 0.18;

  // Anticipation and recovery are driven by the processed input, not only by the velocity it
  // produces. A start step must exist on the first input frame, before acceleration moves the root;
  // a stop brace must exist on the release frame, before braking has carried the body forward.
  const rawInput = fighter.lastInput || null;
  const hasInput = Boolean(rawInput);
  const inputMoving = hasInput ? Boolean(rawInput.moving) : speed > 0.08;
  if (inputMoving) {
    const direction = moveDirection(fighter, rawInput?.x, rawInput?.z);
    state.lastMoveX = direction.x;
    state.lastMoveZ = direction.z;
  }
  const inputStarted = !state.lastInputMoving && inputMoving;
  const inputStopped = state.lastInputMoving && !inputMoving;
  state.lastInputMoving = inputMoving;
  if (inputStarted) state.startTimer = 0.24;
  if (inputStopped) state.stopTimer = 0.22;
  if (justLanded) state.landingReplantTimer = 0.24;
  state.landingReplantTimer = Math.max(0, state.landingReplantTimer - dt);
  state.startTimer = Math.max(0, state.startTimer - dt);
  state.stopTimer = Math.max(0, state.stopTimer - dt);
  state.start = THREE.MathUtils.damp(state.start, state.startTimer > 0 ? 1 : 0, 10, dt);
  state.stop = THREE.MathUtils.damp(state.stop, state.stopTimer > 0 ? 1 : 0, 10, dt);
  state.land = THREE.MathUtils.damp(state.land, THREE.MathUtils.clamp(fighter.landPulse || 0, 0, 1), 12, dt);
  if (justLanded) state.land = Math.max(state.land, 0.65);
  const controller = fighter.animationController;
  const controllerTurn = Number.isFinite(controller?._turnRate) ? controller._turnRate : 0;
  const turnRate = Math.max(controllerTurn, dt > 0 ? Math.abs(headingDelta) / dt : 0);
  const pivotStarted = turnRate > 2 && speed < 0.7 && state.pivotTimer <= 0;
  if (turnRate > 2 && speed < 0.7) state.pivotTimer = 0.3;
  const pivotActive = state.pivotTimer > 0;
  if (pivotStarted) {
    state.pivotSide = null;
    state.pivotStepSide = null;
    state.pivotStepTimer = 0.10;
    state.pivotAnchor = null;
    state.pivotStepTarget = null;
  }
  state.pivotTimer = Math.max(0, state.pivotTimer - dt);
  state.pivot = THREE.MathUtils.damp(state.pivot, pivotActive ? 1 : 0, 10, dt);

  const pelvis = joint(root, fighter, 'pelvis');
  const torso = joint(root, fighter, 'torso');
  if (pelvis) {
    pelvis.rotation.x += state.start * 0.045 - state.stop * 0.035 + state.land * 0.055;
    pelvis.rotation.y += (controller?._turnDir || state.turnDir) * 0.08 * state.pivot;
  }
  if (torso) {
    torso.rotation.x -= state.stop * 0.025 + state.land * 0.035;
    torso.rotation.y -= (controller?._turnDir || state.turnDir) * 0.05 * state.pivot;
  }
  root.updateMatrixWorld(true);

  // Translate the transition pulses into actual foot targets after the pelvis compression has
  // been applied. The targets are world-space, so they survive the root turning under the feet.
  const rootPosition = root.getWorldPosition(new THREE.Vector3());
  const footStep = Math.max(0.12, state.rig.foot.step);
  const transitionDirection = moveDirection(fighter, state.lastMoveX, state.lastMoveZ);
  if (inputStarted) {
    const lead = leadingChain(state.rig.chains, rootPosition, transitionDirection);
    if (lead) {
      state.startStepSide = lead.side;
      const p = lead.ankle.getWorldPosition(_g);
      const targetX = p.x + transitionDirection.x * footStep * 0.38;
      const targetZ = p.z + transitionDirection.z * footStep * 0.38;
      state.startStepTarget = groundTarget(new THREE.Vector3(targetX, 0, targetZ),
        surfaceAt(targetX, targetZ), contactHeight);
    }
  }
  if (inputStopped) {
    const front = leadingChain(state.rig.chains, rootPosition, transitionDirection);
    state.stopFront = front?.side || null;
    state.stopTargets = {};
    for (const chain of state.rig.chains) {
      const p = chain.ankle.getWorldPosition(_g);
      const hip = chain.hip.getWorldPosition(_h);
      const forward = chain.side === state.stopFront ? 0.12 : -0.06;
      // Brace under the hips rather than at the extreme of the braking clip's swing. A target far
      // from the hip can be outside the calibrated reach and is then reported as an unplanted foot.
      const target = new THREE.Vector3(
        p.x * 0.35 + hip.x * 0.65 + transitionDirection.x * footStep * forward,
        0,
        p.z * 0.35 + hip.z * 0.65 + transitionDirection.z * footStep * forward
      );
      target.y = surfaceAt(target.x, target.z) + contactHeight;
      state.stopTargets[chain.side] = target;
    }
  }
  if (pivotStarted) {
    const pivot = lowestChain(state.rig.chains);
    if (pivot) {
      state.pivotSide = pivot.side;
      state.pivotStepSide = pivot.side === 'left' ? 'right' : 'left';
      // Anchor at the current ankle, not at a target left over from the previous gait. A frozen
      // or interrupted clip can leave an old world target metres behind the body.
      const anchor = pivot.ankle.getWorldPosition(new THREE.Vector3());
      anchor.y = surfaceAt(anchor.x, anchor.z) + contactHeight;
      state.pivotAnchor = anchor;
    }
  }
  if (pivotActive && state.pivotStepTimer <= 0 && state.pivotStepSide && !state.pivotStepTarget) {
    const stepChain = state.rig.chains.find(chain => chain.side === state.pivotStepSide);
    if (stepChain) {
      const p = stepChain.ankle.getWorldPosition(new THREE.Vector3());
      const forwardX = Number(fighter.facing) || 0;
      const forwardZ = Number(fighter.facingZ) || 1;
      const rightX = forwardZ;
      const rightZ = -forwardX;
      const lateral = (p.x - rootPosition.x) * rightX + (p.z - rootPosition.z) * rightZ;
      const side = lateral >= 0 ? 1 : -1;
      const target = new THREE.Vector3(
        p.x + rightX * 0.18 * side + forwardX * 0.02,
        0,
        p.z + rightZ * 0.18 * side + forwardZ * 0.02
      );
      target.y = surfaceAt(target.x, target.z) + contactHeight;
      state.pivotStepTarget = target;
    }
    state.pivotStepTimer = 0.12;
  }
  state.pivotStepTimer = Math.max(0, state.pivotStepTimer - dt);

  const feet = [];
  for (const chain of state.rig.chains) {
    const foot = state.feet[chain.side];
    let anklePos = chain.ankle.getWorldPosition(_a).clone();
    if (!Number.isFinite(anklePos.x) || !Number.isFinite(anklePos.y) || !Number.isFinite(anklePos.z)) continue;
    const footGround = surfaceAt(anklePos.x, anklePos.z);
    let reportedAnkle = anklePos;
    let reportedGround = footGround;
    foot.cooldown = Math.max(0, foot.cooldown - dt);
    if (stateChanged) release(foot, 'clip');
    let forcedTarget = null;
    let forcedReason = null;
    let suppressTarget = false;
    if (state.landingReplantTimer > 0) {
      // A landing is a two-foot event: both ankles are pulled to the measured contact band even
      // if the landing clip left them high, and the recovery holds them there. Each ankle uses the
      // surface under its own column, so a landing on a stair or deck edge does not lift the
      // trailing foot to the higher surface (or drop the leading one through it).
      forcedTarget = groundTarget(anklePos, surfaceAt(anklePos.x, anklePos.z), contactHeight);
      forcedReason = 'landing';
    } else if (pivotActive && state.pivotSide && state.pivotStepSide) {
      if (chain.side === state.pivotSide) {
        forcedTarget = reachableTarget(chain, state.pivotAnchor);
        forcedReason = 'pivot';
      } else if (chain.side === state.pivotStepSide) {
        if (state.pivotStepTimer > 0) {
          suppressTarget = true;
        } else if (state.pivotStepTarget) {
          forcedTarget = reachableTarget(chain, state.pivotStepTarget);
          forcedReason = 'pivot-step';
        }
      }
    } else if (state.startTimer > 0 && state.startStepSide === chain.side && state.startStepTarget) {
      forcedTarget = state.startStepTarget;
      forcedReason = 'start';
    } else if (state.stopTimer > 0 && state.stopTargets?.[chain.side]) {
      forcedTarget = state.stopTargets[chain.side];
      forcedReason = 'stop';
    }
    if (forcedTarget) {
      foot.target = forcedTarget.clone();
      foot.targetReason = forcedReason;
      foot.holdTarget = forcedReason !== 'landing';
      foot.age = 0;
      foot.cooldown = 0;
    } else if (suppressTarget) {
      foot.holdTarget = false;
      release(foot, 'pivot-step');
    } else {
      foot.holdTarget = false;
    }
    if (foot.target) {
      foot.age += dt;
      // A planted ankle is held only while it remains inside a believable step from the hip and
      // close enough to its captured height. Beyond that the clip's next swing owns the foot. A
      // pivot target is deliberately held: the stance foot must stay put while the body turns.
      const drift = foot.target.distanceTo(anklePos);
      const vertical = Math.abs(foot.target.y - anklePos.y);
      // A gait target is a world-space plant, so the ankle can stay on it while the root keeps
      // travelling. Three limits hand the foot back to the clip: the root has passed too far
      // beyond the plant (hold), the plant has left the horizontal cone the leg can stand over
      // (hip), or a moving plant has lived longer than one stance (stance). The hold/hip checks
      // wait for the IK to blend; the stance cap is a true duration guard so a creeping root
      // cannot pin the same target indefinitely. The normal drift/vertical settling grace stays
      // long enough for a legitimate plant to settle. Forced pivot/start/stop targets keep their
      // own hold policy.
      const gaitMoving = !foot.holdTarget && foot.targetReason === 'gait' && speed > 0.25;
      const settling = !foot.holdTarget && foot.age < 0.2;
      const rootTravel = (rootPosition.x - foot.target.x) * transitionDirection.x
        + (rootPosition.z - foot.target.z) * transitionDirection.z;
      let hipDistance = 0;
      if (gaitMoving) {
        chain.hip.getWorldPosition(_hip);
        hipDistance = Math.hypot(foot.target.x - _hip.x, foot.target.z - _hip.z);
      }
      if (gaitMoving && foot.weight >= 0.85 && hipDistance > state.rig.foot.hip) {
        release(foot, 'hip');
      } else if (gaitMoving && foot.age > state.rig.foot.stanceMax) {
        release(foot, 'stance');
      } else if (!foot.holdTarget && speed > 0.25 && foot.weight >= 0.85 && rootTravel > state.rig.foot.hold) {
        release(foot, 'hold');
      } else if (!foot.holdTarget && !settling && (drift > state.rig.foot.drift || vertical > state.rig.foot.vertical
        || anklePos.y > footGround + releaseHeight)) {
        release(foot, 'drift');
      }
    }
    // Contact is per-foot and shares the audit's ceiling: acquire only inside the measured band,
    // so a foot that is still raised at blend-in never becomes a held contact in the first place.
    const inBand = anklePos.y <= footGround + contactLimit;
    if (!foot.target && !suppressTarget && foot.cooldown <= 0) {
      const descending = foot.wasY === null || anklePos.y <= foot.wasY + 0.035;
      if (inBand && (speed < 0.35 || descending)) {
        // The contact band belongs to the rig, not to the phase the foot happened to be in when
        // it entered the band. Target the measured contact height so a raised foot is lowered to
        // the floor instead of being pinned where the clip left it.
        foot.target = anklePos.clone();
        foot.target.y = footGround + contactHeight;
        foot.targetReason = 'gait';
        foot.holdTarget = false;
        foot.age = 0;
      }
    }
    // Release a blended gait plant before the solve when the target has left the leg's reach.
    // The old reach check ran after the solve, so the IK had already dragged the ankle toward an
    // unreachable point; this keeps the foot on the clip's side of the limit instead.
    if (foot.target && !foot.holdTarget && speed > 0.25 && foot.weight >= 0.85) {
      chain.hip.getWorldPosition(_hip);
      if (_hip.distanceTo(foot.target) > chain.reach * 0.92) release(foot, 'reach');
    }
    foot.wasY = anklePos.y;
    if (foot.target) {
      // Gait targets blend in faster than held pivots: a walk plant only exists for a fraction of
      // a second, and a slow ramp would release it before it ever settles. The hold guard still
      // waits for weight >= 0.85, so this does not add a hard snap.
      foot.weight = THREE.MathUtils.damp(foot.weight, 1, foot.holdTarget ? 14 : 30, dt);
      const residual = solveLeg(chain, foot.target, foot.weight);
      foot.residual = typeof residual === 'number' ? residual : null;
      chain.ankle.updateWorldMatrix(true, false);
      reportedAnkle = chain.ankle.getWorldPosition(new THREE.Vector3());
      reportedGround = surfaceAt(reportedAnkle.x, reportedAnkle.z);
      // Only a fully blended solve that still cannot reach its target is an unreachable plant;
      // a partially blended foot is expected to lag while the IK weight ramps in.
      if (foot.weight > 0.85 && residual > 0.12) {
        release(foot, 'reach');
        chain.ankle.updateWorldMatrix(true, false);
        reportedAnkle = chain.ankle.getWorldPosition(new THREE.Vector3());
        reportedGround = surfaceAt(reportedAnkle.x, reportedAnkle.z);
      } else if (!foot.holdTarget && reportedAnkle.y - reportedGround > contactLimit) {
        // The ankle is outside the band (including during blend-in). Release it instead of
        // holding a raised foot as a contact until the IK weight happens to cross a threshold.
        release(foot, 'height');
        chain.ankle.updateWorldMatrix(true, false);
        reportedAnkle = chain.ankle.getWorldPosition(new THREE.Vector3());
        reportedGround = surfaceAt(reportedAnkle.x, reportedAnkle.z);
      }
    } else {
      foot.weight = THREE.MathUtils.damp(foot.weight, 0, 14, dt);
    }
    if (pivotActive && state.pivotSide && state.pivotStepSide) {
      // The feet yaw with the turn as well as the pelvis; the stance ankle stays at its world
      // anchor while its foot turns under the hip. Apply this frame's heading delta, not the
      // accumulated pivot angle, or the foot would keep spinning on every held frame.
      turnFoot(chain, headingDelta * 0.55, 0.55);
    }
    feet.push({
      side: chain.side,
      contact: Boolean(foot.target),
      weight: Number(foot.weight.toFixed(3)),
      ground: Number(reportedGround.toFixed(3)),
      height: Number((reportedAnkle.y - reportedGround).toFixed(3)),
      reach: Number(chain.reach.toFixed(3)),
      slide: foot.target && foot.residual !== null ? Number(foot.residual.toFixed(3)) : 0,
      targetReason: foot.target ? (foot.targetReason || 'gait') : null,
      yaw: Number(footYaw(chain).toFixed(3)),
      target: foot.target ? foot.target.toArray().map(v => Number(v.toFixed(3))) : null,
      ankle: reportedAnkle.toArray().map(v => Number(v.toFixed(3))),
      reason: foot.target ? null : (foot.reason || null)
    });
  }

  state.lastClip = clip;
  const report = {
    clip,
    state: 'active',
    cadence: Number((state.rig.legLength ? speed / state.rig.legLength : 0).toFixed(3)),
    stride: Number(strideScaleFor(root, fighter).toFixed(3)),
    actionScale: Number((root.userData.lastMoveAction?.getEffectiveTimeScale?.() || 0).toFixed(3)),
    legLength: Number(state.rig.legLength.toFixed(3)),
    calibration: {
      source: state.rig.calibration.source,
      armReach: state.rig.calibration.arm.reach,
      legReach: state.rig.calibration.leg.reach,
      foot: state.rig.foot
    },
    start: Number(state.start.toFixed(3)),
    stop: Number(state.stop.toFixed(3)),
    landing: Number(state.land.toFixed(3)),
    startStepSide: state.startTimer > 0 ? state.startStepSide : null,
    stopFront: state.stopTimer > 0 ? state.stopFront : null,
    landingReplantTimer: Number(state.landingReplantTimer.toFixed(3)),
    pivot: Number(state.pivot.toFixed(3)),
    pivotSide: state.pivotSide,
    pivotStepSide: state.pivotStepSide,
    pivotHeld: pivotActive && Boolean(state.pivotAnchor),
    groundRoot: Number(ground.toFixed(3)),
    heading: Number(heading.toFixed(3)),
    turnRate: Number(turnRate.toFixed(3)),
    turnDir: state.turnDir,
    feet
  };
  root.userData.locomotionReport = report;
  return report;
}

export function locomotionState(root) {
  return root?.userData?.locomotionReport || null;
}

/** Measured leg length for a body, shared with the stride-time-scale caller. */
export function legLengthFor(root, fighter) {
  if (!root?.userData || !fighter) return 0.86;
  const state = stateFor(root, fighter);
  if (!state.rig.chains.length) {
    state.rig = measure(root, fighter);
  }
  applyCalibration(state.rig, calibrationFor(root, fighter?.animationController?.rig, fighterKey(fighter)));
  return state.rig.legLength || state.rig.calibration?.leg.reach || 0.86;
}

if (typeof window !== 'undefined') {
  window.__browserSmashSetLocomotionPilot = setLocomotionPilotEnabled;
  window.__browserSmashLocomotionPilotEnabled = locomotionPilotEnabled;
  window.__browserSmashSetFootAcceptance = setFootAcceptanceEnabled;
}

/** Clamped cadence multiplier: short legs cycle faster at the same ground speed. */
export function strideScaleFor(root, fighter) {
  // The pilot-off capture is raw; a rejected rig keeps the authored clip cadence and authored
  // feet. Both skip the extra leg-normalization factor.
  if (!pilotEnabled || !footAccepted(fighter)) return 1;
  const leg = legLengthFor(root, fighter);
  return THREE.MathUtils.clamp(0.86 / leg, 0.78, 1.24);
}
