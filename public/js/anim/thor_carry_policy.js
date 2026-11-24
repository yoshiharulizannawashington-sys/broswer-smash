// Thor's intended Stormbreaker carry policy, defined independently of the implementation.
//
// This is the authoring contract the clips and the runtime carry overlay are judged against. It
// deliberately does not import THREE or mutate a fighter: the audit reads it, and weapon_carry.js
// can later implement it without the policy and the implementation disagreeing about the answer.
//
// A carry mode is about the OFFHAND. Stormbreaker is always held in the right hand; the question
// is whether the left hand is on the haft as a second grip or is free to balance, guard or cast.
//
//   one-handed          left hand is free for the whole state
//   two-handed          left hand is on the haft below the right hand for the whole state
//   two-handed-attack   left hand re-grips before the strike lands and releases during recovery
//   two-handed-charge   left hand braces the haft during the charge, releases for the cast
//
// The two-handed targets are expressed in the dominant hand's frame, because the haft moves with
// the authored swing. The left palm closes 0.105 m down the shaft from the right palm, 0.018 m to
// the left and 0.028 m forward. That is the same relationship the runtime solver uses, so a
// measured grip can be compared with the authored target instead of an arbitrary point in space.
//
// Windows are normalised to the clip or attack phase named by `timeline`:
//   attack  - fractions of the queued move's startup/active/recovery clock (move_data.js)
//   clip    - fractions of the clip's own duration (special / ultimate run their own clock)
//   seconds - wall-clock seconds from the state's entry
//
// The policy is intentionally stricter than "the hand brushes the weapon": contact must be within
// 0.10 m of the named haft geometry AND on the secondary-grip side of the right hand. A hand that
// happens to pass through the hammer head is not a two-handed grip.

export const THOR_CARRY_CONTACT = Object.freeze({
  maxGap: 0.10,
  freeGap: 0.12,
  secondaryDropMin: 0.035,
  secondaryDropMax: 0.32,
  // The authored solver's exact offset, kept here so a future implementation has one source.
  secondaryOffset: Object.freeze({ alongHaft: -0.105, left: 0.018, forward: 0.028 })
});

export const THOR_OFFHAND_TARGETS = Object.freeze({
  free: Object.freeze({
    kind: 'clear-of-haft',
    minGap: THOR_CARRY_CONTACT.freeGap,
    description: 'Left hand stays off the haft. The clip may guard, balance or gesture with it.'
  }),
  secondaryGrip: Object.freeze({
    kind: 'haft',
    maxGap: THOR_CARRY_CONTACT.maxGap,
    description: 'Left palm closes on the haft below the right palm, on the pommel side of the grip.',
    offset: THOR_CARRY_CONTACT.secondaryOffset
  })
});

const oneHanded = (clip, note, extra = {}) => Object.freeze({
  mode: 'one-handed',
  clip,
  offhand: 'free',
  note,
  ...extra
});
const twoHanded = (clip, note, extra = {}) => Object.freeze({
  mode: 'two-handed',
  clip,
  offhand: 'secondaryGrip',
  note,
  ...extra
});

export const THOR_CARRY_POLICY = Object.freeze({
  identity: 'thor',
  weapon: 'Stormbreaker',
  dominantHand: 'right',
  contact: THOR_CARRY_CONTACT,
  offhandTargets: THOR_OFFHAND_TARGETS,

  // Defaults for edges between a two-hand state and a free-hand state. A move-level window (the
  // block, slam, signature or ultimate row) overrides these; this is the floor for every other
  // transition. The offhand is never allowed to stay latched on the haft after the two-hand
  // technique has ended, and a new two-hand technique must re-grip inside its own authored window.
  transitionRules: Object.freeze({
    'two-handed-to-free': Object.freeze({
      release: Object.freeze({ timeline: 'seconds', from: 0, by: 0.10, after: 'state-exit' }),
      note: 'Release the offhand within 0.10 s of leaving a two-hand state.'
    }),
    'free-to-two-handed': Object.freeze({
      regrip: Object.freeze({ timeline: 'state-window', note: 'Use the target state\'s re-grip window.' }),
      note: 'Never snap the offhand onto the haft on the first frame; follow the target window.'
    })
  }),

  // Canonical fighter_state.js vocabulary plus the three clip-only action states Thor's body
  // actually owns. `canonical` records which gameplay state selects the clip when it differs.
  states: Object.freeze({
    idle: oneHanded('idle', 'Weapon hangs at the right side; left arm is the authored idle.'),

    walk: oneHanded('walk', 'Low one-hand carry; left arm swings free.'),
    run: oneHanded('run', 'Low one-hand carry; left arm counter-swings.', {
      clipVariants: Object.freeze(['run', 'sprint'])
    }),
    dash: oneHanded('dodge', 'The dash pose keeps the hammer in the right hand and the left hand free.'),

    jump: oneHanded('jump', 'One-hand carry through the takeoff.'),
    double_jump: oneHanded('jump', 'No dedicated double-jump clip on this body; jump is the fallback.', {
      clipFallback: true
    }),
    fall: oneHanded('jump', 'No dedicated fall clip on this body; jump is the fallback.', {
      clipFallback: true
    }),
    land: oneHanded('land', 'One-hand carry through touchdown.'),

    block: twoHanded('block', 'Guard braces Stormbreaker across the chest with both hands.', {
      regrip: Object.freeze({ timeline: 'seconds', from: 0, by: 0.15 }),
      release: Object.freeze({ timeline: 'seconds', from: 0, by: 0.10, after: 'state-exit' })
    }),

    charge: oneHanded('charge', 'One-hand ready while the form/power meter charges.'),
    dodge: oneHanded('dodge', 'The offhand is free to counterbalance the roll.'),

    hitstun: oneHanded('hit_light', 'Light reaction: the hammer stays in the right hand; no re-grip.'),
    launched: oneHanded('jump', 'Launched body keeps the one-hand carry; left arm flails free.', {
      clipFallback: true
    }),
    grabbed: oneHanded('hit_heavy', 'Being held does not put the left hand back on the haft.'),
    'guard-broken': oneHanded('knockdown', 'Guard break: the weapon is still in the right hand; left is free.'),
    knockdown: oneHanded('knockdown', 'Downed body keeps the hammer; the left hand is not gripping.'),
    get_up: oneHanded('get_up', 'Get-up returns to the one-hand carry without an offhand re-grip.'),
    ko: oneHanded('defeat', 'KO pose leaves the weapon in the right hand.'),

    flight: oneHanded('fly', 'Flight keeps Stormbreaker in the right hand; left arm steers.'),

    // Attack states are a router, not a mode. The actual mode belongs to the move in attackSlots.
    'attack-startup': Object.freeze({ mode: 'per-attack', offhand: 'per-attack' }),
    'attack-active': Object.freeze({ mode: 'per-attack', offhand: 'per-attack' }),
    'attack-recovery': Object.freeze({ mode: 'per-attack', offhand: 'per-attack' })
  }),

  // Every attack Thor can put on screen. The two-handed set is deliberately small: the authored
  // Bifrost Slam and signature are the only ground strikes built as overhead two-hand techniques.
  // Everything else is a one-hand hammer swing, kick, launcher or throw; forcing the offhand onto
  // the haft for those is what makes the light chain read as a two-hand axe rather than Thor.
  attackSlots: Object.freeze({
    light1: oneHanded('light1', 'Mjolnir Jab: right-hand hammer jab, left hand free.', { move: 'light1' }),
    light2: oneHanded('light2', 'Stormbreaker Cross: right-hand cross, left hand free.', { move: 'light2' }),
    light3: oneHanded('light3', 'Thunder Knee: kick with the hammer hand still on the shaft.', { move: 'light3' }),
    light4: oneHanded('light4', 'Fourth strike: knee/finisher setup, one hand.', { move: 'light4' }),
    finisher: oneHanded('light5', 'Fifth-hit finisher: one-hand hammer strike.', { move: 'finisher' }),
    heavy: oneHanded('heavy', 'Hammerfall: one-hand forward hammer blow.', { move: 'heavy' }),
    heavyLauncher: oneHanded('heavyLauncher', 'Heavy launcher: left-arm lift while the right hand keeps the haft.', { move: 'heavyLauncher' }),

    heavySlam: Object.freeze({
      mode: 'two-handed',
      clip: 'heavySlam',
      move: 'heavySlam',
      label: 'Bifrost Slam',
      offhand: 'secondaryGrip',
      note: 'Overhead two-hand slam. Re-grip during the second half of startup; release in recovery.',
      regrip: Object.freeze({ timeline: 'attack', phase: 'startup', from: 0.45, by: 1.0 }),
      hold: Object.freeze({ timeline: 'attack', from: 'startup-end', to: 'active-end' }),
      release: Object.freeze({ timeline: 'attack', phase: 'recovery', from: 0.10, by: 0.75 })
    }),

    special: Object.freeze({
      mode: 'two-handed',
      clip: 'special',
      label: 'Signature smash',
      offhand: 'secondaryGrip',
      note: 'Overhead signature smash. Both palms close before impact and hold through the hit.',
      timeline: 'clip',
      regrip: Object.freeze({ timeline: 'clip', from: 0.26, by: 0.36 }),
      hold: Object.freeze({ timeline: 'clip', from: 0.36, to: 0.44 }),
      release: Object.freeze({ timeline: 'clip', from: 0.44, by: 0.58 })
    }),

    ultimate: Object.freeze({
      mode: 'two-handed-charge',
      clip: 'ultimate',
      label: "Ragnarok's Wrath",
      offhand: 'secondaryGrip',
      note: 'Brace the haft overhead during the charge, then release the left hand into the storm cast.',
      timeline: 'clip',
      regrip: Object.freeze({ timeline: 'clip', from: 0.16, by: 0.20 }),
      hold: Object.freeze({ timeline: 'clip', from: 0.20, to: 0.40 }),
      release: Object.freeze({ timeline: 'clip', from: 0.40, by: 0.56 })
    }),

    air: oneHanded('air_attack', 'Aerial strike: one-hand hammer arc, left arm free for balance.'),
    airFinisher: oneHanded('air_attack', 'Aerial finisher uses the same one-hand air clip.'),
    counter: oneHanded('light2', 'Counter strike reuses the one-hand cross.', { move: 'counter' }),
    grab: oneHanded('grab', 'Grab reaches with the left hand while the right keeps Stormbreaker.', { move: 'grab' }),
    throw: oneHanded('throw', 'Throw releases the victim; the hammer stays in the right hand.')
  })
});

/** Every row, flattened for tables and reports. */
export function thorCarryRows() {
  const rows = [];
  for (const [state, row] of Object.entries(THOR_CARRY_POLICY.states)) {
    if (row.mode === 'per-attack') continue;
    rows.push({ kind: 'state', id: state, canonical: row.canonical || state, ...row });
  }
  for (const [slot, row] of Object.entries(THOR_CARRY_POLICY.attackSlots)) {
    rows.push({ kind: 'attack', id: slot, ...row });
  }
  return rows;
}
