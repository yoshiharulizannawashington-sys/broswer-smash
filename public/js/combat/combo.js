// Combo rules: chain length, damage decay, juggle limits and the cancel table's timing half.
//
// Pure functions only, so combo behaviour is testable in node as well as in the browser. The
// fighter owns the counters (`comboStep`, `comboHitCount`, `comboWindow`, `airHits`); this file
// decides what those counters mean.

export const COMBO = Object.freeze({
  window: .82,          // seconds a chain stays open after a hit
  chainLength: 5,       // grounded string length before it wraps back to the jab
  juggleLimit: 4,       // air hits one attacker may land before the target is spiked out
  decayPerHit: .07,     // damage lost per hit past the first
  decayCap: .24,        // maximum damage lost to scaling
  airStunScale: .82,    // air hitstun multiplier, so juggles cannot loop forever
  airJuggleWindow: .9
});

/** Damage scaling for the Nth hit of a combo (1 = 100%). */
export function comboScale(hitIndex = 1) {
  const hits = Math.max(1, Math.floor(hitIndex));
  return 1 - Math.min(COMBO.decayCap, (hits - 1) * COMBO.decayPerHit);
}

/** Next grounded string step. Wraps to 1 when the chain window has closed. */
export function chainStep(previousStep, windowOpen) {
  const step = Math.max(0, Math.floor(previousStep || 0));
  if (!windowOpen) return 1;
  return (step % COMBO.chainLength) + 1;
}

/** Whether one more air hit is allowed before the juggle limit forces a spike. */
export function juggleAllowed(airHits = 0) {
  return Math.max(0, Math.floor(airHits)) < COMBO.juggleLimit;
}

/** Air hitstun, shortened so a juggle cannot be extended indefinitely by hitstun alone. */
export function airHitstun(hitstun = 0, airHits = 0) {
  const scale = Math.max(.55, COMBO.airStunScale - Math.max(0, airHits - 1) * .06);
  return hitstun * scale;
}

/**
 * The single place that decides what a landed hit does to the combo counters. Returns the next
 * values instead of mutating, so the resolver stays readable and this is unit testable.
 */
export function afterHit({
  attackerHits = 0,
  windowOpen = false,
  targetAirborne = false,
  attackerAirHits = 0
} = {}) {
  const hits = windowOpen && attackerHits > 0 ? attackerHits + 1 : 1;
  const airHits = targetAirborne ? (windowOpen ? attackerAirHits + 1 : 1) : 0;
  return {
    hitCount: hits,
    airHits,
    scale: comboScale(hits),
    limitReached: targetAirborne && !juggleAllowed(airHits),
    window: COMBO.window
  };
}
