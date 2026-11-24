import * as THREE from 'three';
import { calibrationFor, restingArmTargetsFor } from './rig_calibration.js';

/**
 * Lower an upper arm whose elbow is still held out near shoulder height.
 *
 * Source rigs from different exporters all express the same defect differently: the idle is an
 * A-pose with the elbow 15-25 cm below the shoulder, or a T-pose with it level. The elbow is the
 * primary test, but two measured limits keep an authored pose intact: an elbow folded inside the
 * shoulder line is already resting, and a correction that lifts the hand is not a settle. A
 * relaxed arm whose hand already hangs to its measured reach is left untouched.
 *
 * This aims the upper arm only. The forearm, wrist and fingers keep their source pose, which keeps
 * a bent guard or a source idle's character instead of replacing it with a canned stance.
 */
export function settleRestingArms(root) {
  const u = root?.userData;
  if (!u?.leftArm || !u.rightArm || !u.leftFore || !u.rightFore) return false;
  root.updateMatrixWorld(true);
  // Bind-time proportions, not a fixed adult's offsets: a long-limbed Hulk gets a longer elbow
  // drop and a wider reach trigger than a 1.8 m Infantry body. The fallback is the old neutral
  // profile only for a rig that has not been calibrated yet.
  const calibration = calibrationFor(root);
  const targets = restingArmTargetsFor(calibration);
  const trigger = targets.trigger;
  const drop = Math.max(targets.elbow?.min ?? 0, Math.min(targets.drop, targets.elbow?.max ?? targets.drop));
  const side = targets.side;
  const forward = targets.forward;
  const restReach = targets.reach ?? calibration.arm.reach * 0.95;
  const handRise = targets.handRise ?? Math.max(0.01, calibration.arm.reach * 0.02);
  const ls = u.leftArm.getWorldPosition(new THREE.Vector3());
  const rs = u.rightArm.getWorldPosition(new THREE.Vector3());
  const le = u.leftFore.getWorldPosition(new THREE.Vector3());
  const re = u.rightFore.getWorldPosition(new THREE.Vector3());
  const leftHand = u.leftHand?.isObject3D ? u.leftHand : null;
  const rightHand = u.rightHand?.isObject3D ? u.rightHand : null;
  const lh = leftHand?.getWorldPosition(new THREE.Vector3()) || null;
  const rh = rightHand?.getWorldPosition(new THREE.Vector3()) || null;
  const lateral = ls.clone().sub(rs).setY(0);
  if (lateral.lengthSq() < 1e-8) lateral.set(1, 0, 0); else lateral.normalize();
  const elbowLateral = targets.elbow?.lateral ?? calibration.arm.shoulderWidth * 0.03;
  const leftElbowSide = le.clone().sub(ls).setY(0).dot(lateral);
  // Right is outward in the negative lateral direction; normalize both sides to "outward".
  const rightElbowSide = -re.clone().sub(rs).setY(0).dot(lateral);
  const leftHigh = le.y >= ls.y - trigger;
  const rightHigh = re.y >= rs.y - trigger;
  const leftNeeds = leftHigh && leftElbowSide >= -elbowLateral;
  const rightNeeds = rightHigh && rightElbowSide >= -elbowLateral;
  u.restingArmTargets = {
    source: calibration.source,
    armReach: calibration.arm.reach,
    shoulderWidth: calibration.arm.shoulderWidth,
    trigger: +trigger.toFixed(4),
    drop: +drop.toFixed(4),
    side: +side.toFixed(4),
    forward: +forward.toFixed(4),
    restReach: +restReach.toFixed(4),
    handRise: +handRise.toFixed(4),
    elbowLimit: +drop.toFixed(4),
    elbowLateral: +elbowLateral.toFixed(4),
    leftTriggered: leftHigh,
    rightTriggered: rightHigh,
    leftElbowSide: +leftElbowSide.toFixed(4),
    rightElbowSide: +rightElbowSide.toFixed(4),
    leftEligible: leftNeeds,
    rightEligible: rightNeeds
  };
  if (!leftNeeds && !rightNeeds) return false;

  const q = root.getWorldQuaternion(new THREE.Quaternion());
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q).setY(0);
  if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, 1); else fwd.normalize();

  // The upper-arm target is only safe while the hand is allowed to follow it. A forearm on its
  // source pose can be bent well away from the upper arm, so rotating a level upper arm down can
  // swing that forearm upward. Cap the correction at the hand's measured rise budget; if the hand
  // was already below its rest reach target, treat the source pose as intentional and leave it.
  const limitedDelta = (delta, handFrom, shoulder, currentHandY) => {
    const angle = 2 * Math.acos(THREE.MathUtils.clamp(delta.w, -1, 1));
    if (!(angle > 1e-5)) return null;
    const axis = new THREE.Vector3(delta.x, delta.y, delta.z);
    if (axis.lengthSq() < 1e-10) return null;
    axis.normalize();
    const probe = new THREE.Vector3();
    const step = new THREE.Quaternion();
    const ceiling = currentHandY + handRise;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      probe.copy(handFrom).applyQuaternion(step.setFromAxisAngle(axis, angle * mid));
      if (shoulder.y + probe.y <= ceiling) lo = mid;
      else hi = mid;
    }
    // A token correction is not worth changing an authored pose for.
    if (lo < 0.08) return null;
    return new THREE.Quaternion().setFromAxisAngle(axis, angle * lo);
  };

  const target = new THREE.Vector3();
  const applied = { left: false, right: false };
  const guards = u.restingArmGuards || (u.restingArmGuards = {});
  const aim = (arm, fore, hand, handPosition, shoulder, sign, needs, key) => {
    if (!needs) return;
    target.copy(shoulder)
      .addScaledVector(lateral, side * sign)
      .addScaledVector(fwd, forward);
    target.y = shoulder.y - drop;
    const from = fore.getWorldPosition(new THREE.Vector3()).sub(shoulder);
    const to = target.clone().sub(shoulder);
    if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8) return;
    let delta = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
    let limited = false;
    if (handPosition) {
      const handFrom = handPosition.clone().sub(shoulder);
      const predictedRise = handFrom.clone().applyQuaternion(delta).y - handFrom.y;
      if (predictedRise > handRise) {
        // Hands already hanging below the rig's own rest reach are source-authored, not a T-pose.
        // Leave them and their bent/behind-back arm pose untouched.
        if (handFrom.y < -restReach) return;
        // A frozen mixer (audit/capture) does not rewrite the source pose between frames. Without
        // this guard a capped correction would be applied again to its own result and ratchet the
        // hand up past the budget. A moving mixer writes the raw pose back, so it still recomputes.
        const previous = guards[key];
        if (previous
          && Math.abs(arm.quaternion.dot(previous.quaternion)) > 0.999999
          && Math.abs(handPosition.y - previous.handY) < 1e-4) return;
        delta = limitedDelta(delta, handFrom, shoulder, handPosition.y);
        if (!delta) return;
        limited = true;
      }
    }
    const world = arm.getWorldQuaternion(new THREE.Quaternion());
    const parent = arm.parent?.getWorldQuaternion(new THREE.Quaternion()) || new THREE.Quaternion();
    arm.quaternion.slerp(parent.invert().multiply(delta).multiply(world), 1);
    arm.updateWorldMatrix(true, true);
    if (limited) {
      guards[key] = {
        quaternion: arm.quaternion.clone(),
        handY: hand?.getWorldPosition(new THREE.Vector3()).y ?? handPosition.y
      };
    } else delete guards[key];
    applied[key] = true;
  };
  aim(u.leftArm, u.leftFore, leftHand, lh, ls, 1, leftNeeds, 'left');
  aim(u.rightArm, u.rightFore, rightHand, rh, rs, -1, rightNeeds, 'right');
  u.restingArmTargets.leftApplied = applied.left;
  u.restingArmTargets.rightApplied = applied.right;
  return applied.left || applied.right;
}
