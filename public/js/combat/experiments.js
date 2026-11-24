// Phase 29.5 — opt-in combat experiments.
//
// An experiment is a small, reversible change to one behaviour, gated so the shipped game behaves
// exactly as it did before. Nothing here is enabled by default: with no flag set, `tuning()` returns
// null and every caller keeps its original numbers.
//
// Enabling (for a measurement run only):
//   ?exp=grab-continuity            both levers
//   ?exp=grab-continuity-knockback  chain knockback scale only
//   ?exp=grab-continuity-reassert   pull re-assert only
//   ?exp=grab-continuity-pull       continuous reel (Phase 29.7: travel, not a reposition)
//   window.__browserSmashExperiments['grab-continuity-reassert'] = true   (before the cast)
//
// Rollback: remove the query parameter (or the global). No storage is written, so a reload always
// returns to the shipped behaviour.

const REGISTRY = Object.freeze({
  'grab-continuity': { fighter: 'wonder_woman', chainKnockback: .45, chainLaunch: .5, reassert: true, gate: 5.2, reassertGap: 4.6 },
  'grab-continuity-knockback': { fighter: 'wonder_woman', chainKnockback: .45, chainLaunch: .5, reassert: false, gate: 5.2 },
  'grab-continuity-reassert': { fighter: 'wonder_woman', chainKnockback: 1, chainLaunch: 1, reassert: true, gate: 5.2, reassertGap: 4.6 },
  // Phase 29.7. The re-assert experiment above moves the target by editing its position, which
  // measured 1.99 m in one 1/60 s tick at 60% reach — a teleport. This configuration gives the target
  // inward velocity instead and lets it travel: 9 m/s, stopping 0.4 m inside the follow-up gate, with
  // the caster giving 0.1 m of ground so the pull visibly comes from somewhere. Knocking power is
  // left at the shipped values, so the chain has to be held together by the reel alone.
  // Phase 29.8 adds the caster's side of the pull: `casterBudget` decides how much ground she may
  // give up ('per-reel' = 0.1 m each reel, 'chain' = 0.1 m across the whole ultimate, 'plant' = no
  // root motion at all, counter-motion is pose only). The default is the Phase 29.7 behaviour so
  // the measured configuration does not silently change; measure the alternatives by overriding
  // `window.__browserSmashCasterBudget` for a run.
  'grab-continuity-pull': { fighter: 'wonder_woman', chainKnockback: 1, chainLaunch: 1, reassert: false, pull: true,
    gate: 5.2, pullSpeed: 9, pullAccel: 45, pullTargetOffset: .4, pullMax: 2.6,
    casterStep: .35, casterMax: .1, casterBudget: 'per-reel' }
});

const ALIAS = Object.freeze({
  'grab-continuity-both': 'grab-continuity'
});

function requested() {
  const names = new Set();
  try {
    const raw = new URLSearchParams(globalThis.location?.search || '').get('exp');
    for (const part of String(raw || '').split(',')) {
      const name = part.trim();
      if (name) names.add(ALIAS[name] || name);
    }
  } catch (_error) { /* no location: the global is the only channel */ }
  const global = globalThis.window?.__browserSmashExperiments;
  if (global && typeof global === 'object') {
    for (const [name, on] of Object.entries(global)) if (on) names.add(ALIAS[name] || name);
  }
  return names;
}

const identityKey = fighter => String(fighter?.identityKey || fighter?.identity || '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** True when the named experiment is requested. Presentation and tests share this check. */
export function experimentOn(name) {
  return requested().has(name);
}

/**
 * Tuning for a grab record, or null. Returns null unless an experiment is on AND it targets this
 * caster, so enabling the flag never touches the other two grab fighters.
 */
export function grabContinuityTuning(record) {
  const owner = record?.owner;
  if (!owner) return null;
  for (const name of requested()) {
    const spec = REGISTRY[name];
    if (!spec) continue;
    if (identityKey(owner) !== spec.fighter) continue;
    return { ...spec, name };
  }
  return null;
}

export const EXPERIMENTS = REGISTRY;
