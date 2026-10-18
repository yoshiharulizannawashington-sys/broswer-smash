import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

export async function fetchMaps(url = '/data/maps.json') {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load maps.json (${response.status})`);
  return response.json();
}

export async function loadMapById(scene, renderer, mapId, options = {}) {
  const maps = options.maps ?? await fetchMaps(options.mapsUrl);
  const mapData = maps.find((map) => map.id === mapId) ?? maps[0];
  if (!mapData) throw new Error('No maps configured.');

  const loader = new GLTFLoader();
  let stageRoot = new THREE.Group();
  if (mapData.model) {
    try {
      const gltf = await loader.loadAsync(mapData.model);
      stageRoot = gltf.scene;
      stageRoot.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      scene.add(stageRoot);
    } catch (error) {
      console.warn(`Stage asset missing: ${mapData.model}. Using a procedural stage.`, error);
      stageRoot = createFallbackStage(scene, mapData.radius ?? 30);
    }
  }

  // HDRIs are optional. A local HDRI is recommended for deploy reliability.
  if (mapData.hdri && options.loadHDRI !== false) {
    try {
      const texture = await new RGBELoader().loadAsync(mapData.hdri);
      texture.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = texture;
      if (options.useAsBackground) scene.background = texture;
    } catch (error) {
      console.warn('Optional HDRI failed to load; continuing without it.', error);
    }
  }

  return { id: mapData.id, name: mapData.name, radius: mapData.radius ?? 30, root: stageRoot };
}

function createFallbackStage(scene, radius) {
  const root = new THREE.Group();
  const floor = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 1, 64),
    new THREE.MeshStandardMaterial({ color: 0x20283b, metalness: 0.55, roughness: 0.35 })
  );
  floor.position.y = -0.5;
  floor.receiveShadow = true;
  root.add(floor);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius - 0.6, 0.13, 10, 100),
    new THREE.MeshStandardMaterial({ color: 0x59baff, emissive: 0x174cff, emissiveIntensity: 1.8 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.06;
  root.add(ring);
  scene.add(root);
  return root;
}
