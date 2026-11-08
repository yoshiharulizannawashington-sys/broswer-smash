import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { tuneAsgardMaterials } from './asgard_materials.js';
import { tuneArchitecturalStone } from './architectural_materials.js';
import { buildAsgardArchitecture, buildAsgardCourtyard } from './asgard_architecture.js';
import { buildHogwartsArchitecture } from './hogwarts_architecture.js';

// The map key is the id the game selects by; `marker` is the node the Blender exporter
// writes as the arena's root, which is not always the same word (the Stark Tower map is
// built from the helicarrier scene). Validating the marker against the map key instead of
// the file made every starktower load fail its own structure check.
const MODEL_PATHS = Object.freeze({
  asgard: { file: 'asgard.glb', marker: 'arena_asgard' },
  starktower: { file: 'helicarrier.glb', marker: 'arena_helicarrier' },
  deathstar: { file: 'deathstar.glb', marker: 'arena_deathstar' },
  hogwarts: { file: 'hogwarts.glb', marker: 'arena_hogwarts' },
  tournament: { file: 'tournament.glb', marker: 'arena_tournament' }
});
// The authored scenes are dense (300-900 meshes). Anything much smaller means the export
// is truncated or the wrong file, so treat it as unavailable and keep the procedural arena.
const MIN_ARENA_MESHES = 80;
const ASSET_VERSION = 'cinematic-arena-library-v1-20261018';
const loader = new GLTFLoader();
const loadedArenas = new Map();
let arenaLayer = null;
let activeArenaKey = null;

function stateRoot() {
  if (typeof window === 'undefined') return {};
  window.__browserSmashAssets = window.__browserSmashAssets || {};
  window.__browserSmashAssets.arenas = window.__browserSmashAssets.arenas || {};
  return window.__browserSmashAssets;
}

function hideAllArenaAssets() {
  for (const item of loadedArenas.values()) {
    if (item.group) item.group.visible = false;
  }
}

/**
 * Lazily load only the selected authored Blender arena. Existing Three.js set dressing
 * stays visible as a fallback; a failed GLB never prevents a match from loading.
 */
export async function setCinematicArena(key, scene) {
  activeArenaKey = key;
  hideAllArenaAssets();

  const config = MODEL_PATHS[key];
  if (!scene || !config) {
    stateRoot().activeArena = key;
    return null;
  }

  if (!arenaLayer) {
    arenaLayer = new THREE.Group();
    arenaLayer.name = 'Blender cinematic arena assets';
    scene.add(arenaLayer);
  } else if (arenaLayer.parent !== scene) {
    arenaLayer.parent?.remove(arenaLayer);
    scene.add(arenaLayer);
  }

  stateRoot().activeArena = key;
  const cached = loadedArenas.get(key);
  if (cached?.group) {
    cached.group.visible = activeArenaKey === key;
    stateRoot().arenas[key] = { status: 'loaded', meshCount: cached.meshCount, url: cached.url, cached: true };
    return cached.group;
  }

  if (cached?.promise) return cached.promise;

  const url = new URL('../../assets/arenas/' + config.file, import.meta.url);
  url.searchParams.set('v', ASSET_VERSION);
  stateRoot().arenas[key] = { status: 'loading', url: url.href };

  const promise = new Promise((resolve, reject) => {
    loader.load(url.href, gltf => {
      const group = gltf.scene;
      group.name = 'Blender arena · ' + key;
      let meshCount = 0;
      group.traverse(node => {
        if (node.isMesh) {
          meshCount++;
          node.castShadow = true;
          node.receiveShadow = true;
          if (node.material) {
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            for (const material of materials) {
              material.needsUpdate = true;
            }
          }
        }
      });
      if (meshCount < MIN_ARENA_MESHES || !group.getObjectByName(config.marker)) {
        const error = new Error('Arena GLB failed structure check for ' + key + ' (' + meshCount + ' meshes)');
        stateRoot().arenas[key] = { status: 'error', message: error.message, url: url.href };
        loadedArenas.delete(key);
        reject(error);
        return;
      }
      // Asgard is the one authored arena whose look is driven by material balance rather than by
      // geometry: seven untextured materials, four of them emissive across 87% of the primitives.
      // `__browserSmashAsgardTuning = false` renders the untouched materials so a before/after can be
      // shot with an identical camera.
      if (key === 'asgard' && globalThis.window?.__browserSmashAsgardTuning !== false) {
        const tuning = tuneAsgardMaterials(group);
        stateRoot().asgardTuning = tuning;
        // Real geometry, built on the mounted palace's own measured surfaces: plinths, cornices,
        // pilasters, panel bands, fountain rim blocks, pier bases and capitals.
        const architecture = buildAsgardArchitecture(group);
        stateRoot().asgardArchitecture = architecture;
        globalThis.window.__browserSmashAsgardArchitecture = architecture;
        globalThis.window.__browserSmashAsgardArchitectureMeshes = group.userData.asgardArchitectureMeshes || [];
        // Measured courtyard rim on the real town-square edge. Stays opt-in (?courtyardBand=1) until the
        // stone reads as monumental Asgardian construction at gameplay distance.
        // The measured gilt-inlay square (46 x 46) turned out to be a floor motif inside a much larger
        // marble plaza, not the courtyard edge: in the captured frames the band reads as a low dark
        // kerb in mid-plaza instead of the retaining wall this pass was meant to build. The geometry
        // and its tests are kept for the corrected placement, but it must not ship as a visible
        // defect. Visual architecture only: collision stays with world/arena_layouts.js.
        const courtyardBand = /(?:^|[?&])courtyardBand=1(?:&|$)/.test(globalThis.location?.search || '');
        if (courtyardBand) {
          const courtyard = buildAsgardCourtyard(group);
          stateRoot().asgardCourtyard = courtyard;
          globalThis.window.__browserSmashAsgardCourtyard = courtyard;
          globalThis.window.__browserSmashAsgardCourtyard = courtyard;
          globalThis.window.__browserSmashAsgardCourtyardMeshes = group.userData.asgardCourtyardMeshes || [];
        }
        console.info('Asgard material tuning applied', tuning.tuned.length, 'materials;',
          architecture.added, 'architecture parts in', architecture.meshCount, 'meshes');
      }
      // Hogwarts: real stone geometry on the hall's own named parts (piers, arches, keystones,
      // capitals, ribs, lancet frames). `__browserSmashHogwartsArchitecture = false` mounts the hall
      // untouched so a capture can shoot the same camera with and without the detail.
      if (key === 'hogwarts' && globalThis.window?.__browserSmashHogwartsArchitecture !== false) {
        const architecture = buildHogwartsArchitecture(group);
        stateRoot().hogwartsArchitecture = architecture;
        globalThis.window.__browserSmashHogwartsArchitecture = architecture;
        globalThis.window.__browserSmashHogwartsArchitectureMeshes = group.userData.hogwartsArchitectureMeshes || [];
        console.info('Hogwarts architecture built:', architecture.added, 'parts in', architecture.meshCount, 'meshes');
      }
      group.visible = activeArenaKey === key;
      // Read-only handle for the title composition and its verification: the title camera has to be
      // authored against the geometry that actually mounted, not against remembered coordinates.
      globalThis.window.__browserSmashAuthoredGroup = group;
      globalThis.window.__browserSmashAuthoredKey = key;
      arenaLayer.add(group);
      // Architectural stone has to be tuned on the group that actually contains the arena meshes.
      // The caller used to pass a different container, so the pass traversed an empty tree and every
      // Great Hall surface kept its flat untextured factor.
      if (key !== 'asgard' && globalThis.window?.__browserSmashStoneTuning !== false) {
        const stone = tuneArchitecturalStone(group, key);
        stateRoot().stoneTuning = stone;
        globalThis.window.__browserSmashStoneTuning = stone;
        console.info('Architectural stone applied to ' + key + ':', stone.tuned.length, 'materials');
      }
      loadedArenas.set(key, { group, meshCount, url: url.href, promise: null });
      stateRoot().arenas[key] = { status: 'loaded', meshCount, url: url.href, cached: false };
      resolve(group);
    }, undefined, error => {
      stateRoot().arenas[key] = { status: 'fallback', message: String(error?.message || error), url: url.href };
      loadedArenas.delete(key);
      reject(error);
    });
  });

  loadedArenas.set(key, { group: null, meshCount: 0, url: url.href, promise });
  try {
    return await promise;
  } catch (error) {
    // Keep the procedural map alive; allow a later selection to retry the GLB.
    loadedArenas.delete(key);
    console.warn('Blender arena asset failed; procedural arena remains enabled:', key, error);
    return null;
  }
}
