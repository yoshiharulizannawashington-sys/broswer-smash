// Drives a real match toward the Rock030 surface and captures it at gameplay distance.
// The camera is never touched: the player walks, the follow camera does the rest. Each checkpoint
// records which surface is under the crosshair and how far away it is, so the close-up frames are
// tied to a measured surface instead of an assumption about where the stone should be.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/asgard-stone';
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

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.evaluate(() => { const s = document.querySelector('#menuMapSelect'); s.value = 'asgard'; s.dispatchEvent(new Event('change', { bubbles: true })); });
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => { window.__browserSmashSelect?.select?.('p1', 'Goku'); window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki'); });
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 25000, polling: 200 });
await page.waitForTimeout(2500);

await page.evaluate(() => {
  const T = window.__browserSmashThree;
  window.__stoneProbe = () => {
    const camera = window.smashCamera?.camera;
    const scene = window.__browserSmashScene;
    const raycaster = new T.Raycaster();
    const visible = object => { for (let n = object; n; n = n.parent) if (n.visible === false) return false; return true; };
    const sample = (x, y) => {
      raycaster.setFromCamera(new T.Vector2(x, y), camera);
      raycaster.far = 4000;
      const hit = raycaster.intersectObjects(scene.children, true)
        .filter(h => h.object.isMesh && visible(h.object))
        .find(h => {
          const m = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material;
          return !m || (!m.transparent && (m.opacity ?? 1) >= 0.9);
        });
      if (!hit) return null;
      const m = Array.isArray(hit.object.material) ? hit.object.material[0] : hit.object.material;
      return { mesh: hit.object.name || '(unnamed)', material: m?.name || '(unnamed)', distance: +hit.distance.toFixed(2) };
    };
    return { camera: camera.position.toArray().map(v => +v.toFixed(2)), centre: sample(0, 0), ground: sample(0, -0.6), left: sample(-0.5, -0.35), right: sample(0.5, -0.35) };
  };
});

const log = [];
const shots = [];
for (let step = 0; step < 8; step += 1) {
  const sample = await page.evaluate(() => window.__stoneProbe());
  log.push({ step, ...sample });
  if (step === 0 || sample.centre?.material?.includes('warm stone') || step === 7) {
    const file = `${out}/closeup-${String(step).padStart(2, '0')}.png`;
    await page.screenshot({ path: file });
    shots.push(file);
  }
  if ((sample.centre?.distance ?? 999) < 6 && sample.centre?.material?.includes('warm stone')) break;
  await page.keyboard.down('w');
  await page.waitForTimeout(900);
  await page.keyboard.up('w');
  await page.waitForTimeout(250);
}

await writeFile(`${out}/closeup-log.json`, JSON.stringify(log, null, 2));
for (const entry of log) console.log(`  step ${entry.step}  centre=${entry.centre?.material}@${entry.centre?.distance}  ground=${entry.ground?.material}@${entry.ground?.distance}  cam=${entry.camera}`);
console.log('SHOTS ' + shots.join(' '));
await browser.close(); server.close();
