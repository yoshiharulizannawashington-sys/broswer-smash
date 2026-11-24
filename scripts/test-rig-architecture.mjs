// Rig architecture test: the shared animation interface stays fixed while individual bodies may
// carry more joints, character-owned rigs, or fewer of the optional extensions.
//
// This is the test that stops the canonical joint list from becoming a ceiling: it asserts the
// interface is a strict subset of what bodies actually bind, that every roster identity resolves a
// profile, that the authored bodies bind the full contract, and that a body missing its optional
// joints is still animation-ready instead of silently broken.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CANONICAL_BONES, CORE_BONES, EXTENSION_BONES, resolveRig } from '../public/js/anim/rig_map.js';
import {
  RIG_CAPABILITY_GROUPS, SPECIALIZED_RIGS, IDENTITY_RIG_PROFILES, DEFAULT_RIG_PROFILE,
  rigProfileFor, requiredBonesFor, describeRigCapabilities, isAnimationReady
} from '../public/js/anim/rig_profile.js';
import { createSculptedFighter, hasSculptedFighter, SCULPTED_FIGHTERS } from '../public/js/characters/sculpted.js';
import { makeProceduralCharacter } from '../public/js/models.js';
import { MOVESETS } from '../public/js/combat/movesets.js';

let checks = 0;
const failures = [];
function check(name, condition, detail = '') {
  checks++;
  if (condition) { console.log(`  ok  ${name}`); return true; }
  failures.push(`${name}${detail ? ' — ' + detail : ''}`);
  console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`);
  return false;
}

console.log('\n[shared interface]');
const canonical = new Set(CANONICAL_BONES);
check('the core contract is a subset of the canonical interface', CORE_BONES.every(b => canonical.has(b)));
check('the extensions are exactly the canonical bones beyond the core',
  CANONICAL_BONES.length === CORE_BONES.length + EXTENSION_BONES.length
  && EXTENSION_BONES.every(b => canonical.has(b) && !CORE_BONES.includes(b)),
  `${CORE_BONES.length} core + ${EXTENSION_BONES.length} extensions = ${CANONICAL_BONES.length}`);
check('the interface has no duplicate bone', canonical.size === CANONICAL_BONES.length);
let strayGroupBone = null;
for (const [group, bones] of Object.entries(RIG_CAPABILITY_GROUPS)) {
  for (const bone of bones) if (!canonical.has(bone)) strayGroupBone = `${group}.${bone}`;
}
check('every capability group names only shared-interface bones', !strayGroupBone, strayGroupBone || 'none');
check('empty capability groups are declared, not absent (fingers, face are planned)',
  'fingers' in RIG_CAPABILITY_GROUPS && 'face' in RIG_CAPABILITY_GROUPS);

console.log('\n[per-character profiles]');
const identities = Object.keys(MOVESETS);
check('every roster identity resolves a rig profile',
  identities.every(id => Boolean(rigProfileFor({ identityKey: id }))), `${identities.length} identities`);
check('an unlisted identity falls back to the shared-only default',
  rigProfileFor({ identityKey: 'not_on_roster' }) === DEFAULT_RIG_PROFILE);
check('a specialist profile points at a declared specialized rig',
  Object.values(IDENTITY_RIG_PROFILES).every(p => !p.specialized || Boolean(SPECIALIZED_RIGS[p.specialized])));
check('specialized rigs name their owning module (no hidden second animation system)',
  Object.values(SPECIALIZED_RIGS).every(rig => typeof rig.owner === 'string' && rig.owner.includes('/')));
check('required bones are the shared interface plus the character\'s own bones',
  requiredBonesFor(DEFAULT_RIG_PROFILE).length === CANONICAL_BONES.length
  && requiredBonesFor({ extraBones: ['tail'] }).includes('tail'));

console.log('\n[authored bodies bind the whole contract]');
const gokuSlug = Object.keys(SCULPTED_FIGHTERS).find(slug => /goku/i.test(slug));
const ironSlug = Object.keys(SCULPTED_FIGHTERS).find(slug => /iron.?man/i.test(slug));
for (const [label, slug, identityKey] of [['Goku', gokuSlug, 'goku'], ['Iron Man', ironSlug, 'iron_man_tony_stark']]) {
  if (!slug || !hasSculptedFighter(slug)) { check(`${label} authored body exists`, false, String(slug)); continue; }
  const body = createSculptedFighter(slug, { identity: label });
  const rig = resolveRig(body);
  const caps = describeRigCapabilities(rig, rigProfileFor({ identityKey }));
  check(`${label}: binds every canonical joint`, caps.boundJoints >= CANONICAL_BONES.length && caps.missing.length === 0,
    `${caps.boundJoints} joints, missing ${caps.missing.join(', ') || 'none'}`);
  check(`${label}: core and extensions both complete`, caps.coreComplete && caps.extensionsComplete,
    `core=${caps.coreComplete} extensions=${caps.extensionsComplete}`);
  check(`${label}: is animation-ready`, isAnimationReady(caps));
}

console.log('\n[prefab bodies and graceful degradation]');
const hulk = makeProceduralCharacter('brawler', 'Hulk');
const hulkRig = resolveRig(hulk);
const hulkCaps = describeRigCapabilities(hulkRig, rigProfileFor({ identityKey: 'hulk_bruce_banner' }));
check('a prefab body binds the canonical contract too', hulkCaps.boundJoints >= CANONICAL_BONES.length,
  `${hulkCaps.boundJoints}/${CANONICAL_BONES.length}`);
check('every capability group is reported per body', Object.keys(hulkCaps.groups).length === Object.keys(RIG_CAPABILITY_GROUPS).length);

const bare = makeProceduralCharacter('warrior', 'Bare');
for (const key of ['leftHand', 'rightHand', 'leftFoot', 'rightFoot', 'neck', 'spine', 'leftClavicle', 'rightClavicle']) {
  delete bare.userData[key];
}
const bareCaps = describeRigCapabilities(resolveRig(bare), DEFAULT_RIG_PROFILE);
check('a body without its optional joints still reports the core complete', bareCaps.coreComplete);
check('its missing joints are named rather than hidden',
  bareCaps.missing.includes('leftHand') && bareCaps.missing.includes('spine'),
  bareCaps.missing.join(', '));
check('it stays animation-ready (the clip layer can still drive it)', isAnimationReady(bareCaps));
check('it is not reported as having the extensions', bareCaps.extensionsComplete === false);

console.log('\n[character-owned rigs]');
const spiderSlug = Object.keys(SCULPTED_FIGHTERS).find(slug => /spider/i.test(slug) && /iron/i.test(slug));
if (spiderSlug && hasSculptedFighter(spiderSlug)) {
  const spider = createSculptedFighter(spiderSlug, { identity: 'Iron Spider' });
  const caps = describeRigCapabilities(resolveRig(spider), rigProfileFor({ identityKey: 'iron_spider' }));
  check('Iron Spider declares its appendage rig', caps.specialized?.id === 'spider-appendages', String(caps.specialized?.id));
  check('the appendage rig is owned outside the shared clip library',
    caps.specialized?.owner.includes('spider_legs'), caps.specialized?.owner);
  check('the body really carries the appendage data', Boolean(spider.userData?.spiderLegs ?? spider.userData?.spiderLegs));
} else {
  check('Iron Spider authored body exists', false, String(spiderSlug));
}
const plainCaps = describeRigCapabilities(hulkRig, DEFAULT_RIG_PROFILE);
check('a non-specialist reports no specialized rig', plainCaps.specialized === null);

console.log('');
console.log(`${checks - failures.length}/${checks} rig-architecture checks passed`);
if (failures.length) {
  console.log(failures.join('\n'));
  process.exit(1);
}
