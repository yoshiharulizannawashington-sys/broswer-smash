// Per-character locomotion audit. Runs without a browser.
//
//   node scripts/test-locomotion.mjs
//
// It asserts four things the movement rework has to hold to:
//   1. every launch-roster identity has an explicit movement profile (no fighter silently runs
//      the generic default),
//   2. no profile in either table is dead data (a key that cannot match a real identity slug -
//      `hulk` and `iron_man` were exactly that in the move table),
//   3. the profiles are genuinely different from each other, in the directions the character
//      design says they should be,
//   4. the integration the fighter actually runs (damp toward the mode's target speed) produces
//      those differences, simulated here with the same helper Fighter3D calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LOCOMOTION, DEFAULT_LOCOMOTION, ARCHETYPE_LOCOMOTION, locomotionFor,
  speedTarget, jumpImpulse, gravityFor, dampVelocity, steerRate
} from '../public/js/combat/locomotion.js';
import { CHARACTER_MOVE_PROFILES } from '../public/js/combat/move_data.js';

let checks = 0;
function check(name, condition, detail = '') {
  checks++;
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  console.log(`  ok  ${name}`);
}

const slug = name => String(name).normalize('NFKD').toLowerCase()
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** A profile is steerable if every movement lambda is finite and positive. */
const Steerable = p => [p.accel, p.brake, p.airAccel, p.airBrake, p.turn, p.jump, p.gravity, p.walk, p.run, p.sprint]
  .every(value => Number.isFinite(value) && value > 0);

// The authoritative roster is the `roster` array in main.js - the same source audit-roster and
// test-movesets read, so this cannot drift into a list maintained in two places.
const main = readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
const block = /const roster=\[\[(.*?)\]\];/s.exec(main);
assert.ok(block, 'could not find the launch roster in public/js/main.js');
// Parse each `["Name","archetype"]` entry by its quoted fields rather than with one rigid
// pattern: a single pattern silently matched only 32 of the 34 entries, and a roster gate that
// quietly audits 32 fighters is worse than one that fails. The entry count is asserted too.
const entries = block[1].split('],[');
const roster = entries.map(entry => {
  const parts = [...entry.matchAll(/["']([^"'\]]+)["']/g)].map(match => match[1]);
  return { name: parts[0], archetype: parts[1], slug: slug(parts[0] || '') };
}).filter(entry => entry.name);
check('every roster entry is parsed, not only the ones one pattern matched',
  roster.length === entries.length, `${roster.length} of ${entries.length}`);
check('the launch roster is parsed from main.js', roster.length === 38, String(roster.length));

console.log('\nroster coverage');
for (const { slug: id, archetype } of roster) {
  check(`${id}: has an explicit locomotion profile (${archetype})`, Boolean(LOCOMOTION[id]));
}
const deadLocomotion = Object.keys(LOCOMOTION).filter(key => !roster.some(r => r.slug === key));
check('no locomotion profile is dead data', deadLocomotion.length === 0, deadLocomotion.join(', '));
const deadMoves = Object.keys(CHARACTER_MOVE_PROFILES).filter(key => !roster.some(r => r.slug === key));
check('no move profile is dead data (the bug that left Hulk inert)', deadMoves.length === 0, deadMoves.join(', '));
const missingMoves = roster.filter(r => !CHARACTER_MOVE_PROFILES[r.slug]).map(r => r.slug);
check('every launch fighter has its own move profile', missingMoves.length === 0, missingMoves.join(', '));

console.log('\nthe profiles are genuinely different');
const at = id => LOCOMOTION[id];
check('the default tier is still the shipped movement',
  DEFAULT_LOCOMOTION.walk === 5.1 && DEFAULT_LOCOMOTION.run === 8.8 && DEFAULT_LOCOMOTION.sprint === 12.5
    && DEFAULT_LOCOMOTION.accel === 16 && DEFAULT_LOCOMOTION.brake === 11 && DEFAULT_LOCOMOTION.jump === 10.8,
  JSON.stringify(DEFAULT_LOCOMOTION));
check('at least 10 distinct sprint speeds', new Set(Object.values(LOCOMOTION).map(p => p.sprint)).size >= 10,
  String(new Set(Object.values(LOCOMOTION).map(p => p.sprint)).size));
check('at least 6 distinct accelerations', new Set(Object.values(LOCOMOTION).map(p => p.accel)).size >= 6,
  String(new Set(Object.values(LOCOMOTION).map(p => p.accel)).size));
check('The Flash is the fastest fighter in the game',
  Object.entries(LOCOMOTION).every(([id, p]) => id === 'the_flash_barry_allen' || p.sprint < at('the_flash_barry_allen').sprint));
// The bruiser identity, not an absolute: Professor X is deliberately the slowest fighter alive.
const accelMedian = Object.values(LOCOMOTION).map(p => p.accel).sort((a, b) => a - b)[Math.floor(Object.keys(LOCOMOTION).length / 2)];
const agile = ['spider_man', 'the_flash_barry_allen', 'naruto_uzumaki', 'levi_ackerman', 'goku', 'sasuke_uchiha', 'iron_spider', 'kaze'];
check('Hulk accelerates below the roster median and slower than every agile fighter',
  at('hulk_bruce_banner').accel < accelMedian && agile.every(id => at(id).accel > at('hulk_bruce_banner').accel),
  `hulk ${at('hulk_bruce_banner').accel} vs median ${accelMedian}`);
check('Professor X accelerates slowest of the whole roster',
  Object.entries(LOCOMOTION).every(([id, p]) => id === 'professor_x_charles_xavier' || p.accel >= at('professor_x_charles_xavier').accel));
check('Hulk brakes slower than Spider-Man and The Flash',
  at('hulk_bruce_banner').brake < at('spider_man').brake && at('hulk_bruce_banner').brake < at('the_flash_barry_allen').brake);
check('Hulk jumps higher than The Flash',
  at('hulk_bruce_banner').jump > at('the_flash_barry_allen').jump, `${at('hulk_bruce_banner').jump} > ${at('the_flash_barry_allen').jump}`);
check('The Flash reverses faster than Hulk, and Hulk faster than nobody at his weight class',
  at('the_flash_barry_allen').turn > at('hulk_bruce_banner').turn && at('kratos').turn < 1);
check('the agile fighters steer better in the air than the bruisers',
  at('spider_man').airAccel > at('kratos').airAccel && at('naruto_uzumaki').airAccel > at('thor').airAccel);
check('the armoured fliers brake harder than the lightweights',
  at('iron_man_tony_stark').brake > at('spider_man').brake * .85 && at('master_chief').brake > 9);
check('Aang and Luigi have the floatiest falls', at('aang').gravity < 21 && at('luigi').gravity < 22,
  `${at('aang').gravity}, ${at('luigi').gravity}`);
check('Professor X is the slowest fighter, by design', at('professor_x_charles_xavier').sprint < at('iron_spider').sprint * .75);

console.log('\nthe integration produces those differences');
// The same integration Fighter3D runs: damp the velocity toward the mode's target at the
// character's own rate. 60 Hz, the game's simulation step.
const DT = 1 / 60;
function accelerate(id, seconds, { mode = 'sprint', from = 0 } = {}) {
  const profile = locomotionFor({ identityKey: id, archetype: 'warrior' });
  const target = speedTarget(profile, { mode });
  let v = from;
  for (let t = 0; t < seconds; t += DT) v = dampVelocity(v, target, profile.accel, DT);
  return v;
}
function decelerate(id, seconds, from) {
  const profile = locomotionFor({ identityKey: id, archetype: 'warrior' });
  let v = from;
  for (let t = 0; t < seconds; t += DT) v = dampVelocity(v, 0, profile.brake, DT);
  return v;
}
const flash05 = accelerate('the_flash_barry_allen', 0.5);
const hulk05 = accelerate('hulk_bruce_banner', 0.5);
check('after half a second The Flash is well clear of Hulk', flash05 > hulk05 * 1.3,
  `${flash05.toFixed(2)} vs ${hulk05.toFixed(2)} m/s`);
const slowest = Object.keys(LOCOMOTION)
  .map(id => ({ id, reached: accelerate(id, 1.5) / speedTarget(LOCOMOTION[id], { mode: 'sprint' }) }))
  .sort((a, b) => a.reached - b.reached)[0];
check('every fighter reaches 90% of its own top speed within 1.5 s', slowest.reached >= 0.9,
  `${slowest.id} reaches ${(slowest.reached * 100).toFixed(1)}%`);
const flashStopped = decelerate('the_flash_barry_allen', 0.2, flash05);
const hulkStopped = decelerate('hulk_bruce_banner', 0.2, hulk05);
check('a heavy fighter carries more of its momentum when the stick is released',
  hulkStopped / hulk05 > flashStopped / flash05,
  `${(hulkStopped / hulk05).toFixed(2)} vs ${(flashStopped / flash05).toFixed(2)} of top speed kept`);
const apex = id => {
  const profile = locomotionFor({ identityKey: id, archetype: 'warrior' });
  return jumpImpulse(profile, { roam: false }) ** 2 / (2 * gravityFor(profile, { roam: false }));
};
check('Hulk\'s jump apex is higher than The Flash\'s', apex('hulk_bruce_banner') > apex('the_flash_barry_allen'),
  `${apex('hulk_bruce_banner').toFixed(2)} m vs ${apex('the_flash_barry_allen').toFixed(2)} m`);
check('reversing costs a heavy fighter more than a speedster',
  steerRate(at('hulk_bruce_banner'), { reversing: true }) < steerRate(at('the_flash_barry_allen'), { reversing: true }));
check('a speedster reverses faster than it accelerates, a heavyweight reverses slower, and no profile is degenerate',
  steerRate(at('the_flash_barry_allen'), { reversing: true }) > at('the_flash_barry_allen').accel
    && steerRate(at('hulk_bruce_banner'), { reversing: true }) < at('hulk_bruce_banner').accel
    && Object.values(LOCOMOTION).every(p => steerRate(p, { reversing: true }) > 0 && Steerable(p)));
check('free-roam speeds stay above arena speeds for every fighter',
  Object.values(LOCOMOTION).every(p => p.roamWalk > p.walk && p.roamRun > p.run && p.roamSprint > p.sprint));
check('an identity outside the launch roster falls back to its archetype tier',
  locomotionFor({ identityKey: 'the_rock', archetype: 'brawler' }) === ARCHETYPE_LOCOMOTION.brawler
    && locomotionFor({ identityKey: 'nobody', archetype: 'unknown' }) === DEFAULT_LOCOMOTION);
check('a form\'s speed multiplier still stacks on the character profile',
  speedTarget(at('goku'), { mode: 'sprint' }) * 1.26 > speedTarget(at('goku'), { mode: 'sprint' }));

console.log(`\nlocomotion: ${checks} checks passed`);
