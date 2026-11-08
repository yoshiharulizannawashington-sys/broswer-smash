// Two open questions: why O does not dispatch, and whether the sword is really gone while stowed.
// The sword frame is taken with canvas.toDataURL inside the same tick the weapon is hidden, so the
// capture cannot race the stow window the way a screenshot does.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd();
const out = 'artifacts/compare/naruto-ultimate';
await mkdir(out, { recursive: true });
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
await page.locator('canvas').first().click({ position: { x: 330, y: 230 }, force: true });

// What the game thinks the ultimate is, before pressing anything.
const state = await page.evaluate(() => {
  const f = window.fighters[0];
  const kit = f.abilityKit || f.abilities || null;
  const flat = k => Array.isArray(k) ? k.map(a => ({ id: a?.id, slot: a?.slot, motion: a?.motion, cost: a?.cost, meter: a?.meter })) : null;
  return {
    identity: f.identityKey,
    keys: Object.keys(f).filter(k => /ult|meter|ability|kit|charge/i.test(k)).slice(0, 14),
    meter: f.meter ?? f.ultimateMeter ?? f.charge ?? null,
    kitSample: flat(kit)?.slice(0, 8) || null
  };
});
console.log('ULT_STATE', JSON.stringify(state));
await page.evaluate(() => { const f = window.fighters[0]; f.attackQueue.length = 0; f.hitstun = 0; f.specialCooldown = 0; if (f.abilityReadyAt && typeof f.abilityReadyAt === 'object') for (const k of Object.keys(f.abilityReadyAt)) f.abilityReadyAt[k] = 0; });
await page.keyboard.press('o');
const afterO = await page.evaluate(async () => {
  const f = window.fighters[0]; const rows = [];
  for (let i = 0; i < 10; i++) {
    await new Promise(r => requestAnimationFrame(r));
    const u = f.model.userData; const acts = u.authoredAbilityActions || {};
    rows.push({
      cast: f.abilityCast?.motion || null,
      special: u.authoredSpecialAction?.isRunning() ? +u.authoredSpecialAction.getEffectiveWeight().toFixed(2) : null,
      running: Object.entries(acts).filter(([, a]) => a.isRunning() && a.getEffectiveWeight() > 0.01).map(([s]) => s),
      meter: f.meter ?? f.ultimateMeter ?? null
    });
  }
  return rows;
});
console.log('AFTER_O', JSON.stringify(afterO));

// Atomic in-tick capture of the stowed window for each cast.
const captures = [];
for (const [label, key] of [['rasengan', 'h'], ['shadowClone', 'l'], ['signature', 'k']]) {
  await page.evaluate(() => { const f = window.fighters[0]; f.attackQueue.length = 0; f.hitstun = 0; f.specialCooldown = 0; if (f.abilityReadyAt && typeof f.abilityReadyAt === 'object') for (const k of Object.keys(f.abilityReadyAt)) f.abilityReadyAt[k] = 0; });
  await page.keyboard.press(key);
  const shot = await page.evaluate(async () => {
    const f = window.fighters[0];
    const weapons = () => [f.model.userData.equippedWeaponRight, f.model.userData.equippedWeaponLeft, f.model.userData.pickupBlade].filter(o => o && o.isObject3D);
    for (let i = 0; i < 40; i++) {
      await new Promise(r => requestAnimationFrame(r));
      const ws = weapons();
      if (ws.length && ws.every(w => w.visible === false)) {
        const canvas = document.querySelector('canvas');
        const url = canvas.toDataURL('image/png');
        return { hidden: true, frames: i, dataUrl: url, state: f.model.userData.equipmentState?.state || null };
      }
    }
    return { hidden: false, frames: 40, dataUrl: null };
  });
  if (shot.hidden && shot.dataUrl && shot.dataUrl.length > 5000) {
    const file = `${out}/sword-stowed-${label}.png`;
    await writeFile(file, Buffer.from(shot.dataUrl.split(',')[1], 'base64'));
    captures.push({ label, hidden: shot.hidden, frames: shot.frames, file, bytes: shot.dataUrl.length, state: shot.state });
  } else {
    captures.push({ label, hidden: shot.hidden, frames: shot.frames, dataUrlLength: shot.dataUrl ? shot.dataUrl.length : 0, state: shot.state || null });
  }
}
console.log('SWORD', JSON.stringify(captures));
console.log('ERRORS', JSON.stringify(errors.slice(0, 2)));
await browser.close(); server.close();
