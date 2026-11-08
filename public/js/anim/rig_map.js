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

// The eleven joints every rig must have for the clip library to drive a body at all.
export const CORE_BONES = Object.freeze([
  'pelvis', 'torso', 'head',
  'leftArm', 'leftFore', 'rightArm', 'rightFore',
  'leftLeg', 'leftShin', 'rightLeg', 'rightShin'
]);

// Joints that exist in the authored geometry but were never bound, so no clip could move them:
// a neck (head stabilisation and look direction), a wrist per arm (hand angle on strikes and
// grips) and an ankle per leg (heel strike, toe-off, planted foot). They extend the contract
// without breaking it: a rig that lacks them reports them as missing and still animates.
export const EXTENSION_BONES = Object.freeze([
  'spine', 'leftClavicle', 'rightClavicle',
  'neck', 'leftHand', 'rightHand', 'leftFoot', 'rightFoot'
]);

export const CANONICAL_BONES = Object.freeze([...CORE_BONES, ...EXTENSION_BONES]);

// Prefab joints live on userData under these keys (see models.js / characters/sculpted.js).
const PREFAB_KEYS = Object.freeze({
  pelvis: 'pelvis', spine: 'spine', torso: 'torso', neck: 'neck', head: 'head',
  leftClavicle: 'leftClavicle', rightClavicle: 'rightClavicle',
  leftArm: 'leftArm', leftFore: 'leftFore', leftHand: 'leftHand',
  rightArm: 'rightArm', rightFore: 'rightFore', rightHand: 'rightHand',
  leftLeg: 'leftLeg', leftShin: 'leftShin', leftFoot: 'leftFoot',
  rightLeg: 'rightLeg', rightShin: 'rightShin', rightFoot: 'rightFoot'
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
  // GLTFLoader sanitises node names, so Blender's `upperarm.l` arrives as `upperarml`: the side
  // letter ends up glued to the part name with no separator left. Accept that form, but only when
  // the text before the letter is a real limb part, so `shoulder` is not read as the right side.
  const glued = /^(.*?)([lr])$/i.exec(raw);
  // `shoulder` belongs in this list: GLTFLoader removes the dot from Blender's `DEF-shoulder.L`,
  // so the side letter is glued to `DEF-shoulder` and without it the clavicle never binds. That
  // left every Rigify body reporting `leftClavicle`/`rightClavicle` missing even though the
  // shoulder bones were present, and the roster audit failed the mounted rig for it.
  const gluedSide = glued && /(arm|hand|palm|wrist|clavicle|shoulder|leg|thigh|shin|calf|foot|ankle|toe|knee|elbow)$/i.test(glued[1])
    ? glued[2].toLowerCase() : null;
  // 3ds Max / Bip001 rigs put the side in a standalone token: `Bip001 L UpperArm_023`. GLTFLoader
  // keeps the spaces, so the side letter is neither a suffix nor glued to the part name. Without
  // this the whole arm/leg chain of a Bip rig classified as unsided and the mount failed its core
  // bone gate even though every joint was present.
  const tokenSide = /(?:^|[\s_.\-])([lr])(?=[\s_.\-]|$)/i.exec(String(rawName || ''))?.[1]?.toLowerCase() || null;
  const sideLetter = suffixSide || gluedSide || tokenSide;
  const s = raw.includes('left') ? 'left'
    : raw.includes('right') ? 'right'
    : sideLetter === 'l' ? 'left'
    : sideLetter === 'r' ? 'right'
    : null;
  if (!s) return null;
  // IK targets, roll curves and weapon sockets are helpers, not deform joints: letting them claim
  // a slot would shadow the real bone that drives the mesh.
  if (/ik|control|ctrl|roll|socket|slot|nub/.test(raw)) return null;
  // Fingers are not separately driven: the hand joint carries them as children.
  if (/finger|thumb|index|middle|ring|pinky/.test(raw)) return null;
  if (/hand|wrist|palm/.test(raw)) return s + 'Hand';
  if (/forearm|lowerarm|elbow/.test(raw)) return s + 'Fore';
  // A shoulder/clavicle is its own joint: rotating it rolls the arm from the chest instead of
  // hinging the whole arm at the socket.
  if (/clavicle|shoulder/.test(raw)) return s + 'Clavicle';
  if (/upperarm|arm/.test(raw)) return s + 'Arm';
  if (/foot|ankle|toe/.test(raw)) return s + 'Foot';
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
  if (/neck/.test(raw)) return 'neck';
  if (/head/.test(raw)) return 'head';
  if (/hips|pelvis/.test(raw)) return 'pelvis';
  // The first spine bone becomes the chest (the core contract needs a torso); a later spine bone
  // fills the extension slot, which is what gives an imported rig a multi-segment spine.
  if (/spine/.test(raw)) return 'spine';
  if (/chest|torso|abdomen|ribcage/.test(raw)) return 'torso';
  return null;
}

/** Deterministic, PropertyBinding-safe node name for a canonical bone. */
export function safeBoneName(canonical) {
  return 'bs_' + canonical;
}

/** A joint this module already renamed (`bs_leftFore`) maps straight back to its canonical id. */
function canonicalNameOf(name) {
  const match = /^bs_([A-Za-z]+)$/.exec(String(name || ''));
  return match && CANONICAL_BONES.includes(match[1]) ? match[1] : null;
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
  // Decide the two torso slots together. The old greedy rule gave the first spine-like bone the core
  // `torso` slot, so on a Hips/Spine/Chest rig the `Chest` bone was then discarded and `spine` was
  // reported unbound even though the mesh had a weighted spine. When a chest-like bone exists (or a
  // second spine bone), the spine takes its own extension slot and the chest satisfies `torso`.
  const torsoCandidates = ordered.filter(node => node.name && classifyCore(node.name));
  const spineCount = torsoCandidates.filter(node => classifyCore(node.name) === 'spine').length;
  const chestCount = torsoCandidates.filter(node => classifyCore(node.name) === 'torso').length;
  for (const node of ordered) {
    if (!node.name) continue;
    const canonical = canonicalNameOf(node.name);
    if (canonical) { if (!joints[canonical]) joints[canonical] = node; continue; }
    const core = classifyCore(node.name);
    if (core) {
      let target = core;
      if (core === 'spine') {
        target = (!joints.spine && (chestCount > 0 || spineCount > 1)) ? 'spine'
          : (!joints.torso ? 'torso' : (!joints.spine ? 'spine' : null));
      } else if (core === 'torso' && joints.torso && !joints.spine && spineCount === 0) {
        target = 'spine';
      }
      if (target && !joints[target]) { joints[target] = node; continue; }
    }
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
  const mixamo = /^mixamorig/i.test(String(joints.leftArm?.name || ''));
  // Re-resolving a live rig must not capture the pose currently being animated as its bind pose.
  // Keep the original bind rotations alongside the bind parent orientations so every later compile
  // agrees with the clips that were built first.
  if (mixamo && root.userData?.mixamoBindRest) {
    for (const [canonical, values] of Object.entries(root.userData.mixamoBindRest)) {
      if (joints[canonical] && Array.isArray(values)) rest.set(canonical, new THREE.Quaternion(...values));
    }
  }
  // Mixamo exports bind in a T-pose; the authored clip library is written as small offsets from
  // a relaxed, arms-at-the-sides stance. Without this correction every clip plays on top of the
  // T-pose, so idle looks like a bind pose and a jab reads as both arms held overhead. Rotate the
  // upper arms down once, in the model's own frame, and cache the corrected rest pose so repeated
  // resolves and resetRig() agree with the clips compiled from it.
  if (mixamo && !root.userData?.mixamoRestCorrected) {
    try {
      root.updateMatrixWorld(true);
      const rootInverse = new THREE.Quaternion();
      root.getWorldQuaternion(rootInverse).invert();
      const down = new THREE.Quaternion();
      for (const [canonical, sign] of [['leftArm', -1], ['rightArm', 1]]) {
        const node = joints[canonical];
        if (!node?.parent) continue;
        const parentWorld = new THREE.Quaternion();
        const boneWorld = new THREE.Quaternion();
        node.parent.getWorldQuaternion(parentWorld).premultiply(rootInverse);
        node.getWorldQuaternion(boneWorld).premultiply(rootInverse);
        down.setFromAxisAngle(new THREE.Vector3(0, 0, 1), sign * 1.36);
        const corrected = parentWorld.invert().multiply(down).multiply(boneWorld);
        node.quaternion.copy(corrected);
        rest.set(canonical, corrected.clone());
      }
      root.userData.mixamoRestCorrected = { arms: 1.36 };
      root.updateMatrixWorld(true);
    } catch (error) {
      console.warn('Mixamo arm rest correction unavailable:', error?.message || error);
    }
  }
  // The authored Euler values are rotations in the body frame, not rotations around each Mixamo
  // bone's own local axis. On Mixamo the arm bone points sideways, so applying "raise arm forward"
  // around its local X twists it and leaves large attack poses reading as arms held overhead. Build
  // a per-joint bind-parent orientation once and conjugate each body-frame delta into that parent
  // frame; the physical rotation is then the one the clip author intended, on any bind orientation.
  let bindParentWorld = null;
  if (mixamo) {
    const stored = root.userData?.mixamoBindParentWorld;
    if (stored) {
      bindParentWorld = new Map(Object.entries(stored).map(([key, values]) => [key, new THREE.Quaternion(...values)]));
    } else {
      root.updateMatrixWorld(true);
      const rootInverse = new THREE.Quaternion();
      root.getWorldQuaternion(rootInverse).invert();
      bindParentWorld = new Map();
      const serialized = {};
      for (const [canonical, node] of Object.entries(joints)) {
        if (!node?.parent) continue;
        const parentWorld = new THREE.Quaternion();
        node.parent.getWorldQuaternion(parentWorld).premultiply(rootInverse);
        bindParentWorld.set(canonical, parentWorld);
        serialized[canonical] = parentWorld.toArray();
      }
      root.userData.mixamoBindParentWorld = serialized;
    }
    if (!root.userData.mixamoBindRest) {
      const serialized = {};
      for (const [canonical, quaternion] of rest) serialized[canonical] = quaternion.toArray();
      root.userData.mixamoBindRest = serialized;
    }
  }
  // PropertyBinding cannot bind a track path containing '.' or ':' (Mixamo `mixamorig:LeftArm`,
  // Blender `upper_arm.L`) and the prefab joints are unnamed, so those get a deterministic safe
  // name. Names that are already binding-safe are left alone - renaming them would break the
  // model's own baked clips and make a second resolve read `bs_leftFore` as an unknown bone.
  for (const [canonical, node] of Object.entries(joints)) {
    if (node.name && !/[.:]/.test(node.name)) continue;
    node.name = safeBoneName(canonical);
  }
  // Publish the resolved joints on userData as well. The weapon mount, ground pickup, palm VFX and
  // the roster audit read `userData.rightArm` / `leftLeg` and friends, so an imported body that
  // only carried the handful of keys some other path assigned lost those lookups even though the
  // rig had resolved. Existing keys win: a prefab joint or an explicit attachment is never replaced.
  const userData = root.userData || (root.userData = {});
  for (const [canonical, node] of Object.entries(joints)) {
    if (!userData[canonical]) userData[canonical] = node;
  }
  const missing = CANONICAL_BONES.filter(b => !joints[b]);
  return {
    kind: usePrefab ? 'prefab' : 'bone',
    root,
    joints,
    rest,
    // `body` means Euler offsets are body-frame rotations (Mixamo); the default keeps the original
    // local-axis convention for the prefab and non-Mixamo imported rigs.
    retarget: mixamo ? 'body' : 'local',
    bindParentWorld,
    missing,
    // A rig is animation-ready with the core eleven; the extensions are reported separately so a
    // body without wrists or ankles is not misreported as broken.
    missingCore: CORE_BONES.filter(b => !joints[b]),
    extensions: EXTENSION_BONES.filter(b => joints[b]),
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
  if (rig.retarget === 'body') {
    const parent = rig.bindParentWorld?.get(canonical);
    if (parent) {
      // local = parent^-1 * bodyDelta * parent * rest
      return parent.clone().invert().multiply(delta).multiply(parent).multiply(rest);
    }
  }
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
