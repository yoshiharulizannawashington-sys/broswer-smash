/**
 * Frame-data is authored at 60 simulation frames per second.
 * Frames are converted to seconds by the combat controller, not by the data.
 * Values are starter balance values and require playtesting.
 */
const DEFAULT_MOVES = {
  jab:         { clipName: 'attack_neutral',  startup: 4,  active: 3, recovery: 8,  damage: 5,  bkb: 10, kbs: 30,  angle: 45, radius: 1.5 },
  forwardTilt: { clipName: 'attack_forward',  startup: 8,  active: 4, recovery: 14, damage: 10, bkb: 25, kbs: 65, angle: 35, radius: 2.0 },
  upTilt:      { clipName: 'attack_up',       startup: 6,  active: 5, recovery: 12, damage: 8,  bkb: 30, kbs: 50, angle: 80, radius: 1.8 },
  downTilt:    { clipName: 'attack_down',     startup: 5,  active: 3, recovery: 10, damage: 7,  bkb: 15, kbs: 40, angle: 20, radius: 1.6 },
  special:     { clipName: 'attack_special',  startup: 14, active: 8, recovery: 22, damage: 18, bkb: 45, kbs: 95, angle: 50, radius: 2.8 }
};

const ARCHETYPE_OVERRIDES = {
  ninja: {
    jab: { startup: 3, active: 2, recovery: 6, damage: 4, bkb: 8, kbs: 25, radius: 1.4 },
    forwardTilt: { startup: 6, active: 3, recovery: 10, damage: 8, bkb: 20, kbs: 70, radius: 2.2 },
    upTilt: { startup: 5, active: 4, recovery: 9, damage: 7, bkb: 28, kbs: 55, angle: 85, radius: 1.9 },
    downTilt: { startup: 4, active: 3, recovery: 8, damage: 6, bkb: 12, kbs: 35, angle: 15, radius: 1.7 },
    special: { startup: 10, active: 6, recovery: 18, damage: 15, bkb: 40, kbs: 100, radius: 3.0 }
  },
  brute: {
    jab: { startup: 7, active: 4, recovery: 12, damage: 9, bkb: 20, kbs: 40, radius: 1.8 },
    forwardTilt: { startup: 12, active: 6, recovery: 20, damage: 16, bkb: 40, kbs: 85, radius: 2.5 },
    upTilt: { startup: 10, active: 5, recovery: 18, damage: 14, bkb: 45, kbs: 75, angle: 90, radius: 2.2 },
    downTilt: { startup: 9, active: 4, recovery: 15, damage: 12, bkb: 30, kbs: 60, angle: 25, radius: 2.0 },
    special: { startup: 20, active: 10, recovery: 30, damage: 25, bkb: 65, kbs: 120, radius: 3.5 }
  },
  speedster: {
    jab: { startup: 3, active: 2, recovery: 7, damage: 4, bkb: 8, kbs: 28, radius: 1.4 },
    forwardTilt: { startup: 6, active: 3, recovery: 11, damage: 7, bkb: 18, kbs: 68, radius: 2.0 },
    special: { startup: 9, active: 5, recovery: 20, damage: 12, bkb: 30, kbs: 90, radius: 2.6 }
  },
  tank: {
    jab: { startup: 6, active: 4, recovery: 12, damage: 8, bkb: 18, kbs: 42, radius: 1.8 },
    forwardTilt: { startup: 11, active: 6, recovery: 19, damage: 15, bkb: 38, kbs: 82, radius: 2.4 },
    special: { startup: 19, active: 9, recovery: 29, damage: 24, bkb: 60, kbs: 115, radius: 3.4 }
  }
};

function mergeMove(base, override) {
  return { ...base, ...(override || {}) };
}

function buildArchetype(overrides = {}) {
  return Object.fromEntries(
    Object.entries(DEFAULT_MOVES).map(([key, move]) => [
      key,
      mergeMove(move, overrides[key])
    ])
  );
}

// Roster archetypes not explicitly tuned below safely use the default timings.
export const MOVES_DATABASE = {
  default: buildArchetype(),
  ninja: buildArchetype(ARCHETYPE_OVERRIDES.ninja),
  brute: buildArchetype(ARCHETYPE_OVERRIDES.brute),
  speedster: buildArchetype(ARCHETYPE_OVERRIDES.speedster),
  tank: buildArchetype(ARCHETYPE_OVERRIDES.tank),
  armored: buildArchetype(),
  monk: buildArchetype(),
  caped: buildArchetype(),
  zoner: buildArchetype(),
  brawler: buildArchetype(),
  mage: buildArchetype(),
  cyborg: buildArchetype(),
  aquatic: buildArchetype(),
  pyro: buildArchetype(),
  engineer: buildArchetype(),
  gravity: buildArchetype(),
  colossus: buildArchetype(ARCHETYPE_OVERRIDES.brute),
  rogue: buildArchetype(ARCHETYPE_OVERRIDES.ninja),
  archer: buildArchetype(),
  gunner: buildArchetype(),
  knight: buildArchetype(ARCHETYPE_OVERRIDES.tank),
  trickster: buildArchetype(ARCHETYPE_OVERRIDES.speedster),
  techmage: buildArchetype(),
  golem: buildArchetype(ARCHETYPE_OVERRIDES.tank),
  jetpack: buildArchetype(ARCHETYPE_OVERRIDES.speedster),
  blade: buildArchetype(),
  cleric: buildArchetype(),
  mechbeast: buildArchetype(ARCHETYPE_OVERRIDES.brute),
  dancer: buildArchetype(ARCHETYPE_OVERRIDES.speedster),
  raider: buildArchetype(),
  blaster: buildArchetype(),
  hunting: buildArchetype(),
  berserker: buildArchetype(ARCHETYPE_OVERRIDES.brute),
  cosmic: buildArchetype(),
  exosuit: buildArchetype(),
  tinkerer: buildArchetype(),
  spinning: buildArchetype(),
  lancer: buildArchetype(ARCHETYPE_OVERRIDES.tank),
  street: buildArchetype(),
  clockwork: buildArchetype(),
  nature: buildArchetype(),
  pilot: buildArchetype(),
  animal: buildArchetype(ARCHETYPE_OVERRIDES.speedster),
  commander: buildArchetype(ARCHETYPE_OVERRIDES.tank),
  runeknight: buildArchetype(),
  runner: buildArchetype(ARCHETYPE_OVERRIDES.speedster),
  scourge: buildArchetype(),
  bard: buildArchetype(),
  assassin: buildArchetype(ARCHETYPE_OVERRIDES.ninja),
  paladin: buildArchetype(ARCHETYPE_OVERRIDES.tank),
  duo: buildArchetype()
};

export function getMovesForArchetype(archetype) {
  return MOVES_DATABASE[archetype] || MOVES_DATABASE.default;
}
