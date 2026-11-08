// Per-character locomotion profiles.
//
// Movement used to be one generic table (walk 5.1 / run 8.8 / sprint 12.5 m/s, one acceleration,
// one jump impulse, one gravity) with two hard-coded identity checks inside Fighter3D.handleInput:
// The Flash and Spider-Man got a speed multiplier and nobody else did. That is a recoloured
// controller, not a movement identity: a 500 kg brawler and a speedster accelerated at exactly the
// same rate.
//
// Every identity on the launch roster now has an explicit profile here. A profile changes:
//   speed    walk / run / sprint top speed (m/s), arena and free-roam variants
//   accel    how hard the fighter pulls toward its top speed on the ground (damping lambda)
//   brake    how hard it stops when the stick is released on the ground
//   airAccel how hard it steers while airborne (air control)
//   airBrake how hard it bleeds horizontal speed in the air
//   jump     take-off impulse, and gravity (a heavy fighter rises less and falls harder)
//   turn     how fast it can commit to a direction reversal (>1 = pivots instantly, <1 = commits)
//
// The default tier reproduces the numbers the game shipped with, so a profile only changes the
// fighters it names and every existing movement assertion keeps its meaning. This module is pure
// data and math (no THREE, no DOM) so scripts/test-locomotion.mjs can assert the whole roster and
// simulate the real movement integration in node.

/** The tuned arena numbers every fighter starts from (the values the game shipped with). */
export const LOCOMOTION_BASE = Object.freeze({
  walk: 5.1, run: 8.8, sprint: 12.5,
  roamWalk: 6.8, roamRun: 10.8, roamSprint: 15.5,
  jump: 10.8, roamJump: 9.4,
  gravity: 24, roamGravity: 19,
  accel: 16, brake: 11, airAccel: 7, airBrake: 2.5,
  turn: 1
});

const round = value => Math.round(value * 1000) / 1000;

/**
 * Build a profile from a speed tier plus explicit overrides. `speed` scales the three ground
 * speeds and both roam variants together, which is how a fast fighter stays fast everywhere.
 */
function profile(speed = 1, overrides = {}) {
  const base = LOCOMOTION_BASE;
  return Object.freeze({
    walk: round(base.walk * speed),
    run: round(base.run * speed),
    sprint: round(base.sprint * speed),
    roamWalk: round(base.roamWalk * speed),
    roamRun: round(base.roamRun * speed),
    roamSprint: round(base.roamSprint * speed),
    jump: base.jump,
    roamJump: base.roamJump,
    gravity: base.gravity,
    roamGravity: base.roamGravity,
    accel: base.accel,
    brake: base.brake,
    airAccel: base.airAccel,
    airBrake: base.airBrake,
    turn: base.turn,
    ...overrides
  });
}

/** Default for an identity with no entry: the shipped numbers. */
export const DEFAULT_LOCOMOTION = profile(1);

/**
 * The launch roster, one entry each. Values are deliberate, not decorative:
 *  - The Flash is the fastest and pivots hardest, with a lower jump than a brawler.
 *  - Hulk and the other bruisers accelerate and brake slowly, jump high, and fall hard.
 *  - Armoured and armoured-flying fighters (Iron Man, Master Chief, Thor) are mid-speed with
 *    strong braking because thrusters and weight stop them, and weaker air steering that is made
 *    up for by flight.
 *  - The agile ninjas (Naruto, Sasuke, Levi, Spider-Man, Iron Spider, Link, Kaze) have the best
 *    air control in the game.
 */
export const LOCOMOTION = Object.freeze({
  // ---- DC / science / cosmic
  superman: profile(1.06, { accel: 17, brake: 12, airAccel: 8.4, jump: 11.6, turn: 1.05 }),
  iron_man_tony_stark: profile(.98, { accel: 15, brake: 13.5, airAccel: 6.2, jump: 10.2, turn: .9 }),
  hulk_bruce_banner: profile(.92, { accel: 10.5, brake: 6.5, airAccel: 4.6, airBrake: 1.6, jump: 12.6, gravity: 27, turn: .62 }),
  green_lantern_hal_jordan: profile(1, { accel: 15.5, brake: 11.5, airAccel: 7.6, jump: 10.6 }),
  wonder_woman: profile(1.04, { accel: 18, brake: 12, airAccel: 7.8, jump: 11.2, turn: 1.08 }),
  professor_x_charles_xavier: profile(.74, { accel: 9, brake: 8.5, airAccel: 3.4, jump: 8, gravity: 22, turn: .7 }),
  the_flash_barry_allen: profile(1.24, { accel: 23, brake: 17, airAccel: 9.2, jump: 10.4, turn: 1.5 }),
  aquaman: profile(1, { accel: 14.5, brake: 10.5, airAccel: 6.6, jump: 10.8, turn: .92 }),
  doctor_strange: profile(.96, { accel: 14.5, brake: 11, airAccel: 7.8, jump: 11, turn: .95 }),
  arnold_schwarzenegger: profile(.94, { accel: 12, brake: 8, airAccel: 5, jump: 10.2, gravity: 26, turn: .72 }),
  // ---- anime
  goku: profile(1.08, { accel: 19, brake: 13.5, airAccel: 9, jump: 11.8, turn: 1.15 }),
  naruto_uzumaki: profile(1.1, { accel: 19.5, brake: 13, airAccel: 9.4, jump: 11.4, turn: 1.2 }),
  vegeta: profile(1.06, { accel: 18.5, brake: 13, airAccel: 8.6, jump: 11.4, turn: 1.1 }),
  saitama: profile(1, { accel: 15, brake: 12, airAccel: 6.4, jump: 11.2, turn: .88 }),
  l_death_note_style: profile(.86, { accel: 11, brake: 9, airAccel: 4.2, jump: 9.2, gravity: 23, turn: .8 }),
  all_might: profile(1.02, { accel: 14, brake: 9.5, airAccel: 6, jump: 11.8, gravity: 25.5, turn: .85 }),
  edward_elric: profile(1, { accel: 16.5, brake: 12, airAccel: 7.4, jump: 10.8, turn: 1.05 }),
  levi_ackerman: profile(1.12, { accel: 21, brake: 15, airAccel: 9.6, jump: 11.6, turn: 1.3 }),
  // ---- stylised platform fighters
  mario: profile(1.02, { accel: 18, brake: 14, airAccel: 8.6, jump: 12.2, gravity: 23, turn: 1.25 }),
  luigi: profile(1.04, { accel: 17, brake: 13, airAccel: 9, jump: 12.8, gravity: 21.5, turn: 1.12 }),
  // ---- heavy melee
  kratos: profile(.98, { accel: 12.5, brake: 8.5, airAccel: 5.2, jump: 10.6, gravity: 26, turn: .7 }),
  link: profile(1.02, { accel: 17, brake: 12.5, airAccel: 8, jump: 11, turn: 1.05 }),
  master_chief: profile(.96, { accel: 12, brake: 9.5, airAccel: 5.4, jump: 10.4, gravity: 26, turn: .78 }),
  thor: profile(1.02, { accel: 13.5, brake: 9, airAccel: 6.4, jump: 11.4, gravity: 26, turn: .8 }),
  // ---- elemental / magic
  aang: profile(1.06, { accel: 20, brake: 13, airAccel: 10.4, airBrake: 3.4, jump: 11.6, gravity: 20, turn: 1.2 }),
  madara_uchiha: profile(1.04, { accel: 16, brake: 11, airAccel: 8, jump: 11.2, turn: .95 }),
  hashirama_senju: profile(.98, { accel: 13, brake: 9, airAccel: 6, jump: 11, gravity: 25, turn: .82 }),
  lord_voldemort: profile(.9, { accel: 12.5, brake: 10, airAccel: 5.2, jump: 9.8, gravity: 24, turn: .85 }),
  sasuke_uchiha: profile(1.1, { accel: 20, brake: 14, airAccel: 9.2, jump: 11.2, turn: 1.22 }),
  // ---- specialists
  edna_mode: profile(.88, { accel: 13, brake: 12, airAccel: 5.6, jump: 9.4, gravity: 23, turn: 1 }),
  captain_jack_sparrow: profile(.97, { accel: 14, brake: 9.5, airAccel: 6.2, jump: 10.4, turn: .86 }),
  spider_man: profile(1.08, { accel: 21, brake: 15, airAccel: 10.2, airBrake: 3.2, jump: 12, turn: 1.3 }),
  iron_spider: profile(1.07, { accel: 20, brake: 14.5, airAccel: 9.8, airBrake: 3, jump: 11.8, turn: 1.25 }),
  // ---- recovered launch promotions
  wolverine_logan: profile(1.0, { accel: 18, brake: 13, airAccel: 8, jump: 11, turn: 1.12 }),
  geralt_of_rivia: profile(.98, { accel: 15.5, brake: 11, airAccel: 7, jump: 10.8, turn: .98 }),
  doom_slayer: profile(.94, { accel: 12.5, brake: 8.5, airAccel: 5.4, jump: 11.4, gravity: 26, turn: .78 }),
  // ---- grounded rifleman
  infantry: profile(.94, { accel: 13.5, brake: 10.5, airAccel: 5.2, jump: 10.2, gravity: 25, turn: .84 }),
  // ---- original reference fighter
  kaze: profile(1.05, { accel: 19, brake: 14, airAccel: 9.4, jump: 11.4, turn: 1.18 })
});

/**
 * Locomotion for a fighter. An identity with no explicit entry falls back to its archetype's
 * tier, so a DLC identity added later still moves sensibly instead of standing still - but
 * scripts/test-locomotion.mjs fails if any launch-roster identity is relying on that fallback.
 */
export function locomotionFor(fighter) {
  const id = String(fighter?.identityKey || '').toLowerCase();
  if (LOCOMOTION[id]) return LOCOMOTION[id];
  const archetype = String(fighter?.archetype || '').toLowerCase();
  if (ARCHETYPE_LOCOMOTION[archetype]) return ARCHETYPE_LOCOMOTION[archetype];
  return DEFAULT_LOCOMOTION;
}

/** Archetype fallbacks for identities that are not on the launch roster. */
export const ARCHETYPE_LOCOMOTION = Object.freeze({
  warrior: profile(1, { accel: 15.5, brake: 11, airAccel: 7 }),
  ninja: profile(1.08, { accel: 19, brake: 13.5, airAccel: 9 }),
  brawler: profile(.95, { accel: 12.5, brake: 8.5, airAccel: 5.4, jump: 11.6, gravity: 26 }),
  mage: profile(.94, { accel: 13.5, brake: 10.5, airAccel: 6, jump: 10, gravity: 23 }),
  cyborg: profile(.98, { accel: 14, brake: 11, airAccel: 6, jump: 10.4 })
});

/** Top speed for a movement mode. `mode` is 'walk' | 'run' | 'sprint'. */
export function speedTarget(profile, { mode = 'walk', roam = false } = {}) {
  const table = roam
    ? { walk: profile.roamWalk, run: profile.roamRun, sprint: profile.roamSprint }
    : { walk: profile.walk, run: profile.run, sprint: profile.sprint };
  return table[mode] ?? table.walk;
}

/** Take-off impulse. */
export function jumpImpulse(profile, { roam = false } = {}) {
  return roam ? profile.roamJump : profile.jump;
}

/** Downward acceleration (the game uses a fixed gravity rather than a fall-speed cap). */
export function gravityFor(profile, { roam = false } = {}) {
  return roam ? profile.roamGravity : profile.gravity;
}

/**
 * The real integration the fighter uses for horizontal movement: damp the current velocity toward
 * a target at a per-character rate. Exported so the movement math can be simulated and asserted in
 * node instead of only being observed in the browser.
 */
export function dampVelocity(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/**
 * Steering rate for a movement command. Holding the same direction you are already moving uses the
 * plain acceleration; turning against your own momentum multiplies it by the fighter's `turn`
 * factor, which is what stops an armoured heavyweight from pivoting like a speedster.
 */
export function steerRate(profile, { grounded = true, reversing = false } = {}) {
  const base = grounded ? profile.accel : profile.airAccel;
  return reversing ? base * (Number(profile.turn) > 0 ? Number(profile.turn) : 1) : base;
}
