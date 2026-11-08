// Per-arena sky environment maps.
//
// The scene used to light every map with RoomEnvironment, a neutral photo-studio box:
// metallic armour reflected white softboxes instead of sky, which is why the fighters
// read as flat plastic in daylight arenas. These generate a small equirectangular sky
// (gradient + sun disc + ground bounce) per arena, so reflections and ambient light
// match the map the fight is actually happening in.
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

const cache = new Map();

export const SKY_PRESETS = {
  valley: { top: '#2f6ea8', horizon: '#bcd6d8', ground: '#41503a', sun: '#fff2d2', sunHeight: .58, sunSize: .1 },
  finalvalley: { top: '#25486f', horizon: '#f3b46a', ground: '#3d3a30', sun: '#ffd79a', sunHeight: .32, sunSize: .12 },
  tournament: { top: '#3b7fc4', horizon: '#dfeaf0', ground: '#5c5344', sun: '#fffbe8', sunHeight: .66, sunSize: .08 },
  starktower: { top: '#20365c', horizon: '#f0a269', ground: '#2b2f3a', sun: '#ffcf9c', sunHeight: .4, sunSize: .1 },
  asgard: { top: '#28477e', horizon: '#ffe2a6', ground: '#4a4a52', sun: '#fff4cd', sunHeight: .5, sunSize: .11 },
  hogwarts: { top: '#2b3f63', horizon: '#c8c6c0', ground: '#3c3a33', sun: '#f4ecd6', sunHeight: .6, sunSize: .09 },
  deathstar: { top: '#1b2230', horizon: '#5b6b82', ground: '#1a2029', sun: '#cfe0ff', sunHeight: .72, sunSize: .07 },
  konoha: { top: '#2e6fb4', horizon: '#e4ecec', ground: '#45583a', sun: '#fff6dd', sunHeight: .62, sunSize: .085 },
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
let skyRenderer = null;
export function skyEnvironment(renderer, key) {
  skyRenderer = renderer || skyRenderer;
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

// --- Real CC0 skies -------------------------------------------------------------------------
// The procedural presets above stay as the instant fallback: they are cheap, synchronous and always
// available. A real Poly Haven HDRI (CC0) replaces the IBL once decoded, so metal, skin and stone
// pick up directional sky light and proper specular response instead of a flat gradient.
// Sources and licences: public/assets/skies/SOURCES.json.
const SKY_HDRI = {
  valley: '/assets/skies/sunflowers_puresky_1k.hdr',
  tournament: '/assets/skies/kloofendal_48d_partly_cloudy_puresky_1k.hdr',
  asgard: '/assets/skies/kloofendal_48d_partly_cloudy_puresky_1k.hdr',
  hogwarts: '/assets/skies/kloofendal_48d_partly_cloudy_puresky_1k.hdr',
  deathstar: '/assets/skies/kloofendal_48d_partly_cloudy_puresky_1k.hdr'
};
// A real HDR sky is photographically exposed, so its diffuse contribution is much dimmer than the
// generated gradient it replaced. These multipliers restore arena readability per stage without
// touching the renderer's global exposure (which is driven per theme by `lamp.exposure`).
const SKY_INTENSITY = { valley: 1.55, tournament: 1.5, asgard: 1.6, hogwarts: 1.5, deathstar: 1.45 };

// --- Developer environment A/B --------------------------------------------------------------
// Three selectable environment sources, used to compare the fallback against the real sky with the
// arena, fighters, pose, camera, exposure and direct lights untouched:
//   procedural     generated equirect sky (the pre-HDRI fallback) + the arena's flat sky colour
//   hdri           the CC0 HDRI exactly as decoded, prefiltered once for image-based lighting
//   hdri-adjusted  the same HDRI with this arena's SKY_INTENSITY applied to the radiance
//
// Only scene.environment and scene.background change between modes. Nothing here touches lights,
// exposure, materials or game state, so a mode switch is safe to run inside a live match.
//
// Note on the previous adjustment: SKY_INTENSITY used to be applied by multiplying the decoded
// DataTexture in place. RGBELoader returns *half-float* data, so those multiplications were applied
// to half-float bit patterns rather than to radiance - it scaled the visible background into
// nonsense while leaving the prefiltered IBL untouched. The adjustment now converts to float,
// scales that copy, and prefilters the result, so "adjusted" means what it says.
const ENVIRONMENT_MODES = Object.freeze(['procedural', 'hdri', 'hdri-adjusted']);
const HDRI_BASE_MEMORY = new Map();  // path -> { raw, env }
const HDRI_ADJUSTED = new Map();     // path#boost -> { background, env }
let devMode = null;                  // null = the game's own path (unchanged default)
let activeScene = null;
let activeKey = 'valley';
let activeStatus = { mode: 'auto' };

const halfToFloat = (() => {
  const table = new Float32Array(65536);
  for (let i = 0; i < 65536; i += 1) {
    const sign = (i & 0x8000) >> 15;
    const exponent = (i & 0x7c00) >> 10;
    const fraction = i & 0x03ff;
    if (exponent === 0) table[i] = (sign ? -1 : 1) * Math.pow(2, -14) * (fraction / 1024);
    else if (exponent === 31) table[i] = fraction ? NaN : (sign ? -Infinity : Infinity);
    else table[i] = (sign ? -1 : 1) * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
  }
  return table;
})();

function prefilter(source) {
  if (!skyRenderer || !THREE.PMREMGenerator) return source;
  const generator = new THREE.PMREMGenerator(skyRenderer);
  generator.compileEquirectangularShader();
  const target = generator.fromEquirectangular(source);
  generator.dispose();
  return target.texture;
}

function loadHdri(path) {
  if (HDRI_BASE_MEMORY.has(path)) return Promise.resolve(HDRI_BASE_MEMORY.get(path));
  return new RGBELoader().loadAsync(path).then(raw => {
    raw.mapping = THREE.EquirectangularReflectionMapping;
    const record = { raw, env: prefilter(raw) };
    HDRI_BASE_MEMORY.set(path, record);
    return record;
  });
}

// HDR radiance has to stay half-float: a Float32 equirect data texture is not linearly filterable
// on every GL backend (SwiftShader returns black), so the scaled copy is encoded back to half.
const floatToHalf = (() => {
  const floats = new Float32Array(1);
  const ints = new Int32Array(floats.buffer);
  return value => {
    floats[0] = value;
    const bits = ints[0];
    const sign = (bits >> 16) & 0x8000;
    const exponent = ((bits >> 23) & 0xff) - 127 + 15;
    const mantissa = bits & 0x7fffff;
    if (exponent <= 0) {
      if (exponent < -10) return sign;
      return sign | (((mantissa | 0x800000) >> (1 - exponent)) >> 13);
    }
    if (exponent >= 31) return sign | 0x7c00;
    return sign | (exponent << 10) | (mantissa >> 13);
  };
})();

/** A half-float copy of the decoded HDR radiance with `boost` applied - leaving the original intact. */
function scaledCopy(raw, boost) {
  const image = raw.image;
  const data = image.data;
  const half = data instanceof Uint16Array;
  const out = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i += 1) {
    const value = half ? halfToFloat[data[i]] : data[i];
    // Sun discs sit near the half-float ceiling already; scaling one by the arena boost overflows it
    // to Infinity, which turns the whole prefiltered cube into NaN and renders the stage black.
    const scaled = (i % 4 === 3) ? value : Math.min(value * boost, 60000);
    out[i] = floatToHalf(Number.isFinite(scaled) ? scaled : 0);
  }
  const texture = new THREE.DataTexture(out, image.width, image.height, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = raw.colorSpace;
  texture.needsUpdate = true;
  return texture;
}

function adjustedFor(path, boost) {
  const key = path + '#' + boost;
  if (HDRI_ADJUSTED.has(key)) return HDRI_ADJUSTED.get(key);
  const base = HDRI_BASE_MEMORY.get(path);
  const background = scaledCopy(base.raw, boost);
  const record = { background, env: prefilter(background) };
  HDRI_ADJUSTED.set(key, record);
  return record;
}

function report(status) {
  activeStatus = status;
  if (typeof window !== 'undefined') window.__browserSmashSkyStatus = status;
}

function applyMode(scene, key) {
  if (devMode === 'procedural') {
    scene.environment = skyEnvironment(skyRenderer, key);
    const colour = typeof window !== 'undefined' ? window.__browserSmashSkyColour : null;
    if (colour !== null && colour !== undefined) scene.background = new THREE.Color(colour);
    report({ source: 'procedural', mode: devMode, key, loaded: true });
    return Promise.resolve({ mode: devMode, key, source: 'procedural' });
  }
  const path = SKY_HDRI[key];
  if (!path) return Promise.resolve(null);
  const boost = SKY_INTENSITY[key] ?? 1.8;
  return loadHdri(path).then(base => {
    if (devMode === 'hdri') {
      scene.environment = base.env;
      scene.background = base.raw;
      report({ source: 'hdri', mode: devMode, key, path, loaded: true, adjusted: false });
      return { mode: devMode, key, source: 'hdri' };
    }
    const adjusted = adjustedFor(path, boost);
    scene.environment = adjusted.env;
    scene.background = adjusted.background;
    report({ source: 'hdri', mode: devMode, key, path, loaded: true, adjusted: true, boost });
    return { mode: devMode, key, source: 'hdri', boost };
  });
}

/**
 * Switch the environment source for the live scene. `'auto'` (or null) restores the game's own
 * behaviour. Returns the state that was applied, so a probe can assert the same arena/mode pairing.
 */
export function setEnvironmentMode(scene, key, mode) {
  if (scene) activeScene = scene;
  if (key) activeKey = key;
  if (mode === undefined) return Promise.resolve(activeStatus);
  if (mode === null || mode === 'auto') devMode = null;
  else if (ENVIRONMENT_MODES.includes(mode)) devMode = mode;
  else return Promise.resolve({ ...activeStatus, rejected: String(mode) });
  advanceHistory();
  if (!activeScene) return Promise.resolve({ mode: devMode || 'auto' });
  if (!devMode) return applyRealSky(activeScene, activeKey);
  return applyMode(activeScene, activeKey).catch(error => {
    report({ source: 'error', mode: devMode, key: activeKey, loaded: false, error: String(error?.message || error).slice(0, 140) });
    return null;
  });
}

const modeHistory = [];
function advanceHistory() {
  modeHistory.push({ mode: devMode || 'auto', at: Date.now() });
  if (modeHistory.length > 20) modeHistory.shift();
}

/** Load the arena's HDRI once and make it the scene's lighting environment. */
export function applyRealSky(scene, key) {
  if (scene) activeScene = scene;
  if (key) activeKey = key;
  if (devMode) return applyMode(activeScene, activeKey);
  const path = SKY_HDRI[activeKey];
  if (!activeScene || !path) return Promise.resolve(null);
  return loadHdri(path).then(base => {
    // A developer may have switched modes while the file was decoding; respect the newer request.
    if (devMode) return applyMode(activeScene, activeKey);
    activeScene.environment = base.env;
    activeScene.background = base.raw;
    report({
      source: 'hdri', mode: 'auto', key: activeKey, path, loaded: true,
      width: base.raw.image?.width || 0, height: base.raw.image?.height || 0
    });
    return base.raw;
  }).catch(error => {
    report({ source: 'procedural', mode: 'auto', key: activeKey, path, loaded: false, error: String(error).slice(0, 120) });
    return null;
  });
}

if (typeof window !== 'undefined') {
  window.__browserSmashApplySky = applyRealSky;
  /** Developer hook: window.__browserSmashEnvironmentMode('hdri' | 'hdri-adjusted' | 'procedural' | 'auto') */
  window.__browserSmashEnvironmentMode = mode => setEnvironmentMode(activeScene, activeKey, mode);
  window.__browserSmashEnvironmentModes = ENVIRONMENT_MODES;
  window.__browserSmashEnvironmentHistory = modeHistory;
  Object.defineProperty(window, '__browserSmashEnvironmentModeState', { get: () => ({ ...activeStatus, devMode }) });
  // F9 cycles auto -> procedural -> hdri -> hdri-adjusted in a live match. Deliberately not in any
  // player-facing menu: it is a comparison tool, not a graphics setting.
  window.addEventListener('keydown', event => {
    if (event.code !== 'F9' || event.repeat) return;
    const order = [null, ...ENVIRONMENT_MODES];
    const next = order[(order.indexOf(devMode) + 1) % order.length];
    event.preventDefault();
    setEnvironmentMode(activeScene, activeKey, next ?? 'auto');
    console.info('[environment] mode ->', next ?? 'auto');
  });
}
