// Acceptance for the cinematic title beauty framing.
//
// For each large authored map it captures the title screen and measures, rather than eyeballs:
//   - the lens that was applied (and that it is not one shared transform),
//   - clearance along the sightline to the landmark (the camera is not inside scenery, nothing close
//     blocks the shot),
//   - where the landmark lands in the frame,
//   - how much of the frame the live geometry actually covers (so "empty sky/floor" fails),
//   - that the title UI is still on screen,
//   - that the environment toggle still works and does not move the camera,
//   - that starting a match hands the camera back to gameplay, and returning to the title restores
//     the same map-specific beauty shot.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/title-beauty';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.hdr': 'application/octet-stream', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`); };
const MAPS = ['asgard', 'hogwarts', 'deathstar', 'tournament', 'starktower'];

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { maps: {} };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
  await page.waitForTimeout(700);

  for (const key of MAPS) {
    await page.evaluate(k => {
      for (const sel of [document.querySelector('#mapSelect'), document.querySelector('#menuMapSelect')]) {
        if (sel) { sel.value = k; sel.dispatchEvent(new Event('change')); }
      }
      window.__browserSmashApplyMap(k);
    }, key);
    await page.waitForFunction(k => window.__browserSmashAssets?.authoredArena?.key === k
      && window.__browserSmashAssets.authoredArena.status === 'loaded', key, { timeout: 90000, polling: 300 });
    await page.waitForTimeout(900);
    const data = await page.evaluate(k => {
      const THREE = window.__browserSmashThree;
      const camera = window.smashCamera.camera;
      const group = window.__browserSmashAuthoredGroup;
      const state = window.__browserSmashTitleCamera();
      if (!THREE || !camera || !group || !state?.shot) return { key: k, error: 'missing handle' };
      const shot = state.shot;
      group.updateWorldMatrix(true, true);
      const target = new THREE.Vector3(shot.anchor[0], shot.anchor[1], shot.anchor[2]);
      const anchor = target.clone();
      const toTarget = target.clone().sub(camera.position);
      const distance = toTarget.length();
      const ray = new THREE.Raycaster(camera.position.clone(), toTarget.clone().normalize(), 0.05, distance);
      const hits = ray.intersectObject(group, true);
      const probe = new THREE.Raycaster();
      let covered = 0;
      let sampled = 0;
      for (const nx of [-0.75, -0.35, 0, 0.35, 0.75]) {
        for (const ny of [-0.55, -0.1, 0.35, 0.7]) {
          const ndc = new THREE.Vector3(nx, ny, 0.5).unproject(camera);
          probe.set(camera.position, ndc.sub(camera.position).normalize());
          const hit = probe.intersectObject(group, true)[0];
          sampled += 1;
          if (hit && hit.distance > 1.5) covered += 1;
        }
      }
      const anchorNdc = anchor.clone().project(camera);
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      const anchorInFront = forward.dot(anchor.clone().sub(camera.position)) > 0;
      // NDC z approaches 1.0 for a landmark a hundred metres away, so depth is reported for context
      // and front-ness is decided by the view vector, not by a rounded z value.
      const anchorDepth = +anchorNdc.z.toFixed(3);
      const panel = document.querySelector('#bbTitle').getBoundingClientRect();
      return {
        key: k,
        shot: { position: shot.position, anchor: shot.anchor, fov: shot.fov, ndcY: shot.ndcY, why: shot.why, lookAt: state.lookAt },
        panelTopNdc: +(1 - 2 * (panel.top / window.innerHeight)).toFixed(3),
        camera: { x: +camera.position.x.toFixed(2), y: +camera.position.y.toFixed(2), z: +camera.position.z.toFixed(2), fov: +camera.fov.toFixed(1) },
        distanceToTarget: +distance.toFixed(1),
        nearestHit: hits[0] ? +hits[0].distance.toFixed(2) : null,
        anchorNdc: { x: +anchorNdc.x.toFixed(2), y: +anchorNdc.y.toFixed(2), z: anchorDepth, inFront: anchorInFront },
        coverage: { covered, sampled },
        ui: {
          menuVisible: !document.querySelector('#menu').classList.contains('hidden'),
          titleRect: { w: Math.round(panel.width), h: Math.round(panel.height), top: Math.round(panel.top), bottom: Math.round(panel.bottom) },
          navCount: document.querySelectorAll('#bbTitle button').length,
          overlayBg: getComputedStyle(document.querySelector('#menu')).backgroundImage.slice(0, 40)
        }
      };
    }, key);
    report.maps[key] = data;
    await page.screenshot({ path: `${out}/${key}.png` });
    if (data.error) { check(`${key}: probe data`, false, data.error); continue; }
    console.log('SHOT', key, JSON.stringify({ camera: data.camera, shot: data.shot, nearestHit: data.nearestHit, coverage: data.coverage }));
    check(`${key}: authored shot applied`, Math.abs(data.camera.x - data.shot.position[0]) < 0.2 && Math.abs(data.camera.z - data.shot.position[2]) < 0.2, JSON.stringify(data.camera));
    check(`${key}: view is clear, camera not inside scenery`, data.nearestHit == null || data.nearestHit > 12, `nearest hit ${data.nearestHit} m of ${data.distanceToTarget} m`);
    check(`${key}: landmark sits in the visible band above the title panel`, data.anchorNdc.inFront && Math.abs(data.anchorNdc.x) < 0.95 && data.anchorNdc.y > data.panelTopNdc + 0.01 && data.anchorNdc.y < 0.98, JSON.stringify({ anchor: data.anchorNdc, panelTopNdc: data.panelTopNdc }));
    check(`${key}: frame is not empty sky or floor`, data.coverage.covered >= 9, JSON.stringify(data.coverage));
    check(`${key}: title UI stays on screen`, data.ui.menuVisible && data.ui.titleRect.w > 200 && data.ui.titleRect.h > 80 && data.ui.navCount >= 2, JSON.stringify(data.ui));
  }

  const lenses = MAPS.map(k => report.maps[k]?.camera).filter(Boolean);
  const distinct = new Set(lenses.map(c => `${c.x}|${c.y}|${c.z}|${c.fov}`));
  check('each map has its own composition (no shared transform)', distinct.size === MAPS.length, JSON.stringify([...distinct]));

  // Environment toggle must still work and must not move the title camera.
  const beforeF9 = await page.evaluate(() => ({ ...window.smashCamera.camera.position }));
  for (let i = 0; i < 3; i += 1) { await page.keyboard.press('F9'); await page.waitForTimeout(500); }
  const env = await page.evaluate(() => ({ mode: window.__browserSmashEnvironmentModeState, camera: { ...window.smashCamera.camera.position } }));
  check('environment toggle still works on the title', Boolean(env.mode?.devMode), JSON.stringify(env.mode));
  check('environment toggle leaves the beauty camera in place', Math.hypot(env.camera.x - beforeF9.x, env.camera.y - beforeF9.y, env.camera.z - beforeF9.z) < 0.01, JSON.stringify({ beforeF9, after: env.camera }));
  await page.screenshot({ path: `${out}/asgard-hdri-adjusted.png` });
  await page.evaluate(() => window.__browserSmashEnvironmentMode?.('auto'));
  await page.waitForTimeout(400);

  // Start a match, then return to the title.
  await page.evaluate(() => { const s = document.querySelector('#mapSelect'); s.value = 'asgard'; s.dispatchEvent(new Event('change')); window.__browserSmashApplyMap('asgard'); });
  await page.waitForFunction(() => window.__browserSmashAssets?.authoredArena?.key === 'asgard', null, { timeout: 60000, polling: 300 });
  await page.waitForTimeout(400);
  const titleShotBefore = await page.evaluate(() => ({ ...window.smashCamera.camera.position }));
  // The title overlay sits above the menu, so the start button is hidden at this point; call the same
  // handler the UI click would invoke rather than fighting the overlay's visibility.
  await page.evaluate(() => document.querySelector('#play')?.click());
  await page.waitForFunction(() => window.__browserSmashTitleCamera().started === true, null, { timeout: 30000, polling: 200 });
  await page.waitForTimeout(1400);
  const gameplay = await page.evaluate(() => ({
    title: window.__browserSmashTitleCamera(),
    camera: { x: +window.smashCamera.camera.position.x.toFixed(2), y: +window.smashCamera.camera.position.y.toFixed(2), z: +window.smashCamera.camera.position.z.toFixed(2), fov: +window.smashCamera.camera.fov.toFixed(1) },
    match: { arena: window.__browserSmashMatch?.().arena || null }
  }));
  check('starting a match releases the title camera', gameplay.title.active === false, JSON.stringify(gameplay.title));
  check('gameplay camera is not the title pose', Math.hypot(gameplay.camera.x - titleShotBefore.x, gameplay.camera.y - titleShotBefore.y, gameplay.camera.z - titleShotBefore.z) > 3, JSON.stringify({ titleShotBefore, gameplay: gameplay.camera }));
  await page.screenshot({ path: `${out}/gameplay-from-title.png` });

  await page.evaluate(() => window.__browserSmashReturnToTitle());
  await page.waitForTimeout(1100);
  const restored = await page.evaluate(() => ({
    title: window.__browserSmashTitleCamera(),
    camera: { x: +window.smashCamera.camera.position.x.toFixed(2), y: +window.smashCamera.camera.position.y.toFixed(2), z: +window.smashCamera.camera.position.z.toFixed(2) }
  }));
  check('returning to the title restores the same beauty shot', restored.title.active === true && Math.hypot(restored.camera.x - titleShotBefore.x, restored.camera.z - titleShotBefore.z) < 0.3, JSON.stringify(restored));
  await page.screenshot({ path: `${out}/title-restored.png` });
  check('no page errors', errors.length === 0, errors.join(' | '));

  const failed = checks.filter(c => !c.ok);
  report.checks = checks;
  report.errors = errors;
  await writeFile(`${out}/verify.json`, JSON.stringify(report, null, 2));
  console.log('SUMMARY', JSON.stringify({ passed: checks.length - failed.length, total: checks.length, failures: failed.map(c => `${c.name}: ${c.detail}`), errors: errors.length }));
  process.exitCode = failed.length ? 1 : 0;
} finally {
  await browser.close();
  server.close();
}
