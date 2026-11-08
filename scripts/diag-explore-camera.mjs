// Does the explore camera respond to a look drag, and when?
//   bash scripts/run-browser-test.sh scripts/diag-explore-camera.mjs
//
// test-explore turns the camera, steps 0.4 s, and requires the camera POSITION to move > 0.2 m.
// That measures the residual left after settling, not whether the camera responded. This records the
// before-drag, post-drag and post-step positions so the question is answered with numbers.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sources: [], roster: { launch: [], manifestKeys: [] } }));
      return;
    }
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => relative === d || relative.startsWith(d + sep))) relative = 'public' + sep + relative;
    const body = await readFile(resolve(root, relative));
    res.writeHead(200, { 'Content-Type': mime[extname(relative).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch {
    if (!res.headersSent) { res.writeHead(404); res.end('not found'); } else res.end();
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(180_000);
await page.route('https://unpkg.com/three@0.152.2/**', async route => {
  const url = new URL(route.request().url());
  try { await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
    body: await readFile(resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''))) }); }
  catch { await route.fulfill({ status: 404, body: 'missing' }); }
});
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
  && window.__browserSmashStep && window.fighters?.length === 2, null, { timeout: 150_000, polling: 200 });
await page.evaluate(() => window.__browserSmashSelect.chooseArena('dbz_main_entrance'));
await page.evaluate(() => window.__browserSmashExplore());
await page.evaluate(() => window.smashCamera.resetOrbit());

const state = () => page.evaluate(() => window.__browserSmashExploreState());
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

const before = await state();
const box = await page.locator('#gl').boundingBox();
const cx = box.x + box.width * .5, cy = box.y + box.height * .5;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 160, cy, { steps: 6 });
await page.mouse.up();
// Immediately after the drag, before any deliberate settling step.
await page.waitForTimeout(80);
const afterDrag = await state();
await page.evaluate(() => window.__browserSmashStep(.4));
const afterStep = await state();

const out = {
  beforeDrag: before.cameraPosition,
  afterDrag: afterDrag.cameraPosition,
  afterStep: afterStep.cameraPosition,
  yawBefore: before.orbitYaw, yawAfterDrag: afterDrag.orbitYaw, yawAfterStep: afterStep.orbitYaw,
  movedDuringDrag: +dist(before.cameraPosition, afterDrag.cameraPosition).toFixed(4),
  movedAfterStep: +dist(afterDrag.cameraPosition, afterStep.cameraPosition).toFixed(4),
  yawDelta: +(afterDrag.orbitYaw - before.orbitYaw).toFixed(4)
};
console.log('EXPLORE_CAMERA ' + JSON.stringify(out));
await browser.close();
await new Promise(done => server.close(done));
