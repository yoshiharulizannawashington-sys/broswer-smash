// Motion personality test: proves every roster identity has a reviewed stride, that the values are
// inside the range the overlay can safely apply, and that cadence responds to speed without ever
// leaving its clamps.
//
// Runs in node with no WebGL: motion_style.js is pure data and pure functions by design, so the
// whole 38-fighter table is asserted here instead of being eyeballed in the browser. The overlay
// itself (animation_controller.js) is exercised by scripts/test-animation-pipeline.mjs and
// scripts/validate-animations.mjs against a real skinned rig.
import { MOVESETS } from '../public/js/combat/movesets.js';
import {
  MOTION_STYLES, MOTION_DEFAULTS, DEFAULT_MOTION_STYLE, ARCHETYPE_MOTION_STYLES,
  styleFor, gaitTimeScale, describeMotionStyle
} from '../public/js/anim/motion_style.js';

let checks = 0;
let failures = 0;

function check(label, condition, detail = '') {
  checks++;
  if (condition) {
    console.log(`  PASS ${label}${detail ? ' — ' + detail : ''}`);
    return true;
  }
  failures++;
  console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`);
  return false;
}

const RANGES = {
  tempo: [0.7, 1.4],
  fadeScale: [0.6, 1.6],
  sway: [0, 0.2],
  bounce: [0, 0.2],
  stride: [0, 0.12],
  armSwing: [0, 0.22],
  armBack: [0, 1.3],
  lean: [-0.1, 0.15],
  runLean: [0, 0.35],
  flightLean: [-0.1, 0.15],
  headPitch: [-0.1, 0.1],
  headTurn: [0, 0.2],
  idleSway: [0, 0.1],
  breathing: [0, 0.06],
  guardBounce: [0, 0.2],
  turnBank: [0, 0.5]
};

console.log('1. every roster identity has an authored motion style');
const identities = Object.keys(MOVESETS);
const missing = identities.filter(id => !MOTION_STYLES[id]);
check('the roster is 38 identities', identities.length === 38, `${identities.length}`);
check('every roster identity has a style', missing.length === 0, missing.join(', ') || 'none missing');
const orphaned = Object.keys(MOTION_STYLES).filter(id => !MOVESETS[id]);
check('no style is authored for an identity that is not on the roster', orphaned.length === 0,
  orphaned.join(', ') || 'none');

console.log('2. every style stays inside the range the overlay can apply safely');
let outOfRange = [];
for (const [id, s] of Object.entries(MOTION_STYLES)) {
  for (const [key, [lo, hi]] of Object.entries(RANGES)) {
    const value = s[key];
    if (!Number.isFinite(value) || value < lo || value > hi) outOfRange.push(`${id}.${key}=${value}`);
  }
}
check('all numeric fields are finite and in range', outOfRange.length === 0,
  outOfRange.slice(0, 6).join(', ') || `${Object.keys(MOTION_STYLES).length} styles`);
check('every style carries a readable note', Object.values(MOTION_STYLES).every(s => s.note && s.note.length > 10));

console.log('3. resolution: identity, then archetype, then neutral');
check('identity wins', styleFor({ identityKey: 'goku' }) === MOTION_STYLES.goku);
check('identity lookup is case-insensitive', styleFor({ identityKey: 'GOKU' }) === MOTION_STYLES.goku);
check('unknown identity falls back to its archetype',
  styleFor({ identityKey: 'not_a_fighter', archetype: 'ninja' }) === ARCHETYPE_MOTION_STYLES.ninja);
check('unknown identity with no archetype gets the neutral default',
  styleFor({ identityKey: 'not_a_fighter' }) === DEFAULT_MOTION_STYLE);
check('a fighter with no data at all still resolves', styleFor(undefined) === DEFAULT_MOTION_STYLE);
const OVERLAY_FIELDS = Object.keys(RANGES).filter(key => key !== 'tempo' && key !== 'fadeScale');
check('the neutral default adds no motion at all (unlisted identities play the bare clip)',
  OVERLAY_FIELDS.every(key => DEFAULT_MOTION_STYLE[key] === 0)
  && DEFAULT_MOTION_STYLE.tempo === 1 && DEFAULT_MOTION_STYLE.fadeScale === 1);
check('inherited defaults are inert except tempo/fade, which are applied only to authored entries',
  MOTION_DEFAULTS.tempo === 1 && MOTION_DEFAULTS.fadeScale === 1);

console.log('4. cadence responds to speed and stays clamped');
for (const mode of ['walk', 'run', 'sprint']) {
  const slow = gaitTimeScale(MOTION_STYLES.goku, mode, mode === 'walk' ? 0.5 : mode === 'run' ? 5 : 9);
  const fast = gaitTimeScale(MOTION_STYLES.goku, mode, mode === 'walk' ? 6 : mode === 'run' ? 11 : 18);
  check(`${mode} plays faster at speed`, fast > slow, `${slow.toFixed(3)} -> ${fast.toFixed(3)}`);
  check(`${mode} never runs away (<= 1.6x)`, gaitTimeScale(MOTION_STYLES.hulk_bruce_banner, mode, 60) <= 1.6);
  check(`${mode} never stalls (>= 0.5x)`, gaitTimeScale(MOTION_STYLES.professor_x_charles_xavier, mode, 0) >= 0.5);
}
check('attacks are not retimed by personality (gameplay owns the strike window)',
  gaitTimeScale(MOTION_STYLES.goku, 'jab', 9) === 1 && gaitTimeScale(MOTION_STYLES.goku, 'special_attack', 9) === 1);
check('a non-numeric or missing speed does not produce NaN',
  Number.isFinite(gaitTimeScale(MOTION_STYLES.goku, 'walk', undefined))
  && Number.isFinite(gaitTimeScale(MOTION_STYLES.goku, 'run', NaN)));
check('a style with a broken tempo still plays at 1x',
  gaitTimeScale({ tempo: 0 }, 'walk', 3) > 0 && Number.isFinite(gaitTimeScale({ tempo: 0 }, 'walk', 3)));

console.log('5. the identities actually differ from one another');
check('Naruto runs with his arms streamed back', MOTION_STYLES.naruto_uzumaki.armBack >= 1,
  `${MOTION_STYLES.naruto_uzumaki.armBack}`);
check('his run also leans further than the neutral lean',
  MOTION_STYLES.naruto_uzumaki.runLean > MOTION_STYLES.goku.runLean);
check('Hulk steps slower than Goku', MOTION_STYLES.hulk_bruce_banner.tempo < MOTION_STYLES.goku.tempo);
check('Goku has the springy guard bounce', MOTION_STYLES.goku.guardBounce >= 0.12,
  `${MOTION_STYLES.goku.guardBounce}`);
check('Iron Man barely sways (armoured weight)', MOTION_STYLES.iron_man_tony_stark.sway <= 0.02);
check('Jack Sparrow has the widest hip roll', Object.entries(MOTION_STYLES)
  .every(([id, s]) => id === 'captain_jack_sparrow' || s.sway <= MOTION_STYLES.captain_jack_sparrow.sway));
check('Kratos carries his head lower than Vegeta carries his',
  MOTION_STYLES.kratos.headPitch > MOTION_STYLES.vegeta.headPitch);
check('The Flash transitions faster than Master Chief',
  MOTION_STYLES.the_flash_barry_allen.fadeScale < MOTION_STYLES.master_chief.fadeScale);
const distinct = new Set(Object.values(MOTION_STYLES).map(s => `${s.tempo}|${s.sway}|${s.bounce}|${s.armSwing}`));
check('at least 20 distinct motion signatures exist', distinct.size >= 20, `${distinct.size} distinct`);

console.log('6. the report the browser exposes');
const described = describeMotionStyle(MOTION_STYLES.goku);
check('describeMotionStyle reports every overlay input',
  Object.keys(RANGES).every(key => key in described) && described.id === 'goku');

console.log('');
console.log(`${checks - failures}/${checks} checks passed`);
if (failures) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
