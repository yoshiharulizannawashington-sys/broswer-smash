// Trigger a real jab and signature move, then report the live action weights, timers and the
// actual bone rotation. Distinguishes "clip selected" from "clip posing the body".
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.webp': 'image/webp', '.wasm': 'application/wasm' };
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
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(90000);
  page.on('pageerror', e => console.log('PAGEERROR', String(e.message || e).slice(0, 200)));
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
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
  await page.waitForFunction(() => {
    const a = window.__browserSmashAssets || {};
    return [a.importedStrikes?.goku, a.importedAbilities?.goku].every(s => s && (s.status === 'ready' || s.status === 'failed'));
  }, null, { timeout: 90000, polling: 300 }).catch(() => console.log('CLIPS not settled'));
  await page.waitForTimeout(1200);

  const snap = label => page.evaluate((tag) => {
    const f = window.fighters[0], root = f.model;
    const bone = name => { let hit = null; root.traverse(n => { if (!hit && n.isBone && n.name === name) hit = n; }); return hit; };
    const quats = {};
    for (const n of ['RightArm', 'LeftForeArm', 'Hips', 'Spine']) quats[n] = bone(n)?.quaternion.toArray().map(v => +v.toFixed(3)) || null;
    const act = a => a ? { clip: a.getClip?.()?.name, running: a.isRunning?.(), weight: +(a.getEffectiveWeight?.() ?? 0).toFixed(3), time: +(a.time ?? 0).toFixed(2) } : null;
    return {
      tag, clip: root.userData.currentClip || null,
      strike: act(root.userData.authoredStrikeAction), strikeTime: root.userData.authoredStrikeTime ?? null,
      special: act(root.userData.authoredSpecialAction), specialTime: root.userData.authoredSpecialTime ?? null,
      lastStrike: root.userData.lastAuthoredStrike ? { clip: root.userData.lastAuthoredStrike.clip, id: root.userData.lastAuthoredStrike.id } : null,
      idleW: +(root.userData.lastMoveAction?.getEffectiveWeight?.() ?? 0).toFixed(3),
      quats
    };
  }, label);

  const idle = await snap('idle');
  await page.evaluate(() => { const f = window.fighters[0]; f.dashTimer = 0; f.dodgeTimer = 0; f.hitstun = 0; f.position.y = 0; });
  await page.keyboard.press('KeyJ');
  await page.evaluate(() => window.__browserSmashStep(0.1));
  const jab = await snap('jab+0.1');
  await page.evaluate(() => window.__browserSmashStep(0.06));
  const jab2 = await snap('jab+0.16');

  await page.evaluate(() => window.__browserSmashStep(0.6));
  const beforeSpecial = await snap('before-special');
  await page.keyboard.press('KeyK');
  await page.evaluate(() => window.__browserSmashStep(0.2));
  const special = await snap('special+0.2');
  await page.evaluate(() => window.__browserSmashStep(0.25));
  const special2 = await snap('special+0.45');

  const delta = (a, b) => {
    let max = 0;
    for (const n of Object.keys(a.quats)) {
      const x = a.quats[n], y = b.quats[n];
      if (x && y) max = Math.max(max, ...x.map((v, i) => Math.abs(v - y[i])));
    }
    return +max.toFixed(3);
  };
  console.log('ACTIONS ' + JSON.stringify({ idle, jab, jab2, beforeSpecial, special, special2,
    movedIdleToJab: delta(idle, jab), movedIdleToSpecial: delta(idle, special), movedBeforeToSpecial: delta(beforeSpecial, special) }));
} finally {
  await browser.close().catch(() => {});
  server.close();
}
