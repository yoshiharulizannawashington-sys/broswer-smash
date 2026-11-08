// Captures the real victory results panel by driving a knockout through the engine's own damage
// state (no synthetic events, no mocked markup): the round/match end logic and resultMarkup() are
// the shipped ones.
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
await page.waitForTimeout(4000);

// Knock the CPU out for real: push its damage past the KO threshold and let the engine resolve it.
let koRound = 0;
for (let attempt = 0; attempt < 60; attempt++) {
  const done = await page.evaluate(() => {
    const result = document.querySelector('#result');
    const visible = result && getComputedStyle(result).display !== 'none' && !document.querySelector('#menu')?.classList.contains('hidden');
    if (!visible && window.fighters?.[1]) {
      window.fighters[1].percent = 999;
      window.fighters[1].ko = true;
      window.fighters[1].stock = 0;
    }
    return visible;
  });
  if (done) break;
  await page.waitForTimeout(800);
}
await page.waitForTimeout(2500);
const state = await page.evaluate(() => {
  const result = document.querySelector('#result');
  const style = result ? getComputedStyle(result) : null;
  return {
    matchEnded: Boolean(result) && style.display !== 'none' && Number(style.opacity) > 0.1,
    menuHidden: Boolean(document.querySelector('#menu')?.classList.contains('hidden')),
    text: result?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 260) || null,
    actions: [...(result?.querySelectorAll('#bbResultActions button') || [])].map(b => b.textContent),
    titleVisible: Boolean(document.querySelector('#bbTitle')) && getComputedStyle(document.querySelector('#bbTitle')).display !== 'none'
  };
});
await page.screenshot({ path: `${out}/results-victory.png` });
await writeFile(`${out}/results-victory-report.json`, JSON.stringify({ generatedAt: new Date().toISOString(), state, errors }, null, 2));
console.log('RESULTWIN', JSON.stringify({ state, errors }));
await browser.close(); server.close();
