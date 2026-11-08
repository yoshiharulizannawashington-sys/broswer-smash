// Per-identity motion personality: how a fighter carries their weight while they move.
//
// Every fighter plays the same 39 authorable clips (anim/clip_library.js). A clip is a
// humanoid-average walk, so before this module Goku, Kratos, Naruto and Iron Man all ambled at
// exactly the same cadence with exactly the same hip sway. That is what made the roster read as
// one body in different colours.
//
// This module is pure data plus two pure functions, deliberately:
//   gaitTimeScale(style, clipId, speed)  how fast a locomotion clip plays for this fighter
//   styleFor(fighter)                    identity -> archetype -> neutral default
//
// The secondary motion (breathing, weight shift, hip sway, arm opposition, turn banking) lives in
// animation_controller.js because it has to be written onto the rig after the mixer runs. Keeping
// the numbers here means the whole roster's body language is reviewable in one place and
// testable in node without a WebGL context.
//
// HONESTY NOTE: these are authored numbers describing observed body language in each character's
// source material - a light springy bounce for a martial artist, trailing arms for a shinobi,
// armoured stiffness for a suit of armour. They are not motion capture, and the rig is 11 rigid
// joints, so this changes posture, cadence and secondary motion, not limb anatomy.

/** Values an identity inherits unless it overrides them. Deliberately restrained. */
export const MOTION_DEFAULTS = Object.freeze({
  tempo: 1,          // playback multiplier for locomotion clips (step cadence)
  fadeScale: 1,      // crossfade length multiplier (>1 = softer, heavier transitions)
  sway: 0.05,        // hip roll amplitude (radians), the side-to-side weight transfer
  bounce: 0.04,      // pelvis/torso bob amplitude per step (double frequency)
  stride: 0.05,      // extra leg swing amplitude on top of the clip
  armSwing: 0.10,    // arm opposition amplitude on top of the clip
  armBack: 0,        // constant arms-trailing-back offset (shinobi run) while running
  lean: 0.02,        // resting forward lean of the torso
  runLean: 0,        // extra lean while running/sprinting
  flightLean: 0,     // extra lean while in flight
  headPitch: -0.02,  // resting head pitch (<0 = chin up / looking ahead)
  headTurn: 0.05,    // idle head drift amplitude
  idleSway: 0.03,    // slow weight shift while standing still
  breathing: 0.025,  // chest rise amplitude while idle
  guardBounce: 0.05, // bounce amplitude in the fighting idle (the "ready" spring)
  turnBank: 0.30     // torso roll while changing direction
});

const style = (id, note, overrides = {}) => Object.freeze({
  id,
  note,
  ...MOTION_DEFAULTS,
  ...overrides
});

/**
 * The launch roster, one entry per identity. The notes state what the numbers are imitating so a
 * reader can disagree with a specific choice instead of the whole table.
 */
export const MOTION_STYLES = Object.freeze({
  // ------------------------------------------------------------ DC, science, cosmic
  superman: style('superman', 'Upright and unhurried; the cape does the drama.', {
    tempo: 1.02, sway: 0.04, bounce: 0.05, lean: -0.02, fadeScale: 1.1, flightLean: 0.06
  }),
  iron_man_tony_stark: style('iron_man_tony_stark', 'Armoured weight: no hip sway, slow fades, stiff arms.', {
    tempo: 0.98, sway: 0.015, bounce: 0.02, stride: 0.035, armSwing: 0.04,
    headTurn: 0.02, fadeScale: 1.2, turnBank: 0.18, flightLean: 0.1
  }),
  hulk_bruce_banner: style('hulk_bruce_banner', 'Mass: slow cadence, huge sway, shoulders driving forward.', {
    tempo: 0.82, sway: 0.12, bounce: 0.14, stride: 0.09, armSwing: 0.18, runLean: 0.12,
    fadeScale: 1.35, turnBank: 0.2, headPitch: -0.04
  }),
  green_lantern_hal_jordan: style('green_lantern_hal_jordan', 'Confident pilot gait, easy and open.', {
    tempo: 1.0, sway: 0.05, bounce: 0.05, armSwing: 0.11, flightLean: 0.04
  }),
  wonder_woman: style('wonder_woman', 'Grounded, deliberate, hips led by the stride.', {
    tempo: 1.05, sway: 0.07, bounce: 0.05, armSwing: 0.12, fadeScale: 1.05
  }),
  professor_x_charles_xavier: style('professor_x_charles_xavier', 'Seated posture: almost no locomotion gesture.', {
    tempo: 0.8, sway: 0.02, bounce: 0.015, stride: 0.03, armSwing: 0.03,
    idleSway: 0.02, fadeScale: 1.3, turnBank: 0.12
  }),
  the_flash_barry_allen: style('the_flash_barry_allen', 'Everything happens faster; transitions barely exist.', {
    tempo: 1.3, sway: 0.05, bounce: 0.07, armSwing: 0.14, fadeScale: 0.7, turnBank: 0.45
  }),
  aquaman: style('aquaman', 'Broad and rolling, like walking through resistance.', {
    tempo: 0.97, sway: 0.08, bounce: 0.06, armSwing: 0.12, fadeScale: 1.1
  }),
  doctor_strange: style('doctor_strange', 'Still and controlled; hands matter more than hips.', {
    tempo: 0.95, sway: 0.03, bounce: 0.02, armSwing: 0.05, fadeScale: 1.2, turnBank: 0.2
  }),
  arnold_schwarzenegger: style('arnold_schwarzenegger', 'Very heavy ordnance: planted, minimal flourish.', {
    tempo: 0.88, sway: 0.03, bounce: 0.03, armSwing: 0.09, fadeScale: 1.25
  }),

  // ------------------------------------------------------------------------- anime
  goku: style('goku', 'Light on the balls of his feet, constant small bounce, loose arms.', {
    tempo: 1.12, sway: 0.06, bounce: 0.1, stride: 0.07, armSwing: 0.14, lean: 0.05,
    guardBounce: 0.16, idleSway: 0.05, breathing: 0.04, headTurn: 0.1,
    runLean: 0.08, fadeScale: 0.9
  }),
  vegeta: style('vegeta', 'Chest out, chin up, short proud steps - sway is beneath him.', {
    tempo: 1.06, sway: 0.03, bounce: 0.04, lean: -0.02, headPitch: -0.06,
    guardBounce: 0.06, idleSway: 0.025, armSwing: 0.08
  }),
  naruto_uzumaki: style('naruto_uzumaki', 'The shinobi run: torso pitched forward, arms streaming behind.', {
    tempo: 1.14, armBack: 1.15, runLean: 0.3, sway: 0.04, bounce: 0.08,
    armSwing: 0.06, headTurn: 0.14, fadeScale: 0.85
  }),
  sasuke_uchiha: style('sasuke_uchiha', 'Low, compact, economical - almost no wasted motion.', {
    tempo: 1.1, sway: 0.025, bounce: 0.03, armSwing: 0.05, lean: 0.04,
    guardBounce: 0.03, idleSway: 0.02, headTurn: 0.03, fadeScale: 0.8
  }),
  levi_ackerman: style('levi_ackerman', 'Committed and clipped: short steps, instant direction changes.', {
    tempo: 1.18, sway: 0.035, bounce: 0.06, armBack: 0.5, runLean: 0.18,
    armSwing: 0.07, fadeScale: 0.75, turnBank: 0.4
  }),
  madara_uchiha: style('madara_uchiha', 'Unhurried menace; nothing above the waistline moves.', {
    tempo: 1.0, sway: 0.03, bounce: 0.03, armSwing: 0.06, lean: -0.02, fadeScale: 1.1
  }),
  hashirama_senju: style('hashirama_senju', 'Open, plain, honest footwork.', {
    tempo: 1.02, sway: 0.06, bounce: 0.05, armSwing: 0.11
  }),
  saitama: style('saitama', 'Bored: upright, arms barely bothered to swing.', {
    tempo: 0.95, sway: 0.04, bounce: 0.03, armSwing: 0.05, lean: -0.03,
    guardBounce: 0.02, headTurn: 0.06, fadeScale: 1.0
  }),
  all_might: style('all_might', 'Heroic stance: chest forward, wide base, deliberate steps.', {
    tempo: 0.98, sway: 0.04, bounce: 0.05, armSwing: 0.1, lean: -0.04, fadeScale: 1.05
  }),
  edward_elric: style('edward_elric', 'Short quick strides, weight forward.', {
    tempo: 1.06, sway: 0.05, bounce: 0.06, armSwing: 0.11, lean: 0.04
  }),
  kaze: style('kaze', 'The reference fighter: wind-quick, leaning into the run.', {
    tempo: 1.1, sway: 0.05, bounce: 0.07, armBack: 0.45, runLean: 0.16, armSwing: 0.1
  }),
  l_death_note_style: style('l_death_note_style', 'Hunched, static, hands never far from the body.', {
    tempo: 0.9, sway: 0.02, bounce: 0.02, armSwing: 0.04, lean: 0.05,
    headPitch: 0.03, fadeScale: 1.15, turnBank: 0.15
  }),

  // ------------------------------------------------------- stylised platform fighters
  mario: style('mario', 'Cartoon bounce: quick feet, pronounced up-down.', {
    tempo: 1.15, sway: 0.06, bounce: 0.13, stride: 0.08, armSwing: 0.16,
    guardBounce: 0.1, fadeScale: 0.9
  }),
  luigi: style('luigi', 'Taller, twitchier, bouncier than his brother.', {
    tempo: 1.12, sway: 0.07, bounce: 0.16, stride: 0.08, armSwing: 0.18,
    guardBounce: 0.12, fadeScale: 0.9
  }),

  // ------------------------------------------------------------------- heavy melee
  kratos: style('kratos', 'Head down, shoulders forward, weight carried low.', {
    tempo: 0.92, sway: 0.05, bounce: 0.05, armSwing: 0.12, lean: 0.1,
    headPitch: 0.04, fadeScale: 1.1, turnBank: 0.22
  }),
  link: style('link', 'Balanced and practical; nothing exaggerated.', {
    tempo: 1.03, sway: 0.05, bounce: 0.05, armSwing: 0.1
  }),
  master_chief: style('master_chief', 'Armour: wide base, rigid torso, no sway.', {
    tempo: 0.92, sway: 0.02, bounce: 0.03, armSwing: 0.06, fadeScale: 1.25, turnBank: 0.16
  }),
  thor: style('thor', 'Broad and weighty, hips driving the stride.', {
    tempo: 0.9, sway: 0.06, bounce: 0.06, armSwing: 0.12, fadeScale: 1.15, flightLean: 0.05
  }),

  // --------------------------------------------------------------- elemental / magic
  aang: style('aang', 'Weightless: soft transitions, feet that barely commit.', {
    tempo: 1.04, sway: 0.05, bounce: 0.07, armSwing: 0.1, flightLean: -0.05,
    fadeScale: 1.15, turnBank: 0.35
  }),
  lord_voldemort: style('lord_voldemort', 'Gliding and minimal; the body resists effort.', {
    tempo: 0.85, sway: 0.03, bounce: 0.02, armSwing: 0.04, lean: 0.03,
    headPitch: 0.05, fadeScale: 1.25, turnBank: 0.14
  }),

  // --------------------------------------------------------------------- specialists
  edna_mode: style('edna_mode', 'Crisp and precise: tiny quick steps, no wasted sway.', {
    tempo: 1.1, sway: 0.03, bounce: 0.04, stride: 0.04, armSwing: 0.07,
    fadeScale: 0.85, turnBank: 0.25
  }),
  captain_jack_sparrow: style('captain_jack_sparrow', 'Swagger: the widest hip roll on the roster.', {
    tempo: 1.0, sway: 0.14, bounce: 0.07, armSwing: 0.13, lean: 0.05,
    headTurn: 0.12, idleSway: 0.05, fadeScale: 1.1
  }),
  spider_man: style('spider_man', 'Springy and loose, always half a beat from a flip.', {
    tempo: 1.08, sway: 0.07, bounce: 0.12, armSwing: 0.13, guardBounce: 0.12,
    turnBank: 0.45, idleSway: 0.05, fadeScale: 1.05
  }),
  iron_spider: style('iron_spider', 'Same agility, mechanically damped.', {
    tempo: 1.06, sway: 0.05, bounce: 0.07, armSwing: 0.09, guardBounce: 0.08,
    headTurn: 0.02, turnBank: 0.3, fadeScale: 1.05, flightLean: 0.08
  }),
  wolverine_logan: style('wolverine_logan', 'Feral and low: short aggressive steps, shoulders ahead of the hips.', {
    tempo: 1.08, sway: 0.06, bounce: 0.07, stride: 0.06, armSwing: 0.1,
    lean: 0.08, guardBounce: 0.12, headPitch: 0.04, fadeScale: 0.9
  }),
  geralt_of_rivia: style('geralt_of_rivia', 'Controlled swordsman: measured steps, steady weapon arm, no flourish.', {
    tempo: 1.0, sway: 0.04, bounce: 0.04, stride: 0.05, armSwing: 0.08,
    lean: 0.02, fadeScale: 1.05, turnBank: 0.16
  }),
  doom_slayer: style('doom_slayer', 'Armoured momentum: heavy cadence, square shoulders, almost no sway.', {
    tempo: 0.9, sway: 0.03, bounce: 0.03, stride: 0.055, armSwing: 0.08,
    fadeScale: 1.3, turnBank: 0.18, headPitch: -0.03
  }),
  infantry: style('infantry', 'Rifle ready: planted boots, short controlled steps, weapon arm steadier than the free arm.', {
    tempo: 0.97, sway: 0.035, bounce: 0.04, stride: 0.045, armSwing: 0.07,
    lean: 0.025, guardBounce: 0.04, fadeScale: 1.1, turnBank: 0.2
  })
});

/** Archetype fallbacks, so an identity added later still moves like its class. */
export const ARCHETYPE_MOTION_STYLES = Object.freeze({
  warrior: style('archetype:warrior', 'Archetype default for an unnamed warrior.', {
    tempo: 1.0, sway: 0.05, bounce: 0.05, armSwing: 0.1
  }),
  ninja: style('archetype:ninja', 'Archetype default for an unnamed shinobi.', {
    tempo: 1.12, sway: 0.035, bounce: 0.06, armBack: 0.35, runLean: 0.14, armSwing: 0.08, fadeScale: 0.85
  }),
  brawler: style('archetype:brawler', 'Archetype default for an unnamed bruiser.', {
    tempo: 0.88, sway: 0.09, bounce: 0.09, armSwing: 0.15, runLean: 0.08, fadeScale: 1.2
  }),
  mage: style('archetype:mage', 'Archetype default for an unnamed caster.', {
    tempo: 0.94, sway: 0.03, bounce: 0.03, armSwing: 0.06, fadeScale: 1.2, turnBank: 0.2
  }),
  cyborg: style('archetype:cyborg', 'Archetype default for an unnamed machine.', {
    tempo: 0.98, sway: 0.02, bounce: 0.03, armSwing: 0.05, fadeScale: 1.2, turnBank: 0.18
  })
});

/**
 * Neutral default: every overlay value is zero, so an identity with no authored entry plays its
 * clips exactly as the library authored them. Adding motion here would silently change every
 * fighter the roster does not name, which is not this layer's decision to make.
 */
export const DEFAULT_MOTION_STYLE = Object.freeze({
  id: 'default',
  note: 'No authored identity: play the clip exactly as authored.',
  tempo: 1, fadeScale: 1, sway: 0, bounce: 0, stride: 0, armSwing: 0, armBack: 0, lean: 0,
  runLean: 0, flightLean: 0, headPitch: 0, headTurn: 0, idleSway: 0, breathing: 0,
  guardBounce: 0, turnBank: 0
});

/**
 * The motion personality for a fighter. Identity first, then archetype, then neutral, so a new
 * roster entry animates sensibly without edits here while the roster stays explicit.
 */
export function styleFor(fighter) {
  const identity = String(fighter?.identityKey || '').toLowerCase();
  if (MOTION_STYLES[identity]) return MOTION_STYLES[identity];
  const archetype = String(fighter?.archetype || '').toLowerCase();
  if (ARCHETYPE_MOTION_STYLES[archetype]) return ARCHETYPE_MOTION_STYLES[archetype];
  return DEFAULT_MOTION_STYLE;
}

/**
 * Playback rate for a locomotion clip at a given ground speed.
 *
 * The clips are authored at one cycle per fixed duration, so playing them at 1x makes a fighter
 * skid at sprint speeds and shuffle at walk speeds. Scaling the rate with speed - deliberately
 * clamped, because matching a 12 m/s sprint to its true stride would look like a cartoon - keeps
 * the feet closer to the ground without changing any gameplay number.
 */
export function gaitTimeScale(motionStyle, clipId, speed = 0) {
  const tempo = Number(motionStyle?.tempo) > 0 ? Number(motionStyle.tempo) : 1;
  const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
  const v = Number.isFinite(speed) ? speed : 0;
  if (clipId === 'walk') return tempo * clamp(1 + (v - 2) * 0.035, 0.82, 1.35);
  if (clipId === 'run') return tempo * clamp(1 + (v - 7) * 0.02, 0.9, 1.3);
  if (clipId === 'sprint') return tempo * clamp(1 + (v - 12) * 0.02, 0.95, 1.25);
  if (clipId === 'strafe_left' || clipId === 'strafe_right') return tempo * 1.05;
  // Attacks are retimed against the gameplay active window; the personality must not fight that.
  return 1;
}

/** Every value the overlay reads, for the asset report and the node test. */
export function describeMotionStyle(motionStyle) {
  const s = motionStyle || DEFAULT_MOTION_STYLE;
  return {
    id: s.id,
    note: s.note || '',
    tempo: s.tempo,
    fadeScale: s.fadeScale,
    sway: s.sway,
    bounce: s.bounce,
    stride: s.stride,
    armSwing: s.armSwing,
    armBack: s.armBack,
    lean: s.lean,
    runLean: s.runLean,
    flightLean: s.flightLean,
    headPitch: s.headPitch,
    headTurn: s.headTurn,
    idleSway: s.idleSway,
    breathing: s.breathing,
    guardBounce: s.guardBounce,
    turnBank: s.turnBank
  };
}
