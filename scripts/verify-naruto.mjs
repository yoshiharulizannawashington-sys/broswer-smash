// Naruto vertical slice: five-form progression, per-form ultimates, and real shadow clones.
//
//   bash scripts/run-browser-test.sh scripts/verify-naruto.mjs
//
// Real key presses and real simulation; no direct calls into the damage or form code except where a
// harness has to stage meter or a cooldown (documented inline). Screenshots for each form and the
// clone pack are written to artifacts/compare/naruto/.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import { MOVESETS } from '../public/js/combat/movesets.js';
import { CLONE_LIMITS } from '../public/js/combat/clones.js';

const root = process.cwd();
const out = process.env.OUT || 'artifacts/compare/naruto';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let rel = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => rel === dir || rel.startsWith(dir + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

let checks = 0;
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  checks++;
  console.log(`  ok  ${name}`);
}

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180_000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.stack || String(error)));
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const local = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try { await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: await readFile(local) }); }
    catch { await route.fulfill({ status: 404, body: 'missing' }); }
  });
  const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150_000, polling: 250 });
  await page.evaluate(() => {
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashSelect?.chooseArena('valley');
    window.__browserSmashSelect?.select('p1', 'Naruto Uzumaki');
    window.__browserSmashSelect?.select('p2', 'Thor');
    document.querySelector('#play').click();
  });
  await step(.5);
  const identity = await page.evaluate(() => window.fighters[0].identity);
  check('the match is Naruto versus Thor', identity === 'Naruto Uzumaki', String(identity));

  // ---- five-form progression ------------------------------------------------------
  const expected = MOVESETS.naruto_uzumaki.forms;
  const seen = [];
  for (let stage = 0; stage < expected.length; stage++) {
    await page.evaluate(() => {
      const f = window.fighters[0];
      f.power = 100; f.transformCooldown = 0; f.formLock = 0;
      f.hitstun = 0; f.guardBreak = 0;
      f.position.set(0, .6, 0); window.fighters[1].position.set(3, .6, 0);
      window.fighters[1].percent = 0;
    });
    await page.keyboard.press('i');
    await step(.7);
    const state = await page.evaluate(() => {
      const f = window.fighters[0];
      const powers = window.__browserSmashPowers?.();
      return {
        label: f.transform?.form?.label || null,
        id: f.transform?.form?.id || null,
        aura: f.transform?.form?.aura || null,
        damage: f.transformMods?.damage ?? null,
        defense: f.transformMods?.defense ?? null,
        special: f.specialProfile?.label || null,
        ultimate: powers?.p1?.ultimateLabel || null
      };
    });
    seen.push(state);
    await page.screenshot({ path: `${out}/form-${stage + 1}-${state.id}.png` });
    // End the form so the next activation enters the next tier.
    await page.evaluate(() => { const f = window.fighters[0]; if (f.transform) f.transform.time = 0; });
    await step(.1);
    await page.evaluate(() => { window.fighters[0].transformCooldown = 0; window.fighters[0].formLock = 0; });
  }
  check('every activation enters the next form in order',
    seen.every((s, i) => s.id === expected[i].id), JSON.stringify(seen.map(s => s.id)));
  check('the five forms change real combat numbers, not just labels',
    new Set(seen.map(s => `${s.damage}/${s.defense}`)).size === expected.length,
    JSON.stringify(seen.map(s => `${s.damage}/${s.defense}`)));
  check('each form swaps in its own signature move',
    new Set(seen.map(s => s.special)).size === expected.length, JSON.stringify(seen.map(s => s.special)));
  check('each form has its own ultimate',
    new Set(seen.map(s => s.ultimate)).size === expected.length, JSON.stringify(seen.map(s => s.ultimate)));

  // ---- shadow clones --------------------------------------------------------------
  await page.evaluate(() => {
    window.__browserSmashClearClones?.();
    const f = window.fighters[0];
    f.transform = null; f.formStage = 0; f.abilityReadyAt = {};
    f.position.set(0, .6, 0); f.facing = 1; f.facingZ = 0;
    window.fighters[1].position.set(3.2, .6, 0);
    window.fighters[1].percent = 0;
  });
  const skinnedMeshes = () => page.evaluate(() => {
    let count = 0;
    window.__browserSmashScene?.traverse?.(node => { if (node.isSkinnedMesh) count++; });
    return count;
  });
  const baselineSkinned = await skinnedMeshes();
  await page.keyboard.press('l');
  await step(.2);
  const readClones = () => page.evaluate(() => JSON.stringify(window.__browserSmashClones?.() ?? null)).then(raw => JSON.parse(raw));
  const cloneCountNow = () => page.evaluate(() => window.__browserSmashCloneCount?.() ?? -1);
  const spawned = await cloneCountNow();
  check('L summons two real clones', spawned === 2, String(spawned));

  await page.evaluate(() => window.spawnShadowClones(window.fighters[0], 3));
  const capped = await cloneCountNow();
  check(`the clone pool is capped at ${CLONE_LIMITS.alive}`, capped > 0 && capped <= CLONE_LIMITS.alive, String(capped));

  const before = await page.evaluate(() => window.fighters[1].percent);
  // The clone brain runs on render frames, so wait on real frames rather than the fixed step.
  const damaged = await page.evaluate(async (start) => {
    const target = window.fighters[1];
    for (let i = 0; i < 1200 && target.percent === start; i++) {
      await new Promise(done => requestAnimationFrame(done));
    }
    return target.percent;
  }, before);
  check('a clone lands real damage on the opponent', damaged > before, `${before}% -> ${damaged}%`);

  await page.screenshot({ path: `${out}/clones-in-match.png` });

  const cleaned = await page.evaluate(() => window.__browserSmashClearClones());
  check('clones are removed from the scene on cleanup', cleaned === 0, String(cleaned));
  const leftover = await skinnedMeshes();
  // The scene already holds the two fighters' own skinned meshes; the assertion is that the clone
  // bodies added nothing that outlives them.
  check('no clone skinned meshes survive cleanup', leftover === baselineSkinned,
    `${baselineSkinned} before, ${leftover} after`);

  check('no page errors during the Naruto run', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  console.log(`\nNaruto verification passed (${checks} checks).`);
} finally {
  await browser?.close();
  server.close();
}
