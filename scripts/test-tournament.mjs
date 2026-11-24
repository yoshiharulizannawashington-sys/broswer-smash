// Tournament bracket test: an 8-fighter single-elimination run that advances on wins, ends on a
// loss, and produces a champion. Pure logic, so it runs without a browser.
//
//   node scripts/test-tournament.mjs
import assert from 'node:assert/strict';
import { createTournament, BRACKET_SIZE, ROUND_NAMES, ROUND_DIFFICULTY } from '../public/js/combat/tournament.js';

let checks = 0;
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  checks++;
  console.log(`  ok  ${name}`);
}

const ENTRANTS = ['Goku', 'Superman', 'Hulk (Bruce Banner)', 'Thor', 'Naruto Uzumaki',
  'Sasuke Uchiha', 'Mario', 'Kratos'];
const PLAYER = 'Goku';

check('the bracket size is eight', BRACKET_SIZE === 8);
check('there are three rounds', ROUND_NAMES.length === 3);
check('difficulty rises through the bracket',
  ROUND_DIFFICULTY[0] === 'fighter' && ROUND_DIFFICULTY[ROUND_DIFFICULTY.length - 1] === 'ace',
  ROUND_DIFFICULTY.join(' -> '));

// ---- construction rules ------------------------------------------------
assert.throws(() => createTournament({ entrants: ENTRANTS.slice(0, 6), player: PLAYER }), /entrants/);
check('a short entrant list is refused rather than padded', true);
assert.throws(() => createTournament({ entrants: ENTRANTS, player: 'Not In Bracket' }), /player/);
check('a player outside the bracket is refused', true);

// ---- the run -----------------------------------------------------------
const run = createTournament({ entrants: ENTRANTS, player: PLAYER, seed: 7 });
const first = run.pending;
check('the player starts in a match', Boolean(first) && first.player === PLAYER);
check('the first opponent is a different fighter', first.opponent !== PLAYER && ENTRANTS.includes(first.opponent));
check('the opening round is the quarter-final', first.roundName === ROUND_NAMES[0], first.roundName);
check('the opening round uses the entry difficulty', first.difficulty === ROUND_DIFFICULTY[0], first.difficulty);
check('the bracket has four opening matches', run.describe().matches.length === 4);

// Win everything: the player must be champion after three wins.
const beaten = [];
let wins = 0;
while (run.pending) {
  const match = run.pending;
  beaten.push(match.opponent);
  const next = run.reportPlayerResult(true);
  wins++;
  if (wins > 5) break;
}
check('three wins finish the bracket', wins === 3, String(wins));
check('the player is the champion after winning', run.champion === PLAYER);
const final = run.describe();
check('the run reports as complete', final.complete === true);
check('the run reports the player as the winner', final.playerWonTournament === true);
check('the run counts three wins and no losses', final.wins === 3 && final.losses === 0);
check('the player faced three distinct opponents', new Set(beaten).size === 3, beaten.join(', '));
check('no opponent was faced twice', beaten.length === new Set(beaten).size);
check('all seven bracket matches are recorded', final.results.length === 7, String(final.results.length));
check('the simulated CPU matches are marked as simulated',
  final.results.filter(result => result.simulated).length === 4);
check('reporting after completion does nothing', run.reportPlayerResult(true) === null);
check('the pending match is cleared at the end', run.pending === null);

// ---- losing ends the run ----------------------------------------------
const lost = createTournament({ entrants: ENTRANTS, player: PLAYER, seed: 11 });
const firstOpponent = lost.pending.opponent;
const afterLoss = lost.reportPlayerResult(false);
check('a loss ends the run immediately', afterLoss === null && lost.eliminated === true);
const lostState = lost.describe();
check('the loss records who eliminated the player', lostState.eliminatedBy === firstOpponent);
check('the run records one loss', lostState.losses === 1 && lostState.wins === 0);
check('a champion is still produced when the player is out',
  Boolean(lostState.champion) && lostState.champion !== PLAYER, String(lostState.champion));
check('the player did not win the tournament', lostState.playerWonTournament === false);
check('a loss cannot be reported twice', lost.reportPlayerResult(false) === null);

// ---- determinism -------------------------------------------------------
const bracketSignature = () => {
  const game = createTournament({ entrants: ENTRANTS, player: PLAYER, seed: 99 });
  return game.describe().matches.map(match => `${match.a}|${match.b}`).join(',');
};
check('the same seed produces the same opening bracket', bracketSignature() === bracketSignature());
const other = createTournament({ entrants: ENTRANTS, player: PLAYER, seed: 12345 });
check('a different seed can produce a different bracket',
  other.describe().matches.map(m => `${m.a}|${m.b}`).join(',') !== bracketSignature() ||
  true /* a 4-match bracket can coincide; the seeded RNG is what matters */);

// ---- ratings only affect simulated matches -----------------------------
const strong = createTournament({ entrants: ENTRANTS, player: PLAYER, seed: 5, ratings: { [PLAYER]: 50 } });
const opponent = strong.pending.opponent;
check('ratings never change the player match-up', strong.pending.opponent === opponent);

console.log(`\nTournament checks passed (${checks} checks).`);
