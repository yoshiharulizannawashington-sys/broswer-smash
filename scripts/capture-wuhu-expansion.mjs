// Capture a same-camera, top-down before/after of the Wuhu arena expansion.
//
// The current authored GLB is used for both frames so the terrain and materials are identical.
// The "before" frame hides the newer land bridge and draws the prior 22×18 m stage bounds; the
// "after" frame draws the current 26×26 m bounds, the old bounds dashed for comparison, and the
// bridge. This is a reconstruction of the prior extent on the same terrain, not a re-export of
// an old asset; it is labelled that way in the output report.
//
//   bash scripts/run-browser-test.sh scripts/capture-wuhu-expansion.mjs
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/environment/arenas/wuhu-expansion');
await mkdir(outDir, { recursive: true });

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp'
};

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    const relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    const candidates = relative === 'index.html'
      ? [resolve(root, 'public/index.html')]
      : [resolve(root, relative), resolve(root, 'public', relative)];
    let body = null;
    let filePath = null;
    for (const candidate of candidates) {
      try { body = await readFile(candidate); filePath = candidate; break; } catch {}
    }
    if (!body) throw new Error('not found');
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end('not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(180_000);
const errors = [];
page.on('pageerror', error => errors.push(String(error.message || error).slice(0, 300)));
page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text().slice(0, 240)); });

const report = {
  title: 'Wuhu Island arena expansion',
  capture: 'orthographic top-down, same camera for both frames',
  frameSize: 1000,
  view: { center: [-32, -22], size: 34, up: [0, 0, -1] },
  before: {
    bounds: { x0: -45, x1: -23, z0: -26, z1: -8 },
    dimensions: [22, 18],
    bridge: 'hidden',
    note: 'Prior extent reconstructed on the current Wuhu terrain.'
  },
  after: {
    bounds: { x0: -45, x1: -19, z0: -36, z1: -10 },
    dimensions: [26, 26],
    bridge: 'visible',
    note: 'Current authored stage and land bridge.'
  },
  files: {},
  pageErrors: errors
};

async function capture(mode) {
  await page.goto(`${origin}/scripts/_wuhu_topdown_viewer.html?mode=${mode}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__wuhuTopdown?.ready === true || window.__wuhuTopdown?.error,
    null, { timeout: 120_000, polling: 200 });
  const state = await page.evaluate(() => window.__wuhuTopdown);
  if (!state.ready) throw new Error(`${mode}: ${state.error}`);
  await page.waitForTimeout(700);
  const file = resolve(outDir, `${mode}.png`);
  await page.screenshot({ path: file });
  return { state, file };
}

try {
  const before = await capture('before');
  const after = await capture('after');
  const image = await readFile(after.file);
  const beforeImage = await readFile(before.file);
  report.files.before = 'artifacts/environment/arenas/wuhu-expansion/before.png';
  report.files.after = 'artifacts/environment/arenas/wuhu-expansion/after.png';
  report.checks = {
    beforeBridgeHidden: before.state.bridgePresent && before.state.bridgeVisible === false,
    afterBridgeVisible: after.state.bridgePresent && after.state.bridgeVisible === true,
    sameCamera: JSON.stringify(before.state.camera) === JSON.stringify(after.state.camera),
    beforeFrameBytes: beforeImage.length,
    afterFrameBytes: image.length,
    beforeReady: before.state.ready,
    afterReady: after.state.ready
  };

  const comparisonPage = await browser.newPage({ viewport: { width: 1600, height: 1080 }, deviceScaleFactor: 1 });
  await comparisonPage.setContent(`<!doctype html>
  <html><head><meta charset="utf-8"><style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #07141c; color: #eaf7ff;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { padding: 40px 48px 34px; }
    header { display: flex; align-items: end; justify-content: space-between; gap: 28px; margin-bottom: 22px; }
    h1 { margin: 0; font-size: 30px; letter-spacing: -.025em; font-weight: 700; }
    .eyebrow { margin: 0 0 7px; color: #75e5ce; font: 700 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .16em; text-transform: uppercase; }
    .sub { margin: 7px 0 0; color: #9fb7c8; font-size: 13px; }
    .legend { display: flex; gap: 18px; align-items: center; color: #a9bfce; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
    .legend span { display: inline-flex; align-items: center; gap: 7px; }
    .swatch { width: 24px; height: 3px; display: inline-block; border-radius: 2px; }
    .old { background: #ffbd59; } .new { background: #52f0cc; } .bridge { background: #ff5d8f; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
    figure { margin: 0; background: #0c222e; border: 1px solid #1d3a4a; border-radius: 14px; overflow: hidden; }
    .frame { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; }
    figcaption { padding: 16px 18px 17px; }
    .tag { color: #75e5ce; font: 700 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .14em; text-transform: uppercase; }
    h2 { margin: 7px 0 4px; font-size: 19px; letter-spacing: -.015em; }
    .caption { margin: 0; color: #9fb7c8; font-size: 13px; line-height: 1.5; }
    .dim { color: #f4fbff; font-weight: 650; }
    footer { margin-top: 18px; color: #7894a5; font-size: 11.5px; line-height: 1.55; }
    footer strong { color: #a9c2d1; font-weight: 600; }
  </style></head><body><main>
    <header>
      <div><p class="eyebrow">Browser Smash · environment evidence</p>
        <h1>Wuhu Island arena expansion</h1>
        <p class="sub">Same orthographic top-down camera · 34 m frame · north up</p></div>
      <div class="legend"><span><i class="swatch old"></i>old extent</span><span><i class="swatch new"></i>current extent</span><span><i class="swatch bridge"></i>land bridge</span></div>
    </header>
    <div class="row">
      <figure><img class="frame" src="data:image/png;base64,${beforeImage.toString('base64')}" alt="Before: 22 by 18 metre Wuhu stage">
        <figcaption><div class="tag">Before</div><h2>West headland only</h2>
          <p class="caption"><span class="dim">22 × 18 m</span> stage on Wuhu's west shelf. The airport rim and the later land bridge are outside this playable area.</p></figcaption>
      </figure>
      <figure><img class="frame" src="data:image/png;base64,${image.toString('base64')}" alt="After: 26 by 26 metre Wuhu stage with land bridge">
        <figcaption><div class="tag">After</div><h2>Headland + airport rim</h2>
          <p class="caption"><span class="dim">26 × 26 m</span> stage; the grass-and-rock bridge connects Wuhu to the airport's solid western rim. Dashed line = old extent.</p></figcaption>
      </figure>
    </div>
    <footer><strong>Method:</strong> both frames use the current authored GLB and the same camera. The before frame hides <code>mariokart_land_bridge</code> and draws the prior 22×18 m bounds; the after frame draws the current 26×26 m bounds. The before terrain is therefore the same Wuhu geometry with the newer bridge omitted, not a historical re-export.</footer>
  </main></body></html>`, { waitUntil: 'load' });
  await comparisonPage.waitForTimeout(500);
  const comparisonPath = resolve(outDir, 'comparison.png');
  await comparisonPage.screenshot({ path: comparisonPath, fullPage: true });
  report.files.comparison = 'artifacts/environment/arenas/wuhu-expansion/comparison.png';
  report.checks.comparisonWritten = true;
  await writeFile(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    before: report.files.before,
    after: report.files.after,
    comparison: report.files.comparison,
    checks: report.checks,
    pageErrors: report.pageErrors
  }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
