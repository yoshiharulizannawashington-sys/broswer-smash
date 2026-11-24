// Build the accepted-rig table for the grounded foot-plant layer.
//
//   bash scripts/run-browser-test.sh scripts/probe-grounded-locomotion-roster.mjs --acceptance=off --tag=acceptance
//   node scripts/build-foot-acceptance.mjs artifacts/grounded-locomotion/acceptance.json
//
// A rig is accepted only when every supplied sweep run measured a walk/run clip with enough
// ankle and visible-foot contact, all three foot contact regions, no raised planted foot, a
// settled sample below the slide ceiling, and bounded floor penetration, planted yaw and
// screen-space foot slip. The same run must also show start, stop, pivot, landing, strafe,
// slope and stair traversal with foot support; see scenarioFailures below for those checks.
// A rig that passes one run and fails another, or is missing from a run, is omitted. The runtime
// gate fails closed: unlisted and unknown identities keep their authored clip feet.
//
// The raised-plant check uses falsePlantedRaised, which covers every contact against the lower of
// the idle and walk floors. It already subsumes the settled and walk-floor variants, so checking
// all three would count the same raised foot more than once.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const inputs = process.argv.slice(2);
if (!inputs.length) {
  console.error('usage: node scripts/build-foot-acceptance.mjs <sweep-report.json> [...]');
  process.exit(1);
}

const MIN_CONTACT_FRAMES = 12;
const MIN_CONTACT_RATIO = 0.05;
const MAX_SETTLED_TRAVEL = 0.020;
// Visible-foot evidence. Each region must touch at least once, because a foot that only ever
// contacts with the toe or heel is visibly not planted even when its ankle report looks settled.
const MIN_FOOT_CONTACT_FRAMES = 12;
const MIN_FOOT_CONTACT_RATIO = 0.03;
const MIN_CONTACT_REGIONS = 3;
// Penetration is measured from the three footprint points against the rig's floor. The mean
// catches a foot that spends its stance below the floor; the max catches a single deep spike.
const MAX_FLOOR_PENETRATION_MEAN = 0.030;
const MAX_FLOOR_PENETRATION = 0.080;
// Yaw and screen slip are measured from the same planted footprint. Slip is in pixels at the
// 960x600 sweep viewport, so it reflects what the camera actually shows rather than world travel.
const MAX_PLANTED_YAW_MEAN = 6;
const MAX_PLANTED_YAW = 30;
const MAX_SCREEN_SLIP_MEAN = 40;
const MAX_SCREEN_SLIP = 150;

// Transition and terrain scenarios. Each window is short and intentionally measured on the real
// input/ground path, so these minimums are about presence and support, not about matching the
// full walk's contact coverage. Pivot yaw is deliberately exempt: turning the planted foot is
// the point of the pivot. Stair risers also make max penetration meaningless at the toe edge;
// the stair check uses mean penetration across the whole climb.
const MIN_SCENARIO_FRAMES = 12;
const MIN_SCENARIO_FOOT_CONTACT = 6;
const MIN_SCENARIO_SUPPORT_FRAMES = 6;
const MAX_SCENARIO_PENETRATION = 0.080;
const MAX_LANDING_PENETRATION = 0.090;
const MAX_STRAFE_YAW_MEAN = 6;
const MAX_STRAFE_SLIP_MEAN = 40;
const MAX_STRAFE_SLIP = 150;
const MIN_SLOPE_RISE = 0.50;
const MIN_SLOPE_FRAMES = 24;
const MIN_SLOPE_FOOT_CONTACT = 8;
const MIN_SLOPE_SUPPORT_FRAMES = 10;
const MAX_SLOPE_PENETRATION_MEAN = 0.120;
const MIN_STAIRS_FRAMES = 40;
const MIN_STAIRS_RISE = 0.80;
const MIN_STAIRS_TREADS = 2;
const MIN_STAIRS_FOOT_CONTACT = 8;
const MIN_STAIRS_SUPPORT_FRAMES = 10;
const MAX_STAIRS_PENETRATION_MEAN = 0.100;

// One map per run. Keeping the runs separate is what makes a one-run pass insufficient.
const runs = [];
for (const input of inputs) {
  const report = JSON.parse(await readFile(resolve(root, input), 'utf8'));
  const rows = new Map();
  for (const row of report.rows || []) {
    if (row.slug) rows.set(row.slug, row);
  }
  runs.push(rows);
}

const slugs = [...new Set(runs.flatMap(rows => [...rows.keys()]))]
  .sort((a, b) => a.localeCompare(b));
if (!slugs.length) throw new Error('no measured rows found');

function failureReason(row) {
  const reasons = [];
  if (!/(?:walk|run|sprint)/i.test(String(row.walkClip || ''))) {
    reasons.push(`unmeasured clip ${row.walkClip || 'none'}`);
  }
  const contacts = Number(row.contactFrames) || 0;
  const ratio = Number(row.contactFrameRatio) || 0;
  if (contacts < MIN_CONTACT_FRAMES || ratio < MIN_CONTACT_RATIO) {
    reasons.push(`contact ${contacts} frames (${(ratio * 100).toFixed(1)}%)`);
  }
  const raised = Number(row.falsePlantedRaised) || 0;
  if (raised > 0) reasons.push(`raised plant ${raised}`);
  const samples = Number(row.settledTravelSamples) || 0;
  const travel = Number(row.settledWorldTravelMean);
  if (!samples) {
    reasons.push('no settled samples');
  } else if (!Number.isFinite(travel) || travel > MAX_SETTLED_TRAVEL) {
    reasons.push(`settled slip ${Number.isFinite(travel) ? travel.toFixed(4) : 'n/a'} m/frame`);
  }

  const footContacts = Number(row.footContactFrames) || 0;
  const footRatio = Number(row.footContactRatio) || 0;
  if (footContacts < MIN_FOOT_CONTACT_FRAMES || footRatio < MIN_FOOT_CONTACT_RATIO) {
    reasons.push(`foot contact ${footContacts} frames (${(footRatio * 100).toFixed(1)}%)`);
  }
  const regions = [
    ['sole', Number(row.soleContactFrames) || 0],
    ['toe', Number(row.toeContactFrames) || 0],
    ['heel', Number(row.heelContactFrames) || 0]
  ].filter(([, count]) => count > 0).map(([name]) => name);
  if (regions.length < MIN_CONTACT_REGIONS) {
    reasons.push(`contact regions ${regions.length}/${MIN_CONTACT_REGIONS}${regions.length ? ` (${regions.join('+')})` : ''}`);
  }
  const penetrationMean = Number(row.floorPenetrationMean);
  const penetrationMax = Number(row.floorPenetrationMax);
  if (!Number.isFinite(penetrationMean) || !Number.isFinite(penetrationMax)) {
    reasons.push('no foot penetration samples');
  } else if (penetrationMean > MAX_FLOOR_PENETRATION_MEAN || penetrationMax > MAX_FLOOR_PENETRATION) {
    reasons.push(`floor penetration ${penetrationMean.toFixed(3)}/${penetrationMax.toFixed(3)} m mean/max`);
  }
  const yawSamples = Number(row.plantedYawSamples) || 0;
  const yawMean = Number(row.plantedYawMeanDeg);
  const yawMax = Number(row.plantedYawMaxDeg);
  if (!yawSamples) {
    reasons.push('no planted yaw samples');
  } else if (!Number.isFinite(yawMean) || !Number.isFinite(yawMax)
    || yawMean > MAX_PLANTED_YAW_MEAN || yawMax > MAX_PLANTED_YAW) {
    reasons.push(`planted yaw ${Number.isFinite(yawMean) ? yawMean.toFixed(1) : 'n/a'}/${Number.isFinite(yawMax) ? yawMax.toFixed(1) : 'n/a'} deg mean/max`);
  }
  const slipSamples = Number(row.screenSlipSamples) || 0;
  const slipMean = Number(row.screenSlipMeanPx);
  const slipMax = Number(row.screenSlipMaxPx);
  if (!slipSamples) {
    reasons.push('no screen-slip samples');
  } else if (!Number.isFinite(slipMean) || !Number.isFinite(slipMax)
    || slipMean > MAX_SCREEN_SLIP_MEAN || slipMax > MAX_SCREEN_SLIP) {
    reasons.push(`screen slip ${Number.isFinite(slipMean) ? slipMean.toFixed(1) : 'n/a'}/${Number.isFinite(slipMax) ? slipMax.toFixed(1) : 'n/a'} px mean/max`);
  }
  reasons.push(...scenarioFailures(row));
  return reasons.length ? reasons.join('; ') : null;
}

function scenarioFailures(row) {
  const reasons = [];
  const scenarios = row.scenarios;
  if (!scenarios) return ['scenarios missing'];
  const count = (value, key) => Number(value?.[key]) || 0;
  const finite = value => Number.isFinite(Number(value));
  const add = (name, reason) => reasons.push(`${name}: ${reason}`);
  const support = (name, value, minFrames, minFoot, minSupport, maxPenetration) => {
    if (count(value, 'frames') < minFrames) add(name, `${count(value, 'frames')} frames`);
    if (count(value, 'footContactFrames') < minFoot) add(name, `foot contact ${count(value, 'footContactFrames')}`);
    if (count(value, 'supportFrames') < minSupport) add(name, `support ${count(value, 'supportFrames')}`);
    if (!finite(value?.floorPenetrationMean) || Number(value.floorPenetrationMean) > maxPenetration) {
      add(name, `floor penetration mean ${finite(value?.floorPenetrationMean) ? Number(value.floorPenetrationMean).toFixed(3) : 'n/a'}`);
    }
  };

  const start = scenarios.start;
  if (!start) add('start', 'missing');
  else {
    support('start', start, MIN_SCENARIO_FRAMES, MIN_SCENARIO_FOOT_CONTACT, MIN_SCENARIO_SUPPORT_FRAMES, MAX_SCENARIO_PENETRATION);
    if (count(start, 'startFrames') < 4) add('start', `start weight ${count(start, 'startFrames')}`);
    if (count(start.targetCounts, 'start') < 1) add('start', 'no start-step target');
  }

  const stop = scenarios.stop;
  if (!stop) add('stop', 'missing');
  else {
    support('stop', stop, MIN_SCENARIO_FRAMES, MIN_SCENARIO_FOOT_CONTACT, MIN_SCENARIO_SUPPORT_FRAMES, MAX_SCENARIO_PENETRATION);
    if (count(stop, 'stopFrames') < 4) add('stop', `stop weight ${count(stop, 'stopFrames')}`);
    if (!stop.stopFronts?.length) add('stop', 'no braced front foot');
    if (count(stop.targetCounts, 'stop') < 2) add('stop', 'stop targets missing');
  }

  const pivot = scenarios.pivot;
  if (!pivot) add('pivot', 'missing');
  else {
    support('pivot', pivot, MIN_SCENARIO_FRAMES, MIN_SCENARIO_FOOT_CONTACT, MIN_SCENARIO_SUPPORT_FRAMES, MAX_SCENARIO_PENETRATION);
    if (count(pivot, 'pivotFrames') < 4) add('pivot', `pivot weight ${count(pivot, 'pivotFrames')}`);
    if (!pivot.pivotSides?.length) add('pivot', 'no pivot foot');
    if (!pivot.pivotStepSides?.length) add('pivot', 'no pivot step foot');
    if (count(pivot.targetCounts, 'pivot') < 1) add('pivot', 'pivot target missing');
    if (count(pivot.targetCounts, 'pivot-step') < 1) add('pivot', 'pivot-step target missing');
  }

  const landing = scenarios.landing;
  if (!landing) add('landing', 'missing');
  else {
    support('landing', landing, MIN_SCENARIO_FRAMES, MIN_SCENARIO_FOOT_CONTACT, 8, MAX_LANDING_PENETRATION);
    if (count(landing, 'landingFrames') < 4) add('landing', `landing weight ${count(landing, 'landingFrames')}`);
    if (!(Number(landing.landingTimerMax) >= 0.05)) add('landing', 'landing replant missing');
    if (count(landing.targetCounts, 'landing') < 1) add('landing', 'landing targets missing');
  }

  const strafe = scenarios.strafe;
  if (!strafe) add('strafe', 'missing');
  else {
    support('strafe', strafe, MIN_SCENARIO_FRAMES, MIN_SCENARIO_FOOT_CONTACT, 8, MAX_SCENARIO_PENETRATION);
    if (count(strafe, 'strafeFrames') < 8) add('strafe', `lateral frames ${count(strafe, 'strafeFrames')}`);
    if (!finite(strafe.plantedYawMeanDeg) || Number(strafe.plantedYawMeanDeg) > MAX_STRAFE_YAW_MEAN) {
      add('strafe', `yaw mean ${finite(strafe.plantedYawMeanDeg) ? Number(strafe.plantedYawMeanDeg).toFixed(1) : 'n/a'}`);
    }
    if (!finite(strafe.screenSlipMeanPx) || Number(strafe.screenSlipMeanPx) > MAX_STRAFE_SLIP_MEAN
      || !finite(strafe.screenSlipMaxPx) || Number(strafe.screenSlipMaxPx) > MAX_STRAFE_SLIP) {
      add('strafe', `screen slip ${finite(strafe.screenSlipMeanPx) ? Number(strafe.screenSlipMeanPx).toFixed(1) : 'n/a'}/${finite(strafe.screenSlipMaxPx) ? Number(strafe.screenSlipMaxPx).toFixed(1) : 'n/a'} px`);
    }
  }

  const slope = scenarios.slope;
  if (!slope) add('slope', 'missing');
  else {
    support('slope', slope, MIN_SLOPE_FRAMES, MIN_SLOPE_FOOT_CONTACT, MIN_SLOPE_SUPPORT_FRAMES, MAX_SLOPE_PENETRATION_MEAN);
    if (!(Number(slope.groundRise) >= MIN_SLOPE_RISE)) add('slope', `rise ${finite(slope.groundRise) ? Number(slope.groundRise).toFixed(2) : 'n/a'} m`);
    if (count(slope, 'groundDropFrames') > 2) add('slope', `${count(slope, 'groundDropFrames')} downward steps`);
  }

  const stairs = scenarios.stairs;
  if (!stairs) add('stairs', 'missing');
  else {
    support('stairs', stairs, MIN_STAIRS_FRAMES, MIN_STAIRS_FOOT_CONTACT, MIN_STAIRS_SUPPORT_FRAMES, MAX_STAIRS_PENETRATION_MEAN);
    if (!(Number(stairs.groundRise) >= MIN_STAIRS_RISE)) add('stairs', `rise ${finite(stairs.groundRise) ? Number(stairs.groundRise).toFixed(2) : 'n/a'} m`);
    if (count(stairs, 'groundStepFrames') < MIN_STAIRS_TREADS) add('stairs', `${count(stairs, 'groundStepFrames')} treads`);
  }

  for (const error of row.scenarioErrors || []) reasons.push(`scenario error ${error}`);
  return reasons;
}

const entries = slugs.map(slug => {
  const failures = [];
  runs.forEach((rows, index) => {
    const row = rows.get(slug);
    if (!row) {
      failures.push(`run ${index + 1}: missing`);
      return;
    }
    if (row.error) {
      failures.push(`run ${index + 1}: errored`);
      return;
    }
    const reason = failureReason(row);
    if (reason) failures.push(`run ${index + 1}: ${reason}`);
  });
  return [slug, failures.length ? failures.join('; ') : null];
});
const accepted = entries.filter(([, reason]) => reason === null).map(([slug]) => slug);

const source = `// Accepted rigs for the grounded foot-plant layer.
//
// Generated from ${inputs.join(', ')} by scripts/build-foot-acceptance.mjs.
//
// ${accepted.length} of ${entries.length} measured rigs passed every run. A rig is listed only when
// every supplied run measured a walk/run clip with at least ${MIN_CONTACT_FRAMES} ankle contact frames
// (${(MIN_CONTACT_RATIO * 100).toFixed(0)}% coverage), no raised planted frame, a settled sample at or below
// ${MAX_SETTLED_TRAVEL.toFixed(3)} m of ankle travel per sample (1.2 m/s at 60 fps), at least
// ${MIN_FOOT_CONTACT_FRAMES} visible-foot contact frames (${(MIN_FOOT_CONTACT_RATIO * 100).toFixed(0)}% coverage) with sole, toe and heel all
// touching, mean/max floor penetration at or below ${MAX_FLOOR_PENETRATION_MEAN.toFixed(3)}/${MAX_FLOOR_PENETRATION.toFixed(3)} m,
// planted yaw mean/max at or below ${MAX_PLANTED_YAW_MEAN}/${MAX_PLANTED_YAW} deg, and screen-space foot slip
// mean/max at or below ${MAX_SCREEN_SLIP_MEAN}/${MAX_SCREEN_SLIP} px at 960x600.
//
// Transition checks use a ${MIN_SCENARIO_FRAMES}-frame minimum, at least ${MIN_SCENARIO_FOOT_CONTACT} visible-foot contact frames,
// ${MIN_SCENARIO_SUPPORT_FRAMES} support frames (8 on landing/strafe), the matching transition weight and target reason,
// a braced front foot on stop, a planted pivot and pivot step, a landing replant, and mean
// floor penetration at or below ${MAX_SCENARIO_PENETRATION.toFixed(3)} m (${MAX_LANDING_PENETRATION.toFixed(3)} on landing).
// Strafe also requires 8 lateral frames, planted yaw mean at or below ${MAX_STRAFE_YAW_MEAN} deg, and screen slip
// mean/max at or below ${MAX_STRAFE_SLIP_MEAN}/${MAX_STRAFE_SLIP} px.
// Slope requires ${MIN_SLOPE_RISE.toFixed(2)} m of rise, no more than 2 downward steps, ${MIN_SLOPE_FRAMES} frames, ${MIN_SLOPE_FOOT_CONTACT} foot-contact frames,
// ${MIN_SLOPE_SUPPORT_FRAMES} support frames and mean penetration at or below ${MAX_SLOPE_PENETRATION_MEAN.toFixed(3)} m. Stairs require
// ${MIN_STAIRS_RISE.toFixed(2)} m of rise, ${MIN_STAIRS_TREADS} treads, ${MIN_STAIRS_FRAMES} frames, ${MIN_STAIRS_FOOT_CONTACT} foot-contact frames, ${MIN_STAIRS_SUPPORT_FRAMES} support frames and
// mean penetration at or below ${MAX_STAIRS_PENETRATION_MEAN.toFixed(3)} m; stair max penetration is not gated because
// a toe ahead of a riser is expected to clip at the edge.
// A rig that passes one run and fails another, or is missing from a run, is omitted.
// Unlisted and unknown identities fail closed and keep their authored clip feet.
export const FOOT_ACCEPTANCE_ACCEPTED = Object.freeze([
${accepted.map(slug => `  '${slug}',`).join('\n')}
]);
`;
const output = resolve(root, 'public/js/anim/foot_acceptance_data.js');
await writeFile(output, source);
console.log(`wrote ${entries.length} identities to ${output}`);
console.log(`gate split: ${accepted.length} accepted / ${entries.length - accepted.length} fallback across ${runs.length} run${runs.length === 1 ? '' : 's'}`);
for (const [slug, reason] of entries) {
  if (reason) console.log(`  fallback ${slug}: ${reason}`);
}
