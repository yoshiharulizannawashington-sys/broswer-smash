// Fighter AI: personality + a pure decision function.
//
// The CPU used to make one generic set of choices: every fighter advanced the same way, at the same
// range, and spent specials on the same schedule. The roster has 34 identities with different
// specials, weights and damage, so the opponent felt the same no matter who you picked.
//
// Two ideas keep this honest:
//  * Personality is derived from data the game already has (combat profile, special type, whether
//    the fighter flies) with a small table of overrides for the characters whose identity is
//    obvious. Nothing invents equipment or stats; it only re-weights decisions.
//  * `decide()` is pure. It takes a snapshot and returns the same input shape the game already
//    consumes, so the behaviour can be tested without a renderer, and difficulty stays a
//    decision-quality knob rather than a damage multiplier.

export const ARCHETYPES = Object.freeze({
  aggressive: {
    id: 'aggressive', label: 'Aggressive',
    preferredRange: 1.7, attackRangeScale: 1.05, approachBias: 1.25, defenceBias: 0.9,
    specialBias: 1, ultimateBias: 1, retreatPercent: 165, aerialBias: 1, projectileDodge: 0.85
  },
  defensive: {
    id: 'defensive', label: 'Defensive',
    preferredRange: 3.3, attackRangeScale: 0.95, approachBias: 0.9, defenceBias: 1.35,
    specialBias: 0.85, ultimateBias: 1, retreatPercent: 105, aerialBias: 0.6, projectileDodge: 1.2
  },
  evasive: {
    id: 'evasive', label: 'Fast & evasive',
    preferredRange: 4.1, attackRangeScale: 0.9, approachBias: 0.8, defenceBias: 1.1,
    specialBias: 0.9, ultimateBias: 0.9, retreatPercent: 120, aerialBias: 1.1, projectileDodge: 1.45
  },
  heavy: {
    id: 'heavy', label: 'Heavy hitter',
    preferredRange: 1.9, attackRangeScale: 1.1, approachBias: 1.15, defenceBias: 1,
    specialBias: 0.75, ultimateBias: 1.15, retreatPercent: 175, aerialBias: 0.5, projectileDodge: 0.7
  },
  energy: {
    id: 'energy', label: 'Ranged energy',
    preferredRange: 6.8, attackRangeScale: 0.85, approachBias: 0.7, defenceBias: 1,
    specialBias: 1.45, ultimateBias: 1.1, retreatPercent: 135, aerialBias: 0.8, projectileDodge: 1.1
  }
});

/** Characters whose combat identity is not captured by the numeric profile alone. */
const OVERRIDES = Object.freeze({
  'the flash (barry allen)': 'evasive',
  'spider-man': 'evasive',
  'levi ackerman': 'evasive',
  'sasuke uchiha': 'evasive',
  'hulk (bruce banner)': 'heavy',
  'kratos': 'heavy',
  'thor': 'heavy',
  'arnold schwarzenegger': 'heavy',
  'professor x (charles xavier)': 'energy',
  'doctor strange': 'energy',
  'green lantern (hal jordan)': 'energy',
  'goku': 'energy',
  'vegeta': 'energy',
  'iron man (tony stark)': 'energy',
  'madara uchiha': 'energy',
  'lord voldemort': 'energy',
  'superman': 'aggressive',
  'all might': 'aggressive',
  'saitama': 'aggressive',
  'wonder woman': 'aggressive',
  'captain jack sparrow': 'defensive',
  'edna mode': 'defensive',
  'aquaman': 'defensive',
  'mario': 'defensive',
  'luigi': 'defensive',
  'link': 'defensive'
});

const RANGED_TYPES = new Set(['beam', 'orb', 'fireball', 'lightning', 'frost', 'curse', 'psychic', 'shockwave', 'web']);

const normalize = value => String(value || '').trim().toLowerCase();

/**
 * Resolve a fighter's personality from what the game knows about them.
 * Always returns a real archetype, so a new roster entry cannot end up without behaviour.
 */
export function personalityFor(identity, profile = {}, special = {}) {
  const key = normalize(identity);
  const override = OVERRIDES[key];
  if (override && ARCHETYPES[override]) return { ...ARCHETYPES[override], source: 'override' };

  const weight = Number(profile.weight) || 1;
  const damage = Number(profile.damage) || 1;
  const knockback = Number(profile.knockback) || 1;
  const type = normalize(special.type);

  if (weight >= 1.18) return { ...ARCHETYPES.heavy, source: 'weight' };
  if (RANGED_TYPES.has(type) && weight <= 1.08) return { ...ARCHETYPES.energy, source: 'special' };
  if (damage >= 1.1 || knockback >= 1.15) return { ...ARCHETYPES.aggressive, source: 'profile' };
  return { ...ARCHETYPES.defensive, source: 'default' };
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Neutral input, in the exact shape the game's controller already consumes. */
export function neutralInput() {
  return {
    left: false, right: false, up: false, down: false, run: false, sprint: false,
    jump: false, ascend: false, descend: false, dodge: false, attack: false, special: false,
    shield: false, parry: false, flightToggle: false, transform: false, ultimate: false,
    special2: false, special3: false
  };
}

/**
 * One decision. Pure: same snapshot and same `random` sequence always give the same answer.
 *
 * Snapshot fields (all optional, defaults are safe):
 *   distance, dx, dz          relative position of the opponent
 *   selfPercent, foePercent   damage percentages
 *   incoming                  true when a strike is in startup and within reaction range
 *   specialReady, ultimateMeter, transformReady, airborne, canFly, flightMode
 *   edgeDistance              metres to the nearest ring-out edge
 *   toCenterX, toCenterZ      direction back toward safety
 *   attackTimerReady          true when the AI's attack cooldown has elapsed
 */
export function decide(snapshot = {}, skill = {}, personality = ARCHETYPES.defensive, random = Math.random) {
  const out = neutralInput();
  const persona = personality || ARCHETYPES.defensive;
  const distance = Number(snapshot.distance) || 0;
  const dx = Number(snapshot.dx) || 0;
  const dz = Number(snapshot.dz) || 0;
  const selfPercent = Number(snapshot.selfPercent) || 0;
  const range = (Number(skill.range) || 3) * (persona.attackRangeScale || 1);
  const notice = Number(skill.notice) || 6;
  const hesitation = clamp(Number(skill.hesitation) || 0, 0, 1);

  // --- environmental awareness: never walk yourself out of the arena ---------
  const edge = Number(snapshot.edgeDistance);
  const huggingEdge = Number.isFinite(edge) && edge < 2.2;
  const toCenterX = Number(snapshot.toCenterX) || 0;
  const toCenterZ = Number(snapshot.toCenterZ) || 0;

  // --- distance management ---------------------------------------------------
  const desired = persona.preferredRange;
  const wantClose = distance > desired + 0.9;
  const wantSpace = distance < desired - 0.9;
  // A hurt fighter with a defensive or evasive style backs off instead of trading.
  const hurt = selfPercent >= persona.retreatPercent;
  const retreating = hurt && wantSpace && distance < 4.5;

  if (huggingEdge) {
    out.left = toCenterX < -0.35;
    out.right = toCenterX > 0.35;
    out.up = toCenterZ < -0.35;
    out.down = toCenterZ > 0.35;
    out.run = true;
  } else if (retreating) {
    out.left = dx > 0.35;
    out.right = dx < -0.35;
    out.up = dz > 0.35;
    out.down = dz < -0.35;
    out.run = true;
  } else if (wantClose) {
    out.left = dx < -1.1;
    out.right = dx > 1.1;
    out.up = dz < -1.1;
    out.down = dz > 1.1;
    out.run = distance > 4.5 * (2 - (persona.approachBias || 1));
    out.sprint = distance > 8;
  }

  // --- aerial play ----------------------------------------------------------
  const airborne = Boolean(snapshot.airborne);
  if (airborne) {
    out.jump = !snapshot.flightMode && Boolean(snapshot.canFly) && Number(snapshot.selfY || 0) < 1.5;
    if (snapshot.flightMode) {
      out.ascend = Number(snapshot.selfY || 0) < Number(snapshot.foeY || 0) + 0.8;
      out.descend = Number(snapshot.selfY || 0) > Number(snapshot.foeY || 0) + 2.4;
    }
  }

  // --- defence --------------------------------------------------------------
  const inDanger = Boolean(snapshot.incoming) && distance < notice;
  if (inDanger) {
    const defence = clamp((Number(skill.parry) || 0) * persona.defenceBias, 0, 1);
    const blockChance = clamp((Number(skill.block) || 0) * persona.defenceBias, 0, 1);
    const dodgeChance = clamp((Number(skill.dodge) || 0) * (persona.projectileDodge || 1), 0, 1);
    const roll = random();
    if (snapshot.parryReady !== false && roll < defence) out.parry = true;
    else if (roll < defence + blockChance) out.shield = true;
    else if (snapshot.dodgeReady !== false && roll < defence + blockChance + dodgeChance) out.dodge = true;
    // Defence spends the turn: do not attack into the same frame.
    return out;
  }

  // --- offence --------------------------------------------------------------
  if (snapshot.attackTimerReady !== false && distance <= range && random() > hesitation) {
    out.attack = true;
  }

  const specialReady = Boolean(snapshot.specialReady);
  // Kit abilities are spent at their own rhythm: a distinct mid-range tool, not a second signature.
  if (snapshot.altReady && distance > 1.6 && distance < 13 && !out.special
    && random() < clamp((Number(skill.special) || 0) * persona.specialBias * .8, 0, 1)) {
    out.special2 = true;
  }
  if (specialReady && distance > 2.6 && distance < 12 && random() < clamp((Number(skill.special) || 0) * persona.specialBias, 0, 1)) {
    out.special = true;
  }

  // Energy management: the meter is only spent when it is actually full, and a ranged fighter
  // prefers to spend it from a distance instead of on a clinch.
  const meter = Number(snapshot.ultimateMeter) || 0;
  const ultimateRange = persona.id === 'energy' ? distance > 4 && distance < 18 : distance > 1.4 && distance < 14;
  if (meter >= 100 && ultimateRange && random() < clamp((Number(skill.ultimate) || 0) * persona.ultimateBias, 0, 1)) {
    out.ultimate = true;
  }

  if (snapshot.transformReady && distance < 11 && random() < clamp((Number(skill.form) || 0) * 1.2, 0, 1)) {
    out.transform = true;
  }

  return out;
}
