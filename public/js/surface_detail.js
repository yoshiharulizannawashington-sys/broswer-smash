// Procedural surface detail for the shipped character and weapon prefabs.
//
// The Blender prefab libraries (character_models.glb, character_weapons.glb) are
// UV-mapped with 500+ PBR materials but contain no image textures at all, so every
// fighter reads as smooth flat plastic. This module bakes a small set of tiling
// detail maps once (fabric weave, brushed armor, leather grain, skin pores) and
// applies them to cloned materials, keeping each fighter's authored base colour,
// metallic/roughness and clearcoat while giving the surfaces something to catch
// the light with.
import * as THREE from 'three';

const CLASS_PATTERNS = {
  fabric: { repeat: 3.2, normalScale: 0.55, roughnessRange: [0.9, 1], weave: true },
  armor: { repeat: 2.1, normalScale: 0.34, roughnessRange: [0.82, 1], brushed: true },
  leather: { repeat: 2.4, normalScale: 0.6, roughnessRange: [0.88, 1] },
  skin: { repeat: 1.6, normalScale: 0.22, roughnessRange: [0.94, 1], pores: true },
  generic: { repeat: 2.6, normalScale: 0.24, roughnessRange: [0.92, 1] }
};

// Skip anything that owns its own look: eyes, energy trim, hair cards and glow bits
// must not receive a matte weave on top of their emissive material.
// Note: whole words only. A bare /lash/ matched "the_flash_barry_allen Armor" and left
// The Flash as the one fighter in the roster with no surface detail at all.
const SKIP = /(eyelash|eyebrow|eye|iris|pupil|glow|energy|emissive|lens|core|beam|flare|hair|fur|beard|tooth|tongue|blade edge|light)/;
const ARMOR = /(armor|plate|helmet|gauntlet|boot|greave|pauldron|bracer|shoulder|knee|belt|buckle|metal|steel|iron|chrome|visor|mask|shield|gauntlet)/;
const FABRIC = /(suit|cloth|fabric|tunic|cape|robe|gi |gi$|kimono|wrap|pants|trouser|scarf|skirt|sash|tabard|shirt|jacket|coat|sleeve|hood|undersuit|spandex)/;
const LEATHER = /(leather|strap|harness|boot shaft|glove|handle|grip|sheath|pouch)/;
const SKIN = /(skin|face|neck|hand|arm|leg|chest|torso|flesh|body)/;

// Source material -> enhanced clone. Prefab templates are cloned for every fighter, so the
// cache has to hand the enhanced clone back to later clones as well; otherwise the second
// fighter built from the same template would silently lose its surface detail.
const state = { textures: new Map(), enhanced: new WeakMap() };

function canvas2d(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return { canvas, context: canvas.getContext('2d'), size };
}

// Cheap deterministic value noise so the patterns are identical on every load
// and can be cached across all 57 fighters instead of regenerated per character.
function makeRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function heightToNormal(height, size, strength) {
  const { canvas, context } = canvas2d(size);
  const image = context.createImageData(size, size);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      // Normalize the perturbed normal back into 0..1 RGB space.
      const length = Math.sqrt(dx * dx + dy * dy + 1);
      const index = (y * size + x) * 4;
      image.data[index] = Math.round((-dx / length * .5 + .5) * 255);
      image.data[index + 1] = Math.round((-dy / length * .5 + .5) * 255);
      image.data[index + 2] = Math.round((1 / length * .5 + .5) * 255);
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function buildPattern(kind) {
  const size = 256;
  const preset = CLASS_PATTERNS[kind] || CLASS_PATTERNS.generic;
  const { canvas, context } = canvas2d(size);
  const albedo = context.createImageData(size, size);
  const rough = context.createImageData(size, size);
  const height = new Float32Array(size * size);
  const random = makeRandom(kind.length * 7919 + 17);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = y * size + x;
      let shade = 1;
      let relief = 0;
      let roughness = .95;

      if (preset.weave) {
        // Two interlaced thread directions plus a slow weave wobble.
        const warp = ((x + Math.sin(y * .11) * 1.4) % 5) < 2.5 ? 1 : .9;
        const weft = ((y + Math.cos(x * .09) * 1.2) % 5) < 2.5 ? 1 : .92;
        const slub = Math.sin(x * .7 + y * .33) * .02 + Math.sin(y * 1.3) * .015;
        shade = (warp * weft) * .95 + slub;
        relief = (warp - weft) * .8 + slub * 3;
        roughness = .93 + (random() - .5) * .06;
      } else if (preset.brushed) {
        // Horizontally brushed metal with occasional panel seams.
        const streak = Math.sin(y * 2.1 + Math.sin(x * .05) * 3) * .5 + Math.sin(y * 8.3 + x * .01) * .5;
        const seam = (x % 84 < 2 || y % 84 < 2) ? -.16 : 0;
        const micro = (random() - .5) * .05;
        shade = .98 + streak * .022 + seam + micro;
        relief = streak * .16 + seam * 1.6 + micro * 2;
        roughness = .95 + (random() - .5) * .05;
      } else if (preset.pores) {
        // Fine skin grain: soft cellular bumps, no directional pattern.
        const cell = Math.sin(x * 1.7 + Math.sin(y * .9) * 2.1) * Math.cos(y * 1.9 + Math.sin(x * .8) * 1.7);
        shade = .985 + cell * .012;
        relief = cell * .35;
        roughness = .96 + (random() - .5) * .03;
      } else {
        // Leather / generic pebbling.
        const pebble = Math.sin(x * .9 + y * 1.7) * Math.sin(x * 1.3 - y * .8);
        const grain = Math.sin(x * 3.1) * Math.cos(y * 2.7);
        shade = .96 + pebble * .03 + grain * .012;
        relief = pebble * .55 + grain * .2;
        roughness = .93 + (random() - .5) * .06;
      }

      const [minRough, maxRough] = preset.roughnessRange;
      roughness = Math.min(maxRough, Math.max(minRough, roughness));
      const base = Math.max(.55, Math.min(1.04, shade));
      albedo.data[index * 4] = Math.round(255 * base);
      albedo.data[index * 4 + 1] = Math.round(255 * base);
      albedo.data[index * 4 + 2] = Math.round(255 * base);
      albedo.data[index * 4 + 3] = 255;
      rough.data[index * 4] = Math.round(255 * roughness);
      rough.data[index * 4 + 1] = Math.round(255 * roughness);
      rough.data[index * 4 + 2] = Math.round(255 * roughness);
      rough.data[index * 4 + 3] = 255;
      height[index] = relief;
    }
  }

  const flat = context.createImageData(size, size);
  flat.data.set(albedo.data);
  context.putImageData(flat, 0, 0);

  const roughCanvas = canvas2d(size);
  roughCanvas.context.putImageData(rough, 0, 0);
  const normalCanvas = heightToNormal(height, size, preset.normalScale * 46);

  const albedoTexture = new THREE.CanvasTexture(canvas);
  albedoTexture.colorSpace = THREE.SRGBColorSpace;
  const roughnessTexture = new THREE.CanvasTexture(roughCanvas.canvas);
  roughnessTexture.colorSpace = THREE.NoColorSpace;
  const normalTexture = new THREE.CanvasTexture(normalCanvas);
  normalTexture.colorSpace = THREE.NoColorSpace;
  for (const texture of [albedoTexture, roughnessTexture, normalTexture]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(preset.repeat, preset.repeat);
    texture.anisotropy = 4;
  }
  return { albedoTexture, roughnessTexture, normalTexture, normalScale: preset.normalScale };
}

function pattern(kind) {
  if (!state.textures.has(kind)) state.textures.set(kind, buildPattern(kind));
  return state.textures.get(kind);
}

export function classifyMaterial(materialName) {
  const name = String(materialName || '').toLowerCase();
  if (!name || SKIP.test(name)) return null;
  if (ARMOR.test(name)) return 'armor';
  if (FABRIC.test(name)) return 'fabric';
  if (LEATHER.test(name)) return 'leather';
  if (SKIN.test(name)) return 'skin';
  return 'generic';
}

function enhanceMaterial(source) {
  if (!source) return source;
  const cached = state.enhanced.get(source);
  if (cached) return cached;
  const kind = classifyMaterial(source.name);
  if (!kind) { state.enhanced.set(source, source); return source; }
  // Materials are shared between the prefab template and every fighter cloned from
  // it, so swap in a clone before touching maps or one fighter would repaint the roster.
  const material = source.clone();
  const maps = pattern(kind);
  if (!material.map) material.map = maps.albedoTexture;
  if (!material.normalMap) {
    material.normalMap = maps.normalTexture;
    material.normalScale = new THREE.Vector2(maps.normalScale, maps.normalScale);
  }
  if (!material.roughnessMap) material.roughnessMap = maps.roughnessTexture;
  material.envMapIntensity = Math.max(material.envMapIntensity ?? 1, 1.15);
  material.needsUpdate = true;
  material.userData = { ...material.userData, surfaceDetail: kind };
  state.enhanced.set(source, material);
  return material;
}

/** Apply generated detail maps to every mesh under `root`, once per material. */
export function enhanceSurfaceMaterials(root, { weapon = false } = {}) {
  if (!root) return { enhanced: 0, materials: 0 };
  let enhanced = 0;
  let materials = 0;
  root.traverse(node => {
    if (!node.isMesh || !node.material) return;
    const source = Array.isArray(node.material) ? node.material : [node.material];
    let changed = false;
    const next = source.map(material => {
      materials++;
      const result = enhanceMaterial(material);
      if (result !== material) { enhanced++; changed = true; }
      return result;
    });
    if (changed) node.material = Array.isArray(node.material) ? next : next[0];
    node.castShadow = true;
    node.receiveShadow = true;
  });
  if (weapon) root.traverse(node => { if (node.isMesh) node.castShadow = true; });
  return { enhanced, materials };
}

/** Detail classes present on a rig, for runtime diagnostics. */
export function surfaceDetailReport(root) {
  const found = {};
  root?.traverse(node => {
    if (!node.isMesh || !node.material) return;
    for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
      const kind = material?.userData?.surfaceDetail;
      if (kind) found[kind] = (found[kind] || 0) + 1;
    }
  });
  return found;
}
