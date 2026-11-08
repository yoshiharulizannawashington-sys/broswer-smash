// Aerial combat test. Drives the real game in a browser with two flying fighters and asserts
// the eight things Phase 10 has to prove, on simulation state rather than screenshots:
//
//   1 take-off   2 full 3D movement   3 hovering   4 landing
//   5 collision  6 aerial damage      7 airborne knockback   8 both fighters in frame
//
// Game time is advanced with window.__browserSmashStep(), exactly as the gameplay test does, so
// the result does not depend on how fast the software renderer is.
//
// bash scripts/run-browser-test.sh scripts/test-flight-live.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();

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

const results = [];
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  results.push(name);
  console.log(`  ok  ${name}`);
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

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
    null, { timeout: 120_000, polling: 200 });

  // Two different fighters that can both fly: a Ki fighter and a thruster fighter.
  await page.click('#selectScreen .bs-card[data-fighter="Goku"]');
  await page.click('#selectScreen .bs-card[data-fighter="Iron Man (Tony Stark)"]');
  await page.click('#selectScreen [data-nav="next"]');
  await page.click('#selectScreen .bs-arena[data-arena="tournament"]');
  await page.click('#play');
  await step(0.15);
  // The CPU is a dummy for the whole run. Left live, its own attacks can stun the attacker or
  // leave it mid-move between phases, which is what made the first aerial attempt read as a whiff.
  await page.evaluate(() => { window.__browserSmashTrainingDummy = true; });

  const read = index => page.evaluate(i => {
    const f = window.fighters[i];
    return {
      x: f.position.x, y: f.position.y, z: f.position.z,
      vy: f.velocity.y, vx: f.velocity.x, vz: f.velocity.z,
      flight: f.flightMode, canFly: f.canFly, grounded: f.isGrounded,
      ground: f.groundLevel, percent: f.percent, hitstun: f.hitstun, identity: f.identity
    };
  }, index);

  const start = await Promise.all([read(0), read(1)]);
  check('both chosen fighters are flight-capable', start[0].canFly && start[1].canFly,
    `${start[0].identity} / ${start[1].identity}`);

  // ---- 1. Take-off --------------------------------------------------------
  await page.keyboard.press('f');
  await step(0.6);
  const takeoff = await read(0);
  check('F engages flight', takeoff.flight === true);
  check('take-off leaves the ground', takeoff.y > start[0].y + 1.2,
    `y ${start[0].y.toFixed(2)} -> ${takeoff.y.toFixed(2)}`);

  // ---- 2. Full 3D movement ------------------------------------------------
  const beforeClimb = await read(0);
  await page.keyboard.down('Space');           // jump doubles as ascend while flying
  await step(0.9);
  await page.keyboard.up('Space');
  const climbed = await read(0);
  check('ascending gains altitude', climbed.y > beforeClimb.y + 3,
    `+${(climbed.y - beforeClimb.y).toFixed(2)} m`);

  const beforeForward = await read(0);
  await page.keyboard.down('w');
  await step(0.8);
  const forward = await read(0);
  await page.keyboard.up('w');
  const travelled = Math.hypot(forward.x - beforeForward.x, forward.z - beforeForward.z);
  check('forward flight covers ground at flight speed', travelled > 4, `${travelled.toFixed(2)} m in 0.8 s`);

  const beforeStrafe = await read(0);
  await page.keyboard.down('d');
  await step(0.7);
  const strafed = await read(0);
  await page.keyboard.up('d');
  check('strafing moves sideways while holding altitude',
    Math.abs(strafed.x - beforeStrafe.x) > 3 && Math.abs(strafed.y - beforeStrafe.y) < 2,
    `dx ${(strafed.x - beforeStrafe.x).toFixed(2)} · dy ${(strafed.y - beforeStrafe.y).toFixed(2)}`);

  // ---- 3. Hovering --------------------------------------------------------
  await step(0.4);
  const hoverStart = await read(0);
  await step(1.2);
  const hover = await read(0);
  check('releasing the stick holds altitude', Math.abs(hover.vy) < 1.2 && Math.abs(hover.y - hoverStart.y) < 1.2,
    `vy ${hover.vy.toFixed(2)} · dy ${(hover.y - hoverStart.y).toFixed(2)}`);

  // ---- Flight brake -------------------------------------------------------
  await page.keyboard.down('d');
  await step(0.5);
  const moving = await read(0);
  await page.keyboard.up('d');
  await page.keyboard.down('x');
  await step(0.25);
  const braked = await read(0);
  await page.keyboard.up('x');
  check('the brake key bleeds horizontal speed',
    Math.hypot(braked.vx, braked.vz) < Math.hypot(moving.vx, moving.vz) * .6,
    `${Math.hypot(moving.vx, moving.vz).toFixed(2)} -> ${Math.hypot(braked.vx, braked.vz).toFixed(2)} m/s`);

  // ---- Ceiling ------------------------------------------------------------
  await page.keyboard.down('Space');
  await page.keyboard.down('ShiftLeft');
  await step(3.2);
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('Space');
  const ceiling = await read(0);
  check('flight respects its altitude ceiling', ceiling.y <= 14.05, `y ${ceiling.y.toFixed(2)}`);

  // ---- 4. Controlled landing ---------------------------------------------
  await page.keyboard.down('c');
  for (let i = 0; i < 24; i++) {
    await step(0.15);
    const now = await read(0);
    if (now.grounded) break;
  }
  await page.keyboard.up('c');
  const landed = await read(0);
  check('holding descend lands the fighter', landed.grounded === true,
    `y ${landed.y.toFixed(2)} · floor ${landed.ground.toFixed(2)}`);
  check('touchdown disengages flight', landed.flight === false);

  // ---- 5. Collision -------------------------------------------------------
  const bounds = await page.evaluate(() => ({ ...window.fighters[0].bounds }));
  await page.evaluate(() => { const f = window.fighters[0]; f.position.set(f.bounds.x1 - 1.2, 4, f.position.z); f.velocity.set(0, 0, 0); });
  await page.keyboard.press('f');
  await step(0.2);
  await page.keyboard.down('d');
  await step(1.5);
  await page.keyboard.up('d');
  const wall = await read(0);
  check('flight cannot leave the stage through its edge', wall.x <= bounds.x1 + 0.001,
    `x ${wall.x.toFixed(2)} · edge ${bounds.x1.toFixed(2)}`);

  // ---- 6. Aerial attack damage -------------------------------------------
  await page.evaluate(() => {
    window.__browserSmashTrainingDummy = true;
    const [p1, p2] = window.fighters;
    // Both fighters start this phase clean: no leftover stun, no half-finished move, both
    // airborne and holding altitude, both disengaged from the floor.
    for (const f of [p1, p2]) {
      f.flightMode = true;
      f.velocity.set(0, 0, 0);
      f.hitstun = 0; f.invulnerable = 0; f.guardBreak = 0; f.casting = false;
      f.attackQueue.length = 0; f.attackBuffer = 0;
      f.comboStep = 0; f.comboWindow = 0; f.comboHitCount = 0;
      f.isGrounded = false;
    }
    p1.position.set(0, 5, -12);
    p2.position.set(1.05, 5, -12);
    p2.percent = 0; p2.guardHeld = false;
    p1.facing = 1; p1.facingZ = 0;
    window.fighters[1].aiTimer = 999;
  });
  await step(0.2);
  const aerialBefore = await read(1);
  await page.keyboard.press('j');
  let aerialHit = null;
  let diagnostics = null;
  for (let i = 0; i < 40; i++) {
    await step(0.02);
    const now = await read(1);
    diagnostics = await page.evaluate(() => ({
      queue: window.fighters[0].attackQueue.length,
      move: window.fighters[0].activeMoveId,
      pose: Number(window.fighters[0].attackPose.toFixed(2)),
      boxes: window.fighters[0].hitboxes.length,
      attackerY: Number(window.fighters[0].position.y.toFixed(2)),
      victimY: Number(window.fighters[1].position.y.toFixed(2)),
      gap: Number(window.fighters[0].position.distanceTo(window.fighters[1].position).toFixed(2))
    }));
    if (now.percent > aerialBefore.percent) { aerialHit = now; break; }
  }
  check('a midair punch damages an airborne opponent', aerialHit != null && aerialHit.percent > 0,
    aerialHit ? `${aerialHit.percent.toFixed(1)}%` : `no hit · ${JSON.stringify(diagnostics)}`);

  // ---- 7. Airborne knockback ---------------------------------------------
  const knock = await read(1);
  check('the airborne victim is pushed, not dropped in place',
    Math.hypot(knock.vx, knock.vz) > 0.5 || !knock.grounded,
    `speed ${Math.hypot(knock.vx, knock.vz).toFixed(2)} · grounded ${knock.grounded}`);

  // ---- 8. Both fighters stay in frame ------------------------------------
  // Dropping both fighters into the camera's view is not a test, so this compares the same
  // horizontal gap at two vertical separations: level, then 11 m apart.
  const framingShot = () => page.evaluate(() => {
    const cam = window.smashCamera.camera;
    const project = f => {
      const v = f.position.clone();
      v.y += 1;
      v.project(cam);
      return { x: +v.x.toFixed(3), y: +v.y.toFixed(3) };
    };
    const [a, b] = window.fighters;
    return { a: project(a), b: project(b), distance: +window.smashCamera.framing.distance.toFixed(2) };
  });

  await page.evaluate(() => {
    const [a, b] = window.fighters;
    for (const f of [a, b]) { f.flightMode = true; f.velocity.set(0, 0, 0); f.hitstun = 0; }
    a.position.set(0, 3, -12);
    b.position.set(2, 3, -12);
  });
  await step(0.6);
  const level = await framingShot();

  await page.evaluate(() => {
    const [a, b] = window.fighters;
    a.position.set(0, 13, -12);
    b.position.set(2, 2, -12);
    a.velocity.set(0, 0, 0); b.velocity.set(0, 0, 0);
  });
  await step(0.7);
  const apart = await framingShot();

  const inFrame = p => Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;
  check('both fighters stay inside the frame with 11 m of vertical separation',
    inFrame(apart.a) && inFrame(apart.b),
    `A ${apart.a.x},${apart.a.y} · B ${apart.b.x},${apart.b.y}`);
  check('the camera pulls back as vertical separation grows', apart.distance > level.distance,
    `${level.distance} -> ${apart.distance} units`);

  check('no browser runtime errors during flight', errors.length === 0, errors.join('\n'));

  console.log(`\nAerial combat test passed (${results.length} checks).`);
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
