// Hulk match lifecycle, real inputs only: walk toward the opponent with WASD, attack with J,
// win the round by damage (maxPercent), read the authoritative match summary and result screen,
// click the real REMATCH control, then let the CPU fight back for the defeat path.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
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
await mkdir('artifacts/hulk', { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(240000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 240)));

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 120000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Hulk (Bruce Banner)');
  window.__browserSmashSelect?.select?.('p2', 'Goku');
  window.__browserSmashTrainingDummy = true;
  window.__browserSmashFreezeAI = true;
});
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
await page.waitForFunction(() => Boolean(window.fighters?.[0]?.model?.userData?.importedStrikeSet), null, { timeout: 60000, polling: 250 });

const result = await page.evaluate(() => {
  const f = window.fighters[0], u = f.model.userData, foe = window.fighters[1];
  const tick = n => { for (let i = 0; i < n; i += 1) window.__browserSmashStep(1 / 60); };
  const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
  const held = {};
  const hold = (code, on) => { if (!!held[code] === on) return; held[code] = on; key(code, on); };
  const release = () => { for (const code of Object.keys(held)) hold(code, false); };
  const walkTo = target => {
    for (let i = 0; i < 900; i += 1) {
      const dx = foe.position.x - f.position.x, dz = foe.position.z - f.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= target) break;
      // WASD is camera-relative, not world-axis. Steering on raw dx/dz walked Hulk sideways
      // away from Goku for the whole round.
      const V = window.__browserSmashThree;
      const cam = window.smashCamera.camera;
      const fwd = new V.Vector3(); cam.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
      const right = new V.Vector3().crossVectors(fwd, new V.Vector3(0, 1, 0)).normalize();
      const tx = dx / (dist || 1), tz = dz / (dist || 1);
      const along = tx * fwd.x + tz * fwd.z;
      const across = tx * right.x + tz * right.z;
      hold('KeyW', along > 0.25); hold('KeyS', along < -0.25);
      hold('KeyD', across > 0.25); hold('KeyA', across < -0.25);
      tick(1);
      if (window.__browserSmashMatch().status !== 'fighting') break;
    }
    release();
    tick(4);
  };
  const status = () => window.__browserSmashMatch().status;
  const settle = () => { for (let i = 0; i < 300 && status() === 'fighting' && (foe.invulnerable > 0 || foe.hitstun > 0); i += 1) tick(1); };
  const attack = () => { key('KeyJ', true); tick(1); key('KeyJ', false); tick(16); };
  const chain = () => { for (let i = 0; i < 5; i += 1) { if (status() !== 'fighting') break; settle(); if (status() !== 'fighting') break; attack(); } };

  // Authoritative default rules: first to two rounds, 80-second rounds. No rule changes.
  const start = window.__browserSmashMatch();
  const log = [];
  let awarded = 0;
  for (let n = 0; n < 40 && status() !== 'match-over'; n += 1) {
    // A KO ends the round, not the probe. Step through the round-over pause so the next round can
    // actually be fought; stopping here was why the old run ended at 1-0.
    if (status() === 'round-over') {
      for (let i = 0; i < 240 && status() === 'round-over'; i += 1) tick(1);
      n -= 1;
      continue;
    }
    walkTo(1.7);
    if (status() === 'fighting') settle();
    if (status() === 'fighting') chain();
    // Do not keep swinging after the winning blow: the result hold is measured in simulation time,
    // and a five-hit chain after the KO would consume it before this probe returns.
    const ended = status() === 'match-over';
    if (!ended) tick(40);
    const summary = window.__browserSmashMatch();
    const wins = summary.wins[0] + summary.wins[1];
    if (wins !== awarded) { awarded = wins; log.push({ roundWin: summary.wins.slice(), round: summary.round, foe: Math.round(foe.percent), hulk: Math.round(f.percent) }); }
    log.push({ n, dist: +Math.hypot(foe.position.x-f.position.x, foe.position.z-f.position.z).toFixed(2), foe: Math.round(foe.percent), hulk: Math.round(f.percent), status: summary.status, wins: summary.wins });
    if (ended) break;
  }
  if (status() !== 'match-over') throw new Error('Hulk probe did not reach match-over: ' + JSON.stringify(window.__browserSmashMatch()));
  // Stop at the match-over frame. The game now holds the result panel for the celebration, so the
  // probe captures the transition and pose before advancing the hold to the result screen.
  tick(1);
  const win = {
    summary: window.__browserSmashMatch(),
    result: document.querySelector('#result')?.textContent || '',
    playLabel: document.querySelector('#play')?.textContent || '',
    foe: Math.round(foe.percent), hulk: Math.round(f.percent),
    winnerKo: Boolean(foe.ko), hulkVictory: f.victoryPose,
    hulkModel: u.humanMixer?.getRoot?.().uuid === f.model.uuid,
    hulkWeapon: (() => { const w = u.equippedWeaponRight; return { name: w?.name || null, kind: u.weaponKind || null, label: u.weaponLabel || null, visible: w?.visible ?? null }; })(),
    hulkVictoryAnim: Boolean(u.victoryAction?.isRunning?.()),
    hulkVictoryClip: u.victoryAction?.getClip?.()?.name || null,
    hulkVictoryWeight: u.victoryAction?.getEffectiveWeight?.() ?? null,
    hulkVictoryTime: u.victoryAction?.time ?? null,
    hulkVictoryDuration: u.victoryAction?.getClip?.()?.duration ?? null,
    hulkVictoryPaused: Boolean(u.victoryAction?.paused),
    hulkVictoryEnabled: Boolean(u.victoryAction?.enabled),
    hulkVictoryTimeScale: u.victoryAction?.getEffectiveTimeScale?.() ?? null,
    spectating: Boolean(window.smashCamera?.spectateState),
    spectate: window.smashCamera?.describeSpectate?.() || null,
    camera: window.smashCamera?.camera?.position?.toArray?.().map(v => +v.toFixed(2)) || null,
    hulkPosition: f.position.toArray().map(v => +v.toFixed(2)),
    hulkModelPosition: f.model.position.toArray().map(v => +v.toFixed(2)),
    hulkModelScale: f.model.scale.toArray().map(v => +v.toFixed(3)),
    bodyBox: (() => {
      const THREE = window.__browserSmashThree;
      const box = new THREE.Box3().setFromObject(f.model);
      return { min: box.min.toArray().map(v => +v.toFixed(2)), max: box.max.toArray().map(v => +v.toFixed(2)),
        center: box.getCenter(new THREE.Vector3()).toArray().map(v => +v.toFixed(2)),
        size: box.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(2)) };
    })(),
    cameraDirection: (() => {
      const THREE = window.__browserSmashThree;
      const dir = new THREE.Vector3();
      window.smashCamera.camera.getWorldDirection(dir);
      return dir.toArray().map(v => +v.toFixed(3));
    })(),
    framingReport: (() => {
      try { return window.smashCamera.report?.(f, foe) || null; } catch (e) { return { error: String(e.message || e) }; }
    })(),
    foeDefeatAnim: Boolean(foe.model.userData.defeatAction?.isRunning?.()),
    foeDefeatClip: foe.model.userData.defeatAction?.getClip?.()?.name || null,
    hulkDebrisAttached: Boolean(f.debrisSequence?.group?.parent),
    hulkDebrisPose: Boolean(f.debrisPose),
    winsAfterTick: (() => { tick(30); return window.__browserSmashMatch().wins.slice(); })(),
    log
  };
  return win;
});
// Freeze the deterministic camera at the match-over frame, then capture the transition, the
// celebration and the late pose without the result panel covering the character. Advance the
// camera before the first capture so it records the transition itself, not the broken duel shot
// the match happened to end on.
await page.evaluate(() => window.__browserSmashSetPaused(true));
await page.evaluate(() => document.querySelectorAll('body > *:not(canvas)').forEach(el => { el.style.visibility = 'hidden'; }));
const capture = async (name, advance = 0) => {
  if (advance) await page.evaluate(s => window.__browserSmashStep(s), advance);
  await page.waitForTimeout(250);
  const shot = await page.evaluate(label => {
    const THREE = window.__browserSmashThree, c = window.smashCamera, f = window.fighters[0], foe = window.fighters[1];
    const box = new THREE.Box3().setFromObject(f.model);
    const body = box.getCenter(new THREE.Vector3());
    const cam = c.camera;
    const dir = new THREE.Vector3(); cam.getWorldDirection(dir);
    const state = c.spectateState;
    const inside = c.report?.(f, foe)?.insideGeometry ?? c._insideBlock?.(cam.position.x, cam.position.y, cam.position.z) ?? null;
    const target = state?.victoryTarget ? state.victoryTarget.toArray().map(v => +v.toFixed(2)) : null;
    return { label,
      camera: cam.position.toArray().map(v => +v.toFixed(2)), direction: dir.toArray().map(v => +v.toFixed(3)),
      look: c.lookTarget.toArray().map(v => +v.toFixed(2)), target,
      body: { min: box.min.toArray().map(v => +v.toFixed(2)), max: box.max.toArray().map(v => +v.toFixed(2)), center: body.toArray().map(v => +v.toFixed(2)) },
      distanceToBody: +cam.position.distanceTo(body).toFixed(2), inside, blend: state?.blend ?? null,
      choice: state?.victoryChoice ?? null, heading: state?.victoryHeading ?? null,
      opponent: (() => { const b = new THREE.Box3().setFromObject(foe.model); return { center: b.getCenter(new THREE.Vector3()).toArray().map(v => +v.toFixed(2)), size: b.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(2)) }; })(),
      animTime: f.model.userData.victoryAction?.time ?? null, animRunning: Boolean(f.model.userData.victoryAction?.isRunning?.()),
      report: c.report?.(f, foe) || null };
  }, name);
  console.log('SHOT ' + JSON.stringify(shot));
  await page.screenshot({ path: `artifacts/hulk/hulk-victory-${name}.png` });
};
await capture('transition', .22);
await capture('pose', .6);
await capture('pose-late', .85);
await capture('complete', .85);
await page.evaluate(() => document.querySelectorAll('body > *:not(canvas)').forEach(el => { el.style.visibility = ''; }));

// Let the celebration hold expire, then capture the real result panel.
const final = await page.evaluate(() => {
  window.__browserSmashSetPaused(false);
  let steps = 0;
  for (; steps < 420 && !document.querySelector('#result')?.textContent; steps += 1) window.__browserSmashStep(1 / 60);
  return {
    steps,
    result: document.querySelector('#result')?.textContent || '',
    match: window.__browserSmashMatch(),
    hulkVictoryTime: window.fighters[0].model.userData.victoryAction?.time ?? null,
    camera: window.smashCamera?.camera?.position?.toArray?.().map(v => +v.toFixed(2)) || null,
    spectating: Boolean(window.smashCamera?.spectateState),
    hulkWeapon: window.fighters[0].model.userData.equippedWeaponRight?.visible ?? null,
    foeHoldables: ((name) => { const u = window.fighters[name].model.userData; return [u.equippedWeaponRight, u.equippedWeaponLeft, u.pickupBlade].filter(Boolean).map(o => ({ name: o.name || o.type, visible: o.visible })); })('1')
  };
});
await page.waitForTimeout(300);
await page.screenshot({ path: 'artifacts/hulk/match-victory.png' });

// Rematch through the real button, then verify a fresh match and a live hit.
await page.evaluate(() => { document.querySelector('#play')?.click(); });
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
await page.waitForTimeout(800);
const rematch = await page.evaluate(() => {
  const f = window.fighters[0], u = f.model.userData, foe = window.fighters[1];
  const tick = n => { for (let i = 0; i < n; i += 1) window.__browserSmashStep(1 / 60); };
  const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
  const before = { summary: window.__browserSmashMatch(), foe: Math.round(foe.percent), hulk: Math.round(f.percent), meter: Math.round(f.meter || 0), queue: f.attackQueue.length, boxes: f.hitboxes.length, model: u.humanMixer?.getRoot?.().uuid === f.model.uuid };
  // Walk in and land one real light hit on the fresh match.
  for (let i = 0; i < 500; i += 1) {
    const dx = foe.position.x - f.position.x, dz = foe.position.z - f.position.z;
    if (Math.hypot(dx, dz) <= 1.7) break;
    key('KeyD', dx > 0.2); key('KeyA', dx < -0.2); key('KeyS', dz > 0.2); key('KeyW', dz < -0.2);
    tick(1);
    key('KeyD', false); key('KeyA', false); key('KeyS', false); key('KeyW', false);
  }
  key('KeyJ', true); tick(1); key('KeyJ', false); tick(20);
  return { before, after: { foe: Math.round(foe.percent), hulk: Math.round(f.percent), slot: u.lastAuthoredStrike?.slot || null, clip: u.lastAuthoredStrike?.clip || null, status: window.__browserSmashMatch().status,
    // The clean-handed victory stows the gauntlet; a rematch must put it back on the hand.
    weapon: (() => { const w = u.equippedWeaponRight; return { name: w?.name || null, visible: w?.visible ?? null }; })(),
    presentationHandsFree: Boolean(u.presentationHandsFree),
    foeHoldables: (() => { const u = foe.model.userData; return [u.equippedWeaponRight, u.equippedWeaponLeft, u.pickupBlade].filter(Boolean).map(o => ({ name: o.name || o.type, visible: o.visible })); })() } };
});

// Defeat path: same fresh match, Hulk stands passive and the real CPU fights.
await page.evaluate(() => { window.__browserSmashFreezeAI = false; window.__browserSmashTrainingDummy = false; });
const loss = await page.evaluate(() => {
  const f = window.fighters[0], foe = window.fighters[1];
  const tick = n => { for (let i = 0; i < n; i += 1) window.__browserSmashStep(1 / 60); };
  let ticks = 0;
  while (window.__browserSmashMatch().status !== 'match-over' && ticks < 12000) { tick(10); ticks += 10; }
  return { ticks, summary: window.__browserSmashMatch(), result: document.querySelector('#result')?.textContent || '', hulk: Math.round(f.percent), foe: Math.round(foe.percent), hulkKo: Boolean(f.ko),
    hulkGrounded: Boolean(f.isGrounded), hulkDefeatAnim: Boolean(f.model.userData.defeatAction?.isRunning?.()), hulkDefeatClip: f.model.userData.defeatAction?.getClip?.()?.name || null,
    hulkDefeatTime: f.model.userData.defeatAction?.time ?? null, hulkDefeatPaused: Boolean(f.model.userData.defeatAction?.paused),
    hulkDebrisAttached: Boolean(f.debrisSequence?.group?.parent), hulkDebrisPose: Boolean(f.debrisPose),
    foeVictoryAnim: Boolean(foe.model.userData.victoryAction?.isRunning?.()), foeVictoryClip: foe.model.userData.victoryAction?.getClip?.()?.name || null };
});
// Let the defeat camera and the one-shot die clip settle on the simulation clock. Pausing
// immediately after match-over froze the lens mid-ease from the live duel and captured the
// opening standing frames instead of the completed defeat pose.
await page.evaluate(() => {
  window.__browserSmashSetPaused(false);
  window.__browserSmashStep(1.25);
  window.__browserSmashSetPaused(true);
});
await page.evaluate(() => document.querySelectorAll('body > *:not(canvas)').forEach(el => { el.style.visibility = 'hidden'; }));
await capture('defeat', .02);
await page.evaluate(() => document.querySelectorAll('body > *:not(canvas)').forEach(el => { el.style.visibility = ''; }));
const defeatFinal = await page.evaluate(() => {
  window.__browserSmashSetPaused(false);
  let steps = 0;
  for (; steps < 420 && !document.querySelector('#result')?.textContent; steps += 1) window.__browserSmashStep(1 / 60);
  return { steps, result: document.querySelector('#result')?.textContent || '', hulk: Math.round(window.fighters[0].percent), camera: window.smashCamera?.camera?.position?.toArray?.().map(v => +v.toFixed(2)) || null,
    hulkWeapon: window.fighters[0].model.userData.equippedWeaponRight?.visible ?? null,
    foeHoldables: ((name) => { const u = window.fighters[name].model.userData; return [u.equippedWeaponRight, u.equippedWeaponLeft, u.pickupBlade].filter(Boolean).map(o => ({ name: o.name || o.type, visible: o.visible })); })('1') };
});
await page.waitForTimeout(300);
await page.screenshot({ path: 'artifacts/hulk/match-defeat.png' });

const failures = [];
if (final.hulkWeapon !== false) failures.push('Hulk gauntlet visible during the victory presentation');
if (final.foeHoldables?.some(item => item.visible === false)) failures.push("opponent's equipment hidden by Hulk's victory");
if (rematch.after.weapon?.visible !== true) failures.push('rematch did not restore the gamma-knuckle');
if (rematch.after.presentationHandsFree !== false) failures.push('clean-hands flag survived the rematch');
if (rematch.after.foeHoldables?.some(item => item.visible === false)) failures.push("opponent's equipment not back after rematch");
if (defeatFinal.hulkWeapon !== true) failures.push('Hulk gauntlet missing after the defeat');
console.log('EQUIP ' + JSON.stringify({
  victoryHulk: final.hulkWeapon, victoryFoeHoldables: final.foeHoldables,
  rematchHulk: rematch.after.weapon?.visible, rematchFoeHoldables: rematch.after.foeHoldables,
  defeatHulk: defeatFinal.hulkWeapon, defeatFoeHoldables: defeatFinal.foeHoldables, failures
}));
console.log('MATCH ' + JSON.stringify({ result, final, rematch, loss, errors, failures }));
await browser.close();
server.close();
process.exit(failures.length ? 1 : 0);
