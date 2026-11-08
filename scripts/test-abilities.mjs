// Ability framework test: every identity must have a complete, distinct, balanced moveset.
//
// The ability data already existed (combat/movesets.js), but nothing asserted it: a fighter could
// ship with no ultimate, a form that costs more meter than anyone can earn, or a duplicate label,
// and the only symptom would be a character that felt broken in a match. This runs in node against
// the real data and the real signature module.
//
//   node scripts/test-abilities.mjs
import assert from 'node:assert/strict';
import { MOVESETS, movesetFor, ultimateFor } from '../public/js/combat/movesets.js';
import { ABILITY_KIT, lightLabelFor } from '../public/js/combat/ability_kit.js';
import {
  signatureFor, impactSoundFor, hashColor, IDENTITY_TINTS, AURA_PITCH
} from '../public/js/combat/character_identity.js';
import { SEGMENTS, REACH, LEG_LAYOUT, POSES } from '../public/js/anim/spider_legs.js';

let checks = 0;
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  checks++;
  console.log(`  ok  ${name}`);
}

const identities = Object.keys(MOVESETS);
check('the moveset table is populated', identities.length >= 34, `${identities.length} identities`);

// ---- Completeness --------------------------------------------------------
const formless = new Set(identities.filter(key => MOVESETS[key].formless === true));
const incomplete = [];
for (const key of identities) {
  const set = MOVESETS[key];
  const problems = [];
  if (!Array.isArray(set.lights) || set.lights.length < 3) problems.push('lights');
  if (!Array.isArray(set.heavy) || set.heavy.length < 2) problems.push('heavy');
  if (!set.aerial) problems.push('aerial');
  if (!set.formless) {
    if (!set.form?.id) problems.push('form.id');
    if (!set.form?.label) problems.push('form.label');
    if (!set.form?.aura) problems.push('form.aura');
    if (!Number.isFinite(set.form?.color)) problems.push('form.color');
    if (!Number.isFinite(set.form?.duration)) problems.push('form.duration');
    if (!Number.isFinite(set.form?.cost)) problems.push('form.cost');
    if (!Number.isFinite(set.form?.drain)) problems.push('form.drain');
    if (!Number.isFinite(set.form?.cooldown)) problems.push('form.cooldown');
    if (!set.form?.special?.type) problems.push('form.special.type');
  }
  if (!set.ultimate?.label) problems.push('ultimate.label');
  if (problems.length) incomplete.push(`${key}:${problems.join('+')}`);
}
check('every identity has a complete ability set', incomplete.length === 0, incomplete.slice(0, 6).join(' · '));

// ---- Kit abilities -------------------------------------------------------
// Two castable kit abilities and a five-hit light string are the depth standard; before this the
// roster was one special button and a three-hit string.
const kitProblems = [];
for (const key of identities) {
  const kit = ABILITY_KIT[key];
  if (!Array.isArray(kit) || kit.length < 2 || kit.length > 4) { kitProblems.push(`${key}:count`); continue; }
  const labels = new Set();
  for (const entry of kit) {
    if (!entry.label || labels.has(entry.label)) kitProblems.push(`${key}:label`);
    labels.add(entry.label);
    if (!entry.type) kitProblems.push(`${key}:type`);
    if (!(entry.damage >= 6 && entry.damage <= 45)) kitProblems.push(`${key}:damage`);
    if (!(entry.cooldown >= .5 && entry.cooldown <= 8)) kitProblems.push(`${key}:cooldown`);
    if (!(entry.speed > 0)) kitProblems.push(`${key}:speed`);
  }
  const first = lightLabelFor(key, 1, MOVESETS[key].lights);
  const fifth = lightLabelFor(key, 5, MOVESETS[key].lights);
  if (!fifth) kitProblems.push(`${key}:chain5`);
  if (fifth && fifth === first) kitProblems.push(`${key}:chainRepeat`);
}
check('every identity has two to four distinct kit abilities and a five-hit chain',
  kitProblems.length === 0, kitProblems.slice(0, 6).join(' · '));

// The four kits in the current brief must be deeper than the standard two-slot kit. Naruto's
// fourth slot is the kunai throw, so his kit is four-deep; the gate is a depth floor, not a cap.
for (const id of ['naruto_uzumaki', 'superman', 'goku', 'spider_man']) {
  check(`${id} has at least a three-deep kit`, (ABILITY_KIT[id] || []).length >= 3,
    `${(ABILITY_KIT[id] || []).length} abilities`);
}

// Named identities from the brief must be present and have what the brief expects.
for (const id of ['kratos', 'aang', 'edna_mode', 'arnold_schwarzenegger', 'l_death_note_style',
  'iron_man_tony_stark', 'iron_spider']) {
  check(`${id} has a moveset`, Boolean(MOVESETS[id]));
}
check('Iron Man has a repulsor-class special',
  ['beam', 'orb', 'burst', 'shockwave'].includes(MOVESETS.iron_man_tony_stark?.form?.special?.type)
  || ['beam', 'orb', 'burst'].includes(MOVESETS.iron_man_tony_stark?.ultimate?.behaviour),
  JSON.stringify(MOVESETS.iron_man_tony_stark?.form?.special?.type));

// ---- Distinctness --------------------------------------------------------
const formIds = identities.filter(key => !formless.has(key)).map(key => MOVESETS[key].form.id);
check('no two identities share a form id', new Set(formIds).size === formIds.length,
  `${new Set(formIds).size} unique of ${formIds.length}`);
const ultimateLabels = identities.map(key => MOVESETS[key].ultimate.label);
check('ultimates are individually named', new Set(ultimateLabels).size >= identities.length - 2,
  `${new Set(ultimateLabels).size} unique`);
const styles = identities.map(key => MOVESETS[key].style);
check('every identity declares its own combat style', styles.every(Boolean));

// ---- Balance bands -------------------------------------------------------
const outOfBand = [];
for (const key of identities) {
  const { form, ultimate } = MOVESETS[key];
  const bad = [];
  if (!formless.has(key)) {
  if (form.cost < 20 || form.cost > 70) bad.push(`cost ${form.cost}`);
  if (form.cooldown < 4 || form.cooldown > 20) bad.push(`cooldown ${form.cooldown}`);
  if (form.drain < 0 || form.drain > 15) bad.push(`drain ${form.drain}`);
  if (form.duration < 5 || form.duration > 14) bad.push(`duration ${form.duration}`);
  const dmgMod = form.mods?.damage;
  if (dmgMod != null && (dmgMod < 0.9 || dmgMod > 1.45)) bad.push(`damage x${dmgMod}`);
  const speedMod = form.mods?.speed;
  if (speedMod != null && (speedMod < 0.85 || speedMod > 1.5)) bad.push(`speed x${speedMod}`);
  const specialDamage = form.special?.damage;
  if (specialDamage != null && (specialDamage < 6 || specialDamage > 45)) bad.push(`special ${specialDamage}`);
  }
  // `ultimate.damage` is raw damage, not a multiplier: the shipped ultimates read 9-30.
  const ult = ultimate?.damage;
  if (ult != null && (ult < 8 || ult > 45)) bad.push(`ultimate ${ult}`);
  if (bad.length) outOfBand.push(`${key}:${bad.join(', ')}`);
}
check('every form sits inside the balance bands', outOfBand.length === 0,
  outOfBand.slice(0, 5).join(' · '));

// A form that costs more meter than its duration can earn back is a trap pick; flag it.
const trapForms = identities.filter(key => {
  const { form } = MOVESETS[key];
  return !MOVESETS[key].formless && form.drain > 0 && form.cost > form.duration * 12;
});
check('no form costs more meter than it can realistically earn back', trapForms.length === 0,
  trapForms.join(', '));

// ---- Presentation signature ---------------------------------------------
const signatures = identities.map(key => signatureFor(key));
check('every identity has a signature', signatures.length === identities.length);
check('every signature colour is a real colour',
  signatures.every(s => Number.isInteger(s.color) && s.color >= 0 && s.color <= 0xffffff));
check('every signature pitch is inside the audible band',
  signatures.every(s => s.pitch >= 0.6 && s.pitch <= 1.6));
const distinctColors = new Set(signatures.map(s => s.color));
check('fighters do not all share one impact colour', distinctColors.size >= 20,
  `${distinctColors.size} distinct colours`);
const distinctPitches = new Set(signatures.map(s => s.pitch));
check('impact pitch varies with the aura family', distinctPitches.size >= 3,
  `${distinctPitches.size} distinct pitches`);

check('a heavy identity hits lower than an airbender',
  signatureFor('kratos').pitch < signatureFor('aang').pitch,
  `${signatureFor('kratos').pitch} vs ${signatureFor('aang').pitch}`);
check('declared tints win over the derived colour',
  signatureFor('iron_man_tony_stark').color === IDENTITY_TINTS.iron_man_tony_stark.color);
check('the signature records where it came from',
  signatureFor('kratos').source === 'identity-tint' && signatureFor('nobody_at_all').source === 'hash');
check('an unknown identity still gets a stable colour',
  hashColor('somebody') === hashColor('somebody') && hashColor('somebody') !== hashColor('somebody_else'));
check('impact sound parameters are usable as-is',
  impactSoundFor('goku', 12).intensity === 12 && impactSoundFor('goku').pitch === signatureFor('goku').pitch);
check('every aura family has an impact pitch',
  Object.values(AURA_PITCH).every(p => p >= 0.6 && p <= 1.6));

// ---- Iron Spider appendages ---------------------------------------------
check('Iron Spider carries the configured appendage count', LEG_LAYOUT.length === 4, `${LEG_LAYOUT.length} legs`);
check('each leg is a multi-segment limb', SEGMENTS.length === 3, SEGMENTS.join(', '));
check('the legs reach far enough to matter in combat', REACH > 1.5, `${REACH.toFixed(2)} m`);
check('the legs have poses for idle, guard and an attack strike',
  ['idle', 'guard', 'strike'].every(id => Boolean(POSES[id])),
  Object.keys(POSES).join(', '));
check('the legs also cover stagger, flight and landing',
  ['stagger', 'flight', 'land'].every(id => Boolean(POSES[id])));

// ---- Lookup helpers ------------------------------------------------------
// movesetFor resolves by object slug or by plain key, and returns null for an unknown identity so
// the caller can pick its own fallback rather than silently borrowing another fighter's moves.
check('movesetFor resolves a fighter object and a plain key',
  movesetFor({ identityKey: 'goku' }) === MOVESETS.goku && movesetFor('goku') === MOVESETS.goku);
check('an unknown identity resolves to null, not to someone else\'s moveset',
  movesetFor({ identityKey: 'nobody' }) === null && movesetFor('nobody') === null && movesetFor(undefined) === null);
check('ultimateFor returns the identity ultimate',
  ultimateFor({ identityKey: 'goku' })?.label === MOVESETS.goku.ultimate.label);

console.log(`\nAbility framework checks passed (${checks} checks).`);
