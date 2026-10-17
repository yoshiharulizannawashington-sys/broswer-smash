// public/js/main.js — renderer, postprocessing, stage, spawn logic, cinematic camera
import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.152.2/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'https://unpkg.com/three@0.152.2/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://unpkg.com/three@0.152.2/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://unpkg.com/three@0.152.2/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'https://unpkg.com/three@0.152.2/examples/jsm/postprocessing/SSAOPass.js';
import { ShaderPass } from 'https://unpkg.com/three@0.152.2/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'https://unpkg.com/three@0.152.2/examples/jsm/shaders/FXAAShader.js';
import { OutlinePass } from 'https://unpkg.com/three@0.152.2/examples/jsm/postprocessing/OutlinePass.js';
import { FilmPass } from 'https://unpkg.com/three@0.152.2/examples/jsm/postprocessing/FilmPass.js';

import SmashInputHandler from './smash_input.js';
import Fighter3D from './fighter3D.js';
import { makeProceduralCharacter } from './models.js';

// renderer + scene
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 6, 16);

// cinematic camera controller state
const camState = { targetZoom: 16, currentZoom: 16, shake: 0 };
function updateCamera(dt) {
  camState.currentZoom += (camState.targetZoom - camState.currentZoom) * Math.min(1, dt * 6);
  camera.position.z = camState.currentZoom;
  if (camState.shake > 0) {
    const s = camState.shake * (Math.random() - 0.5);
    camera.position.x += s; camera.position.y += s * 0.25;
    camState.shake = Math.max(0, camState.shake - dt * 6);
  }
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.enabled = false;

// lights
const hemi = new THREE.HemisphereLight(0xffffff, 0x101218, 0.5);
const dir = new THREE.DirectionalLight(0xffffff, 2.0);
dir.position.set(6, 12, 6); dir.castShadow = true;
scene.add(hemi, dir);

// stage
const groundMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.05, roughness: 0.82 });
const ground = new THREE.Mesh(new THREE.BoxGeometry(40, 1, 14), groundMat);
ground.position.y = -0.5; ground.receiveShadow = true; scene.add(ground);
const platform = new THREE.Mesh(new THREE.BoxGeometry(6, 0.6, 3), groundMat);
platform.position.set(0, 3, 0); platform.receiveShadow = true; platform.castShadow = true; scene.add(platform);

// subtle environment lights
const rim = new THREE.DirectionalLight(0x88ccff, 0.25); rim.position.set(-6,6,-8); scene.add(rim);

// sky gradient
const skyGeo = new THREE.SphereGeometry(80, 16, 8);
const skyMat = new THREE.MeshBasicMaterial({ color: 0x071026, side: THREE.BackSide });
const sky = new THREE.Mesh(skyGeo, skyMat); scene.add(sky);

// postprocessing
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const ssao = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight);
ssao.radius = 0.45; ssao.kernelRadius = 14; composer.addPass(ssao);
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.7, 0.4, 0.9);
composer.addPass(bloom);
const outline = new OutlinePass(new THREE.Vector2(window.innerWidth, window.innerHeight), scene, camera);
outline.edgeStrength = 3.2; outline.visibleEdgeColor.set('#ffffff'); composer.addPass(outline);
const film = new FilmPass(0.015, 0.2, 648, false); film.renderToScreen = false; composer.addPass(film);
const fxaa = new ShaderPass(FXAAShader); fxaa.material.uniforms['resolution'].value.set(1 / window.innerWidth, 1 / window.innerHeight); fxaa.renderToScreen = true; composer.addPass(fxaa);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  composer.setSize(window.innerWidth, window.innerHeight);
  fxaa.material.uniforms['resolution'].value.set(1 / window.innerWidth, 1 / window.innerHeight);
});

// input + fighters
const input = new SmashInputHandler();
window.fighters = [];
const outlineTargets = [];

function spawnProcedural(name, pos, archetype) {
  const model = makeProceduralCharacter(archetype);
  model.position.copy(pos);
  scene.add(model);
  const f = new Fighter3D({ name, model, weight: 80 });
  window.fighters.push(f);
  outlineTargets.push(model);
  outline.selectedObjects = outlineTargets;
  return f;
}

// initial pair
spawnProcedural('Apex', new THREE.Vector3(-3, 0, 0), 'ninja');
spawnProcedural('Atlas', new THREE.Vector3(3, 0, 0), 'warrior');

// UI hooks
document.getElementById('spawnBtn').onclick = () => {
  const list = ['ninja','warrior','brawler','mage','cyborg'];
  const a = list[Math.floor(Math.random()*list.length)];
  spawnProcedural('F-' + Math.floor(Math.random()*999), new THREE.Vector3((Math.random()*8)-4,0,0), a);
};
document.getElementById('spawnPairBtn').onclick = () => {
  spawnProcedural('Ally-'+Math.floor(Math.random()*999), new THREE.Vector3(-4,0,0),'ninja');
  spawnProcedural('Rival-'+Math.floor(Math.random()*999), new THREE.Vector3(4,0,0),'warrior');
};
document.getElementById('finalBtn').onclick = () => {
  // big VFX + camera zoom trigger
  camState.targetZoom = 9; camState.shake = 1.8;
  setTimeout(()=>{ camState.targetZoom = 16; }, 1200);
  // pulse bloom
  bloom.strength = 1.6; setTimeout(()=> bloom.strength = 0.7, 900);
};

// fixed timestep sim
let accumulator = 0; const dt = 1/60; const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const frameTime = Math.min(0.1, clock.getDelta()); accumulator += frameTime; input.update();

  while (accumulator >= dt) {
    for (const f of window.fighters) f.simulate(dt, input);
    accumulator -= dt;
  }

  const delta = clock.getDelta();
  for (const f of window.fighters) f.updateAnimations(delta);
  updateCamera(delta);
  composer.render(delta);
}
animate();
