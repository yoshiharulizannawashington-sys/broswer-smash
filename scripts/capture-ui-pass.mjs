// Capture the restyled screens: main menu, character select, and the in-match HUD.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/ui';
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
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' || window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.waitForTimeout(2500);

const shots = [];
const shoot = async (name) => {
  const file = `${out}/${name}.png`;
  await page.screenshot({ path: file });
  shots.push(file);
};

// 1. Main menu / character select landing.
await shoot('main-menu');

// 2. Character select with a fighter picked, so the selected tile and preview are visible.
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Naruto Uzumaki');
  window.__browserSmashSelect?.select?.('p2', 'Goku');
});
await page.waitForTimeout(1200);
await shoot('character-select');

// 3. In-match HUD.
await page.evaluate(() => document.querySelector('#play')?.click());
await page.evaluate(() => window.__browserSmashSkipCinematic?.());
await page.waitForTimeout(4000);
const hud = await page.evaluate(() => {
  const css = getComputedStyle(document.querySelector('#clockstack') || document.body);
  return {
    clockstack: Boolean(document.querySelector('#clockstack')),
    roundText: document.querySelector('#roundScore')?.textContent || '',
    timer: document.querySelector('#timer')?.textContent || '',
    ultimateReady: document.querySelector('#energyHUD')?.classList.contains('ready') || false,
    clockBorder: css.borderTopColor,
    stylesheet: [...document.styleSheets].some(s => (s.href || '').includes('browserbros.css'))
  };
});
await shoot('match-hud');

await writeFile(`${out}/ui-report.json`, JSON.stringify({ generatedAt: new Date().toISOString(), hud, shots, errors }, null, 2));
console.log('UI', JSON.stringify({ hud, shots, errors }));
await browser.close(); server.close();
