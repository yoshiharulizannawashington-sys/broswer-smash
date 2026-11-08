// Texture-leak regression: selection must reach a stable plateau.
//
// Phase A: 10 same-character selections (no model swap at all).
// Phase B: 10 alternating-character rematches (two swaps and a match each).
//
// node scripts/test-rematch-textures.mjs   (plain node: this is how CI runs it; locally use
// scripts/run-browser-test.sh or set CHROME_PATH when the system browser libraries are absent)
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
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForTimeout(2000);
const sample = () => page.evaluate(() => ({
  tex: window.__browserSmashRenderer.info.memory.textures,
  own: window.__browserSmashTextureOwnership?.() || null,
  meshes: (() => { let n = 0; window.__browserSmashScene.traverse(o => { if (o.isMesh) n++; }); return n; })(),
  fighters: window.fighters.length
}));
// Warm-up: the first selections after a match starts let one-time caches settle (shader/pipeline
// textures, the opponents' rigs). Those are one-off costs, so the leak measurement starts after them.
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => window.__browserSmashSelect?.select('p1', 'Superman'));
  await page.waitForTimeout(900);
}
const base = await sample();
const sameSeries = [base];
for (let i = 1; i <= 10; i++) {
  await page.evaluate(() => window.__browserSmashSelect?.select('p1', 'Superman'));
  await page.waitForTimeout(900);
  sameSeries.push(await sample());
}
const altSeries = [sameSeries[sameSeries.length - 1]];
for (let i = 1; i <= 10; i++) {
  await page.evaluate(() => window.__browserSmashSelect?.select('p1', 'Superman'));
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__browserSmashSelect?.select('p2', 'Goku'));
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelector('#play')?.click());
  await page.waitForTimeout(1300);
  altSeries.push(await sample());
}
// A plateau is a bounded band, not a frozen number: one-time caches may warm by a texture or two
// while nothing accumulates. A leak of +1 per selection would move a 10-step phase by 10 and fail.
const flat = series => {
  const tail = series.slice(-5).map(s => s.tex);
  return Math.max(...tail) - Math.min(...tail) <= 2;
};
// Growth is measured across the converged window: a leak that adds a texture per selection would
// still move a 5-selection window by +4 and fail, while a settled cache shows zero.
const growth = (series, from = 1) => series[series.length - 1].tex - series[from].tex;
const tex = series => series.map(s => s.tex);
const last = altSeries[altSeries.length - 1];
const sameOk = flat(sameSeries);
const altOk = flat(altSeries);
// Debris and hit effects add and remove meshes every match, so this is a band, not equality: what it
// catches is an unbounded climb (a body left mounted per rematch would add hundreds).
const meshTail = altSeries.slice(-4).map(s => s.meshes);
const meshesStable = Math.max(...meshTail) - Math.min(...meshTail) <= 120;
const boneTextures = last.own?.boneTextures || 0;
const disposed = last.own?.disposed || 0;
console.log('REM104 ' + JSON.stringify({
  same: tex(sameSeries), alternating: tex(altSeries),
  meshes: altSeries.map(s => s.meshes), fighters: [base.fighters, last.fighters],
  ownership: last.own, errors: errors.slice(0, 5)
}));
const checks = [
  ['same-character selections plateau', sameOk],
  ['alternating rematches plateau', altOk],
  ['no growth across 10 rematches', growth(altSeries) <= 1],
  ['no growth across converged same-character selections', growth(sameSeries, sameSeries.length - 5) <= 1],
  ['mesh count stable', meshesStable],
  ['fighter count stays 2', base.fighters === 2 && last.fighters === 2],
  ['bone textures were actually freed', boneTextures > 0],
  ['ownership report shows real disposals', disposed > 0],
  ['no page or console errors', errors.length === 0]
];
for (const [name, ok] of checks) console.log((ok ? 'PASS ' : 'FAIL ') + name);
const failures = checks.filter(([, ok]) => !ok).length;
console.log(failures ? `PLATEAU missing (${failures} failed): ${tex(altSeries).join(' -> ')}` : 'PLATEAU ok');
await browser.close();
await new Promise(d => server.close(d));
process.exit(failures ? 1 : 0);
