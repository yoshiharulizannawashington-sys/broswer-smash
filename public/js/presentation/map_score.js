// Per-map adaptive score, synthesised at runtime.
//
// The game's existing music loop is one eight-note arpeggio shared by every arena. This module gives
// each map its own motif (root, scale, tempo, timbre, bass figure) and layers it by state, so the
// Valley, Asgard, Hogwarts and the Death Star do not sound the same. Everything is generated with
// oscillators and envelopes - there are no sampled or copyrighted recordings here, and the motifs
// are original note sequences written for this game.
//
// Missing maps do not fail silently: `report().missing` is true and the caller can surface it.

const MAPS = Object.freeze({
  valley: { root: 196.0, scale: [0, 3, 5, 7, 10], tempo: 104, lead: 'triangle', bass: 'sine', pad: true, swing: .08 },
  asgard: { root: 146.83, scale: [0, 4, 7, 9, 11], tempo: 86, lead: 'sawtooth', bass: 'triangle', pad: true, brass: true },
  hogwarts: { root: 174.61, scale: [0, 2, 3, 7, 8], tempo: 76, lead: 'sine', bass: 'triangle', pad: true, bells: true },
  deathstar: { root: 110.0, scale: [0, 1, 5, 6, 8], tempo: 68, lead: 'square', bass: 'sawtooth', pad: false, pulse: true },
  tournament: { root: 220.0, scale: [0, 2, 4, 7, 9], tempo: 132, lead: 'square', bass: 'triangle', pad: false },
  helicarrier: { root: 164.81, scale: [0, 3, 7, 10, 12], tempo: 96, lead: 'triangle', bass: 'sine', pad: true },
  volcano: { root: 130.81, scale: [0, 1, 3, 6, 8], tempo: 90, lead: 'sawtooth', bass: 'sawtooth', pad: false, pulse: true },
  ice: { root: 246.94, scale: [0, 2, 5, 7, 9], tempo: 80, lead: 'sine', bass: 'sine', pad: true, bells: true },
  neon: { root: 185.0, scale: [0, 3, 5, 6, 10], tempo: 118, lead: 'square', bass: 'triangle', pad: false },
  finalvalley: { root: 123.47, scale: [0, 1, 5, 7, 10], tempo: 94, lead: 'sawtooth', bass: 'triangle', pad: true, taiko: true },
  konoha: { root: 207.65, scale: [0, 2, 5, 7, 9], tempo: 98, lead: 'triangle', bass: 'sine', pad: true, flute: true },
  stark: { root: 155.56, scale: [0, 4, 7, 9, 11], tempo: 110, lead: 'sawtooth', bass: 'square', pad: true, pulse: true }
});

/**
 * Every playable world resolves to a score family. This is not a silent fallback: an unrecognised
 * key reports `missing` so the caller can surface it, and the mapping is explicit per world family
 * rather than "whatever track happened to be loaded".
 */
const FAMILY_RULES = Object.freeze([
  [/^dbz_/, 'tournament'],
  [/^nyc_|stark/i, 'stark'],
  [/^konoha_/, 'konoha'],
  [/^hogwarts/, 'hogwarts'],
  [/^deathstar/, 'deathstar'],
  [/^asgard/, 'asgard'],
  [/^finalvalley$/, 'finalvalley'],
  [/^valley$/, 'valley'],
  [/^volcano$/, 'volcano'],
  [/^ice$/, 'ice'],
  [/^neon$/, 'neon'],
  [/^tournament$/, 'tournament'],
  [/^helicarrier$/, 'helicarrier']
]);

/** Resolve a world key to its musical identity, or null when the world has no score. */
export function resolveScoreMap(key) {
  const raw = String(key || '');
  for (const [pattern, family] of FAMILY_RULES) {
    if (pattern.test(raw) && MAPS[family]) return { family, config: MAPS[family], motif: MOTIFS[family] };
  }
  return null;
}

/** Motif shape (scale degrees) per map; -1 rests. Original sequences. */
const MOTIFS = Object.freeze({
  valley: [0, 2, 4, 2, 3, 1, 0, 2],
  asgard: [0, 3, 4, 3, 2, 3, 1, 0],
  hogwarts: [0, 1, 2, 4, 3, 2, 1, 0],
  deathstar: [0, 0, 2, 1, 0, -1, 1, 0],
  tournament: [0, 2, 1, 3, 2, 4, 3, 1],
  helicarrier: [0, 2, 3, 2, 4, 3, 2, 1],
  volcano: [0, 1, 4, 3, 1, 0, -1, 1],
  ice: [0, 2, 4, 3, 1, 2, 4, 0],
  neon: [0, 3, 2, 4, 1, 3, 0, 2],
  finalvalley: [0, 1, 3, 2, 4, 1, 3, 0],
  konoha: [0, 2, 3, 4, 2, 1, 3, 0],
  stark: [0, 3, 4, 2, 3, 4, 1, 2]
});

export const SCORE_MAPS = Object.freeze(Object.keys(MAPS));

export function createMapScore({ volume = .22 } = {}) {
  let ctx = null;
  let bus = null;
  let timer = null;
  let step = 0;
  let mapKey = null;
  let config = null;
  let motif = [];
  let intensity = 'combat';
  let muted = false;
  const stats = { started: 0, notes: 0, map: null, family: null, intensity: 'combat', missing: false, stops: 0 };

  function ensureContext() {
    if (ctx) return ctx;
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
      bus = ctx.createGain();
      bus.gain.value = muted ? 0 : volume;
      bus.connect(ctx.destination);
    } catch { ctx = null; }
    return ctx;
  }

  function note(frequency, { type = 'triangle', duration = .4, gain = .09, at = 0 } = {}) {
    if (!ctx || !bus) return;
    const start = ctx.currentTime + at;
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, frequency), start);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(.001, gain), start + .02);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(bus);
    oscillator.start(start);
    oscillator.stop(start + duration + .02);
    stats.notes++;
  }

  const degreeToFrequency = degree => {
    if (!config || degree < 0) return 0;
    const scale = config.scale;
    const octave = Math.floor(degree / scale.length);
    const semitone = scale[degree % scale.length];
    return config.root * Math.pow(2, (semitone + octave * 12) / 12);
  };

  function tick() {
    if (!config) return;
    const beat = step % 8;
    const degree = motif[beat] ?? 0;
    const lead = degreeToFrequency(degree);
    if (lead) note(lead * (intensity === 'combat' ? 1 : .5), { type: config.lead, duration: .38, gain: intensity === 'combat' ? .085 : .055 });
    // Bass pulse, heavier in combat.
    if (beat % 2 === 0) note(config.root / 2, { type: config.bass, duration: .5, gain: intensity === 'combat' ? .075 : .05 });
    // Combat only: a percussion-ish click and a fifth above the motif for urgency.
    if (intensity === 'combat' && beat % 4 === 2) note(degreeToFrequency((degree + 2) % 5) * 2, { type: 'sine', duration: .16, gain: .04 });
    if (config.bells && beat === 6) note(config.root * 4, { type: 'sine', duration: .8, gain: .035 });
    if (config.pulse && beat === 0) note(config.root / 4, { type: 'square', duration: .9, gain: .05 });
    step++;
  }

  function start(map = 'valley', { state = 'combat' } = {}) {
    const context = ensureContext();
    const resolved = resolveScoreMap(map);
    stats.missing = !resolved;
    stats.family = resolved?.family || null;
    mapKey = resolved?.family || 'valley';
    config = resolved?.config || MAPS.valley;
    motif = resolved?.motif || MOTIFS.valley;
    intensity = state;
    stats.map = mapKey;
    stats.intensity = intensity;
    stats.started++;
    step = 0;
    stats.stopped = false;
    if (!context) return { started: false, reason: 'no-audio-context', map: mapKey };
    context.resume?.();
    stopTimer();
    tick();
    timer = setInterval(tick, Math.round(60000 / config.tempo / 2));
    return { started: true, map: mapKey, missing: stats.missing };
  }

  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function stop() {
    stopTimer();
    config = null;
    stats.stops++;
  }

  /** Smoothly change layer intensity without restarting the motif. */
  function setIntensity(state = 'combat') {
    if (!['combat', 'explore', 'victory'].includes(state)) return intensity;
    // Before a match has chosen a map there is nothing to score; arming a timer here would report
    // an active score with no map behind it.
    if (!config) { stats.intensity = state; return intensity; }
    intensity = state;
    stats.intensity = state;
    if (state === 'explore') stopTimer(), timer = setInterval(tick, Math.round(60000 / (config?.tempo || 100) / 1.5));
    return intensity;
  }

  /** A short original fanfare for the result screen. */
  function sting(kind = 'victory') {
    if (!ensureContext() || !config) return false;
    const degrees = kind === 'victory' ? [0, 2, 4, 7] : [0, -1, 2, 1];
    degrees.forEach((degree, index) => {
      const frequency = degreeToFrequency(degree);
      if (frequency) note(frequency, { type: kind === 'victory' ? 'triangle' : 'sine', duration: .6, gain: .09, at: index * .13 });
    });
    return true;
  }

  function setMuted(value) {
    muted = Boolean(value);
    if (bus) bus.gain.value = muted ? 0 : volume;
  }

  function report() {
    return {
      map: stats.map,
      family: stats.family || null,
      intensity: stats.intensity,
      active: Boolean(timer),
      started: stats.started,
      notes: stats.notes,
      missing: stats.missing,
      stops: stats.stops,
      context: ctx ? ctx.state : 'none'
    };
  }

  return { start, stop, setIntensity, sting, setMuted, report, maps: SCORE_MAPS, get active() { return Boolean(timer); } };
}
