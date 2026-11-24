// Live 3D preview for the match-setup screen.
//
// The selection screen is DOM/CSS: it shows names, archetypes and signature moves, but nothing
// that proves the roster's models exist. This module mounts a small dedicated renderer beside the
// roster grid and loads the selected fighter's real GLB through the same manifest the game reads,
// plays its idle clip, and disposes every geometry/material/texture it created when the selection
// changes or the screen closes.
//
// It is deliberately separate from the game renderer: its own canvas, camera, lights and clock, so
// a preview can never disturb a match, the arena streamed behind the menu, or controller input.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { claimModelTextures, releaseModelTextures } from '../render/texture_ownership.js';
import { resolveRig } from '../anim/rig_map.js';
import { buildClip } from '../anim/clip_library.js';
import { importedReactionClipsFor } from '../anim/animation_manifest.js';
import { settleRestingArms } from '../anim/resting_arms.js';
import { heightFor } from '../character_scale.js';

const MANIFEST_URL = '/models/characters/manifest.json';
const loader = new GLTFLoader();
const LOAD_ATTEMPTS = 3;
const LOAD_TIMEOUT_MS = 20_000;
const RETRY_DELAY_MS = [250, 750];
let manifestPromise = null;

// Saitama's GLB exports every untextured slot with a near-black base colour; the match loader
// repairs those slots before it binds them. The preview mounts the GLB directly, so without the
// same repair it showed a black silhouette while the fighter in the arena was correctly coloured.
const MISSING_MATERIAL_COLORS = Object.freeze({
  cape: 0xf2efe7, cape_shadow: 0xded9cc, cape_button: 0xc9a227,
  skin: 0xefc3a0, skin_shadow: 0xd9a07c, glove: 0xc8332f,
  white_eye: 0xffffff, black_eye: 0x111111, eyebrows: 0x1b1b1b,
  shoe_sole: 0x292623, zip1: 0x33302c, zip2: 0x272421,
  belt1: 0x3b3026, belt2: 0x2b241e
});

function repairPreviewMaterials(root, slug) {
  if (slug !== 'saitama') return;
  root.traverse(node => {
    if (!node.isMesh || !node.material) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material || material.map) continue;
      const key = String(material.name || '').replace(/\.\d+$/, '');
      if (key === 'OH_Outline_Material' || !(material.color)) continue;
      const hex = MISSING_MATERIAL_COLORS[key];
      if (hex === undefined) continue;
      if (Math.max(material.color.r, material.color.g, material.color.b) > 0.12) continue;
      material.color.setHex(hex);
      material.userData.materialRepair = 'saitama-missing-base-color-preview';
    }
  });
}

/**
 * Normalise a model authored in centimetres (or another unusual unit) to its roster height.
 * The match mount path does this for every body; the preview used to skip it, so Aquaman and
 * Green Lantern were framed as 2 cm specks. Only clear outliers are touched so already-normal
 * metres are left exactly as authored.
 */
function normalizePreviewHeight(root, slug) {
  // Measure the body as mounted, including the GLTF wrapper's own scale. The shared height
  // helper deliberately resets that scale to inspect the raw mesh, which hid the wrapper scale
  // on Aquaman/Green Lantern and left them at 2 cm in the preview.
  root.updateMatrixWorld(true);
  const measured = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y;
  if (!(measured > 0.001) || (measured >= 1.0 && measured <= 3.2)) return measured;
  const target = heightFor(slug) || 1.8;
  const factor = target / measured;
  root.scale.multiplyScalar(factor);
  root.updateMatrixWorld(true);
  return measured * factor;
}

/** The roster manifest, cached: one request per page, not one per selection. */
function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(MANIFEST_URL, { cache: 'no-cache' })
      .then(response => (response.ok ? response.json() : null))
      .catch(() => null);
  }
  return manifestPromise;
}

function abortError(message = 'preview model load was cancelled') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

/** Wait for a retry without making a superseded selection wait for its old request. */
function waitForRetry(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      reject(abortError());
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

/**
 * Fetch and parse a GLB with cancellation, a bounded wait and two retries.
 *
 * `GLTFLoader.load()` exposes no abort handle, so a rapid roster selection used to leave every
 * previous multi-megabyte download running. Fetching first gives the preview a real AbortController;
 * parsing the ArrayBuffer keeps the same GLTFLoader path once the bytes are present. A retry gets a
 * fresh request, so a single stale/failed response cannot leave the panel on LOADING MODEL.
 */
async function loadModelGltf(url, { signal, onRetry } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < LOAD_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw abortError();
    if (attempt > 0) {
      onRetry?.(attempt + 1);
      await waitForRetry(RETRY_DELAY_MS[attempt - 1] ?? RETRY_DELAY_MS[RETRY_DELAY_MS.length - 1], signal);
    }
    const attemptController = new AbortController();
    const forwardAbort = () => attemptController.abort();
    signal?.addEventListener?.('abort', forwardAbort, { once: true });
    const timeout = setTimeout(() => attemptController.abort(), LOAD_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: attemptController.signal, cache: 'no-cache' });
      if (!response.ok) {
        throw new Error(`fetch for ${url} responded with ${response.status}: ${response.statusText || 'HTTP error'}`);
      }
      const buffer = await response.arrayBuffer();
      clearTimeout(timeout);
      if (signal?.aborted) throw abortError();
      const baseUrl = new URL('.', new URL(url, document.baseURI)).href;
      return await new Promise((resolve, reject) => loader.parse(buffer, baseUrl, resolve, reject));
    } catch (error) {
      if (signal?.aborted) throw abortError();
      lastError = error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener?.('abort', forwardAbort);
    }
  }
  throw lastError || new Error(`could not load ${url}`);
}

function disposeTree(root) {
  // Textures are released by the ownership registry, which refuses to dispose anything shared;
  // geometry and materials are owned solely by this preview and go now.
  releaseModelTextures(root);
  root.traverse(node => {
    if (!node.isMesh) return;
    node.geometry?.dispose?.();
    const list = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of list) material?.dispose?.();
  });
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ onStatus?: (status: {state: string, label?: string, detail?: string}) => void }} options
 * @returns {{ show: (slug: string, label?: string) => Promise<void>, setActive: (on: boolean) => void,
 *            dispose: () => void, available: boolean }}
 */
export function createFighterPreview(canvas, { onStatus } = {}) {
  const report = (state, label, detail = '') => onStatus?.({ state, label, detail });
  const statusElement = document.querySelector('[data-role="previewstatus"]');
  let renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: true, powerPreference: 'low-power'
    });
  } catch (error) {
    // A preview must never be the reason the menu does not open. Report and stay inert.
    report('unavailable', 'PREVIEW UNAVAILABLE', String(error?.message || error));
    return {
      available: false,
      show: async () => {},
      setActive: () => {},
      dispose: () => {}
    };
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60);
  // Three-point studio light: a bright key from the front-left, a cool rim from behind so armour
  // and hair have a separated edge, and a dim fill raised with the sky colour so nothing is black.
  const hemi = new THREE.HemisphereLight(0xbfe9ff, 0x1a2430, 1.15);
  const key = new THREE.DirectionalLight(0xffffff, 2.3);
  key.position.set(2.6, 3.6, 3.2);
  const rim = new THREE.DirectionalLight(0x63e6ff, 1.6);
  rim.position.set(-2.8, 2.0, -2.6);
  const fill = new THREE.AmbientLight(0x8fb6cb, 0.42);
  scene.add(hemi, key, rim, fill);

  const clock = new THREE.Clock();
  let frameId = 0;
  let active = false;
  let root = null;
  let mixer = null;
  let requestId = 0;
  let lastSlug = null;
  let loadController = null;
  let loadingSlug = null;
  let spin = 0;
  // Imported bodies can be authored facing -Z (Dr. Luigi is). The match loader applies the
  // manifest's yawOffset; the preview must apply the same offset or it frames the character's back.
  let modelYaw = 0;
  // Tooling hook: the capture harness pins a yaw so a body can be shot from the front, three-
  // quarter and side instead of only wherever the idle sway happens to be. Null means sway.
  let yawOverride = null;

  function resize() {
    const width = Math.max(1, canvas.clientWidth || canvas.parentElement?.clientWidth || 240);
    const height = Math.max(1, canvas.clientHeight || canvas.parentElement?.clientHeight || 240);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(canvas);

  function frame() {
    frameId = requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta());
    if (mixer) mixer.update(dt);
    if (root) {
      // The one elbow-based settle in resting_arms.js is shared with the live mixer, so the
      // preview and the match cannot disagree about what a resting arm is.
      settleRestingArms(root);
      // A slow sway instead of a turn: enough parallax to read as 3D, never enough to hide the
      // face. The roster GLBs face +Z (the close-up viewer frames them from +Z with no rotation),
      // so the base yaw stays at 0 - a Math.PI base showed every fighter's back.
      spin += dt * 0.35;
      // A three-quarter stance with a small sway reads as a character portrait; a full turn hid
      // the face for half of every cycle, and yaw 0 stared straight down the lens.
      root.rotation.y = (yawOverride === null ? -0.34 + Math.sin(spin) * 0.11 : yawOverride) + modelYaw;
    }
    renderer.render(scene, camera);
  }

  function release() {
    if (mixer) {
      mixer.stopAllAction();
      if (root) mixer.uncacheRoot(root);
      mixer = null;
    }
    if (root) {
      scene.remove(root);
      disposeTree(root);
      root = null;
    }
    modelYaw = 0;
  }

  /**
   * Frame the whole body from its own bounding box, without moving the model.
   *
   * The first version moved the model so its feet sat on y=0 and then aimed a camera at a height
   * derived from the box. That only agrees with itself when the file's origin is at the feet; these
   * exports are not, so the body was lifted out of frame and the capture showed shins. Positioning
   * the camera on the measured centre instead is origin-independent, and it leaves the model's own
   * transforms exactly as exported.
   */
  function frameModel(model) {
    model.updateMatrixWorld(true);
    // A supplied body can carry a detached signature prop (Aquaman's native trident is a mesh
    // under Aux_trident1). Boxing the whole scene framed the empty gap between the prop and the
    // man, leaving the body at the right edge. Frame the body meshes and keep the prop out of the
    // camera solve; the prop is still rendered if it falls inside the panel.
    const body = new THREE.Box3();
    model.traverse(node => {
      if (!node.isMesh) return;
      let excluded = false;
      for (let parent = node; parent; parent = parent.parent) {
        if (/trident|weapon-holder|equipped|pickup/i.test(String(parent.name || ''))) { excluded = true; break; }
      }
      if (!excluded) body.expandByObject(node);
    });
    const box = body.isEmpty() ? new THREE.Box3().setFromObject(model) : body;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const height = Math.max(0.5, size.y);
    const width = Math.max(0.4, size.x);
    const halfTan = Math.tan((camera.fov * Math.PI) / 360);
    // Fit the taller constraint rather than the widest one: fighters hold their arms out, and
    // framing on that width pushed every body into a small figure in a large empty panel. The
    // vertical fit keeps head and feet inside the frame with a small margin, and the horizontal
    // check only takes over for genuinely wide silhouettes (a cape or a spread stance).
    const vertical = (height * 0.5) / halfTan;
    const horizontal = (width * 0.5) / (halfTan * Math.max(0.6, camera.aspect));
    const distance = Math.max(vertical, horizontal) * 1.04;
    camera.position.set(center.x, center.y + height * 0.02, center.z + distance);
    camera.lookAt(center.x, center.y, center.z);
    camera.near = Math.max(0.02, distance * 0.04);
    camera.far = distance * 8;
    camera.updateProjectionMatrix();
    window.__fighterPreviewDebug = {
      boxMin: box.min.toArray().map(v => +v.toFixed(3)),
      boxMax: box.max.toArray().map(v => +v.toFixed(3)),
      size: size.toArray().map(v => +v.toFixed(3)),
      camera: camera.position.toArray().map(v => +v.toFixed(3)),
      distance: +distance.toFixed(3),
      // Tooling only: lets a probe measure and tint the loaded model (which material owns which
      // surface) and frame a head close-up without a second renderer that would not be the real
      // preview. Neither is read by the runtime.
      root: model,
      camera
    };
  }

  function cancelLoad() {
    const controller = loadController;
    loadController = null;
    loadingSlug = null;
    controller?.abort();
  }

  async function show(slug, label = '') {
    if (!slug) return;
    if (!active) { lastSlug = slug; return; }
    // Repeated paint() calls for the same card must not restart an in-flight download.
    if (slug === lastSlug && (root || (loadController && loadingSlug === slug))) return;
    lastSlug = slug;
    const token = ++requestId;
    // A new pick supersedes the old one immediately. Without this, every click left another GLB
    // downloading and the last request could appear to hang behind the abandoned ones.
    cancelLoad();
    const manifest = await loadManifest();
    if (token !== requestId) return;
    const entry = manifest?.characters?.[slug];
    modelYaw = THREE.MathUtils.degToRad(Number(entry?.yawOffset) || 0);
    if (!entry || entry.enabled !== true || !entry.url) {
      release();
      report('fallback', 'PROCEDURAL BODY', `${label || slug} has no enabled model file`);
      return;
    }
    report('loading', 'LOADING MODEL');
    const controller = new AbortController();
    loadController = controller;
    loadingSlug = slug;
    let gltf = null;
    try {
      // Resolve only when this fighter's model is actually in the scene and its idle has been
      // chosen. Resolving when the load was merely *started* let a caller that awaits `show()`
      // screenshot the previous fighter - the roster capture harness caught exactly that, with
      // Superman's body saved as "the flash".
      gltf = await loadModelGltf(entry.url, {
        signal: controller.signal,
        onRetry: attempt => {
          if (token === requestId && !controller.signal.aborted) {
            report('loading', 'LOADING MODEL', `Retry ${attempt}/${LOAD_ATTEMPTS}`);
          }
        }
      });
      if (token !== requestId || controller.signal.aborted) {
        disposeTree(gltf.scene);
        return;
      }
      release();
      // release() resets the facing for the previous body; restore this entry's offset before
      // the first paint or the imported back-facing body is framed from behind again.
      modelYaw = THREE.MathUtils.degToRad(Number(entry.yawOffset) || 0);
      root = gltf.scene;
      root.traverse(node => { node.frustumCulled = false; });
      scene.add(root);
      // Imported bodies are not all authored in metres, and the preview mounts the raw export.
      // Normalise clear outliers before framing so centimetre-scale bodies fill the panel too.
      normalizePreviewHeight(root, slug);
      repairPreviewMaterials(root, slug);
      // Apply the manifest facing before the first paint. Waiting for the animation frame left
      // a one-frame back view, which is exactly what a screenshot taken as soon as the status
      // said MODEL READY captured for the imported Luigi body.
      root.rotation.y = -0.34 + modelYaw;
      claimModelTextures(root);
      frameModel(root);
      const clips = gltf.animations || [];
      // Imported bodies often ship no usable idle (or only a broken zero-duration clip).
      // Fall back to the same authored idle clip the match uses, compiled against this rig,
      // so the select panel never shows a T-pose. Baked clips still win when present.
      // Aquaman's match lane deliberately uses the semantic library idle instead of the source
      // HeroicIdleV2/CombatIdle pair, so the preview must use the same one or it shows a different
      // stance from the fight it is previewing.
      const libraryIdleOnly = new Set(['aquaman', 'naruto_uzumaki', 'wonder_woman', 'infantry']).has(slug);
      // Do not accept clips[0] as an idle. The HD Infantry export only ships walk and run, so the
      // old fallback opened his portrait on a mid-stride run frame; the reaction set below has his
      // real Infantry_idle. A body with no named idle and no reaction set falls through to the
      // compiled idle rather than presenting arbitrary locomotion as a stance.
      let idle = libraryIdleOnly ? null : clips.find(clip => /idle|stand/i.test(clip.name));
      // A body can ship mesh, skin and materials with no animation at all (Goku's converted
      // HD body is one): his clips live in a separate clip-only GLB keyed by the same
      // identity. Read that set first, or the panel shows the raw bind pose - a T-pose.
      if (!idle && !libraryIdleOnly) {
        const set = importedReactionClipsFor({ identityKey: slug });
        if (set?.url) {
          try {
            const clipGltf = await loadModelGltf(set.url, { signal: controller.signal });
            idle = clipGltf.animations.find(clip => clip.name === set.slots?.idle)
              || clipGltf.animations.find(clip => /idle/i.test(clip.name))
              || null;
          } catch (error) {
            if (error?.name !== 'AbortError') {
              console.warn('Imported preview clips unavailable:', error?.message || error);
            }
          }
        }
      }
      if (!idle) {
        try {
          const rig = resolveRig(root);
          idle = rig ? buildClip('idle', rig) : null;
        } catch (error) {
          console.warn('Authored preview idle unavailable:', error?.message || error);
        }
      }
      // The secondary idle request can reject or a newer pick can cancel this body while the
      // clip is in flight. Never publish a preview that is no longer the selected fighter.
      if (token !== requestId || controller.signal.aborted) {
        if (root === gltf.scene) release();
        else disposeTree(gltf.scene);
        return;
      }
      if (idle) {
        mixer = new THREE.AnimationMixer(root);
        const action = mixer.clipAction(idle);
        action.reset().setLoop(THREE.LoopRepeat, Infinity).play();
        // Frame zero of a source clip is routinely its authored bind/equip pose. Advance a little
        // so the panel opens on a settled loop frame rather than a one-frame A-pose.
        mixer.update(Math.min(0.5, Math.max(0.12, idle.duration * 0.22)));
      }
      // Resolve once for every body, not only bodies that needed a compiled idle. The resolver
      // publishes the joint handles the T-pose relaxer and the debug probes read; relying on the
      // buildClip branch left reaction-clip bodies (Infantry) with no handles and one arm out.
      let previewRig = null;
      try { previewRig = resolveRig(root); } catch (error) {
        console.warn('Preview rig resolution unavailable:', error?.message || error);
      }
      if (window.__fighterPreviewDebug) {
        window.__fighterPreviewDebug.idle = idle ? {
          name: idle.name, duration: +idle.duration.toFixed(2), tracks: idle.tracks.length,
          bones: idle.userData?.bones?.length ?? null, mixer: Boolean(mixer)
        } : null;
        // Tooling only: probes build any library clip against this same rig and pose it for
        // front/side inspection without a second renderer or a second copy of the skeleton.
        window.__fighterPreviewDebug.mixer = mixer;
        window.__fighterPreviewDebug.rig = previewRig;
        window.__fighterPreviewDebug.bones = (() => { let n = 0; root.traverse(o => { if (o.isBone) n++; }); return n; })();
      }
      // The clip count is tooling data, not a player label: it is exposed as an attribute
      // for the probes instead of being printed over the character.
      if (statusElement) statusElement.dataset.clips = String(clips.length);
      report('ready', (clips.length || idle) ? 'MODEL READY' : 'STATIC MODEL');
    } catch (error) {
      if (token !== requestId || controller.signal.aborted) {
        if (gltf && root === gltf.scene) release();
        else if (gltf) disposeTree(gltf.scene);
        return;
      }
      release();
      report('fallback', 'MODEL FAILED', String(error?.message || error));
    } finally {
      if (loadController === controller) {
        loadController = null;
        loadingSlug = null;
      }
    }
  }

  function setYaw(angle = null) {
    yawOverride = Number.isFinite(angle) ? angle : null;
    if (root && yawOverride !== null) root.rotation.y = yawOverride + modelYaw;
  }

  function setActive(on) {
    if (on === active) {
      if (on && lastSlug) show(lastSlug);
      return;
    }
    active = on;
    if (on) {
      resize();
      clock.getDelta();
      if (!frameId) frameId = requestAnimationFrame(frame);
      if (lastSlug) show(lastSlug);
    } else {
      // Leaving the fighter step abandons the download rather than letting it finish and compete
      // with the match/arena assets. Reactivating the step starts the selected body again.
      requestId++;
      cancelLoad();
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
    }
  }

  function dispose() {
    active = false;
    requestId++;
    cancelLoad();
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    observer?.disconnect();
    release();
    renderer.dispose();
    renderer = null;
  }

  return { available: true, show, setActive, setYaw, dispose };
}
