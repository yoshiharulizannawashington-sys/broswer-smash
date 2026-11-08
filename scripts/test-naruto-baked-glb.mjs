// The Blender-baked authored clips and the manifest must describe the same 20 animations.
//
//   node scripts/test-naruto-baked-glb.mjs
//
// A clip GLB that silently lost an action, or a manifest pointing at a renamed clip, would only show
// up as a missing pose in the browser. This checks the asset itself: names, durations, channel
// counts and that the file is clip-only.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { IMPORTED_AUTHORED_CLIP_SETS } from '../public/js/anim/animation_manifest.js';

let checks = 0;
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  checks++;
  console.log(`  ok  ${name}`);
}

const set = IMPORTED_AUTHORED_CLIP_SETS.naruto_uzumaki;
check('Naruto has a baked authored clip set', !!set, 'missing');
const path = 'public' + set.url;
check('the baked GLB exists', existsSync(path), path);

const buffer = await readFile(path);
const jsonLength = buffer.readUInt32LE(12);
const glb = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
const animations = glb.animations || [];
const byName = new Map(animations.map(animation => [animation.name, animation]));
const durationOf = animation => Math.max(0, ...animation.samplers.map(sampler => glb.accessors[sampler.input]?.max?.[0] || 0));

check('the GLB is clip-only (no meshes)', (glb.meshes || []).length === 0, `${(glb.meshes || []).length} meshes`);
check('the GLB carries the skeleton', (glb.skins || []).length === 1 && glb.nodes.length > 500,
  `${(glb.skins || []).length} skins, ${glb.nodes.length} nodes`);
check('the GLB has 20 animations', animations.length === 20, String(animations.length));

const strikeSlots = Object.entries(set.strikes);
const formSlots = Object.entries(set.forms);
check('15 combat slots are mapped', strikeSlots.length === 15, String(strikeSlots.length));
check('5 transformation sequences are mapped', formSlots.length === 5, String(formSlots.length));

for (const [slot, clipName] of [...strikeSlots, ...formSlots]) {
  const animation = byName.get(clipName);
  check(`${slot} -> ${clipName} exists`, !!animation, 'missing');
  if (!animation) continue;
  const channels = animation.channels.length;
  check(`${clipName} animates only the authored joints`, channels > 0 && channels <= 40, `${channels} channels`);
  const duration = durationOf(animation);
  check(`${clipName} has a playable duration`, duration >= 0.9, `${duration.toFixed(2)} s`);
  const bones = new Set(animation.channels.map(channel => glb.nodes[channel.target.node]?.name));
  check(`${clipName} targets named bones`, [...bones].every(Boolean) && bones.size >= 5, `${bones.size} bones`);
}

check('the ultimate runs the record length, not one second', durationOf(byName.get(set.strikes.ultimate)) >= 2.4,
  `${durationOf(byName.get(set.strikes.ultimate)).toFixed(2)} s`);
check('no animation is orphaned from the manifest',
  animations.every(animation => [...strikeSlots, ...formSlots].some(([, name]) => name === animation.name)),
  animations.map(a => a.name).filter(name => ![...strikeSlots, ...formSlots].some(([, n]) => n === name)).join(','));

console.log(`\nBaked Naruto clip asset passed (${checks} checks).`);
