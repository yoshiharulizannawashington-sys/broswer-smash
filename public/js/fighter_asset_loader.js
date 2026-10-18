// Detailed skinned fighter assets with real rigged animation clips.
// Uses the Three.js-hosted Soldier GLB (textured PBR model + skeletal animation).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
let sourcePromise;
const tints = {
  warrior: 0xff6a55, ninja: 0x3bc8ff, brawler: 0xe9a04d,
  mage: 0xa18aff, cyborg: 0x48e7d5
};

function loadSource() {
  if (!sourcePromise) sourcePromise = new Promise((resolve, reject) => {
    loader.load(
      'https://threejs.org/examples/models/gltf/Soldier.glb',
      gltf => resolve(gltf),
      undefined,
      error => { sourcePromise = null; reject(error); }
    );
  });
  return sourcePromise;
}

export async function createDetailedFighter(archetype = 'warrior') {
  const gltf = await loadSource();
  const root = new THREE.Group();
  const rig = clone(gltf.scene);
  rig.rotation.y = Math.PI / 2;
  rig.scale.setScalar(1.22);
  rig.traverse(node => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    if (node.material) {
      node.material = node.material.clone();
      if (node.material.color) node.material.color.lerp(new THREE.Color(tints[archetype] || 0xffffff), .2);
      node.material.envMapIntensity = 1;
    }
  });
  root.add(rig);
  const mixer = new THREE.AnimationMixer(rig);
  const actions = {};
  for (const clip of gltf.animations) {
    const action = mixer.clipAction(clip);
    actions[clip.name.toLowerCase()] = action;
  }
  const idle = actions.idle || Object.values(actions)[0];
  idle?.reset().play();
  root.userData.detailedRig = true;
  root.userData.mixer = mixer;
  root.userData.actions = actions;
  root.userData.activeAction = idle;
  root.userData.animTime = 0;
  root.userData.archetype = archetype;
  return root;
}

export function updateDetailedFighter(model, fighter, dt) {
  const data = model?.userData;
  if (!data?.detailedRig || !data.mixer) return;
  data.mixer.update(dt);
  const actions = data.actions;
  const speed = Math.hypot(fighter.velocity.x, fighter.velocity.z);
  const desired = fighter.hitstun > 0
    ? (actions.hit || actions.die || actions.no || actions.idle)
    : !fighter.isGrounded
      ? (actions.jump || actions.walk || actions.idle)
      : speed > 1.1
        ? (fighter.velocity.length() > 8 ? actions.run || actions.walk : actions.walk || actions.run)
        : actions.idle;
  if (desired && desired !== data.activeAction) {
    data.activeAction?.fadeOut(.14);
    desired.reset().fadeIn(.14).play();
    data.activeAction = desired;
  }
  // Keep the imported rig's feet at the same floor height as the original fighters.
  model.scale.y = THREE.MathUtils.damp(model.scale.y, 1, 8, dt);
}
