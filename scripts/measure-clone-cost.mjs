// Measures the cost of casting Shadow Clone Jutsu: how long the spawn blocks the main thread and
// how much material/geometry churn it creates. Run before and after a change to compare.
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
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 20000, polling: 200 });
await page.waitForTimeout(1500);

const measurement = await page.evaluate(() => {
  const countMeshes = root => { let meshes = 0; root?.traverse?.(n => { if (n.isMesh) meshes += 1; }); return meshes; };
  const materialIds = root => {
    const ids = new Set();
    root?.traverse?.(n => {
      if (!n.isMesh) return;
      for (const m of (Array.isArray(n.material) ? n.material : [n.material])) if (m) ids.add(m.uuid);
    });
    return ids.size;
  };
  const owner = window.fighters[0];
  const before = { meshes: countMeshes(owner.model), materials: materialIds(owner.model) };
  const t0 = performance.now();
  const created = window.spawnShadowClones(owner, 2);
  const t1 = performance.now();
  return { created, spawnMs: +(t1 - t0).toFixed(1), ownerMeshes: before.meshes, ownerMaterials: before.materials, clones: window.__browserSmashClones?.() || null };
});

// A second cast after the first pack is cleaned up measures the steady-state cost rather than the
// cold first-use cost (shader/program setup).
await page.waitForTimeout(1200);
const second = await page.evaluate(() => {
  const owner = window.fighters[0];
  const t0 = performance.now();
  const created = window.spawnShadowClones(owner, 1);
  const t1 = performance.now();
  return { created, spawnMs: +(t1 - t0).toFixed(1) };
});

await writeFile(`${out}/clone-cost.json`, JSON.stringify({ measurement, second, errors }, null, 2));
console.log('CLONECOST', JSON.stringify({ measurement, second, errors }));
await browser.close(); server.close();
