// Render a close-up orthographic top-down of the authored Wuhu land bridge and Sunshine Airport
// rim. This uses the existing GLB viewer, which keeps the bridge, terrain and airport geometry
// cleanly separated from the match HUD and the runtime shelf overlay.
//
//   bash scripts/run-browser-test.sh scripts/capture-wuhu-bridge-rim-source.mjs
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
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.hdr': 'image/vnd.radiance', '.wasm': 'application/wasm'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const relative = normalize(pathname).replace(/^[/\\\\]+/, '') || 'index.html';
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
page.on('console', message => {
  if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
    errors.push('console: ' + message.text().slice(0, 240));
  }
});
page.on('response', response => {
  if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`);
});

const query = new URLSearchParams({
  mode: 'after', detail: 'bridge', cutaway: 'airport', center: '-20.6,-35.25', size: '15'
});
const report = {
  title: 'Wuhu land bridge and airport rim · close-up top-down',
  file: 'artifacts/environment/arenas/wuhu-expansion/bridge-rim-topdown.png',
  capture: 'authored mariokart GLB, orthographic top-down, airport cutaway detail frame',
  view: { center: [-20.6, -35.25], size: 15, up: [0, 0, -1] },
  pageErrors: errors
};

try {
  await page.goto(`${origin}/scripts/_wuhu_topdown_viewer.html?${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__wuhuTopdown?.ready === true || window.__wuhuTopdown?.error,
    null, { timeout: 120_000, polling: 200 });
  const state = await page.evaluate(() => window.__wuhuTopdown);
  if (!state.ready) throw new Error(state.error || 'viewer failed to load');
  await page.waitForTimeout(700);
  const file = resolve(outDir, 'bridge-rim-topdown.png');
  await page.screenshot({ path: file, timeout: 120_000 });
  report.bridgeBox = state.bridgeBox;
  report.camera = state.camera;
  report.sceneBounds = state.sceneBounds;
  report.checks = {
    bridgePresent: state.bridgePresent,
    bridgeVisible: state.bridgeVisible,
    detailView: state.detail,
    bridgeInFrame: Boolean(state.bridgeBox?.min && state.bridgeBox.max[0] > -28.1
      && state.bridgeBox.min[0] < -13.1 && state.bridgeBox.max[2] > -42.75
      && state.bridgeBox.min[2] < -27.75),
    airportCutaway: state.cutaway === true,
    frameBytes: (await readFile(file)).length
  };
  await writeFile(resolve(outDir, 'bridge-rim-topdown.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ file: report.file, checks: report.checks, bridgeBox: report.bridgeBox, pageErrors: report.pageErrors }, null, 2));
  if (!Object.values(report.checks).every(Boolean) || errors.length) process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
