// Build the per-rig foot-contact table from a grounded-locomotion roster sweep.
//
//   bash scripts/run-browser-test.sh scripts/probe-grounded-locomotion-roster.mjs --start=0 --count=13 --tag=raw-a
//   ...
//   node scripts/build-foot-calibration.mjs artifacts/grounded-locomotion/raw-a.json ...
//
// The sweep writes one row per selectable identity. This script takes the already-measured
// contactHeightMeasured value (the lower edge of the idle/raw-walk contact band) and the raw walk
// floor (rawContactFloor) and emits the two runtime tables used by rig_calibration.js. The idle
// table anchors idle/stand/landing; the walk table keeps walk/run from snapping to an idle pose
// that sits below the clip's own foot floor. It never measures a rig itself.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const inputs = process.argv.slice(2);
if (!inputs.length) {
  console.error('usage: node scripts/build-foot-calibration.mjs <sweep-report.json> [...]');
  process.exit(1);
}
const rows = new Map();
for (const input of inputs) {
  const report = JSON.parse(await readFile(resolve(root, input), 'utf8'));
  for (const row of report.rows || []) {
    if (row.error || !Number.isFinite(row.contactHeightMeasured)) continue;
    rows.set(row.slug, row);
  }
}
const entries = [...rows.entries()].sort(([a], [b]) => a.localeCompare(b));
if (!entries.length) throw new Error('no measured contact heights found');
const source = `// Per-rig foot-contact calibration measured by scripts/probe-grounded-locomotion-roster.mjs.
//
// FOOT_CONTACT_BY_IDENTITY is the ankle height above the fighter origin at the lower edge of the
// rig's idle/walk contact band. FOOT_WALK_CONTACT_BY_IDENTITY is the raw-walk 10th percentile on
// its own. The walk table keeps a low idle pose from dragging the walk target below the clip's
// own foot floor (Hulk, Vegeta, Mario); an unmapped body falls back to its bind-pose measurement.
//
// Regenerate with: node scripts/build-foot-calibration.mjs <sweep-report.json> [...]
export const FOOT_CONTACT_BY_IDENTITY = Object.freeze({
${entries.map(([slug, row]) => `  ${slug}: ${Number(row.contactHeightMeasured).toFixed(4)},`).join('\n')}
});

export const FOOT_WALK_CONTACT_BY_IDENTITY = Object.freeze({
${entries.map(([slug, row]) => `  ${slug}: ${Number(Number.isFinite(row.rawContactFloor) ? row.rawContactFloor : row.contactHeightMeasured).toFixed(4)},`).join('\n')}
});
`;
const output = resolve(root, 'public/js/anim/foot_calibration_data.js');
await writeFile(output, source);
console.log(`wrote ${entries.length} identities to ${output}`);
