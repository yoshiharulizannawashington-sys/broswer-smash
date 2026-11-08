// Capture the CURRENT Naruto model as before-evidence: character select, a real match, and a pose.
//   bash scripts/run-browser-test.sh scripts/capture-naruto-before.mjs
//
// This records what is actually on screen today, at the real game camera, so any future replacement
// can be compared against something honest instead of a description.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'docs/naruto-baseline');
await mkdir(outDir, { recursive: true });

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
    if (['js', 'assets', 'models', 'data'].some(d => relative === d || relative.startsWith(d + sep))) {
      relative = 'public' + sep + relative;
    }
    const body = await readFile(resolve(root, relative));
    res.writeHead(200, { 'Content-Type': mime[extname(relative).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch {
    if (!res.headersSent) { res.writeHead(404); res.end('not found'); } else res.end();
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180_000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e)));
await page.route('https://unpkg.com/three@0.152.2/**', async route => {
  const url = new URL(route.request().url());
  try { await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: await readFile(resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''))) }); }
  catch { await route.fulfill({ status: 404, body: 'missing' }); }
});
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2,
  null, { timeout: 150_000, polling: 250 });

// Character select with Naruto chosen on player 1.
await page.evaluate(() => {
  window.__browserSmashSelect.setMode('2p');
  const cards = [...document.querySelectorAll('#selectScreen .bs-card')];
  (cards.find(c => /naruto/i.test(c.dataset.fighter || '')) || cards[0])?.click();
  (cards.find(c => /naruto/i.test(c.dataset.fighter || '')) || cards[1])?.click();
});
await page.waitForTimeout(1200);
await page.screenshot({ path: resolve(outDir, 'before-select.png') });

await page.click('#selectScreen [data-nav="next"]', { force: true });
const arena = await page.$('#selectScreen .bs-arena[data-arena="valley"]') || await page.$('#selectScreen .bs-arena');
await arena.click({ force: true });
await page.click('#play', { force: true });
await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting', null, { timeout: 40_000, polling: 100 });
await page.waitForTimeout(1500);
await page.screenshot({ path: resolve(outDir, 'before-match.png') });

const identity = await page.evaluate(() => {
  const f = window.fighters[0];
  const j = f?.model?.userData || {};
  let tris = 0, meshes = 0;
  f?.model?.traverse?.(o => {
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    if (g?.index) tris += g.index.count / 3;
    else if (g?.attributes?.position) tris += g.attributes.position.count / 3;
  });
  return {
    fighter: f?.identity, modelName: f?.model?.name,
    characterModelLoaded: !!f?.characterModelLoaded,
    meshes, triangles: Math.round(tris),
    hasRig: !!(j.leftArm && j.leftLeg && j.head),
    materialCount: new Set((() => { const s = new Set(); f?.model?.traverse?.(o => { if (o.isMesh && o.material) s.add(o.material.uuid); }); return [...s]; })()).size,
    autoRotate: j.rotation?.y ?? null
  };
});
// A mid-attack frame for pose evidence.
await page.evaluate(() => {
  const f = window.fighters[0];
  window.__browserSmashInput.keys.KeyJ = true;
  setTimeout(() => { window.__browserSmashInput.keys.KeyJ = false; }, 120);
});
await page.waitForTimeout(700);
await page.screenshot({ path: resolve(outDir, 'before-attack.png') });

await writeFile(resolve(outDir, 'before-model.json'), JSON.stringify({
  generatedAt: new Date().toISOString(), origin: 'live game, public/index.html',
  identity, pageErrors: errors.slice(0, 5),
  note: 'Current model as loaded by the game today. Not a replacement.'
}, null, 2));
console.log('IDENTITY ' + JSON.stringify(identity));
console.log('PAGE_ERRORS ' + errors.length);
await browser.close();
await new Promise(done => server.close(done));
