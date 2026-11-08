// Captures a real in-match frame (not the title screen) so arena lighting can be judged where it counts.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/hd-sky';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.hdr': 'image/vnd.radiance', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
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
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 140)));

await page.goto(origin + '/' + (process.env.CAPTURE_QUERY || ''), { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.waitForFunction(() => window.__browserSmashSkyStatus?.loaded, null, { timeout: 60000, polling: 250 }).catch(() => {});
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Goku');
  window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki');
});
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 25000, polling: 200 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/03-idle.png` });
// Hold a fight pose rather than a neutral spawn: step the simulation deterministically.
await page.evaluate(() => {
  const key = (t, c) => window.dispatchEvent(new KeyboardEvent(t, { code: c, key: 'j', bubbles: true }));
  key('keydown', 'KeyJ');
  for (let i = 0; i < 40; i += 1) { window.__browserSmashStep(1 / 60); window.__browserSmashAttackTick?.(); }
  key('keyup', 'KeyJ');
});
await page.screenshot({ path: `${out}/04-match.png` });
const status = await page.evaluate(() => window.__browserSmashSkyStatus || null);
const light = await page.evaluate(() => {
  const scene = window.scene || null;
  return scene ? { intensity: scene.environmentIntensity ?? null, env: Boolean(scene.environment) } : null;
});
console.log('MATCH_STATUS', JSON.stringify({ status, light, errors }));
await browser.close(); server.close();
