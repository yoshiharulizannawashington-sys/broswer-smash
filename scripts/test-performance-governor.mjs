// Governor test: frame pacing must lower quality only on sustained shortfall, only one step at a
// time, never below Low, and never against an explicit player choice.
//
// Frames are fed by hand, so the timing here is exact and does not depend on the host.
//
//   node scripts/test-performance-governor.mjs
import assert from 'node:assert/strict';
import { createPerformanceGovernor } from '../public/js/render/performance_governor.js';

let checks = 0;
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  checks++;
  console.log(`  ok  ${name}`);
}

/** Feed `count` frames of `frameMs` each, starting at `at`, and collect any suggestion. */
function feed(governor, { at, count, frameMs }) {
  let now = at;
  const suggestions = [];
  for (let i = 0; i < count; i++) {
    now += frameMs;
    const result = governor.sample(now);
    if (result) suggestions.push(result);
  }
  return { suggestions, at: now };
}

function make(preset, extra = {}) {
  return createPerformanceGovernor({ autoStart: false, getCurrentPreset: () => preset, ...extra });
}

// ---- A healthy machine is left alone -----------------------------------
{
  const governor = make('high');
  const run = feed(governor, { at: 0, count: 600, frameMs: 16.7 });
  check('60 fps produces no suggestion', run.suggestions.length === 0);
  check('the measured rate is reported', governor.fps >= 58, String(governor.fps));
}

// ---- Sustained low frame rate steps down exactly one level --------------
{
  const governor = make('high');
  feed(governor, { at: 0, count: 60, frameMs: 16.7 }); // warm-up at full speed
  const run = feed(governor, { at: 60 * 16.7, count: 400, frameMs: 33 });
  check('a sustained 30 fps run produces a suggestion', run.suggestions.length >= 1);
  check('High is lowered to Medium, not straight to Low',
    run.suggestions[0]?.suggestedPreset === 'medium', run.suggestions[0]?.suggestedPreset);
  check('the suggestion carries the measured fps', run.suggestions[0]?.fps < 45);
  check('a suggestion is cooldown-limited', run.suggestions.length === 1, String(run.suggestions.length));
}

// ---- It never goes below Low ------------------------------------------
{
  const governor = make('low');
  feed(governor, { at: 0, count: 60, frameMs: 16.7 });
  const run = feed(governor, { at: 1000, count: 500, frameMs: 50 });
  check('Low is the floor: nothing below it is suggested', run.suggestions.length === 0);
  check('the floor is reported as low', governor.describe().ladder[0] === 'low');
}

// ---- Manual choice is respected ---------------------------------------
{
  const governor = make('ultra', { manual: true });
  feed(governor, { at: 0, count: 60, frameMs: 16.7 });
  const run = feed(governor, { at: 1000, count: 400, frameMs: 40 });
  check('a manual player still gets a measurement', run.suggestions.length === 1);
  check('but the suggestion is marked as offered, not applied', run.suggestions[0].autoApply === false);
  check('and it records that the choice was manual', run.suggestions[0].manual === true);
  governor.setManual(false);
  check('manual mode can be cleared', governor.manual === false);
}

// ---- Warm-up and settling --------------------------------------------
{
  const governor = make('ultra');
  // Everything below arrives inside the warm-up window: no verdict yet.
  const early = feed(governor, { at: 0, count: 40, frameMs: 60 });
  check('shortfalls during warm-up do not trigger a downgrade', early.suggestions.length === 0);
  const after = feed(governor, { at: early.at, count: 300, frameMs: 60 });
  check('once warmed up the same shortfall does', after.suggestions.length >= 1);
  const immediatelyAfter = feed(governor, { at: after.at, count: 200, frameMs: 60 });
  check('after a suggestion the governor pauses before judging again',
    immediatelyAfter.suggestions.length === 0);
}

// ---- Backgrounded tabs cannot trigger a downgrade ----------------------
{
  const governor = make('high');
  feed(governor, { at: 0, count: 60, frameMs: 16.7 });
  governor.sample(5000); // one enormous gap
  const run = feed(governor, { at: 5000, count: 120, frameMs: 16.7 });
  check('a single huge gap is ignored', run.suggestions.length === 0);
}

// ---- Applied presets are re-evaluated, not re-suggested ----------------
{
  const governor = make('high');
  feed(governor, { at: 0, count: 60, frameMs: 16.7 });
  const first = feed(governor, { at: 1000, count: 400, frameMs: 33 });
  check('first downgrade is offered', first.suggestions[0]?.suggestedPreset === 'medium');
  governor.noteApplied('medium');
  // Even after the cooldown, High must not be suggested again for the same reason.
  const later = feed(governor, { at: first.at + 25_000, count: 400, frameMs: 33 });
  check('the same source level is not suggested twice',
    later.suggestions.every(s => s.from !== 'high'), JSON.stringify(later.suggestions.map(s => s.from)));
}

check('history is recorded for diagnostics', make('high').history.length === 0);
console.log(`\nPerformance governor checks passed (${checks} checks).`);
