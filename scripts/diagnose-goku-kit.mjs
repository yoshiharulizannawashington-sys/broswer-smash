// State timeline for the two deterministic kit failures: light attacks never report a motion pose,
// and the K special never starts a cooldown. Prints one line per sample so the cause is visible.
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
await page.waitForTimeout(500);
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Goku');
  window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki');
  window.__browserSmashTrainingDummy = true;
  window.__browserSmashFreezeAI = true;
});
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 25000, polling: 200 });
await page.waitForTimeout(1200);

const sample = () => page.evaluate(() => {
  const f = window.fighters[0];
  return {
    pose: f.attackMotionPose || null,
    move: f.activeMoveId || null,
    queue: (f.attackQueue || []).map(a => a.id),
    attackPose: +(f.attackPose || 0).toFixed(2),
    casting: Boolean(f.casting),
    cooldown: +(f.specialCooldown || 0).toFixed(2),
    hitstun: +(f.hitstun || 0).toFixed(2),
    formLock: +(f.formLock || 0).toFixed(2),
    lock: +(f.specialLock || 0).toFixed(2),
    tickFn: typeof window.__browserSmashAttackTick,
    motionFn: typeof window.__browserSmashAttackMotion
  };
});

console.log('BASELINE', JSON.stringify(await sample()));
await page.keyboard.down('j');
for (let i = 0; i < 22; i += 1) {
  await page.waitForTimeout(40);
  console.log('J', i, JSON.stringify(await sample()));
}
await page.keyboard.up('j');
await page.waitForTimeout(600);
console.log('AFTER_J', JSON.stringify(await sample()));

await page.keyboard.down('k');
for (let i = 0; i < 18; i += 1) {
  await page.waitForTimeout(50);
  console.log('K', i, JSON.stringify(await sample()));
}
await page.keyboard.up('k');
await page.waitForTimeout(400);
console.log('AFTER_K', JSON.stringify(await sample()));
console.log('SPECIAL_TEXT', JSON.stringify(await page.evaluate(() => document.querySelector('#p1special')?.textContent || null)));
await browser.close(); server.close();
