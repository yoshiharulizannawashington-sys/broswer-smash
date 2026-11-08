// Performance audit for Phase 17: measures what the running game actually costs and whether it
// degrades over repeated matches, world switches and particle bursts.
//
//   bash scripts/run-browser-test.sh scripts/probe-performance-audit.mjs
//
// Honest limitation: this container has no GPU. Chromium runs software WebGL (SwiftShader), so
// absolute frame times are NOT a device figure and are reported as such. What is exact here:
// loading time, asset weight on disk, renderer.info draw calls/triangles, live geometry/texture
// counts, JS heap, and the *deltas* across rematches, world switches and bursts, which is how a
// leak or an accumulating listener shows up.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { resolve, normalize, sep, extname, join } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const artifacts = resolve(root, 'artifacts', 'p72');
await mkdir(artifacts, { recursive: true });

// ---- Asset weight on disk (exact, no browser needed) ---------------------
async function walk(dir, out = { files: 0, bytes: 0, byExt: {} }) {
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { await walk(path, out); continue; }
    try {
      const info = await stat(path);
      out.files++;
      out.bytes += info.size;
      const ext = extname(entry.name).toLowerCase() || '(none)';
      out.byExt[ext] = out.byExt[ext] || { files: 0, bytes: 0 };
      out.byExt[ext].files++;
      out.byExt[ext].bytes += info.size;
    } catch { /* unreadable file */ }
  }
  return out;
}
const assets = await walk(resolve(root, 'public'));

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
    // Read before writing headers. A read failure after writeHead(200) reached the catch with
    // headers already sent and threw ERR_HTTP_HEADERS_SENT, which killed the whole probe.
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch {
    if (!res.headersSent) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); }
    else res.end();
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const report = { assets, errors: [], note: 'Software WebGL (SwiftShader), no GPU: frame times are not a device figure. Object counts, draw calls and heap are exact.' };
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push('console: ' + message.text()); });
  page.on('requestfailed', request => report.errors.push('request failed: ' + request.url()));

  const startedAt = Date.now();
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.fighters?.length === 2, null, { timeout: 180_000, polling: 250 });
  report.loadingMs = Date.now() - startedAt;

  const stats = () => page.evaluate(() => {
    const scene = window.__browserSmashScene;
    const renderer = window.__browserSmashRenderer;
    let meshes = 0, materials = new Set(), lights = 0, instanced = 0;
    scene.traverse(node => {
      if (node.isMesh) meshes++;
      if (node.isInstancedMesh) instanced++;
      if (node.isLight) lights++;
      if (node.material) for (const m of (Array.isArray(node.material) ? node.material : [node.material])) if (m?.uuid) materials.add(m.uuid);
    });
    return {
      sceneChildren: scene.children.length,
      meshes, materials: materials.size, lights, instanced,
      geometries: renderer?.info?.memory?.geometries ?? null,
      textures: renderer?.info?.memory?.textures ?? null,
      drawCalls: renderer?.info?.render?.calls ?? null,
      triangles: renderer?.info?.render?.triangles ?? null,
      heapMb: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      // Lifetime texture-ownership counters, so a flat renderer count can be attributed to real
      // disposals instead of a swap that never happened.
      ownership: window.__browserSmashTextureOwnership?.() || null
    };
  });

  const sampleFrames = async (ms) => page.evaluate(async duration => {
    const frames = [];
    let last = performance.now();
    await new Promise(done => {
      const tick = now => {
        frames.push(now - last);
        last = now;
        if (now - frames.length * 0) { /* keep shape stable */ }
        if (frames.length * 16 >= duration || frames.length > 2000) done();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      setTimeout(done, duration + 500);
    });
    const clean = frames.filter(v => v > 0 && v < 5000).sort((a, b) => a - b);
    const at = q => clean.length ? +clean[Math.min(clean.length - 1, Math.floor(clean.length * q))].toFixed(1) : null;
    const mean = clean.length ? +(clean.reduce((s, v) => s + v, 0) / clean.length).toFixed(1) : null;
    return {
      frames: clean.length,
      meanMs: mean,
      fps: mean ? +(1000 / mean).toFixed(1) : null,
      medianMs: at(.5), p95Ms: at(.95), p99Ms: at(.99),
      over100ms: clean.filter(v => v > 100).length
    };
  }, ms);

  // ---- baseline match ----------------------------------------------------
  await page.evaluate(() => document.querySelector('#play')?.click());
  await page.waitForTimeout(2500);
  report.baseline = { frames: await sampleFrames(6000), ...(await stats()) };

  const setFighters = (p1, p2) => page.evaluate(([a, b]) => {
    window.__browserSmashSelect?.select('p1', a);
    window.__browserSmashSelect?.select('p2', b);
    document.querySelector('#play')?.click();
  }, [p1, p2]);

  // ---- repeated matches (leak check) ------------------------------------
  const chain = [['Hulk (Bruce Banner)', 'Iron Spider'], ['Goku', 'Vegeta'], ['Superman', 'Thor'],
    ['Naruto Uzumaki', 'Sasuke Uchiha'], ['Mario', 'Luigi']];
  report.rematches = [];
  for (const [a, b] of chain) {
    await setFighters(a, b);
    await page.waitForTimeout(1200);
    report.rematches.push({ match: `${a} vs ${b}`, ...(await stats()) });
  }

  // ---- world switching ---------------------------------------------------
  report.worlds = [];
  for (const key of ['hogwarts', 'deathstar', 'asgard', 'finalvalley', 'valley']) {
    await page.evaluate(map => {
      const select = document.querySelector('#mapSelect');
      if (!select) return false;
      select.value = map;
      select.dispatchEvent(new Event('change'));
      return true;
    }, key);
    await page.waitForTimeout(1500);
    report.worlds.push({ map: key, ...(await stats()) });
  }

  // ---- repeat the SAME fighter and SAME map -------------------------------
  // A new identity per match legitimately allocates its rig once, so growth across five different
  // characters cannot distinguish a cache filling up from a leak. Repeating one pair is decisive:
  // a leak keeps climbing, a cache plateaus.
  report.repeats = [];
  for (let i = 0; i < 4; i++) {
    await setFighters('Superman', 'Goku');
    await page.waitForTimeout(1200);
    report.repeats.push({ run: i + 1, ...(await stats()) });
  }
  report.sameWorld = [];
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const select = document.querySelector('#mapSelect');
      select.value = 'valley';
      select.dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(1500);
    report.sameWorld.push({ run: i + 1, ...(await stats()) });
  }

  // ---- thirty consecutive swaps ------------------------------------------
  // The claim under test is a plateau, not a lower first reading: the count is allowed to rise
  // while distinct bodies load, and must stop rising once the roster's bodies have all been seen.
  // Same-character and different-character swaps are interleaved for that reason.
  const swapNames = ['Superman', 'Goku', 'Vegeta', 'Thor', 'Hulk (Bruce Banner)', 'Spider-Man', 'Kratos', 'Aang'];
  report.swaps = [];
  for (let i = 0; i < 30; i++) {
    const a = swapNames[i % swapNames.length];
    const b = swapNames[(i + 3) % swapNames.length];
    await setFighters(a, b);
    await page.waitForTimeout(900);
    const s = await stats();
    report.swaps.push({ i: i + 1, pair: `${a} vs ${b}`, geometries: s.geometries, textures: s.textures, children: s.sceneChildren, ownership: s.ownership });
  }

  // ---- high particle / projectile load -----------------------------------
  const burstStart = await stats();
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    for (let i = 0; i < 60; i++) {
      const point = (i % 2 ? p1 : p2).position.clone();
      point.y += 1.1;
      window.spawnImpact?.(point, 18);
    }
    for (let i = 0; i < 20; i++) {
      window.spawnProjectile?.(p1, { source: 'special', ...(p1.specialProfile || {}) });
      window.spawnProjectile?.(p2, { source: 'special', ...(p2.specialProfile || {}) });
    }
  });
  report.burst = { frames: await sampleFrames(4000), before: burstStart, after: await stats() };
  await page.waitForTimeout(4000);
  report.burstSettled = await stats();

  // ---- long idle to surface slow leaks ----------------------------------
  await page.waitForTimeout(6000);
  report.afterIdle = await stats();

  await writeFile(resolve(artifacts, 'p17-perf.json'), JSON.stringify(report, null, 2));
  console.log('loadingMs:', report.loadingMs);
  console.log('asset bytes:', (assets.bytes / 1048576).toFixed(2), 'MB across', assets.files, 'files');
  console.log('baseline:', JSON.stringify({ fps: report.baseline.fps, p95: report.baseline.p95Ms, over100: report.baseline.over100ms, calls: report.baseline.drawCalls, tris: report.baseline.triangles, geo: report.baseline.geometries, tex: report.baseline.textures, heap: report.baseline.heapMb, meshes: report.baseline.meshes }));
  console.log('rematches:', report.rematches.map(r => `${r.match.split(' vs ')[0]}: geo=${r.geometries} tex=${r.textures} heap=${r.heapMb} children=${r.sceneChildren}`).join(' | '));
  console.log('worlds:', report.worlds.map(w => `${w.map}: geo=${w.geometries} tex=${w.textures} heap=${w.heapMb} children=${w.sceneChildren} calls=${w.drawCalls}`).join(' | '));
  console.log('repeat same fighter:', report.repeats.map(r => `geo=${r.geometries} tex=${r.textures} children=${r.sceneChildren}`).join(' | '));
  console.log('repeat same world:', report.sameWorld.map(r => `geo=${r.geometries} tex=${r.textures} children=${r.sceneChildren}`).join(' | '));
  const swapTail = report.swaps.slice(-5);
  console.log('swaps (30):', report.swaps.map(s => `${s.i}:g${s.geometries}/t${s.textures}`).join(' '));
  console.log('swap plateau (last 5):', JSON.stringify({
    geometries: swapTail.map(s => s.geometries), textures: swapTail.map(s => s.textures),
    maxTexture: Math.max(...report.swaps.map(s => s.textures ?? 0)),
    maxGeometry: Math.max(...report.swaps.map(s => s.geometries ?? 0)),
    ownership: swapTail[swapTail.length - 1]?.ownership || null
  }));
  console.log('burst:', JSON.stringify({ fps: report.burst.frames.fps, over100: report.burst.frames.over100ms, children: report.burst.after.sceneChildren, settledChildren: report.burstSettled.sceneChildren }));
  console.log('errors:', report.errors.length ? report.errors.slice(0, 5).join(' | ') : 'none');
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
