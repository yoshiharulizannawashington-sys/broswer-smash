// Tournament bracket: an 8-fighter single-elimination bracket that runs on the real combat engine.
//
// The bracket is pure data. It decides who fights whom, tracks wins and losses, advances the player,
// and simulates the other matches with a seeded rating so the bracket is reproducible. The UI and
// the match itself are driven elsewhere; this module only answers "who is next" and "is it over".
//
// A loss ends the run: a single-elimination bracket the player cannot lose is not a bracket.

export const BRACKET_SIZE = 8;
export const ROUND_NAMES = Object.freeze(['Quarter-final', 'Semi-final', 'Final']);

/** Difficulty rises through the bracket so the final is the hardest fight, not the first. */
export const ROUND_DIFFICULTY = Object.freeze(['fighter', 'ace', 'ace']);

function seededRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}

/**
 * @param {string[]} entrants  exactly BRACKET_SIZE names, player included
 * @param {string} player      the entrant the human controls
 */
export function createTournament({ entrants = [], player = null, seed = 1337, ratings = {} } = {}) {
  const roster = entrants.filter(Boolean).slice(0, BRACKET_SIZE);
  if (roster.length !== BRACKET_SIZE) throw new Error(`a tournament needs ${BRACKET_SIZE} entrants, got ${roster.length}`);
  if (!player || !roster.includes(player)) throw new Error('the player must be one of the entrants');

  const random = seededRandom(seed);
  const state = {
    player,
    seed,
    round: 0,
    matches: [],      // current round's pairings
    results: [],      // every completed match
    alive: [...roster],
    eliminatedBy: null,
    champion: null,
    pending: null,    // the player's next match, if the run is still alive
    ratings: { ...ratings }
  };

  /** Rating drives only the simulated CPU-vs-CPU matches. */
  const ratingOf = name => Number(state.ratings[name]) || 1;

  function pairRound(pool) {
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const matches = [];
    for (let i = 0; i < shuffled.length; i += 2) matches.push({ a: shuffled[i], b: shuffled[i + 1] });
    return matches;
  }

  function start() {
    state.round = 0;
    state.results = [];
    state.alive = [...roster];
    state.champion = null;
    state.eliminatedBy = null;
    state.matches = pairRound(state.alive);
    return nextMatch();
  }

  function playerMatch() {
    return state.matches.find(match => match.a === state.player || match.b === state.player) || null;
  }

  function nextMatch() {
    if (state.champion || state.eliminatedBy) { state.pending = null; return null; }
    const match = playerMatch();
    if (!match) { state.pending = null; return null; }
    const opponent = match.a === state.player ? match.b : match.a;
    state.pending = {
      round: state.round,
      roundName: ROUND_NAMES[state.round] || `Round ${state.round + 1}`,
      difficulty: ROUND_DIFFICULTY[Math.min(state.round, ROUND_DIFFICULTY.length - 1)],
      player: state.player,
      opponent
    };
    return state.pending;
  }

  /** Simulate one CPU-vs-CPU match, weighted by rating. */
  function simulate(match) {
    const aStrength = ratingOf(match.a) * (0.85 + random() * 0.3);
    const bStrength = ratingOf(match.b) * (0.85 + random() * 0.3);
    return aStrength >= bStrength ? match.a : match.b;
  }

  /**
   * Record the player's result and advance the bracket.
   * Returns the next match, or null when the run ended (win or loss).
   */
  function reportPlayerResult(won) {
    const match = playerMatch();
    if (!match) return null;
    const opponent = match.a === state.player ? match.b : match.a;
    state.results.push({ round: state.round, player: state.player, opponent, won: Boolean(won), simulated: false });

    if (!won) {
      state.eliminatedBy = opponent;
      state.pending = null;
      // The player's own match has to be awarded to the opponent before the rest of the bracket is
      // played out. Simulating that pairing again could hand the tie to the player who just lost,
      // and then crown them.
      state.alive = state.matches.map(pairing => pairing === match ? opponent : simulate(pairing));
      finishWithoutPlayer();
      return null;
    }

    const winners = [];
    for (const pairing of state.matches) {
      if (pairing === match) { winners.push(state.player); continue; }
      const winner = simulate(pairing);
      state.results.push({ round: state.round, player: pairing.a, opponent: pairing.b, won: winner === pairing.a, simulated: true });
      winners.push(winner);
    }
    state.alive = winners;

    if (winners.length === 1) {
      state.champion = state.player;
      state.pending = null;
      return null;
    }
    state.round += 1;
    state.matches = pairRound(winners);
    return nextMatch();
  }

  /** If the player is out, play the remaining rounds out between the CPU fighters. */
  function finishWithoutPlayer() {
    if (state.champion) return;
    let pool = [...state.alive];
    let round = state.round + 1;
    while (pool.length > 1) {
      const winners = [];
      for (let i = 0; i < pool.length; i += 2) {
        const a = pool[i], b = pool[i + 1];
        if (!b) { winners.push(a); continue; }
        const winner = ratingOf(a) * (0.85 + random() * 0.3) >= ratingOf(b) * (0.85 + random() * 0.3) ? a : b;
        state.results.push({ round, player: a, opponent: b, won: winner === a, simulated: true });
        winners.push(winner);
      }
      pool = winners;
      round += 1;
    }
    state.champion = pool[0] || null;
  }

  function describe() {
    return {
      player: state.player,
      round: state.round,
      roundName: ROUND_NAMES[state.round] || null,
      champion: state.champion,
      eliminatedBy: state.eliminatedBy,
      complete: Boolean(state.champion),
      playerWonTournament: state.champion === state.player,
      pending: state.pending ? { ...state.pending } : null,
      matches: state.matches.map(match => ({ ...match })),
      results: state.results.map(result => ({ ...result })),
      wins: state.results.filter(r => !r.simulated && r.won).length,
      losses: state.results.filter(r => !r.simulated && !r.won).length
    };
  }

  start();
  return {
    start,
    reportPlayerResult,
    nextMatch,
    describe,
    get pending() { return state.pending ? { ...state.pending } : null; },
    get champion() { return state.champion; },
    get round() { return state.round; },
    get eliminated() { return Boolean(state.eliminatedBy); }
  };
}
