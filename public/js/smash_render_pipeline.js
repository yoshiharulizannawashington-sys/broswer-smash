// Shared renderer and post-processing setup for Browser Smash.
import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';
import { EffectComposer } from 'https://unpkg.com/three@0.152.2/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://unpkg.com/three@0.152.2/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://unpkg.com/three@0.152.2/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'https://unpkg.com/three@0.152.2/examples/jsm/postprocessing/OutputPass.js';

export function createSmashRenderPipeline(canvas, scene) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const camera = new THREE.PerspectiveCamera(49, innerWidth / innerHeight, .1, 500);
  camera.position.set(0, 12, 18);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .4, .35, .85);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  return { renderer, camera, composer, bloom };
}

export function createWetStoneMaterial(color = 0x303b47) {
  return new THREE.MeshStandardMaterial({ color, metalness: .28, roughness: .2 });
}
