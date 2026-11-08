// Hogwarts castle interior: the east range behind the Great Hall, built as a real place.
//
// The castle used to be a curtain wall with two interiors behind it (the nave and a dungeon
// room) and no way between them. This module adds a three-storey range that is walkable for
// real: a ground floor of halls and classrooms, a first floor of common rooms and a library
// gallery, and a second floor of faculty and secret rooms, joined by an open well with two
// straight flights of stairs.
//
// It emits the same part descriptors as the rest of world_catalog.js, so world_builder merges
// it into the existing per-material draw calls and `blocksFromParts()` turns every `solid`
// part into the collision volume the fighter controller already uses. Nothing here needs a
// second collision system:
//
//   * a floor is a slab with `bottom` set, which makes it standable from above and walkable
//     underneath (arena_layouts.js honours `bottom` for overhead volumes);
//   * a tread rises 0.4 m, under arena_layouts' STEP_HEIGHT of 0.42, so stairs climb;
//   * a wall is a box from floor to ceiling, so it blocks;
//   * a door is a gap in that wall with a lintel whose `bottom` starts above head height.
//
// Coordinates: x 22..64, z -148..-70, west face against the Great Hall's east wall. North is
// -Z. The wing is inside the curtain wall, so its light is candles, sconces and glazed panels
// rather than windows, which is why every room carries its own lamps.
//
// Every material used here must exist in PALETTES.hogwarts (scripts/test-worlds.mjs asserts
// that): stone, stoneDark, stoneLight, brick, roofCastle, roofHall, ceiling, wood, gold,
// glassWarm, glassCool, cobble, floorHall, flame, clock, the four house banners, crystal and
// dark.

/** Ground floor, first floor, second floor and the roof slab above them. */
export const FLOOR_Y = { ground: 0.6, first: 5.0, second: 9.4, roof: 13.8 };
const SLAB = 0.45;
const THIN = 0.9;
const DOOR_H = 3.2;

const WING = { x0: 22, x1: 64, z0: -148, z1: -70 };
const CORRIDOR = { x0: 40, x1: 46 };
const WEST = { x0: 22, x1: 40 };
const EAST = { x0: 46, x1: 64 };
/** Depth bands, north to south. The east column splits these differently from the west. */
const BAND = {
  north: { z0: -148, z1: -127 },
  stair: { z0: -127, z1: -102 },
  entrance: { z0: -102, z1: -88 },
  south: { z0: -88, z1: -70 }
};
const EAST_LIBRARY = { z0: -127, z1: -88 };

// ---- part primitives (same descriptor shape as world_catalog.js) -------------
const part = (parts, t, x, y, z, s, mat, extra) => { parts.push({ t, p: [x, y, z], s, mat, ...extra }); };
const box = (parts, x, y, z, w, h, d, mat, extra) => part(parts, 'box', x, y, z, [w, h, d], mat, extra);
const cyl = (parts, x, y, z, rt, rb, h, mat, extra) => part(parts, 'cyl', x, y, z, [rt, rb, h], mat, extra);
const cone = (parts, x, y, z, r, h, mat, extra) => part(parts, 'cone', x, y, z, [r, h], mat, extra);
const ball = (parts, x, y, z, r, mat, extra) => part(parts, 'sphere', x, y, z, [r], mat, extra);
const solid = extra => ({ solid: true, ...extra });

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- structure helpers -----------------------------------------------------

/** A walkable floor: solid from above, clear underneath. */
function floorSlab(parts, x0, z0, x1, z1, top, mat = 'floorHall') {
  box(parts, (x0 + x1) / 2, top - SLAB / 2, (z0 + z1) / 2, x1 - x0, SLAB, z1 - z0, mat, solid({ bottom: top - SLAB }));
}

/**
 * One wall run with real door openings. `doors` entries are {at, width, height?}: the wall is
 * split around each opening and a lintel is added above head height, so the doorway is an
 * actual hole in the collision volume rather than a painted door.
 */
function wallRun(parts, { axis, fixed, from, to, y0, y1, thickness = THIN, mat = 'stone', doors = [] }) {
  const spans = [];
  let cursor = from;
  const openings = [...doors].sort((a, b) => a.at - b.at);
  for (const door of openings) {
    const a = door.at - door.width / 2;
    const b = door.at + door.width / 2;
    if (a > cursor + .05) spans.push({ a: cursor, b: a, y0, y1 });
    cursor = Math.max(cursor, b);
    const lintelBottom = y0 + (door.height ?? DOOR_H);
    if (lintelBottom < y1 - .05) spans.push({ a, b, y0: lintelBottom, y1 });
  }
  if (cursor < to - .05) spans.push({ a: cursor, b: to, y0, y1 });
  for (const span of spans) {
    const length = span.b - span.a;
    if (length < .05) continue;
    const height = span.y1 - span.y0;
    if (height < .05) continue;
    const mid = (span.a + span.b) / 2;
    const cy = span.y0 + height / 2;
    if (axis === 'x') box(parts, mid, cy, fixed, length, height, thickness, mat, solid({ bottom: span.y0 }));
    else box(parts, fixed, cy, mid, thickness, height, length, mat, solid({ bottom: span.y0 }));
  }
}

/** A straight flight of treads under the 0.42 m step limit, with a solid stringer. */
function flight(parts, { x0, x1, zStart, rise, run, steps, base, dir = 1, mat = 'stoneDark' }) {
  for (let i = 0; i < steps; i++) {
    const top = base + rise * (i + 1);
    const zc = zStart + dir * run * (i + .5);
    box(parts, (x0 + x1) / 2, top - .2, zc, x1 - x0, .4, run, mat, solid({ bottom: base - .1 }));
  }
}

function railing(parts, x, y, z, length, axis, mat = 'stoneDark') {
  const half = length / 2;
  for (let i = -half; i <= half; i += 2.2) {
    if (axis === 'x') box(parts, x + i, y + .5, z, .1, 1, .1, mat);
    else box(parts, x, y + .5, z + i, .1, 1, .1, mat);
  }
  if (axis === 'x') box(parts, x, y + 1.02, z, length, .12, .12, mat);
  else box(parts, x, y + 1.02, z, .12, .12, length, mat);
}

/** Wall sconce: iron bracket and a candle. Light itself comes from the flame material. */
function sconce(parts, x, y, z) {
  box(parts, x, y + 1.5, z, .1, .6, .1, 'dark');
  cyl(parts, x, y + 1.95, z, .07, .09, .4, 'stoneLight', { seg: 6 });
  ball(parts, x, y + 2.24, z, .15, 'flame', { seg: 6 });
}

function banner(parts, x, y, z, mat, w = 1.9, h = 4.4) {
  box(parts, x, y, z, w, h, .12, mat);
  box(parts, x, y + h / 2 + .12, z, w + .3, .2, .2, 'gold');
  box(parts, x, y - h / 2 - .1, z, w * .3, .35, .18, 'gold');
}

/** Framed portrait. The painting is a house-banner colour so it reads at gameplay distance. */
function portrait(parts, x, y, z, wide = 1.5, tall = 2.1, mat = 'bannerBlue') {
  box(parts, x, y, z, wide + .3, tall + .3, .14, 'gold');
  box(parts, x, y, z, wide, tall, .2, mat);
}

function table(parts, x, z, w, d, base, mat = 'wood') {
  box(parts, x, base + .78, z, w, .14, d, mat, solid({ bottom: base }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(parts, x + sx * (w / 2 - .3), base + .38, z + sz * (d / 2 - .3), .16, .76, .16, mat);
  }
}

function bench(parts, x, z, w, d, base, mat = 'wood') {
  box(parts, x, base + .48, z, w, .12, d, mat, solid({ bottom: base }));
  for (const sx of [-1, 1]) box(parts, x + sx * (w / 2 - .25), base + .24, z, .14, .48, d - .2, mat);
}

function stool(parts, x, z, base) {
  cyl(parts, x, base + .28, z, .24, .26, .56, 'wood', { seg: 8 });
}

function bookcase(parts, x, z, w, d, base, rows = 4, mat = 'wood') {
  const h = 1.05 + rows * .52;
  box(parts, x, base + h / 2, z, w, h, d, mat, solid({ bottom: base }));
  for (let row = 0; row < rows; row++) {
    box(parts, x, base + .78 + row * .52, z + d / 2 + .04, w - .2, .1, .12, 'gold');
    const fill = ['bannerRed', 'bannerBlue', 'bannerGreen', 'bannerGold', 'stoneLight'][row % 5];
    box(parts, x, base + .6 + row * .52, z, w - .3, .34, d + .06, fill);
  }
}

function armchair(parts, x, z, base, mat = 'bannerRed', ry = 0) {
  box(parts, x, base + .42, z, 1.2, .5, 1.1, mat, { ry, solid: true, bottom: base });
  box(parts, x, base + .78, z - .42, 1.2, 1.1, .22, mat, { ry });
  for (const sx of [-1, 1]) box(parts, x + sx * .52, base + .62, z, .18, .42, 1, mat, { ry });
}

function cauldron(parts, x, z, base, mat = 'dark') {
  cyl(parts, x, base + .38, z, .52, .34, .76, mat, { seg: 10 });
  cyl(parts, x, base + .78, z, .48, .48, .06, 'stoneDark', { seg: 10 });
  ball(parts, x, base + .74, z, .34, 'bannerGreen', { sy: .3, seg: 8 });
  for (let i = 0; i < 3; i++) ball(parts, x + (i - 1) * .2, base + 1.1 + i * .18, z + (i - 1) * .12, .16, 'glassCool', { sy: 1.5, seg: 6 });
}

function bed(parts, x, z, base) {
  box(parts, x, base + .32, z, 1.5, .35, 3, 'stoneLight', solid({ bottom: base }));
  box(parts, x, base + .56, z - .3, 1.4, .22, 2.1, 'bannerBlue');
  box(parts, x, base + .62, z - 1.3, 1.2, .3, .5, 'stoneLight');
  for (const sx of [-1, 1]) cyl(parts, x + sx * .72, base + 1.5, z + 1.4, .06, .07, 2.6, 'wood', { seg: 5 });
  box(parts, x, base + 2.8, z + 1.4, 1.6, .08, .08, 'wood');
  box(parts, x + .76, base + 1.5, z + .2, .06, 2.4, 2.8, 'bannerBlue');
}

function telescope(parts, x, z, base) {
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3;
    cyl(parts, x + Math.cos(a) * .38, base + .7, z + Math.sin(a) * .38, .06, .08, 1.4, 'gold', { seg: 5 });
  }
  cyl(parts, x, base + 1.75, z, .16, .2, 1.5, 'gold', { seg: 10, rx: .5 });
  cyl(parts, x, base + 2.35, z + .45, .12, .16, .5, 'stoneLight', { seg: 8 });
}

function instrument(parts, x, z, base) {
  cyl(parts, x, base + .1, z, .4, .44, .2, 'gold', { seg: 10 });
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    cyl(parts, x + Math.cos(a) * .28, base + .8, z + Math.sin(a) * .28, .02, .02, 1.2, 'gold', { seg: 4 });
    ball(parts, x + Math.cos(a) * .28, base + 1.45, z + Math.sin(a) * .28, .12, 'crystal', { seg: 8 });
  }
}

function suitOfArmour(parts, x, z, base) {
  cyl(parts, x, base + .9, z, .34, .42, 1.8, 'stoneLight', { seg: 8 });
  ball(parts, x, base + 2.05, z, .3, 'stoneLight', { seg: 10 });
  box(parts, x, base + 2.32, z, .5, .18, .5, 'dark');
  for (const sx of [-1, 1]) {
    box(parts, x + sx * .5, base + 1.1, z, .2, 1.5, .2, 'stoneLight');
    box(parts, x + sx * .18, base + .1, z, .22, 1.4, .22, 'stoneLight');
  }
  box(parts, x, base + 1.35, z + .3, .62, .9, .1, 'bannerRed');
  cone(parts, x, base + 2.55, z, .16, .5, 'bannerRed', { seg: 6 });
  cyl(parts, x, base + 1.5, z + .5, .04, .05, 2.6, 'dark', { seg: 5 });
}

function hearth(parts, x, z, base, ry = 0) {
  box(parts, x, base + 1.1, z, 3.4, 2.2, .7, 'stoneDark', { ry, solid: true, bottom: base });
  box(parts, x, base + .25, z + .1, 2.2, .9, .9, 'stone', { ry });
  for (let i = 0; i < 5; i++) ball(parts, x + (i - 2) * .3, base + .55, z + .5, .2 + (i % 2) * .06, 'flame', { seg: 6 });
  box(parts, x, base + 2.35, z, 3.9, .3, 1, 'stone', { ry });
}

function chandelier(parts, x, y, z) {
  cyl(parts, x, y - .35, z, .04, .04, .7, 'dark', { seg: 4 });
  cyl(parts, x, y - .72, z, .56, .56, .08, 'gold', { seg: 12 });
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    cyl(parts, x + Math.cos(a) * .5, y - .6, z + Math.sin(a) * .5, .035, .04, .22, 'stoneLight', { seg: 5 });
    ball(parts, x + Math.cos(a) * .5, y - .45, z + Math.sin(a) * .5, .07, 'flame', { seg: 6 });
  }
}

// ---- the wing --------------------------------------------------------------

/**
 * Build the interior range into `parts`. Returns the room manifest (used by the docs and by
 * the navigation assertions in scripts/test-worlds.mjs).
 */
export function buildHogwartsInterior(parts) {
  const rng = mulberry32(20261029);
  const G0 = FLOOR_Y.ground, G1 = FLOOR_Y.first, G2 = FLOOR_Y.second, R = FLOOR_Y.roof;

  // ---- floors --------------------------------------------------------------
  // The ground slab reaches 1.1 m west so it meets the Great Hall's floor through the new
  // doorway: a 1 m gap with no floor would drop a walker to the terrain between the two rooms.
  floorSlab(parts, 20.9, WING.z0, WING.x1, WING.z1, G0, 'cobble');
  // Entrance Hall inlay: a lighter marble run down the middle of the room.
  box(parts, 31, G0 + .02, -95, 8, .06, 12, 'floorHall');

  // First floor exists over the north and south bands and the corridor; the stair hall,
  // entrance hall and library are open wells up to the roof.
  for (const column of [WEST, EAST]) {
    floorSlab(parts, column.x0, BAND.north.z0, column.x1, BAND.north.z1, G1, 'wood');
    floorSlab(parts, column.x0, BAND.south.z0, column.x1, BAND.south.z1, G1, 'wood');
  }
  floorSlab(parts, CORRIDOR.x0, WING.z0, CORRIDOR.x1, WING.z1, G1, 'stoneLight');
  // Library gallery: a balcony along the corridor wall, looking down into the library.
  floorSlab(parts, EAST.x0, EAST_LIBRARY.z0, 52.6, EAST_LIBRARY.z1, G1, 'wood');
  // F1 landing of the grand staircase and the F2 landing at the top of the second flight.
  floorSlab(parts, 22.4, -121, 40, -115.2, G1, 'stoneLight');
  floorSlab(parts, 22.4, -108.6, 40, -103.5, G2, 'stoneLight');

  // Second floor over the same bands, plus the corridor.
  for (const column of [WEST, EAST]) {
    floorSlab(parts, column.x0, BAND.north.z0, column.x1, BAND.north.z1, G2, 'wood');
    floorSlab(parts, column.x0, BAND.south.z0, column.x1, BAND.south.z1, G2, 'wood');
  }
  floorSlab(parts, CORRIDOR.x0, WING.z0, CORRIDOR.x1, WING.z1, G2, 'stoneLight');

  // Roof over the whole range, so every open well ends in a ceiling.
  box(parts, (WING.x0 + WING.x1) / 2, R + .25, (WING.z0 + WING.z1) / 2,
    WING.x1 - WING.x0, .5, WING.z1 - WING.z0, 'roofHall', solid({ bottom: R }));

  // ---- perimeter walls -----------------------------------------------------
  // West face, with the doorway that joins the Great Hall (the hall's own east wall is cut
  // open at the same span by buildHogwarts).
  wallRun(parts, { axis: 'z', fixed: 22, from: WING.z0, to: WING.z1, y0: G0, y1: R, thickness: 1.1, mat: 'stone', doors: [{ at: -94, width: 6, height: 3.4 }] });
  wallRun(parts, { axis: 'z', fixed: 64, from: WING.z0, to: WING.z1, y0: G0, y1: R, thickness: 1.1, mat: 'stone' });
  wallRun(parts, { axis: 'x', fixed: WING.z0, from: WING.x0, to: WING.x1, y0: G0, y1: R, thickness: 1.1, mat: 'stone' });
  wallRun(parts, { axis: 'x', fixed: WING.z1, from: WING.x0, to: WING.x1, y0: G0, y1: R, thickness: 1.1, mat: 'stone' });

  // Two pilasters per face give the outside some articulation above the curtain wall.
  for (const x of [30, 52]) box(parts, x, (G0 + R) / 2, WING.z1 + .9, 2.4, R - G0, 1.2, 'stoneDark', solid({ bottom: G0 }));

  // ---- corridor walls, floor by floor --------------------------------------
  const levels = [
    { y0: G0, y1: G1, west: [-137.5, -104.5, -95, -79], east: [-137.5, -107.5, -79] },
    { y0: G1, y1: G2, west: [-137.5, -118, -79], east: [-137.5, -100, -79] },
    { y0: G2, y1: R, west: [-137.5, -105.7, -79], east: [-137.5, -79] }
  ];
  for (const level of levels) {
    wallRun(parts, {
      axis: 'z', fixed: CORRIDOR.x0, from: WING.z0, to: WING.z1, y0: level.y0, y1: level.y1, mat: 'stone',
      doors: level.west.map(at => ({ at, width: 4 }))
    });
    wallRun(parts, {
      axis: 'z', fixed: CORRIDOR.x1, from: WING.z0, to: WING.z1, y0: level.y0, y1: level.y1, mat: 'stone',
      doors: level.east.map(at => ({ at, width: 4 }))
    });
  }

  // ---- cross walls between bands ------------------------------------------
  const crossWall = (z, y0, y1, from, to, doors = []) =>
    wallRun(parts, { axis: 'x', fixed: z, from, to, y0, y1, mat: 'stone', doors });
  // West column: kitchens | stair hall | entrance hall | DADA on the ground floor.
  crossWall(BAND.north.z1, G0, G1, WEST.x0, WEST.x1);
  // The entrance hall opens onto the stair well. This wall used to be drawn solid, so the
  // documented "north opening" was data only and the staircase could not be reached from the
  // entrance hall at all — the walk test below walks through the new doorway.
  crossWall(BAND.entrance.z0, G0, G1, WEST.x0, WEST.x1, [{ at: 31, width: 9 }]);
  crossWall(BAND.south.z0, G0, G1, WEST.x0, WEST.x1);
  // East column: hospital | library | charms. The library is one tall room through both bands.
  crossWall(BAND.north.z1, G0, G1, EAST.x0, EAST.x1);
  crossWall(BAND.south.z0, G0, G1, EAST.x0, EAST.x1);
  // Upper floors: only the north and south bands are rooms, so two walls each.
  for (const [y0, y1] of [[G1, G2], [G2, R]]) {
    crossWall(BAND.north.z1, y0, y1, WEST.x0, WEST.x1);
    crossWall(BAND.south.z0, y0, y1, WEST.x0, WEST.x1);
    crossWall(BAND.north.z1, y0, y1, EAST.x0, EAST.x1);
    crossWall(BAND.south.z0, y0, y1, EAST.x0, EAST.x1);
  }

  // ---- the grand staircase ------------------------------------------------
  // Flight A climbs north from the middle of the stair hall; a broad landing turns, and flight
  // B climbs south-east to the second floor. Both flights sit inside the open well, so the
  // stairs are seen from the entrance hall as well.
  flight(parts, { x0: 24, x1: 31, zStart: -108.6, rise: .4, run: .6, steps: 11, base: G0, dir: -1 });
  flight(parts, { x0: 33, x1: 39.6, zStart: -115.2, rise: .4, run: .6, steps: 11, base: G1, dir: 1 });
  railing(parts, 31.4, G0, -111.9, 6.6, 'z', 'stoneDark');
  railing(parts, 32.6, G1, -111.9, 6.6, 'z', 'stoneDark');
  // Landing balustrades. Each flight climbs away from its landing rather than over it, so no
  // walkable floor ever sits under a tread: the collider would (correctly) treat that as a wall.
  box(parts, 26.7, G1 + .55, -115.1, 8.6, 1.1, .35, 'stoneDark');
  box(parts, 27.7, G2 + .55, -108.7, 10.6, 1.1, .35, 'stoneDark');
  // Newel posts and the hourglasses that tally house points in the stair hall.
  for (const [x, z, y] of [[23.6, -119.2, G1], [39.2, -103.2, G2]]) {
    box(parts, x, y + .8, z, .7, 1.6, .7, 'stoneDark', solid({ bottom: y }));
    ball(parts, x, y + 1.85, z, .34, 'crystal', { seg: 10 });
  }
  for (let i = 0; i < 4; i++) {
    const x = 24.5 + i * 1.3;
    cyl(parts, x, G0 + 1.35, -126.2, .3, .42, .5, 'gold', { seg: 8 });
    ball(parts, x, G0 + 1.7, -126.2, .28, ['bannerRed', 'bannerGreen', 'bannerBlue', 'bannerGold'][i], { seg: 8 });
  }
  // Portrait bank up the stair wall, and candles on the landings.
  for (let i = 0; i < 5; i++) {
    portrait(parts, 22.7, G0 + 4.2 + (i % 3) * 2.4, -124 + i * 4.2, 1.4, 2.1, ['bannerBlue', 'bannerGreen', 'bannerRed'][i % 3]);
  }
  for (const [x, z, y] of [[39.4, -121, G0], [23, -122, G1], [39.4, -122, G1], [23, -105, G2], [39.4, -105, G2]]) sconce(parts, x, y, z);
  chandelier(parts, 31, G0 + 11.2, -116);

  // ---- entrance hall ------------------------------------------------------
  // Double-height, with the Great Hall door in the west wall.
  box(parts, 31, G0 + .03, -95, 13, .07, 9, 'floorHall');
  for (const x of [25.5, 36.5]) for (const z of [-100, -90]) box(parts, x, G0 + .5, z, 1, 1, 1, 'stoneLight', solid({ bottom: G0 }));
  suitOfArmour(parts, 24.2, -99, G0);
  suitOfArmour(parts, 37.8, -99, G0);
  suitOfArmour(parts, 24.2, -91, G0);
  suitOfArmour(parts, 37.8, -91, G0);
  for (const [z, mat] of [[-101, 'bannerRed'], [-97, 'bannerBlue'], [-93, 'bannerGreen'], [-89, 'bannerGold']]) {
    banner(parts, 22.9, G0 + 5.4, z, mat, 1.7, 4);
  }
  chandelier(parts, 31, G0 + 10.4, -95);
  for (const [x, z] of [[23.4, -102], [38.6, -102], [23.4, -88], [38.6, -88]]) sconce(parts, x, G0, z);
  // The castle's hourglasses and a lectern with the day's notices.
  box(parts, 35, G0 + .55, -101.2, 1.8, 1.1, .8, 'wood', solid({ bottom: G0 }));
  box(parts, 35, G0 + 1.2, -101.2, 1.5, .1, .6, 'gold');

  // ---- kitchens -----------------------------------------------------------
  // Long trestle runs down both flank walls, pots above, hearth at the north end.
  hearth(parts, 31, -146.4, G0);
  for (const side of [-1, 1]) {
    const x = 31 + side * 6.4;
    table(parts, x, -140, 2.6, 9, G0);
    bench(parts, x + side * 2.1, -140, .8, 9, G0);
    for (let i = 0; i < 5; i++) {
      const z = -144 + i * 2;
      cyl(parts, x - side * .4, G0 + .95, z, .3, .26, .3, 'dark', { seg: 8 });
      ball(parts, x + side * .5, G0 + .92, z, .18, i % 2 ? 'bannerGold' : 'bannerGreen', { seg: 7 });
    }
    // Hanging copper pans over the run.
    for (let i = 0; i < 6; i++) {
      const z = -144 + i * 1.8;
      box(parts, x, G0 + 3.1, z, .06, .8, .06, 'dark');
      cyl(parts, x, G0 + 2.5, z, .26, .2, .16, 'gold', { seg: 10 });
    }
  }
  for (let i = 0; i < 3; i++) cauldron(parts, 26 - i * .1, -131 - i * 2.4, G0, 'dark');
  bookcase(parts, 23.2, -137, 1.2, .6, G0, 3);
  for (const [x, z] of [[23.4, -131], [38.6, -131], [23.4, -146], [38.6, -146]]) sconce(parts, x, G0, z);

  // ---- Defence Against the Dark Arts classroom ----------------------------
  for (let row = 0; row < 3; row++) {
    for (const side of [-1, 1]) {
      const x = 31 + side * 5.6;
      table(parts, x, -85 + row * 4, 2.4, 1.9, G0);
      stool(parts, x - .6, -83.6 + row * 4, G0);
      stool(parts, x + .6, -83.6 + row * 4, G0);
    }
  }
  // Dueling circle in front of the teaching wall, and the specimen cabinet.
  cyl(parts, 31, G0 + .06, -79, 5.2, 5.2, .12, 'stoneLight', { seg: 20 });
  cyl(parts, 31, G0 + .1, -79, 4.6, 4.6, .1, 'stoneDark', { seg: 20 });
  box(parts, 31, G0 + 1.9, -87.4, 12, 3.4, .3, 'stoneDark', solid({ bottom: G0 }));
  for (let i = 0; i < 4; i++) box(parts, 27 + i * 2.6, G0 + 2.1, -87.2, .18, 1.6, .06, 'dark');
  bookcase(parts, 23.2, -79, 1.8, .7, G0, 5);
  suitOfArmour(parts, 38.4, -86, G0);
  ball(parts, 24, G0 + 2.6, -71.8, .9, 'clock', { sx: 1.2, sy: 1.6, sz: .18, seg: 10 });
  for (const [x, z] of [[23.6, -84], [38.4, -84], [23.6, -73], [38.4, -73]]) sconce(parts, x, G0, z);

  // ---- hospital wing -----------------------------------------------------
  for (let i = 0; i < 5; i++) {
    const z = -145 + i * 3.2;
    bed(parts, 49.4, z, G0);
    bed(parts, 60.6, z, G0);
  }
  // Privacy screens run across each bed alcove, so the central aisle stays walkable.
  for (let i = 0; i < 4; i++) {
    const z = -143.4 + i * 3.2;
    for (const x of [49.4, 60.6]) {
      box(parts, x, G0 + 1.1, z, .1, 2.1, 2.2, 'stoneLight', solid({ bottom: G0 }));
      box(parts, x, G0 + 2.2, z, .16, .16, 2.4, 'wood');
    }
  }
  bookcase(parts, 55, -127.9, 3.2, .6, G0, 4);
  for (const [x, z] of [[47.4, -145], [62.6, -145], [47.4, -129], [62.6, -129]]) sconce(parts, x, G0, z);
  chandelier(parts, 55, G0 + 3.6, -137);

  // ---- library ------------------------------------------------------------
  // Shelving bays on both sides of a wide central aisle; the aisle is the spine of the room.
  for (let i = 0; i < 5; i++) {
    const z = -125 + i * 3.4;
    bookcase(parts, 48.2, z, 2.4, 1.1, G0, 6);
    bookcase(parts, 61.8, z, 2.4, 1.1, G0, 6);
  }
  for (let i = 0; i < 3; i++) {
    const z = -122 + i * 4.6;
    table(parts, 55, z, 5.4, 2, G0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) stool(parts, 55 + sx * 2, z + sz * 1.5, G0);
  }
  // Tall shelves at the north end, either side of the restricted gate.
  for (const x of [50.5, 59.5]) bookcase(parts, x, -126.2, 4.4, 1.4, G0, 8);
  // Restricted section gate: a heavy iron grille across the north bay.
  for (let i = 0; i < 9; i++) box(parts, 51.4 + i * 1.1, G0 + 1.6, -124.6, .12, 3.2, .12, 'dark');
  box(parts, 56, G0 + 3.3, -124.6, 10, .2, .3, 'dark');
  // Gallery balustrade above, and ladders leaning into the upper shelves.
  railing(parts, 52.6, G1, -107.5, 39, 'z', 'wood');
  for (const [x, z] of [[48.2, -110], [61.8, -110], [48.2, -96], [61.8, -96]]) {
    box(parts, x, G0 + 2.1, z, .5, 4.2, .12, 'wood', { rz: .12 });
  }
  for (const z of [-118, -104, -92]) {
    chandelier(parts, 55, G1 - .4, z);
  }
  for (const [x, z] of [[47.4, -125], [62.6, -125], [47.4, -90], [62.6, -90]]) sconce(parts, x, G0, z);
  // Catalogue desk by the door.
  table(parts, 49.6, -106.5, 2.2, 1.4, G0);
  box(parts, 49.6, G0 + .95, -106.5, .8, .1, .6, 'stoneLight');

  // ---- Charms classroom ---------------------------------------------------
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const x = 51 + col * 4, z = -85 + row * 4;
      if (x === 55 && row === 1) continue; // clear the centre of the room
      table(parts, x, z, 2, 1.7, G0);
      stool(parts, x, z + 1.2, G0);
    }
  }
  // Floating practice objects and a grammar board.
  for (let i = 0; i < 6; i++) ball(parts, 51 + (i % 3) * 4, G0 + 3.2 + (i % 2) * .7, -86 + Math.floor(i / 3) * 2.4, .18, 'crystal', { seg: 8 });
  box(parts, 55, G0 + 2, -87.3, 9, 3.2, .28, 'stoneDark', solid({ bottom: G0 }));
  bookcase(parts, 47.4, -78, 1.4, .7, G0, 4);
  bookcase(parts, 62.6, -78, 1.4, .7, G0, 4);
  for (const [x, z] of [[47.4, -84], [62.6, -84], [47.4, -72], [62.6, -72]]) sconce(parts, x, G0, z);

  // ---- Gryffindor common room (first floor) -------------------------------
  hearth(parts, 24.4, -137.5, G1);
  for (let i = 0; i < 4; i++) {
    armchair(parts, 27.6 + (i % 2) * 3.4, -134 - Math.floor(i / 2) * 4.2, G1, 'bannerRed', (i % 2) * .4);
  }
  box(parts, 31, G1 + .03, -137.5, 12, .06, 12, 'bannerGold');
  table(parts, 35.4, -142, 2.4, 5, G1);
  for (const z of [-140, -144]) stool(parts, 35.4, z, G1);
  bookcase(parts, 38.6, -140, 1.2, 1.2, G1, 5);
  banner(parts, 22.9, G1 + 3.4, -133, 'bannerRed', 2.4, 5);
  banner(parts, 22.9, G1 + 3.4, -143, 'bannerGold', 2, 4.2);
  chandelier(parts, 31, G1 + 3.6, -138);
  for (const [x, z] of [[23.4, -130], [38.6, -130], [23.4, -146], [38.6, -146]]) sconce(parts, x, G1, z);

  // ---- Ravenclaw common room (first floor, south) -------------------------
  for (let i = 0; i < 4; i++) bookcase(parts, 24 + i * 4.6, -87.2, 3.4, .9, G1, 7);
  table(parts, 31, -74, 6, 2.4, G1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) stool(parts, 31 + sx * 2.4, -74 + sz * 1.8, G1);
  // Star chart and an orrery by the tall windows.
  ball(parts, 36.4, G1 + 3.4, -87.2, 1.7, 'glassCool', { sz: .12, seg: 14 });
  instrument(parts, 26, -74, G1);
  for (let i = 0; i < 5; i++) ball(parts, 37.6, G1 + 2.6 + (i % 3) * 2.1, -85 + i * 2.6, .16, 'crystal', { seg: 8 });
  banner(parts, 22.9, G1 + 3.6, -79, 'bannerBlue', 2.4, 5.4);
  chandelier(parts, 31, G1 + 3.4, -80);
  // Glazed panels along the east wall.
  for (let i = 0; i < 3; i++) box(parts, 63.3, G1 + 2.4, -84 + i * 4.4, .2, 4.4, 2.4, 'glassCool');

  // ---- Slytherin common room (first floor, north-east) -------------------
  box(parts, 55, G1 + .03, -137.5, 16, .06, 19, 'stoneDark');
  for (let i = 0; i < 3; i++) {
    box(parts, 62.9, G1 + 2.6, -144 + i * 6, .2, 5.2, 3.6, 'glassCool');
    for (let s = 0; s < 4; s++) ball(parts, 62.4, G1 + 1 + s * 1.3 + i * .4, -143 + i * 6 + (s % 2) * .8, .5, 'glassCool', { sy: 2.2, seg: 6 });
  }
  for (let i = 0; i < 4; i++) armchair(parts, 49.6 + (i % 2) * 3.2, -134 - Math.floor(i / 2) * 4.4, G1, 'bannerGreen', .3 + i * .1);
  table(parts, 55, -142, 3, 6, G1);
  hearth(parts, 47.6, -143.4, G1);
  // Serpent carving over the hearth.
  for (let i = 0; i < 7; i++) ball(parts, 47.6 + Math.sin(i * .9) * 1.1, G1 + 3 + i * .28, -143.2, .22, 'bannerGreen', { seg: 7 });
  banner(parts, 63.2, G1 + 3.6, -130, 'bannerGreen', 2.4, 5.4);
  chandelier(parts, 55, G1 + 3.4, -138);
  for (const [x, z] of [[47.4, -130], [62.6, -130], [47.4, -146], [62.6, -146]]) sconce(parts, x, G1, z);

  // ---- History of Magic (first floor, south-east) ------------------------
  for (let row = 0; row < 3; row++) {
    for (const side of [-1, 1]) {
      const x = 55 + side * 5.2;
      table(parts, x, -85 + row * 4, 2.4, 1.8, G1);
      stool(parts, x, -83.6 + row * 4, G1);
    }
  }
  box(parts, 55, G1 + 2, -87.3, 10, 3, .28, 'stoneDark', solid({ bottom: G1 }));
  for (let i = 0; i < 3; i++) bookcase(parts, 48.4, -80 + i * 3.6, 1.2, 2.8, G1, 6);
  for (let i = 0; i < 18; i++) ball(parts, 48 + rng() * 14, G1 + 1 + rng() * 3.4, -87 + rng() * 16, .06, 'stoneLight', { seg: 4 });
  banner(parts, 63.2, G1 + 3.6, -79, 'bannerGold', 2.2, 5);
  chandelier(parts, 55, G1 + 3.4, -80);
  for (const [x, z] of [[47.4, -85], [62.6, -85], [47.4, -72], [62.6, -72]]) sconce(parts, x, G1, z);

  // ---- Headmaster's office (second floor, north-west) --------------------
  // A circular study inside the square room: a drum of shelves with a gap for the door side.
  for (let i = 0; i < 20; i++) {
    const a = i * Math.PI * 2 / 20;
    const x = 31 + Math.cos(a) * 6.2, z = -137.5 + Math.sin(a) * 6.2;
    if (Math.abs(x - 31) > 5.6 && Math.abs(z + 137.5) < 1.2) continue;
    box(parts, x, G2 + 1.8, z, 1.5, 3.6, .7, 'wood', { ry: -a, solid: true, bottom: G2 });
    box(parts, x, G2 + 2.9, z, 1.3, .5, .8, ['bannerRed', 'bannerGreen', 'bannerBlue', 'bannerGold'][i % 4], { ry: -a });
  }
  table(parts, 31, -140.5, 4.2, 2.2, G2, 'wood');
  box(parts, 31, G2 + .92, -140.5, 3.4, .1, 1.6, 'stoneDark');
  for (const [x, z] of [[25.5, -145], [36.5, -145], [25.5, -130], [36.5, -130]]) instrument(parts, x, z, G2);
  // Portraits of former headmasters look down from the drum.
  for (let i = 0; i < 7; i++) {
    const a = i * Math.PI * 2 / 7 + .3;
    portrait(parts, 31 + Math.cos(a) * 5.6, G2 + 3.4, -137.5 + Math.sin(a) * 5.6, 1.2, 1.8, ['bannerBlue', 'bannerRed', 'bannerGreen'][i % 3]);
  }
  // The sword-in-the-stone display case and Fawkes' perch.
  box(parts, 35.6, G2 + .8, -131, 1.2, 1.6, 1.2, 'glassWarm', solid({ bottom: G2 }));
  for (let i = 0; i < 3; i++) cyl(parts, 23.6 + i * .9, G2 + .7, -143.4, .06, .08, 1.4, 'gold', { seg: 5 });
  ball(parts, 24.5, G2 + 1.8, -143.4, .34, 'bannerRed', { seg: 8 });
  chandelier(parts, 31, G2 + 3.6, -137.5);
  for (const [x, z] of [[23.4, -131], [38.6, -131], [23.4, -146], [38.6, -146]]) sconce(parts, x, G2, z);

  // ---- Room of Requirement (second floor, south-west) -------------------
  // A training room that has answered a call: dummies, a duelling dais, and stacked furniture.
  cyl(parts, 31, G2 + .1, -79, 6, 6, .2, 'stoneLight', { seg: 24, solid: true, bottom: G2 });
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5;
    const x = 31 + Math.cos(a) * 4.4, z = -79 + Math.sin(a) * 4.4;
    cyl(parts, x, G2 + .95, z, .3, .34, 1.9, 'wood', { seg: 8 });
    ball(parts, x, G2 + 2.1, z, .34, 'stoneLight', { seg: 10 });
    box(parts, x, G2 + 1.2, z + .3, .9, .16, .16, 'wood');
  }
  // The wall of discarded things.
  for (let i = 0; i < 8; i++) {
    box(parts, 23.4, G2 + .3 + (i % 4) * .55, -86 + Math.floor(i / 4) * 2.2, 1.6, .5, 1.8, 'wood', solid({ bottom: G2 }));
  }
  for (let i = 0; i < 5; i++) ball(parts, 37.8, G2 + 1.2 + (i % 3) * 1.1, -84 + i * 2.4, .4, 'crystal', { seg: 8 });
  bookcase(parts, 38.6, -74, 2.6, .8, G2, 5);
  chandelier(parts, 31, G2 + 3.6, -79);
  for (const [x, z] of [[23.4, -74], [38.6, -84], [23.4, -84]]) sconce(parts, x, G2, z);

  // ---- Restricted Archive (second floor, north-east) -------------------
  for (let i = 0; i < 4; i++) {
    bookcase(parts, 48.4, -145 + i * 4.4, 2.6, 1.2, G2, 7);
    bookcase(parts, 61.6, -145 + i * 4.4, 2.6, 1.2, G2, 7);
  }
  table(parts, 55, -141.5, 4.4, 2, G2);
  box(parts, 55, G2 + 1.4, -133.5, 1.6, .8, 1.2, 'dark', solid({ bottom: G2 }));
  for (let i = 0; i < 3; i++) {
    box(parts, 51 + i * 4, G2 + 1.6, -129.4, 2.6, 2.4, 1.2, 'dark', solid({ bottom: G2 }));
    for (let b = 0; b < 4; b++) box(parts, 50.4 + i * 4 + b * .6, G2 + 1.6, -128.7, .1, 2.2, .1, 'stoneLight');
  }
  for (let i = 0; i < 6; i++) ball(parts, 49 + rng() * 12, G2 + 1.4 + rng() * 2, -126 + rng() * 16, .1, i % 2 ? 'crystal' : 'bannerGreen', { seg: 6 });
  chandelier(parts, 55, G2 + 3.4, -137);
  for (const [x, z] of [[47.4, -131], [62.6, -131], [47.4, -146], [62.6, -146]]) sconce(parts, x, G2, z);

  // ---- Astronomy Tower (second floor, south-east) ----------------------
  // The room is open to a domed, star-painted ceiling; three brass telescopes stand on plinths.
  // A star-painted dome reads as a night sky without a transparent sphere cutting the room.
  box(parts, 55, G2 + 3.35, -79, 17.4, .3, 17.4, 'ceiling', solid({ bottom: G2 + 3.2 }));
  for (let i = 0; i < 60; i++) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 7.6;
    ball(parts, 55 + Math.cos(a) * r, G2 + 3.16, -79 + Math.sin(a) * r, .045 + rng() * .05, i % 5 ? 'crystal' : 'clock', { seg: 4 });
  }
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 5;
    box(parts, 55 + Math.cos(a) * 6.6, G2 + 3.18, -79 + Math.sin(a) * 6.6, .09, .06, 2.4, 'gold', { ry: -a });
  }
  for (const [x, z] of [[50, -84], [60, -84], [50, -74], [60, -74]]) {
    cyl(parts, x, G2 + .35, z, 1, 1.15, .7, 'stoneLight', { seg: 12, solid: true, bottom: G2 });
    telescope(parts, x, z, G2 + .7);
  }
  table(parts, 55, -73.4, 6, 1.8, G2);
  // Star chart on the north wall: a dark panel with gold rings and plotted stars, not a glass
  // sphere, which at 5 m across read as a bubble floating in the room.
  box(parts, 55, G2 + 2.6, -87.1, 6.4, 4.4, .28, 'ceiling', solid({ bottom: G2 }));
  for (let i = 0; i < 4; i++) {
    const radius = .7 + i * .5;
    for (let a = 0; a < 48; a++) {
      const angle = a / 48 * Math.PI * 2;
      box(parts, 55 + Math.cos(angle) * radius, G2 + 2.6 + Math.sin(angle) * radius, -86.9, .07, .07, .06, 'gold');
    }
  }
  for (let i = 0; i < 14; i++) {
    const a = i * 2.399, r = .3 + (i % 5) * .62;
    ball(parts, 55 + Math.cos(a) * r, G2 + 2.6 + Math.sin(a) * r, -86.85, .06, i % 3 ? 'crystal' : 'clock', { seg: 5 });
  }
  for (let i = 0; i < 12; i++) {
    const a = i * .6, y = G2 + 3 + (i % 4) * .9;
    ball(parts, 55 + Math.cos(a) * (2 + (i % 3) * 2), y, -79 + Math.sin(a) * (2 + (i % 3) * 2), .12, 'crystal', { seg: 6 });
  }
  chandelier(parts, 55, G2 + 3.2, -79);
  for (const [x, z] of [[47.4, -74], [62.6, -74], [47.4, -84], [62.6, -84]]) sconce(parts, x, G2, z);

  // ---- corridor furnishing --------------------------------------------
  // Sconces down both walls of every landing, benches in the alcoves, portraits between them.
  for (const [y, tag] of [[G0, 0], [G1, 1], [G2, 2]]) {
    for (let z = -145; z <= -73; z += 9) {
      sconce(parts, 40.6, y, z);
      sconce(parts, 45.4, y, z + 4.5);
    }
    for (let i = 0; i < 6; i++) {
      const z = -144 + i * 12;
      portrait(parts, 45.4, y + 2.1, z, 1.4, 2, ['bannerBlue', 'bannerGold', 'bannerGreen', 'bannerRed'][(i + tag) % 4]);
      portrait(parts, 40.6, y + 2.1, z + 5, 1.4, 2, ['bannerRed', 'bannerGreen', 'bannerBlue', 'bannerGold'][(i + tag) % 4]);
    }
    bench(parts, 40.9, -143, 1, 2.2, y);
    bench(parts, 45.1, -76, 1, 2.2, y);
  }
  // Corridor runner rugs (thin, walk-over).
  for (const y of [G0, G1, G2]) box(parts, 43, y + .02, -109, 4.2, .05, 70, 'bannerGold');

  // ---- roofscape -------------------------------------------------------
  // Turrets above the range so the castle reads taller from the grounds and the viaduct.
  for (const [x, z, h] of [[26, -146, 19], [60, -146, 17], [26, -74, 18], [60, -74, 21]]) {
    cyl(parts, x, R + h / 2 - 1, z, 3.6, 4, h, 'stone', { seg: 12, solid: true, bottom: R - 1 });
    cone(parts, x, R + h + 1.4, z, 4.6, 5.6, 'roofCastle', { seg: 12 });
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + .4;
      box(parts, x + Math.cos(a) * 3.4, R + h * .55, z + Math.sin(a) * 3.4, .5, 1.5, .5, 'glassWarm');
    }
  }
  // Chimneys along the ridge.
  for (let i = 0; i < 5; i++) {
    const x = 27 + i * 9;
    cyl(parts, x, R + 2.2, -136, .9, 1.1, 4.4, 'brick', { seg: 8, solid: true, bottom: R });
    cyl(parts, x, R + 4.5, -136, 1.2, 1.2, .3, 'stoneDark', { seg: 8 });
  }

  return HOGWARTS_INTERIOR_AREAS;
}

/**
 * The rooms, for the catalog, the docs and the navigation tests. `bounds` is the inset
 * fighting rectangle inside each room, `floor` is the walkable height, `connected` lists the
 * doors/stairs that make it reachable.
 */
export const HOGWARTS_INTERIOR_AREAS = [
  { id: 'entrance_hall', label: 'Entrance Hall', floor: 'ground', height: FLOOR_Y.ground, room: { x0: 22, z0: -102, x1: 40, z1: -88 }, bounds: [24, -100, 38, -90], connected: ['Great Hall doorway (west)', 'Marble Corridor (east)', 'Grand Staircase (north)'] },
  { id: 'kitchens', label: 'Kitchens', floor: 'ground', height: FLOOR_Y.ground, room: { x0: 22, z0: -148, x1: 40, z1: -127 }, bounds: [24, -146, 38, -129], connected: ['Marble Corridor (east)'] },
  { id: 'dada', label: 'Defence Against the Dark Arts', floor: 'ground', height: FLOOR_Y.ground, room: { x0: 22, z0: -88, x1: 40, z1: -70 }, bounds: [24, -86, 38, -72], connected: ['Marble Corridor (east)'] },
  { id: 'library', label: 'Library', floor: 'ground', height: FLOOR_Y.ground, room: { x0: 46, z0: -127, x1: 64, z1: -88 }, bounds: [48, -125, 62, -90], connected: ['Marble Corridor (west)', 'Gallery (first floor)', 'Restricted Section (north bay)'] },
  { id: 'charms', label: 'Charms Classroom', floor: 'ground', height: FLOOR_Y.ground, room: { x0: 46, z0: -88, x1: 64, z1: -70 }, bounds: [48, -86, 62, -72], connected: ['Marble Corridor (west)'] },
  { id: 'hospital', label: 'Hospital Wing', floor: 'ground', height: FLOOR_Y.ground, room: { x0: 46, z0: -148, x1: 64, z1: -127 }, bounds: [48, -146, 62, -129], connected: ['Marble Corridor (west)'] },
  { id: 'stair_hall', label: 'Grand Staircase', floor: 'ground', height: FLOOR_Y.ground, room: { x0: 22, z0: -127, x1: 40, z1: -102 }, bounds: null, connected: ['Entrance Hall (south)', 'Marble Corridor (east)', 'First-floor landing', 'Second-floor landing'] },
  { id: 'gryffindor', label: 'Gryffindor Common Room', floor: 'first', height: FLOOR_Y.first, room: { x0: 22, z0: -148, x1: 40, z1: -127 }, bounds: [24, -146, 38, -129], connected: ['Marble Corridor (east)', 'Grand Staircase landing (south)'] },
  { id: 'ravenclaw', label: 'Ravenclaw Common Room', floor: 'first', height: FLOOR_Y.first, room: { x0: 22, z0: -88, x1: 40, z1: -70 }, bounds: [24, -86, 38, -72], connected: ['Marble Corridor (east)', 'Grand Staircase landing (north)'] },
  { id: 'slytherin', label: 'Slytherin Common Room', floor: 'first', height: FLOOR_Y.first, room: { x0: 46, z0: -148, x1: 64, z1: -127 }, bounds: [48, -146, 62, -129], connected: ['Marble Corridor (west)'] },
  { id: 'history', label: 'History of Magic', floor: 'first', height: FLOOR_Y.first, room: { x0: 46, z0: -88, x1: 64, z1: -70 }, bounds: [48, -86, 62, -72], connected: ['Marble Corridor (west)'] },
  { id: 'headmaster', label: "Headmaster's Office", floor: 'second', height: FLOOR_Y.second, room: { x0: 22, z0: -148, x1: 40, z1: -127 }, bounds: [24, -146, 38, -129], connected: ['Marble Corridor (east)', 'Grand Staircase landing (south)'] },
  { id: 'requirement', label: 'Room of Requirement', floor: 'second', height: FLOOR_Y.second, room: { x0: 22, z0: -88, x1: 40, z1: -70 }, bounds: [24, -86, 38, -72], connected: ['Marble Corridor (east)'] },
  { id: 'restricted', label: 'Restricted Archive', floor: 'second', height: FLOOR_Y.second, room: { x0: 46, z0: -148, x1: 64, z1: -127 }, bounds: [48, -146, 62, -129], connected: ['Marble Corridor (west)'] },
  { id: 'astronomy', label: 'Astronomy Tower', floor: 'second', height: FLOOR_Y.second, room: { x0: 46, z0: -88, x1: 64, z1: -70 }, bounds: [48, -86, 62, -72], connected: ['Marble Corridor (west)'] }
];

/**
 * Battle/start locations for the interior, in the array shape world_catalog's `loc()` takes.
 * Only rooms with a clear 10 x 10 m floor are stages; the stair hall is a route, not a stage.
 */
export const HOGWARTS_INTERIOR_LOCATIONS = [
  { id: 'hogwarts_entrance_hall', label: 'Entrance Hall', kind: 'interior', bounds: [24, -100, 38, -90], spawns: [27, -98, FLOOR_Y.ground, 35, -92, FLOOR_Y.ground], ground: FLOOR_Y.ground, exits: [{ x: 24, z: -94, to: 'hogwarts_great_hall', label: 'Great Hall' }] },
  { id: 'hogwarts_kitchens', label: 'Kitchens', kind: 'interior', bounds: [24, -146, 38, -129], spawns: [27, -143, FLOOR_Y.ground, 35, -133, FLOOR_Y.ground], ground: FLOOR_Y.ground },
  { id: 'hogwarts_dada', label: 'Dark Arts Classroom', kind: 'interior', bounds: [24, -86, 38, -72], spawns: [28, -83, FLOOR_Y.ground, 34, -77, FLOOR_Y.ground], ground: FLOOR_Y.ground },
  { id: 'hogwarts_library', label: 'Library', kind: 'interior', bounds: [48, -125, 62, -90], spawns: [51, -122, FLOOR_Y.ground, 59, -95, FLOOR_Y.ground], ground: FLOOR_Y.ground },
  { id: 'hogwarts_charms', label: 'Charms Classroom', kind: 'interior', bounds: [48, -86, 62, -72], spawns: [53, -84, FLOOR_Y.ground, 57, -76, FLOOR_Y.ground], ground: FLOOR_Y.ground },
  { id: 'hogwarts_hospital', label: 'Hospital Wing', kind: 'interior', bounds: [48, -146, 62, -129], spawns: [51, -143, FLOOR_Y.ground, 59, -133, FLOOR_Y.ground], ground: FLOOR_Y.ground },
  { id: 'hogwarts_gryffindor', label: 'Gryffindor Common Room', kind: 'interior', bounds: [24, -146, 38, -129], spawns: [27, -143, FLOOR_Y.first, 35, -133, FLOOR_Y.first], ground: FLOOR_Y.first },
  { id: 'hogwarts_ravenclaw', label: 'Ravenclaw Common Room', kind: 'interior', bounds: [24, -86, 38, -72], spawns: [27, -84, FLOOR_Y.first, 35, -76, FLOOR_Y.first], ground: FLOOR_Y.first },
  { id: 'hogwarts_slytherin', label: 'Slytherin Common Room', kind: 'interior', bounds: [48, -146, 62, -129], spawns: [51, -143, FLOOR_Y.first, 59, -133, FLOOR_Y.first], ground: FLOOR_Y.first },
  { id: 'hogwarts_history', label: 'History of Magic', kind: 'interior', bounds: [48, -86, 62, -72], spawns: [53, -84, FLOOR_Y.first, 57, -76, FLOOR_Y.first], ground: FLOOR_Y.first },
  { id: 'hogwarts_headmaster', label: "Headmaster's Office", kind: 'interior', bounds: [24, -146, 38, -129], spawns: [28.6, -133.4, FLOOR_Y.second, 34.6, -141, FLOOR_Y.second], ground: FLOOR_Y.second },
  // The east spawn stands on the room's centre dais (cyl at G2 + .1, r 6), which is 0.2 m proud of
  // the floor; the west spawn is 6.4 m out and stands on the floor itself.
  { id: 'hogwarts_requirement', label: 'Room of Requirement', kind: 'interior', bounds: [24, -86, 38, -72], spawns: [27, -84, FLOOR_Y.second, 35, -76, FLOOR_Y.second + 0.2], ground: FLOOR_Y.second },
  { id: 'hogwarts_archive', label: 'Restricted Archive', kind: 'interior', bounds: [48, -146, 62, -129], spawns: [51, -143, FLOOR_Y.second, 59, -133, FLOOR_Y.second], ground: FLOOR_Y.second },
  { id: 'hogwarts_astronomy', label: 'Astronomy Tower', kind: 'interior', bounds: [48, -86, 62, -72], spawns: [53, -83, FLOOR_Y.second, 57, -77, FLOOR_Y.second], ground: FLOOR_Y.second }
];

/**
 * Walking routes through the wing, as world-space waypoints. scripts/test-worlds.mjs walks
 * these with the game's own groundHeightAt/resolveCollision, so a wall across a doorway or a
 * stair tread over the step limit fails a test instead of stranding a player.
 */
export const HOGWARTS_NAV_ROUTES = [
  {
    name: 'Great Hall doorway → Entrance Hall', endY: FLOOR_Y.ground,
    from: { x: 16, z: -94, y: FLOOR_Y.ground },
    points: [{ x: 16, z: -94 }, { x: 19, z: -94 }, { x: 21, z: -94 }, { x: 23, z: -94 }, { x: 30, z: -94 }]
  },
  {
    name: 'Entrance Hall → Marble Corridor → Library', endY: FLOOR_Y.ground,
    from: { x: 30, z: -95, y: FLOOR_Y.ground },
    points: [{ x: 30, z: -95 }, { x: 39, z: -95 }, { x: 43, z: -95 }, { x: 43, z: -107.5 }, { x: 47, z: -107.5 }, { x: 52, z: -107.5 }]
  },
  {
    name: 'Entrance Hall → Grand Staircase → first floor landing', endY: FLOOR_Y.first,
    from: { x: 30, z: -104, y: FLOOR_Y.ground },
    points: [{ x: 30, z: -105 }, { x: 27.5, z: -108.4 }, { x: 27.5, z: -116 }]
  },
  {
    name: 'Grand Staircase → second floor landing → Marble Corridor', endY: FLOOR_Y.second,
    from: { x: 36, z: -119, y: FLOOR_Y.first },
    points: [{ x: 36, z: -119 }, { x: 36, z: -114.9 }, { x: 36, z: -108.4 }, { x: 39, z: -105.7 }, { x: 43, z: -105.7 }]
  },
  {
    name: 'Marble Corridor → Gryffindor common room', endY: FLOOR_Y.first,
    from: { x: 43, z: -137.5, y: FLOOR_Y.first },
    points: [{ x: 43, z: -137.5 }, { x: 40, z: -137.5 }, { x: 36, z: -137.5 }, { x: 35, z: -137.5 }]
  },
  {
    // The courtyard, the viaduct and the north lawn are one continuous walk: three treads up
    // onto the deck, the deck itself, the landing at the far end, then down to the grounds.
    name: 'Courtyard → viaduct → grounds', endY: 0.3,
    from: { x: 0, z: -38, y: 0.3 },
    points: [{ x: 0, z: -34 }, { x: 0, z: -29.4 }, { x: 0, z: -28.9 }, { x: 0, z: -28.2 },
      { x: 0, z: -27.6 }, { x: 0, z: -20 }, { x: 0, z: 12 }, { x: 0, z: 33.8 },
      { x: 0, z: 43.2 }, { x: 0, z: 44.4 }, { x: 0, z: 45.2 }, { x: 0, z: 52 }]
  },
  {
    name: 'Grounds → viaduct → courtyard', endY: 0.3,
    from: { x: 0, z: 52, y: 0.3 },
    points: [{ x: 0, z: 45.2 }, { x: 0, z: 44.4 }, { x: 0, z: 43.2 }, { x: 0, z: 33.8 },
      { x: 0, z: 12 }, { x: 0, z: -20 }, { x: 0, z: -27.6 }, { x: 0, z: -28.2 },
      { x: 0, z: -28.9 }, { x: 0, z: -29.4 }, { x: 0, z: -34 }, { x: 0, z: -38 }]
  },
  {
    // The only way onto the battlement: east cloister walk, through the turret door, then five
    // switchback flights and out of the stair head onto the wall walk.
    name: 'Courtyard cloister → stair turret → battlement wall walk', endY: 22.8,
    from: { x: 30, z: -58, y: 0.3 },
    points: [{ x: 32, z: -58 }, { x: 33.5, z: -58 }, { x: 35, z: -58.5 },
      { x: 36.9, z: -61.2 }, { x: 41, z: -61.2 },
      { x: 42, z: -61.2 }, { x: 42, z: -57.8 }, { x: 41, z: -57.8 },
      { x: 36.9, z: -57.8 }, { x: 35.9, z: -57.8 }, { x: 35.9, z: -61.2 }, { x: 36.9, z: -61.2 },
      { x: 41, z: -61.2 }, { x: 42, z: -61.2 }, { x: 42, z: -57.8 }, { x: 41, z: -57.8 },
      { x: 36.9, z: -57.8 }, { x: 35.9, z: -57.8 }, { x: 35.9, z: -61.2 }, { x: 36.9, z: -61.2 },
      { x: 41, z: -61.2 }, { x: 41.6, z: -61.2 }, { x: 41.6, z: -63.2 }, { x: 41.6, z: -64.8 }]
  },
  {
    // Both tower decks are reached by walking the battlements: east deck, back along the walk,
    // west deck. The decks stand 0.2 m above the walk, under the step limit.
    name: 'Battlement wall walk → tower decks', endY: 23.0,
    from: { x: 41.6, z: -64.8, y: 22.8 },
    points: [{ x: 20, z: -65.4 }, { x: 20, z: -69.6 }, { x: 20, z: -65.4 },
      { x: -20, z: -65.4 }, { x: -20, z: -69.6 }]
  },
  {
    name: 'Grounds → Black Lake shore', endY: 0.58,
    from: { x: 0, z: 80, y: 0.3 },
    points: [{ x: 0, z: 86 }, { x: 0, z: 88.4 }, { x: 0, z: 92.5 }]
  },
  {
    name: "Grounds → Hagrid's hut", endY: 0.3,
    from: { x: -24, z: 66, y: 0.3 },
    points: [{ x: -40, z: 61 }, { x: -52, z: 44 }, { x: -66, z: 34 }, { x: -84, z: 30 },
      { x: -96, z: 22 }, { x: -96, z: 13 }]
  },
  {
    name: "Hagrid's hut door → interior", endY: 0.36,
    from: { x: -96, z: 13.2, y: 0.3 },
    points: [{ x: -96, z: 11.6 }, { x: -96, z: 9 }, { x: -96, z: 6.5 }]
  },
  {
    name: "Hagrid's hut → grounds", endY: 0.3,
    from: { x: -96, z: 13, y: 0.3 },
    points: [{ x: -96, z: 22 }, { x: -84, z: 30 }, { x: -66, z: 34 }, { x: -52, z: 44 },
      { x: -40, z: 61 }, { x: -24, z: 66 }]
  }
];

/**
 * The outside approaches that make the castle one continuous place rather than a castle with a
 * bridge that stops in mid-air: treads from the courtyard up onto the viaduct, the terrace and
 * steps where it lands on the north lawn, and the path across the grounds. buildHogwarts owns
 * the exterior shell these pieces join, so it calls this next to buildHogwartsInterior.
 */
export function buildHogwartsApproaches(parts) {
  const GROUND = 0.3;
  const DECK = 1.25;                     // viaduct deck top, see buildHogwarts

  // Courtyard → viaduct. The deck sat 0.95 m above the courtyard with nothing in front of it,
  // so the bridge could only be reached by jumping; these three treads meet it at 0.32 m.
  for (let i = 0; i < 3; i++) {
    const top = GROUND + .32 * (i + 1);
    box(parts, 0, (top + GROUND) / 2, -29.4 + i * .66, 9.2, top - GROUND, .66, 'stoneDark', solid({ bottom: GROUND }));
    for (const side of [-1, 1]) railing(parts, side * 4.9, top, -29.05, .9, 'z', 'stoneLight');
  }

  // The far landing. The viaduct used to end over open grass with no terrace at all, so the
  // only way off it was to drop a metre, and nothing on the grounds was reachable from it.
  floorSlab(parts, -9, 33.4, 9, 44, DECK, 'stoneDark');
  for (const side of [-1, 1]) railing(parts, side * 8.6, DECK, 38.7, 9.6, 'z', 'stoneLight');
  for (const side of [-1, 1]) box(parts, side * 6.6, DECK + .45, 44, 1.1, .9, 1.1, 'stoneLight', solid({ bottom: DECK }));
  for (let i = 0; i < 2; i++) {
    const top = .93 - i * .32;
    box(parts, 0, (top + GROUND) / 2, 44.4 + i * .7, 9, top - GROUND, .7, 'stoneDark', solid({ bottom: GROUND }));
  }

  // The grounds path: a cobbled walk north from the landing across the lawn, with lamps. The
  // lawn itself is the plateau floor, so the path is only a 2 cm lip and never a step.
  box(parts, 0, GROUND + .02, 64, 5.4, .04, 40, 'cobble');
  box(parts, -7.4, GROUND + .02, 54, 9, .04, 4, 'cobble');
  box(parts, 7.4, GROUND + .02, 54, 9, .04, 4, 'cobble');
  for (let i = 0; i < 5; i++) {
    for (const side of [-1, 1]) {
      cyl(parts, side * 3.4, GROUND + 1.5, 50 + i * 8, .09, .13, 3, 'dark', { seg: 6 });
      ball(parts, side * 3.4, GROUND + 3.15, 50 + i * 8, .27, 'flame', { seg: 6 });
    }
  }
  // A low stone kerb frames the lawn end of the walk, and two benches give the grounds a
  // destination worth the crossing rather than a bare plane.
  // Two kerb ends rather than one across the path, so the walk north to the lake is clear.
  for (const side of [-1, 1]) box(parts, side * 7.2, GROUND + .22, 84.4, 9.6, .44, .8, 'stoneLight', solid({ bottom: GROUND }));
  for (const side of [-1, 1]) {
    bench(parts, side * 9, 78, 5, 1.4, GROUND);
    cyl(parts, side * 9, GROUND + 1.1, 74.4, .5, .6, 2.2, 'wood', { seg: 8 });
    ball(parts, side * 9, GROUND + 2.5, 74.4, 1.1, 'leaf', { sy: 1.2, seg: 8 });
  }

  // ---- grounds → the Black Lake ------------------------------------------------------
  // The lawn path runs on north to a stone quay standing above the water. A parapet on the
  // lake edge is the boundary: the water plane is below the quay, so nobody wades out of the
  // world, and the drop back to the lawn is 0.26 m instead of a fall.
  box(parts, 0, GROUND + .02, 86.5, 5.4, .04, 9, 'cobble');
  box(parts, 0, (.58 + GROUND) / 2, 93, 34, .58 - GROUND, 10, 'stoneLight', solid({ bottom: GROUND }));
  box(parts, 0, .58 + .28, 97.7, 34, .56, .5, 'stoneDark', solid({ bottom: .58 }));
  for (const side of [-1, 1]) {
    box(parts, side * 16.6, .30, 93, .8, .6, 10, 'stoneDark', solid({ bottom: GROUND }));
    for (let i = 0; i < 3; i++) {
      cyl(parts, side * (4 + i * 5), .58 + 1.4, 95.9, .1, .14, 2.8, 'dark', { seg: 6 });
      ball(parts, side * (4 + i * 5), .58 + 3.0, 95.9, .26, 'flame', { seg: 6 });
    }
    // Shore furniture: a jetty post, a coil of rope and a crate at either end of the quay.
    cyl(parts, side * 14, .58 + .9, 90.2, .16, .2, 1.8, 'wood', { seg: 6 });
    box(parts, side * 13.4, .58 + .3, 94.6, 1.2, .6, 1.2, 'wood', solid({ bottom: .58 }));
  }

  // ---- grounds → Hagrid's hut --------------------------------------------------------
  // A cobbled track west from the lawn, round the south side of Hogsmeade, down to the hut
  // door. The ground is flat plateau the whole way, so the track is a 4 cm lip and never a step.
  const hutTrack = [[-24, 66], [-40, 61], [-52, 44], [-66, 34], [-84, 30], [-96, 22], [-96, 13]];
  for (let i = 1; i < hutTrack.length; i++) {
    const [ax, az] = hutTrack[i - 1], [bx, bz] = hutTrack[i];
    const length = Math.hypot(bx - ax, bz - az);
    box(parts, (ax + bx) / 2, GROUND + .02, (az + bz) / 2, 4.2, .04, length + 1.4, 'cobble',
      { ry: Math.atan2(bx - ax, bz - az) });
  }
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const x = -24 + (hutTrack[hutTrack.length - 1][0] + 24) * t;
    const z = 66 + (hutTrack[hutTrack.length - 1][1] - 66) * t;
    cyl(parts, x - 3.4, GROUND + 1.4, z, .1, .14, 2.8, 'dark', { seg: 6 });
    ball(parts, x - 3.4, GROUND + 2.95, z, .26, 'flame', { seg: 6 });
  }
}

/**
 * The traversal graph: one node per playable space, one edge per physically walkable
 * connection. `route` names the entry in HOGWARTS_NAV_ROUTES that proves the edge by walking
 * it with the game's own collision functions, so the graph cannot drift away from the geometry.
 */
/**
 * The east cloister stair turret, and the only route onto the battlement wall walk.
 *
 * The previous turret was a solid 9 x 9 stone block with its four flights modelled *inside* the
 * solid, and the flights also started 0.8 m above the landing that preceded them. Nobody could
 * stand on it, so the wall walk and the two tower decks it serves were scenery.
 *
 * This one is hollow: walls with a door on the east and west face, a floor at the cloister
 * height, and five stacked switchback flights of 11 treads (0.4 m rise, 0.42 m run) climbing
 * from 0.72 m to 22.72 m. Each landing is a thin slab that spans both stair bands, so turning
 * at a landing never walks into a tread; each flight climbs away from the landing below it.
 * The south wall stops at 21.2 m so the top landing runs out onto the wall walk at 22.8 m.
 */
export function buildHogwartsWallWalkStair(parts) {
  const GROUND = 0.3;
  const X0 = 34.5, X1 = 43.5, Z0 = -63.6, Z1 = -54.6, T = .7, WALL_TOP = GROUND + 23;
  const FLOOR = GROUND + .42;                 // matches the cloister walk
  const cx = (X0 + X1) / 2;
  const cz = (Z0 + Z1) / 2;
  const ix0 = X0 + T, ix1 = X1 - T, iz0 = Z0 + T, iz1 = Z1 - T;

  // Floor: the cloister walk is cut away here, so the turret carries its own.
  floorSlab(parts, ix0, iz0, ix1, iz1, FLOOR, 'stoneDark');
  // West and east walls, each with a doorway onto the cloister walk.
  wallRun(parts, { axis: 'z', fixed: X0 + T / 2, from: Z0, to: Z1, y0: GROUND, y1: WALL_TOP, thickness: T, mat: 'stone', doors: [{ at: cz, width: 3.4 }] });
  wallRun(parts, { axis: 'z', fixed: X1 - T / 2, from: Z0, to: Z1, y0: GROUND, y1: WALL_TOP, thickness: T, mat: 'stone', doors: [{ at: cz, width: 3.4 }] });
  wallRun(parts, { axis: 'x', fixed: Z1 - T / 2, from: X0, to: X1, y0: GROUND, y1: WALL_TOP, thickness: T, mat: 'stone' });
  // The south wall stops one storey short of the others: above it the top landing opens onto
  // the wall walk, which is the whole point of the turret.
  wallRun(parts, { axis: 'x', fixed: Z0 + T / 2, from: X0, to: X1, y0: GROUND, y1: GROUND + 21.2, thickness: T, mat: 'stone' });
  // Lancets and a parapet, so the turret belongs to the cloister it stands in.
  for (const side of [-1, 1]) {
    for (const z of [cz - 2.6, cz + 2.6]) box(parts, side < 0 ? X0 - .02 : X1 + .02, FLOOR + 3.4, z, .1, 2.2, 1.1, 'glassWarm');
    box(parts, side < 0 ? X0 + .35 : X1 - .35, WALL_TOP, cz, .5, .5, Z1 - Z0 - 1.4, 'stoneDark');
  }
  for (let x = X0 + 1; x <= X1 - 1; x += 1.6) box(parts, x, WALL_TOP + .25, Z1 - .35, 1.1, .5, .5, 'stoneLight');

  // ---- five flights, 11 treads each, alternating bands --------------------
  const steps = 11, rise = .4, run = .42;
  const flightRun = steps * run;
  const landing = (ix1 - ix0 - flightRun) / 2;        // 1.49 m each end
  const fx0 = ix0 + landing, fx1 = ix1 - landing;
  const bandA = iz0 + 1.7, bandB = iz1 - 1.7;          // two 3.2 m deep bands
  let y = FLOOR;
  for (let f = 0; f < 5; f++) {
    const upEast = f % 2 === 0;
    const zc = upEast ? bandA : bandB;
    for (let i = 0; i < steps; i++) {
      const top = y + rise * (i + 1);
      const x = upEast ? fx0 + run * (i + .5) : fx1 - run * (i + .5);
      box(parts, x, top - .2, zc, run + .02, .4, 3.2, 'stoneDark', solid({ bottom: top - .45 }));
    }
    y += steps * rise;
    // The landing spans both bands, so the next flight starts across the well.
    const lx0 = upEast ? fx1 : ix0, lx1 = upEast ? ix1 : fx0;
    box(parts, (lx0 + lx1) / 2, y - .2, (iz0 + iz1) / 2, lx1 - lx0, .4, iz1 - iz0, 'stoneDark', solid({ bottom: y - .45 }));
  }
  // Top landing: a floor over the whole turret at the last flight's height, running out to the
  // wall walk. It is deliberately above every tread below it (a slab, not a column).
  box(parts, (fx1 + ix1) / 2, y + .03, (iz0 + iz1) / 2, ix1 - fx1, .34, iz1 - iz0, 'stoneDark', solid({ bottom: y - .14 }));
  box(parts, cx, y + .03, (Z0 - .3 + iz0) / 2, ix1 - ix0, .34, iz0 - (Z0 - .3), 'stoneDark', solid({ bottom: y - .14 }));
  // A handrail down the open side of the two upper landings.
  railing(parts, ix0 + .1, y - 1.5, (iz0 + iz1) / 2, iz1 - iz0, 'z', 'stoneDark');
}


/**
 * Hagrid's hut: a hollow round house with a real doorway, a floor, a ceiling and furniture.
 *
 * It used to be a solid 6 m brick drum with a door panel painted on it, so the track from the
 * grounds ended at a wall. Sixteen wall panels ring a 6.1 m radius; one is left out on the +z
 * side for the door, and two jambs frame the opening. Every panel is solid from the ground to
 * 4.4 m with its own collider, so the interior is enclosed except at the door, and no collider
 * spans the opening.
 */
export function buildHagridsHut(parts) {
  const GROUND = 0.3, HX = -96, HZ = 6, R = 6.1, WALL_H = 4.1, SEGMENTS = 16;
  const chord = 2 * R * Math.sin(Math.PI / SEGMENTS) + .35;
  floorSlab(parts, HX - 5.6, HZ - 5.6, HX + 5.6, HZ + 5.6, GROUND + .06, 'stoneDark');
  for (let i = 0; i < SEGMENTS; i++) {
    const a = (i / SEGMENTS) * Math.PI * 2;
    if (i === 4) continue;                                  // the door, +z
    box(parts, HX + Math.cos(a) * (R - .27), GROUND + WALL_H / 2, HZ + Math.sin(a) * (R - .27),
      chord, WALL_H, .55, 'brick', { ry: -(a + Math.PI / 2), solid: true, bottom: GROUND });
  }
  // Jambs and a lintel frame the opening without closing it.
  for (const s of [-1, 1]) {
    const a = Math.PI / 2 + s * (Math.PI * 2 / SEGMENTS);
    box(parts, HX + Math.cos(a) * (R - .15), GROUND + 1.3, HZ + Math.sin(a) * (R - .15), .45, 2.6, .8, 'trunk',
      { ry: -(a + Math.PI / 2), solid: true, bottom: GROUND });
  }
  box(parts, HX, GROUND + 3.0, HZ + R - .35, 3.1, .55, .5, 'trunk', solid({ bottom: GROUND + 2.75 }));
  // Roof: the thatched cone sits above the walls, with a dark ceiling under it.
  cone(parts, HX, GROUND + 6.2, HZ, 8.2, 4.6, 'thatch', { seg: 14 });
  cyl(parts, HX, GROUND + 4.05, HZ, 6.05, 6.05, .12, 'wood', { seg: 16 });
  // A hearth, a table with benches, shelves and a cauldron, all clear of the door line so the
  // walk from the threshold to the middle of the room is never blocked.
  hearth(parts, HX - .4, HZ - 4.6, GROUND + .06, 0);
  table(parts, HX + 2.9, HZ - 1.6, 3.4, 1.8, GROUND + .06);
  bench(parts, HX + 2.9, HZ - 3.1, 3.4, .8, GROUND + .06);
  bench(parts, HX + 2.9, HZ - .1, 3.4, .8, GROUND + .06);
  bookcase(parts, HX - 4.2, HZ + 1.2, 3.2, .8, GROUND + .06, 3);
  cauldron(parts, HX - 3.6, HZ - 3.4, GROUND + .06);
  armchair(parts, HX - 3.0, HZ + 4.0, GROUND + .06, 'bannerRed', Math.PI);
  for (let i = 0; i < 3; i++) {
    cyl(parts, HX + 3.2 + i * .5, GROUND + 1.5, HZ + 3.6, .24, .3, .7, 'trunk', { seg: 6 });
  }
  sconce(parts, HX - 4.9, GROUND + 1.9, HZ - 2.2);
  sconce(parts, HX + 4.9, GROUND + 1.9, HZ - 2.2);
}


export const HOGWARTS_CONNECTIONS = [
  { a: 'entrance_hall', b: 'great_hall', via: 'Great Hall east doorway', route: 'Great Hall doorway → Entrance Hall' },
  { a: 'entrance_hall', b: 'marble_corridor', via: 'Entrance Hall east doorway', route: 'Entrance Hall → Marble Corridor → Library' },
  { a: 'marble_corridor', b: 'library', via: 'Library west doorway', route: 'Entrance Hall → Marble Corridor → Library' },
  { a: 'entrance_hall', b: 'stair_hall', via: 'Entrance Hall north opening', route: 'Entrance Hall → Grand Staircase → first floor landing' },
  { a: 'stair_hall', b: 'marble_corridor', via: 'Second floor landing and two flights', route: 'Grand Staircase → second floor landing → Marble Corridor' },
  { a: 'marble_corridor', b: 'gryffindor', via: 'Gryffindor west doorway', route: 'Marble Corridor → Gryffindor common room' },
  { a: 'marble_corridor', b: 'kitchens', via: 'Kitchens west doorway' },
  { a: 'marble_corridor', b: 'dada', via: 'Dark Arts west doorway' },
  { a: 'marble_corridor', b: 'charms', via: 'Charms west doorway' },
  { a: 'marble_corridor', b: 'hospital', via: 'Hospital Wing west doorway' },
  { a: 'marble_corridor', b: 'ravenclaw', via: 'Ravenclaw west doorway' },
  { a: 'marble_corridor', b: 'slytherin', via: 'Slytherin east doorway' },
  { a: 'marble_corridor', b: 'history', via: 'History of Magic east doorway' },
  { a: 'marble_corridor', b: 'headmaster', via: 'Headmaster east doorway' },
  { a: 'marble_corridor', b: 'requirement', via: 'Room of Requirement east doorway' },
  { a: 'marble_corridor', b: 'restricted', via: 'Restricted Archive east doorway' },
  { a: 'marble_corridor', b: 'astronomy', via: 'Astronomy Tower east doorway' },
  { a: 'great_hall', b: 'courtyard', via: 'Great Hall south gate' },
  { a: 'courtyard', b: 'viaduct', via: 'Courtyard steps onto the deck', route: 'Courtyard → viaduct → grounds' },
  { a: 'viaduct', b: 'grounds', via: 'Far terrace and steps down to the lawn', route: 'Courtyard → viaduct → grounds' },
  { a: 'courtyard', b: 'dungeons', via: 'West curtain-wall gate' },
  { a: 'courtyard', b: 'wall_walk', via: 'East cloister stair turret', route: 'Courtyard cloister → stair turret → battlement wall walk' },
  { a: 'wall_walk', b: 'tower_deck_east', via: 'East tower deck platform', route: 'Battlement wall walk → tower decks' },
  { a: 'wall_walk', b: 'tower_deck_west', via: 'West tower deck platform', route: 'Battlement wall walk → tower decks' },
  { a: 'grounds', b: 'lakeshore', via: 'Lawn path and quay steps', route: 'Grounds → Black Lake shore' },
  { a: 'grounds', b: 'hagrid_hut', via: 'Track west around Hogsmeade', route: "Grounds → Hagrid's hut" }
];

export const HOGWARTS_GRAPH_NOTES = {
  great_hall: 'the Great Hall and its dais',
  marble_corridor: '78 m ground-floor corridor with four doors per side and two stair landings',
  courtyard: 'courtyard, viaduct approach and cloisters',
  viaduct: 'stone bridge over the ravine',
  grounds: 'north lawn below the landing, path and lakeside seating',
  wall_walk: 'battlement walk along the south curtain wall, reached by the stair turret',
  tower_deck_east: 'east battlement tower deck',
  tower_deck_west: 'west battlement tower deck',
  lakeshore: 'stone quay on the Black Lake',
  hagrid_hut: "Hagrid's hut and its garden",
  dungeons: 'undercroft reached through the west curtain-wall gate'
};
