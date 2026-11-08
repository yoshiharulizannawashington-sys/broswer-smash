// Visual evidence for the Goku kit and the ultimate cinematic: neutral gameplay, the cinematic's
// authored beats, and the frame after it releases. Uses the same deterministic boot as the probe.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/goku';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
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
await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.waitForTimeout(500);
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Goku');
  window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki');
  window.__browserSmashTrainingDummy = true;
  window.__browserSmashFreezeAI = true;
});
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/11-neutral-gameplay.png` });
console.log('SHOT neutral');

await page.evaluate(() => { const f = window.fighters[0]; f.meter = 100; f.specialCooldown = 0; f.attackQueue.length = 0; });
await page.keyboard.down('o');
await page.waitForFunction(() => window.smashCamera?.describeCineShot?.().beat === 'intro', null, { timeout: 12000, polling: 40 }).catch(() => null);
await page.waitForTimeout(220);
await page.screenshot({ path: `${out}/12-ultimate-intro.png` });
console.log('SHOT intro', await page.evaluate(() => window.smashCamera?.describeCineShot?.().beat || null));
await page.waitForFunction(() => window.smashCamera?.describeCineShot?.().beat === 'clash', null, { timeout: 12000, polling: 40 }).catch(() => null);
await page.waitForTimeout(160);
await page.screenshot({ path: `${out}/13-ultimate-clash.png` });
console.log('SHOT clash', await page.evaluate(() => window.smashCamera?.describeCineShot?.().beat || null));
await page.keyboard.up('o');
await page.waitForFunction(() => !window.smashCamera?.describeCineShot?.().active, null, { timeout: 12000, polling: 60 }).catch(() => null);
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/14-after-ultimate.png` });
console.log('SHOT after', await page.evaluate(() => window.smashCamera?.describeCineShot?.().beat || null));
await browser.close(); server.close();
