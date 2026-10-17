// public/js/main.js — renderer, postprocessing, stage, spawn logic, cinematic camera, HDRI + CC0 model loading
import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.152.2/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'https://unpkg.com/three@0.152.2/examples/jsm/loaders/RGBELoader.js';
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
scene.background = new THREE.Color(0x07070a);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 6, 18);

// cinematic camera controller state
window.camState = { targetZoom: 18, currentZoom: 18, shake: 0 };
function updateCamera(dt) {
  const cam = window.camState;
  cam.currentZoom += (cam.targetZoom - cam.currentZoom) * Math.min(1, dt * 6);
  camera.position.z = cam.currentZoom;
  if (cam.shake > 0) {
    const s = cam.shake * (Math.random() - 0.5);
    camera.position.x += s; camera.position.y += s * 0.25;
    cam.shake = Math.max(0, cam.shake - dt * 6);
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
const groundMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.04, roughness: 0.82 });
const ground = new THREE.Mesh(new THREE.BoxGeometry(44, 1, 18), groundMat);
ground.position.y = -0.5; ground.receiveShadow = true; scene.add(ground);
const platform = new THREE.Mesh(new THREE.BoxGeometry(7, 0.6, 3), groundMat);
platform.position.set(0, 3, 0); platform.receiveShadow = true; platform.castShadow = true; scene.add(platform);

// subtle environment lights
const rim = new THREE.DirectionalLight(0x88ccff, 0.25); rim.position.set(-6,6,-8); scene.add(rim);

// sky gradient
const skyGeo = new THREE.SphereGeometry(120, 16, 8);
const skyMat = new THREE.MeshBasicMaterial({ color: 0x071026, side: THREE.BackSide });
const sky = new THREE.Mesh(skyGeo, skyMat); scene.add(sky);

// postprocessing
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const ssao = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight);
ssao.radius = 0.45; ssao.kernelRadius = 14; composer.addPass(ssao);
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.8, 0.4, 0.95);
composer.addPass(bloom);
const outline = new OutlinePass(new THREE.Vector2(window.innerWidth, window.innerHeight), scene, camera);
outline.edgeStrength = 3.2; outline.visibleEdgeColor.set('#ffffff'); composer.addPass(outline);
const film = new FilmPass(0.012, 0.16, 648, false); film.renderToScreen = false; composer.addPass(film);
const fxaa = new ShaderPass(FXAAShader); fxaa.material.uniforms['resolution'].value.set(1 / window.innerWidth, 1 / window.innerHeight); fxaa.renderToScreen = true; composer.addPass(fxaa);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  composer.setSize(window.innerWidth, window.innerHeight);
  fxaa.material.uniforms['resolution'].value.set(1 / window.innerWidth, 1 / window.innerHeight);
});

// HDRI (Poly Haven CC0)
const rgbe = new RGBELoader();
const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();
const hdrUrl = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_03_1k.hdr';
rgbe.setDataType(THREE.UnsignedByteType).load(hdrUrl, (tex) => {
  const env = pmremGenerator.fromEquirectangular(tex).texture;
  scene.environment = env;
  scene.background = null;
  tex.dispose(); pmremGenerator.dispose();
});

// input + fighters
const input = new SmashInputHandler();
window.fighters = [];
const outlineTargets = [];

// GLTF loader for CC0 models
const loader = new GLTFLoader();
const cc0Models = [
  { name: 'Fox', url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Fox/glTF-Binary/Fox.glb' },
  { name: 'CesiumMan', url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/CesiumMan/glTF-Binary/CesiumMan.glb' }
];

function tweakMaterials(root) {
  root.traverse((n) => {
    if (n.isMesh && n.material) {
      // ensure PBR standard material
      n.material.metalness = Math.min(1, (n.material.metalness ?? 0) + 0.15);
      n.material.roughness = Math.max(0.08, (n.material.roughness ?? 0.6) - 0.12);
      n.castShadow = true; n.receiveShadow = true;
      // slight emissive boost for accents
      if (n.material.name && /emissive|light|eye/i.test(n.material.name)) {
        n.material.emissiveIntensity = 0.6;
      }
    }
  });
}

function spawnRemoteModel(modelInfo, pos, namePrefix) {
  loader.load(modelInfo.url, (gltf) => {
    const model = gltf.scene;
    model.position.copy(pos);
    model.scale.setScalar(1.0);
    tweakMaterials(model);
    scene.add(model);
    const f = new Fighter3D({ name: namePrefix + '-' + modelInfo.name, model, weight: 80 });
    window.fighters.push(f);
    outlineTargets.push(model);
    outline.selectedObjects = outlineTargets;
  }, undefined, (err) => console.warn('Model load failed', modelInfo.url, err));
}

// Spawn CC0 models for higher fidelity fighters
spawnRemoteModel(cc0Models[0], new THREE.Vector3(-3,0,0), 'Alpha');
spawnRemoteModel(cc0Models[1], new THREE.Vector3(3,0,0), 'Beta');

// fallback procedural spawns
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

spawnProcedural('Apex', new THREE.Vector3(-6, 0, 0), 'ninja');
spawnProcedural('Atlas', new THREE.Vector3(6, 0, 0), 'warrior');

// UI hooks
window.spawnProcedural = spawnProcedural;

// simple impact particle spawner (sprite-free: use small spheres)
window.spawnImpact = (pos, intensity=6) => {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffddaa, emissive: 0xff8844, emissiveIntensity: 0.6, metalness: 0.2, roughness: 0.2 });
  for (let i=0;i<6;i++){
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.06,6,6), mat);
    s.position.copy(pos).add(new THREE.Vector3((Math.random()-0.5)*0.6, Math.random()*0.4, (Math.random()-0.5)*0.6));
    group.add(s);
  }
  scene.add(group);
  // fade & remove
  const lifetime = 0.45; let t=0; const tick = (dt)=>{ t+=dt; group.children.forEach(c=>{ c.material.emissiveIntensity *= (1 - dt*3); c.scale.setScalar(1 - t/lifetime); }); if(t>lifetime){ scene.remove(group); } else requestAnimationFrame(()=>tick(1/60)); };
  requestAnimationFrame(()=>tick(1/60));
};

// UI spawn buttons on page
const spawnBtn = document.querySelector('#spawnBtn');
if(spawnBtn) spawnBtn.onclick = () => { const list = ['ninja','warrior','brawler','mage','cyborg']; const a = list[Math.floor(Math.random()*list.length)]; spawnProcedural('F-'+Math.floor(Math.random()*999), new THREE.Vector3((Math.random()*8)-4,0,0), a); };
const spawnPairBtn = document.querySelector('#spawnPairBtn');
if(spawnPairBtn) spawnPairBtn.onclick = ()=>{ spawnProcedural('Ally-'+Math.floor(Math.random()*999), new THREE.Vector3(-4,0,0),'ninja'); spawnProcedural('Rival-'+Math.floor(Math.random()*999), new THREE.Vector3(4,0,0),'warrior'); };
const finalBtn = document.querySelector('#finalBtn');
if(finalBtn) finalBtn.onclick = ()=>{ window.camState.targetZoom = 10; window.camState.shake = 2.2; setTimeout(()=>{ window.camState.targetZoom = 18; }, 1300); bloom.strength = 1.6; setTimeout(()=> bloom.strength = 0.8, 1000); };

// fixed timestep sim
let accumulator = 0; const dt = 1/60; const clock = new THREE.Clock();
function animate(){ requestAnimationFrame(animate); const frameTime = Math.min(0.1, clock.getDelta()); accumulator += frameTime; input.update(); while(accumulator >= dt){ for(const f of window.fighters) f.simulate(dt, input); accumulator -= dt; } const delta = clock.getDelta(); for(const f of window.fighters) f.updateAnimations(delta); updateCamera(delta); composer.render(delta); }
animate();
