// Ultimates: the meter, the activation gate, and the seven real attack behaviours.
//
// An ultimate is not a cutscene. Each one runs startup -> active -> recovery on the same fixed
// 1/60 s step as everything else, and lands damage by calling back into the game's hit resolver
// (`ctx.hit`), which is the same resolver that applies guarding, shield cost, invulnerability and
// room cover. A blocked or missed ultimate therefore does what a blocked or missed move does.
//
// The runner owns no fighters and no damage numbers of its own: `ctx` supplies the fighter list,
// the damage callback, wall queries and the camera/VFX hooks, which is what lets the headless
// test drive it against the real game.

import * as THREE from 'three';
import { grabContinuityTuning } from './experiments.js';
import { spawnClones } from './clones.js';

/** Follow-up events of a grab chain require the target within this distance, in metres. */
export const GRAB_GATE = 5.2;

/** Seconds a mark ring takes to fade out once its last damaging event has passed. */
export const MARK_FADE = .15;

export const ULTIMATE = Object.freeze({
  max: 100,
  gainDealtBase: 2,
  gainDealtPerDamage: .9,
  gainTakenBase: 1.2,
  gainTakenPerDamage: .55,
  gainGuard: 1.2,
  // An interrupted ultimate refunds its meter only while nothing has connected yet.
  refundBeforeFirstHit: true
});

/** Meter earned by one damage event. */
export function meterFromDamage(damage, { taken = false, guarded = false } = {}) {
  const amount = Math.max(0, Number(damage) || 0);
  const base = taken
    ? ULTIMATE.gainTakenBase + amount * ULTIMATE.gainTakenPerDamage
    : ULTIMATE.gainDealtBase + amount * ULTIMATE.gainDealtPerDamage;
  return base + (guarded ? ULTIMATE.gainGuard : 0);
}

export function gainMeter(fighter, amount) {
  if (!fighter) return 0;
  fighter.meter = Math.max(0, Math.min(ULTIMATE.max, (fighter.meter || 0) + (Number(amount) || 0)));
  return fighter.meter;
}

const ACTIVE = [];

/** Ultimate definitions default geometry so a character only states what makes it unique. */
const DEFAULTS = Object.freeze({
  beam: { range: 26, width: 2.4, startup: .6, active: .8, recovery: .6 },
  rush: { range: 16, hits: 3, startup: .5, active: 1.2, recovery: .6 },
  slam: { radius: 7, range: 20, startup: .6, active: 1, recovery: .6 },
  storm: { radius: 5, hits: 2, range: 18, gap: .45, startup: .6, active: 1.2, recovery: .6 },
  zone: { radius: 6, ticks: 4, range: 16, startup: .6, active: 1.4, recovery: .6 },
  grab: { range: 12, hits: 3, startup: .5, active: 1.1, recovery: .6 },
  barrage: { range: 22, hits: 3, radius: 2.2, startup: .55, active: 1.1, recovery: .6 }
});

function defOf(owner) {
  const raw = owner?.ultimateDef;
  if (!raw) return null;
  const defaults = DEFAULTS[raw.behaviour];
  if (!defaults) return null;
  return { ...defaults, ...raw };
}

/** True when the fighter may start an ultimate right now. */
export function canUltimate(fighter) {
  if (!fighter) return { ok: false, reason: 'missing' };
  if (!defOf(fighter)) return { ok: false, reason: 'unavailable' };
  if (fighter.ko || fighter.grabbedBy) return { ok: false, reason: 'locked' };
  if ((fighter.hitstun || 0) > 0 || (fighter.guardBreak || 0) > 0) return { ok: false, reason: 'locked' };
  if (fighter.casting || activeUltimate(fighter)) return { ok: false, reason: 'active' };
  if ((fighter.meter || 0) < ULTIMATE.max) return { ok: false, reason: 'not-ready' };
  if (fighter.grabTarget) return { ok: false, reason: 'locked' };
  return { ok: true, reason: 'ready' };
}

export const ULTIMATE_REFUSAL = Object.freeze({
  'not-ready': 'ULTIMATE METER EMPTY',
  active: 'ULTIMATE ALREADY RUNNING',
  locked: 'CANNOT CAST NOW',
  unavailable: 'NO ULTIMATE',
  missing: 'NO ULTIMATE'
});

/** Combat events that feed the meter. Called by the hit resolver, not by gameplay code. */
export function awardCombatMeter(attacker, target, damage, { guarded = false } = {}) {
  if (attacker) gainMeter(attacker, meterFromDamage(damage, { guarded }));
  if (target) gainMeter(target, meterFromDamage(damage, { taken: true, guarded }));
}

export function activeUltimate(owner) {
  return ACTIVE.find(record => record.owner === owner) || null;
}

/** Plan the damage events for a behaviour. Times are seconds from cast start. */
function planEvents(def) {
  const startup = def.startup;
  const active = def.active;
  const events = [];
  switch (def.behaviour) {
    case 'beam':
      events.push({ at: startup + active * .42, kind: 'lane' });
      break;
    case 'slam':
      events.push({ at: startup + active * .58, kind: 'radial' });
      break;
    case 'rush':
    case 'grab':
    case 'barrage':
      for (let i = 0; i < (def.hits || 1); i++) {
        events.push({ at: startup + (active / Math.max(1, def.hits)) * (i + .55), kind: 'contact', index: i });
      }
      break;
    case 'storm': {
      const gap = Math.min(def.gap || .45, active / Math.max(1, def.hits));
      for (let i = 0; i < (def.hits || 1); i++) {
        events.push({ at: startup + gap * (i + .5), kind: 'strike', index: i });
      }
      break;
    }
    case 'zone': {
      for (let i = 0; i < (def.ticks || 4); i++) {
        events.push({ at: startup + (active / Math.max(1, def.ticks)) * (i + .5), kind: 'tick', index: i });
      }
      break;
    }
    default:
      break;
  }
  return events;
}

/**
 * Begin an ultimate. Validates, spends the meter exactly once, and returns the record (or a
 * refused result). `ctx` is required for presentation; the test may pass a minimal stub.
 */
export function startUltimate(owner, ctx = {}) {
  const check = canUltimate(owner);
  if (!check.ok) return check;
  const def = defOf(owner);
  owner.meter = Math.max(0, (owner.meter || 0) - ULTIMATE.max);
  owner.attackQueue.length = 0;
  owner.attackBuffer = 0;
  owner.casting = 'ultimate';
  // No free invulnerability: the startup is the opponent's window. The only protection is the
  // meter refund if nothing has connected yet.
  const dir = new THREE.Vector3(owner.facing || 1, 0, owner.facingZ || 0);
  if (dir.lengthSq() < .001) dir.set(owner.player ? 1 : -1, 0, 0);
  dir.normalize();
  const target = (ctx.fighters?.() || []).find(f => f !== owner && f.model?.visible !== false) || null;
  const record = {
    id: def.id || def.label,
    label: def.label,
    owner,
    def,
    colour: def.color ?? 0x9df6ff,
    phase: 'startup',
    t: 0,
    startup: def.startup,
    active: def.active,
    recovery: def.recovery,
    total: def.startup + def.active + def.recovery,
    events: planEvents(def),
    fired: 0,
    hitCount: 0,
    whiffs: 0,
    interrupted: false,
    target,
    origin: owner.position.clone(),
    dir,
    anchor: new THREE.Vector3(owner.position.x, owner.position.y, owner.position.z),
    marks: [],
    group: new THREE.Group(),
    visuals: []
  };
  if (target) {
    record.anchor.set(target.position.x, target.position.y, target.position.z);
    if (def.behaviour === 'storm' || def.behaviour === 'zone' || def.behaviour === 'slam') {
      record.marks.push(record.anchor.clone());
      for (let i = 1; i < (def.hits || def.ticks || 1); i++) record.marks.push(record.anchor.clone());
    }
  }
  record.group.name = `ultimate:${record.id}`;
  if (ctx.scene) {
    ctx.scene.add(record.group);
    buildVisual(record, ctx);
  }
  if (def.behaviour === 'slam') {
    // The leap is real movement, not a pose: it starts on cast and the landing is the hit.
    owner.isGrounded = false;
    owner.velocity.y = Math.max(owner.velocity.y || 0, 8.6);
    owner.velocity.x += dir.x * 3.4;
    owner.velocity.z += dir.z * 3.4;
  }
  // A clone-barrage ultimate has to put clones on the field, not paint them into the effect. These
  // are the same entities the Shadow Clone Jutsu spawns: they chase, strike through the real hit
  // resolver, and leave through the normal lifetime/cap rather than being removed by this move.
  if (def.cloneBarrage && ctx.scene) {
    record.clones = spawnClones({ scene: ctx.scene, owner, count: 2 });
  }
  ACTIVE.push(record);
  globalThis.window?.combatAudio?.play?.('ultimate');
  ctx.callout?.(`${record.label} · ULTIMATE`, hexCss(record.colour));
  ctx.onStart?.(record);
  return record;
}

/**
 * Advance every running ultimate. Returns the events that ended this frame so the caller can
 * react (camera, HUD). Interruption and cleanup are handled here so no path can leave a record
 * alive after a KO or a round reset.
 */
export function updateUltimates(dt, ctx = {}) {
  const ended = [];
  for (let i = ACTIVE.length - 1; i >= 0; i--) {
    const record = ACTIVE[i];
    const owner = record.owner;
    // Interruption: a clean hit during startup (or before anything connected) cancels the move.
    const disrupted = !owner || owner.ko || owner.grabbedBy || (owner.hitstun || 0) > 0;
    if (disrupted && record.fired === 0) {
      endRecord(record, ctx, 'interrupted', true);
      ended.push(record);
      ACTIVE.splice(i, 1);
      continue;
    }
    record.t += dt;
    const def = record.def;
    record.phase = record.t < record.startup ? 'startup'
      : record.t <= record.startup + record.active ? 'active' : 'recovery';
    if (record.phase === 'active') {
      while (record.fired < record.events.length && record.events[record.fired].at <= record.t) {
        const event = record.events[record.fired];
        BEHAVIOURS[def.behaviour]?.(record, ctx, event);
        record.fired++;
      }
    }
    // Drive the move itself: the behaviours move the owner, this keeps the visuals honest.
    // A reeling grab target keeps travelling here, between events, rather than being moved by the
    // event that requested the pull.
    if (record.reeled) stepReel(record, dt);
    if (ctx.scene) updateVisual(record, ctx);
    if (record.t >= record.total) {
      endRecord(record, ctx, 'finished', false);
      ended.push(record);
      ACTIVE.splice(i, 1);
    }
  }
  return ended;
}

/** Cancel everything (KO, round end, reset, character swap). */
export function clearUltimates(ctx = {}, reason = 'cleared') {
  for (const record of ACTIVE.splice(0, ACTIVE.length)) endRecord(record, ctx, reason, false);
}

function endRecord(record, ctx, reason, refund) {
  const owner = record.owner;
  if (record.target?.grabReel?.record === record) delete record.target.grabReel;
  if (record.castingCleared !== true && owner && owner.casting === 'ultimate') owner.casting = null;
  record.castingCleared = true;
  if (record.group) {
    record.group.parent?.remove(record.group);
    record.group.traverse(node => {
      node.geometry?.dispose?.();
      if (Array.isArray(node.material)) node.material.forEach(m => m.dispose?.());
      else node.material?.dispose?.();
    });
    record.group = null;
  }
  if (refund && ULTIMATE.refundBeforeFirstHit && owner) {
    owner.meter = Math.min(ULTIMATE.max, (owner.meter || 0) + ULTIMATE.max);
    ctx.callout?.('ULTIMATE INTERRUPTED · METER REFUNDED', '#ffb4a8');
  } else if (reason === 'interrupted') {
    ctx.callout?.('ULTIMATE INTERRUPTED', '#ffb4a8');
  }
  record.phase = 'done';
  record.endReason = reason;
  ctx.onEnd?.(record, reason);
}

// ---------------------------------------------------------------- damage helpers

// ---------------------------------------------------------------- reel (Phase 29.7 experiment)

/** Distance a reel stops at: the follow-up gate minus a margin, so the target lands inside it. */
function reelKeep(tune) {
  const gate = Number(tune?.gate) || GRAB_GATE;
  return Math.max(.8, gate - (Number(tune?.pullTargetOffset) || .4));
}

/**
 * Begin reeling a grabbed target inward with velocity. The reel is a state on the target, not a
 * position edit, so the body is seen travelling and stops on its own: at the keep distance, at the
 * next event, or when the record ends. `casterStep` is the counter-motion the pull comes from.
 */
/**
 * Which movement-budget policy the caster uses. `per-reel` is the Phase 29.7 behaviour; `chain`
 * spends one pool across the whole ultimate so repeated reels cannot walk her across the arena;
 * `plant` gives no ground at all and leaves the counter-motion entirely to the body pose.
 */
function casterBudgetFor(record, tune) {
  const override = globalThis.window?.__browserSmashCasterBudget;
  const mode = String(override || tune?.casterBudget || 'per-reel');
  const pool = Number(tune?.casterMax) || .1;
  if (mode === 'plant') return { mode: 'plant', max: 0, pool };
  if (mode === 'chain') return { mode: 'chain', max: Math.max(0, pool - (record.casterSpent || 0)), pool };
  return { mode: 'per-reel', max: pool, pool };
}

function startReel(record, target, tune) {
  // A reel runs to the next event, or for a quarter second after the final one: hauling during the
  // whole recovery would read as her still pulling after the finisher has already landed.
  const next = record.events.find(e => e.at > record.t)?.at;
  const budget = casterBudgetFor(record, tune);
  target.grabReel = {
    record, keep: reelKeep(tune), speed: Number(tune?.pullSpeed) || 9,
    // The reel has a finite acceleration budget, so it is a pull and not a velocity override: a target
    // that is knocked or dashing away can out-run it, which is what keeps an escape possible.
    accel: Number(tune?.pullAccel) || 45,
    until: record.t + (next == null ? .25 : Math.min(.6, Math.max(.06, next - record.t))),
    casterStep: Number(tune?.casterStep) || 0, casterMax: budget.max, casterMode: budget.mode,
    casterMoved: 0, travel: 0
  };
  record.reeled = true;
}

/** Hold a steady inward speed toward the caster. Never adds distance it did not travel. */
function stepReel(record, dt) {
  const target = record.target;
  const owner = record.owner;
  const reel = target?.grabReel;
  if (!reel || reel.record !== record || !owner) return;
  if (target.ko || record.phase === 'done' || record.t > reel.until) { delete target.grabReel; return; }
  const toward = owner.position.clone().sub(target.position);
  toward.y = 0;
  const gap = toward.length();
  const unit = toward.multiplyScalar(1 / Math.max(.001, gap));
  if (gap <= reel.keep + .06) {
    // Inside the leash the target keeps its own physics and the reel adds no inward push — but it stays
    // armed until the next event. Releasing here was wrong: the strike lands while the body is still
    // close, so the reel retired on the pre-knockback distance and the knockback then carried the target
    // back out of the follow-up gate.
    //
    // It also has to BRAKE. The speed granted on earlier ticks is real velocity, so without this the body
    // coasts straight past the keep distance and through the caster (measured: 2.01 m apart at 60% reach).
    const coasting = target.velocity.x * unit.x + target.velocity.z * unit.z;
    if (coasting > 0) {
      target.velocity.x -= unit.x * coasting;
      target.velocity.z -= unit.z * coasting;
    }
    return;
  }
  const inward = target.velocity.x * unit.x + target.velocity.z * unit.z;
  // Hold the speed instead of adding to it: a knockback that is still decaying must not stack with
  // the reel into an overshoot that then has to be corrected back outward.
  if (inward < reel.speed) {
    const add = Math.min((reel.accel || 45) * dt, reel.speed - inward);
    target.velocity.x += unit.x * add;
    target.velocity.z += unit.z * add;
  }
  reel.travel += Math.min(reel.speed, Math.max(0, gap - reel.keep)) * dt;
  if (reel.casterStep > 0 && reel.casterMoved < reel.casterMax) {
    const step = Math.min(reel.casterStep * dt, reel.casterMax - reel.casterMoved);
    owner.position.addScaledVector(unit, step);
    reel.casterMoved += step;
    record.casterSpent = (record.casterSpent || 0) + step;
  }
}

function hitTargets(record, ctx, candidates, { damage, kbs, launchY, stun, falloff = 1, label }) {
  let hits = 0;
  for (const target of candidates) {
    if (!target || target === record.owner) continue;
    if (target.model?.visible === false) continue;
    const dealt = damage * falloff;
    const landed = ctx.hit?.(record.owner, target, {
      damage: dealt, kbs, launchY, stun,
      label: label || record.label,
      color: record.colour,
      kind: 'ultimate',
      ultimate: record
    });
    if (landed) {
      hits++;
      record.hitCount++;
    } else {
      record.whiffs++;
    }
  }
  return hits;
}

function candidatesInRadius(record, ctx, centre, radius) {
  const list = ctx.fighters?.() || [];
  const out = [];
  for (const target of list) {
    if (!target || target === record.owner) continue;
    const point = target.position.clone();
    point.y += .9;
    if (point.distanceTo(centre) <= radius + (target.hurtboxRadius || .7)) out.push(target);
  }
  return out;
}

/**
 * A strike that lands from above covers a column over its mark, not a sphere around it: being
 * lifted by the strike before it is not a way to escape, but stepping out of the mark still is.
 * `candidatesInRadius` stays the test for ground radials, where a jump is meant to clear the hit.
 */
function candidatesInColumn(record, ctx, centre, radius) {
  const list = ctx.fighters?.() || [];
  const out = [];
  for (const target of list) {
    if (!target || target === record.owner) continue;
    if (target.model?.visible === false) continue;
    const horizontal = Math.hypot(target.position.x - centre.x, target.position.z - centre.z);
    if (horizontal <= radius + (target.hurtboxRadius || .7)) out.push(target);
  }
  return out;
}

// ---------------------------------------------------------------- behaviours
// Every behaviour reports honest misses: out of range, behind cover, or outside the marked zone
// simply does not call ctx.hit.

const BEHAVIOURS = {
  /** A lane: a beam that stops at the first wall and falls off along its length. */
  beam(record, ctx, event) {
    if (event.kind !== 'lane') return;
    const owner = record.owner;
    // The lane is resolved from the hands: this is the same point the drawn beam leaves from.
    const resolved = beamOriginFor(record);
    const origin = resolved.point.clone();
    const dir = record.dir.clone();
    // Damage still uses the cast direction (dodging out of the lane is the tested whiff path),
    // but the drawn beam aims at the chest of the target the lane reaches, so picture and hit agree.
    if (record.target?.position) {
      const chest = record.target.position.clone();
      chest.y += 1.1;
      const toTarget = chest.sub(origin);
      if (toTarget.lengthSq() > .01) record.aimDir = toTarget.normalize();
    }
    if (typeof window !== 'undefined') {
      window.__browserSmashBeamTrace ||= [];
      window.__browserSmashBeamTrace.push({
        label: record.label,
        source: resolved.source,
        origin: { x: +origin.x.toFixed(2), y: +origin.y.toFixed(2), z: +origin.z.toFixed(2) },
        // Positive: the beam starts ahead of the body axis, i.e. out at the hands.
        handsAheadOfChest: +Math.hypot(origin.x - owner.position.x, origin.z - owner.position.z).toFixed(2),
        dir: { x: +dir.x.toFixed(3), z: +dir.z.toFixed(3) }
      });
      if (window.__browserSmashBeamTrace.length > 40) window.__browserSmashBeamTrace.splice(0, window.__browserSmashBeamTrace.length - 40);
    }
    const maxLen = record.def.range;
    const reach = ctx.coverDistance?.(origin, dir, maxLen) ?? maxLen;
    // Every lane decision is traced, so a hit that lands from behind the caster can be explained
    // from evidence instead of inferred from the damage total.
    const trace = typeof window !== 'undefined'
      ? (window.__browserSmashUltimateTrace || (window.__browserSmashUltimateTrace = []))
      : null;
    for (const target of ctx.fighters?.() || []) {
      if (!target || target === owner || target.model?.visible === false) continue;
      const rel = target.position.clone().sub(owner.position);
      const along = rel.x * dir.x + rel.z * dir.z;
      const entry = {
        label: record.label, behaviour: record.def.behaviour,
        dir: { x: +dir.x.toFixed(3), z: +dir.z.toFixed(3) },
        reach: Number.isFinite(reach) ? +reach.toFixed(2) : String(reach),
        target: target.identity || target.name || '', along: +along.toFixed(2), perp: null, hit: false
      };
      if (along < -.4 || along > reach) {
        entry.reason = 'out-of-lane';
        trace?.push(entry);
        continue;
      }
      const perp = Math.hypot(rel.x - dir.x * along, rel.z - dir.z * along);
      entry.perp = +perp.toFixed(2);
      if (perp > (record.def.width || 2.4) + (target.hurtboxRadius || .7)) {
        entry.reason = 'outside-width';
        trace?.push(entry);
        continue;
      }
      if (ctx.coverBetween?.(owner.position, target.position)) {
        entry.reason = 'cover';
        trace?.push(entry);
        continue;
      }
      const falloff = Math.max(.55, 1 - Math.max(0, along) / (reach * 2.2));
      entry.hit = hitTargets(record, ctx, [target], {
        damage: record.def.damage * falloff, kbs: record.def.kbs, launchY: record.def.launchY,
        stun: record.def.stun, label: record.label
      }) > 0;
      entry.reason = entry.hit ? 'hit' : 'resisted';
      trace?.push(entry);
    }
    if (trace && trace.length > 60) trace.splice(0, trace.length - 60);
    ctx.onBeam?.(record, origin, dir, reach);
  },

  /** Sequential closes: each hit needs the target within reach and in the open. */
  rush(record, ctx, event) {
    if (event.kind !== 'contact') return;
    const owner = record.owner;
    const target = record.target;
    if (!target || target.model?.visible === false) { record.whiffs++; return; }
    const gap = owner.position.distanceTo(target.position);
    if (ctx.coverBetween?.(owner.position, target.position)) { record.whiffs++; return; }
    const reach = record.def.range;
    if (gap > reach) { record.whiffs++; return; }
    const last = event.index >= (record.def.hits - 1);
    hitTargets(record, ctx, [target], {
      damage: record.def.damage, kbs: record.def.kbs, launchY: last ? record.def.launchY : record.def.launchY * .45,
      stun: record.def.stun, label: record.label
    });
    // Step in behind each hit so the chain reads as movement, not a stationary flurry.
    const toward = target.position.clone().sub(owner.position);
    toward.y = 0;
    const length = toward.length() || 1;
    const step = Math.min(length * .55, 3.4);
    owner.position.addScaledVector(toward.multiplyScalar(1 / length), step);
    owner.velocity.set(0, Math.max(0, owner.velocity.y * .3), 0);
    if (Math.abs(toward.x) > .1) owner.facing = Math.sign(toward.x);
    if (Math.abs(toward.z) > .1) owner.facingZ = Math.sign(toward.z);
    ctx.onImpact?.(target.position.clone().add(new THREE.Vector3(0, 1.1, 0)), record.colour, last ? 22 : 12);
  },

  /** Leap, then a radial landing inside the marked zone. */
  slam(record, ctx, event) {
    const owner = record.owner;
    if (event.kind !== 'radial') return;
    const anchor = record.anchor;
    owner.position.set(anchor.x, Math.max(anchor.y, owner.groundLevel || 0), anchor.z);
    owner.velocity.set(0, 0, 0);
    owner.isGrounded = true;
    const centre = anchor.clone();
    centre.y += .4;
    const targets = candidatesInRadius(record, ctx, centre, record.def.radius);
    for (const target of targets) {
      const distance = target.position.distanceTo(anchor);
      const falloff = Math.max(.4, 1 - (distance / record.def.radius) * .55);
      hitTargets(record, ctx, [target], {
        damage: record.def.damage * falloff, kbs: record.def.kbs, launchY: record.def.launchY,
        stun: record.def.stun, label: record.label
      });
    }
    ctx.onSlam?.(anchor.clone(), record.def.radius, record.colour);
  },

  /** Marked strikes: the mark is where the target stood when the ultimate started. */
  storm(record, ctx, event) {
    if (event.kind !== 'strike') return;
    const mark = record.marks[event.index] || record.anchor;
    const centre = mark.clone();
    centre.y += .3;
    const targets = candidatesInColumn(record, ctx, centre, record.def.radius);
    hitTargets(record, ctx, targets, {
      damage: record.def.damage, kbs: record.def.kbs, launchY: record.def.launchY,
      stun: record.def.stun, label: record.label
    });
    ctx.onStrike?.(centre, record.def.radius, record.colour, event.index);
  },

  /** A persistent damaging field at one point on the ground. */
  zone(record, ctx, event) {
    if (event.kind !== 'tick') return;
    const mark = record.anchor.clone();
    mark.y = (record.owner.groundLevel || 0) + .3;
    const targets = candidatesInRadius(record, ctx, mark, record.def.radius);
    const final = event.index >= (record.def.ticks - 1);
    hitTargets(record, ctx, targets, {
      damage: record.def.damage * (final ? 1.6 : 1), kbs: record.def.kbs,
      launchY: final ? record.def.launchY : record.def.launchY * .35,
      stun: record.def.stun, label: record.label
    });
    ctx.onZoneTick?.(mark, record.def.radius, record.colour, final);
  },

  /** A pull that must connect, then a short finishing chain. */
  grab(record, ctx, event) {
    const owner = record.owner;
    const target = record.target;
    if (!target || target.model?.visible === false) { record.whiffs++; return; }
    if (event.kind !== 'contact') return;
    const gap = owner.position.distanceTo(target.position);
    const tune = grabContinuityTuning(record);
    if (event.index === 0) {
      if (gap > record.def.range || ctx.coverBetween?.(owner.position, target.position)) {
        record.whiffs++;
        ctx.callout?.('ULTIMATE MISSED', '#ffb4a8');
        return;
      }
      const toward = owner.position.clone().sub(target.position);
      toward.y = 0;
      const length = toward.length() || 1;
      // Spider-Man's web pull is a presentation beat as well as a gameplay pull. The default 9.4 m/s
      // carried the target past him (measured 0.47 m between bodies at the first grapple), so his
      // move supplies a slower pull that stops at a readable grappling distance. Every other
      // ultimate keeps the shipped speed.
      const pullSpeed = Number(record.def.pullSpeed) || 9.4;
      target.velocity.x = toward.x / length * pullSpeed;
      target.velocity.z = toward.z / length * pullSpeed;
      target.velocity.y = 2.6;
      target.isGrounded = false;
      target.hitstun = Math.max(target.hitstun || 0, .42);
      record.pulled = true;
      if (tune?.pull) startReel(record, target, tune);
      ctx.onImpact?.(target.position.clone().add(new THREE.Vector3(0, 1.1, 0)), record.colour, 10);
      return;
    }
    if (!record.pulled) { record.whiffs++; return; }
    // Phase 29.5 experiment, off by default: `tune` is null unless a flag named an experiment that
    // targets this caster, in which case the chain may re-assert the pull and scale its own
    // knockback. With no flag the numbers below are byte-for-byte the shipped ones.
    let gapNow = gap;
    let reasserted = false;
    // Continuous travel, not a reposition: the reel below gives the target inward velocity and lets it
    // travel until it reaches the keep distance or the next event arrives. It is armed AFTER the strike
    // lands, because the strike's knockback is what opens the distance the reel has to close — arming it
    // on the pre-hit gap left the target flying out of the gate instead of being reeled back in.
    const armReel = Boolean(tune?.pull);
    if (tune?.reassert) {
      const keep = Number(tune.reassertGap) || GRAB_GATE;
      const toward = owner.position.clone().sub(target.position);
      toward.y = 0;
      const length = toward.length() || 1;
      const pull = Math.min(length - keep, 2.6);
      if (pull > 0) {
        target.position.addScaledVector(toward.multiplyScalar(1 / length), pull);
        target.velocity.x *= .35;
        target.velocity.z *= .35;
        gapNow = owner.position.distanceTo(target.position);
        reasserted = true;
      }
    }
    const gate = tune?.gate ?? GRAB_GATE;
    const guardHeldAtEvent = !!target.guardHeld;
    if (event.index > 0 && (gapNow > gate || ctx.coverBetween?.(owner.position, target.position))) {
      record.whiffs++;
      if (typeof window !== 'undefined') {
        window.__browserSmashGrabTrace ||= [];
        window.__browserSmashGrabTrace.push({ label: record.label, index: event.index, gap: +gapNow.toFixed(2),
          gate, reasserted, outcome: 'out-of-gate', guardHeld: guardHeldAtEvent, shield: +target.shield.toFixed(2) });
      }
      return;
    }
    const last = event.index >= (record.def.hits - 1);
    const kbsBase = record.def.kbs ?? 120;
    const launchBase = record.def.launchY ?? 8;
    const chainKnockback = tune && !last ? (Number(tune.chainKnockback) || 1) : 1;
    const chainLaunch = tune && !last ? (Number(tune.chainLaunch) || 1) : 1;
    if (typeof window !== 'undefined') {
      window.__browserSmashGrabTrace ||= [];
      window.__browserSmashGrabTrace.push({ label: record.label, index: event.index, gap: +gapNow.toFixed(2),
        gate, reasserted: reasserted || armReel, outcome: 'strike', kbs: +(kbsBase * chainKnockback).toFixed(1),
        guardHeld: guardHeldAtEvent, shield: +target.shield.toFixed(2) });
    }
    hitTargets(record, ctx, [target], {
      damage: record.def.damage, kbs: kbsBase * chainKnockback,
      launchY: last ? launchBase : launchBase * .4 * chainLaunch,
      stun: record.def.stun, label: record.label
    });
    ctx.onImpact?.(target.position.clone().add(new THREE.Vector3(0, 1.1, 0)), record.colour, last ? 20 : 12);
    if (armReel) startReel(record, target, tune);
  },

  /** Aimed shells/salvo: each needs line of sight and range. */
  barrage(record, ctx, event) {
    if (event.kind !== 'contact') return;
    const owner = record.owner;
    const target = record.target;
    if (!target || target.model?.visible === false) { record.whiffs++; return; }
    const gap = owner.position.distanceTo(target.position);
    if (gap > record.def.range || ctx.coverBetween?.(owner.position, target.position)) {
      record.whiffs++;
      return;
    }
    hitTargets(record, ctx, [target], {
      damage: record.def.damage, kbs: record.def.kbs,
      launchY: record.def.launchY * (event.index >= record.def.hits - 1 ? 1 : .35),
      stun: record.def.stun, label: record.label
    });
    ctx.onImpact?.(target.position.clone().add(new THREE.Vector3(0, 1.2, 0)), record.colour, 14);
  }
};

// ---------------------------------------------------------------- visuals
// Deliberately cheap: a handful of additive rings and one line per effect, all disposed when the
// record ends. No post-processing, no per-frame allocation beyond small vectors.

function hexCss(color) {
  return '#' + Number(color || 0xffffff).toString(16).padStart(6, '0');
}

/** World position of a hand, or null when this body has no hand joint. */
function handWorldPoint(owner, side) {
  const userData = owner?.model?.userData || {};
  const joint = side === 'left'
    ? (userData.leftHand || userData.leftFore || userData.leftArm)
    : (userData.rightHand || userData.rightFore || userData.rightArm);
  if (!joint?.getWorldPosition) return null;
  const point = new THREE.Vector3();
  joint.getWorldPosition(point);
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z) ? point : null;
}

/**
 * Where a beam actually leaves the body.
 *
 * The chest constant (position + 1.2 m) drew the beam out of the sternum while the animation drove
 * the hands forward, which is exactly what made a Kamehameha read as a light show instead of an
 * attack. The hands are the honest origin when the rig has them, and the chest stays as the
 * documented fallback for a body that does not.
 */
export function beamOriginFor(record) {
  const owner = record?.owner;
  const left = handWorldPoint(owner, 'left');
  const right = handWorldPoint(owner, 'right');
  if (left && right) {
    return { point: left.clone().add(right).multiplyScalar(.5), source: 'both-hands', hands: { left, right } };
  }
  if (right) return { point: right.clone(), source: 'right-hand', hands: { left: null, right } };
  if (left) return { point: left.clone(), source: 'left-hand', hands: { left, right: null } };
  const base = owner?.position || new THREE.Vector3();
  return {
    point: new THREE.Vector3(base.x || 0, (base.y || 0) + 1.2, base.z || 0),
    source: 'chest-fallback',
    hands: { left: null, right: null }
  };
}

function buildVisual(record, ctx) {
  const colour = record.colour;
  const def = record.def;
  const group = record.group;
  const ring = (radius, tube, opacity) => new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, 6, 30),
    new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  switch (def.behaviour) {
    case 'beam': {
      // The drawn beam is as wide as the damage lane. A toothpick visual over a 2.4 m hit
      // volume was the single most misleading thing in the move set: players judged the dodge
      // off the picture. Radius follows `width`, not a fixed number.
      //
      // `width` is the full lane width, so the radius that puts ~84% of the lane inside the drawn
      // cylinder is width * .42. This was .21, which drew the beam at half the intended girth and
      // contradicted both this comment and the beam-art assertion; the palm branch below has always
      // scaled from `radius`, so the two-emitter case follows the same correction. Damage geometry is
      // untouched.
      // SEMANTICS (measured during stabilization): the damage test consumes `def.width` as a RADIUS
      // (`perp > def.width + hurtboxRadius`), so the damaging lane is a cylinder of radius `width`.
      // The drawn beam is deliberately narrower: radius = width * .42, i.e. 42% of the lane radius.
      // Matching the art to the hit volume, or halving the hit radius, changes reach and reliability
      // for every beam ultimate, so both are left for a separate measured balance experiment.
      const radius = Math.max(.22, (def.width || 2.4) * .42);
      // Two palm emitters read as repulsors; one wide emitter reads as a two-handed ki blast.
      const sides = def.beamStyle === 'palms' ? ['left', 'right'] : [null];
      for (const side of sides) {
        const beamRadius = side ? radius * .42 : radius;
        const beam = new THREE.Mesh(
          new THREE.CylinderGeometry(beamRadius, beamRadius * 1.18, 1, 16, 1, true),
          new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: .6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
        );
        beam.rotation.z = Math.PI / 2;
        group.add(beam);
        record.visuals.push({ kind: 'beam', mesh: beam, side });
        if (side) {
          // Palm flare. The strip itself starts just ahead of the hand (see updateVisual) so it cannot
          // cut through the forearm; this glow is what keeps the beam reading as attached to the palm
          // instead of floating in front of it.
          const flare = new THREE.Mesh(
            new THREE.SphereGeometry(beamRadius * 1.35, 12, 10),
            new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false })
          );
          group.add(flare);
          record.visuals.push({ kind: 'palmGlow', mesh: flare, side });
        }
      }
      // Aim tell: a thin line that draws out along the firing lane during startup, so the
      // direction is readable before the beam fires. It stops at the same wall the beam will.
      const aim = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([record.owner.position.clone(), record.owner.position.clone()]),
        new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: .35 })
      );
      aim.frustumCulled = false;
      group.add(aim);
      record.visuals.push({ kind: 'aim', mesh: aim });
      break;
    }
    case 'rush': {
      const trail = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([record.owner.position.clone(), record.owner.position.clone()]),
        new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: .8 })
      );
      trail.frustumCulled = false;
      group.add(trail);
      record.visuals.push({ kind: 'trail', mesh: trail });
      break;
    }
    case 'slam':
    case 'storm':
    case 'zone': {
      const mark = ring(def.radius * .55, .07, .6);
      mark.rotation.x = Math.PI / 2;
      mark.position.copy(record.anchor);
      mark.position.y += .12;
      group.add(mark);
      record.visuals.push({ kind: 'mark', mesh: mark });
      break;
    }
    case 'grab': {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([record.owner.position.clone(), record.anchor.clone()]),
        new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: .7 })
      );
      line.frustumCulled = false;
      group.add(line);
      record.visuals.push({ kind: 'tether', mesh: line });
      break;
    }
    case 'barrage': {
      const arc = ring(.7, .05, .7);
      arc.rotation.x = Math.PI / 2;
      arc.position.copy(record.owner.position);
      arc.position.y += .2;
      group.add(arc);
      record.visuals.push({ kind: 'mark', mesh: arc });
      break;
    }
    default:
      break;
  }
}

function updateVisual(record, ctx) {
  const t = Math.min(1, record.t / Math.max(.001, record.total));
  // 0 at cast, 1 at the moment the active frames begin: every mark/wind-up visual scales with
  // this so an opponent can see the move charging instead of being surprised by it.
  const charge = Math.min(1, record.t / Math.max(.001, record.startup));
  for (const visual of record.visuals) {
    if (visual.kind === 'beam') {
      // Anchor the drawn beam to the hands, not the chest, every frame: the choreography moves the
      // hands, so a fixed origin would detach the attack from the body mid-beat.
      const resolved = beamOriginFor(record);
      const dir = record.aimDir || record.dir;
      const palm = (visual.side && resolved.hands[visual.side]) ? resolved.hands[visual.side] : null;
      // Start a palm strip just in front of the hand. Drawing the cylinder from the palm centre put
      // half its body inside the forearm whenever the arm and the firing lane were not collinear, which
      // is exactly what cut Iron Man's left beam through his arm. The palm flare bridges the gap.
      const beamRadiusNow = visual.mesh.geometry.parameters?.radiusTop ?? .2;
      const clearance = palm ? Math.max(.24, beamRadiusNow * 1.5) : 0;
      const origin = palm ? palm.clone().addScaledVector(dir, clearance) : resolved.point;
      const length = record.def.range;
      // The beam stops at the first wall AND at the target it is aimed at. Drawing the full 30 m
      // range put the emitter cone through the cinematic camera, which is what turned the finisher
      // frame into a white wash instead of a readable attack.
      const wall = ctx.coverDistance?.(origin, dir, length) ?? length;
      const toTarget = record.target?.position
        ? Math.hypot(record.target.position.x - origin.x, record.target.position.z - origin.z) + 1.2
        : length;
      const stop = Math.min(length, wall, toTarget);
      visual.mesh.position.copy(origin).addScaledVector(dir, stop / 2);
      visual.mesh.scale.set(1, stop, 1);
      visual.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      // A palm emitter only fires from the moment the beam event resolved its own lane.
      const on = record.phase === 'active' && Boolean(record.fired > 0);
      // Hand-to-emitter alignment telemetry: the beam is supposed to leave the hands, so the distance
      // between the drawn origin and the hand joint that anchors it is the number to watch, not a
      // visual impression. Recorded every firing frame so a probe can report the worst gap.
      if (on && typeof window !== 'undefined') {
        const hands = resolved.hands || {};
        const anchor = visual.side ? hands[visual.side] : (hands.left && hands.right
          ? hands.left.clone().add(hands.right).multiplyScalar(.5) : null);
        const gap = anchor ? origin.distanceTo(anchor) : null;
        // A two-handed blast draws from the midpoint between both palms, so it is compared with both.
        const twoHandGap = (!visual.side && hands.left && hands.right)
          ? Math.max(origin.distanceTo(hands.left), origin.distanceTo(hands.right)) : null;
        window.__browserSmashBeamLog = (window.__browserSmashBeamLog || []).concat([{
          source: resolved.source,
          side: visual.side || null,
          gapMeters: gap === null ? null : +gap.toFixed(4),
          twoHandMaxGapMeters: twoHandGap === null ? null : +twoHandGap.toFixed(4),
          hasLeft: !!hands.left,
          hasRight: !!hands.right
        }]).slice(-240);
      }
      visual.mesh.visible = on;
      visual.mesh.material.opacity = on ? .34 * (1 - t * .4) : 0;
    } else if (visual.kind === 'palmGlow') {
      const hand = beamOriginFor(record).hands[visual.side];
      const firing = record.phase === 'active' && Boolean(record.fired > 0);
      visual.mesh.visible = firing && !!hand;
      if (hand) visual.mesh.position.copy(hand);
      if (firing) visual.mesh.material.opacity = .34 + Math.abs(Math.sin(record.t * 26)) * .16;
    } else if (visual.kind === 'trail') {
      visual.mesh.geometry.setFromPoints([record.origin, record.owner.position.clone().add(new THREE.Vector3(0, 1, 0))]);
      visual.mesh.material.opacity = .7 * (1 - t);
    } else if (visual.kind === 'tether') {
      visual.mesh.geometry.setFromPoints([
        record.owner.position.clone().add(new THREE.Vector3(0, 1.1, 0)),
        record.anchor.clone().add(new THREE.Vector3(0, 1, 0))
      ]);
      visual.mesh.material.opacity = .6 * (1 - t * .6);
    } else if (visual.kind === 'aim') {
      const origin = record.owner.position.clone().add(new THREE.Vector3(0, 1.2, 0));
      const reach = ctx.coverDistance?.(origin, record.dir, record.def.range) ?? record.def.range;
      visual.mesh.geometry.setFromPoints([origin, origin.clone().addScaledVector(record.dir, reach)]);
      const aiming = record.phase === 'startup';
      visual.mesh.visible = aiming;
      if (aiming) {
        visual.mesh.material.opacity = .18 + charge * .5;
        // A brighter tip line that grows with the charge reads as "about to fire".
        visual.mesh.material.opacity *= .6 + Math.sin(record.t * 26) * .12;
      }
    } else if (visual.kind === 'mark') {
      const pulse = 1 + Math.sin(record.t * 18) * .05;
      // Wind-up: the ring starts small and dim, then fills out as the active frames approach.
      const grow = record.phase === 'startup' ? .34 + charge * .66 : 1;
      visual.mesh.scale.setScalar(pulse * grow);
      // Phase 29.7 presentation fix: once the mark's last damaging event has passed, the ring has to
      // stop reading as live ground. It got there by fading on the record clock alone, so it was still
      // clearly drawn 0.99 s after the final strike. Fade it out over MARK_FADE instead — ring radius,
      // damage timing, warning duration and target acquisition are all untouched.
      const lastEventAt = record.events?.[record.events.length - 1]?.at ?? record.total;
      const spent = Math.min(1, Math.max(0, (record.t - lastEventAt) / MARK_FADE));
      const base = record.phase === 'startup'
        ? .22 + charge * .5
        : .5 * (1 - t * .5);
      visual.mesh.material.opacity = base * (1 - spent);
      visual.mesh.visible = spent < 1;
      if (typeof window !== 'undefined') {
        window.__browserSmashMarkTrace ||= [];
        const trace = window.__browserSmashMarkTrace;
        const entry = { label: record.label, t: +record.t.toFixed(3),
          lastEventAt: +lastEventAt.toFixed(3), opacity: +visual.mesh.material.opacity.toFixed(3),
          visible: visual.mesh.visible };
        if (trace[trace.length - 1]?.t !== entry.t) trace.push(entry);
        if (trace.length > 600) trace.splice(0, trace.length - 600);
      }
    }
  }
}

/** Stub context for the headless tests: no scene, no camera, damage still goes through `hit`. */
export function testContext({ fighters, hit, coverBetween, coverDistance } = {}) {
  return {
    fighters: fighters || (() => []),
    hit: hit || (() => false),
    coverBetween: coverBetween || (() => false),
    coverDistance,
    scene: null
  };
}
