// Assertions for the cinematic finisher timeline.
import { BEATS, FINISHERS, finisherFor, hasAuthoredFinisher, createFinisher, advance, totalDuration, isValidShot,
  beginFinisher, stepFinishers, finisherCount, clearFinishers } from '../public/js/combat/cinematic_finisher.js';

let checks = 0;
const failures = [];
function check(name, condition, detail = '') {
  checks++;
  if (condition) { console.log(`  ok  ${name}`); return; }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

const run = (state, seconds, opts = {}) => {
  const frames = [];
  const steps = Math.round(seconds / (1 / 60));
  for (let i = 0; i < steps; i++) frames.push(advance(state, 1 / 60, opts));
  return frames;
};

console.log('\n[authored choreography]');
check('Goku has authored finisher beats', hasAuthoredFinisher('Goku'));
check('Iron Man has authored finisher beats', hasAuthoredFinisher('Iron Man (Tony Stark)'));
check('an unhyped identity falls back rather than failing', !hasAuthoredFinisher('Mario') && finisherFor('Mario').label === 'FINISHER');
check('identities are normalised like the rest of the codebase', hasAuthoredFinisher('iron man (tony stark)'));
check('each authored finisher has all five camera setups',
  Object.values(FINISHERS).every(f => BEATS.every(b => isValidShot(f.shots[b]))));
check('Goku and Iron Man do not share a camera move',
  JSON.stringify(FINISHERS.goku.shots) !== JSON.stringify(FINISHERS.iron_man_tony_stark.shots));
check('every hold and flash value is a finite positive number',
  Object.values(FINISHERS).every(f => BEATS.every(b => Number.isFinite(f.hold[b]) && f.hold[b] > 0 && Number.isFinite(f.flash[b]))));

console.log('\n[beat order and timing]');
{
  const state = createFinisher({ identityKey: 'Goku' });
  const frames = run(state, 6, { hitConfirmed: true });
  const order = [];
  for (const f of frames) if (order[order.length - 1] !== f.beat) order.push(f.beat);
  check('beats play in order', BEATS.every((b, i) => order[i] === b), order.join(' > '));
  check('the sequence concludes', frames[frames.length - 1].concluded === true);
  const total = totalDuration(createFinisher({ identityKey: 'Goku' }));
  check('total duration matches the authored holds', Math.abs(total - 2.75) < 1e-6, String(total));
  check('no frame produces an invalid camera', frames.every(f => isValidShot(f.camera)));
  check('impact slows time down', frames.some(f => f.beat === 'impact' && f.timeScale < .5));
}

console.log('\n[hit-confirmation gate]');
{
  const state = createFinisher({ identityKey: 'Goku', patience: .4 });
  const frames = run(state, 4, { hitConfirmed: false });
  check('a whiffed ultimate never reaches the finisher shots', frames.every(f => f.beat !== 'finisher' && f.beat !== 'impact'));
  check('a whiffed ultimate reports itself as whiffed', frames[frames.length - 1].whiffed === true);
  // The intro/clash flashes are legitimate: they fire on the cast, hit or miss. What must never
  // happen is a finisher-beat flash without a hit.
  check('a whiffed ultimate never flashes a finisher beat',
    frames.filter(f => f.beat === 'finisher' || f.beat === 'impact').length === 0);
  check('the sequence stops flashing once it has given up',
    frames.filter(f => f.whiffed).every(f => f.flash === 0));
  check('a whiffed ultimate restores normal time', frames[frames.length - 1].timeScale === 1);
}
{
  const state = createFinisher({ identityKey: 'Goku' });
  const frames = run(state, 4, { hitConfirmed: false });
  const beforeHit = frames.length;
  check('without a target the sequence gives up', frames[frames.length - 1].whiffed === true && beforeHit > 0);
}
{
  // Confirm on the frame the runner reports the hit, part-way through.
  const state = createFinisher({ identityKey: 'Iron Man (Tony Stark)' });
  const first = run(state, .7, { hitConfirmed: false });
  check('still in the cast beats before the hit', first.every(f => f.beat === 'intro' || f.beat === 'clash'));
  const after = run(state, 3, { hitConfirmed: true });
  check('a confirmed hit unlocks the finisher beats', after.some(f => f.beat === 'finisher'));
  check('the impact carries the largest flash', after.filter(f => f.beat === 'impact').every(f => f.flash >= .9));
}

console.log('\n[determinism]');
{
  const a = createFinisher({ identityKey: 'Goku' });
  const b = createFinisher({ identityKey: 'Goku' });
  const fa = run(a, 3, { hitConfirmed: true });
  const fb = run(b, 3, { hitConfirmed: true });
  check('the same inputs produce the same sequence', JSON.stringify(fa) === JSON.stringify(fb));
  const big = advance(createFinisher({ identityKey: 'Goku' }), 5, { hitConfirmed: true });
  check('a huge frame step cannot skip beats out of order', BEATS.includes(big.beat));
  const bad = advance(createFinisher({ identityKey: 'Goku' }), NaN, {});
  check('a NaN step does not corrupt the beat', BEATS.includes(bad.beat));
}

console.log('\n[live director]');
{
  clearFinishers();
  const calls = { focus: 0, impact: 0, hitStop: 0 };
  const camera = { focus: () => calls.focus++, impact: () => calls.impact++ };
  const record = { owner: { identityKey: 'goku' }, hitCount: 0, target: {} };
  beginFinisher(record);
  check('a cast starts exactly one finisher', finisherCount() === 1);
  for (let i = 0; i < 180; i++) stepFinishers(1 / 60, { camera, hitStop: () => calls.hitStop++ });
  check('a whiffed cast ends without an impact', calls.impact === 0 && finisherCount() === 0);
  check('a whiffed cast still gave the camera its opening beats', calls.focus > 0);
}
{
  clearFinishers();
  const calls = { focus: 0, impact: 0, hitStop: 0 };
  const camera = { focus: () => calls.focus++, impact: () => calls.impact++ };
  const record = { owner: { identityKey: 'iron_man_tony_stark' }, hitCount: 2, target: {} };
  beginFinisher(record);
  const events = [];
  for (let i = 0; i < 300; i++) events.push(...stepFinishers(1 / 60, { camera, hitStop: () => calls.hitStop++ }));
  check('a landed cast reaches the impact beat', events.some(e => e.beat === 'impact' && e.impact === true));
  check('the impact requests hit-stop exactly once', calls.hitStop === 1, String(calls.hitStop));
  check('the camera is reframed as beats change', calls.focus >= 4, String(calls.focus));
  check('the director empties itself when the sequence ends', finisherCount() === 0);
  check('the sequence concludes rather than looping', events.some(e => e.concluded));
}
{
  clearFinishers();
  const record = { owner: { identityKey: 'goku' }, hitCount: 1, target: {} };
  beginFinisher(record);
  const noCamera = [];
  for (let i = 0; i < 300; i++) noCamera.push(...stepFinishers(1 / 60, {}));
  check('the director survives a headless run with no camera', noCamera.length > 0 && finisherCount() === 0);
}

console.log('');
if (failures.length) {
  console.log(`${failures.length} failure(s):`);
  failures.forEach(f => console.log(` - ${f}`));
  process.exit(1);
}
console.log(`${checks} cinematic-finisher checks passed`);
