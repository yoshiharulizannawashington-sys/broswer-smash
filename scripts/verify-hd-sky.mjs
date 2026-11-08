// Verifies the real CC0 HDRI actually reaches the renderer's environment, not just the network tab.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.hdr': 'image/vnd.radiance', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
const hdrRequests = [];
page.on('response', r => { if (r.url().endsWith('.hdr')) hdrRequests.push(`${r.status()} ${r.url().split('/').pop()}`); });

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
const status = await page.waitForFunction(() => window.__browserSmashSkyStatus, null, { timeout: 60000, polling: 250 })
  .then(h => h.jsonValue()).catch(() => null);
const env = await page.evaluate(() => {
  const scene = window.scene || window.__browserSmashScene || null;
  const texture = scene?.environment || null;
  return texture ? {
    mapping: texture.mapping,
    width: texture.image?.width || 0,
    height: texture.image?.height || 0,
    hdr: Boolean(texture.isDataTexture || texture.type === 1015 || texture.image?.data)
  } : null;
});
await page.screenshot({ path: 'artifacts/hd-sky/01-valley-hdri.png' }).catch(() => {});
const checks = [
  ['HDRI status reported as loaded', Boolean(status?.loaded), JSON.stringify(status)],
  ['the HDR file was served successfully', hdrRequests.some(r => r.startsWith('200')), hdrRequests.join(', ')],
  ['scene.environment is the equirect HDRI', Boolean(env) && env.width >= 1024, JSON.stringify(env)],
  ['no page errors', errors.length === 0, errors.slice(0, 2).join(' | ')]
];
let passed = 0;
for (const [name, ok, detail] of checks) { if (ok) passed += 1; console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`); }
console.log('SUMMARY', JSON.stringify({ passed, total: checks.length, hdrRequests }));
await browser.close(); server.close();
