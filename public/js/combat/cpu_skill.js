// CPU opponent skill profiles.
//
// Difficulty used to be a single hard-coded block of probabilities inside main.js: the computer
// always attacked on a 0.62-1.12 s timer, always noticed an incoming attack inside 4.8 m,
// blocked 72% of the time, parried 13% of the time and spent its ultimate 40% of the time it
// was charged. That is one opponent, not a difficulty setting, and the only way to make it
// easier would have been to nerf its health or damage - which is exactly what the game must not
// do.
//
// Every number here is a decision-making parameter, never a stat:
//
//   cooldown / cooldownJitter  seconds before the CPU will throw another close-range attack
//   range                      distance at which it commits to that attack
//   notice                     distance at which it starts paying attention to your startup
//   readAhead                  how much of your startup it can see (a reaction-time proxy)
//   parry                      chance it reads the startup as a parry instead of a guard
//   block                      chance it guards an incoming attack at all
//   dodge                      chance it side-steps instead of guarding
//   hesitation                 chance it declines an attack that is otherwise available
//   special / form / ultimate  chance per decision to spend a projectile, a form or the meter
//
// The table is pure data so scripts/test-cpu-skill.mjs can assert that the levels are genuinely
// ordered (an ace must react faster, defend more and commit harder than a rookie) and that no
// level can be handed a stat multiplier that would fake difficulty.

export const CPU_SKILL_LEVELS = Object.freeze(['rookie', 'fighter', 'ace']);

export const DEFAULT_SKILL_LEVEL = 'fighter';

export const CPU_SKILLS = Object.freeze({
  rookie: Object.freeze({
    level: 'rookie',
    label: 'ROOKIE',
    blurb: 'Slow to react, rarely guards, almost never spends meter.',
    cooldown: 0.95,
    cooldownJitter: 0.7,
    range: 2.15,
    notice: 3.4,
    readAhead: 0.13,
    parry: 0.04,
    block: 0.42,
    dodge: 0.1,
    hesitation: 0.42,
    special: 0.006,
    form: 0.01,
    ultimate: 0.12
  }),
  fighter: Object.freeze({
    level: 'fighter',
    label: 'FIGHTER',
    blurb: 'Reads a startup, guards most of the time, uses its signature move.',
    cooldown: 0.62,
    cooldownJitter: 0.5,
    range: 2.25,
    notice: 4.8,
    readAhead: 0.2,
    parry: 0.13,
    block: 0.72,
    dodge: 0.28,
    hesitation: 0.22,
    special: 0.018,
    form: 0.05,
    ultimate: 0.4
  }),
  ace: Object.freeze({
    level: 'ace',
    label: 'ACE',
    blurb: 'Reacts early, parries and dodges, transforms and lands its ultimate.',
    cooldown: 0.4,
    cooldownJitter: 0.3,
    range: 2.4,
    notice: 6.2,
    readAhead: 0.26,
    parry: 0.24,
    block: 0.84,
    dodge: 0.4,
    hesitation: 0.08,
    special: 0.038,
    form: 0.1,
    ultimate: 0.62
  })
});

/** Accept any spelling of a level ('ACE', ' ace ', undefined) and return a real key. */
export function normalizeSkillLevel(level) {
  const key = String(level ?? '').trim().toLowerCase();
  return CPU_SKILL_LEVELS.includes(key) ? key : DEFAULT_SKILL_LEVEL;
}

/** The profile for a level. An unknown level falls back to the default rather than undefined. */
export function skillFor(level) {
  return CPU_SKILLS[normalizeSkillLevel(level)];
}

/** Ordered weakest to strongest, for a settings control that reads well. */
export function skillTable() {
  return CPU_SKILL_LEVELS.map(level => CPU_SKILLS[level]);
}
