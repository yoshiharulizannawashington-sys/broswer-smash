// Captures real in-match frames per arena (not the title screen) and reports the materials the arena
// actually ended up using, so "the texture is applied" is evidence from the running scene rather than
// from the presence of files on disk.
//
// Usage: node scripts/capture-arena-sweep.mjs asgard valley
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const arenas = process.argv.slice(2).filter(a => !a.startsWith('-'));
if (!arenas.length) arenas.push('asgard');
const root = process.cwd();
const out = 'artifacts/hd-sky';
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
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 140)));

for (const arena of arenas) {
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
  await page.waitForFunction(() => window.__browserSmashSkyStatus?.loaded, null, { timeout: 60000, polling: 250 }).catch(() => {});
  // Pick the arena before the match starts: applyMap() runs on the change event, so the lights,
  // exposure and sky are the ones this arena will be fought under.
  await page.evaluate(key => {
    const select = document.querySelector('#menuMapSelect');
    if (!select) return;
    select.value = key;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, arena);
  await page.click('#bbTitle [data-nav="versus"]');
  await page.evaluate(() => {
    window.__browserSmashSelect?.select?.('p1', 'Goku');
    window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki');
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('#play')?.click());
  await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 25000, polling: 200 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const key = (t, c) => window.dispatchEvent(new KeyboardEvent(t, { code: c, key: 'j', bubbles: true }));
    key('keydown', 'KeyJ');
    for (let i = 0; i < 40; i += 1) { window.__browserSmashStep(1 / 60); window.__browserSmashAttackTick?.(); }
    key('keyup', 'KeyJ');
  });
  await page.screenshot({ path: `${out}/${arena}-match.png` });

  const report = await page.evaluate(() => {
    const rows = new Map();
    let meshes = 0;
    const sceneRoots = [window.__browserSmashScene].filter(Boolean);
    for (const scene of sceneRoots) {
      scene.traverse(node => {
        if (!node.isMesh || !node.visible) return;
        meshes += 1;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const m of materials) {
          if (!m) continue;
          const name = m.name || '(unnamed)';
          const row = rows.get(name) || { name, meshes: 0, maps: [], roughness: m.roughness, metalness: m.metalness, emissiveIntensity: m.emissiveIntensity, repeat: null };
          row.meshes += 1;
          row.maps = ['map', 'normalMap', 'roughnessMap', 'aoMap', 'metalnessMap'].filter(k => Boolean(m[k]));
          if (m.map?.repeat) row.repeat = [m.map.repeat.x, m.map.repeat.y];
          rows.set(name, row);
        }
      });
    }
    return {
      sky: window.__browserSmashSkyStatus || null,
      exposure: window.__browserSmashRenderer?.toneMappingExposure ?? null,
      sun: window.__browserSmashSun?.intensity ?? null,
      tuned: window.__browserSmashAsgardTuning ?? null,
      meshes,
      materials: [...rows.values()].filter(r => /asgard|rock|stone|marble|floor|tile|wall|concrete|metal|gold|bronze/i.test(r.name) || r.maps.length)
    };
  });
  console.log('ARENA', JSON.stringify({ arena, ...report, errors: errors.slice(-4) }));
  errors.length = 0;
}
await browser.close(); server.close();
