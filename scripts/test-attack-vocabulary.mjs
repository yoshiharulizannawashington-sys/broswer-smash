// Attack-vocabulary gate: every move a match can throw must resolve to a motion, motions must be
// measurably different from each other (not renamed copies), and a fighter with an authored set
// must fail visibly when a move has no motion instead of borrowing the nearest one.
//
// Distinctness is measured, not asserted by name: each motion is sampled at 33 points across its
// own timeline, the joint deltas are flattened into a vector, and every pair is compared by the
// largest per-frame RMS difference. Two motions that are the same pose with different labels cannot
// pass this.
import assert from 'node:assert/strict';
import {
  MOTIONS, MOTION_SETS, MOVE_MOTION, REQUIRED_MOTION_SLOTS,
  motionKindFor, motionSetFor, validateMotionVocabulary, sampleMotion
} from '../public/js/anim/attack_animator.js';
import { resolveMoveId } from '../public/js/combat/move_data.js';
import { MOVESETS } from '../public/js/combat/movesets.js';
import { NARUTO_MOTIONS } from '../public/js/anim/attack_motions_naruto.js';
import { ROSTER_MOTIONS } from '../public/js/anim/attack_motions_roster.js';

let checks = 0;
const check = (name, ok, detail = '') => {
  assert.ok(ok, `${name}${detail ? ' — ' + detail : ''}`);
  checks++;
  console.log('  ok  ' + name + (detail ? `  (${detail})` : ''));
};

const SAMPLES = 33;
const identity = { identityKey: 'naruto_uzumaki' };

/** Flatten a motion's sampled joint deltas into a fixed-order vector per sample. */
function sampleVectors(motions, slot) {
  const frames = [];
  for (let i = 0; i < SAMPLES; i++) frames.push(sampleMotion(slot, i / (SAMPLES - 1), motions));
  const joints = [...new Set(frames.flatMap(frame => Object.keys(frame)))].sort();
  return frames.map(frame => joints.flatMap(joint => frame[joint] || [0, 0, 0]));
}

/** Largest per-frame RMS joint delta between two motions, in radians. */
function distance(a, b) {
  assert.equal(a.length, b.length, 'motion vectors must share a frame count');
  let worst = 0;
  for (let i = 0; i < a.length; i++) {
    let sum = 0;
    for (let j = 0; j < a[i].length; j++) sum += (a[i][j] - b[i][j]) ** 2;
    worst = Math.max(worst, Math.sqrt(sum / a[i].length));
  }
  return +worst.toFixed(4);
}

// ---------------------------------------------------------------- completeness of the vocabulary
for (const [name, motions] of Object.entries(MOTION_SETS)) {
  const missing = validateMotionVocabulary(motions);
  check(`motion set "${name}" covers every move slot`, missing.length === 0, missing.join(', ') || 'complete');
}

// Every move id the resolver can produce must map to a slot the shared set actually has.
const moveIds = [
  resolveMoveId({ comboStep: 1 }), resolveMoveId({ comboStep: 2 }), resolveMoveId({ comboStep: 3 }),
  resolveMoveId({ comboStep: 4 }), resolveMoveId({ comboStep: 5 }),
  resolveMoveId({ heavy: true, heavyVariant: 'forward' }),
  resolveMoveId({ heavy: true, heavyVariant: 'launcher' }),
  resolveMoveId({ heavy: true, heavyVariant: 'slam' }),
  resolveMoveId({ aerial: true }), resolveMoveId({ aerial: true, airFinisher: true }),
  resolveMoveId({ antiAir: true }), resolveMoveId({ dive: true }), resolveMoveId({ countering: true })
];
const unmapped = moveIds.filter(id => !MOVE_MOTION[id]);
check('every move id resolves to a motion slot', unmapped.length === 0, unmapped.join(', ') || `${moveIds.length} moves`);

// ------------------------------------------------------------------------ Naruto's own motions
const narutoSlots = Object.keys(NARUTO_MOTIONS);
check('Naruto ships his complete authored vocabulary', narutoSlots.length >= 20
  && validateMotionVocabulary(NARUTO_MOTIONS).length === 0, narutoSlots.join(', '));
check('Naruto draws on his own set in a live fighter', motionSetFor(identity).id === 'naruto');
check('a roster fighter draws on its own set while an unknown identity keeps the default',
  motionSetFor({ identityKey: 'thor' }).id === 'thor'
  && motionSetFor({ identityKey: 'unknown_identity' }).id === 'default');

const vectors = Object.fromEntries(narutoSlots.map(slot => [slot, sampleVectors(NARUTO_MOTIONS, slot)]));
let closest = { pair: null, value: Infinity };
for (let i = 0; i < narutoSlots.length; i++) {
  for (let j = i + 1; j < narutoSlots.length; j++) {
    const value = distance(vectors[narutoSlots[i]], vectors[narutoSlots[j]]);
    if (value < closest.value) closest = { pair: `${narutoSlots[i]}/${narutoSlots[j]}`, value };
  }
}
check('every pair of Naruto motions is measurably different', closest.value > 0.09,
  `closest pair ${closest.pair} at ${closest.value} rad RMS`);

// The pilot must not be the shared set under new names.
let weakest = { slot: null, value: Infinity };
for (const slot of narutoSlots.filter(slot => MOTIONS[slot])) {
  const value = distance(vectors[slot], sampleVectors(MOTIONS, slot));
  if (value < weakest.value) weakest = { slot, value };
}
check('Naruto differs from the shared set in every shared slot', weakest.value > 0.05,
  `smallest ${weakest.slot} at ${weakest.value} rad RMS`);

// ------------------------------------------------------------------- chain and heavies resolve
const slotsFor = step => motionKindFor({ id: resolveMoveId({ comboStep: step }) }, { ...identity, comboStep: step });
const chain = [1, 2, 3, 4, 5].map(slotsFor);
check('the five-hit chain plays five distinct motions', new Set(chain).size === 5, chain.join(' → '));

const heavy = motionKindFor({ id: resolveMoveId({ heavy: true, heavyVariant: 'forward' }) }, identity);
const launcher = motionKindFor({ id: resolveMoveId({ heavy: true, heavyVariant: 'launcher' }) }, identity);
const slam = motionKindFor({ id: resolveMoveId({ heavy: true, heavyVariant: 'slam' }) }, identity);
check('the three heavies play three distinct motions', new Set([heavy, launcher, slam]).size === 3,
  [heavy, launcher, slam].join(', '));
check('a heavy is not the light chain again', ![chain[0], chain[1]].includes(heavy), heavy);

// A defensively cloned move must not silently pass as mapped.
const cloned = { ...NARUTO_MOTIONS, light1: NARUTO_MOTIONS.light2 };
const cloneDistance = distance(sampleVectors(cloned, 'light1'), sampleVectors(cloned, 'light2'));
check('the gate would catch a duplicated motion', cloneDistance === 0, `distance ${cloneDistance}`);

// ------------------------------------------------------------------------ fail-loud behaviour
const miss = motionKindFor({ id: 'unmapped_move' }, { ...identity, comboStep: 0 });
check('an unmapped move on an authored fighter fails instead of borrowing a pose', miss === null, String(miss));
const shared = motionKindFor({ id: 'unmapped_move' }, { identityKey: 'nobody', comboStep: 1 });
check('a fighter with no authored set still falls back to its chain step', shared === 'light1', String(shared));
const strictMiss = motionKindFor({ id: 'unmapped_move' }, { identityKey: 'thor', comboStep: 1 });
check('an authored roster fighter fails loud instead of borrowing the default pose', strictMiss === null, String(strictMiss));

// ------------------------------------------------------- per-identity coverage across the roster
const roster = Object.entries(MOVESETS).map(([key, set]) => {
  const fighter = { identityKey: key, comboStep: 1 };
  // The eight core moves a grounded exchange can produce: the five-step chain plus the three
  // heavies. The chain length is the fighter's own moveset length, so a 3-light kit still throws
  // light4/finisher when the match keeps the string going.
  const chainLength = Math.max(5, (set.lights || []).length);
  const ids = [
    ...Array.from({ length: chainLength }, (_, index) => resolveMoveId({ comboStep: index + 1 })),
    resolveMoveId({ heavy: true, heavyVariant: 'forward' }),
    resolveMoveId({ heavy: true, heavyVariant: 'launcher' }),
    resolveMoveId({ heavy: true, heavyVariant: 'slam' })
  ];
  const slots = ids.map(id => motionKindFor({ id }, fighter)).filter(Boolean);
  return { key, set: motionSetFor(fighter).id, moves: ids.length, distinct: new Set(slots).size };
});
const narutoRow = roster.find(row => row.key === 'naruto_uzumaki');
check('Naruto covers all eight core moves with distinct motions',
  narutoRow.distinct === 8 && narutoRow.moves === 8, JSON.stringify(narutoRow));
check('every roster identity still resolves an attack motion',
  roster.every(row => row.distinct >= 1), `${roster.length} identities`);
const authoredRows = roster.filter(row => row.set !== 'default');
check('every roster identity carries its own authored motion set',
  authoredRows.length === roster.length, `${authoredRows.length}/${roster.length}`);
check('the generated roster sets cover every required move slot',
  Object.values(ROSTER_MOTIONS).every(motions => validateMotionVocabulary(motions).length === 0),
  `${Object.keys(ROSTER_MOTIONS).length} generated sets`);
check('the generated roster sets are not the shared table under new names',
  Object.values(ROSTER_MOTIONS).every(motions => JSON.stringify(motions) !== JSON.stringify(MOTIONS)),
  `${Object.keys(ROSTER_MOTIONS).length} checked`);

const generatedIds = Object.keys(ROSTER_MOTIONS);
let closestGenerated = { slot: null, pair: null, value: Infinity };
for (const slot of ['light1', 'light2', 'heavy', 'special', 'ultimate']) {
  const byIdentity = Object.fromEntries(generatedIds.map(id => [id, sampleVectors(ROSTER_MOTIONS[id], slot)]));
  for (let i = 0; i < generatedIds.length; i++) {
    for (let j = i + 1; j < generatedIds.length; j++) {
      const value = distance(byIdentity[generatedIds[i]], byIdentity[generatedIds[j]]);
      if (value < closestGenerated.value) {
        closestGenerated = { slot, pair: `${generatedIds[i]}/${generatedIds[j]}`, value };
      }
    }
  }
}
check('every generated roster strike is measurably different from the others',
  closestGenerated.value > 0.015,
  `closest ${closestGenerated.slot} ${closestGenerated.pair} at ${closestGenerated.value} rad RMS`);

const augmenting = Object.keys(REQUIRED_MOTION_SLOTS).length;
console.log(`\nAttack vocabulary passed (${checks} checks). Naruto: ${narutoSlots.length} authored motions, closest pair ${closest.pair} ${closest.value} rad; generated closest ${closestGenerated.pair} ${closestGenerated.value} rad; ${augmenting} required slots.`);
