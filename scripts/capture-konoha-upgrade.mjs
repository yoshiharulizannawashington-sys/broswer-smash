// Evidence captures for the Konoha visual upgrade. These are real in-match frames: the game is
// loaded, two fighters are spawned on the stage's own spawn points, and the camera is the same
// smash camera used during play. No teleports into a separate preview scene.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/konoha-upgrade';
await mkdir(out, { recursive: true });
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm'
};
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end('nf');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 180)));
await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Naruto Uzumaki');
  window.__browserSmashSelect?.select?.('p2', 'Goku');
  window.__browserSmashTrainingDummy = true;
  window.__browserSmashFreezeAI = true;
});
await page.waitForTimeout(450);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
await page.waitForTimeout(1600);

const stages = [
  ['konoha_main_street', 'main-street'],
  ['konoha_hokage_rock', 'hokage-rock'],
  ['konoha_gates', 'gates'],
  ['konoha_academy', 'academy']
];
const only = (process.env.CAPTURE_STAGES || '').split(',').filter(Boolean);

for (const [key, name] of stages) {
  if (only.length && !only.includes(key)) continue;
  await page.evaluate(k => {
    const select = document.querySelector('#mapSelect');
    if (select) {
      select.value = k;
      select.dispatchEvent(new Event('change'));
    }
    window.__browserSmashApplyMap(k);
  }, key);
  await page.waitForTimeout(2200);
  const info = await page.evaluate(() => {
    const layout = window.__browserSmashLayout();
    // `__browserSmashLayout()` still describes the previously selected classic map after a
    // direct __browserSmashApplyMap() switch. The active world location owns the real spawns
    // (including the 24 m Hokage Rock terrace), so prefer those or the fighters end up at y=0
    // inside the cliff while the camera films the terrace above them.
    const world = window.__browserSmashWorld || {};
    const spawns = (world.spawns?.length ? world.spawns : layout.spawns) || [];
    window.fighters.forEach((fighter, index) => {
      const spawn = spawns[index] || spawns[0];
      fighter.position.set(spawn.x, spawn.y ?? layout.ground ?? 0, spawn.z);
      fighter.velocity.set(0, 0, 0);
      fighter.hitstun = 0;
      fighter.guardBreak = 0;
      fighter.isGrounded = true;
      fighter.attackQueue.length = 0;
      fighter.flightMode = false;
    });
    window.smashCamera?.snap?.();
    return {
      label: world.label || layout.label,
      ground: world.ground ?? layout.ground,
      parts: window.__browserSmashWorld?.parts,
      drawCalls: window.__browserSmashWorld?.drawCalls,
      spawns
    };
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${name}.png` });

  // A second, wider architectural frame from the same stage camera. This is a camera setting,
  // not a different scene: it shows the roofline and the landmark behind the fighters. The
  // Hokage Rock terrace is backed by the cliff itself, so scaling this shot out puts the camera
  // inside the rear rock; the default terrace framing is already the wide architectural view.
  if (name !== 'hokage-rock') {
    await page.evaluate(() => {
      window.smashCamera?.setStageTilt?.(0.24, 2.0);
      window.smashCamera?.snap?.();
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${name}-wide.png` });
  }

  // HUD-free frame for judging geometry and material readability. The game is still running;
  // only the DOM overlays are hidden for this one capture.
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.id = 'konoha-clean-capture';
    style.textContent = '#hud,#cameraSettings,#energyHUD,#comboNotice,#ocButton,.online-characters{display:none!important}';
    document.head.appendChild(style);
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${name}-clean.png` });
  await page.evaluate(() => document.querySelector('#konoha-clean-capture')?.remove());
  console.log('SHOT', key, JSON.stringify(info));
}

console.log('ERRORS', JSON.stringify(errors));
// SwiftShader can keep a WebGL context alive after the last screenshot; bound the shutdown so
// evidence runs do not sit for the full cloud command timeout after they have finished.
await Promise.race([browser.close(), new Promise(done => setTimeout(done, 2500))]);
server.close();
process.exit(0);
