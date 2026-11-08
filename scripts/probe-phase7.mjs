// Phase 7: real-match proof for Iron Spider's legs and for air combat.
//
//   bash scripts/run-browser-test.sh scripts/probe-phase7.mjs
//
// Everything here goes through the real select screen, the real input map and the real
// simulation step. Nothing is forced into an animation state directly.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => relative === d || relative.startsWith(d + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const bytes = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const errors = [];
let browser;
try {
  browser = await chromium.launch({ headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180_000);
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));

  await page.goto(origin + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.fighters?.length === 2 && window.__browserSmashStep,
    null, { timeout: 120_000 });
  await page.click('#selectScreen .bs-card[data-fighter="Iron Spider"]');
  await page.click('#selectScreen .bs-card[data-fighter="Goku"]');
  await page.click('#selectScreen [data-nav="next"]');
  await page.click('#selectScreen .bs-arena[data-arena="tournament"]');
  await page.click('#play');
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__browserSmashStep(1.0));

  const step = seconds => page.evaluate(s => window.__browserSmashStep(s), seconds);
  const shot = name => page.screenshot({ path: `artifacts/phase7/${name}.png` });
  const out = {};

  out.selected = await page.evaluate(() => window.fighters.map(f => f.identityKey));

  // ---------------------------------------------------------------- Iron Spider legs, live
  out.legs = await page.evaluate(() => {
    const f = window.fighters[0];
    const rig = f.model?.userData?.spiderLegs;
    if (!rig) return { attached: false };
    // Borrow a Vector3 from the scene graph instead of window.THREE, which the page does not expose.
    const tips = rig.legs.map(leg => {
      const tip = leg.tip.position.clone();
      leg.tip.getWorldPosition(tip);
      const hip = leg.hip.position.clone();
      leg.hip.getWorldPosition(hip);
      return { id: leg.id, reach: +hip.distanceTo(tip).toFixed(3),
        coxa: +leg.coxa.rotation.x.toFixed(3), femur: +leg.femur.rotation.x.toFixed(3),
        tibia: +leg.tibia.rotation.x.toFixed(3) };
    });
    return { attached: true, count: rig.legs.length, state: rig.state, poseWrites: rig.poseWrites,
      visible: rig.group.visible, childOfModel: rig.group.parent === f.model, tips };
  });
  await shot('iron-spider-idle');

  // Guard pose, then a hit reaction: the joints must actually be re-posed.
  await page.keyboard.down('KeyE'); await step(0.4);
  out.guardState = await page.evaluate(() => {
    const rig = window.fighters[0].model.userData.spiderLegs;
    return { state: rig.state, limb: +rig.legs[0].femur.rotation.x.toFixed(3), writes: rig.poseWrites };
  });
  await page.keyboard.up('KeyE');
  await page.evaluate(() => { window.fighters[0].hitstun = 0.9; }); await step(0.25);
  out.staggerState = await page.evaluate(() => {
    const rig = window.fighters[0].model.userData.spiderLegs;
    return { state: rig.state, limb: +rig.legs[0].femur.rotation.x.toFixed(3), writes: rig.poseWrites };
  });
  await shot('iron-spider-guard');

  // The rig must follow the body: turn the fighter and re-measure a tip in world space.
  out.followsBody = await page.evaluate(() => {
    const f = window.fighters[0];
    const tip = f.model.userData.spiderLegs.legs[0].tip;
    const a = tip.getWorldPosition(new tip.position.constructor());
    const before = a.clone();
    f.facing = -(f.facing || 1);
    f.model.rotation.y += Math.PI;
    f.model.updateMatrixWorld(true);
    const b = tip.getWorldPosition(new tip.position.constructor());
    return { moved: +before.distanceTo(b).toFixed(3) };
  });

  // ---------------------------------------------------------------- air combat, real input
  // Jump with SPACE, confirm airborne, then attack with J and read what the animator selected.
  const air = {};
  await page.evaluate(() => { const [p1, p2] = window.fighters;
    p1.hitstun = 0; p1.percent = 0; p2.percent = 0;
    p1.position.set(0, 0, 0); p2.position.set(1.1, 0, 0); p1.isGrounded = true; });
  await step(0.2);
  await page.keyboard.down('Space'); await step(0.06); await page.keyboard.up('Space');
  await step(0.22);
  air.afterJump = await page.evaluate(() => ({ y: +window.fighters[0].position.y.toFixed(2),
    grounded: window.fighters[0].isGrounded }));
  await page.keyboard.down('KeyJ'); await step(0.05); await page.keyboard.up('KeyJ');
  await step(0.12);
  air.attack = await page.evaluate(() => {
    const p = window.fighters[0];
    const q = p.attackQueue[p.attackQueue.length - 1] || {};
    return { clip: p.model.userData.currentClip, airborne: !p.isGrounded,
      moveId: q.id || q.kind || null, aerial: !!q.aerial, queue: p.attackQueue.length,
      hitboxes: p.hitboxes.length };
  });
  let peakHitboxes = 0;
  for (let i = 0; i < 14; i++) {
    await step(1 / 60);
    const n = await page.evaluate(() => window.fighters[0].hitboxes.length);
    peakHitboxes = Math.max(peakHitboxes, n);
  }
  air.peakHitboxes = peakHitboxes;
  air.damage = await page.evaluate(() => ({ p2: +window.fighters[1].percent.toFixed(1),
    p2hitstun: +window.fighters[1].hitstun.toFixed(2) }));
  await shot('air-attack');
  // Landing recovery must return to a grounded, valid state.
  await step(1.6);
  air.landed = await page.evaluate(() => {
    const p = window.fighters[0];
    return { grounded: p.isGrounded, clip: p.model.userData.currentClip, y: +p.position.y.toFixed(2) };
  });

  out.air = air;
  out.pageErrors = errors;
  console.log(JSON.stringify(out, null, 2));
} finally {
  await browser?.close();
  server.close();
}
