// Diagnostics for the results screen: ends a match for real, then reports exactly where #result
// lives, what it contains and how it is laid out.
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
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' || window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.waitForTimeout(900);
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => { window.__browserSmashSelect?.select?.('p1', 'Naruto Uzumaki'); window.__browserSmashSelect?.select?.('p2', 'Goku'); });
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.evaluate(() => window.__browserSmashSkipCinematic?.());
await page.waitForTimeout(3500);
for (let i = 0; i < 40; i++) {
  const done = await page.evaluate(() => {
    const r = document.querySelector('#result');
    if (r && getComputedStyle(r).display !== 'none' && r.textContent.trim().length > 8) return true;
    if (window.fighters?.[1]) { window.fighters[1].percent = 999; window.fighters[1].ko = true; window.fighters[1].stock = 0; }
    return false;
  });
  if (done) break;
  await page.waitForTimeout(700);
}
await page.waitForTimeout(1200);
const diag = await page.evaluate(() => {
  const all = [...document.querySelectorAll('#result')];
  const r = all[0];
  const chain = [];
  let n = r;
  while (n && n.id !== 'menu' && chain.length < 6) { chain.push(`${n.tagName}${n.id ? '#' + n.id : ''}.${[...n.classList].join('.')}`); n = n.parentElement; }
  const rect = r?.getBoundingClientRect();
  const panelKids = [...(document.querySelector('.panel')?.children || [])].map(c => `${c.tagName}${c.id ? '#' + c.id : ''}.${[...c.classList].join('.')} display=${getComputedStyle(c).display}`);
  const innerKids = [...(r?.children || [])].map(c => `${c.tagName}${c.id ? '#' + c.id : ''} display=${getComputedStyle(c).display} h=${Math.round(c.getBoundingClientRect().height)} text=${c.textContent.trim().slice(0, 30)}`);
  return {
    count: all.length,
    chain,
    menuClass: document.querySelector('#menu')?.className,
    display: r ? getComputedStyle(r).display : null,
    opacity: r ? getComputedStyle(r).opacity : null,
    rect: rect ? { w: Math.round(rect.width), h: Math.round(rect.height) } : null,
    html: r?.innerHTML.slice(0, 220) || '',
    panelKids,
    innerKids
  };
});
await page.screenshot({ path: `${out}/results-diag.png` });
await writeFile(`${out}/results-diag.json`, JSON.stringify(diag, null, 2));
console.log('DIAG', JSON.stringify(diag));
await browser.close(); server.close();
