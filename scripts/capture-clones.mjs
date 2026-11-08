// Visual check that Shadow Clone Jutsu still renders after the performance fix (shared materials,
// frustum culling enabled): starts a real match and photographs the summoned clones.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/clones';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.waitForTimeout(500);
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Naruto Uzumaki');
  window.__browserSmashSelect?.select?.('p2', 'Goku');
});
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 25000, polling: 200 });
await page.waitForTimeout(1800);

const state = await page.evaluate(() => {
  const t0 = performance.now();
  const created = window.spawnShadowClones(window.fighters[0], 2);
  const spawnMs = performance.now() - t0;
  // Frame the duel so both clones and the fighters are in shot.
  window.smashCamera?.focus?.(window.fighters[0], { seconds: .6, zoom: .1 });
  return { created, spawnMs: +spawnMs.toFixed(1), clones: window.__browserSmashClones?.() || null };
});
await page.waitForTimeout(2200);
const after = await page.evaluate(() => {
  const report = window.smashCamera?.report?.(window.fighters[0], window.fighters[1]) || null;
  const clones = window.__browserSmashClones?.() || null;
  const visible = (clones?.clones || []).filter(c => {
    const box = window.__browserSmashThree?.Box3;
    return Boolean(c.position);
  }).length;
  return { clones, visible, fightersOnScreen: report?.fighters?.map(f => f.bounds?.onScreen) || null };
});
await page.screenshot({ path: `${out}/shadow-clones.png` });
await writeFile(`${out}/clones-visual.json`, JSON.stringify({ state, after, errors }, null, 2));
console.log('CLONES', JSON.stringify({ state, after, errors }));
await browser.close(); server.close();
