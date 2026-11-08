// Equipment state: one interface for everything a fighter carries, whatever the identity.
//
// The problem this exists to solve is not "hide weapons during specials". It is that a fighter has
// several independent holdables - a signature weapon in each hand and a world pickup blade - each
// mounted by a different system (models.js weapon holders, combat_items.js pickups), and none of
// them knew whether the current animation could physically hold them. A two-handed energy technique
// raised both arms and swept a 0.82 m blade across the character's face.
//
// So state is derived from what the body is actually doing, and every holdable answers the same
// question. Character policy is explicit and per identity, because a blade fighter must keep the
// weapon that IS the move: only identities whose signature needs both hands free stow equipment.
import * as THREE from 'three';

export const EQUIPMENT_STATES = Object.freeze({
  /** Normal carry: weapon in the hand, mounted exactly as the weapon system built it. */
  GRIP: 'grip',
  /** Two-handed technique in progress: both hands are needed, so holdables are stowed. */
  TWO_HANDED: 'two-handed',
  /** Deliberately off the body (documented, character-driven). */
  HIDDEN: 'hidden'
});

// Identities whose signature move is a two-handed energy/alchemy/ki technique. This is a design
// list, not a heuristic: every entry is a character decision, and a weapon-wielder like Thor,
// Wonder Woman, Link or Geralt is deliberately absent because the weapon IS their signature move.
// Iron Man is deliberately NOT in this list: his repulsor is a palm emitter on one hand, so a
// carried weapon can stay in the other. Stowing it during his own signature was the exact
// over-application this list exists to prevent.
export const ENERGY_SIGNATURES = new Set([
  'goku',
  'vegeta',
  'superman',
  'green_lantern_hal_jordan',
  'doctor_strange',
  'naruto_uzumaki',
  'sasuke_uchiha',
  'madara_uchiha',
  'hashirama_senju',
  'lord_voldemort',
  'professor_x_charles_xavier',
  'edward_elric',
  'all_might',
  'saitama',
  'aang'
]);

/** Every object a fighter is currently holding, from every mounting system, in one list. */
export function holdablesOf(model) {
  const userData = model?.userData;
  if (!userData) return [];
  return [userData.equippedWeaponRight, userData.equippedWeaponLeft, userData.pickupBlade]
    .filter(object => object && object.isObject3D);
}

/**
 * The state this fighter should be in right now, derived from animation and gameplay state.
 * Read-only: gameplay never consults equipment state for rules, so damage, reach and timing are
 * untouched by anything in this module.
 */
export function equipmentStateFor(fighter) {
  const userData = fighter?.model?.userData;
  if (!userData) return EQUIPMENT_STATES.GRIP;
  const key = String(fighter.identityKey || fighter.identity || '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  // The authored victory pose is itself a presentation request: Hulk raises that arm across his
  // face, so the gamma-knuckle is stowed for the celebration on every path that plays it (match
  // end, camera staging, replay), not only the one caller that remembered to set the flag.
  if (Number(fighter.victoryPose) > 0 && key === 'hulk_bruce_banner') return EQUIPMENT_STATES.HIDDEN;
  // Presentation can ask for clean hands. Hulk's gamma-knuckle gauntlet is a combat weapon, but the
  // authored victory pose raises that arm across the face, so the staged shot stows it. The flag is
  // set by the presentation only and cleared in reset(), so a live match never loses its weapon.
  if (userData.presentationHandsFree) return EQUIPMENT_STATES.HIDDEN;
  // The kit-ability window counts too. `authoredAbilityTime` is the new authored cast window
  // (Rasengan, Shadow Clone); without it a two-handed technique ran with the blade still gripped,
  // and the sword crossed the face - the exact defect this module exists to prevent.
  // Gated on the clip that is actually playing, not only on its countdown. The countdown drains in
  // real time while the mixer's clip advances in its own time, so the timer ran out several frames
  // before the pose did and the blade came back mid-technique (measured: visible again by frame 5 of
  // a 10-frame cast). The action's own running flag is the same signal the ladder uses to hold the
  // pose, so stowing and pose can no longer disagree.
  // Effective weight, not isRunning: the action still displaces the pose while it fades out, and
  // `isRunning()` is false the moment a clamped clip ends even though its weight is still applied
  // for the 0.13 s crossfade. Weight is the quantity the mixer actually uses to move the bones, so
  // the weapon is stowed for exactly as long as the technique visibly holds the hands.
  const abilityAction = userData.authoredAbilityAction;
  const abilityClipRunning = Boolean(abilityAction && (abilityAction.getEffectiveWeight?.() || 0) > 0.01);
  const twoHandedWindow = (userData.authoredSpecialTime || 0) > 0
    || (userData.specialPoseTime || 0) > 0
    || (userData.authoredAbilityTime || 0) > 0
    || abilityClipRunning;
  if (!twoHandedWindow) return EQUIPMENT_STATES.GRIP;
  return ENERGY_SIGNATURES.has(key) ? EQUIPMENT_STATES.TWO_HANDED : EQUIPMENT_STATES.GRIP;
}

const fadeTowards = (current, target, lambda, dt) => target + (current - target) * Math.exp(-lambda * dt);

/**
 * Apply the derived state, with a short fade so a weapon does not pop out of existence.
 *
 * Restoration is exact, not approximate: the first time an object is affected its visible flag and
 * uniform scale are recorded, and returning to GRIP writes those values back. A weapon the game
 * itself hid stays hidden.
 */
export function applyEquipmentState(fighter, dt = 0) {
  const model = fighter?.model;
  const userData = model?.userData;
  if (!userData) return null;
  const target = equipmentStateFor(fighter);
  const previous = userData.equipmentState;
  if (!previous || previous.state !== target) {
    userData.equipmentState = { state: target, since: Date.now() };
    // Diagnostics are browser-only: this module must also run under node for its tests.
    if (typeof window !== 'undefined') {
      window.__browserSmashAssets = window.__browserSmashAssets || {};
      window.__browserSmashAssets.equipment = window.__browserSmashAssets.equipment || {};
      window.__browserSmashAssets.equipment[fighter.identityKey || fighter.identity || 'fighter'] = {
        state: target,
        holdables: holdablesOf(model).map(object => object.name || object.type)
      };
    }
  }
  const stowed = target === EQUIPMENT_STATES.TWO_HANDED || target === EQUIPMENT_STATES.HIDDEN;
  for (const object of holdablesOf(model)) {
    if (!object.userData.equipmentOriginal) {
      object.userData.equipmentOriginal = { visible: object.visible, scale: object.scale.x };
    }
    const original = object.userData.equipmentOriginal;
    const currentFade = object.userData.equipmentFade ?? 1;
    const raw = dt > 0 ? fadeTowards(currentFade, stowed ? 0 : 1, 18, dt) : (stowed ? 0 : 1);
    // An exponential ease only approaches its target, so a restored weapon settled at 0.99997 of
    // its authored scale and stayed there. Snap once the fade is within a rounding of the target:
    // restoration is then exact rather than almost-exact, and repeated cycles cannot drift.
    const fade = stowed ? (raw < 0.02 ? 0 : raw) : (raw > 0.998 ? 1 : raw);
    object.userData.equipmentFade = fade;
    if (stowed && fade === 0) {
      object.visible = false;
      continue;
    }
    object.visible = original.visible;
    if (fade === 1) object.scale.setScalar(original.scale);
    else object.scale.setScalar(original.scale * (0.01 + 0.99 * fade));
  }
  return target;
}

/** Full equipment report for the asset/diagnostic surface. */
export function describeEquipment(fighter) {
  const model = fighter?.model;
  const userData = model?.userData;
  if (!userData) return null;
  return {
    state: userData.equipmentState?.state || EQUIPMENT_STATES.GRIP,
    weaponKind: userData.weaponKind || null,
    weaponLabel: userData.weaponLabel || null,
    holdables: holdablesOf(model).map(object => ({
      name: object.name || object.type,
      visible: object.visible,
      scale: Number(object.scale.x.toFixed(3))
    }))
  };
}

export { THREE };
