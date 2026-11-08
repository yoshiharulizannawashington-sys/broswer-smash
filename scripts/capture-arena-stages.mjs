// Clean per-stage captures for the exploration audit: switch stage, let the camera settle, seat both
// fighters on the stage's own spawns, then shoot. No teleports, so the framing is the real one.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/arena-exploration';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
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
await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.waitForTimeout(400);
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Goku');
  window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki');
  window.__browserSmashTrainingDummy = true;
  window.__browserSmashFreezeAI = true;
});
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
await page.waitForTimeout(1400);

for (const key of ['asgard', 'hogwarts', 'deathstar', 'tournament', 'starktower']) {
  await page.evaluate(k => {
    const select = document.querySelector('#mapSelect');
    if (select) { select.value = k; select.dispatchEvent(new Event('change')); }
    window.__browserSmashApplyMap(k);
  }, key);
  await page.waitForTimeout(2600);
  const posed = await page.evaluate(() => {
    const layout = window.__browserSmashLayout();
    const spawns = layout.spawns || [];
    window.fighters.forEach((f, index) => {
      const spawn = spawns[index] || spawns[0];
      f.position.set(spawn.x, spawn.y ?? 0, spawn.z);
      f.velocity.set(0, 0, 0); f.hitstun = 0; f.guardBreak = 0; f.isGrounded = true;
      f.attackQueue.length = 0; f.flightMode = false;
    });
    const meshes = (() => { let n = 0; window.__browserSmashScene?.traverse(o => { if (o.isMesh) n += 1; }); return n; })();
    return { label: layout.label, meshes, fit: window.smashCamera?.describeShot?.() || null };
  });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${out}/stage-${key}.png` });
  console.log('SHOT', key, JSON.stringify(posed));
}
await browser.close(); server.close();
