// Goku kit acceptance: deterministic motion-slot checks plus a real cinematic check.
//
// Why this shape:
//   · Under SwiftShader the render loop advances a handful of frames per second, so a chain driven
//     by wall-clock waits never progresses. The simulation is stepped explicitly instead, which is
//     the clock the attack overlay actually reads.
//   · `attack` is an edge-buffered input while `run` (SHIFT) and DOWN are held keys, and the heavy
//     variants only resolve on the ground. Node-side key presses left the fighter's grounding to
//     whatever the live loop happened to do between round trips, which intermittently resolved a
//     heavy as an air move. Every segment therefore runs in ONE evaluate: settle to the ground,
//     latch the modifiers, press attack, step, read the pose.
//   · The cinematic camera does not advance in the stepper, so the ultimate is checked on rendered
//     frames via page.waitForFunction.
//   · The signature is KeyK (the HUD always reads "READY · KAMEHAMEHA", so the old probe "proved" a
//     cast from text and pressed KeyO, the ultimate, in that segment).
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/goku';
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
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;

let failures = 0;
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); if (!ok) failures++; console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`); };
const started = Date.now();
const phase = label => console.log('PHASE', label, ((Date.now() - started) / 1000).toFixed(1) + 's');

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));

  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
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
  await page.evaluate(() => document.querySelector('#play')?.click());
  await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
  await page.waitForTimeout(1200);
  phase('match ready');

  // One pass = the five-hit light chain and the three heavies, all in one evaluate so the live loop
  // cannot interleave a frame between "set up the fighter" and "press the button".
  const kitPass = () => page.evaluate(() => {
    const f = window.fighters[0];
    const press = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    const step = () => { window.__browserSmashStep(1 / 60); window.__browserSmashAttackTick?.(); };
    const release = () => ['KeyJ', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyK', 'KeyO', 'ShiftLeft', 'Space'].forEach(code => press('keyup', code));
    // Stand the fighter on the floor and let the sim confirm it. Grounding is never forced: a stale
    // `isGrounded` is exactly what turned heavies into air moves.
    const clean = () => {
      release();
      f.attackQueue.length = 0;
      f.attackPose = 0; f.attackBuffer = 0; f.comboStep = 0; f.comboWindow = 0; f.comboHitCount = 0;
      f.hitstun = 0; f.guardBreak = 0; f.casting = false; f.specialCooldown = 0; f.formLock = 0;
      f.activeMoveId = null;
      f.position.set(0, 0, 0); f.velocity?.set?.(0, 0, 0);
      for (let i = 0; i < 90; i += 1) { step(); if (f.isGrounded && Math.abs(f.velocity?.y || 0) < 0.01) break; }
      return Boolean(f.isGrounded);
    };
    // Light chain: every link must reach a slot distinct from the one already showing.
    const chain = [];
    clean();
    for (let link = 0; link < 5; link += 1) {
      const before = f.attackMotionPose || null;
      press('keydown', 'KeyJ');
      press('keyup', 'KeyJ');
      let slot = null;
      for (let i = 0; i < 26; i += 1) {
        step();
        if (f.attackMotionPose && f.attackMotionPose !== before) { slot = f.attackMotionPose; break; }
      }
      chain.push({ link: link + 1, slot });
    }
    // Heavies: SHIFT and attack on the SAME frame. Giving SHIFT a frame of its own lets
    // `dodge: buffer.take(map.sprint)` consume the SHIFT keydown first, which dashes the fighter
    // off the ground and turns the heavy into an air move - the exact defect this segment hit.
    const segment = codes => {
      const grounded = clean();
      codes.forEach(code => press('keydown', code));
      press('keydown', 'KeyJ');
      const slots = new Set(), moves = new Set();
      for (let i = 0; i < 26; i += 1) {
        step();
        if (f.attackMotionPose) slots.add(f.attackMotionPose);
        if (f.activeMoveId) moves.add(f.activeMoveId);
      }
      codes.forEach(code => press('keyup', code));
      press('keyup', 'KeyJ');
      return { slots: [...slots], moves: [...moves], grounded };
    };
    const heavy = segment(['ShiftLeft']);
    const launcher = segment(['ShiftLeft', 'KeyW']);
    const slam = segment(['ShiftLeft', 'KeyS']);
    clean();
    return { chain, heavy, launcher, slam };
  });

  const pass1 = await kitPass();
  phase('pass1 done');
  const pass2 = await kitPass();
  phase('pass2 done');

  // Signature: KeyK. The cast is confirmed by the cooldown the game itself sets (and the pose it
  // applies), not by HUD text, then the bones are sampled while the cast pose is active.
  const kame = await (async () => {
    await page.evaluate(() => {
      const f = window.fighters[0];
      f.attackQueue.length = 0; f.attackPose = 0; f.specialCooldown = 0; f.hitstun = 0; f.formLock = 0;
    });
    const rest = await page.evaluate(() => ['leftArm', 'rightArm', 'leftFore', 'rightFore', 'torso']
      .map(name => window.fighters[0].model?.userData?.[name]?.quaternion?.toArray?.() || null));
    await page.keyboard.down('k');
    await page.waitForFunction(() => (window.fighters[0].specialCooldown || 0) > 0, null, { timeout: 5000, polling: 40 }).catch(() => null);
    const sample = await page.evaluate(base => {
      const f = window.fighters[0];
      const joints = ['leftArm', 'rightArm', 'leftFore', 'rightFore', 'torso'];
      let posed = 0, peak = 0, cooldownSeen = 0, poseSeen = null;
      for (let i = 0; i < 30; i += 1) {
        window.__browserSmashStep(1 / 60);
        window.__browserSmashAttackTick?.();
        cooldownSeen = Math.max(cooldownSeen, f.specialCooldown || 0);
        if (f.attackMotionPose) poseSeen = f.attackMotionPose;
        joints.forEach((name, index) => {
          const quaternion = f.model?.userData?.[name]?.quaternion;
          const before = base[index];
          if (!quaternion || !before) return;
          const delta = Math.max(Math.abs(quaternion.x - before[0]), Math.abs(quaternion.y - before[1]), Math.abs(quaternion.z - before[2]));
          peak = Math.max(peak, delta);
          if (delta > 0.06) posed += 1;
        });
      }
      return { posed, peak: +peak.toFixed(3), cooldownSeen: +cooldownSeen.toFixed(2), poseSeen };
    }, rest);
    await page.keyboard.up('k');
    return sample;
  })();
  phase('signature done');

  // Ultimate: real rendered frames, because the cinematic camera only advances there.
  await page.evaluate(() => { const f = window.fighters[0]; f.attackQueue.length = 0; f.meter = 100; f.specialCooldown = 0; });
  const ultRest = await page.evaluate(() => ['torso', 'rightArm', 'leftArm', 'rightFore']
    .map(name => window.fighters[0].model?.userData?.[name]?.quaternion?.toArray?.() || null));
  await page.keyboard.down('o');
  await page.waitForFunction(() => Boolean(window.smashCamera?.describeCineShot?.().active), null, { timeout: 9000, polling: 40 }).catch(() => null);
  const beats = new Set();
  let source = null, peak = 0, cineSeen = false;
  const end = Date.now() + 3500;
  while (Date.now() < end) {
    const sample = await page.evaluate(base => {
      const shot = window.smashCamera?.describeCineShot?.();
      const joints = ['torso', 'rightArm', 'leftArm', 'rightFore']
        .map(name => window.fighters[0].model?.userData?.[name]?.quaternion?.toArray?.() || null);
      let localPeak = 0;
      joints.forEach((quaternion, index) => {
        const before = base[index];
        if (!quaternion || !before) return;
        localPeak = Math.max(localPeak, Math.max(...quaternion.map((value, axis) => Math.abs(value - before[axis]))));
      });
      return { active: Boolean(shot?.active), beat: shot?.beat ?? null, source: window.__browserSmashCinematicPoseSource || null, peak: localPeak };
    }, ultRest);
    if (sample.active) cineSeen = true;
    if (sample.active && sample.beat) beats.add(sample.beat);
    source = sample.source || source;
    peak = Math.max(peak, sample.peak);
    await page.waitForTimeout(50);
  }
  await page.keyboard.up('o');
  const ult = { sawCine: cineSeen, source, peak: +peak.toFixed(3), beats: [...beats] };
  phase('ultimate done');
  await page.screenshot({ path: `${out}/10-goku-kit-isolated.png` });

  const lights = pass1.chain.map(entry => entry.slot).filter(Boolean);
  for (let index = 1; index <= 5; index += 1) {
    check(`light${index} reaches its authored slot`, lights.includes(`light${index}`), `expected light${index}, observed [${lights.join(',') || 'none'}]`);
  }
  check('heavy resolves from run + attack', pass1.heavy.slots.includes('heavy'), JSON.stringify(pass1.heavy));
  check('launcher resolves from up + run + attack', pass1.launcher.slots.includes('heavyLauncher'), JSON.stringify(pass1.launcher));
  check('slam resolves from down + run + attack', pass1.slam.slots.includes('heavySlam'), JSON.stringify(pass1.slam));
  check('the signature cast poses the body', kame.posed > 0 && kame.cooldownSeen > 0, JSON.stringify(kame));
  for (const name of ['heavy', 'launcher', 'slam']) {
    const first = pass1[name].slots.join(','), second = pass2[name].slots.join(',');
    check(`${name} repeats from a clean state`, first === second && first.length > 0, `pass1=${first || '(none)'} pass2=${second || '(none)'}`);
  }
  check('light chain repeats',
    pass1.chain.map(entry => entry.slot).join(',') === pass2.chain.map(entry => entry.slot).join(','),
    `pass1=[${pass1.chain.map(entry => entry.slot).join(',')}] pass2=[${pass2.chain.map(entry => entry.slot).join(',')}]`);
  check('ultimate runs its cinematic sequence on authored motion',
    ult.sawCine && ult.source === 'authored-set' && ult.peak > 0.05,
    JSON.stringify({ expected: { cine: true, source: 'authored-set', peak: '>0.05' }, observed: ult }));

  const form = await page.evaluate(async () => {
    const mod = await import('/js/combat/transformation.js');
    const f = window.fighters[0];
    if (f.transform) mod.endTransform(f, 'expired');
    f.power = 100; f.transformCooldown = 0; f.hitstun = 0;
    const ready = mod.canTransform(f);
    const began = mod.beginTransform(f);
    const state = { label: f.transform?.label, defense: f.incomingDamage, speed: f.transformMods?.speed, aura: Boolean(f.aura || f.transform?.aura) };
    for (let i = 0; i < 20; i += 1) window.__browserSmashStep(0.05);
    const midway = { time: f.transform?.time, power: f.power };
    let ended = null;
    for (let i = 0; i < 140; i += 1) {
      window.__browserSmashStep(0.1);
      if (!f.transform) { ended = { defense: f.incomingDamage, cooldown: f.transformCooldown, stage: f.formStage }; break; }
    }
    return { ready, began, state, midway, ended };
  });
  check('Kaio-ken activates, drains, ends and restores',
    form.began?.ok && form.state.defense !== 1 && form.midway.time < 8 && form.ended?.defense === 1 && form.ended.cooldown > 0,
    JSON.stringify(form));

  await writeFile(`${out}/kit-isolated-report.json`, JSON.stringify({ checks, pass1, pass2, kame, ult, form, errors }, null, 2));
  console.log('SUMMARY', JSON.stringify({
    passed: checks.filter(entry => entry.ok).length,
    total: checks.length,
    lights: pass1.chain.map(entry => entry.slot),
    heavies: { heavy: pass1.heavy.slots, launcher: pass1.launcher.slots, slam: pass1.slam.slots },
    kame,
    ult,
    failures: checks.filter(entry => !entry.ok).map(entry => `${entry.name}: ${entry.detail}`),
    errors: errors.length
  }));
} finally {
  await browser.close();
  server.close();
}
console.log(failures === 0 ? '\nGoku kit probe passed.' : `\nGoku kit probe FAILED (${failures}).`);
process.exitCode = failures === 0 ? 0 : 1;
