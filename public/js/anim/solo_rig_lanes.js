// Explicit lanes for the five bodies that do not share the 19-bone roster skeleton.
//
// These are not a second animation controller. They are the production contract for which body,
// which clip-only files, and which skeleton each solo body owns. The mixer remains the same one
// human_fighter already drives; this module only resolves a clip whose tracks were authored on a
// different but semantically equivalent skeleton (Spider-Man's 19-bone canonical clips on his
// 66-joint Mixamo body) and reports exactly which tracks resolved.
import * as THREE from 'three';
import { buildBoneMap, retargetClipBindPose } from './bind_pose_retargeter.js';

export const SOLO_RIG_LANES = Object.freeze({
  infantry: Object.freeze({
    id: 'rig-24-d480ac08', name: 'Infantry', joints: 24,
    body: '/models/characters/roster_hd/infantry_cc0.glb',
    clips: [
      '/models/characters/roster_hd/infantry_cc0.glb',
      '/models/characters/roster_hd/infantry_combat.glb',
      '/models/characters/roster_hd/infantry_reactions.glb'
    ],
    expected: 17, weapon: 'rifle', weaponBone: /right.*hand|hand.*right/i
  }),
  hulk_bruce_banner: Object.freeze({
    id: 'rig-65-f958b15d', name: 'Hulk', joints: 65,
    body: '/models/characters/imported/hulk/hulk.glb',
    clips: ['/models/characters/imported/hulk/hulk.glb'],
    expected: 19, weapon: null, weaponBone: /right.*hand|hand.*right/i
  }),
  spider_man: Object.freeze({
    id: 'rig-66-46a38179', name: 'Spider-Man', joints: 66,
    body: '/models/characters/roster/spider_man.glb',
    clips: ['/models/characters/bespoke/spider_man_bespoke.glb'],
    expected: 7, weapon: null, weaponBone: /right.*hand|hand.*right/i
  }),
  goku: Object.freeze({
    id: 'rig-73-a07e48a1', name: 'Goku', joints: 73,
    body: '/models/characters/bespoke/goku_body.glb',
    clips: ['/models/characters/bespoke/goku_animated.glb'],
    expected: 46, weapon: null, weaponBone: /right.*hand|hand.*right/i
  }),
  naruto_uzumaki: Object.freeze({
    id: 'rig-567-792f0473', name: 'Naruto', joints: 567,
    body: '/models/characters/naruto_uzumaki/naruto_uzumaki.glb',
    clips: [
      '/models/characters/naruto_uzumaki/naruto_uzumaki.glb',
      '/models/characters/naruto_uzumaki/naruto_reactions.glb',
      '/models/characters/naruto_uzumaki/naruto_authored.glb',
      '/models/characters/naruto_uzumaki/naruto_kunai.glb'
    ],
    expected: 49, weapon: 'kunai', weaponBone: /right.*hand|hand.*right/i
  })
});

const KEY_ALIASES = Object.freeze({
  hulk: 'hulk_bruce_banner',
  bruce_banner: 'hulk_bruce_banner',
  spiderman: 'spider_man',
  spider: 'spider_man',
  naruto: 'naruto_uzumaki'
});

export function soloLaneKey(fighter) {
  const raw = String(fighter?.identityKey || fighter?.identity || fighter?.name || '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return KEY_ALIASES[raw] || raw;
}

export function soloRigLaneFor(fighter) {
  return SOLO_RIG_LANES[soloLaneKey(fighter)] || null;
}

export function isSoloRigFighter(fighter) {
  return Boolean(soloRigLaneFor(fighter));
}

/** Bone names present on a mounted body, including non-deform carriers used by clip-only files. */
export function boneNameSet(root) {
  const names = new Set();
  root?.traverse?.(node => { if (node.name && (node.isBone || node.isObject3D)) names.add(node.name); });
  return names;
}

/** Track nodes a clip cannot resolve on this body. Exact names are tried first; no fuzzy guess. */
export function unresolvedClipNodes(clip, root) {
  const names = boneNameSet(root);
  const unresolved = [];
  for (const track of clip?.tracks || []) {
    const dot = track.name.lastIndexOf('.');
    const node = dot < 0 ? track.name : track.name.slice(0, dot);
    if (!names.has(node)) unresolved.push(track.name);
  }
  return unresolved;
}

function snapshotBones(root) {
  const snapshot = [];
  root.traverse(node => {
    if (!node.isBone && !node.isObject3D) return;
    snapshot.push([node, node.position.clone(), node.quaternion.clone(), node.scale.clone()]);
  });
  return snapshot;
}

function restoreBones(snapshot) {
  for (const [node, position, quaternion, scale] of snapshot) {
    node.position.copy(position);
    node.quaternion.copy(quaternion);
    node.scale.copy(scale);
  }
}

/**
 * Prepare one clip for the mounted solo body.
 *
 * Exact-name clips are returned untouched. A clip authored on a different but mapped skeleton is
 * baked onto this body with the bind-pose retargeter; destination bones are restored afterwards so
 * loading does not leave the fighter in the clip's last sampled pose. Failure returns the original
 * clip with an explicit diagnostic instead of silently claiming it bound.
 */
function minimumSkinnedY(root) {
  root.updateMatrixWorld(true);
  let min = Infinity;
  root.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    for (let parent = mesh; parent; parent = parent.parent) {
      if (String(parent.name || '').startsWith('Equipped')) return;
    }
    const positions = mesh.geometry?.attributes?.position;
    if (!positions) return;
    mesh.skeleton?.update?.();
    const point = new THREE.Vector3();
    for (let index = 0; index < positions.count; index += 12) {
      point.fromBufferAttribute(positions, index);
      if (typeof mesh.applyBoneTransform === 'function') mesh.applyBoneTransform(index, point);
      else if (typeof mesh.boneTransform === 'function') mesh.boneTransform(index, point);
      point.applyMatrix4(mesh.matrixWorld);
      if (Number.isFinite(point.y)) min = Math.min(min, point.y);
    }
  });
  return min;
}

const SOLO_AIR_STATE = /jump|fly|air|fall|launch|dive|takeoff|hover|double|float|flight/i;

/**
 * Ground a solo body without changing its clip or its root ownership. This is the solo-lane
 * counterpart of the shared-family correction: Hulk's authored skills and Goku's form beats sink
 * a few centimetres at their lowest key, so the asset is lifted only while the state is grounded
 * and the correction is released on the next state.
 */
export function applySoloRigGrounding(root, fighter, state) {
  if (!root?.userData || !soloRigLaneFor(fighter)) return 0;
  const asset = root.userData.importedModel || root;
  if (root.userData.soloGroundBaseY === undefined) root.userData.soloGroundBaseY = asset.position.y;
  const baseY = root.userData.soloGroundBaseY;
  const grounded = fighter?.isGrounded !== false;
  const active = grounded && !SOLO_AIR_STATE.test(String(state || ''));
  if (!active) {
    if (root.userData.soloGroundActive) {
      asset.position.y = baseY;
      root.userData.soloGroundActive = false;
    }
    return 0;
  }
  root.userData.soloGroundActive = true;
  asset.position.y = baseY;
  const lowest = minimumSkinnedY(asset);
  if (!Number.isFinite(lowest) || lowest >= -0.004) return 0;
  const lift = Math.min(0.36, -lowest);
  asset.position.y = baseY + lift;
  return lift;
}

export function prepareSoloClip(clip, sourceRoot, targetRoot, { name = null, fps = 30 } = {}) {
  if (!clip || !targetRoot) return { clip, mode: 'missing', unresolved: ['<no clip or target>'] };
  const before = unresolvedClipNodes(clip, targetRoot);
  if (!before.length) {
    return { clip, mode: 'exact', unresolved: [], mappedBones: null, source: clip.name };
  }
  if (!sourceRoot) {
    return { clip, mode: 'unresolved', unresolved: before, source: clip.name };
  }
  const map = buildBoneMap(sourceRoot, targetRoot);
  if (!map.mappings.length) {
    return { clip, mode: 'unresolved', unresolved: before, source: clip.name, mapping: map };
  }
  const restore = snapshotBones(targetRoot);
  try {
    const result = retargetClipBindPose(clip, sourceRoot, targetRoot, { fps, name: name || clip.name });
    const after = unresolvedClipNodes(result.clip, targetRoot);
    return {
      clip: result.clip, mode: 'retargeted', unresolved: after,
      source: clip.name, mappedBones: result.mappings.length,
      mapping: map, retarget: result.report
    };
  } catch (error) {
    return {
      clip, mode: 'retarget-failed', unresolved: before, source: clip.name,
      error: String(error?.message || error), mapping: map
    };
  } finally {
    restoreBones(restore);
    targetRoot.updateMatrixWorld(true);
  }
}

/** A one-line ownership report for a mounted solo body. */
export function soloLaneReport(root, fighter) {
  const lane = soloRigLaneFor(fighter);
  if (!lane) return null;
  const names = boneNameSet(root);
  const weaponBone = [...names].find(name => lane.weaponBone.test(name)) || null;
  return {
    key: soloLaneKey(fighter), family: lane.id, expectedJoints: lane.joints,
    actualJoints: root?.userData?.skeleton?.bones?.length || null,
    weapon: lane.weapon, weaponBone,
    hasHand: Boolean([...names].find(name => /hand|wrist|palm/i.test(name))),
    note: 'solo lane: no 19-bone shared clip is allowed to enter this body'
  };
}

export { THREE };
