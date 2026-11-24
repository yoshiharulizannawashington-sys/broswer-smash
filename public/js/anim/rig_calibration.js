// Bind-time proportion calibration.
//
// The animation layers need to know how long a body's limbs actually are. A fixed 0.32 m elbow
// drop or a 0.30 m foot drift is correct for one average humanoid and wrong for a 1.8 m soldier,
// a 1.93 m Aquaman or a 2.5 m Hulk. This module measures the mounted skeleton once, when the rig is
// bound, and publishes the values every proportional pose layer reads:
//
//   arm.upper / fore / reach / shoulderWidth -> resting-arm trigger, elbow target and hand guard
//   leg.upper / leg.lower / leg.reach        -> foot contact thresholds and stride cadence
//   restingArm / foot                        -> the derived target values themselves
//
// Measurements use world-space bone distances, not local bone translations: an imported GLTF may
// carry a centimetre-scale armature under a metre-scale root, and local positions then contain
// values such as 27.9 for a 0.28 m upper arm. The snapshot is taken once at bind time, because a
// later runtime scale or squash would otherwise change every world distance.
//
// The profile is cached on userData. Bind-time means one measurement per mounted body, not a
// measurement on every animation frame.
import * as THREE from 'three';
import { FOOT_CONTACT_BY_IDENTITY, FOOT_WALK_CONTACT_BY_IDENTITY } from './foot_calibration_data.js';

const ARM_TRIGGER_RATIO = 1.02;
const ARM_DROP_RATIO = 0.95;
const ARM_ELBOW_MIN_RATIO = 0.55;
const ARM_SIDE_RATIO = 0.18;
const ARM_SHOULDER_SIDE_RATIO = 0.13;
const ARM_ELBOW_INSIDE_RATIO = 0.03;
const ARM_FORWARD_RATIO = 0.10;
// A hand hanging below this fraction of the measured arm reach is already at rest. The settle
// must not lift it to reach its elbow target: several authored idles clasp their hands behind the
// back, fold their arms or rest their fists at the belt.
const ARM_REST_REACH_RATIO = 0.95;
// Never lift a hand more than this fraction of the arm's reach while lowering its elbow. The
// forearm is deliberately left on its source pose, so a large upper-arm correction can otherwise
// rotate a bent forearm upward even while the elbow drops.
const ARM_HAND_RISE_RATIO = 0.02;
const ARM_HAND_RISE_MIN = 0.010;
// Contact thresholds are anchored to each rig's measured contact height instead of a fixed
// fraction of leg length. The remaining ratios only set the narrow band around that anchor; they
// are deliberately small enough that a raised swing foot cannot be mistaken for a stance foot.
const FOOT_DRIFT_RATIO = 0.42;
const FOOT_VERTICAL_RATIO = 0.16;
const FOOT_CONTACT_RATIO = 0.08;
const FOOT_RELEASE_RATIO = 0.10;
const FOOT_STEP_RATIO = 0.36;
// A gait target is a world-space plant. It must be released once the root has travelled past it;
// otherwise the IK keeps pulling the ankle toward an unreachable point and the foot slides for the
// rest of the stance. This is how far behind the root the plant may sit before the clip's next
// swing owns the foot. It is a stance budget, not the only hip-distance guard: a foot that starts
// ahead of the hip must be allowed to pass under the body before this budget releases it; the
// separate FOOT_HIP_RATIO guard catches plants already outside the leg's horizontal cone.
const FOOT_HOLD_RATIO = 0.20;
// A stance target must also stay inside the horizontal cone the leg can stand over. At the
// calibrated contact height the hip sits roughly 0.8 x leg reach above the floor, so 0.45 x leg
// reach is the radius still inside a 0.92 x reach two-bone solve. A target beyond it is already
// pulling the ankle off the clip's swing; the foot should be released before the IK extends.
const FOOT_HIP_RATIO = 0.45;
// A moving plant is a step, not a pose. If the clip keeps the foot in contact while the root only
// creeps, the distance budgets may never fire; cap how long a moving gait target may live. This
// is a duration, not a per-rig length, because the clip cadence is normalized across bodies.
const FOOT_STANCE_MAX = 0.35;
const FOOT_CONTACT_BAND_MIN = 0.06;
const FOOT_RELEASE_MIN = 0.18;
const FOOT_VERTICAL_MIN = 0.06;
const FOOT_DRIFT_MIN = 0.15;
const FOOT_CONTACT_MIN = 0.02;

/** Conservative fallback for an unbound/partial rig. The live bodies always take the measured path. */
export const DEFAULT_RIG_CALIBRATION = Object.freeze({
  source: 'fallback',
  arm: Object.freeze({ upper: 0.28, fore: 0.25, reach: 0.53, shoulderWidth: 0.38 }),
  leg: Object.freeze({ upper: 0.42, lower: 0.42, reach: 0.84 }),
  restingArm: Object.freeze({
    trigger: 0.30, drop: 0.32, side: 0.06, forward: 0.03,
    reach: 0.50, handRise: 0.011,
    elbow: Object.freeze({ min: 0.154, max: 0.32, lateral: 0.011 })
  }),
  foot: Object.freeze({
    contactHeight: 0.10, walkContactHeight: 0.10, drift: 0.30, vertical: 0.24,
    contactLimit: 0.167, releaseHeight: 0.30, step: 0.30, hold: 0.168,
    hip: 0.378, stanceMax: 0.35
  })
});

function finite(value) {
  return Number.isFinite(value) && value > 1e-5;
}

function joint(root, rig, key) {
  // Prefer the live mounted bones. A rig description can be resolved before an asynchronous GLB
  // finishes mounting, and its joints may still be proxy/static objects rather than the bones the
  // foot and arm layers actually animate.
  return root?.userData?.[key]
    || rig?.joints?.[key]
    || root?.userData?.animationRig?.joints?.[key]
    || null;
}

function worldPosition(bone, out) {
  if (!bone) return null;
  bone.updateWorldMatrix(true, false);
  return bone.getWorldPosition(out);
}

function averagePair(a, b, fallback) {
  const values = [a, b].filter(finite);
  if (!values.length) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function distance(a, b) {
  return a && b ? a.distanceTo(b) : NaN;
}

function referenceScaleOf(root, rig, out) {
  if (!root?.isObject3D) return out.set(1, 1, 1);
  // Imported armatures often animate the skeleton node's scale (or mount it under a scaled holder)
  // after resolveRig() first sees the model. Use a limb bone's world scale as the reference so a
  // later 1.16x mount rescales the cached unit lengths instead of looking like a different skeleton.
  const bone = joint(root, rig, 'leftArm')
    || joint(root, rig, 'leftLeg')
    || joint(root, rig, 'head')
    || root;
  bone.updateWorldMatrix(true, false);
  return bone.getWorldScale(out);
}

function measureFootHeight(root, leftFoot, rightFoot) {
  const origin = worldPosition(root, new THREE.Vector3());
  if (!origin) return NaN;
  const heights = [leftFoot, rightFoot]
    .map(foot => worldPosition(foot, new THREE.Vector3()))
    .filter(Boolean)
    .map(position => position.y - origin.y)
    .filter(Number.isFinite);
  return heights.length ? Math.max(FOOT_CONTACT_MIN, Math.min(...heights)) : NaN;
}

function measureHeight(root, head, foot) {
  if (head && foot) {
    const top = worldPosition(head, new THREE.Vector3());
    const bottom = worldPosition(foot, new THREE.Vector3());
    if (top && bottom && Math.abs(top.y - bottom.y) > 0.05) return top.y - bottom.y;
  }
  if (!root?.isObject3D) return 0;
  const box = new THREE.Box3().setFromObject(root);
  return box.isEmpty() ? 0 : box.max.y - box.min.y;
}

function uniformScale(scale) {
  const value = (Math.abs(scale.x) + Math.abs(scale.y) + Math.abs(scale.z)) / 3;
  return value > 1e-5 ? value : 1;
}

function sameScale(a, b) {
  return Array.isArray(a) && a.length === 3
    && Math.abs(a[0] - b.x) < 0.01
    && Math.abs(a[1] - b.y) < 0.01
    && Math.abs(a[2] - b.z) < 0.01;
}

function targetsFor(arm, leg, contactHeight = NaN, walkContactHeight = NaN) {
  const shoulderWidth = finite(arm.shoulderWidth) ? arm.shoulderWidth : arm.upper * 1.35;
  const elbowLimit = Object.freeze({
    min: +(arm.upper * ARM_ELBOW_MIN_RATIO).toFixed(4),
    max: +(arm.upper * ARM_DROP_RATIO).toFixed(4),
    // An elbow this far inside the shoulder line belongs to a folded or behind-back pose, not a
    // T/A-pose. The tolerance is body-scaled, so broad and narrow rigs are judged consistently.
    lateral: +(shoulderWidth * ARM_ELBOW_INSIDE_RATIO).toFixed(4)
  });
  const restingArm = {
    trigger: arm.upper * ARM_TRIGGER_RATIO,
    drop: elbowLimit.max,
    // Half the shoulder span is body, not arm. Offset the elbow far enough that the target never
    // sits inside the torso on a wide-shouldered rig.
    side: Math.max(arm.upper * ARM_SIDE_RATIO, shoulderWidth * ARM_SHOULDER_SIDE_RATIO),
    forward: arm.fore * ARM_FORWARD_RATIO,
    reach: +(arm.reach * ARM_REST_REACH_RATIO).toFixed(4),
    handRise: +Math.max(ARM_HAND_RISE_MIN, arm.reach * ARM_HAND_RISE_RATIO).toFixed(4),
    elbow: elbowLimit
  };
  const footHeight = Math.max(FOOT_CONTACT_MIN,
    Number.isFinite(contactHeight) ? contactHeight : leg.reach * 0.12);
  const walkFootHeight = Math.max(FOOT_CONTACT_MIN,
    Number.isFinite(walkContactHeight) ? walkContactHeight : footHeight);
  // One contact ceiling serves both acquisition and the raised-foot release. It is anchored to
  // the lower of the idle and walk floors, matching the pre-calibration audit, so a foot held
  // above that band is reported and released rather than hidden behind an IK-weight filter.
  const contactFloor = Math.min(footHeight, walkFootHeight);
  const foot = {
    contactHeight: +footHeight.toFixed(4),
    // The walk/run target uses the clip's own floor, not the idle minimum. On Hulk the idle band
    // sits 0.062 m below the walk floor; snapping the walk ankle to the idle value makes the IK
    // drag the stance foot, which is the regression this split fixes.
    walkContactHeight: +walkFootHeight.toFixed(4),
    drift: Math.max(FOOT_DRIFT_MIN, leg.reach * FOOT_DRIFT_RATIO),
    vertical: Math.max(FOOT_VERTICAL_MIN, leg.reach * FOOT_VERTICAL_RATIO),
    contactLimit: +(contactFloor + Math.max(FOOT_CONTACT_BAND_MIN, leg.reach * FOOT_CONTACT_RATIO)).toFixed(4),
    releaseHeight: +(footHeight + Math.max(FOOT_RELEASE_MIN, leg.reach * FOOT_RELEASE_RATIO)).toFixed(4),
    step: leg.reach * FOOT_STEP_RATIO,
    hold: +(leg.reach * FOOT_HOLD_RATIO).toFixed(4),
    hip: +(leg.reach * FOOT_HIP_RATIO).toFixed(4),
    stanceMax: FOOT_STANCE_MAX
  };
  return { restingArm, foot };
}

function scaledProfile(base, scale, identity = null) {
  const factor = uniformScale(scale);
  const measure = value => +(value * factor).toFixed(4);
  const arm = {
    upper: measure(base.unit.arm.upper),
    fore: measure(base.unit.arm.fore),
    reach: measure(base.unit.arm.upper + base.unit.arm.fore),
    shoulderWidth: measure(base.unit.arm.shoulderWidth || DEFAULT_RIG_CALIBRATION.arm.shoulderWidth)
  };
  const leg = {
    upper: measure(base.unit.leg.upper),
    lower: measure(base.unit.leg.lower),
    reach: measure(base.unit.leg.upper + base.unit.leg.lower)
  };
  const tabulated = identity ? FOOT_CONTACT_BY_IDENTITY[identity] : undefined;
  const contactHeight = finite(tabulated) ? tabulated
    : base.unit.footHeight ? measure(base.unit.footHeight) : NaN;
  const tabulatedWalk = identity ? FOOT_WALK_CONTACT_BY_IDENTITY[identity] : undefined;
  const walkContactHeight = finite(tabulatedWalk) ? tabulatedWalk : contactHeight;
  const { restingArm, foot } = targetsFor(arm, leg, contactHeight, walkContactHeight);
  return Object.freeze({
    source: base.source,
    rigKind: base.rigKind || null,
    identity: identity || base.identity || null,
    scale: [scale.x, scale.y, scale.z].map(value => +value.toFixed(4)),
    height: measure(base.unit.height),
    arm: Object.freeze(arm),
    leg: Object.freeze(leg),
    restingArm: Object.freeze(restingArm),
    foot: Object.freeze(foot),
    unit: base.unit
  });
}

/**
 * Measure and cache one rig's proportions.
 *
 * `rig` is the object returned by `resolveRig()` (or any object with `joints` and `kind`). The
 * optional `force` is for diagnostics; normal bind paths should let the cache stand.
 */
export function calibrateRig(root, rig = null, { force = false, identity = null } = {}) {
  if (!root?.isObject3D) return DEFAULT_RIG_CALIBRATION;
  const userData = root.userData || (root.userData = {});
  const cached = userData.rigCalibration;
  const resolvedIdentity = identity || cached?.identity || null;
  // Bind-time means one measurement, not a remeasure, whenever the pose changes. A scale change
  // rescales the cached unit lengths rather than re-reading animated world positions, so a squash
  // or a late-mounted uniform scale cannot turn the proportions into a different measurement.
  const scale = referenceScaleOf(root, rig, new THREE.Vector3());
  if (!force && cached?.source === 'bind' && cached.unit) {
    if (sameScale(cached.scale, scale) && (!resolvedIdentity || cached.identity === resolvedIdentity)) return cached;
    const rescaled = scaledProfile(cached, scale, resolvedIdentity);
    userData.rigCalibration = rescaled;
    return rescaled;
  }

  root.updateMatrixWorld(true);
  const leftArm = joint(root, rig, 'leftArm');
  const rightArm = joint(root, rig, 'rightArm');
  const leftFore = joint(root, rig, 'leftFore');
  const rightFore = joint(root, rig, 'rightFore');
  const leftHand = joint(root, rig, 'leftHand');
  const rightHand = joint(root, rig, 'rightHand');
  const leftLeg = joint(root, rig, 'leftLeg');
  const rightLeg = joint(root, rig, 'rightLeg');
  const leftShin = joint(root, rig, 'leftShin');
  const rightShin = joint(root, rig, 'rightShin');
  const leftFoot = joint(root, rig, 'leftFoot');
  const rightFoot = joint(root, rig, 'rightFoot');

  const upper = averagePair(
    distance(worldPosition(leftArm, new THREE.Vector3()), worldPosition(leftFore, new THREE.Vector3())),
    distance(worldPosition(rightArm, new THREE.Vector3()), worldPosition(rightFore, new THREE.Vector3())),
    NaN
  );
  // The shoulder span is the distance between the two arm joints at bind. It is a body-width
  // measurement, distinct from the arm segments; the resting-arm lateral offset is derived from
  // it so a broad rig's elbow target clears the torso instead of aiming inside it.
  const shoulderWidth = distance(
    worldPosition(leftArm, new THREE.Vector3()),
    worldPosition(rightArm, new THREE.Vector3())
  );
  const fore = averagePair(
    distance(worldPosition(leftFore, new THREE.Vector3()), worldPosition(leftHand, new THREE.Vector3())),
    distance(worldPosition(rightFore, new THREE.Vector3()), worldPosition(rightHand, new THREE.Vector3())),
    Number.isFinite(upper) ? upper * 0.88 : NaN
  );
  const thigh = averagePair(
    distance(worldPosition(leftLeg, new THREE.Vector3()), worldPosition(leftShin, new THREE.Vector3())),
    distance(worldPosition(rightLeg, new THREE.Vector3()), worldPosition(rightShin, new THREE.Vector3())),
    NaN
  );
  const lower = averagePair(
    distance(worldPosition(leftShin, new THREE.Vector3()), worldPosition(leftFoot, new THREE.Vector3())),
    distance(worldPosition(rightShin, new THREE.Vector3()), worldPosition(rightFoot, new THREE.Vector3())),
    Number.isFinite(thigh) ? thigh * 0.90 : NaN
  );
  const factor = uniformScale(scale);
  const unitHeight = measureHeight(root, joint(root, rig, 'head'), leftFoot || rightFoot);
  const measuredFootHeight = measureFootHeight(root, leftFoot || rightFoot, rightFoot);
  const unit = Object.freeze({
    arm: Object.freeze({
      upper: (finite(upper) ? upper : DEFAULT_RIG_CALIBRATION.arm.upper) / factor,
      fore: (finite(fore) ? fore : DEFAULT_RIG_CALIBRATION.arm.fore) / factor,
      shoulderWidth: (finite(shoulderWidth)
        ? shoulderWidth
        : DEFAULT_RIG_CALIBRATION.arm.shoulderWidth * factor) / factor
    }),
    leg: Object.freeze({
      upper: (finite(thigh) ? thigh : DEFAULT_RIG_CALIBRATION.leg.upper) / factor,
      lower: (finite(lower) ? lower : DEFAULT_RIG_CALIBRATION.leg.lower) / factor
    }),
    footHeight: finite(measuredFootHeight) ? measuredFootHeight / factor : 0,
    height: unitHeight > 0.05 ? unitHeight / factor : 0
  });
  const source = finite(upper) && finite(fore) && finite(thigh) && finite(lower)
    ? 'bind' : 'fallback';
  const calibration = scaledProfile({ source, rigKind: rig?.kind || null, identity: resolvedIdentity, unit }, scale, resolvedIdentity);
  userData.rigCalibration = calibration;
  return calibration;
}

/** Cached calibration, or a bind-time measurement when no resolveRig() object is available. */
export function calibrationFor(root, rig = null, identity = null) {
  if (!root?.isObject3D) return DEFAULT_RIG_CALIBRATION;
  // calibrateRig() reuses a valid bind cache and retries a fallback, so a late-mounted armature
  // cannot keep the neutral values for the rest of the match.
  return calibrateRig(root, rig, { identity });
}

/** The target values the resting-arm layer should use for this rig. */
export function restingArmTargetsFor(calibration) {
  return calibration?.restingArm || DEFAULT_RIG_CALIBRATION.restingArm;
}

/** The thresholds the foot layer should use for this rig. */
export function footPlacementFor(calibration) {
  return calibration?.foot || DEFAULT_RIG_CALIBRATION.foot;
}

/** Compact, serializable report for probes and asset diagnostics. */
export function describeRigCalibration(calibration) {
  const c = calibration || DEFAULT_RIG_CALIBRATION;
  return {
    source: c.source,
    rigKind: c.rigKind || null,
    height: c.height || 0,
    scale: c.scale || null,
    arm: c.arm,
    leg: c.leg,
    restingArm: c.restingArm,
    foot: c.foot
  };
}
