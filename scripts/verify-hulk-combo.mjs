// Hulk five-hit combo, end to end: real KeyJ presses, a paused screenshot per hit, runtime slot and
// clip for every hit, then combo expiry and restart. Hulk's model is the genuine imported GLB.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
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
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
await mkdir('artifacts/hulk/combo', { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(150000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 120000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Hulk (Bruce Banner)');
  window.__browserSmashSelect?.select?.('p2', 'Goku');
  window.__browserSmashFreezeAI = true;
});
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
try {
  await page.waitForFunction(() => Boolean(window.fighters?.[0]?.model?.userData?.importedStrikeSet), null, { timeout: 45000, polling: 250 });
} catch (_error) {}

const hits = [];
for (let i = 0; i < 5; i += 1) {
  const shot = await page.evaluate(() => {
    const f = window.fighters[0], u = f.model.userData, foe = window.fighters[1];
    const tick = n => { for (let k = 0; k < n; k += 1) window.__browserSmashStep(1 / 60); };
    const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
    for (let k = 0; k < 150 && f.attackQueue.length; k += 1) tick(1);
    if (foe) { foe.position.set(f.position.x + (f.facing >= 0 ? 0.9 : -0.9), 0, f.position.z); foe.velocity?.set?.(0, 0, 0); }
    key('KeyJ', true); tick(1); key('KeyJ', false); tick(18);
    try { window.__browserSmashPause.open(); } catch (_error) {}
    // The pause modal is a fixed overlay; hide it (and the HUD) so the captured pixels are the
    // evaluated attack pose, not the menu.
    let modal = [...document.querySelectorAll('div')].find(n => /TAKE A BREATH/.test(n.textContent || ''));
    while (modal && modal.parentElement !== document.body) modal = modal.parentElement;
    if (modal) modal.style.display = 'none';
    const hud = document.querySelector('#hud'); if (hud) hud.style.display = 'none';
    return {
      step: f.comboStep,
      queuedStep: f.attackQueue[f.attackQueue.length - 1]?.comboStep ?? null,
      slot: u.lastAuthoredStrike?.slot || null,
      clip: u.lastAuthoredStrike?.clip || null,
      move: f.activeMoveId || null,
      dmg: Math.round(foe?.percent ?? 0),
      hitstun: +(foe?.hitstun ?? 0).toFixed(2)
    };
  });
  hits.push(shot);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `artifacts/hulk/combo/hit-${i + 1}.png` });
  await page.evaluate(() => { window.__browserSmashPause.close(); for (let k = 0; k < 10; k += 1) window.__browserSmashStep(1 / 60); });
}

const rest = await page.evaluate(() => {
  const f = window.fighters[0], u = f.model.userData, foe = window.fighters[1];
  const tick = n => { for (let k = 0; k < n; k += 1) window.__browserSmashStep(1 / 60); };
  const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
  for (let k = 0; k < 150 && f.attackQueue.length; k += 1) tick(1);
  for (let k = 0; k < 300 && f.comboWindow > 0; k += 1) tick(1);
  const expired = { comboStep: f.comboStep, comboWindow: +f.comboWindow.toFixed(2) };
  if (foe) { foe.position.set(f.position.x + (f.facing >= 0 ? 0.9 : -0.9), 0, f.position.z); foe.velocity?.set?.(0, 0, 0); }
  key('KeyJ', true); tick(1); key('KeyJ', false); tick(6);
  const restart = { step: f.comboStep, slot: u.lastAuthoredStrike?.slot || null, clip: u.lastAuthoredStrike?.clip || null };
  // A press during startup must be rejected and must not advance the counter.
  const before = f.comboStep;
  key('KeyJ', true); tick(1); key('KeyJ', false); tick(2);
  const rejected = { before, after: f.comboStep, queue: f.attackQueue.length };
  return { expired, restart, rejected, foePercent: Math.round(foe?.percent ?? 0) };
});

console.log('COMBO ' + JSON.stringify({ hits, rest, errors }));
await browser.close();
server.close();
process.exit(0);
