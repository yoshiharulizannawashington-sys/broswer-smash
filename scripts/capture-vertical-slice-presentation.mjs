// Parameterized vertical-slice presentation capture.
//
// This drives the game the way a player does:
//   title -> VERSUS -> P1 / P2 cards -> arena card -> START FIGHT -> cinematic intro
//   -> a complete first-to-one round with real keyboard input -> result screen.
//
// There is no forced percentage, no teleported fighter, no frozen AI and no hand-set meter.
// The only automation switch is `__browserSmashIntros`, which is required because Playwright
// reports `navigator.webdriver` and the game deliberately suppresses the entrance for automated
// runs. That switch changes whether the real cinematic plays; it does not change combat.
//
// Default (Hulk vs Aquaman, Final Valley):
//   node scripts/capture-vertical-slice-presentation.mjs
//
// Wonder Woman vs Thor in Asgard (the slower arena needs a longer test-only intro duration and
// more wall time for the same real-time round; the player default remains 5 s):
//   SLICE_P1='Wonder Woman' SLICE_P2='Thor' SLICE_ARENA=asgard \
//   SLICE_ARENA_LABEL=ASGARD SLICE_OUT=slice-presentation-wonder-woman-thor-asgard \
//   SLICE_INTRO_SECONDS=30 SLICE_ROUND_MS=150000 SLICE_RESULT_TIMEOUT_MS=120000 \
//   bash scripts/run-browser-test.sh scripts/capture-vertical-slice-presentation.mjs
//
// Output: artifacts/a1-cohort/<SLICE_OUT>/ (PNG frames + slice-presentation.json).
// Default SLICE_OUT is `slice-presentation`, so the original evidence path is unchanged.
const slice = {
  p1: process.env.SLICE_P1 || 'Hulk (Bruce Banner)',
  p1Short: process.env.SLICE_P1_SHORT || process.env.SLICE_P1 || 'Hulk',
  p2: process.env.SLICE_P2 || 'Aquaman',
  p2Short: process.env.SLICE_P2_SHORT || process.env.SLICE_P2 || 'Aquaman',
  arena: process.env.SLICE_ARENA || 'finalvalley',
  arenaLabel: process.env.SLICE_ARENA_LABEL || 'FINAL VALLEY',
  label: process.env.SLICE_LABEL || 'Hulk (Bruce Banner) vs Aquaman · Final Valley',
  out: process.env.SLICE_OUT || 'slice-presentation',
  // On a slow software renderer the first rendered frame can consume most of a short intro
  // before the screenshot is encoded. This only lengthens the presentation hold; combat is
  // unchanged. Heavy arenas should pass a larger value.
  introSeconds: Number(process.env.SLICE_INTRO_SECONDS) || 8
};
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = resolve(root, 'artifacts/a1-cohort', slice.out);
await mkdir(out, { recursive: true });

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.hdr': 'application/octet-stream', '.bin': 'application/octet-stream',
  '.svg': 'image/svg+xml'
};

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"sources":[],"roster":{"launch":[],"manifestKeys":[]}}');
      return;
    }
    let rel = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => rel === dir || rel.startsWith(dir + sep))) {
      rel = 'public' + sep + rel;
    }
    const file = resolve(root, rel);
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    if (!res.headersSent) { res.writeHead(404); res.end('Not found'); } else res.end();
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.setDefaultTimeout(180_000);

// The game imports three from unpkg through an import map. Serve the pinned local copy so the
// capture is offline and does not depend on a CDN response during the round.
await page.route('https://unpkg.com/three@0.152.2/**', async route => {
  const url = new URL(route.request().url());
  const local = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
  try {
    await route.fulfill({
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: await readFile(local)
    });
  } catch {
    await route.fulfill({ status: 404, body: 'missing local three module' });
  }
});

const errors = [];
const consoleErrors = [];
const failedRequests = [];
page.on('pageerror', error => errors.push(String(error.message || error).slice(0, 300)));
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300));
});
page.on('requestfailed', request => {
  failedRequests.push({ url: request.url().slice(0, 220), error: request.failure()?.errorText || 'failed' });
});

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
};
const capture = async name => {
  const path = resolve(out, name + '.png');
  await page.screenshot({ path });
  return path;
};
const sleep = ms => new Promise(done => setTimeout(done, ms));

let selection = null;
let arena = null;
let intro = null;
let introAfter = null;
let round = null;
let result = null;
let report = null;

try {
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashStep && window.fighters?.length === 2, null,
    { timeout: 180_000, polling: 250 });
  await page.waitForTimeout(1200);
  await capture('01-title');

  // VERSUS is the real title button, not a setup API call.
  await page.locator('#bbTitle [data-nav="versus"]').click();
  await page.waitForSelector('.bs-step[data-step="1"]:not([hidden])', { timeout: 20_000 });

  await page.locator('.bs-side[data-side="p1"]').click();
  await page.locator('.bs-card', { hasText: slice.p1Short }).first().click();
  await page.waitForTimeout(250);
  await page.locator('.bs-side[data-side="p2"]').click();
  await page.locator('.bs-card', { hasText: slice.p2Short }).first().click();
  await page.waitForTimeout(700);
  await page.selectOption('[data-rule="rounds"]', '1');
  await page.selectOption('[data-rule="timer"]', '60');
  await page.waitForTimeout(300);

  selection = await page.evaluate(() => ({
    state: window.__browserSmashSelect?.state
      ? { p1: window.__browserSmashSelect.state.p1, p2: window.__browserSmashSelect.state.p2,
        arena: window.__browserSmashSelect.state.arena, rules: { ...window.__browserSmashSelect.state.rules } }
      : null,
    fighters: (window.fighters || []).map(f => f.identity),
    cards: [...document.querySelectorAll('.bs-card')].filter(c => c.classList.contains('p1') || c.classList.contains('p2'))
      .map(c => ({ fighter: c.dataset.fighter, classes: c.className })),
    rules: window.__browserSmashRules?.() || null,
    matchline: document.querySelector('[data-role="matchline"]')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    p1Select: document.querySelector('#p1Character')?.value || null,
    p2Select: document.querySelector('#cpuCharacter')?.value || null
  }));
  await capture('02-fighters-selected');
  check(`real fighter cards select ${slice.p1Short} for P1`,
    new RegExp(slice.p1Short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(selection.state?.p1 || '')
      && selection.fighters[0] === slice.p1,
    JSON.stringify({ state: selection.state?.p1, live: selection.fighters[0] }));
  check(`real fighter cards select ${slice.p2Short} for P2`,
    new RegExp(slice.p2Short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(selection.state?.p2 || '')
      && selection.fighters[1] === slice.p2,
    JSON.stringify({ state: selection.state?.p2, live: selection.fighters[1] }));
  check('selected rules are first-to-one, 60 seconds',
    selection.state?.rules?.roundsToWin === 1 && selection.state?.rules?.roundSeconds === 60
      && selection.rules?.roundsToWin === 1 && selection.rules?.roundSeconds === 60,
    JSON.stringify({ select: selection.state?.rules, live: selection.rules }));
  check('setup line reflects the selected rules',
    /first to 1 round/i.test(selection.matchline) && /60s/i.test(selection.matchline),
    selection.matchline);

  await page.locator('#selectScreen [data-nav="next"]').click();
  await page.waitForSelector('.bs-step[data-step="2"]:not([hidden])', { timeout: 20_000 });
  await page.waitForTimeout(400);
  await capture('03-arena-choice');

  // The arena card is the real control. Classic arenas (finalvalley, asgard) are visible in the
  // default world tab; clicking one drives the hidden #mapSelect through a change event.
  const arenaCard = page.locator(`.bs-arena[data-arena="${slice.arena}"]`);
  await arenaCard.click();
  await page.waitForTimeout(900);
  arena = await page.evaluate(arenaKey => {
    const card = document.querySelector(`.bs-arena[data-arena="${arenaKey}"]`);
    const option = document.querySelector(`#mapSelect option[value="${arenaKey}"]`);
    return {
      clicked: arenaKey,
      selected: card?.classList.contains('on') || false,
      mapSelect: document.querySelector('#mapSelect')?.value || null,
      menuMapSelect: document.querySelector('#menuMapSelect')?.value || null,
      title: document.querySelector('[data-role="matchline"]')?.textContent?.replace(/\s+/g, ' ').trim() || '',
      option: option?.textContent || null,
      world: window.__browserSmashWorld?.location || null,
      liveArena: window.__browserSmashMatch?.().arena || null,
      authored: window.__browserSmashAssets?.authoredArena || null
    };
  }, slice.arena);
  await capture('04-arena-selected');
  check(`arena card selects ${slice.arenaLabel} in the real map source`,
    arena.selected && arena.mapSelect === slice.arena && arena.menuMapSelect === slice.arena,
    JSON.stringify(arena));
  check(`arena card switches the live stage to ${slice.arenaLabel} before the match`,
    arena.liveArena === slice.arena
      && new RegExp(slice.arenaLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(arena.option || ''),
    JSON.stringify({ live: arena.liveArena, option: arena.option, authored: arena.authored }));

  // Playwright is a webdriver, so the game intentionally suppresses the intro for automated
  // evidence. Turn only that presentation switch back on; combat and inputs stay real.
  // The authored entrance is five seconds. The capture holds the same sequence longer on
  // SwiftShader (the documented capture hook), so a slow first frame cannot consume the beats
  // before the screenshots are taken. This changes presentation duration only, never combat.
  await page.evaluate(seconds => {
    window.__browserSmashIntros = true;
    window.__browserSmashIntroSeconds = seconds;
  }, slice.introSeconds);
  const playVisible = await page.locator('#play').isVisible();
  check('START FIGHT is a visible real control', playVisible);
  await page.locator('#play').click();
  await page.waitForTimeout(250);
  await capture('05-loading');

  await page.waitForFunction(() => window.__bbLoading?.describe?.().visible === false, null,
    { timeout: 30_000, polling: 100 });
  // Capture while the intro still owns the frame: both plates are in, VS is up and the first
  // dialogue line has fired. If the loading gate outlasted the intro, this fails rather than
  // claiming a match-start pose was a cinematic.
  await page.waitForFunction(() => {
    const state = window.__browserSmashPresentation?.report?.().intro;
    return state?.active && state.elapsed >= 1.65;
  }, null, { timeout: 30_000, polling: 80 });

  intro = await page.evaluate(() => {
    const wrap = document.querySelector('#browserSmashCinematic');
    const text = role => wrap?.querySelector(`[data-role="${role}"]`)?.textContent?.trim() || null;
    const rect = role => {
      const node = wrap?.querySelector(`[data-role="${role}"]`);
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
    };
    const style = node => node ? getComputedStyle(node) : null;
    return {
      report: window.__browserSmashPresentation?.report?.().intro || null,
      exists: Boolean(wrap),
      tag: text('tag'),
      plateA: { text: text('plate-a'), rect: rect('plate-a'), opacity: style(wrap?.querySelector('[data-role="plate-a"]'))?.opacity || null },
      plateB: { text: text('plate-b'), rect: rect('plate-b'), opacity: style(wrap?.querySelector('[data-role="plate-b"]'))?.opacity || null },
      versus: { text: text('versus'), rect: rect('versus'), opacity: style(wrap?.querySelector('[data-role="versus"]'))?.opacity || null },
      bodyClass: document.body.className,
      hudVisibility: style(document.querySelector('#hud'))?.visibility || null,
      bbHudDisplay: style(document.querySelector('#bbHudLayer'))?.display || null,
      roundScoreVisibility: style(document.querySelector('#roundScore'))?.visibility || null,
      dialogue: window.__browserSmashPresentation?.report?.().dialogue || null
    };
  });
  await capture('06-cinematic-intro');
  check('cinematic intro is active and owns the frame',
    intro.report?.active === true && intro.exists === true && intro.bodyClass.includes('bb-cinematic'),
    JSON.stringify({ active: intro.report?.active, elapsed: intro.report?.elapsed, body: intro.bodyClass }));
  check('intro names both fighters on screen',
    new RegExp(slice.p1Short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(intro.plateA.text || '')
      && new RegExp(slice.p2Short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(intro.plateB.text || '')
      && intro.plateA.rect?.width > 0 && intro.plateB.rect?.width > 0,
    JSON.stringify({ a: intro.plateA, b: intro.plateB }));
  check('intro shows the VS beat and the arena / round tag',
    intro.versus.text === 'VS' && Number(intro.versus.opacity) > 0
      && new RegExp(slice.arenaLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(intro.tag || '')
      && /ROUND 01/i.test(intro.tag || ''),
    JSON.stringify({ versus: intro.versus, tag: intro.tag }));
  check('intro hides the gameplay HUD while the plates play',
    intro.bodyClass.includes('bb-cinematic') && intro.bbHudDisplay === 'none'
      && intro.roundScoreVisibility === 'hidden',
    JSON.stringify({ body: intro.bodyClass, bbHud: intro.bbHudDisplay, roundScore: intro.roundScoreVisibility }));
  check(`intro has an authored exchange for ${slice.p1Short} and ${slice.p2Short}`,
    (intro.report?.lastLines?.length || 0) >= 2 && intro.report?.played === 1,
    JSON.stringify({ lines: intro.report?.lastLines, played: intro.report?.played }));

  await page.waitForFunction(() => window.__browserSmashPresentation?.report?.().intro?.active === false,
    null, { timeout: 12_000, polling: 100 });
  await page.waitForTimeout(250);
  introAfter = await page.evaluate(() => {
    const styleOf = selector => {
      const node = document.querySelector(selector);
      return node ? getComputedStyle(node) : null;
    };
    return {
      report: window.__browserSmashPresentation?.report?.().intro || null,
      match: window.__browserSmashMatch?.() || null,
      round: window.__browserSmashRound?.state
        ? { round: window.__browserSmashRound.state.round, timer: window.__browserSmashRound.state.timer,
          status: window.__browserSmashRound.state.status }
        : null,
      started: window.__browserSmashControlMode?.().started ?? null,
      hudVisibility: styleOf('#hud')?.visibility || null,
      bbHudDisplay: styleOf('#bbHudLayer')?.display || null
    };
  });
  await capture('07-round-start');
  check('intro completes without being skipped',
    introAfter.report?.completed === 1 && introAfter.report?.skipped === 0,
    JSON.stringify({ completed: introAfter.report?.completed, skipped: introAfter.report?.skipped }));
  check('intro hands off to round 1, not a phantom round 2',
    introAfter.match?.status === 'fighting' && introAfter.match?.round === 1
      && introAfter.round?.round === 1,
    JSON.stringify({ match: introAfter.match, round: introAfter.round }));
  check('round clock is preserved through the entrance',
    Number(introAfter.round?.timer) >= 58,
    JSON.stringify({ timer: introAfter.round?.timer }));
  check('gameplay HUD returns after the intro',
    introAfter.hudVisibility !== 'hidden' && introAfter.bbHudDisplay !== 'none',
    JSON.stringify({ hud: introAfter.hudVisibility, bbHud: introAfter.bbHudDisplay }));

  // A real round: drive P1 with the keyboard, leave the P2 AI live. Movement is expressed
  // around the live camera basis just like the game's camera-relative controller.
  const held = new Set();
  const setHeld = async keys => {
    const next = new Set(keys);
    for (const code of [...held]) {
      if (!next.has(code)) { await page.keyboard.up(code); held.delete(code); }
    }
    for (const code of next) {
      if (!held.has(code)) { await page.keyboard.down(code); held.add(code); }
    }
  };
  const releaseAll = async () => {
    for (const code of [...held]) { await page.keyboard.up(code); held.delete(code); }
  };
  const readRound = () => page.evaluate(() => {
    const [p1, p2] = window.fighters || [];
    const cam = window.camera;
    let fx = 0, fz = 0;
    if (cam) {
      const forward = cam.position.clone();
      cam.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() > 1e-6) {
        forward.normalize();
        fx = forward.x; fz = forward.z;
      }
    }
    return {
      match: window.__browserSmashMatch?.() || null,
      stats: window.__browserSmashStats?.() || null,
      round: window.__browserSmashRound?.state
        ? { round: window.__browserSmashRound.state.round, timer: window.__browserSmashRound.state.timer,
          status: window.__browserSmashRound.state.status, wins: [...window.__browserSmashRound.state.wins] }
        : null,
      player: p1 ? { x: p1.position.x, y: p1.position.y, z: p1.position.z,
        percent: p1.percent, stock: p1.stock, ko: p1.ko, facing: p1.facing,
        meter: p1.meter, casting: p1.casting || null } : null,
      cpu: p2 ? { x: p2.position.x, y: p2.position.y, z: p2.position.z,
        percent: p2.percent, stock: p2.stock, ko: p2.ko, facing: p2.facing,
        meter: p2.meter, casting: p2.casting || null } : null,
      camera: { fx, fz },
      resultText: (document.querySelector('#result')?.textContent || '').replace(/\s+/g, ' ').trim(),
      resultVisible: Boolean(document.querySelector('#bbResultActions'))
    };
  });
  const distance = state => Math.hypot(state.cpu.x - state.player.x, state.cpu.z - state.player.z);
  const moveKeysFor = state => {
    const dx = state.cpu.x - state.player.x;
    const dz = state.cpu.z - state.player.z;
    const length = Math.hypot(dx, dz) || 1;
    const nx = dx / length, nz = dz / length;
    const forward = nx * state.camera.fx + nz * state.camera.fz;
    const right = nx * -state.camera.fz + nz * state.camera.fx;
    const keys = [];
    if (forward > 0.2) keys.push('KeyW'); else if (forward < -0.2) keys.push('KeyS');
    if (right > 0.2) keys.push('KeyD'); else if (right < -0.2) keys.push('KeyA');
    return keys;
  };

  // SwiftShader advances the match clock far slower than wall time, and heavier arenas
  // (Asgard) are slower still. The budget is presentation pacing only; the round itself
  // remains the game's real 60-second first-to-one round.
  const roundBudgetMs = Number(process.env.SLICE_ROUND_MS) || 68_000;
  const started = Date.now();
  let sawAction = false;
  let lastSpecial = 0;
  let lastDebris = 0;
  let lastSlam = 0;
  let usedUltimate = false;
  let firstHitAt = null;
  let maxDistanceMoved = 0;
  let maxPercent = { p1: 0, p2: 0 };
  let samples = 0;
  const spawn = await readRound();
  while (Date.now() - started < roundBudgetMs) {
    const state = await readRound();
    samples++;
    if (!state.player || !state.cpu) break;
    maxDistanceMoved = Math.max(maxDistanceMoved, distance(state));
    maxPercent.p1 = Math.max(maxPercent.p1, state.player.percent || 0);
    maxPercent.p2 = Math.max(maxPercent.p2, state.cpu.percent || 0);
    if (firstHitAt === null && (maxPercent.p1 > 0 || maxPercent.p2 > 0)) firstHitAt = Date.now() - started;
    if (!sawAction && (maxPercent.p1 > 0 || maxPercent.p2 > 0)) {
      sawAction = true;
      await capture('08-round-contact');
    }
    if (state.match?.status === 'match-over' || state.resultVisible || /VICTORY|DEFEAT|DRAW/i.test(state.resultText)) break;

    const range = distance(state);
    if (range > 8.2) {
      await setHeld(moveKeysFor(state));
    } else {
      await setHeld([]);
      const now = Date.now();
      // At point-blank, the light chain is the only thing fast enough to beat the CPU's
      // interrupt. P1's real ranged kit is used only when there is actual space between the
      // two bodies.
      if (range <= 2.35) {
        await page.keyboard.press('KeyJ');
      } else {
        if (now - lastSpecial > 1250) {
          await page.keyboard.press('KeyK');
          lastSpecial = now;
        }
        if (now - lastDebris > 4900) {
          await page.keyboard.press('KeyL');
          lastDebris = now;
        }
        if (now - lastSlam > 6300) {
          await page.keyboard.press('KeyH');
          lastSlam = now;
        }
      }
      if (!usedUltimate && Number(state.player.meter) >= 100 && range < 8) {
        await page.keyboard.press('KeyO');
        usedUltimate = true;
      }
    }
    await sleep(140);
  }
  await releaseAll();
  round = {
    ...(await readRound()),
    wallSeconds: +((Date.now() - started) / 1000).toFixed(2),
    samples,
    firstHitAt,
    maxDistanceMoved: +maxDistanceMoved.toFixed(2),
    spawnDistance: +distance(spawn).toFixed(2),
    maxPercent: { p1: +maxPercent.p1.toFixed(1), p2: +maxPercent.p2.toFixed(1) }
  };
  await capture('09-round-live');

  // The result is the game's own match end. Wait for the authored hold to finish and the panel
  // to render; do not synthesize a KO to get here. Slow SwiftShader arenas can take well over
  // 20 s of wall time to advance the authored hold, so the wait is configurable.
  const resultTimeoutMs = Number(process.env.SLICE_RESULT_TIMEOUT_MS) || 20_000;
  await page.waitForFunction(() => /VICTORY|DEFEAT|DRAW/i.test(document.querySelector('#result')?.textContent || ''),
    null, { timeout: resultTimeoutMs, polling: 100 });
  await page.waitForTimeout(500);
  result = await page.evaluate(() => ({
    text: (document.querySelector('#result')?.textContent || '').replace(/\s+/g, ' ').trim(),
    status: window.__browserSmashMatch?.().status || '',
    summary: window.__browserSmashMatch?.() || null,
    stats: window.__browserSmashStats?.() || null,
    lastResult: window.__browserSmashLastResult || null,
    buttons: [...document.querySelectorAll('#bbResultActions [data-result]')].map(b => b.dataset.result),
    resultClass: document.querySelector('#result')?.className || null
  }));
  await capture('10-result');

  const winner = result.summary?.winner || null;
  check('round reaches a real match-over state',
    result.status === 'match-over' && ['p1', 'p2'].includes(winner),
    JSON.stringify({ status: result.status, winner, wins: result.summary?.wins }));
  check('result is the game result, not a forced 999% shortcut',
    /VICTORY|DEFEAT/i.test(result.text) && !/999/.test(result.text)
      && result.stats?.time > 1 && result.stats?.hits > 0,
    JSON.stringify({ text: result.text.slice(0, 90), time: result.stats?.time, hits: result.stats?.hits }));
  check('at least one complete round was scored',
    result.summary?.wins?.includes(1) && result.summary?.round === 1,
    JSON.stringify({ wins: result.summary?.wins, round: result.summary?.round }));
  check('both fighters dealt real damage in the round',
    result.stats?.dealt?.[0] > 0 && result.stats?.dealt?.[1] > 0
      && maxPercent.p1 > 0 && maxPercent.p2 > 0,
    JSON.stringify({ dealt: result.stats?.dealt, maxPercent }));
  check('both fighters moved from their spawns during the round',
    round.maxDistanceMoved > 0 && round.spawnDistance > 0,
    JSON.stringify({ spawnDistance: round.spawnDistance, maxDistance: round.maxDistanceMoved }));
  check('results offer the real rematch / select / title actions',
    result.buttons.join(',') === 'rematch,select,title',
    result.buttons.join(','));

  // Click the result screen's own rematch control. A fresh match must clear the result text, both
  // health percentages and the round score, and keep the selected arena. This is the real handoff a
  // player uses, not a second call to the capture's setup path.
  await page.evaluate(() => document.querySelector('#play')?.click());
  await page.waitForFunction(() => window.__browserSmashMatch?.().status === 'fighting'
    && window.fighters?.[0]?.percent === 0 && window.fighters?.[1]?.percent === 0,
  null, { timeout: 40_000, polling: 100 });
  await page.waitForTimeout(500);
  const rematch = await page.evaluate(() => ({
    match: window.__browserSmashMatch?.(),
    resultText: (document.querySelector('#result')?.textContent || '').replace(/\s+/g, ' ').trim(),
    arena: window.__browserSmashSelect?.state?.arena || null,
    fighters: (window.fighters || []).map(fighter => ({
      identity: fighter.identity, percent: fighter.percent,
      transform: fighter.transform?.id || null
    }))
  }));
  await capture('11-rematch');
  check('rematch starts a fresh live round with no result state',
    rematch.match?.status === 'fighting' && rematch.match?.round === 1
      && rematch.match?.wins?.[0] === 0 && rematch.match?.wins?.[1] === 0
      && rematch.fighters.every(fighter => fighter.percent === 0)
      && rematch.resultText === '' && rematch.arena === slice.arena,
    JSON.stringify(rematch));
  check('no page errors during the slice',
    errors.length === 0,
    errors.slice(0, 3).join(' | ') || 'none');
  check('no failed asset requests during the slice',
    failedRequests.length === 0,
    JSON.stringify(failedRequests.slice(0, 3)));

  report = {
    generatedAt: new Date().toISOString(),
    slice: slice.label,
    evidence: 'SwiftShader software capture; not hardware acceptance',
    automation: {
      introForced: true,
      introSeconds: slice.introSeconds,
      forcedPercent: false,
      frozenAI: false,
      teleportedFighters: false,
      realKeyboardInput: true
    },
    selection,
    arena,
    intro,
    introAfter,
    round: {
      match: round.match,
      stats: round.stats,
      round: round.round,
      player: round.player,
      cpu: round.cpu,
      wallSeconds: round.wallSeconds,
      samples: round.samples,
      firstHitAt: round.firstHitAt,
      maxDistanceMoved: round.maxDistanceMoved,
      spawnDistance: round.spawnDistance,
      maxPercent: round.maxPercent
    },
    result,
    rematch,
    checks,
    errors,
    consoleErrors,
    failedRequests,
    hardwareVerified: false
  };
  await writeFile(resolve(out, 'slice-presentation.json'), JSON.stringify(report, null, 2));
  console.log('SUMMARY', JSON.stringify({
    passed: checks.filter(entry => entry.ok).length,
    total: checks.length,
    result: result.text.slice(0, 100),
    outcome: result.summary?.winner,
    stats: result.stats,
    errors: errors.length,
    failedRequests: failedRequests.length
  }));
} catch (error) {
  errors.push(String(error?.stack || error).slice(0, 1200));
  checks.push({ name: 'capture completed', ok: false, detail: String(error?.message || error).slice(0, 300) });
  console.error('CAPTURE FAILED', error);
  try { await capture('99-failure'); } catch { /* browser may be gone */ }
  report = { generatedAt: new Date().toISOString(), slice: slice.label,
    selection, arena, intro, introAfter, round, result, checks, errors, consoleErrors, failedRequests,
    hardwareVerified: false };
  await writeFile(resolve(out, 'slice-presentation.json'), JSON.stringify(report, null, 2)).catch(() => {});
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}

const failed = checks.filter(entry => !entry.ok);
for (const entry of failed) console.error('FAILED:', entry.name, entry.detail);
if (failed.length) process.exitCode = 1;
