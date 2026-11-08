// Why does the body stay in its rest pose? Mount Goku, wait for every clip set, then report the mixer,
// the bound actions and the actual bone rotation while the game claims a clip is selected.
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
    const sets = [a.importedStrikes?.goku, a.importedReactions?.goku];
    return sets.every(s => s && (s.status === 'ready' || s.status === 'failed'));
  }, null, { timeout: 90000, polling: 300 }).catch(() => console.log('CLIPS not settled'));
  await page.waitForTimeout(1500);

  const report = await page.evaluate(async () => {
    const f = window.fighters[0], root = f.model, mixer = root.userData.humanMixer;
    const bone = (() => { let hit = null; root.traverse(n => { if (!hit && n.isBone && n.name === 'RightArm') hit = n; }); return hit; })();
    const record = {};
    for (const [key, value] of Object.entries(root.userData)) {
      if (value && (value.isAnimationAction || key.includes('Action') || key.includes('Action'))) {
        record[key] = value?.getClip ? { clip: value.getClip()?.name, running: value.isRunning?.(), weight: value.getWeight?.() } : typeof value;
      }
    }
    const before = bone ? bone.quaternion.toArray() : null;
    const idle = root.userData.idleAction || root.userData.reactionActions?.idle || null;
    const manualBefore = bone ? bone.quaternion.toArray() : null;
    let manual = null;
    if (idle) {
      idle.reset().play();
      manual = { clip: idle.getClip().name, running: idle.isRunning(), weight: idle.getWeight() };
    }
    const frame = () => new Promise(done => requestAnimationFrame(() => done()));
    for (let i = 0; i < 40; i += 1) { window.__browserSmashStep(1 / 60); await frame(); }
    return {
      mixer: mixer ? { time: mixer.time, actions: mixer._actions?.length, timeScale: mixer.timeScale } : null,
      actions: record,
      hasIdle: Boolean(idle), manual,
      currentClip: root.userData.currentClip || null,
      lastMove: root.userData.lastMoveAction?.getClip?.().name || null,
      boneBefore: before, boneAfter: bone ? bone.quaternion.toArray() : null,
      boneMoved: bone && before ? Math.max(...bone.quaternion.toArray().map((v, i) => Math.abs(v - before[i]))) : null,
      controllerReleased: Boolean(root.userData.animationControllerReleased),
      controller: Boolean(root.userData.animationController),
      keys: Object.keys(root.userData).filter(k => /action|clip|anim|mix/i.test(k))
    };
  });
  console.log('PROBE ' + JSON.stringify(report));
} finally {
  await browser.close().catch(() => {});
  server.close();
}
