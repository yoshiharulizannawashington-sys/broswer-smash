// Normal-gameplay capture for the New York showcase reconstruction.
//
// It starts a real 1P match on the two Stark Tower stages, waits for the imported skyline
// landmark, freezes the CPU and settles the real duel camera. No diagnostic camera and no
// hand-placed lens: the frames are the composition the player actually gets.
//
//   bash scripts/run-browser-test.sh scripts/capture-nyc-showcase.mjs
//   NYC_CAPTURE_TAG=before bash scripts/run-browser-test.sh scripts/capture-nyc-showcase.mjs
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const tag = (process.env.NYC_CAPTURE_TAG || 'showcase').replace(/[^a-z0-9_-]/gi, '-');
const out = resolve(root, 'artifacts/environment/new-york/showcase');
await mkdir(out, { recursive: true });

const stages = [
  { key: 'nyc_stark_plaza', file: 'plaza' },
  { key: 'nyc_stark_roof', file: 'roof' }
];

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.hdr': 'application/octet-stream', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav'
};

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sources: [], roster: { launch: [], manifestKeys: [] } }));
      return;
    }
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
    if (!res.headersSent) res.writeHead(404);
    res.end('not found');
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
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.setDefaultTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error.message || error).slice(0, 300)));
  page.on('console', message => {
    if (message.type() === 'error') errors.push('console: ' + message.text().slice(0, 240));
  });
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try {
      await route.fulfill({
        status: 200, contentType: 'text/javascript; charset=utf-8',
        body: await readFile(localPath)
      });
    } catch {
      await route.fulfill({ status: 404, body: 'missing' });
    }
  });

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashStep && window.fighters?.length === 2,
  null, { timeout: 180_000, polling: 250 });

  const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);
  const frames = [];

  for (const stage of stages) {
    await page.evaluate(key => {
      const select = window.__browserSmashSelect;
      window.__browserSmashLastResult = null;
      select.setMode('1p');
      select.setRules({ roundsToWin: 1, roundSeconds: 99 });
      select.select('p1', 'Spider-Man');
      select.select('p2', 'Goku');
      select.chooseArena(key);
      window.__browserSmashFreezeAI = true;
      window.__browserSmashGame.startMatch();
      window.__browserSmashStep(0.2);
    }, stage.key);
    await page.waitForFunction(key => window.__browserSmashWorld?.location === key
      && window.__browserSmashControlMode?.().started === true,
    stage.key, { timeout: 180_000, polling: 250 });
    await page.waitForFunction(() => window.__browserSmashAssets?.nycSkyline?.status === 'loaded'
      || window.__browserSmashAssets?.nycSkyline?.status === 'fallback',
    null, { timeout: 180_000, polling: 250 });
    await page.evaluate(() => {
      window.__browserSmashFreezeAI = true;
      window.__browserSmashSkipCinematic?.();
      window.__browserSmashSpawnFighters();
      window.__browserSmashStep(1.6);
    });
    await page.waitForTimeout(1200);

    const report = await page.evaluate(key => {
      const assets = window.__browserSmashAssets || {};
      const [p1, p2] = window.fighters || [];
      const cam = window.camera || window.smashCamera?.camera;
      const project = object => {
        if (!cam || !object) return null;
        const p = object.position.clone();
        p.y += 1.05;
        const ndc = p.project(cam);
        return { x: +ndc.x.toFixed(2), y: +ndc.y.toFixed(2), onScreen: Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 };
      };
      return {
        stage: key,
        world: window.__browserSmashWorld,
        skyline: assets.nycSkyline || null,
        camera: cam ? { x: +cam.position.x.toFixed(1), y: +cam.position.y.toFixed(1), z: +cam.position.z.toFixed(1), fov: +cam.fov.toFixed(1) } : null,
        fighters: [p1, p2].map(f => ({ name: f?.name, at: f ? [+f.position.x.toFixed(1), +f.position.y.toFixed(1), +f.position.z.toFixed(1)] : null, screen: project(f?.model) })),
        loadingOpacity: getComputedStyle(document.querySelector('#loading')).opacity
      };
    }, stage.key);

    await page.screenshot({ path: resolve(out, `${tag}-${stage.file}.png`) });
    await writeFile(resolve(out, `${tag}-${stage.file}.json`), JSON.stringify(report, null, 1) + '\n');
    frames.push(report);
    console.log(`capture ${stage.key}:`, JSON.stringify(report));
  }

  // ---- Lazy landmark visibility ------------------------------------------------
  // Leaving New York must hide the imported tower without disposing it; returning must show
  // the already-loaded layer again rather than downloading 12.5 MB a second time.
  await page.evaluate(() => window.__browserSmashSelect.chooseArena('konoha_main_street'));
  await page.waitForFunction(() => window.__browserSmashWorld?.location === 'konoha_main_street',
    null, { timeout: 60_000, polling: 200 });
  const hidden = await page.evaluate(() => {
    const layer = window.__browserSmashScene?.getObjectByName('NYC skyline · Avengers Tower');
    return {
      world: window.__browserSmashWorld?.world,
      location: window.__browserSmashWorld?.location,
      exists: Boolean(layer),
      visible: layer?.visible ?? null,
      status: window.__browserSmashAssets?.nycSkyline?.status || null
    };
  });
  await page.evaluate(() => window.__browserSmashSelect.chooseArena('nyc_stark_plaza'));
  await page.waitForFunction(() => window.__browserSmashWorld?.location === 'nyc_stark_plaza',
    null, { timeout: 60_000, polling: 200 });
  const shown = await page.evaluate(() => {
    const layer = window.__browserSmashScene?.getObjectByName('NYC skyline · Avengers Tower');
    return {
      world: window.__browserSmashWorld?.world,
      location: window.__browserSmashWorld?.location,
      exists: Boolean(layer),
      visible: layer?.visible ?? null,
      status: window.__browserSmashAssets?.nycSkyline?.status || null,
      meshCount: window.__browserSmashAssets?.nycSkyline?.meshCount || null
    };
  });
  if (!hidden.exists || hidden.visible !== false) {
    throw new Error('NYC landmark stayed visible outside New York: ' + JSON.stringify(hidden));
  }
  if (!shown.exists || shown.visible !== true || shown.status !== 'loaded') {
    throw new Error('NYC landmark did not return from cache: ' + JSON.stringify(shown));
  }
  const visibilityCycle = { hidden, shown };
  await writeFile(resolve(out, `${tag}-visibility.json`), JSON.stringify(visibilityCycle, null, 1) + '\n');
  console.log('visibility cycle:', JSON.stringify(visibilityCycle));
  console.log('errors:', errors.length ? errors.slice(0, 4).join(' | ') : 'none');
  console.log('captures:', out);
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
