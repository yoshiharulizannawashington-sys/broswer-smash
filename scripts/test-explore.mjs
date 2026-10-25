// Browser test for free roam (explore mode).
//
// Two promises are checked against the live game, not by inspecting source:
//   1. Explore mode is ONE continuous world. The fighter walks out of the stage it was
//      seated on, across the streets between battle locations, without the location ever
//      changing and without a doorway prompt firing.
//   2. The mouse looks around only in explore mode. Inside a world a drag turns the camera;
//      in a match the same drag leaves the duel camera exactly where it was.
//
// Game time is advanced through window.__browserSmashStep(); CI renders in software at a
// few frames per second, so wall-clock waits are not a reliable clock.
//
// node scripts/test-explore.mjs
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

const results = [];
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  results.push(name);
  console.log(`  ok  ${name}`);
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180_000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.stack || String(error)));
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try {
      await route.fulfill({
        status: 200, contentType: 'text/javascript; charset=utf-8',
        body: await readFile(localPath)
      });
    } catch {
      await route.fulfill({ status: 404, body: 'missing' });
    }
  });

  const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);
  const state = () => page.evaluate(() => window.__browserSmashExploreState());
  const world = () => page.evaluate(() => window.__browserSmashWorld);
  const movePlayer = (x, y, z) => page.evaluate(position => {
    const fighter = window.fighters[0];
    fighter.position.set(position.x, position.y, position.z);
    fighter.velocity.set(0, 0, 0);
  }, { x, y, z });
  /** Drag the real cursor across the canvas, exactly as a player looks around. */
  const drag = async (dx, dy = 0) => {
    const box = await page.locator('#gl').boundingBox();
    const x = box.x + box.width * .5, y = box.y + box.height * .5;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 6 });
    await page.mouse.up();
  };

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
  null, { timeout: 120_000, polling: 200 });

  // ---- entering free roam -----------------------------------------------------
  await page.evaluate(() => window.__browserSmashSelect.chooseArena('dbz_main_entrance'));
  const entered = await page.evaluate(() => window.__browserSmashExplore());
  const stage = (await world()).bounds;
  const roam = (await world()).roamBounds;
  check('explore mode starts in the third-person explore camera', entered.cameraMode === 'explore');
  check('the free-roam fence is the whole world, not the stage rectangle',
    entered.bounds.x0 < stage.x0 && entered.bounds.x1 > stage.x1
    && entered.bounds.z0 < stage.z0 && entered.bounds.z1 > stage.z1,
    `${JSON.stringify(entered.bounds)} vs stage ${JSON.stringify(stage)}`);
  check('the roam fence matches the catalog rectangle',
    entered.bounds.x0 === roam.x0 && entered.bounds.x1 === roam.x1
    && entered.bounds.z0 === roam.z0 && entered.bounds.z1 === roam.z1);
  // The camera eases into the walk-around shot from the menu framing, so give it the same
  // frame budget a player sees before judging where it settled.
  await step(.9);
  const settled = await state();
  check('the free-roam camera is low and behind the fighter',
    settled.cameraPosition.y > settled.position.y + .8
    && distance(settled.cameraPosition, settled.position) > 1.5
    && distance(settled.cameraPosition, settled.position) < 14,
    `camera ${JSON.stringify(settled.cameraPosition)} player ${JSON.stringify(settled.position)}`);
  check('doorway travel rings are hidden while exploring', entered.exitsVisible === false);
  check('the explorer is seated on the chosen stage\'s spawn', distance(entered.position, entered.spawn) < 3,
    `${JSON.stringify(entered.position)} vs ${JSON.stringify(entered.spawn)}`);
  check('the explore control hint is on screen',
    await page.evaluate(() => getComputedStyle(document.querySelector('#exploreHint')).display !== 'none'));

  // ---- walking out of the stage it was seated on ------------------------------
  await page.keyboard.down('KeyD');
  await step(6);
  await page.keyboard.up('KeyD');
  const east = await state();
  check('walking east leaves the entrance stage behind', east.position.x > stage.x1 + 6,
    `x ${east.position.x.toFixed(1)} vs fence ${stage.x1}`);
  check('walking out of a stage never swaps battle location', east.location === 'dbz_main_entrance',
    String(east.location));
  check('free roam never fires a doorway travel prompt',
    await page.evaluate(() => window.__browserSmashNearbyExit()) === null);

  await movePlayer(entered.spawn.x, entered.spawn.y, entered.spawn.z);
  await page.keyboard.down('KeyA');
  await step(9);
  await page.keyboard.up('KeyA');
  const west = await state();
  check('walking west leaves the other side of the same stage', west.position.x < stage.x0 - 6,
    `x ${west.position.x.toFixed(1)} vs fence ${stage.x0}`);
  check('the long walk still never swapped location', west.location === 'dbz_main_entrance');

  // Standing on a doorway ring is the strongest version of the old prompt: it must not fire.
  const exit = await page.evaluate(() => window.__browserSmashWorld.exits[0]);
  check('the world still declares doorway exits for matches', Boolean(exit && exit.to), JSON.stringify(exit));
  if (exit) {
    await movePlayer(exit.x, entered.spawn.y, exit.z);
    await step(2);
    const atExit = await state();
    check('standing on a doorway ring in free roam does not travel',
      atExit.location === 'dbz_main_entrance' && atExit.exploring === true, String(atExit.location));
  }

  // ---- the whole world is one walk -------------------------------------------
  // A walk between two stages has to be continuous: stepping from the entrance towards the
  // far side of the island advances the same fighter, at the same ground height, with no
  // rebuild of the world (same world group, same location).
  await movePlayer(0, entered.spawn.y, -34);
  await page.keyboard.down('KeyA');
  await step(4);
  await page.keyboard.up('KeyA');
  const midWalk = await state();
  check('a stage-to-stage walk stays on the world surface', Math.abs(midWalk.position.y - entered.spawn.y) < 1.5,
    `y ${midWalk.position.y.toFixed(2)} vs ${entered.spawn.y.toFixed(2)}`);
  check('the walk is continuous, not a teleport', distance(midWalk.position, { x: 0, z: -34 }) > 8);

  // ---- falling off the world -------------------------------------------------
  await movePlayer(entered.spawn.x, -400, entered.spawn.z);
  await step(.5);
  const recovered = await state();
  check('falling out of the world returns the explorer to their seat',
    distance(recovered.position, entered.spawn) < 4 && recovered.position.y > entered.spawn.y - 2,
    `pos ${JSON.stringify(recovered.position)} spawn ${JSON.stringify(entered.spawn)}`);

  // ---- mouse look, explore only ----------------------------------------------
  await page.evaluate(() => window.smashCamera.resetOrbit());
  check('the explore camera starts centred', Math.abs((await state()).orbitYaw) < .001);
  await drag(160);
  const looked = await state();
  check('dragging the mouse turns the explore camera', Math.abs(looked.orbitYaw) > .1,
    `yaw ${looked.orbitYaw.toFixed(3)}`);
  await drag(0, -90);
  const pitched = await state();
  check('dragging vertically tilts the explore camera', Math.abs(pitched.orbitPitch) > .05,
    `pitch ${pitched.orbitPitch.toFixed(3)}`);
  const beforeStep = (await state()).cameraPosition;
  await step(.4);
  const afterStep = (await state()).cameraPosition;
  check('the turned camera is the camera actually rendering',
    distance(beforeStep, afterStep) > .2 || Math.hypot(beforeStep.x - afterStep.x, beforeStep.y - afterStep.y) > .2,
    `${JSON.stringify(beforeStep)} → ${JSON.stringify(afterStep)}`);
  check('the mouse does not steal keyboard movement', looked.exploring === true);

  // ---- leaving free roam -----------------------------------------------------
  await page.evaluate(() => window.__browserSmashLeaveExplore());
  const left = await page.evaluate(() => ({
    exploring: window.__browserSmashExploreState().exploring,
    menu: !document.querySelector('#menu').classList.contains('hidden'),
    hint: getComputedStyle(document.querySelector('#exploreHint')).display,
    cursor: document.querySelector('#gl').style.cursor
  }));
  check('leaving free roam returns to the menu', left.exploring === false && left.menu === true);
  check('leaving free roam undoes the explore presentation', left.hint === 'none' && left.cursor === '',
    `${left.hint} / "${left.cursor}"`);

  // ---- a match keeps its own camera and its own fence ------------------------
  // The setup panel may still be sitting on its fighter step (that is the existing UI, not
  // something free roam changes), so start the match the way the other gameplay tests do.
  await page.evaluate(() => document.querySelector('#play').click());
  await step(.3);
  const matchStart = await state();
  check('a match is not free roam', matchStart.exploring === false);
  check('starting a match clears the mouse-look rotation', Math.abs(matchStart.orbitYaw) < .001,
    `yaw ${matchStart.orbitYaw}`);
  await drag(200);
  const afterMatchDrag = await state();
  check('dragging the mouse in a match does not turn the camera',
    Math.abs(afterMatchDrag.orbitYaw) < .001 && Math.abs(afterMatchDrag.orbitPitch) < .001,
    `yaw ${afterMatchDrag.orbitYaw.toFixed(3)} pitch ${afterMatchDrag.orbitPitch.toFixed(3)}`);

  await page.keyboard.down('KeyD');
  await step(4);
  await page.keyboard.up('KeyD');
  const fenced = await page.evaluate(() => {
    const fighter = window.fighters[0];
    return { x: fighter.position.x, z: fighter.position.z, bounds: fighter.bounds };
  });
  check('a match still fences the fighter inside its stage',
    fenced.bounds != null && fenced.x <= fenced.bounds.x1 + .5 && fenced.x >= fenced.bounds.x0 - .5,
    `x ${fenced.x.toFixed(1)} in ${JSON.stringify(fenced.bounds)}`);

  // ---- every world clamps to the world, not to the stage ---------------------
  // One corridor was walked for real above. For the other five worlds the fence itself is
  // the question, so stand near the far corner of the roam rectangle: a per-stage fence
  // would snap the fighter back to the stage, and the world fence must keep it in the world.
  for (const key of ['nyc_stark_plaza', 'konoha_main_street', 'hogwarts_courtyard', 'asgard_palace_court', 'deathstar_hangar']) {
    await page.evaluate(arena => window.__browserSmashSelect.chooseArena(arena), key);
    const opened = await page.evaluate(() => window.__browserSmashExplore());
    const stageHere = (await world()).bounds;
    const roamHere = opened.bounds;
    check(`${key}: free roam is fenced by the whole world`,
      roamHere.x0 < stageHere.x0 && roamHere.x1 > stageHere.x1
      && roamHere.z0 < stageHere.z0 && roamHere.z1 > stageHere.z1,
      `${JSON.stringify(roamHere)} vs stage ${JSON.stringify(stageHere)}`);
    const far = { x: roamHere.x0 + 4, y: opened.spawn.y, z: roamHere.z0 + 4 };
    await movePlayer(far.x, far.y, far.z);
    await step(1.2);
    const outsider = await state();
    check(`${key}: the stage fence does not drag a far walker back`,
      distance(outsider.position, far) < 12,
      `moved ${distance(outsider.position, far).toFixed(1)} m from the world corner`);
    check(`${key}: the world fence still holds`,
      outsider.position.x > roamHere.x0 - 1 && outsider.position.x < roamHere.x1 + 1
      && outsider.position.z > roamHere.z0 - 1 && outsider.position.z < roamHere.z1 + 1,
      JSON.stringify(outsider.position));
    check(`${key}: standing across the world does not change location`,
      outsider.location === key, String(outsider.location));
    await page.evaluate(() => window.__browserSmashLeaveExplore());
  }

  check('no page errors during the free-roam run', pageErrors.length === 0, pageErrors.join('\n'));
} finally {
  await browser?.close();
  server.close();
}

console.log(`\n✓ free roam checks passed: ${results.length} assertions`);
