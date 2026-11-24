// Capture the Wuhu expansion comparison from the live match, rather than the standalone
// orthographic viewer. Both frames use the same fixed perspective camera and the real GLB,
// lighting, post-processing and fighters. The before frame hides the land bridge and atoll shelf;
// the after frame shows both and places the second fighter on the new shelf.
//
//   bash scripts/run-browser-test.sh scripts/capture-wuhu-expansion-live.mjs
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/environment/arenas/wuhu-expansion/live');
await mkdir(outDir, { recursive: true });

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.hdr': 'image/vnd.radiance',
  '.wasm': 'application/wasm'
};

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sources: [] }));
      return;
    }
    const relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    const candidates = relative === 'index.html'
      ? [resolve(root, 'public/index.html')]
      : [resolve(root, relative), resolve(root, 'public', relative)];
    let body = null;
    let filePath = null;
    for (const candidate of candidates) {
      try { body = await readFile(candidate); filePath = candidate; break; } catch {}
    }
    if (!body) throw new Error('not found');
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end('not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(180_000);
const errors = [];
page.on('pageerror', error => errors.push(String(error.message || error).slice(0, 300)));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
    errors.push('console: ' + message.text().slice(0, 240));
  }
});
page.on('response', response => {
  if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`);
});

const cameraConfig = {
  position: [0, 15, -38],
  target: [-27, -1, -24],
  fov: 52
};
const beforeFighters = [{ x: -26, z: -18 }, { x: -24, z: -22 }];
const afterFighters = [{ x: -18.5, z: -24 }, { x: -15.5, z: -28 }];

const report = {
  title: 'Wuhu Island arena expansion · live camera',
  capture: 'live Three.js match scene, fixed perspective camera, HUD hidden',
  camera: cameraConfig,
  before: {
    bounds: { x0: -45, x1: -23, z0: -26, z1: -8 },
    dimensions: [22, 18],
    bridge: 'hidden',
    shelf: 'hidden',
    fighters: beforeFighters
  },
  after: {
    bounds: { x0: -45, x1: -11, z0: -38, z1: -10 },
    dimensions: [34, 28],
    bridge: 'visible',
    shelf: 'visible',
    fighters: afterFighters
  },
  files: {},
  pageErrors: errors
};

async function setFighters(positions) {
  return page.evaluate(({ positions }) => {
    const layout = window.__browserSmashLayout?.() || {};
    const heightAt = (x, z) => typeof layout.heightAt === 'function'
      ? layout.heightAt(x, z) : (layout.ground ?? 0);
    window.__browserSmashFreezeAI = true;
    window.fighters.forEach((fighter, index) => {
      const point = positions[index];
      if (!point) return;
      const y = heightAt(point.x, point.z);
      fighter.position.set(point.x, y, point.z);
      fighter.velocity?.set?.(0, 0, 0);
      fighter.isGrounded = true;
      fighter.groundLevel = y;
      fighter.facing = index === 0 ? 1 : -1;
      fighter.facingZ = 0;
      fighter.model?.position?.set?.(point.x, y, point.z);
    });
    return positions.map((point, index) => ({
      name: window.fighters[index]?.identity || window.fighters[index]?.name,
      x: point.x, y: +heightAt(point.x, point.z).toFixed(3), z: point.z
    }));
  }, { positions });
}

async function setExpansion({ bridge, shelf }) {
  return page.evaluate(({ bridge, shelf }) => {
    const group = window.__browserSmashAuthoredGroup;
    const bridgeObject = group?.getObjectByName?.('mariokart_land_bridge') || null;
    const shelfObject = group?.getObjectByName?.('mariokart_atoll_shelf') || null;
    if (bridgeObject) bridgeObject.visible = bridge;
    if (shelfObject) shelfObject.visible = shelf;
    return {
      bridgePresent: Boolean(bridgeObject), bridgeVisible: Boolean(bridgeObject?.visible),
      shelfPresent: Boolean(shelfObject), shelfVisible: Boolean(shelfObject?.visible)
    };
  }, { bridge, shelf });
}

async function setCamera() {
  return page.evaluate(({ cameraConfig }) => {
    const camera = window.__browserSmashCamera;
    camera.position.fromArray(cameraConfig.position);
    camera.up.set(0, 1, 0);
    camera.lookAt(...cameraConfig.target);
    camera.fov = cameraConfig.fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    return {
      position: camera.position.toArray().map(v => +v.toFixed(4)),
      quaternion: camera.quaternion.toArray().map(v => +v.toFixed(5)),
      fov: camera.fov
    };
  }, { cameraConfig });
}

async function captureState(name, fighters, expansion) {
  await page.evaluate(() => window.__browserSmashPause?.close?.());
  await setFighters(fighters);
  await setExpansion(expansion);
  await page.waitForTimeout(900);
  await page.evaluate(() => window.__browserSmashPause?.open?.());
  const camera = await setCamera();
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    document.querySelectorAll('body *').forEach(element => {
      if (element === canvas || element.contains(canvas)) return;
      element.style.visibility = 'hidden';
    });
    if (canvas) canvas.style.visibility = 'visible';
  });
  await page.waitForTimeout(350);
  const cameraReport = await page.evaluate(() => {
    const report = window.smashCamera?.report?.(window.fighters[0], window.fighters[1]) || null;
    const camera = window.__browserSmashCamera;
    return {
      report,
      fighters: window.fighters.map(fighter => {
        const screen = fighter.position.clone();
        screen.y += 1.0;
        screen.project(camera);
        return {
          name: fighter.identity || fighter.name,
          visible: fighter.model?.visible !== false,
          onScreen: Math.abs(screen.x) < 0.96 && Math.abs(screen.y) < 0.96,
          screen: { x: Math.round((screen.x * 0.5 + 0.5) * 1600), y: Math.round((0.5 - screen.y * 0.5) * 900) },
          position: {
            x: +fighter.position.x.toFixed(2), y: +fighter.position.y.toFixed(2),
            z: +fighter.position.z.toFixed(2)
          }
        };
      })
    };
  });
  const file = resolve(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  return { file, camera, cameraReport, expansion: await setExpansion(expansion) };
}

try {
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashMatch && window.__browserSmashStep
    && window.fighters?.length === 2, null, { timeout: 150_000, polling: 250 });
  await page.click('#bbTitle [data-nav="versus"]');
  await page.evaluate(() => {
    window.__browserSmashSelect.select('p1', 'Goku');
    window.__browserSmashSelect.select('p2', 'Naruto Uzumaki');
    window.__browserSmashSelect.chooseArena('mariokart');
    document.querySelector('#play').click();
  });
  await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting', null,
    { timeout: 45_000, polling: 100 });
  await page.waitForFunction(() => window.__browserSmashAssets?.arenas?.mariokart?.status === 'loaded',
    null, { timeout: 180_000, polling: 250 });
  await page.evaluate(() => {
    window.__browserSmashFreezeAI = true;
    window.__browserSmashTrainingDummy = true;
  });
  await page.waitForTimeout(1_200);

  const before = await captureState('before', beforeFighters, { bridge: false, shelf: false });
  const after = await captureState('after', afterFighters, { bridge: true, shelf: true });

  report.files.before = 'artifacts/environment/arenas/wuhu-expansion/live/before.png';
  report.files.after = 'artifacts/environment/arenas/wuhu-expansion/live/after.png';
  report.checks = {
    sameCamera: JSON.stringify(before.camera) === JSON.stringify(after.camera),
    beforeBridgeHidden: before.expansion.bridgePresent && !before.expansion.bridgeVisible,
    beforeShelfHidden: before.expansion.shelfPresent && !before.expansion.shelfVisible,
    afterBridgeVisible: after.expansion.bridgePresent && after.expansion.bridgeVisible,
    afterShelfVisible: after.expansion.shelfPresent && after.expansion.shelfVisible,
    fightersVisible: [before.cameraReport, after.cameraReport].every(state =>
      state.fighters.every(fighter => fighter.visible && fighter.onScreen)),
    fighterScreen: {
      before: before.cameraReport.fighters.map(fighter => ({ name: fighter.name, screen: fighter.screen, onScreen: fighter.onScreen })),
      after: after.cameraReport.fighters.map(fighter => ({ name: fighter.name, screen: fighter.screen, onScreen: fighter.onScreen }))
    },
    frameBytes: { before: (await readFile(before.file)).length, after: (await readFile(after.file)).length }
  };

  const comparisonPage = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  comparisonPage.setDefaultTimeout(180_000);
  const beforeImage = await readFile(before.file);
  const afterImage = await readFile(after.file);
  await comparisonPage.setContent(`<!doctype html>
  <html><head><meta charset="utf-8"><style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #07141c; color: #eaf7ff;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { padding: 40px 48px 34px; }
    header { display: flex; align-items: end; justify-content: space-between; gap: 28px; margin-bottom: 22px; }
    h1 { margin: 0; font-size: 30px; letter-spacing: -.025em; font-weight: 700; }
    .eyebrow { margin: 0 0 7px; color: #75e5ce; font: 700 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .16em; text-transform: uppercase; }
    .sub { margin: 7px 0 0; color: #9fb7c8; font-size: 13px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
    figure { margin: 0; background: #0c222e; border: 1px solid #1d3a4a; border-radius: 14px; overflow: hidden; }
    .frame { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; }
    figcaption { padding: 16px 18px 17px; }
    .tag { color: #75e5ce; font: 700 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .14em; text-transform: uppercase; }
    h2 { margin: 7px 0 4px; font-size: 20px; letter-spacing: -.015em; }
    .caption { margin: 0; color: #9fb7c8; font-size: 13px; line-height: 1.5; }
    .dim { color: #f4fbff; font-weight: 650; }
    footer { margin-top: 18px; color: #7894a5; font-size: 11.5px; line-height: 1.55; }
    footer strong { color: #a9c2d1; font-weight: 600; }
  </style></head><body><main>
    <header>
      <div><p class="eyebrow">Browser Smash · environment evidence</p>
        <h1>Wuhu Island arena expansion</h1>
        <p class="sub">Same fixed live-scene camera · both fighters visible · HUD hidden</p></div>
    </header>
    <div class="row">
      <figure><img class="frame" src="data:image/png;base64,${beforeImage.toString('base64')}" alt="Before: 22 by 18 metre Wuhu stage">
        <figcaption><div class="tag">Before</div><h2>West headland only</h2>
          <p class="caption"><span class="dim">22 × 18 m</span> stage. The land bridge and atoll shelf are hidden; both fighters stand on the old Wuhu ground.</p></figcaption>
      </figure>
      <figure><img class="frame" src="data:image/png;base64,${afterImage.toString('base64')}" alt="After: 34 by 28 metre Wuhu stage with land bridge and atoll shelf">
        <figcaption><div class="tag">After</div><h2>Wuhu + Sunshine atoll</h2>
          <p class="caption"><span class="dim">34 × 28 m</span> stage. The grass-and-rock bridge and atoll shelf are visible; both fighters are standing on the new shelf.</p></figcaption>
      </figure>
    </div>
    <footer><strong>Method:</strong> both frames are the live Three.js match at Wuhu with the same perspective camera transform. The before frame hides <code>mariokart_land_bridge</code> and <code>mariokart_atoll_shelf</code>; the after frame shows both. HUD is hidden and the CPU is frozen for a stable capture.</footer>
  </main></body></html>`, { waitUntil: 'load' });
  await comparisonPage.waitForTimeout(400);
  const comparisonFile = resolve(outDir, 'comparison.png');
  await comparisonPage.screenshot({ path: comparisonFile, fullPage: true, timeout: 120_000, animations: 'disabled' });
  report.files.comparison = 'artifacts/environment/arenas/wuhu-expansion/live/comparison.png';
  report.checks.comparisonWritten = true;

  await writeFile(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    files: report.files, checks: report.checks, before: before.cameraReport, after: after.cameraReport,
    pageErrors: report.pageErrors
  }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
