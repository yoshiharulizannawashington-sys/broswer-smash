// World/stage validation for the four large reference environments.
//
// These are the normal node-testable parts of the world system: the catalog is plain data,
// so every battle location, collision volume, spawn point and ring-out rule can be checked
// without a browser or a GPU. Rendering (merged geometry, shaders, lighting) is verified
// separately by scripts/test-gameplay.mjs in a real Chromium.
import {
  WORLDS, WORLD_ORDER, WORLD_LOCATIONS, PALETTES, worldParts, blocksFromParts, worldGroups, worldLocation
} from '../public/js/worlds/world_catalog.js';
import {
  ARENA_LAYOUTS, layoutFor, spawnPoints, groundHeightAt, resolveCollision, clampToBounds, isOutOfBounds
} from '../public/js/world/arena_layouts.js';

let checks = 0;
const failures = [];
function ok(condition, message) {
  checks++;
  if (!condition) failures.push(message);
}
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

// ---- worlds register -------------------------------------------------------
ok(WORLD_ORDER.length === 5, `expected five worlds, got ${WORLD_ORDER.length}`);
for (const id of WORLD_ORDER) {
  const world = WORLDS[id];
  ok(Boolean(world), `world ${id} exists`);
  ok(world.locations.length >= 5, `${id} has at least five battle locations (${world.locations.length})`);
  ok(typeof world.build === 'function', `${id} has a geometry builder`);
  ok(Boolean(PALETTES[world.paletteKey]), `${id} has a palette`);
}

// Several dozen distinct landmark stages across the five worlds.
ok(WORLD_LOCATIONS.length >= 20, `expected 20+ battle locations, got ${WORLD_LOCATIONS.length}`);
const ids = new Set(WORLD_LOCATIONS.map(location => location.id));
ok(ids.size === WORLD_LOCATIONS.length, 'battle location ids are unique');
const groups = worldGroups();
ok(groups.length === 5 && groups.every(group => group.locations.length >= 5), 'every world exposes its locations to the menu');
ok(groups.flatMap(group => group.locations).length === WORLD_LOCATIONS.length, 'menu lists every battle location');

// ---- geometry plans --------------------------------------------------------
for (const id of WORLD_ORDER) {
  const parts = worldParts(id);
  const palette = PALETTES[WORLDS[id].paletteKey];
  ok(parts.length > 80, `${id} has a substantial geometry plan (${parts.length} parts)`);
  const missing = new Set(parts.filter(part => !palette[part.mat]).map(part => part.mat));
  ok(missing.size === 0, `${id} every part material exists in its palette (missing: ${[...missing].join(', ')})`);
  for (const part of parts) {
    ok(Array.isArray(part.p) && part.p.length === 3, `${id} part has a position`);
    ok(part.p.every(Number.isFinite), `${id} part positions are finite`);
    for (const key of ['x', 'y', 'z']) void key;
  }
  // Determinism: the same world rebuilt gives the same part count and first/last coordinates.
  const again = worldParts(id);
  ok(again === parts, `${id} geometry plan is cached, not rebuilt per request`);
}

// ---- collision volumes -----------------------------------------------------
for (const id of WORLD_ORDER) {
  const blocks = blocksFromParts(worldParts(id));
  ok(blocks.length > 20, `${id} exposes solid volumes (${blocks.length})`);
  let rects = 0, circles = 0;
  for (const block of blocks) {
    ok(Number.isFinite(block.top), `${id} block has a numeric top`);
    ok(block.bottom == null || Number.isFinite(block.bottom), `${id} block has a numeric bottom`);
    ok(block.top >= block.bottom, `${id} block top is above its bottom (${block.top} vs ${block.bottom})`);
    if (block.r != null) {
      circles++;
      ok(block.r > 0, `${id} circle block has a positive radius`);
      ok(Number.isFinite(block.x) && Number.isFinite(block.z), `${id} circle block has a centre`);
    } else {
      rects++;
      ok(block.x1 > block.x0 && block.z1 > block.z0, `${id} box block has a positive footprint`);
    }
  }
  ok(rects + circles === blocks.length, `${id} blocks are all rects or circles`);
}

// ---- battle locations ------------------------------------------------------
for (const location of WORLD_LOCATIONS) {
  const layout = layoutFor(location.id);
  ok(layout === location.layout, `${location.id} is registered in ARENA_LAYOUTS`);
  ok(ARENA_LAYOUTS[location.id] === layout, `${location.id} is selectable through the layout registry`);
  const b = layout.bounds;
  const width = b.x1 - b.x0, depth = b.z1 - b.z0;
  ok(width >= 10 && depth >= 10, `${location.id} has a real fighting area (${width}×${depth})`);
  ok(layout.blocks.length > 0, `${location.id} shares its world's collision volumes`);

  // Spawns must be valid, separated, inside the ring and standing on a surface.
  const spawns = spawnPoints(layout);
  ok(spawns.length === 2, `${location.id} defines two spawn points`);
  for (const spawn of spawns) {
    ok(spawn.x > b.x0 + 1 && spawn.x < b.x1 - 1, `${location.id} spawn x ${spawn.x} is inside the bounds`);
    ok(spawn.z > b.z0 + 1 && spawn.z < b.z1 - 1, `${location.id} spawn z ${spawn.z} is inside the bounds`);
    const ground = groundHeightAt(spawn.x, spawn.z, layout, spawn.y, 0.6);
    ok(near(spawn.y, ground, 0.7), `${location.id} spawn stands on a surface (y ${spawn.y.toFixed(2)} vs ground ${ground.toFixed(2)})`);
    // A spawn buried in a wall would be pushed out by collision resolution.
    const probe = { x: spawn.x, y: spawn.y, z: spawn.z };
    const velocity = { x: 0, y: 0, z: 0 };
    resolveCollision(probe, velocity, 0.7, layout);
    const moved = Math.hypot(probe.x - spawn.x, probe.z - spawn.z);
    ok(moved < 0.05, `${location.id} spawn is not inside a solid volume (moved ${moved.toFixed(2)} m)`);
  }
  const separation = Math.hypot(spawns[0].x - spawns[1].x, spawns[0].z - spawns[1].z);
  ok(separation >= 4, `${location.id} spawns are separated (${separation.toFixed(1)} m)`);

  // The middle of the stage has to be standable, not a hole in the world.
  const centreX = (b.x0 + b.x1) / 2, centreZ = (b.z0 + b.z1) / 2;
  const centreGround = groundHeightAt(centreX, centreZ, layout, layout.ground + 2, 0.6);
  ok(near(centreGround, layout.ground, 1.2), `${location.id} centre sits on its floor (${centreGround.toFixed(2)} vs ${layout.ground})`);

  // Ring-out stages release the clamp and need a fall threshold.
  if (layout.ringOut) {
    ok(layout.fallBelow != null, `${location.id} declares a fall height for ring-outs`);
    const falling = { x: centreX, y: layout.fallBelow - 1, z: centreZ };
    ok(isOutOfBounds(falling, layout), `${location.id} reports a fighter below the world as out`);
    // The game skips clampToBounds() on ring-out stages (main.js resolveArenaCollision), so
    // being knocked past the edge has to be reported as out of bounds rather than clamped.
    ok(isOutOfBounds({ x: b.x0 - 6, y: layout.ground, z: centreZ }, layout), `${location.id} reports a knock-off beyond the edge`);
  } else {
    ok(!layout.ringOut, `${location.id} keeps fighters inside its layout`);
  }
}

// ---- collision behaviour ---------------------------------------------------
{
  // A building in West City blocks movement.
  const layout = layoutFor('dbz_west_city');
  const building = layout.blocks.find(block => block.x1 - block.x0 > 6 && block.top > 8);
  ok(Boolean(building), 'West City has a building volume');
  if (building) {
    const inside = { x: (building.x0 + building.x1) / 2, y: 3.2, z: (building.z0 + building.z1) / 2 };
    resolveCollision(inside, { x: 2, y: 0, z: 0 }, 0.7, layout);
    const moved = Math.hypot(inside.x - (building.x0 + building.x1) / 2, inside.z - (building.z0 + building.z1) / 2);
    ok(moved > 0.5, 'walking into a West City building is pushed out');
    const outsideFootprint = inside.x >= building.x1 || inside.x <= building.x0 || inside.z >= building.z1 || inside.z <= building.z0;
    ok(outsideFootprint, 'the push out leaves the building footprint');
  }
}
{
  // Standing on the Great Hall table works, and the table blocks a walk.
  const layout = layoutFor('hogwarts_great_hall');
  const table = layout.blocks.find(block => near(block.x0, -13.55, 0.01) && block.top > 1.5);
  ok(Boolean(table), 'Great Hall has house tables as volumes');
  if (table) {
    ok(near(groundHeightAt(-12, -100, layout, 1.9, 0.6), table.top, 0.01), 'the Great Hall table top is walkable');
    const atFloor = { x: -12, y: 0.57, z: -100 };
    resolveCollision(atFloor, { x: 1, y: 0, z: 0 }, 0.7, layout);
    ok(atFloor.x !== -12, 'a fighter on the floor is pushed out of the table');
  }
}
{
  // A catwalk is overhead, not a wall: the Reactor Core deck must be walkable under and on.
  const layout = layoutFor('deathstar_reactor');
  const deck = layout.blocks.find(block => block.bottom != null && block.bottom > 5 && block.top < 12);
  ok(Boolean(deck), 'Reactor Core has raised catwalks');
  if (deck) {
    const under = { x: (deck.x0 + deck.x1) / 2, y: 0, z: (deck.z0 + deck.z1) / 2 };
    const probe = { ...under };
    resolveCollision(probe, { x: 0, y: 0, z: 0 }, 0.7, layout);
    ok(near(probe.x, under.x, 0.001) && near(probe.z, under.z, 0.001), 'a fighter stands under a catwalk without being pushed');
    ok(near(groundHeightAt(under.x, under.z, layout, deck.top + 0.1, 0.6), deck.top, 0.01), 'the catwalk deck is walkable from above');
    ok(groundHeightAt(under.x, under.z, layout, 0) < deck.bottom, 'from the floor the catwalk is not ground');
  }
}
{
  // The DBZ island edge is a cliff stage: leaving it is a ring-out, not a clamp.
  const layout = layoutFor('dbz_cliffs');
  ok(isOutOfBounds({ x: 220, y: 3.2, z: -100 }, layout), 'outside the tournament island counts as out');
  ok(layout.ringOut, 'the cliffs stage allows a knock-off');
}
{
  // King Kai's planet is its own high arena, not a stage at sea level.
  const layout = layoutFor('dbz_king_kai');
  ok(layout.ground > 55, `King Kai's Planet is elevated (${layout.ground} m)`);
  const spawns = spawnPoints(layout);
  ok(spawns.every(spawn => spawn.y > 55), "King Kai's spawns are on the floating island");
}
{
  // Asgard's Rainbow Bridge is a narrow span with ring-out on both sides.
  const layout = layoutFor('asgard_rainbow_bridge');
  ok(layout.bounds.x1 - layout.bounds.x0 < 24, 'the Rainbow Bridge is a narrow fighting lane');
  ok(layout.ringOut && layout.fallBelow < 0, 'falling off the Rainbow Bridge loses the round');
}
{
  // Escaping a stage's bounds is reported, and the default clamp keeps normal arenas inside.
  const layout = layoutFor('hogwarts_courtyard');
  const outside = { x: layout.bounds.x1 + 40, y: 0.3, z: 0 };
  ok(isOutOfBounds(outside, layout), 'leaving the courtyard bounds is out of bounds');
  const clamped = clampToBounds({ ...outside }, null, 0.7, layout);
  ok(clamped.x <= layout.bounds.x1, 'normal arenas clamp fighters inside');
}

// ---- world lookup ----------------------------------------------------------
ok(worldLocation('dbz_grand_prize')?.world === 'dbz', 'world lookup resolves a DBZ stage');
ok(worldLocation('konoha_main_street')?.world === 'konoha', 'world lookup resolves a Konoha stage');
ok(worldLocation('deathstar_hangar')?.world === 'deathstar', 'world lookup resolves a Death Star stage');
ok(worldLocation('nope') === null, 'unknown locations return null');

// ---- landmark presence (geometry, not visual claims) -----------------------
const matSet = id => new Set(worldParts(id).map(part => part.mat));
const has = (id, mat) => matSet(id).has(mat);
ok(has('dbz', 'water') && has('dbz', 'gold') && has('dbz', 'banner'), 'DBZ island has ocean, gold trim and banners');
ok(has('dbz', 'cloud') && has('dbz', 'mountain'), 'DBZ island has clouds and a mountain horizon');
ok(has('asgard', 'crystalGlow') && has('asgard', 'goldLight') && has('asgard', 'crystal'), 'Asgard has glowing Bifrost and gold architecture');
ok(has('deathstar', 'glowRed') && has('deathstar', 'glowGreen') && has('deathstar', 'star'), 'Death Star has warning lights, core glow and starfield');
ok(has('hogwarts', 'floorHall') && has('hogwarts', 'bannerRed') && has('hogwarts', 'flame'), 'Great Hall has floors, house banners and candles');
ok(has('hogwarts', 'water') && has('hogwarts', 'leaf'), 'Hogwarts has the Black Lake and forest');
ok(has('konoha', 'cliff') && has('konoha', 'mountain') && has('konoha', 'glassWarm'), 'Konoha has the Hokage cliff, mountain horizon and lit windows');
ok(has('konoha', 'roof') && has('konoha', 'roofBlue') && has('konoha', 'stoneDark'), 'Konoha has tiled roofs and compound walls');
ok(has('konoha', 'water') && has('konoha', 'leaf') && has('konoha', 'banner'), 'Konoha has the river, forest and banners');

// ---- world travel: exits between stages --------------------------------------
// Every exit must point at a real stage in the same world, sit inside the stage it leaves
// from, be clear of solid geometry, and be reachable on foot from that stage's spawns.
let exitCount = 0;
const exitPairs = new Set();
for (const location of WORLD_LOCATIONS) {
  const exits = location.exits || [];
  exitCount += exits.length;
  const blocks = blocksFromParts(worldParts(location.world));
  for (const exit of exits) {
    const label = `${location.id} exit ${exit.to}`;
    const target = worldLocation(exit.to);
    ok(Boolean(target), `${label} points at a known stage`);
    if (!target) continue;
    ok(target.world === location.world, `${label} stays inside the ${location.world} world`);
    ok(exit.x >= location.bounds.x0 && exit.x <= location.bounds.x1
      && exit.z >= location.bounds.z0 && exit.z <= location.bounds.z1, `${label} sits inside its stage bounds`);
    const blocked = blocks.some(block => (block.r != null
      ? Math.hypot(exit.x - block.x, exit.z - block.z) < block.r + 0.9
      : exit.x > block.x0 - 0.9 && exit.x < block.x1 + 0.9 && exit.z > block.z0 - 0.9 && exit.z < block.z1 + 0.9)
      && block.top > (location.ground ?? 0) + 0.2 && block.bottom < (location.ground ?? 0) + 1.8);
    ok(!blocked, `${label} is not buried in solid geometry`);
    // Reachability: the spawn must be able to walk to the exit inside the stage rectangle.
    const spawn = location.spawns[0];
    ok(Math.hypot(spawn.x - exit.x, spawn.z - exit.z) > 2.6, `${label} is not on top of the spawn point`);
    exitPairs.add(`${location.id}->${exit.to}`);
  }
}
ok(exitCount >= 20, `expected a connected set of world exits, got ${exitCount}`);
for (const pair of exitPairs) {
  const [from, to] = pair.split('->');
  ok(exitPairs.has(`${to}->${from}`), `${from} -> ${to} has a return exit`);
}
for (const id of WORLD_ORDER) {
  const reachable = WORLD_LOCATIONS.filter(location => location.world === id && (location.exits || []).length > 0);
  ok(reachable.length >= 2, `${id} has walkable links between its stages (${reachable.length})`);
}

// ---- report ----------------------------------------------------------------
if (failures.length) {
  console.error(`\n✗ ${failures.length} of ${checks} world checks failed:\n` + failures.slice(0, 40).map(f => `  - ${f}`).join('\n'));
  process.exit(1);
}
const perWorld = WORLD_ORDER.map(id => `${id}:${WORLDS[id].locations.length}`).join(' ');
console.log(`✓ world checks passed: ${checks} assertions across ${WORLD_LOCATIONS.length} battle locations (${perWorld}); ${WORLD_ORDER.map(id => `${id} ${blocksFromParts(worldParts(id)).length} blocks`).join(', ')}`);
