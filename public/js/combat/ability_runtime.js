// Runtime for the two kit abilities in ability_kit.js.
//
// A kit ability uses the same execution paths as the signature move and the ultimate — the live
// projectile pipeline (`window.spawnProjectile`) or the authored behaviour resolver
// (`window.performSignatureMove`) — so it is resolved against the real opponent, guard, cover and
// invulnerability. No parallel damage path exists here on purpose.
//
// Cooldowns are absolute clock stamps stored on the fighter. That keeps the code out of the
// per-frame timer block (which is already dense) and means a paused match does not silently
// refund a cooldown.

import { abilityFor } from './ability_kit.js';

const clock = () => (globalThis.performance?.now?.() ?? Date.now()) / 1000;

/** Colour for a callout: '#rrggbb' from the ability's numeric colour. */
export function abilityColorCss(ability) {
  const value = Number(ability?.color) || 0xbde9ff;
  return '#' + value.toString(16).padStart(6, '0');
}

/** Seconds still to wait before `slot` can cast again (0 = ready). */
export function abilityCooldownRemaining(fighter, slot, time = clock()) {
  const until = fighter?.abilityReadyAt?.[slot] || 0;
  return Math.max(0, until - time);
}

/** Whether a slot is castable right now. */
export function abilityReady(fighter, slot) {
  if (!abilityFor(fighter, slot)) return false;
  if ((fighter.guardBreak || 0) > 0 || fighter.ko) return false;
  return abilityCooldownRemaining(fighter, slot) <= 0;
}

let castSequence = 0;

/**
 * Cast kit ability `slot` (1 or 2). Returns `{ cast, reason, label }` so the caller (and the tests)
 * can tell a real cast from a refused one instead of guessing.
 *
 * A successful cast is also stamped onto the fighter (`abilityCast`), because the projectile and the
 * clones are spawned from the ability definition while the *animation* is chosen elsewhere. Without
 * the stamp a Rasengan and a Shadow Clone looked identical on screen: same pose, same clip.
 */
export function castAbility(fighter, slot) {
  const ability = abilityFor(fighter, slot);
  const result = castAbilityInner(fighter, slot);
  if (result?.cast && fighter) {
    fighter.abilityCast = { slot, motion: ability?.motion || null, at: ++castSequence };
  }
  return result;
}

function castAbilityInner(fighter, slot) {
  const ability = abilityFor(fighter, slot);
  if (!ability) return { cast: false, reason: 'none' };
  if (!fighter || fighter.ko) return { cast: false, reason: 'ko' };
  if ((fighter.guardBreak || 0) > 0) return { cast: false, reason: 'locked' };
  if (abilityCooldownRemaining(fighter, slot) > 0) return { cast: false, reason: 'cooldown' };

  // The projectile is built from the ability, never from `specialProfile`: the signature profile
  // belongs to the signature key, and borrowing it is how a kit move would silently become a
  // duplicate of the character's headline move.
  const payload = {
    source: 'ability',
    label: ability.label,
    type: ability.type,
    color: ability.color,
    damage: ability.damage,
    speed: ability.speed,
    stun: ability.stun,
    knockback: ability.knockback,
    behavior: ability.behavior,
    radius: ability.radius,
    range: ability.range,
    dashSpeed: ability.dashSpeed,
    lift: ability.lift,
    kitSlot: slot
  };
  if (ability.effect === 'clones') {
    const created = globalThis.window?.spawnShadowClones?.(fighter, ability.count || 2) || 0;
    if (created) {
      fighter.abilityReadyAt ??= {};
      fighter.abilityReadyAt[slot] = clock() + Math.max(.25, ability.cooldown || 1);
      fighter.abilityLastCast = { slot, label: ability.label, type: 'clones', spawned: created, at: clock() };
      fighter.attackPose = Math.max(fighter.attackPose || 0, .7);
      globalThis.window?.showCombatCallout?.(`${ability.label} ×${created}`, abilityColorCss(ability));
      return { cast: true, reason: 'cast', label: ability.label, spawned: created };
    }
    return { cast: false, reason: 'cap' };
  }
  const handled = ability.behavior ? globalThis.window?.performSignatureMove?.(fighter, payload) : false;
  if (!handled) globalThis.window?.spawnProjectile?.(fighter, payload);

  fighter.abilityReadyAt ??= {};
  fighter.abilityReadyAt[slot] = clock() + Math.max(.25, ability.cooldown || 1);
  fighter.abilityLastCast = { slot, label: ability.label, type: ability.type, at: clock() };
  fighter.attackPose = Math.max(fighter.attackPose || 0, .7);
  globalThis.window?.showCombatCallout?.(ability.label, abilityColorCss(ability));
  return { cast: true, reason: 'cast', label: ability.label };
}

/** Reset cooldowns (round restart). */
export function resetAbilities(fighter) {
  if (fighter) fighter.abilityReadyAt = {};
}
