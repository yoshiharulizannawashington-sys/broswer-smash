// Boot diagnostic: what the page exposes 22 s after load, and what threw.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) relative = 'public' + sep + relative;
    res.writeHead(200, { 'Content-Type': mime[extname(relative).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, relative)));
  } catch (error) { res.writeHead(404); res.end('404 ' + error.message); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [];
const failed = [];
page.on('pageerror', error => errors.push(String(error).split('\n')[0]));
page.on('requestfailed', request => failed.push(request.url().slice(-70) + ' ' + (request.failure()?.errorText || '')));
await page.goto(origin + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(22000);
console.log(JSON.stringify(await page.evaluate(() => ({
  readyState: document.readyState,
  preview: typeof window.__browserSmashPreview,
  smashKeys: Object.keys(window).filter(key => /smash|preview|fighter/i.test(key)).slice(0, 24),
  assets: window.__browserSmashAssets?.characters?.status || null,
  selectScreen: Boolean(document.querySelector('#selectScreen')),
  previewCanvas: Boolean(document.querySelector('#selectScreen [data-role="preview"] canvas')),
  fighters: window.fighters?.length ?? null,
  bodyClass: document.body.className
})), null, 2));
console.log('errors', errors.slice(0, 6));
console.log('failedRequests', failed.slice(0, 6));
await browser.close();
server.close();
