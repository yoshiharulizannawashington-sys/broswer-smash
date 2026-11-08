// Transformations / overdrives: a timed combat mode with its own resource.
//
// A form is not a recolor. Entering one spends `power`, changes real numbers the simulation
// reads (speed, damage, knockback, incoming damage, attack windup, jump) and swaps the
// fighter's signature move for a second, stronger move. Leaving one puts every number back and
// rebuilds the base move, so nothing can leak into the next round.
//
// Power is earned in combat only — there is no passive regeneration — which is what stops a
// transformation from being a free state you simply wait for.

import * as THREE from 'three';
import { ultimateFor } from './movesets.js';
import { applyFormCostume, clearFormCostume, updateFormCostume } from '../anim/form_costume.js';
import { applyFormPresentation, clearFormPresentation, updateFormPresentation } from '../anim/form_presentation.js';

// Power is earned in combat only. The flat gain per damage event follows the ultimate meter's
// design so a transformation arrives on roughly the same number of clean hits as an ultimate,
// instead of first requiring a long, unanswered combo.
export const POWER = Object.freeze({
  max: 100,
  gainDealtBase: 1.4,
  dealtPerDamage: .78,
  gainTakenBase: .8,
  takenPerDamage: .46,
  guardedBonus: 1
});
// `charge` is the power-up wind-up before a form lands; `activationLock` is the total commitment
// (gather plus a short settle) during which the fighter cannot steer or start a new attack.
export const FORM = Object.freeze({ charge: .45, activationLock: .62, fatigue: .6 });

/** Neutral multipliers, used whenever a fighter is not transformed. */
export const NEUTRAL_MODS = Object.freeze({ speed: 1, damage: 1, kbs: 1, defense: 1, startup: 1, jump: 1 });

/** Power earned from one damage event, in either direction. */
export function powerFromDamage(damage, { taken = false, guarded = false } = {}) {
  const amount = Math.max(0, Number(damage) || 0);
  const base = taken
    ? POWER.gainTakenBase + amount * POWER.takenPerDamage
    : POWER.gainDealtBase + amount * POWER.dealtPerDamage;
  return base + (guarded ? POWER.guardedBonus : 0);
}

/** Add power, clamped, and return the new value. */
export function gainPower(fighter, amount) {
  if (!fighter) return 0;
  fighter.power = Math.max(0, Math.min(POWER.max, (fighter.power || 0) + (Number(amount) || 0)));
  return fighter.power;
}

/**
 * Every form the fighter can enter, in progression order. A single-form fighter is a one-item list,
 * so the runtime has exactly one code path.
 */
export function formSequence(fighter) {
  const set = fighter?.moveset;
  if (Array.isArray(set?.forms) && set.forms.length) return set.forms;
  return set?.form ? [set.form] : [];
}

/** The form the next activation would enter. */
export function nextFormFor(fighter) {
  const sequence = formSequence(fighter);
  if (!sequence.length) return null;
  const stage = Math.max(0, Math.floor(fighter?.formStage || 0));
  return sequence[stage % sequence.length];
}

/** The mods in force right now. */
export function transformMods(fighter) {
  return fighter?.transform?.form?.mods || NEUTRAL_MODS;
}

/**
 * Whether the form can be entered. Returns `{ ok, reason }` so the HUD and the callout can say
 * exactly why it refused instead of silently doing nothing.
 */
export function canTransform(fighter) {
  const form = nextFormFor(fighter);
  if (!fighter) return { ok: false, reason: 'missing' };
  if (!form) return { ok: false, reason: 'unavailable' };
  if (fighter.ko) return { ok: false, reason: 'ko' };
  if (fighter.transform) return { ok: false, reason: 'active' };
  if ((fighter.transformCooldown || 0) > 0) return { ok: false, reason: 'cooldown' };
  if ((fighter.power || 0) < form.cost) return { ok: false, reason: 'not-ready' };
  if (fighter.grabbedBy || (fighter.hitstun || 0) > 0 || (fighter.guardBreak || 0) > 0) {
    return { ok: false, reason: 'locked' };
  }
  return { ok: true, reason: 'ready' };
}

/** Display strings for a refused activation. */
export const REFUSAL = Object.freeze({
  'not-ready': 'FORM NOT READY',
  cooldown: 'FORM RECHARGING',
  active: 'FORM ACTIVE',
  locked: 'CANNOT TRANSFORM NOW',
  ko: 'CANNOT TRANSFORM NOW',
  unavailable: 'NO FORM AVAILABLE',
  missing: 'NO FORM AVAILABLE'
});

/**
 * Enter the form. Spends power once, applies the mods, swaps the signature move and attaches
 * the aura. Returns `{ ok, reason }`.
 */
export function beginTransform(fighter) {
  const check = canTransform(fighter);
  if (!check.ok) return check;
  // Progression, not a single toggle: each activation enters the next form in the sequence and
  // cycles back to the first after the last one.
  const form = nextFormFor(fighter);
  fighter.power = Math.max(0, (fighter.power || 0) - form.cost);
  fighter.transform = {
    id: form.id,
    label: form.label,
    form,
    time: form.duration,
    elapsed: 0,
    drain: form.drain || 0,
    // The body does not change on the frame the key is pressed. `charge` is the power-up
    // wind-up: the fighter plants, the aura gathers, and the new surfaces arrive at the burst.
    charge: FORM.charge,
    landed: false
  };
  fighter.formLock = FORM.activationLock;
  // Publish the form's ultimate for the whole duration of the form, not only when it ends.
  fighter.ultimateDef = ultimateFor(fighter);
  // Real stat changes, read by the simulation and by the hit resolver.
  fighter.incomingDamage = form.mods.defense ?? 1;
  fighter.transformMods = form.mods;
  if (!fighter.baseSpecialProfile) fighter.baseSpecialProfile = fighter.specialProfile || null;
  if (form.special && fighter.baseSpecialProfile) {
    fighter.specialProfile = { ...fighter.baseSpecialProfile, ...form.special };
  }
  fighter.attackQueue.length = 0;
  fighter.attackBuffer = 0;
  // The aura is attached immediately but starts tight; `updateAura` swells it during the gather.
  createAura(fighter, form);
  // Camera weight during the gather, not only after it: the form gets its own beat instead of
  // appearing mid-punch with no wind-up. The burst is applied by `landForm` when the charge ends.
  globalThis.window?.smashCamera?.focus?.(fighter, { seconds: FORM.charge + .35, zoom: .2, bias: .3 });
  return { ok: true, reason: 'charging' };
}

/**
 * The burst: the gathered power lands, the body's own surfaces and the form costume change, and
 * the form announces itself. Kept separate from `beginTransform` so a KO or round end during the
 * charge can cancel a form that has not landed yet.
 */
function landForm(fighter, active) {
  if (!active || active.landed) return false;
  const form = active.form;
  active.landed = true;
  active.charge = 0;
  applyFormPresentation(fighter, form);
  applyFormCostume(fighter, form);
  // `window` is absent when the rules module is unit-tested in node.
  globalThis.window?.showCombatCallout?.(form.label, hexCss(form.color));
  // A transformation is a presentation event: aura burst, camera weight and a spoken line.
  globalThis.window?.__browserSmashPresent?.('form', { owner: fighter, label: form.label, color: form.color });
  globalThis.window?.spawnImpact?.(fighter.position.clone().add(new THREE.Vector3(0, 1.1, 0)), 16, form.color);
  // A transformation is a punctuation mark in the fight: give it the same camera weight as a
  // heavy connect so the opponent notices the state change, without a full-screen effect.
  globalThis.window?.smashCamera?.impact?.(.34);
  globalThis.window?.combatAudio?.play?.('form');
  return true;
}

/** Leave the form, restoring every number and the base move. */
export function endTransform(fighter, reason = 'expired') {
  if (!fighter?.transform) return false;
  const form = fighter.transform.form;
  // A charge cancelled by the round bell was never reached, so it must not advance the ladder.
  const landed = fighter.transform.landed;
  fighter.transform = null;
  fighter.incomingDamage = 1;
  fighter.transformMods = null;
  fighter.formLock = 0;
  // The ultimate is attached once at match start, so a form that changes its behaviour (a beam, a
  // slam, a rush) has to republish it here or the runner keeps using the base ultimate.
  fighter.ultimateDef = ultimateFor(fighter);
  fighter.transformCooldown = (form.cooldown || 8) + FORM.fatigue;
  // Advance the progression only when the form actually ended, so an interrupted or drained form
  // still counts as the tier you reached - but a gather that never landed does not.
  if (landed) fighter.formStage = (fighter.formStage || 0) + 1;
  if (fighter.baseSpecialProfile) fighter.specialProfile = fighter.baseSpecialProfile;
  disposeAura(fighter);
  clearFormPresentation(fighter, reason);
  clearFormCostume(fighter);
  const label = reason === 'drained' ? `${form.label} · DRAINED`
    : reason === 'ko' || reason === 'round' ? `${form.label} ENDED`
      : `${form.label} FADED`;
  globalThis.window?.showCombatCallout?.(label, hexCss(form.color));
  globalThis.window?.combatAudio?.play?.('formEnd');
  return true;
}

/** Advance one fighter's form. Called from Fighter3D.simulate. */
export function tickTransform(fighter, dt) {
  fighter.transformCooldown = Math.max(0, (fighter.transformCooldown || 0) - dt);
  fighter.formLock = Math.max(0, (fighter.formLock || 0) - dt);
  updateFormPresentation(fighter, dt);
  const active = fighter.transform;
  if (!active) return;
  let step = dt;
  if (!active.landed) {
    // Power up first: the duration and the drain only start when the burst lands, so the player
    // pays the activation lock but not part of a form they never got to use.
    const spent = Math.min(active.charge || 0, step);
    active.charge = Math.max(0, (active.charge || 0) - step);
    step = Math.max(0, step - spent);
    if (active.charge > 0) return;
    landForm(fighter, active);
  }
  if (step <= 0) return;
  active.elapsed += step;
  active.time -= step;
  if (active.drain > 0) {
    fighter.power = Math.max(0, (fighter.power || 0) - active.drain * step);
    if (fighter.power <= 0) { endTransform(fighter, 'drained'); return; }
  }
  if (active.time <= 0) endTransform(fighter, 'expired');
}

/** HUD-ready snapshot of the form and its resource. */
export function transformState(fighter) {
  const active = fighter?.transform || null;
  // The HUD has to describe the form the next press actually enters. With a ladder the base
  // entry's price is not the price of the second or third tier: this used to report Super
  // Saiyan's 40 power for Super Saiyan Blue (52) and print bars like "117%".
  const form = active?.form || nextFormFor(fighter) || fighter?.moveset?.form || null;
  const mods = active?.form?.mods || NEUTRAL_MODS;
  return {
    hasForm: formSequence(fighter).length > 0,
    label: active?.label || form?.label || '',
    active: !!active,
    charging: !!active && !active.landed,
    landed: !!active && !!active.landed,
    charge: active ? Math.max(0, active.charge || 0) : 0,
    chargeTotal: FORM.charge,
    stage: Math.max(0, Math.floor(fighter?.formStage || 0)),
    tiers: formSequence(fighter).length,
    remaining: active ? Math.max(0, active.time) : 0,
    duration: form?.duration || 0,
    ratio: active && form?.duration ? Math.max(0, Math.min(1, active.time / form.duration)) : 0,
    power: Math.round(fighter?.power || 0),
    cost: form?.cost || 0,
    ready: canTransform(fighter).ok,
    reason: canTransform(fighter).reason,
    mods,
    note: form?.note || ''
  };
}

function hexCss(color) {
  return '#' + Number(color || 0xffffff).toString(16).padStart(6, '0');
}

// ---------------------------------------------------------------- aura presentation
// Each form gets its own generated silhouette so a transformation reads as that character's
// power rather than a shared glow. Everything is a handful of unlit additive meshes attached to
// the fighter model; nothing is shadow-casting and nothing is rebuilt per frame.

function auraMaterial(color, opacity = .55) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending
  });
}

function linearMaterial(color, opacity = .8) {
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity });
}

function buildAuraGroup(form) {
  const color = form.color || 0x8fe8ff;
  const group = new THREE.Group();
  group.name = `aura:${form.id}`;
  const add = (mesh, data = {}) => {
    mesh.userData.aura = { spin: 0, bob: 0, ...data };
    group.add(mesh);
    return mesh;
  };
  switch (form.aura) {
    case 'flame': {
      for (let i = 0; i < 7; i++) {
        const flame = new THREE.Mesh(new THREE.ConeGeometry(.16 + i * .014, .85 + (i % 3) * .28, 5, 1, true), auraMaterial(color, .5));
        const angle = (i / 7) * Math.PI * 2;
        flame.position.set(Math.cos(angle) * .42, .7 + (i % 3) * .22, Math.sin(angle) * .42);
        add(flame, { spin: .4 + i * .05, bob: 1.1, base: flame.position.y });
      }
      const core = new THREE.Mesh(new THREE.SphereGeometry(.62, 12, 10), auraMaterial(color, .16));
      core.position.y = 1.0;
      add(core, { pulse: 1.6 });
      break;
    }
    case 'lightning': {
      for (let i = 0; i < 6; i++) {
        const points = [];
        const angle = (i / 6) * Math.PI * 2;
        for (let step = 0; step <= 4; step++) {
          const t = step / 4;
          points.push(new THREE.Vector3(
            Math.cos(angle) * (.5 + t * .22) + (Math.random() - .5) * .18,
            .35 + t * 1.5,
            Math.sin(angle) * (.5 + t * .22) + (Math.random() - .5) * .18
          ));
        }
        add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), linearMaterial(color, .85)), { spin: .9 + i * .1 });
      }
      const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(.66, 0), new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: .3 }));
      shell.position.y = 1.0;
      add(shell, { spin: 1.4 });
      break;
    }
    case 'ring': {
      for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(.62 + i * .1, .022, 6, 30), auraMaterial(color, .7));
        ring.position.y = .55 + i * .42;
        ring.rotation.x = Math.PI / 2 + i * .22;
        add(ring, { spin: (i % 2 ? -1 : 1) * (.8 + i * .4) });
      }
      break;
    }
    case 'construct': {
      const shell = new THREE.Mesh(new THREE.OctahedronGeometry(.85, 0), new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: .42 }));
      shell.position.y = 1.0;
      add(shell, { spin: .7 });
      for (let i = 0; i < 4; i++) {
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(.42, .42), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .3, side: THREE.DoubleSide, depthWrite: false }));
        const angle = (i / 4) * Math.PI * 2;
        plate.position.set(Math.cos(angle) * .72, 1.0, Math.sin(angle) * .72);
        plate.lookAt(new THREE.Vector3(0, 1.0, 0));
        add(plate, { spin: .5 });
      }
      break;
    }
    case 'steam': {
      for (let i = 0; i < 8; i++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(.16 + (i % 3) * .05, 7, 6), auraMaterial(color, .3));
        const angle = (i / 8) * Math.PI * 2;
        puff.position.set(Math.cos(angle) * .38, .5 + (i % 4) * .28, Math.sin(angle) * .38);
        add(puff, { bob: .7 + (i % 3) * .2, base: puff.position.y });
      }
      break;
    }
    case 'wind': {
      for (let i = 0; i < 2; i++) {
        const helix = new THREE.Mesh(new THREE.TorusKnotGeometry(.5, .014, 48, 5, 2, 3), auraMaterial(color, .55));
        helix.position.y = .55 + i * .55;
        helix.rotation.z = i * .6;
        add(helix, { spin: 1.1 + i * .6 });
      }
      break;
    }
    case 'holy': {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(.34, .5, 2.2, 12, 1, true), auraMaterial(color, .18));
      pillar.position.y = 1.1;
      add(pillar, { pulse: .8 });
      const halo = new THREE.Mesh(new THREE.TorusGeometry(.36, .022, 6, 24), auraMaterial(color, .8));
      halo.position.y = 2.05;
      halo.rotation.x = Math.PI / 2;
      add(halo, { spin: 1.2 });
      break;
    }
    case 'shadow': {
      const shroud = new THREE.Mesh(new THREE.SphereGeometry(.82, 12, 10), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .22, side: THREE.BackSide, depthWrite: false }));
      shroud.position.y = 1.0;
      add(shroud, { pulse: .5 });
      for (let i = 0; i < 5; i++) {
        const wisp = new THREE.Mesh(new THREE.TorusGeometry(.6 + i * .06, .012, 5, 26), auraMaterial(color, .45));
        wisp.position.y = .35 + i * .35;
        wisp.rotation.x = Math.PI / 2 - .18 * i;
        add(wisp, { spin: (i % 2 ? -1 : 1) * .9 });
      }
      break;
    }
    default: {
      const shell = new THREE.Mesh(new THREE.SphereGeometry(.8, 14, 12), auraMaterial(color, .18));
      shell.position.y = 1.0;
      add(shell, { pulse: 1.2 });
    }
  }
  return group;
}

/** Attach a generated aura to the fighter's model. */
export function createAura(fighter, form) {
  disposeAura(fighter);
  if (!fighter?.model) return null;
  const group = buildAuraGroup(form);
  group.userData.formId = form.id;
  // A form whose silhouette is carried by real costume geometry keeps its aura tight, so the
  // generated flames accent the coat and tails instead of hiding them (Naruto's chakra forms).
  if (Number.isFinite(form.auraScale) && form.auraScale > 0) group.scale.setScalar(form.auraScale);
  // Remember the authored size: the aura swells from it during the charge and is restored to it
  // every frame, so the ramp cannot compound on itself.
  group.userData.baseScale = group.scale.x;
  if (fighter.transform && !fighter.transform.landed) group.scale.setScalar(group.scale.x * .16);
  // Remember each material's authored opacity so the end-of-form fade cannot ratchet it down
  // every frame.
  group.traverse(node => {
    if (node.material && node.material.transparent) node.material.userData.baseOpacity = node.material.opacity;
  });
  fighter.model.add(group);
  fighter.aura = group;
  return group;
}

export function disposeAura(fighter) {
  const group = fighter?.aura;
  if (!group) return;
  group.parent?.remove(group);
  group.traverse(node => {
    node.geometry?.dispose?.();
    if (Array.isArray(node.material)) node.material.forEach(m => m.dispose?.());
    else node.material?.dispose?.();
  });
  fighter.aura = null;
}

/** Animate the attached aura. Cheap: no allocations beyond the numbers. */
export function updateAura(fighter) {
  const group = fighter?.aura;
  if (!group) return;
  const t = fighter.t || 0;
  const active = fighter.transform;
  const baseScale = group.userData.baseScale ?? group.scale.x ?? 1;
  const charge = Math.max(0, active?.charge || 0);
  // Gather (aura tight and brightening) then burst (full silhouette). A landed form fades only
  // as its timer runs out.
  const grow = !active ? 0
    : active.landed ? 1
      : .16 + .84 * Math.pow(1 - Math.min(1, charge / FORM.charge), 2);
  const fade = active ? Math.min(1, active.time * 2.2) : 0;
  const strength = grow * fade;
  group.scale.setScalar(baseScale * strength);
  for (const child of group.children) {
    const data = child.userData.aura;
    if (!data) continue;
    if (data.spin) child.rotation.y = t * data.spin;
    if (data.bob) child.position.y = data.base + Math.sin(t * 3 * data.bob) * .08;
    if (data.pulse) {
      const scale = 1 + Math.sin(t * data.pulse * 3) * .06;
      child.scale.setScalar(scale);
    }
  }
  group.visible = strength > .02;
  for (const child of group.children) {
    if (!child.material || !child.material.transparent) continue;
    const base = child.material.userData.baseOpacity;
    if (base != null) child.material.opacity = base * strength;
  }
}
