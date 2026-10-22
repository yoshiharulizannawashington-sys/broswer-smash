// Per-arena sky environment maps.
//
// The scene used to light every map with RoomEnvironment, a neutral photo-studio box:
// metallic armour reflected white softboxes instead of sky, which is why the fighters
// read as flat plastic in daylight arenas. These generate a small equirectangular sky
// (gradient + sun disc + ground bounce) per arena, so reflections and ambient light
// match the map the fight is actually happening in.
import * as THREE from 'three';

const cache = new Map();

export const SKY_PRESETS = {
  valley: { top: '#2f6ea8', horizon: '#bcd6d8', ground: '#41503a', sun: '#fff2d2', sunHeight: .58, sunSize: .1 },
  finalvalley: { top: '#25486f', horizon: '#f3b46a', ground: '#3d3a30', sun: '#ffd79a', sunHeight: .32, sunSize: .12 },
  tournament: { top: '#3b7fc4', horizon: '#dfeaf0', ground: '#5c5344', sun: '#fffbe8', sunHeight: .66, sunSize: .08 },
  starktower: { top: '#20365c', horizon: '#f0a269', ground: '#2b2f3a', sun: '#ffcf9c', sunHeight: .4, sunSize: .1 },
  asgard: { top: '#28477e', horizon: '#ffe2a6', ground: '#4a4a52', sun: '#fff4cd', sunHeight: .5, sunSize: .11 },
  hogwarts: { top: '#2b3f63', horizon: '#c8c6c0', ground: '#3c3a33', sun: '#f4ecd6', sunHeight: .6, sunSize: .09 },
  deathstar: { top: '#1b2230', horizon: '#5b6b82', ground: '#1a2029', sun: '#cfe0ff', sunHeight: .72, sunSize: .07 },
  volcano: { top: '#321c22', horizon: '#d8642c', ground: '#241a18', sun: '#ffb070', sunHeight: .38, sunSize: .12 },
  ice: { top: '#3a5f85', horizon: '#dcecf7', ground: '#54697a', sun: '#eaf6ff', sunHeight: .56, sunSize: .1 },
  neon: { top: '#140f2c', horizon: '#7d3fd0', ground: '#1a1428', sun: '#ff6fd2', sunHeight: .46, sunSize: .12 }
};

function paintSky(preset, width = 512, height = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const horizonY = height * .52;

  const sky = context.createLinearGradient(0, 0, 0, horizonY);
  sky.addColorStop(0, preset.top);
  sky.addColorStop(1, preset.horizon);
  context.fillStyle = sky;
  context.fillRect(0, 0, width, horizonY);

  const ground = context.createLinearGradient(0, horizonY, 0, height);
  ground.addColorStop(0, preset.horizon);
  ground.addColorStop(1, preset.ground);
  context.fillStyle = ground;
  context.fillRect(0, horizonY, width, height - horizonY);

  // Sun (and its haze) sit at the height the arena's key light actually comes from.
  const sunX = width * .28;
  const sunY = height * preset.sunHeight;
  const glow = context.createRadialGradient(sunX, sunY, 0, sunX, sunY, width * .34);
  glow.addColorStop(0, preset.sun);
  glow.addColorStop(.12, preset.sun);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  context.globalAlpha = .85;
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);
  context.globalAlpha = 1;

  // A soft second highlight opposite the sun keeps metal from reading black on the shadow side.
  const fill = context.createRadialGradient(width * .78, height * .34, 0, width * .78, height * .34, width * .3);
  fill.addColorStop(0, 'rgba(180,205,255,.5)');
  fill.addColorStop(1, 'rgba(180,205,255,0)');
  context.fillStyle = fill;
  context.fillRect(0, 0, width, height);

  return canvas;
}

/** Equirectangular sky texture for `key`, generated once per preset. */
export function skyEnvironment(renderer, key) {
  const preset = SKY_PRESETS[key] || SKY_PRESETS.valley;
  const cacheKey = key in SKY_PRESETS ? key : 'valley';
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const canvas = paintSky(preset);
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  // Renderer is only used to prove the module is wired to a live context; the texture
  // itself is resolved to a PMREM cube by the renderer when it is assigned to scene.environment.
  void renderer;
  cache.set(cacheKey, texture);
  return texture;
}
