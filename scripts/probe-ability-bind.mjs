// Does the prefab body actually own authored kit-ability actions, and do they run on a cast?
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
const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 300)));
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
const bound = await page.evaluate(() => {
  const u = window.fighters[0].model.userData;
  return { slots: Object.keys(u.authoredAbilityActions || {}), special: u.authoredSpecialClipId || null, report: window.__browserSmashAssets?.authoredAbilities || null };
});
console.log('BOUND', JSON.stringify(bound));
const run = await page.evaluate(async () => {
  const f = window.fighters[0], u = f.model.userData;
  f.abilityCast = { slot: 2, motion: 'rasengan', at: 777 };
  const samples = [];
  for (let i = 0; i < 30; i++) {
    await new Promise(r => requestAnimationFrame(r));
    const a = u.authoredAbilityAction;
    samples.push({ i, running: a ? a.isRunning() : null, weight: a ? +a.getEffectiveWeight().toFixed(2) : null, time: a ? +a.time.toFixed(2) : null, hold: +(u.authoredAbilityTime || 0).toFixed(2) });
  }
  return samples.filter((s, i) => i % 5 === 0 || s.running);
});
console.log('RUNNING', JSON.stringify(run));
console.log('ERRORS', JSON.stringify(errors.slice(0, 2)));
await browser.close(); server.close();
