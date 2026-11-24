// Naruto only: five transformations on the game's own authored showcase camera, aura and HUD
// hidden, so the costume silhouette can be judged rather than the transformation glow.
//
//   CHROME_PATH=... bash scripts/run-browser-test.sh scripts/capture-naruto-closeups.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = process.env.OUT || 'artifacts/compare/naruto-phase2-1';
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
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.stack || e).slice(0, 300)));
const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);
const frames = n => page.evaluate(async total => { for (let i = 0; i < total; i++) await new Promise(r => requestAnimationFrame(r)); }, n);

await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.evaluate(() => {
  window.__browserSmashTrainingDummy = true;
  window.__browserSmashSelect?.chooseArena('valley');
  window.__browserSmashSelect?.select('p1', 'Naruto Uzumaki');
  window.__browserSmashSelect?.select('p2', 'Thor');
  document.querySelector('#play').click();
});
await page.evaluate(() => {
  window.__browserSmashSkipCinematic?.();
  // A camera/AI proof must not be pre-empted by the opponent: freeze the CPU brain and make the
  // subject untouchable so a transform is never refused for being in hitstun.
  window.__browserSmashFreezeAI = true;
  if (window.fighters?.[0]) window.fighters[0].invulnerable = 9999;
});
await step(.4);

// Hide every overlay that is not the render canvas.
await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  const keep = canvas?.closest('body > *');
  [...document.body.children].forEach(el => {
    if (el === keep) return;
    el.dataset.costumeHidden = el.style.visibility;
    el.style.visibility = 'hidden';
  });
});

for (let stage = 1; stage <= 5; stage++) {
  await page.evaluate(() => {
    const f = window.fighters[0];
    f.position.set(0, .6, 0); f.facing = 1; f.facingZ = 0;
    f.power = 100; f.transformCooldown = 0; f.formLock = 0; f.abilityReadyAt = {};
    f.hitstun = 0; f.guardBreak = 0; f.grabbedBy = null;
    window.fighters[1].position.set(6, .6, 0);
    window.fighters[1].invulnerable = 60;
  });
  await page.keyboard.press('i');
  await step(.7);
  await page.evaluate(() => {
    const f = window.fighters[0];
    if (f.aura) f.aura.visible = false;
    // Use the player-over-shoulder game camera at its closest wheel zoom, so this is a view a
    // player can actually reach rather than a bespoke inspection lens.
    const select = document.querySelector('#cameraMode');
    if (select && select.value !== 'over-p1') { select.value = 'over-p1'; select.dispatchEvent(new Event('change')); }
    window.smashCamera?.setZoom?.(.76);
  });
  await frames(3);
  await page.screenshot({ path: `${out}/form-${stage}-showcase.png` });
  console.log('SHOWCASE', stage, JSON.stringify(await page.evaluate(() => window.__browserSmashFormCostume().p1)));
  await page.evaluate(() => {
    window.smashCamera?.endCineShot?.();
    const f = window.fighters[0];
    if (f.aura) f.aura.visible = true;
    if (f.transform) f.transform.time = 0;
  });
  await step(.2);
  await page.evaluate(() => { window.fighters[0].transformCooldown = 0; window.fighters[0].formLock = 0; });
}

await page.evaluate(() => {
  [...document.body.children].forEach(el => {
    if (el.dataset.costumeHidden === undefined) return;
    el.style.visibility = el.dataset.costumeHidden;
    delete el.dataset.costumeHidden;
  });
});
console.log('ERRORS', errors.slice(0, 2).join(' | ') || 'none');
await browser.close();
server.close();
