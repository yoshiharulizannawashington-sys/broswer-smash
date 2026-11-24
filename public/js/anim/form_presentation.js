// Transformation presentation: real material and geometry changes on the fighter's own body.
//
// A form is not just an aura. Where the body has surfaces that can honestly change - the
// character's hair mesh, a reactor disc, the mechanical appendages - the form retargets those
// materials and, for hair, scales the geometry so the silhouette changes too. Everything is
// restored from a recorded original, so expiry, interruption, KO, round reset and rematch all
// put the base appearance back exactly.
//
// What this module will NOT do is claim a model swap. The procedural and Blender-prefab bodies
// tag their own surfaces (`userData.formSurface`); an imported rig is only retinted where a
// material or mesh name clearly identifies hair or a reactor. Anything else is left alone and
// the aura carries the form's identity.
import * as THREE from 'three';

/** Surface tags a body can declare. */
export const SURFACES = Object.freeze(['hair', 'reactor', 'appendage', 'accent']);

const _color = new THREE.Color();

function tagOf(node) {
  const tag = node?.userData?.formSurface;
  if (tag && SURFACES.includes(tag)) return tag;
  // Materials the fighter authors declared for this purpose by name.
  const declared = node?.material?.name;
  if (declared === 'fighter-hair') return 'hair';
  if (declared === 'fighter-accent') return 'accent';
  // Imported rigs: only unambiguous names are accepted. A guess would silently repaint a face.
  const label = `${declared || ''} ${node?.name || ''}`.toLowerCase();
  if (/\bhair\b|hair_|_hair/.test(label)) return 'hair';
  if (/reactor|arc[_-]?reactor|unibeam/.test(label)) return 'reactor';
  return null;
}

/** Every material on the model that a form is allowed to change, grouped by surface tag. */
export function collectFormSurfaces(model) {
  const found = new Map();
  if (!model?.traverse) return found;
  model.traverse(node => {
    if (!node.isMesh || !node.material) return;
    const tag = tagOf(node);
    if (!tag) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material) continue;
      if (!found.has(tag)) found.set(tag, []);
      const entry = found.get(tag);
      if (!entry.some(item => item.material === material)) {
        entry.push({ material, mesh: node, baseScale: node.scale.clone() });
      }
    }
  });
  return found;
}

/**
 * Apply a form's look. `look` is authored per form in combat/movesets.js:
 *   { hair: {color, emissive, emissiveIntensity, scale}, reactor: {...}, appendage: {...}, accent: {...} }
 * Returns { applied, surfaces, tags } so callers (and tests) can see exactly what changed.
 */
export function applyFormPresentation(fighter, form) {
  const look = form?.look || null;
  const model = fighter?.model;
  if (!look || !model) return { applied: false, surfaces: 0, tags: [] };
  clearFormPresentation(fighter);
  const found = collectFormSurfaces(model);
  const records = [];
  for (const [tag, entries] of found) {
    const spec = look[tag];
    if (!spec) continue;
    for (const { material, mesh, baseScale } of entries) {
      const record = {
        tag,
        material,
        baseColor: material.color ? material.color.clone() : null,
        baseEmissive: material.emissive ? material.emissive.clone() : null,
        baseIntensity: material.emissiveIntensity ?? 1,
        formIntensity: spec.emissiveIntensity ?? material.emissiveIntensity ?? 1,
        mesh,
        baseScale,
        flash: 1
      };
      if (spec.color != null && material.color) {
        if (spec.mix != null) material.color.lerp(_color.setHex(spec.color), spec.mix);
        else material.color.setHex(spec.color);
      }
      if (spec.emissive != null && material.emissive) material.emissive.setHex(spec.emissive);
      if (spec.emissiveIntensity != null) material.emissiveIntensity = spec.emissiveIntensity;
      if (material.needsUpdate) material.needsUpdate = true;
      if (spec.scale != null && mesh?.scale) {
        // Hair lifts and flares; the mesh keeps its authored shape, only the silhouette grows.
        mesh.scale.copy(baseScale).multiplyScalar(spec.scale);
      }
      records.push(record);
    }
  }
  // Alternate meshes: a form that ships a real second mesh (Super Saiyan hair, a variant
  // armour shell) swaps it in and hides the base. Recorded so every exit path restores it.
  const variants = model.userData?.formVariants;
  const variant = variants?.[form.id] || null;
  const swapped = [];
  if (variant) {
    const baseSets = model.userData?.hairSets;
    const hidden = baseSets?.base ? [baseSets.base] : [];
    for (const node of hidden) {
      if (!node) continue;
      swapped.push({ node, wasVisible: node.visible });
      node.visible = false;
    }
    swapped.push({ node: variant, wasVisible: variant.visible });
    variant.visible = true;
  }
  fighter.formLook = { id: form.id, records, swapped, tags: [...new Set(records.map(r => r.tag))] };
  return { applied: records.length > 0, surfaces: records.length, tags: fighter.formLook.tags };
}

/** Put every surface back the way the body was authored. Safe to call when nothing is applied. */
export function clearFormPresentation(fighter, reason = 'ended') {
  const state = fighter?.formLook;
  if (!state) return false;
  for (const record of state.records) {
    if (record.baseColor && record.material.color) record.material.color.copy(record.baseColor);
    if (record.baseEmissive && record.material.emissive) record.material.emissive.copy(record.baseEmissive);
    if (record.material.emissiveIntensity != null) record.material.emissiveIntensity = record.baseIntensity;
    if (record.baseScale && record.mesh?.scale) record.mesh.scale.copy(record.baseScale);
  }
  for (const swap of state.swapped || []) {
    if (swap.node) swap.node.visible = swap.wasVisible;
  }
  fighter.formLook = null;
  return reason !== 'none';
}

/**
 * Advance the form's presentation: a short emissive flash on activation that settles into the
 * authored intensity, and a fade back as the timer runs out. No allocation, no clones.
 */
export function updateFormPresentation(fighter, dt) {
  const state = fighter?.formLook;
  if (!state) return;
  const step = Math.min(0.05, dt || 0);
  const remaining = fighter.transform ? Math.max(0, fighter.transform.time) : 0;
  const fading = fighter.transform ? Math.min(1, remaining * 1.6) : 1;
  for (const record of state.records) {
    if (record.flash > 0) record.flash = Math.max(0, record.flash - step * 2.6);
    const material = record.material;
    if (material.emissiveIntensity == null) continue;
    // `formIntensity` is the form's authored value; `baseIntensity` is only used to restore.
    material.emissiveIntensity = record.formIntensity * (1 + record.flash * 0.55) * (0.35 + 0.65 * fading);
  }
}

/** Snapshot for the debug overlay and the asset report. */
export function formPresentationReport(fighter) {
  const state = fighter?.formLook;
  if (!state) return { active: false, tags: [], surfaces: 0 };
  return {
    active: true,
    id: state.id,
    tags: state.tags.slice(),
    surfaces: state.records.length,
    swappedMeshes: (state.swapped || []).length,
    detail: state.records.map(r => ({
      tag: r.tag,
      material: r.material?.name || '(unnamed)',
      color: r.material?.color ? '#' + r.material.color.getHexString() : null,
      emissiveIntensity: r.material?.emissiveIntensity ?? null
    }))
  };
}
