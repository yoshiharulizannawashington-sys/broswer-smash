// Captures the real results screen: the pause menu's character-select exit runs the game's own
// finish() -> resultMarkup() path with the live match stats, so this is the shipped screen and not
// a synthetic panel. (A knockout victory ends the same screen; reaching one needs a full round.)
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/ui2';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    let rel = normalize(p).replace(/^[/\\]+/, '') || 'index.html';
    if (rel === 'index.html') rel = 'public/index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep)) && ['js', 'assets', 'models', 'data', 'css'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' || window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.waitForTimeout(1000);
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Naruto Uzumaki');
  window.__browserSmashSelect?.select?.('p2', 'Goku');
});
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.evaluate(() => window.__browserSmashSkipCinematic?.());
await page.waitForTimeout(5000);
await page.evaluate(() => window.__browserSmashPause?.toggle());
await page.waitForTimeout(500);
await page.click('#pauseMenu [data-action="select"]');
await page.waitForTimeout(1500);
const state = await page.evaluate(() => {
  const result = document.querySelector('#result');
  const style = result ? getComputedStyle(result) : null;
  return {
    resultVisible: Boolean(result) && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.1,
    headline: result?.querySelector('div')?.textContent?.trim().slice(0, 60) || null,
    text: result?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 240) || null,
    actions: [...(result?.querySelectorAll('#bbResultActions button') || [])].map(b => b.textContent)
  };
});
await page.screenshot({ path: `${out}/results-screen.png` });
await writeFile(`${out}/results-report.json`, JSON.stringify({ generatedAt: new Date().toISOString(), state, errors }, null, 2));
console.log('RESULTS', JSON.stringify({ state, errors }));
await browser.close(); server.close();
