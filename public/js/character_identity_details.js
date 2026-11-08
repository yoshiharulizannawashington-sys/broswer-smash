// Palette pass only. The identity shapes live in the exported GLBs.
//
// Jack's tricorn - closed crown, brim rim, three folded wings and the gold band - and Voldemort's
// recessed sockets, muzzle, slit eyes and brows are authored geometry in
// assets/blender/build_roster_fighters.py and arrive in captain_jack_sparrow.glb /
// lord_voldemort.glb. This module must not add geometry, hide the exported hat or move vertices
// again: the old runtime overlay is exactly what made the hat read as a separate cylinder and what
// put a second snout over Voldemort's face. Nothing here touches the skull, so there is no second
// application to accumulate - reloading a body repaints the same materials and stops.
function paintMaterials(model, materialNames, colour, { roughness = null } = {}) {
  const painted = [];
  model.traverse(node => {
    if (!node.isMesh) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    for (const mat of mats) {
      if (!mat || !materialNames.includes(mat.name)) continue;
      if (mat.color) mat.color.set(colour);
      if (roughness !== null && 'roughness' in mat) mat.roughness = roughness;
      mat.needsUpdate = true;
      painted.push(mat.name);
    }
  });
  return painted;
}


export function applyJackTricorn(model) {
  // The tricorn is authored mesh in the exported GLB (assets/blender/build_roster_fighters.py), so
  // the runtime must not mount a second hat or hide the band any more: that overlay is exactly what
  // made the hat read as a separate cylinder floating over the hair.
  // Only the hat felt is tinted. `jack-trim` is his tan bandana, not the gold hat band - the gold
  // band is authored with its own material in the build, so tinting that slot gold would turn the
  // bandana gold too.
  const tintedHat = paintMaterials(model, ['jack-hat'], 0x1b1b1d, { roughness: 0.86 });
  return { ok: true, source: 'glb', tintedHat, parts: tintedHat };
}

/**
 * Voldemort: pale desaturated skin, dark slits and robe. The human nose is gone from the mesh itself
 * (its vertices are sculpted into the muzzle at build time), so there is no nose to conceal.
 */
export function applyVoldemortIdentity(model) {
  // The recessed sockets, flat muzzle, slit eyes and nostrils are authored vertices and mesh in the
  // exported GLB. The baked human nose is deleted there at build time, so there is no nose left to
  // conceal and nothing to carve here. This pass only keeps the palette on-model.
  const paintedSkin = paintMaterials(model, ['fighter-skin', 'fighter-skin-shade'], 0xc9cfc6, { roughness: 0.9 });
  const paintedEyes = paintMaterials(model, ['fighter-eye', 'fighter-iris', 'vold-socket', 'vold-slit'], 0x14170f);
  const paintedCloth = paintMaterials(model, ['fighter-undershirt', 'fighter-gi', 'fighter-trim', 'fighter-accent'], 0x14161c, { roughness: 0.95 });
  return { ok: true, source: 'glb', paintedSkin, paintedEyes, paintedCloth };
}

/** Apply whichever identity details belong to this fighter. Safe to call on every body. */
export function applyIdentityDetails(model, fighter) {
  const key = String(fighter?.identityKey || fighter?.identity || '').toLowerCase();
  const slug = key.replace(/[^a-z0-9]+/g, '_');
  try {
    if (slug.includes('jack_sparrow')) return { identity: 'jack', ...applyJackTricorn(model) };
    if (slug.includes('voldemort')) return { identity: 'voldemort', ...applyVoldemortIdentity(model) };
  } catch (error) {
    console.warn('Identity details failed: ' + (error?.message || error));
    return { identity: slug, ok: false, reason: String(error?.message || error) };
  }
  return { identity: slug, ok: false, reason: 'no identity details' };
}
