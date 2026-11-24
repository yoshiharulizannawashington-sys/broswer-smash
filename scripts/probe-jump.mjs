// Diagnostic probe: trace a double jump to the ground, frame by frame.
//
// test-gameplay asserts that a double jump has landed 1.2 s after the second press. If that
// timing is marginal the assertion reports "not landed" without saying how close it was, so this
// records altitude, vertical speed and the jump counter instead of guessing.
//
// bash scripts/run-browser-test.sh scripts/probe-jump.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
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

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.setDefaultTimeout(180_000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
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

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashStep && window.fighters?.length === 2, null, { timeout: 120_000, polling: 200 });
  await page.click('#selectScreen .bs-card[data-fighter="Goku"]');
  await page.click('#selectScreen .bs-card[data-fighter="Vegeta"]');
  await page.click('#selectScreen [data-nav="next"]');
  await page.click('#selectScreen .bs-arena[data-arena="tournament"]');
  await page.click('#play');
  await step(0.1);
  await page.evaluate(() => { window.__browserSmashTrainingDummy = true; });

  const read = () => page.evaluate(() => {
    const f = window.fighters[0];
    return {
      y: +f.position.y.toFixed(2), vy: +f.velocity.y.toFixed(2), grounded: f.isGrounded,
      jumps: f.jumps, flight: f.flightMode, floor: +f.groundLevel.toFixed(2),
      stun: +f.hitstun.toFixed(2), ctl: f.state || null
    };
  });

  await page.evaluate(() => {
    const p = window.fighters[0];
    p.position.set(0, p.groundLevel, -12);
    p.velocity.set(0, 0, 0);
    p.hitstun = 0;
  });
  await page.keyboard.press('Space');
  await step(0.1);
  console.log('after 1st jump', JSON.stringify(await read()));
  await step(0.15);
  await page.keyboard.press('Space');
  await step(0.08);
  console.log('after 2nd jump', JSON.stringify(await read()));

  // Follow the descent in 0.1 s slices and report the frame it touches down.
  let landedAt = null;
  for (let i = 1; i <= 30; i++) {
    await step(0.1);
    const now = await read();
    if (now.grounded && landedAt == null) { landedAt = i / 10; console.log(`touched down at +${landedAt.toFixed(1)} s`, JSON.stringify(now)); }
    if (i % 3 === 0) console.log(`+${(i / 10).toFixed(1)}s`, JSON.stringify(now));
  }
  console.log(`\nlanded after ${landedAt == null ? 'NEVER (within 3 s)' : landedAt.toFixed(1) + ' s'}`);
  console.log('page errors:', pageErrors.length ? pageErrors.slice(0, 3) : 'none');
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
