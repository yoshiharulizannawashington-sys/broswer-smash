// Performance governor: watches real frame pacing and suggests a lower graphics preset when the
// machine cannot hold a smooth frame rate.
//
// Two rules shape it, both from the brief:
//  * It only ever steps DOWN one level at a time, and never below Low. Aiming for 60 and forcing
//    Ultra-to-Low in one jump would be a panic response, not an optimisation.
//  * A suggestion is not an override. When the player has chosen a preset by hand, the governor
//    still reports what it measured, but the caller must not apply it. `manual` is carried on the
//    suggestion so the UI can offer rather than impose.
//
// Frame pacing is judged on a rolling median of frame intervals, because a single long frame (a
// shader compile, a texture upload) must not trigger a downgrade on its own.

const DEFAULTS = Object.freeze({
  warmupMs: 4000,
  windowMs: 3000,
  minFps: 45,
  cooldownMs: 20000,
  ladder: ['low', 'medium', 'high', 'ultra'],
  settleMs: 1500
});

export function createPerformanceGovernor(options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const ladder = [...settings.ladder];
  let started = false;
  let stopped = false;
  let manual = Boolean(options.manual);
  let frame = 0;
  let lastFrameAt = 0;
  let windowStart = 0;
  let frozenUntil = 0;
  let lastSuggestionAt = -Infinity;
  let suggested = new Set();
  const samples = [];
  const history = [];
  const state = { fps: null, medianMs: null, level: null, suggestions: 0, downgradesApplied: 0 };

  function currentPreset() {
    const fromOption = typeof settings.getCurrentPreset === 'function' ? settings.getCurrentPreset() : settings.currentPreset;
    const name = String(fromOption || globalThis.window?.__graphicsPresetName || 'high').toLowerCase();
    return ladder.includes(name) ? name : 'high';
  }

  function lowerThan(name) {
    const index = ladder.indexOf(name);
    return index > 0 ? ladder[index - 1] : null;
  }

  /** Feed one animation frame time. Returns a suggestion object when one is produced. */
  function sample(now = typeof performance !== 'undefined' ? performance.now() : Date.now()) {
    if (stopped) return null;
    if (!started) {
      started = true;
      windowStart = now;
      lastFrameAt = now;
      return null;
    }
    const delta = now - lastFrameAt;
    lastFrameAt = now;
    // Ignore absurd gaps (tab backgrounded, debugger pause) rather than reading them as stutter.
    if (delta <= 0 || delta > 1000) return null;
    samples.push(delta);

    // Give the scene time to compile shaders and settle before judging it.
    if (now - windowStart < settings.warmupMs) return null;
    if (now - windowStart < settings.windowMs) return null;
    if (now < frozenUntil) { samples.length = 0; windowStart = now; return null; }

    samples.sort((a, b) => a - b);
    const medianMs = samples[Math.floor(samples.length / 2)] || 0;
    const fps = medianMs > 0 ? 1000 / medianMs : 0;
    state.fps = +fps.toFixed(1);
    state.medianMs = +medianMs.toFixed(1);
    samples.length = 0;
    windowStart = now;

    if (fps >= settings.minFps) return null;

    const from = currentPreset();
    const to = lowerThan(from);
    if (!to || suggested.has(from)) return null;
    if (now - lastSuggestionAt < settings.cooldownMs) return null;

    suggested.add(from);
    lastSuggestionAt = now;
    frozenUntil = now + settings.settleMs;
    state.suggestions++;
    state.level = to;
    history.push({ at: Math.round(now), fps: state.fps, from, to, manual });
    const suggestion = {
      from,
      suggestedPreset: to,
      fps: state.fps,
      medianMs: state.medianMs,
      manual,
      autoApply: !manual,
      reason: `median ${state.fps} fps over ${Math.round(settings.windowMs / 1000)}s (target ${settings.minFps})`
    };
    try { settings.onSuggestion?.(suggestion); } catch (_error) { /* never break the loop */ }
    return suggestion;
  }

  function tick(now) {
    frame = requestAnimationFrame(tick);
    sample(now);
  }

  if (settings.autoStart !== false && typeof requestAnimationFrame === 'function') {
    frame = requestAnimationFrame(tick);
  }

  return {
    sample,
    stop() {
      stopped = true;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    },
    setManual(value) { manual = Boolean(value); },
    /** Called by the game when a preset is applied, so a freshly lowered one is re-evaluated. */
    noteApplied(name) {
      suggested.delete(String(name).toLowerCase());
      frozenUntil = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + settings.settleMs;
    },
    get manual() { return manual; },
    get fps() { return state.fps; },
    get suggestions() { return state.suggestions; },
    get history() { return [...history]; },
    describe: () => ({ ...state, manual, minFps: settings.minFps, windowMs: settings.windowMs, ladder: [...ladder] })
  };
}
