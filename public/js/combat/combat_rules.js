// The single source of truth for how damage, launches and rounds work.
//
// Every one of these functions is pure, so the balance of the game is testable in node
// (scripts/test-combat.mjs) instead of only being observable by playing a match. The
// fighter simulation and the match loop both call into this module rather than open-coding
// their own copies of the formulas.

export const DEFAULT_RULES = Object.freeze({
  maxPercent: 150,
  roundsToWin: 2,
  roundSeconds: 80,
  roundBannerSeconds: 2.2,
  respawnInvulnerability: 1.1
});

/**
 * What an ordinary block is worth. `damageScale` is the bare-handed guard every fighter has; an
 * offhand item may improve it (OFFHAND_DEFENSE below), and nothing else may.
 */
export const GUARD = Object.freeze({ damageScale: 0.28 });

/**
 * Offhand defence. Only equipment that is actually a shield is listed here: a katana, a ki orb, a
 * blaster or a webshooter is not a defensive item and falls through to the bare guard. Each entry
 * is deliberately a trade rather than free damage reduction - a shield blocks harder, spends more
 * of the meter per blocked hit, and refills that meter more slowly.
 */
export const OFFHAND_DEFENSE = Object.freeze({
  shield: Object.freeze({
    damageScale: 0.18,     // ordinary block, versus GUARD.damageScale bare-handed
    shieldCostScale: 1.15, // shield spent per blocked hit, versus SHIELD.hitCost
    regenScale: 0.82       // shield regained per second, versus SHIELD.regen
  })
});

/** The offhand kind a fighter is carrying, as classified on its model by models.js. */
export function offhandOf(fighter) {
  return fighter?.model?.userData?.offhandKind || null;
}

/** Defence entry for an offhand kind, or null when the item does not defend. */
export function offhandDefense(kind) {
  return (kind && OFFHAND_DEFENSE[kind]) || null;
}

/**
 * Damage multiplier for an ordinary block. `base` is the path's own authored guard scale, so a
 * shield improves every attack type by the same proportion instead of flattening the deliberate
 * differences between them: melee and ultimates use GUARD.damageScale, while the projectile and
 * signature paths keep the 0.30 / 0.32 they were tuned with.
 */
export function guardDamageScale(offhandKind, base = GUARD.damageScale) {
  const entry = offhandDefense(offhandKind);
  if (!entry) return base;
  return base * (entry.damageScale / GUARD.damageScale);
}

/** Percentage damage after guarding, counters, character profiles and the combo step. */
export function damageFor(base, { guarding = false, countering = false, profile, comboStep = 1, itemMultiplier = 1, offhand = null } = {}) {
  const profileDamage = profile?.damage ?? 1;
  const scaling = comboStep > 1 ? 1 - Math.min(0.24, (comboStep - 1) * 0.07) : 1;
  const guardScale = guarding ? guardDamageScale(offhand) : 1;
  const raw = base * profileDamage * (countering ? 1.42 : 1) * guardScale * itemMultiplier * scaling;
  return Math.max(0, raw);
}

/** Horizontal launch strength (world units per second) for a landed hit. */
export function knockbackFor({ kbs = 80, percent = 0, guarding = false, weight = 85, profile } = {}) {
  const profileKnockback = profile?.knockback ?? 1;
  const weightScale = 85 / Math.max(45, weight || 85);
  const growth = 0.035 + Math.min(0.19, percent / 1200);
  return kbs * growth * profileKnockback * weightScale * (guarding ? 0.25 : 1);
}

/** Vertical launch strength for a landed hit. */
export function launchFor({ launchY = 3.4, guarding = false, weight = 85, profile, aerial = false, launcher = false } = {}) {
  if (guarding) return 1.2;
  const profileLaunch = profile?.launch ?? 1;
  const weightScale = Math.sqrt(85 / Math.max(45, weight || 85));
  const base = Math.max(launchY, launcher ? 6.2 : aerial ? 5.4 : 3.4);
  return base * profileLaunch * weightScale;
}

/** Hit stun, which grows with accumulated damage so late hits are harder to recover from. */
export function hitstunFor({ percent = 0, guarding = false, aerial = false, launcher = false } = {}) {
  if (guarding) return 0.1;
  return 0.3 + Math.min(1.05, percent / 165) + (aerial || launcher ? 0.12 : 0);
}

/**
 * Attack chaining window. A five-hit string is allowed while the previous hit has not
 * expired; after that the chain resets to the first hit. Attack recovery is what actually
 * gates re-entry: a new attack can only be buffered when the queue is empty. The length is the
 * same 5 as COMBO.chainLength in combo.js, so the rules helper and the live chain cannot drift.
 */
export const CHAIN_LENGTH = 5;
export function chainStep(previousStep, comboWindow) {
  if (comboWindow <= 0) return 1;
  return (previousStep % CHAIN_LENGTH) + 1;
}

/**
 * Guard (shield) rules. Guarding is a resource, not a free stance: holding it drains the
 * shield, a blocked hit costs shield in proportion to the move's weight, and an empty shield
 * breaks the guard for a fixed time. Every number lives here so the balance is testable in
 * node and the fighter simulation has no open-coded copy of it.
 */
export const SHIELD = Object.freeze({
  max: 100,
  holdDrain: 11,          // per second while guard is held
  hitCost: 24,            // base cost of one blocked hit
  damageCost: 0.9,        // extra cost per point of damage above 8
  knockbackCost: 0.16,    // extra cost per point of kbs above 70
  regen: 26,              // per second once the guard is down
  regenDelay: 0.55,       // pause after a blocked hit before regen starts
  breakSeconds: 1.15,
  breakRecover: 22        // shield handed back when a break ends
});

/** Shield after `dt` of holding or recovering. A broken shield stays at zero. */
export function shieldTick(shield, dt, { guarding = false, broken = false, offhand = null } = {}) {
  const current = Math.max(0, Math.min(SHIELD.max, Number(shield) || 0));
  if (broken) return 0;
  // Holding the guard drains at the standard rate whatever is in the offhand: the shield's
  // extra cost is per blocked hit and in its slower refill, not in merely standing ready.
  if (guarding) return Math.max(0, current - SHIELD.holdDrain * dt);
  const regenScale = offhandDefense(offhand)?.regenScale ?? 1;
  return Math.min(SHIELD.max, current + SHIELD.regen * regenScale * dt);
}

/** What one blocked hit costs, scaled by how heavy the move was and by the offhand absorbing it. */
export function shieldCostFor({ damage = 8, kbs = 80, offhand = null } = {}) {
  const raw = SHIELD.hitCost
    + Math.max(0, damage - 8) * SHIELD.damageCost
    + Math.max(0, kbs - 70) * SHIELD.knockbackCost;
  const costScale = offhandDefense(offhand)?.shieldCostScale ?? 1;
  return Math.max(6, raw) * costScale;
}

/** Apply a blocked hit. Returns the remaining shield and whether it broke. */
export function shieldAfterHit(shield, move = {}) {
  const current = Math.max(0, Number(shield) || 0);
  const next = Math.max(0, current - shieldCostFor(move));
  return { shield: next, broke: next <= 0, cost: current - next };
}

export function createMatch(rules = {}) {
  const merged = { ...DEFAULT_RULES, ...rules };
  return {
    rules: merged,
    round: 1,
    wins: [0, 0],
    timer: merged.roundSeconds,
    status: 'fighting',
    roundWinner: null,
    winner: null,
    banner: '',
    bannerTimer: 0
  };
}

/** Advance the round clock. Returns the events that the presentation layer should show. */
export function tickMatch(match, dt) {
  const events = [];
  if (!match) return events;
  if (match.bannerTimer > 0) {
    match.bannerTimer = Math.max(0, match.bannerTimer - dt);
    if (match.bannerTimer === 0 && match.status === 'round-over') match.status = 'fighting';
  }
  if (match.status !== 'fighting') return events;
  match.timer = Math.max(0, match.timer - dt);
  return events;
}

/**
 * Decide whether the current round is over.
 * `fighters` is [{ percent, outOfBounds }] in P1/P2 order.
 */
export function evaluateRound(match, fighters) {
  if (!match || match.status !== 'fighting') return null;
  const [a, b] = fighters;
  const over = match.rules.maxPercent;
  const aOut = a.percent >= over || a.outOfBounds;
  const bOut = b.percent >= over || b.outOfBounds;
  if (aOut && bOut) return 'draw';
  if (aOut) return 'p2';
  if (bOut) return 'p1';
  if (match.timer <= 0) {
    if (a.percent === b.percent) return 'draw';
    return a.percent < b.percent ? 'p1' : 'p2';
  }
  return null;
}

/** Record a round result. Returns { roundOver, matchOver, winner, label }. */
export function awardRound(match, winner) {
  const label = { p1: 'PLAYER 1', p2: 'PLAYER 2', draw: 'DRAW' }[winner] || 'DRAW';
  // A drawn round is replayed: neither fighter is credited, so a double ring-out or a
  // tied clock cannot hand the series to someone who did not win it.
  if (winner === 'p1') match.wins[0]++;
  else if (winner === 'p2') match.wins[1]++;
  match.roundWinner = winner;
  match.banner = winner === 'draw' ? 'DRAW ROUND · REPLAY' : `${label} WINS THE ROUND`;
  match.bannerTimer = match.rules.roundBannerSeconds;
  match.status = 'round-over';
  const need = match.rules.roundsToWin;
  const matchOver = match.wins[0] >= need || match.wins[1] >= need;
  if (matchOver) {
    match.status = 'match-over';
    match.winner = match.wins[0] === match.wins[1] ? 'draw' : match.wins[0] > match.wins[1] ? 'p1' : 'p2';
    match.banner = match.winner === 'draw' ? 'DRAW MATCH' : `${label} WINS`;
    match.bannerTimer = 0;
  }
  return { roundOver: true, matchOver, winner, label, banner: match.banner };
}

/** Reset for the next round, keeping the series score. */
export function nextRound(match) {
  if (!match) return match;
  match.round++;
  match.timer = match.rules.roundSeconds;
  match.status = 'fighting';
  match.roundWinner = null;
  match.banner = `ROUND ${match.round}`;
  match.bannerTimer = Math.min(1.6, match.rules.roundBannerSeconds);
  return match;
}

export function resetMatch(match) {
  if (!match) return match;
  const rules = match.rules;
  Object.assign(match, createMatch(rules));
  return match;
}

export function scoreLine(match) {
  if (!match) return '';
  return `${match.wins[0]} - ${match.wins[1]}`;
}

export function matchSummary(match) {
  if (!match) return null;
  return {
    round: match.round,
    wins: [...match.wins],
    timer: match.timer,
    status: match.status,
    winner: match.winner,
    roundsToWin: match.rules.roundsToWin
  };
}
