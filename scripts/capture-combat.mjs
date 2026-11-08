// Combat evidence capture. Boots the real game, stages a two-fighter duel in a ring, and
// photographs the frames a fighting game is judged on: the neutral stance, an attack in
// startup, the frame the hit confirms, a three-hit chain with the combo notice up, and a
// blocked strike. Every shot is taken while the simulation is paused between steps, so the
// image shows a specific combat frame instead of whatever the software renderer reached.
//
// The section of test-gameplay.mjs that boots the page is reused deliberately: same server,
// same Three.js route, same step() hook, so a capture cannot pass on a page the tests never
// exercise.
//
// node scripts/capture-combat.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = 'artifacts/phase9';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '');
    if (!relative) relative = 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const bytes = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

await mkdir(outDir, { recursive: true });

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || String(error)));

  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try {
      await route.fulfill({
        status: 200,
        contentType: 'text/javascript; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: await readFile(localPath)
      });
    } catch {
      await route.fulfill({ status: 404, body: 'missing' });
    }
  });

  const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);
  const shoot = async name => {
    await page.screenshot({ path: `${outDir}/${name}.png` });
    console.log(`  shot ${outDir}/${name}.png`);
  };

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
    null, { timeout: 120_000, polling: 200 });

  // Goku versus Vegeta on the tournament ring: two fighters with distinct silhouettes, on a
  // stage whose floor, ring edge and lighting make a hit's position readable.
  await page.click('#selectScreen .bs-card[data-fighter="Goku"]');
  await page.click('#selectScreen .bs-card[data-fighter="Vegeta"]');
  await page.click('#selectScreen [data-nav="next"]');
  await page.click('#selectScreen .bs-arena[data-arena="tournament"]');
  await page.click('#play');
  await step(0.1);

  // The CPU is a training dummy for the whole capture so it holds still for the camera.
  await page.evaluate(() => {
    window.__browserSmashTrainingDummy = true;
    window.fighters[1].aiTimer = 999;
  });

  const place = (p1x, p1z, p2x, p2z) => page.evaluate(([a, b, c, d]) => {
    const [p1, p2] = window.fighters;
    p1.position.set(a, p1.groundLevel, b); p1.velocity.set(0, 0, 0);
    p1.attackQueue.length = 0; p1.comboStep = 0; p1.comboWindow = 0; p1.comboHitCount = 0;
    p1.facing = 1; p1.facingZ = 0; p1.hitstun = 0;
    p2.position.set(c, p2.groundLevel, d); p2.velocity.set(0, 0, 0);
    p2.percent = 0; p2.hitstun = 0; p2.invulnerable = 0; p2.guardHeld = false;
    window.fighters[1].aiTimer = 999;
  }, [p1x, p1z, p2x, p2z]);

  const state = () => page.evaluate(() => ({
    percent: window.fighters[1].percent,
    hitstun: window.fighters[1].hitstun,
    combo: window.fighters[0].comboHitCount,
    notice: document.querySelector('#comboNotice')?.classList.contains('show') || false,
    hitStop: window.__browserSmashMatch().hitStop
  }));

  // ---- 1. Neutral stance --------------------------------------------------
  await place(0, -12, 3.4, -12);
  await step(0.35);
  await shoot('01-neutral');

  // ---- 2. Attack in startup ----------------------------------------------
  await page.keyboard.press('j');
  await step(0.04);
  await shoot('02-startup');

  // ---- 3. Confirmed hit ---------------------------------------------------
  // Step in small slices until the target actually takes damage, then photograph that frame:
  // the spark burst, shock ring and hit-stop freeze are only on screen for a few frames.
  // Peak values are tracked, not the value at the moment the loop breaks: hit stun decays
  // every tick, so reading it one step late reports 0.00 s for a hit that did stun.
  let hit = null;
  let peakStun = 0, peakStop = 0;
  for (let i = 0; i < 20; i++) {
    await step(0.02);
    const now = await state();
    peakStun = Math.max(peakStun, now.hitstun);
    peakStop = Math.max(peakStop, now.hitStop);
    if (now.percent > 0 && !hit) { hit = now; await shoot('03-impact'); }
  }
  console.log(`  hit frame: ${hit ? `damage ${hit.percent.toFixed(1)}% · peak hitstun ${peakStun.toFixed(2)}s · peak hit-stop ${peakStop.toFixed(3)}s` : 'NO HIT LANDED'}`);

  // ---- 4. Three-hit chain with the combo counter -------------------------
  await place(0, -12, 1.15, -12);
  await step(0.3);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('j');
    await step(0.13);
  }
  const chain = await state();
  console.log(`  chain: ${chain.combo} hits · ${chain.percent.toFixed(1)}% · notice ${chain.notice}`);
  await shoot('04-combo');

  // ---- 5. Perfect parry ---------------------------------------------------
  // A match has no training panel, so the dummy's guard cannot be commanded; the parry is
  // armed the same way the input handler arms it (parryTimer), which makes the frame
  // deterministic instead of hoping the CPU raises its shield on cue.
  await place(0, -12, 1.3, -12);
  await step(0.3);
  await page.evaluate(() => {
    const p2 = window.fighters[1];
    p2.parryTimer = 0.5;
    p2.guardHeld = true;
  });
  await page.keyboard.press('j');
  let parried = null;
  for (let i = 0; i < 20; i++) {
    await step(0.02);
    const now = await page.evaluate(() => ({
      counter: window.fighters[1].counterWindow,
      callout: window.showCombatCallout?.last || null,
      attackerStun: window.fighters[0].hitstun,
      percent: window.fighters[1].percent
    }));
    if (now.counter > 0 || now.attackerStun > 0) { parried = now; break; }
  }
  console.log(`  parry: ${parried
    ? `counter window ${parried.counter.toFixed(2)}s · attacker stunned ${parried.attackerStun.toFixed(2)}s · victim took ${parried.percent.toFixed(2)}%`
    : 'NO PARRY'}`);
  await shoot('05-parry');

  if (errors.length) {
    console.error('page errors during capture:\n' + errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('\ncombat captures complete');
  }
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
