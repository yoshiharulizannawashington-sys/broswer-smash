// The promoted Sage body and the manifest must describe the same shinobi clip set.
//
//   node scripts/test-naruto-baked-glb.mjs
//
// A body that silently lost an action, or a manifest pointing at a renamed clip, would only show
// up as a missing pose in the browser. This checks the asset itself: the Sage body, its 19-bone
// skeleton, the 20 authored strike/form clips, and the complete 49-clip inventory.
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
check('the Sage GLB exists', existsSync(path), path);

const buffer = await readFile(path);
const jsonLength = buffer.readUInt32LE(12);
const glb = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
const animations = glb.animations || [];
const byName = new Map(animations.map(animation => [animation.name, animation]));
const durationOf = animation => Math.max(0, ...animation.samplers.map(sampler => glb.accessors[sampler.input]?.max?.[0] || 0));

check('the GLB carries the three Sage meshes', (glb.meshes || []).length === 3,
  `${(glb.meshes || []).length} meshes`);
check('the GLB carries one skinned 19-bone skeleton',
  (glb.skins || []).length === 1 && glb.skins[0].joints?.length === 19 && glb.nodes.length === 23,
  `${(glb.skins || []).length} skins, ${glb.skins?.[0]?.joints?.length || 0} joints, ${glb.nodes.length} nodes`);
check('the GLB has all 49 shinobi animations', animations.length === 49, String(animations.length));
check('every shinobi clip name is unique', new Set(animations.map(a => a.name)).size === animations.length);

const strikeSlots = Object.entries(set.strikes);
const formSlots = Object.entries(set.forms);
check('15 combat slots are mapped', strikeSlots.length === 15, String(strikeSlots.length));
check('5 transformation sequences are mapped', formSlots.length === 5, String(formSlots.length));

for (const [slot, clipName] of [...strikeSlots, ...formSlots]) {
  const animation = byName.get(clipName);
  check(`${slot} -> ${clipName} exists`, !!animation, 'missing');
  if (!animation) continue;
  const channels = animation.channels.length;
  check(`${clipName} animates only the Sage joints`, channels > 0 && channels <= 40, `${channels} channels`);
  const duration = durationOf(animation);
  check(`${clipName} has a playable duration`, duration >= 0.9, `${duration.toFixed(2)} s`);
  const bones = new Set(animation.channels.map(channel => glb.nodes[channel.target.node]?.name));
  check(`${clipName} targets named bones`, [...bones].every(Boolean) && bones.size >= 5, `${bones.size} bones`);
}

const mapped = new Set([...strikeSlots, ...formSlots].map(([, name]) => name));
check('the 29 body/reaction/kunai clips remain in the asset', animations.length - mapped.size === 29,
  String(animations.length - mapped.size));
check('the ultimate runs the record length, not one second', durationOf(byName.get(set.strikes.ultimate)) >= 2.4,
  `${durationOf(byName.get(set.strikes.ultimate)).toFixed(2)} s`);
check('every mapped authored clip is present', [...mapped].every(name => byName.has(name)),
  [...mapped].filter(name => !byName.has(name)).join(','));

console.log(`\nSage shinobi clip asset passed (${checks} checks).`);
