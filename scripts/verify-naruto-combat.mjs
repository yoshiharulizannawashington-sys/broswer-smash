// Naruto combat proof through real key presses, human and CPU.
//
// The earlier checks pushed attacks straight into `attackQueue`, which proves the resolver and the
// pose layer but not that a player's input produces them. This drives the actual keyboard path
// (J = attack, Shift = run/heavy, W/S = up/down) and records the move id and motion slot that
// reached the fighter, then repeats the observation with Naruto as the CPU.
//
//   bash scripts/run-browser-test.sh scripts/verify-naruto-combat.mjs
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/animation-phase1';
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

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.stack || e).slice(0, 300)));

  const boot = async (p1, p2) => {
    await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
    await page.evaluate(({ p1, p2 }) => {
      window.__browserSmashTrainingDummy = true;
      window.__browserSmashSelect?.chooseArena('valley');
      window.__browserSmashSelect?.select('p1', p1);
      window.__browserSmashSelect?.select('p2', p2);
      document.querySelector('#play').click();
    }, { p1, p2 });
    await page.evaluate(() => window.__browserSmashSkipCinematic?.());
    await page.evaluate(() => {
      window.__browserSmashFreezeAI = true;
      const f = window.fighters[0], c = window.fighters[1];
      f.position.set(0, .6, 0); f.facing = 1; f.facingZ = 0;
      c.position.set(1.6, .6, 0);
    });
    await page.locator('canvas').first().click({ position: { x: 220, y: 170 }, force: true });
    await page.waitForTimeout(500);
  };

  const observe = () => page.evaluate(() => {
    window.__browserSmashAttackTick?.();
    const f = window.fighters[0];
    const a = f.attackQueue?.[f.attackQueue.length - 1] || null;
    const report = window.__browserSmashAttackMotion?.()?.p1 || null;
    return { id: a?.id || null, kind: a?.kind || null, pose: report?.pose || null, set: report?.set || null };
  });

  // Hold state (run/up/down) is polled once per frame, and the attack is edge-buffered for 9 frames.
  // Releasing a modifier before a frame renders meant the game never saw it: every "heavy" arrived
  // as a plain light punch. These helpers drive the real loop instead of a manual step.
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const waitForAttack = async (timeout = 9000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const seen = await observe();
      if (seen.id) return seen;
      await page.waitForTimeout(150);
    }
    return null;
  };
  const waitForIdle = async (timeout = 9000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if ((await observe()).id === null) return true;
      await page.waitForTimeout(150);
    }
    return false;
  };
  const holdKeys = async keys => { for (const key of keys) await page.keyboard.down(key); await frame(); };
  const releaseKeys = async keys => { for (const key of keys) await page.keyboard.up(key); };

  // ---------------------------------------------------------------- human-controlled Naruto
  await boot('Naruto Uzumaki', 'Thor');
  // Key delivery, proven without attacks: movement only happens if the held key reaches the game.
  const startPos = await page.evaluate(() => ({ x: +window.fighters[0].position.x.toFixed(3), z: +window.fighters[0].position.z.toFixed(3) }));
  await holdKeys(['w']);
  await page.waitForTimeout(500);
  await frame();
  const movedTo = await page.evaluate(() => ({ x: +window.fighters[0].position.x.toFixed(3), z: +window.fighters[0].position.z.toFixed(3) }));
  await releaseKeys(['w']);
  const travelled = Math.hypot(movedTo.x - startPos.x, movedTo.z - startPos.z);
  check('holding W moves the fighter (key delivery reaches the game)', travelled > 0.05, `travelled ${travelled.toFixed(3)} m`);

  const chain = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.down('j');
    const seen = await waitForAttack();
    chain.push(seen || await observe());
    await page.keyboard.up('j');
    await waitForIdle();
  }
  console.log('CHAIN', JSON.stringify(chain));
  const chainIds = chain.map(entry => entry.id);
  check('a real J-press chain runs five attacks',
    chainIds.every(Boolean) && new Set(chainIds).size >= 4, chainIds.join(' → '));
  check('each chain attack reports a motion slot',
    chain.every(entry => entry.pose) && new Set(chain.map(entry => entry.pose)).size >= 4,
    chain.map(entry => entry.pose).join(' → '));
  check('Naruto uses his own motion set on the input path',
    chain.every(entry => entry.set === 'naruto'), chain[0]?.set || 'none');

  const heavies = [];
  for (const [keys, label] of [[['Shift'], 'heavy'], [['Shift', 'w'], 'launcher'], [['Shift', 's'], 'slam']]) {
    await page.evaluate(() => {
      const f = window.fighters[0];
      f.comboStep = 0; f.comboWindow = 0; f.attackQueue.length = 0;
    });
    await waitForIdle();
    await holdKeys(keys);
    await page.keyboard.down('j');
    const seen = await waitForAttack(9000);
    await page.keyboard.up('j');
    await releaseKeys(keys);
    heavies.push({ label, ...(seen || await observe()) });
    // Capture the strike while it is live: this is the keyboard path, not a harness pose.
    await page.evaluate(() => window.smashCamera?.spectate?.({ fighter: window.fighters[0], framing: 'full', yaw: 28, pitch: 8 }));
    await page.waitForTimeout(350);
    await page.screenshot({ path: `artifacts/compare/animation-phase1/keyboard-${label}.png` });
    await page.evaluate(() => window.smashCamera?.endSpectate?.());
    console.log('SHOT', `artifacts/compare/animation-phase1/keyboard-${label}.png`);
    await waitForIdle(9000);
  }
  console.log('HEAVIES', JSON.stringify(heavies));
  check('Shift+J produces the heavy strike', heavies[0].id === 'heavy', String(heavies[0].id));
  check('Shift+W+J produces the launcher', heavies[1].id === 'heavyLauncher', String(heavies[1].id));
  check('Shift+S+J produces the ground slam', heavies[2].id === 'heavySlam', String(heavies[2].id));
  check('the three heavies play three different motion slots',
    new Set(heavies.map(entry => entry.pose)).size === 3, heavies.map(entry => entry.pose).join(', '));

  // ---------------------------------------------------------------- other real inputs
  const readState = () => page.evaluate(() => {
    const f = window.fighters[0];
    const report = window.__browserSmashAttackMotion?.()?.p1 || null;
    const controller = f.model.userData.animationController || null;
    return {
      queued: f.attackQueue?.[f.attackQueue.length - 1]?.id || null,
      pose: report?.pose || null,
      clip: controller ? controller.describe().active : null,
      jumping: !f.isGrounded,
      guard: Boolean(f.guardHeld),
      dodgeTimer: +(f.dodgeTimer || 0).toFixed(2),
      specialCooldown: +(f.specialCooldown || 0).toFixed(2)
    };
  });

  await page.evaluate(() => { const f = window.fighters[0]; f.comboStep = 0; f.comboWindow = 0; f.attackQueue.length = 0; });
  await waitForIdle();
  const beforeK = await readState();
  await page.keyboard.down('k');
  // The observable is the move announcing itself, not `specialCooldown`: the main loop clears that
  // field every frame, so a probe that reads it later always measured 0 and reported a false failure.
  const signatureSeen = await page.waitForFunction(() => {
    const f = window.fighters[0];
    const announced = String(document.body.innerText || '').includes('RASENSHURIKEN');
    const posed = (window.__browserSmashAttackMotion?.()?.p1?.pose || '') === 'special';
    const wound = (f.attackPose || 0) >= 0.65 || (f.specialCooldown || 0) > 0;
    return announced || posed || wound;
  }, null, { timeout: 8000, polling: 100 }).then(() => true).catch(() => false);
  await page.keyboard.up('k');
  const afterK = await page.evaluate(() => ({
    ...window.__browserSmashAttackMotion?.()?.p1,
    callout: (String(document.body.innerText || '').match(/RASENSHURIKEN/) || [])[0] || null,
    attackPose: +(window.fighters[0].attackPose || 0).toFixed(2)
  }));
  check('K fires the signature move through the input path', signatureSeen, JSON.stringify(afterK));
  console.log('SPECIAL', JSON.stringify(afterK));

  // Jump: Space must leave the ground.
  await waitForIdle();
  await page.keyboard.down('Space');
  await page.waitForTimeout(350);
  await page.keyboard.up('Space');
  const airborne = await page.evaluate(() => !window.fighters[0].isGrounded || (window.fighters[0].velocity?.y || 0) > 0.5);
  check('Space lifts the fighter off the ground', airborne, String(airborne));

  // Shift: the sprint/dodge input must be seen by the game while held.
  await page.waitForTimeout(700);
  await holdKeys(['Shift']);
  const shiftState = await page.evaluate(() => {
    const f = window.fighters[0];
    return { dodgeTimer: +(f.dodgeTimer || 0).toFixed(2), speed: +Math.hypot(f.velocity?.x || 0, f.velocity?.z || 0).toFixed(2) };
  });
  await releaseKeys(['Shift']);
  check('Shift is delivered while held (dodge or sprint response)', shiftState.dodgeTimer > 0 || shiftState.speed > 0.5, JSON.stringify(shiftState));

  // Cancellation: an attack interrupted by a hit must not leave the body locked mid-pose.
  await waitForIdle();
  await page.evaluate(() => {
    const f = window.fighters[0];
    f.attackQueue.length = 0;
    f.attackQueue.push({ id: 'heavy', kind: 'heavy', t: 0.1, total: 0.4, start: 0.04, end: 0.22, duration: 0.4 });
    window.__browserSmashAttackTick?.();
    f.hitstun = 0.45;
  });
  await page.waitForTimeout(600);
  const cancelled = await readState();
  console.log('CANCEL (diagnostic, synthetic queue - not an assertion)', JSON.stringify(cancelled));

  // Repeated attacks must not accumulate offsets.
  await page.evaluate(() => { window.fighters[0].hitstun = 0; });
  await waitForIdle();
  const firstRead = await page.evaluate(() => {
    const f = window.fighters[0];
    const grab = key => f.model.userData[key]?.rotation?.toArray().slice(0, 3).map(v => +v.toFixed(3)) || null;
    return { torso: grab('torso'), rightArm: grab('rightArm'), pelvis: grab('pelvis') };
  });
  for (let i = 0; i < 6; i++) {
    await page.keyboard.down('j');
    await waitForAttack(6000).catch(() => null);
    await page.keyboard.up('j');
    await waitForIdle(6000);
  }
  const lastRead = await page.evaluate(() => {
    const f = window.fighters[0];
    const grab = key => f.model.userData[key]?.rotation?.toArray().slice(0, 3).map(v => +v.toFixed(3)) || null;
    return { torso: grab('torso'), rightArm: grab('rightArm'), pelvis: grab('pelvis') };
  });
  const drift = Math.max(...['torso', 'rightArm', 'pelvis'].map(key => Math.abs((firstRead[key]?.[0] ?? 0) - (lastRead[key]?.[0] ?? 0))));
  console.log('REPEAT (diagnostic)', JSON.stringify({ drift: +drift.toFixed(3), afterSixAttacks: lastRead }));

  // Recovery: after the moves finish the body must return to a locomotion pose, not stay locked.
  await page.evaluate(() => window.__browserSmashStep?.(1.2));
  const recovered = await observe();
  check('the body leaves the attack and returns to locomotion idle',
    recovered.id === null && recovered.pose === null, JSON.stringify(recovered));

  // ---------------------------------------------------------------- CPU-controlled Naruto
  await boot('Thor', 'Naruto Uzumaki');
  // The dummy flag and the AI freeze both stop the CPU from ever attacking, so previous runs
  // reported "0 observed" for a reason that had nothing to do with animation.
  await page.evaluate(() => {
    window.__browserSmashTrainingDummy = false;
    window.__browserSmashFreezeAI = false;
  });

  // Sample the move id, the pose the overlay applied and the controller's active clip in ONE
  // evaluation per animation frame. The previous version read the attack queue and the motion report
  // in separate round trips, so an id belonging to a new attack could be paired with the pose still
  // playing from the previous one - which is exactly how "light2 attack, light1 pose" happened.
  const SLOT_FOR_MOVE = {
    light1: 'light1', light2: 'light2', light3: 'light3', light4: 'light4', light5: 'light5',
    finisher: 'light5', heavy: 'heavy', heavyLauncher: 'heavyLauncher', heavySlam: 'heavySlam'
  };
  // Sampled on RENDERED frames, not through __browserSmashStep: the deterministic step advances
  // gameplay but not the animation overlay for the CPU, so stepping froze its pose at whatever the
  // last rendered frame had applied (always light1) and measured the harness rather than the game.
  const samples = await page.evaluate(async ms => {
    const out = [];
    const end = performance.now() + ms;
    return await new Promise(resolve => {
      const tick = () => {
        const cpu = window.fighters[1];
        const attack = cpu?.attackQueue?.[0] || null;
        const report = window.__browserSmashAttackMotion?.()?.p2 || null;
        out.push({ at: Math.round(performance.now()), id: attack?.id || null, pose: report?.pose || null, set: report?.set || null });
        if (performance.now() < end) requestAnimationFrame(tick);
        else resolve(out);
      };
      requestAnimationFrame(tick);
    });
  }, 30000);

  const runs = [];
  for (const sample of samples) {
    const current = runs[runs.length - 1];
    if (current && current.id === sample.id) {
      current.poses.add(sample.pose);
      current.sets.add(sample.set);
      current.frames++;
    } else {
      runs.push({ id: sample.id, poses: new Set([sample.pose]), sets: new Set([sample.set]), frames: 1 });
    }
  }
  const attacks = runs.filter(run => run.id);
  // The pose layer's own table (anim/attack_animator.js MOVE_MOTION), restated here so the test can
  // say what each move should look like instead of only recording what it saw.
  const MOVE_MOTION = {
    light1: 'light1', light2: 'light2', light3: 'light3', light4: 'light4', finisher: 'light5',
    heavy: 'heavy', heavyLauncher: 'heavyLauncher', heavySlam: 'heavySlam',
    antiAir: 'heavyLauncher', dive: 'light4', air: 'light3', airFinisher: 'light5'
  };
  const summary = attacks.map(run => ({
    id: run.id,
    expected: MOVE_MOTION[run.id] || null,
    poses: [...run.poses].filter(Boolean),
    frames: run.frames
  }));
  console.log('CPU', JSON.stringify(summary));
  // A one-frame window can legitimately still be showing the previous pose, so the rule is: the
  // move must show its own pose in at least one window where it was current. A move that never does
  // is a real mapping bug, which is exactly what the earlier "light2 / light1" line was suspected of.
  const byMove = new Map();
  for (const entry of summary) {
    const record = byMove.get(entry.id) || { windows: 0, sawOwnPose: 0, poses: new Set() };
    record.windows++;
    for (const pose of entry.poses) record.poses.add(pose);
    if (entry.expected && entry.poses.includes(entry.expected)) record.sawOwnPose++;
    byMove.set(entry.id, record);
  }
  const table = [...byMove.entries()].map(([id, record]) => ({ id, expected: MOVE_MOTION[id] || null, windows: record.windows, sawOwnPose: record.sawOwnPose, poses: [...record.poses] }));
  console.log('CPU_MAP', JSON.stringify(table));
  check('CPU Naruto throws attacks through the same animation path', attacks.length > 0, `${attacks.length} attack windows`);
  check('every CPU move shows its own motion pose at least once', table.length > 0 && table.every(entry => entry.sawOwnPose > 0),
    table.map(entry => `${entry.id}→${entry.poses.join('/') || 'none'} (${entry.sawOwnPose}/${entry.windows})`).join(' '));
  check('CPU motion poses differ between moves', new Set(table.flatMap(entry => entry.poses)).size >= 3,
    table.map(entry => entry.poses.join('/')).join(' '));
  check('CPU attacks resolve more than one distinct move', byMove.size >= 2, [...byMove.keys()].join(', '));
  check('CPU Naruto uses its own motion set',
    attacks.every(run => [...run.sets].every(value => value === null || value === 'naruto')),
    [...new Set(attacks.flatMap(run => [...run.sets]))].join(', ') || 'none');

  check('no page errors during the combat run', errors.length === 0, errors.slice(0, 2).join(' | '));
  console.log(failures === 0 ? '\nNaruto combat verification passed.' : `\nNaruto combat verification FAILED (${failures}).`);
} finally {
  await browser?.close();
  server.close();
}
process.exitCode = failures === 0 ? 0 : 1;
