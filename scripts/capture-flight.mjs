// Flight evidence capture. Photographs the four frames aerial movement is judged on: the
// take-off from the deck, a midair duel with both fighters airborne, a high-altitude flight that
// pulls the camera back, and the landing shockwave. It boots the same page and uses the same
// step() hook as the tests, so a capture cannot show a state the game cannot reach.
//
// bash scripts/run-browser-test.sh scripts/capture-flight.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = 'artifacts/phase10';
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.svg': 'image/svg+xml'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '');
    if (!relative) relative = 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => relative === d || relative.startsWith(d + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(filePath));
  } catch { res.writeHead(404); res.end('Not found'); }
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
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    try {
      await route.fulfill({
        status: 200, contentType: 'text/javascript; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: await readFile(resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', '')))
      });
    } catch { await route.fulfill({ status: 404, body: 'missing' }); }
  });
  const step = s => page.evaluate(v => window.__browserSmashStep(v), s);
  const shoot = async name => {
    await page.screenshot({ path: `${outDir}/${name}.png` });
    console.log(`  shot ${outDir}/${name}.png`);
  };

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashStep && window.fighters?.length === 2, null, { timeout: 120_000, polling: 200 });
  await page.click('#selectScreen .bs-card[data-fighter="Goku"]');
  await page.click('#selectScreen .bs-card[data-fighter="Iron Man (Tony Stark)"]');
  await page.click('#selectScreen [data-nav="next"]');
  await page.click('#selectScreen .bs-arena[data-arena="tournament"]');
  await page.click('#play');
  await step(0.12);
  await page.evaluate(() => { window.__browserSmashTrainingDummy = true; });

  // ---- 1. Take-off --------------------------------------------------------
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(-2, p1.groundLevel, -12);
    p2.position.set(3, p2.groundLevel, -12);
    p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0);
  });
  await step(0.2);
  await page.keyboard.press('f');
  await step(0.14);
  console.log('  take-off', JSON.stringify(await page.evaluate(() => ({
    y: +window.fighters[0].position.y.toFixed(2), flight: window.fighters[0].flightMode
  }))));
  await shoot('01-takeoff');

  // ---- 2. Midair duel -----------------------------------------------------
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.flightMode = true; p2.flightMode = true;
    p1.position.set(-1, 5.4, -12); p2.position.set(1.2, 5.0, -12);
    p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0);
    p1.facing = 1; p1.facingZ = 0;
    p2.percent = 0; p2.invulnerable = 0; p2.guardHeld = false; p2.aiTimer = 999;
    window.fighters[0].attackQueue.length = 0;
  });
  await step(0.2);
  await page.keyboard.press('j');
  for (let i = 0; i < 20; i++) {
    await step(0.02);
    const landed = await page.evaluate(() => window.fighters[1].percent > 0);
    if (landed) break;
  }
  console.log('  air hit', JSON.stringify(await page.evaluate(() => ({
    victim: +window.fighters[1].percent.toFixed(1),
    victimY: +window.fighters[1].position.y.toFixed(2),
    knock: +Math.hypot(window.fighters[1].velocity.x, window.fighters[1].velocity.z).toFixed(2)
  }))));
  await shoot('02-air-duel');

  // ---- 3. High flight, camera pulled back --------------------------------
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.flightMode = true; p2.flightMode = true;
    p1.position.set(-4, 12.5, -14); p2.position.set(5, 3.5, -8);
    p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0);
  });
  await step(0.5);
  const framing = await page.evaluate(() => {
    const cam = window.smashCamera.camera;
    const ndc = f => { const v = f.position.clone(); v.y += 1; v.project(cam); return { x: +v.x.toFixed(2), y: +v.y.toFixed(2) }; };
    return { distance: +window.smashCamera.framing.distance.toFixed(2), a: ndc(window.fighters[0]), b: ndc(window.fighters[1]) };
  });
  console.log('  framing', JSON.stringify(framing));
  await shoot('03-high-altitude');

  // ---- 4. Landing shockwave ----------------------------------------------
  await page.evaluate(() => {
    const p1 = window.fighters[0];
    p1.flightMode = true;
    p1.position.set(0, 9, -12);
    p1.velocity.set(0, 0, 0);
  });
  await page.evaluate(() => { window.fighters[0].velocity.y = -11; });
  await page.keyboard.down('c');
  for (let i = 0; i < 30; i++) {
    await step(0.05);
    const done = await page.evaluate(() => window.fighters[0].isGrounded);
    if (done) break;
  }
  await page.keyboard.up('c');
  await step(0.06);
  console.log('  landing', JSON.stringify(await page.evaluate(() => ({
    y: +window.fighters[0].position.y.toFixed(2),
    grounded: window.fighters[0].isGrounded,
    flight: window.fighters[0].flightMode
  }))));
  await shoot('04-landing');

  if (errors.length) {
    console.error('page errors during capture:\n' + errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('\nflight captures complete');
  }
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
