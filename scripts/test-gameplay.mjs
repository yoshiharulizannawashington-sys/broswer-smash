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
  const setup = await page.evaluate(() => ({
    step1: !document.querySelector('.bs-step[data-step="1"]').hidden,
    cards: document.querySelectorAll('#selectScreen .bs-card').length,
    arenas: document.querySelectorAll('#selectScreen .bs-arena').length
  }));
  check('selection screen opens on the fighter step', setup.step1);
  check('all 32 roster fighters are selectable', setup.cards === 32, `${setup.cards} cards`);
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
  const px0 = await page.evaluate(() => window.fighters[0].position.x);
  await page.keyboard.down('d');
  await step(0.7);
  await page.keyboard.up('d');
  const px1 = await page.evaluate(() => window.fighters[0].position.x);
  check('P1 moves with the keyboard', px1 - px0 > 1.2, `moved ${(px1 - px0).toFixed(2)}m`);

  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('w');
  await step(0.35);
  await page.keyboard.up('w');
  await page.keyboard.up('ShiftLeft');
  const sprint = await page.evaluate(() => Math.hypot(window.fighters[0].velocity.x, window.fighters[0].velocity.z));
  check('sprinting reaches run speed', sprint > 5, sprint.toFixed(2));

  // ---- Jump and double jump ----------------------------------------------
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
  await step(1.2);
  const landed = await page.evaluate(() => ({ grounded: window.fighters[0].isGrounded, jumps: window.fighters[0].jumps }));
  check('landing resets the jump count', landed.grounded === true && landed.jumps === 0);

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
  const finished = await page.evaluate(() => ({
    match: window.__browserSmashMatch(),
    result: document.querySelector('#result').textContent,
    menuVisible: !document.querySelector('#menu').classList.contains('hidden')
  }));
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

  const p2Start = await page.evaluate(() => window.fighters[1].position.x);
  await page.keyboard.down('ArrowLeft');
  await step(0.7);
  await page.keyboard.up('ArrowLeft');
  const p2Moved = await page.evaluate(() => window.fighters[1].position.x);
  check('player 2 steers with the arrow keys', p2Start - p2Moved > 1.0, `moved ${(p2Start - p2Moved).toFixed(2)}m`);

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
  await page.keyboard.down(';');
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
  });
  await page.keyboard.press('j');
  await step(0.2);
  const guarded = await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    return {
      guard: p2.guardHeld,
      percent: p2.percent,
      debug: {
        p1pos: p1.position.toArray(), p2pos: p2.position.toArray(),
        facing: [p1.facing, p1.facingZ], queue: p1.attackQueue.length,
        stun: p1.hitstun, buffer: p1.attackBuffer, p2stun: p2.hitstun,
        mode: window.__browserSmashMatch().mode
      }
    };
  });
  await page.keyboard.up(';');
  check('P2 holds guard with ;', guarded.guard === true);
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

  // ---- Camera framing -----------------------------------------------------
  const camera = await page.evaluate(() => ({
    distance: window.smashCamera.framing.distance,
    fov: window.smashCamera.camera.fov,
    y: window.smashCamera.camera.position.y
  }));
  check('the camera stays pulled back and elevated', camera.distance > 5 && camera.y > 2, JSON.stringify(camera));

  check('no browser runtime errors during play', errors.length === 0, errors.join('\n'));
  check('no console errors during play', consoleErrors.length === 0, consoleErrors.join('\n'));

  await page.screenshot({ path: 'artifacts/gameplay-test.png' });
  console.log(`\nGameplay test passed (${results.length} checks).`);
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
