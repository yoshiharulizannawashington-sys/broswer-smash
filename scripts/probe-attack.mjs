// Diagnostic probe: does a punch land on the ground, and does the same punch land in the air?
//
// The aerial test reported "no hit" with an empty attack queue, which is ambiguous: the move may
// never have been queued, or it may have resolved and missed. This probe records the attack every
// frame at both altitudes, so the difference is visible instead of inferred.
//
// bash scripts/run-browser-test.sh scripts/probe-attack.mjs
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
  await page.click('#selectScreen .bs-card[data-fighter="Iron Man (Tony Stark)"]');
  await page.click('#selectScreen [data-nav="next"]');
  await page.click('#selectScreen .bs-arena[data-arena="tournament"]');
  await page.click('#play');
  await step(0.15);
  await page.evaluate(() => { window.__browserSmashTrainingDummy = true; });

  const sample = () => page.evaluate(() => {
    const p1 = window.fighters[0], p2 = window.fighters[1];
    return {
      queue: p1.attackQueue.length,
      boxes: p1.hitboxes.length,
      move: p1.activeMoveId,
      grounded: p1.isGrounded,
      y1: +p1.position.y.toFixed(2), y2: +p2.position.y.toFixed(2),
      gap: +p1.position.distanceTo(p2.position).toFixed(2),
      percent: +p2.percent.toFixed(2),
      invuln: +p2.invulnerable.toFixed(2),
      stun1: +p1.hitstun.toFixed(2),
      buffer: +p1.attackBuffer.toFixed(2),
      flight: p1.flightMode,
      // What the resolver actually has to work with while the box is live.
      box: p1.hitboxes[0] ? {
        pos: p1.hitboxes[0].pos.toArray().map(v => +v.toFixed(2)),
        radius: p1.hitboxes[0].radius,
        reach: +(p1.hitboxes[0].reach ?? 0).toFixed(2),
        aerial: p1.hitboxes[0].aerial,
        lifetime: +p1.hitboxes[0].lifetime.toFixed(2),
        hurtbox: p2.hurtboxRadius,
        d: +p1.hitboxes[0].pos.distanceTo(p2.position.clone().add({ x: 0, y: 1, z: 0 })).toFixed(2),
        threshold: +(p1.hitboxes[0].radius + p2.hurtboxRadius).toFixed(2)
      } : null
    };
  });

  async function attempt(label, { y1, y2, flight }) {
    await page.evaluate(({ y1, y2, flight }) => {
      const p1 = window.fighters[0], p2 = window.fighters[1];
      for (const f of [p1, p2]) {
        f.flightMode = flight;
        f.velocity.set(0, 0, 0);
        f.hitstun = 0; f.invulnerable = 0; f.guardBreak = 0; f.casting = false;
        f.attackQueue.length = 0; f.attackBuffer = 0; f.hitboxes.length = 0;
        f.comboStep = 0; f.comboWindow = 0; f.comboHitCount = 0;
        f.isGrounded = !flight;
      }
      p1.position.set(0, y1, -12);
      p2.position.set(1.05, y2, -12);
      p2.percent = 0; p2.guardHeld = false;
      p1.facing = 1; p1.facingZ = 0;
      p2.aiTimer = 999;
    }, { y1, y2, flight });
    await step(0.25);
    const before = await sample();
    await page.keyboard.press('j');
    const frames = [];
    let hit = null;
    for (let i = 0; i < 26; i++) {
      await step(0.02);
      const now = await sample();
      frames.push(now);
      if (now.percent > before.percent) { hit = now; break; }
    }
    const peakBoxes = Math.max(...frames.map(f => f.boxes));
    const queued = frames.some(f => f.queue > 0);
    const moves = [...new Set(frames.map(f => f.move).filter(Boolean))];
    console.log(`\n[${label}] before: ${JSON.stringify(before)}`);
    console.log(`[${label}] queued=${queued} peakBoxes=${peakBoxes} moves=${JSON.stringify(moves)} hit=${hit ? hit.percent + '%' : 'NO'}`);
    console.log(`[${label}] last frame: ${JSON.stringify(frames[frames.length - 1])}`);
    return { label, queued, peakBoxes, hit, moves };
  }

  const ground = await attempt('ground', { y1: 0.18, y2: 0.18, flight: false });
  const air = await attempt('air', { y1: 5, y2: 5, flight: true });

  console.log(`\nSUMMARY ground=${ground.hit ? 'HIT' : 'miss'} air=${air.hit ? 'HIT' : 'miss'}`);
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
