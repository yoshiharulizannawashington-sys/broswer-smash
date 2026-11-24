// Live proof for the additive face/weapon overlays. Goku supplies the sculpted facial geometry;
// Superman supplies a controller-owned body mask plus a hand-mounted weapon. Both are driven through
// the normal character-select and match path, and every frame is captured from the real renderer.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = resolve('artifacts/animation-overlays');
await mkdir(out, { recursive: true });
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const file = resolve(root, relative);
    if (!file.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
const errors = [];
const failedRequests = [];
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
  page.setDefaultTimeout(180_000);
  page.on('pageerror', error => errors.push(String(error.stack || error).slice(0, 300)));
  page.on('requestfailed', request => failedRequests.push(request.url()));
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.fighters?.length === 2, null, { timeout: 150_000, polling: 250 });
  await page.evaluate(() => {
    window.__browserSmashFreezeAI = true;
    document.querySelector('#play')?.click();
  });
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  await page.waitForFunction(() => window.__browserSmashControlMode?.().started === true,
    null, { timeout: 120_000, polling: 250 });
  await page.waitForFunction(() => window.__browserSmashPresentation?.report?.().intro?.active === false,
    null, { timeout: 15_000, polling: 100 }).catch(() => {});
  await page.addStyleTag({ content: '#bbHudLayer, #bbHudLayer *, #combatCallout, #hud, #energyHUD, #comboNotice, #roundScore, #cameraSettings, #executeHint { display: none !important; }' });
  // The loading curtain lifts only after the render loop has drawn the arena. Wait for that before
  // pausing, otherwise the first close-up is a picture of the entry card, not the fighter.
  await page.waitForFunction(() => window.__bbLoading?.describe?.().visible === false,
    null, { timeout: 30_000, polling: 100 }).catch(() => {});
  await page.evaluate(() => window.__browserSmashSetPaused?.(true));

  const step = seconds => page.evaluate(seconds => {
    window.__browserSmashSetPaused?.(false);
    for (let i = 0; i < Math.max(1, Math.round(seconds * 60)); i++) window.__browserSmashStep(1 / 60);
    window.__browserSmashSetPaused?.(true);
  }, seconds);

  const select = async name => {
    await page.evaluate(name => window.__browserSmashSelect?.select('p1', name), name);
    const mounted = await page.waitForFunction(name => {
      const f = window.fighters?.[0];
      return Boolean(f?.identity === name && f.model?.userData?.characterAssetUrl
        && f.animationBindModel === f.model);
    }, name, { timeout: 20_000, polling: 100 }).then(() => true).catch(() => false);
    if (name === 'Superman' || name === 'Wonder Woman') {
      await page.waitForFunction(() => Boolean(window.fighters?.[0]?.model?.userData?.equippedWeaponRight),
        null, { timeout: 12_000, polling: 100 }).catch(() => {});
    }
    await page.evaluate(() => {
      const [p1, p2] = window.fighters;
      p1.position.set(-2, p1.groundLevel ?? 0, 0);
      p2.position.set(14, p2.groundLevel ?? 0, 0);
      p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
      for (const f of [p1, p2]) {
        f.velocity.set(0, 0, 0); f.hitstun = 0; f.attackQueue.length = 0; f.guardHeld = false;
        f.isGrounded = true; f.ko = false;
      }
      p1.percent = 0; p2.model.visible = false; p1.model.visible = true;
    });
    await page.keyboard.up('d').catch(() => {});
    await page.keyboard.up('e').catch(() => {});
    await step(0.2);
    return mounted;
  };

  const read = () => page.evaluate(() => {
    const f = window.fighters?.[0];
    const controller = f?.animationController || null;
    const state = f?.model?.userData?.animationOverlays || null;
    const report = controller?.describe?.() || null;
    const mouth = state?.faceParts?.find(part => part.kind === 'mouth') || null;
    const lid = state?.faceParts?.find(part => part.kind === 'blink') || null;
    const weapon = f?.model?.userData?.equippedWeaponRight || null;
    const record = weapon && state?.weapons?.find(item => item.object === weapon) || null;
    return {
      identity: f?.identity || null,
      owner: controller ? 'controller' : 'legacy',
      mask: report?.layers || f?.model?.userData?.bodyMaskLayers || null,
      overlays: report?.overlays || state?.report || null,
      face: mouth ? {
        scaleY: +mouth.node.scale.y.toFixed(4),
        baseScaleY: +mouth.base.scale.y.toFixed(4),
        lidScaleY: lid ? +lid.node.scale.y.toFixed(4) : null,
        lidBaseScaleY: lid ? +lid.base.scale.y.toFixed(4) : null,
        parts: state.faceParts.map(part => part.kind),
        mouths: state.faceParts.filter(part => part.kind === 'mouth').map(part => ({
          role: part.node.userData?.expressionRole || 'line',
          visible: part.node.visible,
          scaleY: +part.node.scale.y.toFixed(4)
        }))
      } : null,
      weapon: weapon && record ? {
        name: weapon.name || null,
        angleToBase: +weapon.quaternion.angleTo(record.base.quaternion).toFixed(4),
        positionFromBase: +weapon.position.distanceTo(record.base.position).toFixed(4),
        basePosition: record.base.position.toArray().map(value => +value.toFixed(3))
      } : null,
      speed: +Math.hypot(f?.velocity?.x || 0, f?.velocity?.z || 0).toFixed(3)
    };
  });

  const capture = async (file, framing, distance) => {
    const pose = await page.evaluate(({ framing, distance }) => {
      const camera = window.smashCamera || window.__browserSmashCamera;
      // The proof poses are stationary, so the model keeps the +Z facing set by the selector. A
      // fixed front three-quarter avoids the root turning into a strafe-facing back view.
      camera?.spectate?.({ fighter: window.fighters[0], framing, yaw: 28,
        pitch: framing === 'head' ? 4 : 8, distance, transition: 0 });
      return { yaw: 28, framing, distance };
    }, { framing, distance });
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(out, file) });
    return pose;
  };

  const report = { generatedAt: new Date().toISOString(), states: {}, checks, pageErrors: errors, failedRequests };
  const mountedGoku = await select('Goku');
  const gokuIdle = await read();
  await capture('goku-face-idle.png', 'head', 1.3);
  report.states.goku = { mounted: mountedGoku, idle: gokuIdle };
  check('Goku mounts through character select', mountedGoku, gokuIdle.identity);
  check('Goku exposes the live facial head/neck channel',
    Boolean(gokuIdle.overlays?.face?.head && gokuIdle.overlays?.face?.neck),
    JSON.stringify(gokuIdle.overlays?.face));
  check('Goku has authored brow, mouth and blink geometry',
    ['brow', 'mouth', 'blink'].every(kind => gokuIdle.overlays?.face?.parts?.includes(kind))
      && gokuIdle.overlays?.face?.authoredRig === true,
    JSON.stringify(gokuIdle.overlays?.face));
  check('Goku loads the baked morph rig from the GLB',
    gokuIdle.overlays?.face?.baked === true
      && (gokuIdle.overlays?.face?.morphs || 0) >= 12
      && gokuIdle.overlays?.face?.morphWeights?.Blink === 0,
    JSON.stringify(gokuIdle.overlays?.face));
  await page.evaluate(() => {
    const state = window.fighters?.[0]?.model?.userData?.animationOverlays;
    if (state) state.clock = 3.74;
  });
  await step(1 / 60);
  const gokuBlink = await read();
  await capture('goku-face-blink.png', 'head', 1.3);
  report.states.goku.blink = gokuBlink;
  check('Goku eyelid geometry closes on the blink pulse',
    (gokuBlink.overlays?.face?.blink || 0) > 0.5
      && ((gokuBlink.face?.lidScaleY || 0) > (gokuBlink.face?.lidBaseScaleY || 1) * 0.5
        || (gokuBlink.overlays?.face?.baked === true
          && (gokuBlink.overlays?.face?.morphWeights?.Blink || 0) > 0.5)),
    JSON.stringify({ face: gokuBlink.overlays?.face, geometry: gokuBlink.face }));
  await page.evaluate(() => {
    const state = window.fighters?.[0]?.model?.userData?.animationOverlays;
    if (state) state.clock = 0;
  });
  await step(0.05);
  // Hold the key across the stepped frames. A press that lands while the probe is paused can be
  // consumed before the next update, which made the attack-only mask checks intermittently miss.
  await page.keyboard.down('j');
  await step(0.12);
  await page.keyboard.up('j');
  const gokuAttack = await read();
  await capture('goku-face-attack.png', 'head', 1.3);
  report.states.goku.attack = gokuAttack;
  check('the facial overlay is live while Goku attacks',
    (gokuAttack.overlays?.face?.weight || 0) > 0.5 && (gokuAttack.overlays?.face?.effort || 0) > 0.4,
    JSON.stringify(gokuAttack.overlays?.face));
  check('Goku walk+jab still keeps the masked attack lanes',
    gokuAttack.mask?.overlayRegion === 'upper' && gokuAttack.mask?.baseRegion === 'lower',
    JSON.stringify(gokuAttack.mask));

  await page.evaluate(() => {
    const f = window.fighters?.[0];
    if (!f) return;
    f.attackQueue.length = 0;
    f.hitstun = 0;
    f.guardBreak = 0;
    f.guardHeld = true;
    f.victoryPose = 0;
    const state = f.model?.userData?.animationOverlays;
    if (state) state.clock = 0;
  });
  // Guard is input-derived: stepping the game rebuilds guardHeld from the held key, so set the
  // field as a fallback but hold the real key across the stepped frames.
  await page.keyboard.down('e');
  await step(0.45);
  const gokuGuard = await read();
  await capture('goku-face-guard.png', 'head', 1.3);
  await page.keyboard.up('e');
  report.states.goku.guard = gokuGuard;
  check('Goku guard drives the guard expression',
    gokuGuard.overlays?.face?.expression === 'guard'
      && (gokuGuard.overlays?.face?.expressionWeight || 0) > 0.5
      && (gokuGuard.overlays?.face?.baked !== true
        || (gokuGuard.overlays?.face?.morphWeights?.Blink || 0) === 0),
    JSON.stringify(gokuGuard.overlays?.face));

  await page.evaluate(() => {
    const f = window.fighters?.[0];
    if (!f) return;
    f.guardHeld = false;
    f.hitstun = 0.45;
    f.victoryPose = 0;
    const state = f.model?.userData?.animationOverlays;
    if (state) state.clock = 0;
  });
  await step(0.12);
  const gokuHit = await read();
  await capture('goku-face-hit.png', 'head', 1.3);
  report.states.goku.hit = gokuHit;
  check('Goku hitstun drives the hit expression',
    gokuHit.overlays?.face?.expression === 'hit'
      && (gokuHit.overlays?.face?.expressionWeight || 0) > 0.5
      && (gokuHit.overlays?.face?.baked === true
        ? (gokuHit.overlays?.face?.morphWeights?.Hit || 0) > 0.5
        : gokuHit.face?.mouths?.some(mouth => mouth.role === 'open' && mouth.visible)),
    JSON.stringify({ face: gokuHit.overlays?.face, mouths: gokuHit.face?.mouths }));

  await page.evaluate(() => {
    const f = window.fighters?.[0];
    if (!f) return;
    f.guardHeld = false;
    f.hitstun = 0;
    f.victoryPose = 4;
    const state = f.model?.userData?.animationOverlays;
    if (state) state.clock = 0;
  });
  await step(0.45);
  const gokuVictory = await read();
  await capture('goku-face-victory.png', 'head', 1.3);
  report.states.goku.victory = gokuVictory;
  check('Goku victory pose drives the victory expression',
    gokuVictory.overlays?.face?.expression === 'victory'
      && (gokuVictory.overlays?.face?.expressionWeight || 0) > 0.5
      && (gokuVictory.overlays?.face?.baked === true
        ? (gokuVictory.overlays?.face?.morphWeights?.Victory || 0) > 0.5
        : gokuVictory.face?.mouths?.some(mouth => mouth.role === 'smile' && mouth.visible)),
    JSON.stringify({ face: gokuVictory.overlays?.face, mouths: gokuVictory.face?.mouths }));

  await page.evaluate(() => {
    const f = window.fighters?.[0];
    if (!f) return;
    f.victoryPose = 0;
    f.hitstun = 0;
    f.guardHeld = false;
  });
  await step(0.18);

  const mountedSuperman = await select('Superman');
  // Guard without strafing: the lower lane still drives the legs, while the upper block and the
  // weapon grip stay square to the front camera.
  await page.keyboard.down('e');
  await step(0.8);
  const supermanGuard = await read();
  await capture('superman-weapon-guard.png', 'torso', 2.2);
  await page.keyboard.up('e');
  await page.keyboard.press('j');
  await step(0.12);
  const supermanAttack = await read();
  await capture('superman-weapon-attack.png', 'torso', 2.2);
  report.states.superman = { mounted: mountedSuperman, guard: supermanGuard, attack: supermanAttack };
  check('Superman mounts through character select', mountedSuperman, supermanGuard.identity);
  check('Superman keeps lower locomotion + upper block while the weapon overlay runs',
    supermanGuard.mask?.overlay === 'block' && supermanGuard.mask?.overlayRegion === 'upper'
      && supermanGuard.mask?.baseRegion === 'lower', JSON.stringify(supermanGuard.mask));
  check('the weapon overlay is live during guard and attack',
    (supermanGuard.overlays?.weapon?.count || 0) === 1
      && (supermanGuard.overlays?.weapon?.weight || 0) > 0.5
      && (supermanAttack.overlays?.weapon?.weight || 0) > 0.5,
    JSON.stringify({ guard: supermanGuard.overlays?.weapon, attack: supermanAttack.overlays?.weapon }));
  check('the equipped weapon actually moves around its authored grip',
    (supermanAttack.weapon?.angleToBase || 0) > 0.001 || (supermanAttack.weapon?.positionFromBase || 0) > 0.0005,
    JSON.stringify(supermanAttack.weapon));
  const mountedWonderWoman = await select('Wonder Woman');
  await page.keyboard.down('e');
  await step(0.8);
  const wonderGuard = await read();
  await capture('wonder-woman-weapon-guard.png', 'torso', 2.2);
  await page.keyboard.up('e');
  await page.keyboard.press('j');
  await step(0.12);
  const wonderAttack = await read();
  await capture('wonder-woman-weapon-attack.png', 'torso', 2.2);
  report.states.wonderWoman = { mounted: mountedWonderWoman, guard: wonderGuard, attack: wonderAttack };
  check('Wonder Woman mounts through the legacy character path',
    mountedWonderWoman && wonderGuard.owner === 'legacy', `${wonderGuard.identity}/${wonderGuard.owner}`);
  check('the legacy body keeps a guard mask while the overlay runs',
    wonderGuard.mask?.overlay?.includes('block') && wonderGuard.mask?.overlayRegion === 'upper'
      && wonderGuard.mask?.baseRegion === 'lower', JSON.stringify(wonderGuard.mask));
  check('the legacy mixer exposes the same face/weapon overlay report',
    Boolean(wonderGuard.overlays?.face?.head)
      && (wonderGuard.overlays?.weapon?.count || 0) >= 1
      && (wonderGuard.overlays?.weapon?.weight || 0) > 0.5,
    JSON.stringify(wonderGuard.overlays));
  check('the legacy weapon grip receives the additive recoil',
    (wonderAttack.weapon?.angleToBase || 0) > 0.001 || (wonderAttack.weapon?.positionFromBase || 0) > 0.0005,
    JSON.stringify(wonderAttack.weapon));
  check('no browser runtime errors during the overlay proof', errors.length === 0, errors.join(' | '));
  check('no failed asset requests during the overlay proof', failedRequests.length === 0,
    failedRequests.slice(0, 3).join(' | '));

  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  const passed = checks.filter(item => item.ok).length;
  console.log(`\n${passed}/${checks.length} overlay checks passed`);
  if (passed !== checks.length) process.exitCode = 1;
} finally {
  await browser?.close();
  server.close();
}
