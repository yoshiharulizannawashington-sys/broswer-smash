// Attack presentation: a data-driven timeline for every attack class.
//
// The point of this module is that nothing about "a Rasengan sounds and looks like X" is hard-coded
// at the call site. Each attack class owns a short list of beats (anticipation, release, impact,
// recovery) in seconds; a caller starts a track and the presenter fires VFX, SFX, camera shake and
// character callouts as the beats come due. Per-identity palettes/overrides sit in one table, so a
// new fighter's effects are data, not a new branch in the combat code.
//
// Beats only ever trigger on the fixed step the game already runs, and a beat fires exactly once.

/** Element/palette identity used when a move does not state its own colour. */
export const IDENTITY_FX = Object.freeze({
  naruto_uzumaki: { color: 0xffb03a, element: 'chakra', sfx: 'whoosh' },
  thor: { color: 0x9fd8ff, element: 'lightning', sfx: 'whoosh' },
  kratos: { color: 0xff7a3c, element: 'blades', sfx: 'punch' },
  edward_elric: { color: 0x7fd8ff, element: 'alchemy', sfx: 'whoosh' },
  captain_jack_sparrow: { color: 0xd9c07a, element: 'blade', sfx: 'whoosh' },
  lord_voldemort: { color: 0x7ef07e, element: 'curse', sfx: 'whoosh' },
  aquaman: { color: 0x66e0d0, element: 'water', sfx: 'punch' },
  green_lantern_hal_jordan: { color: 0x66ff9c, element: 'will', sfx: 'whoosh' }
});

const DEFAULT_FX = Object.freeze({ color: 0xffe3a0, element: 'impact', sfx: 'punch' });

export function fxFor(identity) {
  return IDENTITY_FX[identity] || DEFAULT_FX;
}

const BEAT = (at, data) => Object.freeze({ at, ...data });

/**
 * Timelines, in seconds from the start of the move. `sfx` names are the ones the audio module
 * already exposes; `vfx` builds an impact of the given intensity at the owner's hand height.
 */
export const ATTACK_TRACKS = Object.freeze({
  // A projectile or energy attack: charge, release, travel whoosh, then recovery.
  projectile: [BEAT(0, { sfx: 'whoosh', camera: .04 }), BEAT(.12, { vfx: 9, camera: .06 }), BEAT(.42, { vfx: 4 })],
  // A summoned clone pack: puff of chakra at the spawn point, then a settling beat.
  clone: [BEAT(0, { sfx: 'whoosh', vfx: 8, camera: .1, callout: true }), BEAT(.22, { vfx: 5 }), BEAT(.5, { vfx: 3 })],
  // A transformation: aura burst, camera weight, spoken form name.
  form: [BEAT(0, { sfx: 'form', camera: .3, callout: true }), BEAT(.16, { vfx: 16, camera: .18 }), BEAT(.55, { vfx: 7 })],
  // An ultimate: the heaviest presentation in the kit.
  ultimate: [BEAT(0, { sfx: 'form', camera: .35, callout: true }), BEAT(.22, { vfx: 20, camera: .5 }), BEAT(.7, { vfx: 13 }), BEAT(1.2, { vfx: 8 })],
  // A landed heavy: contact flash and a bigger shake than a light attack.
  heavy: [BEAT(0, { sfx: 'punch' }), BEAT(.08, { vfx: 12, camera: .28 })],
  light: [BEAT(0, { sfx: 'whoosh' }), BEAT(.09, { vfx: 6, camera: .1 })]
});

export const TRACK_KINDS = Object.freeze(Object.keys(ATTACK_TRACKS));

/**
 * Resolve the beats for one move. Identity only changes colour and the fallback sound, never the
 * timing: timing belongs to the class of attack, not to who is throwing it.
 */
export function trackFor(kind, { identity = null, color = null, label = '' } = {}) {
  const beats = ATTACK_TRACKS[kind] || ATTACK_TRACKS.light;
  const fx = fxFor(identity);
  return beats.map(beat => ({
    ...beat,
    color: color ?? fx.color,
    label,
    identity,
    sfx: beat.sfx || fx.sfx
  }));
}

/**
 * Runtime driver. `start()` is called by the combat code when an attack actually begins;
 * `update()` is called once per frame. The presenter never deals damage and never decides whether
 * an attack is allowed - it only presents attacks that the combat systems already accepted.
 */
export function createPresenter({ vfx = null, audio = null, camera = null, dialogue = null, resolveVfx = null, resolveAudio = null } = {}) {
  const active = [];
  const stats = { tracks: 0, beats: 0, byKind: Object.create(null), vfx: 0, sfx: 0, callouts: 0 };

  function positionOf(origin, three) {
    if (!origin) return null;
    if (origin.isVector3) return origin;
    if (origin.position) {
      const base = origin.position;
      return three ? new three.Vector3(base.x, base.y + 1.05, base.z) : { x: base.x, y: base.y + 1.05, z: base.z, clone() { return this; } };
    }
    return origin;
  }

  /** Start presenting one attack. Returns the number of beats scheduled. */
  function start(kind, { owner = null, label = '', color = null, origin = null, three = null, identity = null } = {}) {
    const beats = trackFor(kind, { identity: identity || owner?.identity, color, label });
    const track = {
      kind,
      label: label || kind,
      owner,
      identity: identity || owner?.identity || null,
      beats,
      time: 0,
      fired: new Set()
    };
    active.push(track);
    stats.tracks++;
    stats.byKind[kind] = (stats.byKind[kind] || 0) + 1;
    // Position is captured now: a fighter that gets knocked away mid-attack should not drag the
    // effect with them.
    track.position = positionOf(origin || owner?.position, three) || positionOf(owner?.model, three);
    return beats.length;
  }

  // The effects system and the audio bus are created during game boot, which can be after this
  // presenter is constructed. Resolving them per beat means presentation never silently no-ops
  // because a reference was captured too early.
  // `resolveVfx`/`resolveAudio` are supplied by the game module that owns those systems, so a
  // presenter built before they exist still dispatches once they do.
  const effectSystem = () => (resolveVfx ? resolveVfx() : vfx) || globalThis.window?.__browserSmashEffects?.() || null;
  const audioSystem = () => (resolveAudio ? resolveAudio() : audio) || globalThis.window?.combatAudio || null;

  function fire(track, beat) {
    stats.beats++;
    const position = track.position || positionOf(track.owner?.position);
    const effects = effectSystem();
    if (beat.vfx && effects && position) {
      try {
        effects.impact(position, { color: beat.color, intensity: beat.vfx, kind: track.kind });
        stats.vfx++;
      } catch { /* a missing VFX system must not interrupt combat */ }
    }
    const sound = audioSystem();
    if (beat.sfx && sound) {
      try {
        if (sound.play(beat.sfx, { position }) !== false) stats.sfx++;
      } catch { /* audio failures are non-fatal */ }
    }
    if (beat.camera && camera) {
      try { camera.impact(beat.camera); } catch { /* ignore */ }
    }
    if (beat.callout && dialogue) {
      try {
        const line = dialogue.callout(track.identity, track.kind, track.label);
        if (line) stats.callouts++;
      } catch { /* ignore */ }
    }
  }

  function update(dt) {
    const step = Math.max(0, Number(dt) || 0);
    for (let index = active.length - 1; index >= 0; index--) {
      const track = active[index];
      track.time += step;
      track.beats.forEach((beat, beatIndex) => {
        if (track.fired.has(beatIndex) || track.time < beat.at) return;
        track.fired.add(beatIndex);
        fire(track, beat);
      });
      if (track.fired.size >= track.beats.length) active.splice(index, 1);
    }
  }

  function clear() {
    active.length = 0;
  }

  function describe() {
    return {
      active: active.map(track => ({ kind: track.kind, label: track.label, time: +track.time.toFixed(2), beats: track.beats.length })),
      current: active.length,
      ...stats,
      byKind: { ...stats.byKind }
    };
  }

  return { start, update, clear, describe, get activeCount() { return active.length; } };
}
