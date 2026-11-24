import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// The supplied Dragon Ball tournament GLB already ships an authored gate, jade roof and
// gilded ridge pieces. Reuse those exact meshes as East City's north entrance instead of
// painting another approximate torii out of boxes. The arena asset stays the source of
// truth; this module only clones the gate-sized subset (never the 500-mesh stadium).
const ASSET_VERSION = 'dbz-landmarks-v1-20261114';
// Three.js sanitizes node names on import, so match both the authored spaces and the
// underscore form the loader produces.
const GATE_PATTERN = /^(Tournament[ _]gate[ _]pillar|Tournament[ _]gate[ _]lintel|Glazed[ _]jade[ _]roof|Jade[ _]gate[ _]top|Gate[ _]roof[ _]tip)/;
const GATE_CENTER_Z = -43;
const EAST_GATE = Object.freeze({ x: 78, y: 3.2, z: -4, scale: .82 });
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
 * Show/hide the imported DBZ landmark layer. Loading begins only for a DBZ location and a
 * failed download leaves the procedural East City market untouched.
 */
export function setDbzLandmarks(enabled, scene) {
  wanted = Boolean(enabled && scene);
  if (layer) layer.visible = wanted;
  if (!wanted || !scene) return request;
  if (layer || request) return request;

  layer = new THREE.Group();
  layer.name = 'DBZ · imported tournament gate';
  layer.visible = false;
  scene.add(layer);

  const url = new URL('../../assets/arenas/tournament.glb', import.meta.url);
  url.searchParams.set('v', ASSET_VERSION);
  assetState().dbzLandmarks = { status: 'loading', url: url.href };

  request = new Promise(resolve => {
    loader.load(url.href, gltf => {
      const gate = new THREE.Group();
      gate.name = 'East City · supplied tournament gate';
      let meshCount = 0;
      const sources = [];
      // The exporter keeps the arena under one root node, so the gate pieces are descendants,
      // not direct children of gltf.scene. Collect matching meshes while walking the tree.
      gltf.scene.traverse(node => {
        if (node.isMesh && GATE_PATTERN.test(node.name || '')) sources.push(node);
      });
      for (const source of sources) {
        const clone = source.clone(true);
        // Gate pieces are authored at x 0, z -43 around the arena's north gate. Shift them
        // into a local origin, then scale the whole gate down to a market entrance.
        clone.position.z -= GATE_CENTER_Z;
        gate.add(clone);
        meshCount++;
        clone.castShadow = false;
        clone.receiveShadow = true;
        const materials = Array.isArray(clone.material) ? clone.material : [clone.material];
        for (const material of materials) {
          if (!material) continue;
          material.fog = true;
          material.needsUpdate = true;
        }
      }
      gate.scale.setScalar(EAST_GATE.scale);
      gate.position.set(EAST_GATE.x, EAST_GATE.y, EAST_GATE.z);
      layer.add(gate);
      layer.visible = wanted;
      assetState().dbzLandmarks = {
        status: meshCount ? 'loaded' : 'fallback',
        url: url.href,
        meshCount,
        source: 'tournament.glb · gate subset',
        position: [EAST_GATE.x, EAST_GATE.y, EAST_GATE.z],
        scale: EAST_GATE.scale
      };
      resolve(layer);
    }, undefined, error => {
      assetState().dbzLandmarks = { status: 'fallback', message: String(error?.message || error), url: url.href };
      console.warn('DBZ landmark gate failed; procedural East City remains:', error);
      resolve(null);
    });
  });
  return request;
}
