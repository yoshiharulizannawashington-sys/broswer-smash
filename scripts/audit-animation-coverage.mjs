// Honest animation-coverage audit: what each fighter can actually play, versus what its moves need.
//
// This does not claim an animation is good because a clip exists. It reports, per identity, which
// capability clips are present in the exported GLB and how many distinct attack clips exist, then
// compares that with the number of attacks the moveset and ability kit define. A move that shares
// one generic attack clip with every other attack is counted as uncovered.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROSTER_DIR = 'public/models/characters/roster';
const OUT = 'artifacts/audits/animation-coverage.json';

function glbJson(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546C67) return null;
  const jsonLength = buffer.readUInt32LE(12);
  return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
}

const CAPABILITIES = {
  idle: /idle|breath|stand/i,
  walk: /walk/i,
  run: /run|sprint|jog/i,
  jump: /jump|leap/i,
  fall: /fall|air/i,
  land: /land/i,
  block: /block|guard/i,
  dodge: /dodge|roll|dash/i,
  hurt: /hit|hurt|damage|stagger/i,
  ko: /ko|defeat|death|down/i,
  victory: /victory|win|taunt/i,
  transform: /transform|power|charge|form/i,
  throw: /throw|grab/i,
  special: /special|signature|cast|spell|beam/i,
  attack: /punch|jab|kick|attack|combo|slash|strike|swing/i
};

const { MOVESETS } = await import('../public/js/combat/movesets.js');
const { ABILITY_KIT } = await import('../public/js/combat/ability_kit.js');

const files = (await readdir(ROSTER_DIR)).filter(name => name.endsWith('.glb'));
const rows = [];
for (const file of files) {
  const json = glbJson(await readFile(join(ROSTER_DIR, file)));
  if (!json) continue;
  const clips = (json.animations || []).map(animation => animation.name || '');
  const capabilities = {};
  for (const [name, pattern] of Object.entries(CAPABILITIES)) capabilities[name] = clips.filter(clip => pattern.test(clip)).length;
  rows.push({
    file,
    clips: clips.length,
    clipNames: clips,
    capabilities,
    attacks: clips.filter(clip => CAPABILITIES.attack.test(clip)).length,
    distinctAttacks: new Set(clips.filter(clip => CAPABILITIES.attack.test(clip))).size
  });
}

const identities = Object.keys(MOVESETS);

// Bodies are not identities: this repo ships more GLBs than selectable fighters. Map each exported
// body to the identities the character manifest points at it, and name the bodies no identity uses,
// so animation production is never spent on a duplicate variant while a real fighter goes without.
const manifest = JSON.parse(await readFile('public/models/characters/manifest.json', 'utf8'));
const manifestEntries = Object.entries(manifest.characters || manifest)
  .filter(([, entry]) => entry && typeof entry === 'object' && entry.url);
const bodyOwners = new Map();
for (const [key, entry] of manifestEntries) {
  const file = String(entry.url).split('/').pop();
  if (!bodyOwners.has(file)) bodyOwners.set(file, []);
  bodyOwners.get(file).push(key);
}
for (const row of rows) row.identities = bodyOwners.get(row.file) || [];
const unclaimedBodies = rows.filter(row => !row.identities.length).map(row => ({ file: row.file, clips: row.clips }));
// Bodies are not all in the roster folder (the reference fighter Kaze sits beside it), so the
// existence check walks every character GLB rather than assuming one directory.
const allBodyFiles = new Set();
const walkBodies = async dir => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walkBodies(path);
    else if (entry.name.endsWith('.glb')) allBodyFiles.add(entry.name);
  }
};
await walkBodies('public/models/characters');
const identitiesWithoutBody = identities.filter(identity => {
  const entry = manifestEntries.find(([key]) => key === identity);
  if (!entry) return true;
  return !allBodyFiles.has(String(entry[1].url).split('/').pop());
});

// Distinct attack motions each identity can actually play, resolved through the live mapping.
const { motionKindFor, motionSetFor } = await import('../public/js/anim/attack_animator.js');
const { resolveMoveId } = await import('../public/js/combat/move_data.js');
const motionCoverage = identities.map(identity => {
  const fighter = { identityKey: identity, comboStep: 1 };
  const moveIds = [1, 2, 3, 4, 5].map(step => resolveMoveId({ comboStep: step })).concat([
    resolveMoveId({ heavy: true, heavyVariant: 'forward' }),
    resolveMoveId({ heavy: true, heavyVariant: 'launcher' }),
    resolveMoveId({ heavy: true, heavyVariant: 'slam' })
  ]);
  const slots = moveIds.map(id => motionKindFor({ id }, fighter));
  return { identity, set: motionSetFor(fighter).id, distinctMotions: new Set(slots.filter(Boolean)).size, moves: moveIds.length };
});
const kits = Object.keys(ABILITY_KIT);
const needs = identities.map(identity => {
  const set = MOVESETS[identity];
  const kit = ABILITY_KIT[identity] || [];
  return {
    identity,
    moves: (set?.lights?.length || 0) + (set?.heavy?.length || 0) + 1 /* aerial */ + 1 /* signature */ + kit.length + (set?.ultimate ? 1 : 0) + (Array.isArray(set?.forms) ? set.forms.length : set?.form ? 1 : 0)
  };
});

const totals = {
  fightersWithModels: rows.length,
  identities: identities.length,
  identitiesWithKit: kits.length,
  movesNeedingPresentation: needs.reduce((sum, row) => sum + row.moves, 0),
  fightersWithDistinctAttackClips: rows.filter(row => row.distinctAttacks >= 5).length,
  bodies: rows.length,
  manifestIdentities: manifestEntries.length,
  bodiesClaimedByAnIdentity: rows.filter(row => row.identities.length).length,
  unclaimedBodies: unclaimedBodies.length,
  identitiesWithoutBody: identitiesWithoutBody.length,
  identitiesWithEightDistinctMotions: motionCoverage.filter(row => row.distinctMotions >= 8).length,
  // Distinct motion counts are necessary but not sufficient: before this milestone all 34 identities
  // resolved the same eight slots, so "8 motions" was true and combat still looked identical.
  // "authored" means the identity owns a motion set of its own rather than borrowing the shared one.
  identitiesWithAuthoredMotionSet: motionCoverage.filter(row => row.set !== 'default').length,
  averageClips: rows.length ? +(rows.reduce((sum, row) => sum + row.clips, 0) / rows.length).toFixed(1) : 0,
  capabilityTotals: Object.fromEntries(Object.keys(CAPABILITIES).map(name => [name, rows.filter(row => row.capabilities[name] > 0).length]))
};

await mkdir('artifacts/audits', { recursive: true });
await writeFile(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(), totals, rows, needs, motionCoverage,
  unclaimedBodies, identitiesWithoutBody
}, null, 2));
console.log('ANIMATION COVERAGE AUDIT');
console.log(JSON.stringify(totals, null, 1));
console.log('fighters with >=5 distinct attack clips:', rows.filter(row => row.distinctAttacks >= 5).map(row => row.file).slice(0, 8).join(', ') || 'none');
console.log(`bodies ${rows.length} · claimed by an identity ${rows.filter(row => row.identities.length).length} · unclaimed ${unclaimedBodies.length} · identities without a body ${identitiesWithoutBody.length}`);
console.log(`identities with 8 distinct attack motions: ${motionCoverage.filter(row => row.distinctMotions >= 8).length}/${motionCoverage.length} (shared vocabulary)`);
console.log('identities owning an authored motion set:', motionCoverage.filter(row => row.set !== 'default').map(row => `${row.identity} (${row.set}, ${row.distinctMotions} motions)`).join(', ') || 'none');
if (unclaimedBodies.length) console.log('unclaimed bodies:', unclaimedBodies.map(row => row.file).slice(0, 10).join(', '));
if (identitiesWithoutBody.length) console.log('identities without a body:', identitiesWithoutBody.join(', '));
console.log('wrote', OUT);
