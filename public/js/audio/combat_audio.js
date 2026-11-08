// Combat audio: procedural sound effects, synthesised at runtime with Web Audio.
//
// There are no audio files in this project and nothing was downloaded, so every sound here is
// generated from oscillators and one cached noise buffer. That keeps the project free of
// unclear licensing and keeps the download small.
//
// Rules this module follows:
//  * Nothing plays before a real user gesture (browser autoplay policy), so the context is only
//    created on the first pointer/key press and resumed if the browser suspends it.
//  * Repeated simulation frames cannot stack: each event name has a minimum interval and a
//    global voice budget, so a 24-spark hit is one sound, not twenty-four.
//  * It is optional. Muting is persisted, and every call is a no-op when muted or unsupported.
//  * It never throws into the game loop: a missing AudioContext disables the module quietly.
//  * Three buses (effects, music, ambience) hang off one master fader, so mute and pause mean
//    silence for everything, while music and ambience can be balanced separately.
//  * Events that happen somewhere in the world can be positioned: `play(name, { position })`
//    routes the voice through a Web Audio panner relative to the listener.

const STORAGE_MUTED = 'browserSmashAudioMuted';
const STORAGE_VOLUME = 'browserSmashAudioVolume';
const STORAGE_MUSIC = 'browserSmashMusicVolume';
const STORAGE_AMBIENCE = 'browserSmashAmbienceVolume';

/** Minimum seconds between two plays of the same event. */
const THROTTLE = Object.freeze({
  impactLight: 0.035,
  impactHeavy: 0.055,
  guard: 0.06,
  projectile: 0.055,
  form: 0.25,
  ultimate: 0.35,
  ko: 0.4,
  jump: 0.09,
  land: 0.09,
  whoosh: 0.08,
  footstep: 0.16,
  kick: 0.05,
  dodge: 0.14,
  grab: 0.12,
  throw: 0.18,
  explosion: 0.14,
  flight: 0.22,
  menuMove: 0.03,
  menuSelect: 0.05,
  menuBack: 0.05,
  pickup: 0.09,
  shield: 0.2,
  hazard: 0.3,
  victory: 1.2,
  defeat: 1.2
});

const MAX_VOICES_PER_FRAME = 10;

function readNumber(key, fallback) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  } catch (_error) {
    return fallback;
  }
}

function writeValue(key, value) {
  try { globalThis.localStorage?.setItem(key, String(value)); } catch (_error) { /* private mode */ }
}

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));

export function createCombatAudio() {
  let ctx = null;
  let master = null;
  let musicBus = null;
  let ambienceBus = null;
  let noise = null;
  let muted = readNumber(STORAGE_MUTED, 0) === 1;
  let volume = clamp01(readNumber(STORAGE_VOLUME, 0.55));
  let musicVolume = clamp01(readNumber(STORAGE_MUSIC, 0.4));
  let ambienceVolume = clamp01(readNumber(STORAGE_AMBIENCE, 0.35));
  let unlocked = false;
  // A paused match must not keep sounding off: the simulation stops, so a ringing reverb tail or
  // a queued oscilloscope would be the only thing still "playing". Freezing the master gain and
  // refusing new voices makes pause mean silence as well as stillness.
  let paused = false;
  let frameVoices = 0;
  let lastFrame = 0;
  let listener = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1 };
  let musicTimer = null;
  let musicStep = 0;
  let ambienceSource = null;
  let ambiencePreset = null;
  const lastPlayed = new Map();
  const stats = { plays: 0, dropped: 0, throttled: 0, spatial: 0, byName: Object.create(null) };

  function ensureContext() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : volume;
      // A gentle limiter keeps stacked hits from clipping on laptop speakers.
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 12;
      compressor.ratio.value = 6;
      master.connect(compressor);
      compressor.connect(ctx.destination);
      // Music and ambience are separate faders feeding the same master, so mute/pause still
      // silences them, but a player can turn the score down without losing the punches.
      musicBus = ctx.createGain();
      musicBus.gain.value = musicVolume;
      musicBus.connect(master);
      ambienceBus = ctx.createGain();
      ambienceBus.gain.value = ambienceVolume;
      ambienceBus.connect(master);
      // One second of white noise, generated once and reused by every impact.
      const length = Math.floor(ctx.sampleRate);
      noise = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    } catch (_error) {
      ctx = null;
      return null;
    }
    return ctx;
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    const context = ensureContext();
    if (context && context.state === 'suspended') context.resume().catch(() => {});
  }

  function budget() {
    // Voices are budgeted per animation frame (not wall clock) so a slow Chromebook cannot
    // machine-gun a single hit into a hundred overlapping blips.
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastFrame > 8) {
      lastFrame = now;
      frameVoices = 0;
    }
    if (frameVoices >= MAX_VOICES_PER_FRAME) {
      stats.dropped++;
      return false;
    }
    frameVoices++;
    return true;
  }

  /**
   * Where a voice goes. `position` produces a panner in world space using the current listener;
   * anything else lands on a bus. A browser without panner support silently falls back to the bus,
   * which is why a missing spatial stage can never mute a hit.
   */
  function outFor(options = {}) {
    if (options.position && ctx?.createPanner) {
      try {
        const panner = ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 2.5;
        panner.maxDistance = 45;
        panner.rolloffFactor = 1.1;
        if (panner.positionX) {
          panner.positionX.value = Number(options.position.x) || 0;
          panner.positionY.value = Number(options.position.y) || 0;
          panner.positionZ.value = Number(options.position.z) || 0;
        } else {
          panner.setPosition?.(Number(options.position.x) || 0, Number(options.position.y) || 0, Number(options.position.z) || 0);
        }
        panner.connect(master);
        stats.spatial++;
        return panner;
      } catch (_error) {
        // fall through to the bus
      }
    }
    if (options.bus === 'music' && musicBus) return musicBus;
    if (options.bus === 'ambience' && ambienceBus) return ambienceBus;
    return master;
  }

  function tone({ type = 'sine', from = 220, to = from, duration = 0.15, gain = 0.25, delay = 0, curve = 'exp', out = null }) {
    const context = ctx;
    const osc = context.createOscillator();
    const env = context.createGain();
    osc.type = type;
    const start = context.currentTime + delay;
    osc.frequency.setValueAtTime(Math.max(20, from), start);
    if (to !== from) {
      if (curve === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration);
      else osc.frequency.linearRampToValueAtTime(Math.max(20, to), start + duration);
    }
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(env);
    env.connect(out || master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
    osc.onended = () => { osc.disconnect(); env.disconnect(); };
  }

  function burst({ duration = 0.18, gain = 0.3, from = 1800, to = 320, q = 1.1, delay = 0, out = null }) {
    const context = ctx;
    const source = context.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = q;
    const start = context.currentTime + delay;
    filter.frequency.setValueAtTime(from, start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, to), start + duration);
    const env = context.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(env);
    env.connect(out || master);
    source.start(start);
    source.stop(start + duration + 0.03);
    source.onended = () => { source.disconnect(); filter.disconnect(); env.disconnect(); };
  }

  const VOICES = {
    impactLight({ intensity = 8 } = {}, out) {
      const weight = Math.min(1, intensity / 20);
      burst({ duration: 0.1 + weight * 0.1, gain: 0.16 + weight * 0.16, from: 2400 - weight * 900, to: 500, q: 0.9, out });
      tone({ type: 'triangle', from: 190 - weight * 40, to: 90, duration: 0.11 + weight * 0.08, gain: 0.12 + weight * 0.1, out });
    },
    impactHeavy({ intensity = 18 } = {}, out) {
      const weight = Math.min(1, intensity / 30);
      burst({ duration: 0.2 + weight * 0.14, gain: 0.26 + weight * 0.14, from: 1900, to: 240, q: 0.7, out });
      tone({ type: 'sine', from: 130, to: 44, duration: 0.24 + weight * 0.14, gain: 0.26 + weight * 0.12, out });
      tone({ type: 'square', from: 320, to: 120, duration: 0.1, gain: 0.06, delay: 0.01, out });
    },
    kick({ intensity = 14 } = {}, out) {
      // A kick is heavier in the lows and duller than a punch, so it reads as a different limb.
      burst({ duration: 0.16, gain: 0.2 + Math.min(0.12, intensity * 0.006), from: 1200, to: 220, q: 0.6, out });
      tone({ type: 'sine', from: 105, to: 52, duration: 0.2, gain: 0.24, out });
    },
    guard(_, out) {
      tone({ type: 'triangle', from: 900, to: 620, duration: 0.09, gain: 0.1, out });
      burst({ duration: 0.07, gain: 0.1, from: 5200, to: 2200, q: 2.6, out });
    },
    dodge(_, out) {
      burst({ duration: 0.2, gain: 0.09, from: 900, to: 3000, q: 0.7, out });
      tone({ type: 'triangle', from: 420, to: 760, duration: 0.14, gain: 0.05, curve: 'lin', out });
    },
    grab(_, out) {
      burst({ duration: 0.09, gain: 0.14, from: 700, to: 400, q: 1.6, out });
      tone({ type: 'square', from: 150, to: 190, duration: 0.08, gain: 0.08, out });
    },
    throw(_, out) {
      burst({ duration: 0.3, gain: 0.16, from: 1800, to: 200, q: 0.6, out });
      tone({ type: 'sawtooth', from: 260, to: 70, duration: 0.3, gain: 0.1, out });
    },
    footstep({ surface = 'stone' } = {}, out) {
      const from = surface === 'metal' ? 2200 : surface === 'grass' ? 900 : 1500;
      burst({ duration: 0.06, gain: 0.055, from, to: 260, q: 1.2, out });
      tone({ type: 'sine', from: 88, to: 62, duration: 0.06, gain: 0.06, out });
    },
    projectile({ pitch = 1 } = {}, out) {
      tone({ type: 'sawtooth', from: 620 * pitch, to: 240 * pitch, duration: 0.14, gain: 0.08, out });
      burst({ duration: 0.1, gain: 0.07, from: 2600, to: 900, q: 1.4, out });
    },
    explosion({ intensity = 20 } = {}, out) {
      const weight = Math.min(1, intensity / 40);
      burst({ duration: 0.5 + weight * 0.3, gain: 0.3, from: 1600, to: 90, q: 0.4, out });
      tone({ type: 'sine', from: 90, to: 28, duration: 0.6, gain: 0.3, out });
      tone({ type: 'square', from: 200, to: 60, duration: 0.24, gain: 0.07, delay: 0.03, out });
    },
    flight({ speed = 1 } = {}, out) {
      // Continuous lift: filtered noise swept up, quiet on purpose so it can repeat while flying.
      burst({ duration: 0.34, gain: 0.05 + Math.min(0.05, speed * 0.01), from: 500, to: 1400, q: 0.6, out });
    },
    form(_, out) {
      tone({ type: 'sine', from: 160, to: 620, duration: 0.5, gain: 0.16, curve: 'lin', out });
      tone({ type: 'triangle', from: 240, to: 940, duration: 0.46, gain: 0.08, delay: 0.05, curve: 'lin', out });
      burst({ duration: 0.5, gain: 0.12, from: 400, to: 3200, q: 0.8, out });
    },
    formEnd(_, out) {
      tone({ type: 'sine', from: 520, to: 140, duration: 0.4, gain: 0.12, curve: 'lin', out });
    },
    ultimate(_, out) {
      tone({ type: 'sine', from: 90, to: 300, duration: 0.55, gain: 0.24, curve: 'lin', out });
      tone({ type: 'sawtooth', from: 180, to: 60, duration: 0.7, gain: 0.1, delay: 0.12, out });
      burst({ duration: 0.6, gain: 0.16, from: 300, to: 2400, q: 0.6, out });
    },
    ko(_, out) {
      tone({ type: 'sine', from: 220, to: 40, duration: 0.85, gain: 0.3, out });
      burst({ duration: 0.5, gain: 0.2, from: 2600, to: 180, q: 0.5, out });
    },
    jump(_, out) {
      tone({ type: 'triangle', from: 320, to: 520, duration: 0.12, gain: 0.07, curve: 'lin', out });
    },
    land({ intensity = 6 } = {}, out) {
      burst({ duration: 0.13, gain: 0.1 + Math.min(0.12, intensity * 0.01), from: 900, to: 180, q: 0.8, out });
      tone({ type: 'sine', from: 110, to: 60, duration: 0.14, gain: 0.12, out });
    },
    whoosh(_, out) {
      burst({ duration: 0.16, gain: 0.09, from: 1400, to: 300, q: 0.9, out });
    },
    pickup({ kind = 'health' } = {}, out) {
      const base = kind === 'power' ? 460 : kind === 'shield' ? 380 : 520;
      tone({ type: 'triangle', from: base, to: base * 1.5, duration: 0.1, gain: 0.1, curve: 'lin', out });
      tone({ type: 'sine', from: base * 1.5, to: base * 2, duration: 0.14, gain: 0.08, delay: 0.07, out });
    },
    shield(_, out) {
      tone({ type: 'sine', from: 300, to: 900, duration: 0.3, gain: 0.12, curve: 'lin', out });
      burst({ duration: 0.26, gain: 0.06, from: 3000, to: 1200, q: 2.2, out });
    },
    hazard(_, out) {
      burst({ duration: 0.4, gain: 0.12, from: 300, to: 1600, q: 0.5, out });
      tone({ type: 'sawtooth', from: 70, to: 120, duration: 0.35, gain: 0.1, out });
    },
    menuMove(_, out) {
      tone({ type: 'square', from: 640, to: 700, duration: 0.045, gain: 0.035, out });
    },
    menuSelect(_, out) {
      tone({ type: 'square', from: 520, to: 780, duration: 0.09, gain: 0.055, curve: 'lin', out });
      tone({ type: 'sine', from: 1040, to: 1240, duration: 0.1, gain: 0.035, delay: 0.05, out });
    },
    menuBack(_, out) {
      tone({ type: 'square', from: 520, to: 300, duration: 0.1, gain: 0.05, curve: 'lin', out });
    },
    victory(_, out) {
      // A short ascending fanfare, authored rather than borrowed so it is original.
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, i) => tone({ type: 'triangle', from: freq, to: freq, duration: 0.28, gain: 0.1, delay: i * 0.12, out }));
      tone({ type: 'sine', from: 261.63, to: 261.63, duration: 0.9, gain: 0.08, delay: 0.1, out });
    },
    defeat(_, out) {
      const notes = [392, 349.23, 293.66, 196];
      notes.forEach((freq, i) => tone({ type: 'sine', from: freq, to: freq * 0.99, duration: 0.4, gain: 0.09, delay: i * 0.16, out }));
    }
  };

  /** Games and tools read this to know which brief category each event belongs to. */
  const EVENT_CATEGORIES = Object.freeze({
    menu: ['menuMove', 'menuSelect', 'menuBack'],
    selection: ['menuSelect', 'menuBack'],
    footstep: ['footstep'],
    punch: ['impactLight', 'impactHeavy', 'whoosh'],
    kick: ['kick'],
    block: ['guard'],
    dodge: ['dodge'],
    grab: ['grab'],
    throw: ['throw'],
    impact: ['impactLight', 'impactHeavy', 'land'],
    energy: ['projectile', 'form', 'formEnd', 'ultimate'],
    explosion: ['explosion'],
    flight: ['flight'],
    landing: ['land'],
    ambience: ['startAmbience'],
    music: ['startMusic'],
    result: ['victory', 'defeat', 'ko']
  });

  function play(name, options = {}) {
    if (muted || paused || !unlocked) return false;
    const voice = VOICES[name];
    if (!voice) return false;
    const context = ensureContext();
    if (!context) return false;
    const now = context.currentTime;
    const gap = THROTTLE[name] ?? 0.05;
    // `-Infinity` rather than -1: at currentTime 0 a 1.2 s gap would otherwise throttle the
    // very first victory/defeat fanfare of the session.
    const last = lastPlayed.has(name) ? lastPlayed.get(name) : -Infinity;
    if (now - last < gap) {
      stats.throttled++;
      return false;
    }
    if (!budget()) return false;
    lastPlayed.set(name, now);
    try {
      voice(options, outFor(options));
    } catch (_error) {
      return false;
    }
    stats.plays++;
    stats.byName[name] = (stats.byName[name] || 0) + 1;
    return true;
  }

  /** World position and facing of the ear. Called by the game each frame; safe without support. */
  function setListener(position, forward) {
    listener = {
      x: Number(position?.x) || 0,
      y: Number(position?.y) || 0,
      z: Number(position?.z) || 0,
      fx: Number(forward?.x) || 0,
      fy: Number(forward?.y) || 0,
      fz: Number(forward?.z) ?? -1
    };
    if (!ctx || !ctx.listener) return listener;
    const l = ctx.listener;
    try {
      if (l.positionX) {
        l.positionX.value = listener.x; l.positionY.value = listener.y; l.positionZ.value = listener.z;
        l.forwardX.value = listener.fx; l.forwardY.value = listener.fy; l.forwardZ.value = listener.fz;
        l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
      } else {
        l.setPosition?.(listener.x, listener.y, listener.z);
        l.setOrientation?.(listener.fx, listener.fy, listener.fz, 0, 1, 0);
      }
    } catch (_error) { /* older listeners */ }
    return listener;
  }

  // ---- Music: a slow minor arpeggio loop, scheduled ahead of the clock ----
  const MUSIC_STEPS = [220, 261.63, 329.63, 392, 329.63, 261.63, 196, 246.94];
  function musicTick() {
    if (!ctx || paused || muted) return;
    const freq = MUSIC_STEPS[musicStep % MUSIC_STEPS.length];
    const octave = musicStep % 16 >= 8 ? 2 : 1;
    tone({ type: 'triangle', from: freq * octave, to: freq * octave, duration: 0.5, gain: 0.07, out: musicBus });
    if (musicStep % 4 === 0) {
      tone({ type: 'sine', from: freq / 2, to: freq / 2, duration: 1.1, gain: 0.06, out: musicBus });
    }
    musicStep++;
  }

  function startMusic() {
    if (musicTimer || paused) return Boolean(musicTimer);
    ensureContext();
    if (!ctx) return false;
    musicTick();
    musicTimer = setInterval(musicTick, 380);
    return true;
  }

  function stopMusic() {
    if (musicTimer) clearInterval(musicTimer);
    musicTimer = null;
    return true;
  }

  // ---- Ambience: a very low filtered noise bed, per-scene tuning ----
  const AMBIENCE_PRESETS = Object.freeze({
    outdoor: { from: 420, q: 0.5, gain: 0.5 },
    interior: { from: 220, q: 0.8, gain: 0.42 },
    volcanic: { from: 140, q: 0.6, gain: 0.55 },
    ice: { from: 900, q: 0.4, gain: 0.35 },
    city: { from: 600, q: 0.7, gain: 0.45 }
  });

  function startAmbience(preset = 'outdoor') {
    if (!unlocked || muted) return false;
    const context = ensureContext();
    if (!context || !noise) return false;
    const spec = AMBIENCE_PRESETS[preset] || AMBIENCE_PRESETS.outdoor;
    stopAmbience();
    try {
      const source = context.createBufferSource();
      source.buffer = noise;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = spec.from;
      filter.Q.value = spec.q;
      const gain = context.createGain();
      gain.gain.value = spec.gain;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(ambienceBus);
      source.start();
      ambienceSource = { source, filter, gain };
      ambiencePreset = preset;
      return true;
    } catch (_error) {
      return false;
    }
  }

  function stopAmbience() {
    if (ambienceSource) {
      try { ambienceSource.source.stop(); } catch (_error) { /* already stopped */ }
      try {
        ambienceSource.source.disconnect();
        ambienceSource.filter.disconnect();
        ambienceSource.gain.disconnect();
      } catch (_error) { /* already disconnected */ }
      ambienceSource = null;
    }
    ambiencePreset = null;
    return true;
  }

  function setMuted(next) {
    muted = Boolean(next);
    writeValue(STORAGE_MUTED, muted ? 1 : 0);
    if (master) master.gain.value = muted ? 0 : volume;
    return muted;
  }

  function setVolume(next) {
    volume = clamp01(next);
    writeValue(STORAGE_VOLUME, volume);
    if (master && !muted) master.gain.value = paused ? 0 : volume;
    return volume;
  }

  function setMusicVolume(next) {
    musicVolume = clamp01(next);
    writeValue(STORAGE_MUSIC, musicVolume);
    if (musicBus) musicBus.gain.value = musicVolume;
    return musicVolume;
  }

  function setAmbienceVolume(next) {
    ambienceVolume = clamp01(next);
    writeValue(STORAGE_AMBIENCE, ambienceVolume);
    if (ambienceBus) ambienceBus.gain.value = ambienceVolume;
    return ambienceVolume;
  }

  /** Freeze or resume audio for a paused match. Persisted mute/volume are untouched. */
  function setPaused(next) {
    paused = Boolean(next);
    if (master) master.gain.value = paused || muted ? 0 : volume;
    return paused;
  }

  // Unlock on the first real gesture. `once` is not used so a browser that starts the context
  // suspended (tab switch) can be resumed by the next press.
  if (typeof window !== 'undefined' && window.addEventListener) {
    const gesture = () => unlock();
    window.addEventListener('pointerdown', gesture, { passive: true });
    window.addEventListener('keydown', gesture, { passive: true });
    window.addEventListener('touchstart', gesture, { passive: true });
    window.addEventListener('keydown', event => {
      if (event.code === 'KeyM' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        const nowMuted = setMuted(!muted);
        window.showCombatCallout?.(nowMuted ? 'AUDIO MUTED · CTRL+M' : 'AUDIO ON · CTRL+M', '#bfe9ff');
      }
    });
  }

  return {
    play, setMuted, setVolume, setMusicVolume, setAmbienceVolume, setPaused, setListener,
    startMusic, stopMusic, startAmbience, stopAmbience, unlock,
    get muted() { return muted; },
    get volume() { return volume; },
    get musicVolume() { return musicVolume; },
    get ambienceVolume() { return ambienceVolume; },
    get paused() { return paused; },
    get ready() { return Boolean(ctx) && !muted; },
    get musicPlaying() { return Boolean(musicTimer); },
    get ambiencePreset() { return ambiencePreset; },
    get voiceNames() { return Object.keys(VOICES); },
    get eventCategories() { return EVENT_CATEGORIES; },
    get ambiencePresets() { return Object.keys(AMBIENCE_PRESETS); },
    get listener() { return { ...listener }; },
    describe: () => ({
      supported: Boolean(globalThis.AudioContext || globalThis.webkitAudioContext),
      spatial: Boolean(ctx?.createPanner),
      unlocked,
      muted,
      paused,
      volume,
      musicVolume,
      ambienceVolume,
      musicPlaying: Boolean(musicTimer),
      ambience: ambiencePreset,
      voices: Object.keys(VOICES).length,
      categories: Object.keys(EVENT_CATEGORIES).length,
      ...stats
    })
  };
}

/** The game-wide instance. `window.combatAudio` is also the tooling/QA handle. */
export function installCombatAudio() {
  if (globalThis.window?.combatAudio) return globalThis.window.combatAudio;
  const audio = createCombatAudio();
  if (globalThis.window) globalThis.window.combatAudio = audio;
  return audio;
}
