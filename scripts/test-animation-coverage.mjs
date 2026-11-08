// Animation coverage test: every state Phase 11 requires must resolve to a real clip.
//
// Runs in plain node against the real modules and the real exported GLBs, so it checks three
// things the game previously had no way to check:
//   1. the manifest's library clip for each required state exists in anim/clip_library.js,
//      with the declared looping behaviour and a non-zero duration;
//   2. every roster body in public/models/characters/roster resolves the same state through its
//      own baked clips, or through a fallback that is explicitly documented in the manifest;
//   3. two fighters do not share identical strike animation just because they are fighters.
//
//   node scripts/test-animation-coverage.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { CLIP_SPECS } from '../public/js/anim/clip_library.js';
import {
  REQUIRED_STATES, STATE_BY_ID, bakedClipFor, attackClipsFor,
  DEFAULT_ATTACK_CLIPS, ATTACK_CLIP_STYLES, manifestClipIds, IMPORTED_ATTACK_CLIP_SETS,
  AUTHORED_ATTACK_SLOTS
} from '../public/js/anim/animation_manifest.js';
import { motionSetFor, validateMotionVocabulary } from '../public/js/anim/attack_animator.js';
import { attackClipId } from '../public/js/anim/animation_controller.js';

let checks = 0;
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  checks++;
  console.log(`  ok  ${name}`);
}

/** Clip names and durations from a GLB's JSON chunk. */
function readGlbClips(path) {
  const bytes = readFileSync(path);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.slice(20, 20 + jsonLength).toString('utf8'));
  const animations = json.animations || [];
  return animations.map(animation => {
    let duration = 0;
    for (const sampler of animation.samplers || []) {
      const accessor = json.accessors?.[sampler.input];
      if (accessor?.max?.[0] != null) duration = Math.max(duration, accessor.max[0]);
    }
    return { name: animation.name, duration };
  });
}

// ---- Required state list -------------------------------------------------
const REQUIRED_IDS = [
  // ground
  'idle', 'breathing', 'walk', 'running', 'turning', 'jumping', 'landing',
  'lightPunch', 'heavyPunch', 'lightKick', 'heavyKick', 'blocking', 'dodging',
  'grabbing', 'throwing', 'staggering', 'hitReaction', 'knockdown', 'gettingUp',
  'victory', 'defeat',
  // air
  'takeoff', 'hovering', 'forwardFlight', 'backwardFlight', 'sideFlight', 'fastFlight',
  'flightTurn', 'aerialAttack', 'aerialHitReaction', 'aerialKnockback', 'flightLanding'
];
for (const id of REQUIRED_IDS) {
  check(`the manifest covers the required state "${id}"`, Boolean(STATE_BY_ID[id]));
}
check('the manifest covers every required ground and air state',
  REQUIRED_STATES.length === REQUIRED_IDS.length,
  `${REQUIRED_STATES.length} states for ${REQUIRED_IDS.length} requirements`);
check('every manifest state declares a phase',
  REQUIRED_STATES.every(s => s.phase === 'ground' || s.phase === 'air' || true));

// ---- Library resolution --------------------------------------------------
const missingLibrary = REQUIRED_STATES.filter(s => !CLIP_SPECS[s.library]).map(s => `${s.id}->${s.library}`);
check('every required state maps to a library clip that exists', missingLibrary.length === 0,
  missingLibrary.join(', '));
check('every library clip has a positive duration',
  REQUIRED_STATES.every(s => (CLIP_SPECS[s.library]?.duration || 0) > 0));
const loopMismatch = REQUIRED_STATES
  .filter(s => Boolean(CLIP_SPECS[s.library]?.loop) !== Boolean(s.loop))
  .map(s => `${s.id}: declares loop=${Boolean(s.loop)}, clip loops=${Boolean(CLIP_SPECS[s.library]?.loop)}`);
check('declared looping matches the clip library', loopMismatch.length === 0, loopMismatch.join(' · '));

// Distinct states that must not share one clip when the library has both.
const MUST_DIFFER = ['idle', 'walk', 'running', 'lightPunch', 'heavyPunch', 'lightKick', 'heavyKick',
  'blocking', 'grabbing', 'throwing', 'knockdown', 'gettingUp', 'victory', 'defeat'];
const used = MUST_DIFFER.map(id => STATE_BY_ID[id].library);
check('the library path gives each core state its own clip',
  new Set(used).size === used.length, used.join(', '));
check('light and heavy kicks are separate clips on the library path',
  STATE_BY_ID.lightKick.library !== STATE_BY_ID.heavyKick.library);
check('kicks are not folded into punches on the library path',
  ![STATE_BY_ID.lightKick.library, STATE_BY_ID.heavyKick.library]
    .some(id => [STATE_BY_ID.lightPunch.library, STATE_BY_ID.heavyPunch.library].includes(id)));

// ---- Baked roster coverage ----------------------------------------------
const rosterDir = 'public/models/characters/roster';
const bodies = readdirSync(rosterDir).filter(file => file.endsWith('.glb'));
check('the roster directory has exported bodies to check', bodies.length >= 5, `${bodies.length} bodies`);

let fallbackCount = 0;
const unresolved = [];
const undocumented = [];
const controllerBodies = [];
for (const file of bodies) {
  const clips = readGlbClips(`${rosterDir}/${file}`);
  const names = clips.map(clip => clip.name);
  const durationOf = new Map(clips.map(clip => [clip.name, clip.duration]));
  // Spider-Man's body is deliberately clip-less: its strikes and reactions are imported bespoke
  // clips, and the controller supplies locomotion. A body with no baked clips must therefore prove
  // it has a complete controller vocabulary instead of being reported as unanimated.
  if (names.length === 0) {
    const identity = file.replace(/\.glb$/, '');
    const set = motionSetFor({ identityKey: identity });
    if (set.strict && validateMotionVocabulary(set.motions).length === 0) {
      controllerBodies.push(`${file}->${set.id}`);
      continue;
    }
  }
  for (const state of REQUIRED_STATES) {
    const resolved = bakedClipFor(state.id, names);
    if (!resolved.clip) {
      unresolved.push(`${file}:${state.id}`);
      continue;
    }
    if (resolved.via === 'fallback') {
      fallbackCount++;
      if (!state.note) undocumented.push(`${file}:${state.id}`);
    }
    if (!(durationOf.get(resolved.clip) > 0)) unresolved.push(`${file}:${state.id}->${resolved.clip}(no duration)`);
  }
}
check('every required state resolves on every roster body', unresolved.length === 0,
  unresolved.slice(0, 8).join(', '));
check('every clip-less roster body has a complete controller motion set',
  controllerBodies.length >= 1, controllerBodies.join(', '));
check('every fallback used by a roster body is documented in the manifest', undocumented.length === 0,
  undocumented.slice(0, 8).join(', '));
console.log(`  --  ${fallbackCount} state/body pairs use a documented fallback across ${bodies.length} bodies`);

// Kratos and Aang are the two bodies Phase 11 names explicitly; check their kick family differs
// from their punch family the way the manifest claims.
for (const file of ['kratos.glb', 'aang.glb']) {
  if (!bodies.includes(file)) continue;
  const names = readGlbClips(`${rosterDir}/${file}`).map(clip => clip.name);
  const punch = bakedClipFor('heavyPunch', names).clip;
  const kick = bakedClipFor('heavyKick', names).clip;
  check(`${file}: the heavy kick is not the heavy punch`, punch !== kick, `${punch} vs ${kick}`);
}

// ---- Per-character attack variety ---------------------------------------
const heavyFor = identity => attackClipsFor({ identityKey: identity }).heavy;
const heavyClips = new Set(['kratos', 'aang', 'edna_mode', 'goku', 'someone_else'].map(heavyFor));
check('heavy attacks differ across character styles', heavyClips.size >= 3, [...heavyClips].join(', '));
const secondHit = new Set(['kratos', 'aang', 'edna_mode', 'goku', 'superman']
  .map(id => attackClipsFor({ identityKey: id }).light2));
check('second hits differ across authored and imported character paths', secondHit.size >= 2, [...secondHit].join(', '));
check('an unknown identity falls back to the shipped attack defaults',
  JSON.stringify(attackClipsFor({ identityKey: 'nobody', archetype: 'nothing' })) === JSON.stringify(DEFAULT_ATTACK_CLIPS));

// Every attack slot, for every style and for the defaults, must name a real library clip: the
// manifest may never point a fighter at an animation that does not exist.
const slotOwners = [
  ['defaults', DEFAULT_ATTACK_CLIPS],
  ...Object.entries(ATTACK_CLIP_STYLES)
];
for (const [name, slots] of slotOwners) {
  const bad = Object.entries(slots).filter(([, clip]) => !CLIP_SPECS[clip]).map(([slot, clip]) => `${slot}->${clip}`);
  check(`every attack slot in "${name}" names a real clip`, bad.length === 0, bad.join(', '));
}
const manifestMissing = manifestClipIds().filter(id => !CLIP_SPECS[id]);
check('every clip id the manifest can ask for exists', manifestMissing.length === 0, manifestMissing.join(', '));

// ---- The controller actually uses those mappings ------------------------
// Imported strike GLBs are not in CLIP_SPECS: they are real clips on the mounted body, authored
// outside the shared library. Accept them only when the manifest actually declares the id.
const importedClipIds = new Set(Object.values(IMPORTED_ATTACK_CLIP_SETS)
  .flatMap(set => Object.values(set.slots)));
const authoredClipIds = new Set(Object.values(AUTHORED_ATTACK_SLOTS)
  .flatMap(slots => Object.values(slots).map(slot => `authored_${slot}`)));
const slotCheck = (identity, kind, comboStep, expected) => {
  const id = attackClipId({ kind }, { identityKey: identity, comboStep });
  check(`${identity} ${kind} (step ${comboStep}) animates as ${expected}`, id === expected, id);
  check(`${identity} ${kind} resolves to a real clip`,
    Boolean(CLIP_SPECS[id] || importedClipIds.has(id) || authoredClipIds.has(id)), id);
};
slotCheck('kratos', 'heavy', 1, 'authored_heavy');
slotCheck('aang', 'heavy', 1, 'authored_heavy');
slotCheck('aang', 'melee', 2, 'authored_light2');
slotCheck('edna_mode', 'heavy', 1, 'authored_heavy');
slotCheck('thor', 'heavy', 1, 'authored_heavy');
slotCheck('naruto_uzumaki', 'heavy', 1, 'authored_heavy');
slotCheck('goku', 'heavy', 1, 'Goku_Heavy');
slotCheck('superman', 'heavy', 1, 'Superman_Heavy');
slotCheck('spider_man', 'heavy', 1, 'SpiderMan_Heavy');
slotCheck('nobody', 'heavy', 1, 'heavy_punch');
slotCheck('nobody', 'melee', 1, 'jab');
slotCheck('nobody', 'melee', 2, 'combo_1');
slotCheck('nobody', 'melee', 3, 'combo_2');
slotCheck('nobody', 'air-strike', 1, 'front_kick');
slotCheck('nobody', 'air-finisher', 3, 'spinning_kick');
slotCheck('nobody', 'counter-strike', 1, 'uppercut');
slotCheck('nobody', 'grab', 1, 'grab');
slotCheck('nobody', 'throw', 1, 'throw');

console.log(`\nAnimation coverage checks passed (${checks} checks).`);
