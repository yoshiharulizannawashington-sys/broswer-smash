// Live acceptance for the remaining imported-character migrations.
//
// Each target is selected through the real character-select path, mounted in a real match, and
// driven with keyboard input. The harness records damage, hit reactions, the signature move, the
// equipped prop and screenshots. It then plays every baked action on the mounted mixer and records
// how many bones actually move, so a body cannot pass on clip count alone.
//
//   bash scripts/run-browser-test.sh scripts/verify-imported-migrations.mjs
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import { HARDWARE_GPU, assertHardwareGpu, browserLaunchOptions, captureGpu, isSoftwareRenderer } from './lib/hardware-gpu.mjs';

const root = process.cwd();
const out = resolve(root, 'artifacts/imported-migrations');
await mkdir(out, { recursive: true });

const TARGETS = [
  {
    key: 'vegeta', stable: 'Vegeta', display: 'Vegeta', slug: 'vegeta',
    special: 'GALICK GUN', weapon: 'unarmed'
  },
  {
    key: 'light', stable: 'L (Death Note Style)', display: 'Light Yagami', slug: 'l_death_note_style',
    special: 'NAME IN THE NOTEBOOK', weapon: 'book'
  },
  {
    key: 'harry', stable: 'Lord Voldemort', display: 'Harry Potter', slug: 'lord_voldemort',
    special: 'EXPECTO PATRONUM', weapon: 'wand'
  },
  {
    key: 't800', stable: 'Arnold Schwarzenegger', display: 'T-800', slug: 'arnold_schwarzenegger',
    special: 'CYBERNETIC CANNON', weapon: 'shotgun'
  }
];

const ONLY = (process.env.MIGRATION_ONLY || '').split(',').map(part => part.trim()).filter(Boolean);
const selectedTargets = ONLY.length ? TARGETS.filter(target => ONLY.includes(target.key) || ONLY.includes(target.slug)) : TARGETS;
if (!selectedTargets.length) throw new Error('MIGRATION_ONLY selected no targets: ' + ONLY.join(','));

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.hdr': 'application/octet-stream', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav'
};

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
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const bytes = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end('not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
};

let browser;
try {
  browser = await chromium.launch(browserLaunchOptions());
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.setDefaultTimeout(180_000);
  const errors = [];
  const failedRequests = [];
  page.on('pageerror', error => errors.push(String(error.message || error).slice(0, 260)));
  page.on('console', message => {
    if (message.type() === 'error') errors.push('console: ' + message.text().slice(0, 220));
  });
  page.on('response', response => {
    if (response.status() >= 400) failedRequests.push(response.status() + ' ' + response.url().slice(-110));
  });
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try {
      await route.fulfill({
        status: 200,
        contentType: 'text/javascript; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: await readFile(localPath)
      });
    } catch {
      await route.fulfill({ status: 404, body: 'missing' });
    }
  });

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashStep && window.fighters?.length === 2,
  null, { timeout: 150_000, polling: 250 });
  const gpu = await captureGpu(page);
  const softwareRenderer = isSoftwareRenderer(gpu);
  console.log('GPU ' + JSON.stringify({ ...gpu, softwareRenderer }));
  if (HARDWARE_GPU) assertHardwareGpu(gpu, 'Imported migration hardware acceptance');

  const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);

  const startMatch = async target => {
    await page.evaluate(({ stable }) => {
      window.__browserSmashLastResult = null;
      const select = window.__browserSmashSelect;
      select.setMode('1p');
      select.setRules({ roundsToWin: 1, roundSeconds: 60 });
      select.select('p1', stable);
      select.select('p2', 'Goku');
      select.chooseArena('tournament');
      window.__browserSmashFreezeAI = true;
      window.__browserSmashGame.startMatch();
      window.__browserSmashStep(0.2);
    }, { stable: target.stable });
    await page.waitForFunction(({ stable, slug, display }) => {
      const [p1, p2] = window.fighters || [];
      return p1?.identity === stable && p1?.name === display && p1?.characterModelLoaded === true
        && p2?.identity === 'Goku'
        && window.__browserSmashAssets?.characterModels?.[slug]?.status === 'loaded'
        && window.__browserSmashControlMode?.().started === true;
    }, target, { timeout: 180_000, polling: 250 });
    await page.evaluate(() => {
      window.__browserSmashFreezeAI = true;
      window.__browserSmashSkipCinematic?.();
      window.__browserSmashStep(0.6);
    });
    await page.waitForFunction(() => window.__browserSmashPresentation?.report?.().intro?.active === false,
      null, { timeout: 20_000, polling: 200 }).catch(() => {});
  };

  const reset = distance => page.evaluate(({ distance }) => {
    const [p1, p2] = window.fighters;
    const ground = p1.groundLevel ?? 0;
    window.combatPowers?.clear?.('migration-test');
    window.__browserSmashTraining?.resetPositions?.();
    window.__browserSmashLastImpact = null;
    window.__browserSmashLastShot = null;
    p1.position.set(-distance / 2, ground, 0); p1.velocity.set(0, 0, 0);
    p2.position.set(distance / 2, ground, 0); p2.velocity.set(0, 0, 0);
    for (const fighter of [p1, p2]) {
      fighter.velocity.set(0, 0, 0); fighter.isGrounded = true; fighter.hitstun = 0;
      fighter.guardBreak = 0; fighter.guardHeld = false; fighter.attackQueue.length = 0;
      fighter.attackPose = 0; fighter.hitboxes.length = 0; fighter.dodgeTimer = 0;
      fighter.transform = null; fighter.formLock = 0; fighter.transformCooldown = 0;
      fighter.casting = null; fighter.ko = false; fighter.flightMode = false;
      fighter.attackBuffer = 0; fighter.comboStep = 0; fighter.activeMoveId = null;
      if (fighter.model?.userData) fighter.model.userData.attackLock = 0;
    }
    p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
    p1.percent = 0; p1.meter = 100; p1.power = 100; p1.specialCooldown = 0;
    p1.abilityReadyAt = {};
    p2.percent = 0; p2.invulnerable = 0; p2.shield = 100; p2.hitstun = 0;
    const c = p1.animationController;
    if (c) { c._lock = null; c._downState = false; c._getUpTimer = 0; c._landTimer = 0; c._airTime = 0; }
    window.__browserSmashStep(0.22);
  }, { distance });

  const advance = seconds => page.evaluate(seconds => {
    const [p1, p2] = window.fighters;
    const seen = [];
    let active = null;
    let clip = null;
    let last = null;
    let maxPercent = p2.percent;
    let maxHitstun = 0;
    const userData = p1.model?.userData || {};
    const steps = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < steps; i += 1) {
      window.__browserSmashStep(1 / 60);
      const controller = p1.animationController;
      const current = controller?._active || userData.currentClip
        || userData.lastMoveAction?.getClip?.()?.name || null;
      if (current && current !== last) {
        last = current;
        seen.push(current);
      }
      active = current || active;
      clip = userData.currentClip || controller?._action?.getClip?.()?.name || clip;
      maxPercent = Math.max(maxPercent, p2.percent || 0);
      maxHitstun = Math.max(maxHitstun, p1.hitstun || 0);
    }
    return {
      active, clip, seen,
      name: p1.name, identity: p1.identity,
      specialLabel: p1.specialProfile?.label || null,
      weaponKind: p1.model?.userData?.weaponKind || null,
      equippedWeapons: ['equippedWeaponRight', 'equippedWeaponLeft']
        .filter(key => p1.model?.userData?.[key]).map(key => p1.model.userData[key].name),
      attacks: p1.model?.userData?.animationActions
        ? Object.keys(p1.model.userData.animationActions).length : 0,
      p1percent: +(p1.percent || 0).toFixed(1),
      p2percent: +(p2.percent || 0).toFixed(1),
      maxPercent: +maxPercent.toFixed(1),
      p2hitstun: +(p2.hitstun || 0).toFixed(2),
      maxHitstun: +maxHitstun.toFixed(2),
      grounded: Boolean(p1.isGrounded),
      specialCast: p1.specialCast || null,
      specialCooldown: +(p1.specialCooldown || 0).toFixed(2),
      casting: p1.casting || null,
      lastShot: window.__browserSmashLastShot || null
    };
  }, seconds);

  const capture = async (target, name, trace) => {
    await page.evaluate(() => window.__browserSmashSetPaused?.(true));
    await page.waitForTimeout(90);
    await page.screenshot({ path: resolve(out, target.key, name + '.png') });
    await page.evaluate(() => window.__browserSmashSetPaused?.(false));
    if (trace) {
      await writeFile(resolve(out, target.key, 'evidence-' + name + '.json'), JSON.stringify(trace, null, 1) + '\n');
    }
  };

  const clipMatrix = async () => {
    await page.evaluate(() => window.__browserSmashSetPaused?.(true));
    const rows = await page.evaluate(() => {
      const p1 = window.fighters[0];
      const root = p1.model;
      const userData = root?.userData;
      const mixer = userData?.humanMixer;
      const actions = userData?.animationActions;
      if (!mixer || !actions) return { error: 'no mounted mixer' };
      const bones = [];
      root.traverse(node => { if (node.isBone) bones.push(node); });
      mixer.stopAllAction();
      if (actions.idle) {
        actions.idle.reset();
        actions.idle.setLoop(window.__browserSmashThree.LoopRepeat, Infinity);
        actions.idle.play();
        mixer.setTime(0.1);
      }
      root.updateMatrixWorld(true);
      const base = new Map(bones.map(bone => [bone, bone.quaternion.clone()]));
      const result = [];
      for (const [name, action] of Object.entries(actions)) {
        const clip = action.getClip();
        mixer.stopAllAction();
        action.reset();
        action.setLoop(window.__browserSmashThree.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.setEffectiveWeight(1);
        action.play();
        mixer.setTime(Math.min(0.34, Math.max(0.04, clip.duration * 0.45)));
        root.updateMatrixWorld(true);
        let moved = 0;
        let angle = 0;
        for (const bone of bones) {
          const delta = base.get(bone).angleTo(bone.quaternion);
          if (delta > 0.01) moved += 1;
          angle = Math.max(angle, delta);
        }
        result.push({
          name,
          duration: +clip.duration.toFixed(3),
          tracks: clip.tracks.length,
          movedBones: moved,
          maxAngleDeg: +(angle * 180 / Math.PI).toFixed(1)
        });
        action.stop();
      }
      mixer.stopAllAction();
      const idle = actions.idle;
      if (idle) { idle.reset(); idle.setLoop(window.__browserSmashThree.LoopRepeat, Infinity); idle.play(); }
      mixer.setTime(0.08);
      return { bones: bones.length, clips: result };
    });
    await page.evaluate(() => window.__browserSmashSetPaused?.(false));
    return rows;
  };

  const results = [];
  for (const target of selectedTargets) {
    console.log(`\n=== ${target.display} (${target.stable}) ===`);
    await mkdir(resolve(out, target.key), { recursive: true });
    await startMatch(target);

    const mount = await page.evaluate(({ slug }) => {
      const p1 = window.fighters[0];
      const asset = window.__browserSmashAssets?.characterModels?.[slug] || null;
      return {
        name: p1.name,
        identity: p1.identity,
        loaded: p1.characterModelLoaded,
        asset,
        animationCount: Object.keys(p1.model?.userData?.animationActions || {}).length,
        mixer: Boolean(p1.model?.userData?.humanMixer),
        weaponKind: p1.model?.userData?.weaponKind || null,
        weaponLabel: p1.model?.userData?.weaponLabel || null,
        equippedWeapons: ['equippedWeaponRight', 'equippedWeaponLeft']
          .filter(key => p1.model?.userData?.[key]).map(key => p1.model.userData[key].name),
        specialLabel: p1.specialProfile?.label || null,
        moveset: p1.moveset?.key || null,
        height: +(p1.height || 0).toFixed(2),
        hudName: document.querySelector('.bb-fname')?.textContent?.trim() || null
      };
    }, { slug: target.slug });

    check(`[${target.key}] mounts the promoted body`, mount.loaded && mount.mixer && mount.animationCount === 25,
      JSON.stringify({ loaded: mount.loaded, animations: mount.animationCount }));
    check(`[${target.key}] displays ${target.display} while keeping ${target.stable}`,
      mount.name === target.display && mount.identity === target.stable,
      JSON.stringify({ name: mount.name, identity: mount.identity, hud: mount.hudName }));
    check(`[${target.key}] writes the display name into the live HUD`,
      mount.hudName === target.display.toUpperCase(), JSON.stringify(mount.hudName));
    check(`[${target.key}] resolves its own moveset`, mount.moveset === target.slug, JSON.stringify(mount.moveset));
    if (target.weapon) {
      const empty = target.weapon === 'unarmed';
      check(`[${target.key}] ${empty ? 'keeps its hands free' : 'equips ' + target.weapon}`,
        mount.weaponKind === target.weapon && (empty ? mount.equippedWeapons.length === 0 : mount.equippedWeapons.length > 0),
        JSON.stringify({ kind: mount.weaponKind, label: mount.weaponLabel, weapons: mount.equippedWeapons }));
    }

    await reset(2.4);
    let trace = await advance(0.35);
    check(`[${target.key}] idle plays on the mounted body`, trace.seen.some(name => name === 'idle' || name === 'fighting_idle') || Boolean(trace.active),
      JSON.stringify({ active: trace.active, clip: trace.clip }));
    await capture(target, '01-idle', trace);

    await reset(2.4);
    await page.keyboard.down('d');
    trace = await advance(0.7);
    await page.keyboard.up('d');
    check(`[${target.key}] walks under keyboard input`, trace.seen.includes('walk'), JSON.stringify(trace.seen));
    await capture(target, '02-walk', trace);

    await reset(2.4);
    await page.keyboard.press('Space');
    trace = await advance(0.22);
    check(`[${target.key}] jumps under keyboard input`, trace.seen.includes('jump'), JSON.stringify(trace.seen));
    await capture(target, '03-jump', trace);
    await advance(1.2);

    await reset(1.15);
    const beforeAttack = await page.evaluate(() => window.fighters[1].percent);
    await page.keyboard.press('j');
    trace = await advance(0.24);
    const afterAttack = trace.p2percent;
    check(`[${target.key}] carries a real jab that damages the opponent`, afterAttack > beforeAttack,
      JSON.stringify({ before: beforeAttack, after: afterAttack, seen: trace.seen }));
    await capture(target, '04-jab', trace);

    await reset(1.8);
    await page.keyboard.press('k');
    trace = await advance(1.5);
    check(`[${target.key}] signature is ${target.special}`,
      String(trace.specialLabel || '').toUpperCase().includes(target.special),
      JSON.stringify({ label: trace.specialLabel }));
    check(`[${target.key}] signature produces gameplay state`,
      trace.maxPercent > 0 || Boolean(trace.lastShot) || trace.maxHitstun > 0,
      JSON.stringify({ damage: trace.maxPercent, shot: trace.lastShot, hitstun: trace.maxHitstun }));
    await capture(target, '05-signature', trace);

    await reset(2.4);
    await page.evaluate(() => { window.fighters[0].hitstun = 0.5; });
    trace = await advance(0.16);
    check(`[${target.key}] plays a real hit reaction`, trace.seen.includes('hit_heavy') || trace.seen.includes('hit_light'),
      JSON.stringify(trace.seen));
    await capture(target, '06-hit-reaction', trace);

    const matrix = await clipMatrix();
    const rows = matrix.clips || [];
    const dead = rows.filter(row => !(row.movedBones > 0));
    check(`[${target.key}] all ${rows.length}/25 baked clips move the skeleton`,
      rows.length === 25 && dead.length === 0,
      JSON.stringify({ clips: rows.length, dead: dead.map(row => row.name), min: Math.min(...rows.map(row => row.movedBones)) }));
    await writeFile(resolve(out, target.key, 'clip-matrix.json'), JSON.stringify(matrix, null, 1) + '\n');

    const result = { target, mount, matrix, evidence: trace };
    results.push(result);
    await writeFile(resolve(out, target.key, 'result.json'), JSON.stringify(result, null, 1) + '\n');
  }

  const report = {
    generatedAt: new Date().toISOString(),
    engine: HARDWARE_GPU ? 'Chromium hardware GPU' : 'Chromium SwiftShader',
    hardwareMode: HARDWARE_GPU,
    hardwareVerified: HARDWARE_GPU,
    evidenceClass: HARDWARE_GPU
      ? 'live-browser hardware-GPU acceptance'
      : 'live-browser software (headless Chromium/SwiftShader)',
    gpu: { ...gpu, softwareRenderer },
    softwareRenderer,
    checks,
    targets: results,
    pageErrors: errors,
    failedRequests
  };
  const reportName = selectedTargets.length === TARGETS.length ? 'report.json' : `report-${selectedTargets.map(target => target.key).join('-')}.json`;
  await writeFile(resolve(out, reportName), JSON.stringify(report, null, 1) + '\n');
  console.log(`\n${checks.filter(item => item.ok).length}/${checks.length} checks passed`);
  if (errors.length) console.log('PAGE ERRORS', JSON.stringify(errors.slice(0, 8), null, 1));
  if (failedRequests.length) console.log('FAILED REQUESTS', JSON.stringify(failedRequests.slice(0, 8), null, 1));
  if (errors.length || failedRequests.length) process.exitCode = 1;
  if (checks.some(item => !item.ok)) process.exitCode = 1;
} finally {
  await browser?.close();
  server.close();
}
