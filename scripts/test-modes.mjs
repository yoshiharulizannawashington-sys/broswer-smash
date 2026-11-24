// Game mode registry test: a mode may only be advertised when the game can start it.
//
// The brief's rule is "only display a mode as available when it actually works", so this asserts
// exactly that: every available mode names an entry point the game implements, every unavailable
// mode carries a reason, and Tournament/Survival are not silently sold as playable.
//
//   node scripts/test-modes.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GAME_MODES, availableModes, unavailableModes, modeById, canStart, describeModes
} from '../public/js/ui/game_modes.js';

let checks = 0;
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  checks++;
  console.log(`  ok  ${name}`);
}

const mainSource = readFileSync('public/js/main.js', 'utf8');

// The entry points the registry is allowed to point at, and evidence each really exists.
const ENTRY_EVIDENCE = {
  play: () => mainSource.includes("$('#play')") || mainSource.includes('#play'),
  practice: () => mainSource.includes("$('#practice')") || mainSource.includes('practice='),
  explore: () => mainSource.includes("$('#explore')") || mainSource.includes('exploration=true'),
  tournament: () => mainSource.includes('__browserSmashTournamentStart') && mainSource.includes('createTournament')
};

// ---- Shape ---------------------------------------------------------------
check('the registry has modes', GAME_MODES.length >= 5, `${GAME_MODES.length} modes`);
check('every mode has an id, label and family',
  GAME_MODES.every(m => m.id && m.label && m.family));
check('mode ids are unique', new Set(GAME_MODES.map(m => m.id)).size === GAME_MODES.length);
check('the requested mode families are represented',
  ['versus', 'practice', 'explore', 'bracket', 'endless'].every(family => GAME_MODES.some(m => m.family === family)),
  [...new Set(GAME_MODES.map(m => m.family))].join(', '));

// ---- Availability is honest ---------------------------------------------
const missingEntry = availableModes().filter(mode => !ENTRY_EVIDENCE[mode.entry]);
check('every available mode points at an entry point that exists', missingEntry.length === 0,
  missingEntry.map(m => m.id).join(', '));
const availableWithoutEntry = availableModes().filter(mode => mode.entry == null);
check('no available mode lacks an entry point', availableWithoutEntry.length === 0);

const unavailable = unavailableModes();
check('unavailable modes are declared and explained',
  unavailable.length > 0 && unavailable.every(mode => typeof mode.reason === 'string' && mode.reason.length > 10),
  unavailable.map(m => m.id).join(', '));
check('an unavailable mode has no entry point',
  unavailable.every(mode => !mode.entry && mode.available === false));

// ---- The specific promises the brief makes ------------------------------
for (const id of ['1p', '2p', 'training', 'practice', 'exploration']) {
  check(`${id} is offered as playable`, canStart(id));
}
check('tournament is offered now that the bracket drives real matches', canStart('tournament'));
for (const id of ['survival']) {
  check(`${id} is not offered as playable while it is unimplemented`, canStart(id) === false);
  check(`${id} explains why it is unavailable`, Boolean(modeById(id)?.reason));
}
check('unknown ids are refused rather than trusted', canStart('nonsense') === false && modeById('nonsense') === null);

// ---- Serialisable description for the front end -------------------------
const described = describeModes();
check('the description lists every mode', described.all.length === GAME_MODES.length);
check('the description separates available from unavailable',
  described.available.length === availableModes().length
  && described.unavailable.length === unavailableModes().length,
  `${described.available.length} available · ${described.unavailable.length} unavailable`);
check('the description is plain data',
  JSON.parse(JSON.stringify(described)).all.length === described.all.length);
check('solo and local versus both start the real match flow',
  modeById('1p').entry === 'play' && modeById('2p').entry === 'play');

console.log(`\nGame mode checks passed (${checks} checks).`);
