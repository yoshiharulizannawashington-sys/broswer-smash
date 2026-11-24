// Identify the +1 texture per character selection by diffing attached texture uuids.
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
const scan = () => page.evaluate(() => {
  const out = {}; const tex = window.__browserSmashRenderer.info.memory.textures;
  const scene = window.__browserSmashScene;
  scene.traverse(node => {
    if (!node.isMesh || !node.material) return;
    for (const m of (Array.isArray(node.material) ? node.material : [node.material])) {
      for (const [slot, v] of Object.entries(m)) {
        if (!v || !v.isTexture) continue;
        (out[v.uuid] ||= []).push({ slot, mat: m.name || '(unnamed)', mesh: node.name || '(unnamed)', type: v.type, src: (v.image?.src || v.image?.width) ? 'img' : 'none' });
      }
    }
  });
  return { tex, attached: out };
});
const diff = (a, b) => ({ added: Object.keys(b).filter(k => !a[k]), removed: Object.keys(a).filter(k => !b[k]) });
const snaps = [];
snaps.push(await scan());
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForTimeout(1800); snaps.push(await scan());
const report = [];
for (const who of ['Superman', 'Superman', 'Superman', 'Superman']) {
  await page.evaluate(n => window.__browserSmashSelect?.select('p1', n), who);
  await page.waitForTimeout(1400); snaps.push(await scan());
  const d = diff(snaps[snaps.length - 2].attached, snaps[snaps.length - 1].attached);
  report.push({ after: who, tex: snaps[snaps.length - 1].tex, added: d.added.map(k => snaps[snaps.length - 1].attached[k][0]), removed: d.removed.length });
}
console.log('TEXTUREDIFF ' + JSON.stringify({ tex: snaps.map(s => s.tex), report }));
await browser.close();
await new Promise(d => server.close(d));
