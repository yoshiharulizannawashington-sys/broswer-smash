// Which arena actually reaches the running scene for an Asgard match, and does it contain
// the dressing added to the authored GLB (market stalls, braziers, inlays, horizon towers)?
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.bin': 'application/octet-stream' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (pathname === '/api/models/sources') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"sources":[],"roster":{"launch":[],"manifestKeys":[]}}'); return; }
    let rel = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel;
    const file = resolve(root, rel);
    if (!file.startsWith(root + sep)) { res.writeHead(403); res.end('no'); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) { res.writeHead(404); res.end('nf'); } else res.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const glbs = [];
page.on('request', r => { if (r.url().includes('.glb')) glbs.push(decodeURIComponent(r.url()).split('/').pop().slice(0, 60)); });
const errors = [];
page.on('pageerror', e => errors.push(String(e.message)));
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 180_000, polling: 250 });
await page.evaluate(() => {
  window.__browserSmashFreezeAI = true;
  window.__browserSmashSelect?.select('p1', 'Wonder Woman');
  window.__browserSmashSelect?.select('p2', 'Thor');
  window.__browserSmashSelect?.chooseArena?.('asgard');
});
await page.waitForTimeout(1500);
await page.evaluate(() => { document.querySelector('#practice')?.click(); });
await page.waitForTimeout(14000);
const info = await page.evaluate(() => {
  const A = window.__browserSmashAssets || {};
  const words = ['market', 'brazier', 'inlay', 'kerb', 'horizon', 'banner', 'architrave', 'gate pier'];
  const counts = {};
  let total = 0, dressing = 0;
  const scene = A.app?.scene;
  const walk = o => {
    if (o.isMesh) {
      total++;
      const n = (o.name || '').toLowerCase();
      const hit = words.find(w => n.includes(w));
      if (hit) { dressing++; counts[hit] = (counts[hit] || 0) + 1; }
    }
    o.children.forEach(walk);
  };
  if (scene) walk(scene);
  return {
    meshTotal: total, dressingMeshes: dressing, dressingByWord: counts,
    authoredArena: A.authoredArena || null,
    arenas: A.arenas ? Object.fromEntries(Object.entries(A.arenas).map(([k, v]) => [k, { status: v.status, meshCount: v.meshCount }])) : null,
    world: window.__browserSmashWorld || null
  };
});
console.log(JSON.stringify({ requests: [...new Set(glbs)], errors, ...info }, null, 1));
await browser.close(); server.close();
