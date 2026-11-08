// Identify requests that 404 during a normal load of the public entrypoint.
//   node scripts/diag-404.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bin': 'application/octet-stream', '.ktx2': 'image/ktx2' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
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
    if (!res.headersSent) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); }
    else res.end();
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.setDefaultTimeout(180_000);
const bad = [];
page.on('response', r => { if (r.status() >= 400) bad.push({ status: r.status(), url: r.url() }); });
page.on('requestfailed', r => bad.push({ failed: r.failure()?.errorText, url: r.url() }));
await page.route('https://unpkg.com/three@0.152.2/**', async route => {
  const url = new URL(route.request().url());
  try { await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: await readFile(resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''))) }); }
  catch { await route.fulfill({ status: 404, body: 'missing' }); }
});
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.fighters?.length === 2, null, { timeout: 120_000, polling: 250 }).catch(() => {});
await page.waitForTimeout(4000);
console.log('NON_2XX ' + JSON.stringify(bad, null, 1));
const unique = [...new Set(bad.map(b => b.url))];
console.log('UNIQUE ' + unique.length + ': ' + unique.slice(0, 12).join(' | '));
await browser.close();
await new Promise(done => server.close(done));
