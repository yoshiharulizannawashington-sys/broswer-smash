// Texture allocation stacks: every THREE.Texture constructed during selection is logged with the
// app call site that built it. WebGL2 uses texStorage2D/texSubImage2D, so the old texImage2D hook
// (diag-leak-create) could not see these.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (p === '/api/models/sources') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"sources":[],"roster":{"launch":[],"manifestKeys":[]}}'); return; }
    let rel = normalize(p).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel;
    const body = await readFile(resolve(root, rel));
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) { res.writeHead(404); res.end('n'); } else res.end(); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.setDefaultTimeout(180000);
await page.route('https://unpkg.com/three@0.152.2/**', async route => {
  const url = new URL(route.request().url());
  try { await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
    body: await readFile(resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''))) }); }
  catch { await route.fulfill({ status: 404, body: 'm' }); }
});
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
const installed = await page.evaluate(() => {
  const scene = window.__browserSmashScene;
  let sample = null;
  scene.traverse(o => { const m = o.material; const arr = Array.isArray(m) ? m : (m ? [m] : []); for (const x of arr) { if (!sample) for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap']) if (x[k]?.isTexture) { sample = x[k]; break; } } });
  if (!sample) return 'no-sample-texture';
  let proto = Object.getPrototypeOf(sample);
  while (proto && proto.constructor?.name !== 'Texture') proto = Object.getPrototypeOf(proto);
  if (!proto) return 'no-texture-proto';
  window.__texCreate = [];
  const clean = s => String(s).split('\n').slice(1).map(l => l.trim().replace(/^at\s+/, ''))
    .filter(l => !/three|node_modules|webgl|WebGL|playwright/i.test(l))
    .slice(0, 5).join(' < ');
  Object.defineProperty(proto, 'uuid', {
    configurable: true,
    get() { return this.__uuidValue; },
    set(v) {
      if (this.__uuidValue === undefined) {
        this.__uuidValue = v;
        window.__texCreate.push({ type: this.constructor?.name || 'Texture', stack: clean(new Error().stack), raw: String(new Error().stack).split('\n').slice(1, 9).join(' | ') });
      } else this.__uuidValue = v;
    }
  });
  return 'installed';
});
const tex = () => page.evaluate(() => window.__browserSmashRenderer.info.memory.textures);
const drain = () => page.evaluate(() => window.__texCreate.splice(0));
const rows = [];
const step = async (name, fn) => {
  await page.evaluate(() => { window.__texCreate.length = 0; });
  const before = await tex();
  if (fn) await page.evaluate(fn);
  await page.waitForTimeout(1500);
  const made = await drain();
  rows.push({ step: name, before, after: await tex(), created: made });
};
await step('start', null);
await step('select-p1-Superman', () => window.__browserSmashSelect?.select('p1', 'Superman'));
await step('select-p2-Goku', () => window.__browserSmashSelect?.select('p2', 'Goku'));
await step('reselect-p2-Goku', () => window.__browserSmashSelect?.select('p2', 'Goku'));
await step('enter-match', () => document.querySelector('#play')?.click());
await step('reselect-p2-Goku-in-match', () => window.__browserSmashSelect?.select('p2', 'Goku'));
console.log('STACKS ' + JSON.stringify({ installed, rows }));
await browser.close();
await new Promise(d => server.close(d));
