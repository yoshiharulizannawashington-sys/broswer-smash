// Does a real J press put an authored light clip on the prefab body's mixer?
// Per-frame, with the attack window and the selected action recorded, so a miss is explained rather
// than assumed.
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
const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
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
await page.evaluate(() => {
  window.__browserSmashFreezeAI = true;
  const a = window.fighters[0], b = window.fighters[1];
  a.position.set(0, 0, 0); b.position.set(2.8, 0, 0);
  a.velocity?.set?.(0, 0, 0); b.velocity?.set?.(0, 0, 0);
  window.__strikeTrace = async (count) => {
    const f = window.fighters[0];
    const rows = [];
    for (let i = 0; i < count; i++) {
      await new Promise(r => requestAnimationFrame(r));
      const u = f.model.userData;
      const acts = u.authoredAbilityActions || {};
      const running = Object.entries(acts).filter(([, a]) => a.isRunning() && a.getEffectiveWeight() > 0.001)
        .map(([slot, a]) => ({ slot, w: +a.getEffectiveWeight().toFixed(2), t: +a.time.toFixed(2), ts: +a.getEffectiveTimeScale().toFixed(2) }));
      const active = f.attackQueue?.[0] || null;
      rows.push({
        queue: f.attackQueue?.length || 0,
        kind: active?.kind || null,
        step: active?.comboStep ?? active?.step ?? null,
        dur: active?.duration ?? null,
        last: u.lastMoveAction?._clip?.name || u.lastMoveAction?.getClip?.()?.name || null,
        running
      });
    }
    return rows;
  };
});
await page.locator('canvas').first().click({ position: { x: 300, y: 220 }, force: true });
await page.evaluate(() => { const f = window.fighters[0]; f.attackQueue.length = 0; f.hitstun = 0; });
const before = await page.evaluate(() => Object.keys(window.fighters[0].model.userData.authoredAbilityActions || {}));
const rest = await page.evaluate(() => { const f = window.fighters[0]; let b = null; f.model.traverse(x => { if (!b && x.isBone && /rightarm/i.test(x.name || '')) b = x; }); return b ? b.quaternion.toArray() : null; });
await page.keyboard.press('j');
const rows = await page.evaluate(() => window.__strikeTrace(14));
const deltas = await page.evaluate((rest) => {
  const f = window.fighters[0];
  let b = null; f.model.traverse(x => { if (!b && x.isBone && /rightarm/i.test(x.name || '')) b = x; });
  return b ? Math.max(...b.quaternion.toArray().map((v, i) => Math.abs(v - rest[i]))).toFixed(3) : null;
}, rest);
console.log('BOUND_SLOTS', JSON.stringify(before));
console.log('TRACE', JSON.stringify(rows));
console.log('ARM_DELTA_NOW', deltas, 'ERRORS', JSON.stringify(errors.slice(0, 2)));
await browser.close(); server.close();
