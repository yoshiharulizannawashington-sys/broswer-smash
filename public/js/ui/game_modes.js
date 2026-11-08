// Game mode registry: the single source of truth for what the front end may offer.
//
// Before this, the menu had a 1P/2P toggle plus separate Practice and Explore buttons, and no
// concept of a mode at all. That is fine until a mode is added as a button and turns out not to
// exist behind it. Every mode now declares how it starts and whether it can be started, and the
// brief's rule is enforced here: a mode is only `available` when an entry point actually runs.
//
// `entry` names the button/flow the game already implements:
//   'play'      #play - a normal match, solo or local versus
//   'practice'  #practice - practice mode with powers and a training dummy
//   'explore'   #explore - free exploration of the continuous world
// A mode with no entry is unavailable and must be shown as such, never as playable.

export const GAME_MODES = Object.freeze([
  {
    id: '1p', label: 'Solo vs CPU', family: 'versus', entry: 'play', available: true,
    players: 1, description: 'Fight the CPU in the selected arena. First to two rounds.'
  },
  {
    id: '2p', label: 'Local versus', family: 'versus', entry: 'play', available: true,
    players: 2, description: 'Two players on one keyboard or two gamepads.'
  },
  {
    id: 'training', label: 'Training', family: 'practice', entry: 'practice', available: true,
    players: 1, description: 'Training dummy, powers enabled, damage and combo feedback.'
  },
  {
    id: 'practice', label: 'Practice combat', family: 'practice', entry: 'practice', available: true,
    players: 1, description: 'Same simulation as Training, for rehearsing combos against a dummy.'
  },
  {
    id: 'exploration', label: 'Free exploration', family: 'explore', entry: 'explore', available: true,
    players: 1, description: 'Walk the continuous world between battles; no match rules.'
  },
  {
    id: 'tournament', label: 'Tournament', family: 'bracket', entry: 'tournament', available: true,
    players: 1, description: 'An eight-fighter bracket; win three real matches to take it.'
  },
  {
    id: 'survival', label: 'Survival', family: 'endless', entry: null, available: false,
    players: 1, description: 'Endless CPU opponents with one shared health pool.',
    reason: 'No endless-opponent loop or persistent health exists yet; a button would start a normal match.'
  }
]);

/** Modes that can actually be started right now. */
export function availableModes() {
  return GAME_MODES.filter(mode => mode.available && mode.entry);
}

/** Modes that are declared but not implemented, with the reason shown to the player. */
export function unavailableModes() {
  return GAME_MODES.filter(mode => !mode.available || !mode.entry);
}

/** Lookup by id. */
export function modeById(id) {
  return GAME_MODES.find(mode => mode.id === id) || null;
}

/**
 * True only when the id names a mode the game can start. Callers use this instead of trusting a
 * dataset value from the DOM.
 */
export function canStart(id) {
  const mode = modeById(id);
  return Boolean(mode && mode.available && mode.entry);
}

/**
 * Plain data for the front end and for tests: what to render, and what to grey out with a reason.
 * Keeping this serialisable means a menu can render it without importing game internals.
 */
export function describeModes() {
  return {
    all: GAME_MODES.map(({ id, label, family, entry, available, players, description, reason }) => ({
      id, label, family, entry, available, players, description, reason: reason || null
    })),
    available: availableModes().map(mode => mode.id),
    unavailable: unavailableModes().map(mode => ({ id: mode.id, reason: mode.reason }))
  };
}
