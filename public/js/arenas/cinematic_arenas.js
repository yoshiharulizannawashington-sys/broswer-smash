import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
      group.visible = activeArenaKey === key;
      arenaLayer.add(group);
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
