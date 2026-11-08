// Graphics preset probe: measures the real cost of each preset in the running game.
//
//   bash scripts/run-browser-test.sh scripts/probe-presets.mjs
//
// This container has no GPU, so Chromium renders with software WebGL (SwiftShader). The absolute
// frame times are not a device figure and are not reported as one. What is exact and useful:
// draw calls, triangles, material/shadow settings actually applied, and the relative frame cost
// between presets under identical software rendering.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const artifacts = resolve(root, 'artifacts', 'p72');
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
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(filePath));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

let browser;
const report = { presets: {}, errors: [], note: 'Software WebGL (SwiftShader), no GPU: absolute frame times are not a device figure.' };
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push('console: ' + message.text()); });

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.fighters?.length === 2, null, { timeout: 180_000, polling: 250 });
  await page.evaluate(() => document.querySelector('#play')?.click());
  await page.waitForTimeout(2500);

  const sample = async (preset) => {
    const applied = await page.evaluate(name => {
      const result = window.setGraphicsPreset?.(name) || null;
      return result ? { name: result.name, materials: result.materials, applied: result.applied } : null;
    }, preset);
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      window.__perf = { frames: [], last: performance.now(), active: true };
      const tick = now => {
        if (!window.__perf.active) return;
        window.__perf.frames.push(now - window.__perf.last);
        window.__perf.last = now;
        window.__perf.request = requestAnimationFrame(tick);
      };
      window.__perf.request = requestAnimationFrame(tick);
    });
    await page.waitForTimeout(3000);
    const measured = await page.evaluate(() => {
      window.__perf.active = false;
      cancelAnimationFrame(window.__perf.request);
      const frames = window.__perf.frames.filter(v => v > 0 && v < 1000).sort((a, b) => a - b);
      const mean = frames.length ? frames.reduce((s, v) => s + v, 0) / frames.length : null;
      const at = q => frames.length ? frames[Math.min(frames.length - 1, Math.floor(frames.length * q))] : null;
      const renderer = window.__browserSmashRenderer;
      return {
        frames: frames.length,
        meanMs: mean ? +mean.toFixed(1) : null,
        p95Ms: at(.95) ? +at(.95).toFixed(1) : null,
        drawCalls: renderer?.info?.render?.calls ?? null,
        triangles: renderer?.info?.render?.triangles ?? null,
        pixelRatio: renderer?.getPixelRatio?.() ?? null,
        shadowEnabled: renderer?.shadowMap?.enabled ?? null,
        shadowMapSize: window.__browserSmashSun?.shadow?.mapSize?.x ?? null,
        materials: window.__browserSmashAssetMaterialCount ?? null,
        heapMb: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null
      };
    });
    report.presets[preset] = { applied, ...measured };
    return measured;
  };

  for (const preset of ['low', 'medium', 'high', 'ultra']) await sample(preset);
  await sample('low'); // restore a playable default, and prove switching back works
  await page.screenshot({ path: resolve(artifacts, 'p16-preset-low.png') });

  await writeFile(resolve(artifacts, 'p16-presets.json'), JSON.stringify(report, null, 2));
  const rows = Object.entries(report.presets).map(([name, data]) =>
    `${name.padEnd(6)} frames=${String(data.frames).padStart(3)} meanMs=${String(data.meanMs).padStart(6)} p95=${String(data.p95Ms).padStart(6)} calls=${String(data.drawCalls).padStart(4)} tris=${String(data.triangles).padStart(7)} dpr=${data.pixelRatio} shadow=${data.shadowMapSize}`);
  console.log(rows.join('\n'));
  console.log('\npage errors:', report.errors.length ? report.errors.join(' | ') : 'none');
  if (report.errors.length) process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
