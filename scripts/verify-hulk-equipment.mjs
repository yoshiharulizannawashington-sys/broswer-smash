// One-off evidence: Hulk's clean-handed victory must not touch the other fighter's kit.
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
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 120000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect.select('p1', 'Hulk (Bruce Banner)');
  window.__browserSmashSelect.select('p2', 'Thor');
  document.querySelector('#play').click();
});
await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting' && window.fighters[0].identityKey === 'hulk_bruce_banner', null, { timeout: 30000, polling: 100 });
const out = await page.evaluate(() => {
  const holdables = i => { const u = window.fighters[i].model.userData; return [u.equippedWeaponRight, u.equippedWeaponLeft, u.pickupBlade].filter(Boolean).map(o => ({ name: o.name || o.type, visible: o.visible })); };
  const step = n => { for (let i = 0; i < n; i += 1) window.__browserSmashStep(1 / 60); };
  for (let i = 0; i < 40 && window.__browserSmashMatch().status !== 'match-over'; i += 1) { window.fighters[1].percent = 999; step(6); }
  for (let i = 0; i < 900; i += 1) { const v = window.__browserSmashVictoryState?.(); if (v && v.hold === 0 && document.querySelector('#result')?.textContent.trim()) break; window.__browserSmashStep(1 / 60); }
  return { winner: window.__browserSmashMatch().winner, hulk: holdables(0), thor: holdables(1), result: (document.querySelector('#result')?.textContent || '').slice(0, 24) };
});
const thorHidden = out.thor.some(item => item.visible === false);
const hulkVisible = out.hulk.some(item => item.visible === true);
const failures = [];
if (out.winner !== 'p1') failures.push('Hulk did not win');
if (!out.hulk.length || hulkVisible) failures.push('Hulk gauntlet still visible');
if (!out.thor.length) failures.push('Thor carried no holdables to test');
if (thorHidden) failures.push("Thor's equipment was hidden");
console.log('THOR ' + JSON.stringify({ ...out, failures }));
await browser.close(); server.close();
process.exit(failures.length ? 1 : 0);
