// Which animation owner holds Naruto's body, and does it actually own his authored clips?
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd();
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
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
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
await page.waitForTimeout(3500);
const before = await page.evaluate(() => {
  const f = window.fighters[0];
  const c = f.animationController;
  return {
    identityKey: f.identityKey,
    identity: f.identity,
    hasController: Boolean(c),
    describe: c?.describe?.() || null,
    authoredClips: c?.authoredAttackClips || null,
    attackClipReport: c?.attackClipReport || null,
    hasAuthoredRasengan: c ? c.clips.has('authored_rasengan') : null,
    hasAuthoredShadowClone: c ? c.clips.has('authored_shadowClone') : null,
    clipCount: c ? c.clips.size : null,
    keys: Object.keys(f).filter(k => /anim|motion|mixer/i.test(k))
  };
});
console.log('BEFORE', JSON.stringify(before, null, 1));
// Cast Rasengan and read the active clip over the following frames.
await page.locator('canvas').first().click({ position: { x: 300, y: 200 }, force: true });
const during = await page.evaluate(async () => {
  const f = window.fighters[0];
  f.abilityReadyAt = {}; f.guardBreak = 0; f.ko = false;
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH', key: 'h', bubbles: true }));
  const samples = [];
  for (let frame = 0; frame < 24; frame++) {
    await new Promise(r => requestAnimationFrame(r));
    const d = f.animationController?.describe?.() || null;
    samples.push({ frame, active: d?.active ?? null, progress: d?.activeProgress ?? null, cast: f.abilityCast?.motion ?? null });
  }
  return samples;
});
console.log('DURING', JSON.stringify(during.filter((s, i) => i % 3 === 0 || s.active !== during[0].active)));
console.log('ERRORS', JSON.stringify(errors.slice(0, 3)));
await browser.close(); server.close();
