// Asgard environment verification: weather runs, braziers light, pillars break from real attacks.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/refine7-asgard';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => { try { const p = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname); let rel = normalize(p).replace(/^[/\\]+/, '') || 'index.html'; if (['js','assets','models','data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel; res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' }); res.end(await readFile(resolve(root, rel))); } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); } });
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;

let checks = 0;
const check = (name, ok, detail = '') => { assert.ok(ok, `${name}${detail ? ' — ' + detail : ''}`); checks++; console.log('  ok  ' + name); };

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180000);
  // The atmosphere is advanced by the render loop, so the harness drives real animation frames.
  const frames = count => page.evaluate(async total => {
    for (let index = 0; index < total; index++) await new Promise(done => requestAnimationFrame(done));
  }, count);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.stack || e).slice(0, 400)));
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
  await page.evaluate(() => {
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashSelect?.chooseArena('asgard');
    window.__browserSmashSelect?.select('p1', 'Thor');
    window.__browserSmashSelect?.select('p2', 'Naruto Uzumaki');
    document.querySelector('#play').click();
  });
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  await page.evaluate(() => window.__browserSmashStep(0.4));
  await page.waitForFunction(() => window.__browserSmashAsgard?.() != null, null, { timeout: 20000, polling: 100 });

  // Matched before/after pair: the same camera with the atmosphere off, then on.
  await page.evaluate(() => window.__browserSmashAsgardToggle(false));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/asgard-before.png` });
  await page.evaluate(() => window.__browserSmashAsgardToggle(true));
  await page.evaluate(() => window.__browserSmashStep(0.3));
  await page.waitForTimeout(300);
  const stage = await page.evaluate(() => window.__browserSmashAsgard());
  await page.screenshot({ path: `${out}/asgard-after.png` });

  check('the Asgard atmosphere system is live', stage?.active === true, JSON.stringify(stage));
  check('weather particles are present at the configured quality', stage.snow >= 380, String(stage.snow));
  check('four braziers and three pillars exist as real objects', stage.braziers === 4 && stage.pillars === 3, JSON.stringify({ braziers: stage.braziers, pillars: stage.pillars }));

  // The update loop is genuinely advancing: frames grow and the firelight flickers.
  const samples = [];
  for (let index = 0; index < 3; index++) {
    await frames(4);
    samples.push(await page.evaluate(() => window.__browserSmashAsgard()));
  }
  check('weather and lighting advance every step', samples[2].frames > samples[0].frames, JSON.stringify(samples.map(s => s.frames)));
  check('brazier light is animated, not constant', new Set(samples.map(s => s.fireLight)).size > 1, JSON.stringify(samples.map(s => s.fireLight)));

  // Break a pillar with a live attack frame on the fighter's queue (the same data combat uses).
  const broke = await page.evaluate(() => {
    const fighter = window.fighters[0];
    fighter.position.set(-4, .6, -5.1);
    fighter.facing = 0; fighter.facingZ = -1;
    fighter.attackQueue.push({ start: 0, active: 0, duration: 2.2, t: .05, damage: 18, hit: false, kind: 'heavy' });
    return true;
  });
  await frames(4);
  const brokeState = await page.evaluate(() => window.__browserSmashAsgard());
  check('a heavy strike breaks a pillar into debris', brokeState.destroyed >= 1 && brokeState.debris >= 1, JSON.stringify({ destroyed: brokeState.destroyed, debris: brokeState.debris }));
  await page.screenshot({ path: `${out}/asgard-pillar-broken.png` });

  const flare = await page.evaluate(() => {
    const before = window.__browserSmashAsgard().flashes;
    const fighter = window.fighters[0];
    fighter.position.set(5.4, .6, 2.4);
    fighter.attackQueue.push({ start: 0, active: 0, duration: 2.2, t: .05, damage: 12, hit: false, kind: 'heavy' });
    return { before };
  });
  await frames(4);
  flare.after = await page.evaluate(() => window.__browserSmashAsgard().flashes);
  check('a hit beside a brazier makes it flare', flare.after > flare.before, JSON.stringify(flare));

  const timing = await page.evaluate(async () => {
    const deltas = [];
    let last = performance.now();
    for (let index = 0; index < 24; index++) {
      await new Promise(done => requestAnimationFrame(done));
      const now = performance.now();
      deltas.push(now - last);
      last = now;
    }
    deltas.sort((a, b) => a - b);
    return { medianMs: +deltas[Math.floor(deltas.length / 2)].toFixed(1), worstMs: +deltas[deltas.length - 1].toFixed(1), drawCalls: window.__browserSmashAsgard()?.drawCalls ?? null };
  });
  console.log('PERF', JSON.stringify(timing));
  check('no page errors while running Asgard', errors.length === 0, errors.slice(0, 2).join(' | '));
  console.log(`\nAsgard verification passed (${checks} checks).`);
} finally {
  await browser?.close();
  server.close();
}
