// Browser test for the four large reference worlds.
//
// It loads the real game, selects every battle location through the real selection API,
// and asserts on live scene/simulation state: the world geometry is present as one merged
// group, fighters spawn on the world's own surface, combat still works inside it, and
// switching worlds or locations never duplicates scene objects or lights.
//
// Game time is advanced through window.__browserSmashStep(); CI renders in software at a
// few frames per second, so wall-clock waits are not a reliable clock.
//
// node scripts/test-worlds-browser.mjs
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
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
  null, { timeout: 120_000, polling: 200 });

  const catalog = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#selectScreen .bs-arena')].map(card => ({
      key: card.dataset.arena, world: card.dataset.world || null
    }));
    const tabs = [...document.querySelectorAll('#selectScreen [data-worldtab]')].map(tab => ({
      id: tab.dataset.worldtab, label: tab.textContent
    }));
    return { cards, tabs };
  });
  const worldCards = catalog.cards.filter(card => card.world);
  check('the selection screen lists four worlds', catalog.tabs.filter(tab => tab.id !== 'classic').length === 4,
    catalog.tabs.map(tab => tab.id).join(','));
  check('every world exposes at least five battle locations', ['dbz', 'asgard', 'deathstar', 'hogwarts'].every(id =>
    worldCards.filter(card => card.world === id).length >= 5), `${worldCards.length} world stages`);
  check('battle locations are kept out of the classic arena filter', catalog.cards.filter(card => !card.world).length >= 6);

  const worldInfo = key => page.evaluate(() => {
    const scene = window.__browserSmashScene;
    const stage = scene.children.find(child => child.name === 'world-stage');
    const groups = stage ? stage.children : [];
    return {
      world: window.__browserSmashWorld,
      groups: groups.map(group => ({ name: group.name, children: group.children.length, uuid: group.uuid, visible: group.visible })),
      stageVisible: stage?.visible,
      directionalLights: scene.children.filter(child => child.isDirectionalLight).length,
      fighters: window.fighters.map(fighter => ({
        x: fighter.position.x, y: fighter.position.y, z: fighter.position.z,
        ground: fighter.groundLevel, percent: fighter.percent
      }))
    };
  });

  const seenGroups = new Map();
  let lastUuid = null;
  let renderable = 0;
  for (const card of worldCards) {
    await page.evaluate(key => window.__browserSmashSelect.chooseArena(key), card.key);
    await page.waitForFunction(key => window.__browserSmashWorld?.location === key, card.key, { timeout: 60_000 });
    // Put both fighters on this stage's real spawn points (the same call a round reset uses).
    await page.evaluate(() => window.__browserSmashSpawnFighters());
    await step(0.08);
    const info = await worldInfo(card.key);
    const label = `${card.world}/${card.key}`;
    check(`${label}: world is reported to the game`, info.world?.world === card.world, JSON.stringify(info.world?.world));
    check(`${label}: exactly one world group is mounted`, info.groups.length === 1, `${info.groups.length} groups`);
    const group = info.groups[0];
    check(`${label}: world geometry is present`, Boolean(group) && group.children > 3,
      `${group?.children} material groups`);
    check(`${label}: draw calls stay bounded`, group.children <= 40, `${group.children} draw calls`);
    check(`${label}: world parts were built`, info.world.parts > 80, `${info.world.parts} parts`);
    check(`${label}: collision volumes are registered`, info.world.blocks > 20, `${info.world.blocks} blocks`);
    renderable++;

    // Fighters stand on this world's surface, inside its battle area.
    const b = info.world.bounds;
    for (const fighter of info.fighters) {
      check(`${label}: fighter is inside the stage bounds`,
        fighter.x >= b.x0 - 4 && fighter.x <= b.x1 + 4 && fighter.z >= b.z0 - 4 && fighter.z <= b.z1 + 4,
        `${fighter.x.toFixed(1)},${fighter.z.toFixed(1)}`);
      check(`${label}: fighter is standing on the world surface`,
        Math.abs(fighter.y - fighter.ground) < 0.75, `y ${fighter.y.toFixed(2)} ground ${fighter.ground?.toFixed(2)}`);
      check(`${label}: fighter is not below the arena floor`,
        fighter.y >= info.world.ground - 0.6, `y ${fighter.y.toFixed(2)} vs ${info.world.ground}`);
    }

    // A world's geometry is built once and reused by every location inside that world.
    const previous = seenGroups.get(card.world);
    if (previous) check(`${label}: reuses the world geometry instead of rebuilding`, previous === group.uuid);
    else seenGroups.set(card.world, group.uuid);
    lastUuid = group.uuid;
  }
  check('all four worlds were loaded', renderable === worldCards.length, `${renderable} stages`);
  check('the page stayed error-free while building the worlds', pageErrors.length === 0, pageErrors[0] || '');

  // ---- Combat inside a large world ----------------------------------------
  await page.evaluate(() => window.__browserSmashSelect.chooseArena('dbz_grand_prize'));
  await page.waitForFunction(() => window.__browserSmashWorld?.location === 'dbz_grand_prize', null, { timeout: 60_000 });
  if (await page.evaluate(() => document.querySelector('.bs-step[data-step="1"]') && !document.querySelector('.bs-step[data-step="1"]').hidden)) {
    await page.click('#selectScreen [data-nav="next"]');
  }
  await page.click('#play');
  await step(0.05);
  const started = await page.evaluate(() => ({
    match: window.__browserSmashMatch(),
    ground: window.__browserSmashWorld.ground,
    heights: window.fighters.map(fighter => fighter.position.y)
  }));
  check('a match starts on the Grand Prize Stage', started.match.arena === 'dbz_grand_prize', started.match.arena);
  check('fighters spawn on the raised tournament platform',
    started.heights.every(y => Math.abs(y - started.ground) < 0.6), started.heights.map(y => y.toFixed(2)).join(','));

  const before = await page.evaluate(() => window.fighters[0].position.toArray());
  await page.keyboard.down('d');
  await step(0.5);
  await page.keyboard.up('d');
  const moved = await page.evaluate(() => window.fighters[0].position.toArray());
  check('fighters can move around the world', Math.hypot(moved[0] - before[0], moved[2] - before[2]) > 0.5,
    `${Math.hypot(moved[0] - before[0], moved[2] - before[2]).toFixed(2)} m`);

  const damage = await page.evaluate(async () => {
    window.__browserSmashTrainingDummy = true;
    const [a, b] = window.fighters;
    a.position.set(-4, window.__browserSmashWorld.ground, -2);
    b.position.set(-2.2, window.__browserSmashWorld.ground, -2);
    a.facing = 1; b.facing = -1; b.percent = 0; b.velocity.set(0, 0, 0);
    return { start: b.percent };
  });
  await page.keyboard.press('j');
  await step(0.4);
  const hit = await page.evaluate(() => ({ percent: window.fighters[1].percent, last: window.fighters[1].lastHitBy || null }));
  check('attacks connect inside the world', hit.percent > damage.start, `${damage.start} -> ${hit.percent}`);
  await page.evaluate(() => { window.__browserSmashTrainingDummy = false; });

  // ---- Ring-outs ----------------------------------------------------------
  // A designated ring-out stage has no playable clamp: a fighter thrown past the edge falls
  // and loses the round. The same throw on a normal stage has to be clamped instead.
  await page.evaluate(() => window.__browserSmashSelect.chooseArena('dbz_cliffs'));
  await page.waitForFunction(() => window.__browserSmashWorld?.location === 'dbz_cliffs', null, { timeout: 60_000 });
  await page.evaluate(() => window.__browserSmashSpawnFighters());
  await step(0.1);
  const beforeFall = await page.evaluate(() => window.__browserSmashMatch());
  await page.evaluate(() => {
    const fighter = window.fighters[0];
    const bounds = window.__browserSmashWorld.bounds;
    fighter.position.set(bounds.x1 + 26, 3.2, (bounds.z0 + bounds.z1) / 2);
    fighter.velocity.set(0, -14, 0);
    fighter.isGrounded = false;
  });
  await step(0.25);
  const afterFall = await page.evaluate(() => window.__browserSmashMatch());
  check('a ring-out ends the round for the fighter who went over the edge',
    afterFall.wins[1] === beforeFall.wins[1] + 1,
    `${beforeFall.wins.join('-')} -> ${afterFall.wins.join('-')} (${afterFall.status})`);

  await page.evaluate(() => window.__browserSmashSelect.chooseArena('dbz_grand_prize'));
  await page.waitForFunction(() => window.__browserSmashWorld?.location === 'dbz_grand_prize', null, { timeout: 60_000 });
  // Practice mode is behind the (closed) setup screen here, so dispatch the button's own
  // click handler instead of requiring it to be visible.
  await page.evaluate(() => document.querySelector('#practice').click());
  await page.evaluate(() => {
    const fighter = window.fighters[0];
    const bounds = window.__browserSmashWorld.bounds;
    fighter.position.set(bounds.x1 + 26, 4.2, (bounds.z0 + bounds.z1) / 2);
    fighter.velocity.set(0, -14, 0);
    fighter.isGrounded = false;
  });
  await step(0.35);
  const clamped = await page.evaluate(() => ({
    position: window.fighters[0].position.toArray(),
    ground: window.fighters[0].groundLevel,
    bounds: window.__browserSmashWorld.bounds,
    match: window.__browserSmashMatch()
  }));
  check('a normal stage still clamps a thrown fighter inside the arena',
    clamped.position[0] <= clamped.bounds.x1 + 0.7 && clamped.position[0] >= clamped.bounds.x0 - 0.7,
    `x ${clamped.position[0].toFixed(1)} vs ${clamped.bounds.x0}..${clamped.bounds.x1}`);
  check('a clamped fighter lands on the stage floor',
    Math.abs(clamped.position[1] - clamped.ground) < 0.6, `y ${clamped.position[1].toFixed(2)} ground ${clamped.ground?.toFixed(2)}`);
  check('a clamped fighter does not lose the round', clamped.match.wins[1] === 0, clamped.match.wins.join('-'));

  // The camera must not sit inside the world's solid geometry once the stage has walls.
  const camera = await page.evaluate(() => {
    const cam = window.__browserSmashScene.children.find(child => child.isCamera) || null;
    const liveCamera = window.__browserSmashCamera || cam;
    const blocks = window.__browserSmashWorld.blocks || 0;
    return { hasCamera: Boolean(liveCamera), blocks, collides: Boolean(window.smashCamera?.collisionBlocks?.length) };
  });
  check('the camera is given the stage geometry to avoid', camera.collides, `${camera.blocks} blocks registered`);

  // ---- Switching worlds and back ------------------------------------------
  await page.evaluate(() => window.__browserSmashSelect.chooseArena('asgard_bifrost'));
  await page.waitForFunction(() => window.__browserSmashWorld?.location === 'asgard_bifrost', null, { timeout: 60_000 });
  await step(0.05);
  const swapped = await worldInfo('asgard_bifrost');
  check('switching world replaces the mounted world geometry', swapped.groups.length === 1 && swapped.groups[0].uuid !== lastUuid);
  check('switching world does not add lights', swapped.directionalLights === 2, `${swapped.directionalLights} lights`);

  await page.evaluate(() => window.__browserSmashSelect.chooseArena('finalvalley'));
  await page.waitForFunction(() => window.__browserSmashWorld?.location === null, null, { timeout: 60_000 });
  const legacy = await page.evaluate(() => ({
    world: window.__browserSmashWorld,
    groups: window.__browserSmashScene.children.find(child => child.name === 'world-stage')?.children.length || 0
  }));
  check('returning to a classic arena unloads the world geometry', legacy.world.world === null && legacy.groups === 0);

  await page.evaluate(() => window.__browserSmashSelect.chooseArena('hogwarts_great_hall'));
  await page.waitForFunction(() => window.__browserSmashWorld?.location === 'hogwarts_great_hall', null, { timeout: 60_000 });
  await step(0.05);
  const rebuilt = await worldInfo('hogwarts_great_hall');
  check('re-entering a world rebuilds it once', rebuilt.groups.length === 1 && rebuilt.groups[0].name === 'world-hogwarts');
  check('the Great Hall interior is an interior stage', rebuilt.world.blocks > 20 && rebuilt.world.ground > 0.5);

  // ---- Every classic arena still loads, spawns and fights -----------------
  // The world stages above must not have broken the original maps, and the clamp still has
  // to keep fighters inside arenas that are not ring-out stages.
  const classic = catalog.cards.filter(card => !card.world).map(card => card.key);
  check('the classic arenas are still selectable', classic.length >= 6, classic.join(','));
  for (const key of classic) {
    await page.evaluate(k => window.__browserSmashSelect.chooseArena(k), key);
    await page.waitForFunction(() => window.__browserSmashWorld?.location === null, null, { timeout: 60_000 });
    await page.evaluate(() => window.__browserSmashSpawnFighters());
    await step(0.08);
    const info = await page.evaluate(() => ({
      world: window.__browserSmashWorld,
      stageGroups: window.__browserSmashScene.children.find(child => child.name === 'world-stage')?.children.length || 0,
      fighters: window.fighters.map(fighter => ({
        x: fighter.position.x, y: fighter.position.y, z: fighter.position.z, ground: fighter.groundLevel
      }))
    }));
    const b = info.world.bounds;
    check(`${key}: loads without mounting world geometry`, info.stageGroups === 0);
    check(`${key}: fighters stand on the arena floor`,
      info.fighters.every(fighter => Number.isFinite(fighter.y) && Math.abs(fighter.y - fighter.ground) < 0.75),
      info.fighters.map(fighter => fighter.y.toFixed(2)).join(','));
    check(`${key}: fighters spawn inside the arena bounds`,
      info.fighters.every(fighter => fighter.x >= b.x0 - 0.5 && fighter.x <= b.x1 + 0.5 && fighter.z >= b.z0 - 0.5 && fighter.z <= b.z1 + 0.5),
      JSON.stringify(info.fighters.map(fighter => [Math.round(fighter.x), Math.round(fighter.z)])));
  }
  check('no page errors during location and world switching', pageErrors.length === 0, pageErrors[0] || '');

  await page.screenshot({ path: 'artifacts/worlds-great-hall.png' });
  console.log(`\nWorld browser tests passed (${results.length} checks across ${worldCards.length} battle locations).`);
} finally {
  await browser?.close();
  server.close();
}
