// Creation trace: which call site allocates the textures that survive a selection?
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
await page.evaluate(() => {
  window.__texLog = [];
  const tag = (stack) => String(stack).split('\n').slice(2)
    .map(l => l.replace(/^\s*at\s+/, '').replace(/https?:\/\/[^/]+\//g, '').replace(/\(.*\)$/, ''))
    .filter(l => !/three|node_modules|webgl|WebGL/i.test(l)).slice(0, 4).join(' < ');
  const create = document.createElement.bind(document);
  document.createElement = function (t, ...rest) {
    const el = create(t, ...rest);
    if (String(t).toLowerCase() === 'canvas') window.__texLog.push({ k: 'canvas', size: el.width + 'x' + el.height, at: tag(new Error().stack) });
    return el;
  };
  const gl = window.__browserSmashRenderer.getContext();
  const upload = gl.texImage2D.bind(gl);
  gl.texImage2D = function (...a) {
    if (a.length >= 6) window.__texLog.push({ k: 'upload', w: a[3], h: a[4], at: tag(new Error().stack) });
    return upload(...a);
  };
});
const tex = () => page.evaluate(() => window.__browserSmashRenderer.info.memory.textures);
const rows = [];
await page.evaluate(() => { window.__texLog.length = 0; });
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForTimeout(1800); rows.push({ step: 'play', tex: await tex(), log: await page.evaluate(() => window.__texLog.splice(0)) });
for (let i = 1; i <= 3; i++) {
  await page.evaluate(() => window.__browserSmashSelect?.select('p1', 'Superman'));
  await page.waitForTimeout(1400);
  rows.push({ step: 'select-' + i, tex: await tex(), log: await page.evaluate(() => window.__texLog.splice(0)) });
}
const agg = {};
for (const r of rows) for (const e of r.log) {
  const key = e.k + ' ' + (e.size || (e.w + 'x' + e.h)) + ' ' + e.at;
  agg[key] = (agg[key] || 0) + 1;
}
console.log('CREATION ' + JSON.stringify({ tex: rows.map(r => r.tex), agg }));
await browser.close();
await new Promise(d => server.close(d));
