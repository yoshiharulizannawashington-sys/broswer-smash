// Compile an authored attack motion into a real AnimationClip for a bound rig.
//
// The per-joint overlay in attack_animator.js can only reach bones it finds on model.userData. On a
// body whose rig is driven by AnimationController that is the wrong skeleton: the overlay reports a
// pose id and changes nothing that is drawn (measured: 0.0000 delta on the rendered bones). These
// keyframes are therefore also compiled into clips the controller can play, blend and retime through
// the same path it already uses for jumps, hits and dodges. One animation owner, no competitor.
import * as THREE from 'three';
import { offsetQuaternion } from './rig_map.js';

// Every joint an authored motion is allowed to name. Unknown keys are ignored rather than treated
// as a new channel, so a typo cannot invent a bone.
const MOTION_JOINTS = Object.freeze([
  'pelvis', 'spine', 'torso', 'neck', 'head',
  'leftClavicle', 'leftArm', 'leftFore', 'leftHand',
  'rightClavicle', 'rightArm', 'rightFore', 'rightHand',
  'leftLeg', 'leftShin', 'leftFoot', 'rightLeg', 'rightShin', 'rightFoot'
]);

// Authored motion is normalised time (0..1) in a one-second clip; the controller retimes the clip
// onto the attack's real duration and peak, exactly as it does for library clips.
export const MOTION_CLIP_SECONDS = 1;

/**
 * Build the clip for one motion slot.
 *
 * Keyframes name only the joints they move, so each joint is sampled at EVERY keyframe time using
 * the last value it was given. Sampling the sparse keys directly would make Three.js interpolate
 * across a gap the author intended as a hold.
 */
export function buildAttackClip(id, motion, rig, { label = null, peak = 0.45 } = {}) {
  if (!rig?.joints || !Array.isArray(motion) || motion.length < 2) return null;

  const keys = motion
    .map(key => ({ t: Math.max(0, Math.min(1, Number(key.t) || 0)), pose: key }))
    .sort((a, b) => a.t - b.t);

  const touched = new Set();
  for (const key of keys) for (const joint of MOTION_JOINTS) if (key.pose[joint]) touched.add(joint);

  const tracks = [];
  const covered = [];
  const skipped = [];
  for (const joint of touched) {
    const bone = rig.joints[joint];
    if (!bone) { skipped.push(joint); continue; }
    const times = [];
    const values = [];
    let current = [0, 0, 0];
    for (const key of keys) {
      if (key.pose[joint]) current = key.pose[joint];
      const q = offsetQuaternion(rig, joint, current);
      times.push(key.t * MOTION_CLIP_SECONDS);
      values.push(q.x, q.y, q.z, q.w);
    }
    // A track with fewer than two distinct times cannot play; drop it rather than ship a static one.
    if (new Set(times).size < 2) { skipped.push(joint); continue; }
    tracks.push(new THREE.QuaternionKeyframeTrack(bone.name + '.quaternion', times, values));
    covered.push(joint);
  }
  if (!tracks.length) return null;

  const clip = new THREE.AnimationClip(id, MOTION_CLIP_SECONDS, tracks);
  clip.userData = {
    id,
    label: label || id,
    loop: false,
    clamp: true,
    peak,
    origin: 'authored-motion',
    bones: covered,
    skippedBones: skipped
  };
  return clip;
}

/**
 * Ensure a controller owns a playable clip for every authored attack motion it may be asked for.
 *
 * `ids` maps controller clip id -> motion slot, so a per-identity manifest can point several ids at
 * one motion. Existing clips are never replaced: a downloaded/baked clip for that id stays the
 * authority, and an authored motion only fills a hole.
 */
export function registerAttackClips(controller, { ids, motions, peakFor } = {}) {
  if (!controller?.clips || !controller.rig || !ids || !motions) return { added: [], skipped: [] };
  const added = [];
  const skipped = [];
  for (const [clipId, slot] of Object.entries(ids)) {
    if (!slot) { skipped.push(clipId); continue; }
    if (controller.clips.has(clipId)) { skipped.push(clipId); continue; }
    const motion = motions[slot];
    if (!motion) { skipped.push(clipId); continue; }
    const clip = buildAttackClip(clipId, motion, controller.rig, {
      label: `${slot} (authored)`,
      peak: typeof peakFor === 'function' ? peakFor(slot) : (peakFor ?? 0.45)
    });
    if (!clip) { skipped.push(clipId); continue; }
    controller.clips.set(clipId, clip);
    added.push(clipId);
  }
  controller.authoredAttackClips = added;
  return { added, skipped };
}
