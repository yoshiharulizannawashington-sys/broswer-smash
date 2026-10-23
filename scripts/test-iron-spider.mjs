// Iron Spider end-to-end check. Drives the real game in a browser and asserts on simulation
// state, not on screenshots: the fighter is selectable, mounts through the normal roster path,
// stands on the floor on flat and raised stages, moves, attacks, takes hits, fires its
// signature move with the mechanical-leg VFX attached (and disposes them), and can be played
// as player 2. Screenshots are written to artifacts/ for a human look at the same run.
//
// The imported Sketchfab GLB is not in the repository, so the manifest entry is disabled and
// the fighter renders the procedural fallback. This test proves the fallback path and the
// roster wiring; it cannot prove the downloaded model renders until the file is installed.
//
// node scripts/test-iron-spider.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const artifacts = resolve(root, 'artifacts');
await mkdir(artifacts, { recursive: true });

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
  const missingRequests = [];
  page.on('pageerror', error => errors.push(error.stack || String(error)));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('response', response => {
    const url = response.url();
    if (response.status() >= 400 && /models\/characters|\.glb|\.fbx|\.gltf/.test(url)) {
      missingRequests.push(response.status() + ' ' + url);
    }
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

  const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
    null, { timeout: 120_000, polling: 200 });

  // ---- Selection ----------------------------------------------------------
  const card = await page.evaluate(() => {
    const node = document.querySelector('#selectScreen .bs-card[data-fighter="Iron Spider"]');
    return node ? { text: node.textContent.replace(/\s+/g, ' ').trim(), cards: document.querySelectorAll('#selectScreen .bs-card').length } : null;
  });
  check('Iron Spider has its own character-select card', Boolean(card), card ? `${card.cards} cards` : 'no card');
  check('the card advertises the signature move', /SPIDER-LEG ASSAULT/.test(card.text), card.text);
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-select.png') });

  await page.click('#selectScreen .bs-card[data-fighter="Iron Spider"]');
  await page.click('#selectScreen .bs-card[data-fighter="Goku"]');
  await page.click('#selectScreen [data-nav="next"]');
  await page.click('#selectScreen .bs-arena[data-arena="tournament"]');
  await page.evaluate(() => document.querySelector('#play').click());
  await step(0.2);

  const identity = await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    return {
      identity: p1.identity,
      key: p1.identityKey,
      special: p1.specialProfile?.label,
      archetype: p1.archetype,
      imported: p1.characterModelLoaded,
      assets: window.__browserSmashAssets?.characterModels || {},
      opponent: p2.identity
    };
  });
  check('P1 is Iron Spider', identity.identity === 'Iron Spider' && identity.key === 'iron_spider', JSON.stringify(identity));
  check('the opponent is still a separate fighter', identity.opponent === 'Goku');
  check('the signature move is SPIDER-LEG ASSAULT', identity.special === 'SPIDER-LEG ASSAULT');
  check('the disabled manifest entry falls back instead of pretending to load',
    identity.imported === false && !identity.assets.iron_spider, JSON.stringify(identity.assets.iron_spider || null));

  // ---- Floor contact and rig ---------------------------------------------
  const rig = await page.evaluate(() => {
    const p = window.fighters[0];
    const check = window.__browserSmashRigCheck(p);
    const box = new window.__browserSmashThree.Box3().setFromObject(p.model);
    return { ok: check.ok, issues: check.issues, feetY: check.metrics.feetY, height: check.metrics.height, minY: box.min.y, ground: p.position.y };
  });
  check('the fighter rig passes the structural gate', rig.ok, rig.issues.join('; '));
  check('the feet stand on the stage floor', Math.abs(rig.minY - rig.ground) < 0.12, `min y ${rig.minY.toFixed(3)} vs ground ${rig.ground.toFixed(3)}`);
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-idle.png') });

  // ---- Run ---------------------------------------------------------------
  // Freeze the CPU so these checks measure Iron Spider, not an exchange with Goku.
  await page.evaluate(() => { window.__browserSmashTrainingDummy = true; });
  const startX = await page.evaluate(() => window.fighters[0].position.x);
  await page.keyboard.down('d');
  await step(0.6);
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-run.png') });
  await page.keyboard.up('d');
  const runState = await page.evaluate(() => {
    const p = window.fighters[0];
    const box = new window.__browserSmashThree.Box3().setFromObject(p.model);
    return { x: p.position.x, minY: box.min.y, y: p.position.y, ground: p.groundLevel, grounded: p.isGrounded };
  });
  check('the fighter runs forward', runState.x - startX > 1, `moved ${(runState.x - startX).toFixed(2)} m`);
  // A running stride drops a boot below the model origin by design; the rig gate allows
  // 0.25 m, so anything past that is a detached or mis-scaled limb rather than a stride.
  check('the feet stay attached to the model origin while running', runState.minY - runState.y > -0.25,
    `model min y ${runState.minY.toFixed(3)} vs fighter y ${runState.y.toFixed(3)}`);
  check('running keeps the fighter on the floor', runState.grounded && Math.abs(runState.y - runState.ground) < 0.08,
    JSON.stringify(runState));

  // ---- Jump and land ------------------------------------------------------
  await page.keyboard.press('Space');
  await step(0.22);
  const airborne = await page.evaluate(() => ({
    y: window.fighters[0].position.y,
    grounded: window.fighters[0].isGrounded,
    ground: window.fighters[0].groundLevel
  }));
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-jump.png') });
  await step(1.6);
  const landed = await page.evaluate(() => {
    const p = window.fighters[0];
    return { y: p.position.y, grounded: p.isGrounded, ground: p.groundLevel, velocityY: p.velocity.y };
  });
  check('jumping lifts the fighter off the floor', airborne.y > airborne.ground + 0.3, JSON.stringify(airborne));
  check('the fighter lands back on the floor', landed.grounded && Math.abs(landed.y - landed.ground) < 0.08, JSON.stringify(landed));

  // ---- Melee -------------------------------------------------------------
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(0, p1.groundLevel, -12); p1.velocity.set(0, 0, 0); p1.facing = 1; p1.facingZ = 0;
    p1.hitstun = 0; p1.attackQueue.length = 0; p1.attackBuffer = 0;
    p2.position.set(1.05, p2.groundLevel, -12); p2.velocity.set(0, 0, 0); p2.percent = 0;
    p2.hitstun = 0; p2.guardHeld = false; p2.attackQueue.length = 0;
  });
  await page.keyboard.press('j');
  await step(0.16);
  const melee = await page.evaluate(() => ({
    queue: window.fighters[0].attackQueue.length,
    pose: window.fighters[0].attackPose,
    percent: window.fighters[1].percent,
    stun: window.fighters[1].hitstun
  }));
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-attack.png') });
  check('the attack animates', melee.queue > 0 || melee.pose > 0, JSON.stringify(melee));
  check('the attack damages and stuns the opponent', melee.percent > 0 && melee.stun > 0, JSON.stringify(melee));

  // ---- Signature move ----------------------------------------------------
  const legCount = () => page.evaluate(() => {
    let n = 0;
    window.__browserSmashScene.traverse(node => {
      if (node.isMesh && node.geometry?.parameters?.radiusBottom === 0.095) n++;
    });
    return n;
  });
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(0, p1.groundLevel, -14); p1.velocity.set(0, 0, 0);
    p1.facing = 1; p1.facingZ = 0; p1.hitstun = 0; p1.specialCooldown = 0; p1.attackQueue.length = 0;
    p2.position.set(1.6, p2.groundLevel, -14); p2.velocity.set(0, 0, 0);
    p2.percent = 0; p2.hitstun = 0; p2.guardHeld = false; p2.invulnerable = 0;
  });
  const legsBefore = await legCount();
  await page.keyboard.press('k');
  await step(0.12);
  const special = await page.evaluate(() => ({
    cooldown: window.fighters[0].specialCooldown,
    label: window.fighters[0].specialProfile?.label,
    percent: window.fighters[1].percent,
    legs: window.__browserSmashScene.children.length
  }));
  const legsDuring = await legCount();
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-special.png') });
  check('the signature move fires', special.cooldown > 0 && special.label === 'SPIDER-LEG ASSAULT', JSON.stringify(special));
  check('four mechanical legs stab out during the move', legsBefore === 0 && legsDuring === 4, `before ${legsBefore}, during ${legsDuring}`);
  check('the spider-leg sweep damages an adjacent opponent', special.percent > 0, `${special.percent.toFixed(1)}%`);
  await step(1.2);
  const legsAfter = await legCount();
  check('the leg VFX is disposed when the move ends', legsAfter === 0, `${legsAfter} leg meshes left in the scene`);

  // ---- Knockout ----------------------------------------------------------
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p2.percent = 340;
    p1.position.set(0, p1.groundLevel, -12); p1.facing = 1; p1.facingZ = 0;
    p1.velocity.set(0, 0, 0); p1.hitstun = 0; p1.attackQueue.length = 0; p1.attackBuffer = 0;
    p2.position.set(1.05, p2.groundLevel, -12); p2.velocity.set(0, 0, 0);
    p2.hitstun = 0; p2.guardHeld = false; p2.invulnerable = 0;
  });
  await page.keyboard.press('j');
  await step(0.4);
  const ko = await page.evaluate(() => window.__browserSmashMatch());
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-knockout.png') });
  check('a knockout ends the round', ko.round > 1 || ko.status !== 'fighting', JSON.stringify(ko));

  // ---- Raised platform ---------------------------------------------------
  const raised = await page.evaluate(() => {
    // The knockout above ended the match, so restart on the penthouse arena first.
    window.__browserSmashSelect.chooseArena('starktower');
    document.querySelector('#play').click();
    window.__browserSmashStep(0.3);
    const p = window.fighters[0];
    // Drop onto the 1.0 m dais in the penthouse layout: the feet must rest on its top.
    p.position.set(44, 1.5, -14.5);
    p.velocity.set(0, 0, 0);
    window.__browserSmashStep(0.6);
    const check = window.__browserSmashRigCheck(p);
    const box = new window.__browserSmashThree.Box3().setFromObject(p.model);
    return {
      arena: window.__browserSmashMatch().arena,
      y: p.position.y,
      ground: p.groundLevel,
      grounded: p.isGrounded,
      minY: box.min.y,
      ok: check.ok,
      issues: check.issues
    };
  });
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-raised-stage.png') });
  check('the fighter stands on a raised platform', raised.grounded && raised.y > 0.9 && Math.abs(raised.ground - raised.y) < 0.08, JSON.stringify(raised));
  check('the feet sit on the platform surface', Math.abs(raised.minY - raised.y) < 0.14, `min y ${raised.minY.toFixed(3)} vs platform ${raised.y.toFixed(3)}`);
  check('the rig is still valid on the raised stage', raised.ok, raised.issues.join('; '));

  // ---- Player 2 ----------------------------------------------------------
  await page.evaluate(() => {
    window.__browserSmashSelect.select('p2', 'Iron Spider');
    window.__browserSmashSelect.setMode('2p');
    window.__browserSmashStep(0.05);
    document.querySelector('#play').click();
  });
  await step(0.2);
  const p2Identity = await page.evaluate(() => ({
    identity: window.fighters[1].identity,
    key: window.fighters[1].identityKey,
    special: window.fighters[1].specialProfile?.label,
    mode: window.__browserSmashMatch().mode
  }));
  check('Iron Spider can be player 2', p2Identity.identity === 'Iron Spider' && p2Identity.mode === '2p', JSON.stringify(p2Identity));

  const p2Start = await page.evaluate(() => window.fighters[1].position.x);
  await page.keyboard.down('ArrowLeft');
  await step(0.6);
  await page.keyboard.up('ArrowLeft');
  const p2Moved = await page.evaluate(() => window.fighters[1].position.x);
  check('player 2 Iron Spider moves', p2Start - p2Moved > 0.8, `moved ${(p2Start - p2Moved).toFixed(2)} m`);

  // Iron Spider taking a hit, through the normal P2 attack path rather than a synthetic one.
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(0, p1.groundLevel, -12); p1.velocity.set(0, 0, 0); p1.percent = 0; p1.hitstun = 0;
    p2.position.set(-1.05, p2.groundLevel, -12); p2.velocity.set(0, 0, 0);
    p2.facing = 1; p2.facingZ = 0; p2.attackQueue.length = 0; p2.attackBuffer = 0; p2.hitstun = 0;
  });
  await page.keyboard.press(',');
  await step(0.18);
  const hitReact = await page.evaluate(() => ({
    percent: window.fighters[0].percent,
    stun: window.fighters[0].hitstun,
    velocity: window.fighters[0].velocity.toArray().map(v => +v.toFixed(2))
  }));
  check('Iron Spider takes damage and hit stun', hitReact.percent > 0 && hitReact.stun > 0, JSON.stringify(hitReact));
  check('the hit knocks the fighter back', Math.hypot(hitReact.velocity[0], hitReact.velocity[2]) > 0.2, JSON.stringify(hitReact.velocity));
  await step(0.4);
  // Player 2's special button is '.' - see public/js/smash_input.js.
  await page.keyboard.press('.');
  await step(0.12);
  const p2Special = await page.evaluate(() => ({
    cooldown: window.fighters[1].specialCooldown,
    label: window.fighters[1].specialProfile?.label
  }));
  check('player 2 can fire SPIDER-LEG ASSAULT', p2Special.cooldown > 0, p2Special.label);
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-player2.png') });

  // ---- Rematch / stage travel / camera -----------------------------------
  const framing = await page.evaluate(() => ({
    distance: window.smashCamera.framing.distance,
    y: window.smashCamera.camera.position.y,
    fov: window.smashCamera.camera.fov
  }));
  check('the camera stays pulled back and elevated', framing.distance > 5 && framing.y > 2, JSON.stringify(framing));

  const travel = await page.evaluate(() => {
    window.__browserSmashTravel('hogwarts_great_hall', 'Great Hall');
    window.__browserSmashStep(0.3);
    const [p1, p2] = window.fighters;
    const a = window.__browserSmashRigCheck(p1);
    const b = window.__browserSmashRigCheck(p2);
    return { arena: window.__browserSmashMatch().arena, rig1: a.ok, rig2: b.ok, feet1: a.metrics.feetY, feet2: b.metrics.feetY };
  });
  check('stage travel keeps both fighters valid and grounded',
    travel.arena === 'hogwarts_great_hall' && travel.rig1 && travel.rig2
      && Math.abs(travel.feet1) < 0.12 && Math.abs(travel.feet2) < 0.12,
    JSON.stringify(travel));

  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p2.percent = 340;
    p1.position.set(0, p1.groundLevel, -12); p1.facing = 1; p1.facingZ = 0; p1.hitstun = 0; p1.attackQueue.length = 0;
    p2.position.set(1.05, p2.groundLevel, -12); p2.hitstun = 0; p2.guardHeld = false; p2.invulnerable = 0;
    window.__browserSmashStep(0.1);
  });

  check('no browser runtime errors during play', errors.length === 0, errors.join('\n'));
  check('no console errors during play', consoleErrors.length === 0, consoleErrors.join('\n'));
  check('no missing model requests', missingRequests.length === 0, missingRequests.join('\n'));

  console.log(`\nIron Spider test passed (${results.length} checks).`);
} finally {
  await browser?.close();
  server.close();
}
