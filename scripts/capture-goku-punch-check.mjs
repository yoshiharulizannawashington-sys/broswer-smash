// Goku strike readability capture. Each move is dispatched explicitly and its active clip asserted
// before any frame is taken, so a jab can never be filed as a heavy. Camera is front three-quarter.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd(), out = 'artifacts/goku-strikes';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(150000);
await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 120000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.waitForFunction(() => document.querySelector('#selectScreen [data-fighter="Goku"]'), null, { timeout: 30000, polling: 200 });
await page.evaluate(() => {
  document.querySelector('#selectScreen [data-side="p1"]').click();
  document.querySelector('#selectScreen [data-fighter="Goku"]').click();
  document.querySelector('#selectScreen [data-side="p2"]').click();
  document.querySelector('#selectScreen [data-fighter="Naruto Uzumaki"]').click();
  document.querySelector('#play').click();
});
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 60000, polling: 200 });
await page.waitForFunction(() => window.fighters?.[0]?.model?.userData?.humanMixer, null, { timeout: 120000, polling: 250 });
await page.waitForFunction(() => { const g = window.__browserSmashAssets?.importedReactions?.goku; return g && g.status !== 'loading'; }, null, { timeout: 90000, polling: 250 }).catch(() => {});
await page.evaluate(() => { window.__browserSmashFreezeAI = true; window.__browserSmashTrainingDummy = true; window.__browserSmashStep(0.5); });

const state = () => { const u = window.fighters[0].model.userData, a = u.authoredStrikeAction; return { clip: u.currentClip || null, strike: a?.getClip?.().name || null, t: +(a?.time || 0).toFixed(3), dur: +(a?.getClip?.().duration || 0).toFixed(3) }; };
const CLEAN = () => {
  const f = window.fighters[0], o = window.fighters[1];
  f.dashTimer = 0; f.dashCooldown = 0; f.dodgeTimer = 0; f.hitstun = 0; f.guardBreak = 0; f.comboStep = 0; f.comboWindow = 0; f.specialCooldown = 0;
  f.attackQueue.length = 0; f.attackBuffer = 0; f.isGrounded = true; f.position.y = 0; f.velocity?.set?.(0, 0, 0);
  f.attackTimer = 0; f.attackCooldown = 0; f.activeMoveId = null; f.currentMove = null; f.pendingSignature = null; f.attack = null;
  o.position.set(f.position.x + 0.9, 0, f.position.z + 1.9);
  for (let i = 0; i < 45; i++) window.__browserSmashStep(1 / 60);
  f.isGrounded = true; f.position.y = 0;
};
const shot = async (name) => {
  await page.evaluate(() => {
    window.__browserSmashSetPaused?.(true);
    const THREE = window.__browserSmashThree, scene = window.__browserSmashScene, cam = window.smashCamera.camera, f = window.fighters[0];
    const p = f.model.position, ang = 0.62;
    cam.position.set(p.x + Math.sin(ang) * 2.45, 1.42, p.z + Math.cos(ang) * 2.45);
    cam.lookAt(p.x, 1.03, p.z);
    cam.updateMatrixWorld(true);
    window.__hidden = [];
    const rival = window.fighters[1].model;
    if (rival.visible !== false) { rival.visible = false; window.__hidden.push(rival); }
    const box = new THREE.Box3().setFromObject(f.model);
    scene.traverse(o => {
      if (!o.isMesh || o.visible === false || o.isSkinnedMesh) return;
      if (f.model.getObjectById(o.id)) return;
      if (new THREE.Box3().setFromObject(o).intersectsBox(box)) { o.visible = false; window.__hidden.push(o); }
    });
  });
  await page.waitForTimeout(220);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.evaluate(() => { for (const o of window.__hidden || []) o.visible = true; window.__hidden = []; window.__browserSmashSetPaused?.(false); });
  return page.evaluate(state);
};
const stepUntil = (target, expected, label) => page.evaluate(([target, expected, label]) => {
  const u = window.fighters[0].model.userData;
  for (let i = 0; i < 150; i++) {
    window.__browserSmashStep(1 / 60);
    const a = u.authoredStrikeAction;
    if (a?.getClip?.().name === expected && (a.time || 0) >= target) return { ok: true, clip: a.getClip().name, t: +a.time.toFixed(3) };
  }
  const a = u.authoredStrikeAction;
  return { ok: false, label, expected, got: a?.getClip?.().name || null, t: +(a?.time || 0).toFixed(3) };
}, [target, expected, label]);
const press = (code, extra = {}) => page.evaluate(([code, extra]) => { window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, ...extra })); }, [code, extra]);

const strikes = [
  { move: 'jab', expected: 'Goku_Jab', contact: 0.14, anticipation: 0.045, follow: 0.26 },
  { move: 'cross', expected: 'Goku_Cross', contact: 0.17, anticipation: 0.055, follow: 0.3 },
  { move: 'heavy', expected: 'Goku_Heavy', contact: 0.26, anticipation: 0.08, follow: 0.42 }
];
const failures = [];
for (const s of strikes) {
  await page.evaluate(CLEAN);
  if (s.move === 'heavy') {
    await press('ShiftLeft'); await press('KeyJ', { shiftKey: true });
    await page.evaluate(() => { for (let i = 0; i < 4; i++) window.__browserSmashStep(1 / 60); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft', bubbles: true })); });
  } else if (s.move === 'cross') {
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', bubbles: true }));
      for (let i = 0; i < 10; i++) window.__browserSmashStep(1 / 60);
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', bubbles: true }));
    });
  } else { await press('KeyJ'); }
  const antic = await stepUntil(s.anticipation, s.expected, s.move + '-anticipation');
  if (!antic.ok) { failures.push(antic); continue; }
  await shot(`${s.move}-1-anticipation`);
  const contact = await stepUntil(s.contact, s.expected, s.move + '-contact');
  if (!contact.ok) { failures.push(contact); continue; }
  const c = await shot(`${s.move}-2-contact`);
  const follow = await stepUntil(s.follow, s.expected, s.move + '-follow');
  const fs = follow.ok ? await shot(`${s.move}-3-followthrough`) : null;
  console.log('STRIKE', s.move, JSON.stringify({ antic: antic.clip, contact: c.clip, contactTime: c.t, follow: fs?.clip || null, followOk: follow.ok }));
}
console.log('FAILURES', JSON.stringify(failures));
await browser.close(); server.close();
if (failures.length) process.exitCode = 3;
