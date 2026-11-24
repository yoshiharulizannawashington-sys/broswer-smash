// Street-level evidence that the Asgard dressing reaches the renderer: over-shoulder
// views down the avenue and toward the Bifrost gate, at gameplay camera height.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd();
const out = 'artifacts/compare/20261103-033936/after';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (pathname === '/api/models/sources') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"sources":[],"roster":{"launch":[],"manifestKeys":[]}}'); return; }
    let rel = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel;
    const body = await readFile(resolve(root, rel));
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 180_000, polling: 250 });
await page.evaluate(() => {
  window.__browserSmashFreezeAI = true;
  window.__browserSmashSelect?.select('p1', 'Wonder Woman');
  window.__browserSmashSelect?.select('p2', 'Thor');
  window.__browserSmashSelect?.chooseArena?.('asgard');
});
await page.waitForTimeout(1200);
await page.evaluate(() => document.querySelector('#practice')?.click());
await page.waitForFunction(() => window.__browserSmashAssets?.authoredArena?.status === 'loaded', null, { timeout: 120_000, polling: 250 });
await page.waitForTimeout(3000);
await page.evaluate(() => document.querySelector('#cameraSelect')?.value && null);
await page.evaluate(() => { for (const id of ['#hud', '#training', '#overlay', '#menu', '#controls']) document.querySelector(id)?.classList.add('hidden'); });
const shots = [
  { name: 'asgard-avenue', p1: [0, 26], p2: [0, -30] },
  { name: 'asgard-gate', p1: [0, -34], p2: [0, 34] }
];
for (const shot of shots) {
  const info = await page.evaluate(async s => {
    const f = window.fighters;
    const a = f[0], b = f[1];
    a.root.position.set(s.p1[0], 0.05, s.p1[1]);
    b.root.position.set(s.p2[0], 0.05, s.p2[1]);
    a.body?.position?.copy?.(a.root.position);
    b.body?.position?.copy?.(b.root.position);
    window.smashCamera?.snap?.();
    for (let i = 0; i < 40; i++) window.smashCamera.update(a, b, 0.2, 'explore');
    const c = window.smashCamera.camera;
    return { pos: c.position.toArray().map(v => +v.toFixed(2)), fov: c.fov, mode: window.smashCamera.mode };
  }, shot);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${shot.name}.png` });
  console.log(shot.name, JSON.stringify(info));
}
await browser.close(); server.close();
