// Iron Spider appendage stow / deploy state.
//
// The supplied Object_122 mesh is a twenty-one-bone appendage rig: one backpack bone and four
// five-bone leg chains. There is no stow or retract clip in the source library, so the fold is a
// procedural overlay on the native chain after the clip owner writes the skeleton. It never edits
// a clip, hides the mesh, swaps a model or changes joint lengths; at progress 0 the overlay is a
// no-op and the authored pose is exactly the pose the mixer produced.
//
// Fold shape: the four chains accordion into a narrow vertical stack behind the backpack. Each
// segment is aimed at a body-relative direction (back/up or back/down), so the tips finish close
// to the shoulder pack instead of sweeping across the chest or through the legs. The directions
// follow the fighter's facing, not world Z, so a turned fighter remains symmetric.
import * as THREE from 'three';

const STOW_SECONDS = 0.30;
const CHAIN_BONE = /^spider_leg_([LR])_Bone(\d{3})(?:_|$)/i;
const _parentQuat = new THREE.Quaternion();
const _worldQuat = new THREE.Quaternion();
const _desiredQuat = new THREE.Quaternion();
const _alignQuat = new THREE.Quaternion();
const _currentDir = new THREE.Vector3();
const _targetDir = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _back = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const rigCache = new WeakMap();

function rigFor(model) {
  if (!model?.isObject3D) return null;
  const arm = model.getObjectByName?.('Object_122') || null;
  if (!arm?.skeleton) return null;
  const cached = rigCache.get(model);
  if (cached?.arm === arm) return cached;

  const bones = (arm.skeleton.bones || []).filter(bone => CHAIN_BONE.test(bone.name || ''));
  const roots = bones.filter(bone => {
    const number = Number(bone.name.match(CHAIN_BONE)?.[2] || 0);
    return number === 1 || number === 6;
  });
  const chains = [];
  for (const root of roots) {
    const match = root.name.match(CHAIN_BONE);
    const chain = [];
    let bone = root;
    // Follow the actual skin hierarchy rather than trusting a name range. A different export can
    // renumber the terminal bone without moving the chain.
    while (bone && CHAIN_BONE.test(bone.name || '') && chain.length < 5) {
      chain.push(bone);
      bone = (bone.children || []).find(child => CHAIN_BONE.test(child.name || '')) || null;
    }
    if (chain.length >= 2) {
      chains.push({
        side: match?.[1]?.toUpperCase() || '?',
        group: Number(match?.[2] || 0) >= 6 ? 'lower' : 'upper',
        bones: chain
      });
    }
  }
  if (chains.length !== 4) {
    rigCache.set(model, { arm, chains: [], valid: false });
    return rigCache.get(model);
  }
  const rig = { arm, chains, valid: true };
  rigCache.set(model, rig);
  return rig;
}

function stateFor(model) {
  if (!model?.userData) return null;
  let state = model.userData.nativeSpiderStow;
  if (!state) {
    state = {
      progress: 0,
      target: 0,
      deployments: 0,
      folds: 0,
      mesh: 'Object_122',
      bones: 0,
      chains: 0,
      transitionSeconds: STOW_SECONDS
    };
    model.userData.nativeSpiderStow = state;
  }
  return state;
}

/**
 * Aim a bone's local +X segment at a world-space direction, blending from the current authored
 * direction by `amount`. The overlay is recomputed from the clip pose every frame, so there is no
 * accumulated offset and no bind-pose cache to restore.
 */
function aimBone(bone, target, amount) {
  if (!bone?.isBone || amount <= 0) return;
  bone.updateWorldMatrix(true, false);
  bone.getWorldQuaternion(_worldQuat);
  _currentDir.set(1, 0, 0).applyQuaternion(_worldQuat);
  if (_currentDir.lengthSq() < 1e-8 || target.lengthSq() < 1e-8) return;
  _alignQuat.setFromUnitVectors(_currentDir.normalize(), _targetDir.copy(target).normalize());
  // desired world = align * current world
  _desiredQuat.copy(_worldQuat).premultiply(_alignQuat);
  // At amount 0 this is the authored world rotation; at amount 1 it is the full aim.
  _desiredQuat.slerp(_worldQuat, 1 - amount);
  bone.parent.getWorldQuaternion(_parentQuat).invert();
  bone.quaternion.copy(_parentQuat.multiply(_desiredQuat));
  bone.updateWorldMatrix(true, false);
}

/**
 * Apply the native stow overlay after the active clip owner has written this frame.
 *
 * `fighter.ironSpiderStowed` is the requested state. Any attack, airborne state, hit reaction or
 * round reset clears it in Fighter3D / clearFighterCombatState; this function only turns that
 * request into a smooth, reversible fold.
 */
export function applyNativeSpiderStow(fighter, dt) {
  const model = fighter?.model;
  if (!model || fighter.identityKey !== 'iron_spider') return null;
  const state = stateFor(model);
  const rig = rigFor(model);
  if (!state || !rig?.valid) return state;
  state.mesh = rig.arm.name;
  state.bones = rig.arm.skeleton?.bones?.length || 0;
  state.chains = rig.chains.length;

  const busy = fighter.hitstun > 0 || fighter.ko || (fighter.victoryPose || 0) > 0 || fighter.casting
    || fighter.attackQueue?.length > 0 || fighter.grabTarget || fighter.grabbedBy
    || fighter.flightMode || !fighter.isGrounded;
  const target = fighter.ironSpiderStowed && !busy ? 1 : 0;
  if (target !== state.target) {
    state.target = target;
    if (target) state.folds += 1;
    else state.deployments += 1;
  }
  const step = Math.max(0, Number(dt) || 0);
  if (step > 0) {
    state.progress = THREE.MathUtils.damp(state.progress, target, 12, step);
    if (Math.abs(state.progress - target) < 0.001) state.progress = target;
  }
  const fold = state.progress <= 0 ? 0 : state.progress * state.progress * (3 - 2 * state.progress);
  state.fold = fold;
  if (fold <= 0) return state;

  _forward.set(fighter.facing || 1, 0, fighter.facingZ || 0).normalize();
  _right.set(-_forward.z, 0, _forward.x).normalize();
  _back.copy(_forward).negate();

  const verticalPattern = {
    upper: [0.35, -0.95, 0.85, -0.95, 0.45],
    lower: [-0.35, 0.95, -0.85, 0.95, -0.45]
  };
  const depthPattern = [0.58, 0.10, 0.44, 0.10, 0.58];
  for (const chain of rig.chains) {
    const side = chain.side === 'L' ? -1 : 1;
    const lift = verticalPattern[chain.group];
    for (let index = 0; index < chain.bones.length; index++) {
      // A shallow fan at the root, then a tight back/vertical accordion. The alternating vertical
      // directions keep the five segments stacked around the backpack instead of turning the last
      // bone into a tall antenna; the two sides mirror outward so they cannot cross the torso.
      const sideBias = index === 0 ? 0.20 * side : index === 4 ? 0.08 * side : 0.04 * side;
      _targetDir.copy(_back).multiplyScalar(depthPattern[index])
        .addScaledVector(_right, sideBias)
        .addScaledVector(_up, lift[index] * (chain.bones.length === 5 ? 1 : 0));
      aimBone(chain.bones[index], _targetDir, fold);
    }
  }
  rig.arm.skeleton.update?.();
  return state;
}

/** Restore the authored bind/idle pose on a round reset so a rematch never starts folded. */
export function resetNativeSpiderStow(fighter) {
  if (fighter?.identityKey !== 'iron_spider') return;
  const state = stateFor(fighter?.model);
  if (!state) return;
  state.progress = 0;
  state.target = 0;
  state.fold = 0;
}
