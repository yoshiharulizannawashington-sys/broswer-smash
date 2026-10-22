// Rig adapter: maps one canonical skeleton onto whichever rig the fighter actually has.
//
// The game ships two kinds of rig:
//  1. the procedurally built prefab rig (12 rigid joints exposed on model.userData), and
//  2. an imported skinned GLB/FBX rig (Mixamo, Blender, Sketchfab) with real bones.
//
// Animations are authored once in canonical bone space and compiled against whichever rig is
// bound, so the same clip library drives both. Imported clips (Mixamo/FBX) are retargeted into
// the same canonical space by the loader, which is why a downloaded clip can drive a prefab
// fighter and vice versa.
import * as THREE from 'three';

export const CANONICAL_BONES = Object.freeze([
  'pelvis', 'torso', 'head',
  'leftArm', 'leftFore', 'rightArm', 'rightFore',
  'leftLeg', 'leftShin', 'rightLeg', 'rightShin'
]);

// Prefab joints live on userData under these keys (see models.js).
const PREFAB_KEYS = Object.freeze({
  pelvis: 'pelvis', torso: 'torso', head: 'head',
  leftArm: 'leftArm', leftFore: 'leftFore', rightArm: 'rightArm', rightFore: 'rightFore',
  leftLeg: 'leftLeg', leftShin: 'leftShin', rightLeg: 'rightLeg', rightShin: 'rightShin'
});

/**
 * Classify a raw bone name into a canonical bone id.
 * Handles Mixamo (`mixamorig:LeftUpLeg`), Blender (`upper_arm.L`) and generic naming.
 * Mixamo's `LeftLeg` is the shin, so `leg` alone maps to Shin, never to the thigh.
 */
export function classifyBone(rawName) {
  const raw = String(rawName || '')
    .toLowerCase()
    .replace(/^mixamorig:?/, '')
    .replace(/[._:\-\s]/g, '');
  if (!raw) return null;
  // Blender/Maya suffix rigs carry the side as a trailing separator + L/R (upper_arm.L).
  const suffixSide = /[._\-]\s*([lr])$/i.exec(String(rawName || ''))?.[1]?.toLowerCase();
  const s = raw.includes('left') ? 'left'
    : raw.includes('right') ? 'right'
    : suffixSide === 'l' ? 'left'
    : suffixSide === 'r' ? 'right'
    : null;
  if (!s) return null;
  if (/hand|wrist|palm|finger|thumb|index|middle|ring|pinky/.test(raw)) return null;
  if (/forearm|lowerarm|elbow/.test(raw)) return s + 'Fore';
  if (/shoulder|clavicle|upperarm|arm/.test(raw)) return s + 'Arm';
  if (/upleg|thigh|upperleg/.test(raw)) return s + 'Leg';
  if (/shin|calf|lowerleg|knee|leg/.test(raw)) return s + 'Shin';
  return null;
}

function classifyCore(rawName) {
  const raw = String(rawName || '')
    .toLowerCase()
    .replace(/^mixamorig:?/, '')
    .replace(/[._:\-\s]/g, '');
  if (!raw) return null;
  if (/head|neck/.test(raw)) return 'head';
  if (/hips|pelvis/.test(raw)) return 'pelvis';
  if (/spine|chest|torso|abdomen|ribcage/.test(raw)) return 'torso';
  return null;
}

/** Deterministic, PropertyBinding-safe node name for a canonical bone. */
export function safeBoneName(canonical) {
  return 'bs_' + canonical;
}

function captureRest(node, quaternion) {
  return quaternion ? quaternion.clone() : node.quaternion.clone();
}

/**
 * Bind a canonical rig to an imported skeleton by scanning bone names.
 * `renameUnsafe` assigns safe names because Three.js AnimationMixer cannot bind a track path
 * that contains '.' or ':' (both appear in Mixamo/Blender bone names).
 */
function bindFromBones(root, { renameUnsafe = true } = {}) {
  const joints = {};
  const bones = [];
  root.traverse(node => {
    if (node === root) return;
    if (node.isBone || node.isObject3D) bones.push(node);
  });
  // Prefer bones, then named groups (Blender exports often expose empty joints as groups).
  const boneList = bones.filter(n => n.isBone);
  const ordered = boneList.length ? boneList : bones.filter(n => n.isGroup || n.isObject3D);
  for (const node of ordered) {
    if (!node.name) continue;
    const core = classifyCore(node.name);
    if (core && !joints[core]) { joints[core] = node; continue; }
    const side = classifyBone(node.name);
    if (side && !joints[side]) joints[side] = node;
  }
  return { joints, renamed: renameUnsafe };
}

/** Bind the prefab rig exposed on model.userData. */
function bindFromPrefab(root) {
  const joints = {};
  for (const [canonical, key] of Object.entries(PREFAB_KEYS)) {
    const node = root.userData?.[key];
    if (node?.isObject3D) joints[canonical] = node;
  }
  return { joints };
}

/**
 * Resolve the animation rig for a fighter model.
 * Returns { kind, joints, rest, missing, boundCount } where `rest` holds each joint's bind quaternion.
 */
export function resolveRig(root) {
  if (!root?.isObject3D) return null;
  const prefab = bindFromPrefab(root);
  const prefabCount = Object.keys(prefab.joints).length;
  const hasSkinnedMesh = (() => {
    let found = false;
    root.traverse(n => { if (n.isSkinnedMesh) found = true; });
    return found;
  })();
  const usePrefab = prefabCount >= 8 && !hasSkinnedMesh;
  const { joints } = usePrefab ? prefab : bindFromBones(root);
  const bound = Object.keys(joints);
  if (bound.length < 4) return null;

  const rest = new Map();
  for (const [canonical, node] of Object.entries(joints)) {
    rest.set(canonical, captureRest(node));
  }
  // PropertyBinding cannot bind a track path containing '.' or ':' and the prefab joints are
  // unnamed, so every animated joint gets a deterministic safe name. A rig that ships its own
  // GLB clips keeps its names (nothing is renamed here for bone rigs with baked clips).
  for (const [canonical, node] of Object.entries(joints)) {
    node.name = safeBoneName(canonical);
  }
  const missing = CANONICAL_BONES.filter(b => !joints[b]);
  return {
    kind: usePrefab ? 'prefab' : 'bone',
    root,
    joints,
    rest,
    missing,
    boundCount: bound.length
  };
}

/** Restore every joint to its bind pose (used when an animation is suspended). */
export function resetRig(rig) {
  if (!rig) return;
  for (const [canonical, node] of Object.entries(rig.joints)) {
    const rest = rig.rest.get(canonical);
    if (rest) node.quaternion.copy(rest);
  }
}

/** Euler offset (radians, XYZ) from the bind pose, expressed as an absolute local quaternion. */
export function offsetQuaternion(rig, canonical, euler) {
  const rest = rig.rest.get(canonical) || new THREE.Quaternion();
  const delta = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(euler[0] || 0, euler[1] || 0, euler[2] || 0, 'XYZ')
  );
  return rest.clone().multiply(delta);
}

/**
 * Measure a rig for the validation report: orientation, size and joint coverage.
 * Used by scripts/validate-animations.mjs and the in-page asset diagnostics.
 */
export function describeRig(rig) {
  if (!rig) return null;
  const box = new THREE.Box3().setFromObject(rig.root);
  const size = new THREE.Vector3();
  box.getSize(size);
  return {
    kind: rig.kind,
    boundCount: rig.boundCount,
    missing: rig.missing.slice(),
    height: Number(size.y.toFixed(3)),
    width: Number(size.x.toFixed(3)),
    depth: Number(size.z.toFixed(3))
  };
}
