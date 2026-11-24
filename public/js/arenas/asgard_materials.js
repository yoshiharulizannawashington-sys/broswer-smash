// Material tuning for the mounted Asgard palace.
//
// The GLB is seven materials and no texture maps at all (the container has zero images), so every
// surface is a flat PBR factor. Four of those seven are emissive - Asgard · polished electrum,
// royal gold, window light and bifrost crystal - and between them they cover 486 of the palace's 559
// primitives. At emissiveFactor 1.0 across 87% of the geometry the lighting has nothing left to
// shade: gold floods its own highlights, marble blows out to cream next to it, and the palace reads
// pale and flat at gameplay distance. That is a material problem, not a geometry or camera problem.
//
// The fix is therefore per-material and absolute: emissive is pulled down so it reads as an accent,
// metal is pushed towards metal, and stone is separated from the gold in both value and hue - the
// first attempt only darkened the marble towards the gold, which lowered the frame's contrast
// instead of raising it. No prop is added,
// no geometry changes, no camera or global lighting change, and no other arena is touched.
//
// Every value is written from the table, never multiplied, and `userData.asgardTuned` guards the
// pass, so switching arenas back and forth cannot compound the change.

/**
 * Per-material targets. Names are the exact GLB material names (verified by parsing asgard.glb).
 *   emissive  multiplier applied to the material's own authored emissive colour
 *   metal / rough  absolute metallic and roughness factors
 *   colour    absolute base colour, only for the stone materials that need value separation
 */
import * as THREE from 'three';

// Real CC0 PBR data for the palace's rock surface (ambientCG Rock030, 1K; provenance in
// public/assets/materials/rock030_1k/SOURCES.json). The GLB ships no texture maps at all, so this is
// the only surface in the arena with genuine albedo, normal and roughness detail. Only the rock /
// cliff material takes it: city marble stays polished, and gold, bronze, electrum and bifrost
// crystal keep their authored factors, because a stone photograph on a metal accent reads as dirt.
//
// Loaded once per page and shared across every mount - switching arenas back and forth does not
// allocate a second copy - and owned by this module rather than by a material, so disposing one
// arena's materials cannot free the maps out from under the arena that is still on screen.
const ROCK_BASE = '/assets/materials/rock030_1k/';
let rock030 = null;

function loadRock030() {
  if (rock030) return rock030;
  const loader = new THREE.TextureLoader();
  const map = (file, srgb) => {
    const texture = loader.load(ROCK_BASE + file);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    // Repeat is set per surface in applyRock030 from that mesh's real footprint in metres.
    texture.anisotropy = 4;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  rock030 = {
    map: map('Rock030_1K-JPG_Color.jpg', true),
    normalMap: map('Rock030_1K-JPG_NormalGL.jpg', false),
    roughnessMap: map('Rock030_1K-JPG_Roughness.jpg', false),
    aoMap: map('Rock030_1K-JPG_AmbientOcclusion.jpg', false)
  };
  return rock030;
}

const MARBLE_BASE = '/assets/materials/marble_1k/';
let marbleMaps = null;

/**
 * Real CC0 marble (ambientCG Marble001, provenance in public/assets/materials/marble_1k/SOURCES.json).
 * The palace marble shipped as a flat factor with no maps at all, which is why 25 large panels read as
 * untextured geometry. Rock030 is a rock and is deliberately NOT used here.
 */
export function loadMarble() {
  if (marbleMaps) return marbleMaps;
  const loader = new THREE.TextureLoader();
  const load = (file, srgb) => {
    const texture = loader.load(MARBLE_BASE + file);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    // Palace walls are almost always seen at a grazing angle from the follow camera, where a 1K
    // sheet without anisotropic filtering smears its veins into vertical streaks.
    texture.anisotropy = 8;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  marbleMaps = {
    map: load('Marble001_1K-JPG_Color.jpg', true),
    normalMap: load('Marble001_1K-JPG_NormalGL.jpg', false),
    roughnessMap: load('Marble001_1K-JPG_Roughness.jpg', false)
  };
  return marbleMaps;
}

// Clones per mesh so each architectural panel can carry its own tiling instead of one repeating
// stamp across all 25 surfaces.
function marbleSurface(texture, repeat) {
  const clone = texture.clone();
  clone.needsUpdate = true;
  clone.wrapS = clone.wrapT = THREE.RepeatWrapping;
  clone.repeat.set(repeat[0], repeat[1]);
  return clone;
}

function applyMarbleDetail(material, repeat, hasSecondUv) {
  const maps = loadMarble();
  material.map = marbleSurface(maps.map, repeat);
  material.normalMap = marbleSurface(maps.normalMap, repeat);
  // Restrained relief, not rock: enough for the veins to catch a highlight on a polished slab, low
  // enough that the wall still reads as flat marble at gameplay distance.
  material.normalScale = new THREE.Vector2(0.9, 0.9);
  material.roughnessMap = marbleSurface(maps.roughnessMap, repeat);
  material.roughness = 1;
  // This ambientCG set ships no ambient-occlusion map, so none is invented: the normal and
  // roughness maps carry the surface detail and the stage lighting supplies contact shading.
  material.aoMap = null;
  // The photograph carries the value. The warm near-white tint turned the palace chalky and cool
  // next to the gold, so the tint is a restrained blue-grey that keeps the marble in the same family
  // as the palace palette while leaving every vein in the colour map visible.
  if (material.color) material.color.setHex(0xb9c4d0);
}

function applyRock030(material, hasSecondUv, repeat) {
  const maps = loadRock030();
  // One tile per ~2.5 m: the stone mesh is a 126 x 90 m courtyard, so a fixed small repeat would
  // smear one photograph over the whole arena and read as a flat wash up close.
  for (const texture of [maps.map, maps.normalMap, maps.roughnessMap, maps.aoMap]) {
    texture.repeat.set(repeat[0], repeat[1]);
  }
  material.map = maps.map;
  material.normalMap = maps.normalMap;
  material.normalScale = new THREE.Vector2(1, 1);
  material.roughnessMap = maps.roughnessMap;
  // The roughness map supplies the value now, so the scalar must not scale it down a second time.
  material.roughness = 1;
  // Rock is a dielectric, and this set has no metalness map at all - asking for one is a 404 on
  // every page load - so the surface is wired as plain non-metal.
  material.metalness = 0;
  material.metalnessMap = null;
  // aoMap samples the uv1 channel; wiring it without one renders flat grey. The caller clones
  // uv -> uv1 when the geometry has no second set, so this is only enabled when a channel exists.
  material.aoMap = hasSecondUv ? maps.aoMap : null;
  material.aoMapIntensity = 0.7; // a full-strength AO bake over a whole slope just muddies it
  // No displacement map: the slope is a low-density mesh, so height data would add silhouette
  // artefacts and vertex cost instead of detail the normal map does not already provide.
  // The albedo map carries the rock's value; keeping the old dark tint on top would multiply the
  // photograph down into mud, so the tint steps out of the way of real surface data.
  if (material.color) material.color.setHex(0xffffff);
}

/**
 * A stone material for new architecture, with its own tiling.
 *
 * Rock030's maps are shared and a texture's repeat is a property of the texture, so a 2 m course
 * cannot reuse the 126 x 90 m plaza's repeat without turning the photograph into noise. Cloning the
 * maps keeps the real albedo, normal and roughness data and tiles them at the same ~2.5 m the plaza
 * uses, which is what makes a new band read as the same stone rather than a different rock.
 */
export function createRockSurfaceMaterial(tilesX = 6, tilesY = 1, tint = 0xffffff) {
  // Own texture instances, loaded here rather than cloned from loadRock030(). Cloning a texture
  // before its image has arrived copies a null image, and the band then sampled a missing map and
  // rendered black; the plaza looked correct because it uses the shared originals.
  const loader = new THREE.TextureLoader();
  const own = (file, srgb) => {
    const texture = loader.load(ROCK_BASE + file);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(Math.max(1, tilesX), Math.max(1, tilesY));
    texture.anisotropy = 4;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  const material = new THREE.MeshStandardMaterial({
    color: tint,
    roughness: 1,
    metalness: 0,
    map: own('Rock030_1K-JPG_Color.jpg', true),
    normalMap: own('Rock030_1K-JPG_NormalGL.jpg', false),
    roughnessMap: own('Rock030_1K-JPG_Roughness.jpg', false),
    // The outer courtyard face stands in the palace's own shade. A faint warm self-light stands in
    // for bounce off the plaza instead of letting the whole band read as a black plank.
    emissive: 0x241d15,
    emissiveIntensity: 0.5
  });
  material.normalScale = new THREE.Vector2(1, 1);
  material.name = 'Asgard · courtyard stone band';
  return material;
}

/** Restrained electrum for a hairline inlay - the same metal family, none of the gold glow. */
export function createElectrumAccentMaterial() {
  const material = new THREE.MeshStandardMaterial({
    color: 0xc9a03a,
    metalness: 0.85,
    roughness: 0.34,
    // The arena ships no environment map, so a bare metal seam reads black. A faint self-light keeps
    // it reading as electrum catching the sky instead of a dark scratch.
    emissive: 0x6b4f1a,
    emissiveIntensity: 0.35
  });
  material.name = 'Asgard · courtyard electrum inlay';
  return material;
}

const ASGARD_TARGETS = Object.freeze({
  // 25 prims. The pale cream base is what makes the palace look chalky under the gold.
  'Asgard · city marble': { colour: 0x8b939c, metal: 0.05, rough: 0.66 },
  // 1 prim, but it is the cliff/ground read behind the fighters.
  'Asgard · warm stone': { colour: 0x3d372f, metal: 0.04, rough: 0.84 },
  // 180 prims: the dominant metal. It was glowing as much as it was reflecting.
  'Asgard · polished electrum': { emissive: 0.16, metal: 0.92, rough: 0.3 },
  // 70 prims: the windows should glow, they are the accent light.
  'Asgard · window light': { emissive: 0.8, metal: 0.2, rough: 0.24 },
  // 135 prims: royal gold. Deeper value, tighter highlight, faint self-light only.
  'Asgard · royal gold': { colour: 0xc79a2f, emissive: 0.22, metal: 0.94, rough: 0.28 },
  // 101 prims: the bifrost crystal has to stay the one cool, saturated accent.
  'Asgard · bifrost crystal': { emissive: 0.5, metal: 0.24, rough: 0.22 },
  // 47 prims: roofs. Darker and rougher so they stop reading as gold.
  'Asgard · bronze roofs': { colour: 0x513722, metal: 0.72, rough: 0.44 }
});

/**
 * Tune the materials of a mounted arena group. Safe to call on every mount: values are absolute and
 * the pass is recorded on each material.
 *
 * @returns {{tuned: string[], skipped: string[]}} what was changed, for the verification script
 */
export function tuneAsgardMaterials(group) {
  const tuned = [];
  const skipped = [];
  if (!group?.traverse) return { tuned, skipped };
  const seen = new Set();
  group.traverse(node => {
    if (!node.isMesh || !node.material) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material || seen.has(material.uuid)) continue;
      seen.add(material.uuid);
      const target = ASGARD_TARGETS[material.name];
      if (!target) { skipped.push(material.name || '(unnamed)'); continue; }
      if (material.userData?.asgardTuned) { tuned.push(material.name); continue; }
      if (target.colour !== undefined && material.color) material.color.setHex(target.colour);
      if (target.metal !== undefined) material.metalness = target.metal;
      if (target.rough !== undefined) material.roughness = target.rough;
      // Applied after the flat factors so the real maps win: the albedo carries the value, and the
      // roughness map - not the table's scalar - drives how glossy the surface reads.
      // The only genuinely rocky surface in the palace: the cliff/ground read behind the fighters.
      if (material.name === 'Asgard · warm stone') {
        const geometry = node.geometry;
        // The GLB ships one UV set. Sharing it as uv1 gives the AO map a real channel without
        // re-laying or damaging the original attribute.
        if (geometry && !geometry.getAttribute('uv1') && geometry.getAttribute('uv')) {
          geometry.setAttribute('uv1', geometry.getAttribute('uv'));
        }
        geometry?.computeBoundingBox?.();
        const bounds = geometry?.boundingBox;
        const tile = 2.5;
        const across = bounds ? bounds.max.x - bounds.min.x : 10;
        const depth = bounds ? bounds.max.z - bounds.min.z : 10;
        applyRock030(material, Boolean(geometry?.getAttribute('uv1')), [
          Math.max(1, Math.round(across / tile)),
          Math.max(1, Math.round(depth / tile))
        ]);
      }
      // Marble keeps its authored colour and polish; it only gains faint relief so the palace does
      // not read as untextured flat panels up close.
      if (material.name === 'Asgard · city marble') {
          const geometry = node.geometry;
          if (geometry && !geometry.getAttribute('uv1') && geometry.getAttribute('uv')) {
            geometry.setAttribute('uv1', geometry.getAttribute('uv'));
          }
          geometry?.computeBoundingBox?.();
          const b = geometry?.boundingBox;
          // Tiling follows the slab's real size. The old pass derived both axes from the footprint
          // (x and z), so a tall wall got the same repeat vertically as horizontally and the veins
          // stretched; here the vertical axis uses the mesh's height and the horizontal axis its
          // longer side, which is what a box-mapped architectural panel actually needs.
          const tile = 2.4;
          const width = b ? Math.max(b.max.x - b.min.x, b.max.z - b.min.z) : 8;
          const height = b ? b.max.y - b.min.y : 6;
          applyMarbleDetail(material, [
            Math.max(1, Math.round(width / tile)),
            Math.max(1, Math.round(height / tile))
          ], Boolean(geometry?.getAttribute('uv1')));
        }
      if (target.emissive !== undefined && material.emissive) {
        // Keep the authored hue, scale its strength. Multiplying the colour itself would shift gold
        // towards brown; emissiveIntensity only affects how much it self-illuminates.
        material.emissiveIntensity = target.emissive;
      }
      material.needsUpdate = true;
      material.userData = { ...(material.userData || {}), asgardTuned: true };
      tuned.push(material.name);
    }
  });
  return { tuned, skipped: [...new Set(skipped)] };
}
