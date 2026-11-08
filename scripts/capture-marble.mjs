// Asgard marble evidence: a wide match frame, then the player walks to the palace wall and the
// script keeps the first frame that is genuinely a marble close-up (crosshair on the marble material
// at a few metres). Also records console errors and failed requests so a texture change cannot hide
// a 404 behind a pretty screenshot.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const ARENA = process.env.ARENA || 'asgard';
const PHASE = process.env.PHASE || 'before';
const root = process.cwd();
const out = 'artifacts/marble';
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
const failed = [];
const textures = new Set();
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
page.on('requestfailed', r => failed.push({ url: r.url().split('/').pop(), error: r.failure()?.errorText }));
page.on('response', r => {
  const name = r.url().split('/').pop().split('?')[0];
  if (/\.(jpg|jpeg|png|hdr)$/i.test(name)) textures.add(`${r.status()} ${name}`);
});

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.evaluate(key => {
  const select = document.querySelector('#menuMapSelect');
  if (select) { select.value = key; select.dispatchEvent(new Event('change', { bubbles: true })); }
}, ARENA);
await page.waitForTimeout(700);
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Goku');
  window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki');
});
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 25000, polling: 200 });
await page.waitForTimeout(2500);

await page.evaluate(() => {
  const T = window.__browserSmashThree;
  window.__marbleProbe = () => {
    const camera = window.smashCamera?.camera;
    const scene = window.__browserSmashScene;
    const raycaster = new T.Raycaster();
    const visible = o => { for (let n = o; n; n = n.parent) if (n.visible === false) return false; return true; };
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
    return { centre: sample(0, 0), left: sample(-0.4, 0.1), right: sample(0.4, 0.1) };
  };
});

const wide = `${out}/${ARENA}-${PHASE}-wide.png`;
await page.screenshot({ path: wide });
const log = { arena: ARENA, phase: PHASE, wide, steps: [], closeup: null, closeupHit: null, textures: [], errors, failed };

if (ARENA === 'asgard') {
  for (let step = 0; step < 9; step += 1) {
    const sample = await page.evaluate(() => window.__marbleProbe());
    log.steps.push({ step, centre: sample.centre, left: sample.left, right: sample.right });
    const marble = [sample.centre, sample.left, sample.right].find(s => s && /marble/i.test(s.material) && s.distance < 16);
    if (marble) {
      log.closeup = `${out}/asgard-${PHASE}-marble-closeup.png`;
      await page.screenshot({ path: log.closeup });
      log.closeupHit = marble;
      break;
    }
    await page.keyboard.down('w');
    await page.waitForTimeout(1050);
    await page.keyboard.up('w');
    await page.waitForTimeout(180);
  }
  if (!log.closeup) {
    log.closeup = `${out}/asgard-${PHASE}-marble-closeup.png`;
    await page.screenshot({ path: log.closeup });
  }
  await page.screenshot({ path: `${out}/asgard-${PHASE}-architecture.png` });
}

log.textures = [...textures].filter(line => /marble|rock030/i.test(line));
await writeFile(`${out}/${ARENA}-${PHASE}.json`, JSON.stringify(log, null, 2));
console.log('MARBLE ' + JSON.stringify({ arena: ARENA, phase: PHASE, closeup: log.closeup, closeupHit: log.closeupHit, textures: log.textures, errors: errors.length, failed: failed.length }));
await browser.close(); server.close();
