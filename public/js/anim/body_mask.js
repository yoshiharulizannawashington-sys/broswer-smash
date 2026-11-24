// Upper/lower body animation masks.
//
// The clip library is written as whole-body poses: every clip drives the spine, arms, pelvis and
// legs. That is correct for a state transition, but it means a guard or punch replaces the walk
// cycle underneath it. A body mask builds a second view of the same clip containing only the bones
// of one region, so two actions on one mixer can own disjoint halves of the skeleton:
//
//   lower action: locomotion (pelvis + legs)
//   upper action: guard or punch (spine + head + arms)
//
// The mask is a track filter, not a skinning trick. Each action still drives real joints through
// the normal AnimationMixer, and a track the source clip does not contain cannot be fabricated.
import * as THREE from 'three';

export const UPPER_BODY_BONES = Object.freeze([
  'spine', 'torso', 'neck', 'head',
  'leftClavicle', 'rightClavicle',
  'leftArm', 'leftFore', 'leftHand',
  'rightArm', 'rightFore', 'rightHand'
]);

export const LOWER_BODY_BONES = Object.freeze([
  'pelvis',
  'leftLeg', 'leftShin', 'leftFoot',
  'rightLeg', 'rightShin', 'rightFoot'
]);

const UPPER_SET = new Set(UPPER_BODY_BONES);
const LOWER_SET = new Set(LOWER_BODY_BONES);
const MASK_CACHE = new WeakMap();
const NODE_CACHE = new WeakMap();

/** Canonical bones a region is allowed to drive. Unknown regions are rejected, not widened. */
export function bonesForRegion(region) {
  if (region === 'upper') return UPPER_BODY_BONES;
  if (region === 'lower') return LOWER_BODY_BONES;
  return null;
}

/** True when a canonical bone belongs to the requested region. */
export function boneInRegion(bone, region) {
  return region === 'upper' ? UPPER_SET.has(bone) : region === 'lower' ? LOWER_SET.has(bone) : false;
}

function nodeToCanonical(rig) {
  let map = NODE_CACHE.get(rig);
  if (map) return map;
  map = new Map();
  for (const [canonical, node] of Object.entries(rig?.joints || {})) {
    if (node?.name) map.set(node.name, canonical);
  }
  NODE_CACHE.set(rig, map);
  return map;
}

function trackNodeName(trackName) {
  const text = String(trackName || '');
  const dot = text.indexOf('.');
  return dot < 0 ? text : text.slice(0, dot);
}

/**
 * Measure how much of a clip belongs to a region. Used by tests and by the controller's
 * diagnostics instead of guessing from the clip id.
 */
export function maskCoverage(clip, rig, region) {
  const allowed = region === 'upper' ? UPPER_SET : region === 'lower' ? LOWER_SET : null;
  if (!clip || !rig || !allowed) return { region, total: 0, matched: 0, ratio: 0, bones: [] };
  const canonical = nodeToCanonical(rig);
  const bones = new Set();
  let matched = 0;
  for (const track of clip.tracks || []) {
    const bone = canonical.get(trackNodeName(track.name));
    if (!bone || !allowed.has(bone)) continue;
    matched++;
    bones.add(bone);
  }
  return {
    region,
    total: clip.tracks?.length || 0,
    matched,
    ratio: clip.tracks?.length ? matched / clip.tracks.length : 0,
    bones: [...bones]
  };
}

/**
 * Build a region-only copy of a clip. Returns null when the clip drives none of the bones in the
 * requested region, so a caller can fall back to a whole-body action instead of playing "nothing".
 * The source clip is never mutated and the result is cached per source/region pair.
 */
export function maskClip(clip, rig, region) {
  const allowed = region === 'upper' ? UPPER_SET : region === 'lower' ? LOWER_SET : null;
  if (!clip || !rig || !allowed || !clip.tracks?.length) return null;
  if (clip.userData?.mask === region) return clip;

  let perClip = MASK_CACHE.get(clip);
  if (!perClip) {
    perClip = new Map();
    MASK_CACHE.set(clip, perClip);
  }
  if (perClip.has(region)) return perClip.get(region);

  const canonical = nodeToCanonical(rig);
  const tracks = [];
  const bones = new Set();
  for (const track of clip.tracks) {
    const bone = canonical.get(trackNodeName(track.name));
    if (!bone || !allowed.has(bone)) continue;
    tracks.push(track);
    bones.add(bone);
  }
  if (!tracks.length) {
    perClip.set(region, null);
    return null;
  }

  const masked = new THREE.AnimationClip(`${clip.name}__${region}`, clip.duration, tracks);
  masked.userData = {
    ...(clip.userData || {}),
    mask: region,
    maskSource: clip.name,
    maskSourceBones: Array.isArray(clip.userData?.bones) ? clip.userData.bones.slice() : undefined,
    bones: [...bones],
    trackCount: tracks.length
  };
  perClip.set(region, masked);
  return masked;
}

/** Remove a cached mask pair (tests and rig replacement use this). */
export function clearMaskCache(clip) {
  if (clip) MASK_CACHE.delete(clip);
}
