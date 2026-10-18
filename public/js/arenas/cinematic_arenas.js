import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.152.2/examples/jsm/loaders/GLTFLoader.js';

const MODEL_PATHS = Object.freeze({
  asgard: 'asgard.glb',
  starktower: 'helicarrier.glb',
  deathstar: 'deathstar.glb',
  hogwarts: 'hogwarts.glb',
  tournament: 'tournament.glb'
});
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

  if (!scene || !MODEL_PATHS[key]) {
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

  const url = new URL('../../assets/arenas/' + MODEL_PATHS[key], import.meta.url);
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
      if (meshCount < 80 || !group.getObjectByName('arena_' + key)) {
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
