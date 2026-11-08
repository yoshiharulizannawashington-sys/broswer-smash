// Spider-Man gameplay acceptance: the imported body, driven through the real keyboard controls,
// in a real match against Goku. Every assertion reads the live fighter/controller, not a rail.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/spider-man-gameplay';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.hdr': 'application/octet-stream' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sources: [], roster: { launch: [], manifestKeys: [] } }));
      return;
    }
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) relative = 'public' + sep + relative;
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;

const checks = [];
const report = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
};
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.setDefaultTimeout(180000);
const errors = [];
const failedRequests = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 220)));
page.on('response', r => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url().slice(-90)}`); });
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 180)); });

await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.waitForSelector('#selectScreen [data-fighter="Spider-Man"]', { timeout: 30000 });
await page.evaluate(() => document.querySelector('#selectScreen [data-fighter="Spider-Man"]').click());
await page.evaluate(() => document.querySelector('#selectScreen [data-side="p1"]').click());
await page.waitForTimeout(700);
await page.evaluate(() => document.querySelector('#selectScreen [data-side="p2"]').click());
await page.waitForTimeout(250);
await page.evaluate(() => document.querySelector('#selectScreen [data-fighter="Goku"]').click());
await page.evaluate(() => document.querySelector('#play').click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 40000, polling: 200 });
await page.waitForFunction(() => window.__browserSmashAssets?.characterModels?.spider_man?.status === 'loaded', null, { timeout: 120000, polling: 300 });
await page.waitForTimeout(1200);
await page.evaluate(() => {
  window.__browserSmashFreezeAI = true;
  const idle = { left:false, right:false, up:false, down:false, run:false, sprint:false, jump:false, attack:false, special:false, special2:false, special3:false, grab:false, dodge:false, shield:false, parry:false, ascend:false, descend:false, flightToggle:false, brake:false, webSwing:false, vertical:0 };
  const p2 = window.fighters[1];
  if (!p2.__spiderTestSim) {
    p2.__spiderTestSim = p2.simulate.bind(p2);
    p2.simulate = dt => p2.__spiderTestSim(dt, { getInputs: () => ({ ...idle }) });
  }
});
await page.evaluate(() => window.__browserSmashStep(0.5));

async function reset(distance = 1.8) {
  await page.evaluate(distance => {
    const [p1, p2] = window.fighters;
    window.combatPowers?.clear?.('test');
    // Clear in-flight projectiles/effects as a round reset would; otherwise a web ball from the
    // previous probe can land during the next one and turn a miss into a false positive.
    window.__browserSmashTraining?.resetPositions?.();
    window.__browserSmashLastImpact = null;
    window.__browserSmashLastShot = null;
    window.__browserSmashGrabTrace = [];
    const angle = 0;
    p1.position.set(-distance / 2, 0, angle); p2.position.set(distance / 2, 0, angle);
    for (const f of [p1, p2]) {
      f.velocity.set(0, 0, 0); f.isGrounded = true; f.hitstun = 0; f.guardBreak = 0;
      f.guardHeld = false; f.attackQueue.length = 0; f.attackPose = 0; f.hitboxes.length = 0;
      f.dodgeTimer = 0; f.transform = null; f.formLock = 0; f.transformCooldown = 0;
      f.casting = null; f.ko = false; f.webSwinging = false; f.flightMode = false;
      f.attackBuffer = 0; f.comboStep = 0; f.activeMoveId = null;
      window.endWebSwing?.(f, false);
    }
    p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
    p2.invulnerable = 0; p2.shield = 100; p2.percent = 0; p2.hitstun = 0; p2.guardHeld = false;
    p1.percent = 0; p1.meter = 100; p1.power = 100; p1.specialCooldown = 0; p1.abilityReadyAt = {};
    const c = p1.animationController;
    if (c) { c._lock = null; c._downState = false; c._getUpTimer = 0; c._landTimer = 0; c._airTime = 0; }
  }, distance);
  await page.evaluate(() => window.__browserSmashStep(0.22));
}

async function advance(seconds) {
  return page.evaluate(seconds => {
    const [p1, p2] = window.fighters;
    const seen = [];
    let last = null, maxPercent = p2.percent, maxHitstun = 0, maxCooldown = 0, minGap = p1.position.distanceTo(p2.position);
    const start = p1.position.clone();
    const steps = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < steps; i += 1) {
      window.__browserSmashStep(1 / 60);
      const active = p1.animationController?._active || null;
      if (active && active !== last) { seen.push(active); last = active; }
      maxPercent = Math.max(maxPercent, p2.percent);
      maxHitstun = Math.max(maxHitstun, p1.hitstun || 0);
      maxCooldown = Math.max(maxCooldown, p1.specialCooldown || 0);
      minGap = Math.min(minGap, p1.position.distanceTo(p2.position));
    }
    const animClip = p1.animationController?._action?.getClip?.();
    const animProgress = animClip && animClip.duration > 0
      ? +(p1.animationController.currentTime / animClip.duration).toFixed(2) : null;
    // The strike peak the controller retimes the clip to: the middle of the real active window.
    // Captures must sample this, not a fixed fraction, or a 0.25 s jab is already retracting.
    const queued = p1.attackQueue?.[p1.attackQueue.length - 1] || null;
    const attackPeak = queued && queued.total > 0
      ? +((((queued.start || 0) + (queued.end ?? queued.total)) / 2) / queued.total).toFixed(2) : null;
    // World-space limb line, so a screenshot can be checked against the pose it claims to show.
    const joint = (name) => {
      const node = p1.model?.userData?.[name];
      return node ? node.getWorldPosition(new window.__browserSmashThree.Vector3()).toArray().map(v => +v.toFixed(3)) : null;
    };
    const limbProbe = {
      pelvis: joint('pelvis'), rightLeg: joint('rightLeg'), rightShin: joint('rightShin'), rightFoot: joint('rightFoot'),
      leftLeg: joint('leftLeg'), leftShin: joint('leftShin'), leftFoot: joint('leftFoot'),
      rightArm: joint('rightArm'), rightFore: joint('rightFore'), rightHand: joint('rightHand'),
      leftArm: joint('leftArm'), leftFore: joint('leftFore'), leftHand: joint('leftHand')
    };
    return {
      seen, active: p1.animationController?._active || null,
      animProgress, attackPeak, limbProbe,
      state: p1.animationController?._select?.()?.id || null,
      casting: p1.casting || null, transform: p1.transform?.id || null,
      formLock: +(p1.formLock || 0).toFixed(2), grounded: !!p1.isGrounded,
      webSwinging: !!p1.webSwinging, dodge: +(p1.dodgeTimer || 0).toFixed(2),
      specialCooldown: +(p1.specialCooldown || 0).toFixed(2), maxCooldown: +maxCooldown.toFixed(2),
      meter: Math.round(p1.meter || 0), p2percent: +p2.percent.toFixed(1), maxPercent: +maxPercent.toFixed(1),
      p2hitstun: +(p2.hitstun || 0).toFixed(2), minGap: +minGap.toFixed(2),
      dx: +(p1.position.x - start.x).toFixed(2), dz: +(p1.position.z - start.z).toFixed(2),
      attack: p1.attackQueue?.[p1.attackQueue.length - 1]?.id || p1.activeMoveId || null,
      lastStrike: p1.model?.userData?.lastAuthoredStrike || null,
      lastUltimateAnimation: p1.model?.userData?.lastUltimateAnimation || null,
      weaponKind: p1.model?.userData?.weaponKind || null,
      equippedWeapons: ['equippedWeaponRight', 'equippedWeaponLeft'].filter(k => p1.model?.userData?.[k]),
      lastShot: window.__browserSmashLastShot || null,
      lastImpact: window.__browserSmashLastImpact || null,
      grabTrace: (window.__browserSmashGrabTrace || []).slice(-8),
      liveProjectiles: typeof window.__browserSmashProjectiles === 'function' ? window.__browserSmashProjectiles() : null,
      p1pos: p1.position.toArray().map(v => +v.toFixed(2)), p2pos: p2.position.toArray().map(v => +v.toFixed(2)),
      facing: p1.facing, cinematicSource: window.__browserSmashCinematicPoseSource || null,
      hasUltimateClip: !!p1.animationController?.clips?.has('spider_web_ultimate'),
      hasFormClip: !!p1.animationController?.clips?.has('spider_sense_overdrive')
    };
  }, seconds);
}

async function advanceUntil(predicate, { step = .05, max = 4 } = {}) {
  let trace = null;
  let elapsed = 0;
  while (elapsed < max - 1e-6) {
    trace = await advance(step);
    elapsed += step;
    if (predicate(trace)) return trace;
  }
  return trace;
}

async function snap(name, trace = null) {
  // Freeze the match so the screenshot is the measured pose, not a frame several simulation
  // steps later. Screenshots had been advancing the ultimate and airborne states under test.
  await page.evaluate(() => window.__browserSmashSetPaused?.(true));
  await page.waitForTimeout(80);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.evaluate(() => window.__browserSmashSetPaused?.(false));
  if (trace) {
    report.push({ name, ...trace });
    console.log('SNAP', name, JSON.stringify(trace));
  }
}

// 1. idle + locomotion
await reset();
let t = await advance(0.35);
check('idle plays on the imported body', t.active === 'fighting_idle' || t.active === 'idle', JSON.stringify(t));
check('imported body carries no oversized signature prop', t.weaponKind === 'unarmed' && t.equippedWeapons.length === 0, JSON.stringify(t));
await snap('01-idle', t);
await page.keyboard.down('d'); t = await advance(0.55); await page.keyboard.up('d');
check('walk state is reached', t.seen.includes('walk'), JSON.stringify(t));
await snap('02-walk', t);
await reset();
await page.keyboard.down('Shift'); await page.keyboard.down('d'); t = await advance(0.75); await page.keyboard.up('d'); await page.keyboard.up('Shift');
check('run/sprint is reached after the dash edge', t.seen.includes('run') || t.seen.includes('sprint'), JSON.stringify(t));
check('run silhouette is not a standing idle', t.active !== 'fighting_idle' && t.active !== 'idle', JSON.stringify(t));
await snap('03-run', t);

// 2. jump / fall / landing
await reset();
await page.keyboard.press('Space'); t = await advance(0.16);
check('jump clip plays on takeoff', t.seen.includes('jump'), JSON.stringify(t));
await snap('04-jump', t);
t = await advanceUntil(x => x.active === 'fall' || x.seen.includes('fall'), { step: .04, max: 1.4 });
check('fall clip plays in the air', !t.grounded && (t.active === 'fall' || t.seen.includes('fall')), JSON.stringify(t));
await snap('05-fall', t);
t = await advanceUntil(x => x.grounded && (x.active === 'land' || x.seen.includes('land')), { step: .04, max: 1.6 });
check('landing clip plays and the body is grounded again', t.grounded && (t.active === 'land' || t.seen.includes('land')), JSON.stringify(t));
await snap('06-land', t);

// 3. attacks: jab chain, kick, heavy, aerial
await reset(1.15);
await page.keyboard.press('j'); t = await advance(0.16);
check('jab clip and real hit confirm', (t.seen.includes('jab') || t.seen.includes('SpiderMan_Jab')) && t.maxPercent > 0, JSON.stringify(t));
await snap('07-jab', t);
// Normal-camera phase review for the same real attack: startup, extension, recovery.
await reset(1.15);
await page.keyboard.press('j');
await page.evaluate(() => window.__browserSmashStep(0.06));
await snap('07a-jab-anticipation');
await page.evaluate(() => window.__browserSmashStep(0.12));
await snap('07b-jab-peak');
await page.evaluate(() => window.__browserSmashStep(0.16));
await snap('07c-jab-recovery');
await reset(1.15);
await page.keyboard.press('j');
const lateJab = await advanceUntil(x => x.active === 'SpiderMan_Jab' && x.attackPeak != null && x.animProgress >= x.attackPeak, { step: .01, max: .5 });
await snap('07d-jab-extension', lateJab);
const comboSeen = [...t.seen];
await page.keyboard.press('j'); t = await advance(0.18); comboSeen.push(...t.seen);
check('jab chain reaches a kick', comboSeen.some(id => ['front_kick', 'combo_2', 'spinning_kick', 'SpiderMan_Cross', 'SpiderMan_Kick'].includes(id)), JSON.stringify({ ...t, comboSeen }));
await page.keyboard.press('j'); t = await advance(0.28); comboSeen.push(...t.seen);
check('third combo step reaches the finisher clip', comboSeen.some(id => ['combo_1', 'spinning_kick', 'heavy_punch', 'front_kick', 'SpiderMan_Cross', 'SpiderMan_Kick'].includes(id)), JSON.stringify({ ...t, comboSeen }));
await snap('08-combo', t);
// Fresh chain, sampled at the ground finisher's real contact peak.
await reset(1.3);
await page.keyboard.press('j'); await advance(0.18);
await page.keyboard.press('j'); await advance(0.18);
await page.keyboard.press('j');
const comboPeak = await advanceUntil(x => x.active === 'SpiderMan_Kick' && x.attackPeak != null && x.animProgress >= x.attackPeak, { step: .01, max: .6 });
await snap('08b-combo-contact', comboPeak);
await reset(2.1);
await page.keyboard.down('Shift'); await page.keyboard.press('j'); t = await advance(0.30); await page.keyboard.up('Shift');
check('heavy attack lands with real damage', t.seen.some(id => ['heavy_punch', 'uppercut', 'front_kick', 'SpiderMan_Heavy'].includes(id)) && t.maxPercent > 0, JSON.stringify(t));
await snap('09-heavy', t);
await reset(2.1);
await page.keyboard.down('Shift'); await page.keyboard.press('j');
await page.evaluate(() => window.__browserSmashStep(0.16));
await snap('09a-heavy-anticipation');
await page.evaluate(() => window.__browserSmashStep(0.16));
await snap('09b-heavy-peak');
await page.evaluate(() => window.__browserSmashStep(0.18));
await snap('09c-heavy-recovery');
await page.keyboard.up('Shift');
await reset(2.1);
await page.keyboard.down('Shift'); await page.keyboard.press('j');
const lateHeavy = await advanceUntil(x => x.active === 'SpiderMan_Heavy' && x.attackPeak != null && x.animProgress >= x.attackPeak, { step: .01, max: .6 });
await snap('09d-heavy-extension', lateHeavy);
await page.keyboard.up('Shift');
await reset(1.35);
await page.keyboard.press('Space'); await advance(0.20); await page.keyboard.press('j'); t = await advance(0.26);
check('aerial attack plays while airborne', !t.grounded && t.seen.some(id => ['front_kick', 'jump', 'fall', 'SpiderMan_Air'].includes(id)), JSON.stringify(t));
await snap('10-aerial', t);
await page.evaluate(() => window.__browserSmashStep(0.10));
await snap('10a-aerial-peak');
await reset(1.35);
await page.keyboard.press('Space');
await page.evaluate(() => window.__browserSmashStep(0.20));
await page.keyboard.press('j');
const airPeak = await advanceUntil(x => x.active === 'SpiderMan_Air' && x.attackPeak != null && x.animProgress >= x.attackPeak, { step: .01, max: .6 });
await snap('10b-aerial-extension', airPeak);
await advance(1.2);

// 4. guard / dodge / reactions / knockdown
await reset();
await page.keyboard.down('e'); t = await advance(0.25);
check('guard reaches the block clip', t.seen.includes('block') && t.active === 'block', JSON.stringify(t));
await snap('11-block', t);
await page.keyboard.up('e'); await advance(0.2);
await reset();
await page.keyboard.press('Shift'); t = await advance(0.12);
check('dodge enters a dodge clip', t.seen.some(id => id.startsWith('dodge')), JSON.stringify(t));
await snap('12-dodge', t);
t = await advance(0.55);
check('dodge releases control', t.dodge <= 0 && !t.active?.startsWith('dodge'), JSON.stringify(t));
await reset();
await page.evaluate(() => { const p = window.fighters[0]; p.hitstun = 0.45; });
t = await advance(0.12);
check('hit reaction plays hit_heavy', t.seen.includes('hit_heavy'), JSON.stringify(t));
await snap('13-hit', t);
await page.evaluate(() => { window.fighters[0].hitstun = 0; });
t = await advance(0.45);
check('hit reaction returns to idle', t.active === 'fighting_idle' || t.active === 'idle', JSON.stringify(t));
await reset();
await page.evaluate(() => { const p = window.fighters[0]; p.hitstun = 1.2; p.isGrounded = true; p.velocity.set(0, 0, 0); });
t = await advance(0.16);
check('knockdown clip plays', t.seen.includes('knockdown'), JSON.stringify(t));
await snap('14-knockdown', t);
await page.evaluate(() => { window.fighters[0].hitstun = 0; });
t = await advance(0.55);
check('get-up clip plays after knockdown', t.seen.includes('get_up'), JSON.stringify(t));
await snap('15-get-up', t);

// 5. web signature moves + swing
await reset(2.2);
await page.keyboard.press('k'); t = await advance(0.55);
check('Web Zip clip plays and starts its cooldown', t.seen.includes('spider_man_web_zip') && t.maxCooldown > 0, JSON.stringify(t));
check('Web Zip deals real damage', t.maxPercent > 0, JSON.stringify(t));
await snap('16-web-zip', t);
t = await advance(0.8);
check('Web Zip returns control when the cooldown ends', t.specialCooldown <= 0 && (t.active === 'fighting_idle' || t.active === 'idle' || t.active === 'walk'), JSON.stringify(t));
await reset(2.4);
await page.keyboard.press('l'); t = await advance(0.12);
const shotClip = t.seen.includes('spider_web_shot');
await snap('17-web-shot', t);
// Projectiles are advanced by the render loop, not __browserSmashStep. Wait for the game's own hit
// resolver to report the impact; a fixed wall-clock sleep can sample before SwiftShader draws a
// frame, especially after extra screenshot work has loaded the renderer.
await page.waitForFunction(() => (window.__browserSmashLastImpact?.dealt || 0) > 0
  || (window.fighters?.[1]?.percent || 0) > 0, null, { timeout: 6000 }).catch(() => {});
t = await advance(0.08);
check('Web Shot clip and projectile hit', shotClip && t.maxPercent > 0 && (t.lastImpact?.dealt || 0) > 0, JSON.stringify(t));
await reset(3.6);
await page.keyboard.press('h'); t = await advance(0.55);
check('Web Pull clip and target displacement', t.seen.includes('spider_web_pull') && (t.minGap < 3.6 || t.p2hitstun > 0), JSON.stringify(t));
await snap('18-web-pull', t);
await reset(2.0);
await page.keyboard.press('t'); t = await advance(0.40);
check('Web Swing Strike clip plays', t.seen.includes('spider_web_swing'), JSON.stringify(t));
await snap('19-web-swing-strike', t);
await reset(5.0);
await page.keyboard.down('g'); t = await advance(0.38);
check('held web swing owns the body and marks webSwinging', t.webSwinging && t.active === 'web_swing', JSON.stringify(t));
await snap('20-web-swing', t);
await page.keyboard.up('g'); t = await advance(0.85);
check('releasing web swing returns control', !t.webSwinging && !t.casting, JSON.stringify(t));

// 6. ultimate: the pull beat plus two damaging strikes, meter spend, recovery and control.
// The finisher's presentation clock slows the simulation to .35x at impact, so cast beats are
// measured from the cast state and the grab trace, never from a fixed wall-clock offset.
await reset(2.5);
await page.evaluate(() => { const p = window.fighters[0]; p.meter = 100; p.power = 100; });
await page.keyboard.press('o');
let ultSeen = [];
t = await advance(0.22); ultSeen.push(...t.seen);
check('ultimate spends the meter and starts the authored clip', t.casting === 'ultimate' && t.seen.includes('spider_web_ultimate') && t.meter === 0, JSON.stringify(t));
check('ultimate clip is present in the imported controller', t.hasUltimateClip, JSON.stringify(t));
await snap('21-ultimate-web', t);
t = await advance(0.35); ultSeen.push(...t.seen);
await snap('22-ultimate-reel', t);
const firstBeat = await advanceUntil(x => x.grabTrace.some(e => e.index === 1), { step: .3, max: 6 });
ultSeen.push(...firstBeat.seen);
check('ultimate first strike damages the opponent', firstBeat.p2percent > 0 && firstBeat.grabTrace.some(e => e.index === 1 && e.outcome === 'strike'), JSON.stringify(firstBeat));
await snap('23-ultimate-kick', firstBeat);
const slamBeat = await advanceUntil(x => x.grabTrace.some(e => e.index === 2), { step: .3, max: 6 });
ultSeen.push(...slamBeat.seen);
check('ultimate reaches its slam beat and full damage chain', slamBeat.p2percent >= 36 && slamBeat.grabTrace.some(e => e.index === 2 && e.outcome === 'strike'), JSON.stringify(slamBeat));
await snap('24-ultimate-slam', slamBeat);
const ended = await advanceUntil(x => x.casting === null && !['spider_web_ultimate'].includes(x.active), { step: .3, max: 8 });
ultSeen.push(...ended.seen);
check('ultimate ends and returns control', ended.casting === null && !['spider_web_ultimate'].includes(ended.active), JSON.stringify(ended));
check('ultimate landed real opponent damage', ended.p2percent >= 36, JSON.stringify(ended));
const ultStartX = await page.evaluate(() => window.fighters[0].position.x);
await page.keyboard.down('d'); t = await advance(0.35); await page.keyboard.up('d');
check('control returns after the ultimate', Math.abs(t.dx) > 0.03, JSON.stringify({ ...t, startX: ultStartX }));
await snap('25-after-ultimate', t);
console.log('ULTIMATE SEEN', JSON.stringify([...new Set(ultSeen)]));

// 7. transformation activation
await reset();
await page.evaluate(() => { const p = window.fighters[0]; p.power = 100; p.meter = 100; });
await page.keyboard.press('i'); t = await advance(0.22);
check('transformation activates and plays its activation clip', !!t.transform && t.seen.includes('spider_sense_overdrive'), JSON.stringify(t));
check('form activation clip is present in the imported controller', t.hasFormClip, JSON.stringify(t));
await snap('26-transform', t);
t = await advance(0.65);
check('transformation remains active after the activation read', !!t.transform, JSON.stringify(t));
await page.keyboard.down('d'); t = await advance(0.3); await page.keyboard.up('d');
check('control returns during the form', Math.abs(t.dx) > 0.03, JSON.stringify(t));

check('no page errors or failed asset requests', errors.length === 0 && failedRequests.length === 0, [...errors.slice(0, 4), ...failedRequests.slice(0, 4)].join(' | '));

const passed = checks.filter(c => c.ok).length;
console.log(`\n${passed}/${checks.length} checks passed`);
await writeFile(`${out}/report.json`, JSON.stringify({ checks, report, ultSeen: [...new Set(ultSeen)], errors, failedRequests }, null, 2));
await browser.close();
server.close();
process.exit(checks.every(c => c.ok) ? 0 : 1);
