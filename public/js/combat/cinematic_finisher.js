// Cinematic finishers: the camera and timing language for an ultimate that connects.
//
// Every ultimate in the game already resolves real damage through the runner in combat/ultimate.js.
// What none of them had was presentation: 34 labels on 7 shared behaviours, and no sequence data at
// all. This module is the missing layer and it is deliberately pure (no THREE, no DOM), so the
// timeline can be asserted in node and previewed against the real camera in the browser.
//
// Rules it keeps:
//   * A finisher NEVER invents damage. It only plays when the runner reports a real hit, and it
//     cannot extend or delay the ultimate's own hit windows.
//   * Every beat is authored per identity, so two fighters do not share a camera move.
//   * A whiffed ultimate plays no cinematic at all: the sequence asks for hitConfirmation and ends.

/** Ordered beats. `intro` and `clash` play on cast; `finisher` and `impact` need a landed hit. */
export const BEATS = Object.freeze(['intro', 'clash', 'finisher', 'impact', 'recover']);

const cam = (distance, height, yaw, pitch, look = 'mid', fov = 42) => Object.freeze({ distance, height, yaw, pitch, look, fov });

/**
 * Authored finishers. `shots` maps a beat to a camera setup:
 *   distance  metres from the look point
 *   height    metres above it
 *   yaw       radians around it (0 = behind the owner looking forward)
 *   pitch     radians of downward tilt
 *   look      'owner' | 'target' | 'mid'
 *   fov       vertical field of view
 * `hold` is how long the beat lasts before the next one; `flash` peaks at the impact.
 */
export const FINISHERS = Object.freeze({
  goku: Object.freeze({
    label: 'DRAGON NOVA',
    hold: Object.freeze({ intro: .55, clash: .45, finisher: .7, impact: .5, recover: .55 }),
    flash: Object.freeze({ intro: .1, clash: .22, finisher: .5, impact: 1, recover: .25 }),
    scale: Object.freeze({ intro: .55, clash: .8, finisher: 1, impact: 1.35, recover: .8 }),
    shots: Object.freeze({
      intro: cam(9.4, 2.1, -0.55, 0.06, 'owner', 46),
      clash: cam(6.2, 1.2, -0.18, 0.03, 'owner', 40),
      finisher: cam(4.4, 2.6, 0.35, 0.16, 'target', 34),
      impact: cam(11.5, 3.4, 0.9, 0.22, 'mid', 52),
      recover: cam(8.2, 2.4, 0.2, 0.1, 'mid', 44)
    })
  }),
  iron_man_tony_stark: Object.freeze({
    label: 'ARC REACTOR OVERLOAD',
    hold: Object.freeze({ intro: .4, clash: .35, finisher: .6, impact: .45, recover: .45 }),
    flash: Object.freeze({ intro: .14, clash: .3, finisher: .62, impact: .9, recover: .3 }),
    scale: Object.freeze({ intro: .45, clash: .75, finisher: 1.05, impact: 1.25, recover: .85 }),
    shots: Object.freeze({
      intro: cam(8.2, 3.1, -0.9, 0.14, 'owner', 44),
      clash: cam(5.4, 1.6, -0.45, 0.05, 'owner', 38),
      finisher: cam(3.6, 1.9, 0.5, 0.12, 'target', 32),
      impact: cam(10.2, 4.2, 1.15, 0.3, 'mid', 50),
      recover: cam(7.6, 2.8, 0.35, 0.12, 'mid', 42)
    })
  }),

  // The rest of the roster is authored by ultimate *behaviour*, then tuned per identity, so a
  // grappling finisher never borrows a projectile's camera language.
  hulk_bruce_banner: Object.freeze({
    label: 'WORLDBREAKER IMPACT',
    hold: Object.freeze({ intro: .6, clash: .5, finisher: .8, impact: .55, recover: .6 }),
    flash: Object.freeze({ intro: .12, clash: .26, finisher: .55, impact: 1, recover: .3 }),
    scale: Object.freeze({ intro: .6, clash: .85, finisher: 1.05, impact: 1.4, recover: .85 }),
    shots: Object.freeze({
      // Low, heavy, and close to the floor: Hulk is felt through the ground he breaks.
      intro: cam(7.8, 0.9, -0.75, -0.12, 'owner', 50),
      clash: cam(5.2, 0.7, -0.35, -0.18, 'owner', 44),
      finisher: cam(4.2, 1.1, 0.45, -0.22, 'target', 38),
      impact: cam(9.6, 1.6, 1.0, -0.3, 'mid', 58),
      recover: cam(8.4, 2.0, 0.3, -0.08, 'mid', 46)
    })
  }),
  the_flash_barry_allen: Object.freeze({
    label: 'INFINITE MASS IMPACT',
    hold: Object.freeze({ intro: .34, clash: .3, finisher: .5, impact: .34, recover: .4 }),
    flash: Object.freeze({ intro: .18, clash: .34, finisher: .7, impact: .95, recover: .34 }),
    scale: Object.freeze({ intro: .5, clash: .8, finisher: 1.1, impact: 1.3, recover: .9 }),
    shots: Object.freeze({
      // Snap timing and lateral offsets read as speed; nothing lingers.
      intro: cam(10.2, 2.4, -1.35, 0.1, 'owner', 52),
      clash: cam(6.8, 1.8, -0.95, 0.06, 'owner', 46),
      finisher: cam(3.8, 1.4, 0.95, 0.1, 'target', 36),
      impact: cam(12.4, 3.0, 1.65, 0.24, 'mid', 60),
      recover: cam(7.4, 2.2, 0.6, 0.08, 'mid', 46)
    })
  }),
  wonder_woman: Object.freeze({
    label: 'WRATH OF THE AMAZONS',
    hold: Object.freeze({ intro: .5, clash: .45, finisher: .7, impact: .48, recover: .55 }),
    flash: Object.freeze({ intro: .1, clash: .24, finisher: .5, impact: .95, recover: .28 }),
    scale: Object.freeze({ intro: .5, clash: .8, finisher: 1, impact: 1.3, recover: .85 }),
    shots: Object.freeze({
      // A grapple: the camera stays at human height and turns with the throw.
      intro: cam(7.2, 1.7, 0.55, 0.04, 'owner', 44),
      clash: cam(4.4, 1.5, 0.85, 0.02, 'owner', 38),
      finisher: cam(3.4, 1.6, -0.7, 0.06, 'target', 34),
      impact: cam(10.8, 2.2, -1.2, 0.16, 'mid', 48),
      recover: cam(7.0, 1.9, -0.4, 0.08, 'mid', 42)
    })
  }),
  green_lantern_hal_jordan: Object.freeze({
    label: 'EMERALD JUDGMENT',
    hold: Object.freeze({ intro: .45, clash: .4, finisher: .65, impact: .45, recover: .5 }),
    flash: Object.freeze({ intro: .12, clash: .28, finisher: .58, impact: .9, recover: .3 }),
    scale: Object.freeze({ intro: .55, clash: .85, finisher: 1.05, impact: 1.25, recover: .85 }),
    shots: Object.freeze({
      // Construct zone: high orbit, looking down into the dome he seals.
      intro: cam(10.6, 3.6, -0.25, 0.3, 'owner', 46),
      clash: cam(7.4, 2.9, 0.15, 0.26, 'owner', 42),
      finisher: cam(5.2, 2.4, 0.65, 0.22, 'mid', 38),
      impact: cam(13.0, 4.4, 1.35, 0.4, 'mid', 54),
      recover: cam(9.0, 3.2, 0.5, 0.18, 'mid', 44)
    })
  }),
  aquaman: Object.freeze({
    label: "LEVIATHAN'S JUDGMENT",
    hold: Object.freeze({ intro: .5, clash: .42, finisher: .68, impact: .5, recover: .52 }),
    flash: Object.freeze({ intro: .12, clash: .3, finisher: .6, impact: .95, recover: .32 }),
    scale: Object.freeze({ intro: .55, clash: .85, finisher: 1.05, impact: 1.3, recover: .88 }),
    shots: Object.freeze({
      // Tide-level horizon: the storm reads from just above the waterline.
      intro: cam(9.8, 1.2, -0.85, 0.02, 'owner', 48),
      clash: cam(6.6, 0.9, -0.4, -0.02, 'owner', 42),
      finisher: cam(4.6, 1.4, 0.5, 0.08, 'target', 36),
      impact: cam(12.2, 2.0, 1.1, 0.2, 'mid', 52),
      recover: cam(8.6, 1.7, 0.3, 0.06, 'mid', 44)
    })
  }),

  // --- Phase 29.1 pilot: four identities that share no behaviour, authored as data only --------
  // These add presentation, not mechanics. Each one uses the same five-shot contract as the seven
  // above, so it proves the camera layer is reusable without a code path of its own. Note that the
  // applied placement uses distance / height / yaw / look / fov; `pitch` is authored for parity but
  // does not move the camera (documented in artifacts/dev/phase291/CAMERA_AUDIT.md).
  saitama: Object.freeze({
    label: 'SERIOUS SERIES',
    hold: Object.freeze({ intro: .5, clash: .35, finisher: .55, impact: .6, recover: .7 }),
    flash: Object.freeze({ intro: .08, clash: .18, finisher: .45, impact: 1, recover: .2 }),
    scale: Object.freeze({ intro: .5, clash: .75, finisher: 1, impact: 1.35, recover: .8 }),
    shots: Object.freeze({
      // Flat, wide and slightly bored: the frame refuses to sell the move. The one big beat is the
      // pull-back at impact, so the damage is what sells it, not the lens.
      intro: cam(12.5, 1.0, 0.05, 0.0, 'mid', 48),
      clash: cam(8.0, 0.6, 0.0, 0.0, 'owner', 44),
      finisher: cam(4.2, 1.5, 0.85, 0.06, 'target', 34),
      impact: cam(16.0, 2.2, 1.25, 0.14, 'mid', 56),
      recover: cam(11.0, 1.8, 0.15, 0.04, 'mid', 48)
    })
  }),
  sasuke_uchiha: Object.freeze({
    label: 'KIRIN',
    hold: Object.freeze({ intro: .4, clash: .32, finisher: .5, impact: .45, recover: .5 }),
    flash: Object.freeze({ intro: .2, clash: .34, finisher: .68, impact: 1, recover: .34 }),
    scale: Object.freeze({ intro: .55, clash: .8, finisher: 1.05, impact: 1.3, recover: .85 }),
    shots: Object.freeze({
      // Sky strike: the camera stays near the floor for every beat, so the lightning falls INTO the
      // frame from above instead of being filmed across it. Wide and low at impact, where the flash is.
      intro: cam(11.0, 0.25, -0.35, -0.1, 'owner', 50),
      clash: cam(6.5, 0.3, -0.15, -0.18, 'owner', 44),
      finisher: cam(4.6, 0.15, 0.5, -0.22, 'target', 36),
      impact: cam(15.5, 0.6, 1.4, -0.12, 'mid', 60),
      recover: cam(9.5, 1.2, 0.3, 0.02, 'mid', 46)
    })
  }),
  lord_voldemort: Object.freeze({
    label: 'AVADA KEDAVRA',
    hold: Object.freeze({ intro: .62, clash: .5, finisher: .8, impact: .55, recover: .62 }),
    flash: Object.freeze({ intro: .14, clash: .3, finisher: .62, impact: .95, recover: .26 }),
    scale: Object.freeze({ intro: .5, clash: .78, finisher: 1, impact: 1.25, recover: .82 }),
    shots: Object.freeze({
      // Precision, not power: a slow high opening, a close frame on the wand, then a dead-level
      // shot down the killing line. The overhead finish is the only wide beat.
      intro: cam(9.6, 2.6, 0.15, 0.1, 'owner', 44),
      clash: cam(5.0, 1.8, -0.2, 0.08, 'owner', 36),
      finisher: cam(4.0, 1.2, 0.35, 0.04, 'target', 32),
      impact: cam(13.5, 4.6, 1.05, 0.3, 'mid', 52),
      recover: cam(8.8, 2.2, -0.25, 0.06, 'mid', 42)
    })
  }),
  spider_man: Object.freeze({
    label: 'WEB-SLING TAKEDOWN',
    hold: Object.freeze({ intro: .42, clash: .34, finisher: .52, impact: .4, recover: .46 }),
    flash: Object.freeze({ intro: .16, clash: .3, finisher: .6, impact: .92, recover: .3 }),
    scale: Object.freeze({ intro: .5, clash: .82, finisher: 1.08, impact: 1.28, recover: .88 }),
    shots: Object.freeze({
      // Movement is the identity: every beat carries a different side angle, so the sequence reads as
      // an orbit around the pair rather than a camera parked on one axis.
      intro: cam(8.6, 2.0, -1.05, 0.12, 'owner', 46),
      clash: cam(5.6, 1.5, -0.7, 0.06, 'owner', 40),
      finisher: cam(3.8, 1.7, 0.75, 0.1, 'target', 34),
      impact: cam(11.8, 2.8, 1.5, 0.22, 'mid', 54),
      recover: cam(7.8, 2.2, 0.45, 0.08, 'mid', 44)
    })
  })
});

/** Fallback choreography so an identity without authored beats still presents coherently. */
export const DEFAULT_FINISHER = Object.freeze({
  label: 'FINISHER',
  hold: Object.freeze({ intro: .5, clash: .4, finisher: .65, impact: .5, recover: .5 }),
  flash: Object.freeze({ intro: .1, clash: .24, finisher: .55, impact: .95, recover: .25 }),
  scale: Object.freeze({ intro: .5, clash: .8, finisher: 1, impact: 1.3, recover: .8 }),
  shots: Object.freeze({
    intro: cam(9, 2.6, -0.6, 0.08, 'owner', 44),
    clash: cam(6, 1.4, -0.3, 0.04, 'owner', 40),
    finisher: cam(4, 2.2, 0.4, 0.14, 'target', 34),
    impact: cam(11, 3.6, 1, 0.26, 'mid', 50),
    recover: cam(8, 2.6, 0.25, 0.1, 'mid', 44)
  })
});

export function finisherFor(identityKey) {
  const key = String(identityKey || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return FINISHERS[key] || DEFAULT_FINISHER;
}

/** True when an identity has choreography of its own rather than the shared fallback. */
export function hasAuthoredFinisher(identityKey) {
  return Boolean(FINISHERS[String(identityKey || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')]);
}

/**
 * Begin a sequence. `hitConfirmed` is read every step: the sequence will not spend beat time on the
 * finisher shots until a real hit has landed, and gives up after `patience` seconds of whiffing.
 */
export function createFinisher({ identityKey = '', patience = 1.6 } = {}) {
  const def = finisherFor(identityKey);
  return {
    def,
    identityKey,
    beat: 'intro',
    beatTime: 0,
    elapsed: 0,
    beatIndex: 0,
    hitConfirmed: false,
    concluded: false,
    whiffed: false,
    patience,
    waited: 0,
    peakFlash: 0
  };
}

export function totalDuration(state) {
  const hold = state.def.hold;
  return BEATS.reduce((sum, beat) => sum + hold[beat], 0);
}

function shotFor(state) {
  return state.def.shots[state.beat] || DEFAULT_FINISHER.shots[state.beat];
}

/**
 * Advance the sequence. Returns the current presentation for this frame. Pure apart from mutating
 * the state object it is handed.
 */
export function advance(state, dt, { hitConfirmed = state.hitConfirmed, hasTarget = true } = {}) {
  state.hitConfirmed = Boolean(hitConfirmed);
  // Consume the frame in small slices. A single clamped step meant a slow renderer (or a
  // background tab) stretched a 0.4-0.7 s beat into tens of seconds: the cast lock, the HUD and
  // the cinematic camera all stayed live long after the authored sequence should have ended.
  let remaining = Math.max(0, Math.min(2, Number(dt) || 0));
  const slice = 1 / 30;
  while (remaining > 1e-6 && !state.concluded) {
    const step = Math.min(slice, remaining);
    remaining -= step;
    const hold = state.def.hold[state.beat];
    state.beatTime += step;
    state.elapsed += step;
    const gated = state.beat === 'finisher' || state.beat === 'impact';
    const giveUp = () => { state.concluded = true; state.whiffed = true; };
    if (gated && !state.hitConfirmed) {
      // Stranded in a gated beat without a hit: wait a bounded time, then give up.
      state.waited += step;
      if (state.waited >= state.patience || !hasTarget) giveUp();
    } else if (state.beatTime >= hold) {
      const nextIndex = Math.min(BEATS.length - 1, state.beatIndex + 1);
      const next = BEATS[nextIndex];
      // The sequence must never SPEND time on the finisher shots without a real hit.
      if ((next === 'finisher' || next === 'impact') && !state.hitConfirmed) {
        state.waited += step;
        if (state.waited >= state.patience || !hasTarget) giveUp();
      } else if (nextIndex === state.beatIndex) {
        // Already on the last beat and its hold has elapsed: the sequence is over.
        state.concluded = true;
      } else {
        state.beatIndex = nextIndex;
        state.beat = next;
        state.beatTime = 0;
      }
    }
  }
  const shot = shotFor(state);
  const flash = state.def.flash[state.beat] ?? 0;
  state.peakFlash = Math.max(state.peakFlash, flash * (state.hitConfirmed ? 1 : .5));
  const scale = state.def.scale[state.beat] ?? 1;
  return {
    beat: state.beat,
    concluded: state.concluded,
    whiffed: state.whiffed,
    hitConfirmed: state.hitConfirmed,
    timeScale: state.whiffed ? 1 : (state.beat === 'impact' ? .38 : state.beat === 'finisher' ? .72 : 1),
    flash: state.whiffed ? 0 : flash,
    shake: state.whiffed ? 0 : (flash * scale) * .6,
    scale,
    camera: { ...shot, distance: shot.distance / scale }
  };
}

// ---------------------------------------------------------------------------------------------
// Live director: one finisher per running ultimate, driven from the ultimate runner's own update.
// It only ever calls camera hooks the game already had (focus / impact) plus the existing
// requestHitStop, so it cannot fight another system for the camera or the clock.
// ---------------------------------------------------------------------------------------------

const DIRECTOR = new Map();

/** Start a sequence for a real cast. Returns the state, or null if the record is unusable. */
export function beginFinisher(record) {
  if (!record) return null;
  const identityKey = record.owner?.identityKey || record.owner?.identity || '';
  const state = createFinisher({ identityKey });
  DIRECTOR.set(record, state);
  return state;
}

/** The runner reported a landed hit for this record. */
export function confirmFinisher(record) {
  const state = DIRECTOR.get(record);
  if (state) state.hitConfirmed = true;
  return Boolean(state);
}

export function finisherFor_record(record) {
  return DIRECTOR.get(record) || null;
}

export function finisherCount() {
  return DIRECTOR.size;
}

export function clearFinishers() {
  DIRECTOR.clear();
}

/**
 * Advance every running finisher. Returns the events this frame so the caller can log them.
 * `camera` may be missing (headless), in which case nothing is presented but timing still advances.
 */
export function stepFinishers(dt, { camera = null, hitStop = null, onImpact = null } = {}) {
  const events = [];
  const trace = typeof window !== 'undefined'
    ? (window.__browserSmashFinisherTrace || (window.__browserSmashFinisherTrace = []))
    : null;
  // advance() clamps dt to this for its own timeline; mirror it or the trace lies.
  const stepSeconds = Math.max(0, Math.min(0.1, Number(dt) || 0));
  for (const [record, state] of [...DIRECTOR]) {
    // The ultimate itself is over (finished, interrupted, KO, swap): the presentation must never
    // outlive it. This is the path that used to leave a finisher record alive after a whiff, with
    // the HUD hidden and the camera parked in a cinematic that could no longer finish.
    if (record.phase === 'done' || !record.owner) {
      DIRECTOR.delete(record);
      camera?.endCineShot?.();
      events.push({ record, beat: state.beat, concluded: true, whiffed: state.whiffed });
      continue;
    }
    const hitConfirmed = (record.hitCount || 0) > 0;
    const frame = advance(state, dt, { hitConfirmed, hasTarget: Boolean(record.target) });
    if (frame.beat !== state._lastBeat) {
      state._lastBeat = frame.beat;
      // Authored shots own the camera for the beat. Until Phase 24.2.5 this branch only nudged the
      // duel framing, which is why the authored 32-34 degree close-ups measured 45-51 degrees in
      // game: the shot data was returned by advance() and then thrown away.
      const shot = { ...frame.camera, beat: frame.beat };
      if (camera && typeof camera.cineShot === 'function') {
        camera.cineShot(shot, { owner: record.owner, target: record.target });
      } else if (camera && typeof camera.focus === 'function' && record.owner) {
        camera.focus(record.owner, { seconds: Math.min(.3, state.def.hold[frame.beat] || .3), zoom: frame.beat === 'finisher' ? .2 : .1 });
      }
      events.push({ record, beat: frame.beat, beatChanged: true, hitConfirmed: frame.hitConfirmed });
      if (typeof window !== 'undefined') {
        // Telemetry: which choreography set is actually presenting this beat. Proves a character is
        // using its own shots rather than the shared fallback.
        window.__browserSmashFinisherIdentity = {
          identity: state.identityKey, authored: hasAuthoredFinisher(state.identityKey), beat: frame.beat
        };
      }
    }
    if (frame.beat === 'impact' && !state._impactFired) {
      state._impactFired = true;
      camera?.impact?.(frame.shake);
      hitStop?.(.09);
      events.push({ record, beat: 'impact', impact: true, flash: frame.flash });
    }
    if (frame.beat === 'impact' && state._impactFired && onImpact && !state._reaction) {
      state._reaction = true;
      onImpact({ record, target: record.target, beat: frame.beat });
    }
    if (trace) {
      trace.push({ beat: frame.beat, beatTime: +state.beatTime.toFixed(2), dt: +stepSeconds.toFixed(4),
        hit: Boolean(hitConfirmed), hitCount: record.hitCount ?? null, hasTarget: Boolean(record.target),
        waited: +state.waited.toFixed(2), concluded: frame.concluded });
    }
    if (frame.concluded) {
      events.push({ record, beat: frame.beat, concluded: true, whiffed: frame.whiffed });
      DIRECTOR.delete(record);
      // Hand the camera back on every ending, including a whiff, so nothing can be left framed
      // inside a cinematic that will never play its finisher.
      camera?.endCineShot?.();
    }
  }
  return events;
}

/**
 * The slow-motion factor for the beat currently being presented. The simulation scales its own
 * timestep by this, so slow motion slows the fight without slowing the director that requested it.
 */
export function activeFinisherTimeScale() {
  let scale = 1;
  for (const [, state] of DIRECTOR) {
    if (state.concluded || state.whiffed) continue;
    if (state.hitConfirmed === false) continue;
    const s = state.beat === 'impact' ? .38 : state.beat === 'finisher' ? .72 : 1;
    if (s < scale) scale = s;
  }
  return Math.max(.35, Math.min(1, scale));
}

/** Safe check used before anything is applied to the real camera. */
export function isValidShot(shot) {
  if (!shot) return false;
  return ['distance', 'height', 'yaw', 'pitch', 'fov'].every(k => Number.isFinite(shot[k]))
    && shot.distance > 0.5 && shot.fov > 10 && shot.fov < 120;
}
