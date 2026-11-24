// Kaze locomotion pilot before/after captures.
//   bash scripts/run-browser-test.sh scripts/capture-locomotion-pilot.mjs
//
// The mixer is frozen for each pair, so the only difference between the two frames is the
// foot-plant/stride layer. The pilot switch bypasses that layer for the raw frame; it is not a
// per-character rollout gate.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = resolve(root, 'artifacts/locomotion-pilot');
await mkdir(out, { recursive: true });
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
    res.writeHead(404); res.end('not found');
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
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) });
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
  await page.click('#selectScreen .bs-card[data-fighter="Kaze"]');
  await page.click('#selectScreen .bs-card[data-fighter="Goku"]');
  await page.click('#selectScreen [data-nav="next"]');
  await page.click('#selectScreen .bs-arena[data-arena="tournament"]');
  await page.evaluate(() => {
    window.__browserSmashSelect.setMode('2p');
    window.__browserSmashTrainingDummy = true;
  });
  await page.click('#play');
  await page.waitForFunction(() => window.__browserSmashSetLocomotionPilot
    && window.__browserSmashMatch().status === 'fighting');
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
    window.smashCamera?.spectate?.({ fighter: p1, framing: 'full', distance: 3.1, yaw: 90, pitch: 2 });
  });
  await page.evaluate(() => window.__browserSmashStep(0.45));

  const read = () => page.evaluate(() => {
    const f = window.fighters[0];
    const m = f.model;
    const report = m?.userData?.locomotionReport || null;
    const feet = ['leftFoot', 'rightFoot'].map(key => {
      const bone = m?.userData?.[key] || f.animationController?.rig?.joints?.[key];
      if (!bone) return null;
      bone.updateWorldMatrix(true, false);
      const e = bone.matrixWorld.elements;
      return { x: +e[12].toFixed(3), y: +e[13].toFixed(3), z: +e[14].toFixed(3) };
    });
    const mixer = m?.userData?.humanMixer || null;
    return {
      identity: f.identity, clip: report?.clip || m?.userData?.currentClip || null,
      report, feet,
      mixerTime: mixer ? +mixer.time.toFixed(3) : null,
      mixerScale: mixer ? mixer.timeScale : null,
      pilot: window.__browserSmashLocomotionPilotEnabled?.() ?? null
    };
  });

  const setPilot = enabled => page.evaluate(on => window.__browserSmashSetLocomotionPilot(on), enabled);
  const resetRawPose = () => page.evaluate(() => {
    // Re-evaluate the active clip at its current time so foot IK edits from the previous frame
    // are gone. The mixer stays at timeScale 0, so the pair remains in the same authored phase.
    const mixer = window.fighters[0].model?.userData?.humanMixer;
    if (!mixer) return;
    mixer.timeScale = 0;
    mixer.update(0);
  });
  const snapCamera = () => page.evaluate(() => {
    const f = window.fighters[0];
    const cam = window.__browserSmashCamera;
    cam.position.set(f.position.x, f.position.y + 1.25, f.position.z + 3.2);
    cam.lookAt(f.position.x, f.position.y + 1.02, f.position.z);
    cam.updateMatrixWorld(true);
    window.__browserSmashRenderer.render(window.__browserSmashScene, cam);
  });
  const freeze = () => page.evaluate(() => {
    const f = window.fighters[0];
    // Keep locomotion velocity so the state machine stays on walk/run. Pausing stops the real
    // render loop; the explicit step below only advances a sub-frame to apply the presentation.
    window.__browserSmashSetPaused(true);
    const mixer = f.model?.userData?.humanMixer;
    if (mixer) mixer.timeScale = 0;
  });
  const unfreeze = () => page.evaluate(() => {
    const f = window.fighters[0];
    const mixer = f.model?.userData?.humanMixer;
    if (mixer) mixer.timeScale = 1;
  });
  const resetPose = async () => {
    await page.evaluate(() => window.__browserSmashSetPaused(false));
    await unfreeze();
    await page.evaluate(() => {
      const [p1, p2] = window.fighters;
      p1.position.set(-7, p1.groundLevel || 0.18, -11);
      p2.position.set(7, p2.groundLevel || 0.18, -11);
      p1.facing = 1; p1.facingZ = 0;
      p2.facing = -1; p2.facingZ = 0;
      for (const f of [p1, p2]) {
        f.velocity.set(0, 0, 0);
        f.hitstun = 0;
        f.attackQueue.length = 0;
        f.guardBreak = 0;
        f.dodgeTimer = 0;
        f.landPulse = 0;
        f.isGrounded = true;
      }
      p1.model.userData.landingPoseTime = 0;
    });
    await page.evaluate(() => window.__browserSmashStep(0.25));
  };
  const pair = async (label) => {
    await setPilot(false);
    await page.evaluate(() => window.__browserSmashStep(0.016));
    await resetRawPose();
    await snapCamera();
    await page.waitForTimeout(180);
    const before = await read();
    await page.screenshot({ path: resolve(out, `${label}-before.png`) });
    await setPilot(true);
    await page.evaluate(() => window.__browserSmashStep(0.08));
    await snapCamera();
    await page.waitForTimeout(180);
    const after = await read();
    await page.screenshot({ path: resolve(out, `${label}-after.png`) });
    console.log(`PAIR ${label} before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
    return { label, before, after };
  };

  // Walk: hold a direction, let the cycle land on a contact pose, then freeze it.
  await resetPose();
  await page.keyboard.down('d');
  await page.evaluate(() => window.__browserSmashStep(0.55));
  await freeze();
  const walk = await pair('walk');
  await page.keyboard.up('d');
  check('walk uses Kaze walk and the pilot binds', afterClip(walk) && (walk.after.report?.legLength > 0.2),
    JSON.stringify(walk.after));

  // Run: sprint input reaches the run/sprint band.
  await resetPose();
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('d');
  await page.evaluate(() => window.__browserSmashStep(0.45));
  // Shift is also the dash button, so the first press can resolve as a dodge. Clear the dodge
  // and let the state machine settle onto the run cycle before freezing the pair.
  await page.evaluate(() => {
    const f = window.fighters[0];
    f.dodgeTimer = 0;
    f.dashTimer = 0;
    f.velocity.x = 8.5;
    f.velocity.z = 0;
  });
  await page.evaluate(() => window.__browserSmashStep(0.08));
  await freeze();
  const run = await pair('run');
  await page.keyboard.up('d');
  await page.keyboard.up('ShiftLeft');
  check('run uses a faster locomotion clip', /run|sprint/i.test(String(run.after.clip || '')), String(run.after.clip));

  // Turn in place: change the heading with the body stopped, freeze the pivot.
  await resetPose();
  await page.evaluate(() => {
    const f = window.fighters[0];
    f.facing = -1; f.facingZ = 0;
  });
  await page.evaluate(() => window.__browserSmashStep(0.1));
  await freeze();
  const turn = await pair('turn');
  check('turn raises the pilot pivot weight', (turn.after.report?.pivot || 0) > 0.1,
    JSON.stringify(turn.after.report));

  // Landing: jump, let the authored land clip start, freeze on the recovery.
  await resetPose();
  await page.keyboard.press('Space');
  for (let i = 0; i < 45; i += 1) {
    await page.evaluate(() => window.__browserSmashStep(0.04));
    const atLand = await page.evaluate(() => {
      const f = window.fighters[0];
      return /land/i.test(String(f.model?.userData?.locomotionReport?.clip || f.model?.userData?.currentClip || ''))
        || (f.landPulse || 0) > 0.1;
    });
    if (atLand) break;
  }
  await page.evaluate(() => {
    const f = window.fighters[0];
    f.velocity.set(0, 0, 0);
  });
  await freeze();
  const landing = await pair('land');
  check('landing reaches a land state', /land/i.test(String(landing.after.clip || '')), String(landing.after.clip));
  check('landing blends recovery compression', (landing.after.report?.landing || 0) > 0.02,
    JSON.stringify(landing.after.report));
  check('no page errors during captures', errors.length === 0, errors.slice(0, 2).join(' | '));

  await page.evaluate(() => window.__browserSmashSetPaused(false));
  await writeFile(resolve(out, 'report.json'), JSON.stringify({
    rig: 'Kaze (shared 19-bone generic source)', generatedAt: new Date().toISOString(),
    captures: { walk, run, turn, landing }, checks: results
  }, null, 2) + '\n');
  console.log('SUMMARY ' + JSON.stringify({ checks: results.length, captures: ['walk', 'run', 'turn', 'landing'] }));
} finally {
  await browser?.close();
  server.close();
}

function afterClip(pair) {
  return Boolean(pair.after?.report?.state === 'active' && pair.after?.report?.clip);
}
