// Phase 29.6 — stills for the grab re-assert and the storm telegraph.
//
//   bash scripts/run-browser-test.sh scripts/audit-phase296-frames.mjs
//
// Capture methods that failed before this one, kept here so the same dead ends are not repeated:
//   1. `marks` (29.5): 0.1 s steps with the live loop running — the clock drifted, the move ended.
//   2. `telegraph` (29.5): paused first, but pausing stops `__browserSmashStep`, so nothing advanced.
//   3. screenshots after `__browserSmashStep` alone: that hook advances the simulation but never
//      draws, so the compositor kept showing the last live frame (three configs came out identical).
//
// This pass uses the same handle the repository's other capture scripts use: mute the loop's render,
// step the simulation, draw once through `__browserSmashRenderer`, then screenshot.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/dev/phase29');
const shotDir = resolve(root, 'artifacts/dev/phase296/frames');
await mkdir(outDir, { recursive: true });
await mkdir(shotDir, { recursive: true });

const CONFIGS = {
  baseline: {},
  reassert: { 'grab-continuity-reassert': true },
  both: { 'grab-continuity': true }
};
// 1.667 / 1.683 straddle the second follow-up at 60% reach, where the re-assert moves the victim
// 1.99 m in a single 1/60 s tick. A pair either side is the only still evidence that shows a snap
// rather than motion.
const TIMES = [0.3, 0.7, 1.0, 1.05, 1.12, 1.5, 1.65, 1.667, 1.683, 1.7, 1.75, 2.1];
const TELEGRAPH_TIMES = [0.2, 0.6, 0.8, 0.88, 0.95, 1.1, 1.32, 1.6, 2.0, 2.3];

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
  && window.__browserSmashScene && window.fighters?.length === 2,
  null, { timeout: 150_000, polling: 200 });
await page.evaluate(() => {
  window.__browserSmashSelect.setMode('2p');
  const cards = [...document.querySelectorAll('#selectScreen .bs-card')];
  (cards.find(c => c.dataset.fighter === 'Wonder Woman') || cards[0])?.click();
  (cards.find(c => c.dataset.fighter === 'Wonder Woman') || cards[1])?.click();
});
await page.click('#selectScreen [data-nav="next"]');
const arenaCard = await page.$('#selectScreen .bs-arena[data-arena="valley"]')
  || await page.$('#selectScreen .bs-arena[data-arena="tournament"]');
await arenaCard.click();
await page.click('#play');
await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting', null, { timeout: 30_000, polling: 100 });

await page.evaluate(() => {
  // Stop the loop's own drawing and the loop's own stepping; both become explicit below.
  const renderer = window.__browserSmashRenderer;
  if (!renderer.__originalRender) renderer.__originalRender = renderer.render;
  renderer.render = () => {};
  window.requestAnimationFrame = () => 0;
  window.__p296 = {
    begin(flags, gap) {
      const p1 = window.fighters[0], p2 = window.fighters[1];
      window.combatPowers.clear('p296f');
      for (const f of [p1, p2]) {
        f.percent = 0; f.velocity.set(0, 0, 0); f.hitstun = 0; f.casting = null; f.grabbedBy = null;
        f.grabTarget = null; f.ko = false; f.attackQueue.length = 0; f.isGrounded = true; f.meter = 0;
        f.shield = 100; f.guardHeld = false; f.guardBreak = 0; f.guardStun = 0;
      }
      p1.position.set(0, p1.groundLevel ?? 0, 0); p1.facing = 1;
      p2.position.set(gap, p2.groundLevel ?? 0, 0); p2.facing = -1;
      const keys = window.__browserSmashInput.keys;
      for (const code of Object.keys(keys)) keys[code] = false;
      window.__browserSmashHitTrace = [];
      window.__browserSmashGrabTrace = [];
      window.__browserSmashExperiments = { ...flags };
      window.__browserSmashStep(1 / 60);
      p2.meter = 100;
      const rec = window.combatPowers.tryUltimate(p2);
      if (!rec || rec.ok === false) return { refused: rec?.reason || 'rejected' };
      this.rec = rec; this.cursor = 0;
      return { ok: true, label: rec.label, startup: rec.startup, active: rec.active, total: rec.total };
    },
    frame(seconds) {
      const p2 = window.fighters[1], p1 = window.fighters[0];
      const target = Math.round(seconds * 60);
      while (this.cursor < target) { window.__browserSmashStep(1 / 60); this.cursor++; }
      const renderer = window.__browserSmashRenderer;
      renderer.__originalRender.call(renderer, window.__browserSmashScene, window.smashCamera.camera);
      return { t: +(this.cursor / 60).toFixed(2), phase: this.rec?.phase || null,
        damage: +p1.percent.toFixed(1),
        gap: +Math.hypot(p1.position.x - p2.position.x, p1.position.z - p2.position.z).toFixed(2),
        events: (window.__browserSmashHitTrace || []).filter(h => h.ultimate === this.rec?.label).length };
    }
  };
});

const shots = [];
for (const [config, flags] of Object.entries(CONFIGS)) {
  const begin = await page.evaluate(({ flags }) => window.__p296.begin(flags, 7.8), { flags });
  if (!begin.ok) { console.log(config + ' refused ' + begin.refused); continue; }
  for (const time of TIMES) {
    const state = await page.evaluate(t => window.__p296.frame(t), time);
    const file = config + '-t' + time.toFixed(2) + '.png';
    await page.screenshot({ path: resolve(shotDir, file) });
    shots.push({ config, requested: time, ...state, file });
    console.log(config.padEnd(9) + 'req ' + time.toFixed(2) + ' -> t' + state.t + ' ' + state.phase
      + ' dmg ' + state.damage + ' gap ' + state.gap + ' events ' + state.events);
  }
  await page.evaluate(() => { for (const f of window.fighters) { f.percent = 0; f.casting = null; } });
}

const telegraph = [];
if (await page.evaluate(() => {
  const select = document.getElementById('cpuCharacter');
  const option = [...select.options].find(o => /aquaman/i.test(o.textContent));
  if (!option) return false;
  select.value = option.value; select.dispatchEvent(new Event('change'));
  return true;
})) {
  const begin = await page.evaluate(() => window.__p296.begin({}, 6));
  if (begin.ok) {
    for (const time of TELEGRAPH_TIMES) {
      const state = await page.evaluate(t => window.__p296.frame(t), time);
      const file = 'storm-t' + time.toFixed(2) + '.png';
      await page.screenshot({ path: resolve(shotDir, file) });
      telegraph.push({ requested: time, ...state, file });
      console.log('storm    req ' + time.toFixed(2) + ' -> t' + state.t + ' ' + state.phase
        + ' dmg ' + state.damage + ' gap ' + state.gap + ' events ' + state.events);
    }
  } else console.log('storm refused ' + begin.refused);
}

await writeFile(resolve(outDir, 'grab-motion-stills.json'), JSON.stringify(
  { kind: 'grab-motion-stills', generatedAt: new Date().toISOString(),
    method: 'loop render muted; step; explicit renderer.render; page.screenshot',
    shots, telegraph, pageErrors }, null, 2));
console.log('stills ' + shots.length + ' + telegraph ' + telegraph.length
  + ', page errors ' + pageErrors.length);
await browser.close();
await new Promise(done => server.close(done));
