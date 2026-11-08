// Closes the restore half of the stow check: hold the cast, capture in-tick while the blade is
// hidden, then keep polling until it is visible again and capture that same tick.
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
const result = await page.evaluate(async () => {
  const f = window.fighters[0];
  f.attackQueue.length = 0; f.hitstun = 0; f.specialCooldown = 0;
  if (f.abilityReadyAt && typeof f.abilityReadyAt === 'object') for (const k of Object.keys(f.abilityReadyAt)) f.abilityReadyAt[k] = 0;
  const weapons = () => [f.model.userData.equippedWeaponRight, f.model.userData.equippedWeaponLeft, f.model.userData.pickupBlade].filter(o => o && o.isObject3D);
  const canvas = document.querySelector('canvas');
  const grab = () => canvas.toDataURL('image/png');
  const before = { state: f.model.userData.equipmentState?.state || null, visible: weapons().every(w => w.visible !== false) };
  const beforeShot = grab();
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH', key: 'h', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyH', key: 'h', bubbles: true }));
  let hiddenAt = -1, hiddenShot = null, restoredAt = -1, restoredShot = null;
  for (let i = 0; i < 90; i++) {
    await new Promise(r => requestAnimationFrame(r));
    const ws = weapons();
    if (hiddenAt < 0 && ws.length && ws.every(w => w.visible === false)) { hiddenAt = i; hiddenShot = grab(); continue; }
    if (hiddenAt >= 0 && ws.every(w => w.visible !== false) && (f.model.userData.equipmentState?.state || '') !== 'two-handed') { restoredAt = i; restoredShot = grab(); break; }
  }
  return { before, hiddenAt, restoredAt, hiddenShot, restoredShot, afterState: f.model.userData.equipmentState?.state || null };
});
const save = async (name, url) => { if (!url || url.length < 5000) return null; const f = `${out}/${name}`; await writeFile(f, Buffer.from(url.split(',')[1], 'base64')); return f; };
const beforeFile = await save('sword-restore-before.png', result.beforeShot);
const hiddenFile = await save('sword-restore-hidden.png', result.hiddenShot);
const restoredFile = await save('sword-restore-after.png', result.restoredShot);
console.log('RESTORE', JSON.stringify({ before: result.before, hiddenAt: result.hiddenAt, restoredAt: result.restoredAt, afterState: result.afterState, beforeFile, hiddenFile, restoredFile }));
console.log('ERRORS', JSON.stringify(errors.slice(0, 2)));
await browser.close(); server.close();
