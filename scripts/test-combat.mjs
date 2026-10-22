// Unit tests for the two pure gameplay modules the fighter simulation depends on.
// These run without a browser: node scripts/test-combat.mjs
import assert from 'node:assert/strict';
import {
  DEFAULT_RULES, createMatch, tickMatch, evaluateRound, awardRound, nextRound, resetMatch,
  damageFor, knockbackFor, launchFor, hitstunFor, chainStep, matchSummary
} from '../public/js/combat/combat_rules.js';
import {
  ARENA_LAYOUTS, layoutFor, layoutKeys, spawnPoints, groundHeightAt,
  resolveCollision, clampToBounds, isOutOfBounds, STEP_HEIGHT
} from '../public/js/world/arena_layouts.js';

let checks = 0;
function check(name, condition, detail = '') {
  checks++;
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  console.log(`  ok  ${name}`);
}

console.log('combat rules');
check('guarding cuts damage to 28%', Math.abs(damageFor(10, { guarding: true }) - 2.8) < 1e-9);
check('counters add 42% damage', Math.abs(damageFor(10, { countering: true }) - 14.2) < 1e-9);
check('character profile scales damage', damageFor(10, { profile: { damage: 1.3 } }) > 12.9);
check('longer combos scale damage down', damageFor(10, { comboStep: 3 }) < damageFor(10, { comboStep: 1 }));
check('damage never goes negative', damageFor(-5) === 0);

const light = knockbackFor({ kbs: 80, percent: 20, weight: 85 });
const heavyVictim = knockbackFor({ kbs: 80, percent: 20, weight: 130 });
const lateHit = knockbackFor({ kbs: 80, percent: 120, weight: 85 });
const guarded = knockbackFor({ kbs: 80, percent: 20, weight: 85, guarding: true });
check('heavier fighters are launched less', heavyVictim < light, `${heavyVictim} < ${light}`);
check('knockback grows with damage', lateHit > light);
check('guarding cuts knockback to 25%', Math.abs(guarded - light * 0.25) < 1e-9);

check('guarded hits barely launch', launchFor({ guarding: true }) === 1.2);
check('launchers lift higher than jabs', launchFor({ launchY: 8.6, launcher: true }) > launchFor({ launchY: 3.4 }));
check('hit stun grows with damage', hitstunFor({ percent: 120 }) > hitstunFor({ percent: 10 }));
check('guarded hit stun is short', hitstunFor({ guarding: true }) === 0.1);
check('chains cycle 1-2-3', chainStep(1, 1) === 2 && chainStep(2, 1) === 3 && chainStep(3, 1) === 1);
check('expired combo window restarts the chain', chainStep(2, 0) === 1);

console.log('match state');
let match = createMatch();
check('starts at round 1 with no wins', match.round === 1 && match.wins[0] === 0 && match.wins[1] === 0);
check('timer starts at the rule value', Math.abs(match.timer - DEFAULT_RULES.roundSeconds) < 1e-9);
tickMatch(match, 1.5);
check('tick advances the round clock', Math.abs(match.timer - (DEFAULT_RULES.roundSeconds - 1.5)) < 1e-6);

check('a fighter past max percent loses the round',
  evaluateRound(match, [{ percent: 160 }, { percent: 10 }]) === 'p2');
check('the lower percent wins on time',
  (() => { const m = createMatch(); m.timer = 0; return evaluateRound(m, [{ percent: 40 }, { percent: 90 }]); })() === 'p1');
check('no result while both are alive and time remains',
  evaluateRound(match, [{ percent: 20 }, { percent: 30 }]) === null);
check('a ring-out is a round loss',
  evaluateRound(match, [{ percent: 0, outOfBounds: true }, { percent: 0 }]) === 'p2');

let result = awardRound(match, 'p1');
check('round win is recorded', match.wins[0] === 1 && result.roundOver === true);
check('first round win does not end a best-of-three', result.matchOver === false);
nextRound(match);
check('next round increments and resets the clock',
  match.round === 2 && Math.abs(match.timer - DEFAULT_RULES.roundSeconds) < 1e-9 && match.status === 'fighting');
result = awardRound(match, 'p1');
check('second round win ends the match', result.matchOver === true && match.winner === 'p1');
check('summary reports the series', matchSummary(match).wins.join('-') === '2-0');

resetMatch(match);
check('rematch clears the series', match.round === 1 && match.wins[0] === 0 && match.winner === null);

// A drawn round is replayed, so it cannot hand the series to either fighter.
const drawMatch = createMatch();
awardRound(drawMatch, 'p1');
const drawResult = awardRound(drawMatch, 'draw');
check('a draw awards no round', drawMatch.wins[0] === 1 && drawMatch.wins[1] === 0);
check('a draw does not end the match', drawResult.matchOver === false && drawMatch.winner === null);
check('a draw replays the same round number', drawMatch.round === 1);

console.log('arena layouts');
const keys = layoutKeys();
check('every selectable arena has a layout', keys.length >= 10, keys.join(', '));
for (const key of keys) {
  const layout = layoutFor(key);
  const b = layout.bounds;
  check(`${key}: bounds are wide enough for a fight`, b.x1 - b.x0 >= 30 && b.z1 - b.z0 >= 30,
    `${Math.round(b.x1 - b.x0)} x ${Math.round(b.z1 - b.z0)}`);
  const spawns = spawnPoints(layout);
  check(`${key}: two spawns inside the bounds`,
    spawns.length === 2 && spawns.every(s => s.x > b.x0 && s.x < b.x1 && s.z > b.z0 && s.z < b.z1));
  const gap = Math.hypot(spawns[0].x - spawns[1].x, spawns[0].z - spawns[1].z);
  check(`${key}: fighters do not spawn on top of each other`, gap >= 2.5, `gap ${gap.toFixed(2)}`);
  check(`${key}: spawns are not inside a solid volume`,
    spawns.every(s => groundHeightAt(s.x, s.z, layout, s.y) === s.y));
}

const unknown = layoutFor('nope');
check('unknown arena keys fall back safely', unknown === ARENA_LAYOUTS.valley);

const hogwarts = layoutFor('hogwarts');
const tableTop = 1.3;
check('a table is not walkable from the floor', groundHeightAt(-12, -20, hogwarts, 0) < tableTop);
check('a table can be landed on', Math.abs(groundHeightAt(-12, -20, hogwarts, 1.1) - tableTop) < 1e-9);
check('the hall floor is walkable in the aisle', groundHeightAt(0, -20, hogwarts, 0) === 0);

const tournament = layoutFor('tournament');
check('the tournament ring floor is raised', groundHeightAt(0, -12, tournament, 0) === 0.18);

// Collision: push a fighter standing inside a table out to its edge.
const pos = { x: -12, y: 0, z: -20 };
const vel = { x: 6, y: 0, z: 0 };
resolveCollision(pos, vel, 0.7, hogwarts);
check('solid volumes push the fighter out', pos.x > -13.7 - 5 && pos.x < -13.7 + 5, `x=${pos.x.toFixed(2)}`);
check('a head-on collision removes the inward speed', Math.abs(vel.x) < 6);

const wall = { x: 20, y: 0, z: -32 };
const wallVel = { x: 5, y: 0, z: 0 };
resolveCollision(wall, wallVel, 0.7, hogwarts);
check('columns are solid', Math.hypot(wall.x - 20, wall.z + 32) >= 1.6, `${wall.x.toFixed(2)},${wall.z.toFixed(2)}`);

const edge = { x: 500, y: 0, z: 500 };
const edgeVel = { x: 9, y: 0, z: 9 };
clampToBounds(edge, edgeVel, 0.7, hogwarts);
check('bounds clamp the fighter inside the arena',
  edge.x <= hogwarts.bounds.x1 && edge.z <= hogwarts.bounds.z1);
check('clamping kills outward velocity', edgeVel.x === 0 && edgeVel.z === 0);
check('outside the bounds is a ring-out',
  isOutOfBounds({ x: hogwarts.bounds.x1 + 6, z: 0 }, hogwarts) === true);
check('inside the bounds is not a ring-out',
  isOutOfBounds({ x: 0, z: -20 }, hogwarts) === false);

const step = STEP_HEIGHT;
check('step height is small enough to climb a kerb', step > 0.2 && step < 0.6);

// Every arena must let a fighter walk 8m from spawn in at least one direction.
for (const key of keys) {
  const layout = layoutFor(key);
  const spawn = spawnPoints(layout)[0];
  let best = 0;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const probe = { x: spawn.x, y: spawn.y, z: spawn.z };
    const direction = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 90; i++) {
      probe.x += dx * 0.25;
      probe.z += dz * 0.25;
      probe.y = groundHeightAt(probe.x, probe.z, layout, probe.y);
      resolveCollision(probe, direction, 0.7, layout);
      clampToBounds(probe, direction, 0.7, layout);
    }
    best = Math.max(best, Math.hypot(probe.x - spawn.x, probe.z - spawn.z));
  }
  check(`${key}: spawn has room to move`, best >= 8, `travelled ${best.toFixed(1)}m`);
}

console.log(`\nCombat and arena tests passed (${checks} checks).`);
