// Performance probe: drives a real two-fighter match and measures what the running game actually
// costs - frame time, scene size, live object counts and JS heap - before and during heavy combat.
//
//   bash scripts/run-browser-test.sh scripts/probe-performance.mjs
//
// Honest limitation: this container has no GPU, so Chromium runs software WebGL (SwiftShader). The
// absolute frame times here are far worse than a Chromebook's and must not be quoted as a
// device result. What the probe is good for is the *relative* cost of the changes (idle vs a full
// exchange with forms, ultimates and projectiles) and the object counts, which are exact.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const artifacts = resolve(root, 'artifacts');
await mkdir(artifacts, { recursive: true });

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

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.fighters?.length === 2, null, { timeout: 180_000, polling: 250 });

  // Frame-time sampler: real animation frames, so it measures the render loop the player sees.
  const installSampler = () => page.evaluate(() => {
    window.__perf = { frames: [], last: performance.now(), active: true };
    const tick = now => {
      if (!window.__perf.active) return;
      window.__perf.frames.push(now - window.__perf.last);
      window.__perf.last = now;
      window.__perf.request = requestAnimationFrame(tick);
    };
    window.__perf.request = requestAnimationFrame(tick);
    return true;
  });
  const readSampler = () => page.evaluate(() => {
    window.__perf.active = false;
    cancelAnimationFrame(window.__perf.request);
    const frames = window.__perf.frames.filter(value => value > 0 && value < 1000).sort((a, b) => a - b);
    const at = q => frames.length ? frames[Math.min(frames.length - 1, Math.floor(frames.length * q))] : null;
    const mean = frames.length ? frames.reduce((sum, value) => sum + value, 0) / frames.length : null;
    return {
      frames: frames.length,
      meanMs: mean ? +mean.toFixed(1) : null,
      medianMs: at(.5) ? +at(.5).toFixed(1) : null,
      p95Ms: at(.95) ? +at(.95).toFixed(1) : null
    };
  });

  const sceneReport = () => page.evaluate(() => {
    const scene = window.__browserSmashScene;
    let meshes = 0, materials = new Set(), bones = 0, skinned = 0, lights = 0;
    scene.traverse(node => {
      if (node.isMesh) { meshes++; for (const m of (Array.isArray(node.material) ? node.material : [node.material])) if (m?.uuid) materials.add(m.uuid); }
      if (node.isBone) bones++;
      if (node.isSkinnedMesh) skinned++;
      if (node.isLight) lights++;
    });
    const fighters = window.fighters.map(f => ({
      identity: f.identity,
      body: String(f.model?.userData?.characterAssetUrl || '').split('/').pop() || 'procedural',
      meshes: (() => { let n = 0; f.model.traverse(o => { if (o.isMesh) n++; }); return n; })(),
      clips: Object.keys(f.model?.userData?.animationActions || {}).length,
      mixers: f.model?.userData?.humanMixer ? 1 : 0
    }));
    return {
      sceneChildren: scene.children.length,
      meshes, materials: materials.size, bones, skinned, lights,
      projectiles: (window.__browserSmashProjectiles?.() || []).length,
      fighters,
      heapMb: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null
    };
  });

  // ---- idle --------------------------------------------------------------
  await page.evaluate(() => document.querySelector('#play').click());
  await page.waitForTimeout(2500);
  await installSampler();
  await page.waitForTimeout(4000);
  const idle = await readSampler();
  const idleScene = await sceneReport();

  // ---- a full exchange: forms, ultimates, specials, projectiles ----------
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.meter = 100; p1.power = 100; p2.meter = 100; p2.power = 100;
    window.__browserSmashTryForm?.('p1');
    window.__browserSmashTryUltimate?.('p1');
    window.__browserSmashTryForm?.('p2');
    window.__browserSmashTryUltimate?.('p2');
  });
  await page.waitForTimeout(2500);
  await installSampler();
  // Keep the busiest state alive: forms held, specials re-fired as they come off cooldown.
  for (let burst = 0; burst < 6; burst++) {
    await page.evaluate(() => {
      for (const side of ['p1', 'p2']) {
        const fighter = side === 'p1' ? window.fighters[0] : window.fighters[1];
        fighter.specialCooldown = 0; fighter.power = 100; fighter.meter = 100;
      }
      window.spawnProjectile?.(window.fighters[0], { source: 'special', ...(window.fighters[0].specialProfile || {}) });
      window.spawnProjectile?.(window.fighters[1], { source: 'special', ...(window.fighters[1].specialProfile || {}) });
      window.__browserSmashTryUltimate?.('p1');
    });
    await page.waitForTimeout(700);
  }
  const combat = await readSampler();
  const combatScene = await sceneReport();

  // ---- repeated rematches: is anything leaking? -------------------------
  const before = await page.evaluate(() => ({
    children: window.__browserSmashScene.children.length,
    weapons: window.__browserSmashAssets?.weapons?.count || 0
  }));
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      window.__browserSmashSelect?.select('p1', 'Hulk (Bruce Banner)');
      window.__browserSmashSelect?.select('p2', 'Iron Spider');
      document.querySelector('#play').click();
    });
    await page.waitForTimeout(1200);
  }
  const after = await sceneReport();

  console.log(JSON.stringify({
    idle, idleScene: { ...idleScene, fighters: undefined },
    combat, combatScene: { ...combatScene, fighters: undefined },
    afterRematches: { sceneChildren: after.sceneChildren, meshes: after.meshes, materials: after.materials, bones: after.bones, lights: after.lights, heapMb: after.heapMb },
    beforeRematches: before,
    fighters: combatScene.fighters,
    pageErrors: errors,
    note: 'Software WebGL (SwiftShader) in a container with no GPU: absolute frame times are not a device figure, relative cost and object counts are.'
  }, null, 2));
  await page.screenshot({ path: resolve(artifacts, 'performance-final.png') });
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
