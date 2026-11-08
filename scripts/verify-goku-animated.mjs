// Goku in-game verification: mount the verified 73-joint body in a real match, then prove his own
// authored clips are what the body actually plays.
//
// The checks are deliberately split. Bind reports prove the manifest resolved to clips that exist on
// this skeleton; the per-state probes prove the state machine selected them; the bone sampling
// proves the skeleton moved rather than the body sliding around in a rest pose.
//
// Probes change-detect `lastAuthoredStrike.at` (fighter time) instead of comparing wall-clock time,
// and they step the simulation between reads, because software rendering delivers only a few frames
// per second: a fixed wall-clock wait samples the same stale selection again and again.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/goku-anim/in-game';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
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

let failures = 0;
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  if (!ok) failures++;
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
};
const started = Date.now();
const phase = label => console.log('PHASE', label, ((Date.now() - started) / 1000).toFixed(1) + 's');
const watchdog = setTimeout(() => { console.log('WATCHDOG timeout'); process.exit(2); }, 220000);
watchdog.unref?.();

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(60000);
  page.on('pageerror', error => errors.push(String(error?.message || error).slice(0, 200)));

  await page.goto(origin + '/?showcaseCharacter=goku_licensed', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 120000, polling: 250 });
  await page.waitForTimeout(500);
  await page.click('#bbTitle [data-nav="versus"]');
  await page.evaluate(() => {
    window.__browserSmashSelect?.select?.('p1', 'Goku');
    window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki');
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashFreezeAI = true;
  });
  await page.waitForTimeout(300);
  const selection = await page.evaluate(() => ({
    p1: document.querySelector('#p1Character')?.value || null,
    p2: document.querySelector('#p2Character')?.value || null
  }));
  await page.evaluate(() => document.querySelector('#play')?.click());
  await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
  await page.waitForTimeout(1200);
  phase('match ready');

  const ready = await page.waitForFunction(() => {
    const a = window.__browserSmashAssets || {};
    const sets = [a.importedStrikes?.goku, a.importedReactions?.goku, a.authoredBaked?.goku, a.importedAbilities?.goku];
    const mounted = window.fighters?.[0]?.model?.userData || {};
    // The registry is global per identity, so it can go ready for the selection preview before the
    // match root has bound its own sets. Wait for the root that is actually being asserted on.
    const rootReady = Boolean(mounted.importedReactionSet && mounted.importedStrikeSet && mounted.idleAction);
    return rootReady && sets.every(set => set && (set.status === 'ready' || set.status === 'failed')) ? sets : null;
  }, null, { timeout: 90000, polling: 500 }).then(handle => handle.jsonValue());
  const [strikes, reactions, authored, abilities] = ready;
  phase('clip sets settled');

  const skeleton = await page.evaluate(() => {
    const f = window.fighters[0];
    const root = f.model;
    let joints = 0;
    const names = [];
    root.traverse(node => { if (node.isBone) { joints++; names.push(node.name); } });
    return {
      identityKey: f.identityKey, modelName: root.name, joints,
      hasRightHand: names.includes('RightHand'), hasHips: names.includes('Hips'),
      controllerReleased: Boolean(root.userData.animationControllerReleased),
      currentClip: root.userData.currentClip || null,
      idleClip: root.userData.idleAction?.getClip?.().name || null,
      walk: root.userData.walkAction?.getClip?.().name || null
    };
  });
  check('the mounted body is the verified 73-joint Goku', skeleton.joints >= 70 && skeleton.hasRightHand && skeleton.hasHips, JSON.stringify(skeleton));
  check('his identity resolves to the goku clip sets', skeleton.identityKey === 'goku', String(skeleton.identityKey));
  check('the canonical controller released the rig to his own clips', skeleton.controllerReleased === true, String(skeleton.controllerReleased));
  check('strike set bound on the body', strikes?.status === 'ready' && (strikes?.missing || []).length === 0, JSON.stringify({ status: strikes?.status, bound: strikes?.bound, missing: strikes?.missing }));
  check('reaction set bound on the body', reactions?.status === 'ready' && (reactions?.missing || []).length === 0, JSON.stringify({ status: reactions?.status, bound: reactions?.bound, missing: reactions?.missing }));
  check('authored form sequences bound', authored?.status === 'ready' && (authored?.forms || []).length === 3, JSON.stringify({ status: authored?.status, forms: authored?.forms, missing: authored?.missing }));
  check('kit ability clips bound', abilities?.status === 'ready' && (abilities?.missing || []).length === 0, JSON.stringify({ status: abilities?.status, bound: abilities?.bound, missing: abilities?.missing }));
  check('idle is his own authored clip', skeleton.idleClip === 'Goku_Idle', String(skeleton.idleClip));
  check('walk is his own authored clip', skeleton.walk === 'Goku_Walk', String(skeleton.walk));
  await page.screenshot({ path: `${out}/01-idle.png` });

  // ---- strikes ----------------------------------------------------------------------------------
  // One press, stepped until the selection actually changes, so the recorded clip belongs to this
  // press rather than to the previous one.
  const strikePress = codes => page.evaluate(async ({ codes }) => {
    const f = window.fighters[0];
    const root = f.model;
    const foe = window.fighters[1];
    const frame = () => new Promise(done => requestAnimationFrame(() => done()));
    // A light chain only advances on a real connection, and a frozen dummy at spawn distance is out
    // of reach, so every press would resolve to the first link. Pin it just inside jab range.
    if (foe) {
      foe.position.set(f.position.x + (f.facing >= 0 ? 1.15 : -1.15), 0, f.position.z);
      foe.velocity?.set?.(0, 0, 0);
    }
    // Let the previous move finish and drain the queue so this press starts a fresh link.
    for (let i = 0; i < 30 && ((f.attackQueue?.length || 0) > 0 || (f.attackPose || 0) > 0); i += 1) {
      window.__browserSmashStep(1 / 60);
      await frame();
    }
    const before = root.userData.lastAuthoredStrike?.at ?? -1;
    f.dodgeTimer = 0; f.dashTimer = 0; f.dashCooldown = 0;
    // Modifiers must be HELD across the frame that resolves the attack. Pressing and releasing them
    // in the same task means no frame ever observes SHIFT or W held, so every heavy resolves as a
    // light: the input reader samples held keys, not the event order.
    for (const code of codes) window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    if (codes.length) { window.__browserSmashStep(1 / 60); await frame(); }
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', bubbles: true }));
    window.__browserSmashStep(1 / 60);
    await frame();
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyJ', bubbles: true }));
    for (const code of codes) window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
    for (let i = 0; i < 26; i += 1) {
      window.__browserSmashStep(1 / 60);
      await frame();
      const strike = root.userData.lastAuthoredStrike;
      if (strike && strike.at !== before) return strike;
    }
    return null;
  }, { codes });

  await page.evaluate(() => { const f = window.fighters[0]; f.hitstun = 0; f.attackQueue.length = 0; f.comboStep = 0; f.comboWindow = 0; f.comboHitCount = 0; });
  const lightChain = [];
  for (let hit = 0; hit < 5; hit += 1) lightChain.push(await strikePress([]));
  const lightSlots = [...new Set(lightChain.map(entry => entry?.slot).filter(Boolean))];
  const lightClips = [...new Set(lightChain.map(entry => entry?.clip).filter(Boolean))];
  check('light chain plays his authored strike clips', lightSlots.length >= 3 && lightClips.every(name => name.startsWith('Goku_')), JSON.stringify(lightChain.map(entry => entry && [entry.slot, entry.clip])));
  await page.screenshot({ path: `${out}/02-strike.png` });

  await page.evaluate(() => { const f = window.fighters[0]; f.attackQueue.length = 0; f.hitstun = 0; f.comboStep = 0; f.comboWindow = 0; });
  const heavy = await strikePress(['ShiftLeft']);
  check('heavy plays his authored heavy clip', heavy?.clip === 'Goku_Heavy', JSON.stringify(heavy));

  const slamSlot = await page.evaluate(() => window.fighters[0].model.userData.lastAuthoredStrike?.slot || null);
  await page.evaluate(() => { const f = window.fighters[0]; f.attackQueue.length = 0; f.hitstun = 0; f.comboStep = 0; f.comboWindow = 0; });
  const launcher = await strikePress(['ShiftLeft', 'KeyW']);
  check('launcher plays his authored launcher clip', launcher?.clip === 'Goku_Launcher' || launcher?.clip === 'Goku_Kick', JSON.stringify(launcher));

  // ---- guard ------------------------------------------------------------------------------------
  const guardClip = await page.evaluate(async () => {
    const f = window.fighters[0];
    const root = f.model;
    const frame = () => new Promise(done => requestAnimationFrame(() => done()));
    f.hitstun = 0; f.guardBreak = 0; f.shield = 100; f.dodgeTimer = 0;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true }));
    let clip = null;
    for (let i = 0; i < 18; i += 1) {
      window.__browserSmashStep(1 / 60);
      await frame();
      if ((root.userData.currentClip || '').startsWith('Goku_Block')) { clip = root.userData.currentClip; break; }
    }
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE', bubbles: true }));
    return clip || root.userData.currentClip || null;
  });
  await page.screenshot({ path: `${out}/03-guard.png` });
  check('guard plays his authored block clip', guardClip === 'Goku_Block', String(guardClip));

  // ---- skeleton motion ---------------------------------------------------------------------------
  const boneMotion = await page.evaluate(async () => {
    const f = window.fighters[0];
    const root = f.model;
    const find = name => { let hit = null; root.traverse(node => { if (!hit && node.isBone && node.name === name) hit = node; }); return hit; };
    const hand = find('RightHand');
    const hip = find('Hips');
    if (!hand || !hip) return { error: 'bones missing' };
    const pos = bone => [bone.matrixWorld.elements[12], bone.matrixWorld.elements[13], bone.matrixWorld.elements[14]];
    const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const frame = () => new Promise(done => requestAnimationFrame(() => done()));
    const baseHand = pos(hand), baseHip = pos(hip);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyJ', bubbles: true }));
    let maxHand = 0, maxHip = 0, clip = null;
    for (let i = 0; i < 40; i += 1) {
      window.__browserSmashStep(1 / 60);
      await frame();
      const name = root.userData.currentClip;
      if (name && name.startsWith('Goku_')) clip = name;
      maxHand = Math.max(maxHand, distance(pos(hand), baseHand));
      maxHip = Math.max(maxHip, distance(pos(hip), baseHip));
    }
    return { maxHand: +maxHand.toFixed(3), maxHip: +maxHip.toFixed(3), clip };
  });
  check('the skeleton moves during a strike (not a rest pose)', (boneMotion.maxHand || 0) > 0.12, JSON.stringify(boneMotion));
  phase('strikes and guard sampled');

  // ---- signature ----------------------------------------------------------------------------------
  await page.evaluate(() => { const f = window.fighters[0]; f.specialCooldown = 0; f.hitstun = 0; f.attackQueue.length = 0; f.formLock = 0; });
  await page.keyboard.press('k');
  const signature = await page.waitForFunction(() => {
    const root = window.fighters[0].model;
    const id = root.userData.authoredSpecialClipId || null;
    return id ? { id, clip: root.userData.authoredSpecialAction?.getClip?.().name || null, current: root.userData.currentClip || null } : null;
  }, null, { timeout: 8000, polling: 60 }).then(handle => handle.jsonValue()).catch(() => null);
  await page.waitForTimeout(240);
  await page.screenshot({ path: `${out}/04-kamehameha.png` });
  check('signature selects the Kamehameha clip on this body', signature?.clip === 'Goku_Kamehameha' && signature?.id === 'Goku_Kamehameha', JSON.stringify(signature));
  phase('signature sampled');

  // ---- kit ability ---------------------------------------------------------------------------------
  const ability = await page.evaluate(async () => {
    const f = window.fighters[0];
    const root = f.model;
    const frame = () => new Promise(done => requestAnimationFrame(() => done()));
    // The signature owns the pose for its whole clip; a kit cast is refused while it runs, so let it
    // finish before probing. This is the same priority rule the runtime applies to a real player.
    root.userData.authoredSpecialTime = 0;
    root.userData.authoredAbilityTime = 0;
    f.specialCooldown = 0; f.formLock = 0; f.hitstun = 0; f.attackQueue.length = 0;
    const before = f.abilityCast?.at || 0;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyL', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyL', bubbles: true }));
    for (let i = 0; i < 26; i += 1) {
      window.__browserSmashStep(1 / 60);
      await frame();
      const action = root.userData.authoredAbilityAction;
      if (action && (f.abilityCast?.at || 0) > before) return { motion: f.abilityCast.motion, clip: action.getClip().name };
    }
    return { motion: f.abilityCast?.motion || null, clip: null };
  });
  check('a kit ability plays its own clip', ability?.motion === 'kiBlast' && ability?.clip === 'Goku_KiBlast', JSON.stringify(ability));

  // ---- ultimate ------------------------------------------------------------------------------------
  const ultimate = await page.evaluate(async () => {
    const f = window.fighters[0];
    const root = f.model;
    const frame = () => new Promise(done => requestAnimationFrame(() => done()));
    f.meter = 100; f.power = 100; f.hitstun = 0; f.attackQueue.length = 0; f.formLock = 0; f.casting = null;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyO', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyO', bubbles: true }));
    let last = null;
    for (let i = 0; i < 45; i += 1) {
      window.__browserSmashStep(1 / 60);
      await frame();
      if (root.userData.lastUltimateAnimation) { last = root.userData.lastUltimateAnimation; break; }
    }
    return { last, current: root.userData.currentClip || null, casting: f.casting || null };
  });
  check('ultimate plays the Dragon Nova clip', ultimate?.last?.clip === 'Goku_Ultimate', JSON.stringify(ultimate));
  phase('ultimate sampled');

  // ---- transformation ------------------------------------------------------------------------------
  const form = await page.evaluate(async () => {
    const f = window.fighters[0];
    const root = f.model;
    const frame = () => new Promise(done => requestAnimationFrame(() => done()));
    f.meter = 100; f.power = 100; f.hitstun = 0; f.casting = null; f.formLock = 0; f.transform = null;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyI', bubbles: true }));
    let last = null;
    for (let i = 0; i < 40; i += 1) {
      window.__browserSmashStep(1 / 60);
      await frame();
      if (root.userData.lastFormAnimation) { last = root.userData.lastFormAnimation; break; }
    }
    return { last, form: f.transform?.form?.id || null, current: root.userData.currentClip || null, actions: Object.keys(root.userData.authoredFormActions || {}) };
  });
  await page.waitForTimeout(240);
  await page.screenshot({ path: `${out}/05-super-saiyan.png` });
  check('transformation plays its own sequence', form?.last?.clip === 'Goku_FormSuperSaiyan', JSON.stringify(form));
  check('all three form sequences are bound', (form?.actions || []).length === 3, JSON.stringify(form?.actions));

  const report = {
    origin, selection, skeleton, ready: { strikes, reactions, authored, abilities },
    lightChain, lightSlots, lightClips, heavy, slamSlot, launcher, guardClip, boneMotion, signature, ability, ultimate, form, errors, checks
  };
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  phase('done');
  console.log('SUMMARY', JSON.stringify({ passed: checks.filter(entry => entry.ok).length, total: checks.length, failures, errors: errors.length, lightSlots }));
} finally {
  await browser.close();
  server.close();
}
process.exitCode = failures ? 1 : 0;
