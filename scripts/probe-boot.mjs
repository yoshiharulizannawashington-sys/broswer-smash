// Boot diagnostic: where does the page stop when the arena does not come up?
//   bash scripts/run-browser-test.sh scripts/probe-boot.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.hdr': 'application/octet-stream', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    const body = await readFile(resolve(root, rel));
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('PAGEERROR', String(e.message || e).slice(0, 200)));
page.on('crash', () => console.log('PAGE_CRASHED'));
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE_ERROR', m.text().slice(0, 200)); });

const t0 = Date.now();
console.log('goto', origin);
await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i = 0; i < 24; i += 1) {
  await page.waitForTimeout(5000);
  const s = await page.evaluate(() => ({
    title: Boolean(document.querySelector('#bbTitle')),
    fighters: window.fighters?.length ?? null,
    loading: document.querySelector('#loading')?.textContent?.slice(0, 40) || null,
    fatal: document.querySelector('#fatalError')?.textContent?.slice(0, 200) || null,
    app: window.__browserSmashAssets?.app?.status || null,
    weapons: window.__browserSmashAssets?.weapons?.status || null
  })).catch(error => ({ evaluateFailed: String(error.message).slice(0, 120) }));
  console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s`, JSON.stringify(s));
  if (s.fighters === 2 && s.title) break;
}
await browser.close();
server.close();
