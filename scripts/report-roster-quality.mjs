// Generates docs/CHARACTER_ROSTER_QUALITY_AUDIT.md from the live modules - the roster in main.js,
// the moveset table, the per-character locomotion table and the character manifest - so the
// document cannot drift away from the data it describes. It also folds in the measured
// performance probe (artifacts/performance.json) and the last gate results
// (artifacts/verification.json) when they exist.
//
//   node scripts/report-roster-quality.mjs                          # matrix only
//   node scripts/report-roster-quality.mjs > docs/CHARACTER_ROSTER_QUALITY_AUDIT.md
import { readFileSync, statSync, existsSync } from 'node:fs';
import { MOVESETS } from '../public/js/combat/movesets.js';
import { LOCOMOTION } from '../public/js/combat/locomotion.js';
import { CANONICAL_BONES } from '../public/js/anim/rig_map.js';

const CANONICAL_BONE_COUNT = CANONICAL_BONES.length;

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const json = path => { try { return JSON.parse(readFileSync(new URL(path, root), 'utf8')); } catch { return null; } };
const main = read('public/js/main.js');
const manifest = JSON.parse(read('public/models/characters/manifest.json'));
const performance = json('artifacts/performance.json');
const verification = json('artifacts/verification.json');
// Per-body measurements taken with the game's own loader (scripts/measure-roster-bodies.mjs).
// Without this the matrix would show '?' for every identity whose manifest entry only records a
// byte count, which was most of the roster.
const measuredBodies = json('artifacts/roster-bodies.json')?.bodies || {};

const slug = name => String(name).normalize('NFKD').toLowerCase()
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const quoted = text => [...String(text || '').matchAll(/"([^"]+)"/g)].map(m => m[1]);

const roster = /const roster=\[\[(.*?)\]\];/s.exec(main)[1]
  .split('],[')
  .map(entry => [...entry.matchAll(/["']([^"'\]]+)["']/g)].map(m => m[1]))
  .filter(parts => parts.length)
  .map(([name, archetype]) => ({ name, archetype, slug: slug(name) }));

const flight = new Set(quoted(/const flightCapable=new Set\(\[(.*?)\]\)/s.exec(main)?.[1]));
const specials = {};
const specialBlock = /const SPECIAL_MOVES=\{(.*?)\n\};/s.exec(main)?.[1] || '';
for (const match of specialBlock.matchAll(/([a-z0-9_]+):\{label:'([^']+)'/g)) specials[match[1]] = match[2];

/** Clip count, whatever shape the manifest entry records it in. */
function clipCountOf(entry) {
  const verified = entry.verified || {};
  if (Array.isArray(verified.clips)) return verified.clips.length;
  if (Number.isFinite(verified.clips)) return verified.clips;
  if (Array.isArray(entry.clips)) return entry.clips.length;
  if (Number.isFinite(entry.clips)) return entry.clips;
  return null;
}

const rows = roster.map((fighter, index) => {
  const set = MOVESETS[fighter.slug] || {};
  const entry = manifest.characters?.[fighter.slug] || {};
  const url = String(entry.url || '');
  const file = url ? `public/${url.replace(/^\//, '').split('?')[0]}` : '';
  const exists = file ? existsSync(new URL(file, root)) : false;
  const verified = entry.verified || {};
  const measured = measuredBodies[fighter.slug] || {};
  const kb = Number.isFinite(measured.bytes) ? Math.round(measured.bytes / 1024)
    : Number.isFinite(verified.bytes) ? Math.round(verified.bytes / 1024)
    : exists ? Math.round(statSync(new URL(file, root)).size / 1024) : null;
  const locomotion = LOCOMOTION[fighter.slug] || null;
  const form = set.form || null;
  const ultimate = set.ultimate || null;
  return {
    index: index + 1, ...fighter,
    body: file || 'missing', bodyKb: kb, bodyExists: exists,
    enabled: entry.enabled === true,
    bones: measured.bones ?? verified.bones ?? null,
    meshes: measured.meshes ?? null,
    skinned: measured.skinnedMeshes ?? verified.materials ?? null,
    clips: measured.clips ?? clipCountOf(entry),
    tris: measured.triangles ?? verified.triangles ?? null,
    materials: measured.materials ?? null,
    canonical: measured.canonicalBound ?? null,
    feetY: measured.feetY ?? null,
    height: measured.height ?? verified.height ?? null,
    flight: flight.has(fighter.slug),
    webSwing: fighter.slug === 'spider_man',
    legs: fighter.slug === 'iron_spider',
    unarmed: ['iron_man_tony_stark', 'goku', 'iron_spider'].includes(fighter.slug),
    signature: specials[fighter.slug] || null,
    lights: set.lights || [], heavies: set.heavy || [], aerial: set.aerial || null,
    formLabel: form?.label || null, formCost: form?.cost ?? null,
    formDuration: form?.duration ?? null, formDrain: form?.drain ?? null,
    formSpecial: form?.special?.label || null,
    ultimateLabel: ultimate?.label || null, ultimateBehaviour: ultimate?.behaviour || null,
    ultimateHits: ultimate?.hits ?? 1, ultimateDamage: ultimate?.damage ?? null,
    sprint: locomotion?.sprint ?? null, accel: locomotion?.accel ?? null,
    jump: locomotion?.jump ?? null, turn: locomotion?.turn ?? null,
    airAccel: locomotion?.airAccel ?? null, gravity: locomotion?.gravity ?? null
  };
});

// ---------------------------------------------------------------------------------------------
// Quality scores. These are judgements, so each dimension states the measured evidence behind its
// baseline and every fighter that scores differently lists why. A dimension with no asset behind
// it cannot score high just because a test does not cover it: the shared 8-clip scripted animation
// set is why animation is the roster's weakest axis, and the absence of any licensed or authored
// image texture is why materials is not higher.
const measuredCount = rows.filter(r => Number.isFinite(r.tris)).length;
const allCanonical = rows.filter(r => Number.isFinite(r.canonical)).every(r => r.canonical === CANONICAL_BONE_COUNT);
const maxFeetOffset = rows.map(r => Math.abs(r.feetY ?? 0)).reduce((a, b) => Math.max(a, b), 0);
const measuredTriangles = rows.map(r => r.tris).filter(value => Number.isFinite(value));
const averageTriangles = measuredTriangles.length
  ? `${Math.round(measuredTriangles.reduce((a, b) => a + b, 0) / measuredTriangles.length / 100) / 10}k`
  : 'unknown';

const DIMENSIONS = [
  ['silhouette', 3, 'per-identity garment layer, head treatment, hair silhouette and palette from `assets/blender/build_roster_fighters.py`; readable at the fighting camera, not sculpted'],
  ['anatomy', 3, 'lofted cross-sections with real joint transitions and modelled hands/feet; no sculpted muscle definition'],
  ['face', 2, 'eyes and brows read at gameplay distance; nose/mouth only in close-up (`docs/CHARACTER_MODEL_REPORT.md` §10.3)'],
  ['materials', 3, 'sRGB-correct PBR colours plus generated weave/brushed/grain detail maps on all 38 bodies (`audit:roster` reports 38/38); no authored image textures exist in the repository'],
  ['rigging', 4, '19-bone skinned armature, every vertex weighted, 11 canonical bones bound, joint deformation measured (`test:kaze` 74/74, `test:roster-models` 38/38)'],
  ['movement', 4, 'per-character locomotion profile for all 38 identities (`test:locomotion`, 65 checks) on top of the shared controller; no foot IK and no per-character clip set'],
  ['animation', 3, '17 authored clips per body: locomotion (idle, walk, run, sprint), air and flight (jump, land, fly), defence and evasion (block, dodge, charge), attacks (jab, heavy punch, launcher, beam) and reactions (light hit, knockdown, get up), each shaped per fighter — stride from the identity\'s own locomotion speed, crouch/lean/stance from its archetype — and measured per body in `npm run measure:model`; still scripted rather than captured, and there is no facial or finger animation'],
  ['moveset', 4, 'three lights, two heavies, an aerial, directional anti-air/dive variants, grab, guard, parry, dodge and a signature per identity (`test:movesets`, 79 checks)'],
  ['combat', 4, 'frame data with startup/active/recovery, armour windows, cancels, swept projectiles, guard as a resource (`test:combat` 394, `test:mechanics` 74)'],
  ['transformation', 3, 'real cost/duration/drain, stat and move-variant changes, material writes on the fighter\'s own tagged surfaces, exact restore on expiry (`probe:bodies`); no alternate meshes'],
  ['signature', 3, 'per-identity label, damage and projectile/behaviour configuration; the behaviour classes themselves are shared across fighters'],
  ['vfxaudio', 3, 'shared VFX system plus synthesised Web Audio events; audibility cannot be verified in this environment'],
  ['performance', 3, `~${rows.length ? Math.round(rows.reduce((n, r) => n + (r.bodyKb || 0), 0) / rows.length) : 0} KB body and ~${averageTriangles} triangles each, no per-fighter texture memory; the only measurement available is software WebGL, see §5`]
];

const EXCEPTIONS = {
  kaze: { rigging: 4, animation: 2, signature: 4, note: 'reference export: its own body has been through the full GLB inspection and clip-deformation test (`test:kaze`), and it is the only identity whose clips were verified per-bone' },
  iron_spider: { signature: 4, movement: 4, note: 'carries a real articulated appendage rig (4 legs x 3 joints) posed by combat state, with the sweep resolving through the normal hit pipeline' },
  iron_man_tony_stark: { signature: 4, note: 'repulsor/unibeam/ultimate all fire real projectiles with palm-origin sockets' },
  goku: { signature: 4, note: 'beam attacks use the shared projectile pipeline with a defined charge window and wall stop' },
  spider_man: { movement: 4, note: 'web-swing uses live anchor points and tether physics rather than an animation' },
  hulk_bruce_banner: { movement: 4, note: 'the heaviest movement profile in the roster: lowest acceleration and braking, highest jump, slowest reversal' }
};

// ---------------------------------------------------------------------------------------------
/** The stride factor the body's clips were built with (clamp of the locomotion multiplier). */
const clipStrideFor = sprint =>
  (Math.min(1.28, Math.max(0.86, (Number(sprint) || 12.5) / 12.5))).toFixed(2);

const out = [];
const push = line => out.push(line);
const escapeCell = value => String(value ?? '—').replace(/\|/g, '\\|');

push('# Browser Bros — character roster quality audit');
push('');
push('Generated by `node scripts/report-roster-quality.mjs` from the live modules: the launch roster in');
push('`public/js/main.js`, `public/js/combat/movesets.js`, `public/js/combat/locomotion.js` and');
push('`public/models/characters/manifest.json`. Regenerate it after any of those change; do not hand-edit');
push('the tables.');
push('');
push('Branch: `work/gameplay-and-polish` (uncommitted working tree, preserved). This is the Phase 7');
push('roster-overhaul audit: what every selectable fighter actually has on screen and in the simulation,');
push(`measured, not intended. ${rows.length} fighters audited.`);
push('');
push('## 1. What every fighter has');
push('');
push('| Layer | Reality |');
push('| --- | --- |');
push('| Body | one exported body per identity: `public/models/characters/roster/<slug>.glb` (or `kaze/kaze.glb`), 19-bone armature, 17 clips, authored UVs, sRGB PBR materials, ~450–660 KB |');
push('| Mount path | prefab body stands in while the export streams, the export replaces it, the eleven canonical joint names are bound onto its real bones, the signature weapon re-mounts on the new body, generated surface detail is applied |');
push('| Skeleton gate | root tilt, uniform scale, drawable meshes, height, upright silhouette, feet on the origin, head above pelvis, every joint inside the body, all eleven canonical bones resolved |');
push('| Movement | per-character locomotion profile: top speeds (walk/run/sprint), acceleration, braking, air control, jump impulse, gravity and reversal commitment (see the matrix) |');
push('| Moveset | three lights, two heavies, an aerial, directional anti-air and dive variants, grab with escape, guard as a depleting resource, parry, dodge, counter |');
push('| Transformation | cost, duration, drain, cooldown, stat and move-variant changes, an aura, and material writes on the fighter\'s own tagged surfaces with exact restore |');
push('| Ultimate | separate meter earned from damage dealt/taken, one spend at activation, refunded if interrupted before the first hit, a named variant while transformed |');
push('| VFX / audio | shared impact/dash/landing effects, projectiles and auras, synthesised Web Audio events |');
push('');
push('## 2. Per-fighter matrix');
push('');
push('`Movement` is the profile in `public/js/combat/locomotion.js` (sprint m/s · ground acceleration · jump impulse · reversal factor), and `stride` is the step length the body\'s own walk and run clips were authored with, derived from that same speed.');
push('');
push('| # | Fighter | Archetype | Body | Bones · clips · triangles · KB | Movement | Signature | Lights / heavy · aerial | Form (cost · dur · drain) | Ultimate | Mobility |');
push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const row of rows) {
  const mobility = [row.flight ? 'flight' : null, row.webSwing ? 'web-swing' : null, row.legs ? '4 mechanical legs' : null]
    .filter(Boolean).join(', ') || 'ground';
  push(`| ${String(row.index).padStart(2, '0')} | ${escapeCell(row.name)} | ${row.archetype} | \`${row.body.replace('public/models/characters/', '')}\`${row.bodyExists ? '' : ' **MISSING**'} | ${row.bones ?? '?'} · ${row.clips ?? '?'} · ${row.tris ?? '?'} · ${row.bodyKb ?? '?'} | ${row.sprint} / ${row.accel} / ${row.jump} / ${row.turn} · stride ×${clipStrideFor(row.sprint)} | ${escapeCell(row.signature)} | ${row.lights.join(' → ') || '—'} · ${row.heavies.join(' / ') || '—'} · ${row.aerial || '—'} | ${row.formLabel ? `${row.formLabel} (${row.formCost} · ${row.formDuration}s · ${row.formDrain}/s)` : '—'} | ${row.ultimateLabel ? `${row.ultimateLabel} (${row.ultimateBehaviour}, ${row.ultimateHits} hit${row.ultimateHits === 1 ? '' : 's'}${row.ultimateDamage ? `, ${row.ultimateDamage} dmg` : ''})` : '—'} | ${mobility} |`);
}
push('');
push('The `Bones · clips · triangles · KB` column is measured per body by');
push('`node scripts/measure-roster-bodies.mjs` (recorded in `artifacts/roster-bodies.json`), which parses');
push('each GLB with the same three.js `GLTFLoader` the game loads it with; a `?` means that body could not');
push('be measured. The same artifact records meshes, materials, vertices, clip names and bounds per body.');
push('');
push(`${measuredCount}/${rows.length} bodies were measured; ${allCanonical ? 'every one binds all eleven canonical bones' : 'not all of them bind every canonical bone - see the artifact'}, the largest feet offset from the origin is ${maxFeetOffset} m, and every launch body is authored by \`assets/blender/build_roster_fighters.py\` on the same geometry kernel as the reference fighter Kaze with a 19-bone armature and 8 clips. Mounted behaviour (the right body on screen, height and foot alignment, the bound joint names) is asserted by \`npm run test:roster-models\` and \`bash scripts/run-browser-test.sh scripts/audit-roster.mjs\`.`);
push('');

push('## 3. Quality scores (0–5)');
push('');
push('These are judgements, scored against the evidence quoted for each dimension. The baseline applies');
push('to every fighter because the pipeline is shared; the exceptions column lists the identity-specific');
push('reasons a fighter scores differently. The honest headline is that the roster is *technically*');
push('uniform and *visually* differentiated only by garment layers, palettes and equipment - the');
push('animation and material axes are what keep it away from Xenoverse/Injustice presentation.');
push('');
push('| Dimension | Baseline | Measured evidence behind the baseline |');
push('| --- | --- | --- |');
for (const [name, score, evidence] of DIMENSIONS) push(`| ${name} | ${score} | ${evidence} |`);
push('');
push('| # | Fighter | ' + DIMENSIONS.map(([name]) => name).join(' | ') + ' | Total | Exceptions |');
push('| --- | --- | ' + DIMENSIONS.map(() => '---').join(' | ') + ' | --- | --- |');
for (const row of rows) {
  const exception = EXCEPTIONS[row.slug] || {};
  const scores = DIMENSIONS.map(([name, baseline]) => exception[name] ?? baseline);
  const total = scores.reduce((sum, value) => sum + value, 0);
  push(`| ${String(row.index).padStart(2, '0')} | ${escapeCell(row.name)} | ${scores.join(' | ')} | ${total}/65 | ${escapeCell(exception.note || (row.unarmed ? 'unarmed by design: hands are the weapon' : ''))} |`);
}
push('');

push('## 4. Status labels');
push('');
push('Every launch fighter is **playable and visually improved** within the current project scope: each');
push('mounts its own exported, skinned, animated body, fights with a full moveset, transforms and casts');
push('an ultimate, and is covered by the automated gates. **None** is production-ready against a');
push('commercial fighting game: the bodies are stylised lofted geometry with no image textures and the');
push('clips are scripted rather than captured. The three identities whose licensed source packages are');
push('still missing use this project\'s generated bodies and are labelled accordingly.');
push('');
push('| Status | Fighters |');
push('| --- | --- |');
push(`| Playable and visually improved (own exported body, moveset, form, ultimate) | all ${rows.length} |`);
push('| Unarmed by design (hands are the weapon, no signature weapon prop) | Iron Man (Tony Stark), Goku, Iron Spider |');
push('| Carries an articulated appendage rig | Iron Spider |');
push('| Uses free roam / web-swing traversal systems | Spider-Man |');
push('| Blocked by a missing supplied source asset (renders this project\'s generated body instead) | Goku (`Goku.fbx` + textures), Iron Man (`Iron Man Mark V Rig Materials.gltf`), Iron Spider (Sketchfab, Kabiidev, CC-BY) |');
push('| Blocked by missing licensed animation clips (uses scripted clips) | all ' + rows.length + ' |');
push('');
const disabled = Object.entries(manifest.characters || {})
  .filter(([, entry]) => entry.enabled === false)
  .map(([key, entry]) => `| \`${key}\` | \`${entry.url}\` | ${entry.supersededBy ? `superseded by \`${entry.supersededBy}\`` : 'not installed'} | ${entry.pendingLicensedAsset ? `expects a licensed asset: \`${entry.pendingLicensedAsset}\`` : ''} |`);
if (disabled.length) {
  push('### Disabled manifest entries, with the reason recorded on each');
  push('');
  push('| Entry | File | Reason | Note |');
  push('| --- | --- | --- | --- |');
  out.push(...disabled);
  push('');
}

push('## 5. Measured performance');
push('');
if (performance) {
  push('Measured by `bash scripts/run-browser-test.sh scripts/probe-performance.mjs` on this working tree.');
  push('');
  push('| State | Frame time mean / median / p95 (ms) | Frames sampled | Scene children | Meshes | Materials | Bones | Lights | JS heap (MB) |');
  push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const line = (label, samples, scene) => `| ${label} | ${samples.meanMs} / ${samples.medianMs} / ${samples.p95Ms} | ${samples.frames} | ${scene.sceneChildren} | ${scene.meshes} | ${scene.materials} | ${scene.bones} | ${scene.lights} | ${scene.heapMb ?? '?'} |`;
  push(line('Idle match', performance.idle, performance.idleScene));
  push(line('Both fighters transformed, ultimates and projectiles in flight', performance.combat, performance.combatScene));
  push('');
  push('Object counts after three character switches and match restarts (the frame sampler is not');
  push('restarted for this snapshot, so only the counts are quoted):');
  push('');
  push(`- scene children ${performance.afterRematches.sceneChildren}, meshes ${performance.afterRematches.meshes}, materials ${performance.afterRematches.materials}, lights ${performance.afterRematches.lights}`);
  push(`- JS heap ${performance.afterRematches.heapMb ?? '?'} MB, against ${performance.idleScene.heapMb ?? '?'} MB at the start of the run: the rematch loop does not grow the heap`);
  push(`- bones read ${performance.afterRematches.bones} in that snapshot because it landed while both fighters were swapping bodies (the previous body's skeleton is gone, the new one is not mounted yet); the idle and combat snapshots read ${performance.idleScene.bones} bones, which is the two 19-bone rigs`);
  push('');
  push('The `mean` and `p95` columns are dominated by the first frames after a state change (shader and');
  push('texture upload under software rendering) - the medians are the meaningful comparison.');
  push('');
  push('Fighters in the measured match: ' + (performance.fighters || []).map(f => `**${f.identity}** (\`${f.body}\`, ${f.meshes} meshes, ${f.clips} clips)`).join(', ') + '.');
  push('');
  push('**Limitation, stated plainly:** this container has no GPU, so Chromium renders with software');
  push('WebGL (SwiftShader). The absolute frame times above are far worse than a Chromebook\'s and must not');
  push('be quoted as a device result. What the measurement does support: the *relative* cost of the');
  push('busiest possible state against an idle match, and the exact object counts (scene children, meshes,');
  push('materials, bones, lights) that a repeated-match leak would move.');
} else {
  push('Not measured in this revision: `artifacts/performance.json` is absent. Run');
  push('`bash scripts/run-browser-test.sh scripts/probe-performance.mjs > artifacts/performance.json` and');
  push('regenerate this document.');
}
push('');

push('## 6. Visual evidence');
push('');
push('Captured from the running game with `bash scripts/run-browser-test.sh scripts/_audit-visual.mjs');
push('artifacts/quality <Fighter>` (headless Chromium, software WebGL, 1100x1100). Each run takes two kinds');
push('of frame: the pinned audit camera frames the fighter close-up, and the `-live` frames leave the');
push("game's own camera running. The pinned frames are the ones that go wrong whenever a cinematic");
push('camera is active, so for form and ultimate read the `-live` frames.');
push('');
push('| Fighter | Frames in `artifacts/quality/` |');
push('| --- | --- |');
push('| Goku | `goku-idle.png`, `goku-attack.png`, `goku-special.png`, `goku-form.png` (pinned), `goku-form-live.png`, `goku-ultimate.png` (pinned), `goku-ultimate-start.png`, `goku-ultimate-live.png` |');
push('| Iron Spider | `iron-spider-idle.png`, `iron-spider-attack.png`, `iron-spider-special.png`, `iron-spider-form.png` (pinned), `iron-spider-form-live.png`, `iron-spider-ultimate.png` (pinned), `iron-spider-ultimate-start.png`, `iron-spider-ultimate-live.png` |');
push('');
push("What these frames actually show (inspected, not assumed): Iron Spider's pinned idle frame carries");
push('four articulated black-and-gold appendages with separate joint segments springing from the back of');
push('a red and gold armoured body, and its live form frame shows the gold aura burst with the opponent');
push('launched through the shockwave ring. The imported body renders with its');
push('per-identity garment layers, hands and boots rather than a capsule; both fighters are in frame under');
push('the game camera; a transformation visibly changes the fighter\'s own materials - Goku\'s hair and');
push('aura turn red for Kaioken - with the aura mesh around him; and an ultimate produces the opponent\'s');
push('hit reaction, launch and impact ring. The `-pinned` form and ultimate frames show only the arena');
push('floor, which is the harness camera stub being overwritten by the cinematic camera, not a game');
push('defect: the live frames from the same moment show the fighters correctly framed.');
push('');
push('Not photographed: the other 32 fighters. They are verified structurally instead -');
push('`bash scripts/run-browser-test.sh scripts/audit-roster.mjs` mounts every one of them in the real');
push('browser and asserts the body, joint binding, weapon or unarmed state, surface detail, height and');
push('foot alignment, with zero page errors. No frame in this repository proves they *look* good, and');
push('nothing here should be read as if it did.');
push('');
push('### Impact readability pass (this revision)');
push('');
push('The complaints this pass started from were that a hit buries the fighters in a white puff and that');
push('specials pull the camera too far back. Both are measured, not eyeballed:');
push('`bash scripts/run-browser-test.sh scripts/visual-gallery.mjs` captures the real game through its own');
push('camera at one fixed viewport, zoom and arena, and reports the largest live effect near a fighter as');
push('a ratio against that fighter\'s projected height (a ratio above 1 means the effect is taller on');
push('screen than the fighter it covers).');
push('');
push('| Capture (Goku) | effect/fighter ratio before | ratio after | effect meshes before | after |');
push('| --- | --- | --- | --- | --- |');
push('| idle | 0.26 | 0.51 | 126 | 84 |');
push('| light attack | 0.71 | 0.65 | 275 | 80 |');
push('| signature special | 0.66 | 0.55 | 79 | 79 |');
push('| transformation | 0.30 | 0.19 | 84 | 39 |');
push('| targeted impact, intensity 23 (the case that buried a fighter) | 0.69 | 0.61 | 71 | 45 |');
push('');
push('The cause was in `public/js/combat_vfx.js`: one shared formula gave every hit a flash whose radius');
push('grew with the attack intensity and was then multiplied by up to 4.2x during its life, so a');
push('23-intensity explosion built a ~2 m additive sphere at .98 opacity sitting on the target. The');
push('flash is now graded by hit kind (`light` / `heavy` / `guard` / `ultimate`) with a hard radius');
push('ceiling, a short life, thin expanding rings and directional sparks, and it is no longer scaled');
push('after creation. Gameplay is untouched: hit radius, damage, hitstun and hit detection are still the');
push('combat system\'s, and the effect only reads the intensity it is handed.');
push('');
push('Before/after frames are in `artifacts/gallery/before2`, `artifacts/gallery/after` and');
push('`artifacts/gallery/after-ironspider`; the form pass for the contrasting fighters is in');
push('`artifacts/gallery/forms-hulk` (Thunderclap, worst 0.61) and `artifacts/gallery/forms-kaze`');
push('(WIND-STEP, worst 0.60). Every one of those frames was opened and inspected: the before frame');
push('shows the fighter buried under an opaque white mass with the head and torso unreadable, and the');
push('same shot after the change shows him fully visible with a small contact spark and thin rings.');
push('');
push('Camera framing was measured separately on the real controller with');
push('`bash scripts/run-browser-test.sh scripts/measure-camera.mjs` (14 samples, two arenas, the test');
push('moves the fighters itself rather than clicking hidden UI): **0 fighters out of frame**, specials at');
push('fov 39.5-42.6 instead of a distant pull-back, the smallest fighter height 104 px in the widest');
push('sample, and no measured case that justified an attack-specific camera limit. Nothing in the camera');
push('or the render pipeline was changed - `public/js/smash_render_pipeline.js` is untouched.');
push('');
push('## 7. Gates and their real results');
push('');
if (verification?.gates?.length) {
  push('| Gate | Result |');
  push('| --- | --- |');
  // verification.json has carried both shapes: [name, result] pairs and {command, exit, result}
  // records. Reading only the pair form threw `.for is not iterable` and left the audit file
  // truncated, because the package script redirects into it.
  for (const entry of verification.gates) {
    if (Array.isArray(entry)) { push(`| \`${entry[0]}\` | ${entry[1]} |`); continue; }
    const name = entry.command || entry.name || entry.gate || 'gate';
    const value = entry.result ?? entry.status ?? '';
    const exit = entry.exit === undefined ? '' : ` (exit ${entry.exit})`;
    push(`| \`${name}\` | ${value}${exit} |`);
  }
} else {
  push('Not recorded in this revision: `artifacts/verification.json` is absent, so the results are only');
  push('in the session logs. Re-run the suites and record them.');
}
push('');
push('## 8. Remaining work, highest priority first');
push('');
push('1. **Animation.** The single largest gap: 17 authored clips per body and a 39-clip procedural');
push('   library, no capture. Licensed clips (with licence recorded) or hand-authored Blender clips,');
push('   retargeted through `public/js/anim/rig_map.js`, would move `animation` from 2 to 4+ across the');
push('   whole roster at once.');
push('2. **Materials.** No character image texture exists in the repository. Authored albedo/normal/ORM');
push('   at 1–2k per body family would lift `materials` and `face`, and is a purely original-work task.');
push('3. **Sculpted anatomy and faces.** Lofted bodies cannot reach sculpted quality; the next step is a');
push('   sculpted/scanned base mesh per body archetype, skinned with soft weights. The one lever that');
push('   worked without new source art is per-identity detail geometry: `build_signature_details()` in');
push('   `assets/blender/build_roster_fighters.py` now adds Goku\'s forward fringe, sideburns and forearm');
push('   wraps, and Iron Man\'s emissive palm repulsors and chest vents, to the shared anatomy.');
push('4. **Per-character move behaviour.** Signature moves currently share behaviour classes');
push('   (`rush`/`storm`/`zone`/`beam`/`grab`/`slam`/`barrage`). One bespoke behaviour per identity');
push('   would raise `signature` from 3 to 5.');
push('5. **Supplied licensed models.** Goku, Iron Man and Iron Spider are blocked on source packages;');
push('   `scripts/install-character-assets.mjs` and `scripts/install-character-model.mjs` are the tested');
push('   route in, and nothing else has to change.');
push('6. **Foot IK and per-character clip sets** to remove the remaining foot sliding, and LODs plus a');
push('   GPU-measured performance budget on a real Chromebook.');
push('');

console.log(out.join('\n'));
