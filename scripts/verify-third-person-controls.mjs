// Live third-person control test: does WASD actually drive a character around the camera?
//
//   bash scripts/run-browser-test.sh scripts/verify-third-person-controls.mjs
//
// Every movement assertion uses real keyboard events and the deterministic game step, then measures
// the fighter's world position, facing vector and the camera's own forward direction. A control
// scheme that only changes a config value cannot pass this.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/movement';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    let rel = normalize(p).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

let checks = 0;
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  checks++;
  console.log(`  ok  ${name}`);
}
const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
const norm2 = v => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180_000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.stack || e).slice(0, 400)));
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150_000, polling: 250 });
  await page.evaluate(() => {
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashFreezeAI = true;
    window.__browserSmashSelect?.chooseArena('valley');
    window.__browserSmashSelect?.select('p1', 'Naruto Uzumaki');
    window.__browserSmashSelect?.select('p2', 'Thor');
    document.querySelector('#play').click();
  });
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);

  // Select the new camera from the real UI, exactly as a player would.
  await page.evaluate(() => {
    const select = document.querySelector('#cameraMode');
    select.value = 'third-person';
    select.dispatchEvent(new Event('change'));
  });
  check('Third-Person Follow is a selectable UI option', await page.evaluate(() => {
    const select = document.querySelector('#cameraMode');
    return select.value === 'third-person' && [...select.options].some(o => o.value === 'third-person');
  }));

  const reset = () => page.evaluate(() => {
    const [p1, p2] = window.fighters;
    for (const f of [p1, p2]) {
      f.position.set(0, 0, 0);
      f.velocity.set(0, 0, 0);
      f.isGrounded = true;
      f.attackQueue.length = 0;
      f.hitboxes.length = 0;
      f.hitstun = 0;
      f.guardHeld = false;
      f.percent = 0;
      f.invulnerable = 0;
      f.jumps = 0;
      f.flightMode = false;
    }
    p1.position.set(0, 0, 0); p2.position.set(5, 0, 0);
    p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
    const cam = window.smashCamera;
    cam.orbitYaw = 0; cam.orbitPitch = 0; cam.followYaw = null; cam.pendingSnap = true; cam.setZoom(1.2);
    const keys = window.__browserSmashInput?.keys;
    if (keys) for (const code of Object.keys(keys)) keys[code] = false;
  });

  const read = () => page.evaluate(() => {
    const f = window.fighters[0];
    const cam = window.smashCamera.camera;
    cam.updateMatrixWorld(true);
    const m = cam.matrixWorld.elements;
    let dx = -m[8], dz = -m[10];
    const l = Math.hypot(dx, dz) || 1;
    return {
      pos: [f.position.x, f.position.z], y: f.position.y,
      facing: [f.facing, f.facingZ],
      camDir: [dx / l, dz / l],
      camPos: [cam.position.x, cam.position.y, cam.position.z],
      grounded: f.isGrounded,
      mode: window.__browserSmashCameraMode?.(),
      hitboxes: (f.hitboxes || []).map(h => [h.pos.x, h.pos.z])
    };
  });

  const press = async (keys, seconds) => {
    for (const key of keys) await page.keyboard.down(key);
    await step(seconds);
    for (const key of keys) await page.keyboard.up(key);
    return read();
  };

  // ---- W: away from the camera, character's back to the lens -------------------------------
  await reset();
  await step(0.5);
  const start = await read();
  const w = await press(['w'], 0.6);
  const wMove = sub2(w.pos, start.pos);
  check('W moves along the camera forward axis', dot2(norm2(wMove), w.camDir) > 0.85,
    `${JSON.stringify(wMove)} vs ${JSON.stringify(w.camDir)}`);
  check('W runs at least a metre (input actually drives movement)', Math.hypot(...wMove) > 1.0, String(Math.hypot(...wMove)));
  check('W turns the character away from the camera', dot2(w.facing, w.camDir) > 0.7,
    `${JSON.stringify(w.facing)} vs ${JSON.stringify(w.camDir)}`);
  const camToPlayer = [w.pos[0] - w.camPos[0], w.pos[1] - w.camPos[2]];
  check('the camera sits behind the character', dot2(norm2(camToPlayer), w.facing) > 0.5,
    JSON.stringify(camToPlayer));
  check('the camera is elevated above the character', w.camPos[1] > 1.6, String(w.camPos[1]));
  await page.screenshot({ path: resolve(root, out, 'third-person-w-back.png') });

  // ---- S: backpedal, no 180-degree spin -----------------------------------------------------
  await reset(); await step(0.4);
  const s = await press(['s'], 0.55);
  const sMove = sub2(s.pos, [0, 0]);
  check('S moves backwards relative to facing', dot2(norm2(sMove), s.facing) < -0.7,
    `${JSON.stringify(sMove)} vs ${JSON.stringify(s.facing)}`);
  check('S keeps the body facing the camera forward while backpedalling', dot2(s.facing, s.camDir) > 0.6,
    `${JSON.stringify(s.facing)} vs ${JSON.stringify(s.camDir)}`);

  // ---- A / D: strafe across the camera, facing stays forward --------------------------------
  await reset(); await step(0.4);
  const right = [-s.camDir[1], s.camDir[0]];
  const d = await press(['d'], 0.5);
  const dMove = sub2(d.pos, [0, 0]);
  check('D strafes to camera-right', dot2(norm2(dMove), right) > 0.7,
    `${JSON.stringify(dMove)} vs ${JSON.stringify(right)}`);
  check('D keeps the body facing camera-forward (strafe, not turn)', dot2(d.facing, d.camDir) > 0.7,
    JSON.stringify(d.facing));
  await reset(); await step(0.4);
  const a = await press(['a'], 0.5);
  const aMove = sub2(a.pos, [0, 0]);
  check('A strafes to camera-left', dot2(norm2(aMove), right) < -0.7, JSON.stringify(aMove));

  // ---- diagonal ----------------------------------------------------------------------------
  await reset(); await step(0.4);
  const target = norm2([d.camDir[0] + right[0], d.camDir[1] + right[1]]);
  const wd = await press(['w', 'd'], 0.6);
  const wdMove = sub2(wd.pos, [0, 0]);
  check('W+D moves diagonally forward-right', dot2(norm2(wdMove), target) > 0.75,
    `${JSON.stringify(wdMove)} vs ${JSON.stringify(target)}`);
  check('W+D turns the body into the diagonal', dot2(wd.facing, target) > 0.6,
    `${JSON.stringify(wd.facing)} vs ${JSON.stringify(target)}`);

  // ---- camera rotation redefines forward ----------------------------------------------------
  await reset(); await step(0.5);
  await page.evaluate(() => window.smashCamera.orbit(1.05, 0));
  await step(0.5);
  const rotated = await read();
  const rw = await press(['w'], 0.6);
  const rwMove = sub2(rw.pos, [0, 0]);
  check('rotating the camera changes what W means', Math.abs(dot2(norm2(rwMove), rotated.camDir)) > 0.8,
    `${JSON.stringify(rwMove)} vs new forward ${JSON.stringify(rotated.camDir)}`);

  // ---- jump while running ------------------------------------------------------------------
  await reset(); await step(0.4);
  await page.keyboard.down('w');
  await step(0.25);
  await page.keyboard.press('Space');
  await step(0.25);
  const air = await page.evaluate(() => ({ y: window.fighters[0].position.y, grounded: window.fighters[0].isGrounded }));
  check('jumping while running leaves the ground', air.y > 0.5 && !air.grounded, JSON.stringify(air));
  await step(1.6);
  await page.keyboard.up('w');
  const landed = await page.evaluate(() => ({ y: window.fighters[0].position.y, grounded: window.fighters[0].isGrounded }));
  check('the character lands back on the stage', landed.grounded && landed.y < 0.35, JSON.stringify(landed));

  // ---- attacks follow facing, not the camera -----------------------------------------------
  const attackAt = async (facing) => {
    await page.evaluate((f) => {
      const [p1, p2] = window.fighters;
      p1.position.set(0, 0, 0); p2.position.set(1.15 * f, 0, 0);
      p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0);
      p1.facing = f; p1.facingZ = 0; p2.facing = -f; p2.facingZ = 0;
      p1.hitstun = 0; p1.attackQueue.length = 0; p1.hitboxes.length = 0;
      p1.comboStep = 0; p1.attackBuffer = 0; p2.percent = 0; p2.invulnerable = 0; p2.hitstun = 0;
    }, facing);
    await step(0.3);
    await page.keyboard.press('j');
    await step(0.3);
    return page.evaluate(() => ({ percent: window.fighters[1].percent, facing: window.fighters[0].facing, hitboxes: (window.fighters[0].hitboxes || []).map(h => [h.pos.x, h.pos.z]) }));
  };
  const forwardHit = await attackAt(1);
  check('an attack while facing +X hits an opponent in front of +X', forwardHit.percent > 0,
    JSON.stringify(forwardHit));
  const backwardHit = await attackAt(-1);
  check('turning around turns the attack with the body', backwardHit.percent > 0,
    JSON.stringify(backwardHit));

  // ---- camera options ----------------------------------------------------------------------
  await page.evaluate(() => {
    const select = document.querySelector('#cameraMode');
    select.value = 'overhead';
    select.dispatchEvent(new Event('change'));
  });
  await reset();
  await step(1.2);
  const framing = await page.evaluate(async () => {
    const THREE = await import('three');
    const cam = window.smashCamera.camera;
    cam.updateMatrixWorld(true);
    return window.fighters.map(f => {
      const v = new THREE.Vector3(f.position.x, f.position.y + 1, f.position.z).project(cam);
      return [+v.x.toFixed(2), +v.y.toFixed(2)];
    });
  });
  check('Elevated Wide keeps both fighters in frame', framing.every(([x, y]) => Math.abs(x) <= 1 && Math.abs(y) <= 1), JSON.stringify(framing));
  await page.screenshot({ path: resolve(root, out, 'elevated-wide-both.png') });

  // ---- boundaries --------------------------------------------------------------------------
  await reset();
  await step(0.3);
  await page.keyboard.down('w');
  await step(3);
  await page.keyboard.up('w');
  const edge = await read();
  check('running does not leave the stage or produce NaN', Number.isFinite(edge.pos[0]) && Number.isFinite(edge.pos[1]) && Math.abs(edge.pos[0]) < 90 && Math.abs(edge.pos[1]) < 90 && edge.y >= -1,
    JSON.stringify(edge.pos));
  check('no page errors during the control run', errors.length === 0, errors.join(' | '));

  console.log(`\nThird-person controls passed (${checks} checks). Output: ${out}`);
} finally {
  await browser?.close();
  server.close();
}
