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

const MANIFEST_URL = '/models/characters/manifest.json';
const loader = new GLTFLoader();
let manifestPromise = null;

/** The roster manifest, cached: one request per page, not one per selection. */
function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(MANIFEST_URL, { cache: 'no-cache' })
      .then(response => (response.ok ? response.json() : null))
      .catch(() => null);
  }
  return manifestPromise;
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
  let spin = 0;
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
      // A slow sway instead of a turn: enough parallax to read as 3D, never enough to hide the
      // face. The roster GLBs face +Z (the close-up viewer frames them from +Z with no rotation),
      // so the base yaw stays at 0 - a Math.PI base showed every fighter's back.
      spin += dt * 0.35;
      // A three-quarter stance with a small sway reads as a character portrait; a full turn hid
      // the face for half of every cycle, and yaw 0 stared straight down the lens.
      root.rotation.y = yawOverride === null ? -0.34 + Math.sin(spin) * 0.11 : yawOverride;
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
    const box = new THREE.Box3().setFromObject(model);
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

  async function show(slug, label = '') {
    if (!slug) return;
    if (!active) { lastSlug = slug; return; }
    if (slug === lastSlug && root) return;
    lastSlug = slug;
    const token = ++requestId;
    const manifest = await loadManifest();
    if (token !== requestId) return;
    const entry = manifest?.characters?.[slug];
    if (!entry || entry.enabled !== true || !entry.url) {
      release();
      report('fallback', 'PROCEDURAL BODY', `${label || slug} has no enabled model file`);
      return;
    }
    report('loading', 'LOADING MODEL');
    // Resolve only when this fighter's model is actually in the scene. Resolving when the load was
    // merely *started* let a caller that awaits `show()` screenshot the previous fighter - the
    // roster capture harness caught exactly that, with Superman's body saved as "the flash".
    await new Promise(resolve => {
      loader.load(
        entry.url,
        async gltf => {
          if (token !== requestId) {
            disposeTree(gltf.scene);
            resolve();
            return;
          }
          release();
          root = gltf.scene;
          root.traverse(node => { node.frustumCulled = false; });
          scene.add(root);
          claimModelTextures(root);
          frameModel(root);
          const clips = gltf.animations || [];
          // Imported bodies often ship no usable idle (or only a broken zero-duration clip).
          // Fall back to the same authored idle clip the match uses, compiled against this rig,
          // so the select panel never shows a T-pose. Baked clips still win when present.
          let idle = clips.find(clip => /idle|stand/i.test(clip.name)) || clips[0];
          // A body can ship mesh, skin and materials with no animation at all (Goku's converted
          // HD body is one): his clips live in a separate clip-only GLB keyed by the same
          // identity. Read that set first, or the panel shows the raw bind pose - a T-pose.
          if (!idle) {
            const set = importedReactionClipsFor({ identityKey: slug });
            if (set?.url) {
              try {
                const clipGltf = await new GLTFLoader().loadAsync(set.url);
                idle = clipGltf.animations.find(clip => clip.name === set.slots?.idle)
                  || clipGltf.animations.find(clip => /idle/i.test(clip.name))
                  || null;
              } catch (error) {
                console.warn('Imported preview clips unavailable:', error?.message || error);
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
          if (idle) {
            mixer = new THREE.AnimationMixer(root);
            const action = mixer.clipAction(idle);
            action.reset().setLoop(THREE.LoopRepeat, Infinity).play();
          }
          if (window.__fighterPreviewDebug) {
            window.__fighterPreviewDebug.idle = idle ? {
              name: idle.name, duration: +idle.duration.toFixed(2), tracks: idle.tracks.length,
              bones: idle.userData?.bones?.length ?? null, mixer: Boolean(mixer)
            } : null;
            // Tooling only: probes build any library clip against this same rig and pose it for
            // front/side inspection without a second renderer or a second copy of the skeleton.
            window.__fighterPreviewDebug.mixer = mixer;
            window.__fighterPreviewDebug.rig = idle ? resolveRig(root) : null;
            window.__fighterPreviewDebug.bones = (() => { let n = 0; root.traverse(o => { if (o.isBone) n++; }); return n; })();
          }
          // The clip count is tooling data, not a player label: it is exposed as an attribute
          // for the probes instead of being printed over the character.
          if (statusElement) statusElement.dataset.clips = String(clips.length);
          report('ready', (clips.length || idle) ? 'MODEL READY' : 'STATIC MODEL');
          resolve();
        },
        undefined,
        error => {
          if (token === requestId) {
            release();
            report('fallback', 'MODEL FAILED', String(error?.message || error));
          }
          resolve();
        }
      );
    });
  }

  function setYaw(angle = null) {
    yawOverride = Number.isFinite(angle) ? angle : null;
    if (root && yawOverride !== null) root.rotation.y = yawOverride;
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
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
    }
  }

  function dispose() {
    active = false;
    requestId++;
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    observer?.disconnect();
    release();
    renderer.dispose();
    renderer = null;
  }

  return { available: true, show, setActive, setYaw, dispose };
}
