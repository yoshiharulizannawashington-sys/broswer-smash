// Single-resolution intro capture used to check the title band and plate spacing.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd();
const out = 'artifacts/compare/presentation-phase2';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => { try { const p = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname); let rel = normalize(p).replace(/^[/\\]+/, '') || 'index.html'; if (['js','assets','models','data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel; res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' }); res.end(await readFile(resolve(root, rel))); } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); } });
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(180000);
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.evaluate(() => {
  window.__browserSmashIntros = true; window.__browserSmashIntroSeconds = 16;
  window.__browserSmashSelect?.select('p1', 'Naruto Uzumaki');
  window.__browserSmashSelect?.select('p2', 'Thor');
  document.querySelector('#play').click();
});
await page.waitForFunction(() => window.__browserSmashPresentation?.report?.().intro.active === true, null, { timeout: 20000, polling: 100 });
await page.waitForFunction(() => {
  const ready = role => { const n = document.querySelector(`#browserSmashCinematic [data-role="${role}"]`); if (!n) return false; const r = n.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; };
  return ready('plate-a') && ready('plate-b');
}, null, { timeout: 30000, polling: 100 });
const metrics = await page.evaluate(() => {
  const tag = document.querySelector('#browserSmashCinematic [data-role="tag"]');
  const r = tag.getBoundingClientRect();
  return { text: tag.textContent, lines: Math.round(r.height / parseFloat(getComputedStyle(tag).lineHeight)), height: +r.height.toFixed(1), width: +r.width.toFixed(1) };
});
console.log('TAG', JSON.stringify(metrics));
await page.screenshot({ path: `${out}/intro-final-1280x800.png` });
await browser.close(); server.close();
