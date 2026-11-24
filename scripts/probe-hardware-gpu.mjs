// Hardware-GPU preflight. This is intentionally separate from the fighter suites so a software
// renderer is rejected before any test can be recorded as hardware evidence.
//
// Run it through the browser wrapper:
//   HARDWARE_GPU=1 HARDWARE_GPU_HEADED=1 bash scripts/run-browser-test.sh scripts/probe-hardware-gpu.mjs
//
// The normal acceptance runner invokes this first:
//   npm run accept:hardware-gpu
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import {
  HARDWARE_GPU,
  assertHardwareGpu,
  browserLaunchOptions,
  captureGpu,
  isSoftwareRenderer
} from './lib/hardware-gpu.mjs';

const root = process.cwd();
const out = resolve(root, 'artifacts/hardware-gpu');
await mkdir(out, { recursive: true });
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
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
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end('Not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

let browser;
let page;
let gpu = null;
const errors = [];
const report = {
  generatedAt: new Date().toISOString(),
  origin,
  pageUrl: null,
  hardwareMode: HARDWARE_GPU,
  launch: browserLaunchOptions(),
  gpu: null,
  softwareRenderer: null,
  hardwareGpu: false,
  screenshot: null,
  errors,
  checks: {},
  pass: false
};

try {
  if (!HARDWARE_GPU) throw new Error('HARDWARE_GPU=1 is required; refusing to label a software run as hardware');
  browser = await chromium.launch(browserLaunchOptions());
  page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.setDefaultTimeout(180_000);
  page.on('pageerror', error => errors.push(String(error?.message || error).slice(0, 240)));
  page.on('console', message => {
    if (message.type() === 'error') errors.push('console: ' + message.text().slice(0, 220));
  });
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  report.pageUrl = page.url();
  await page.waitForFunction(() => window.__browserSmashRenderer
    && window.fighters?.length === 2
    && window.__browserSmashAssets?.app?.status === 'running', null, { timeout: 180_000, polling: 250 });
  gpu = await captureGpu(page);
  report.gpu = gpu;
  report.softwareRenderer = isSoftwareRenderer(gpu);
  report.hardwareGpu = Boolean(gpu?.available) && !report.softwareRenderer;
  report.checks = {
    webglContext: Boolean(gpu?.available),
    webgl2: gpu?.webgl2 === true,
    debugRendererInfo: gpu?.debugRendererInfo === true,
    hardwareVendor: !report.softwareRenderer,
    noPageErrors: errors.length === 0
  };
  await page.screenshot({ path: resolve(out, 'preflight.png'), fullPage: false });
  report.screenshot = resolve(out, 'preflight.png');
  if (!HARDWARE_GPU) throw new Error('HARDWARE_GPU=1 is required; refusing to label a software run as hardware');
  assertHardwareGpu(gpu, 'hardware preflight');
  report.pass = Object.values(report.checks).every(Boolean);
  if (!report.pass) throw new Error('hardware preflight checks failed: ' + JSON.stringify(report.checks));
  console.log('GPU ' + JSON.stringify(gpu, null, 2));
  console.log('HARDWARE PREFLIGHT PASS');
} catch (error) {
  errors.push(String(error?.stack || error).slice(0, 600));
  console.log('HARDWARE PREFLIGHT FAIL ' + String(error?.message || error));
} finally {
  await browser?.close().catch(() => {});
  server.close();
  report.errors = errors;
  report.pass = report.pass && errors.length === 0;
  await writeFile(resolve(out, 'preflight.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('PREFLIGHT_REPORT ' + resolve(out, 'preflight.json'));
}

process.exitCode = report.pass ? 0 : 1;
