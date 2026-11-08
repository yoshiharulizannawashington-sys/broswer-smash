// Camera composition acceptance across the eight required Asgard situations.
//
//   node scripts/accept-camera-composition.mjs        (or bash scripts/run-browser-test.sh ...)
//
// Each scenario records, per fighter: screen-space bounds, whether both are inside the frame, and
// whether the head and torso sightlines are clear. A scenario passes only when BOTH fighters are on
// screen with unblocked head and torso. It also records camera position/distance, the solver's chosen
// adjustment, frame rate and page errors, and saves a PNG per scenario.
//
// This is composition evidence from a software renderer (SwiftShader). It is not hardware-rendered
// visual acceptance: frame rate here is meaningless as a performance signal.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve(root, 'artifacts', 'camera', stamp);
await mkdir(out, { recursive: true });

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"sources":[],"roster":{"launch":[],"manifestKeys":[]}}');
      return;
    }
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) relative = 'public' + sep + relative;
    const file = resolve(root, relative);
    if (!file.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) { res.writeHead(404); res.end('Not found'); } else res.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e.message)));
const results = [];
try {
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running', null, { timeout: 180_000, polling: 250 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const select = window.__browserSmashSelect;
    select?.select('p1', 'Wonder Woman');
    select?.select('p2', 'Thor');
    select?.chooseArena?.('asgard');
    document.querySelector('#practice')?.click();
  });
  // The spectate style hides the HUD, so the captured frame is the composition with no overlays.
  await page.evaluate(() => document.body.classList.add('spectating'));
  await page.waitForTimeout(3200);

  const place = (where) => page.evaluate(({ a, b }) => {
    const f = window.fighters || [];
    if (f[0]) { f[0].position.set(a[0], a[1], a[2]); f[0].velocity?.set(0, 0, 0); }
    if (f[1]) { f[1].position.set(b[0], b[1], b[2]); f[1].velocity?.set(0, 0, 0); }
    window.__browserSmashStep?.(1.4);
  }, where);

  // A scenario is graded on a fixed pose: the CPU fighters keep moving, so a settle loop without
  // pinning measured the camera against wherever the AI had wandered. The pose is whatever the
  // scenario set (spawn uses the real spawn positions), held while the damped lens converges.
  // The camera is damped and driven by the render loop. Calling __browserSmashStep in a tight loop
  // advances the simulation but never renders, so the lens kept its framing from the PREVIOUS pose -
  // which is why a clipped fighter still reported an unadjusted camera. Drive the camera directly.
  const settleCamera = pose => page.evaluate(where => {
    const cam = window.smashCamera?.camera;
    const f = window.fighters || [];
    if (!cam || f.length < 2) return null;
    const pin = () => {
      for (const fighter of f) {
        if (typeof fighter.health === 'number') {
          const max = Number.isFinite(fighter.maxHealth) ? fighter.maxHealth : 100;
          if (fighter.health < max) fighter.health = max;
        }
      }
      if (where?.a) { f[0].position.set(where.a[0], where.a[1], where.a[2]); f[0].velocity?.set(0, 0, 0); }
      if (where?.b) { f[1].position.set(where.b[0], where.b[1], where.b[2]); f[1].velocity?.set(0, 0, 0); }
    };
    let last = { x: cam.position.x, y: cam.position.y, z: cam.position.z };
    for (let i = 0; i < 26; i++) {
      pin();
      window.smashCamera.update?.(f[0], f[1], 0.2, 'overhead');
      pin();
      const moved = Math.hypot(cam.position.x - last.x, cam.position.y - last.y, cam.position.z - last.z);
      last = { x: cam.position.x, y: cam.position.y, z: cam.position.z };
      if (moved < 0.02 && i > 6) break;
    }
    pin();
    window.smashCamera.snap?.();
    window.smashCamera.update?.(f[0], f[1], 0.05, 'overhead');
    cam.updateMatrixWorld(true);
    return last;
  }, pose);

  const currentPose = async () => page.evaluate(() => {
    const f = window.fighters || [];
    return {
      a: f[0] ? [f[0].position.x, f[0].position.y, f[0].position.z] : null,
      b: f[1] ? [f[1].position.x, f[1].position.y, f[1].position.z] : null
    };
  });

  // A scenario must run on a live match. The play button is on screen only once the match is over.
  const ensureLive = async () => {
    const ended = await page.evaluate(() => {
      const play = document.querySelector('#play');
      return Boolean(play && play.offsetParent !== null);
    });
    if (!ended) return false;
    await page.evaluate(() => {
      const practiceButton = document.querySelector('#practice');
      practiceButton?.click();
      window.fighters?.forEach(f => { if (typeof f.health === 'number') f.health = Number.isFinite(f.maxHealth) ? f.maxHealth : 100; });
    });
    await page.waitForTimeout(2200);
    return true;
  };

  const measure = async (label, pose = null, { settle = true } = {}) => {
    const only = process.env.SCENARIOS;
    if (only && !only.split(',').map(x => x.trim()).filter(Boolean).includes(label)) return true;
    const restarted = await ensureLive();
    if (restarted && pose) await place(pose);
    const before = await page.evaluate(() => window.smashCamera?.composition?.switches ?? 0);
    if (settle) await settleCamera(pose || await currentPose());
    const data = await page.evaluate(async () => {
      const fps = await new Promise(done => {
        let frames = 0;
        const started = performance.now();
        const tick = () => {
          frames++;
          if (performance.now() - started < 900) requestAnimationFrame(tick);
          else done(Number((frames / ((performance.now() - started) / 1000)).toFixed(1)));
        };
        requestAnimationFrame(tick);
      });
      const cam = window.smashCamera;
      const f = window.fighters || [];
      const report = cam?.report && f.length >= 2 ? cam.report(f[0], f[1]) : null;
      return { fps, report, colliders: window.__browserSmashCameraColliders || null };
    });
    const switches = Math.max(0, (data.report?.bearings?.switches ?? 0) - before);
    const shot = { label, switches, ...data };
    results.push(shot);
    await page.screenshot({ path: resolve(out, label.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.png') });
    const r = data.report;
    const visible = Boolean(r) && r.fighters.every(x => x.bounds.onScreen && x.head.clear && x.torso.clear);
    const stable = switches <= 3;
    const outside = Boolean(r) && r.insideGeometry === false;
    const pass = visible && stable && outside;
    const reason = !visible ? 'VISIBILITY' : !outside ? 'INSIDE_GEOMETRY' : !stable ? 'OSCILLATION' : 'ok';
    console.log(`SCENARIO ${label} :: ${pass ? 'PASS' : 'FAIL'} :: ` + JSON.stringify({
      reason, camera: r?.camera, adjustment: r?.adjustment, switches, insideGeometry: r?.insideGeometry,
      fps: data.fps, colliders: data.colliders,
      fighters: r?.fighters.map(x => ({ name: x.name, onScreen: x.bounds.onScreen, height: x.bounds.heightFraction,
        bounds: [x.bounds.minX, x.bounds.maxX, x.bounds.minY, x.bounds.maxY],
        head: x.head.clear, torso: x.torso.clear, obstruction: x.head.obstruction || x.torso.obstruction }))
    }));
    return pass;
  };

  await measure('spawn');
  await page.evaluate(() => window.__browserSmashStep?.(0.6));
  await measure('plaza-standing');

  await place({ a: [56, 0, 12], b: [62, 0, 20] });
  await measure('narrow-street', { a: [56, 0, 12], b: [62, 0, 20] });

  await place({ a: [2, 0, -16], b: [12, 0, -24] });
  await measure('moving-apart', { a: [2, 0, -16], b: [12, 0, -24] });

  await place({ a: [0, 0, -20], b: [3, 6.5, -18] });
  await measure('one-airborne', { a: [0, 0, -20], b: [3, 6.5, -18] });

  await place({ a: [10, 0, -8], b: [12, 0, -6] });
  await page.evaluate(() => { const f = window.fighters?.[1]; f?.velocity?.set(-26, 6, 0); window.__browserSmashStep?.(0.5); });
  await measure('knockback', { a: [10, 0, -8], b: [12, 0, -6] });

  await place({ a: [-4, 0, -24], b: [7, 0, -14] });
  await page.evaluate(() => {
    const f = window.fighters || [];
    f[0]?.velocity?.set(3.2, 0, 1.4);
    f[1]?.velocity?.set(-2.6, 0, -1.1);
    for (let i = 0; i < 8; i++) window.__browserSmashStep?.(0.15);
  });
  await measure('moving-independently', null, { settle: false });

  await place({ a: [-1.2, 0, -20], b: [1.2, 0, -19.5] });
  await measure('close-combat', { a: [-1.2, 0, -20], b: [1.2, 0, -19.5] });

  await place({ a: [-23, 0, -8], b: [-28, 0, -3] });
  await measure('palace-architecture', { a: [-23, 0, -8], b: [-28, 0, -3] });

  await writeFile(resolve(out, 'report.json'), JSON.stringify({ stamp, errors, results }, null, 2));
  const failures = results.filter(r => {
    const rep = r.report;
    const visible = rep && rep.fighters.every(x => x.bounds.onScreen && x.head.clear && x.torso.clear);
    return !visible || rep.insideGeometry !== false || r.switches > 3;
  });
  console.log('colliders:', JSON.stringify(results[0]?.colliders));
  console.log('page errors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');
  console.log(`camera composition: ${results.length - failures.length}/${results.length} scenarios pass`);
  console.log('artifacts:', out);
  process.exitCode = failures.length ? 1 : 0;
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
