// Which modifier path actually reaches the attack resolver: synthetic window KeyboardEvents with a
// `code` only, or real browser key events. Traces the input latch, queue and grounding per frame.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
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
await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.waitForTimeout(400);
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Goku');
  window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki');
  window.__browserSmashTrainingDummy = true;
  window.__browserSmashFreezeAI = true;
});
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
await page.waitForTimeout(1200);

const clean = () => page.evaluate(() => {
  const f = window.fighters[0];
  ['KeyJ', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyK', 'KeyO', 'ShiftLeft', 'ShiftRight', 'Space'].forEach(code => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true })));
  f.attackQueue.length = 0; f.attackPose = 0; f.attackBuffer = 0; f.comboStep = 0; f.comboWindow = 0;
  f.hitstun = 0; f.guardBreak = 0; f.specialCooldown = 0; f.activeMoveId = null;
  f.position.set(0, 0.05, 0); f.velocity?.set?.(0, 0, 0); f.isGrounded = true; f.velocity = f.velocity || null;
  for (let i = 0; i < 12; i += 1) { window.__browserSmashStep(1 / 60); window.__browserSmashAttackTick?.(); }
  f.isGrounded = true;
  return { grounded: f.isGrounded, pose: f.attackMotionPose || null, move: f.activeMoveId, queue: f.attackQueue.length };
});
const trace = (frames = 6) => page.evaluate(n => {
  const f = window.fighters[0];
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    window.__browserSmashStep(1 / 60);
    window.__browserSmashAttackTick?.();
    rows.push({ step: i, buffer: +(f.attackBuffer || 0).toFixed(2), queue: (f.attackQueue || []).map(a => a.id), move: f.activeMoveId || null, pose: f.attackMotionPose || null, y: +(f.position.y || 0).toFixed(2), grounded: Boolean(f.isGrounded) });
  }
  return rows;
}, frames);

for (const variant of ['synthetic-shift', 'real-shift', 'real-down-shift']) {
  const base = await clean();
  if (variant === 'synthetic-shift') {
    await page.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft', bubbles: true })); window.__browserSmashStep(1 / 60); });
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', bubbles: true })));
  } else if (variant === 'real-shift') {
    await page.keyboard.down('Shift');
    await page.evaluate(() => window.__browserSmashStep(1 / 60));
    await page.keyboard.down('j');
  } else {
    await page.keyboard.down('Shift');
    await page.keyboard.down('s');
    await page.evaluate(() => window.__browserSmashStep(1 / 60));
    await page.keyboard.down('j');
  }
  const rows = await trace();
  console.log('VARIANT', variant, 'BASE', JSON.stringify(base));
  rows.forEach(row => console.log('  ', JSON.stringify(row)));
  await page.keyboard.up('j').catch(() => {});
  await page.keyboard.up('s').catch(() => {});
  await page.keyboard.up('Shift').catch(() => {});
}
await browser.close(); server.close();
