// Merge the three index batches of the Iron Spider clip matrix into one report and contact sheet.
// The batches exist only because headless SwiftShader takes long enough per capture that 57 clips
// exceed the command window; each batch is the same harness and the same live body.
import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = resolve(root, 'artifacts/iron-spider/clip-matrix');
const batchFiles = ['report-batch-01.json', 'report-batch-02.json', 'report-batch-03.json',
  'report-fix-01.json', 'report-fix-02.json'];
const batchPaths = batchFiles.map(file => resolve(out, file));
const reports = [];
for (const path of batchPaths) reports.push(JSON.parse(await readFile(path, 'utf8')));

// Later replacement reports intentionally override earlier records for the same global index.
const byIndex = new Map();
for (const report of reports) for (const clip of report.clips) byIndex.set(clip.index, clip);
const clips = [...byIndex.values()].sort((a, b) => a.index - b.index);
const indexes = clips.map(clip => clip.index);
const expected = Array.from({ length: 57 }, (_, index) => index + 1);
const indexComplete = indexes.length === 57 && new Set(indexes).size === 57
  && expected.every(index => indexes.includes(index));
if (!indexComplete) {
  throw new Error(`expected indexes 1..57, received ${indexes.length}: ${indexes.join(',')}`);
}
for (const clip of clips) await access(resolve(root, clip.capture));

const summary = {
  total: clips.length,
  pass: clips.filter(clip => clip.status === 'PASS').length,
  fail: clips.filter(clip => clip.status === 'FAIL').length,
  source: clips.filter(clip => clip.source === 'source').length,
  supplemental: clips.filter(clip => clip.source === 'supplemental').length,
  armAnimatedClips: clips.filter(clip => clip.spiderBonesMoved > 0).length,
  zeroMotion: clips.filter(clip => clip.maxAngleDeg < 1).map(clip => clip.short)
};
const first = reports[0];
const checks = [
  ...first.checks.slice(0, 4),
  {
    name: 'all 57 global clip indices have a capture',
    ok: indexComplete && clips.every(clip => clip.captureBytes > 0),
    detail: `${clips.length} captures`
  },
  {
    name: 'all 57 clips have a real action and a live pose measurement',
    ok: clips.every(clip => clip.actionFound !== false && clip.liveAngleDeg !== null),
    detail: clips.filter(clip => clip.liveAngleDeg === null).map(clip => clip.short).join(', ') || 'all measured'
  },
  {
    name: 'the native arm is attached and visible in all 57 captures',
    ok: clips.every(clip => clip.arm?.present && clip.arm.visible),
    detail: clips.filter(clip => !clip.arm?.present || !clip.arm.visible).map(clip => clip.short).join(', ') || 'all visible'
  },
  {
    name: 'no browser runtime errors across the three batches',
    ok: reports.every(report => report.pageErrors.length === 0),
    detail: reports.flatMap(report => report.pageErrors).slice(0, 3).join(' | ')
  },
  {
    name: 'no failed asset requests across the three batches',
    ok: reports.every(report => report.failedRequests.length === 0),
    detail: reports.flatMap(report => report.failedRequests).slice(0, 3).join(' | ')
  }
];

const escape = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));
const tiles = [];
for (const clip of clips) {
  const image = await readFile(resolve(root, clip.capture));
  tiles.push({ ...clip, src: 'data:image/png;base64,' + image.toString('base64') });
}
const cards = tiles.map(tile => `
    <figure class="${tile.status.toLowerCase()}">
      <img src="${tile.src}" alt="${escape(tile.short)}">
      <figcaption>
        <b>${tile.status}</b> <span>${String(tile.index).padStart(2, '0')} ${escape(tile.short)}</span>
        <em>${tile.maxAngleDeg.toFixed(1)}° track · ${tile.liveAngleDeg ?? '?'}° live · ${tile.spiderBonesMoved} arm</em>
        <small>${tile.captureBytes.toLocaleString()} bytes · ${tile.reasons.join(', ') || 'captured'}</small>
      </figcaption>
    </figure>`).join('');

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #07111a; color: #e7f0f6; font-family: Inter, Arial, sans-serif; }
    header { padding: 26px 30px 16px; border-bottom: 1px solid #1c3445; }
    h1 { margin: 0; font-size: 27px; letter-spacing: .04em; }
    header p { margin: 7px 0 0; color: #80a6bc; font-size: 13px; letter-spacing: .06em; text-transform: uppercase; }
    main { display: grid; grid-template-columns: repeat(8, 1fr); gap: 12px; padding: 16px 20px 24px; }
    figure { margin: 0; background: #0b1a25; border: 1px solid #274556; border-radius: 4px; overflow: hidden; }
    figure.pass { border-color: #2f8f6a; }
    figure.fail { border-color: #b24d4d; }
    img { display: block; width: 100%; height: auto; aspect-ratio: 8 / 9; object-fit: contain; background: #0d1c27; }
    figcaption { padding: 6px 7px 7px; display: flex; flex-direction: column; gap: 2px; min-height: 62px; }
    figcaption b { font-size: 11px; letter-spacing: .08em; color: #7fe0b4; }
    figure.fail figcaption b { color: #ff8d8d; }
    figcaption span { font: 700 11px/1.2 ui-monospace, monospace; color: #d9e7ef; word-break: break-word; }
    figcaption em, figcaption small { font: 9px/1.25 ui-monospace, monospace; color: #7fa4bb; font-style: normal; }
    footer { padding: 0 30px 24px; color: #66849a; font-size: 11px; }
  </style></head><body>
    <header><h1>IRON SPIDER · 57-CLIP VISUAL MATRIX</h1>
    <p>${summary.pass}/${summary.total} pass · ${summary.fail} fail · ${summary.source} source + ${summary.supplemental} supplemental · native Object_122</p></header>
    <main>${cards}</main>
    <footer>Live 107-bone Iron Spider body · peak-pose captures · helper scale channels removed for readable body frames · three deterministic batches · headless Chromium / SwiftShader composition evidence, not hardware or performance verification.</footer>
  </body></html>`);
  await page.evaluate(() => Promise.all([...document.images].map(image =>
    image.complete ? true : new Promise(done => { image.onload = done; image.onerror = done; }))));
  const sheetFile = resolve(out, 'clip-matrix-sheet.png');
  await page.screenshot({ path: sheetFile, fullPage: true });
  console.log('SHEET ' + sheetFile);
} finally {
  await browser.close();
}

const report = {
  generatedAt: new Date().toISOString(),
  runtime: first.runtime,
  renderer: first.renderer,
  viewport: first.viewport,
  batchMode: { files: batchFiles, reason: 'headless capture time exceeds the command window; replacement reports override affected indices' },
  inventory: first.inventory,
  summary,
  clips,
  sheet: 'artifacts/iron-spider/clip-matrix/clip-matrix-sheet.png',
  checks,
  pageErrors: reports.flatMap(report => report.pageErrors),
  failedRequests: reports.flatMap(report => report.failedRequests)
};
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
const failedChecks = checks.filter(check => !check.ok);
console.log(`\n${checks.length - failedChecks.length}/${checks.length} merged harness checks passed`);
console.log(`SUMMARY total=${summary.total} pass=${summary.pass} fail=${summary.fail} source=${summary.source} supplemental=${summary.supplemental}`);
console.log('REPORT ' + resolve(out, 'report.json'));
if (failedChecks.length) process.exitCode = 1;
