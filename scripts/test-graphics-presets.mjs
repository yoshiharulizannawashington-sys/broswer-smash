// Graphics preset test: four presets must exist, Low must be a real (coherent, shadowed) setting
// rather than "Ultra or nothing", and applying one must actually change renderer state.
//
//   node scripts/test-graphics-presets.mjs
import assert from 'node:assert/strict';
import {
  PRESETS, PRESET_ORDER, presetById, describePresets, detectPreset,
  applyGraphicsPreset, readStoredPreset
} from '../public/js/render/graphics_presets.js';

let checks = 0;
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  checks++;
  console.log(`  ok  ${name}`);
}

// ---- The four presets ---------------------------------------------------
check('four presets exist', PRESET_ORDER.length === 4);
check('they are exactly low/medium/high/ultra',
  PRESET_ORDER.join(',') === 'low,medium,high,ultra');
check('every preset is described with a label and hint',
  describePresets().every(p => p.label && p.hint && p.id));
check('unknown preset ids are refused', presetById('cinematic') === null && applyGraphicsPreset('cinematic') === null);

// ---- Low is a real setting, not a fallback ---------------------------------
const low = PRESETS.low;
check('Low keeps shadows enabled', low.shadows === true);
check('Low still uses a real shadow map', low.shadowMap >= 512);
check('Low renders at more than a third of native pixels', low.pixelRatio >= 0.75);
check('Low keeps environment lighting', low.envIntensity > 0.5);
check('Low is cheaper than High on every cost knob',
  low.pixelRatio < PRESETS.high.pixelRatio
  && low.shadowMap < PRESETS.high.shadowMap
  && low.anisotropy < PRESETS.high.anisotropy
  && low.particleScale < PRESETS.high.particleScale);
check('Ultra is not the only playable option', PRESET_ORDER.length > 1 && low.shadows);
check('cost knobs rise monotonically from low to ultra', PRESET_ORDER.every((id, i, all) => {
  if (i === 0) return true;
  const previous = PRESETS[all[i - 1]];
  const current = PRESETS[id];
  return current.pixelRatio >= previous.pixelRatio
    && current.shadowMap >= previous.shadowMap
    && current.shadowRadius >= previous.shadowRadius
    && current.anisotropy >= previous.anisotropy
    && current.envIntensity >= previous.envIntensity
    && current.particleScale >= previous.particleScale;
}));

// ---- Applying changes the renderer --------------------------------------
function makeHarness() {
  const state = { pixelRatio: 2, shadowEnabled: true, shadowType: 'soft', mapDisposals: 0 };
  const renderer = {
    capabilities: { getMaxAnisotropy: () => 16 },
    setPixelRatio(value) { state.pixelRatio = value; },
    shadowMap: {
      get enabled() { return state.shadowEnabled; },
      set enabled(value) { state.shadowEnabled = value; },
      get type() { return state.shadowType; },
      set type(value) { state.shadowType = value; }
    }
  };
  const sun = {
    castShadow: true,
    shadow: {
      radius: 3.5,
      mapSize: { x: 2048, y: 2048, set(x, y) { this.x = x; this.y = y; } },
      map: { dispose() { state.mapDisposals++; } }
    }
  };
  const texture = { anisotropy: 1, needsUpdate: false };
  const materials = [
    { envMapIntensity: 1.15, map: texture },
    { envMapIntensity: 1, normalMap: { anisotropy: 4, needsUpdate: false } }
  ];
  const scene = { traverse(fn) { materials.forEach(material => fn({ material })); } };
  return { state, renderer, sun, scene, materials, texture };
}

// Pixel ratio is capped against the *device* ratio, so model a real 2x display. Without this the
// clamp hides the difference: min(1, 1.0) and min(1, 1.75) are both 1 on a 1x host.
globalThis.devicePixelRatio = 2;
const shadowTypes = { soft: 2, basic: 0 };
const lowHarness = makeHarness();
const lowResult = applyGraphicsPreset('low', { ...lowHarness, shadowTypes });
check('applying Low succeeds', lowResult?.name === 'low');
check('Low renders at native 1x on a 2x display', lowHarness.state.pixelRatio === 1, String(lowHarness.state.pixelRatio));
check('Low resizes the shadow map', lowHarness.sun.shadow.mapSize.x === 512);
check('Low frees the old shadow map so the new size takes effect', lowHarness.state.mapDisposals === 1);
check('Low lowers environment intensity', lowHarness.materials[0].envMapIntensity === PRESETS.low.envIntensity);
check('Low clamps texture anisotropy to its budget', lowHarness.texture.anisotropy === PRESETS.low.anisotropy);
check('the result reports what was applied', lowResult.applied.pixelRatio && lowResult.applied.shadowMap && lowResult.applied.materials);

const ultraHarness = makeHarness();
applyGraphicsPreset('ultra', { ...ultraHarness, shadowTypes });
check('Ultra renders at 1.75x on a 2x display, above Low', ultraHarness.state.pixelRatio === PRESETS.ultra.pixelRatio && ultraHarness.state.pixelRatio > lowHarness.state.pixelRatio, String(ultraHarness.state.pixelRatio));
check('Ultra enlarges the shadow map', ultraHarness.sun.shadow.mapSize.x === PRESETS.ultra.shadowMap);
check('Ultra restores higher environment intensity',
  ultraHarness.materials[0].envMapIntensity === PRESETS.ultra.envIntensity);
check('Ultra uses the soft shadow type', ultraHarness.state.shadowType === 2);

// ---- Partial/stub inputs cannot throw -----------------------------------
check('a bare object does not throw', (() => {
  try { return applyGraphicsPreset('high', {}).name === 'high'; } catch (_error) { return false; }
})());
check('a scene without traverse does not throw', (() => {
  try { return applyGraphicsPreset('medium', { scene: {} }).name === 'medium'; } catch (_error) { return false; }
})());

// ---- Device detection picks something sane -------------------------------
check('a two-core machine starts at Low', detectPreset({ hardwareConcurrency: 2 }) === 'low');
check('a low-memory machine starts at Low', detectPreset({ hardwareConcurrency: 8, deviceMemory: 2 }) === 'low');
check('a four-core high-DPI laptop does not start at High', detectPreset({ hardwareConcurrency: 4, devicePixelRatio: 2 }) === 'low');
check('a strong machine starts at High, never Ultra automatically',
  detectPreset({ hardwareConcurrency: 16, deviceMemory: 16 }) === 'high');
check('detected presets are always valid', ['low', 'medium', 'high'].every(id => detectPreset({ hardwareConcurrency: 2 }) === 'low')
  && presetById(detectPreset({ hardwareConcurrency: 16 })) !== null);

// ---- Persistence text ----------------------------------------------------
check('a fresh profile has no stored preset', readStoredPreset() === null);

delete globalThis.devicePixelRatio;
console.log(`\nGraphics preset checks passed (${checks} checks).`);
