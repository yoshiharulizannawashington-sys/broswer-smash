// Merge the batched Iron Spider roster match reports into one complete matrix.
//
// The detail pages are deliberately capped at 10 opponents (40 images) so Chromium does not
// exhaust its renderer while loading every capture at once. A compact overview has one signature
// frame per opponent.
//
//   bash scripts/run-browser-test.sh scripts/merge-iron-spider-match-matrix.mjs
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = resolve(root, 'artifacts/iron-spider/matrix');
const batchFiles = (await readdir(out))
  .filter(file => /^report-batch-[a-zA-Z0-9_-]+\.json$/.test(file))
  .filter(file => !file.includes('interrupted'))
  .sort();
if (!batchFiles.length) throw new Error('no report-batch-*.json files found');

const reports = [];
for (const file of batchFiles) reports.push(JSON.parse(await readFile(resolve(out, file), 'utf8')));
let legacy = null;
try {
  legacy = JSON.parse(await readFile(resolve(out, 'report-four-opponents.json'), 'utf8'));
} catch {
  legacy = null;
}
const allReports = legacy ? [legacy, ...reports] : reports;
const roster = reports[0].batch?.launchRoster || [];
const expected = roster.filter(name => name !== 'Iron Spider');
const bySlug = new Map();
for (const report of allReports) {
  for (const entry of report.opponents || []) {
    if (!bySlug.has(entry.slug)) bySlug.set(entry.slug, entry);
  }
}
const rank = name => expected.indexOf(name);
const opponents = [...bySlug.values()].sort((a, b) => rank(a.opponent) - rank(b.opponent));
const missing = expected.filter(name => !opponents.some(entry => entry.opponent === name));
const extras = opponents.filter(entry => !expected.includes(entry.opponent)).map(entry => entry.opponent);
const noFourCaptures = opponents.filter(entry => entry.captures?.length !== 4 || entry.error).map(entry => entry.opponent);
const perOpponentChecks = allReports.flatMap(report =>
  (report.checks || []).filter(entry => entry.name.startsWith('[')));
const globalCheck = (name, fallback) => {
  const found = allReports.flatMap(report => report.checks || []).filter(entry => entry.name === name);
  return found.length ? found.every(entry => entry.ok) : fallback;
};
const checks = [
  {
    name: 'every selectable launch-roster opponent has a match row',
    ok: missing.length === 0 && extras.length === 0 && opponents.length === expected.length,
    detail: JSON.stringify({ expected: expected.length, rows: opponents.length, missing, extras })
  },
  {
    name: 'every roster match produced four capture frames',
    ok: noFourCaptures.length === 0,
    detail: noFourCaptures.join(', ') || 'all present'
  },
  ...perOpponentChecks,
  {
    name: 'no browser runtime errors across the matrix batches',
    ok: globalCheck('no browser runtime errors during the matrix', false),
    detail: ''
  },
  {
    name: 'no failed asset requests across the matrix batches',
    ok: globalCheck('no failed asset requests during the matrix', false),
    detail: ''
  }
];
const summary = {
  launchRoster: roster.length,
  selectableOpponents: expected.length,
  catalogSize: reports[0].batch?.catalogSize ?? null,
  catalogOnly: reports[0].batch?.catalogOnly?.length ?? null,
  rows: opponents.length,
  pass: opponents.filter(entry => !entry.error).length,
  fail: opponents.filter(entry => entry.error).length,
  checks: checks.filter(entry => entry.ok).length,
  checksTotal: checks.length
};

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const sheetErrors = [];
const imageData = async (slug, beat) => {
  try {
    const image = await readFile(resolve(out, slug, `${beat}.png`));
    return 'data:image/png;base64,' + image.toString('base64');
  } catch {
    return '';
  }
};
const renderPage = async (html, path, width = 1500, height = 1000) => {
  const page = await browser.newPage({ viewport: { width, height } });
  page.setDefaultTimeout(180_000);
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    await page.screenshot({ path, fullPage: true });
  } catch (error) {
    const detail = String(error?.message || error).slice(0, 500);
    sheetErrors.push(`${path}: ${detail}`);
    console.error('SHEET FAILED ' + path + ' · ' + detail);
  } finally {
    await page.close();
  }
};
const beats = ['01-match', '02-light-hit', '03-signature', '04-result'];
const beatLabels = ['MATCH', 'JAB HIT', 'SIGNATURE', 'RESULT'];
const detailCss = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #081018; color: #e8f0f7; font-family: Inter, Arial, sans-serif; }
  header { padding: 24px 28px 12px; border-bottom: 1px solid #1d3344; }
  h1 { margin: 0; font-size: 25px; letter-spacing: .04em; }
  header p { margin: 5px 0 0; color: #7fa4bb; font-size: 12px; letter-spacing: .07em; text-transform: uppercase; }
  main { padding: 10px 18px 16px; }
  .row { display: grid; grid-template-columns: 130px repeat(4, 1fr); gap: 8px; align-items: start; padding: 8px 0; border-bottom: 1px solid #142838; }
  .rail { display: flex; flex-direction: column; gap: 5px; padding-left: 8px; border-left: 3px solid #2d7ea8; }
  .rail strong { font-size: 12px; letter-spacing: .05em; color: #8db2c8; }
  .rail span { font-size: 15px; font-weight: 700; }
  .rail em { font-size: 10px; color: #75a9c5; font-style: normal; }
  .rail small { font-size: 9px; color: #5d8499; }
  figure { margin: 0; }
  img, .missing { display: block; width: 100%; height: auto; aspect-ratio: 1 / 1; object-fit: contain; border: 1px solid #264456; border-radius: 3px; background: #0d1c27; }
  .missing { display: grid; place-items: center; color: #ff9b8e; font: 900 12px system-ui; }
  figcaption { margin-top: 4px; color: #8db2c8; font-size: 10px; letter-spacing: .08em; }
`;
const sheetPaths = [];
for (let offset = 0; offset < opponents.length; offset += 10) {
  const chunk = opponents.slice(offset, offset + 10);
  const rows = [];
  for (const entry of chunk) {
    const cells = [];
    for (const beat of beats) {
      const src = await imageData(entry.slug, beat);
      cells.push(`<figure>${src ? `<img src="${src}" alt="${entry.opponent} ${beat}">` : '<div class="missing">MISSING</div>'}<figcaption>${beatLabels[beats.indexOf(beat)]}</figcaption></figure>`);
    }
    rows.push(`
      <section class="row">
        <div class="rail"><strong>IRON SPIDER</strong><span>vs ${entry.opponent}</span><em>${entry.error ? 'MATCH FAILED' : `light ${entry.light.damage}% · sig ${entry.signature.damage}%`}</em><small>${entry.error ? 'see failure log' : entry.durationMs != null ? `${entry.durationMs} ms` : 'legacy capture'}</small></div>
        ${cells.join('')}
      </section>`);
  }
  const pageNumber = String(sheetPaths.length + 1).padStart(2, '0');
  const sheetPath = resolve(out, `matrix-sheet-${pageNumber}.png`);
  sheetPaths.push(sheetPath);
  await renderPage(`<!doctype html><html><head><meta charset="utf-8"><style>${detailCss}</style></head><body>
    <header><h1>IRON SPIDER · ROSTER MATCH MATRIX · DETAIL ${pageNumber}</h1>
    <p>${expected.length} selectable launch opponents · real J / K inputs · match result check per row · CPU frozen for measurement</p></header>
    <main>${rows.join('')}</main>
  </body></html>`, sheetPath);
}

const overviewCells = [];
for (const entry of opponents) {
  const src = await imageData(entry.slug, '03-signature');
  overviewCells.push(`<figure class="tile">${src ? `<img src="${src}" alt="${entry.opponent} signature">` : '<div class="missing">MISSING</div>'}<figcaption><b>${entry.opponent}</b><span>${entry.error ? 'MATCH FAILED' : `light ${entry.light.damage}% · sig ${entry.signature.damage}%`}</span></figcaption></figure>`);
}
const overviewPath = resolve(out, 'matrix-sheet.png');
await renderPage(`<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #081018; color: #e8f0f7; font-family: Inter, Arial, sans-serif; }
  header { padding: 24px 28px 12px; border-bottom: 1px solid #1d3344; }
  h1 { margin: 0; font-size: 25px; letter-spacing: .04em; }
  header p { margin: 5px 0 0; color: #7fa4bb; font-size: 12px; letter-spacing: .07em; text-transform: uppercase; }
  main { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; padding: 14px 18px 18px; }
  .tile { margin: 0; min-width: 0; }
  img, .missing { display: block; width: 100%; height: auto; aspect-ratio: 1 / 1; object-fit: cover; border: 1px solid #264456; border-radius: 3px; background: #0d1c27; }
  .missing { display: grid; place-items: center; color: #ff9b8e; font: 900 12px system-ui; }
  figcaption { margin-top: 5px; display: flex; flex-direction: column; gap: 3px; }
  figcaption b { color: #eaf7ff; font-size: 12px; line-height: 1.2; }
  figcaption span { color: #75a9c5; font-size: 10px; }
</style></head><body>
  <header><h1>IRON SPIDER · SELECTABLE-ROSTER MATCH MATRIX</h1>
  <p>${expected.length} launch opponents · one signature frame each · detail pages ${sheetPaths.length} · CPU frozen</p></header>
  <main>${overviewCells.join('')}</main>
</body></html>`, overviewPath);
await browser.close();

const report = {
  capturedAt: new Date().toISOString(),
  sheet: overviewPath,
  sheets: sheetPaths,
  renderer: 'headless Chromium / SwiftShader',
  roundsToWin: reports.map(report => ({ label: report.batch?.label || null, roundsToWin: report.roundsToWin ?? null })),
  roster: {
    launch: roster,
    selectableOpponents: expected,
    catalogSize: reports[0].batch?.catalogSize ?? null,
    catalogOnly: reports[0].batch?.catalogOnly || []
  },
  batches: batchFiles,
  opponents,
  checks,
  summary,
  sheetErrors
};
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));

const failed = checks.filter(entry => !entry.ok);
console.log(`SHEET ${overviewPath}`);
console.log('DETAIL ' + sheetPaths.join(' '));
console.log(`REPORT ${resolve(out, 'report.json')}`);
console.log(`\n${checks.length - failed.length}/${checks.length} merged matrix checks passed`);
console.log(JSON.stringify(summary, null, 2));
if (failed.length || sheetErrors.length) process.exitCode = 1;
