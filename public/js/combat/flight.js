// Flight physics for the aerial movement mode.
//
// Flight shipped as a vertical assist: the fighter left the ground, but horizontal motion still
// came from the ordinary air-control numbers (weak thrust, weak brake) and the only flight input
// was ascend / descend. That is a jump with a flying animation, not a movement mode: a fighter
// could not strafe at speed, could not brake, and every character flew identically.
//
// This module owns the numbers. It is pure data and math (no THREE, no DOM) so
// scripts/test-flight.mjs can assert the physics in node, and Fighter3D only integrates it.
//
//   cruise / boost     horizontal top speed, and with the sprint key held
//   thrust             how hard the fighter pulls toward its horizontal target
//   brake              how hard it stops with the brake key or with no direction held
//   airResist          passive damping on all three axes, so nothing glides forever
//   climb / descend    vertical target speed; climbBoost with sprint held
//   hover              damping that holds altitude when neither ascend nor descend is pressed
//   ceiling            how high the mode is allowed to leave the floor

export const FLIGHT_BASE = Object.freeze({
  cruise: 15, boost: 21,
  thrust: 7, boostThrust: 8.5, brake: 9,
  airResist: 0.6,
  climb: 8.5, climbBoost: 13, climbDamp: 5.5, descend: 8,
  hover: 3.4,
  ceiling: 14, roamCeiling: 72,
  takeoff: 4.6
});

const round = value => Math.round(value * 1000) / 1000;

/**
 * A flight profile from a speed factor plus explicit overrides. The factor scales cruise, boost,
 * climb and descend together, so a fast flyer is fast in every direction instead of only forward.
 */
function profile(cruise = 1, overrides = {}) {
  const base = FLIGHT_BASE;
  return Object.freeze({
    cruise: round(base.cruise * cruise),
    boost: round(base.boost * cruise),
    climb: round(base.climb * cruise),
    climbBoost: round(base.climbBoost * cruise),
    descend: round(base.descend * Math.max(.8, cruise)),
    thrust: base.thrust,
    boostThrust: base.boostThrust,
    brake: base.brake,
    airResist: base.airResist,
    climbDamp: base.climbDamp,
    hover: base.hover,
    ceiling: base.ceiling,
    roamCeiling: base.roamCeiling,
    takeoff: base.takeoff,
    ...overrides
  });
}

/**
 * Flight identities. Values are deliberate:
 *  - Goku, Vegeta, Superman and the speedsters cruise fast and climb hard.
 *  - Iron Man is the most controllable: strong thrust and the strongest brake, so a thruster
 *    fighter stops where it is pointed instead of drifting through a corner.
 *  - Hulk flies like a thrown object: fast in a straight line, poor climbing, slow to stop.
 *  - Aang and the airbenders float: high climb, high brake, low top speed.
 */
export const FLIGHT = Object.freeze({
  goku: profile(1.16, { climb: 9.6, hover: 3.8 }),
  vegeta: profile(1.12, { climb: 9.2 }),
  superman: profile(1.24, { climb: 10.4, thrust: 7.6 }),
  iron_man_tony_stark: profile(1.04, { thrust: 9.2, boostThrust: 10.5, brake: 12.5, climb: 8.8 }),
  iron_spider: profile(1.02, { thrust: 8.6, brake: 11, climb: 8.6 }),
  hulk_bruce_banner: profile(.82, { climb: 6.4, brake: 4.6, thrust: 4.8, turn: .7 }),
  the_flash_barry_allen: profile(1.32, { thrust: 9, brake: 10.5 }),
  wonder_woman: profile(1.08, { climb: 9 }),
  green_lantern_hal_jordan: profile(1.06, { brake: 10, thrust: 8 }),
  thor: profile(1.02, { climb: 8.8, brake: 8.4 }),
  aang: profile(1, { climb: 11.5, brake: 12, cruise: 13.5, boost: 18 }),
  naruto_uzumaki: profile(1.1),
  sasuke_uchiha: profile(1.1, { brake: 10 }),
  madara_uchiha: profile(1.08, { climb: 9.4 }),
  saitama: profile(1.06, { brake: 8 }),
  kaze: profile(1.1, { brake: 10.5 }),
  spider_man: profile(1.04, { thrust: 8.4, brake: 11 }),
  doctor_strange: profile(1, { climb: 9.8, hover: 4.2 }),
  aquaman: profile(.98),
  master_chief: profile(.92, { brake: 7 }),
  kratos: profile(.9, { climb: 7.4, brake: 7 }),
  arnold_schwarzenegger: profile(.9, { climb: 7, brake: 6.6 })
});

/** Flight for a fighter, falling back to archetype and then to the base profile. */
export function flightFor(fighter) {
  const id = String(fighter?.identityKey || '').toLowerCase();
  if (FLIGHT[id]) return FLIGHT[id];
  const archetype = String(fighter?.archetype || '').toLowerCase();
  if (ARCHETYPE_FLIGHT[archetype]) return ARCHETYPE_FLIGHT[archetype];
  return DEFAULT_FLIGHT;
}

export const DEFAULT_FLIGHT = profile(1);

/** Archetype fallbacks, so an identity added later still flies like its kind. */
export const ARCHETYPE_FLIGHT = Object.freeze({
  warrior: profile(1, { climb: 8.8 }),
  ninja: profile(1.08, { brake: 10 }),
  brawler: profile(.88, { climb: 7.2, brake: 6 }),
  mage: profile(1, { climb: 9.6 }),
  cyborg: profile(1, { thrust: 8.4, brake: 10 })
});

/** Horizontal top speed, with the sprint key treated as a boost. */
export function flightSpeed(f, { boost = false } = {}) {
  return boost ? f.boost : f.cruise;
}

/** Damping lambda for pulling toward the horizontal target. Braking always wins. */
export function flightThrust(f, { boost = false, braking = false } = {}) {
  if (braking) return f.brake;
  return boost ? f.boostThrust : f.thrust;
}

/** Vertical target speed: climb, boost-climb, descend, or zero to hold altitude. */
export function flightVerticalTarget(input = {}, f = DEFAULT_FLIGHT) {
  if (input.ascend) return input.sprint || input.run ? f.climbBoost : f.climb;
  if (input.descend) return -f.descend;
  return 0;
}

/** Damping lambda for the vertical axis: thrusting is snappier than holding a hover. */
export function flightVerticalLambda(input = {}, f = DEFAULT_FLIGHT) {
  return input.ascend || input.descend ? (f.climbDamp ?? FLIGHT_BASE.climbDamp) : f.hover;
}

/** Target horizontal velocity for a normalized stick direction. */
export function flightHorizontalTarget(nx, nz, f = DEFAULT_FLIGHT, input = {}) {
  const length = Math.hypot(nx, nz);
  if (!length) return { x: 0, z: 0 };
  const speed = flightSpeed(f, { boost: !!(input.sprint || input.boost) });
  return { x: (nx / length) * speed, z: (nz / length) * speed };
}

/** Keep flight under its ceiling; dropping onto the limit also kills upward velocity. */
export function clampFlightAltitude(y, vy, f = DEFAULT_FLIGHT, { roam = false } = {}) {
  const ceiling = roam ? f.roamCeiling : f.ceiling;
  if (y > ceiling) return { y: ceiling, vy: Math.min(0, vy) };
  return { y, vy };
}

/** Upward impulse when flight engages, so take-off is a lift rather than a jump cut. */
export function flightTakeoffImpulse(f = DEFAULT_FLIGHT) {
  return f.takeoff;
}

/** Impact intensity for the landing shockwave, scaled by how hard the fighter came down. */
export function flightLandingIntensity(f = DEFAULT_FLIGHT, impactSpeed = 0) {
  return Math.max(0, Math.min(18, Math.round(2 + Math.abs(impactSpeed) * 1.1 + f.cruise * .1)));
}

/** The damping step the fighter integrates (same curve as THREE.MathUtils.damp). */
export function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}
