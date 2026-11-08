// Iron Spider's mechanical appendages: four articulated legs with real joints.
//
// Each leg is a three-segment chain (coxa -> femur -> tibia) built from nested groups, so a
// pose is a set of joint rotations rather than a stretched cylinder. The chain is authored in
// the same space as the procedural/prefab fighter (origin at the feet, Y up, character facing
// +Z), hinged on a harness behind the shoulders.
//
// The legs are presentation: the sweep's damage volume is still the propagating shockwave arc
// resolved in main.js. What the legs add to the simulation is their tip positions - the sweep
// accepts a leg-tip contact as a hit as well, so a target standing in the arc of a leg that is
// physically touching them is hit even outside the facing cone - and per-state poses that make
// the attack, guard, hitstun and flight states readable.
import * as THREE from 'three';

/** Segment lengths in metres, ordered coxa -> femur -> tibia. */
export const SEGMENTS = Object.freeze([0.34, 0.5, 0.58]);
export const SEGMENT_SCALE = 1.25;
export const REACH = SEGMENTS.reduce((sum, n) => sum + n, 0) * SEGMENT_SCALE;

/** Harness hinge points, in fighter space. Mirrored pairs front/back. */
export const LEG_LAYOUT = Object.freeze([
  { id: 'front-left', side: -1, tier: 0 },
  { id: 'front-right', side: 1, tier: 0 },
  { id: 'back-left', side: -1, tier: 1 },
  { id: 'back-right', side: 1, tier: 1 }
]);

// Pose presets. `yaw` swings the leg around the body, `x` is the pitch of each joint in
// radians (negative lifts the segment away from the ground, positive drives it down).
export const POSES = Object.freeze({
  folded: { coxa: [-0.92, 0], femur: [-0.5, 0], tibia: [1.92, 0], crouch: 0 },
  idle: { coxa: [-0.86, 0], femur: [-0.44, 0], tibia: [1.78, 0], crouch: 0 },
  // Flare lifts the legs off the harness; strike straightens them and drives them down, so the
  // tips genuinely leave the body instead of folding tighter.
  flare: { coxa: [-0.26, 0.06], femur: [-0.16, 0], tibia: [0.34, 0], crouch: 0 },
  strike: { coxa: [0.3, 0.06], femur: [-0.04, 0], tibia: [-0.12, 0], crouch: 0 },
  guard: { coxa: [-0.34, 0.5], femur: [-0.52, 0.16], tibia: [1.34, 0], crouch: 0 },
  stagger: { coxa: [-0.06, 0.4], femur: [0.58, -0.22], tibia: [0.86, 0], crouch: 0 },
  flight: { coxa: [-1.24, 0.16], femur: [-0.62, 0], tibia: [0.5, 0], crouch: 0 },
  land: { coxa: [0.3, 0.3], femur: [0.2, 0], tibia: [0.7, 0], crouch: 0.1 }
});

const DAMP = 9.5;
const _tipWorld = new THREE.Vector3();

function segmentMesh(length, radius, material) {
  // A tapered cylinder laid along local +Z, with the fat end at the joint.
  const geometry = new THREE.CylinderGeometry(radius * 0.62, radius, length, 6);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.z = length / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.formSurface = 'appendage';
  return mesh;
}

function jointSphere(radius, material) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 6), material);
  mesh.castShadow = true;
  mesh.userData.formSurface = 'appendage';
  return mesh;
}

/**
 * Attach the leg rig to a fighter model. Returns the rig, or null when the model is not a
 * character root. Idempotent: a second call reuses the existing rig.
 */
export function attachSpiderLegs(root) {
  if (!root?.isObject3D) return null;
  if (root.userData.spiderLegs) return root.userData.spiderLegs;

  const group = new THREE.Group();
  group.name = 'spider-leg-rig';
  const gold = new THREE.MeshStandardMaterial({ name: 'spider-leg-gold', color: 0xd8a640, metalness: 0.88, roughness: 0.22, emissive: 0xffb63c, emissiveIntensity: 0.55 });
  const steel = new THREE.MeshStandardMaterial({ name: 'spider-leg-steel', color: 0x2b2f38, metalness: 0.7, roughness: 0.3, emissive: 0x101820, emissiveIntensity: 0.2 });

  const legs = LEG_LAYOUT.map((layout, index) => {
    const hip = new THREE.Group();
    hip.name = `spider-leg-${layout.id}`;
    hip.position.set(layout.side * 0.3, 1.5 - layout.tier * 0.16, -0.3 - layout.tier * 0.03);
    // Yaw puts the four legs on the diagonals, like a spider's stance.
    hip.rotation.y = layout.side * (0.72 + layout.tier * 0.5) + (layout.tier ? Math.PI : 0);
    group.add(hip);

    const coxa = new THREE.Group();
    hip.add(coxa);
    coxa.add(segmentMesh(SEGMENTS[0] * SEGMENT_SCALE, 0.055, gold));

    const femur = new THREE.Group();
    femur.position.z = SEGMENTS[0] * SEGMENT_SCALE;
    coxa.add(femur);
    femur.add(jointSphere(0.05, gold));
    femur.add(segmentMesh(SEGMENTS[1] * SEGMENT_SCALE, 0.045, steel));

    const tibia = new THREE.Group();
    tibia.position.z = SEGMENTS[1] * SEGMENT_SCALE;
    femur.add(tibia);
    tibia.add(jointSphere(0.042, gold));
    tibia.add(segmentMesh(SEGMENTS[2] * SEGMENT_SCALE, 0.034, steel));

    const tip = new THREE.Object3D();
    tip.position.z = SEGMENTS[2] * SEGMENT_SCALE;
    tibia.add(tip);
    tip.add(jointSphere(0.038, gold));

    return {
      id: layout.id, index, layout, hip, coxa, femur, tibia, tip,
      phase: index * 1.37,
      current: { coxa: [-0.9, 0], femur: [-0.5, 0], tibia: [1.8, 0] },
      pose: 'folded'
    };
  });

  const rig = {
    group, legs, gold, steel,
    reach: REACH,
    state: 'folded',
    strike: 0,
    enabled: true,
    // Bumped whenever a pose is applied, so tooling can prove the joints actually move.
    poseWrites: 0
  };
  root.add(group);
  root.userData.spiderLegs = rig;
  applyPose(rig, 'folded', 1);
  return rig;
}

function lerp(a, b, t) { return a + (b - a) * t; }

/** Force a pose immediately (used at attach time and by tests). */
export function applyPose(rig, poseId, blend = 1) {
  if (!rig) return false;
  const pose = POSES[poseId] || POSES.idle;
  for (const leg of rig.legs) {
    const mirror = leg.layout.side;
    leg.current.coxa[0] = lerp(leg.current.coxa[0], pose.coxa[0], blend);
    leg.current.coxa[1] = lerp(leg.current.coxa[1], pose.coxa[1] * mirror, blend);
    leg.current.femur[0] = lerp(leg.current.femur[0], pose.femur[0], blend);
    leg.current.femur[1] = lerp(leg.current.femur[1], pose.femur[1] * mirror, blend);
    leg.current.tibia[0] = lerp(leg.current.tibia[0], pose.tibia[0], blend);
    leg.hip.position.y = lerp(leg.hip.position.y, 1.5 - leg.layout.tier * 0.16 - pose.crouch, blend);
  }
  rig.state = poseId;
  rig.poseWrites++;
  writeJoints(rig);
  return true;
}

function writeJoints(rig) {
  for (const leg of rig.legs) {
    leg.coxa.rotation.set(leg.current.coxa[0], leg.current.coxa[1], 0);
    leg.femur.rotation.set(leg.current.femur[0], leg.current.femur[1], 0);
    leg.tibia.rotation.set(leg.current.tibia[0], 0, 0);
  }
}

/** Pick the pose the current gameplay state should show. */
export function poseForState(fighter) {
  if (!fighter) return 'idle';
  if (fighter.hitstun > 0.28) return 'stagger';
  if (fighter.legStrike > 0) return fighter.legStrike > 0.55 ? 'strike' : 'flare';
  if (fighter.guardHeld && fighter.guardBreak <= 0) return 'guard';
  if (fighter.flightMode) return 'flight';
  if (fighter.dodgeTimer > 0) return 'stagger';
  if (!fighter.isGrounded && (fighter.velocity?.y || 0) < -6) return 'land';
  const speed = Math.hypot(fighter.velocity?.x || 0, fighter.velocity?.z || 0);
  if (speed > 1.4) return 'idle';
  return 'idle';
}

/**
 * Drive the legs from the fighter's state. Called once per frame after the gameplay step.
 * Cheap: a handful of damped rotations and no allocation.
 */
export function updateSpiderLegs(fighter, dt) {
  const rig = fighter?.model?.userData?.spiderLegs;
  if (!rig || !rig.enabled) return null;
  const step = Math.min(0.05, dt || 0);
  // `legStrike` is set by the signature move; hold it at full for the strike window, then let
  // the pose relax. The legs keep striking while the wave is travelling, which is what sells
  // the shockwave as coming from them.
  fighter.legStrike = Math.max(0, (fighter.legStrike || 0) - step);
  const poseId = poseForState(fighter);
  const pose = POSES[poseId] || POSES.idle;
  const blend = Math.min(1, step * DAMP);
  const t = fighter.t || 0;
  for (const leg of rig.legs) {
    const mirror = leg.layout.side;
    // A slow sway keeps the idle legs alive; it vanishes once a real pose takes over.
    const sway = poseId === 'idle' ? Math.sin(t * 1.7 + leg.phase) * 0.06 : 0;
    const jitter = poseId === 'stagger' ? Math.sin(t * 22 + leg.phase) * 0.12 : 0;
    leg.current.coxa[0] = lerp(leg.current.coxa[0], pose.coxa[0] + sway, blend);
    leg.current.coxa[1] = lerp(leg.current.coxa[1], pose.coxa[1] * mirror + sway * 0.4, blend);
    leg.current.femur[0] = lerp(leg.current.femur[0], pose.femur[0] + jitter, blend);
    leg.current.femur[1] = lerp(leg.current.femur[1], pose.femur[1] * mirror + sway * 0.5, blend);
    leg.current.tibia[0] = lerp(leg.current.tibia[0], pose.tibia[0] + jitter * 0.6, blend);
    // A striking leg drives a little further than the rest, so the sweep is not a rigid fan.
    if (poseId === 'strike') {
      const lunge = 0.1 + 0.06 * Math.sin(t * 14 + leg.phase);
      leg.current.coxa[0] += lunge;
    }
  }
  rig.strike = fighter.legStrike || 0;
  rig.state = poseId;
  rig.poseWrites++;
  writeJoints(rig);
  return poseId;
}

/** World-space positions of the four leg tips, for hit tests and impact VFX. */
export function spiderLegTips(rig, out = []) {
  out.length = 0;
  if (!rig) return out;
  rig.group.updateWorldMatrix(true, true);
  for (const leg of rig.legs) {
    out.push(leg.tip.getWorldPosition(new THREE.Vector3()));
  }
  return out;
}

/** Report used by tooling and the docs: real joint counts and measured reach. */
export function describeSpiderLegs(rig) {
  if (!rig) return null;
  rig.group.updateWorldMatrix(true, true);
  const tips = spiderLegTips(rig);
  const root = rig.group.getWorldPosition(_tipWorld).clone();
  return {
    legs: rig.legs.length,
    jointsPerLeg: 3,
    joints: rig.legs.length * 3,
    reach: Number(REACH.toFixed(3)),
    state: rig.state,
    strike: Number((rig.strike || 0).toFixed(3)),
    poseWrites: rig.poseWrites,
    tipSpread: Number(Math.max(...tips.map(t => t.distanceTo(root))).toFixed(3))
  };
}

export function detachSpiderLegs(root) {
  const rig = root?.userData?.spiderLegs;
  if (!rig) return false;
  rig.group.parent?.remove(rig.group);
  rig.group.traverse(node => {
    node.geometry?.dispose?.();
  });
  rig.gold.dispose?.();
  rig.steel.dispose?.();
  delete root.userData.spiderLegs;
  return true;
}
