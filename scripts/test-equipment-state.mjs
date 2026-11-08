// Equipment-state test: one interface for everything a fighter carries.
//
// This is the test that keeps the state system honest. It asserts the stow/restore cycle is exact,
// that repeated and interrupted transitions cannot corrupt a weapon's transform, that the state is
// derived from animation state alone (never from gameplay rules), and that the per-character policy
// really is per character: energy casters stow, weapon wielders keep what their move IS.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  EQUIPMENT_STATES, ENERGY_SIGNATURES, applyEquipmentState, equipmentStateFor,
  holdablesOf, describeEquipment
} from '../public/js/equipment_state.js';
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

const slug = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** A fighter stub with the same userData contract the live bodies expose. */
function makeFighter(identity, { weapon = true, offhand = false, pickup = false } = {}) {
  const model = new THREE.Group();
  model.name = 'body-' + identity;
  const make = (name, scale = 1) => {
    const object = new THREE.Group();
    object.name = name;
    object.scale.setScalar(scale);
    object.userData.baseScale = scale;
    return object;
  };
  if (weapon) model.userData.equippedWeaponRight = make('equipped-right', 1.6);
  if (offhand) model.userData.equippedWeaponLeft = make('equipped-left', 1.1);
  if (pickup) model.userData.pickupBlade = make('pickup-blade', 1);
  return { identity, identityKey: slug(identity), model };
}

/** Run the state towards `target` for `seconds`, then report the fighter's state. */
function settle(fighter, seconds = 0.6, step = 1 / 60) {
  for (let t = 0; t < seconds; t += step) applyEquipmentState(fighter, step);
  return fighter.model.userData.equipmentState?.state;
}

function enterSignature(fighter, { authored = 1.15, generic = 0 } = {}) {
  fighter.model.userData.authoredSpecialTime = authored;
  fighter.model.userData.specialPoseTime = generic;
}

function endSignature(fighter) {
  fighter.model.userData.authoredSpecialTime = 0;
  fighter.model.userData.specialPoseTime = 0;
}

console.log('\n[grip]');
{
  const fighter = makeFighter('Goku', { weapon: false, pickup: true });
  const blade = fighter.model.userData.pickupBlade;
  const state = settle(fighter);
  check('a fighter with no technique in progress is in grip', state === EQUIPMENT_STATES.GRIP, state);
  check('a held weapon stays visible in grip', blade.visible === true);
  check('grip leaves the weapon at its authored scale', Math.abs(blade.scale.x - 1) < 1e-6, String(blade.scale.x));
  check('the equipment report names each holdable', holdablesOf(fighter.model).length === 1
    && describeEquipment(fighter).holdables[0].name === 'pickup-blade');
}

console.log('\n[two-handed stow]');
{
  const fighter = makeFighter('Goku', { pickup: true, weapon: true, offhand: true });
  const objects = holdablesOf(fighter.model);
  enterSignature(fighter);
  check('an energy caster stows while its technique runs', equipmentStateFor(fighter) === EQUIPMENT_STATES.TWO_HANDED);
  // One frame in: the fade has started but must not have popped.
  applyEquipmentState(fighter, 1 / 60);
  const midScale = objects[0].scale.x;
  check('the stow fades instead of popping', midScale > 0 && midScale < 1.6, String(midScale));
  settle(fighter);
  check('every holdable is hidden once the stow completes', objects.every(o => o.visible === false),
    objects.map(o => `${o.name}:${o.visible}`).join(' '));
  check('a hidden weapon is not left as a visible speck', objects.every(o => o.scale.x < 0.1));
}

console.log('\n[exact restoration]');
{
  const fighter = makeFighter('Goku', { pickup: true, weapon: true, offhand: true });
  const [right, left, blade] = holdablesOf(fighter.model);
  const originals = [right.scale.x, left.scale.x, blade.scale.x];
  enterSignature(fighter);
  settle(fighter);
  endSignature(fighter);
  settle(fighter);
  check('returning to grip restores visibility', [right, left, blade].every(o => o.visible === true));
  check('returning to grip restores the exact original scale',
    [right, left, blade].every((o, i) => Math.abs(o.scale.x - originals[i]) < 1e-6),
    `${[right.scale.x, left.scale.x, blade.scale.x].join(',')} vs ${originals.join(',')}`);
  check('the state is recorded as grip once restored', equipmentStateFor(fighter) === EQUIPMENT_STATES.GRIP);
}
{
  // A weapon the game itself hid must stay hidden: restoration is of the original state, not of an
  // assumed "everything visible" state.
  const fighter = makeFighter('Goku', { pickup: true });
  const blade = fighter.model.userData.pickupBlade;
  blade.visible = false;
  enterSignature(fighter);
  settle(fighter);
  endSignature(fighter);
  settle(fighter);
  check('a holdable the game hid stays hidden after restoration', blade.visible === false);
}

console.log('\n[repeats and interruption]');
{
  const fighter = makeFighter('Goku', { pickup: true, weapon: true });
  const objects = holdablesOf(fighter.model);
  const originals = objects.map(o => o.scale.x);
  let survived = true;
  for (let cycle = 0; cycle < 10; cycle++) {
    enterSignature(fighter);
    settle(fighter, 0.5);
    endSignature(fighter);
    settle(fighter, 0.5);
    if (!objects.every((o, i) => o.visible && Math.abs(o.scale.x - originals[i]) < 1e-6)) survived = false;
  }
  check('ten stow/restore cycles return to the exact original transform', survived);
}
{
  const fighter = makeFighter('Goku', { pickup: true });
  const blade = fighter.model.userData.pickupBlade;
  enterSignature(fighter);
  applyEquipmentState(fighter, 1 / 60);
  endSignature(fighter);
  settle(fighter);
  check('an interrupted technique still restores the weapon',
    blade.visible === true && Math.abs(blade.scale.x - 1) < 1e-6, `${blade.visible}/${blade.scale.x}`);
}

console.log('\n[derived from animation state, never from gameplay rules]');
{
  const fighter = makeFighter('Goku', { pickup: true });
  fighter.specialCooldown = 0.5;
  fighter.hitstun = 0.2;
  fighter.flightMode = true;
  check('a signature cooldown alone never stows equipment', equipmentStateFor(fighter) === EQUIPMENT_STATES.GRIP);
  enterSignature(fighter, { authored: 0, generic: 0.4 });
  check('the generic special window also stows for an energy caster', equipmentStateFor(fighter) === EQUIPMENT_STATES.TWO_HANDED);
  endSignature(fighter);
  check('the state leaves two-handed when the window closes', equipmentStateFor(fighter) === EQUIPMENT_STATES.GRIP);
  fighter.model.userData.authoredSpecialTime = 0.2;
  check('an authored window keeps the stow while it lasts', equipmentStateFor(fighter) === EQUIPMENT_STATES.TWO_HANDED);
}

console.log('\n[character exceptions]');
{
  const cases = [
    ['Goku', EQUIPMENT_STATES.TWO_HANDED, 'ki technique needs both hands'],
    ['Iron Man (Tony Stark)', EQUIPMENT_STATES.GRIP, 'palm repulsor is one-handed'],
    ['Thor', EQUIPMENT_STATES.GRIP, 'Mjolnir is the attack'],
    ['Wonder Woman', EQUIPMENT_STATES.GRIP, 'her weapon is the attack'],
    ['Link', EQUIPMENT_STATES.GRIP, 'his weapon is the attack'],
    ['Geralt of Rivia', EQUIPMENT_STATES.GRIP, 'his weapon is the attack']
  ];
  for (const [identity, expected, why] of cases) {
    const fighter = makeFighter(identity, { pickup: true, weapon: true });
    enterSignature(fighter);
    const state = equipmentStateFor(fighter);
    check(`${identity} is ${expected} during its own signature`, state === expected, `${state} (${why})`);
  }
  check('Iron Man is not on the stow policy list', !ENERGY_SIGNATURES.has(slug('Iron Man (Tony Stark)')));
}

console.log('\n[whole-roster policy]');
{
  const identifiers = Object.keys(MOVESETS);
  const policy = identifiers.filter(id => ENERGY_SIGNATURES.has(slug(id)));
  const wielders = identifiers.filter(id => !ENERGY_SIGNATURES.has(slug(id)));
  check('the roster resolves against the policy', identifiers.length >= 34, `${identifiers.length} identities`);
  // 15, not the 16 first reported: Iron Man was removed from the list because his repulsor is a
  // one-handed palm emitter. The count is asserted so a policy edit is a deliberate act.
  check('the policy matches the documented stowing identities', ENERGY_SIGNATURES.size === 15, String(ENERGY_SIGNATURES.size));
  check('every policy identity is on the roster (no dead policy entries)',
    [...ENERGY_SIGNATURES].every(key => identifiers.some(id => slug(id) === key)),
    [...ENERGY_SIGNATURES].filter(key => !identifiers.some(id => slug(id) === key)).join(',') || 'none');

  let stowOk = true, keepOk = true;
  for (const id of policy) {
    const fighter = makeFighter(id, { pickup: true, weapon: true, offhand: true });
    enterSignature(fighter);
    const state = settle(fighter, 0.4);
    const objects = holdablesOf(fighter.model);
    if (state !== EQUIPMENT_STATES.TWO_HANDED || !objects.every(o => o.visible === false)) stowOk = false;
  }
  for (const id of wielders) {
    const fighter = makeFighter(id, { pickup: true, weapon: true, offhand: true });
    enterSignature(fighter);
    const state = settle(fighter, 0.4);
    const objects = holdablesOf(fighter.model);
    if (state !== EQUIPMENT_STATES.GRIP || !objects.every(o => o.visible === true)) keepOk = false;
  }
  check(`all ${policy.length} policy identities stow every holdable`, stowOk);
  check(`all ${wielders.length} weapon-wielders keep their equipment through a signature`, keepOk);
}

console.log(failures.length
  ? `\n${failures.length} failure(s):\n - ${failures.join('\n - ')}`
  : `\n${checks} equipment-state checks passed`);
assert.equal(failures.length, 0);
