// Iron Spider roster match matrix. Boots the real game once, then plays a fresh Iron Spider
// match against every selectable launch-roster opponent (Iron Spider excluded). Each match uses
// real J / K inputs, checks the opponent's identity, damage, hit stun, signature clip and
// knockout/result, and keeps a four-frame capture set per opponent. The full 37-opponent sheet is
// composed at the end.
//
// The CPU is frozen so every sample measures Iron Spider's hit against a stationary opponent; the
// match, damage, hitstun, signature and round-end paths are the game's own code.
//
// The roster is read from window.characterRosters.launch after boot, so this stays aligned with
// the actual character-select list instead of a hard-coded sample.
//
//   bash scripts/run-browser-test.sh scripts/verify-iron-spider-match-matrix.mjs
//
// Batching (the SwiftShader run is split by the cloud command limit):
//   IRON_MATRIX_OFFSET=0 IRON_MATRIX_LIMIT=10 IRON_MATRIX_LABEL=batch-01 ...
//   IRON_MATRIX_OPPONENTS="Superman,Goku" ...
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const requireGpu = process.env.IRON_MATRIX_GPU === '1';
const out = resolve(root, process.env.IRON_MATRIX_OUT
  || (requireGpu ? 'artifacts/iron-spider/matrix-gpu' : 'artifacts/iron-spider/matrix'));
await mkdir(out, { recursive: true });

const envOpponents = String(process.env.IRON_MATRIX_OPPONENTS || '')
  .split(',').map(name => name.trim()).filter(Boolean);
const offset = Math.max(0, Number(process.env.IRON_MATRIX_OFFSET) || 0);
const limit = Math.max(0, Number(process.env.IRON_MATRIX_LIMIT) || 0);
const batchLabel = String(process.env.IRON_MATRIX_LABEL || '').trim().replace(/[^a-zA-Z0-9_-]/g, '-');
const roundsToWin = Math.max(1, Number(process.env.IRON_MATRIX_ROUNDS) || 2);
const reportFile = resolve(out, batchLabel ? `report-${batchLabel}.json` : 'report.json');
const sheetFile = resolve(out, batchLabel ? `matrix-sheet-${batchLabel}.png` : 'matrix-sheet.png');
const slugOf = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

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
    headless: process.env.IRON_MATRIX_HEADED !== '1',
    args: requireGpu
      ? ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu']
      : ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
        '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
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

  const gpu = await page.evaluate(() => {
    const gl = window.__browserSmashRenderer?.getContext?.()
      || document.querySelector('canvas')?.getContext?.('webgl2');
    if (!gl) return null;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)
    };
  });
  const softwareRenderer = /swiftshader|llvmpipe|software|basic render/i.test(String(gpu?.renderer || ''));
  console.log('GPU ' + JSON.stringify({ ...gpu, softwareRenderer }));
  if (requireGpu && (!gpu || softwareRenderer)) {
    throw new Error(`hardware GPU required; Chromium is using ${gpu?.renderer || 'no WebGL renderer'}`);
  }

  const roster = await page.evaluate(() => ({
    launch: (window.characterRosters?.launch || []).map(([name]) => name),
    all: (window.characterRosters?.all || []).map(([name]) => name)
  }));
  const launchOpponents = roster.launch.filter(name => name !== 'Iron Spider');
  const requested = envOpponents.length ? envOpponents : launchOpponents;
  const opponents = requested
    .slice(offset, limit ? offset + limit : undefined)
    .map(name => ({ name, slug: slugOf(name) }));
  const batch = {
    label: batchLabel || null,
    offset,
    limit,
    requested: requested.length,
    selected: opponents.length,
    launchRoster: roster.launch,
    catalogSize: roster.all.length,
    catalogOnly: roster.all.filter(name => !roster.launch.includes(name))
  };
  console.log(`ROSTER launch=${roster.launch.length} catalog=${roster.all.length} selected=${opponents.length}${batchLabel ? ` batch=${batchLabel}` : ''}`);
  check('the selected opponents are all selectable launch-roster identities',
    opponents.length > 0 && opponents.every(opponent => launchOpponents.includes(opponent.name)),
    opponents.map(opponent => opponent.name).join(', '));

  const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);
  const startMatch = async opponent => {
    await page.evaluate(({ name, roundsToWin }) => {
      // A previous round's payload is still on the test hook. Clear it so the new match cannot
      // mistake the old result for its own.
      window.__browserSmashLastResult = null;
      const select = window.__browserSmashSelect;
      select.setMode('1p');
      select.setRules({ roundsToWin, roundSeconds: 80 });
      // setRules updates the selector UI but does not invoke onRules. Push the same rule into
      // matchState so the real match honors the requested first-to-N setting.
      window.__browserSmashSetRules?.({ roundsToWin, roundSeconds: 80 });
      select.select('p1', 'Iron Spider');
      select.select('p2', name);
      select.chooseArena('tournament');
      window.__browserSmashFreezeAI = true;
      window.__browserSmashGame.startMatch();
      window.__browserSmashStep(0.2);
    }, { name: opponent, roundsToWin });
    await page.waitForFunction(name => {
      const [p1, p2] = window.fighters || [];
      return p1?.identity === 'Iron Spider' && p1.characterModelLoaded === true
        && p2?.identity === name
        && window.__browserSmashControlMode?.().started === true;
    }, opponent, { timeout: 120_000, polling: 250 });
    await page.evaluate(() => {
      window.__browserSmashFreezeAI = true;
      window.__browserSmashStep(1.0);
    });
    await page.waitForFunction(() => window.fighters?.[0]?.model?.userData?.nativeSpiderLegs,
      null, { timeout: 30_000, polling: 200 });
  };

  const place = distance => page.evaluate(({ distance }) => {
    const [p1, p2] = window.fighters;
    const ground = p1.groundLevel ?? 0;
    p1.position.set(0, ground, -12); p1.velocity.set(0, 0, 0);
    p1.facing = 1; p1.facingZ = 0; p1.hitstun = 0; p1.ko = false; p1.victoryPose = 0;
    p1.attackQueue.length = 0; p1.attackBuffer = 0; p1.attackPose = 0;
    p1.specialCooldown = 0; p1.model.userData.attackLock = 0;
    p2.position.set(distance, p2.groundLevel ?? ground, -12); p2.velocity.set(0, 0, 0);
    p2.facing = -1; p2.facingZ = 0; p2.percent = 0; p2.hitstun = 0;
    p2.invulnerable = 0; p2.guardHeld = false; p2.attackQueue.length = 0;
    window.__browserSmashStep(0.4);
  }, { distance });

  // Reposition without touching the opponent's accumulated percent. The knockout loop below must
  // earn its damage through the real signature hit, not a pre-set percentage.
  const positionForHit = distance => page.evaluate(({ distance }) => {
    const [p1, p2] = window.fighters;
    const ground = p1.groundLevel ?? 0;
    p1.position.set(0, ground, -12); p1.velocity.set(0, 0, 0);
    p1.facing = 1; p1.facingZ = 0; p1.isGrounded = true; p1.hitstun = 0;
    p1.attackQueue.length = 0; p1.attackBuffer = 0; p1.attackPose = 0;
    p1.specialCooldown = 0; p1.model.userData.attackLock = 0;
    p2.position.set(distance, p2.groundLevel ?? ground, -12); p2.velocity.set(0, 0, 0);
    p2.facing = -1; p2.facingZ = 0; p2.isGrounded = true; p2.ko = false;
    p2.hitstun = 0; p2.invulnerable = 0; p2.guardHeld = false; p2.attackQueue.length = 0;
    window.__browserSmashStep(0.12);
  }, { distance });

  const state = () => page.evaluate(() => {
    const [p1, p2] = window.fighters;
    const arm = p1.model?.getObjectByName?.('Object_122') || null;
    return {
      ironSpider: {
        identity: p1.identity,
        loaded: p1.characterModelLoaded,
        clip: p1.model.userData.currentClip || null,
        move: p1.activeMoveId || null,
        arm: arm ? { mesh: arm.name, visible: arm.visible, parent: arm.parent?.name || null } : null,
        specialCooldown: +(p1.specialCooldown || 0).toFixed(3),
        attackQueue: p1.attackQueue.length
      },
      opponent: {
        identity: p2.identity,
        percent: +(p2.percent || 0).toFixed(2),
        hitstun: +(p2.hitstun || 0).toFixed(3),
        ko: Boolean(p2.ko),
        visible: p2.model?.visible !== false
      },
      match: window.__browserSmashMatch?.() || null,
      result: window.__browserSmashLastResult || null
    };
  });    const results = [];
  for (const opponent of opponents) {
    const startedAt = Date.now();
    const dir = resolve(out, opponent.slug);
    await mkdir(dir, { recursive: true });
    console.log(`\n=== ${opponent.name} ===`);
    try {
      await startMatch(opponent.name);

    const [p1, p2] = await page.evaluate(() => [window.fighters[0].identity, window.fighters[1].identity]);
    const mount = await state();
    check(`[${opponent.name}] Iron Spider mounts the supplied body and Object_122`,
      p1 === 'Iron Spider' && mount.ironSpider.loaded
        && mount.ironSpider.arm?.mesh === 'Object_122' && mount.ironSpider.arm.visible,
      JSON.stringify({ p1, arm: mount.ironSpider.arm }));

    await place(2.2);
    await page.screenshot({ path: resolve(dir, '01-match.png') });

    const beforeLight = await state();
    await place(1.05);
    await page.keyboard.press('j');
    await step(0.18);
    const light = await state();
    await page.screenshot({ path: resolve(dir, '02-light-hit.png') });
    check(`[${opponent.name}] the live opponent is the requested roster body`,
      p2 === opponent.name && beforeLight.opponent.identity === opponent.name && beforeLight.opponent.visible,
      JSON.stringify({ requested: opponent.name, actual: p2 }));
    check(`[${opponent.name}] J lands damage and hit stun on the opponent`,
      light.opponent.percent > beforeLight.opponent.percent && light.opponent.hitstun > 0,
      JSON.stringify({ before: beforeLight.opponent.percent, after: light.opponent.percent, stun: light.opponent.hitstun }));

    await place(1.6);
    await page.keyboard.press('k');
    await step(0.28);
    const signature = await state();
    await page.screenshot({ path: resolve(dir, '03-signature.png') });
    check(`[${opponent.name}] K plays skill07 and damages the opponent`,
      /skill07/i.test(signature.ironSpider.clip || '')
        && signature.ironSpider.specialCooldown > 0
        && signature.opponent.percent > 0,
      JSON.stringify({ clip: signature.ironSpider.clip, cooldown: signature.ironSpider.specialCooldown, percent: signature.opponent.percent }));

    // The game is best-of-three (first to two rounds). Earn the knockouts with real signature
    // hits so the result screen's damage and biggest-hit numbers are the character's own.
    let attempts = 0;
    let round = await page.evaluate(() => window.__browserSmashMatch().round);
    while (attempts < 80) {
      const snapshot = await page.evaluate(() => ({
        match: window.__browserSmashMatch(),
        result: window.__browserSmashLastResult || null
      }));
      // A first-round KO reports a non-fighting status while the round banner plays. That is not
      // the end of the match: wait through it, then fight round 2.
      if (snapshot.match.status === 'match-over') break;
      if (snapshot.match.status !== 'fighting') { await step(0.6); continue; }
      if (snapshot.match.round !== round) {
        round = snapshot.match.round;
        await step(1.5);
        await page.waitForFunction(() => window.__browserSmashControlMode?.().started === true
          && window.__browserSmashControlMode?.().roundPause === false,
        null, { timeout: 8_000 }).catch(() => {});
        continue;
      }
      await positionForHit(1.6);
      await page.keyboard.press('k');
      // The signature cooldown is 0.8 s; step past it so every loop iteration is a real hit.
      await step(0.9);
      attempts += 1;
    }
    await page.waitForFunction(() => Boolean(window.__browserSmashLastResult)
      || window.__browserSmashMatch?.().status === 'match-over', null, { timeout: 8_000 }).catch(() => {});
    await page.waitForFunction(() => Boolean(window.__browserSmashLastResult), null, { timeout: 6_000 }).catch(() => {});
    await step(4);
    const result = await state();
    await page.screenshot({ path: resolve(dir, '04-result.png') });
    check(`[${opponent.name}] ${roundsToWin === 1 ? 'one KO reaches' : 'two KOs reach'} a match result`,
      result.match?.status !== 'fighting' && Boolean(result.result),
      JSON.stringify({ status: result.match?.status, result: result.result?.text || result.result || null, attempts, percent: result.opponent.percent, clip: result.ironSpider.clip }));

    results.push({
      opponent: opponent.name,
      slug: opponent.slug,
      captures: ['01-match.png', '02-light-hit.png', '03-signature.png', '04-result.png']
        .map(file => `${opponent.slug}/${file}`),
      light: { damage: +(light.opponent.percent - beforeLight.opponent.percent).toFixed(2), stun: light.opponent.hitstun },
      signature: { clip: signature.ironSpider.clip, damage: signature.opponent.percent, cooldown: signature.ironSpider.specialCooldown },
      result: result.result?.text || String(result.result || ''),
      durationMs: Date.now() - startedAt
    });
    console.log(`RESULT ${opponent.name} · light ${results.at(-1).light.damage}% · signature ${results.at(-1).signature.damage}% · ${results.at(-1).result} · ${results.at(-1).durationMs}ms`);
    } catch (error) {
      const detail = String(error?.stack || error?.message || error).slice(0, 1000);
      console.error(`MATCH FAILED ${opponent.name} · ${detail}`);
      check(`[${opponent.name}] match completes`, false, detail);
      await page.screenshot({ path: resolve(dir, '00-failure.png') }).catch(() => {});
      results.push({
        opponent: opponent.name,
        slug: opponent.slug,
        captures: [],
        light: null,
        signature: null,
        result: null,
        error: detail,
        durationMs: Date.now() - startedAt
      });
    }
  }

  check('no browser runtime errors during the matrix', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('no failed asset requests during the matrix', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | '));

  // A compact review sheet: four opponents down, four live beats across.
  const tiles = [];
  for (const entry of results) {
    const row = [];
    for (const file of ['01-match.png', '02-light-hit.png', '03-signature.png', '04-result.png']) {
      try {
        const image = await readFile(resolve(out, entry.slug, file));
        row.push('data:image/png;base64,' + image.toString('base64'));
      } catch {
        row.push(null);
      }
    }
    tiles.push({ ...entry, row });
  }
  const sheet = await browser.newPage({ viewport: { width: 1500, height: 1600 } });
  const rows = tiles.map(tile => `
    <section class="row">
      <div class="rail"><strong>IRON SPIDER</strong><span>vs ${tile.opponent}</span><em>${tile.error ? 'MATCH FAILED' : `light ${tile.light.damage}% · sig ${tile.signature.damage}%`}</em></div>
      ${tile.row.map((src, index) => `<figure>${src ? `<img src="${src}" alt="${tile.opponent} ${['match', 'light hit', 'signature', 'result'][index]}">` : '<div class="missing">MISSING</div>'}<figcaption>${['MATCH', 'JAB HIT', 'SIGNATURE', 'RESULT'][index]}</figcaption></figure>`).join('')}
    </section>`).join('');
  await sheet.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #081018; color: #e8f0f7; font-family: Inter, Arial, sans-serif; }
    header { padding: 24px 28px 12px; border-bottom: 1px solid #1d3344; }
    h1 { margin: 0; font-size: 25px; letter-spacing: .04em; }
    header p { margin: 5px 0 0; color: #7fa4bb; font-size: 12px; letter-spacing: .07em; text-transform: uppercase; }
    main { padding: 10px 18px 16px; }
    .row { display: grid; grid-template-columns: 130px repeat(4, 1fr); gap: 8px; align-items: start; padding: 8px 0; border-bottom: 1px solid #142838; }
    .rail { display: flex; flex-direction: column; gap: 5px; padding-left: 8px; border-left: 3px solid #2d7ea8; }
    .rail strong { font-size: 12px; letter-spacing: .05em; color: #8db2c8; }
    .rail span { font-size: 15px; font-weight: 700; }
    .rail em { font-size: 10px; color: #75a9c5; font-style: normal; }
    figure { margin: 0; }
    img, .missing { display: block; width: 100%; height: auto; aspect-ratio: 1 / 1; object-fit: contain; border: 1px solid #264456; border-radius: 3px; background: #0d1c27; }
    .missing { display: grid; place-items: center; color: #ff9b8e; font: 900 12px system-ui; }
    figcaption { margin-top: 4px; color: #8db2c8; font-size: 10px; letter-spacing: .08em; }
  </style></head><body>
    <header><h1>IRON SPIDER · ROSTER MATCH MATRIX</h1>
    <p>Live Iron Spider matches · Tournament · J light hit / K SPIDER-LEG ASSAULT / knockout result · CPU frozen for measurement</p></header>
    <main>${rows}</main>
  </body></html>`);
  await sheet.waitForTimeout(500);
  await sheet.screenshot({ path: sheetFile, fullPage: true });
  console.log('SHEET ' + sheetFile);    const report = {
    capturedAt: new Date().toISOString(),
    sheet: sheetFile,
    renderer: gpu?.renderer || 'unknown WebGL renderer',
    gpu,
    hardwareGpu: Boolean(gpu) && !softwareRenderer,
    roundsToWin,
    batch,
    opponents: results,
    checks
  };
  await writeFile(reportFile, JSON.stringify(report, null, 2));
  console.log('REPORT ' + reportFile);
  const failed = checks.filter(entry => !entry.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} matrix checks passed`);
  if (failed.length) process.exitCode = 1;
} finally {
  await browser?.close();
  server.close();
}
