// Graphics presets: one table that decides how expensive the renderer is allowed to be.
//
// Before this, quality was fixed in code: pixel ratio capped at 1.65, a 2048 shadow map on every
// device, full environment reflections. That is fine on a desktop GPU and wrong on a laptop or a
// Chromebook, and there was no way for a player to change it.
//
// The table is deliberately conservative at the low end instead of degrading into soup: shadows
// stay ON at Low (a smaller, softer, cheaper map), environment lighting and anisotropy are reduced
// rather than removed, and fog stays. Low must still look like the same game.
//
// This module never imports three: shadow-type constants are passed in by the caller, which keeps
// it testable in Node and keeps the renderer's object graph in one place.

export const PRESETS = Object.freeze({
  low: {
    id: 'low', label: 'Low', hint: 'laptops and integrated graphics',
    pixelRatio: 1, shadows: true, shadowMap: 512, shadowRadius: 1.4,
    anisotropy: 1, envIntensity: 0.7, particleScale: 0.5
  },
  medium: {
    id: 'medium', label: 'Medium', hint: 'balanced',
    pixelRatio: 1.15, shadows: true, shadowMap: 1024, shadowRadius: 2.2,
    anisotropy: 2, envIntensity: 0.95, particleScale: 0.75
  },
  high: {
    id: 'high', label: 'High', hint: 'discrete graphics',
    pixelRatio: 1.4, shadows: true, shadowMap: 2048, shadowRadius: 3.5,
    anisotropy: 4, envIntensity: 1.15, particleScale: 1
  },
  ultra: {
    id: 'ultra', label: 'Ultra', hint: 'desktop GPU, highest fidelity',
    pixelRatio: 1.75, shadows: true, shadowMap: 3072, shadowRadius: 4.5,
    anisotropy: 8, envIntensity: 1.3, particleScale: 1.35
  }
});

export const PRESET_ORDER = Object.freeze(['low', 'medium', 'high', 'ultra']);
const STORAGE_KEY = 'browserSmashGraphicsPreset';

export function presetById(id) {
  return PRESETS[String(id || '').toLowerCase()] || null;
}

/** Plain data for a settings menu. */
export function describePresets() {
  return PRESET_ORDER.map(id => ({ ...PRESETS[id] }));
}

export function readStoredPreset() {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return presetById(value) ? String(value).toLowerCase() : null;
  } catch (_error) {
    return null;
  }
}

export function storePreset(id) {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, String(id)); } catch (_error) { /* private mode */ }
}

/**
 * Pick a starting preset from the device, without pretending to benchmark: a machine that reports
 * few cores or a high-DPI small screen starts lower, and anything unknown starts at High.
 */
export function detectPreset({ hardwareConcurrency = 0, deviceMemory = 0, devicePixelRatio = 1 } = {}) {
  const cores = Number(hardwareConcurrency) || 0;
  const memory = Number(deviceMemory) || 0;
  const dpr = Number(devicePixelRatio) || 1;
  if (cores && cores <= 2) return 'low';
  if (memory && memory <= 2) return 'low';
  if (cores && cores <= 4) return dpr > 1.5 ? 'low' : 'medium';
  if (!cores) return 'medium';
  return 'high';
}

function forEachMaterial(scene, visit) {
  if (!scene || typeof scene.traverse !== 'function') return 0;
  let seen = 0;
  const done = new Set();
  scene.traverse(node => {
    if (!node || !node.material) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material || done.has(material)) continue;
      done.add(material);
      visit(material);
      seen++;
    }
  });
  return seen;
}

/**
 * Apply a preset to a live renderer. Every step is guarded, so a partial or stub renderer is fine
 * (that is how the test drives it) and a failure in one material cannot break the frame.
 *
 * Returns `{ name, preset, materials, applied }`, where `applied` lists what actually changed.
 */
export function applyGraphicsPreset(id, { renderer = null, sun = null, scene = null, shadowTypes = {} } = {}) {
  const preset = presetById(id);
  if (!preset) return null;
  const applied = { pixelRatio: false, shadows: false, shadowMap: false, materials: false };

  try {
    if (renderer?.setPixelRatio) {
      const cap = Math.max(0.75, preset.pixelRatio);
      const dpr = Number(globalThis.devicePixelRatio) || 1;
      renderer.setPixelRatio(Math.min(dpr, cap));
      applied.pixelRatio = true;
    }
  } catch (_error) { /* renderer without pixel-ratio support */ }

  try {
    if (renderer?.shadowMap) {
      renderer.shadowMap.enabled = preset.shadows;
      // Type is a material/compiled-shader level choice; switching it needs every material to
      // recompile, so it is only assigned when it actually changes.
      const wanted = shadowTypes[preset.shadows ? 'soft' : 'basic'];
      if (wanted !== undefined && renderer.shadowMap.type !== wanted) renderer.shadowMap.type = wanted;
      applied.shadows = true;
    }
    if (sun?.shadow) {
      sun.castShadow = preset.shadows;
      if (sun.shadow.mapSize?.set) sun.shadow.mapSize.set(preset.shadowMap, preset.shadowMap);
      // A live map of the old size has to be freed, or the new size is ignored.
      if (sun.shadow.map?.dispose) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      sun.shadow.radius = preset.shadowRadius;
      applied.shadowMap = true;
    }
  } catch (_error) { /* light without shadow support */ }

  let maxAnisotropy = 1;
  try { maxAnisotropy = Number(renderer?.capabilities?.getMaxAnisotropy?.()) || 1; } catch (_error) { maxAnisotropy = 1; }

  try {
    const materials = forEachMaterial(scene, material => {
      try {
        if ('envMapIntensity' in material) material.envMapIntensity = preset.envIntensity;
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
          const texture = material[key];
          if (texture && 'anisotropy' in texture) {
            const wanted = Math.min(maxAnisotropy, preset.anisotropy);
            if (texture.anisotropy !== wanted) { texture.anisotropy = wanted; texture.needsUpdate = true; }
          }
        }
      } catch (_error) { /* a material that refuses the change */ }
    });
    applied.materials = materials > 0;
    storePreset(preset.id);
    return { name: preset.id, preset, materials, applied };
  } catch (_error) {
    storePreset(preset.id);
    return { name: preset.id, preset, materials: 0, applied };
  }
}

/** Highest preset that is defined; used by tests to prove Ultra is not the only playable option. */
export function highestPreset() {
  return PRESET_ORDER[PRESET_ORDER.length - 1];
}
