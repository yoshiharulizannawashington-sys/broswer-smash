// State-aware weapon carry and stow poses.
//
// The existing equipment_state.js owns visibility (grip / two-handed / hidden). This module owns
// the body language around that state: a low ready carry while moving, a two-handed grip while
// guarding or attacking, and a back-mounted stow pose that leaves the hands free. It is a
// presentation layer only; hitboxes, reach, damage and input timing never read it.
//
// Idle arm pose is deliberately a no-op. The current idle arms are the authored source pose, and
// the previous arm-settle pass showed how expensive an uncalled-for idle change is. The first frame
// after a clip write is always the clip's pose; this module only adds arm offsets for moving or
// committed states. The prop itself may receive a small forward tilt for body clearance, without
// writing an arm bone.
//
// Starting pilots:
//   Thor        - Stormbreaker, one-handed carry, two-handed guard/attacks.
//   Kaze        - the one-sword launch fighter, two-handed carry and committed poses.
import * as THREE from 'three';

export const WEAPON_CARRY_IDS = new Set(['thor', 'kaze']);

const CARRY_STATES = new Set(['walk', 'run', 'dash']);
const TWO_HANDED_STATES = new Set(['block', 'attack-startup', 'attack-active', 'attack-recovery']);

const POLICIES = Object.freeze({
  thor: Object.freeze({
    label: 'Stormbreaker',
    twoHandedCarry: false,
    carryDrop: 0.46,
    carryOut: 0.42,
    carryForward: 0.34,
    carryTilt: 0.34,
    twoHandedRoll: 0.32,
    idleTilt: 0.30,
    // The raised grip puts Stormbreaker's head at hip height. Keep the original yaw that leaves
    // the grip readable, and roll the shaft outward so the head sits forward beside the hip. From
    // behind, only the hammer poll edges past the cape; the broad head is not a back silhouette.
    idleYaw: -0.80,
    idleRoll: -0.55,
    // The ultimate's authored pose brings the hand up beside the face. Keep the head forward of the
    // shoulder rather than yawing it behind the back, and roll the shaft outward so the head sits
    // beside the arm. It reads at the side from behind, not across the back. Idle arms untouched.
    ultimateTilt: 0.30,
    ultimateYaw: -1.00,
    ultimateRoll: -0.75,
    stow: Object.freeze({ back: 0.24, drop: 0.10, yaw: 0.20, pitch: 0.02, roll: -0.32 })
  }),
  kaze: Object.freeze({
    label: 'Sword',
    twoHandedCarry: true,
    carryDrop: 0.29,
    carryOut: 0.34,
    carryForward: 0.32,
    carryTilt: 0.20,
    twoHandedRoll: 0.08,
    idleTilt: 0.12,
    stow: Object.freeze({ back: 0.30, drop: 0.16, yaw: 0.16, pitch: 0.04, roll: -0.68 })
  })
});

let enabled = true;
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _box = new THREE.Box3();
const _identity = new THREE.Quaternion();

function keyOf(fighter) {
  return String(fighter?.identityKey || fighter?.identity || fighter?.name || '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function policyFor(fighter) {
  return POLICIES[keyOf(fighter)] || null;
}

export function isWeaponCarryFighter(fighter) {
  return Boolean(policyFor(fighter));
}

/** Test/authoring bypass; the live game leaves this enabled. */
export function setWeaponCarryEnabled(next = true) {
  enabled = Boolean(next);
  return enabled;
}

export function weaponCarryEnabled() {
  return enabled;
}

if (typeof window !== 'undefined') {
  window.__browserSmashSetWeaponCarry = setWeaponCarryEnabled;
  window.__browserSmashWeaponCarryEnabled = weaponCarryEnabled;
}

function worldBone(root, bone, out) {
  if (!bone) return null;
  bone.updateWorldMatrix(true, false);
  return bone.getWorldPosition(out);
}

/** Rotate `bone` so its child points at a world target, expressed as a local quaternion. */
function aimBoneAt(bone, child, target, weight) {
  if (!bone || !child || weight <= 0) return;
  bone.updateWorldMatrix(true, false);
  child.updateWorldMatrix(true, false);
  const origin = bone.getWorldPosition(_v);
  const from = child.getWorldPosition(_v2).sub(origin);
  const to = target.clone().sub(origin);
  if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8) return;
  from.normalize();
  to.normalize();
  const delta = _q.setFromUnitVectors(from, to);
  const world = bone.getWorldQuaternion(_q2);
  const parent = bone.parent?.getWorldQuaternion(new THREE.Quaternion()) || _identity;
  const desiredLocal = parent.invert().multiply(delta.multiply(world));
  bone.quaternion.slerp(desiredLocal, weight);
  bone.updateWorldMatrix(true, true);
}

/**
 * Two-bone reach: place the elbow so the wrist can actually arrive at the target. The simpler
 * aim-only helper is fine for a bow at arm's length, but it makes a close two-handed grip stop
 * with both palms short of the shaft, leaving a hand-sized gap.
 */
function solveTwoBone(bone, child, hand, target, pole, weight) {
  if (!bone || !child || !hand || weight <= 0) return false;
  bone.updateWorldMatrix(true, false);
  child.updateWorldMatrix(true, false);
  hand.updateWorldMatrix(true, false);
  const shoulder = bone.getWorldPosition(new THREE.Vector3());
  const elbow = child.getWorldPosition(new THREE.Vector3());
  const wrist = hand.getWorldPosition(new THREE.Vector3());
  const upper = shoulder.distanceTo(elbow);
  const fore = elbow.distanceTo(wrist);
  if (upper < 1e-4 || fore < 1e-4) return false;
  const offset = target.clone().sub(shoulder);
  const wanted = offset.length();
  const min = Math.abs(upper - fore) + 0.002;
  const max = upper + fore - 0.002;
  if (wanted < 1e-6) return false;
  const distance = THREE.MathUtils.clamp(wanted, min, max);
  const direction = offset.normalize();
  const reachable = shoulder.clone().addScaledVector(direction, distance);
  const along = (upper * upper - fore * fore + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upper * upper - along * along));
  const poleDir = pole.clone().addScaledVector(direction, -pole.dot(direction));
  if (poleDir.lengthSq() < 1e-8) poleDir.set(0, -1, 0); else poleDir.normalize();
  const elbowTarget = shoulder.clone().addScaledVector(direction, along).addScaledVector(poleDir, height);
  aimBoneAt(bone, child, elbowTarget, weight);
  aimBoneAt(child, hand, reachable, weight);
  return true;
}

function targetOffsets(fighter, shoulder, forward, right, up, policy, mode) {
  const target = shoulder.clone()
    .addScaledVector(forward, policy.carryForward || 0.24)
    .addScaledVector(right, policy.carryOut)
    .addScaledVector(up, -policy.carryDrop);
  const report = { adjusted: false, headGap: null, cameraGap: null };
  const head = worldBone(fighter.model, fighter.model?.userData?.head, _v3);
  if (head && target.distanceTo(head) < 0.34) {
    target.addScaledVector(right, 0.12).addScaledVector(up, -0.08);
    report.adjusted = true;
    report.headGap = +target.distanceTo(head).toFixed(3);
  }
  const torso = worldBone(fighter.model, fighter.model?.userData?.torso, _v3);
  if (torso && target.distanceTo(torso) < 0.30) {
    target.addScaledVector(forward, 0.08).addScaledVector(right, 0.10);
    report.adjusted = true;
  }
  // The fighting camera normally sits 3-6 m away. This only fires when a staged/close camera is
  // inside the carry volume; the hand and prop then move out and down rather than crossing the lens.
  const camera = typeof window !== 'undefined' ? window.__browserSmashCamera : null;
  if (camera?.position) {
    const gap = camera.position.distanceTo(target);
    report.cameraGap = +gap.toFixed(3);
    if (gap < 1.25) {
      target.addScaledVector(right, 0.10).addScaledVector(up, -0.08);
      report.adjusted = true;
    }
  }
  return { target, report, mode };
}

function poseCarryArm(fighter, policy, weight) {
  const u = fighter.model?.userData;
  if (!u?.rightArm || !u.rightFore || !u.rightHand) return null;
  fighter.model.updateMatrixWorld(true);
  const q = fighter.model.getWorldQuaternion(_q);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize();
  const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(q).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const shoulder = worldBone(fighter.model, u.rightArm, _v);
  if (!shoulder) return null;
  const { target, report } = targetOffsets(fighter, shoulder, forward, right, up, policy, 'carry');
  const pole = right.clone().addScaledVector(up, 0.38);
  solveTwoBone(u.rightArm, u.rightFore, u.rightHand, target, pole, weight);
  return { target, report, hand: 'right' };
}

function poseTwoHandedGrip(fighter, weight, { forward: forwardAmount = 0.44, out = 0.04, drop = 0.10 } = {}) {
  const u = fighter.model?.userData;
  if (!u?.leftArm || !u.leftFore || !u.leftHand || !u.rightArm || !u.rightFore || !u.rightHand) return null;
  fighter.model.updateMatrixWorld(true);
  const q = fighter.model.getWorldQuaternion(_q);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize();
  const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(q).normalize();
  const left = new THREE.Vector3(1, 0, 0).applyQuaternion(q).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const chest = worldBone(fighter.model, u.torso || u.pelvis, new THREE.Vector3());
  const lShoulder = worldBone(fighter.model, u.leftArm, new THREE.Vector3());
  const rShoulder = worldBone(fighter.model, u.rightArm, new THREE.Vector3());
  if (!chest || !lShoulder || !rShoulder) return null;
  // A common grip point in front of the sternum keeps both elbows out of the ribs and puts the
  // weapon where the camera can read it. The offhand closes just below the dominant hand.
  // Keep the common grip close enough to the sternum that both shoulders can reach it. A point
  // far forward looks like a two-handed pose in a diagram, but both palms stop at their own max
  // extension and never meet on the shaft.
  const grip = chest.clone()
    .addScaledVector(forward, forwardAmount)
    .addScaledVector(right, out)
    .addScaledVector(up, drop);
  // Shared body/camera clearance for the two-hand grip. The head/torso checks keep the shaft
  // out of the face; the camera check only fires for a close staged shot.
  const head = worldBone(fighter.model, u.head, _v3);
  if (head && grip.distanceTo(head) < 0.34) {
    grip.addScaledVector(forward, 0.10).addScaledVector(right, 0.10).addScaledVector(up, -0.04);
  }
  const torso = worldBone(fighter.model, u.torso, _v3);
  if (torso && grip.distanceTo(torso) < 0.30) grip.addScaledVector(forward, 0.08);
  const camera = typeof window !== 'undefined' ? window.__browserSmashCamera : null;
  if (camera?.position && camera.position.distanceTo(grip) < 1.25) {
    grip.addScaledVector(right, 0.09).addScaledVector(up, -0.06);
  }
  const rightTarget = grip.clone().addScaledVector(right, 0.012);
  const leftTarget = grip.clone().addScaledVector(up, -0.105).addScaledVector(left, 0.018);
  const rPole = right.clone().addScaledVector(up, 0.38);
  const lPole = left.clone().addScaledVector(up, 0.38);
  solveTwoBone(u.rightArm, u.rightFore, u.rightHand, rightTarget, rPole, weight);
  solveTwoBone(u.leftArm, u.leftFore, u.leftHand, leftTarget, lPole, weight);
  return { rightTarget, leftTarget, mode: 'two-handed' };
}

function poseTwoHandedLeft(fighter, weight) {
  const u = fighter.model?.userData;
  if (!u?.leftArm || !u.leftFore || !u.leftHand || !u.rightHand) return null;
  fighter.model.updateMatrixWorld(true);
  const q = fighter.model.getWorldQuaternion(_q);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize();
  const left = new THREE.Vector3(1, 0, 0).applyQuaternion(q).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const rightHand = worldBone(fighter.model, u.rightHand, _v);
  const shoulder = worldBone(fighter.model, u.leftArm, _v2);
  if (!rightHand || !shoulder) return null;
  // The left palm closes just below the right palm on the shaft. The right hand owns the actual
  // grip position; this does not reinterpret the weapon's authored offset.
  const target = rightHand.clone()
    .addScaledVector(up, -0.105)
    .addScaledVector(forward, 0.028)
    .addScaledVector(left, 0.012);
  const toTarget = target.clone().sub(shoulder);
  if (toTarget.length() > 0.62) {
    // A cross-body swing can put the right hand outside the left arm's reach. Keep the elbow
    // path readable instead of hyperextending the shoulder.
    target.copy(shoulder).addScaledVector(toTarget.normalize(), 0.60);
  }
  const pole = left.clone().addScaledVector(up, 0.38);
  solveTwoBone(u.leftArm, u.leftFore, u.leftHand, target, pole, weight);
  return { target, hand: 'left' };
}

function weaponFor(fighter) {
  const u = fighter?.model?.userData;
  return u?.equippedWeaponRight || null;
}

function gapToBox(point, box) {
  if (!point || !box || box.isEmpty()) return null;
  const clamped = point.clone().clamp(box.min, box.max);
  return point.distanceTo(clamped);
}

function measureClearance(fighter, weapon) {
  if (!weapon) return null;
  weapon.updateWorldMatrix(true, true);
  _box.setFromObject(weapon);
  if (_box.isEmpty()) return null;
  const center = _box.getCenter(new THREE.Vector3());
  const u = fighter.model?.userData;
  const head = worldBone(fighter.model, u?.head, new THREE.Vector3());
  const torso = worldBone(fighter.model, u?.torso, new THREE.Vector3());
  const camera = typeof window !== 'undefined' ? window.__browserSmashCamera : null;
  return {
    center: center.toArray().map(v => +v.toFixed(3)),
    bodyGap: head ? +(Math.min(
      gapToBox(head, _box) - 0.16,
      torso ? gapToBox(torso, _box) - 0.24 : Infinity
    )).toFixed(3) : null,
    cameraGap: camera?.position ? +(camera.position.distanceTo(center) - _box.getBoundingSphere(new THREE.Sphere()).radius).toFixed(3) : null,
    floorGap: +(_box.min.y - (fighter.position?.y || 0)).toFixed(3)
  };
}

/**
 * Pose the body before syncEquippedWeapons. The weapon holder is moved to the hand by that sync;
 * this function never touches the holder.
 */
export function applyWeaponCarryPoses(fighter, dt = 1 / 60) {
  if (!enabled || !fighter?.model?.userData) return null;
  const policy = policyFor(fighter);
  if (!policy) return null;
  const u = fighter.model.userData;
  const state = String(fighter.state || 'idle');
  const stowed = Boolean(fighter.weaponStowed);
  const castingUltimate = !stowed && fighter.casting === 'ultimate';
  const ultimatePose = castingUltimate
    && (policy.ultimateTilt !== undefined || policy.ultimateYaw !== undefined);
  const targetWeight = stowed ? 0 : (CARRY_STATES.has(state) || TWO_HANDED_STATES.has(state) ? 1 : 0);
  const weight = u.weaponCarryWeight = THREE.MathUtils.damp(u.weaponCarryWeight || 0, targetWeight, 14, dt);
  u.weaponCarry = {
    enabled: true,
    identity: keyOf(fighter),
    label: policy.label,
    state,
    mode: stowed ? 'stow' : ultimatePose ? 'ultimate'
      : TWO_HANDED_STATES.has(state) ? 'two-handed' : CARRY_STATES.has(state) ? 'carry' : 'idle',
    weight: +weight.toFixed(3),
    stowed,
    // A stowed weapon is moved by the mount pass only; it does not add an arm pose. Idle,
    // inherited and ultimate states likewise leave the authored arms exactly as the clip wrote them.
    idleArmsUntouched: stowed || castingUltimate
      || (!CARRY_STATES.has(state) && !TWO_HANDED_STATES.has(state))
  };
  if (stowed || weight < 0.002) return u.weaponCarry;
  let report = null;
  if (TWO_HANDED_STATES.has(state)) {
    // Guard is a held two-hand silhouette, so both hands own the grip. An attack keeps the
    // authored right-arm swing and adds only the offhand, which preserves the strike arc.
    const both = state === 'block' ? poseTwoHandedGrip(fighter, weight) : null;
    const left = both ? null : poseTwoHandedLeft(fighter, weight);
    report = both ? { mode: 'two-handed', rightTarget: both.rightTarget.toArray().map(v => +v.toFixed(3)),
      leftTarget: both.leftTarget.toArray().map(v => +v.toFixed(3)) }
      : left ? { mode: 'two-handed', leftTarget: left.target.toArray().map(v => +v.toFixed(3)) } : null;
  } else if (CARRY_STATES.has(state)) {
    if (policy.twoHandedCarry) {
      const both = poseTwoHandedGrip(fighter, weight, { forward: 0.36, drop: 0.02 });
      report = both ? { mode: 'two-handed-carry', rightTarget: both.rightTarget.toArray().map(v => +v.toFixed(3)),
        leftTarget: both.leftTarget.toArray().map(v => +v.toFixed(3)) } : null;
    } else {
      const right = poseCarryArm(fighter, policy, weight);
      report = right ? { mode: 'carry', rightTarget: right.target.toArray().map(v => +v.toFixed(3)), clearance: right.report } : null;
    }
  }
  if (report) Object.assign(u.weaponCarry, report);
  return u.weaponCarry;
}

/**
 * Apply the post-sync prop adjustment. Carry and idle keep the hand position written by
 * syncEquippedWeapons and only tilt the prop for body clearance; a stowed weapon is repositioned
 * on the back. A hidden prop (equipment fade) is never resurrected by this pass.
 */
export function applyWeaponStowPose(fighter) {
  if (!enabled || !fighter?.model?.userData) return null;
  const policy = policyFor(fighter);
  if (!policy) return null;
  const u = fighter.model.userData;
  const weapon = weaponFor(fighter);
  const holder = weapon?.parent;
  if (!holder) return null;
  const stowed = Boolean(fighter.weaponStowed);
  if (!stowed) {
    // Tilt the carried prop forward around its grip. The hand stays on the handle, but the head or
    // blade no longer hangs back through the chest. Idle arms are untouched; only the prop tilts.
    const mode = u.weaponCarry?.mode;
    if (mode === 'idle' || mode === 'ultimate' || mode === 'carry'
      || mode === 'two-handed' || mode === 'two-handed-carry') {
      const idle = mode === 'idle' || mode === 'ultimate';
      const tilt = mode === 'ultimate' ? policy.ultimateTilt : idle ? policy.idleTilt : policy.carryTilt;
      const yaw = mode === 'ultimate' ? policy.ultimateYaw : mode === 'idle' ? policy.idleYaw : 0;
      const roll = mode === 'two-handed' ? policy.twoHandedRoll
        : mode === 'ultimate' ? (policy.ultimateRoll || 0)
          : mode === 'idle' ? (policy.idleRoll || 0) : 0;
      holder.quaternion.multiply(new THREE.Quaternion().setFromEuler(
        new THREE.Euler(tilt || 0, yaw || 0, roll || 0)
      ));
    }
    u.weaponCarryClearance = measureClearance(fighter, weapon);
    return u.weaponCarryClearance;
  }
  if (!weapon.visible || (weapon.userData?.equipmentFade ?? 1) <= 0.01) {
    u.weaponCarryClearance = null;
    return null;
  }
  fighter.model.updateMatrixWorld(true);
  const q = fighter.model.getWorldQuaternion(_q);
  const back = new THREE.Vector3(0, 0, -1).applyQuaternion(q).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const torso = worldBone(fighter.model, u.torso || u.pelvis, new THREE.Vector3());
  if (!torso) return null;
  const target = torso
    .addScaledVector(back, policy.stow.back)
    .addScaledVector(up, -policy.stow.drop);
  holder.position.copy(fighter.model.worldToLocal(target));
  // The holder is a model-space child; the authored prop axes stay intact. A diagonal back carry
  // keeps the blade/head out of the face and behind the silhouette.
  holder.rotation.set(policy.stow.pitch, policy.stow.yaw, policy.stow.roll);
  holder.updateMatrixWorld(true);
  u.weaponCarry = {
    ...(u.weaponCarry || {}),
    mode: 'stow',
    stowed: true,
    backMount: holder.position.toArray().map(v => +v.toFixed(3))
  };
  u.weaponCarryClearance = measureClearance(fighter, weapon);
  return u.weaponCarryClearance;
}

/** Read-only report for probes and the asset diagnostics surface. */
export function describeWeaponCarry(fighter) {
  if (!fighter?.model?.userData) return null;
  return {
    ...(fighter.model.userData.weaponCarry || null),
    clearance: fighter.model.userData.weaponCarryClearance || null,
    enabled
  };
}
