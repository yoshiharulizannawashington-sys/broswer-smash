#!/usr/bin/env node
/**
 * Numerical animation audit for the imported Goku body and its authored clips.
 *
 * Forward-kinematics only: the body's skin bind pose and clip tracks are read from the same GLBs the
 * game loads, the tracks are sampled at fixed times, and the resulting joint world positions are
 * measured. That is enough to answer the questions a screenshot cannot:
 *
 *   - does the clip actually move the bones it claims to (per-joint peak angle)?
 *   - how far does the striking hand travel, and how fast (readability, not a twitch)?
 *   - do the feet stay on the floor, and does a planted foot slide during locomotion?
 *   - does a looping clip return to its first pose, and does an attack start/end in the stance?
 *   - where are anticipation / contact / recovery in time, so renders sample the right frames?
 *
 *   node scripts/audit-goku-animation.mjs [--body <glb>] [--clips <glb>] [--out <json>]
 */
import './glb-node-compat.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

globalThis.self ||= globalThis;

const arg = (name, fallback) => {
  const index = process.argv.indexOf('--' + name);
  return index > 0 ? process.argv[index + 1] : fallback;
};
const BODY = arg('body', 'public/models/characters/bespoke/goku_body.glb');
const CLIPS = arg('clips', 'public/models/characters/bespoke/goku_animated.glb');
const OUT = arg('out', 'artifacts/goku-animation/audit.json');

const load = file => new Promise((ok, bad) => {
  const buffer = readFileSync(file);
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  new GLTFLoader().parse(data, './', ok, bad);
});

const body = await load(BODY);
const clipFile = await load(CLIPS);
const scene = body.scene;
scene.updateMatrixWorld(true);

const bones = new Map();
const rest = new Map();
scene.traverse(node => {
  if (node.isBone || node.isSkinnedMesh) {
    if (node.isBone) {
      bones.set(node.name, node);
      rest.set(node.name, { position: node.position.clone(), quaternion: node.quaternion.clone() });
    }
  }
});
const jointNames = [...bones.keys()];

const LOOPING = /Idle|Walk|Run|Fall|Hover|FlyForward|FlyBack|FlyTurn/;
const ATTACKS = /Jab|Cross|Punch|Heavy|Kick|Launcher|AirPunch|AirKick|Slam|Grab|Throw|KiBlast|Kamehameha|DragonFist|Ultimate|InstantTransmission|Form|Special|Air$/;
const GROUNDED = /Idle|Walk|Run|Turn|Jab|Cross|Punch|Heavy|Kick|Launcher|Slam|Grab|Throw|Block|Dodge|Hit|Knockdown|GetUp|Victory|Defeat|KiBlast|Kamehameha|DragonFist|Ultimate|Instant|Form|Special/;

const tmpQuat = new THREE.Quaternion();
const restQuatOf = name => rest.get(name)?.quaternion || new THREE.Quaternion();
const jointPosition = name => {
  const bone = bones.get(name);
  if (!bone) return null;
  const v = new THREE.Vector3();
  bone.getWorldPosition(v);
  return [v.x, v.y, v.z];
};

const sampleClip = (clip, times) => {
  // Reset to rest, then evaluate every rotation track at each sample time.
  for (const [name, saved] of rest) {
    const node = bones.get(name);
    node.position.copy(saved.position);
    node.quaternion.copy(saved.quaternion);
  }
  const rotationTracks = clip.tracks
    .filter(track => track.name.endsWith('.quaternion'))
    .map(track => ({ name: track.name.split('.')[0], interpolant: track.createInterpolant() }));
  // Hips translation is real animation (grounding, jumps, knockdowns); ignoring it measured every
  // grounded clip as if the hips never moved, which is why the foot hover looked unchanged.
  const positionTracks = clip.tracks
    .filter(track => track.name.endsWith('.position'))
    .map(track => ({ name: track.name.split('.')[0], interpolant: track.createInterpolant() }));
  const frames = [];
  for (const time of times) {
    for (const [name, saved] of rest) {
      bones.get(name).quaternion.copy(saved.quaternion);
      bones.get(name).position.copy(saved.position);
    }
    for (const track of rotationTracks) {
      const bone = bones.get(track.name);
      if (!bone) continue;
      const value = track.interpolant.evaluate(Math.min(time, clip.duration));
      bone.quaternion.set(value[0], value[1], value[2], value[3]);
    }
    for (const track of positionTracks) {
      const bone = bones.get(track.name);
      if (!bone) continue;
      const value = track.interpolant.evaluate(Math.min(time, clip.duration));
      bone.position.set(value[0], value[1], value[2]);
    }
    scene.updateMatrixWorld(true);
    frames.push({
      time,
      hips: jointPosition('Hips'),
      chest: jointPosition('Chest'),
      head: jointPosition('Head'),
      leftHand: jointPosition('LeftHand'),
      rightHand: jointPosition('RightHand'),
      leftFoot: jointPosition('LeftFoot'),
      rightFoot: jointPosition('RightFoot'),
      leftToe: jointPosition('LeftToeBase'),
      rightToe: jointPosition('RightToeBase')
    });
  }
  return frames;
};

const distance = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : 0);
const horizontal = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[2] - b[2]) : 0);

const results = [];
for (const clip of clipFile.animations) {
  const fps = 60;
  const count = Math.max(8, Math.round(clip.duration * fps));
  const times = Array.from({ length: count + 1 }, (_, index) => (clip.duration * index) / count);
  const frames = sampleClip(clip, times);

  // Peak per-joint rotation away from rest: proves the clip drives real bones, and which.
  const perJoint = new Map();
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.quaternion')) continue;
    const name = track.name.split('.')[0];
    const restInverse = restQuatOf(name).clone().invert();
    let peak = 0;
    for (let i = 0; i < track.values.length; i += 4) {
      tmpQuat.set(track.values[i], track.values[i + 1], track.values[i + 2], track.values[i + 3]);
      const relative = restInverse.clone().multiply(tmpQuat);
      peak = Math.max(peak, 2 * Math.acos(Math.min(1, Math.abs(relative.w))) * 180 / Math.PI);
    }
    perJoint.set(name, +peak.toFixed(1));
  }
  const moved = [...perJoint.entries()].filter(([, degrees]) => degrees >= 2).sort((a, b) => b[1] - a[1]);

  // Hand speed: the peak frame-to-frame travel is the contact instant for a strike.
  let contactIndex = 0;
  let peakSpeed = 0;
  for (let index = 1; index < frames.length; index += 1) {
    const dt = frames[index].time - frames[index - 1].time;
    const travel = Math.max(
      distance(frames[index].rightHand, frames[index - 1].rightHand),
      distance(frames[index].leftHand, frames[index - 1].leftHand)
    );
    const speed = travel / dt;
    if (speed > peakSpeed) { peakSpeed = speed; contactIndex = index; }
  }
  const handTravel = Math.max(
    ...frames.map(frame => distance(frame.rightHand, frames[0].rightHand)),
    ...frames.map(frame => distance(frame.leftHand, frames[0].leftHand))
  );
  // A two-handed cast must actually bring the palms together in front of the chest. Separation is
  // the smallest distance the hands reach; reach is how far ahead of the chest they end up.
  const handSeparation = Math.min(...frames.map(frame => distance(frame.leftHand, frame.rightHand)));
  const chest = frames.map(frame => frame.chest).filter(Boolean);
  const reach = frames.map((frame, index) => {
    if (!frame.leftHand || !frame.rightHand || !chest[index]) return -Infinity;
    const mid = [(frame.leftHand[0] + frame.rightHand[0]) / 2, (frame.leftHand[1] + frame.rightHand[1]) / 2, (frame.leftHand[2] + frame.rightHand[2]) / 2];
    return mid[2] - chest[index][2];
  });

  // Feet: lowest point over the clip is the ground reference for this body (origin at the soles).
  const footY = frames.map(frame => Math.min(
    frame.leftFoot?.[1] ?? Infinity, frame.rightFoot?.[1] ?? Infinity,
    frame.leftToe?.[1] ?? Infinity, frame.rightToe?.[1] ?? Infinity
  ));
  const lowestFoot = Math.min(...footY);
  const highestFoot = Math.max(...footY);

  // Foot slide: while a foot is within 4 cm of its own lowest height it is "planted"; sum its
  // horizontal travel. A locomotion cycle should plant at least one foot and not drag it.
  const planted = (side) => {
    let slide = 0;
    let plantedFrames = 0;
    const positions = frames.map(frame => (side === 'left' ? frame.leftFoot : frame.rightFoot));
    const floor = Math.min(...positions.map(position => position?.[1] ?? Infinity));
    for (let index = 1; index < positions.length; index += 1) {
      const previous = positions[index - 1];
      const current = positions[index];
      if (!previous || !current) continue;
      if (previous[1] <= floor + 0.04 && current[1] <= floor + 0.04) {
        slide += horizontal(previous, current);
        plantedFrames += 1;
      }
    }
    return { slide: +slide.toFixed(3), plantedFrames };
  };
  const leftPlant = planted('left');
  const rightPlant = planted('right');

  // Loop / stance continuity: how far the last sampled pose is from the first, per joint.
  let worstLoopJoint = '';
  let worstLoopDegrees = 0;
  for (const [name, saved] of rest) {
    const track = clip.tracks.find(entry => entry.name === name + '.quaternion');
    if (!track) continue;
    const values = track.values;
    const first = new THREE.Quaternion(values[0], values[1], values[2], values[3]);
    const last = new THREE.Quaternion(values[values.length - 4], values[values.length - 3], values[values.length - 2], values[values.length - 1]);
    const degrees = 2 * Math.acos(Math.min(1, Math.abs(first.dot(last)))) * 180 / Math.PI;
    if (degrees > worstLoopDegrees) { worstLoopDegrees = degrees; worstLoopJoint = name; }
  }

  const loopExpected = LOOPING.test(clip.name) && !/Air$/.test(clip.name);
  results.push({
    name: clip.name,
    duration: +clip.duration.toFixed(3),
    tracks: clip.tracks.length,
    jointsDriven: moved.length,
    jointsAtLeast15: moved.filter(([, degrees]) => degrees >= 15).length,
    topJoints: moved.slice(0, 5).map(([name, degrees]) => `${name}:${degrees}`),
    peakHandSpeed: +peakSpeed.toFixed(2),
    handTravel: +handTravel.toFixed(3),
    handSeparation: +handSeparation.toFixed(3),
    reach: +Math.max(...reach).toFixed(3),
    contactTime: +frames[contactIndex].time.toFixed(3),
    contactFraction: +(frames[contactIndex].time / clip.duration).toFixed(2),
    lowestFoot: +lowestFoot.toFixed(3),
    footRange: +(highestFoot - lowestFoot).toFixed(3),
    leftFootSlide: leftPlant.slide,
    rightFootSlide: rightPlant.slide,
    loopClosureDegrees: +worstLoopDegrees.toFixed(1),
    loopClosureJoint: worstLoopJoint,
    loopExpected,
    groundedExpected: GROUNDED.test(clip.name)
  });
}

const summary = {
  body: BODY,
  clips: CLIPS,
  joints: jointNames.length,
  clipCount: results.length,
  clips: results
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(summary, null, 2));

console.log('clip'.padEnd(26), 'dur', 'jnt', '>=15', 'handM', 'm/s', 'hands', 'reach', 'contact', 'lowFoot', 'slideL', 'slideR', 'loopDeg');
for (const row of results) {
  console.log(
    row.name.padEnd(26),
    String(row.duration).padStart(4),
    String(row.jointsDriven).padStart(3),
    String(row.jointsAtLeast15).padStart(4),
    String(row.handTravel).padStart(5),
    String(row.peakHandSpeed).padStart(4),
    String(row.handSeparation).padStart(5),
    String(row.reach).padStart(5),
    String(row.contactFraction).padStart(7),
    String(row.lowestFoot).padStart(7),
    String(row.leftFootSlide).padStart(6),
    String(row.rightFootSlide).padStart(6),
    String(row.loopClosureDegrees).padStart(6)
  );
}
console.log('WROTE ' + OUT);
