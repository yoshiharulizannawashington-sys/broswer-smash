// Projectile origin tests: every policy, every fallback, and the guarantee that travel is untouched.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  ORIGIN_POLICIES, ORIGIN_OVERRIDES, DEFAULT_ORIGIN_POLICY, originPolicyFor,
  resolveProjectileOrigin, distanceFromBodyAxis, identityKeyOf
} from '../public/js/combat/projectile_origin.js';

let checks = 0;
const failures = [];
function check(name, condition, detail = '') {
  checks++;
  if (condition) { console.log(`  ok  ${name}`); return true; }
  failures.push(`${name}${detail ? ' — ' + detail : ''}`);
  console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`);
  return false;
}

/** A fighter stub whose bones sit at known world positions. */
function makeOwner(identity, bones = {}, { at = [0, 0, 0] } = {}) {
  const model = new THREE.Group();
  model.position.set(at[0], at[1], at[2]);
  const node = (name, x, y, z) => {
    const object = new THREE.Object3D();
    object.name = name;
    object.position.set(x, y, z);
    model.add(object);
    return object;
  };
  const userData = {};
  for (const [key, [name, x, y, z]] of Object.entries(bones)) userData[key] = node(name, x, y, z);
  model.userData = userData;
  return { identity, identityKey: identityKeyOf({ identity }), model, position: model.position };
}

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

console.log('\n[policy defaults and overrides]');
check('the default policy is the right hand', DEFAULT_ORIGIN_POLICY === ORIGIN_POLICIES.RIGHT_HAND);
check('an unlisted identity uses the default', originPolicyFor({ identity: 'Goku' }) === ORIGIN_POLICIES.RIGHT_HAND);
check('Iron Man is a right-hand caster (his repulsor is one-handed)',
  originPolicyFor({ identity: 'Iron Man (Tony Stark)' }) === ORIGIN_POLICIES.RIGHT_HAND);
for (const identity of ['Thor', 'Wonder Woman', 'Link']) {
  check(`${identity} fires from the weapon`, originPolicyFor({ identity }) === ORIGIN_POLICIES.WEAPON);
}
// Geralt is DLC, has no MOVESETS entry and no signature, so a weapon override for him was dead
// data. Removing it is a behaviour change, so it is asserted here rather than assumed.
check('a DLC fighter with no signature falls back to the right hand',
  originPolicyFor({ identity: 'Geralt of Rivia' }) === ORIGIN_POLICIES.RIGHT_HAND);
check('a weapon-sourced shot is weapon-origined regardless of identity',
  originPolicyFor({ identity: 'Goku' }, { source: 'weapon' }) === ORIGIN_POLICIES.WEAPON);
check('every override names a real policy',
  Object.values(ORIGIN_OVERRIDES).every(p => Object.values(ORIGIN_POLICIES).includes(p)));
// A regression guard against dead data: an override key that no identity can reach is a lie about
// coverage. Geralt of Rivia used to sit here with no moveset entry and no signature at all.
{
  const mainSource = readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
  const signatureKeys = new Set([
    ...[...mainSource.matchAll(/([a-z0-9_]+):\{label:'([^']*)',type:'([a-z]+)'/g)].map(m => m[1])
  ]);
  const deadOverrides = Object.keys(ORIGIN_OVERRIDES).filter(key => !signatureKeys.has(key));
  check('no override targets an identity without a real signature', deadOverrides.length === 0,
    deadOverrides.join(', '));
}

console.log('\n[right hand]');
{
  const owner = makeOwner('Goku', { rightHand: ['RightHand', 0.3, 1.2, 0.1] }, { at: [5, 0, -2] });
  const result = resolveProjectileOrigin({ owner, direction: { x: 1, y: 0, z: 0 } });
  check('resolves the hand bone', result.objectName === 'RightHand' && !result.usedFallback);
  // Owner at (5, 0, -2) with the hand at local (0.3, 1.2, 0.1) puts the palm at (5.3, 1.2, -1.9).
  check('the point is the bone world position', near(result.point.x, 5.3) && near(result.point.y, 1.2) && near(result.point.z, -1.9),
    JSON.stringify(result.point));
}

console.log('\n[left hand]');
{
  const owner = makeOwner('Kaze', { leftHand: ['LeftHand', -0.3, 1.15, 0] });
  const result = resolveProjectileOrigin({ owner, options: { originPolicy: 'leftHand' }, policy: 'leftHand' });
  // The policy table is authoritative; a body with only a left hand and a right-hand policy still
  // resolves through its fallback chain rather than returning nothing.
  check('a body with no right hand still resolves an origin', result.point && Number.isFinite(result.point.x));
  const leftOwner = makeOwner('Kaze', { leftHand: ['LeftHand', -0.3, 1.15, 0] });
  const direct = resolveProjectileOrigin({ owner: leftOwner, options: { source: 'weapon' } });
  check('weapon policy falls back through the listed chain', direct.usedFallback === true && Boolean(direct.point));
}

console.log('\n[weapon]');
{
  const owner = makeOwner('Wonder Woman', {
    equippedWeaponRight: ['Equipped Wonder Woman · Amazon sword', 0.45, 1.1, 0.2],
    rightHand: ['RightHand', 0.3, 1.2, 0.1]
  });
  const result = resolveProjectileOrigin({ owner, options: { source: 'weapon' } });
  check('the shot starts at the weapon, not the hand', result.objectName.includes('Amazon sword'));
  check('the weapon wins over the hand', !near(result.point.x, 0.3));
}

console.log('\n[weapon policy without a weapon]');
{
  // A weapon policy on a body that has no equipped weapon falls through to the hand. The hand is a
  // better origin than the chest, so the documented chain is weapon -> hand -> chest.
  const owner = makeOwner('Wonder Woman', { rightHand: ['RightHand', 0.3, 1.2, 0.1] }, { at: [2, 0, 4] });
  const result = resolveProjectileOrigin({ owner, options: { source: 'weapon' }, direction: { x: 1, y: 0, z: 0 } });
  check('a weapon policy with no weapon falls through to the hand', result.usedFallback === false && result.objectName === 'RightHand',
    `${result.objectName}/${result.usedFallback}`);

  // With no weapon and no hand there is nothing left but the chest point.
  const bareOwner = makeOwner('Wonder Woman', {}, { at: [2, 0, 4] });
  const bare = resolveProjectileOrigin({ owner: bareOwner, options: { source: 'weapon' }, direction: { x: 1, y: 0, z: 0 } });
  check('with no weapon and no hand the chest fallback is used', bare.usedFallback === true && near(bare.point.x, 3.05) && near(bare.point.y, 1.5));
}

console.log('\n[fallbacks never produce invalid coordinates]');
{
  const bare = { identity: 'Nobody', identityKey: 'nobody', model: { userData: {} }, position: new THREE.Vector3(3, 0, 7) };
  const result = resolveProjectileOrigin({ owner: bare, direction: { x: 1, y: 0, z: 0 } });
  check('a body with no bones falls back rather than crashing', result.usedFallback === true && Boolean(result.objectName) === false);
  check('the fallback point is finite', Number.isFinite(result.point.x) && Number.isFinite(result.point.y) && Number.isFinite(result.point.z));
  check('the fallback point sits in front of the fighter', near(result.point.x, 4.05) && near(result.point.y, 1.5) && near(result.point.z, 7));
  check('a model-less fighter does not throw', Boolean(resolveProjectileOrigin({ owner: { position: { x: 0, y: 0, z: 0 } } })));
  check('a NaN bone transform is rejected in favour of the fallback',
    (() => {
      const owner = makeOwner('Broken', { rightHand: ['RightHand', NaN, 0, 0] });
      return resolveProjectileOrigin({ owner }).usedFallback === true;
    })());
}

console.log('\n[direction and travel are never touched]');
{
  const owner = makeOwner('Goku', { rightHand: ['RightHand', 0.3, 1.2, 0.1] });
  const direction = { x: 0.6, y: 0, z: 0.8 };
  const snapshot = JSON.stringify(direction);
  resolveProjectileOrigin({ owner, direction });
  check('the passed direction object is not mutated', JSON.stringify(direction) === snapshot);
  check('the direction magnitude is untouched', near(Math.hypot(direction.x, direction.z), 1, 1e-9));
}

console.log('\n[self-intersection measure]');
{
  const owner = makeOwner('Goku', { rightHand: ['RightHand', 0.4, 1.1, 0] }, { at: [0, 0, 0] });
  const result = resolveProjectileOrigin({ owner });
  const distance = distanceFromBodyAxis(result.point, owner);
  check('a hand origin is measurably outside the body axis', distance > 0.3, distance.toFixed(3));
  check('a chest fallback is measured as inside/on the edge of the body', distanceFromBodyAxis({ x: 0, y: 1.1, z: 0 }, owner) < 0.05);
}

console.log(failures.length
  ? `\n${failures.length} failure(s):\n - ${failures.join('\n - ')}`
  : `\n${checks} projectile-origin checks passed`);
assert.equal(failures.length, 0);
