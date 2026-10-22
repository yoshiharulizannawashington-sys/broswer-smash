// External animation pack loader.
//
// Downloads are the user's responsibility: this module never fetches from Sketchfab or Mixamo.
// It loads GLB files the project already contains, validates them, retargets their clips into the
// canonical bone space, and reports exactly which library entries were satisfied.
//
// Two things it refuses to do:
//  * pretend a pack exists when the file is missing (status stays `missing`, never `loaded`), and
//  * guess a mapping. Every clip comes from an explicit entry in public/data/animation-manifest.json.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { classifyBone, safeBoneName } from './rig_map.js';

const loader = new GLTFLoader();

const normalize = value => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '');

/** Fetch the animation manifest. A missing manifest is a reported condition, not a throw. */
export async function loadAnimationManifest(url = '/data/animation-manifest.json') {
  try {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) return { ok: false, status: response.status, clips: [], packs: [] };
    const json = await response.json();
    return { ok: true, status: 200, ...json };
  } catch (error) {
    return { ok: false, status: 0, error: String(error?.message || error), clips: [], packs: [] };
  }
}

/**
 * Retarget a clip from its source skeleton into canonical bone space.
 * Tracks that cannot be matched to a canonical bone are dropped and counted, never silently
 * remapped onto an unrelated joint. Translation/scale tracks are stripped so a downloaded clip
 * cannot fight the gameplay physics for control of the fighter's position (root motion stays in
 * the gameplay layer).
 */
export function retargetClip(clip, { allowRootMotion = false, name = null } = {}) {
  const tracks = [];
  const matched = new Set();
  const dropped = [];
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    if (dot < 0) { dropped.push(track.name); continue; }
    const nodeName = track.name.slice(0, dot);
    const property = track.name.slice(dot + 1);
    if (property !== 'quaternion') {
      if (!allowRootMotion && (property === 'position' || property === 'scale')) continue;
      dropped.push(track.name);
      continue;
    }
    const core = /hips|pelvis|root|spine|chest|torso|head|neck/i.test(nodeName) && !/arm|leg|hand|foot/i.test(nodeName)
      ? (/head|neck/i.test(nodeName) ? 'head' : /hips|pelvis/i.test(nodeName) ? 'pelvis' : 'torso')
      : classifyBone(nodeName);
    if (!core) { dropped.push(track.name); continue; }
    matched.add(core);
    const times = Float32Array.from(track.times);
    const values = Float32Array.from(track.values);
    tracks.push(new THREE.QuaternionKeyframeTrack(`${safeBoneName(core)}.quaternion`, times, values));
  }
  if (!tracks.length) return null;
  const out = new THREE.AnimationClip(name || clip.name, clip.duration, tracks);
  out.userData = {
    ...(clip.userData || {}),
    origin: 'external',
    sourceClip: clip.name,
    matchedBones: [...matched],
    droppedTracks: dropped.length
  };
  return out;
}

/** Pick the first candidate name present in the GLB's clip list. */
function findClip(animations, candidates) {
  const pool = animations.map(a => ({ clip: a, key: normalize(a.name) }));
  for (const candidate of candidates) {
    const wanted = normalize(candidate);
    const direct = pool.find(entry => entry.key === wanted);
    if (direct) return direct.clip;
  }
  for (const candidate of candidates) {
    const wanted = normalize(candidate);
    const partial = pool.find(entry => entry.key.includes(wanted) || wanted.includes(entry.key));
    if (partial) return partial.clip;
  }
  return null;
}

function fileExists(url) {
  return fetch(url, { method: 'HEAD', cache: 'no-store' })
    .then(response => response.ok)
    .catch(() => false);
}

/**
 * Load every installed pack and return { clips, report }.
 * `clips` maps a library clip id to a retargeted AnimationClip ready for setExternalClips().
 */
export async function loadAnimationPacks(manifest, { allowRootMotion = false, verifyFiles = true } = {}) {
  const clips = new Map();
  const report = { packs: [], loaded: 0, missing: 0, clipsBound: 0, errors: [] };
  const packs = Array.isArray(manifest?.packs) ? manifest.packs : [];
  for (const pack of packs) {
    const entry = {
      id: pack.id,
      label: pack.label || pack.id,
      file: pack.file || null,
      status: 'skipped',
      mapped: 0,
      missingClips: [],
      error: null
    };
    if (!pack.file || pack.enabled === false) {
      entry.status = 'not-supplied';
      report.packs.push(entry);
      continue;
    }
    if (verifyFiles && !(await fileExists(pack.file))) {
      entry.status = 'missing';
      entry.error = 'file not present in the project';
      report.missing++;
      report.packs.push(entry);
      continue;
    }
    try {
      const gltf = await new Promise((resolve, reject) =>
        loader.load(pack.file, resolve, undefined, reject));
      const animations = gltf.animations || [];
      if (!animations.length) {
        entry.status = 'no-clips';
        entry.error = 'GLB contains a mesh but no animation clips';
        report.errors.push(`${pack.id}: no clips`);
        report.packs.push(entry);
        continue;
      }
      const mapping = pack.clips && typeof pack.clips === 'object' ? pack.clips : {};
      for (const [clipId, candidates] of Object.entries(mapping)) {
        const list = Array.isArray(candidates) ? candidates : [candidates];
        const source = findClip(animations, list);
        if (!source) {
          entry.missingClips.push(clipId);
          continue;
        }
        const retargeted = retargetClip(source, { allowRootMotion, name: clipId });
        if (!retargeted) {
          entry.missingClips.push(clipId);
          continue;
        }
        clips.set(clipId, retargeted);
        entry.mapped++;
        report.clipsBound++;
      }
      entry.status = entry.mapped ? 'loaded' : 'unusable';
      if (!entry.mapped) entry.error = 'clips present but none matched a canonical bone';
      report.loaded++;
    } catch (error) {
      entry.status = 'error';
      entry.error = String(error?.message || error);
      report.errors.push(`${pack.id}: ${entry.error}`);
    }
    report.packs.push(entry);
  }
  return { clips, report };
}

/**
 * Fetch + load in one step, tolerating a missing manifest (the game keeps its procedural
 * library and the UI reports that no downloaded packs are installed).
 */
export async function bootstrapAnimationPacks(options = {}) {
  const manifest = await loadAnimationManifest(options.manifestUrl);
  if (!manifest.ok) {
    return {
      clips: new Map(),
      report: { manifest: 'unavailable', packs: [], loaded: 0, missing: 0, clipsBound: 0, errors: [] },
      manifest
    };
  }
  const result = await loadAnimationPacks(manifest, options);
  return { ...result, manifest, report: { manifest: 'loaded', ...result.report } };
}
