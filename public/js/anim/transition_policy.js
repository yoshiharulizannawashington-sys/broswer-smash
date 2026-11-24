// Shared transition policy for the two animation owners in the game.
//
// Imported bodies with baked clips use the legacy action mixer in human_fighter.js; bodies without
// a clip library use AnimationController. Both need the same answer to two questions:
//
//   1. How long should this crossfade be? A hit reaction is sharper than a walk-to-run blend, and a
//      victory pose should settle rather than snap.
//   2. Should the incoming loop inherit the phase of the outgoing loop? Locomotion cycles must not
//      restart at frame zero when a fighter accelerates from a walk to a run; attack and reaction
//      clips must start from their own first frame.
//
// This module is deliberately pure. It does not know about mixers, gameplay timers or bone names,
// so both owners can use it and the policy can be tested without a browser.

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

// Recommended fade length by the semantic family of the incoming clip. The caller's existing fade
// is used as a guardrail: a policy can nudge a tuned value, but cannot turn a deliberate 0.06 s
// impact response into a long, floaty blend.
const FAMILY_FADE = Object.freeze({
  reaction: 0.045,
  knockdown: 0.08,
  getup: 0.09,
  defeat: 0.12,
  victory: 0.2,
  guard: 0.09,
  parry: 0.05,
  dodge: 0.06,
  special: 0.12,
  form: 0.12,
  grab: 0.06,
  attack: 0.055,
  air: 0.08,
  gait: 0.13,
  turn: 0.08,
  idle: 0.16,
  other: 0.12
});

function normalizedName(value) {
  const name = typeof value === 'string'
    ? value
    : (value?.getClip?.()?.name || value?.name || '');
  return String(name || '').trim();
}

/** The clip name behind an action, a clip or a plain string. */
export function clipNameOf(value) {
  return normalizedName(value);
}

/**
 * The semantic family of a clip. Names are normalised so imported clips such as
 * `Naruto_hit_light`, authored clips such as `authored_form_formSage`, and legacy library clips
 * such as `hit_light` classify the same way.
 */
export function clipFamily(value) {
  const name = normalizedName(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!name) return 'unknown';
  if (/victory|winpose|winner|winning/.test(name)) return 'victory';
  if (/defeat|lose|knockout|knockedout|ko$/.test(name)) return 'defeat';
  if (/knockdown|downed|groundedhit/.test(name)) return 'knockdown';
  if (/getup|standup|recover|recovery/.test(name)) return 'getup';
  if (/parry/.test(name)) return 'parry';
  if (/block|guard|shield/.test(name)) return 'guard';
  if (/dodge|evade|sidestep/.test(name)) return 'dodge';
  if (/hit|hurt|flinch|stagger|launch|recoil|impact/.test(name)) return 'reaction';
  if (/ultimate|finisher|rasenshuriken|rasengan|shadowclone|special|kamehameha|beam|meteor|nova/.test(name)) return 'special';
  if (/transformation|transform|form|sage|kurama|baryon|sixpaths|ninetails/.test(name)) return 'form';
  if (/grab|throw|grapple/.test(name)) return 'grab';
  if (/jab|cross|punch|kick|strike|slash|light|heavy|uppercut|kunai|attack|combo/.test(name)) return 'attack';
  if (/jump|leap|fall|fly|hover|land|air|double/.test(name)) return 'air';
  if (/walk|run|sprint|strafe/.test(name)) return 'gait';
  if (/turn|stop|pivot/.test(name)) return 'turn';
  if (/idle|breath|stand/.test(name)) return 'idle';
  return 'other';
}

/**
 * Resolve the crossfade and phase-sync decision for one action swap.
 *
 * `requestedFade` is the fade the caller already selected from gameplay state and identity style.
 * The family recommendation is clamped around that value, so the policy adds consistency without
 * discarding per-state tuning. Gait-to-gait swaps inherit the outgoing cycle phase; every other
 * transition starts from the incoming clip's first frame.
 */
export function resolveTransition(from, to, { requestedFade = 0.12 } = {}) {
  const fromName = normalizedName(from);
  const toName = normalizedName(to);
  const fromFamily = clipFamily(fromName);
  const toFamily = clipFamily(toName);
  const requested = Number(requestedFade);
  let fade = FAMILY_FADE[toFamily] ?? FAMILY_FADE.other;

  if (Number.isFinite(requested) && requested > 0) {
    fade = clamp(fade, requested * 0.35, requested * 1.65);
  }
  fade = clamp(fade, 0.04, 0.32);

  const syncPhase = fromFamily === 'gait' && toFamily === 'gait'
    && Boolean(fromName) && Boolean(toName) && fromName !== toName;

  return {
    from: fromName,
    to: toName,
    fromFamily,
    toFamily,
    fade,
    syncPhase,
    sameClip: Boolean(fromName) && fromName === toName,
    reason: syncPhase ? 'gait-phase-sync' : `${toFamily}-transition`
  };
}

/**
 * Copy the outgoing loop's normalised phase onto the incoming action.
 *
 * Called after `action.reset()` and before `play()`. Returns the transferred phase, or null when
 * either action has no usable duration.
 */
export function syncActionPhase(target, source) {
  const targetClip = target?.getClip?.();
  const sourceClip = source?.getClip?.();
  const targetDuration = Number(targetClip?.duration);
  const sourceDuration = Number(sourceClip?.duration);
  const sourceTime = Number(source?.time);

  if (!(targetDuration > 0) || !(sourceDuration > 0) || !Number.isFinite(sourceTime)) return null;
  const phase = ((sourceTime % sourceDuration) + sourceDuration) % sourceDuration / sourceDuration;
  target.time = phase * targetDuration;
  return phase;
}
