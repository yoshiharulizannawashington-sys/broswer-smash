// Renderer, HDRI image-based lighting, wet-stone normal detail and SSR pipeline.
import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';
import { EffectComposer } from 'https://unpkg.com/three@0.152.2/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://unpkg.com/three@0.152.2/examples/jsm/postprocessing/RenderPass.js';
import { SSRPass } from 'https://unpkg.com/three@0.152.2/examples/jsm/postprocessing/SSRPass.js';
import { UnrealBloomPass } from 'https://unpkg.com/three@0.152.2/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'https://unpkg.com/three@0.152.2/examples/jsm/postprocessing/OutputPass.js';
import { RGBELoader } from 'https://unpkg.com/three@0.152.2/examples/jsm/loaders/RGBELoader.js';

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

  // Real equirectangular HDRI: converted to a PMREM cubemap for physically based reflections.
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const environmentReady = new Promise(resolve => {
    new RGBELoader().setDataType(THREE.HalfFloatType).load(
      'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/sunset_in_the_dunes_1k.hdr',
      hdr => {
        const env = pmrem.fromEquirectangular(hdr);
        scene.environment = env.texture;
        scene.environmentIntensity = .8;
        hdr.dispose();
        pmrem.dispose();
        resolve(true);
      },
      undefined,
      error => {
        console.warn('Sunset HDRI could not be loaded; using scene lights instead.', error);
        pmrem.dispose();
        resolve(false);
      }
    );
  });
  return { renderer, camera, composer, bloom, environmentReady, enableSSR(floor) {
    // Screen-space reflections are real-time but limited to visible pixels and are quality-scaled.
    try {
      const ssr = new SSRPass({ renderer, scene, camera, width: innerWidth, height: innerHeight, selects: [floor], bouncing: false });
      ssr.thickness = 0.018;
      ssr.maxDistance = 18;
      ssr.opacity = .52;
      composer.insertPass(ssr, 1);
      return ssr;
    } catch (error) {
      console.warn('SSR unavailable on this device; retaining PBR environment reflections.', error);
      return null;
    }
  }};
}

function makeDetailNormalTexture() {
  const size = 128, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const ripple = Math.sin(x * .37 + Math.sin(y * .18) * 2) * .22 + Math.cos(y * .31) * .16;
    data[i] = 128 + ripple * 65;
    data[i + 1] = 128 + Math.cos(x * .22 + y * .27) * 18;
    data[i + 2] = 246;
    data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(18, 12);
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createWetStoneMaterial(color = 0x303b47) {
  return new THREE.MeshStandardMaterial({
    color, metalness: .32, roughness: .2,
    normalMap: makeDetailNormalTexture(), normalScale: new THREE.Vector2(.22, .22),
    envMapIntensity: 1.15
  });
}
