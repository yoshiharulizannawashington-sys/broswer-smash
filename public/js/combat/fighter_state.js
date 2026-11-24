// Canonical fighter states, derived from the timers the simulation already owns.
//
// The game has always been driven by explicit timers (`hitstun`, `attackQueue`, `dodgeTimer`,
// `guardBreak`, `flightMode`, …). This module does not replace them — it names the state those
// timers add up to, in one place, so the HUD, the debug overlay, the tests and the hit resolver
// all agree on what "being launched" or "in recovery" means.
//
// Priority is deliberate: a KO outranks everything, a hit outranks the attack that was
// interrupted, a guard break outranks a held guard, and an attack's recovery is still an
// attack (so a fresh attack can only be queued through the cancel table).

export const STATE = Object.freeze({
  IDLE: 'idle',
  WALK: 'walk',
  RUN: 'run',
  DASH: 'dash',
  JUMP: 'jump',
  FALL: 'fall',
  ATTACK_STARTUP: 'attack-startup',
  ATTACK_ACTIVE: 'attack-active',
  ATTACK_RECOVERY: 'attack-recovery',
  BLOCK: 'block',
  DODGE: 'dodge',
  GRABBED: 'grabbed',
  HITSTUN: 'hitstun',
  LAUNCHED: 'launched',
  GUARD_BROKEN: 'guard-broken',
  FLIGHT: 'flight',
  KO: 'ko'
});

/** Dodge windows in seconds: i-frames start immediately and end well before the dodge does. */
export const DODGE = Object.freeze({
  total: .48,
  invulnerable: .2,
  recovery: .28,       // remainder of the dodge
  cooldown: .4,
  roamTotal: .62,
  roamCooldown: .55
});

/** Which phase of its active attack a fighter is in, or null when it is not attacking. */
export function attackPhase(f) {
  if (!f) return null;
  const attack = f.attackQueue?.[f.attackQueue.length - 1];
  if (!attack) return null;
  if (attack.t < attack.start) return { id: attack.id || attack.kind, phase: 'startup', attack, frame: Math.round(attack.t * 60) };
  if (attack.t <= attack.end) return { id: attack.id || attack.kind, phase: 'active', attack, frame: Math.round(attack.t * 60) };
  return { id: attack.id || attack.kind, phase: 'recovery', attack, frame: Math.round(attack.t * 60) };
}

/** True while a move with explicit armour is inside its armour frames. */
export function armourActive(f) {
  const current = attackPhase(f);
  if (!current || !current.attack.armor) return false;
  const attack = current.attack;
  return attack.t >= (attack.armorFrom ?? attack.start) && attack.t <= (attack.armorTo ?? attack.end);
}

/** Ground speed, used only for picking a locomotion state. */
function groundSpeed(f) {
  return Math.hypot(f?.velocity?.x || 0, f?.velocity?.z || 0);
}

/** The canonical state of a fighter, most dominant first. */
export function stateOf(f) {
  if (!f) return STATE.IDLE;
  if (f.ko) return STATE.KO;
  if (f.grabbedBy) return STATE.GRABBED;
  if (f.hitstun > 0) {
    return (f.velocity?.y || 0) > 2.2 ? STATE.LAUNCHED : STATE.HITSTUN;
  }
  if (f.guardBreak > 0) return STATE.GUARD_BROKEN;
  if (f.dodgeTimer > 0) return STATE.DODGE;
  const attack = attackPhase(f);
  if (attack) {
    if (attack.phase === 'startup') return STATE.ATTACK_STARTUP;
    if (attack.phase === 'active') return STATE.ATTACK_ACTIVE;
    return STATE.ATTACK_RECOVERY;
  }
  if (f.guardHeld) return STATE.BLOCK;
  if (f.flightMode) return STATE.FLIGHT;
  if (!f.isGrounded) return (f.velocity?.y || 0) > .4 ? STATE.JUMP : STATE.FALL;
  if (f.dashTimer > 0) return STATE.DASH;
  const speed = groundSpeed(f);
  if (speed > 6.2) return STATE.RUN;
  if (speed > .8) return STATE.WALK;
  return STATE.IDLE;
}

/**
 * Whether ordinary inputs may act right now. Hitstun, a grab hold, a guard break and a KO are
 * all hard locks; an attack is handled separately by the cancel table in move_data.js.
 */
export function canAct(f) {
  return !!f && !f.ko && !f.grabbedBy
    && (f.hitstun || 0) <= 0 && (f.guardBreak || 0) <= 0;
}

/**
 * Extra hitstun/knockback reaction rules for a landed hit. Armoured moves take the damage but
 * keep their state; a knocked-down (juggle-exhausted) target is spiked instead of floated.
 */
export function reactionFor(target, { hitstun, knockback, launch, damage, limitReached = false } = {}) {
  const armored = armourActive(target);
  if (armored && damage < 18) {
    return { hitstun: hitstun * .18, knockback: knockback * .3, launch: 0, armored: true };
  }
  if (limitReached) {
    return { hitstun: Math.max(hitstun, .55), knockback: knockback * 1.1, launch: -6.4, armored: false, spike: true };
  }
  return { hitstun, knockback, launch, armored: false };
}
