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
page.setDefaultTimeout(120000);
const errors = []; page.on('pageerror', e => errors.push(String(e.stack || e.message || e).slice(0, 500)));
await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => { window.__browserSmashSelect?.select?.('p1', 'Goku'); window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki'); window.__browserSmashTrainingDummy = true; window.__browserSmashFreezeAI = true; });
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
await page.waitForFunction(() => { const f = (window.fighters || []).find(x => /goku/i.test(x.identity || '')); return !!f?.model?.userData?.animationActions; }, null, { timeout: 60000, polling: 250 });

const healthBefore = await page.evaluate(() => (window.fighters || []).map(f => ({ id: f.identity, hp: f.damage ?? f.health ?? null })));
await page.keyboard.down('j');
const capture = await page.evaluate(async () => {
  const f = (window.fighters || []).find(x => /goku/i.test(x.identity || ''));
  const u = f.model.userData;
  const pools = [u.authoredStrikeAction, u.importedStrikeActions, u.bakedAuthoredActions, u.animationActions];
  const collect = v => v instanceof Map ? [...v.values()] : (v && typeof v === 'object' ? Object.values(v) : []);
  const findJab = () => {
    for (const pool of pools) for (const v of collect(pool)) {
      const a = v?.getClip ? v : v?.action;
      if (a?.getClip?.().name === 'Goku_Jab') return a;
    }
    return null;
  };
  const t0 = performance.now();
  let a = null;
  while (performance.now() - t0 < 25000) {
    const cand = findJab();
    if (cand && cand.isRunning?.()) { a = cand; break; }
    await new Promise(r => setTimeout(r, 100));
  }
  if (!a) return { captured: false, elapsed: Math.round(performance.now() - t0), strikeType: typeof u.authoredStrikeAction, currentClip: u.currentClip };
  const pb = (a._propertyBindings || []).map(x => !!(x?.binding ? x.binding.node : x?.node));
  const hand = u.rightHand || u.leftHand || null;
  const pos = () => { const v = hand.getWorldPosition(hand.position.clone()); return [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)]; };
  const first = pos();
  const samples = [];
  let maxD = 0;
  for (let i = 0; i < 14; i++) {
    await new Promise(r => requestAnimationFrame(r));
    const p = pos();
    maxD = Math.max(maxD, Math.hypot(p[0] - first[0], p[1] - first[1], p[2] - first[2]));
    samples.push({ t: +a.time.toFixed(3), w: +a.getEffectiveWeight().toFixed(2), running: !!a.isRunning(), p });
  }
  return { captured: true, clip: a.getClip().name, hand: hand?.name, bindings: pb.length, bound: pb.filter(Boolean).length,
    nulls: pb.filter(v => !v).length, first, maxHandDelta: +maxD.toFixed(4), mixerIsModel: a._mixer.getRoot() === f.model,
    mixerIsHumanMixer: a._mixer === u.humanMixer, samples };
});
await page.keyboard.up('j');
await page.waitForTimeout(600);
const healthAfter = await page.evaluate(() => (window.fighters || []).map(f => ({ id: f.identity, hp: f.damage ?? f.health ?? null })));
console.log('CAPTURE', JSON.stringify(capture));
console.log('HEALTH', JSON.stringify({ healthBefore, healthAfter }));
console.log('ERRORS', JSON.stringify(errors.slice(0, 6)));
await browser.close(); server.close(); process.exit(0);
