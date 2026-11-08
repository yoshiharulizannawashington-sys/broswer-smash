// Development-only simulated fighter.
//
// Phase 28.4.12: prove a candidate body works with Browser Bros' real fighter controller without
// registering it in the roster or touching Link. This module is never imported by the game; a test
// script loads it explicitly.
//
// It reuses the production path end to end:
//   · Fighter3D            — the real simulation (locomotion, jump, guard, dodge, attacks, hitstun)
//   · upgradeFighterModel  — the real mount: placement, rig gate, joint binding, mixer, materials
//   · animateHumanFighter  — the real per-frame rig driver and clip state machine
// Nothing here re-implements controller logic; it only owns creation, input injection and teardown.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import Fighter3D from '../fighter3D.js';
import { upgradeFighterModel, animateHumanFighter } from '../human_fighter.js';
import { syncEquippedWeapons } from '../models.js';

const NEUTRAL = Object.freeze({
  left: false, right: false, up: false, down: false, run: false, sprint: false,
  jump: false, ascend: false, descend: false, dodge: false, attack: false, special: false,
  shield: false, parry: false, flightToggle: false, transform: false, ultimate: false
});

const boneSample = root => {
  const bones = [];
  root?.traverse?.(node => { if (node.isBone && bones.length < 24) bones.push(node); });
  return { bones, values: bones.map(bone => bone.quaternion.toArray()) };
};

const motionBetween = (before, after) => {
  if (!before.bones.length) return 0;
  let total = 0;
  for (let index = 0; index < before.bones.length; index++) {
    const a = before.values[index];
    const b = after.values[index];
    for (let axis = 0; axis < 4; axis++) total += Math.abs(a[axis] - b[axis]);
  }
  return +total.toFixed(3);
};

// Equipped weapons are not part of the body: a sword swinging past the boots reads as the fighter
// standing 3 cm under the floor. rig_validation excludes them the same way.
const isEquipped = node => {
  for (let current = node; current; current = current.parent) {
    if (String(current.name || '').startsWith('Equipped')) return true;
  }
  return false;
};
const meshMetrics = root => {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.traverse(node => {
    if (!node.isMesh || isEquipped(node)) return;
    node.updateMatrixWorld(true);
    const piece = new THREE.Box3().setFromObject(node);
    if (!piece.isEmpty()) box.union(piece);
  });
  const size = box.getSize(new THREE.Vector3());
  return {
    height: +size.y.toFixed(3),
    feetY: +box.min.y.toFixed(3),
    width: +size.x.toFixed(3)
  };
};

let sim = null;

async function create({ url, name = 'Knight Sim', archetype = 'warrior', position = [0, 0, 0], yawOffset = 0 } = {}) {
  if (sim) await dispose();
  const scene = window.__browserSmashScene;
  const THREEref = window.__browserSmashThree || THREE;

  // The placeholder is the body the mount replaces; it exists so the fighter is a normal scene
  // object with a parent, exactly like the roster fighters when their GLB streams in.
  const placeholder = new THREEref.Group();
  placeholder.name = 'sim-placeholder';
  placeholder.position.set(...position);
  scene.add(placeholder);

  const fighter = new Fighter3D({ name, model: placeholder, weight: 88, player: false });
  fighter.archetype = archetype;
  fighter.identity = name;
  fighter.identityKey = 'knight_sim';
  fighter.combatProfile = { damage: 1, knockback: 1, weight: 1, launch: 1 };
  fighter.specialProfile = { label: 'SIMULATION', type: 'orb', color: 0x6fe0ff, damage: 0, speed: 1, cooldown: 1, stun: 0, knockback: 0 };
  fighter.canFly = false;
  fighter.canWebSwing = false;
  sim = { fighter, placeholder, disposed: false, steps: 0 };

  const gltf = await new Promise((ok, bad) => new GLTFLoader().load(url, ok, undefined, bad));
  const mounted = await upgradeFighterModel(fighter, archetype, { gltf, url, format: 'gltf', yawOffset });
  const model = fighter.model;
  const data = model?.userData || {};
  const actions = data.animationActions ? Object.keys(data.animationActions) : [];
  sim.mounted = mounted;
  sim.url = url;
  sim.metrics = mounted ? meshMetrics(model) : null;
  return {
    mounted,
    metrics: sim.metrics,
    actorScale: model ? model.scale.toArray().map(value => +value.toFixed(4)) : null,
    rigScale: model?.getObjectByName?.('Rig')?.scale?.x ?? null,
    bones: data.proceduralJoints ? Object.keys(data.proceduralJoints) : [],
    actions,
    clipCount: (gltf.animations || []).length,
    hasMixer: Boolean(data.humanMixer),
    controller: Boolean(data.animationController),
    validation: window.__browserSmashAssets?.characterModels?.knight_sim?.validation || null,
    placement: data.placement || null,
    materials: (() => {
      const names = new Set();
      model?.traverse?.(node => { if (node.isMesh) for (const material of [].concat(node.material || [])) if (material) names.add(material.name || material.uuid); });
      return [...names];
    })()
  };
}

/** Advance the real controller by one fixed step with the given held inputs. */
function step(inputs = {}, dt = 1 / 60) {
  if (!sim || sim.disposed) return null;
  const fighter = sim.fighter;
  const before = boneSample(fighter.model);
  const held = { ...NEUTRAL, ...inputs };
  const stateBefore = fighter.state;
  // Fighter3D reads a handler (`getInputs()`), not a plain object; the spread also serves any
  // direct property reads so the same handler works for both access styles.
  const handler = { ...held, getInputs: () => held, update: () => {} };
  fighter.simulate(dt, handler);
  animateHumanFighter(fighter, dt);
  // The game loop runs this for every match fighter each step; a dev fighter is not in
  // window.fighters, so the harness has to do it or the mounted weapon stays where it was equipped.
  syncEquippedWeapons(fighter.model);
  fighter.model.updateMatrixWorld(true);
  const after = boneSample(fighter.model);
  sim.steps++;
  const data = fighter.model.userData || {};
  const actions = data.animationActions || {};
  let active = null;
  for (const [name, action] of Object.entries(actions)) {
    if (action?.isRunning?.()) { active = name; break; }
  }
  const box = meshMetrics(fighter.model);
  return {
    stateBefore,
    state: fighter.state,
    activeClip: active,
    boneDelta: motionBetween(before, after),
    height: box.height,
    feetY: box.feetY,
    position: fighter.position.toArray().map(value => +value.toFixed(2)),
    grounded: fighter.isGrounded,
    hitstun: +Number(fighter.hitstun || 0).toFixed(3),
    attackActive: Boolean(fighter.activeMoveId) || (fighter.attackQueue || []).length > 0,
    attackPhase: fighter.activeMoveId || null,
    speed: +Math.hypot(fighter.velocity.x, fighter.velocity.z).toFixed(2),
    shield: +Number(fighter.shield || 0).toFixed(1),
    dodgeTimer: +Number(fighter.dodgeTimer || 0).toFixed(3)
  };
}

/** Run a scripted state for `seconds`, returning the samples and a couple of aggregates. */
function run(inputs = {}, seconds = 0.4) {
  const frames = Math.max(1, Math.round(seconds * 60));
  const samples = [];
  for (let index = 0; index < frames; index++) samples.push(step(inputs, 1 / 60));
  const clips = [...new Set(samples.map(sample => sample?.activeClip).filter(Boolean))];
  return {
    frames,
    clips,
    end: samples[samples.length - 1],
    maxBoneDelta: Math.max(0, ...samples.map(sample => sample?.boneDelta ?? 0)),
    minFeetY: Math.min(...samples.map(sample => sample?.feetY ?? 0)),
    maxFeetY: Math.max(...samples.map(sample => sample?.feetY ?? 0)),
    states: [...new Set(samples.map(sample => sample?.state).filter(Boolean))],
    maxSpeed: Math.max(0, ...samples.map(sample => sample?.speed ?? 0)),
    attackFrames: samples.filter(sample => sample?.attackActive).length
  };
}

/** Apply damage the way the combat system does, so the reaction path runs for real. */
function hit({ stun = 0.45, velocity = [6, 2, 0] } = {}) {
  if (!sim) return null;
  sim.fighter.hitstun = stun;
  sim.fighter.velocity.set(...velocity);
  sim.fighter.isGrounded = false;
  return run({}, 0.05).end;
}

function metrics() {
  return sim?.metrics || null;
}

function fighterModel() {
  return sim?.fighter?.model || null;
}

async function dispose() {
  if (!sim) return { disposed: false, reason: 'nothing to dispose' };
  if (sim.opponent) await dropOpponent();
  if (sim.joined && Array.isArray(window.fighters)) {
    const index = window.fighters.indexOf(sim.fighter);
    if (index >= 0) window.fighters.splice(index, 1);
  }
  const { fighter, placeholder } = sim;
  const scene = window.__browserSmashScene;
  const model = fighter.model;
  const controller = model?.userData?.animationController;
  controller?.dispose?.();
  model?.userData?.humanMixer?.stopAllAction?.();
  let geometries = 0; let materials = 0;
  const seenGeo = new Set(); const seenMat = new Set();
  model?.traverse?.(node => {
    if (node.geometry && !seenGeo.has(node.geometry)) { seenGeo.add(node.geometry); node.geometry.dispose?.(); geometries++; }
    for (const material of [].concat(node.material || [])) {
      if (!material || seenMat.has(material)) continue;
      seenMat.add(material); material.dispose?.(); materials++;
    }
  });
  if (model?.parent) model.parent.remove(model);
  else scene.remove(model);
  if (placeholder?.parent) placeholder.parent.remove(placeholder);
  sim.disposed = true;
  sim = null;
  return { disposed: true, geometries, materials, textures: seenMat.size };
}

/** Spawn a second disposable fighter through the same production mount path. */
async function spawnOpponent({ url, name = 'Sim Opponent', archetype = 'warrior', position = [0, 0, 1.2], yawOffset = 0, joinMatch = true } = {}) {
  if (!sim) return null;
  if (sim.opponent) await dropOpponent();
  const scene = window.__browserSmashScene;
  const THREEref = window.__browserSmashThree || THREE;
  const placeholder = new THREEref.Group();
  placeholder.name = 'sim-opponent-placeholder';
  placeholder.position.set(...position);
  scene.add(placeholder);
  const fighter = new Fighter3D({ name, model: placeholder, weight: 88, player: false });
  fighter.archetype = archetype;
  fighter.identity = name;
  fighter.identityKey = 'knight_sim_opponent';
  fighter.combatProfile = { damage: 1, knockback: 1, weight: 1, launch: 1 };
  fighter.specialProfile = { label: 'SIMULATION', type: 'orb', color: 0x6fe0ff, damage: 0, speed: 1, cooldown: 1, stun: 0, knockback: 0 };
  fighter.canFly = false;
  fighter.canWebSwing = false;
  const gltf = await new Promise((ok, bad) => new GLTFLoader().load(url, ok, undefined, bad));
  await upgradeFighterModel(fighter, archetype, { gltf, url, format: 'gltf', yawOffset });
  sim.opponent = { fighter, placeholder, joined: false };
  if (joinMatch && Array.isArray(window.fighters)) {
    window.fighters.push(fighter);
    sim.opponent.joined = true;
  }
  return { mounted: true, metrics: meshMetrics(fighter.model), actions: Object.keys(fighter.model?.userData?.animationActions || {}) };
}

/** Advance the opponent through the real controller with its own inputs. */
function stepOpponent(inputs = {}, dt = 1 / 60) {
  const entry = sim?.opponent;
  if (!entry) return null;
  const held = { ...NEUTRAL, ...inputs };
  entry.fighter.simulate(dt, { ...held, getInputs: () => held, update: () => {} });
  animateHumanFighter(entry.fighter, dt);
  syncEquippedWeapons(entry.fighter.model);
  entry.fighter.model.updateMatrixWorld(true);
  const box = meshMetrics(entry.fighter.model);
  return {
    state: entry.fighter.state,
    feetY: box.feetY,
    grounded: entry.fighter.isGrounded,
    grabbedBy: Boolean(entry.fighter.grabbedBy),
    hitstun: +Number(entry.fighter.hitstun || 0).toFixed(3),
    percent: +Number(entry.fighter.percent || 0).toFixed(1),
    velocity: entry.fighter.velocity.toArray().map(value => +value.toFixed(2)),
    lastThrow: entry.fighter.lastThrow ? { aim: entry.fighter.lastThrow.aim, damage: entry.fighter.lastThrow.damage } : null,
    position: entry.fighter.position.toArray().map(value => +value.toFixed(2))
  };
}

async function dropOpponent() {
  const entry = sim?.opponent;
  if (!entry) return null;
  entry.fighter.model?.userData?.animationController?.dispose?.();
  entry.fighter.model?.userData?.humanMixer?.stopAllAction?.();
  if (entry.joined && Array.isArray(window.fighters)) {
    const index = window.fighters.indexOf(entry.fighter);
    if (index >= 0) window.fighters.splice(index, 1);
  }
  entry.fighter.model?.parent?.remove(entry.fighter.model);
  entry.placeholder?.parent?.remove(entry.placeholder);
  sim.opponent = null;
  return { removed: true };
}

function opponentFighter() {
  return sim?.opponent?.fighter || null;
}

window.__browserSmashSim = { create, step, run, hit, metrics, fighterModel, dispose, neutral: NEUTRAL,
  spawnOpponent, stepOpponent, dropOpponent, opponent: opponentFighter,
  joinMatch: () => { if (sim && Array.isArray(window.fighters) && !window.fighters.includes(sim.fighter)) { window.fighters.push(sim.fighter); sim.joined = true; return true; } return false; },
  // Read-only escapes for the probe: the live fighter object and a bounds switch. Used to give the
  // sprint phase room to reach the run clip threshold; never touches match state or saves.
  fighter: () => sim?.fighter || null,
  setBounds: roam => { if (sim) sim.fighter.roamMode = Boolean(roam); } };
