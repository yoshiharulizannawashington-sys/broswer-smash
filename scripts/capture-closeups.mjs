// Close-up evidence for the slice fighters, through the game's own spectator camera.
//   npm run capture:closeups
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const SLICE = { p1: 'Wonder Woman', p2: 'Thor', arena: 'asgard' };
const FRAMINGS = ['torso', 'head', 'hands'];
const root = process.cwd();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve(root, 'artifacts', 'slice', stamp + '-closeups');
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
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e.message)));
try {
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 180_000, polling: 250 });
  await page.evaluate(({ p1, p2, arena }) => {
    window.__browserSmashFreezeAI = true;
    window.__browserSmashSelect?.select('p1', p1);
    window.__browserSmashSelect?.select('p2', p2);
    window.__browserSmashSelect?.chooseArena?.(arena);
    document.querySelector('#play')?.click();
  }, SLICE);
  await page.waitForTimeout(3000);
  const written = [];
  for (const side of [0, 1]) {
    for (const framing of FRAMINGS) {
      const info = await page.evaluate(({ side, framing }) => {
        const camera = window.smashCamera || window.__browserSmashCamera;
        if (!camera?.spectate) return { ok: false, reason: 'no spectate api' };
        const fighter = window.fighters?.[side];
        camera.spectate({ fighter, framing, yaw: side === 0 ? 24 : -24, pitch: -4 });
        return { ok: true, name: fighter?.name, state: camera.describeSpectate?.() || null };
      }, { side, framing });
      if (!info.ok) { console.log('spectate unavailable:', info.reason); break; }
      await page.waitForTimeout(900);
      const file = resolve(out, `${side === 0 ? 'p1' : 'p2'}-${(info.name || '').replace(/\W+/g, '-').toLowerCase()}-${framing}.png`);
      await page.screenshot({ path: file });
      written.push(`${file.split('/').slice(-1)[0]} (${info.name})`);
    }
    await page.evaluate(() => (window.smashCamera || window.__browserSmashCamera)?.endSpectate?.());
  }
  console.log('captured:', written.length ? written.join(', ') : 'nothing');
  console.log('errors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');
  console.log('dir:', out);
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
