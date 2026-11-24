// Resource stability across repeated character swaps and arena changes.
//
//   bash scripts/run-browser-test.sh scripts/probe-resource-stability.mjs
//
// Counts are read from renderer.info after each swap, so a falling or flat series is measured, not
// inferred. The first appearance of a distinct body legitimately allocates; the claim under test is
// that repeated swaps stop allocating once the bodies have been seen.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/phase20');
await mkdir(outDir, { recursive: true });
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
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(filePath));
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const report = { swaps: [], arenas: [], errors: [] };
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl',
  '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--js-flags=--expose-gc'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.setDefaultTimeout(180_000);
page.on('pageerror', error => report.errors.push(String(error.message || error)));
page.on('console', message => { if (message.type() === 'error') report.errors.push('console: ' + message.text()); });
await page.route('https://unpkg.com/three@0.152.2/**', async route => {
  const url = new URL(route.request().url());
  const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
  try {
    await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
      headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) });
  } catch { await route.fulfill({ status: 404, body: 'missing' }); }
});

const stats = () => page.evaluate(() => {
  const renderer = window.__browserSmashRenderer;
  return {
    textures: renderer?.info?.memory?.textures ?? null,
    geometries: renderer?.info?.memory?.geometries ?? null,
    calls: renderer?.info?.render?.calls ?? null,
    triangles: renderer?.info?.render?.triangles ?? null,
    children: window.__browserSmashScene?.children.length ?? null,
    ownership: window.__browserSmashTextureOwnership?.() || null
  };
});

try {
  await page.goto(origin + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.fighters?.length === 2 && window.__browserSmashRenderer, null, { timeout: 180_000 });
  await page.evaluate(() => document.querySelector('#play')?.click());
  await page.waitForTimeout(2500);
  report.baseline = await stats();

  const names = ['Superman', 'Goku', 'Vegeta', 'Thor', 'Hulk (Bruce Banner)', 'Spider-Man', 'Kratos', 'Aang'];
  for (let i = 0; i < 30; i++) {
    const p1 = names[i % names.length];
    const p2 = names[(i + 3) % names.length];
    await page.evaluate(([a, b]) => {
      window.__browserSmashSelect?.select('p1', a);
      window.__browserSmashSelect?.select('p2', b);
    }, [p1, p2]);
    await page.waitForTimeout(750);
    await page.evaluate(() => window.__browserSmashStep?.(0.1));
    report.swaps.push({ i: i + 1, p1, p2, ...(await stats()) });
  }

  const tail = report.swaps.slice(-6);
  const spread = key => Math.max(...tail.map(s => s[key] ?? 0)) - Math.min(...tail.map(s => s[key] ?? 0));
  report.plateau = {
    tail: tail.map(s => ({ textures: s.textures, geometries: s.geometries, calls: s.calls })),
    textureSpreadLast6: spread('textures'),
    geometrySpreadLast6: spread('geometries'),
    textureMax: Math.max(...report.swaps.map(s => s.textures ?? 0)),
    geometryMax: Math.max(...report.swaps.map(s => s.geometries ?? 0)),
    baseline: { textures: report.baseline.textures, geometries: report.baseline.geometries }
  };

  for (const map of ['volcano', 'ice', 'neon', 'valley']) {
    await page.evaluate(key => {
      const select = document.querySelector('#mapSelect');
      if (!select) return;
      select.value = key;
      select.dispatchEvent(new Event('change'));
    }, map);
    await page.waitForTimeout(1400);
    report.arenas.push({ map, ...(await stats()) });
  }

  await writeFile(resolve(outDir, 'resource-stability.json'), JSON.stringify(report, null, 2));
  console.log('BASELINE ' + JSON.stringify(report.baseline));
  console.log('SWAPS ' + report.swaps.map(s => `${s.i}:t${s.textures}/g${s.geometries}/c${s.calls}`).join(' '));
  console.log('PLATEAU ' + JSON.stringify(report.plateau));
  console.log('ARENAS ' + report.arenas.map(a => `${a.map}:t${a.textures}/g${a.geometries}/c${a.calls}`).join(' '));
  console.log('ERRORS ' + JSON.stringify(report.errors.slice(0, 4)));
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
