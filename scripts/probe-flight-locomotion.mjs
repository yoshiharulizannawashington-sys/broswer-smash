// Live proof for the shared flight locomotion package on the two body paths that consume it:
// Goku's baked legacy mixer and Iron Man's controller-driven procedural body.
//
//   PLAYWRIGHT_BROWSERS_PATH="$PWD/.tools/playwright/browsers" \
//     bash scripts/run-browser-test.sh scripts/probe-flight-locomotion.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const file = resolve(root, relative);
    if (!file.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const bytes = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || String(error)));
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const file = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(file) });
    } catch {
      await route.fulfill({ status: 404, body: 'missing' });
    }
  });

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
    null, { timeout: 120_000, polling: 200 });

  // Use the select screen's programmatic API. The card grid is virtualised and a card can be
  // present but off-screen, which is not a fighter or animation failure.
  await page.evaluate(() => document.querySelector('[data-nav="versus"]')?.click());
  await page.waitForSelector('#selectScreen', { state: 'visible', timeout: 30_000 });
  await page.evaluate(() => {
    window.__browserSmashSelect.select('p1', 'Goku');
    window.__browserSmashSelect.select('p2', 'Iron Man (Tony Stark)');
    window.__browserSmashSelect.chooseArena('tournament');
    document.querySelector('#selectScreen')?.classList.add('hidden');
    document.querySelector('#play')?.click();
  });
  await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'),
    null, { timeout: 60_000, polling: 100 });
  await page.evaluate(() => {
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashFreezeAI = true;
  });
  // The bespoke Goku body loads asynchronously over the procedural stand-in. Wait for the final
  // body and its authored Goku_Idle action before sampling, or the first frames describe a
  // placeholder mixer that is about to be swapped out.
  await page.waitForFunction(() => {
    const g = window.fighters?.[0];
    const u = g?.model?.userData;
    return Boolean(u?.humanMixer && u?.idleAction?.getClip?.()?.name === 'Goku_Idle');
  }, null, { timeout: 90_000, polling: 200 });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__browserSmashStep(1 / 60));

  const read = index => page.evaluate(i => {
    const f = window.fighters[i];
    const controller = f.animationController?.describe?.() || null;
    const plan = f.model?.userData?.flightLocomotion || controller?.flight || null;
    return {
      model: f.model?.name || null,
      hasClips: Boolean(f.model?.userData?.hasAnimationClips),
      hasMixer: Boolean(f.model?.userData?.humanMixer),
      released: Boolean(f.model?.userData?.animationControllerReleased),
      idleClip: f.model?.userData?.idleAction?.getClip?.()?.name || null,
      identity: f.identity,
      phase: plan?.phase ?? null,
      action: plan?.action ?? null,
      clip: plan?.clip ?? null,
      body: plan?.body ?? null,
      style: plan?.style ?? null,
      bank: plan?.bank ?? 0,
      presentation: plan?.presentation ?? null,
      boost: plan?.boost ?? false,
      speed: plan?.speed ?? Math.hypot(f.velocity?.x || 0, f.velocity?.z || 0),
      flying: Boolean(f.flightMode),
      grounded: Boolean(f.isGrounded),
      currentClip: f.model?.userData?.currentClip || null,
      controllerClip: controller?.active || null,
      timeScale: f.model?.userData?.lastMoveAction?.getEffectiveTimeScale?.() ?? null,
      hasController: Boolean(f.animationController)
    };
  }, index);

  const place = (index, { flight = true, grounded = false, velocity = [0, 0, 0], facing = 1, facingZ = 0 }) =>
    page.evaluate(({ index, flight, grounded, velocity, facing, facingZ }) => {
      const f = window.fighters[index];
      f.canFly = true;
      f.flightMode = flight;
      f.isGrounded = grounded;
      f.position.y = grounded ? 0 : 6;
      f.groundLevel = 0;
      f.velocity.set(velocity[0], velocity[1], velocity[2]);
      f.facing = facing;
      f.facingZ = facingZ;
      f.hitstun = 0;
      f.attackQueue = [];
    }, { index, flight, grounded, velocity, facing, facingZ });
  const frame = (seconds = 1 / 60) => page.evaluate(value => window.__browserSmashStep(value), seconds);

  const initial = await Promise.all([read(0), read(1)]);
  assert.ok(initial[0].identity === 'Goku' && initial[1].identity === 'Iron Man (Tony Stark)',
    `selected ${initial[0].identity} / ${initial[1].identity}`);
  assert.ok(initial[0].hasMixer && !initial[0].hasController, 'Goku is driven by his baked legacy mixer');
  assert.ok(initial[1].hasMixer && !initial[1].hasController, 'Iron Man is driven by his baked legacy mixer');
  const ironFlight = await page.evaluate(() => {
    const data = window.fighters[1].model?.userData || {};
    return {
      takeoff: data.flyTakeoffAction?.getClip?.()?.name || null,
      loop: data.flyLoopAction?.getClip?.()?.name || null,
      turn: data.flyTurnAction?.getClip?.()?.name || null,
      boost: data.flyBoostAction?.getClip?.()?.name || null,
      land: data.flyLandAction?.getClip?.()?.name || null
    };
  });
  console.log(`  body paths: Goku legacy=${initial[0].hasMixer && !initial[0].hasController}, Iron Man legacy=${initial[1].hasMixer && !initial[1].hasController}`);
  console.log('  iron flight actions', JSON.stringify(ironFlight));
  assert.deepEqual(ironFlight, {
    takeoff: 'iron_fly_start', loop: 'iron_fly_loop', turn: 'iron_fly_turn',
    boost: 'iron_fly_boost', land: 'iron_fly_land'
  });

  const states = [];
  async function stateFor(index, label, setup, frames = 2) {
    await place(index, setup);
    await frame(1 / 60);
    for (let i = 0; i < frames; i++) await frame(1 / 60);
    const state = await read(index);
    states.push({ label, ...state });
    return state;
  }

  // Goku: takeoff, hover, forward, boost, strafe, ascend, descend, turn, landing.
  let s = await stateFor(0, 'goku takeoff', { velocity: [0, 0, 0] }, 1);
  assert.equal(s.phase, 'takeoff'); assert.equal(s.action, 'flyTakeoffAction');
  assert.match(s.currentClip || '', /Goku_FlyTakeoff/);

  s = await stateFor(0, 'goku hover', { velocity: [0, 0, 0] }, 38);
  assert.equal(s.phase, 'hover'); assert.equal(s.action, 'hoverAction');
  assert.match(s.currentClip || '', /Goku_Hover/);

  s = await stateFor(0, 'goku forward', { velocity: [12, 0, 0] });
  assert.equal(s.phase, 'forward'); assert.match(s.currentClip || '', /Goku_FlyForward/);

  s = await stateFor(0, 'goku boost', { velocity: [24, 0, 0] }, 0);
  assert.equal(s.phase, 'boost'); assert.equal(s.boost, true); assert.match(s.currentClip || '', /Goku_FlyForward/);
  assert.ok((s.timeScale || 0) > 1, `boost cadence ${s.timeScale}`);

  s = await stateFor(0, 'goku strafe', { velocity: [0, 0, -6], facing: 1, facingZ: 0 });
  assert.ok(['strafe_left', 'strafe_right'].includes(s.phase), s.phase);
  assert.ok(Math.abs(s.bank) > 0.01, `bank ${s.bank}`);

  s = await stateFor(0, 'goku ascend', { velocity: [0, 4, 0] });
  assert.equal(s.phase, 'ascend');
  s = await stateFor(0, 'goku descend', { velocity: [0, -4, 0] });
  assert.equal(s.phase, 'descend');

  await place(0, { velocity: [10, 0, 0], facing: 0, facingZ: 1 });
  await frame(1 / 60);
  await page.evaluate(() => { const f = window.fighters[0]; f.facing = 1; f.facingZ = 0; });
  await frame(1 / 60);
  s = await read(0);
  states.push({ label: 'goku banked turn', ...s });
  assert.equal(s.phase, 'turn', s.phase);
  assert.ok(Math.abs(s.bank) > 0.01, `bank ${s.bank}`);
  assert.equal(s.presentation?.applied, true, 'bank reached Goku\'s torso');
  assert.match(s.currentClip || '', /Goku_FlyTurn/);

  await place(0, { flight: false, grounded: false, velocity: [2, -2, 0] });
  await frame(1 / 60);
  s = await read(0);
  states.push({ label: 'goku landing', ...s });
  assert.equal(s.phase, 'landing'); assert.equal(s.action, 'flyLandAction');
  assert.match(s.currentClip || '', /Goku_FlyLand/);
  await place(0, { flight: false, grounded: true, velocity: [0, 0, 0] });
  await frame(1 / 60);
  s = await read(0);
  states.push({ label: 'goku touchdown', ...s });
  assert.equal(s.phase, null); assert.match(s.currentClip || '', /Goku_Land/);

  // Iron Man: same phases through his baked legacy mixer, with the thruster clip family.
  s = await stateFor(1, 'iron takeoff', { velocity: [0, 0, 0] }, 1);
  assert.equal(s.phase, 'takeoff'); assert.match(s.clip || '', /^iron_fly_/);
  assert.match(s.currentClip || '', /^iron_fly_start/);

  s = await stateFor(1, 'iron hover', { velocity: [0, 0, 0] }, 38);
  assert.equal(s.phase, 'hover'); assert.equal(s.clip, 'iron_fly_loop');
  assert.match(s.currentClip || '', /^iron_fly_loop/);

  s = await stateFor(1, 'iron forward', { velocity: [12, 0, 0] });
  assert.equal(s.phase, 'forward'); assert.equal(s.style, 'thruster');
  assert.match(s.currentClip || '', /^iron_fly_loop/);

  s = await stateFor(1, 'iron boost', { velocity: [24, 0, 0] }, 0);
  assert.equal(s.phase, 'boost'); assert.equal(s.clip, 'iron_fly_boost');
  assert.match(s.currentClip || '', /^iron_fly_boost/);

  s = await stateFor(1, 'iron strafe', { velocity: [0, 0, -6], facing: 1, facingZ: 0 });
  assert.ok(['strafe_left', 'strafe_right'].includes(s.phase), s.phase);
  assert.ok(Math.abs(s.bank) > 0.01, `bank ${s.bank}`);

  s = await stateFor(1, 'iron ascend', { velocity: [0, 4, 0] });
  assert.equal(s.phase, 'ascend'); assert.equal(s.clip, 'iron_fly_climb');
  assert.match(s.currentClip || '', /^iron_fly_climb/);
  s = await stateFor(1, 'iron descend', { velocity: [0, -4, 0] });
  assert.equal(s.phase, 'descend'); assert.equal(s.clip, 'iron_fly_dive');
  assert.match(s.currentClip || '', /^iron_fly_dive/);

  await place(1, { velocity: [10, 0, 0], facing: 0, facingZ: 1 });
  await frame(1 / 60);
  await page.evaluate(() => { const f = window.fighters[1]; f.facing = 1; f.facingZ = 0; });
  await frame(1 / 60);
  s = await read(1);
  states.push({ label: 'iron banked turn', ...s });
  assert.equal(s.phase, 'turn', s.phase);
  assert.ok(Math.abs(s.bank) > 0.01, `bank ${s.bank}`);
  assert.equal(s.presentation?.applied, true, 'bank reached Iron Man\'s torso');
  assert.equal(s.clip, 'iron_fly_turn');
  assert.match(s.currentClip || '', /^iron_fly_turn/);

  await place(1, { flight: false, grounded: false, velocity: [2, -2, 0] });
  await frame(1 / 60);
  s = await read(1);
  states.push({ label: 'iron landing', ...s });
  assert.equal(s.phase, 'landing'); assert.equal(s.clip, 'iron_fly_land');
  assert.match(s.currentClip || '', /^iron_fly_land/);
  await place(1, { flight: false, grounded: true, velocity: [0, 0, 0] });
  await frame(1 / 60);
  s = await read(1);
  states.push({ label: 'iron touchdown', ...s });
  assert.equal(s.phase, null); assert.match(s.currentClip || '', /^iron_fly_land|^land$/);

  assert.deepEqual(errors, [], `page errors: ${errors.join('\n')}`);
  for (const row of states) {
    console.log(`  ok  ${row.label}: ${row.phase} | clip=${row.clip || '-'} | current=${row.currentClip || row.controllerClip || '-'} | bank=${Number(row.bank).toFixed(2)}`);
  }
  console.log(`\nLive flight locomotion passed (${states.length} body states, Goku + Iron Man).`);
} finally {
  await browser?.close();
  server.close();
}
