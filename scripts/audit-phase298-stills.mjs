// Phase 29.8 — three-angle stills of the haul, with and without the overlay.
//
//   bash scripts/run-browser-test.sh scripts/audit-phase298-stills.mjs
//
// The first attempt framed from the victim's side of the line and sat inside the caster while the
// ultimate's own glow flooded the frame. This pass uses three off-axis framings around HER, hides the
// ultimate's VFX group so the body can be read, and captures the same tick twice (overlay on, overlay
// off) so the pose difference is visible, not inferred.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const shotDir = resolve(root, 'artifacts/dev/phase298/pose');
const outDir = resolve(root, 'artifacts/dev/phase29');
await mkdir(shotDir, { recursive: true });
await mkdir(outDir, { recursive: true });

const PEAK_T = 1.22;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => relative === d || relative.startsWith(d + sep))) relative = 'public' + sep + relative;
    const filePath = resolve(root, relative);
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) res.writeHead(404); res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl',
  '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.setDefaultTimeout(180_000);
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e.message || e)));
await page.route('https://unpkg.com/three@0.152.2/**', async route => {
  const url = new URL(route.request().url());
  const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
  try { await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
    headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) }); }
  catch { await route.fulfill({ status: 404, body: 'missing' }); }
});
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
  && window.__browserSmashMatch && window.__browserSmashStep && window.__browserSmashRenderer
  && window.fighters?.length === 2, null, { timeout: 150_000, polling: 200 });
await page.evaluate(() => {
  window.__browserSmashSelect.setMode('2p');
  const cards = [...document.querySelectorAll('#selectScreen .bs-card')];
  (cards.find(c => c.dataset.fighter === 'Wonder Woman') || cards[0])?.click();
  (cards.find(c => c.dataset.fighter === 'Wonder Woman') || cards[1])?.click();
});
await page.click('#selectScreen [data-nav="next"]', { force: true });
const arenaCard = await page.$('#selectScreen .bs-arena[data-arena="valley"]')
  || await page.$('#selectScreen .bs-arena[data-arena="tournament"]');
await arenaCard.click({ force: true });
await page.click('#play', { force: true });
await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting', null, { timeout: 30_000, polling: 100 });

await page.evaluate(() => {
  const renderer = window.__browserSmashRenderer;
  const scene = window.__browserSmashScene;
  const camera = window.smashCamera.camera;
  window.__origRender = renderer.render.bind(renderer);
  renderer.render = () => {};
  window.requestAnimationFrame = () => 0;
  const V = scene.position.clone();
  window.__still = {
    begin(noHaul) {
      const p1 = window.fighters[0], p2 = window.fighters[1];
      window.combatPowers.clear('p298s');
      window.__browserSmashNoHaul = Boolean(noHaul);
      for (const f of [p1, p2]) {
        f.percent = 0; f.velocity.set(0, 0, 0); f.hitstun = 0; f.invulnerable = 0;
        f.casting = null; f.grabbedBy = null; f.grabTarget = null; f.ko = false;
        f.attackQueue.length = 0; f.isGrounded = true; f.meter = 0; f.shield = 100;
        f.guardHeld = false; f.guardBreak = 0; f.grabReel = null; f.__haul = null;
      }
      p1.position.set(0, p1.groundLevel ?? 0, 0); p1.facing = 1;
      p2.position.set(7.8, p2.groundLevel ?? 0, 0); p2.facing = -1;
      const keys = window.__browserSmashInput.keys;
      for (const code of Object.keys(keys)) keys[code] = false;
      window.__browserSmashExperiments = { 'grab-continuity-pull': true };
      window.__browserSmashStep(1 / 60);
      p2.meter = 100;
      const rec = window.combatPowers.tryUltimate(p2);
      return { ok: rec?.ok !== false, total: rec?.total, label: rec?.label };
    },
    /** Step to the peak tug, hide the ultimate's glow, and frame her from three off-axis angles. */
    async shoot(tag) {
      const p1 = window.fighters[0], p2 = window.fighters[1];
      for (let i = 0; i < Math.round(1.22 * 60); i++) {
        window.__browserSmashStep(1 / 60);
        window.combatPowers.applyCinematicPose?.(1 / 60);
      }
      const record = window.combatPowers.context?.() ? null : null;
      // Turn off the move's own VFX group so the body is legible; the scene and bodies are untouched.
      for (const group of scene.children) {
        if (group.__ultimateVfx) group.visible = false;
      }
      const angles = {
        'front-three-quarter': [-3.4, 2.0, 2.7],
        'side': [0.3, 1.9, 4.6],
        'rear-three-quarter': [2.9, 2.1, 2.8]
      };
      const out = [];
      for (const [angle, offset] of Object.entries(angles)) {
        const target = p2.position.clone(); target.y = (p2.groundLevel ?? 0) + 1.15;
        camera.position.set(target.x + offset[0], (p2.groundLevel ?? 0) + offset[1], target.z + offset[2]);
        camera.lookAt(target);
        camera.updateMatrixWorld(true);
        window.__origRender(scene, camera);
        out.push({ angle, tag, file: 'artifacts/dev/phase298/pose/' + tag + '-' + angle.replace(/[^a-z]/g, '') + '.png',
          gap: +Math.hypot(p2.position.x - p1.position.x, p2.position.z - p1.position.z).toFixed(2),
          damage: +p1.percent.toFixed(1), leftHand: this.hand(p2, 'leftHand'), rightHand: this.hand(p2, 'rightHand') });
      }
      return out;
    },
    hand(f, name) {
      const j = f.model?.userData?.[name];
      if (!j) return null;
      j.getWorldPosition(V);
      return { x: +V.x.toFixed(3), y: +V.y.toFixed(3), z: +V.z.toFixed(3) };
    },
    restore() {
      const renderer = window.__browserSmashRenderer;
      renderer.render = window.__origRender;
    }
  };
});

const stills = [];
for (const [tag, noHaul] of [['haul', false], ['none', true]]) {
  await page.evaluate(nh => window.__still.begin(nh), noHaul);
  const shots = await page.evaluate(async t => window.__still.shoot(t), tag);
  for (const shot of shots) {
    await page.screenshot({ path: resolve(root, shot.file) });
    stills.push(shot);
  }
  console.log(tag + ' ' + JSON.stringify(shots.map(s => ({ angle: s.angle, gap: s.gap, damage: s.damage }))));
}

await writeFile(resolve(outDir, 'grab-haul-stills.json'), JSON.stringify({
  kind: 'grab-haul-stills', generatedAt: new Date().toISOString(), peakSeconds: PEAK_T,
  note: 'same tick, overlay on and off; ultimate VFX group hidden for legibility only',
  stills, pageErrors }, null, 2));
console.log('stills ' + stills.length + ' page errors ' + pageErrors.length);
await browser.close();
await new Promise(done => server.close(done));
