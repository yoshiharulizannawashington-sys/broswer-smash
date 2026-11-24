// Bind-pose-aware skeleton retargeting.
//
// `retargetClip()` in animation_loader.js only renames tracks into the game's canonical
// eleven-bone space. That is enough for Mixamo-like rigs, but not for a body whose hierarchy
// has a different rest pose, extra spine/limb bones and a different bind orientation. This
// module samples a source clip and solves each destination joint from a world-space rest delta:
//
//   destinationWorld = deltaWorld * destinationRestWorld
//   destinationLocal = inverse(parentWorld) * destinationWorld
//
// The source clip never writes destination positions or scales, so gameplay physics keeps
// ownership of the fighter's root. Unmapped destination bones inherit their animated parent and
// keep their own rest local transform; extra hair, face and finger bones are therefore preserved
// without being guessed onto an unrelated joint.
import * as THREE from 'three';
import { classifyBone } from './rig_map.js';

const IDENTITY = new THREE.Quaternion();

function clean(name) {
  return String(name || '').replace(/^.*:/, '').toLowerCase();
}

function sideOf(name) {
  const raw = String(name || '');
  const lower = raw.toLowerCase();
  if (/\bleft\b/.test(lower)) return 'left';
  if (/\bright\b/.test(lower)) return 'right';
  const token = /(?:^|[._\-\s])([lr])(?=[._\-\s]|$)/i.exec(raw)?.[1];
  return token ? (token.toLowerCase() === 'l' ? 'left' : 'right') : null;
}

function trunkKey(name) {
  const n = clean(name);
  // Blender/Sketchfab spine chains are exported as `spine_01`, `Spine_02` or `spine01`. The
  // separator and the numeric index defeated both the `spine$` and the `spine1` patterns, so an
  // imported body's whole torso stayed on its bind pose while only the limbs animated.
  const compact = n.replace(/[._\-\s]+\d+$/, '').replace(/[._\-\s]/g, '');
  // A side-suffixed `pelvisL`/`pelvisR` is a buttock bone, not the body root.
  if (/(waist|hips|pelvis)/.test(compact) && !/[lr]$/.test(compact)) return 'pelvis';
  // The spine index is the number immediately after the word, not the whole trailing digit run.
  // Sketchfab/UE exports append their own bone id (`spine_01_142_12`), so reading every trailing
  // digit as the index made every segment parse as a high index: all five Miles spine bones
  // classified as `torso`, the lowest took the only torso slot, and the source `Spine` track had
  // no destination (`missing: ["spine"]` on all 25 retargeted clips). Parse the semantic index.
  const spineIndex = /^spine[._\-\s]*(\d+)/.exec(n);
  if (/^spine/.test(n)) return Number(spineIndex?.[1] || 0) >= 2 ? 'torso' : 'spine';
  // Mixamo spells the upper spine `Spine1`/`Spine2`; both are torso joints. Without this, a 19-bone
  // source clip's Chest track had no destination and the whole upper body stayed in its rest pose.
  if (/spine[23]|chest|torso|ribcage/.test(compact)) return 'torso';
  if (/neck/.test(compact)) return 'neck';
  if (/head/.test(compact)) return 'head';
  return null;
}

/**
 * Rigify exports carry a parallel DEF- deform chain beside static ORG-/MCH- helpers. The helpers
 * are often earlier in the node list but keep a two-key bind pose, so they must not shadow the
 * animated DEF chain. These explicit names also put DEF-spine (the pelvis in this rig) in the
 * pelvis slot instead of the generic spine slot.
 */
function rigifySourceKey(name) {
  const n = clean(name);
  if (/^def-spine$/.test(n)) return 'pelvis';
  if (/^def-spine[._]?001$/.test(n)) return 'spine';
  if (/^def-spine[._]?003$/.test(n)) return 'torso';
  if (/^def-spine[._]?004$/.test(n)) return 'neck';
  if (/^def-spine[._]?005$/.test(n)) return 'head';
  const limb = /^def-(shoulder|upper_arm|forearm|hand|thigh|shin|foot)[._-]?([lr])$/.exec(n);
  if (limb) {
    const side = limb[2] === 'l' ? 'left' : 'right';
    const slot = {
      shoulder: 'Clavicle', upper_arm: 'Arm', forearm: 'Fore', hand: 'Hand',
      thigh: 'Leg', shin: 'Shin', foot: 'Foot'
    }[limb[1]];
    return side + slot;
  }
  return null;
}

function sourceBoneRank(name) {
  const n = clean(name);
  if (/^def-/.test(n)) return 0;
  if (/^(?:org|mch|vis)-/.test(n)) return 2;
  return 1;
}

/**
 * MFF/Unreal Bip001 exports spell the trunk `Bip001_Spine_012` and `Bip001_Spine1_014`.
 * The trailing number on the first is the exporter's bone id, not a spine index, so treating
 * every number as the index made both bones classify as `torso`; the lower spine then had no
 * destination and the retarget dropped 2 of the 19 canonical joints. Only a digit immediately
 * after `Spine` is the semantic index (the MFF upper spine is `Spine1`).
 */
function mffSpineKey(name) {
  const match = /^bip001[\s._-]+spine(\d*)(?:[\s._-]|$)/.exec(clean(name));
  if (!match) return null;
  return Number(match[1] || 0) >= 1 ? 'torso' : 'spine';
}

/** Canonical slot for a source bone. */
export function sourceBoneKey(name) {
  return mffSpineKey(name) || rigifySourceKey(name) || trunkKey(name) || classifyBone(name);
}

/** Canonical slot for a destination bone. Light.k uses WAIST/SPINE/SHOULDER/ELBOW/... names. */
export function destinationBoneKey(name) {
  const n = clean(name);
  if (/end|roll|twist|helper|reserve|null/.test(n)) return null;
  const trunk = trunkKey(name);
  if (trunk) return trunk;
  // Dragon Ball FighterZ's `G_stomach` is the mid-spine joint; with `G_chest` taking the torso
  // slot it is the only destination for the source spine. Leave the waist on the pelvis chain.
  if (/stomach|abdomen/.test(n)) return 'spine';
  const side = sideOf(name);
  // Mixamo prefixes the side (`mixamorigLeftArm_09`), so sideOf cannot see a separate token.
  // classifyBone strips that prefix itself; it must run before the unsided early return or the
  // entire arm/leg chain is reported as a missing target.
  if (!side) return classifyBone(name);
  if (/clavicle/.test(n)) return side + 'Clavicle';
  // Light.k's SHOULDER is the upper arm, not the clavicle.
  if (/shoulder|upperarm/.test(n)) return side + 'Arm';
  if (/elbow|lowerarm|forearm/.test(n)) return side + 'Fore';
  if (/wrist|hand|palm/.test(n)) return side + 'Hand';
  if (/thigh|upperleg|upleg/.test(n)) return side + 'Leg';
  // CLANK is the shin/ankle joint; TOE1 is the foot on this rig. There is no separate knee.
  if (/clank|knee|shin|calf|lowerleg/.test(n)) return side + 'Shin';
  if (/toe1|ankle|foot/.test(n)) return side + 'Foot';
  // Mixamo's upper arm is `LeftArm`/`RightArm`, not `UpperArm`; classifyBone already owns that
  // spelling (and rejects finger/IK helpers), so it is the final semantic fallback.
  return classifyBone(name);
}

function boneList(root) {
  // A rig with a real skeleton is driven only by its bones. Mixing in every named Object3D also
  // collected exporter wrappers (`GLTF_SceneRootNode`, `Armature`), and the root-most-bone rule
  // below could then promote a 90-degree scene-rotation wrapper to `pelvis`.
  const bones = [];
  const others = [];
  root.traverse(node => {
    if (node === root || !node.name) return;
    if (node.isBone) bones.push(node);
    else if (node.isObject3D) others.push(node);
  });
  return bones.length ? bones : others;
}

function restWorld(bone) {
  bone.updateWorldMatrix(true, false);
  return bone.getWorldQuaternion(new THREE.Quaternion());
}

/**
 * Build an explicit source → destination mapping. One bone per canonical slot; the first real
 * deform bone wins, so helper/roll joints cannot shadow the animated chain.
 */
export function buildBoneMap(sourceRoot, targetRoot) {
  const sourceByKey = new Map();
  for (const bone of boneList(sourceRoot)) {
    const key = sourceBoneKey(bone.name);
    if (!key) continue;
    const current = sourceByKey.get(key);
    if (!current || sourceBoneRank(bone.name) < sourceBoneRank(current.name)) sourceByKey.set(key, bone);
  }
  const targetByKey = new Map();
  for (const bone of boneList(targetRoot)) {
    const key = destinationBoneKey(bone.name);
    if (key && !targetByKey.has(key)) targetByKey.set(key, bone);
  }
  // Some rigs name the root joint `spine` (or `root`/`Bip001`) and split the real pelvis into
  // `pelvisL`/`pelvisR` buttock bones, so no bone classified as `pelvis` and the only whole-body
  // joint stayed on its bind pose. The root-most deform bone is the pelvis by construction: it is
  // the one whose parent is the skeleton's structural node rather than another bone.
  const structuralRoot = /^(?:gltf_created_\d+_)?(?:root|rootjoint|armature|skeleton|scene|reference|transform)/i;
  const targetBones = boneList(targetRoot);
  const skeletonRoot = targetBones.find(bone => structuralRoot.test(String(bone.name)) && !bone.parent?.isBone)
    || targetBones.find(bone => structuralRoot.test(String(bone.name)));
  const firstDeform = skeletonRoot ? targetBones.find(bone => bone.parent === skeletonRoot) : null;
  if (firstDeform && !targetByKey.has('pelvis') && targetByKey.get('pelvis') !== firstDeform) {
    for (const [key, bone] of [...targetByKey]) {
      if (key === 'pelvis' || bone === firstDeform) targetByKey.delete(key);
    }
    targetByKey.set('pelvis', firstDeform);
  }
  const mappings = [];
  const missingTargets = [];
  for (const [key, source] of sourceByKey) {
    const target = targetByKey.get(key);
    if (!target) { missingTargets.push(key); continue; }
    mappings.push({
      slot: key,
      source: source.name,
      target: target.name,
      sourceParent: source.parent?.name || null,
      targetParent: target.parent?.name || null
    });
  }
  return {
    mappings,
    sourceByKey,
    targetByKey,
    missingTargets,
    unmappedSourceBones: boneList(sourceRoot).filter(b => !sourceBoneKey(b.name)).length,
    unmappedTargetBones: boneList(targetRoot).filter(b => !destinationBoneKey(b.name)).length
  };
}

function quaternionAt(track, time, out) {
  const values = track.values;
  if (values.length < 4) return out.identity();
  if (values.length === 4) return out.fromArray(values, 0);
  // GLTF quaternion tracks carry one keyframe per four values; use Three's interpolant so
  // non-uniform key spacing is respected instead of assuming a fixed frame rate.
  track.__interpolant ||= track.createInterpolant();
  const value = track.__interpolant.evaluate(time);
  return out.fromArray(value);
}

/**
 * Bake a source clip onto a destination skeleton. Returns a normal Three AnimationClip whose
 * tracks target destination bone names, plus a mapping/validation report.
 */
export function retargetClipBindPose(clip, sourceRoot, targetRoot, { fps = 30, name = null, calibrateArms = false } = {}) {
  if (!clip || !sourceRoot || !targetRoot) throw new Error('retargetClipBindPose requires a clip and both skeletons');
  const map = buildBoneMap(sourceRoot, targetRoot);
  if (!map.mappings.length) throw new Error('no anatomical bones matched between source and destination');

  sourceRoot.updateMatrixWorld(true);
  targetRoot.updateMatrixWorld(true);
  const sourceRestLocal = new Map();
  const sourceRestWorld = new Map();
  for (const [, bone] of map.sourceByKey) {
    sourceRestLocal.set(bone, bone.quaternion.clone());
    sourceRestWorld.set(bone, restWorld(bone));
  }
  const targetRestLocal = new Map();
  const targetRestWorld = new Map();
  const targetParentRestWorld = new Map();
  for (const bone of boneList(targetRoot)) {
    targetRestLocal.set(bone, bone.quaternion.clone());
    targetRestWorld.set(bone, restWorld(bone));
  }
  for (const bone of boneList(targetRoot)) {
    const parent = bone.parent;
    targetParentRestWorld.set(bone, parent ? restWorld(parent) : IDENTITY.clone());
  }
  // Some export rigs bind in a T-pose while the source idles with its arms down. A pure rest
  // basis conversion then reproduces the T-pose. This is an animation-side calibration only:
  // it lowers the destination upper arms around the shoulder before the clip delta is applied,
  // leaving the bind pose and skin weights untouched.
  if (calibrateArms) {
    const axis = new THREE.Vector3(0, 0, 1);
    const rotation = new THREE.Quaternion();
    for (const side of ['left', 'right']) {
      const bone = map.targetByKey.get(side + 'Arm');
      if (!bone) continue;
      const parentWorld = bone.parent ? restWorld(bone.parent) : IDENTITY.clone();
      rotation.setFromAxisAngle(axis, side === 'left' ? -0.92 : 0.92);
      const world = rotation.clone().multiply(targetRestWorld.get(bone));
      const local = parentWorld.clone().invert().multiply(world);
      bone.quaternion.copy(local);
      targetRestLocal.set(bone, local);
    }
    targetRoot.updateMatrixWorld(true);
    for (const bone of boneList(targetRoot)) targetRestWorld.set(bone, restWorld(bone));
    for (const bone of boneList(targetRoot)) {
      const parent = bone.parent;
      targetParentRestWorld.set(bone, parent ? restWorld(parent) : IDENTITY.clone());
    }
  }

  const sourceTracks = new Map();
  for (const track of clip.tracks) {
    if (!/\.quaternion$/.test(track.name)) continue;
    const nodeName = track.name.slice(0, track.name.lastIndexOf('.'));
    sourceTracks.set(nodeName, track);
  }
  const sourceAnimBones = [];
  sourceRoot.traverse(node => { if ((node.isBone || node.isObject3D) && sourceTracks.has(node.name)) sourceAnimBones.push(node); });
  if (!sourceAnimBones.length) throw new Error('clip has no quaternion tracks that name source bones: tracks=' + clip.tracks.slice(0, 4).map(t => t.name).join('|') + ' nodes=' + boneList(sourceRoot).slice(0, 8).map(b => b.name).join('|'));

  const duration = Math.max(0, Number(clip.duration) || 0);
  const steps = Math.max(1, Math.round(duration * fps));
  const times = new Float32Array(steps + 1);
  const values = new Map(map.mappings.map(m => [m.target, new Float32Array((steps + 1) * 4)]));
  const targetByName = new Map(map.mappings.map(m => [m.target, map.targetByKey.get(m.slot)]));
  const sourceByName = new Map(map.mappings.map(m => [m.source, map.sourceByKey.get(m.slot)]));
  const tmp = new THREE.Quaternion();
  const parentWorld = new THREE.Quaternion();
  const world = new THREE.Quaternion();
  let maxStep = 0;
  let nonFinite = 0;

  for (let step = 0; step <= steps; step++) {
    const time = duration * step / steps;
    times[step] = time;

    // Reset only the sampled bones, then write the clip's local rotations.
    for (const bone of sourceAnimBones) {
      const rest = sourceRestLocal.get(bone);
      if (rest) bone.quaternion.copy(rest);
    }
    for (const [nodeName, track] of sourceTracks) {
      const bone = sourceAnimBones.find(b => b.name === nodeName);
      if (!bone) continue;
      quaternionAt(track, time, bone.quaternion);
    }
    sourceRoot.updateMatrixWorld(true);

    const delta = new Map();
    for (const [slot, sourceBone] of map.sourceByKey) {
      if (!map.targetByKey.has(slot)) continue;
      sourceBone.getWorldQuaternion(world);
      const targetRest = targetRestWorld.get(map.targetByKey.get(slot));
      // Rest-basis conversion: map the source's absolute pose through both rest frames. A plain
      // world delta preserves the destination's rest pose (Light.k's arms stayed folded), which
      // is not a retarget when the two rigs were bound in different poses.
      delta.set(slot, targetRest.clone().multiply(sourceRestWorld.get(sourceBone).clone().invert()).multiply(world));
    }

    // Solve destination joints in hierarchy order. Unmapped bones (hair, face, extra twists)
    // keep their rest local rotation and inherit the nearest mapped parent.
    const targetBones = boneList(targetRoot);
    const solvedWorld = new Map();
    for (const bone of targetBones) {
      const parent = bone.parent;
      if (parent?.isBone) parentWorld.copy(solvedWorld.get(parent) || targetRestWorld.get(parent) || IDENTITY);
      else parentWorld.copy(targetParentRestWorld.get(bone) || IDENTITY);
      const slot = destinationBoneKey(bone.name);
      const mapped = slot && delta.has(slot) && map.targetByKey.get(slot) === bone;
      if (mapped) {
        world.copy(delta.get(slot));
        bone.quaternion.copy(parentWorld.clone().invert().multiply(world));
      } else {
        bone.quaternion.copy(targetRestLocal.get(bone) || IDENTITY);
        world.copy(parentWorld).multiply(bone.quaternion);
      }
      if (!Number.isFinite(bone.quaternion.x + bone.quaternion.y + bone.quaternion.z + bone.quaternion.w)) nonFinite++;
      solvedWorld.set(bone, world.clone());
      if (mapped) {
        const out = values.get(bone.name);
        bone.quaternion.toArray(out, step * 4);
        if (step > 0) {
          const prev = new THREE.Quaternion().fromArray(out, (step - 1) * 4);
          maxStep = Math.max(maxStep, prev.angleTo(bone.quaternion));
        }
      }
    }
    targetRoot.updateMatrixWorld(true);
  }

  const tracks = [];
  for (const [targetName, data] of values) {
    if (!targetByName.has(targetName)) continue;
    tracks.push(new THREE.QuaternionKeyframeTrack(`${targetName}.quaternion`, times, data));
  }
  const out = new THREE.AnimationClip(name || `${clip.name}_lightk`, duration, tracks);
  out.userData = {
    ...(clip.userData || {}),
    origin: 'bind-pose-retarget',
    sourceClip: clip.name,
    sourceSkeleton: sourceRoot.name || null,
    targetSkeleton: targetRoot.name || null,
    mappedBones: map.mappings.length,
    missingTargets: map.missingTargets,
    unmappedSourceBones: map.unmappedSourceBones,
    unmappedTargetBones: map.unmappedTargetBones,
    rootMotionStripped: true,
    fps,
    nonFinite,
    maxStepRadians: maxStep
  };
  return { clip: out, report: out.userData, mappings: map.mappings, targetRoot };
}
