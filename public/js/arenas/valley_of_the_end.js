// Valley of the End arena, built from the supplied Sketchfab model.
//
// The old `finalvalley` stage was procedural scenery plus `assets/final_valley.glb`. That stand-in
// is replaced by the real valley: a 21.7 x 57.8 m gorge with two guardian statues at its head.
// It is mounted at 5.4x, which makes it 117 m across, 312 m long and ~42 m tall, so it spans the
// arena's full 116 x 88 m playfield and the statues tower over the far end instead of sitting in
// the middle of the fighting space.
//
// Only the model's vertices, materials and textures are reused. The gameplay root, floor height,
// bounds and collision stay owned by `world/arena_layouts.js`, so nothing about the match changes
// except what the player sees.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ASSET_PATH = '../../assets/arenas/valley_of_the_end.glb';
const ASSET_VERSION = 'valley-of-the-end-arena-v1-20261110';
// 117 m across: the playfield is 116 m wide (x -58..58), so the canyon walls sit just outside the
// bounds the fighters are clamped to.
const ARENA_SCALE = 5.4;
// The source river surface is a plane whose top is at y = 0.2 m. Lifting the model by that much
// puts the water at y = 0.005: the fighters stand on it and the game's flat ground plane stays
// underneath, so the arena never floats or z-fights with the floor.
const RIVER_TOP_Y = 0.2 * ARENA_SCALE;
const GROUND_Y = -(RIVER_TOP_Y - 0.005);
// The statue end (source z = -23.2) lands at z = -70, just beyond the far bound (-66); the gorge
// then runs back past the spawns and the camera, which is what makes the valley feel huge.
const PLACE_Z = 55.3;

export function createValleyOfTheEnd(THREE) {
  const group = new THREE.Group();
  group.name = 'Final Valley - Valley of the End arena';
  const state = typeof window !== 'undefined' ? (window.__browserSmashAssets ||= {}) : {};
  const url = new URL(ASSET_PATH, import.meta.url);
  url.searchParams.set('v', ASSET_VERSION);
  state.finalValley = { status: 'loading', url: url.href, scale: ARENA_SCALE };

  const loader = new GLTFLoader();
  loader.load(url.href, gltf => {
    const root = gltf.scene;
    root.name = 'Valley of the End (Sketchfab model)';
    root.scale.setScalar(ARENA_SCALE);
    root.position.set(0, GROUND_Y, PLACE_Z);
    root.updateMatrixWorld(true);
    let meshCount = 0;
    root.traverse(node => {
      if (!node.isMesh) return;
      meshCount += 1;
      node.castShadow = true;
      node.receiveShadow = true;
      // The cliff shell is one 14k-triangle mesh that spans the whole canyon. Leaving frustum
      // culling on makes the entire gorge pop out as soon as the camera sits inside its bounds.
      node.frustumCulled = false;
      for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
        if (!material) continue;
        material.envMapIntensity = 0.7;
        if (material.map) {
          material.map.anisotropy = 8;
          material.map.needsUpdate = true;
        }
        material.needsUpdate = true;
      }
    });
    group.add(root);
    state.finalValley = {
      status: meshCount ? 'loaded' : 'partial',
      meshCount, url: url.href, scale: ARENA_SCALE,
      placement: { y: GROUND_Y, z: PLACE_Z }
    };
    if (typeof window !== 'undefined') {
      window.__browserSmashFinalValley = {
        root, meshCount, scale: ARENA_SCALE,
        span: { width: 21.71 * ARENA_SCALE, depth: 57.82 * ARENA_SCALE, height: 7.89 * ARENA_SCALE }
      };
    }
  }, undefined, error => {
    state.finalValley = { status: 'fallback', message: String(error?.message || error), url: url.href };
  });

  // The canyon walls are outside the arena bounds, so the existing clamp already keeps fighters on
  // the river. No invisible blocks are added inside the fighting space.
  const obstacles = [];
  const update = () => {};

  return { group, obstacles, update, scale: ARENA_SCALE };
}
