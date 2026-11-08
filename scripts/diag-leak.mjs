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
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2,
  null, { timeout: 150000, polling: 250 });
const snap = () => page.evaluate(() => {
  const r = window.__browserSmashRenderer;
  return { tex: r.info.memory.textures, geo: r.info.memory.geometries,
    fighters: (window.fighters || []).length,
    scenes: window.__browserSmashScene.children.length,
    own: window.__browserSmashTextureOwnership?.() || null };
});
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForTimeout(2000);
const rows = [Object.assign({ step: 'after-play' }, await snap())];
for (let i = 1; i <= 4; i++) {
  await page.evaluate(() => {
    window.__browserSmashSelect?.select('p1', 'Superman');
    window.__browserSmashSelect?.select('p2', 'Goku');
    document.querySelector('#play')?.click();
  });
  await page.waitForTimeout(1400);
  rows.push(Object.assign({ step: 'rematch-' + i }, await snap()));
}
console.log('LEAK ' + JSON.stringify(rows, null, 1));
await browser.close();
await new Promise(d => server.close(d));
