// Frame-based move data for the two-fighter combat pipeline.
//
// Every attack is described here once, in 60 Hz frames, and Fighter3D queues the result of
// `buildAttack`. The simulation runs a fixed 1/60 s step (see simulationStep in main.js), so a
// frame is exactly `FRAME` seconds; nothing in this file or in the fighter mixes frames and
// seconds. `start`/`end`/`total` on the queued attack are seconds derived from these frames.
//
// Archetypes keep their old feel (`windup`, `damage`, `reach`, `combo`) and a character can add
// a small move profile on top (startup/reach/knockback only — damage already comes from
// COMBAT_PROFILES in main.js, so scaling it here too would double-count).

export const FPS = 60;
export const FRAME = 1 / FPS;
/** Convert a frame count to seconds. The only unit conversion in the combat data. */
export const seconds = frames => frames * FRAME;

/** Per-archetype flavour, matching the pre-move-data style table. */
export const ARCHETYPE_STYLES = Object.freeze({
  warrior: { reach: 1.65, damage: 1.12, windup: 1, combo: .82 },
  ninja: { reach: 1.8, damage: .86, windup: .72, combo: .88 },
  brawler: { reach: 1.5, damage: 1.32, windup: 1.18, combo: .86 },
  mage: { reach: 1.72, damage: 1.02, windup: 1.02, combo: .84 },
  cyborg: { reach: 1.7, damage: 1.04, windup: .84, combo: .82 },
  webslinger: { reach: 1.75, damage: .94, windup: .72, combo: .9 }
});

const DEFAULT_STYLE = { reach: 1.6, damage: 1, windup: 1, combo: .82 };

/**
 * The move table. `frames: [startup, active, recovery]`; `reach` is a multiplier of the
 * archetype reach unless `reachAbsolute` is given. `armor` marks the only moves allowed to eat
 * a light hit without losing their state (heavy and the 3-hit finisher, active frames only).
 */
export const MOVES = Object.freeze({
  light1: {
    id: 'light1', label: 'Jab', frames: [4, 8, 9], damage: 9, kbs: 80, launchY: 3.4,
    reach: 1, radius: 1.2, kind: 'melee'
  },
  light2: {
    id: 'light2', label: 'Second jab', frames: [4, 8, 9], damage: 10, kbs: 84, launchY: 3.4,
    reach: 1, radius: 1.2, kind: 'melee'
  },
  light3: {
    id: 'light3', label: 'Third strike', frames: [4, 7, 9], damage: 8, kbs: 78, launchY: 3.2,
    reach: .98, radius: 1.15, kind: 'melee'
  },
  light4: {
    id: 'light4', label: 'Fourth strike', frames: [5, 8, 10], damage: 11, kbs: 88, launchY: 3.6,
    reach: 1.05, radius: 1.25, kind: 'melee'
  },
  finisher: {
    id: 'finisher', label: 'Finisher', frames: [9, 10, 14], damage: 20, kbs: 112, launchY: 8.6,
    reach: 1.42, radius: 2.45, kind: 'heavy', launcher: true, armor: true
  },
  heavy: {
    id: 'heavy', label: 'Heavy strike', frames: [9, 10, 14], damage: 17, kbs: 112, launchY: 3.4,
    reach: 1, radius: 1.35, kind: 'heavy', armor: true
  },
  // UP+heavy is a real launcher and DOWN+heavy is a real ground slam: one `heavy` move meant every
  // character's "three heavies" were three names on one hitbox. The launcher trades damage for the
  // highest launch in the grounded kit; the slam trades speed for reach and a forward commit.
  heavyLauncher: {
    id: 'heavyLauncher', label: 'Launcher', frames: [8, 9, 16], damage: 14, kbs: 96, launchY: 11.8,
    reach: 1.12, radius: 1.5, kind: 'heavy', launcher: true, armor: true
  },
  heavySlam: {
    id: 'heavySlam', label: 'Ground slam', frames: [11, 12, 18], damage: 19, kbs: 132, launchY: 2.8,
    reach: 1.2, radius: 1.7, kind: 'slam', armor: true
  },
  antiAir: {
    id: 'antiAir', label: 'Anti-air', frames: [4, 8, 9], damage: 9, kbs: 80, launchY: 10.4,
    reach: 1, radius: 1.48, kind: 'anti-air', launcher: true
  },
  air: {
    id: 'air', label: 'Air strike', frames: [5, 14, 7], damage: 10.08, kbs: 89.6, launchY: 7.2,
    reachAbsolute: 4.6, radius: 2.05, kind: 'air-strike', aerial: true
  },
  airFinisher: {
    id: 'airFinisher', label: 'Air finisher', frames: [5, 19, 9], damage: 22.4, kbs: 125.4,
    launchY: 11.2, reachAbsolute: 6, radius: 2.45, kind: 'air-finisher', aerial: true, armor: true
  },
  dive: {
    id: 'dive', label: 'Dive kick', frames: [5, 14, 7], damage: 10.08, kbs: 89.6, launchY: 7.2,
    reachAbsolute: 4.6, radius: 1.5, kind: 'dive-kick', aerial: true
  },
  counter: {
    id: 'counter', label: 'Counter strike', frames: [2, 18, 13], damage: 12.78, kbs: 147.8,
    launchY: 9.2, reach: 1.35, radius: 1.35, kind: 'counter-strike', launcher: true, armor: true
  },
  grab: {
    id: 'grab', label: 'Grab', frames: [6, 10, 13], damage: 16, kbs: 126, launchY: 9.4,
    reachAbsolute: 1.45, radius: 1.05, kind: 'grab'
  }
});

/** Grab timing: the throw resolves after a short hold, and the victim can struggle out of it. */
export const GRAB = Object.freeze({
  hold: .2,            // seconds the victim is held before the throw lands
  escapeWindow: .2,    // window in which an attack/dodge/jump input escapes the hold
  escapeCooldown: .45  // the grabber cannot immediately re-grab an escaped victim
});

/** Reach of a weapon, added in metres to the archetype reach. */
export const WEAPON_REACH = Object.freeze({
  sword: .42, katana: .5, cyber_blade: .48, giant_sword: .8, scimitar: .46, trident: .62,
  staff: .38, axe: .5, hammer: .42, war_fan: .34, whip: 1.15, tentacle: .62, knife: .22,
  claws: .24, nunchaku: .42
});

/**
 * Small per-character overrides on top of the archetype. These only change timing, reach and
 * knockback; damage numbers live in COMBAT_PROFILES (main.js) and the move table above.
 */
// The keys are identity slugs - the same slug the roster, the character manifest and the mounted
// body file use. `hulk` and `iron_man` used to be listed here and could never match the real keys
// `hulk_bruce_banner` / `iron_man_tony_stark`, so the Hulk's slower startup and heavier knockback
// were dead data that never applied. Every launch identity now has its own entry and
// scripts/test-locomotion.mjs fails if a key is not a real roster identity.
export const CHARACTER_MOVE_PROFILES = Object.freeze({
  // DC / cosmic
  superman: { startup: 1.02, reach: 1.02, kbs: 1.08 },
  iron_man_tony_stark: { startup: 1.04, reach: 1.03, kbs: 1.05 },
  hulk_bruce_banner: { startup: 1.22, reach: 1.05, kbs: 1.2 },
  green_lantern_hal_jordan: { startup: .96, reach: 1.06, kbs: 1 },
  wonder_woman: { startup: .96, reach: 1.04, kbs: 1.06 },
  professor_x_charles_xavier: { startup: 1.1, reach: 1.14, kbs: 1.02 },
  the_flash_barry_allen: { startup: .7, reach: .96, kbs: .95 },
  aquaman: { startup: .98, reach: 1.12, kbs: 1.04 },
  doctor_strange: { startup: 1, reach: 1.06, kbs: 1.02 },
  arnold_schwarzenegger: { startup: 1.06, reach: 1.02, kbs: 1.12 },
  // anime
  goku: { startup: .88, reach: 1.04, kbs: 1.02 },
  naruto_uzumaki: { startup: .86, reach: 1, kbs: 1 },
  vegeta: { startup: .92, reach: 1.02, kbs: 1.06 },
  saitama: { startup: .8, reach: 1.02, kbs: 1.15 },
  l_death_note_style: { startup: 1.14, reach: 1.02, kbs: .92 },
  all_might: { startup: 1.04, reach: 1.03, kbs: 1.14 },
  edward_elric: { startup: .96, reach: 1.02, kbs: 1 },
  levi_ackerman: { startup: .84, reach: 1.14, kbs: .98 },
  // stylised
  mario: { startup: .94, reach: .98, kbs: 1.02 },
  luigi: { startup: 1, reach: 1.06, kbs: 1 },
  // heavy melee
  kratos: { startup: 1.08, reach: 1.12, kbs: 1.12 },
  link: { startup: .95, reach: 1.16, kbs: 1.02 },
  master_chief: { startup: 1.02, reach: 1.06, kbs: 1.08 },
  thor: { startup: 1.06, reach: 1.14, kbs: 1.14 },
  // elemental / magic
  aang: { startup: .92, reach: 1.08, kbs: .98 },
  madara_uchiha: { startup: .98, reach: 1.06, kbs: 1.06 },
  hashirama_senju: { startup: 1.04, reach: 1.1, kbs: 1.1 },
  lord_voldemort: { startup: 1, reach: 1.08, kbs: 1.02 },
  sasuke_uchiha: { startup: .88, reach: 1.06, kbs: 1 },
  // specialists
  edna_mode: { startup: .9, reach: .96, kbs: .9 },
  captain_jack_sparrow: { startup: .92, reach: 1.14, kbs: .98 },
  spider_man: { startup: .9, reach: 1.08, kbs: .98 },
  iron_spider: { startup: .94, reach: 1.06, kbs: 1.02 },
  wolverine_logan: { startup: .86, reach: .98, kbs: 1.04 },
  geralt_of_rivia: { startup: .94, reach: 1.1, kbs: 1.04 },
  doom_slayer: { startup: 1.08, reach: 1.06, kbs: 1.16 },
  kaze: { startup: .9, reach: 1.02, kbs: 1 },
  infantry: { startup: 1.02, reach: 1.04, kbs: 1.02 }
});

/** Resolve the style for a fighter (archetype table plus the webslinger exception). */
export function styleFor(fighter) {
  if (fighter?.canWebSwing) return ARCHETYPE_STYLES.webslinger;
  return ARCHETYPE_STYLES[fighter?.archetype] || DEFAULT_STYLE;
}

/** Per-character move profile, defaulting to neutral multipliers. */
export function moveProfileFor(fighter) {
  return CHARACTER_MOVE_PROFILES[fighter?.identityKey] || {};
}

/**
 * Pick the move for an input context. Order matters: a counter hit beats a directional
 * move, an air move beats a ground move, and the third hit of a grounded string becomes the
 * launcher finisher.
 */
export function resolveMoveId({ aerial = false, finisher, heavy = false, heavyVariant = 'forward', antiAir = false, dive = false, countering = false, comboStep = 1, airFinisher } = {}) {
  if (countering) return 'counter';
  // The third grounded hit is the finisher unless the caller says otherwise, so a caller can
  // pass only the chain step and still get the right move.
  const chainFinisher = finisher != null ? finisher : comboStep >= 5;
  if (aerial) {
    if (dive) return 'dive';
    return (airFinisher != null ? airFinisher : chainFinisher) ? 'airFinisher' : 'air';
  }
  if (antiAir) return 'antiAir';
  if (heavy) {
    if (heavyVariant === 'launcher') return 'heavyLauncher';
    if (heavyVariant === 'slam') return 'heavySlam';
    return 'heavy';
  }
  if (chainFinisher) return 'finisher';
  if (comboStep >= 4) return 'light4';
  if (comboStep >= 3) return 'light3';
  return comboStep >= 2 ? 'light2' : 'light1';
}

/**
 * Build the queued-attack object Fighter3D consumes.
 *
 * Times are seconds. `start`/`end` are the active window in which the single hitbox is spawned;
 * `total` includes recovery, so an attack always has a defined, finite return to neutral.
 */
export function buildAttack({
  moveId,
  fighter,
  comboStep = 1,
  aerial = false,
  countering = false,
  antiAir = false,
  dive = false,
  itemMultiplier = 1,
  weaponReachBonus = 0,
  profile
} = {}) {
  const move = MOVES[moveId] || MOVES.light1;
  const style = styleFor(fighter);
  const moveProfile = profile || moveProfileFor(fighter);
  const combatProfile = fighter?.combatProfile || { damage: 1, knockback: 1, launch: 1 };
  const windup = style.windup * (moveProfile.startup || 1);
  const [startup, active, recovery] = move.frames;
  const start = seconds(startup) * windup;
  const end = seconds(startup + active) * windup;
  const total = seconds(startup + active + recovery) * windup;

  const baseReach = move.reachAbsolute != null ? move.reachAbsolute : style.reach * move.reach;
  const reach = (baseReach + weaponReachBonus * (aerial ? .62 : 1)) * (moveProfile.reach || 1) + (countering ? .25 : 0);

  const damage = move.damage * style.damage
    * (aerial ? 1.12 : 1)
    * (countering ? 1.42 : 1)
    * itemMultiplier;

  const kbs = move.kbs
    * (fighter?.archetype === 'brawler' ? 1.15 : 1)
    * (combatProfile.knockback || 1)
    * (aerial ? 1.12 : 1)
    * (countering ? 1.32 : 1)
    * (moveProfile.kbs || 1);

  return {
    id: move.id,
    label: move.label,
    kind: move.kind,
    total,
    t: 0,
    start,
    end,
    damage: damage * (combatProfile.damage || 1),
    reach,
    kbs,
    radius: move.radius,
    aerial,
    launcher: !!move.launcher || (!aerial && countering),
    antiAir,
    dive,
    countering,
    armor: !!move.armor,
    armorFrom: start,
    armorTo: end,
    launchY: (move.launchY || 3.4) * (combatProfile.launch || 1),
    comboStep,
    weaponKind: fighter?.model?.userData?.weaponKind || 'unarmed',
    hit: false
  };
}

/**
 * Whether a queued move may be interrupted by a new attack while it is still resolving.
 * Only recovery frames are cancellable, and only along the documented chain.
 */
export const CANCELS = Object.freeze({
  light1: ['light2', 'heavy', 'finisher', 'antiAir', 'grab'],
  light2: ['light3', 'finisher', 'heavy', 'antiAir', 'grab'],
  light3: ['light4', 'heavy', 'finisher', 'antiAir', 'grab'],
  light4: ['finisher', 'heavy', 'antiAir', 'grab'],
  finisher: ['grab'],
  heavy: ['grab'],
  heavyLauncher: ['grab'],
  heavySlam: ['grab'],
  antiAir: ['light2', 'grab'],
  air: ['airFinisher', 'air', 'dive'],
  airFinisher: [],
  dive: [],
  counter: ['grab'],
  grab: []
});

/** True when `next` may cancel `current` during the latter's recovery. */
export function canCancel(current, next) {
  if (!current) return true;
  const list = CANCELS[current];
  return Array.isArray(list) && list.includes(next);
}
