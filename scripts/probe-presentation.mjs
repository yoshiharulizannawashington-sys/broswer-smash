import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => { try { const p = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname); let rel = normalize(p).replace(/^[/\\]+/, '') || 'index.html'; if (['js','assets','models','data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel; res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' }); res.end(await readFile(resolve(root, rel))); } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); } });
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.setDefaultTimeout(150000);
const errors = [];
page.on('pageerror', e => errors.push(String(e && e.stack || e).slice(0, 600)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 140000, polling: 250 });
const probe = await page.evaluate(() => {
  window.__browserSmashIntros = true;
  const before = { present: typeof window.__browserSmashPresentation, report: window.__browserSmashPresentation?.report?.() || null, errors: window.__browserSmashAiError || null };
  let clickError = null;
  try { document.querySelector('#play').click(); } catch (e) { clickError = String(e && e.message || e); }
  return { before: JSON.parse(JSON.stringify(before)), clickError, after: JSON.parse(JSON.stringify(window.__browserSmashPresentation?.report?.() || null)), status: document.querySelector('#status')?.textContent, menuHidden: document.querySelector('#menu')?.classList.contains('hidden') };
});
await page.waitForTimeout(800);
const later = await page.evaluate(() => ({ intro: JSON.parse(JSON.stringify(window.__browserSmashPresentation?.intro?.report?.() || null)), overlay: !!document.querySelector('#browserSmashCinematic'), status: document.querySelector('#status')?.textContent }));
const chosen = {
  present: probe.before.present,
  clickError: probe.clickError,
  status: probe.status,
  menuHidden: probe.menuHidden,
  introAfterClick: probe.after?.intro || null,
  scoreAfterClick: probe.after?.score || null,
  introLater: later.intro,
  overlayLater: later.overlay,
  statusLater: later.status,
  introsFlag: await page.evaluate(() => window.__browserSmashIntros),
  errors: errors.slice(0, 5)
};
console.log('PROBE', JSON.stringify(chosen, null, 1));
await browser.close(); server.close();
