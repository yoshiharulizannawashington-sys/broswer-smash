// Five-character approval set: 5 views per fighter, one browser session, one light rig.
//
//   bash scripts/run-browser-test.sh scripts/capture-approval-set.mjs --slugs=kratos,aang
//   bash scripts/run-browser-test.sh scripts/capture-approval-set.mjs --sheet-only
//
// Shoots, for each fighter, through the shipped character-select preview:
//   full-front, full-quarter, full-side  (panel framing, whole body)
//   head-front, head-quarter             (camera framed on the measured head)
// All 25 images therefore share the same renderer, materials, lighting and panel size, which is the
// only way they are comparable. The head views use the preview's own camera and the model's own
// bounding box, so a head is never cropped and never framed by a guessed offset.
//
// Writes artifacts/phase73/<slug>-<view>.png and artifacts/phase73/contact-sheet.png
// Batch-friendly: `--slugs=` limits the run (the cloud command cap is five minutes), existing files
// are skipped unless `--force`, and `--sheet-only` recomposes the sheet without loading any model.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/phase73');
await mkdir(outDir, { recursive: true });

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const value = (name, fallback = null) => {
  const hit = argv.find(arg => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const FORCE = flag('--force');
const SHEET_ONLY = flag('--sheet-only');
const only = (value('slugs') || '').split(',').map(s => s.trim()).filter(Boolean);

const ROSTER = [
  'Kratos', 'Aang', 'Arnold Schwarzenegger', 'L (Death Note Style)', 'Edna Mode'
];
const slugOf = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const VIEWS = ['full-front', 'full-quarter', 'full-side', 'head-front', 'head-quarter'];
const YAW = { 'full-front': 0, 'full-quarter': 0.72, 'full-side': 1.35, 'head-front': 0, 'head-quarter': 0.72 };

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

async function composeSheet() {
  const sheet = await browser.newPage({ viewport: { width: 1700, height: 1500 } });
  const rows = ROSTER.map(name => {
    const slug = slugOf(name);
    const cells = VIEWS.map(view => {
      const shot = resolve(outDir, `${slug}-${view}.png`);
      return existsSync(shot)
        ? `<figure class="cell"><img src="${origin}/artifacts/phase73/${slug}-${view}.png" alt="${name} ${view}"><figcaption>${view}</figcaption></figure>`
        : `<figure class="cell bad"><div class="miss">MISSING</div><figcaption>${view}</figcaption></figure>`;
    }).join('');
    return `<section><h3>${name}</h3><div class="row">${cells}</div></section>`;
  }).join('');
  await sheet.setContent(`<base href="${origin}/"><style>
    body{margin:0;background:#04101a;color:#dff2ff;font:600 12px system-ui}
    h3{margin:10px 12px 4px;font-size:13px;letter-spacing:.08em;color:#7fe3ff}
    .row{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;padding:0 12px 12px}
    .cell{margin:0;position:relative;background:#08202e;border:1px solid #1d4356;overflow:hidden}
    .cell img{display:block;width:100%;height:250px;object-fit:contain;background:#061a26}
    .cell.bad{border-color:#ff6a55}
    .miss{height:250px;display:flex;align-items:center;justify-content:center;color:#ff8a75}
    figcaption{position:absolute;left:0;right:0;bottom:0;padding:3px 6px;background:#02101ae0;font-size:10px;letter-spacing:.05em}
  </style>${rows}`, { waitUntil: 'load' });
  await sheet.waitForFunction(() => [...document.images].every(img => img.complete), null, { timeout: 60_000 });
  await sheet.waitForTimeout(500);
  await sheet.screenshot({ path: resolve(outDir, 'contact-sheet.png'), fullPage: true });
  await sheet.close();
  const missing = ROSTER.flatMap(name => VIEWS
    .filter(view => !existsSync(resolve(outDir, `${slugOf(name)}-${view}.png`)))
    .map(view => `${slugOf(name)}-${view}`));
  return missing;
}

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });

  if (!SHEET_ONLY) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1150 }, deviceScaleFactor: 2 });
    page.setDefaultTimeout(180_000);
    const errors = [];
    page.on('pageerror', error => errors.push(String(error).split('\n')[0]));
    await page.goto(origin + '/index.html', { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.__browserSmashPreview), null, { timeout: 120_000 });
    const panel = page.locator('#selectScreen [data-role="preview"]');

    for (const name of ROSTER) {
      const slug = slugOf(name);
      if (only.length && !only.includes(slug)) continue;
      if (!FORCE && VIEWS.every(view => existsSync(resolve(outDir, `${slug}-${view}.png`)))) {
        console.log(`skip ${slug} (complete)`);
        continue;
      }
      // Size and strip the panel before show(): the preview frames the model against the canvas it
      // can see, so resizing afterwards leaves the camera set for the previous box.
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
      await page.waitForTimeout(320);

      await page.evaluate(async id => {
        window.__browserSmashPreview.setYaw(0);
        await window.__browserSmashPreview.show(id, id);
      }, slug);
      await page.waitForTimeout(300);
      const state = await page.evaluate(() =>
        document.querySelector('#selectScreen [data-role="previewstatus"]')?.dataset.state || 'missing');

      for (const view of ['full-front', 'full-quarter', 'full-side']) {
        await page.evaluate(yaw => window.__browserSmashPreview.setYaw(yaw), YAW[view]);
        await page.waitForTimeout(120);
        await panel.screenshot({ path: resolve(outDir, `${slug}-${view}.png`) });
      }

      // Head framing from the model's own box: the crown is boxMax.y and the head is ~13% of total
      // height, so nothing here is a hand-tuned offset that a taller fighter would break.
      for (const view of ['head-front', 'head-quarter']) {
        await page.evaluate(yaw => {
          const { boxMin, boxMax, camera } = window.__fighterPreviewDebug;
          const height = boxMax[1] - boxMin[1];
          const headY = boxMax[1] - height * 0.075;
          const cx = (boxMin[0] + boxMax[0]) / 2;
          const cz = (boxMin[2] + boxMax[2]) / 2;
          const distance = (height * 0.30 * 0.5) / Math.tan((camera.fov * Math.PI) / 360);
          camera.near = Math.max(0.01, distance * 0.2);
          camera.far = distance * 20;
          camera.updateProjectionMatrix();
          camera.position.set(cx + Math.sin(yaw) * distance, headY, cz + Math.cos(yaw) * distance);
          camera.lookAt(cx, headY, cz);
          camera.updateMatrixWorld(true);
          window.__browserSmashPreview.setYaw(yaw);
        }, YAW[view]);
        await page.waitForTimeout(260);
        await panel.screenshot({ path: resolve(outDir, `${slug}-${view}.png`) });
      }
      console.log(`shot ${slug} (preview state ${state})`);
    }
    console.log(JSON.stringify({ pageErrors: [...new Set(errors)].slice(0, 6) }, null, 2));
  }

  const missing = await composeSheet();
  console.log(`contact sheet: ${resolve(outDir, 'contact-sheet.png')}`);
  console.log(missing.length ? `MISSING ${missing.length}: ${missing.join(' ')}` : 'COMPLETE: 25 of 25');
  await writeFile(resolve(outDir, 'approval-set.json'),
    JSON.stringify({ roster: ROSTER.map(slugOf), views: VIEWS, missing }, null, 2));
} finally {
  await browser?.close();
  server.close();
}
