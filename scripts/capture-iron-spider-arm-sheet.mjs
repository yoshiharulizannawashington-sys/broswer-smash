// Iron Spider native-arm pose sheet. Drives the live roster body in a real match, pauses the
// simulation at three gameplay poses, and shoots each from the front and the fighter's left side
// with the game's own spectator camera. The six close-ups are then composed into one labeled sheet
// so the supplied Object_122 arms can be reviewed without opening six files.
//
// This does not replace the 44-check E2E; it is the arm-specific visual acceptance pass.
//
//   bash scripts/run-browser-test.sh scripts/capture-iron-spider-arm-sheet.mjs
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = resolve(root, 'artifacts/iron-spider/arms/pose-sheet');
await mkdir(out, { recursive: true });

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sources: [], roster: { launch: [], manifestKeys: [] } }));
      return;
    }
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
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
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
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
  page.setDefaultTimeout(180_000);
  const errors = [];
  const failedRequests = [];
  page.on('pageerror', error => errors.push(String(error.message || error).slice(0, 240)));
  page.on('response', response => {
    if (response.status() >= 400) failedRequests.push(response.status() + ' ' + response.url().slice(-100));
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
  null, { timeout: 120_000, polling: 200 });

  await page.evaluate(() => {
    const select = window.__browserSmashSelect;
    select.setMode('1p');
    select.select('p1', 'Iron Spider');
    select.select('p2', 'Goku');
    select.chooseArena('tournament');
    window.__browserSmashFreezeAI = true;
    window.__browserSmashGame.startMatch();
    window.__browserSmashStep(0.2);
  });
  await page.waitForFunction(() => {
    const fighter = window.fighters?.[0];
    return fighter?.identity === 'Iron Spider'
      && fighter.characterModelLoaded === true
      && window.__browserSmashControlMode?.().started === true;
  }, null, { timeout: 120_000, polling: 250 });
  await page.waitForFunction(() => Boolean(window.fighters?.[0]?.model?.userData?.nativeSpiderLegs),
    null, { timeout: 30_000, polling: 200 });
  await page.evaluate(() => window.__browserSmashStep(1.2));
  // The spectator stylesheet predates the modern HUD layer, so hide the live health/ability
  // chrome explicitly; the sheet should be the character, not overlays.
  await page.addStyleTag({ content: '#bbHudLayer, #bbHudLayer *, #combatCallout { display: none !important; }' });

  const step = frames => page.evaluate(n => window.__browserSmashStep(n / 60), frames);
  const pause = value => page.evaluate(paused => window.__browserSmashSetPaused?.(paused), value);
  const reset = () => page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(0, p1.groundLevel ?? 0, -12);
    p1.velocity.set(0, 0, 0);
    p1.facing = 1; p1.facingZ = 0;
    p1.hitstun = 0; p1.specialCooldown = 0;
    p1.attackQueue.length = 0; p1.attackBuffer = 0; p1.attackPose = 0;
    p1.model.userData.attackLock = 0;
    p1.model.userData.lastAuthoredStrike = null;
    p2.position.set(8, p2.groundLevel ?? 0, -12);
    p2.velocity.set(0, 0, 0);
    p2.attackQueue.length = 0;
    p2.hitstun = 0;
    window.__browserSmashStep(0.35);
  });

  const armState = () => page.evaluate(() => {
    const THREE = window.__browserSmashThree;
    const fighter = window.fighters[0];
    const arm = fighter.model?.getObjectByName?.('Object_122') || null;
    if (!arm) return null;
    arm.skeleton?.update?.();
    arm.computeBoundingBox?.();
    const box = arm.boundingBox?.clone?.().applyMatrix4(arm.matrixWorld) || null;
    const size = box ? box.getSize(new THREE.Vector3()) : null;
    const center = box ? box.getCenter(new THREE.Vector3()) : null;
    return {
      mesh: arm.name,
      visible: arm.visible,
      skinned: Boolean(arm.isSkinnedMesh),
      parent: arm.parent?.name || null,
      clip: fighter.model.userData.currentClip || null,
      move: fighter.activeMoveId || null,
      size: size ? size.toArray().map(value => +value.toFixed(3)) : null,
      center: center ? center.toArray().map(value => +value.toFixed(3)) : null,
      bones: (arm.skeleton?.bones || [])
        .filter(bone => /spider/i.test(bone.name || ''))
        .map(bone => ({ name: bone.name, q: bone.quaternion.toArray().map(value => +value.toFixed(6)) }))
    };
  });

  const cameraShot = async yaw => page.evaluate(({ yaw }) => {
    const camera = window.smashCamera || window.__browserSmashCamera;
    camera.spectate({
      fighter: window.fighters[0],
      framing: 'torso',
      yaw,
      pitch: 4,
      distance: 2.4,
      transition: 0
    });
    return camera.describeSpectate?.() || null;
  }, { yaw });

  const shots = [];
  const shotPair = async (state, label) => {
    await pause(true);
    const pair = {};
    for (const [side, yaw] of [['front', 0], ['side', 90]]) {
      const camera = await cameraShot(yaw);
      await page.waitForTimeout(450);
      const file = resolve(out, `${state}-${side}.png`);
      await page.screenshot({ path: file });
      pair[side] = { file, camera, arm: await armState() };
      console.log(`SHOT ${state}-${side} · ${label} · ${pair[side].arm?.clip || 'no clip'}`);
    }
    await pause(false);
    shots.push({ state, label, ...pair });
    return pair;
  };

  // ---- idle -----------------------------------------------------------------
  await reset();
  await step(45);
  const idle = await shotPair('idle', 'idle');

  // ---- heavy strike ---------------------------------------------------------
  await reset();
  await page.keyboard.down('Shift');
  await page.keyboard.press('j');
  // Shift is both dash and the heavy modifier. It must still be held when the buffered J is
  // consumed, otherwise the input resolves as the light atk-01 and the row is mislabeled.
  await step(3);
  await page.keyboard.up('Shift');
  let heavyProgress = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    heavyProgress = await page.evaluate(() => {
      const attack = window.fighters[0].attackQueue[0];
      return attack ? attack.t / (attack.total || 1) : 0;
    });
    if (heavyProgress >= 0.42) break;
    await step(1);
  }
  const heavy = await shotPair('heavy', 'heavy strike');

  // ---- signature sweep ------------------------------------------------------
  await reset();
  await page.keyboard.press('k');
  await step(17); // 0.28 s, the active window used by the Iron Spider E2E
  const signature = await shotPair('signature', 'SPIDER-LEG ASSAULT');

  const idleArm = idle.front.arm;
  const armMotion = pose => {
    const before = new Map((idleArm?.bones || []).map(bone => [bone.name, bone.q]));
    let best = { angle: 0, bone: null };
    for (const after of pose?.front?.arm?.bones || []) {
      const from = before.get(after.name);
      if (!from) continue;
      const dot = Math.abs(from.reduce((sum, value, index) => sum + value * after.q[index], 0));
      const angle = 2 * Math.acos(Math.min(1, dot)) * 180 / Math.PI;
      if (angle > best.angle) best = { angle, bone: after.name };
    }
    return best;
  };
  const heavyMotion = armMotion(heavy);
  const signatureMotion = armMotion(signature);

  check('the live fighter mounts the supplied Object_122 arm',
    idleArm?.mesh === 'Object_122' && idleArm.visible && idleArm.skinned,
    JSON.stringify({ mesh: idleArm?.mesh, visible: idleArm?.visible, parent: idleArm?.parent }));
  check('idle close-ups carry the idle clip and bounded arms',
    /idle/i.test(idle.front.arm?.clip || '') && idle.front.arm?.size?.every(value => value > 0.2 && value < 3),
    JSON.stringify({ clip: idle.front.arm?.clip, size: idle.front.arm?.size }));
  const heavyMove = heavy.front.arm?.move || '';
  check('the heavy input resolves to a heavy move and moves the native arms',
    /^heavy/.test(heavyMove) && !/atk-01|idle/i.test(heavy.front.arm?.clip || '') && heavyMotion.angle > 5,
    JSON.stringify({ move: heavyMove, clip: heavy.front.arm?.clip, progress: +heavyProgress.toFixed(2), bone: heavyMotion.bone, deg: +heavyMotion.angle.toFixed(1) }));
  check('the signature input plays the supplied skill07 clip and sweeps the arms',
    /skill07/i.test(signature.front.arm?.clip || '') && signatureMotion.angle > 5,
    JSON.stringify({ clip: signature.front.arm?.clip, bone: signatureMotion.bone, deg: +signatureMotion.angle.toFixed(1) }));
  check('the arm stays attached and at body scale in every pose',
    [idle, heavy, signature].every(pair => pair.front.arm?.parent === idleArm?.parent
      && pair.side.arm?.parent === idleArm?.parent
      && pair.front.arm?.size?.every(value => value > 0.2 && value < 3)
      && pair.side.arm?.size?.every(value => value > 0.2 && value < 3)),
    JSON.stringify([idle, heavy, signature].map(pair => pair.front.arm?.size)));
  check('the heavy and signature captures use different gameplay clips', 
    heavy.front.arm?.clip !== signature.front.arm?.clip,
    `${heavy.front.arm?.clip} vs ${signature.front.arm?.clip}`);

  // ---- compose the six frames into one sheet -------------------------------
  const tiles = [];
  for (const entry of shots) {
    for (const side of ['front', 'side']) {
      const image = await readFile(entry[side].file);
      tiles.push({
        state: entry.state,
        label: entry.label,
        side,
        clip: entry[side].arm?.clip || '',
        size: (entry[side].arm?.size || []).map(value => value.toFixed(2)).join(' × '),
        src: 'data:image/png;base64,' + image.toString('base64')
      });
    }
  }
  const sheetPage = await browser.newPage({ viewport: { width: 1440, height: 1240 } });
  const rows = ['idle', 'heavy', 'signature'].map(state => {
    const row = tiles.filter(tile => tile.state === state);
    const front = row.find(tile => tile.side === 'front');
    const side = row.find(tile => tile.side === 'side');
    return `
      <section class="row">
        <div class="rail"><span class="state">${front.label}</span><span class="clip">${front.clip.replace(/^Armature\|/, '')}</span></div>
        <figure><img src="${front.src}" alt="${front.label} front"><figcaption>FRONT · ${front.size} m</figcaption></figure>
        <figure><img src="${side.src}" alt="${side.label} side"><figcaption>SIDE · ${side.size} m</figcaption></figure>
      </section>`;
  }).join('');
  await sheetPage.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #081018; color: #e8f0f7; font-family: Inter, Arial, sans-serif; }
    header { padding: 28px 34px 16px; border-bottom: 1px solid #1d3344; }
    h1 { margin: 0; font-size: 28px; letter-spacing: .04em; }
    header p { margin: 6px 0 0; color: #7fa4bb; font-size: 13px; letter-spacing: .07em; text-transform: uppercase; }
    main { padding: 16px 24px 22px; }
    .row { display: grid; grid-template-columns: 150px 1fr 1fr; gap: 14px; align-items: center; padding: 10px 0; border-bottom: 1px solid #142838; }
    .rail { display: flex; flex-direction: column; gap: 6px; padding-left: 10px; border-left: 3px solid #2d7ea8; }
    .state { font-size: 17px; font-weight: 700; letter-spacing: .03em; }
    .clip { color: #75a9c5; font: 11px/1.4 ui-monospace, monospace; word-break: break-word; }
    figure { margin: 0; }
    img { display: block; width: 100%; height: auto; aspect-ratio: 1 / 1; object-fit: contain;
      object-position: center; border: 1px solid #264456; border-radius: 4px; background: #0d1c27; }
    figcaption { margin-top: 5px; color: #8db2c8; font-size: 11px; letter-spacing: .08em; }
    footer { padding: 0 34px 26px; color: #55778c; font-size: 11px; letter-spacing: .04em; }
  </style></head><body>
    <header><h1>IRON SPIDER · NATIVE-ARM POSE SHEET</h1>
      <p>Object_122 · live Iron Spider vs Goku · Tournament · front / left side · torso close-up</p></header>
    <main>${rows}</main>
    <footer>Captured from the live match with the game's spectator camera, simulation paused per pose. Headless SwiftShader composition evidence, not hardware or performance verification.</footer>
  </body></html>`);
  await sheetPage.waitForTimeout(600);
  const sheetFile = resolve(root, 'artifacts/iron-spider/arm-pose-sheet.png');
  await sheetPage.screenshot({ path: sheetFile, fullPage: true });
  console.log('SHEET ' + sheetFile);

  const report = {
    capturedAt: new Date().toISOString(),
    sheet: sheetFile,
    renderer: 'headless Chromium / SwiftShader',
    tiles: tiles.map(({ src, ...rest }) => rest),
    motion: { heavy: heavyMotion, signature: signatureMotion },
    checks
  };
  await writeFile(resolve(root, 'artifacts/iron-spider/arm-pose-sheet.json'), JSON.stringify(report, null, 2));
  check('no browser runtime errors during the pose sheet', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('no failed model or asset requests', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | '));

  const failed = checks.filter(entry => !entry.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} pose-sheet checks passed`);
  if (failed.length) process.exitCode = 1;
} finally {
  await browser?.close();
  server.close();
}
