import * as THREE from 'three';

// Structural gate for a mounted character prefab. The roster swap replaces the procedural
// fighter with the Blender prefab before anything has been rendered, so a prefab that loads
// but is broken (detached costume, feet through the floor, joints flung off the body, or the
// legacy +90 degree axis offset) must be rejected here instead of shipped to the arena.
export const RIG_JOINTS = [
  'pelvis', 'torso', 'head',
  'leftArm', 'rightArm', 'leftFore', 'rightFore',
  'leftLeg', 'rightLeg', 'leftShin', 'rightShin'
];

const scratch = new THREE.Vector3();

/**
 * @param {THREE.Object3D} model mounted prefab root, already oriented the way the fighter
 *   will render, so the measurement matches what the player sees
 * @param {{ground?: number, scale?: number, ignore?: (node: THREE.Object3D) => boolean}} options
 *   `scale` is the model's uniform render scale, so the limits hold for a 1.35x Hulk as well
 *   as a 1x roster fighter. `ground` is the world height the fighter's origin stands on.
 *   `ignore` excludes nodes (equipped weapons, VFX hooks) from the silhouette measurement.
 * @returns {{ok: boolean, issues: string[], metrics: object}}
 */
export function validateFighterRig(model, options = {}) {
  const issues = [];
  const metrics = {
    meshes: 0,
    renderableMeshes: 0,
    joints: 0,
    height: 0,
    width: 0,
    depth: 0,
    scale: 1,
    feetY: 0,
    lowestPart: 0,
    headAbovePelvis: 0,
    rootTilt: 0,
    upright: false
  };
  if (!model || !model.isObject3D) {
    return { ok: false, issues: ['no model object to validate'], metrics };
  }
  const ignore = options.ignore || (() => false);
  // Every limit below is expressed in metres on the authored 2.6 m body, then scaled: the
  // same rig is rendered at 1.35x for Hulk and 0.9x for smaller roster entries.
  const scale = Number(options.scale) > 0
    ? Number(options.scale)
    : Math.max(Math.abs(model.scale.x), Math.abs(model.scale.y), Math.abs(model.scale.z)) || 1;
  metrics.scale = +scale.toFixed(2);
  const axes = [model.scale.x, model.scale.y, model.scale.z].map(value => Math.abs(value) || 1e-6);
  // A per-axis scale is how the old bug squashed a fighter front-to-back while its height
  // still looked fine; the rig is always rendered uniformly.
  if (Math.max(...axes) / Math.min(...axes) > 1.05) {
    issues.push(`model scale is not uniform (${axes.map(value => value.toFixed(2)).join(' x ')})`);
  }

  // 1. The rig must stand upright: yaw is legitimate (the fighter turns to face its
  //    opponent), pitch and roll are not. A prefab straight out of the Blender export
  //    carries a +90 degree X rotation and Z-up joint offsets, and fighter3D.js then tips
  //    the whole fighter over as soon as it turns. Fail loudly instead.
  const tilt = new THREE.Vector3(0, 1, 0).applyQuaternion(model.quaternion).angleTo(new THREE.Vector3(0, 1, 0));
  metrics.rootTilt = +(tilt * 180 / Math.PI).toFixed(1);
  if (tilt > 0.02) {
    issues.push(`root is tilted ${metrics.rootTilt} degrees off world up; run scripts/normalize-character-rig.mjs`);
  }

  const missing = RIG_JOINTS.filter(name => !model.userData?.[name]);
  if (missing.length) issues.push('missing joints: ' + missing.join(', '));
  metrics.joints = RIG_JOINTS.length - missing.length;

  const pelvis = model.userData?.pelvis;
  if (pelvis && pelvis.position.y < 0.6) {
    issues.push(`pelvis sits at local y=${pelvis.position.y.toFixed(2)} (expected +Y up)`);
  }

  // 2. Every mesh must be renderable: real geometry, at least one vertex and a material.
  //    The union of the mesh boxes is measured at the same time, in the fighter's own frame.
  model.updateMatrixWorld(true);
  const modelOrigin = new THREE.Vector3();
  model.getWorldPosition(modelOrigin);
  const box = new THREE.Box3();
  let lowest = { name: '', y: Infinity };
  model.traverse(node => {
    if (!node.isMesh || ignore(node)) return;
    metrics.meshes++;
    const position = node.geometry?.attributes?.position;
    if (!position || position.count === 0 || !node.material) {
      issues.push(`mesh "${node.name || node.uuid}" has no drawable geometry`);
      return;
    }
    metrics.renderableMeshes++;
    const meshBox = new THREE.Box3().setFromObject(node);
    if (meshBox.isEmpty()) return;
    box.union(meshBox);
  });
  if (metrics.meshes === 0) issues.push('model has no meshes');
  if (metrics.meshes > 0 && metrics.renderableMeshes === 0) issues.push('no mesh in the model is renderable');

  // 3. Proportions and ground contact.
  const ground = options.ground ?? modelOrigin.y;
  if (box.isEmpty()) {
    return { ok: false, issues, metrics };
  }
  const size = box.getSize(new THREE.Vector3());
  metrics.height = +size.y.toFixed(2);
  metrics.width = +size.x.toFixed(2);
  metrics.depth = +size.z.toFixed(2);
  metrics.feetY = +(box.min.y - ground).toFixed(2);
  metrics.upright = size.y >= Math.max(size.x, size.z) * 0.55;

  if (metrics.height < 1.5 * scale) issues.push(`fighter is only ${metrics.height} m tall (scale ${metrics.scale})`);
  if (metrics.height > 3.8 * scale) issues.push(`fighter is ${metrics.height} m tall (scale ${metrics.scale})`);
  // Arms out (idle splay, guard, a punch) make a healthy fighter wider than it is tall, so
  // this only has to catch a rig lying on its side.
  if (!metrics.upright) {
    issues.push(`silhouette is not upright (${metrics.width} x ${metrics.height} x ${metrics.depth})`);
  }
  if (metrics.feetY < -0.25 * scale) issues.push(`feet sit ${Math.abs(metrics.feetY).toFixed(2)} m below the fighter origin`);
  if (metrics.feetY > 0.4 * scale) issues.push(`feet float ${metrics.feetY.toFixed(2)} m above the fighter origin`);

  // 4. Nothing may dangle below the floor: that is what a detached cape or a joint offset
  //    written in the wrong axis looks like from the arena camera.
  model.traverse(node => {
    if (!node.isMesh || ignore(node)) return;
    const meshBox = new THREE.Box3().setFromObject(node);
    if (meshBox.isEmpty()) return;
    if (meshBox.min.y - ground < lowest.y) lowest = { name: node.name || node.uuid, y: meshBox.min.y - ground };
  });
  if (Number.isFinite(lowest.y) && lowest.y < -0.3 * scale) {
    issues.push(`"${lowest.name}" hangs ${Math.abs(lowest.y).toFixed(2)} m below the floor`);
    metrics.lowestPart = +lowest.y.toFixed(2);
  }

  // 5. The head must sit above the pelvis, every bound joint must stay inside the body, and
  //    the hips must land in the leg half of the figure (a squashed rig fails this).
  const head = model.userData?.head;
  if (head && pelvis) {
    head.getWorldPosition(scratch);
    const headY = scratch.y - ground;
    pelvis.getWorldPosition(scratch);
    const pelvisY = scratch.y - ground;
    metrics.headAbovePelvis = +(headY - pelvisY).toFixed(2);
    if (metrics.headAbovePelvis < 0.35 * scale) {
      issues.push(`head is only ${metrics.headAbovePelvis.toFixed(2)} m above the pelvis`);
    }
    if (model.userData?.leftLeg) {
      model.userData.leftLeg.getWorldPosition(scratch);
      const hipY = scratch.y - ground;
      if (hipY < 0.3 * scale || hipY > metrics.height * 0.75) {
        issues.push(`hip joint sits at ${hipY.toFixed(2)} m on a ${metrics.height} m fighter`);
      }
    }
    if (metrics.headAbovePelvis > metrics.height) issues.push('head is above the top of the model bounds');
  }
  const forgiving = box.clone().expandByScalar(0.3 * scale);
  for (const name of RIG_JOINTS) {
    const joint = model.userData?.[name];
    if (!joint) continue;
    joint.getWorldPosition(scratch);
    if (!forgiving.containsPoint(scratch)) issues.push(`joint "${name}" sits outside the body bounds`);
  }

  return { ok: issues.length === 0, issues, metrics };
}

/** Bind the prefab's articulated joints onto userData, the shape fighter3D.js poses. */
export function bindRigJoints(model, key) {
  for (const name of RIG_JOINTS) {
    const joint = model.getObjectByName(`joint_${key}_${name}`);
    if (joint) model.userData[name] = joint;
  }
  return RIG_JOINTS.filter(name => model.userData[name]).length;
}

/** Human-readable one-liner for the console and for runtime asset diagnostics. */
export function describeRigValidation(result) {
  const m = result.metrics;
  const shape = `${m.height} m tall at ${m.scale}x, ${m.meshes} meshes, ${m.joints} joints, feet ${m.feetY} m off origin`;
  return result.ok ? `rig valid (${shape})` : `rig rejected: ${result.issues.join('; ')} (${shape})`;
}

/** Weapon meshes are not part of the fighter's silhouette; the audit excludes them. */
export function isEquippedWeapon(node) {
  return String(node.name || '').startsWith('Equipped');
}
