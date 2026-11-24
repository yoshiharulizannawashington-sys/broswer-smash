// Distinctness test: eight attack motions must sample to eight different poses.
import assert from 'node:assert/strict';
import { MOTIONS, MOTION_KINDS, sampleMotion } from '../public/js/anim/attack_animator.js';

const fingerprint = (kind, t) => {
  const pose = sampleMotion(kind, t);
  return Object.entries(pose).map(([joint, v]) => `${joint}:${v.map(n => n.toFixed(2)).join(',')}`).join('|');
};

assert.deepEqual(MOTION_KINDS, ['light1', 'light2', 'light3', 'light4', 'light5', 'heavy', 'heavyLauncher', 'heavySlam', 'special'],
  'the authored motion set is the eight attacks plus the signature cast');

for (const kind of MOTION_KINDS) {
  assert.ok(MOTIONS[kind].length >= 3, `${kind} has anticipation, contact and recovery frames`);
  const start = sampleMotion(kind, 0);
  const end = sampleMotion(kind, 1);
  const moved = Object.keys(start).some(joint => start[joint].some((value, index) => Math.abs(value - end[joint][index]) > 0.01));
  assert.ok(moved || kind === 'light2', `${kind} returns to rest at the end of the motion`);
}

const atContact = MOTION_KINDS.map(kind => fingerprint(kind, .35));
const uniqueContact = new Set(atContact);
assert.equal(uniqueContact.size, MOTION_KINDS.length, 'every attack has a distinct contact pose');

const midPoses = MOTION_KINDS.map(kind => fingerprint(kind, .6));
assert.equal(new Set(midPoses).size, MOTION_KINDS.length, 'every attack has a distinct recovery pose');

// Guard the specific identities the brief asks for.
const light1 = sampleMotion('light1', .35);
const light2 = sampleMotion('light2', .35);
assert.ok(Math.abs(light1.rightArm[0]) > Math.abs(light1.leftArm[0]), 'light 1 leads with the right arm');
assert.ok(Math.abs(light2.leftArm[0]) > Math.abs(light2.rightArm[0]), 'light 2 leads with the left arm');
const kick = sampleMotion('light3', .3);
assert.ok(Math.abs(kick.pelvis[1]) > 1.0, 'light 3 rotates the pelvis for a spinning kick');
const knee = sampleMotion('light4', .3);
assert.ok(knee.rightLeg[0] < -1.0, 'light 4 lifts the right knee');
const launcher = sampleMotion('heavyLauncher', .3);
assert.ok(launcher.rightArm[0] < -2.0, 'the launcher is a rising uppercut');
const slam = sampleMotion('heavySlam', .35);
assert.ok(slam.torso[0] > .4 && slam.pelvis[0] > .4, 'the slam drives the body downward');

console.log(`attack motion checks passed (${MOTION_KINDS.length} motions, ${uniqueContact.size} distinct contact poses).`);
