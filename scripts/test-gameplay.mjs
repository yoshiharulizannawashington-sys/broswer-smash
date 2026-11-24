// End-to-end gameplay test. This drives the real game in a browser and asserts on the
// simulation state, not on screenshots: it selects fighters and an arena, starts a match,
// moves, double jumps, lands a punch, throws, wins rounds, switches arenas, and checks that
// local two-player input reaches the second fighter.
//
// Game time is advanced with window.__browserSmashStep() rather than wall-clock sleeps,
// because CI renders this scene in software at a few frames per second.
//
// node scripts/test-gameplay.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();

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
    // The optional model-import API only exists behind the Vite plugin. A static host answers 404,
    // which Chromium logs as a console error and which made "no console errors" fail for a URL the
    // game is designed to survive without. Answer it with an empty catalogue, as the plugin does.
    if (pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sources: [], roster: { launch: [], manifestKeys: [] } }));
      return;
    }
    let relative = normalize(pathname).replace(/^[/\\]+/, '');
    if (!relative) relative = 'index.html';
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

const results = [];
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  results.push(name);
  console.log(`  ok  ${name}`);
}

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180_000);
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', error => errors.push(error.stack || String(error)));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  // Serve Three.js from node_modules so the test does not depend on the CDN.
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

  const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
    null, { timeout: 120_000, polling: 200 });

  // ---- Match setup screen -------------------------------------------------
  // The game boots to the title screen; VERSUS is the real entry point into fighter select.
  await page.click('#menu [data-nav="versus"]');
  await page.waitForSelector('#selectScreen .bs-card', { state: 'visible' });
  const setup = await page.evaluate(() => ({
    step1: !document.querySelector('.bs-step[data-step="1"]').hidden,
    screenVisible: getComputedStyle(document.querySelector('#selectScreen')).display !== 'none',
    cards: document.querySelectorAll('#selectScreen .bs-card').length,
    launch: window.characterRosters?.launch?.length || 0,
    fighters: [...document.querySelectorAll('#selectScreen .bs-card')].map(card => card.dataset.fighter),
    arenas: document.querySelectorAll('#selectScreen .bs-arena').length
  }));
  check('selection screen opens on the fighter step', setup.step1 && setup.screenVisible, JSON.stringify({ step1: setup.step1, visible: setup.screenVisible }));
  // Held to the roster the page itself publishes, so adding a fighter cannot pass by
  // shrinking the list and cannot fail just because the launch roster grew.
  check('every launch roster fighter is selectable', setup.cards === setup.launch && setup.launch >= 32,
    `${setup.cards} cards for ${setup.launch} launch fighters`);
  check('Iron Spider is selectable alongside Iron Man',
    setup.fighters.includes('Iron Spider') && setup.fighters.includes('Iron Man (Tony Stark)'),
    setup.fighters.filter(name => /spider|iron man/i.test(name)).join(', '));
  check('all arenas are selectable', setup.arenas >= 10, `${setup.arenas} arenas`);

  await page.screenshot({ path: 'artifacts/select-fighters.png' });
  await page.click('#selectScreen .bs-card[data-fighter="Goku"]');
  await page.click('#selectScreen .bs-card[data-fighter="Vegeta"]');
  await page.click('#selectScreen [data-nav="next"]');
  check('choosing fighters advances to the arena step',
    await page.evaluate(() => !document.querySelector('.bs-step[data-step="2"]').hidden));
  await page.screenshot({ path: 'artifacts/select-arena.png' });

  await page.click('#selectScreen .bs-arena[data-arena="tournament"]');
  const chosen = await page.evaluate(() => ({
    arena: document.querySelector('#menuMapSelect').value,
    fighters: window.fighters.map(f => f.identity)
  }));
  check('fighter picks drive the live game', chosen.fighters.join('|') === 'Goku|Vegeta', chosen.fighters.join('|'));
  check('arena pick drives the live map', chosen.arena === 'tournament');
  check('arena step shows the start button', await page.isVisible('#play'));

  await page.click('#play');
  await step(0.05);
  const spawn = await page.evaluate(() => ({
    match: window.__browserSmashMatch(),
    p1: window.fighters[0].position.toArray(),
    gap: window.fighters[0].position.distanceTo(window.fighters[1].position),
    percents: window.fighters.map(f => f.percent),
    ground: window.fighters.map(f => f.groundLevel)
  }));
  check('a match starts in the chosen arena', spawn.match.arena === 'tournament');
  check('both fighters spawn apart', spawn.gap > 5, `gap ${spawn.gap.toFixed(2)}`);
  check('round 1 begins with the clock running', spawn.match.round === 1 && spawn.match.timer > 0);
  check('percent starts at zero', spawn.percents.every(value => value === 0));
  check('the ring floor is the stage height', Math.abs(spawn.ground[0] - 0.18) < 0.01, String(spawn.ground[0]));

  // ---- Movement -----------------------------------------------------------
  // Movement is camera-relative, so the axis a strafe key produces depends on where the select
  // screen left the camera. Assert the distance actually travelled, not one world axis.
  const startPos = await page.evaluate(() => window.fighters[0].position.toArray());
  await page.keyboard.down('d');
  await step(0.7);
  await page.keyboard.up('d');
  const endPos = await page.evaluate(() => window.fighters[0].position.toArray());
  const walked = Math.hypot(endPos[0] - startPos[0], endPos[2] - startPos[2]);
  check('P1 moves with the keyboard', walked > 1.2, `moved ${walked.toFixed(2)}m`);

  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('w');
  await step(0.35);
  await page.keyboard.up('w');
  await page.keyboard.up('ShiftLeft');
  const sprint = await page.evaluate(() => Math.hypot(window.fighters[0].velocity.x, window.fighters[0].velocity.z));
  check('sprinting reaches run speed', sprint > 5, sprint.toFixed(2));

  // ---- Jump and double jump ----------------------------------------------
  // The CPU is stood down here, not only for the punch section below: a live opponent can juggle
  // the player out of the double jump, and then "landed" is false for a reason the assertion is
  // not about. A frame-by-frame trace of the same double jump (scripts/probe-jump.mjs) touches
  // down 1.1 s after the second press with the jump counter reset.
  await page.evaluate(() => { window.__browserSmashTrainingDummy = true; });
  await page.evaluate(() => {
    const p = window.fighters[0];
    p.position.set(0, p.groundLevel, -12);
    p.velocity.set(0, 0, 0);
    p.hitstun = 0;
  });
  await page.keyboard.press('Space');
  await step(0.1);
  const firstJump = await page.evaluate(() => ({ y: window.fighters[0].position.y, jumps: window.fighters[0].jumps }));
  check('SPACE launches the fighter', firstJump.y > 0.4, `y=${firstJump.y.toFixed(2)}`);
  check('the first jump is counted', firstJump.jumps === 1);
  await step(0.15);
  const beforeSecond = await page.evaluate(() => window.fighters[0].position.y);
  await page.keyboard.press('Space');
  await step(0.08);
  const doubleJump = await page.evaluate(() => ({
    y: window.fighters[0].position.y, jumps: window.fighters[0].jumps, vy: window.fighters[0].velocity.y
  }));
  check('a second jump is allowed in the air', doubleJump.jumps === 2);
  check('the double jump adds height or upward speed', doubleJump.y > beforeSecond || doubleJump.vy > 0,
    `y=${doubleJump.y.toFixed(2)} vy=${doubleJump.vy.toFixed(2)}`);
  // Poll for the touchdown rather than sampling one instant: a fixed wait raced whatever else
  // was in flight (a landed fighter with jumps already reset read as "not grounded" because it
  // had been lifted again). Bounded, so a fighter that never lands still fails.
  let landed = { grounded: false, jumps: -1 };
  for (let i = 0; i < 30; i++) {
    await step(0.1);
    landed = await page.evaluate(() => ({ grounded: window.fighters[0].isGrounded, jumps: window.fighters[0].jumps }));
    if (landed.grounded && landed.jumps === 0) break;
  }
  check('landing resets the jump count', landed.grounded === true && landed.jumps === 0,
    JSON.stringify(landed));

  // ---- Punch lands and deals damage --------------------------------------
  // The CPU is a training dummy for these checks: a live opponent blocks, dodges and
  // parries at random, which is correct in a match but makes hit assertions flaky.
  await page.evaluate(() => { window.__browserSmashTrainingDummy = true; });
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(0, p1.groundLevel, -12);
    p1.velocity.set(0, 0, 0); p1.attackQueue.length = 0; p1.comboWindow = 0;
    p1.facing = 1; p1.facingZ = 0;
    p2.position.set(1.05, p2.groundLevel, -12);
    p2.velocity.set(0, 0, 0);
    p2.percent = 0; p2.hitstun = 0; p2.invulnerable = 0; p2.guardHeld = false;
    window.fighters[1].aiTimer = 999;
  });
  await page.keyboard.press('j');
  await step(0.14);
  const punch = await page.evaluate(() => ({
    percent: window.fighters[1].percent,
    hitstun: window.fighters[1].hitstun,
    combo: window.fighters[0].comboHitCount
  }));
  check('J lands a hit and raises damage', punch.percent > 0, `${punch.percent.toFixed(1)}%`);
  check('a landed hit applies hit stun', punch.hitstun > 0, `${punch.hitstun.toFixed(2)}s`);
  check('a landed hit counts as a combo hit', punch.combo >= 1);
  const cleanHitPercent = punch.percent;

  // Three presses inside the chain window must build a combo.
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(0, p1.groundLevel, -12); p1.velocity.set(0, 0, 0);
    p1.attackQueue.length = 0; p1.comboStep = 0; p1.comboWindow = 0;
    p1.facing = 1; p1.facingZ = 0;
    p2.position.set(1.05, p2.groundLevel, -12); p2.velocity.set(0, 0, 0);
    p2.percent = 0; p2.hitstun = 0; p2.invulnerable = 0; p2.guardHeld = false;
    window.fighters[1].aiTimer = 999;
  });
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('j');
    await step(0.42);
    await page.evaluate(() => {
      const [p1, p2] = window.fighters;
      p1.position.set(0, p1.groundLevel, -12);
      p2.position.set(1.05, p2.groundLevel, -12);
      p2.hitstun = 0; p2.invulnerable = 0; p2.percent = Math.min(60, p2.percent);
    });
  }
  const combo = await page.evaluate(() => ({
    hits: window.fighters[0].comboHitCount,
    percent: window.fighters[1].percent
  }));
  check('a three-hit string chains', combo.hits >= 2, `${combo.hits} hits`);

  // ---- Guard --------------------------------------------------------------
  await page.keyboard.down('e');
  await step(0.1);
  const p1Guarding = await page.evaluate(() => ({
    held: window.fighters[0].guardHeld,
    breakTimer: window.fighters[0].guardBreak
  }));
  await page.keyboard.up('e');
  check('holding E raises P1 guard', p1Guarding.held === true, JSON.stringify(p1Guarding));

  // ---- Throw --------------------------------------------------------------
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(0, p1.groundLevel, -12);
    p1.velocity.set(0, 0, 0); p1.attackQueue.length = 0; p1.grabCooldown = 0;
    p1.facing = 1; p1.facingZ = 0;
    p2.position.set(1.0, p2.groundLevel, -12);
    p2.velocity.set(0, 0, 0); p2.percent = 20; p2.hitstun = 0; p2.guardHeld = false;
  });
  await page.keyboard.press('u');
  await step(0.4);
  const throwState = await page.evaluate(() => ({
    percent: window.fighters[1].percent,
    vy: window.fighters[1].velocity.y,
    stun: window.fighters[1].hitstun
  }));
  check('U throws the opponent', throwState.percent > 20, `${throwState.percent.toFixed(1)}%`);
  check('a throw launches the opponent', throwState.vy > 4 || throwState.stun > 0.6,
    `vy=${throwState.vy.toFixed(2)} stun=${throwState.stun.toFixed(2)}`);

  // ---- Round and match flow ----------------------------------------------
  await page.evaluate(() => { window.fighters[1].percent = 999; });
  await step(0.1);
  const roundOne = await page.evaluate(() => window.__browserSmashMatch());
  check('a KO awards the round', roundOne.wins[0] === 1, JSON.stringify(roundOne.wins));
  check('the series continues after one round', roundOne.status !== 'match-over');

  await step(2.2);
  const roundTwo = await page.evaluate(() => ({
    match: window.__browserSmashMatch(),
    percents: window.fighters.map(f => f.percent),
    gap: window.fighters[0].position.distanceTo(window.fighters[1].position)
  }));
  check('round 2 starts automatically', roundTwo.match.round === 2 && roundTwo.match.status === 'fighting');
  check('damage resets between rounds', roundTwo.percents.every(value => value === 0));
  check('fighters respawn apart', roundTwo.gap > 5, `gap ${roundTwo.gap.toFixed(2)}`);

  await page.evaluate(() => { window.fighters[1].percent = 999; });
  await step(0.2);
  // The staged victory shot owns the lens before the panel is written, so 0.2 s after the KO the
  // result is deliberately still empty. Assert that for the right reason, then walk the hold.
  const presentation = await page.evaluate(() => ({
    hold: window.__browserSmashVictoryState?.().hold ?? 0,
    resultDuringHold: document.querySelector('#result').textContent.trim(),
    status: window.__browserSmashMatch().status
  }));
  check('the match is decided before the result panel is written', presentation.status === 'match-over');
  check('the staged hold keeps the result panel back', presentation.hold > 0 && presentation.resultDuringHold === '',
    JSON.stringify(presentation));
  const finished = await page.evaluate(() => {
    // Advance the fixed step through the celebration; simulationStep() calls finish() at zero.
    for (let i = 0; i < 240 && (window.__browserSmashVictoryState?.().hold ?? 0) > 0; i += 1) window.__browserSmashStep(1 / 60);
    return {
      match: window.__browserSmashMatch(),
      result: document.querySelector('#result').textContent,
      menuVisible: !document.querySelector('#menu').classList.contains('hidden'),
      holding: window.__browserSmashVictoryState?.().hold ?? null
    };
  });
  check('the victory hold hands the frame to the result panel', finished.holding === 0);
  // The menu fades in over 0.4 s; a screenshot taken at frame zero is a blank arena.
  await page.waitForTimeout(500);
  const resultVisibility = await page.evaluate(() => {
    const panel = document.querySelector('#result');
    const rect = panel.getBoundingClientRect();
    const centre = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return {
      menuOpacity: Number(getComputedStyle(document.querySelector('#menu')).opacity),
      width: Math.round(rect.width), height: Math.round(rect.height),
      hit: Boolean(centre?.closest('#result')), text: panel.textContent.trim().slice(0, 40)
    };
  });
  check('the result panel is actually on screen, not just in the DOM',
    resultVisibility.hit === true && resultVisibility.menuOpacity > 0.95
      && resultVisibility.width >= 300 && resultVisibility.height >= 80,
    JSON.stringify(resultVisibility));
  await page.screenshot({ path: 'artifacts/result-victory.png' });
  check('winning two rounds ends the match', finished.match.status === 'match-over' && finished.match.winner === 'p1');
  check('the result screen names the winner', /VICTORY/.test(finished.result), finished.result);
  check('the menu returns for a rematch', finished.menuVisible);

  // ---- Arena switching ----------------------------------------------------
  const arenaChange = await page.evaluate(() => {
    window.__browserSmashSelect.chooseArena('hogwarts');
    const bounds = window.fighters[0].bounds;
    return {
      arena: window.__browserSmashMatch().arena,
      select: document.querySelector('#mapSelect').value,
      width: bounds.x1 - bounds.x0,
      depth: bounds.z1 - bounds.z0
    };
  });
  check('selecting an arena switches the live map', arenaChange.select === 'hogwarts' && arenaChange.arena === 'hogwarts');
  check('the playable area comes from that arena', arenaChange.depth > 80 && arenaChange.width > 35,
    `${arenaChange.width.toFixed(0)} x ${arenaChange.depth.toFixed(0)}`);

  // Collision in the arena that was just loaded: the house tables are solid.
  const collision = await page.evaluate(() => {
    document.querySelector('#play').click();
    window.__browserSmashStep(0.02);
    const p = window.fighters[0];
    p.position.set(-12, 0, -20);
    window.__browserSmashStep(0.05);
    return { x: p.position.x, z: p.position.z, y: p.position.y };
  });
  check('arena collision pushes a fighter out of a solid table',
    Math.hypot(collision.x + 12, collision.z + 20) > 0.8, JSON.stringify(collision));

  // ---- Local two-player ---------------------------------------------------
  await page.evaluate(() => {
    window.__browserSmashSelect.setMode('2p');
    document.querySelector('#play').click();
  });
  await step(0.05);
  const modeState = await page.evaluate(() => window.__browserSmashMatch());
  check('local two-player mode starts a match', modeState.mode === '2p' && modeState.status === 'fighting');
  check('the setup screen closes when the match starts',
    await page.evaluate(() => document.querySelector('#menu').classList.contains('hidden')));

  // P2 input is camera-relative (cameraP2Input), so "left" is left of the lens, not world -X.
  // Measure the ground distance actually travelled, not a single world axis.
  const p2Start = await page.evaluate(() => ({ x: window.fighters[1].position.x, z: window.fighters[1].position.z }));
  await page.keyboard.down('ArrowLeft');
  await step(0.7);
  await page.keyboard.up('ArrowLeft');
  const p2Moved = await page.evaluate(() => ({ x: window.fighters[1].position.x, z: window.fighters[1].position.z }));
  const p2Distance = Math.hypot(p2Moved.x - p2Start.x, p2Moved.z - p2Start.z);
  check('player 2 steers with the arrow keys', p2Distance > 1.0, `moved ${p2Distance.toFixed(2)}m`);

  await page.keyboard.press(',');
  await step(0.05);
  const p2Attack = await page.evaluate(() => ({
    queue: window.fighters[1].attackQueue.length,
    pose: window.fighters[1].attackPose
  }));
  check('player 2 attacks with ,', p2Attack.queue > 0 || p2Attack.pose > 0, JSON.stringify(p2Attack));

  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(0, p1.groundLevel, -12); p1.velocity.set(0, 0, 0);
    p1.attackQueue.length = 0; p1.comboWindow = 0; p1.facing = 1; p1.facingZ = 0;
    p1.hitstun = 0; p1.guardBreak = 0; p1.attackBuffer = 0; p1.invulnerable = 0;
    p2.position.set(1.05, p2.groundLevel, -12); p2.velocity.set(0, 0, 0);
    p2.percent = 0; p2.hitstun = 0; p2.guardBreak = 0; p2.guardHeld = false; p2.attackQueue.length = 0;
  });
  // Guard is measured on a clean 2P match: the preceding blocks leave forced KOs, hit-stop and
  // drawn shield on the same bodies, and any of those makes the probe measure stale state.
  await page.evaluate(() => document.querySelector('#play').click());
  await page.evaluate(() => {
    window.__browserSmashStep(0.05);
    const [p1, p2] = window.fighters;
    p1.position.set(0, p1.groundLevel, -12); p1.velocity.set(0, 0, 0);
    p1.hitstun = 0; p1.attackQueue.length = 0; p1.attackBuffer = 0;
    p2.position.set(1.05, p2.groundLevel, -12); p2.velocity.set(0, 0, 0);
    p2.percent = 0; p2.hitstun = 0; p2.guardBreak = 0; p2.shield = 100;
    p2.attackQueue.length = 0; p2.attackBuffer = 0;
  });
  await page.keyboard.down(';');
  await step(0.25);
  // Hold past the 0.22s tap-to-parry window: this is a guard, not a parry.
  await step(0.45);
  // Clear the stray hit P2's earlier attack left on P1 so this is a clean guard check.
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.hitstun = 0; p1.invulnerable = 0; p1.attackQueue.length = 0; p1.attackBuffer = 0; p1.hitboxes.length = 0;
    p1.position.set(0, p1.groundLevel, -12); p1.velocity.set(0, 0, 0);
    p2.position.set(1.05, p2.groundLevel, -12); p2.velocity.set(0, 0, 0);
    p2.percent = 0; p2.attackQueue.length = 0; p2.attackBuffer = 0;
    p2.comboWindow = 0; p2.comboStep = 0; p2.hitboxes.length = 0;
    // Guard is a resource: earlier combat in this match can drain the shield, and an empty
    // shield makes guardHeld false no matter what key is held. Restore it for a clean guard test.
    p2.shield = 100; p2.guardRegenDelay = 0;
    // A forced KO earlier in the suite leaves the body flagged; a downed fighter cannot guard.
    p2.ko = false; p2.down = false;
    // A stale grab from an earlier block returns from simulate() before guard is computed.
    p2.grabbedBy = null; p2.grabTarget = null; p2.grabHold = 0; p2.grabEscapeTimer = 0;
  });
  // One fixed step computes guard from the held key before contact. Without it the jab lands on
  // the first frame after the probe cleared guardHeld, and the resulting hit-stop freezes the
  // simulation before guard can be recomputed.
  await page.evaluate(() => window.__browserSmashStep(1 / 60));
  await page.keyboard.press('j');
  await step(0.2);
  // Let the impact freeze finish so the guarded frame is the one measured.
  await page.evaluate(() => { for (let i = 0; i < 90 && (window.__browserSmashHitStop?.() || 0) > 0; i += 1) window.__browserSmashStep(1 / 60); });
  const guarded = await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    const trace = [];
    window.__browserSmashInputTrace = (body, inputs) => trace.push({
      who: body.identityKey || body.identity || '?',
      isP2: body === p2,
      shield: Boolean(inputs.shield),
      guardHeld: body.guardHeld
    });
    window.__browserSmashStep(1 / 60);
    window.__browserSmashInputTrace = null;
    return {
      trace: trace.slice(-6),
      guard: p2.guardHeld,
      percent: p2.percent,
      debug: {
        p1pos: p1.position.toArray(), p2pos: p2.position.toArray(),
        facing: [p1.facing, p1.facingZ], queue: p1.attackQueue.length,
        stun: p1.hitstun, buffer: p1.attackBuffer, p2stun: p2.hitstun,
        shield: p2.shield, guardBreak: p2.guardBreak, ko: p2.ko,
        inputs: window.__browserSmashInputs?.(2) || null,
        grabbedBy: Boolean(p2.grabbedBy), grabHold: p2.grabHold, state: p2.state, started: window.__browserSmashVictoryState?.().started,
        hitStop: window.__browserSmashHitStop?.(),
        control: window.__browserSmashControlMode?.(),
        mode: window.__browserSmashMatch().mode
      }
    };
  });
  await page.keyboard.up(';');
  check('P2 holds guard with ;', guarded.guard === true, JSON.stringify(guarded.debug));
  check('guarding cuts damage', guarded.percent > 0 && guarded.percent < cleanHitPercent,
    `guarded ${guarded.percent.toFixed(1)}% vs clean ${cleanHitPercent.toFixed(1)}% ${JSON.stringify(guarded.debug)}`);

  await page.keyboard.press('k');
  await step(0.1);
  const p1Special = await page.evaluate(() => ({
    cooldown: window.fighters[0].specialCooldown,
    label: window.fighters[0].specialProfile?.label
  }));
  check('player 1 can fire a signature move', p1Special.cooldown > 0, p1Special.label);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'artifacts/match-hogwarts-2p.png' });

  // ---- Pause menu, match rules and CPU skill -------------------------------
  // The pause menu has to stop time, not just draw a panel: a paused match that keeps counting
  // down, drifting a projectile or swallowing a queued attack is a bug players feel at once.
  const skillSelect = await page.evaluate(() => {
    window.__browserSmashSelect.setMode('1p');
    const select = document.querySelector('#selectScreen [data-rule="difficulty"]');
    const enabledIn1p = !select.disabled;
    select.value = 'ace';
    select.dispatchEvent(new Event('change'));
    window.__browserSmashSelect.setMode('2p');
    const disabledIn2p = select.disabled;
    window.__browserSmashSelect.setMode('1p');
    return { enabledIn1p, disabledIn2p, level: window.__browserSmashCpuSkill() };
  });
  check('the setup screen exposes CPU skill for a CPU match', skillSelect.enabledIn1p);
  check('CPU skill is disabled with no CPU opponent', skillSelect.disabledIn2p);
  check('choosing ACE in the setup screen reaches the live AI',
    skillSelect.level.level === 'ace' && skillSelect.level.block > 0.8 && skillSelect.level.cooldown < 0.5,
    JSON.stringify(skillSelect.level));

  const rulesApplied = await page.evaluate(() => {
    const select = document.querySelector('#selectScreen [data-rule="rounds"]');
    select.value = '3';
    select.dispatchEvent(new Event('change'));
    const timer = document.querySelector('#selectScreen [data-rule="timer"]');
    timer.value = '120';
    timer.dispatchEvent(new Event('change'));
    return { live: window.__browserSmashRules(), ui: window.__browserSmashSelect.state.rules };
  });
  check('the rounds control reaches the live series',
    rulesApplied.live.roundsToWin === 3 && rulesApplied.ui.roundsToWin === 3, JSON.stringify(rulesApplied));
  check('the round timer control reaches the live series',
    rulesApplied.live.roundSeconds === 120 && rulesApplied.ui.roundSeconds === 120, JSON.stringify(rulesApplied));

  await page.evaluate(() => document.querySelector('#play').click());
  await step(0.3);
  const rulesLive = await page.evaluate(() => ({ match: window.__browserSmashMatch(), timer: window.__browserSmashMatch().timer }));
  check('a new series uses the chosen rules', rulesLive.match.roundsToWin === 3, JSON.stringify(rulesLive.match));
  check('the round clock starts from the chosen length', rulesLive.timer > 118 && rulesLive.timer <= 120, String(rulesLive.timer));

  await page.keyboard.press('Escape');
  const pausedAt = await page.evaluate(() => ({
    paused: window.__browserSmashPause.paused,
    menu: window.__browserSmashPause.menuOpen,
    timer: window.__browserSmashMatch().timer,
    positions: window.fighters.map(f => f.position.toArray()),
    stats: window.__browserSmashPause.stats
  }));
  check('Escape opens the pause menu', pausedAt.paused === true && pausedAt.menu === true);
  check('the pause menu reports the live series', /ROUND/.test(pausedAt.stats) && /FIRST TO/.test(pausedAt.stats), pausedAt.stats);
  check('the pause menu names the CPU skill', /ACE/.test(pausedAt.stats), pausedAt.stats);
  const audioPaused = await page.evaluate(() => window.combatAudio?.paused);
  check('combat audio is suspended while paused', audioPaused === true, String(audioPaused));

  // Every pause control has to do something: a menu of dead buttons is worse than no menu.
  const mutedViaUI = await page.evaluate(() => {
    const button = document.querySelector('#pauseMenu [data-action="mute"]');
    const before = window.combatAudio.muted;
    button.click();
    const after = window.combatAudio.muted;
    const label = button.textContent;
    button.click();
    return { before, after, restored: window.combatAudio.muted, label };
  });
  check('the pause menu mute button silences and restores the mix',
    mutedViaUI.before === false && mutedViaUI.after === true && mutedViaUI.restored === false,
    JSON.stringify(mutedViaUI));
  const volumeViaUI = await page.evaluate(() => {
    const slider = document.querySelector('#pauseMenu [data-role="volume"]');
    slider.value = '0.2';
    slider.dispatchEvent(new Event('input'));
    const level = window.combatAudio.volume;
    slider.value = '0.55';
    slider.dispatchEvent(new Event('input'));
    return { level, restored: window.combatAudio.volume };
  });
  check('the pause menu volume slider drives the mixer',
    Math.abs(volumeViaUI.level - 0.2) < 0.001 && Math.abs(volumeViaUI.restored - 0.55) < 0.001,
    JSON.stringify(volumeViaUI));

  // Hold a movement key and an attack while paused: neither may reach the simulation.
  await page.keyboard.down('d');
  await page.keyboard.press('j');
  await step(0.6);
  await page.keyboard.up('d');
  const stillPaused = await page.evaluate(() => ({
    timer: window.__browserSmashMatch().timer,
    positions: window.fighters.map(f => f.position.toArray()),
    queue: window.fighters[0].attackQueue.length,
    percent: window.fighters[1].percent
  }));
  check('a paused match does not advance the clock',
    Math.abs(stillPaused.timer - pausedAt.timer) < 0.001, `${pausedAt.timer.toFixed(2)} -> ${stillPaused.timer.toFixed(2)}`);
  check('a paused match does not move the fighters',
    stillPaused.positions.every((p, i) => Math.abs(p[0] - pausedAt.positions[i][0]) < 0.001
      && Math.abs(p[2] - pausedAt.positions[i][2]) < 0.001), JSON.stringify(stillPaused.positions));
  check('keys pressed while paused do not reach the fight', stillPaused.queue === 0 && stillPaused.percent === 0,
    `queue=${stillPaused.queue} cpu=${stillPaused.percent}`);
  await page.screenshot({ path: 'artifacts/pause-menu.png' });

  await page.click('#pauseMenu [data-action="resume"]');
  await step(0.3);
  const resumed = await page.evaluate(() => ({
    paused: window.__browserSmashPause.paused,
    menu: window.__browserSmashPause.menuOpen,
    timer: window.__browserSmashMatch().timer,
    audio: window.combatAudio?.paused
  }));
  check('the resume button returns to the fight', resumed.paused === false && resumed.menu === false);
  check('the clock runs again after resuming', resumed.timer < pausedAt.timer,
    `${pausedAt.timer.toFixed(2)} -> ${resumed.timer.toFixed(2)}`);
  check('audio resumes with the match', resumed.audio === false);

  await page.evaluate(() => window.__browserSmashPause.open());
  await page.click('#pauseMenu [data-action="restart"]');
  const restarted = await page.evaluate(() => ({
    match: window.__browserSmashMatch(), paused: window.__browserSmashPause.paused, menu: window.__browserSmashPause.menuOpen
  }));
  check('restart returns the series to round 1 at 0 - 0',
    restarted.match.round === 1 && restarted.match.wins.join(',') === '0,0' && restarted.match.status === 'fighting',
    JSON.stringify(restarted.match));
  check('restart closes the pause screen', restarted.paused === false && restarted.menu === false);

  await page.evaluate(() => window.__browserSmashPause.open());
  await page.click('#pauseMenu [data-action="select"]');
  const quitSelect = await page.evaluate(() => ({
    paused: window.__browserSmashPause.paused,
    menuVisible: !document.querySelector('#menu').classList.contains('hidden'),
    selectVisible: !document.querySelector('#selectScreen').hidden,
    fighters: window.fighters.length
  }));
  check('character select from the pause menu returns to match setup',
    quitSelect.menuVisible && quitSelect.selectVisible && quitSelect.paused === false, JSON.stringify(quitSelect));

  await page.evaluate(() => document.querySelector('#play').click());
  await step(0.1);
  await page.evaluate(() => window.__browserSmashPause.open());
  await page.click('#pauseMenu [data-action="title"]');
  const quitTitle = await page.evaluate(() => ({
    paused: window.__browserSmashPause.paused,
    menuVisible: !document.querySelector('#menu').classList.contains('hidden'),
    hosting: document.querySelector('#menu .panel').classList.contains('bs-hosting'),
    playVisible: !document.querySelector('#play').hidden,
    // The modern title is #bbTitle inside the panel; the old .panel > .title block was removed
    // in Part 10, so reading it returned null and crashed the probe.
    titleShown: (() => { const title = document.querySelector('#bbTitle'); return Boolean(title) && getComputedStyle(title).display !== 'none'; })(),
    titleNav: [...document.querySelectorAll('#bbTitle [data-nav]')].map(button => button.dataset.nav)
  }));
  check('return to title shows the title screen again',
    quitTitle.menuVisible && quitTitle.hosting === false && quitTitle.titleShown === true, JSON.stringify(quitTitle));
  // #play lives back in the hidden adapter host after quit-to-title, so its own hidden flag is
  // not evidence of a start path. The modern title entry is VERSUS, and the setup screen owns the
  // start control after that.
  check('the title screen still has a way to start a match',
    quitTitle.titleShown === true && quitTitle.titleNav.includes('versus'), JSON.stringify(quitTitle.titleNav));

  // Back into a fresh match so the framing checks below run against a live fight.
  await page.click('#bbTitle [data-nav="versus"]');
  await page.evaluate(() => document.querySelector('#play').click());
  await step(0.2);
  check('the title screen starts a match again',
    await page.evaluate(() => window.__browserSmashMatch().status === 'fighting'));

  // ---- Result screen statistics ------------------------------------------
  // The result screen used to be one line of text. The numbers below are the ones the match
  // actually produced, accumulated by the simulation, not decorative copy.
  await page.evaluate(() => window.__browserSmashSetRules({ roundsToWin: 2 }));
  await page.evaluate(() => document.querySelector('#play').click());
  await step(0.3);
  await page.evaluate(() => { window.fighters[1].percent = 90; });
  await step(0.2);
  await page.evaluate(() => { window.fighters[1].percent = 999; });
  await step(0.2);
  await page.evaluate(() => { window.fighters[1].percent = 999; });
  await step(2.4);
  await page.evaluate(() => { window.fighters[1].percent = 999; });
  // The presentation holds the authored victory clip before the panel appears; wait for the
  // panel's own text instead of assuming it is on screen 0.4 s after the KO.
  // Step through the staged hold (the presentation owns the lens and the sim is frozen) until the
  // panel is actually written, then read it.
  await page.evaluate(() => {
    for (let i = 0; i < 900; i += 1) {
      const state = window.__browserSmashVictoryState?.();
      if (state && state.hold === 0 && document.querySelector('#result')?.textContent.trim()) break;
      window.__browserSmashStep(1 / 60);
    }
  });
  const resultScreen = await page.evaluate(() => ({
    text: document.querySelector('#result').textContent,
    menuVisible: !document.querySelector('#menu').classList.contains('hidden'),
    stats: window.__browserSmashStats(),
    match: window.__browserSmashMatch(),
    victory: window.__browserSmashVictoryState?.()
  }));
  check('the result screen names the winner', /VICTORY/.test(resultScreen.text), `${(resultScreen.text || '').slice(0, 60)} :: ${JSON.stringify(resultScreen.match)} :: ${JSON.stringify(resultScreen.victory)}`);
  check('the result screen reports the series and the clock',
    /ROUNDS/.test(resultScreen.text) && /MATCH TIME/.test(resultScreen.text), resultScreen.text);
  check('the result screen reports real match statistics',
    /DAMAGE DEALT/.test(resultScreen.text) && /BIGGEST HIT/.test(resultScreen.text)
      && /HITS LANDED/.test(resultScreen.text), resultScreen.text);
  check('the reported damage matches the damage the match recorded',
    /DAMAGE DEALT\s*\d+%/.test(resultScreen.text) && resultScreen.stats.dealt[0] > 0,
    `${JSON.stringify(resultScreen.stats.dealt)} — ${resultScreen.text}`);
  await page.screenshot({ path: 'artifacts/result-screen.png' });

  // ---- Training mode ------------------------------------------------------
  // The result actions return to the modern title, whose TRAINING entry starts practice. Clicking
  // the hidden adapter directly is not a user path and is not actionable for Playwright.
  await page.click('#bbResultActions [data-result="title"]');
  await page.click('#bbTitle [data-nav="training"]');
  await step(0.2);
  const trainingOpen = await page.evaluate(() => ({
    visible: window.__browserSmashTraining.panelVisible(),
    panel: !document.querySelector('#trainingPanel').hidden,
    dummy: window.__browserSmashTraining.state().dummy,
    menuHidden: document.querySelector('#menu').classList.contains('hidden')
  }));
  check('practice mode opens the training panel', trainingOpen.visible === true && trainingOpen.panel === true,
    JSON.stringify(trainingOpen));
  check('training starts against a standing dummy', trainingOpen.dummy === 'stand' && trainingOpen.menuHidden === true);

  // A dummy must not fight: over a full second it may not move, attack or damage the player.
  const dummyBefore = await page.evaluate(() => ({
    x: window.fighters[1].position.x, z: window.fighters[1].position.z, queue: window.fighters[1].attackQueue.length
  }));
  await step(1.2);
  const dummyAfter = await page.evaluate(() => ({
    x: window.fighters[1].position.x, z: window.fighters[1].position.z,
    queue: window.fighters[1].attackQueue.length, playerPercent: window.fighters[0].percent
  }));
  check('the training dummy does not move or attack on its own',
    Math.abs(dummyAfter.x - dummyBefore.x) < 0.05 && Math.abs(dummyAfter.z - dummyBefore.z) < 0.05
      && dummyAfter.queue === 0 && dummyAfter.playerPercent === 0, JSON.stringify(dummyAfter));

  // Land a hit and read the panel: the numbers have to come from the simulation.
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(0, p1.groundLevel, -12); p1.velocity.set(0, 0, 0);
    p1.facing = 1; p1.facingZ = 0; p1.attackQueue.length = 0; p1.comboWindow = 0;
    p2.position.set(1.05, p2.groundLevel, -12); p2.velocity.set(0, 0, 0); p2.percent = 0;
  });
  await page.keyboard.press('j');
  await step(0.2);
  const trainingHit = await page.evaluate(() => ({
    training: window.__browserSmashTraining.state(),
    readout: document.querySelector('#trainingPanel [data-read="dealt"]').textContent,
    dummyDamage: document.querySelector('#trainingPanel [data-read="dummyDamage"]').textContent
  }));
  check('the training panel counts the damage dealt',
    trainingHit.training.dealt > 0 && /%/.test(trainingHit.readout), JSON.stringify(trainingHit));
  check('the training panel reports the dummy damage total', /%/.test(trainingHit.dummyDamage), trainingHit.dummyDamage);

  await page.click('#trainingPanel [data-act="reset-damage"]');
  await step(0.1);
  const clearedTraining = await page.evaluate(() => ({
    training: window.__browserSmashTraining.state(), dummyPercent: window.fighters[1].percent
  }));
  check('resetting training damage clears the counters and the dummy',
    clearedTraining.training.dealt === 0 && clearedTraining.training.hits === 0 && clearedTraining.dummyPercent === 0,
    JSON.stringify(clearedTraining));

  await page.click('#trainingPanel [data-dummy="guard"]');
  await step(0.15);
  const guardDummy = await page.evaluate(() => ({
    dummy: window.__browserSmashTraining.state().dummy, hold: window.fighters[1].guardHeld
  }));
  check('the dummy can be told to hold guard', guardDummy.dummy === 'guard' && guardDummy.hold === true,
    JSON.stringify(guardDummy));

  await page.click('#trainingPanel [data-invuln]');
  await step(0.2);
  const invuln = await page.evaluate(() => ({
    on: window.__browserSmashTraining.state().invulnerable, flag: window.fighters[1].invulnerable
  }));
  check('the dummy can be made invulnerable', invuln.on === true && invuln.flag > 0, JSON.stringify(invuln));
  await page.click('#trainingPanel [data-invuln]');
  check('invulnerability can be switched back off',
    await page.evaluate(() => window.__browserSmashTraining.state().invulnerable === false));

  await page.evaluate(() => { window.fighters[0].position.set(4, window.fighters[0].groundLevel, 6); });
  await page.keyboard.press('r');
  await step(0.1);
  const positionsReset = await page.evaluate(() => ({
    gap: window.fighters[0].position.distanceTo(window.fighters[1].position)
  }));
  check('R puts both fighters back on the stage spawn points', positionsReset.gap > 5, String(positionsReset.gap.toFixed(2)));
  await page.screenshot({ path: 'artifacts/training-mode.png' });

  await page.click('#trainingPanel [data-act="exit"]');
  await step(0.1);
  const trainingClosed = await page.evaluate(() => ({
    visible: window.__browserSmashTraining.panelVisible(),
    menuVisible: !document.querySelector('#menu').classList.contains('hidden'),
    selectVisible: !document.querySelector('#selectScreen').hidden
  }));
  check('exiting training returns to the menu with no overlay left behind',
    trainingClosed.visible === false && trainingClosed.menuVisible === true && trainingClosed.selectVisible === true,
    JSON.stringify(trainingClosed));

  // ---- Camera framing -----------------------------------------------------
  // Exiting training lands on the menu, whose camera has no duel framing. Measure the gameplay
  // camera in a live match, which is what this assertion is about.
  await page.evaluate(() => document.querySelector('#play').click());
  await step(0.3);
  const camera = await page.evaluate(() => {
    const [a, b] = window.fighters;
    const mid = {
      x: (a.position.x + b.position.x) / 2,
      y: (a.position.y + b.position.y) / 2 + 1,
      z: (a.position.z + b.position.z) / 2
    };
    const p = window.smashCamera.camera.position;
    return {
      // framing.distance is a solved value only the presentation camera fills in; the real
      // gameplay distance is the lens to the fighters' midpoint.
      distance: Math.hypot(p.x - mid.x, p.y - mid.y, p.z - mid.z),
      fov: window.smashCamera.camera.fov,
      y: p.y,
      ground: Math.max(a.groundLevel || 0, b.groundLevel || 0)
    };
  });
  check('the camera stays pulled back and elevated',
    camera.distance > 5 && camera.y > camera.ground + 0.8, JSON.stringify(camera));

  check('no browser runtime errors during play', errors.length === 0, errors.join('\n'));
  check('no console errors during play', consoleErrors.length === 0, consoleErrors.join('\n'));

  await page.screenshot({ path: 'artifacts/gameplay-test.png' });
  console.log(`\nGameplay test passed (${results.length} checks).`);
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
