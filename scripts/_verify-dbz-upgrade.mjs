// Live acceptance for the DBZ environment upgrade. Each map gets a fresh page and a real
// match started through the menu, then keyboard movement and a landed light attack, a
// framing check against the live camera, and a screenshot. Usage:
//   bash scripts/run-browser-test.sh scripts/_verify-dbz-upgrade.mjs
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const origin = process.env.BROWSER_SMASH_URL || 'http://127.0.0.1:3000';
const out = resolve(process.env.CAPTURE_DIR || 'artifacts/dbz-upgrade/live');
await mkdir(out, { recursive: true });
const MAPS = ['dbz_west_city', 'dbz_east_city', 'dbz_capsule_corp', 'tournament', 'dbz_grand_prize'];
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const report = [];
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

for (const key of MAPS) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
  page.setDefaultTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error?.stack || error)));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.fighters?.length === 2 && window.__browserSmashSelect && window.__browserSmashStep,
  null, { timeout: 180_000, polling: 200 });
  await page.evaluate(k => {
    window.__browserSmashSelect.select?.('p1', 'Goku');
    window.__browserSmashSelect.select?.('p2', 'Vegeta');
    window.__browserSmashFreezeAI = true;
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashSelect.chooseArena(k);
  }, key);
  await page.waitForFunction(k => window.__browserSmashMatch?.().arena === k, key, { timeout: 60_000, polling: 100 });
  if (key === 'tournament') {
    await page.waitForFunction(() => window.__browserSmashAssets?.arenas?.tournament?.status === 'loaded',
      null, { timeout: 120_000, polling: 150 });
  } else {
    await page.waitForFunction(k => window.__browserSmashWorld?.location === k, key, { timeout: 60_000, polling: 100 });
  }
  await page.evaluate(() => document.querySelector('#play')?.click());
  await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 60_000 });
  // The match HUD doesn't count as a captured result while the 3D character load still owns
  // the screen. Wait for both rigs before spawning and framing.
  await page.waitForFunction(() => window.fighters?.length === 2
    && window.fighters.every(fighter => fighter.characterModelLoaded === true), null,
  { timeout: 180_000, polling: 200 });
  // The loading card is a real overlay; a screenshot before it hides is a capture of the
  // loader, not of the level. It hides itself once the shared asset set and one render settle.
  // On slower SwiftShader pages we give it a short window, then clear the card explicitly
  // only after both character rigs are confirmed loaded. The loader state is recorded.
  let overlayCleared = true;
  try {
    await page.waitForFunction(() => document.querySelector('#bbLoading')?.hidden === true,
      null, { timeout: 12_000, polling: 100 });
  } catch {
    overlayCleared = false;
    await page.evaluate(() => { const node = document.querySelector('#bbLoading'); if (node) node.hidden = true; });
  }
  // Hide both loading notices after the rig check so captures show the stage rather than a
  // diagnostic footer left by a slow secondary asset on SwiftShader.
  await page.evaluate(() => {
    const card = document.querySelector('#bbLoading'); if (card) card.hidden = true;
    const label = document.querySelector('#loading'); if (label) { label.style.opacity = '0'; label.textContent = ''; }
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__browserSmashSpawnFighters?.());
  await page.waitForTimeout(1200);
  // Snap once after the spawn teleport: on the software renderer a camera can otherwise be
  // measured on the frame before it catches up with the new pair.
  await page.evaluate(() => { window.smashCamera?.snap?.(); window.__browserSmashStep(.2); });
  await page.waitForTimeout(600);

  const start = await page.evaluate(() => {
    const layout = window.__browserSmashLayout();
    const cam = window.smashCamera?.camera;
    const THREE = window.__browserSmashThree;
    const project = point => {
      const v = point.clone(); v.y += 1;
      v.project(cam);
      return [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
    };
    cam?.updateMatrixWorld();
    const blocks = window.smashCamera?.collisionBlocks || [];
    const p = cam?.position;
    const insideSolid = Boolean(p && blocks.some(b => {
      if (b.top != null && p.y > b.top) return false;
      if (b.bottom != null && p.y < b.bottom) return false;
      if (b.r != null) return Math.hypot(p.x - b.x, p.z - b.z) < b.r - .2;
      return p.x > b.x0 + .2 && p.x < b.x1 - .2 && p.z > b.z0 + .2 && p.z < b.z1 - .2;
    }));
    return {
      paper: window.__browserSmashMatch(),
      layout,
      world: window.__browserSmashWorld,
      points: window.fighters.map(f => project(f.position.clone())),
      camera: cam ? [+cam.position.x.toFixed(1), +cam.position.y.toFixed(1), +cam.position.z.toFixed(1)] : null,
      insideSolid,
      distances: window.fighters.map(f => cam ? +cam.position.distanceTo(f.position).toFixed(1) : 0),
      gate: window.__browserSmashAssets?.dbzLandmarks || null,
      broadcast: window.__browserSmashAssets?.tournamentBroadcast || null,
      arena: window.__browserSmashAssets?.authoredArena || null
    };
  });
  check(start.layout?.label && start.paper.arena === key,
    `${key}: live layout is the selected arena (${start.layout?.label} / ${start.paper.arena})`);
  check(start.points.every(([x, y]) => Math.abs(x) < 1.05 && Math.abs(y) < 1.1),
    `${key}: both fighters are framed (${JSON.stringify(start.points)})`);
  check(start.camera && start.camera[1] > start.layout.ground + 1.5,
    `${key}: camera is above the court (${JSON.stringify(start.camera)})`);
  check(!start.insideSolid, `${key}: camera is not inside scenery (${JSON.stringify(start.camera)})`);
  check(Math.min(...start.distances) > 4, `${key}: camera is pulled back (${start.distances.join(',')})`);
  if (key === 'dbz_east_city') {
    check(start.gate?.status === 'loaded' && start.gate?.meshCount > 0,
      `East City: supplied tournament gate mounted (${JSON.stringify(start.gate)})`);
  }
  if (key === 'tournament') {
    check(start.arena?.status === 'loaded', `Tournament: authored GLB loaded (${JSON.stringify(start.arena)})`);
    check(start.broadcast?.meshes > 0, `Tournament: broadcast dressing built (${JSON.stringify(start.broadcast)})`);
  }

  // Keyboard movement: the input path a player uses, not a teleported position.
  const x0 = await page.evaluate(() => window.fighters[0].position.x);
  await page.keyboard.down('d');
  await page.evaluate(() => { for (let i = 0; i < 24; i++) window.__browserSmashStep(1 / 60); });
  await page.keyboard.up('d');
  const moved = await page.evaluate(() => window.fighters[0].position.x);
  check(Math.abs(moved - x0) > .8, `${key}: P1 moves with keyboard (${(moved - x0).toFixed(2)} m)`);

  // A real light attack against the training dummy.
  const hit = await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    const spawn = window.__browserSmashLayout().spawns[0];
    p1.position.set(spawn.x, spawn.y ?? p1.groundLevel, spawn.z);
    p2.position.set(spawn.x + 2.1, spawn.y ?? p2.groundLevel, spawn.z);
    p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
    p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0);
    p1.hitstun = 0; p2.hitstun = 0; p2.percent = 0; p2.guardHeld = false; p2.invulnerable = 0;
    p1.attackQueue?.clear?.(); p1.attackQueue.length = 0;
    window.__browserSmashStep(.05);
    return p2.percent;
  });
  await page.keyboard.press('j');
  await page.evaluate(() => { for (let i = 0; i < 40; i++) window.__browserSmashStep(1 / 60); });
  const hitAfter = await page.evaluate(() => window.fighters[1].percent);
  check(hitAfter > hit, `${key}: a light attack deals damage (${hit} -> ${hitAfter})`);

  await page.evaluate(() => {
    const layout = window.__browserSmashLayout();
    window.__browserSmashSpawnFighters?.();
    window.fighters.forEach((f, i) => {
      const spawn = layout.spawns[i] || layout.spawns[0];
      f.position.set(spawn.x, spawn.y ?? layout.ground, spawn.z);
      f.velocity.set(0, 0, 0); f.hitstun = 0; f.percent = 0; f.isGrounded = true;
    });
    window.__browserSmashStep(.3);
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(out, `${key}.png`) });
  report.push({ key, start, moved: +(moved - x0).toFixed(2), hit: [hit, hitAfter], overlayCleared, errors: errors.slice(0, 8) });
  console.log(key, JSON.stringify({ label: start.layout?.label, camera: start.camera,
    points: start.points, moved: +(moved - x0).toFixed(2), hit: [hit, hitAfter], overlayCleared,
    gate: start.gate?.status, broadcast: start.broadcast?.meshes, errors: errors.length }));
  await page.close();
}
await browser.close();
await writeFile(resolve(out, 'verification.json'), JSON.stringify({ generatedAt: new Date().toISOString(), failures, report }, null, 2));
console.log('FAILURES', failures.length);
for (const failure of failures) console.log(' -', failure);
process.exit(failures.length ? 1 : 0);
