// Vertical-slice baseline capture: the two selected fighters in the selected arena, plus the
// selection screen. Evidence only — it changes no game state and writes PNGs under artifacts/slice/.
//
//   npm run capture:slice
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const SLICE = { p1: 'Wonder Woman', p2: 'Thor', arena: 'asgard' };
const root = process.cwd();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve(root, 'artifacts', 'slice', stamp);
await mkdir(out, { recursive: true });

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"sources":[],"roster":{"launch":[],"manifestKeys":[]}}');
      return;
    }
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) relative = 'public' + sep + relative;
    const file = resolve(root, relative);
    if (!file.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) { res.writeHead(404); res.end('Not found'); } else res.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e.message)));
try {
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running', null, { timeout: 180_000, polling: 250 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(out, '01-selection.png') });

  const staged = await page.evaluate(({ p1, p2, arena }) => {
    const select = window.__browserSmashSelect;
    select?.select('p1', p1);
    select?.select('p2', p2);
    select?.chooseArena?.(arena);
    document.querySelector('#play')?.click();
    return { fighters: (window.fighters || []).map(f => f.name), arena: window.__browserSmashWorld?.location || null };
  }, SLICE);
  await page.waitForTimeout(3500);
  const visibility = [];
  const probe = async label => {
    const shot = await page.evaluate(() => {
      const cam = window.camera || window.smashCamera?.camera;
      if (!cam) return null;
      // THREE is a module import, not a global, so borrow a Vector3 from the camera.
      const scratch = cam.position.clone();
      return (window.fighters || []).map(f => {
        const p = f.model.getWorldPosition(scratch.clone());
        const head = p.clone(); head.y += 1.1;
        const ndc = head.project(cam);
        const feet = p.clone().project(cam);
        return { name: f.name, x: +ndc.x.toFixed(2), y: +ndc.y.toFixed(2), feetY: +feet.y.toFixed(2),
          onScreen: Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && Math.abs(feet.y) <= 1 && ndc.z < 1 };
      });
    });
    visibility.push({ label, shot });
  };
  await probe('spawn');
  await page.screenshot({ path: resolve(out, '02-match.png') });

  // A second frame after the fighters have moved so the capture is not a spawn pose.
  await page.evaluate(() => window.__browserSmashStep?.(1.5));
  await page.waitForTimeout(1200);
  await probe('action');
  await page.screenshot({ path: resolve(out, '03-match-action.png') });

  console.log('slice:', JSON.stringify(SLICE));
  console.log('visibility:', JSON.stringify(visibility));
  console.log('staged:', JSON.stringify(staged));
  console.log('errors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');
  console.log('captures:', out);
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
