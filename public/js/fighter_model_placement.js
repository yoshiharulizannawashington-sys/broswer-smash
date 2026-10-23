import * as THREE from 'three';

// Placement rules for a character model imported from outside the generated prefab library
// (the manifest path: Goku's FBX, Iron Man's glTF, a Sketchfab GLB).
//
// The prefab library is shipped already normalised - identity root, Y-up, feet on y=0, facing
// +Z - but an imported asset can arrive at any scale, with its origin in the middle of the
// body, facing any direction. These helpers turn it into the same contract the rest of the
// game assumes, and they are pure so they can be tested without a browser.

/** Roster fighters are authored 2.05 m tall; imported models are normalised to this. */
export const TARGET_FIGHTER_HEIGHT = 2.05;

/**
 * Work out how an imported model has to sit inside the fighter's origin.
 *
 * @param {THREE.Box3} bounds untouched model bounds, measured with the model at the origin
 * @param {{targetHeight?: number, yawOffset?: number}} options `yawOffset` is added to the
 *   yaw that points the model at the fighter's facing direction; use Math.PI for a model
 *   authored facing -Z.
 */
export function computePlacement(bounds, options = {}) {
  const targetHeight = Number(options.targetHeight) > 0 ? Number(options.targetHeight) : TARGET_FIGHTER_HEIGHT;
  const yawOffset = Number.isFinite(options.yawOffset) ? options.yawOffset : 0;
  const size = bounds.getSize(new THREE.Vector3());
  const sourceHeight = Math.max(0.001, size.y);
  const scale = targetHeight / sourceHeight;
  // The model's own lowest point is what has to land on the floor: a Sketchfab export is
  // routinely centred on the hips, which used to leave the fighter buried to the thighs.
  const groundOffset = -bounds.min.y * scale;
  return { scale, groundOffset, yawOffset, sourceHeight, targetHeight };
}

/** Yaw that turns a +Z-facing model onto the fighter's facing vector, plus the model offset. */
export function facingYaw(facing, facingZ, yawOffset = 0) {
  const x = Number(facing) || 0;
  const z = Number(facingZ) || 0;
  if (x === 0 && z === 0) return yawOffset;
  return Math.atan2(x, z) + (Number(yawOffset) || 0);
}

/** Apply the facing yaw to a mounted fighter model. */
export function faceFighterModel(model, facing, facingZ, yawOffset = 0) {
  if (!model) return 0;
  model.rotation.y = facingYaw(facing, facingZ, yawOffset);
  return model.rotation.y;
}

/**
 * Mount an imported model on a fighter: normalise its scale, put its feet on the fighter's
 * origin, and hand back a holder whose position *is* the fighter's physics position.
 *
 * The holder keeps the imported root's own transform intact (many exports carry a -90 degree
 * X correction or a centimetre scale), so nothing here rewrites the asset or fights the
 * animation clip that drives its bones.
 *
 * @param {THREE.Object3D} root the loaded glTF/FBX scene, not yet parented
 * @param {THREE.Object3D} fighterModel the procedural body being replaced
 * @param {{yawOffset?: number, targetHeight?: number, facing?: number, facingZ?: number}} options
 */
export function mountImportedCharacter(root, fighterModel, options = {}) {
  const bounds = new THREE.Box3().setFromObject(root);
  const placement = computePlacement(bounds, options);
  root.scale.multiplyScalar(placement.scale);
  root.position.y += placement.groundOffset;
  root.updateMatrixWorld(true);
  const holder = new THREE.Group();
  holder.name = root.name || 'Imported fighter';
  holder.add(root);
  if (fighterModel) holder.position.copy(fighterModel.position);
  // The fighter reads userData off its model, so the holder shares the imported root's bag
  // rather than copying it: mixer, actions, joints and placement stay one object.
  holder.userData = root.userData || {};
  holder.userData.importedModel = root;
  holder.userData.placement = placement;
  holder.userData.modelFacingOffset = placement.yawOffset;
  faceFighterModel(holder, options.facing ?? 1, options.facingZ ?? 0, placement.yawOffset);
  return { holder, placement, bounds };
}

/** Human-readable summary for the console and for runtime asset diagnostics. */
export function describePlacement(placement) {
  return `imported model ${placement.sourceHeight.toFixed(2)} m -> ${placement.targetHeight.toFixed(2)} m (scale ${placement.scale.toFixed(3)}), feet offset ${placement.groundOffset.toFixed(3)} m, yaw offset ${(placement.yawOffset * 180 / Math.PI).toFixed(0)} deg`;
}
