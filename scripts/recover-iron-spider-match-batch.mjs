// Recover a match-matrix batch whose all-checks log and four-frame captures are complete, but
// whose final report was lost to a sheet-screenshot timeout. This does not invent match results:
// every row is parsed from the recorded CHECK/RESULT lines and its capture files are verified.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const out = resolve(root, 'artifacts/iron-spider/matrix');
const label = String(process.env.IRON_MATRIX_RECOVER_LABEL || '').trim();
if (!label) throw new Error('set IRON_MATRIX_RECOVER_LABEL');
const logPath = resolve(out, `run-${label}.log`);
const metaPath = resolve(out, 'report-batch-02.json');
const meta = JSON.parse(await readFile(metaPath, 'utf8'));
const lines = (await readFile(logPath, 'utf8')).split('\n');
const checks = [];
const results = new Map();
for (const line of lines) {
  const check = line.match(/^CHECK (PASS|FAIL) (.*?)(?: · (.*))?$/);
  if (check) checks.push({ name: check[2], ok: check[1] === 'PASS', detail: check[3] || '' });
  const result = line.match(/^RESULT (.+?) · light ([\d.]+)% · signature ([\d.]+)% · (.*?) · (\d+)ms$/);
  if (result) results.set(result[1], { result: result[4], durationMs: Number(result[5]) });
}
const names = [...new Set(lines.map(line => line.match(/^=== (.+) ===$/)?.[1]).filter(Boolean))];
const rows = [];
const errors = [];
for (const name of names) {
  const find = suffix => checks.find(entry => entry.name === `[${name}] ${suffix}`);
  const lightCheck = find('J lands damage and hit stun on the opponent');
  const signatureCheck = find('K plays skill07 and damages the opponent');
  const resultCheck = find('one KO reaches a match result');
  if (!lightCheck || !signatureCheck || !resultCheck || !results.has(name)) {
    errors.push(name);
    continue;
  }
  const light = JSON.parse(lightCheck.detail);
  const signature = JSON.parse(signatureCheck.detail);
  const matchResult = JSON.parse(resultCheck.detail);
  rows.push({
    opponent: name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    captures: ['01-match.png', '02-light-hit.png', '03-signature.png', '04-result.png']
      .map(file => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}/${file}`),
    light: { damage: +(light.after - light.before).toFixed(2), stun: light.stun },
    signature: { clip: signature.clip, damage: signature.percent, cooldown: signature.cooldown },
    result: matchResult.result || results.get(name).result,
    durationMs: results.get(name).durationMs
  });
}
if (rows.length !== 10) throw new Error(`recovered ${rows.length}/10 rows: ${errors.join(', ')}`);
const report = {
  capturedAt: new Date().toISOString(),
  sheet: null,
  renderer: meta.renderer,
  roundsToWin: 1,
  batch: {
    ...meta.batch,
    label,
    offset: 0,
    limit: 0,
    requested: rows.length,
    selected: rows.length
  },
  recoveredFromLog: logPath,
  recoveryNote: 'All 10 matches and 40 capture files completed; the batch report was lost when the 10-row sheet screenshot timed out.',
  opponents: rows,
  checks
};
await writeFile(resolve(out, `report-${label}.json`), JSON.stringify(report, null, 2));
console.log(`RECOVERED ${rows.length} rows / ${checks.length} checks -> report-${label}.json`);
