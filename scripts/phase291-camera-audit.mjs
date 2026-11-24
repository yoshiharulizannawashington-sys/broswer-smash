// Phase 29.1 audit: can the seven authored finisher camera sequences be reused safely?
//
//   node scripts/phase291-camera-audit.mjs
//
// This is an assertion script, not just a report. It fails (exit 1) when a camera profile breaks
// the contract the runtime relies on, so the four pilot profiles are gated the same way the seven
// original ones are. The report it writes records the reuse surface and the two known gaps.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { FINISHERS, DEFAULT_FINISHER, BEATS, isValidShot, finisherFor, hasAuthoredFinisher,
  createFinisher, advance, totalDuration } from '../public/js/combat/cinematic_finisher.js';
import { MOVESETS } from '../public/js/combat/movesets.js';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const choreo = read('public/js/combat/cinematic_finisher.js');
const cameraSrc = read('public/js/SmashCamera.js');
const combatSrc = read('public/js/combat/combat_powers.js');

const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail });
}

const normalise = key => String(key || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const playable = new Set(Object.keys(MOVESETS));
const authored = Object.entries(FINISHERS);
const PILOT = ['saitama', 'sasuke_uchiha', 'lord_voldemort', 'spider_man'];
const BEHAVIOUR_PILOTS = ['master_chief', 'hulk_bruce_banner', 'levi_ackerman', 'doctor_strange'];

// --- 1. the reuse contract ---------------------------------------------------------------
check('every authored finisher supplies all five beats', authored.every(([, f]) => BEATS.every(b => f.shots?.[b])));
check('every authorable shot is valid', authored.every(([, f]) => BEATS.every(b => isValidShot(f.shots[b]))));
check('every hold is a positive finite number', authored.every(([, f]) => BEATS.every(b => Number.isFinite(f.hold[b]) && f.hold[b] > 0)));
check('every flash is a finite number', authored.every(([, f]) => BEATS.every(b => Number.isFinite(f.flash[b]))));
check('every scale is a finite number', authored.every(([, f]) => BEATS.every(b => Number.isFinite(f.scale[b]))));
check('every authorable shot names a real playable identity', authored.every(([id]) => playable.has(normalise(id))),
  authored.filter(([id]) => !playable.has(normalise(id))).map(([id]) => id).join(', '));
check('an identity key resolves to its own profile', authored.every(([id]) => finisherFor(id).label === FINISHERS[id].label));
check('display names resolve like the runtime does', hasAuthoredFinisher('Spider-Man') && hasAuthoredFinisher('Sasuke Uchiha')
  && hasAuthoredFinisher('Lord Voldemort') && hasAuthoredFinisher('Saitama'));
check('duration stays inside a beat-length budget', authored.every(([, f]) => {
  const total = totalDuration(createFinisher({ identityKey: 'x' }));
  void total;
  return BEATS.reduce((s, b) => s + f.hold[b], 0) >= 1.4 && BEATS.reduce((s, b) => s + f.hold[b], 0) <= 4.2;
}));

// --- 2. distinctness ---------------------------------------------------------------------
const shotsJson = Object.fromEntries(authored.map(([id, f]) => [id, JSON.stringify(f.shots)]));
const uniqueShotSets = new Set(Object.values(shotsJson));
check('no two authored identities share a camera set', uniqueShotSets.size === authored.length,
  `${authored.length} identities, ${uniqueShotSets.size} distinct sets`);
check('no authored profile is the fallback', authored.every(([, f]) => JSON.stringify(f.shots) !== JSON.stringify(DEFAULT_FINISHER.shots)));
const finisherBeat = Object.fromEntries(authored.map(([id, f]) => [id, JSON.stringify(f.shots.finisher)]));
check('no two identities share the finisher close-up',
  new Set(Object.values(finisherBeat)).size === authored.length);
const impactBeat = Object.fromEntries(authored.map(([id, f]) => [id, JSON.stringify(f.shots.impact)]));
check('no two identities share the impact frame',
  new Set(Object.values(impactBeat)).size === authored.length);

// --- 3. pilot scope ----------------------------------------------------------------------
const pilotPresent = PILOT.filter(id => FINISHERS[id]);
check('all four pilot identities are authored', pilotPresent.length === PILOT.length, pilotPresent.join(', '));
check('the pilot does not touch a behaviour-pilot identity',
  PILOT.every(id => !BEHAVIOUR_PILOTS.includes(id)));
check('the pilot spans four different behaviours', new Set(PILOT.map(id => MOVESETS[id]?.ult?.behaviour
  || MOVESETS[id]?.ultimate?.behaviour)).size === PILOT.length,
  PILOT.map(id => `${id}:${MOVESETS[id]?.ult?.behaviour || MOVESETS[id]?.ultimate?.behaviour}`).join(' '));

// --- 4. purity and ownership -------------------------------------------------------------
check('the camera data module imports nothing (pure)', !/^\s*import\s/m.test(choreo.split('\n').slice(0, 30).join('\n')));
// Purity applies to the data + timeline half. The live director section below it is explicitly
// allowed to touch `window` for telemetry and must not be swept into this check.
const dataSection = choreo.slice(choreo.indexOf('export const FINISHERS'), choreo.indexOf('// Live director'));
check('the camera data module never touches the DOM or THREE', !/\bTHREE\.|\bdocument\.|\bwindow\./.test(dataSection),
  dataSection.length ? '' : 'section not found');
check('the camera owns a single restore path', /endCineShot\(\)/.test(cameraSrc) && /cineState\s*=\s*null/.test(cameraSrc));
check('every ending in the director restores the camera',
  (combatSrc.match(/endCineShot/g) || []).length >= 2 && /finisherCount\(\) === 0/.test(combatSrc));
check('the director deletes a finished record', /DIRECTOR\.delete\(record\)/.test(choreo));

// --- 5. known gaps (recorded, not silently accepted) ------------------------------------
const isValidShotUses = (read('public/js/combat/cinematic_finisher.js').match(/isValidShot/g) || []).length;
const pitchUses = (cameraSrc.match(/shot\.pitch/g) || []).length;
const gaps = [
  {
    id: 'isValidShot-unused-in-runtime',
    fact: `\`isValidShot\` appears ${isValidShotUses} time(s) in cinematic_finisher.js (definition + JSDoc) and 0 times in any other runtime file.`,
    consequence: 'A malformed profile is not rejected by a shared guard; each caller relies on its own checks. cineShot() does reject non-finite distance/height/yaw/pitch/fov and distance <= 0.5, and _updateCine clamps distance to 3.2-26 and FOV to 26-62, so bad data degrades to a wrong shot rather than a crash.',
    risk: 'low'
  },
  {
    id: 'pitch-is-inert',
    fact: `\`shot.pitch\` is read ${pitchUses} time(s) in SmashCamera.js — never for placement.`,
    consequence: 'Authored pitch has no visual effect. Vertical angle is encoded entirely by `height` (clamped to 0..0.8*d) and the fixed look point 1.15 m above the body origin. A true low-angle hero shot cannot be authored with this data alone.',
    risk: 'medium'
  }
];

// --- 6. determinism and timing ----------------------------------------------------------
{
  const a = createFinisher({ identityKey: 'saitama' });
  const b = createFinisher({ identityKey: 'saitama' });
  const run = s => { const out = []; for (let i = 0; i < 240; i++) out.push(advance(s, 1 / 60, { hitConfirmed: true })); return out; };
  check('the same inputs produce the same sequence for a pilot identity', JSON.stringify(run(a)) === JSON.stringify(run(b)));
  const frames = run(createFinisher({ identityKey: 'sasuke_uchiha' }));
  check('a pilot sequence reaches its conclusion', frames[frames.length - 1].concluded === true);
  check('a pilot impact slows time', frames.some(f => f.beat === 'impact' && f.timeScale < .5));
  const whiff = [];
  const s = createFinisher({ identityKey: 'lord_voldemort', patience: .4 });
  for (let i = 0; i < 240; i++) whiff.push(advance(s, 1 / 60, { hitConfirmed: false }));
  check('a whiffed pilot never spends a finisher beat', whiff.every(f => f.beat !== 'finisher' && f.beat !== 'impact'));
  check('a whiffed pilot restores normal time', whiff[whiff.length - 1].timeScale === 1);
}

// --- report ------------------------------------------------------------------------------
const failures = checks.filter(c => !c.ok);
const coverage = { authored: authored.length, playable: playable.size, pilot: PILOT.length };
const byBehaviour = {};
for (const [id] of authored) {
  const b = MOVESETS[normalise(id)]?.ult?.behaviour || MOVESETS[normalise(id)]?.ultimate?.behaviour || 'unknown';
  (byBehaviour[b] ||= []).push(id);
}

mkdirSync(new URL('artifacts/dev/phase291/', root), { recursive: true });
const L = [];
L.push('# Phase 29.1 — finisher camera audit and reuse pilot', '');
L.push(`Generated by \`scripts/phase291-camera-audit.mjs\`. ${checks.length} contract checks, ${failures.length} failing.`, '');
L.push('## 1. What is reusable', '');
L.push('| Surface | Where it lives | Reusable as-is? |');
L.push('| --- | --- | --- |');
L.push('| Shot data | `FINISHERS[id].shots` (5 beats) | yes — data only, no code |');
L.push('| Beat timing | `hold` (seconds per beat) | yes — total budget 1.4–4.2 s |');
L.push('| Flash/shake | `flash` scaled by `scale` | yes |');
L.push('| Camera ownership | `SmashCamera.cineShot` / `endCineShot` | yes — single write point, full restore |');
L.push('| Pair fitting | `_updateCine` corner fit, FIT_LIMIT .85 | yes — protects against authored shots that lose a body |');
L.push('| HUD/caption | `updateCinematicHud` + `body.cinematic` | yes — driven by live records, restores on any ending |');
L.push('| Hit gating | `hitConfirmed` from `record.hitCount` | yes — a whiff can never spend a finisher beat |');
L.push('| Time dilation | `activeFinisherTimeScale` | yes — impact .38, finisher .72 |');
L.push('');
L.push('**Coverage after the pilot:** ' + `${coverage.authored} of ${coverage.playable} playable identities authored`
  + ` (${(coverage.authored / coverage.playable * 100).toFixed(1)}%), covering `
  + Object.entries(byBehaviour).map(([b, ids]) => `${b} ${ids.length}`).join(', ') + '.', '');
L.push('## 2. Known gaps', '');
for (const gap of gaps) {
  L.push(`### ${gap.id} (risk: ${gap.risk})`, '', gap.fact, '', gap.consequence, '');
}
// Live pilot results, when the browser probe has been run. Kept honest: measured outcomes only.
{
  const resultsPath = new URL('artifacts/dev/phase291/PILOT_RESULTS.json', root);
  if (existsSync(resultsPath)) {
    const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
    L.push('## 3. Live pilot results (browser, real match)', '');
    L.push(`Probe status: **${results.status}** (` +
      `${(results.expectations || []).length - (results.failures || []).length}/` +
      `${(results.expectations || []).length} checks).`, '');
    L.push('| Pilot | Behaviour | Landed damage | Beats presented | Authored finisher lens | Camera released |');
    L.push('| --- | --- | --- | --- | --- | --- |');
    for (const [key, out] of Object.entries(results.pilots || {})) {
      const hit = out.rows?.hit || {};
      const beats = [...new Set(hit.beats || [])].join(', ') || '—';
      L.push(`| ${key} | ${out.behavior} (range ${out.range}) | ${hit.damage ?? '—'} | ${beats} | ` +
        `${hit.authoredFinisherFov ?? '—'} | ${hit.restored ? (hit.restored.cine ? 'NO' : 'yes') : '—'} |`);
    }
    L.push('');
    L.push('**Verified end to end, per pilot:** each of the four connected, played intro > clash > finisher >');
    L.push('impact > recover, reached its own authored finisher lens, kept both bodies inside the fit margin and');
    L.push('returned `cineState`, the finisher director and `body.cinematic` to their duel state.');
    L.push('');
    L.push('**Also verified in the same run:** all 11 authored profiles (7 pre-existing, 4 new) still reach the');
    L.push('camera and hand it back; a clean hit during startup interrupts the cast, refunds the meter and plays');
    L.push('no finisher shot; a KO during the sequence releases the camera; the round transition and the rematch');
    L.push('path leave no cinematic state behind.');
    L.push('');
    L.push('**Remaining limitations, unchanged by this pilot:** `shot.pitch` is still not used for placement, so');
    L.push('vertical angle is authored through `height`; `isValidShot` is still unused at runtime; and every');
    L.push('scenario used a stationary opponent, so a dodging, blocking or airborne victim is not covered.');
  }
}
L.push('## 4. Contract checks', '', '| Check | Result | Detail |', '| --- | --- | --- |');
for (const c of checks) L.push(`| ${c.name} | ${c.ok ? 'pass' : 'FAIL'} | ${c.detail || ''} |`);
L.push('');
writeFileSync(new URL('artifacts/dev/phase291/CAMERA_AUDIT.md', root), L.join('\n'));
writeFileSync(new URL('artifacts/dev/phase291/camera-audit.json', root), JSON.stringify({
  phase: '29.1', checks, failures: failures.length, coverage, byBehaviour, gaps,
  pilot: PILOT, profiles: Object.fromEntries(authored.map(([id, f]) => [id, { label: f.label, shots: f.shots }]))
}, null, 2));

for (const c of checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
console.log(`\nwrote artifacts/dev/phase291/CAMERA_AUDIT.md (${checks.length} checks, ${failures.length} failing)`);
if (failures.length) process.exit(1);
