// Identity-level leak proof: every texture creation and disposal is logged with its UUID and stack,
// then three controlled comparisons run (normal / shadow-map recreation forced / preset reapplied).
// No source switch is added for this: the shadow and preset comparisons are driven from the page.
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
const errors = [];
page.on('pageerror', e => errors.push(String(e.message)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
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
  scene.traverse(o => { const arr = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of arr) { if (sample) return; for (const k of ['map', 'normalMap']) if (m[k]?.isTexture) { sample = m[k]; return; } } });
  if (!sample) return 'no-sample';
  let proto = Object.getPrototypeOf(sample);
  while (proto && proto.constructor?.name !== 'Texture') proto = Object.getPrototypeOf(proto);
  if (!proto) return 'no-proto';
  window.__texLog = [];
  const clean = s => String(s).split('\n').slice(2).map(l => l.trim().replace(/^at\s+/, '').replace(/https?:\/\/[^/]+\//g, ''))
    .filter(l => !/node_modules|webgl|WebGL|playwright|eval at/i.test(l)).slice(0, 3).join(' < ');
  Object.defineProperty(proto, 'uuid', {
    configurable: true,
    get() { return this.__uuidValue; },
    set(v) {
      if (this.__uuidValue === undefined) {
        this.__uuidValue = v;
        window.__texLog.push({ ev: 'create', uuid: v, type: this.constructor?.name || 'Texture', stack: clean(new Error().stack) });
      } else this.__uuidValue = v;
    }
  });
  const dispose = proto.dispose;
  proto.dispose = function () {
    window.__texLog.push({ ev: 'dispose', uuid: this.__uuidValue, type: this.constructor?.name || 'Texture' });
    return dispose.call(this);
  };
  return 'installed';
});
const snap = () => page.evaluate(() => {
  const sun = window.__browserSmashSun;
  const live = [];
  for (const fighter of window.fighters) {
    let skinned = 0, bone = 0, maps = 0, materials = 0;
    fighter.model?.traverse?.(o => {
      if (o.skeleton) { skinned++; if (o.skeleton.boneTexture) bone++; }
      const arr = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of arr) { materials++; for (const k of ['map', 'normalMap', 'roughnessMap']) if (m[k]?.isTexture) maps++; }
    });
    live.push({ name: fighter.name, skinned, bone, maps, materials });
  }
  return {
    tex: window.__browserSmashRenderer.info.memory.textures,
    shadow: { has: Boolean(sun?.shadow?.map), size: sun?.shadow?.mapSize?.x ?? null, mapUuid: sun?.shadow?.map?.texture?.uuid ?? null },
    shadowEnabled: window.__browserSmashRenderer.shadowMap.enabled,
    live
  };
});
const rows = [];
const run = async (name, action) => {
  await page.evaluate(() => { window.__texLog.length = 0; });
  const before = await snap();
  if (action) await page.evaluate(action);
  await page.waitForTimeout(1600);
  const log = await page.evaluate(() => window.__texLog.splice(0));
  rows.push({ name, before, after: await snap(), created: log.filter(e => e.ev === 'create'), disposed: log.filter(e => e.ev === 'dispose') });
};
// Warm-up so one-time caches settle before any measurement.
for (let i = 0; i < 3; i++) { await page.evaluate(() => window.__browserSmashSelect?.select('p1', 'Superman')); await page.waitForTimeout(800); }
await run('A1-normal-select', () => window.__browserSmashSelect?.select('p1', 'Superman'));
await run('A2-normal-select', () => window.__browserSmashSelect?.select('p2', 'Goku'));
await run('A3-normal-select', () => window.__browserSmashSelect?.select('p1', 'Superman'));
await run('B1-shadow-map-disposed', () => { const s = window.__browserSmashSun; s.shadow.map?.dispose(); s.shadow.map = null; });
await run('B2-shadow-map-disposed', () => { const s = window.__browserSmashSun; s.shadow.map?.dispose(); s.shadow.map = null; });
await run('C1-preset-reapplied', () => window.setGraphicsPreset?.('medium'));
await run('C2-preset-reapplied', () => window.setGraphicsPreset?.('medium'));
console.log('IDENTITY ' + JSON.stringify({ installed, errors: errors.slice(0, 4), rows }));
await browser.close();
await new Promise(d => server.close(d));
