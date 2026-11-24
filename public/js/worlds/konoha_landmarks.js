import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Static, lazy-loaded Konoha landmarks assembled in Blender from two separate Sketchfab
// creators: the Six Hokage Mountain relief and the Hokage Office. They sit behind the
// playable Hokage Rock terrace, outside every stage bound, and never replace the existing
// procedural village, collision or stage layout. The supplied village asset is a tabletop
// diorama and is deliberately not mounted here (see provenance.json).
const ASSET_VERSION = 'konoha-landmarks-v1-20261113';
const OFFSET_Z = 0;
const MOUNTAIN_BACKDROP_Z = -180;
const MOUNTAIN_SCALE = 1.5;
const loader = new GLTFLoader();
let layer = null;
let request = null;
let wanted = false;

function assetState() {
  if (typeof window === 'undefined') return {};
  window.__browserSmashAssets = window.__browserSmashAssets || {};
  return window.__browserSmashAssets;
}

/**
 * Show/hide the imported Konoha landmarks. Loading only starts when a Konoha location is
 * selected. A failed download falls back to the untouched procedural village.
 */
export function setKonohaLandmarks(enabled, scene) {
  wanted = Boolean(enabled && scene);
  if (layer) layer.visible = wanted;
  if (!wanted || !scene) return request;
  if (layer || request) return request;

  layer = new THREE.Group();
  layer.name = 'Konoha · imported landmarks';
  layer.position.set(0, 0, OFFSET_Z);
  scene.add(layer);

  const url = new URL('../../assets/environments/konoha/hokage_landmarks.glb', import.meta.url);
  url.searchParams.set('v', ASSET_VERSION);
  assetState().konohaLandmarks = { status: 'loading', url: url.href };

  request = new Promise(resolve => {
    loader.load(url.href, gltf => {
      const root = gltf.scene;
      let meshCount = 0;
      let triangles = 0;
      root.traverse(node => {
        if (!node.isMesh) return;
        meshCount++;
        node.castShadow = false;
        node.receiveShadow = false;
        const geometry = node.geometry;
        if (geometry?.index) triangles += geometry.index.count / 3;
        else if (geometry?.attributes?.position) triangles += geometry.attributes.position.count / 3;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) {
          if (!material) continue;
          material.fog = true;
          material.envMapIntensity = 1.05;
          material.side = THREE.DoubleSide;
          material.needsUpdate = true;
        }
      });
      root.name = 'Six Hokage Mountain and Hokage Office · imported';
      // The relief sits on the northern skyline behind the Hokage Rock terrace; it remains
      // outside every playable bound. The office keeps its assembly position north of Main Street.
      const mountain = root.getObjectByName('konoha_hokage_mountain');
      if (mountain) {
        mountain.position.z = MOUNTAIN_BACKDROP_Z;
        mountain.position.y = -35;
        mountain.scale.setScalar(MOUNTAIN_SCALE);
      }
      layer.add(root);
      layer.visible = wanted;
      assetState().konohaLandmarks = {
        status: 'loaded',
        url: url.href,
        meshCount,
        triangles: Math.round(triangles),
        visible: layer.visible,
        offsetZ: OFFSET_Z,
        mountainBackdropZ: MOUNTAIN_BACKDROP_Z,
        mountainScale: MOUNTAIN_SCALE,
        placement: 'northern cliff skyline behind the Hokage Rock terrace, outside playable bounds'
      };
      console.info('Konoha landmarks loaded:', meshCount, 'meshes,', Math.round(triangles), 'triangles');
      resolve(layer);
    }, undefined, error => {
      assetState().konohaLandmarks = {
        status: 'fallback',
        message: String(error?.message || error),
        url: url.href
      };
      console.warn('Konoha landmarks failed; procedural village remains:', error);
      resolve(null);
    });
  });
  return request;
}
