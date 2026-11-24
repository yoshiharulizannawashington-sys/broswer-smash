// Native Iron Spider appendage terminals.
//
// The supplied Object_122 mesh has four five-bone leg chains under "spider body bone". The last
// bone of each chain is the physical tip that the signature's shockwave comes from. These are
// sampled from the live skinned skeleton, not inferred from the procedural fallback rig, so a
// native tip follows the authored animation every frame.
import * as THREE from 'three';

export const NATIVE_TIP_RADIUS = 0.55;

const LEG_BONE = /spider[ _-]*leg/i;
const CHAIN_END = /Bone(?:005|010)(?:_|$)/i;
const tipCache = new WeakMap();
const _tip = new THREE.Vector3();
const _parent = new THREE.Vector3();
const _direction = new THREE.Vector3();

/**
 * The four terminal bones of the native appendage mesh, in skeleton order. The fallback to every
 * spider-leg leaf keeps a different export usable if its bone numbering changes.
 */
export function nativeSpiderLegTipBones(model) {
  if (!model?.isObject3D) return [];
  const cached = tipCache.get(model);
  if (cached?.length) return cached;
  const arm = model.getObjectByName?.('Object_122') || null;
  const bones = arm?.skeleton?.bones || [];
  const leaves = bones.filter(bone => LEG_BONE.test(bone.name || '') && !(bone.children?.length));
  const numbered = leaves.filter(bone => CHAIN_END.test(bone.name || ''));
  const tips = numbered.length === 4 ? numbered : leaves;
  if (tips.length) tipCache.set(model, tips);
  return tips;
}

/**
 * World-space centers and radii for the native leg tips. The terminal bone origin is the final
 * joint; a short extension along the parent bone puts the contact sphere at the end of the tarsus.
 * Reuses `out` so the per-frame signature update does not allocate a new array.
 */
export function nativeSpiderLegTipVolumes(model, out = []) {
  out.length = 0;
  const bones = nativeSpiderLegTipBones(model);
  for (let index = 0; index < bones.length; index++) {
    const bone = bones[index];
    bone.getWorldPosition(_tip);
    if (bone.parent?.isObject3D) {
      bone.parent.getWorldPosition(_parent);
      _direction.copy(_tip).sub(_parent);
      const length = _direction.length();
      if (length > 1e-6) _tip.addScaledVector(_direction.normalize(), Math.min(0.1, length * 0.2));
    }
    out.push({
      leg: index + 1,
      bone: bone.name || `native-leg-${index + 1}`,
      pos: _tip.clone(),
      radius: NATIVE_TIP_RADIUS
    });
  }
  return out;
}
