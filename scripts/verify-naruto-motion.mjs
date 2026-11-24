// Does a Naruto cast put an authored clip on the rendered body?
//
// Accepted evidence is threefold and must agree: an action exists on the body's own mixer and
// isRunning with non-zero weight, a bone quaternion actually changes against rest, and a frame is
// captured while it runs. A stamped abilityCast id alone is explicitly not accepted.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd();
const out = 'artifacts/compare/naruto-motion';
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
const page = await browser.newPage({ viewport: { width: 720, height: 700 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 220)));
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.evaluate(() => {
  window.__browserSmashSelect?.chooseArena('valley');
  window.__browserSmashSelect?.select('p1', 'Naruto Uzumaki');
  window.__browserSmashSelect?.select('p2', 'Thor');
  document.querySelector('#play').click();
});
await page.evaluate(() => window.__browserSmashSkipCinematic?.());
await page.waitForTimeout(3500);
await page.evaluate(() => {
  window.__browserSmashFreezeAI = true;
  const a = window.fighters[0], b = window.fighters[1];
  a.position.set(0, 0, 0); b.position.set(2.6, 0, 0);
  a.velocity?.set?.(0, 0, 0); b.velocity?.set?.(0, 0, 0);
});
await page.locator('canvas').first().click({ position: { x: 340, y: 220 }, force: true });
const bound = await page.evaluate(() => ({
  slots: Object.keys(window.fighters[0].model.userData.authoredAbilityActions || {}),
  identityKey: window.fighters[0].identityKey,
  report: window.__browserSmashAssets?.authoredClips || null,
  diag: window.fighters[0].model.userData.authoredBindDiag || null,
  hasMixer: !!window.fighters[0].model.userData.humanMixer,
  hasController: !!window.fighters[0].model.userData.animationController
}));
console.log('BOUND', JSON.stringify(bound));

const readPose = () => {
  const f = window.fighters[0];
  const pick = n => { let b = null; f.model.traverse(x => { if (!b && x.isBone && new RegExp(n, 'i').test(x.name || '')) b = x; }); return b ? b.quaternion.toArray() : null; };
  const u = f.model.userData;
  const actions = u.authoredAbilityActions || {};
  return {
    arm: pick('rightarm'), torso: pick('torso'),
    cast: f.abilityCast?.motion || null,
    weapons: [f.model.userData.equippedWeaponRight, f.model.userData.equippedWeaponLeft, f.model.userData.pickupBlade]
      .filter(o => o && o.isObject3D).map(o => o.visible),
    equipmentState: f.model.userData.equipmentState?.state || null,
    castAt: f.abilityCast?.at ?? null,   // stale casts are identified by an unchanged timestamp
    running: Object.entries(actions).filter(([, a]) => a.isRunning() && a.getEffectiveWeight() > 0.01).map(([slot, a]) => ({ slot, w: +a.getEffectiveWeight().toFixed(2), t: +a.time.toFixed(2) })),
    special: u.authoredSpecialAction && u.authoredSpecialAction.isRunning() && u.authoredSpecialAction.getEffectiveWeight() > 0.01 ? +u.authoredSpecialAction.getEffectiveWeight().toFixed(2) : null
  };
};

const attempts = [];
for (const [label, key] of [['rasengan', 'h'], ['shadowClone', 'l'], ['signature', 'k']]) {
  await page.evaluate(() => {
    const f = window.fighters[0];
    f.specialCooldown = 0; f.attackQueue.length = 0; f.hitstun = 0; f.guardBreak = 0; f.hitLag = 0;
    if (f.abilityReadyAt && typeof f.abilityReadyAt === 'object') for (const k of Object.keys(f.abilityReadyAt)) f.abilityReadyAt[k] = 0;
    const t = window.fighters[1]; t.hitstun = 0; t.invulnerable = 0;
  });
  const rest = await page.evaluate(readPose);
  await page.keyboard.press(key);
  const samples = [];
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
    const frame = await page.evaluate(readPose);
    samples.push(frame);
    // Capture INSIDE the cast, not after it: the first pass photographed the recovery, which shows a
    // restored sword and proves nothing about the stow.
    if (label === 'rasengan' && i === 2) await page.screenshot({ path: `${out}/naruto-rasengan-mid-cast.png` });
  }
  const delta = (a, b) => (a && b) ? Number(Math.max(...a.map((v, k) => Math.abs(v - b[k]))).toFixed(3)) : 0;
  const armMax = Math.max(...samples.map(s => delta(rest.arm, s.arm)));
  const torsoMax = Math.max(...samples.map(s => delta(rest.torso, s.torso)));
  // Only a cast stamped during THIS attempt counts. abilityCast persists on the fighter, so reading
  // it unqualified attributed the previous key's motion to the next one.
  const mine = samples.filter(s => s.cast && s.castAt !== rest.castAt);
  const motion = mine.length ? mine[mine.length - 1].cast : null;
  const runningSlot = samples.flatMap(s => s.running)[0] || null;
  // Recovery: let the clip finish, then require the ability to stop and the body to hand back.
  for (let i = 0; i < 12; i++) await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
  const after = await page.evaluate(readPose);
  const recovered = {
    stillRunning: after.running.length > 0,
    armDeltaVsRest: delta(rest.arm, after.arm),
    specialRunning: after.special !== null
  };
  const file = `${out}/naruto-${label}-${motion || 'none'}.png`;
  // Frame the body itself: the gameplay HUD panel covered the fighter in the first pass, which made
  // the image useless as pose evidence even though the measurements were sound.
  await page.evaluate(() => {
    const THREE = window.__browserSmashThree;
    const f = window.fighters[0];
    const q = f.model.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q).setY(0).normalize();
    const heading = Math.atan2(f.facingZ || 0, f.facing || 1);
    window.smashCamera.spectate({ fighter: f, framing: 'torso', yaw: (Math.atan2(fwd.x, fwd.z) - heading) * 180 / Math.PI + 40, pitch: 4, distance: 3.4 });
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: file });
  const weaponSamples = samples.map(s => s.weapons);
  const anyWeapon = weaponSamples.some(w => w.length);
  const hiddenDuring = anyWeapon && weaponSamples.every(w => w.every(v => v === false));
  const restored = after.weapons.every(v => v === true);
  const equipSeen = [...new Set(samples.concat([after]).map(s => s.equipmentState))];
  attempts.push({ label, key, motion, runningSlot, armMax, torsoMax,
    weapons: { anyWeapon, hiddenDuring, restoredAfter: anyWeapon ? restored : null, equipmentStates: equipSeen,
      sequence: weaponSamples.map(w => (w.length ? w.map(v => (v ? 1 : 0)).join('') : '-')) },
    recovered, file });
  await page.waitForTimeout(400);
}
const ok = attempts.filter(a => a.runningSlot && a.armMax > 0.02);
await writeFile(`${out}/naruto-motion.json`, JSON.stringify({ generatedAt: new Date().toISOString(), bound, attempts, errors }, null, 2));
for (const a of attempts) console.log('MOTION', JSON.stringify({ ...a, weaponSequence: a.weapons.sequence }));
console.log('VERDICT', JSON.stringify({ boundSlots: bound.slots.length, animatedCasts: ok.length, of: attempts.length }));
console.log('ERRORS', JSON.stringify(errors.slice(0, 2)));
await browser.close(); server.close();
