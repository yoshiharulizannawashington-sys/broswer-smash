// Shared animation lane for the exact 19-bone roster family.
//
// The rig audit resolves 55 selectable bodies to the same joint count, normalized joint names and
// parent edges. Those bodies already ship the 17 common clips (the other 54 also ship eight extra
// states), so this lane is deliberately native-first: it binds each body's own clip where it has
// one and only falls back to the shared Kaze clip file when a body is missing a common state.
//
// The lane does not mutate bind/rest transforms, skin weights, geometry or the gameplay root. It
// also does not replace the existing state machine or mixer. It publishes the resolved action and
// applies per-identity cadence/fade calibration through the same actions the legacy mixer already
// drives, so a heavy body and a fast body do not have to share one playback rate.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { gaitTimeScale, styleFor } from './motion_style.js';
import { SHARED_RIG_CLIPS, SHARED_RIG_FAMILY } from './shared_rig_family_data.js';

const MEMBER_BY_KEY = new Map(SHARED_RIG_FAMILY.members.map(member => [member.key, member]));
const CLIP_NAMES = new Set(SHARED_RIG_CLIPS);
const LOOPING = new Set(['idle', 'walk', 'run', 'sprint', 'block', 'fly']);
const STATE_ACTION_KEY = Object.freeze({
  idle: 'idleAction',
  walk: 'walkAction',
  run: 'runAction',
  sprint: 'sprintAction',
  jump: 'jumpAction',
  land: 'landAction',
  dodge: 'dodgeAction',
  charge: 'chargeAction',
  beam: 'beamAction',
  launcher: 'launcherAction',
  jab: 'punchAction',
  heavy_punch: 'heavyAction',
  block: 'blockAction',
  hit_light: 'hitLightAction',
  knockdown: 'knockdownAction',
  get_up: 'getUpAction',
  fly: 'flyAction'
});

// Actions are unique to a mixer, so a WeakMap is the only ownership-correct way to answer
// "which common state is this action?" without writing a parallel string table per body.
const STATE_BY_ACTION = new WeakMap();
const SHARED_ACTION = new WeakSet();
let sourcePromise = null;

const keyOf = fighter => String(fighter?.identityKey || fighter?.identity || fighter?.name || '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** The shared-family member record, or null when this fighter belongs to a solo rig lane. */
export function sharedRigMemberFor(fighter) {
  return MEMBER_BY_KEY.get(keyOf(fighter)) || null;
}

export function isSharedRigFamilyFighter(fighter) {
  return Boolean(sharedRigMemberFor(fighter));
}

/** Per-identity playback calibration. No geometry or rest-pose mutation is involved. */
export function sharedRigCalibrationFor(fighter) {
  const member = sharedRigMemberFor(fighter);
  if (!member) return null;
  const style = styleFor(fighter);
  return {
    member: member.name,
    style: style.id,
    tempo: style.tempo,
    fadeScale: style.fadeScale,
    stride: style.stride,
    armSwing: style.armSwing,
    sway: style.sway,
    bounce: style.bounce
  };
}

/** Locomotion playback rate for a resolved shared-family action. */
export function sharedRigTimeScaleForAction(fighter, action, speed = 0) {
  if (!action || !sharedRigMemberFor(fighter)) return 1;
  const state = STATE_BY_ACTION.get(action);
  if (!state) return 1;
  return gaitTimeScale(styleFor(fighter), state, speed);
}

/** Crossfade length for a shared-family transition; solo lanes keep their existing fade. */
export function sharedRigTransitionFade(fighter, fallback = 0.13) {
  if (!sharedRigMemberFor(fighter)) return fallback;
  const scale = styleFor(fighter)?.fadeScale || 1;
  return THREE.MathUtils.clamp(fallback * scale, 0.06, 0.3);
}

/**
 * Shared fallback clips are authored at Kaze's hip height. Hips position is absolute, so applying
 * it to a taller or shorter body would move the whole mesh through the floor. Gameplay owns the
 * fighter root anyway; the fallback keeps rotations and scales, and drops only Hips translation.
 */
export function calibrateSharedSourceClip(clip) {
  if (!clip) return null;
  const copy = clip.clone();
  copy.tracks = clip.tracks.filter(track => !/^Hips\.(?:position|translation)$/.test(track.name));
  copy.userData = { ...(clip.userData || {}), sourceCalibration: 'root-translation-stripped' };
  return copy;
}

/** The lowest skinned point of this body in world space, at its current pose. */
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

/**
 * Correct the two authored ground poses whose skinned geometry sits below the fighter origin. The
 * offset is applied to the imported asset, never to the holder the gameplay root reads, and it is
 * released as soon as the clip changes. This mirrors the existing hit-reaction floor clamp but
 * covers the knockdown/get-up sequence, which is exactly where the 19-bone set was sinking.
 */
export function applySharedRigGrounding(root, fighter, state) {
  if (!root?.userData || !sharedRigMemberFor(fighter)) return 0;
  const asset = root.userData.importedModel || root;
  if (root.userData.sharedGroundBaseY === undefined) root.userData.sharedGroundBaseY = asset.position.y;
  const baseY = root.userData.sharedGroundBaseY;
  const grounded = fighter?.isGrounded !== false;
  const active = grounded && /^(?:jump|land|knockdown|get_up)$/.test(String(state || ''));
  if (!active) {
    if (root.userData.sharedGroundActive) {
      asset.position.y = baseY;
      root.userData.sharedGroundActive = false;
    }
    return 0;
  }
  root.userData.sharedGroundActive = true;
  asset.position.y = baseY;
  const lowest = minimumSkinnedY(asset);
  if (!Number.isFinite(lowest) || lowest >= -0.004) return 0;
  const lift = Math.min(0.36, -lowest);
  asset.position.y = baseY + lift;
  return lift;
}

function configureAction(action, state) {
  const loop = LOOPING.has(state);
  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  action.clampWhenFinished = !loop;
  action.enabled = true;
  STATE_BY_ACTION.set(action, state);
}

function findNativeAction(actions, state) {
  if (!actions) return null;
  const direct = actions[state] || actions[state.toLowerCase()];
  if (direct?.getClip) return direct;
  for (const action of Object.values(actions)) {
    if (action?.getClip?.()?.name?.toLowerCase() === state) return action;
  }
  return null;
}

function publish(root, report) {
  root.userData.sharedRigBatch = report;
  if (typeof window === 'undefined') return;
  window.__browserSmashAssets = window.__browserSmashAssets || {};
  window.__browserSmashAssets.rigFamilyBatch = window.__browserSmashAssets.rigFamilyBatch || {};
  window.__browserSmashAssets.rigFamilyBatch[report.key] = report;
}

function bindAction(root, state, action, source) {
  if (!action?.getClip) return;
  configureAction(action, state);
  const list = root.userData.animationActions || (root.userData.animationActions = {});
  if (!list[state]) list[state] = action;
  const targetKey = STATE_ACTION_KEY[state];
  // The legacy state machine already reads these slots by name. Fill a missing slot with the
  // fallback action, but never replace a working native action with a shared one.
  if (targetKey && !root.userData[targetKey]) root.userData[targetKey] = action;
  if (source === 'shared') SHARED_ACTION.add(action);
}

function repairAquamanNeckWeights(root, member) {
  if (member.key !== 'aquaman') return 0;
  if (root.userData.aquamanNeckRepair !== undefined) return root.userData.aquamanNeckRepair;
  let repaired = 0;
  root.traverse(mesh => {
    if (!mesh.isSkinnedMesh || !mesh.geometry?.attributes?.skinIndex || !mesh.geometry?.attributes?.skinWeight) return;
    if (!/aquaman/i.test(String(mesh.name || ''))) return;
    const bones = mesh.skeleton?.bones || [];
    const hips = bones.findIndex(bone => /^hips$/i.test(String(bone.name || '')));
    const chest = bones.findIndex(bone => /^chest$/i.test(String(bone.name || '')));
    const positions = mesh.geometry.attributes.position;
    const index = mesh.geometry.attributes.skinIndex;
    const weight = mesh.geometry.attributes.skinWeight;
    if (hips < 0 || chest < 0 || !positions) return;
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const y = positions.getY(vertex);
      if (y < 1.31 || y > 1.70) continue;
      let dominant = -1, dominantWeight = 0;
      for (let slot = 0; slot < 4; slot++) {
        const w = [weight.getX, weight.getY, weight.getZ, weight.getW][slot].call(weight, vertex);
        if (w <= dominantWeight) continue;
        dominantWeight = w;
        dominant = [index.getX, index.getY, index.getZ, index.getW][slot].call(index, vertex);
      }
      if (dominant !== hips && dominant !== chest) continue;
      // The collar rows alternate between 100% Hips and 100% Chest with no transition. Blend
      // Hips into Chest across the collar band so the native neck seam cannot open at either end.
      const t = Math.max(0, Math.min(1, (y - 1.31) / 0.19));
      if (t <= 0.01) continue;
      index.setX(vertex, chest); index.setY(vertex, hips); index.setZ(vertex, 0); index.setW(vertex, 0);
      weight.setX(vertex, t); weight.setY(vertex, 1 - t); weight.setZ(vertex, 0); weight.setW(vertex, 0);
      repaired += 1;
    }
    index.needsUpdate = true;
    weight.needsUpdate = true;
  });
  root.userData.aquamanNeckRepair = repaired;
  return repaired;
}

/**
 * Bind the 17 common states onto this body's existing mixer. Safe to call every frame: the first
 * call per body/identity does the work and later calls return the same report. If a body lacks a
 * common clip, the shared Kaze source is loaded once and added to that same mixer.
 */
export function bindSharedRigFamily(root, fighter, mixer) {
  const member = sharedRigMemberFor(fighter);
  if (!root?.userData || !mixer || !member) return null;
  const key = member.key;
  const skinSeamRepair = repairAquamanNeckWeights(root, member);
  const current = root.userData.sharedRigBatch;
  if (current?.key === key && current.status !== 'loading') return current;

  const actions = root.userData.animationActions || (root.userData.animationActions = {});
  const report = current?.key === key ? current : {
    family: SHARED_RIG_FAMILY.id,
    key,
    name: member.name,
    url: member.url,
    expected: SHARED_RIG_CLIPS.length,
    native: 0,
    fallback: 0,
    missing: [],
    states: {},
    calibration: sharedRigCalibrationFor(fighter),
    skinSeamRepair,
    source: 'native',
    status: 'loading'
  };
  report.calibration = sharedRigCalibrationFor(fighter);
  report.missing = [];
  report.native = 0;
  report.fallback = 0;

  for (const state of SHARED_RIG_CLIPS) {
    const native = findNativeAction(actions, state);
    const action = native || (report.states[state]?.action || null);
    if (!action || !action.getClip) {
      report.missing.push(state);
      continue;
    }
    const source = native && !SHARED_ACTION.has(native) ? 'native' : 'shared';
    bindAction(root, state, action, source);
    report.states[state] = {
      clip: action.getClip().name,
      source,
      loop: LOOPING.has(state)
    };
    if (source === 'native') report.native += 1;
    else report.fallback += 1;
  }

  report.source = report.fallback ? 'native+shared' : 'native';
  report.status = report.missing.length ? 'loading' : 'ready';
  publish(root, report);

  if (report.missing.length) {
    const needed = [...report.missing];
    loadSharedSource().then(gltf => {
      // The body may have been replaced or switched while the source file was loading.
      if (root.userData.sharedRigBatch !== report) return;
      const byName = new Map((gltf.animations || []).map(clip => [clip.name.toLowerCase(), clip]));
      const targetBones = new Set();
      root.traverse(node => { if (node.isBone) targetBones.add(node.name); });
      const sourceBones = new Set();
      gltf.scene?.traverse(node => { if (node.isBone) sourceBones.add(node.name); });
      const absentBones = [...sourceBones].filter(name => !targetBones.has(name));
      if (absentBones.length) {
        report.status = 'failed';
        report.error = 'shared source has bones absent from the destination: ' + absentBones.slice(0, 8).join(', ');
        publish(root, report);
        return;
      }
      const stillMissing = [];
      for (const state of needed) {
        const sourceClip = byName.get(state);
        if (!sourceClip) { stillMissing.push(state); continue; }
        const clip = calibrateSharedSourceClip(sourceClip);
        const action = mixer.clipAction(clip);
        SHARED_ACTION.add(action);
        bindAction(root, state, action, 'shared');
        report.states[state] = { clip: clip.name, source: 'shared', loop: LOOPING.has(state) };
        report.fallback += 1;
      }
      report.missing = stillMissing;
      report.source = report.fallback ? 'native+shared' : 'native';
      report.status = stillMissing.length ? 'failed' : 'ready';
      if (stillMissing.length) report.error = 'shared source is missing states: ' + stillMissing.join(', ');
      publish(root, report);
    }).catch(error => {
      if (root.userData.sharedRigBatch !== report) return;
      report.status = 'failed';
      report.error = String(error?.message || error);
      publish(root, report);
    });
  }
  return report;
}

/** Load the 17-clip Kaze source once per page, not once per fighter. */
function loadSharedSource() {
  if (!sourcePromise) {
    sourcePromise = new Promise((resolve, reject) => {
      new GLTFLoader().load(SHARED_RIG_FAMILY.source, resolve, undefined, reject);
    });
  }
  return sourcePromise;
}

export { CLIP_NAMES, STATE_ACTION_KEY, SHARED_ACTION };
