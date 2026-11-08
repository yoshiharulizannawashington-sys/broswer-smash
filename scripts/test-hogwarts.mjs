// Hogwarts interior: walk tests and a visual gallery, in the real game.
//
// The node suite (scripts/test-worlds.mjs) proves the geometry against the collision functions.
// This script proves the same routes in the running game: it drives the live fighter through
// each doorway and staircase one simulation step at a time, so `resolveArenaCollision` and the
// per-fighter floor clamp in main.js/fighter3D.js are what decide whether the walk works. Then
// it captures the rooms through the real explore camera.
//
//   npm run test:hogwarts            (add --no-capture to skip the screenshots)
//
// Screenshots land in artifacts/hogwarts/.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import { HOGWARTS_CONNECTIONS, HOGWARTS_NAV_ROUTES } from '../public/js/worlds/hogwarts_interior.js';

const root = process.cwd();
const capture = !process.argv.includes('--no-capture');
const shotDir = resolve(root, 'artifacts/hogwarts');
if (capture) await mkdir(shotDir, { recursive: true });

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
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: await readFile(localPath) });
    } catch {
      await route.fulfill({ status: 404, body: 'missing' });
    }
  });

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
  null, { timeout: 120_000, polling: 200 });

  // ---- the stage is selectable and lands you in the room ---------------------
  await page.evaluate(() => window.__browserSmashSelect.chooseArena('hogwarts_entrance_hall'));
  const entered = await page.evaluate(() => window.__browserSmashExplore());
  const world = await page.evaluate(() => window.__browserSmashWorld);
  check('the entrance hall is a selectable Hogwarts stage', world.location === 'hogwarts_entrance_hall', String(world.location));
  check('it spawns on the entrance hall floor', Math.abs(entered.position.y - 0.6) < 0.35, `y ${entered.position.y.toFixed(2)}`);
  check('the castle world is loaded once', world.world === 'hogwarts' && world.drawCalls > 5,
    `${world.drawCalls} draw calls, ${world.blocks} collision volumes`);

  // ---- walking the castle, one simulation step at a time --------------------
  const walk = async route => page.evaluate(({ from, to }) => {
    const fighter = window.fighters[0];
    fighter.position.set(from.x, from.y, from.z);
    if (fighter.model?.position) fighter.model.position.set(from.x, from.y, from.z);
    fighter.velocity.set(0, 0, 0);
    window.__browserSmashStep(0.6);
    const startY = fighter.position.y;
    let worstResistance = 0;
    let stalls = 0;
    const trace = [];
    let lastY = startY;
    for (let i = 0; i < 3000; i++) {
      const dx = to.x - fighter.position.x, dz = to.z - fighter.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.2) break;
      const stride = Math.min(0.07, distance);
      const beforeX = fighter.position.x, beforeZ = fighter.position.z;
      fighter.position.x += dx / distance * stride;
      fighter.position.z += dz / distance * stride;
      window.__browserSmashStep(1 / 120);
      if (Math.abs(fighter.position.y - lastY) > 0.02) {
        if (trace.length < 5) trace.push(`${lastY.toFixed(2)}→${fighter.position.y.toFixed(2)} at (${fighter.position.x.toFixed(1)},${fighter.position.z.toFixed(1)})`);
        lastY = fighter.position.y;
      }
      const moved = Math.hypot(fighter.position.x - beforeX, fighter.position.z - beforeZ);
      worstResistance = Math.max(worstResistance, stride - moved);
      stalls = moved < stride * 0.25 ? stalls + 1 : 0;
      if (stalls > 120) break;
    }
    return {
      x: fighter.position.x, y: fighter.position.y, z: fighter.position.z,
      startY, worstResistance, trace,
      distance: Math.hypot(to.x - fighter.position.x, to.z - fighter.position.z)
    };
  }, { from: route.from, to: route.to });

  // These legs are named exactly like the entries in HOGWARTS_NAV_ROUTES, so every route the
  // traversal graph cites is also walked in the running game (see the graph check below).
  const routes = [
    { name: 'Great Hall doorway → Entrance Hall', from: { x: 16.5, z: -94, y: 0.57 }, to: { x: 30, z: -94 }, toY: 0.6 },
    { name: 'Entrance Hall → Marble Corridor → Library', from: { x: 30, z: -95, y: 0.6 },
      via: [{ x: 43, z: -95 }, { x: 43, z: -107.5 }], to: { x: 52, z: -107.5 }, toY: 0.6 },
    { name: 'Entrance Hall → Grand Staircase → first floor landing', from: { x: 30, z: -104, y: 0.6 }, to: { x: 27.5, z: -116 }, toY: 5.0 },
    { name: 'Grand Staircase → second floor landing → Marble Corridor', from: { x: 36, z: -119, y: 5.0 },
      via: [{ x: 36, z: -108.4 }, { x: 39, z: -105.7 }], to: { x: 43, z: -105.7 }, toY: 9.4 },
    { name: 'Marble Corridor → Gryffindor common room', from: { x: 43, z: -137.5, y: 5.0 }, to: { x: 34, z: -137.5 }, toY: 5.0 },
    { name: 'Gryffindor → back to the Marble Corridor', from: { x: 34, z: -137.5, y: 5.0 }, to: { x: 43, z: -137.5 }, toY: 5.0 },
    { name: 'Courtyard gate → Dungeons passage', from: { x: -34, z: -58, y: 0.7 }, to: { x: -34, z: -77 }, toY: 0.3 },
    { name: 'Courtyard → viaduct → grounds', from: { x: 0, z: -38, y: 0.3 }, to: { x: 0, z: 52 }, toY: 0.3 },
    { name: 'Grounds → viaduct → courtyard', from: { x: 0, z: 52, y: 0.3 }, to: { x: 0, z: -38 }, toY: 0.3 },
    { name: 'Courtyard cloister → stair turret → battlement wall walk', from: { x: 30, z: -58, y: 0.3 },
      via: [{ x: 32, z: -58 }, { x: 33.5, z: -58 }, { x: 35, z: -58.5 },
        { x: 36.9, z: -61.2 }, { x: 41, z: -61.2 }, { x: 42, z: -61.2 }, { x: 42, z: -57.8 },
        { x: 41, z: -57.8 }, { x: 36.9, z: -57.8 }, { x: 35.9, z: -57.8 }, { x: 35.9, z: -61.2 },
        { x: 36.9, z: -61.2 }, { x: 41, z: -61.2 }, { x: 42, z: -61.2 }, { x: 42, z: -57.8 },
        { x: 41, z: -57.8 }, { x: 36.9, z: -57.8 }, { x: 35.9, z: -57.8 }, { x: 35.9, z: -61.2 },
        { x: 36.9, z: -61.2 }, { x: 41, z: -61.2 }, { x: 41.6, z: -61.2 }, { x: 41.6, z: -63.2 }],
      to: { x: 41.6, z: -64.8 }, toY: 22.8 },
    { name: 'Battlement wall walk → tower decks', from: { x: 41.6, z: -64.8, y: 22.8 },
      via: [{ x: 20, z: -65.4 }, { x: 20, z: -69.6 }, { x: 20, z: -65.4 }, { x: -20, z: -65.4 }],
      to: { x: -20, z: -69.6 }, toY: 23.0 },
    { name: 'Grounds → Black Lake shore', from: { x: 0, z: 80, y: 0.3 }, to: { x: 0, z: 92.5 }, toY: 0.58 },
    { name: "Grounds → Hagrid's hut", from: { x: -24, z: 66, y: 0.3 },
      via: [{ x: -40, z: 61 }, { x: -52, z: 44 }, { x: -66, z: 34 }, { x: -84, z: 30 }, { x: -96, z: 22 }],
      to: { x: -96, z: 13 }, toY: 0.3 },
    { name: "Hagrid's hut door → interior", from: { x: -96, z: 13.2, y: 0.3 },
      via: [{ x: -96, z: 11.6 }], to: { x: -96, z: 6.5 }, toY: 0.36 },
    { name: "Hagrid's hut → grounds", from: { x: -96, z: 13, y: 0.3 },
      via: [{ x: -96, z: 22 }, { x: -84, z: 30 }, { x: -66, z: 34 }, { x: -52, z: 44 }, { x: -40, z: 61 }],
      to: { x: -24, z: 66 }, toY: 0.3 }
  ];

  for (const route of routes) {
    const points = [route.from, ...(route.via || []), route.to]
      .map(point => ({ x: point.x, z: point.z, y: point.y ?? route.from.y }));
    let end, firstStart;
    // Each leg starts at the height the previous one finished at: dropping a fighter onto a
    // mid-flight waypoint at the route's start height would put it under the stairs.
    let carriedY = route.from.y;
    for (let i = 1; i < points.length; i++) {
      end = await walk({ from: { ...points[i - 1], y: carriedY }, to: points[i] });
      if (i === 1) firstStart = end.startY;
      carriedY = end.y;
    }
    check(`${route.name}: starts on the ${route.from.y} m floor`, Math.abs(firstStart - route.from.y) < 0.4,
      `started at y ${firstStart.toFixed(2)}`);
    check(`${route.name}: arrives`, end.distance < 1.1,
      `${end.distance.toFixed(2)} m short at (${end.x.toFixed(1)}, ${end.y.toFixed(2)}, ${end.z.toFixed(1)}), resistance ${end.worstResistance.toFixed(3)}`);
    check(`${route.name}: ends on the ${route.toY} m floor`, Math.abs(end.y - route.toY) < 0.35,
      `y ${end.y.toFixed(2)} ${end.trace.join(' | ')}`);
    check(`${route.name}: unobstructed`, end.worstResistance < 0.05, `worst push ${end.worstResistance.toFixed(3)} m`);
  }

  // ---- the graph's routes are the ones walked above ---------------------------
  {
    const walked = new Set(routes.map(route => route.name));
    const missing = HOGWARTS_NAV_ROUTES.filter(route => !walked.has(route.name)).map(route => route.name);
    check('every route in the traversal data is walked in the real game', missing.length === 0, missing.join(', '));
    const proven = new Set(HOGWARTS_CONNECTIONS.filter(edge => edge.route).map(edge => edge.route));
    check('every connection the graph proves is one of those routes',
      [...proven].every(name => walked.has(name)), [...proven].filter(name => !walked.has(name)).join(', '));
  }

  // ---- one continuous journey: grounds → bridge → courtyard → Great Hall → castle ----
  // No teleporting between legs: each leg starts where the last one finished, and the game's
  // own collision and floor code decide the height at every step.
  const journeyStops = [
    { name: 'grounds', x: 0, y: 0.3, z: 52 },
    { name: 'viaduct', x: 0, y: 1.25, z: 10 },
    { name: 'courtyard', x: 0, y: 0.3, z: -38 },
    { name: 'Great Hall gate', x: 0, y: 0.57, z: -70 },
    { name: 'Great Hall nave', x: 0, y: 0.57, z: -90 },
    { name: 'Great Hall aisle', x: 0, y: 0.57, z: -68 },
    { name: 'Great Hall east aisle', x: 17, y: 0.57, z: -68 },
    { name: 'Great Hall doorway', x: 17, y: 0.57, z: -94 },
    { name: 'range doorway', x: 24, y: 0.6, z: -94 },
    { name: 'Entrance Hall', x: 30, y: 0.6, z: -95 },
    { name: 'stair foot', x: 30, y: 0.6, z: -105 },
    { name: 'first floor landing', x: 27.5, y: 5, z: -116 },
    { name: 'first floor landing east', x: 36, y: 5, z: -119 },
    { name: 'second floor', x: 36, y: 9.4, z: -106 },
    { name: 'second floor landing', x: 39, y: 9.4, z: -105.7 },
    { name: 'second floor corridor', x: 43, y: 9.4, z: -105.7 },
    { name: 'corridor north', x: 43, y: 9.4, z: -79 },
    { name: 'Astronomy Tower', x: 52, y: 9.4, z: -79 },
    { name: 'corridor north', x: 43, y: 9.4, z: -79 },
    { name: 'second floor corridor', x: 43, y: 9.4, z: -105.7 },
    { name: 'second floor landing', x: 39, y: 9.4, z: -105.7 },
    { name: 'second floor', x: 36, y: 9.4, z: -106 },
    { name: 'first floor landing east', x: 36, y: 5, z: -119 },
    { name: 'first floor landing', x: 27.5, y: 5, z: -116 },
    { name: 'stair foot', x: 30, y: 0.6, z: -105 },
    { name: 'Entrance Hall', x: 30, y: 0.6, z: -95 },
    { name: 'range doorway', x: 24, y: 0.6, z: -94 },
    { name: 'Great Hall doorway', x: 17, y: 0.57, z: -94 },
    { name: 'Great Hall east aisle', x: 17, y: 0.57, z: -68 },
    { name: 'Great Hall aisle', x: 0, y: 0.57, z: -68 },
    { name: 'courtyard', x: 0, y: 0.3, z: -38 },
    { name: 'viaduct', x: 0, y: 1.25, z: 10 },
    { name: 'grounds', x: 0, y: 0.3, z: 52 }
  ];
  const journey = await page.evaluate(stops => {
    const fighter = window.fighters[0];
    const at = stops[0];
    fighter.position.set(at.x, at.y, at.z);
    if (fighter.model?.position) fighter.model.position.set(at.x, at.y, at.z);
    fighter.velocity.set(0, 0, 0);
    window.__browserSmashStep(0.5);
    const out = [{ name: at.name, x: fighter.position.x, y: fighter.position.y, z: fighter.position.z }];
    for (let s = 1; s < stops.length; s++) {
      const stop = stops[s];
      for (let i = 0; i < 6000; i++) {
        const dx = stop.x - fighter.position.x, dz = stop.z - fighter.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance < 0.25) break;
        const stride = Math.min(0.07, distance);
        fighter.position.x += dx / distance * stride;
        fighter.position.z += dz / distance * stride;
        window.__browserSmashStep(1 / 120);
      }
      out.push({ name: stop.name, x: fighter.position.x, y: fighter.position.y, z: fighter.position.z });
    }
    return out;
  }, journeyStops);
  const expectedY = { grounds: 0.3, viaduct: 1.25, courtyard: 0.3, 'Great Hall gate': 0.57,
    'Great Hall nave': 0.57, 'Great Hall aisle': 0.57, 'Great Hall east aisle': 0.57, 'Great Hall doorway': 0.57,
    'range doorway': 0.6, 'Entrance Hall': 0.6, 'stair foot': 0.6, 'first floor landing': 5.0,
    'first floor landing east': 5.0, 'second floor': 9.4, 'second floor landing': 9.4,
    'second floor corridor': 9.4, 'corridor north': 9.4, 'Astronomy Tower': 9.4 };
  journey.forEach((stop, index) => {
    const target = journeyStops[index];
    check(`journey: reached ${stop.name}`, Math.hypot(stop.x - target.x, stop.z - target.z) < 1.2,
      `${Math.hypot(stop.x - target.x, stop.z - target.z).toFixed(2)} m short at (${stop.x.toFixed(1)}, ${stop.z.toFixed(1)})`);
    check(`journey: ${stop.name} stands on its own floor (${expectedY[stop.name]} m)`,
      Math.abs(stop.y - expectedY[stop.name]) < 0.4, `y ${stop.y.toFixed(2)} at (${stop.x.toFixed(1)}, ${stop.z.toFixed(1)})`);
  });
  const last = journey[journey.length - 1];
  check('journey: the round trip ends back on the grounds', Math.hypot(last.x - 0, last.z - 52) < 1.2,
    `${last.x.toFixed(1)}, ${last.z.toFixed(1)}`);

  // ---- multi-floor: a dropped fighter settles on the floor below, not the one above
  const floors = await page.evaluate(() => {
    const fighter = window.fighters[0];
    const probes = [
      { x: 31, z: -137, y: 5.0, label: 'first floor (Gryffindor)' },
      { x: 31, z: -79, y: 9.4, label: 'second floor (Room of Requirement)' },
      { x: 55, z: -107, y: 0.6, label: 'ground floor (library)' },
      { x: 43, z: -137.5, y: 5.0, label: 'first floor corridor' }
    ];
    return probes.map(probe => {
      fighter.position.set(probe.x, probe.y + 0.9, probe.z);
      if (fighter.model?.position) fighter.model.position.set(probe.x, probe.y + 0.9, probe.z);
      fighter.velocity.set(0, 0, 0);
      window.__browserSmashStep(1.6);
      return { label: probe.label, expected: probe.y, got: fighter.position.y };
    });
  });
  for (const floor of floors) {
    check(`${floor.label}: the fighter settles on its own floor`, Math.abs(floor.got - floor.expected) < 0.3,
      `y ${floor.got.toFixed(2)} vs ${floor.expected}`);
  }

  // ---- Hagrid's hut: a real door, a real interior, walls that hold -------------------
  const hut = await page.evaluate(async () => {
    const fighter = window.fighters[0];
    window.__browserSmashSelect.chooseArena('hogwarts_hagrid');
    await window.__browserSmashExplore();
    const place = (x, y, z) => {
      fighter.position.set(x, y, z);
      if (fighter.model?.position) fighter.model.position.set(x, y, z);
      fighter.velocity.set(0, 0, 0);
    };
    const walkTo = (x, z, steps = 900) => {
      for (let i = 0; i < steps; i++) {
        const dx = x - fighter.position.x, dz = z - fighter.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance < 0.08) break;
        const stride = Math.min(0.06, distance);
        fighter.position.x += dx / distance * stride;
        fighter.position.z += dz / distance * stride;
        window.__browserSmashStep(1 / 120);
      }
      return { x: fighter.position.x, y: fighter.position.y, z: fighter.position.z };
    };
    place(-96, 0.3, 14.6);
    const inside = walkTo(-96, 6.5);
    const turned = walkTo(-96.6, 3.6);
    const backOut = walkTo(-96, 14.6);
    place(-91.5, 0.3, 13.6);
    const blocked = walkTo(-91.5, 6);
    place(-96, 3.4, 9.5);
    window.__browserSmashStep(2.2);
    const dropped = { x: fighter.position.x, y: fighter.position.y, z: fighter.position.z };
    return { inside, turned, backOut, blocked, dropped };
  });
  check("Hagrid's hut: the door admits the fighter", Math.hypot(hut.inside.x + 96, hut.inside.z - 6.5) < 0.7,
    `stopped at (${hut.inside.x.toFixed(1)}, ${hut.inside.z.toFixed(1)})`);
  check("Hagrid's hut: the interior floor is continuous with the threshold", Math.abs(hut.inside.y - 0.36) < 0.12,
    `y ${hut.inside.y.toFixed(2)}`);
  check("Hagrid's hut: the fighter can turn around inside", Math.hypot(hut.turned.x + 96.6, hut.turned.z - 3.6) < 0.7,
    `(${hut.turned.x.toFixed(1)}, ${hut.turned.z.toFixed(1)})`);
  check("Hagrid's hut: the same door lets the fighter back out", hut.backOut.z > 14.0, `z ${hut.backOut.z.toFixed(1)}`);
  const blockedRange = Math.hypot(hut.blocked.x + 96, hut.blocked.z - 6);
  check("Hagrid's hut: the wall beside the door does not let the fighter through", blockedRange > 5.2,
    `parked ${blockedRange.toFixed(2)} m from the hearth instead of walking through the wall`);
  check("Hagrid's hut: the roof does not trap a fighter dropped inside", Math.abs(hut.dropped.y - 0.36) < 0.2,
    `y ${hut.dropped.y.toFixed(2)}`);

  // ---- the explore camera in tight spaces -------------------------------------------
  const camera = await page.evaluate(async () => {
    const fighter = window.fighters[0];
    window.__browserSmashSelect.chooseArena('hogwarts_entrance_hall');
    await window.__browserSmashExplore();
    const measure = (x, z, y) => {
      fighter.position.set(x, y, z);
      if (fighter.model?.position) fighter.model.position.set(x, y, z);
      fighter.velocity.set(0, 0, 0);
      window.smashCamera.resetOrbit?.();
      window.__browserSmashStep(2.6);
      const shot = window.smashCamera.camera.position;
      return { reach: Math.hypot(shot.x - x, shot.y - (y + 1.45), shot.z - z), height: shot.y - y };
    };
    const turret = measure(39, -57, 0.72);
    const open = measure(22, -50, 0.3);
    window.__browserSmashLeaveExplore();
    window.__browserSmashSelect.chooseArena('hogwarts_grounds');
    document.querySelector('#play').click();
    window.__browserSmashStep(1.8);
    const a = window.fighters[0].position, b = window.fighters[1].position;
    const shot = window.smashCamera.camera.position;
    const arena = Math.hypot(shot.x - (a.x + b.x) / 2, shot.y - (a.y + b.y) / 2, shot.z - (a.z + b.z) / 2);
    return { turret, open, arena };
  });
  check('the free camera stays clear of the fighter in the 7.6 m stair well', camera.turret.reach > 2.3,
    `reach ${camera.turret.reach.toFixed(2)} m`);
  check('the free camera lifts over the wall instead of sitting at head height', camera.turret.height > 2.0,
    `${camera.turret.height.toFixed(2)} m above the floor`);
  check('the free camera returns to its trailing distance in the open', camera.open.reach > 4.5,
    `reach ${camera.open.reach.toFixed(2)} m`);
  check('the duel camera still pulls back for a match', camera.arena > 7,
    `${camera.arena.toFixed(2)} m from the fighters`);

  // ---- free exploration crosses stage edges; a match does not -----------------
  const modes = await page.evaluate(async () => {
    const fighter = window.fighters[0];
    window.__browserSmashSelect.chooseArena('hogwarts_grounds');
    await window.__browserSmashExplore();
    fighter.position.set(0, 0.3, 70);
    fighter.velocity.set(0, 0, 0);
    for (let i = 0; i < 400; i++) { fighter.position.z += 0.07; window.__browserSmashStep(1 / 120); }
    const roamZ = fighter.position.z;
    window.__browserSmashLeaveExplore();
    window.__browserSmashSelect.chooseArena('hogwarts_grounds');
    document.querySelector('#play').click();
    window.__browserSmashStep(0.1);
    fighter.position.set(0, 0.3, 70);
    for (let i = 0; i < 400; i++) { fighter.position.z += 0.07; window.__browserSmashStep(1 / 120); }
    return { roamZ, matchZ: fighter.position.z, bounds: fighter.bounds ? { ...fighter.bounds } : null };
  });
  check('free exploration walks past the grounds stage edge', modes.roamZ > 84, `stopped at z ${modes.roamZ.toFixed(1)}`);
  check('a match still fences the fighters inside the grounds', Boolean(modes.bounds) && modes.matchZ <= modes.bounds.z1 + 0.1,
    `z ${modes.matchZ.toFixed(1)} vs bound ${modes.bounds && modes.bounds.z1}`);

  // ---- a match on a new stage stays inside the room -------------------------
  await page.evaluate(() => window.__browserSmashLeaveExplore());
  await page.evaluate(() => window.__browserSmashSelect.chooseArena('hogwarts_library'));
  await page.evaluate(() => document.querySelector('#play').click());
  await page.evaluate(() => window.__browserSmashStep(1.2));
  const match = await page.evaluate(() => {
    const fighter = window.fighters[0];
    return { x: fighter.position.x, y: fighter.position.y, z: fighter.position.z, bounds: fighter.bounds };
  });
  check('a library match spawns the fighters on the library floor', Math.abs(match.y - 0.6) < 0.4, `y ${match.y.toFixed(2)}`);
  check('the library match is fenced to the library', Boolean(match.bounds) && match.x >= match.bounds.x0 - .1 && match.x <= match.bounds.x1 + .1
    && match.z >= match.bounds.z0 - .1 && match.z <= match.bounds.z1 + .1, JSON.stringify(match.bounds));

  // ---- visual gallery -------------------------------------------------------
  if (capture) {
    await page.evaluate(() => window.__browserSmashLeaveExplore());
    const shots = [
      { file: '01-entrance-hall', arena: 'hogwarts_entrance_hall', at: { x: 31, z: -97, y: 0.6 } },
      { file: '02-grand-staircase', arena: 'hogwarts_entrance_hall', at: { x: 31, z: -98, y: 0.6 } },
      { file: '03-library', arena: 'hogwarts_library', at: { x: 55, z: -108, y: 0.6 } },
      { file: '04-gryffindor', arena: 'hogwarts_gryffindor', at: { x: 31, z: -137, y: 5.0 } },
      { file: '05-astronomy', arena: 'hogwarts_astronomy', at: { x: 55, z: -80, y: 9.4 } },
      { file: '06-kitchens', arena: 'hogwarts_kitchens', at: { x: 31, z: -137, y: 0.6 } },
      { file: '07-great-hall', arena: 'hogwarts_great_hall', at: { x: 10, z: -90, y: 0.57 } },
      { file: '08-dungeon-passage', arena: 'hogwarts_dungeons', at: { x: -34, z: -70, y: 0.3 } },
      { file: '09-marble-corridor', arena: 'hogwarts_entrance_hall', at: { x: 43, z: -96, y: 0.6 } },
      { file: '10-grounds-path', arena: 'hogwarts_grounds', at: { x: 0, z: 50, y: 0.3 } },
      { file: '13-stair-turret', arena: 'hogwarts_entrance_hall', at: { x: 39, z: -57, y: 0.72 } },
      { file: '20-turret-camera-open', arena: 'hogwarts_entrance_hall', at: { x: 39, z: -58.5, y: 0.72 } },
      { file: '14-wall-walk', arena: 'hogwarts_entrance_hall', at: { x: 24, z: -65.4, y: 22.8 } },
      { file: '15-lakeshore', arena: 'hogwarts_lakeshore', at: { x: 0, z: 91, y: 0.58 } },
      { file: '16-hagrids-hut', arena: 'hogwarts_hagrid', at: { x: -96, z: 17, y: 0.3 } },
      { file: '17-hut-doorway', arena: 'hogwarts_hagrid', at: { x: -96, z: 12.6, y: 0.36 } },
      { file: '18-hut-interior', arena: 'hogwarts_hagrid', at: { x: -96, z: 4.9, y: 0.36 } }
    ];
    for (const shot of shots) {
      await page.evaluate(arena => window.__browserSmashSelect.chooseArena(arena), shot.arena);
      await page.evaluate(() => window.__browserSmashExplore());
      await page.evaluate(position => {
        const fighter = window.fighters[0];
        fighter.position.set(position.x, position.y + 0.3, position.z);
        if (fighter.model?.position) fighter.model.position.set(position.x, position.y + 0.3, position.z);
        fighter.velocity.set(0, 0, 0);
        window.smashCamera.resetOrbit?.();
      }, shot.at);
      await page.evaluate(seconds => window.__browserSmashStep(seconds), 2.4);
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      await page.screenshot({ path: resolve(shotDir, `${shot.file}.png`) });
      console.log(`  shot artifacts/hogwarts/${shot.file}.png`);
    }

    // A fight is the view the map is really seen from, so the grounds and the bridge are
    // captured through the match camera rather than the free camera.
    for (const [file, arena, floor] of [['11-grounds-fight', 'hogwarts_grounds', 0.3], ['12-viaduct-crossing', 'hogwarts_viaduct', 1.25]]) {
      await page.evaluate(() => window.__browserSmashLeaveExplore());
      await page.evaluate(key => window.__browserSmashSelect.chooseArena(key), arena);
      await page.evaluate(() => document.querySelector('#play').click());
      // Every earlier capture ran in the free camera, which leaves the match on the overhead
      // view; the cinematic duel camera is the one that shows the castle behind the fighters.
      await page.evaluate(() => {
        const select = document.querySelector('#cameraMode');
        if (select) { select.value = 'classic'; select.dispatchEvent(new Event('change')); }
      });
      // Read the spawn before the CPU has had time to walk or jump: the fighters are placed
      // by placeFightersAtSpawns, so a long step would be measuring the CPU's decisions.
      const spawned = await page.evaluate(() => {
        window.__browserSmashStep(0.05);
        const fighter = window.fighters[0];
        return { y: fighter.position.y, x: fighter.position.x, z: fighter.position.z };
      });
      check(`a match on ${arena} spawns on its own floor`, Math.abs(spawned.y - floor) < 0.4,
        `y ${spawned.y.toFixed(2)} at (${spawned.x.toFixed(1)}, ${spawned.z.toFixed(1)})`);
      await page.evaluate(() => window.__browserSmashStep(3.2));
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      await page.screenshot({ path: resolve(shotDir, `${file}.png`) });
      console.log(`  shot artifacts/hogwarts/${file}.png`);
    }
  }

  check('no page errors while exploring the castle', pageErrors.length === 0, pageErrors.slice(0, 2).join('\n'));
} finally {
  await browser?.close();
  server.close();
}

console.log(`\n✓ Hogwarts interior checks passed: ${results.length} assertions`);
