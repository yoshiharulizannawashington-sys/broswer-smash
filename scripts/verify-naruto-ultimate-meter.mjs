// Definitive O check with real key events at both meter levels: empty meter must announce
// "ULTIMATE METER EMPTY" and start nothing; a filled meter must start the real ultimate and spend it.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd();
await mkdir('artifacts/compare/naruto-ultimate', { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    let rel = normalize(p).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 700, height: 700 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.evaluate(() => {
  window.__browserSmashSelect?.chooseArena('valley');
  window.__browserSmashSelect?.select('p1', 'Naruto Uzumaki');
  window.__browserSmashSelect?.select('p2', 'Thor');
  document.querySelector('#play').click();
});
await page.evaluate(() => window.__browserSmashSkipCinematic?.());
await page.waitForTimeout(3000);
await page.evaluate(() => { window.__browserSmashFreezeAI = true; const a = window.fighters[0], b = window.fighters[1]; a.position.set(0,0,0); b.position.set(2.8,0,0); a.velocity?.set?.(0,0,0); b.velocity?.set?.(0,0,0); });
const callouts = [];
await page.exposeFunction('__noteCallout', t => callouts.push(String(t).slice(0, 48)));
await page.evaluate(() => {
  const orig = window.showCombatCallout;
  window.showCombatCallout = (t, c) => { window.__noteCallout?.(t); return orig?.(t, c); };
});
await page.locator('canvas').first().click({ position: { x: 330, y: 230 }, force: true });
const probe = async () => page.evaluate(async () => {
  const f = window.fighters[0];
  const rows = [];
  for (let i = 0; i < 10; i++) {
    await new Promise(r => requestAnimationFrame(r));
    const rec = f.casting === 'ultimate' ? 'casting' : null;
    rows.push({
      meter: +Number(f.meter || 0).toFixed(1),
      casting: f.casting || null,
      phase: window.__ultPhase ?? null,
      queue: f.attackQueue?.length ?? null
    });
  }
  return { rows, ult: f.ultimateDef?.label || null };
});
// 1) real key at an empty meter: must refuse and say why.
await page.evaluate(() => { const f = window.fighters[0]; f.meter = 0; f.attackQueue.length = 0; f.hitstun = 0; f.specialCooldown = 0; });
const emptyCalloutsBefore = callouts.length;
await page.keyboard.press('o');
const empty = await probe();
const emptyCallout = callouts.slice(emptyCalloutsBefore);
// 2) real key at a filled meter: must start the ultimate and spend the meter.
await page.evaluate(() => { const f = window.fighters[0]; f.meter = 100; f.casting = null; f.attackQueue.length = 0; f.hitstun = 0; });
const fullCalloutsBefore = callouts.length;
await page.keyboard.press('o');
const full = await probe();
const fullCallout = callouts.slice(fullCalloutsBefore);
console.log('EMPTY', JSON.stringify({ ult: empty.ult, callout: emptyCallout, first: empty.rows[0], last: empty.rows[9] }));
console.log('FULL', JSON.stringify({ callout: fullCallout, rows: full.rows.map(r => `${r.meter}/${r.casting}`) }));
console.log('ERRORS', JSON.stringify(errors.slice(0, 2)));
await browser.close(); server.close();
