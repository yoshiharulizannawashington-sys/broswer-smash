// Ground-contact locomotion probe.
//   bash scripts/run-browser-test.sh scripts/probe-locomotion-layer.mjs
//
// Drives the real game, not the module in isolation: starts a match, samples the foot layer's
// per-rig report during idle, walk and landing, and checks that a stance ankle is held against
// root travel without leaving the floor or producing a page error.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = resolve(root, 'artifacts/locomotion-transitions');
await mkdir(out, { recursive: true });
const p1Name = process.argv[2] || 'Kaze';
// Link is an accepted rig in the current foot table, so it exercises the calibrated-report path.
// A fallback control intentionally reports `authored` and has no foot targets.
const p2Name = process.argv[3] || 'Link';
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sources: [], roster: { launch: [], manifestKeys: [] } }));
      return;
    }
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const bytes = await readFile(resolve(root, relative));
    res.writeHead(200, { 'Content-Type': mime[extname(relative).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const results = [];
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  results.push(name);
  console.log(`  ok  ${name}${detail ? ' — ' + detail : ''}`);
}

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
  page.on('pageerror', error => errors.push(String(error?.stack || error)));
  page.on('console', message => {
    if (message.type() === 'error' && !/404 \(Not Found\)/.test(message.text())) errors.push(message.text());
  });
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try {
      await route.fulfill({
        status: 200, contentType: 'text/javascript; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath)
      });
    } catch (error) {
      await route.fulfill({ status: 404, body: String(error?.message || error) });
    }
  });

  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
    null, { timeout: 120_000, polling: 200 });
  await page.click('#menu [data-nav="versus"]');
  await page.waitForSelector('#selectScreen .bs-card', { state: 'visible' });
  await page.click(`#selectScreen .bs-card[data-fighter="${p1Name}"]`);
  await page.click(`#selectScreen .bs-card[data-fighter="${p2Name}"]`);
  await page.click('#selectScreen [data-nav="next"]');
  await page.click('#selectScreen .bs-arena[data-arena="tournament"]');
  await page.evaluate(() => {
    window.__browserSmashSelect.setMode('2p');
    window.__browserSmashTrainingDummy = true;
  });
  await page.click('#play');
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(-7, p1.groundLevel || 0.18, -11);
    p2.position.set(7, p2.groundLevel || 0.18, -11);
    for (const f of [p1, p2]) {
      f.velocity.set(0, 0, 0);
      f.hitstun = 0;
      f.attackQueue.length = 0;
      f.guardBreak = 0;
      f.dodgeTimer = 0;
      f.isGrounded = true;
    }
  });
  for (let i = 0; i < 30; i += 1) {
    await page.evaluate(() => window.__browserSmashStep(0.05));
    const ready = await page.evaluate(() => window.__browserSmashMatch().status === 'fighting'
      && (window.fighters[0].model?.userData?.locomotionReport?.legLength || 0) > 0.2);
    if (ready && i > 6) break;
    await page.waitForTimeout(80);
  }

  const read = async () => page.evaluate(() => window.fighters.map(f => {
    const m = f.model;
    const report = m?.userData?.locomotionReport || null;
    const bones = ['leftFoot', 'rightFoot'].map(key => {
      const bone = m?.userData?.[key] || f.animationController?.rig?.joints?.[key];
      if (!bone) return null;
      bone.updateWorldMatrix(true, false);
      const e = bone.matrixWorld.elements;
      return { x: Number(e[12].toFixed(3)), y: Number(e[13].toFixed(3)), z: Number(e[14].toFixed(3)) };
    });
    return { identity: f.identity, report, clip: report?.clip || null, feet: bones,
      status: window.__browserSmashMatch?.().status || null,
      model: m?.userData?.characterAssetUrl || m?.name || null,
      controller: Boolean(f.animationController?.ready),
      active: f.animationController?._active || null,
      speed: Math.hypot(f.velocity.x, f.velocity.z) };
  }));

  // Let the spawn heading settle so this sample measures idle, not the initial pivot timer.
  await page.evaluate(() => window.__browserSmashStep(0.45));
  const idle = await read();
  console.log('IDLE ' + JSON.stringify(idle));
  check('the foot layer binds both live bodies', idle.every(r => r.report?.legLength > 0.2),
    JSON.stringify(idle.map(r => ({ identity: r.identity, status: r.status, model: r.model,
      controller: r.controller, active: r.active, report: r.report }))));
  check('idle plants at least one Kaze stance foot', idle[0].report?.feet?.some(f => f.contact),
    JSON.stringify(idle[0].report?.feet));
  check('idle feet stay near the tournament floor', idle[0].report.feet.every(f => f.height >= -0.04 && f.height < 0.4),
    JSON.stringify(idle[0].report.feet.map(f => f.height)));

  const capture = async name => {
    await page.evaluate(() => {
      const f = window.fighters[0];
      window.smashCamera?.spectate?.({ fighter: f, framing: 'full', distance: 3.2, yaw: 90, pitch: 4 });
    });
    await page.waitForTimeout(120);
    await page.screenshot({ path: resolve(out, `${name}.png`) });
  };

  // A fresh step should carry an anticipation weight and an actual stepping-foot target before
  // the body reaches full speed.
  const idleBeforeStart = await read();
  await page.keyboard.down('a');
  await page.evaluate(() => window.__browserSmashStep(0.08));
  const starting = await read();
  const startSide = starting[0].report?.startStepSide;
  const startFootIndex = startSide === 'right' ? 1 : 0;
  const startTravel = idleBeforeStart[0].feet?.[startFootIndex] && starting[0].feet?.[startFootIndex]
    ? Math.hypot(starting[0].feet[startFootIndex].x - idleBeforeStart[0].feet[startFootIndex].x,
      starting[0].feet[startFootIndex].z - idleBeforeStart[0].feet[startFootIndex].z) : 0;
  check('input start raises the anticipation weight', starting[0].report?.start > 0.1,
    String(starting[0].report?.start));
  check('input start selects a stepping foot and target',
    Boolean(starting[0].report?.startStepSide)
    && starting[0].report.feet.some(foot => foot.targetReason === 'start'),
    JSON.stringify({ side: startSide, feet: starting[0].report?.feet }));
  check('input start moves the stepping foot', startTravel > 0.012,
    JSON.stringify({ side: startSide, startTravel }));
  await capture('start');

  // Releasing the direction is a separate transition: both feet brace around the last input and
  // are explicitly re-targeted instead of merely fading the pelvis offset.
  await page.keyboard.up('a');
  await page.evaluate(() => window.__browserSmashStep(0.08));
  const stopping = await read();
  check('input release raises the stop weight', stopping[0].report?.stop > 0.1,
    String(stopping[0].report?.stop));
  check('input release braces both feet',
    Boolean(stopping[0].report?.stopFront)
    && stopping[0].report.feet.filter(foot => foot.targetReason === 'stop').length >= 2,
    JSON.stringify({ front: stopping[0].report?.stopFront, feet: stopping[0].report?.feet }));
  await capture('stop');
  await page.evaluate(() => window.__browserSmashStep(0.25));

  // A 180 degree idle turn must pivot rather than hold both feet in the old heading.
  const pivotBefore = await read();
  const turning = await page.evaluate(() => {
    const p = window.fighters[0];
    p.facing = -p.facing;
    p.facingZ = -p.facingZ;
    p.velocity.set(0, 0, 0);
    window.__browserSmashStep(0.08);
    return p.model?.userData?.locomotionReport || null;
  });
  check('turning in place raises the pivot weight', turning?.pivot > 0.1, JSON.stringify(turning));
  check('turn-in-place plants one pivot foot and steps the other',
    Boolean(turning?.pivotSide && turning?.pivotHeld)
    && turning?.feet?.some(foot => foot.targetReason === 'pivot'),
    JSON.stringify({ side: turning?.pivotSide, step: turning?.pivotStepSide, feet: turning?.feet }));
  await page.evaluate(() => window.__browserSmashStep(0.16));
  const pivoting = await read();
  const pivotFootIndex = pivoting[0].report?.pivotSide === 'right' ? 1 : 0;
  const pivotYawDelta = pivoting[0].report?.feet?.[pivotFootIndex] && pivotBefore[0].report?.feet?.[pivotFootIndex]
    ? Math.abs(pivoting[0].report.feet[pivotFootIndex].yaw - pivotBefore[0].report.feet[pivotFootIndex].yaw) : 0;
  check('turn-in-place swings the free foot to its new stance',
    pivoting[0].report?.feet?.some(foot => foot.targetReason === 'pivot-step'),
    JSON.stringify({ step: pivoting[0].report?.pivotStepSide, feet: pivoting[0].report?.feet }));
  check('turn-in-place yaws the planted foot', pivotYawDelta > 0.08,
    JSON.stringify({ pivotYawDelta, feet: pivoting[0].report?.feet }));
  await capture('turn');

  await page.evaluate(() => {
    const p = window.fighters[0];
    p.position.set(-7, p.groundLevel || 0.18, -11);
    p.velocity.set(0, 0, 0);
  });
  await page.evaluate(() => window.__browserSmashStep(0.12));
  await page.keyboard.down('d');
  await page.evaluate(() => window.__browserSmashStep(0.55));
  // A stride has an airborne beat. Sample a few sub-steps so the contact assertion measures the
  // planted phase instead of whichever phase one arbitrary sample happened to land on.
  let walking = await read();
  for (let i = 0; i < 12; i += 1) {
    await page.evaluate(() => window.__browserSmashStep(0.06));
    const sample = await read();
    walking = sample;
    if (sample[0].report?.feet?.some(foot => foot.contact)) break;
  }
  await page.keyboard.up('d');
  check('walking reports an active grounded layer on Kaze', walking[0].report?.state === 'active', JSON.stringify(walking[0].report?.state));
  check('walking keeps at least one Kaze contact foot', walking[0].report?.feet?.some(f => f.contact),
    JSON.stringify(walking[0].report?.feet));
  check('walking does not lift a planted ankle above the floor', walking[0].report.feet.filter(f => f.contact)
    .every(f => f.height >= -0.04 && f.height < 0.45),
    JSON.stringify(walking[0].report.feet.map(f => ({ contact: f.contact, height: f.height }))));
  check('stride cadence is normalized from Kaze\'s measured leg',
    Math.abs((walking[0].report?.stride || 1) - 1) > 0.01, JSON.stringify(walking[0].report?.stride));
  check(`the ${p2Name} control receives its calibrated report`, walking[1].report?.state === 'active',
    JSON.stringify(walking[1].report));

  // Land from a short jump and sample during the recovery window.
  await page.keyboard.press('Space');
  await page.evaluate(() => window.__browserSmashStep(0.18));
  await page.keyboard.press('Space');
  let landing = await read();
  for (let i = 0; i < 40; i += 1) {
    await page.evaluate(() => window.__browserSmashStep(0.05));
    const snapshot = await read();
    landing = snapshot;
    const replanting = snapshot.some(entry => (entry.report?.landingReplantTimer || 0) > 0
      && entry.report.feet.some(foot => foot.targetReason === 'landing'));
    if (replanting) break;
    const grounded = await page.evaluate(() => window.fighters.every(f => f.isGrounded));
    if (grounded && i > 12) break;
  }
  check('landing returns to a grounded locomotion report on Kaze', landing[0].report?.state === 'active',
    JSON.stringify(landing[0].report?.state));
  check('landing blends a recovery compression', (landing[0].report?.landing || 0) > 0.05,
    JSON.stringify(landing[0].report?.landing));
  check('landing re-plants both feet in the contact band',
    (landing[0].report?.landingReplantTimer || 0) > 0
    && landing[0].report.feet.length === 2
    && landing[0].report.feet.every(foot => foot.contact && foot.targetReason === 'landing'
      && foot.height >= -0.04 && foot.height <= 0.22),
    JSON.stringify({ timer: landing[0].report?.landingReplantTimer, feet: landing[0].report?.feet }));
  await capture('landing');

  await page.evaluate(() => window.smashCamera?.spectate?.({ fighter: window.fighters[0], framing: 'full', distance: 3.2, yaw: 90, pitch: 4 }));
  await page.waitForTimeout(700);
  const slug = `${p1Name}-${p2Name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  await page.screenshot({ path: `artifacts/locomotion-layer/${slug}.png` });
  check('no page errors during idle, walk or landing', errors.length === 0, errors.slice(0, 2).join(' | '));
  console.log('SUMMARY ' + JSON.stringify({ checks: results.length, idle, walking, landing }));
} finally {
  await browser?.close();
  server.close();
}
