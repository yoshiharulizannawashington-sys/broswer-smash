// Gameplay "feel" test for the newest stages.
//
// tests/worlds cover registration and geometry; this walks the stages the way a player does:
// real keyboard input, a training dummy for repeatable hits, doorway travel in both
// directions, a full round and a rematch. It also measures what the player actually sees:
// both fighters must project inside the camera frustum, the camera must not sit inside a
// solid volume, and the fighters must stay inside their stage while pushed against a wall.
//
// Scope note: framing is measured from the fighters' simulated positions, not from the
// pixels their meshes occupy. The Blender prefab swap currently leaves every fighter's
// articulated parts detached and partly below its own origin (see the milestone report),
// so model pixels are not a trustworthy signal yet; camera and collision are.
//
// node scripts/test-stage-feel.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml'
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

const STAGES = [
  { key: 'asgard_throne_hall', label: 'Throne Hall', wall: 'd' },
  { key: 'dbz_rocky_grounds', label: 'Rocky Training Grounds', wall: 'd' },
  { key: 'dbz_backstreets', label: 'West City Backstreets', wall: 'd' },
  { key: 'dbz_capsule_lab', label: 'Capsule Research Lab', wall: 'd' }
];

const results = [];
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}\n${results.length} checks passed before this one`);
  results.push(name);
  console.log(`  ok  ${name}`);
}

// Runs in the page: the visible state a player would judge.
const FRAME_PROBE = `(() => {
  const cam = window.smashCamera.camera;
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  const THREE = window.__browserSmashThree;
  const points = window.fighters.map(f => {
    const v = f.position.clone();
    v.y += 1.0;
    v.project(cam);
    return [v.x, v.y, v.z];
  });
  const blocks = window.smashCamera.collisionBlocks || [];
  const p = cam.position;
  const insideSolid = blocks.some(b => {
    if (b.top != null && p.y > b.top) return false;
    if (b.bottom != null && p.y < b.bottom) return false;
    if (b.r != null) return Math.hypot(p.x - b.x, p.z - b.z) < b.r - 0.15;
    return p.x > b.x0 + 0.15 && p.x < b.x1 - 0.15 && p.z > b.z0 + 0.15 && p.z < b.z1 - 0.15;
  });
  return {
    camera: p.toArray(),
    look: window.smashCamera.lookTarget.toArray(),
    reach: window.smashCamera.collisionReach,
    framing: { ...window.smashCamera.framing },
    points,
    insideSolid,
    distances: window.fighters.map(f => cam.position.distanceTo(f.position)),
    fighters: window.fighters.map(f => f.position.toArray()),
    ground: window.__browserSmashWorld.ground,
    bounds: window.__browserSmashWorld.bounds,
    match: window.__browserSmashMatch()
  };
})()`;

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  page.setDefaultTimeout(180_000);
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.stack || String(error)));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
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
  const frame = () => page.evaluate(FRAME_PROBE);
  const settle = () => page.waitForTimeout(900); // let the render loop draw the current state
  // __browserSmashStep advances the camera on the same fixed step as the simulation, so a
  // short deterministic advance is enough for the shot to reach its resting framing.
  const settleCamera = async () => { await step(0.9); await settle(); };
  const spawnFighters = () => page.evaluate(() => window.__browserSmashSpawnFighters());

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
    null, { timeout: 180_000, polling: 200 });

  // A full pass takes several minutes on the software renderer this repo is tested on;
  // STAGE_FEEL_ONLY=<stage key> runs a single stage while iterating on it.
  const only = process.env.STAGE_FEEL_ONLY;
  const stages = only ? STAGES.filter(stage => stage.key === only) : STAGES;
  if (!stages.length) throw new Error(`STAGE_FEEL_ONLY=${only} does not match a known stage`);

  for (const stage of stages) {
    console.log(`\n— ${stage.label}`);
    await page.evaluate(key => window.__browserSmashSelect.chooseArena(key), stage.key);
    await page.waitForFunction(key => window.__browserSmashWorld?.location === key, stage.key, { timeout: 120_000 });
    // Start the fight through the menu button a player presses, so input is live.
    await page.evaluate(() => document.getElementById('play')?.click());
    await step(0.05);
    await page.evaluate(() => { window.__browserSmashTrainingDummy = true; });
    await spawnFighters();
    // Arriving on a stage teleports the pair, so let the shot reframe before judging it.
    await settleCamera();

    // ---- Spawn -----------------------------------------------------------
    const spawn = await frame();
    const b = spawn.bounds;
    const insideBounds = spawn.fighters.every(([x, , z]) =>
      x > b.x0 + 0.5 && x < b.x1 - 0.5 && z > b.z0 + 0.5 && z < b.z1 - 0.5);
    check(`${stage.label}: both fighters spawn inside the stage`, insideBounds,
      JSON.stringify(spawn.fighters.map(p => p.map(v => +v.toFixed(1)))));
    const onFloor = spawn.fighters.every(([, y]) => Math.abs(y - spawn.ground) < 0.8);
    check(`${stage.label}: both fighters spawn on the stage floor`, onFloor,
      `ground ${spawn.ground}`);
    const gap = Math.hypot(spawn.fighters[0][0] - spawn.fighters[1][0], spawn.fighters[0][2] - spawn.fighters[1][2]);
    check(`${stage.label}: spawns are clear of each other`, gap > 4, `${gap.toFixed(1)} m`);
    const facing = await page.evaluate(() => {
      const [a, c] = window.fighters;
      const THREE = window.__browserSmashThree;
      const toB = c.position.clone().sub(a.position).setY(0).normalize();
      const toA = a.position.clone().sub(c.position).setY(0).normalize();
      const fa = new THREE.Vector3(a.facing, 0, a.facingZ);
      const fc = new THREE.Vector3(c.facing, 0, c.facingZ);
      return { a: fa.dot(toB), c: fc.dot(toA) };
    });
    check(`${stage.label}: both fighters face each other`, facing.a > 0.25 && facing.c > 0.25,
      JSON.stringify(facing));

    // ---- Camera at spawn -------------------------------------------------
    check(`${stage.label}: camera is elevated above the fighters`,
      spawn.camera[1] > Math.max(spawn.fighters[0][1], spawn.fighters[1][1]) + 3,
      `camera y ${spawn.camera[1].toFixed(1)}`);
    const bothInFrame = spawn.points.every(([x, y]) => Math.abs(x) < 0.97 && Math.abs(y) < 0.97);
    check(`${stage.label}: both fighters are inside the camera frame`, bothInFrame,
      JSON.stringify(spawn.points.map(p => p.map(v => +v.toFixed(2)))));
    check(`${stage.label}: camera is not inside scenery`, !spawn.insideSolid,
      spawn.camera.map(v => +v.toFixed(1)).join(','));
    check(`${stage.label}: camera is pulled back`, Math.min(...spawn.distances) > 5,
      `${Math.min(...spawn.distances).toFixed(1)} m`);
    await page.screenshot({ path: `artifacts/feel-${stage.key}-start.png` });

    // ---- Movement, sprint and jump --------------------------------------
    const px0 = await page.evaluate(() => window.fighters[0].position.x);
    await page.keyboard.down('d');
    await step(0.6);
    await page.keyboard.up('d');
    const px1 = await page.evaluate(() => window.fighters[0].position.x);
    check(`${stage.label}: P1 runs with the keyboard`, px1 - px0 > 0.8, `moved ${(px1 - px0).toFixed(2)} m`);

    await page.evaluate(() => {
      const p = window.fighters[0];
      p.position.set((window.__browserSmashWorld.bounds.x0 + window.__browserSmashWorld.bounds.x1) / 2,
        p.groundLevel, (window.__browserSmashWorld.bounds.z0 + window.__browserSmashWorld.bounds.z1) / 2);
      p.velocity.set(0, 0, 0);
      p.hitstun = 0;
    });
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('d');
    await step(0.4);
    const sprint = await page.evaluate(() => Math.hypot(window.fighters[0].velocity.x, window.fighters[0].velocity.z));
    await page.keyboard.up('d');
    await page.keyboard.up('ShiftLeft');
    check(`${stage.label}: sprint reaches run speed`, sprint > 4, sprint.toFixed(2));

    await page.evaluate(() => {
      const p = window.fighters[0];
      p.position.set((window.__browserSmashWorld.bounds.x0 + window.__browserSmashWorld.bounds.x1) / 2,
        p.groundLevel, (window.__browserSmashWorld.bounds.z0 + window.__browserSmashWorld.bounds.z1) / 2);
      p.velocity.set(0, 0, 0);
      p.hitstun = 0;
    });
    await page.keyboard.press('Space');
    await step(0.12);
    const jump1 = await page.evaluate(() => ({ y: window.fighters[0].position.y, jumps: window.fighters[0].jumps }));
    check(`${stage.label}: jump leaves the ground`, jump1.y > 0.3 || jump1.jumps === 1,
      `y ${jump1.y.toFixed(2)} jumps ${jump1.jumps}`);
    await step(0.1);
    await page.keyboard.press('Space');
    await step(0.08);
    const jump2 = await page.evaluate(() => window.fighters[0].jumps);
    check(`${stage.label}: double jump is available`, jump2 === 2, String(jump2));
    await step(1.4);
    const landed = await page.evaluate(() => ({ grounded: window.fighters[0].isGrounded, y: window.fighters[0].position.y }));
    check(`${stage.label}: the fighter lands again`, landed.grounded === true, `y ${landed.y.toFixed(2)}`);

    // ---- Combat on a training dummy --------------------------------------
    await page.evaluate(() => {
      const [p1, p2] = window.fighters;
      const bounds = window.__browserSmashWorld.bounds;
      const cx = (bounds.x0 + bounds.x1) / 2, cz = (bounds.z0 + bounds.z1) / 2;
      p1.position.set(cx, p1.groundLevel, cz);
      p1.velocity.set(0, 0, 0); p1.attackQueue.length = 0; p1.comboStep = 0; p1.comboWindow = 0;
      p1.facing = 1; p1.facingZ = 0; p1.hitstun = 0;
      p2.position.set(cx + 1.05, p2.groundLevel, cz);
      p2.velocity.set(0, 0, 0);
      p2.percent = 0; p2.hitstun = 0; p2.invulnerable = 0; p2.guardHeld = false;
      p2.aiTimer = 999;
    });
    await page.keyboard.press('j');
    await step(0.16);
    const punch = await page.evaluate(() => ({
      percent: window.fighters[1].percent,
      stun: window.fighters[1].hitstun,
      combo: window.fighters[0].comboHitCount
    }));
    check(`${stage.label}: a punch lands inside the stage`, punch.percent > 0, `${punch.percent.toFixed(1)}%`);
    check(`${stage.label}: a landed hit stuns`, punch.stun > 0, `${punch.stun.toFixed(2)} s`);

    const knockback = await page.evaluate(() => {
      const p2 = window.fighters[1];
      return Math.hypot(p2.velocity.x, p2.velocity.z);
    });
    check(`${stage.label}: a landed hit applies knockback`, knockback > 1, knockback.toFixed(2));

    await page.keyboard.down('e');
    await step(0.1);
    const guard = await page.evaluate(() => window.fighters[0].guardHeld);
    await page.keyboard.up('e');
    check(`${stage.label}: guard raises`, guard === true);

    await page.screenshot({ path: `artifacts/feel-${stage.key}-combat.png` });

    // ---- Camera near the stage edges -------------------------------------
    // Both fighters pressed against opposite side walls, which is the widest duel a stage
    // actually produces. (Walking into a *doorway* is a stage transition, not a duel; the
    // corner of the ring is often exactly where a doorway sits, so the edges are used.)
    await page.evaluate(() => {
      const [p1, p2] = window.fighters;
      const bounds = window.__browserSmashWorld.bounds;
      const midZ = (bounds.z0 + bounds.z1) / 2;
      p1.position.set(bounds.x0 + 1.6, p1.groundLevel, midZ);
      p1.velocity.set(0, 0, 0); p1.hitstun = 0;
      p2.position.set(bounds.x1 - 1.6, p2.groundLevel, midZ);
      p2.velocity.set(0, 0, 0); p2.hitstun = 0;
    });
    await settleCamera();
    const wide = await frame();
    check(`${stage.label}: camera stays out of scenery when the duel is wide`, !wide.insideSolid,
      wide.camera.map(v => +v.toFixed(1)).join(','));
    check(`${stage.label}: both fighters stay in frame at the edges`,
      wide.points.every(([x]) => Math.abs(x) < 1.02),
      JSON.stringify({ points: wide.points.map(p => p.map(v => +v.toFixed(2))),
        camera: wide.camera.map(v => +v.toFixed(1)), look: wide.look.map(v => +v.toFixed(1)),
        feet: wide.fighters.map(f => f.map(v => +v.toFixed(1))), reach: +wide.reach.toFixed(1) }));

    // ---- Wall collision --------------------------------------------------
    // Walk into the nearest side wall for a second and a half: the stage must hold the
    // fighter in, and the camera must not end up inside the wall it is pressed against.
    await page.evaluate(() => {
      const p1 = window.fighters[0];
      const bounds = window.__browserSmashWorld.bounds;
      p1.position.set(bounds.x1 - 1.2, p1.groundLevel, (bounds.z0 + bounds.z1) / 2);
      p1.velocity.set(0, 0, 0); p1.hitstun = 0;
    });
    await page.keyboard.down('d');
    await step(1.5);
    await page.keyboard.up('d');
    await settleCamera();
    const pressed = await frame();
    const [fx, , fz] = pressed.fighters[0];
    check(`${stage.label}: a fighter cannot leave the stage bounds`,
      fx <= b.x1 + 0.05 && fx >= b.x0 - 0.05 && fz <= b.z1 + 0.05 && fz >= b.z0 - 0.05,
      `(${fx.toFixed(1)}, ${fz.toFixed(1)}) in x ${b.x0}..${b.x1} z ${b.z0}..${b.z1}`);
    check(`${stage.label}: the fighter is not inside a wall`, await page.evaluate(() => {
      const p = window.fighters[0].position;
      const feet = p.y;
      return !(window.smashCamera.collisionBlocks || []).some(bl => {
        if (bl.top == null || feet >= bl.top - 0.42) return false;
        if (bl.bottom != null && feet + 1.9 <= bl.bottom) return false;
        if (bl.r != null) return Math.hypot(p.x - bl.x, p.z - bl.z) < bl.r - 0.2;
        return p.x > bl.x0 + 0.2 && p.x < bl.x1 - 0.2 && p.z > bl.z0 + 0.2 && p.z < bl.z1 - 0.2;
      });
    }));
    check(`${stage.label}: camera stays valid against a wall`, !pressed.insideSolid,
      pressed.camera.map(v => +v.toFixed(1)).join(','));

    // ---- Doorway travel, there and back ----------------------------------
    const exits = await page.evaluate(() => window.__browserSmashExits());
    check(`${stage.label}: the stage has a marked doorway`, exits.length >= 1, `${exits.length}`);
    const exit = exits[0];
    await page.evaluate(point => {
      const p = window.fighters[0];
      p.position.set(point.x, p.groundLevel, point.z);
      p.velocity.set(0, 0, 0);
      p.hitstun = 0;
    }, exit);
    await step(0.3);
    await page.waitForFunction(target => window.__browserSmashWorld?.location === target,
      exit.to, { timeout: 60_000 });
    const arrived = await page.evaluate(() => ({
      location: window.__browserSmashWorld.location,
      groups: window.__browserSmashScene.children.filter(child => child.name === 'world-stage')[0]?.children.length ?? 0,
      p1: window.fighters[0].position.toArray(),
      spawns: window.__browserSmashWorld.spawns,
      exits: window.__browserSmashExits()
    }));
    check(`${stage.label}: walking into a doorway moves the match`, arrived.location === exit.to);
    check(`${stage.label}: only one world group is mounted after travel`, arrived.groups === 1, `${arrived.groups}`);
    const arrivedOnSpawn = arrived.spawns.some(spawn =>
      Math.hypot(arrived.p1[0] - spawn.x, arrived.p1[2] - spawn.z) < 2.5);
    check(`${stage.label}: the fighter lands on the new stage's spawn`, arrivedOnSpawn,
      arrived.p1.map(v => +v.toFixed(1)).join(','));
    const back = arrived.exits.find(candidate => candidate.to === stage.key);
    check(`${stage.label}: the destination links back`, Boolean(back), JSON.stringify(arrived.exits));
    await page.evaluate(point => {
      const p = window.fighters[0];
      p.position.set(point.x, p.groundLevel, point.z);
      p.velocity.set(0, 0, 0);
      p.hitstun = 0;
    }, back);
    await step(0.3);
    await page.waitForFunction(target => window.__browserSmashWorld?.location === target,
      stage.key, { timeout: 60_000 });
    check(`${stage.label}: the doorway returns to the stage`,
      await page.evaluate(() => window.__browserSmashWorld.location) === stage.key);

    // ---- Round, result and rematch ---------------------------------------
    await spawnFighters();
    await step(0.05);
    await page.evaluate(() => { window.fighters[1].percent = 999; });
    await step(0.2);
    const round = await page.evaluate(() => window.__browserSmashMatch());
    check(`${stage.label}: a knockout takes the round`, round.wins[0] >= 1, JSON.stringify(round.wins));
    // The first knockout sets a short round pause before the next round can begin.
    await step(2.4);
    await page.evaluate(() => { window.fighters[1].percent = 999; });
    await step(0.3);
    const over = await page.evaluate(() => ({
      match: window.__browserSmashMatch(),
      result: document.querySelector('#result')?.textContent || ''
    }));
    check(`${stage.label}: two rounds end the match`, over.match.status === 'match-over', over.match.status);
    check(`${stage.label}: the result names the winner`, /VICTORY/i.test(over.result), over.result.slice(0, 40));
    await page.screenshot({ path: `artifacts/feel-${stage.key}-end.png` });

    const rematch = await page.evaluate(() => {
      window.__browserSmashStartMatch?.();
      return window.__browserSmashMatch();
    });
    if (!rematch || rematch.status === 'match-over') {
      // No rematch hook: use the menu's own start button, which is what a player presses.
      await page.evaluate(() => document.getElementById('play')?.click());
      await step(0.1);
    }
    const again = await page.evaluate(() => ({
      match: window.__browserSmashMatch(),
      percents: window.fighters.map(f => f.percent),
      gap: window.fighters[0].position.distanceTo(window.fighters[1].position)
    }));
    check(`${stage.label}: a rematch starts a fresh round`,
      again.match.round === 1 && again.match.status === 'fighting', JSON.stringify(again.match.status));
    check(`${stage.label}: a rematch clears damage`, again.percents.every(value => value === 0));
    check(`${stage.label}: a rematch respawns both fighters apart`, again.gap > 4, again.gap.toFixed(1));
  }

  check('no page errors during the stage pass', pageErrors.length === 0, pageErrors[0]);
  check('no console errors during the stage pass', consoleErrors.length === 0, consoleErrors[0]);
  console.log(`\nStage feel test passed (${results.length} checks across ${stages.length} stages).`);
} finally {
  await browser?.close();
  server.close();
}
