import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 240)));
await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 120000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Hulk (Bruce Banner)');
  window.__browserSmashSelect?.select?.('p2', 'Goku');
  window.__browserSmashTrainingDummy = true;
  window.__browserSmashFreezeAI = true;
});
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
await page.waitForFunction(() => Boolean(window.fighters?.[0]?.model?.userData?.importedStrikeSet), null, { timeout: 60000, polling: 250 });

const result = await page.evaluate(() => {
  const f = window.fighters[0], foe = window.fighters[1];
  const step = n => { for (let i = 0; i < n; i += 1) window.__browserSmashStep(1 / 60); };
  let guard = 0;
  while (window.__browserSmashMatch().status !== 'match-over' && guard < 4000) {
    foe.percent = 999;
    step(1);
    guard += 1;
  }
  return {
    guard, summary: window.__browserSmashMatch(), debug: window.__browserSmashVictoryState?.(),
    hulkPosition: f.position.toArray().map(v => +v.toFixed(2)),
    collisionBlocks: window.smashCamera?.collisionBlocks?.length ?? null,
    stageBounds: window.smashCamera?.stageBounds || null,
    result: document.querySelector('#result')?.textContent || ''
  };
});
await page.waitForTimeout(300);
const afterReal = await page.evaluate(() => ({ debug: window.__browserSmashVictoryState?.(), result: document.querySelector('#result')?.textContent || '' }));
const afterStep = await page.evaluate(() => { window.__browserSmashStep(1 / 60); return { debug: window.__browserSmashVictoryState?.(), camera: window.smashCamera?.camera?.position?.toArray?.().map(v => +v.toFixed(2)) }; });
console.log(JSON.stringify({ result, afterReal, afterStep, errors }, null, 2));
await browser.close();
server.close();
