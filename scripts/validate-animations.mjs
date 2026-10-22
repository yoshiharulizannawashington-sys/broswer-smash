#!/usr/bin/env node
// Animation validation: proves the clip library, rig binding, retargeting and state machine work
// before a browser is involved. Every assertion here runs against the real modules the game
// imports, not against a copy.
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { CLIP_SPECS, buildAllClips, retimeClip } from '../public/js/anim/clip_library.js';
import { resolveRig, CANONICAL_BONES, classifyBone } from '../public/js/anim/rig_map.js';
import { AnimationController, attachAnimation } from '../public/js/anim/animation_controller.js';

// The controllers publish diagnostics onto window for browser tooling; give node the same surface.
if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '..');

const REQUIRED_CLIPS = [
  'idle', 'walk', 'run', 'sprint', 'turn', 'stop', 'strafe_left', 'strafe_right',
  'jump', 'double_jump', 'fall', 'land', 'fly_start', 'fly_loop', 'fly_boost', 'fly_turn', 'fly_land',
  'fighting_idle', 'jab', 'cross_punch', 'heavy_punch', 'uppercut', 'front_kick', 'spinning_kick',
  'combo_1', 'combo_2', 'special_attack',
  'block', 'dodge_left', 'dodge_right', 'grab', 'throw',
  'hit_light', 'hit_heavy', 'launch', 'aerial_recovery', 'knockdown', 'get_up', 'knockout'
];

const failures = [];
const notes = [];
function check(name, condition, detail = '') {
  if (condition) return true;
  failures.push(`${name}${detail ? ' — ' + detail : ''}`);
  return false;
}

/**
 * Build a rig shaped like the prefab fighters in models.js: 11 named joints on userData, wired
 * into a real hierarchy so world-space limb directions can be checked (not just local angles).
 */
function makePrefabRig() {
  const model = new THREE.Group();
  model.name = 'validation fighter';
  const joint = (parent, x, y, z) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };
  const pelvis = joint(model, 0, 0.95, 0);
  const torso = joint(pelvis, 0, 0.33, 0);
  const head = joint(torso, 0, 0.44, 0);
  // Arms and legs hang along -Y from their socket, which is the convention the clips assume.
  const leftArm = joint(torso, 0.19, 0.17, 0);
  const leftFore = joint(leftArm, 0, -0.32, 0);
  const rightArm = joint(torso, -0.19, 0.17, 0);
  const rightFore = joint(rightArm, 0, -0.32, 0);
  const leftLeg = joint(pelvis, 0.13, -0.05, 0);
  const leftShin = joint(leftLeg, 0, -0.42, 0);
  const rightLeg = joint(pelvis, -0.13, -0.05, 0);
  const rightShin = joint(rightLeg, 0, -0.42, 0);
  const joints = { pelvis, torso, head, leftArm, leftFore, rightArm, rightFore, leftLeg, leftShin, rightLeg, rightShin };
  Object.assign(model.userData, joints);
  return { model, joints };
}

/** Apply one clip frame to the hierarchy and return world-space joint positions. */
function poseWorld(clip, time) {
  for (const track of clip.tracks) {
    const bone = track.name.replace('.quaternion', '').replace('bs_', '');
    const node = joints[bone];
    if (node) node.quaternion.fromArray(sample(track, time));
  }
  model.updateMatrixWorld(true);
  const out = {};
  for (const [bone, node] of Object.entries(joints)) {
    out[bone] = node.getWorldPosition(new THREE.Vector3());
  }
  return out;
}

function makeFighter() {
  return {
    identityKey: 'validation',
    velocity: new THREE.Vector3(),
    isGrounded: true,
    hitstun: 0,
    guardHeld: false,
    guardBreak: 0,
    dodgeTimer: 0,
    attackQueue: [],
    flightMode: false,
    webSwinging: false,
    specialCooldown: 0,
    comboStep: 1,
    facing: 1,
    facingZ: 0,
    percent: 0
  };
}

function step(controller, frames, dt = 1 / 60, mutate = null) {
  for (let i = 0; i < frames; i++) {
    if (mutate) mutate(i);
    controller.update(dt);
  }
}

const quatAngle = (a, b) => {
  const dot = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
  return 2 * Math.acos(dot);
};

// Three.js r152 exposes track sampling through the interpolant, not getValueAtTime().
const _interpolants = new WeakMap();
function sample(track, t) {
  let interpolant = _interpolants.get(track);
  if (!interpolant) {
    interpolant = track.createInterpolant();
    _interpolants.set(track, interpolant);
  }
  return Array.from(interpolant.evaluate(t));
}

// ---------------------------------------------------------------- 1. clip library
const { model, joints } = makePrefabRig();
const rig = resolveRig(model);
check('rig binds a prefab skeleton', rig?.kind === 'prefab', `got ${rig?.kind}`);
check('all 11 canonical bones bound', rig?.boundCount === CANONICAL_BONES.length, `bound ${rig?.boundCount}`);

const clips = buildAllClips(rig);
check('clip library compiles every id', clips.size === Object.keys(CLIP_SPECS).length,
  `${clips.size} of ${Object.keys(CLIP_SPECS).length}`);
for (const id of REQUIRED_CLIPS) check(`clip present: ${id}`, clips.has(id));

let trackCount = 0;
let keyframeCount = 0;
for (const [id, clip] of clips) {
  trackCount += clip.tracks.length;
  check(`${id}: has animation tracks`, clip.tracks.length >= 6, `${clip.tracks.length} tracks`);
  check(`${id}: duration > 0`, clip.duration > 0.1, String(clip.duration));
  for (const track of clip.tracks) {
    const times = Array.from(track.times);
    keyframeCount += times.length;
    check(`${id}: times sorted`, times.every((t, i) => i === 0 || t >= times[i - 1] - 1e-6));
    check(`${id}: starts at 0`, Math.abs(times[0]) < 1e-6);
    check(`${id}: ends at duration`, Math.abs(times[times.length - 1] - clip.duration) < 1e-4,
      `${times[times.length - 1]} vs ${clip.duration}`);
    check(`${id}: no NaN keys`, Array.from(track.values).every(Number.isFinite));
  }
  // A loop must return to its opening pose or the fighter visibly snaps every cycle.
  if (clip.userData.loop) {
    for (const track of clip.tracks) {
      const first = Array.from(track.values.slice(0, 4));
      const last = Array.from(track.values.slice(track.values.length - 4));
      const angle = quatAngle(first, last);
      check(`${id}: loop ${track.name} closes`, angle < 1e-3, `open by ${angle.toFixed(4)} rad`);
    }
  }
}

// ------------------------------------------------------------- 2. clip actually moves
const idleClip = clips.get('idle');
const armTrack = idleClip.tracks.find(t => t.name === 'bs_leftArm.quaternion');
check('idle track targets a named bone', Boolean(armTrack), armTrack?.name);
const restArm = rig.rest.get('leftArm').toArray();
let maxIdleDelta = 0;
for (const t of Array.from(armTrack.times)) {
  maxIdleDelta = Math.max(maxIdleDelta, quatAngle(sample(armTrack, t), restArm));
}
check('idle visibly moves the arm', maxIdleDelta > 0.01, `max ${maxIdleDelta.toFixed(4)} rad`);

const runClip = clips.get('run');
const legTrack = runClip.tracks.find(t => t.name === 'bs_leftLeg.quaternion');
let maxLegSwing = 0;
for (let i = 0; i <= 20; i++) {
  const q = sample(legTrack, (runClip.duration * i) / 20);
  maxLegSwing = Math.max(maxLegSwing, quatAngle(q, rig.rest.get('leftLeg').toArray()));
}
check('run drives a full leg swing', maxLegSwing > 0.5, `max ${maxLegSwing.toFixed(3)} rad`);
notes.push(`library: ${clips.size} clips, ${trackCount} tracks, ${keyframeCount} keyframes`);

// ---------------------------------------------------------- 3. strike/hitbox sync
function strikeAlignment(id, attack, strikeBone) {
  const source = clips.get(id);
  const total = attack.total;
  const center = (attack.start + attack.end) / 2;
  const peak = center / total;
  const retimed = retimeClip(source, total, peak);
  const track = retimed.tracks.find(t => t.name === strikeBone);
  if (!track) return { missing: strikeBone, drift: Infinity, center, peak, bone: strikeBone, angle: 0 };
  const rest = rig.rest.get(strikeBone.replace('.quaternion', '').replace('bs_', '')).toArray();
  // Argmax of the limb's rotation from rest must sit on the gameplay active window.
  let argmax = { t: 0, angle: -1 };
  for (let i = 0; i <= 400; i++) {
    const t = (total * i) / 400;
    const angle = quatAngle(sample(track, t), rest);
    if (angle > argmax.angle) argmax = { t, angle };
  }
  return { drift: Math.abs(argmax.t - center), center, peak, bone: strikeBone, angle: argmax.angle };
}

// The strike bone is named per move rather than guessed: guessing picks whichever limb happens
// to sweep furthest, which for a spinning kick is the off hand at the end of the clip.
const attackCases = [
  ['jab', { kind: 'melee', total: 0.34, start: 0.065, end: 0.19 }, 'bs_leftArm.quaternion'],
  ['cross_punch', { kind: 'melee', total: 0.34, start: 0.065, end: 0.19 }, 'bs_rightArm.quaternion'],
  ['heavy_punch', { kind: 'heavy', total: 0.56, start: 0.14, end: 0.31 }, 'bs_rightArm.quaternion'],
  ['spinning_kick', { kind: 'air-finisher', total: 0.56, start: 0.08, end: 0.4 }, 'bs_leftLeg.quaternion'],
  ['front_kick', { kind: 'air-strike', total: 0.43, start: 0.08, end: 0.31 }, 'bs_rightLeg.quaternion']
];
for (const [id, attack, strikeBone] of attackCases) {
  const result = strikeAlignment(id, attack, strikeBone);
  const frame = 1 / 60;
  check(`${id}: strike lands on the active window`, result.drift <= frame,
    `drift ${(result.drift * 1000).toFixed(1)}ms (centre ${(result.center * 1000).toFixed(0)}ms)`);
  check(`${id}: strike is a real extension`, result.angle > 0.35, `${result.angle.toFixed(2)} rad`);
  notes.push(`${id}: peak ${result.bone} ${(result.angle).toFixed(2)} rad at ${(result.center * 1000).toFixed(0)}ms (drift ${(result.drift * 1000).toFixed(1)}ms)`);
}

// ------------------------------------------------ 4. limb directions in world space
// Local Euler signs are easy to get backwards; these checks assert where the limb actually ends
// up in the world, which is what the player sees and what the hitbox is judged against.
const peakOf = id => clips.get(id).duration * (clips.get(id).userData.peak ?? 0.5);

/**
 * Fingertip position and forearm bend for a posed limb. There is no hand joint, so the fist is
 * the wrist extended 0.3 m along the forearm's own -Y axis; the bend is the angle between the
 * upper arm and the forearm, which is what actually reads as a punch versus a guard.
 */
function limb(boneName) {
  const node = joints[boneName];
  const dir = new THREE.Vector3(0, -1, 0).transformDirection(node.matrixWorld);
  const tip = node.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 0.3);
  return { tip, dir };
}
const bend = (armBone, foreBone) => Math.acos(THREE.MathUtils.clamp(
  limb(armBone).dir.dot(limb(foreBone).dir), -1, 1));

const shoulderToFist = (armBone, foreBone) =>
  joints[armBone].getWorldPosition(new THREE.Vector3()).distanceTo(limb(foreBone).tip);

// Measure the jab while the jab pose is actually on the rig, then re-pose for the guard.
const jabWorld = poseWorld(clips.get('jab'), peakOf('jab'));
const jabFist = limb('leftFore');
const jabReach = jabFist.tip.z - jabWorld.torso.z;
const jabBend = bend('leftArm', 'leftFore');
const jabExtension = shoulderToFist('leftArm', 'leftFore');

const guardWorld = poseWorld(clips.get('fighting_idle'), 0);
const guardFist = limb('leftFore');
const guardBend = bend('leftArm', 'leftFore');
const guardExtension = shoulderToFist('leftArm', 'leftFore');
check('jab extends the fist forward', jabReach > 0.45, `fist ${jabReach.toFixed(2)}m ahead of chest`);
// Distance from the shoulder is the honest extension measure: a high guard already holds the
// fists forward, so a jab is only longer when the arm actually straightens out.
check('jab extends further from the shoulder than the guard', jabExtension > guardExtension + 0.08,
  `jab ${jabExtension.toFixed(2)}m vs guard ${guardExtension.toFixed(2)}m`);
check('jab straightens the arm', jabBend < 0.45, `${jabBend.toFixed(2)} rad bend`);
check('guard keeps the elbow bent', guardBend > 0.95, `${guardBend.toFixed(2)} rad bend`);
check('jab fist stays on its own side', Math.abs(jabFist.tip.x) < 0.5, `x ${jabFist.tip.x.toFixed(2)}`);
check('jab fist is at head height', jabFist.tip.y > 1.05 && jabFist.tip.y < 1.85,
  `y ${jabFist.tip.y.toFixed(2)}`);

const kickWorld = poseWorld(clips.get('front_kick'), peakOf('front_kick'));
check('front kick drives the shin forward', kickWorld.rightShin.z - kickWorld.pelvis.z > 0.3,
  `shin z ${(kickWorld.rightShin.z - kickWorld.pelvis.z).toFixed(2)}m ahead of hips`);
check('front kick lifts the shin above knee height', kickWorld.rightShin.y > 0.55, `y ${kickWorld.rightShin.y.toFixed(2)}`);

const flyWorld = poseWorld(clips.get('fly_loop'), 0.4);
check('flight spreads both arms wide',
  flyWorld.leftFore.x - flyWorld.torso.x > 0.3 && flyWorld.torso.x - flyWorld.rightFore.x > 0.3,
  `hands at x ${flyWorld.leftFore.x.toFixed(2)} / ${flyWorld.rightFore.x.toFixed(2)}`);
check('flight trails the legs behind the hips',
  flyWorld.leftShin.z < flyWorld.pelvis.z && flyWorld.rightShin.z < flyWorld.pelvis.z,
  `shins z ${flyWorld.leftShin.z.toFixed(2)} / ${flyWorld.rightShin.z.toFixed(2)} vs hips ${flyWorld.pelvis.z.toFixed(2)}`);

const blockWorld = poseWorld(clips.get('block'), 0.2);
check('block brings both hands up in front',
  blockWorld.leftFore.z - blockWorld.torso.z > 0.1 && blockWorld.rightFore.z - blockWorld.torso.z > 0.1
  && blockWorld.leftFore.y > 1.0 && blockWorld.rightFore.y > 1.0,
  `hands y/z ${blockWorld.leftFore.y.toFixed(2)}/${blockWorld.leftFore.z.toFixed(2)}`);

const downWorld = poseWorld(clips.get('knockdown'), clips.get('knockdown').duration * 0.9);
check('knockdown puts the fighter on the floor', downWorld.head.y < 1.05, `head y ${downWorld.head.y.toFixed(2)}`);

// -------------------------------------------------------------- 5. state machine
const fighter = makeFighter();
const controller = new AnimationController(model, fighter, { isCombat: () => true });
check('controller binds the rig', controller.ready);

// Idle
step(controller, 20);
check('idle state -> fighting_idle', controller.describe().active === 'fighting_idle', controller.describe().active);

// Walk -> Run -> Sprint by speed
fighter.velocity.set(3, 0, 0);
step(controller, 8);
check('walk state by speed', controller.describe().active === 'walk', controller.describe().active);
fighter.velocity.set(8, 0, 0);
step(controller, 20);
check('run state by speed', controller.describe().active === 'run', controller.describe().active);
fighter.velocity.set(14, 0, 0);
step(controller, 20);
check('sprint state by speed', controller.describe().active === 'sprint', controller.describe().active);

// Attack mirrors gameplay and restarts per attack object
fighter.velocity.set(0, 0, 0);
step(controller, 20);
const jabAttack = { kind: 'melee', total: 0.34, t: 0, start: 0.065, end: 0.19, damage: 9 };
fighter.attackQueue.push(jabAttack);
step(controller, 3);
check('attack plays the jab clip', controller.describe().active === 'jab', controller.describe().active);
const playedAttackClip = controller._action?.getClip();
check('attack clip is retimed to the attack duration',
  Math.abs((playedAttackClip?.duration ?? 0) - 0.34) < 1e-6, String(playedAttackClip?.duration));
step(controller, 30, 1 / 60, () => { jabAttack.t += 1 / 60; });
fighter.attackQueue.length = 0;
step(controller, 30);
check('attack releases back to stance', ['fighting_idle', 'stop'].includes(controller.describe().active),
  controller.describe().active);

// Guard
fighter.guardHeld = true;
step(controller, 10);
check('guard plays block', controller.describe().active === 'block', controller.describe().active);
fighter.guardHeld = false;

// Dodge
fighter.velocity.set(9, 0, 0);
fighter.dodgeTimer = 0.4;
step(controller, 3);
check('dodge plays a dodge clip', /^dodge_/.test(controller.describe().active || ''), controller.describe().active);
step(controller, 40, 1 / 60, () => { fighter.dodgeTimer = Math.max(0, fighter.dodgeTimer - 1 / 60); });

// Hits escalate and then recover
fighter.velocity.set(0, 0, 0);
fighter.hitstun = 0.2;
step(controller, 2);
check('light hit reaction', controller.describe().active === 'hit_light', controller.describe().active);
fighter.hitstun = 0.4;
step(controller, 2);
check('heavy hit reaction at 0.4s stun', controller.describe().active === 'hit_heavy', controller.describe().active);
step(controller, 40, 1 / 60, () => { fighter.hitstun = Math.max(0, fighter.hitstun - 1 / 60); });

fighter.hitstun = 0.7;
step(controller, 3);
check('long stun knocks down', controller.describe().active === 'knockdown', controller.describe().active);
step(controller, 45, 1 / 60, () => { fighter.hitstun = Math.max(0, fighter.hitstun - 1 / 60); });
fighter.hitstun = 0;
step(controller, 2);
check('knockdown is followed by get up', controller.describe().active === 'get_up', controller.describe().active);
step(controller, 60);
check('get up returns to stance', controller.describe().active === 'fighting_idle', controller.describe().active);

// Air
fighter.isGrounded = false;
fighter.velocity.set(2, 6, 0);
step(controller, 2);
check('takeoff plays jump', controller.describe().active === 'jump', controller.describe().active);
step(controller, 40, 1 / 60);
check('apex falls back to fall', ['fall', 'jump'].includes(controller.describe().active), controller.describe().active);

// Flight
fighter.flightMode = true;
fighter.isGrounded = false;
fighter.velocity.set(6, 1, 0);
step(controller, 4);
check('flight start clip', ['fly_start', 'fly_loop'].includes(controller.describe().active), controller.describe().active);
step(controller, 40);
check('flight settles into a loop', controller.describe().active === 'fly_loop', controller.describe().active);
fighter.velocity.set(18, 4, 0);
step(controller, 4);
check('boost clip when fast and climbing', controller.describe().active === 'fly_boost', controller.describe().active);

fighter.flightMode = false;
fighter.velocity.set(2, 0, 0);
step(controller, 2);
check('leaving flight plays fly_land', controller.describe().active === 'fly_land', controller.describe().active);

// Landing
fighter.velocity.set(1, -6, 0);
fighter.isGrounded = true;
controller._lock = null;
step(controller, 2);
check('descent plays land', controller.describe().active === 'land', controller.describe().active);

// Signature move
controller._lock = null;
fighter.velocity.set(0, 0, 0);
fighter.specialCooldown = 0;
step(controller, 30);
fighter.specialCooldown = 0.9;
step(controller, 2);
check('signature move plays special_attack', controller.describe().active === 'special_attack',
  controller.describe().active);

// Suspension restores the bind pose
const before = joints.leftArm.quaternion.toArray();
controller.suspend();
const after = joints.leftArm.quaternion.toArray();
check('suspend restores the bind pose', quatAngle(before, after) >= 0 && after.every(Number.isFinite));
check('suspended controller stops updating', controller.describe().enabled === false);
controller.resume();
step(controller, 5);
check('resume restarts a clip', Boolean(controller.describe().active));

// ------------------------------------------------------------ 6. retargeting
try {
  const { retargetClip } = await import('../public/js/anim/animation_loader.js');
  check('classifyBone reads Mixamo names', classifyBone('mixamorig:LeftUpLeg') === 'leftLeg',
    classifyBone('mixamorig:LeftUpLeg'));
  check('classifyBone reads Mixamo shins', classifyBone('mixamorig:LeftLeg') === 'leftShin',
    classifyBone('mixamorig:LeftLeg'));
  check('classifyBone reads Blender suffixes', classifyBone('upper_arm.L') === 'leftArm',
    classifyBone('upper_arm.L'));

  const quat = (x, y, z, w) => [x, y, z, w];
  const source = new THREE.AnimationClip('Walk In Place', 1, [
    new THREE.QuaternionKeyframeTrack('mixamorig:LeftArm.quaternion', [0, 1], quat(0, 0, 0, 1).concat(quat(0.2, 0, 0, 1))),
    new THREE.QuaternionKeyframeTrack('mixamorig:RightUpLeg.quaternion', [0, 1], quat(0, 0, 0, 1).concat(quat(0.4, 0, 0, 1))),
    new THREE.QuaternionKeyframeTrack('mixamorig:Hips.position', [0, 1], [0, 0, 0, 0, 0, 2]),
    new THREE.QuaternionKeyframeTrack('someProps.quaternion', [0, 1], quat(0, 0, 0, 1).concat(quat(0, 0.3, 0, 1)))
  ]);
  const retargeted = retargetClip(source, { name: 'walk' });
  check('retarget keeps quaternion tracks only', retargeted.tracks.every(t => t.name.endsWith('.quaternion')));
  check('retarget strips root motion', !retargeted.tracks.some(t => /Hips\.position/.test(t.name)));
  check('retarget maps arm + leg', retargeted.tracks.some(t => t.name === 'bs_leftArm.quaternion')
    && retargeted.tracks.some(t => t.name === 'bs_rightLeg.quaternion'), retargeted.tracks.map(t => t.name).join(','));
  check('retarget drops unmatched nodes', !retargeted.tracks.some(t => /someProps/.test(t.name)));
  notes.push(`retarget: ${retargeted.userData.matchedBones.join(', ')} (${retargeted.userData.droppedTracks} dropped)`);
} catch (error) {
  notes.push(`retarget checks skipped: ${error.message}`);
}

// ------------------------------------------- 7. imported character rigs
// An uploaded Goku/Iron Man skeleton arrives with a mixer and no baked clips. That rig used to
// be handed back to the legacy 4-joint overlay; it must instead receive the authored library.
function makeMixamoRig() {
  const model = new THREE.Group();
  model.name = 'imported character';
  const bone = (parent, name, y) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.y = y;
    parent.add(b);
    return b;
  };
  const hips = bone(model, 'mixamorig:Hips', 1.0);
  const spine = bone(hips, 'mixamorig:Spine', 0.16);
  const spine2 = bone(spine, 'mixamorig:Spine2', 0.16);
  const neck = bone(spine2, 'mixamorig:Neck', 0.16);
  bone(neck, 'mixamorig:Head', 0.1);
  for (const [side, sign] of [['Left', 1], ['Right', -1]]) {
    const shoulder = bone(spine2, `mixamorig:${side}Shoulder`, 0.1);
    shoulder.position.x = sign * 0.12;
    const arm = bone(shoulder, `mixamorig:${side}Arm`, 0);
    arm.position.x = sign * 0.09;
    const fore = bone(arm, `mixamorig:${side}ForeArm`, -0.26);
    bone(fore, `mixamorig:${side}Hand`, -0.24);
    const upLeg = bone(hips, `mixamorig:${side}UpLeg`, -0.06);
    upLeg.position.x = sign * 0.11;
    const leg = bone(upLeg, `mixamorig:${side}Leg`, -0.4);
    bone(leg, `mixamorig:${side}Foot`, -0.38);
  }
  return model;
}
{
  const imported = makeMixamoRig();
  // Exactly what human_fighter.js sets on a loaded character asset with no clips of its own.
  imported.userData.humanMixer = new THREE.AnimationMixer(imported);
  imported.userData.hasAnimationClips = false;
  const controller = attachAnimation(imported, { identityKey: 'goku' });
  check('imported rig without clips is driven by the clip library', Boolean(controller));
  if (controller) {
    // Advance a few frames so the state machine selects and starts a clip.
    for (let i = 0; i < 6; i++) controller.update(1 / 60);
    const state = controller.describe();
    check('imported rig binds most canonical bones', state.boundBones >= CANONICAL_BONES.length - 2,
      `${state.boundBones}/${CANONICAL_BONES.length}`);
    check('imported rig plays a real clip', typeof state.active === 'string' && state.clips > 0,
      String(state.active));
    notes.push(`imported skeleton: ${state.boundBones}/${CANONICAL_BONES.length} bones bound (${state.rig}), playing ${state.active}`);
  }
  const withClips = makeMixamoRig();
  withClips.userData.humanMixer = new THREE.AnimationMixer(withClips);
  withClips.userData.hasAnimationClips = true;
  check('rig with its own baked clips keeps the named-action mixer', attachAnimation(withClips, { identityKey: 'iron_man' }) === null);
}

// --------------------------------------------------------------- 7. manifest
const manifest = JSON.parse(await readFile(path.join(rootDir, 'public/data/animation-manifest.json'), 'utf8'));
const manifestIds = new Set((manifest.clips || []).map(c => c.id));
for (const id of REQUIRED_CLIPS) check(`manifest lists ${id}`, manifestIds.has(id));
for (const id of Object.keys(CLIP_SPECS)) check(`manifest has no orphan clip ${id}`, manifestIds.has(id));
const packIds = new Set();
for (const pack of manifest.packs || []) {
  check(`pack ${pack.id} has a unique id`, !packIds.has(pack.id));
  packIds.add(pack.id);
  check(`pack ${pack.id} has a source url`, typeof pack.source === 'string' && pack.source.startsWith('http'));
  check(`pack ${pack.id} declares a licence note`, typeof pack.license === 'string' && pack.license.length > 10);
  for (const clipId of Object.keys(pack.clips || {})) {
    check(`pack ${pack.id} maps a real clip: ${clipId}`, Boolean(CLIP_SPECS[clipId]));
  }
  check(`pack ${pack.id} is not falsely marked loaded`, pack.status !== 'loaded' || pack.enabled === true);
}

// ------------------------------------------------------------------ report
const lines = [
  '',
  'ANIMATION LIBRARY',
  `  clips            ${clips.size}`,
  `  tracks           ${trackCount}`,
  `  keyframes        ${keyframeCount}`,
  `  rig bound        ${rig.boundCount}/${CANONICAL_BONES.length} bones (${rig.kind})`,
  `  manifest clips   ${manifestIds.size}`,
  `  asset packs      ${(manifest.packs || []).length} declared, ${(manifest.packs || []).filter(p => p.enabled).length} installed`,
  ''
];
for (const note of notes) lines.push('  · ' + note);
if (failures.length) {
  lines.push('', `FAILED ${failures.length} check(s):`);
  for (const failure of failures) lines.push('  ✗ ' + failure);
  console.log(lines.join('\n'));
  process.exit(1);
}
lines.push('', `PASS — all animation checks passed (${clips.size} clips, ${REQUIRED_CLIPS.length} required ids)`);
console.log(lines.join('\n'));
