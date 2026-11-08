// Flight physics test. Asserts the flight model in node, where the numbers can be simulated
// exactly: the browser test (scripts/test-flight-live.mjs) proves the same behaviour reaches the
// real fighter, this one proves the model itself is not degenerate.
//
// node scripts/test-flight.mjs
import assert from 'node:assert/strict';
import {
  FLIGHT, FLIGHT_BASE, DEFAULT_FLIGHT, flightFor, flightSpeed, flightThrust,
  flightVerticalTarget, flightVerticalLambda, flightHorizontalTarget,
  clampFlightAltitude, flightTakeoffImpulse, flightLandingIntensity, damp
} from '../public/js/combat/flight.js';

let checks = 0;
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  checks++;
  console.log(`  ok  ${name}`);
}

// ---- Profiles ------------------------------------------------------------
check('the roster has explicit flight profiles', Object.keys(FLIGHT).length >= 20,
  `${Object.keys(FLIGHT).length} identities`);
check('every profile has a positive cruise speed',
  Object.values(FLIGHT).every(f => f.cruise > 0 && f.boost > f.cruise));
check('every profile can climb and descend',
  Object.values(FLIGHT).every(f => f.climb > 0 && f.descend > 0 && f.climbBoost >= f.climb));
check('an unknown identity falls back to the archetype profile',
  flightFor({ identityKey: 'nobody', archetype: 'ninja' }).cruise > DEFAULT_FLIGHT.cruise);
check('an unknown identity and archetype falls back to the base profile',
  flightFor({ identityKey: 'nobody', archetype: 'nothing' }) === DEFAULT_FLIGHT);

// The point of per-character profiles: they are not recolours of one another.
const goku = flightFor({ identityKey: 'goku' });
const hulk = flightFor({ identityKey: 'hulk_bruce_banner' });
const ironMan = flightFor({ identityKey: 'iron_man_tony_stark' });
const aang = flightFor({ identityKey: 'aang' });
check('a speedster flies faster than a brawler', goku.boost > hulk.boost,
  `${goku.boost} vs ${hulk.boost}`);
check('a brawler climbs worse than an airbender', hulk.climb < aang.climb,
  `${hulk.climb} vs ${aang.climb}`);
check('a thruster fighter brakes harder than a brawler', ironMan.brake > hulk.brake,
  `${ironMan.brake} vs ${hulk.brake}`);

// ---- Speed and thrust ----------------------------------------------------
check('boost raises the horizontal target', flightSpeed(goku, { boost: true }) > flightSpeed(goku),
  `${flightSpeed(goku)} -> ${flightSpeed(goku, { boost: true })}`);
check('braking uses the brake lambda', flightThrust(ironMan, { braking: true }) === ironMan.brake);
check('boost thrust exceeds cruise thrust', flightThrust(goku, { boost: true }) > flightThrust(goku));

// ---- Vertical control ----------------------------------------------------
check('ascend targets a climb', flightVerticalTarget({ ascend: true }, goku) === goku.climb);
check('sprint ascend uses the boosted climb',
  flightVerticalTarget({ ascend: true, sprint: true }, goku) === goku.climbBoost);
check('descend targets a drop', flightVerticalTarget({ descend: true }, goku) === -goku.descend);
check('no vertical input targets level flight', flightVerticalTarget({}, goku) === 0);
check('hovering damps more gently than thrusting',
  flightVerticalLambda({}, goku) < flightVerticalLambda({ ascend: true }, goku));

// Simulated climb: one second of held ascend must move the fighter upward, and the velocity
// must approach the target rather than snapping to it in a single frame.
let vy = 0;
let y = 0;
for (let i = 0; i < 60; i++) {
  vy = damp(vy, flightVerticalTarget({ ascend: true }, goku), flightVerticalLambda({ ascend: true }, goku), 1 / 60);
  y += vy / 60;
}
check('a held climb accelerates and gains altitude', vy > goku.climb * .85 && y > 3,
  `vy ${vy.toFixed(2)} m/s · y ${y.toFixed(2)} m`);
check('the climb does not teleport to target speed in one frame',
  damp(0, goku.climb, flightVerticalLambda({ ascend: true }, goku), 1 / 60) < goku.climb * .2);

// Hover: from a stop, holding altitude keeps the fighter level instead of drifting down.
let hoverVy = 0;
for (let i = 0; i < 60; i++) hoverVy = damp(hoverVy, 0, flightVerticalLambda({}, goku), 1 / 60);
check('hovering holds altitude', Math.abs(hoverVy) < .01, hoverVy.toFixed(4));

// ---- Horizontal flight ---------------------------------------------------
const forward = flightHorizontalTarget(0, -1, goku, {});
check('forward flight targets cruise speed', Math.abs(Math.hypot(forward.x, forward.z) - goku.cruise) < 1e-6);
const strafe = flightHorizontalTarget(1, 0, goku, {});
check('strafing is a full-speed direction, not a reduced one',
  Math.abs(Math.hypot(strafe.x, strafe.z) - goku.cruise) < 1e-6);
const diagonal = flightHorizontalTarget(1, -1, goku, {});
check('a diagonal does not exceed cruise speed',
  Math.hypot(diagonal.x, diagonal.z) <= goku.cruise + 1e-6);
check('no direction targets zero velocity', flightHorizontalTarget(0, 0, goku, {}).x === 0);

// Braking bleeds speed far faster than air resistance does.
let brakingSpeed = goku.boost;
for (let i = 0; i < 12; i++) brakingSpeed = damp(brakingSpeed, 0, flightThrust(goku, { braking: true }), 1 / 60);
let coasting = goku.boost;
for (let i = 0; i < 12; i++) coasting = damp(coasting, 0, FLIGHT_BASE.airResist, 1 / 60);
check('braking removes speed quickly', brakingSpeed < goku.boost * .2, `${brakingSpeed.toFixed(2)} m/s after 0.2 s`);
check('coasting keeps momentum', coasting > goku.boost * .7, `${coasting.toFixed(2)} m/s after 0.2 s`);

// ---- Ceiling and take-off ------------------------------------------------
const capped = clampFlightAltitude(goku.ceiling + 5, 6, goku, {});
check('flight is capped at its ceiling', capped.y === goku.ceiling && capped.vy <= 0,
  `y ${capped.y} · vy ${capped.vy}`);
check('free roam allows more altitude than a match',
  clampFlightAltitude(40, 0, goku, { roam: true }).y === 40);
check('take-off gives an upward impulse', flightTakeoffImpulse(goku) > 0);
check('a hard landing produces a bigger shockwave than a soft one',
  flightLandingIntensity(goku, 12) > flightLandingIntensity(goku, 1));

console.log(`\nFlight model checks passed (${checks} checks).`);
