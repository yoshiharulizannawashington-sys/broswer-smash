// Roster-wide visual capture, through the real character-select preview.
//
//   bash scripts/run-browser-test.sh scripts/capture-roster-sheet.mjs
//
// For every launch fighter, ask the live preview to load that fighter's shipped GLB, pin the yaw to
// the front, three-quarter and side, and screenshot the preview panel: full body, one framing and
// one light rig for all 34, so the images are actually comparable. Then compose the front views into
// a single contact sheet - 34 separate screenshots cannot be reviewed honestly, one sheet can.
//
// Writes artifacts/select-roster/<slug>-{front,quarter,side}.png and artifacts/select-roster/sheet.png
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
// `--tall` shoots the same angles with the preview panel stretched vertically, which is the only
// way to get a character big enough to judge a face. Separate directory so the roster sheet keeps
// its uniform framing.
const TALL = process.argv.includes('--tall');
const outDir = resolve(root, TALL ? 'artifacts/select-roster-tall' : 'artifacts/select-roster');
await mkdir(outDir, { recursive: true });

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '');
    if (!relative) relative = 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const bytes = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const slugOf = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const ANGLES = [['front', 0], ['quarter', 0.72], ['side', 1.35]];

const errors = [];
const rows = [];
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  // 2x device pixels in tall mode: a head crop has to survive inspection, and upscaling a
  // 206 px strip was never going to show whether a face is correct.
  const page = await browser.newPage({ viewport: TALL ? { width: 1100, height: 1150 } : { width: 1000, height: 640 },
    deviceScaleFactor: TALL ? 2 : 1 });
  page.setDefaultTimeout(180_000);
  page.on('pageerror', error => errors.push(String(error).split('\n')[0]));

  await page.goto(origin + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__browserSmashPreview), null, { timeout: 120_000 });

  const allNames = await page.evaluate(() => window.characterRosters.launch.map(([name]) => name));
  // Batched runs: the cloud command cap is five minutes, so an unfinished roster has to be able to
  // resume. `--from/--count` selects a slice; fighters whose three angles already exist are skipped.
  const fromIndex = Number(process.argv[2] ?? 0) || 0;
  const count = Number(process.argv[3] ?? allNames.length) || allNames.length;
  // `--sheet-only` recomposes the contact sheet from images already on disk, so fixing the sheet
  // never costs another 34 model loads.
  const sheetOnly = process.argv.includes('--sheet-only');
  const onlyArg = process.argv.find(arg => arg.startsWith('--slugs='));
  const only = onlyArg ? onlyArg.slice('--slugs='.length).split(',').map(s => s.trim()).filter(Boolean) : null;
  const names = sheetOnly ? []
    : allNames.slice(fromIndex, fromIndex + count).filter(name => !only || only.includes(slugOf(name)));
  const panel = page.locator('#selectScreen [data-role="preview"]');

  for (const name of names) {
    const slug = slugOf(name);
    if (ANGLES.every(([label]) => existsSync(resolve(outDir, `${slug}-${label}.png`)))) {
      rows.push({ name, slug, state: 'cached' });
      continue;
    }
    if (TALL) {
      // Resize and strip chrome FIRST: show() frames the model against the canvas it can see, and
      // resizing afterwards leaves the camera framed for the old box - which is why the head was
      // cropped off the top of every tall capture.
      await page.evaluate(() => {
        const panel = document.querySelector('#selectScreen [data-role="preview"]');
        if (!panel) return;
        for (const el of document.querySelectorAll('#selectScreen *')) {
          if (el === panel || panel.contains(el) || el.contains(panel)) continue;
          el.style.visibility = 'hidden';
        }
        const screen = document.querySelector('#selectScreen');
        if (screen) screen.style.background = 'transparent';
        panel.style.height = '920px';
        panel.style.minHeight = '920px';
        panel.style.border = 'none';
        panel.style.background = 'transparent';
        for (const span of panel.querySelectorAll('span')) span.style.display = 'none';
        for (const canvas of panel.querySelectorAll('canvas')) {
          canvas.style.width = '100%';
          canvas.style.height = '920px';
        }
      });
      await page.waitForTimeout(360);
    }
    // `show()` now resolves once the model is in the scene, so awaiting it is the sequencing;
    // the old status poll could see the *previous* fighter's `ready` and shoot that body instead.
    await page.evaluate(async identity => {
      window.__browserSmashPreview.setYaw(0);
      await window.__browserSmashPreview.show(identity, identity);
      const label = document.querySelector('#selectScreen [data-role="previewname"]');
      if (label) label.textContent = identity.toUpperCase().replace(/_/g, ' ');
    }, slug);
    await page.waitForTimeout(260);
    const state = await page.evaluate(() =>
      document.querySelector('#selectScreen [data-role="previewstatus"]')?.dataset.state || 'missing');
    for (const [label, yaw] of ANGLES) {
      await page.evaluate(angle => window.__browserSmashPreview.setYaw(angle), yaw);
      await page.waitForTimeout(110);
      await panel.screenshot({ path: resolve(outDir, `${slug}-${label}.png`) });
    }
    rows.push({ name, slug, state });
  }

  const sheet = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
  // Every launch fighter, not only the ones captured in this run: the sheet is the roster view.
  const sheetRows = allNames.map(name => {
    const slug = slugOf(name);
    const shot = resolve(outDir, `${slug}-front.png`);
    return { name, slug, state: existsSync(shot) ? 'ready' : 'missing' };
  });
  const cells = sheetRows.map(row => `
    <figure class="cell ${row.state !== 'ready' ? 'bad' : ''}">
      <img src="${origin}/artifacts/select-roster/${row.slug}-front.png" alt="${row.name}">
      <figcaption>${row.name}<span>${row.state}</span></figcaption>
    </figure>`).join('');
  await sheet.setContent(`<base href="${origin}/"><style>
    body{margin:0;background:#050d15;font:600 11px system-ui;color:#dff2ff}
    .grid{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;padding:10px}
    .cell{position:relative;margin:0;background:#08202e;border:1px solid #1d4356;overflow:hidden}
    .cell img{display:block;width:100%;height:150px;object-fit:cover;object-position:center top}
    .cell.bad{border-color:#ff6a55}
    figcaption{position:absolute;left:0;right:0;bottom:0;padding:3px 5px;background:#02101ae0;letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    figcaption span{float:right;color:#6fd8f2;font-size:9px}
  </style><div class="grid">${cells}</div>`, { waitUntil: 'load' });
  // setContent gives the page an about:blank origin, so relative image paths silently failed and
  // the first sheet was 34 broken-image icons. Absolute URLs plus an explicit decode wait.
  await sheet.waitForFunction(() => [...document.images].every(img => img.complete && img.naturalWidth > 0),
    null, { timeout: 60_000 });
  await sheet.waitForTimeout(400);
  await sheet.screenshot({ path: resolve(outDir, 'sheet.png'), fullPage: true });

  const notReady = rows.filter(row => row.state !== 'ready');
  console.log(JSON.stringify({
    captured: rows.length,
    sheet: resolve(outDir, 'sheet.png'),
    notReady: notReady.map(row => `${row.slug}:${row.state}`),
    pageErrors: [...new Set(errors)].slice(0, 8)
  }, null, 2));
  console.log(`OK: sheet composed from ${sheetRows.length} fighters ` +
    `(${rows.filter(row => row.state !== 'cached').length} captured this run)`);
} finally {
  await browser?.close();
  server.close();
}
