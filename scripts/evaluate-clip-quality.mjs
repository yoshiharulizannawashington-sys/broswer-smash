#!/usr/bin/env node
// Phase 28.4.14 objective 1: judge what a clip looks like, not just that a skeleton exists.
// Flags T-pose rest poses, arms held out during idle, static clips and feet that never plant.
//   node scripts/evaluate-clip-quality.mjs <a.glb> [b.glb ...] [--strict]
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import './glb-node-compat.mjs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

globalThis.self ||= globalThis;
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const files = args.filter(a => !a.startsWith('--'));
if (!files.length) { console.error('usage: node scripts/evaluate-clip-quality.mjs <glb...> [--strict]'); process.exit(2); }

const load = async file => {
  const b = readFileSync(file);
  const gltf = await new Promise((ok, bad) => new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), './', ok, bad));
  gltf.scene.updateMatrixWorld(true);
  return gltf;
};
const boneNamed = (scene, re) => { let found = null; scene.traverse(n => { if (!found && n.isBone && re.test(n.name.toLowerCase())) found = n; }); return found; };
const worldY = n => n ? n.getWorldPosition(new THREE.Vector3()).y : null;

function joints(scene) { const list = []; scene.traverse(n => { if (n.isBone) list.push(n); }); return list; }

async function evaluate(file) {
  const gltf = await load(file);
  const scene = gltf.scene;
  const box = new THREE.Box3().setFromObject(scene);
  const height = Math.max(0.2, box.max.y - box.min.y);
  const bones = joints(scene);
  const shoulder = boneNamed(scene, /shoulder|upperarm/);
  const hand = boneNamed(scene, /hand|wrist/);
  const hips = boneNamed(scene, /hips|pelvis/);
  const feet = [boneNamed(scene, /foot|toe/), bones.filter(b => /foot|toe/.test(b.name.toLowerCase())).pop()].filter(Boolean);
  const restDrop = shoulder && hand ? +(worldY(shoulder) - worldY(hand)).toFixed(3) : null;

  const mixer = new THREE.AnimationMixer(scene);
  const clips = [];
  for (const clip of gltf.animations || []) {
    const action = mixer.clipAction(clip);
    action.reset().play();
    const samples = [];
    const duration = clip.duration || 0.001;
    const previous = new Map();
    for (const t of [0, 0.25, 0.5, 0.75, 0.99].map(f => f * duration)) {
      mixer.setTime(t);
      scene.updateMatrixWorld(true);
      let travel = 0;
      for (const bone of bones) {
        const q = bone.quaternion.clone();
        const last = previous.get(bone.uuid);
        if (last) travel += THREE.MathUtils.radToDeg(last.angleTo(q));
        previous.set(bone.uuid, q);
      }
      samples.push({
        drop: shoulder && hand ? worldY(shoulder) - worldY(hand) : null,
        feetY: feet.length ? Math.min(...feet.map(worldY)) : null,
        travel,
        span: hand ? null : null,
      });
    }
    action.stop();
    const drops = samples.map(s => s.drop).filter(v => v != null);
    const meanDrop = drops.length ? drops.reduce((a, b) => a + b, 0) / drops.length : null;
    const footMin = samples.map(s => s.feetY).filter(v => v != null).length ? Math.min(...samples.map(s => s.feetY)) : null;
    const travel = Math.max(...samples.map(s => s.travel));
    const flags = [];
    // A raised-arm pose is legitimate for a defeat, victory or knockdown reaction, so only clips that
    // should read as a ready stance (locomotion, guard, attacks) are held to the arm-drop rule. A
    // T-pose is by definition a pose that never moves, so T_POSE also requires near-zero travel:
    // the Knight's `defeat` clip travels 595 degrees and was being mislabelled as a T-pose.
    const posedByDesign = /defeat|victory|knockdown|get_?up|ko\b|hit|launch|stagger/i.test(clip.name);
    if (!posedByDesign && meanDrop != null && meanDrop < 0.09 * height) flags.push('ARMS_OUT');
    if (meanDrop != null && meanDrop < 0.045 * height && travel < 20) flags.push('T_POSE');
    if (travel < 3) flags.push('STATIC');
    if (footMin != null && footMin > 0.08 * height) flags.push('NO_FOOT_CONTACT');
    clips.push({
      clip: clip.name,
      seconds: +duration.toFixed(2),
      armDropMean: meanDrop == null ? null : +meanDrop.toFixed(3),
      armDropRange: drops.length ? [+Math.min(...drops).toFixed(3), +Math.max(...drops).toFixed(3)] : null,
      jointsMoved: +travel.toFixed(1),
      footMinY: footMin == null ? null : +footMin.toFixed(3),
      flags,
    });
  }
  // A T-pose rest is a convention on authored rigs (Mixamo-style) as long as the clips drive the body,
  // so it is reported for information. What fails the review is a clip that never leaves the T-pose,
  // never moves, or leaves the feet in the air.
  const clipsDriveTheBody = clips.some(c => c.armDropMean != null && c.armDropMean >= 0.12 * height && c.jointsMoved >= 3);
  const restNote = restDrop == null ? null : restDrop < 0.09 * height ? (clipsDriveTheBody ? 'T_REST_CLIPS_DRIVE' : 'ARMS_OUT_REST') : null;
  return { file, name: basename(file), height: +height.toFixed(3), bones: bones.length, clipsInFile: (gltf.animations || []).length, restArmDrop: restDrop, restNote, clips };
}

const results = [];
for (const file of files) {
  try { results.push(await evaluate(file)); }
  catch (error) { results.push({ file, error: String(error?.message || error).slice(0, 200) }); }
}

for (const r of results) {
  if (r.error) { console.log(`\n${r.name} — ERROR: ${r.error}`); continue; }
  const rest = r.restArmDrop == null ? 'n/a' : `${r.restArmDrop.toFixed(3)} m${r.restNote === 'ARMS_OUT_REST' ? ' ⚠ ' + r.restNote : r.restNote === 'T_REST_CLIPS_DRIVE' ? ' (T rest, clips drive)' : ' ✓'}`;
  console.log(`\n${r.name} — height ${r.height} m, ${r.bones} bones, ${r.clipsInFile} clips, rest arm-drop ${rest}`);
  for (const c of r.clips) {
    const flags = c.flags.length ? '  ⚠ ' + c.flags.join(',') : '  ✓';
    console.log(`  ${c.clip.padEnd(12)} ${String(c.armDropMean).padEnd(7)} m drop  moved ${String(c.jointsMoved).padEnd(6)}°  feet ${c.footMinY == null ? 'n/a' : c.footMinY}${flags}`);
  }
  const bad = r.restNote === 'ARMS_OUT_REST' || r.clips.some(c => c.flags.length);
  if (bad) console.log(`  → ${r.name} FAILS visible-quality review`);
}
console.log('\nJSON:' + JSON.stringify({ strict, results }));
const failures = results.filter(r => r.error || r.restNote === 'ARMS_OUT_REST' || r.clips?.some(c => c.flags.some(f => ['T_POSE', 'STATIC', 'NO_FOOT_CONTACT'].includes(f))));
if (strict && failures.length) process.exit(1);
