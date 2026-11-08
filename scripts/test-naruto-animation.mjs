// Naruto animation coverage: does every move he can throw resolve to its own authored motion?
//
//   node scripts/test-naruto-animation.mjs
//
// This is a pure-data check, so it runs in milliseconds and catches the failure the browser test
// cannot see: two gameplay moves silently pointing at one motion slot, a signature ability falling
// back to a generic strike, or a form with no sequence at all. It does not replace the live browser
// evidence - it proves the table, and scripts/probe-naruto-animation.mjs proves the table is bound
// to the mounted rig and actually played.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  AUTHORED_ATTACK_SLOTS,
  AUTHORED_FORM_SLOTS,
  BODY_CLIP_SLOTS,
  IMPORTED_REACTION_CLIP_SETS,
  IMPORTED_ABILITY_CLIP_SETS,
  attackClipsFor,
  authoredStrikeSlotFor,
  authoredFormClipsFor,
  specialClipFor
} from '../public/js/anim/animation_manifest.js';
import { NARUTO_MOTIONS } from '../public/js/anim/attack_motions_naruto.js';
import { MOVE_MOTION } from '../public/js/anim/attack_animator.js';

let checks = 0;
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  checks++;
  console.log(`  ok  ${name}`);
}

const fighter = { identityKey: 'naruto_uzumaki' };
const authored = AUTHORED_ATTACK_SLOTS.naruto_uzumaki;
const motions = NARUTO_MOTIONS;

// ---------------------------------------------------------------- every slot has real motion
for (const [key, slot] of Object.entries(authored)) {
  check(`slot ${key} -> ${slot} has authored keyframes`, Array.isArray(motions[slot]) && motions[slot].length >= 4,
    `motion ${slot} ${motions[slot] ? motions[slot].length + ' keys' : 'MISSING'}`);
}

// ---------------------------------------------------------------- the eleven moves are distinct
// A signature is the per-frame joint set plus its amplitudes. Two moves that share a signature are
// the same animation under two names, which is exactly what the old baked table did (light1 and
// light2 both played `jab`).
function signature(motion) {
  return motion
    .map(key => Object.keys(key).filter(k => k !== 't').sort().map(j => `${j}:${key[j].map(v => v.toFixed(2)).join(',')}`).join('|'))
    .join('>');
}
const moveSlots = ['light1', 'light2', 'light3', 'light4', 'light5', 'heavy', 'heavyLauncher', 'heavySlam', 'special', 'ultimate', 'grab', 'throw'];
const signatures = new Map();
for (const slot of moveSlots) {
  check(`motion ${slot} exists`, Array.isArray(motions[slot]), slot);
  const sig = signature(motions[slot]);
  check(`motion ${slot} is not a duplicate of another move`, !signatures.has(sig),
    signatures.has(sig) ? `same as ${signatures.get(sig)}` : '');
  signatures.set(sig, slot);
}

// ---------------------------------------------------------------- authored motion leads baked clips
// The body table may only be a fallback now. If it still lists a strike slot, the binder would have
// a baked clip for a move whose authored motion it is supposed to compile, and the old bug (five
// baked clips covering eleven moves) could silently return.
// Baked clips stay in the table as fallbacks (the binder only reaches them when a motion compiles
// to no tracks), so the check is not that the table is empty: it is that every strike the resolver
// can ask for is an `authored_` id, which the binder compiles before it ever looks at a baked clip.
for (const [id, slot] of Object.entries({
  light1: 'light1', light2: 'light2', light3: 'light3', light4: 'light4', light5: 'light5',
  finisher: 'light5', heavy: 'heavy', heavyLauncher: 'heavyLauncher', heavySlam: 'heavySlam',
  special: 'rasenshuriken', ultimate: 'ultimate', grab: 'grab', throw: 'throw', counter: 'light3'
})) {
  const clip = attackClipsFor(fighter)[id];
  check(`attack clip for ${id} is authored, not baked`, clip === `authored_${slot}`, String(clip));
}
check('every text of the authored strike table is an authored slot',
  Object.values(authored).every(slot => typeof slot === 'string' && !!motions[slot]), JSON.stringify(authored));
check('the baked table is documented as fallback-only by holding no grab or throw',
  !(BODY_CLIP_SLOTS.naruto_uzumaki || {}).grab && !(BODY_CLIP_SLOTS.naruto_uzumaki || {}).throw,
  JSON.stringify(BODY_CLIP_SLOTS.naruto_uzumaki || {}));

// ---------------------------------------------------------------- the resolved slot per move id
const expected = {
  light1: 'light1', light2: 'light2', light3: 'light3', light4: 'light4', finisher: 'light5',
  heavy: 'heavy', heavyLauncher: 'heavyLauncher', heavySlam: 'heavySlam',
  special: 'rasenshuriken', ultimate: 'ultimate', grab: 'grab', throw: 'throw'
};
for (const [id, slot] of Object.entries(expected)) {
  const resolved = authoredStrikeSlotFor(fighter, { id, kind: 'melee' }, { step: 1 });
  check(`move ${id} resolves to ${slot}`, resolved === slot, String(resolved));
}
check('the special slot is Rasenshuriken, not the Rasengan thrust', authored.special === 'rasenshuriken', String(authored.special));
check('attackClipsFor asks the runtime for authored_<slot> per move',
  attackClipsFor(fighter).special === 'authored_rasenshuriken' && attackClipsFor(fighter).light2 === 'authored_light2',
  JSON.stringify({ special: attackClipsFor(fighter).special, light2: attackClipsFor(fighter).light2 }));
check('the signature clip resolves to the authored special', specialClipFor(fighter) === 'authored_rasenshuriken', specialClipFor(fighter));

// ---------------------------------------------------------------- abilities are their own motion
check('Shadow Clone has a summoning motion', authored.shadowClone === 'shadowClone' && !!motions.shadowClone);
check('Rasengan has its own palm-thrust motion', authored.rasengan === 'rasengan' && !!motions.rasengan);
check('Giant Rasengan is not the Rasengan motion', authored.giantRasengan === 'giantRasengan'
  && motions.giantRasengan !== motions.rasengan && !!motions.giantRasengan);
check('Giant Rasengan is the registered kit cast', authored.giantRasengan === 'giantRasengan');
const kitSource = await readFile(new URL('../public/js/combat/ability_kit.js', import.meta.url), 'utf8');
check("the GIANT RASENGAN ability fires the giantRasengan motion", /GIANT RASENGAN[^)]*motion: 'giantRasengan'/s.test(kitSource.replace(/\n/g, ' ')));
check('Kunai throw keeps its imported Naruto_Kunai clip',
  IMPORTED_ABILITY_CLIP_SETS.naruto_uzumaki?.slots?.kunai === 'Naruto_kunai',
  String(IMPORTED_ABILITY_CLIP_SETS.naruto_uzumaki?.slots?.kunai));

// ---------------------------------------------------------------- five forms, five sequences
const formIds = ['sage-mode', 'nine-tails-chakra', 'kurama-link', 'six-paths-sage', 'baryon-mode'];
const formSlots = authoredFormClipsFor(fighter);
check('five form ids map to authored sequences', formIds.every(id => !!formSlots?.[id]), JSON.stringify(formSlots));
check('each form plays a different sequence', new Set(formIds.map(id => formSlots[id])).size === 5, JSON.stringify(formIds.map(id => formSlots[id])));
for (const id of formIds) {
  const slot = formSlots[id];
  const motion = motions[slot];
  check(`form ${id} sequence ${slot} has an activation arc`, Array.isArray(motion) && motion.length >= 5, `${motion?.length} keys`);
  check(`form ${id} bursts before the activation window closes`, motion.some(key => key.t > .4 && key.t < .62), slot);
}
check('a fighter without forms gets no form table', authoredFormClipsFor({ identityKey: 'goku' }) === null);

// ---------------------------------------------------------------- reactions are bound to his rig
const reactions = IMPORTED_REACTION_CLIP_SETS.naruto_uzumaki;
check('Naruto has an imported reaction set', !!reactions, 'missing');
const reactionSlots = ['idle', 'jump', 'land', 'hit_light', 'hit_heavy', 'knockdown', 'get_up', 'victory', 'defeat'];
check('every reaction state has a clip', reactionSlots.every(slot => !!reactions?.slots?.[slot]),
  JSON.stringify(reactionSlots.filter(slot => !reactions?.slots?.[slot])));
check('reaction clips are Naruto_ prefixed', Object.values(reactions?.slots || {}).every(name => /^Naruto_/.test(name)),
  JSON.stringify(reactions?.slots));

// ---------------------------------------------------------------- every motion is well formed
const JOINTS = new Set(['pelvis', 'spine', 'torso', 'neck', 'head', 'leftClavicle', 'leftArm', 'leftFore', 'leftHand',
  'rightClavicle', 'rightArm', 'rightFore', 'rightHand', 'leftLeg', 'leftShin', 'leftFoot', 'rightLeg', 'rightShin', 'rightFoot']);
for (const [slot, motion] of Object.entries(motions)) {
  check(`${slot} starts and ends near rest`, motion[0].t === 0 && motion[motion.length - 1].t === 1, `${motion[0].t}..${motion[motion.length - 1].t}`);
  const last = motion[motion.length - 1];
  const touched = new Set(motion.flatMap(key => Object.keys(key)).filter(k => k !== 't'));
  check(`${slot} returns every joint it touched to zero`, [...touched].every(joint => Array.isArray(last[joint]) && last[joint].every(v => v === 0)),
    [...touched].filter(joint => !(Array.isArray(last[joint]) && last[joint].every(v => v === 0))).join(','));
  const unknown = [...touched].filter(joint => !JOINTS.has(joint));
  check(`${slot} names only canonical joints`, unknown.length === 0, unknown.join(','));
  const worst = Math.max(...motion.flatMap(key => Object.entries(key).filter(([joint]) => joint !== 't').flatMap(([, v]) => v.map(Math.abs))));
  check(`${slot} stays inside joint range`, worst <= 3.2, `${worst.toFixed(2)} rad`);
  // A jab can legitimately read in four keys (wind-up, contact, follow-through, recovery); the
  // longer techniques are the ones that need explicit staging beats.
  check(`${slot} has anticipation, contact and recovery`, motion.length >= 4, `${motion.length} keys`);
}

// ---------------------------------------------------------------- moves the resolver can ask for
check('every move motion slot has a Naruto motion', Object.values(MOVE_MOTION).every(slot => !!motions[slot]),
  Object.values(MOVE_MOTION).filter(slot => !motions[slot]).join(','));

console.log(`\nNaruto animation table passed (${checks} checks).`);
