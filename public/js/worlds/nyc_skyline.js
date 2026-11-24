import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// A detailed, textured Avengers Tower for the New York skyline. It is scenery only: the
// playable Stark Tower keeps its own lobby, observation deck and roof stages. The model is
// mounted north-west of the playable tower, outside the roam bounds, so it cannot obstruct
// fighters, camera collision or the authored collision volumes. The offset and yaw keep its
// broad A-face out of the playable tower's silhouette for the plaza and roof skyline shot.
const ASSET_VERSION = 'nyc-skyline-v2-20261111';
const LANDMARK_X = -130;
const LANDMARK_Y = 1.2;
const LANDMARK_Z = -200;
// Source front/back are on Z. π put the teal A toward the plaza; the extra turn faces the
// broad face at the stage's skyline camera (south-west of the tower) instead of a thin edge.
const LANDMARK_YAW = Math.PI + .55;
const LANDMARK_SCALE = 1;
const loader = new GLTFLoader();
let layer = null;
let request = null;
let wanted = false;

function state() {
  if (typeof window === 'undefined') return {};
  window.__browserSmashAssets = window.__browserSmashAssets || {};
  return window.__browserSmashAssets;
}

function buildPodium() {
  const group = new THREE.Group();
  group.name = 'NYC skyline podium';
  const stone = new THREE.MeshStandardMaterial({ color: 0x141c29, roughness: 0.92, metalness: 0.08 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(56, 26, 56), stone);
  base.position.y = -11.8;
  base.receiveShadow = false;
  base.castShadow = false;
  group.add(base);
  const rim = new THREE.Mesh(
    new THREE.BoxGeometry(58, 0.5, 58),
    new THREE.MeshStandardMaterial({ color: 0x3a536c, emissive: 0x17364f, emissiveIntensity: 0.5, roughness: 0.55, metalness: 0.35 })
  );
  rim.position.y = 1.25;
  group.add(rim);
  return group;
}

/**
 * Show or hide the New York skyline landmark. Loading only starts when a New York location is
 * selected; leaving the world hides the group without disposing it, and a failed download is a
 * silent fallback that leaves the procedural city untouched.
 */
export function setNycSkyline(enabled, scene) {
  wanted = Boolean(enabled && scene);
  if (layer) layer.visible = wanted;
  if (!wanted || !scene) return request;
  if (layer || request) return request;

  if (!layer) {
    layer = new THREE.Group();
    layer.name = 'NYC skyline · Avengers Tower';
    layer.position.set(LANDMARK_X, LANDMARK_Y, LANDMARK_Z);
    layer.rotation.y = LANDMARK_YAW;
    layer.scale.setScalar(LANDMARK_SCALE);
    layer.add(buildPodium());
    scene.add(layer);
  }

  const url = new URL('../../assets/environments/new-york/avengers_tower.glb', import.meta.url);
  url.searchParams.set('v', ASSET_VERSION);
  state().nycSkyline = { status: 'loading', url: url.href };

  request = new Promise(resolve => {
    loader.load(url.href, gltf => {
      const tower = gltf.scene;
      let meshCount = 0;
      let triangles = 0;
      tower.traverse(node => {
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
          material.envMapIntensity = 1.15;
          // The source is a dusk photograph with very dark metal. At skyline distance it read
          // as a black cut-out against the cloud deck. Reuse the albedo as a low emissive map:
          // lit windows and the teal A survive without turning the whole tower into a lamp.
          if (material.isMeshStandardMaterial && material.map && !material.emissiveMap) {
            material.emissiveMap = material.map;
            material.emissive = new THREE.Color(0x4a6d8c);
            material.emissiveIntensity = .68;
          }
          material.needsUpdate = true;
        }
      });
      tower.name = 'Avengers Tower · detailed skyline';
      layer.add(tower);
      layer.visible = wanted;
      state().nycSkyline = {
        status: 'loaded',
        url: url.href,
        meshCount,
        triangles: Math.round(triangles),
        visible: layer.visible,
        landmark: { x: LANDMARK_X, y: LANDMARK_Y, z: LANDMARK_Z, yaw: LANDMARK_YAW, scale: LANDMARK_SCALE }
      };
      console.info('NYC skyline tower loaded:', meshCount, 'meshes,', Math.round(triangles), 'triangles');
      resolve(layer);
    }, undefined, error => {
      state().nycSkyline = { status: 'fallback', message: String(error?.message || error), url: url.href };
      console.warn('NYC skyline tower failed; procedural city remains:', error);
      resolve(null);
    });
  });
  return request;
}
