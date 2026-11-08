// Current-state check for the reported "black fighters / black sky": captures the title screen and
// real matches for two arenas, and dumps the renderer background/environment plus representative
// fighter materials from the live scene, so the cause is measured rather than guessed.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/black-check';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.hdr': 'image/vnd.radiance', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
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
const missing = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
page.on('response', r => { if (r.status() >= 400) missing.push(r.status() + ' ' + new URL(r.url()).pathname); });

const probe = () => page.evaluate(() => {
  const scene = window.__browserSmashScene;
  const renderer = window.__browserSmashRenderer;
  const bg = scene.background;
  const materials = [];
  for (const f of window.fighters || []) {
    const seen = new Set();
    f.model?.traverse?.(n => {
      if (!n.isMesh || materials.length > 14) return;
      const m = Array.isArray(n.material) ? n.material[0] : n.material;
      if (!m || seen.has(m.uuid)) return;
      seen.add(m.uuid);
      materials.push({
        fighter: f.identity, name: m.name || '(unnamed)', type: m.type,
        color: m.color ? '#' + m.color.getHexString() : null,
        emissive: m.emissive ? '#' + m.emissive.getHexString() : null,
        metalness: m.metalness ?? null, roughness: m.roughness ?? null,
        map: Boolean(m.map), mapSpace: m.map?.colorSpace || null, envMap: Boolean(m.envMap)
      });
    });
  }
  return {
    background: bg ? (bg.isTexture ? 'texture' : 'color:#' + bg.getHexString()) : 'null',
    backgroundSpace: bg?.isTexture ? bg.colorSpace : null,
    environment: scene.environment ? (scene.environment.isCubeTexture ? 'cube' : 'texture') : 'null',
    exposure: renderer.toneMappingExposure,
    toneMapping: renderer.toneMapping,
    output: renderer.outputColorSpace,
    sun: window.__browserSmashSun?.intensity ?? null,
    sky: window.__browserSmashSkyStatus || null,
    materials
  };
});

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.waitForFunction(() => window.__browserSmashSkyStatus?.loaded, null, { timeout: 60000, polling: 250 }).catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/01-title-valley.png` });
const title = await probe();

await page.evaluate(() => { const s = document.querySelector('#menuMapSelect'); s.value = 'asgard'; s.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/02-title-asgard.png` });

await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => { window.__browserSmashSelect?.select?.('p1', 'Goku'); window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki'); });
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 25000, polling: 200 });
await page.waitForTimeout(3000);
await page.evaluate(() => {
  const k = (t, c) => window.dispatchEvent(new KeyboardEvent(t, { code: c, key: 'j', bubbles: true }));
  k('keydown', 'KeyJ');
  for (let i = 0; i < 40; i += 1) { window.__browserSmashStep(1 / 60); window.__browserSmashAttackTick?.(); }
  k('keyup', 'KeyJ');
});
await page.screenshot({ path: `${out}/03-match-asgard.png` });
const asgard = await probe();

await page.evaluate(() => { const s = document.querySelector('#mapSelect'); s.value = 'valley'; s.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/04-match-valley.png` });
const valley = await probe();

await writeFile(`${out}/report.json`, JSON.stringify({ title, asgard, valley, errors, missing: [...new Set(missing)] }, null, 2));
console.log('BLACKCHECK', JSON.stringify({
  title: { background: title.background, backgroundSpace: title.backgroundSpace, environment: title.environment, exposure: title.exposure, sky: title.sky?.source, sample: title.materials.slice(0, 4) },
  asgard: { background: asgard.background, exposure: asgard.exposure, sun: asgard.sun, sample: asgard.materials.slice(0, 4) },
  valley: { background: valley.background, exposure: valley.exposure, sample: valley.materials.slice(0, 3) },
  errors: errors.slice(-4),
  missing: [...new Set(missing)].slice(0, 6)
}));
await browser.close(); server.close();
