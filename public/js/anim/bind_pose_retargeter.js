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
  if (/waist|hips|pelvis/.test(n)) return 'pelvis';
  if (/spine1|spine$/.test(n)) return 'spine';
  // Mixamo spells the upper spine `Spine1`/`Spine2`; both are torso joints. Without this, a 19-bone
  // source clip's Chest track had no destination and the whole upper body stayed in its rest pose.
  if (/spine[23]|chest|torso|ribcage/.test(n)) return 'torso';
  if (/neck/.test(n)) return 'neck';
  if (/head/.test(n)) return 'head';
  return null;
}

/** Canonical slot for a source bone. */
export function sourceBoneKey(name) {
  return trunkKey(name) || classifyBone(name);
}

/** Canonical slot for a destination bone. Light.k uses WAIST/SPINE/SHOULDER/ELBOW/... names. */
export function destinationBoneKey(name) {
  const n = clean(name);
  if (/end|roll|twist|helper|reserve|null/.test(n)) return null;
  const trunk = trunkKey(name);
  if (trunk) return trunk;
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
  const out = [];
  root.traverse(node => { if (node !== root && (node.isBone || node.isObject3D) && node.name) out.push(node); });
  return out;
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
    if (key && !sourceByKey.has(key)) sourceByKey.set(key, bone);
  }
  const targetByKey = new Map();
  for (const bone of boneList(targetRoot)) {
    const key = destinationBoneKey(bone.name);
    if (key && !targetByKey.has(key)) targetByKey.set(key, bone);
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
