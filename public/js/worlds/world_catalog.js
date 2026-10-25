// World and battle-location catalog for Browser Bros.
//
// Each of the five reference worlds is ONE large environment containing its landmarks, with
// several named battle locations inside it. A battle location is a playable rectangle with
// its own spawn points (where the fight starts) inside the same world geometry, so switching
// stages inside a world does not rebuild or reload anything.
//
// Everything in this file is plain data plus deterministic generator functions: no Three.js,
// no DOM. That means node can validate every world, its collision volumes, its spawn points
// and its battle areas without a browser (scripts/test-worlds.mjs). The renderer in
// world_builder.js turns the same part descriptors into merged geometry.

const TAU = Math.PI * 2;

/** Small deterministic PRNG so worlds look identical on every load and in tests. */
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- part descriptors -------------------------------------------------------
// Each world's build function owns a `parts` array; these primitives append to it.
const part = (parts, t, x, y, z, s, mat, extra) => { parts.push({ t, p: [x, y, z], s, mat, ...extra }); };
const box = (parts, x, y, z, w, h, d, mat, extra) => part(parts, 'box', x, y, z, [w, h, d], mat, extra);
const cyl = (parts, x, y, z, rt, rb, h, mat, extra) => part(parts, 'cyl', x, y, z, [rt, rb, h], mat, extra);
const cone = (parts, x, y, z, r, h, mat, extra) => part(parts, 'cone', x, y, z, [r, h], mat, extra);
const ball = (parts, x, y, z, r, mat, extra) => part(parts, 'sphere', x, y, z, [r], mat, extra);
const torus = (parts, x, y, z, r, tube, mat, extra) => part(parts, 'torus', x, y, z, [r, tube], mat, extra);
const plane = (parts, x, y, z, w, d, mat, extra) => part(parts, 'plane', x, y, z, [w, d], mat, extra);

/** A solid block, with its vertical extent recorded so overhead decks do not act as walls. */
const solid = extra => ({ solid: true, ...extra });

// ---- shared structures ------------------------------------------------------
function building(parts, x, z, { w = 9, d = 9, h = 9, base = 0, mat = 'building', roof = 'roof', win = 'glassWarm', winRows = 0 } = {}) {
  box(parts, x, base + h / 2, z, w, h, d, mat, solid({ bottom: base }));
  box(parts, x, base + h + .35, z, w + 1.3, .7, d + 1.3, roof);
  if (win) {
    const rows = winRows || Math.max(1, Math.floor(h / 3.4));
    for (let row = 0; row < rows; row++) {
      for (let col = -1; col <= 1; col++) {
        box(parts, x + col * w * .27, base + 2 + row * 2.9, z + d / 2 + .03, Math.min(1.4, w * .2), 1.45, .06, win);
      }
    }
  }
}

function tower(parts, x, z, { r = 4, h = 26, base = 0, mat = 'stone', roof = 'roof', win = 'glassWarm' } = {}) {
  cyl(parts, x, base + h / 2, z, r, r * 1.08, h, mat, solid({ bottom: base, seg: 10 }));
  cone(parts, x, base + h + 4, z, r * 1.25, 8, roof, { seg: 10 });
  for (let i = 0; i < 4; i++) {
    const a = i * TAU / 4 + .4;
    box(parts, x + Math.cos(a) * r * .97, base + h * .68, z + Math.sin(a) * r * .97, .55, 1.7, .55, win);
  }
}

function tree(parts, x, z, scale, base, rng) {
  const h = (4.6 + rng() * 3.4) * scale;
  cyl(parts, x, base + h * .26, z, .3 * scale, .46 * scale, h * .52, 'trunk', { seg: 6 });
  for (let i = 0; i < 3; i++) {
    cone(parts, x, base + h * .5 + i * h * .2, z, (2.5 - i * .55) * scale, h * .42, 'leaf', { seg: 8 });
  }
}

function rock(parts, x, z, scale, base, rng, mat = 'rock') {
  ball(parts, x, base + scale * .32, z, scale, mat, {
    sx: 1 + rng() * .4, sy: .55 + rng() * .3, sz: 1 + rng() * .4,
    solid: scale > 1.5, bottom: base
  });
}

function stairs(parts, x, z, { steps = 6, width = 6, rise = .32, run = .9, base = 0, mat = 'stone', dir = 'z' } = {}) {
  for (let i = 0; i < steps; i++) {
    const cy = base + rise * i + rise / 2;
    if (dir === 'z') box(parts, x, cy, z + i * run, width, rise, run, mat, solid({ bottom: base }));
    else box(parts, x + i * run, cy, z, run, rise, width, mat, solid({ bottom: base }));
  }
}

function railing(parts, x, y, z, length, axis, mat = 'steel') {
  const half = length / 2;
  for (let i = -half; i <= half; i += 2.4) {
    if (axis === 'x') box(parts, x + i, y + .45, z, .09, .9, .09, mat);
    else box(parts, x, y + .45, z + i, .09, .9, .09, mat);
  }
  if (axis === 'x') box(parts, x, y + .88, z, length, .1, .1, mat);
  else box(parts, x, y + .88, z, .1, .1, length, mat);
}

function arch(parts, x, z, { w = 10, h = 8, d = 1.4, base = 0, mat = 'stone' } = {}) {
  for (const side of [-1, 1]) box(parts, x + side * w / 2, base + h / 2, z, 1.3, h, d, mat, solid({ bottom: base }));
  box(parts, x, base + h + .7, z, w + 1.6, 1.4, d, mat);
}

function banner(parts, x, y, z, w, h, mat, ry = 0) {
  box(parts, x, y, z, w, h, .16, mat, { ry });
  box(parts, x, y + h / 2 + .12, z, w + .3, .22, .22, 'gold');
}

function stall(parts, x, z, base, ry = 0) {
  box(parts, x, base + .6, z, 3, 1.2, 2, 'wood', solid({ bottom: base }));
  box(parts, x, base + 2.3, z, 3.5, .22, 2.5, 'cloth', { ry });
  for (const s of [-1, 1]) box(parts, x + s * 1.45, base + 1.25, z, .16, 2.5, .16, 'wood');
}

/** Catwalk suspended above a floor. `bottom` keeps it from colliding with fighters below. */
function catwalk(parts, x, y, z, w, d, { mat = 'metal', rail = true, axis = 'x' } = {}) {
  box(parts, x, y, z, w, .4, d, mat, solid({ bottom: y - .2 }));
  if (rail) {
    if (axis === 'x') { railing(parts, x, y + .2, z - d / 2, w, 'x'); railing(parts, x, y + .2, z + d / 2, w, 'x'); }
    else { railing(parts, x - w / 2, y + .2, z, d, 'z'); railing(parts, x + w / 2, y + .2, z, d, 'z'); }
  }
}

function crowdBlock(parts, x, z, w, d, base, rows = 3, mats = ['cloth', 'cloth2', 'gold']) {
  for (let row = 0; row < rows; row++) {
    const y = base + row * .55;
    box(parts, x, y + .3, z + row * 1.7, w, .6, 1.6, 'stoneDark');
    for (let i = -w / 2 + .7; i < w / 2; i += 1.3) {
      box(parts, x + i, y + .9, z + row * 1.7, .38, .62, .3, mats[(row + Math.round(i)) % 3 < 0 ? 0 : (row + Math.abs(Math.round(i))) % 3]);
      ball(parts, x + i, y + 1.35, z + row * 1.7, .18, 'skin', { seg: 5 });
    }
  }
}

// ---- world: Dragon Ball Z ---------------------------------------------------
function buildDbz() {
  const parts = [];
  const rng = mulberry32(20261022);
  const GROUND = 3.2;

  // Tropical island: layered rock terraces, grass cap, ocean below.
  plane(parts, 0, -7.5, -20, 760, 620, 'water');
  cyl(parts, 0, -6.5, -10, 122, 134, 17, 'rock', solid({ seg: 28, bottom: -20 }));
  cyl(parts, 0, 2.8, -10, 116, 120, .8, 'grass', solid({ seg: 28, bottom: 2.4 }));

  // Grand Prize Stage: stone platform, gold trim, four pillars, gate and grandstand.
  const stageY = 3.6;
  box(parts, 0, stageY, 0, 37, .9, 33, 'stone', solid({ bottom: GROUND }));
  box(parts, 0, stageY + .5, 0, 34, .12, 30, 'stone');
  // Tiled fighting surface: alternating stone tones keep the large platform from reading
  // as a blank white slab from the pulled-back camera.
  for (let ix = 0; ix < 10; ix++) {
    for (let iz = 0; iz < 9; iz++) {
      const x = -15.3 + ix * 3.4, z = -13.6 + iz * 3.4;
      box(parts, x, stageY + .57, z, 3.24, .06, 3.24, (ix + iz) % 2 ? 'stone' : 'stoneDark', { rx: 0 });
    }
  }
  // Painted centre emblem, as on the reference ring: a red disc inside the gold circles.
  cyl(parts, 0, stageY + .6, 0, 8.3, 8.3, .04, 'banner', { seg: 40 });
  cyl(parts, 0, stageY + .62, 0, 5.6, 5.6, .04, 'stoneLight', { seg: 36 });
  torus(parts, 0, stageY + .64, 0, 8.4, .34, 'gold', { rx: Math.PI / 2 });
  torus(parts, 0, stageY + .64, 0, 4.2, .26, 'gold', { rx: Math.PI / 2 });
  for (let i = 0; i < 8; i++) {
    const a = i * TAU / 8;
    box(parts, Math.cos(a) * 12.2, stageY + .58, Math.sin(a) * 12.2, .5, .05, 2.6, 'gold', { ry: -a });
  }
  for (const [x, z] of [[-15, -13], [15, -13], [-15, 13], [15, 13]]) {
    box(parts, x, stageY + 2.4, z, 1.1, 4.4, 1.1, 'gold', solid({ bottom: stageY }));
    cone(parts, x, stageY + 5.2, z, 1, 1.7, 'gold', { seg: 6 });
  }
  box(parts, 0, stageY + .62, -15.6, 37, .5, .6, 'gold');
  box(parts, 0, stageY + .62, 15.6, 37, .5, .6, 'gold');
  box(parts, -17.1, stageY + .62, 0, .6, .5, 33, 'gold');
  box(parts, 17.1, stageY + .62, 0, .6, .5, 33, 'gold');
  arch(parts, 0, -22, { w: 16, h: 8.4, d: 1.6, base: GROUND, mat: 'stone' });
  banner(parts, 0, GROUND + 7.2, -21.2, 9, 4.6, 'banner');
  crowdBlock(parts, -26, 2, 12, 0, GROUND, 3);
  crowdBlock(parts, 26, 2, 12, 0, GROUND, 3);
  crowdBlock(parts, 0, 21, 30, 0, GROUND, 2);

  // Spectator terraces on all four sides, plus a banner ring. In the reference the arena sits
  // inside a bowl of packed stands rather than on an open platform, so the skyline reads as a
  // tournament rather than a plinth.
  for (const side of [-1, 1]) {
    for (let tier = 0; tier < 3; tier++) {
      const y = GROUND + .55 + tier * .95;
      const zr = side * (25.5 + tier * 3.1);
      const span = 70 - tier * 6;
      const half = span / 2 - 4;
      // Two halves with a gate gap at the centre line, so the stage is not walled in.
      for (const end of [-1, 1]) {
        box(parts, end * (half / 2 + 4), y, zr, half, .95, 3.1, tier % 2 ? 'stoneLight' : 'stone', solid({ bottom: GROUND }));
        box(parts, end * (half / 2 + 4), GROUND + 1.05 + tier * .95, zr, half, .1, 3.2, 'stoneDark');
        box(parts, side * (25.5 + tier * 3.1), y, end * (half / 2 + 4), 3.1, .95, half, tier % 2 ? 'stoneLight' : 'stone', solid({ bottom: GROUND }));
      }
    }
  }
  for (let i = 0; i < 22; i++) {
    const a = i * TAU / 22;
    const r = 21.5;
    box(parts, Math.cos(a) * r, stageY + 2.9, Math.sin(a) * r, .18, 5.4, .18, 'gold');
    banner(parts, Math.cos(a) * r, stageY + 4.4, Math.sin(a) * r, 1.7, 3.2, i % 3 === 0 ? 'banner' : i % 3 === 1 ? 'bannerBlue' : 'cloth2', -a + Math.PI / 2);
  }
  // Shrine gate and its roof behind the stage, matching the reference silhouette.
  box(parts, 0, GROUND + 5.4, -30, 22, 1.4, 7, 'roof', { ry: 0 });
  box(parts, 0, GROUND + 8.2, -30, 16, 1.2, 5.4, 'roof');
  for (const side of [-1, 1]) box(parts, side * 8.6, GROUND + 4, -30, 1.6, 8, 1.6, 'wood', solid({ bottom: GROUND }));
  // Plaza palms, lamps and paving bands.
  for (let i = 0; i < 10; i++) {
    const a = i * TAU / 10 + .3;
    const r = 33 + (i % 2) * 3;
    const x = Math.cos(a) * r, z = Math.sin(a) * r * .8;
    tree(parts, x, z, 1.15 + (i % 3) * .18, GROUND, rng);
  }
  for (let i = 0; i < 14; i++) {
    const a = i * TAU / 14;
    cyl(parts, Math.cos(a) * 30, GROUND + 1.3, Math.sin(a) * 30, .16, .24, 2.6, 'stoneDark', { seg: 6 });
    ball(parts, Math.cos(a) * 30, GROUND + 2.8, Math.sin(a) * 30, .28, 'glassWarm', { seg: 6 });
  }

  // Roads out of the stage square to every district.
  for (const [x, z, w, d] of [[-58, 2, 90, 5], [64, 6, 78, 5], [0, 44, 5, 62], [-8, -56, 5, 60]]) {
    box(parts, x, GROUND + .04, z, w, .09, d, 'road');
  }

  // West City: glass towers and shop fronts.
  for (let i = 0; i < 7; i++) {
    const x = -74 - (i % 3) * 16, z = -26 + i * 13;
    const h = 12 + (i % 4) * 7;
    building(parts, x, z, { w: 11 + (i % 2) * 4, d: 10, h, base: GROUND, mat: 'building', roof: 'roofBlue', win: 'glassBlue', winRows: 4 });
    // Shop signage and a roof plant: the towers were plain slabs from street level.
    box(parts, x, GROUND + 4.6, z + 5.2, 6.4, 1.3, .25, i % 2 ? 'bannerBlue' : 'glassBlue');
    box(parts, x, GROUND + 3.1, z + 5.2, 8.4, .2, 1.6, 'wood', { ry: 0 });
    box(parts, x + 2.4, GROUND + h + 1.4, z - 1.4, 2.2, 1.8, 2.2, 'metal');
  }
  for (let i = 0; i < 4; i++) {
    stall(parts, -66, 34 - i * 7, GROUND, i * .4);
    for (const c of [-1, 1]) box(parts, -66 + c * 2.1, GROUND + 1.5, 34 - i * 7, .5, .9, 1.4, 'crate');
  }
  // East City: low market blocks and food stalls.
  for (let i = 0; i < 5; i++) {
    building(parts, 72 + (i % 2) * 18, -8 + i * 14, { w: 9, d: 9, h: 7 + (i % 3) * 3, base: GROUND, mat: 'buildingWarm', roof: 'roof', win: 'glassWarm', winRows: 2 });
  }
  for (let i = 0; i < 5; i++) stall(parts, 60 + i * 4.5, 40, GROUND, .2 * i);

  // Capsule Corporation campus: domes, a central tower and landing pads.
  const capX = -62, capZ = -74;
  cyl(parts, capX, GROUND + .1, capZ, 26, 26, .5, 'stoneLight', solid({ bottom: GROUND, seg: 24 }));
  for (let i = 0; i < 3; i++) {
    const a = i * TAU / 3;
    ball(parts, capX + Math.cos(a) * 12, GROUND + 2.4, capZ + Math.sin(a) * 12, 7.5, 'buildingBlue', { sy: .7, solid: true, bottom: GROUND, seg: 12 });
    cyl(parts, capX + Math.cos(a) * 12, GROUND + 4.4, capZ + Math.sin(a) * 12, 1.2, 1.2, 2.6, 'glassBlue');
  }
  cyl(parts, capX, GROUND + 12, capZ, 3, 4, 24, 'buildingBlue', solid({ bottom: GROUND, seg: 12 }));
  ball(parts, capX, GROUND + 25, capZ, 4.6, 'glassBlue', { seg: 12 });
  banner(parts, capX, GROUND + 8, capZ + 26, 8, 3.4, 'bannerBlue');

  // Martial Arts Dojo: timber hall with a wide training floor.
  box(parts, 0, GROUND + .3, 62, 24, .6, 18, 'wood', solid({ bottom: GROUND }));
  box(parts, 0, GROUND + 4.6, 68, 26, 8, 2, 'wood', solid({ bottom: GROUND }));
  for (const x of [-9, -3, 3, 9]) box(parts, x, GROUND + 2.4, 62, .7, 4.4, .7, 'wood');
  cone(parts, 0, GROUND + 10, 65, 16, 5.5, 'roof', { seg: 4, ry: Math.PI / 4 });
  // Dojo detail: door frame, paper lanterns, training dummies and a flag pole.
  box(parts, 0, GROUND + 2.2, 71, 6, 4.2, .3, 'stoneDark');
  box(parts, 0, GROUND + 4.5, 71.2, 7.4, .5, .5, 'roof');
  for (const x of [-6.4, 6.4]) {
    cyl(parts, x, GROUND + 3.6, 72.2, .3, .3, .9, 'banner', { seg: 8 });
    ball(parts, x, GROUND + 4.3, 72.2, .3, 'flame', { seg: 8 });
  }
  for (let i = 0; i < 4; i++) {
    const x = -14 + i * 5;
    box(parts, x, GROUND + 1.1, 50, .35, 1.6, .35, 'wood', solid({ bottom: GROUND }));
    ball(parts, x, GROUND + 2.1, 50, .55, 'wood', { seg: 8 });
    box(parts, x, GROUND + 1.5, 50, 1.6, .35, .35, 'wood');
  }
  box(parts, 13, GROUND + 3.4, 54, .22, 6.8, .22, 'dark');
  banner(parts, 14.6, GROUND + 5.6, 54, 3.2, 4.4, 'banner');

  // Training grounds: pads, posts, boulders and a sparring ring.
  cyl(parts, 58, GROUND + .1, -58, 15, 15, .4, 'sand', { seg: 20 });
  for (let i = 0; i < 6; i++) {
    const a = i * TAU / 6;
    box(parts, 58 + Math.cos(a) * 9, GROUND + 1.4, -58 + Math.sin(a) * 9, .45, 2.8, .45, 'wood');
    ball(parts, 58 + Math.cos(a) * 9, GROUND + 3, -58 + Math.sin(a) * 9, .5, 'wood', { seg: 6 });
  }
  // Boulders ring the training pad without sitting on either spawn point.
  for (let i = 0; i < 5; i++) rock(parts, 38 + i * 10, -80 + (i % 2) * 5, 1.2 + rng() * 1.4, GROUND, rng);

  // Ring Out Cliffs: broken rim rock, the edge of the island.
  for (let i = 0; i < 22; i++) {
    const a = Math.PI * (.15 + i * .032);
    const r = 104 + (i % 3) * 4;
    rock(parts, Math.cos(a) * r, -10 + Math.sin(a) * r, 3.2 + rng() * 4.2, GROUND - 1.2, rng);
  }
  for (let i = 0; i < 6; i++) {
    const a = Math.PI * (.18 + i * .12);
    box(parts, Math.cos(a) * 96, GROUND + .5, -10 + Math.sin(a) * 96, 6, 1, 10, 'stoneDark', solid({ bottom: GROUND }));
  }

  // King Kai's Planet: a small checkerboard world floating above the sea.
  const kx = 0, kz = -132, ky = 62;
  ball(parts, kx, ky - 14, kz, 15, 'grassDark', { seg: 16 });
  cyl(parts, kx, ky - .4, kz, 14, 15, .8, 'grass', solid({ bottom: ky - 1, seg: 20 }));
  // Standing height of the little world's cap: ky - .4 + .4.
  torus(parts, kx, ky + .02, kz, 9.5, .3, 'road');
  box(parts, kx + 5, ky + 2.2, kz + 3, 5, 4.4, 5, 'buildingWarm', solid({ bottom: ky }));
  cone(parts, kx + 5, ky + 5.4, kz + 3, 4, 2.4, 'roof', { seg: 4, ry: Math.PI / 4 });
  tree(parts, kx - 5, kz - 2, 1.1, ky, rng);
  for (let i = 0; i < 3; i++) rock(parts, kx - 7 + i * 6, kz + 8, .8, ky, rng);

  // Island greenery and a ring of distant peaks.
  for (let i = 0; i < 26; i++) {
    const a = rng() * TAU, r = 30 + rng() * 70;
    tree(parts, Math.cos(a) * r, -10 + Math.sin(a) * r, .8 + rng() * .7, GROUND, rng);
  }
  for (let i = 0; i < 18; i++) {
    const a = i * TAU / 18;
    cone(parts, Math.cos(a) * 240, -6, -10 + Math.sin(a) * 240, 26 + rng() * 16, 46 + rng() * 40, 'mountain', { seg: 6 });
  }
  for (let i = 0; i < 14; i++) {
    ball(parts, (rng() - .5) * 300, 34 + rng() * 26, -10 + (rng() - .5) * 300, 8 + rng() * 8, 'cloud', { sx: 2.4, sy: .5, seg: 8 });
  }

  // ---- South peninsula: rocky training landscape ---------------------------
  // A second landmass joined by a causeway, with stacked mesas and a ledge to fight on. The
  // elevation is real: every tier is a solid volume the movement code can stand on.
  cyl(parts, 0, -8, 136, 40, 47, 18, 'rock', solid({ seg: 22, bottom: -20 }));
  cyl(parts, 0, 2.1, 136, 37, 39, 2.2, 'grass', solid({ seg: 22, bottom: 1.0 }));
  box(parts, 0, GROUND + .03, 100, 9, .06, 30, 'road');
  for (let i = 0; i < 4; i++) {
    for (const side of [-1, 1]) {
      cyl(parts, side * 4.6, GROUND + 1.2, 82 + i * 8, .22, .28, 2.4, 'stoneDark', { seg: 6 });
      ball(parts, side * 4.6, GROUND + 2.6, 82 + i * 8, .34, 'glassWarm', { seg: 6 });
    }
  }
  cyl(parts, -20, GROUND + 2.6, 128, 7.4, 8.6, 5.2, 'rock', solid({ seg: 12, bottom: GROUND }));
  cyl(parts, -20, GROUND + 5.4, 128, 7.8, 7.8, .5, 'grassDark', solid({ seg: 12, bottom: GROUND + 5.1 }));
  cyl(parts, 18, GROUND + 3.6, 144, 6, 7, 7.2, 'rock', solid({ seg: 12, bottom: GROUND }));
  cyl(parts, 18, GROUND + 7.4, 144, 6.4, 6.4, .5, 'grassDark', solid({ seg: 12, bottom: GROUND + 7.1 }));
  stairs(parts, -9, 133, { steps: 7, width: 4, rise: .72, run: 1, base: GROUND, mat: 'rock', dir: 'z' });
  stairs(parts, 13, 136, { steps: 9, width: 4, rise: .72, run: 1, base: GROUND, mat: 'rock', dir: 'z' });
  // Rock arch landmark and a spring pool.
  for (const side of [-1, 1]) box(parts, side * 9, GROUND + 4, 152, 2.4, 8, 2.4, 'rock', solid({ bottom: GROUND }));
  box(parts, 0, GROUND + 8.2, 152, 20, 1.6, 2.6, 'rock');
  ball(parts, 0, GROUND + 9.4, 152, 2.4, 'rock', { sx: 2.2, sy: .5, seg: 10 });
  cyl(parts, 11, GROUND + .1, 126, 5, 5.4, .5, 'stoneDark', solid({ seg: 14, bottom: GROUND }));
  cyl(parts, 11, GROUND + .45, 126, 4.4, 4.4, .18, 'water', { seg: 14 });
  for (let i = 0; i < 10; i++) {
    const a = i * TAU / 10;
    rock(parts, Math.cos(a) * 29, 136 + Math.sin(a) * 26, .9 + rng() * 1.1, GROUND, rng);
  }

  // ---- Capsule Corporation research lab ------------------------------------
  // An offshore research platform east of the island, reached by a road bridge: a clean
  // white shell with a glass front, capsule pods, a test chamber and a gantry. The deck is
  // its own collision surface, so the lab stands over the sea instead of re-skinning land.
  const lx = 86, lz = 100;
  cyl(parts, lx, -7, lz, 26, 31, 14, 'rock', solid({ seg: 24, bottom: -20 }));
  box(parts, lx, 2.9, lz, 36, .6, 32, 'stoneLight', solid({ bottom: 2.5 }));
  // Road bridge from the island shore to the platform.
  box(parts, 58, 2.86, lz, 23, .5, 7, 'road');
  for (let i = 0; i < 6; i++) {
    cyl(parts, 48 + i * 4, -1.5, lz, .5, .62, 9, 'stoneDark', { seg: 8 });
    for (const side of [-1, 1]) ball(parts, 48 + i * 4, 3.3, lz + side * 3.2, .28, 'glassWarm', { seg: 6 });
  }
  // Shell: four walls with a glazed south front and a doorway between platform and lab.
  for (const [x, z, w, d] of [[lx - 17, lz, 1.6, 30], [lx + 17, lz, 1.6, 30], [lx, lz - 15, 35.6, 1.6]]) {
    box(parts, x, GROUND + 4.7, z, w, 9.4, d, 'panel', solid({ bottom: GROUND }));
  }
  for (const side of [-1, 1]) box(parts, lx + side * 12.5, GROUND + 4.7, lz + 15, 10.6, 9.4, 1.6, 'panel', solid({ bottom: GROUND }));
  box(parts, lx, GROUND + 3.4, lz + 15, 9, 6.8, 1.6, 'glassBlue');
  box(parts, lx, GROUND + 9.9, lz, 38, .7, 34, 'panel', solid({ bottom: GROUND + 9.5 }));
  box(parts, lx, GROUND + 10.3, lz, 26, .3, 22, 'glassBlue');
  for (const side of [-1, 1]) {
    box(parts, lx + side * 16.4, GROUND + 5.2, lz, .3, 6, 24, 'glassBlue');
    for (let i = 0; i < 5; i++) box(parts, lx + side * 16.2, GROUND + 5.2, lz - 10 + i * 5, .5, 7, 1, 'stoneDark');
  }
  // Test chamber, consoles and capsule pods.
  cyl(parts, lx + 7, GROUND + 2.4, lz - 6, 4.2, 4.2, 4.8, 'glassCool', { seg: 18 });
  cyl(parts, lx + 7, GROUND + 2.4, lz - 6, 4.6, 4.6, .5, 'panel', solid({ seg: 18, bottom: GROUND }));
  ball(parts, lx + 7, GROUND + 3.4, lz - 6, 1.8, 'glassBlue', { seg: 12 });
  // Control bank kept to the front-west corner and kept low: a four-wide row across the
  // near side sat between the camera and the arena, hiding the fighters' feet and the
  // test chamber behind a line of cabinets.
  for (let i = 0; i < 2; i++) {
    const x = lx - 13.6 + i * 4.9;
    box(parts, x, GROUND + .95, lz + 11.2, 4.6, 1.2, 2.4, 'panel', solid({ bottom: GROUND }));
    box(parts, x, GROUND + 1.6, lz + 11.2, 4, .18, 1.7, 'glassBlue');
    box(parts, x, GROUND + 1.85, lz + 11.2, 1.1, .1, .8, 'glassWarm');
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      cyl(parts, lx + side * 13.5, GROUND + 2.4, lz + 2 - i * 5, 1.4, 1.4, 4.8, 'panel', { seg: 12 });
      ball(parts, lx + side * 13.5, GROUND + 5, lz + 2 - i * 5, 1.4, 'glassBlue', { seg: 10 });
      box(parts, lx + side * 13.5, GROUND + .6, lz + 2 - i * 5, 3, 1.2, 3, 'stoneDark', solid({ bottom: GROUND }));
    }
  }
  catwalk(parts, lx, GROUND + 3.4, lz + 12, 26, 3.2, { axis: 'x' });
  stairs(parts, lx - 14, lz + 5, { steps: 5, width: 3.4, rise: .68, run: 1, base: GROUND, mat: 'panel', dir: 'z' });
  for (let i = 0; i < 8; i++) box(parts, lx - 15 + i * 4.2, GROUND + .04, lz - 8, 2.2, .06, 24, 'floorStripe');
  cyl(parts, lx, GROUND + 12.6, lz - 2, .8, 1.2, 3.4, 'glassBlue', { seg: 10 });
  box(parts, lx, GROUND + 11.4, lz - 2, 7, 2.4, 7, 'panel');

  // ---- West City backstreets ----------------------------------------------
  // A waterfront block west of the island, joined to the city by a bridge: shopfronts, a
  // service alley, fire escapes and an elevated walkway. New geometry on its own deck, not
  // a re-skinned copy of the first street.
  const bx = -120, bz = 96;
  cyl(parts, bx, -7, bz, 28, 33, 14, 'rock', solid({ seg: 24, bottom: -20 }));
  box(parts, bx, 2.9, bz, 44, .6, 36, 'stone', solid({ bottom: 2.5 }));
  box(parts, bx, GROUND + .03, bz, 20, .06, 34, 'road');
  for (let i = 0; i < 5; i++) box(parts, bx - 9 + i * 4.5, GROUND + .04, bz, .3, .07, 33, 'stoneDark');
  // City bridge heading east to the island shore.
  box(parts, -77, 2.86, bz, 42, .5, 7, 'stone');
  for (let i = 0; i < 6; i++) {
    cyl(parts, -96 + i * 7, -1.5, bz, .7, .8, 9, 'stoneDark', { seg: 8 });
    for (const side of [-1, 1]) ball(parts, -96 + i * 7, 3.3, bz + side * 3.2, .28, 'glassWarm', { seg: 6 });
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const x = bx + side * 15, z = bz - 11 + i * 11;
      building(parts, x, z, { w: 9, d: 8.6, h: 7 + ((i + (side > 0 ? 1 : 0)) % 3) * 3, base: GROUND, mat: i % 2 ? 'buildingWarm' : 'buildingBlue', roof: i % 2 ? 'roof' : 'roofBlue', win: 'glassWarm', winRows: 2 });
      box(parts, x - side * 4.7, GROUND + 2.4, z, .3, 2.6, 5.6, i % 2 ? 'banner' : 'bannerBlue');
      box(parts, x - side * 5.6, GROUND + 3.1, z, 2.6, .2, 7.4, 'wood');
      box(parts, x - side * 6.4, GROUND + .8, z + 2.6, 1.2, 1.4, 1.2, 'crate', solid({ bottom: GROUND }));
      for (let f = 0; f < 3; f++) box(parts, x - side * 4.6, GROUND + 3.2 + f * 2.4, z - 2, 1.6, .16, 3.2, 'metal');
    }
  }
  catwalk(parts, bx, GROUND + 3.6, bz - 12, 30, 3, { axis: 'x' });
  for (const side of [-1, 1]) stairs(parts, bx + side * 12, bz - 8, { steps: 4, width: 3.2, rise: .85, run: 1, base: GROUND, mat: 'metal', dir: 'x' });
  for (let i = 0; i < 5; i++) {
    cyl(parts, bx - 12 + i * 6, GROUND + 2.2, bz + 15.6, .18, .24, 4.4, 'stoneDark', { seg: 6 });
    ball(parts, bx - 12 + i * 6, GROUND + 4.6, bz + 15.6, .3, 'glassWarm', { seg: 6 });
  }
  rock(parts, bx + 18, bz + 14, 1.1, GROUND, rng, 'moss');
  return parts;
}

// ---- world: Asgard ----------------------------------------------------------
function buildAsgard() {
  const parts = [];
  const rng = mulberry32(77123);
  const GROUND = 0.5;

  // Floating realm: a great stone disc with a marble plaza and gold inlay.
  cyl(parts, 0, -7, 0, 116, 128, 15, 'rock', solid({ seg: 30, bottom: -20 }));
  cyl(parts, 0, .1, 0, 112, 114, .8, 'marble', solid({ seg: 30, bottom: -.4 }));
  // Marble inlay disc with a gold rim, not a 116 m sheet of gold: the old solid gold disc
  // tinted the whole plaza warm and hid the marble underneath it.
  cyl(parts, 0, .45, 0, 58, 58, .1, 'marble', { seg: 40 });
  torus(parts, 0, .52, 0, 58, .55, 'gold', { rx: Math.PI / 2 });
  // Dark inlay rings and radial bands give the plaza a pattern: without them the warm marble
  // read as one continuous gold field from the court camera.
  for (const r of [22, 34, 48, 62, 78, 94]) {
    torus(parts, 0, GROUND + .08, 0, r, .38, 'stoneDark', { rx: Math.PI / 2 });
  }
  for (let i = 0; i < 24; i++) {
    const a = i * TAU / 24;
    box(parts, Math.cos(a) * 62, GROUND + .07, Math.sin(a) * 62, 2.2, .06, 58, 'stoneDark', { ry: -a });
  }
  for (let i = 0; i < 12; i++) {
    const a = i * TAU / 12;
    box(parts, Math.cos(a) * 72, GROUND + .06, Math.sin(a) * 72, 30, .08, .7, 'gold', { ry: -a });
  }

  // Royal palace: tiered gold ziggurat, domes, needled spires.
  const pz = -86;
  box(parts, 0, GROUND + 3, pz, 90, 6, 48, 'gold', solid({ bottom: GROUND }));
  box(parts, 0, GROUND + 8.5, pz, 76, 5, 40, 'goldLight', solid({ bottom: GROUND + 6 }));
  box(parts, 0, GROUND + 14, pz, 60, 5, 32, 'gold', solid({ bottom: GROUND + 11 }));
  box(parts, 0, GROUND + 19, pz, 44, 5, 24, 'goldLight', solid({ bottom: GROUND + 16 }));
  cyl(parts, 0, GROUND + 25, pz, 12, 16, 9, 'goldLight', { seg: 24 });
  ball(parts, 0, GROUND + 31, pz, 12, 'gold', { sy: .6, seg: 20 });
  cone(parts, 0, GROUND + 42, pz, 2.6, 18, 'goldLight', { seg: 8 });
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const x = side * (26 + i * 13), h = 26 + (i % 2) * 9;
      box(parts, x, GROUND + h / 2 + 6, pz + (i % 2) * 4, 9, h, 9, 'gold', solid({ bottom: GROUND + 2 }));
      cone(parts, x, GROUND + h + 13, pz + (i % 2) * 4, 5.4, 12, 'goldLight', { seg: 8 });
      ball(parts, x, GROUND + h + 20, pz + (i % 2) * 4, 1.6, 'goldLight', { seg: 8 });
    }
  }
  // Palace steps down to the plaza.
  stairs(parts, 0, pz + 30, { steps: 8, width: 26, rise: .4, run: 1.2, base: GROUND, mat: 'goldLight', dir: 'z' });
  for (let i = 0; i < 6; i++) {
    cyl(parts, -30 + i * 12, GROUND + 4, pz + 27, .8, .9, 8, 'marble', { seg: 8 });
    ball(parts, -30 + i * 12, GROUND + 8.6, pz + 27, .7, 'crystal');
  }
  // Colonnade across the palace front, with lit windows and gold trim on every tier. The
  // ziggurat tiers were solid gold masses; the column line and the window bands give the
  // facade a scale reference and a readable silhouette from the court below.
  for (let i = 0; i < 9; i++) {
    const x = -36 + i * 9;
    cyl(parts, x, GROUND + 7.2, pz + 25, 1.5, 1.7, 13.4, 'marble', solid({ bottom: GROUND, seg: 12 }));
    box(parts, x, GROUND + 13.8, pz + 25, 3.6, .9, 3.6, 'gold');
    box(parts, x, GROUND + 1.4, pz + 25, 3.8, 2.8, 3.8, 'goldLight');
  }
  box(parts, 0, GROUND + 14.6, pz + 25, 82, 1.1, 4.6, 'gold');
  box(parts, 0, GROUND + 15.5, pz + 25, 82, .5, 5.4, 'goldLight');
  for (let tier = 0; tier < 4; tier++) {
    const w = 90 - tier * 15, y = GROUND + 3 + tier * 5.5, zf = pz + 24 - tier * .8;
    for (let i = -Math.floor(w / 7); i <= Math.floor(w / 7); i++) {
      box(parts, i * 7, y, zf, 2.1, 3.4, .16, 'glassWarm');
      box(parts, i * 7, y + 2, zf + .05, 2.5, .3, .22, 'gold');
    }
  }
  // Guardian statues at the stair foot and braziers along the avenue.
  for (const side of [-1, 1]) {
    const x = side * 17;
    box(parts, x, GROUND + 1, pz + 34, 4, 2, 4, 'marble', solid({ bottom: GROUND }));
    box(parts, x, GROUND + 4.2, pz + 34, 2.4, 4.6, 2.4, 'marble', solid({ bottom: GROUND }));
    ball(parts, x, GROUND + 7, pz + 34, 1.1, 'marble', { seg: 10 });
    box(parts, x, GROUND + 8.6, pz + 34, .5, 2.2, 2.6, 'gold');
  }
  for (let i = 0; i < 8; i++) {
    const z = pz + 40 + i * 6;
    for (const side of [-1, 1]) {
      cyl(parts, side * 21, GROUND + 1.6, z, .3, .5, 2.6, 'gold', { seg: 8 });
      ball(parts, side * 21, GROUND + 3.2, z, .42, 'flame', { seg: 8 });
    }
  }

  // City: gold-and-stone houses along the avenue, with banners and braziers.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const x = side * (34 + (i % 3) * 14), z = 26 - i * 13;
      building(parts, x, z, { w: 10 + (i % 2) * 3, d: 9, h: 7 + (i % 3) * 3, base: GROUND, mat: i % 2 ? 'marble' : 'stone', roof: 'roofGold', win: 'crystal', winRows: 2 });
      banner(parts, x - side * 5.4, GROUND + 5, z + 4.7, 2.2, 3.4, 'bannerBlue', side * .1);
    }
  }
  for (let i = 0; i < 10; i++) {
    const z = 28 - i * 9, x = (i % 2 ? 1 : -1) * 9;
    cyl(parts, x, GROUND + 2.6, z, .2, .35, 5, 'gold', { seg: 6 });
    ball(parts, x, GROUND + 5.4, z, .45, 'crystal');
  }

  // Fountain and gardens.
  cyl(parts, -22, GROUND + .3, 18, 5.4, 6, .8, 'marble', solid({ bottom: GROUND, seg: 20 }));
  cyl(parts, -22, GROUND + 1.1, 18, 4.4, 4.4, .3, 'water');
  ball(parts, -22, GROUND + 2.6, 18, 1.5, 'crystal');
  for (let i = 0; i < 7; i++) {
    const a = i * TAU / 7;
    tree(parts, -48 + Math.cos(a) * 12, 44 + Math.sin(a) * 10, 1 + rng() * .6, GROUND, rng);
  }
  for (let i = 0; i < 6; i++) {
    box(parts, -48 + i * 4.2, GROUND + .55, 56, 3.6, 1.1, 1.4, 'leaf', solid({ bottom: GROUND }));
  }

  // Training yard.
  box(parts, 46, GROUND + .12, -42, 34, .24, 26, 'sand', solid({ bottom: GROUND }));
  for (let i = 0; i < 6; i++) {
    const a = i * TAU / 6;
    box(parts, 46 + Math.cos(a) * 11, GROUND + 1.6, -42 + Math.sin(a) * 11, .5, 3.2, .5, 'wood');
  }
  for (const [x, z] of [[30, -54], [62, -54], [30, -30], [62, -30]]) {
    box(parts, x, GROUND + 1, z, 1.2, 2, 1.2, 'stone', solid({ bottom: GROUND }));
    ball(parts, x, GROUND + 2.6, z, .8, 'crystal');
  }

  // Marketplace: stalls with awnings and crates.
  for (let i = 0; i < 6; i++) {
    stall(parts, 58 + (i % 2) * 9, 6 + i * 8, GROUND, i * .3);
    box(parts, 66 + (i % 3) * 2, GROUND + .35, 2 + i * 8, 1.1, .7, 1.1, 'wood');
  }
  arch(parts, 76, 44, { w: 12, h: 8, d: 2, base: GROUND, mat: 'stone' });
  // Marketplace detail: a central fountain, lanterns and produce stacks.
  cyl(parts, 66, GROUND + .4, 22, 5, 5.6, 1, 'marble', solid({ bottom: GROUND, seg: 18 }));
  cyl(parts, 66, GROUND + 1.1, 22, 4.2, 4.2, .24, 'water');
  cyl(parts, 66, GROUND + 2.2, 22, .6, 1, 2.4, 'marble', { seg: 10 });
  ball(parts, 66, GROUND + 3.8, 22, 1.1, 'crystal');
  for (let i = 0; i < 10; i++) {
    const a = i * TAU / 10;
    cyl(parts, 66 + Math.cos(a) * 13, GROUND + 2.4, 22 + Math.sin(a) * 13, .18, .26, 5, 'gold', { seg: 6 });
    ball(parts, 66 + Math.cos(a) * 13, GROUND + 5.1, 22 + Math.sin(a) * 13, .3, 'flame', { seg: 6 });
  }
  for (let i = 0; i < 12; i++) {
    const x = 52 + (i % 4) * 7, z = 2 + Math.floor(i / 4) * 6;
    box(parts, x, GROUND + .45, z, 1.2, .9, 1.2, i % 3 ? 'crate' : 'cloth');
    box(parts, x, GROUND + .95, z, 1.3, .18, 1.3, 'wood');
  }

  // Rainbow Bridge: a long glowing span with arches, running from the plaza to the Bifrost.
  const bridgeZ0 = 30, bridgeZ1 = 138;
  box(parts, 0, GROUND + .9, (bridgeZ0 + bridgeZ1) / 2, 16, .7, bridgeZ1 - bridgeZ0, 'crystal', solid({ bottom: GROUND + .4 }));
  box(parts, 0, GROUND + 1.28, (bridgeZ0 + bridgeZ1) / 2, 11, .06, bridgeZ1 - bridgeZ0, 'gold');
  for (let i = 0; i <= 9; i++) {
    const z = bridgeZ0 + i * 12;
    for (const side of [-1, 1]) {
      cyl(parts, side * 7.4, GROUND + .9, z, .35, .55, 1.5, 'gold', { seg: 8 });
      ball(parts, side * 7.4, GROUND + 1.8, z, .32, 'crystal');
    }
  }
  for (let i = 0; i < 5; i++) {
    const z = bridgeZ0 + 12 + i * 24;
    const support = cyl(parts, 0, GROUND - 6, z, 3.4, 4.6, 14, 'marble', { seg: 10 });
    void support;
    // Arches over each support, rune bands and flame braziers on the parapet.
    for (const side of [-1, 1]) {
      box(parts, side * 6.4, GROUND + 2.1, z, .7, 2.4, 1.6, 'gold');
      torus(parts, side * 6.4, GROUND + .6, z, 1.3, .22, 'goldLight', { rx: 0 });
      cyl(parts, side * 7.9, GROUND + 2.2, z, .28, .42, 2.6, 'gold', { seg: 8 });
      ball(parts, side * 7.9, GROUND + 3.8, z, .38, 'flame', { seg: 8 });
    }
    box(parts, 0, GROUND + .95, z, 9, .06, .5, 'crystalGlow');
  }

  // Throne hall: the palace's interior wing, standing on its own rock spur behind the
  // ziggurat. It is a nave, 40 m wide and 64 m long, with the throne at the north end, so
  // the pulled-back camera looks down the room at the dais instead of into a side wall.
  const hy0 = GROUND, hz0 = -111, hz1 = -175, hcz = (hz0 + hz1) / 2;
  box(parts, 0, -12, hcz, 46, 20, 70, 'rock', solid({ bottom: -26 }));
  box(parts, 0, -6, hcz, 44, 13, 68, 'marble', solid({ bottom: -20 }));
  box(parts, 0, hy0 - .4, hcz, 40, .8, 66, 'marble', solid({ bottom: hy0 - .8 }));
  // Side walls, north wall (behind the throne) and the south wall with its entrance.
  for (const side of [-1, 1]) box(parts, side * 19, hy0 + 9, hcz, 1.8, 18, 64, 'marble', solid({ bottom: hy0 }));
  box(parts, 0, hy0 + 9, hz1 + 1, 39.8, 18, 1.8, 'marble', solid({ bottom: hy0 }));
  for (const side of [-1, 1]) box(parts, side * 13, hy0 + 9, hz0 + 1, 14, 18, 1.8, 'marble', solid({ bottom: hy0 }));
  box(parts, 0, hy0 + 16, hz0 + 1, 13, 4, 1.8, 'marble', solid({ bottom: hy0 + 14 }));
  box(parts, 0, hy0 + 9, hz0 + .2, 9, 14, .4, 'glassWarm');
  // Gold-coffered ceiling, beams and cornice.
  box(parts, 0, hy0 + 18.6, hcz, 40, .9, 64, 'gold', solid({ bottom: hy0 + 18.2 }));
  box(parts, 0, hy0 + 17.6, hcz, 34, .5, 58, 'stoneDark');
  for (let i = 0; i < 11; i++) box(parts, 0, hy0 + 17.2, hz0 - 4 - i * 5.6, 34, .6, .7, 'gold');
  for (const side of [-1, 1]) box(parts, side * 15.5, hy0 + 17.2, hcz, .7, .6, 58, 'gold');
  // Colonnade: four column pairs down the nave, gold capitals, lit sconces.
  for (let i = 0; i < 4; i++) {
    const z = hz0 - 12 - i * 13;
    for (const side of [-1, 1]) {
      const x = side * 13;
      cyl(parts, x, hy0 + 8, z, 1.15, 1.4, 16, 'marble', solid({ bottom: hy0, seg: 12 }));
      box(parts, x, hy0 + 16.4, z, 3.2, .9, 3.2, 'gold');
      box(parts, x, hy0 + .5, z, 3, 1, 3, 'goldLight', solid({ bottom: hy0 }));
      for (const a of [0, Math.PI / 2]) box(parts, x + Math.cos(a) * 1.9, hy0 + 15.4, z + Math.sin(a) * 1.9, 1.6, .5, 1.6, 'gold');
      cyl(parts, side * 16.4, hy0 + 5, z, .22, .3, .9, 'gold', { seg: 6 });
      ball(parts, side * 16.4, hy0 + 5.8, z, .34, 'flame', { seg: 8 });
      banner(parts, x, hy0 + 9.4, z + 1.2, 2.6, 6.4, side < 0 ? 'bannerBlue' : 'cloth', side * .04);
    }
  }
  // Throne dais at the north end: three steps, a gold seat and a great window behind it.
  for (let i = 0; i < 3; i++) {
    box(parts, 0, hy0 + .3 + i * .5, hz1 + 8 + i * 1.7, 20 - i * 2.4, .5, 7.4 - i * 1.5, 'goldLight', solid({ bottom: hy0 }));
  }
  // The seat: a raised platform, a low cushion, a tall panelled back between two gold-
  // capped posts and a spired crest, so the silhouette reads as an ornate throne instead
  // of a heavy bench. Everything sits north of the playable rectangle (z <= -164).
  box(parts, 0, hy0 + .7, hz1 + 5, 9.4, 1.4, 6.4, 'marble', solid({ bottom: hy0 }));
  box(parts, 0, hy0 + 1.5, hz1 + 5, 8.6, .2, 5.6, 'goldLight');
  box(parts, 0, hy0 + 1.55, hz1 + 4.6, 4.8, .3, 3.2, 'gold');
  box(parts, 0, hy0 + 1.95, hz1 + 4.6, 4.2, .55, 2.8, 'cloth', solid({ bottom: hy0 + 1.4 }));
  for (const side of [-1, 1]) {
    // Back posts, finials and the spires above them.
    box(parts, side * 2.1, hy0 + 5.7, hz1 + 3.3, .6, 8.5, .6, 'gold', solid({ bottom: hy0 + 1.4 }));
    ball(parts, side * 2.1, hy0 + 10.1, hz1 + 3.3, .55, 'gold', { seg: 8 });
    cyl(parts, side * 2.1, hy0 + 11, hz1 + 3.3, .12, .24, 1.5, 'gold', { seg: 6 });
    // Arms, with a knob at the front end.
    box(parts, side * 2.5, hy0 + 2.85, hz1 + 4.9, .5, .5, 2.6, 'goldLight', solid({ bottom: hy0 + 1.4 }));
    box(parts, side * 2.5, hy0 + 2.2, hz1 + 5.9, .6, 1.1, .6, 'gold');
    ball(parts, side * 2.5, hy0 + 3.2, hz1 + 3.8, .34, 'gold', { seg: 8 });
  }
  // Back panel with three inset fields and the crest above it.
  box(parts, 0, hy0 + 6.2, hz1 + 3.5, 3.7, 6.6, .45, 'gold', solid({ bottom: hy0 + 1.4 }));
  for (let i = 0; i < 3; i++) box(parts, 0, hy0 + 4.4 + i * 1.7, hz1 + 3.78, 2.6, 1.2, .12, 'goldLight');
  box(parts, 0, hy0 + 9.9, hz1 + 3.5, 3.1, .5, .9, 'goldLight');
  box(parts, 0, hy0 + 10.5, hz1 + 3.5, 1.9, .6, .9, 'gold');
  box(parts, 0, hy0 + 11, hz1 + 3.5, .8, .5, .9, 'goldLight');
  // Footstool on the top step.
  box(parts, 0, hy0 + 1.45, hz1 + 7.9, 3.8, .15, 2, 'gold');
  box(parts, 0, hy0 + 1.7, hz1 + 7.9, 3.4, .4, 1.7, 'marble', solid({ bottom: hy0 + 1.4 }));
  box(parts, 0, hy0 + 9, hz1 + 2.2, 24, 14, .4, 'glassWarm');
  for (let i = 0; i < 6; i++) box(parts, -10 + i * 4, hy0 + 9, hz1 + 2.5, .5, 14, .5, 'gold');
  for (const side of [-1, 1]) {
    box(parts, side * 12.4, hy0 + 2.4, hz1 + 5.6, 2.2, 4.2, 2.2, 'marble', solid({ bottom: hy0 }));
    ball(parts, side * 12.4, hy0 + 5.2, hz1 + 5.6, 1.1, 'gold', { seg: 10 });
  }
  // Processional carpet from the entrance to the dais.
  box(parts, 0, hy0 + .02, hcz - 3, 5.2, .04, 44, 'banner');
  for (let i = 0; i < 6; i++) box(parts, 0, hy0 + .04, hz1 + 12 + i * 7, 6.2, .03, .4, 'gold');
  // Side-chamber alcoves between the columns, each with a lit arch behind a marble jamb.
  for (let i = 0; i < 3; i++) {
    const z = hz0 - 18 - i * 13;
    for (const side of [-1, 1]) {
      box(parts, side * 17.6, hy0 + 6, z, 3, 10, 6.4, 'stoneDark', solid({ bottom: hy0 }));
      box(parts, side * 16.3, hy0 + 6, z, .4, 8, 4.8, 'glassWarm');
      torus(parts, side * 15.9, hy0 + 10.5, z, 2.6, .3, 'gold', { ry: Math.PI / 2 });
    }
  }
  // Balcony gallery along both walls, reached by stairs at the south corners.
  for (const side of [-1, 1]) {
    catwalk(parts, side * 16.8, 9.2, hcz, 5, 44, { axis: 'z', mat: 'marble' });
    railing(parts, side * 14.4, 9.4, hcz, 44, 'z', 'gold');
    stairs(parts, side * 16.8, hz0 - 8, { steps: 9, width: 4, rise: .95, run: 1, base: hy0, mat: 'marble', dir: 'z' });
    // Tall windows above the gallery, so the hall reads as part of the city outside.
    for (let i = 0; i < 4; i++) {
      const z = hz0 - 12 - i * 13;
      box(parts, side * 18.9, hy0 + 12.6, z, .4, 6, 7, 'glassWarm');
      box(parts, side * 18.7, hy0 + 12.6, z, .3, 6.6, .6, 'gold');
    }
  }
  // Braziers along the carpet and the floor mosaic under the dais.
  for (let i = 0; i < 4; i++) {
    for (const side of [-1, 1]) {
      const z = hz1 + 14 + i * 12;
      cyl(parts, side * 8, hy0 + 1.6, z, .3, .45, 3.2, 'gold', { seg: 8 });
      ball(parts, side * 8, hy0 + 3.5, z, .42, 'flame', { seg: 8 });
    }
  }
  for (const side of [-1, 1]) banner(parts, side * 18.2, hy0 + 10, hz1 + 14, 3.4, 8, side < 0 ? 'bannerBlue' : 'cloth', side * .04);
  torus(parts, 0, hy0 + .04, hz1 + 10, 9, .3, 'gold', { rx: Math.PI / 2 });
  torus(parts, 0, hy0 + .04, hz1 + 10, 5.5, .22, 'gold', { rx: Math.PI / 2 });
  for (let i = 0; i < 8; i++) {
    const a = i * TAU / 8;
    box(parts, Math.cos(a) * 7.2, hy0 + .04, hz1 + 10 + Math.sin(a) * 7.2, .5, .05, 3.4, 'gold', { ry: -a });
  }

  // Bifrost: dome of light at the bridge's end.
  box(parts, 0, GROUND + .9, 148, 46, .7, 26, 'crystal', solid({ bottom: GROUND + .4 }));
  ball(parts, 0, GROUND + 1.2, 152, 24, 'crystalGlow', { sy: .55, seg: 16 });
  for (let i = 0; i < 8; i++) {
    const a = i * TAU / 8;
    cyl(parts, Math.cos(a) * 20, GROUND + 3, 148 + Math.sin(a) * 11, .6, .8, 6, 'gold', { seg: 8 });
  }
  torus(parts, 0, GROUND + 1.3, 148, 17, .4, 'crystalGlow', { rx: Math.PI / 2 });
  // Bifrost detail: concentric rings, a raised dais and shards hanging in the dome.
  for (let i = 0; i < 3; i++) {
    torus(parts, 0, GROUND + 2.4 + i * 5.2, 148, 13 - i * 3.4, .26, 'crystalGlow', { rx: Math.PI / 2 });
  }
  cyl(parts, 0, GROUND + 1.5, 148, 7.6, 8.4, 1.4, 'gold', solid({ bottom: GROUND, seg: 20 }));
  cyl(parts, 0, GROUND + 2.3, 148, 5.4, 5.8, .3, 'crystal', { seg: 18 });
  for (let i = 0; i < 12; i++) {
    const a = i * TAU / 12, r = 9 + (i % 3) * 3.2;
    const shard = ball(parts, Math.cos(a) * r, GROUND + 10 + (i % 4) * 4, 148 + Math.sin(a) * r, .7 + (i % 3) * .4, 'crystalGlow', { seg: 6 });
    void shard;
  }
  for (let i = 0; i < 10; i++) {
    const a = i * TAU / 10;
    box(parts, Math.cos(a) * 24, GROUND + .9, 148 + Math.sin(a) * 13, 3.4, .16, 1.4, 'goldLight', { ry: -a });
  }

  // Outer floating islands for exploration.
  for (const [x, y, z, r] of [[136, 16, -54, 26], [-140, 24, 66, 22], [118, 30, 96, 18]]) {
    cyl(parts, x, y - 8, z, r, r * 1.2, 16, 'rock', solid({ seg: 14, bottom: y - 16 }));
    cyl(parts, x, y + .2, z, r * .94, r, .6, 'grass', solid({ seg: 14, bottom: y - .2 }));
    tree(parts, x - r * .3, z, 1.2, y + .5, rng);
    tree(parts, x + r * .25, z + r * .2, .9, y + .5, rng);
  }
  for (let i = 0; i < 12; i++) {
    ball(parts, (rng() - .5) * 320, 44 + rng() * 30, -10 + (rng() - .5) * 320, 10 + rng() * 10, 'cloud', { sx: 2.6, sy: .45, seg: 8 });
  }
  return parts;
}

// ---- world: Death Star ------------------------------------------------------
function buildDeathStar() {
  const parts = [];
  const GROUND = 0;

  // Shared interior helpers -------------------------------------------------
  const floor = (x, z, w, d, mat = 'floor') => box(parts, x, GROUND - .3, z, w, .6, d, mat, solid({ bottom: -1 }));
  const wall = (x, z, w, h, d) => {
    box(parts, x, GROUND + h / 2, z, w, h, d, 'metal', solid({ bottom: GROUND }));
    // Ribbed panelling and a light strip so large walls read at a distance.
    for (let i = -w / 2 + 2; i < w / 2; i += 4) {
      box(parts, x + i, GROUND + h / 2, z + d / 2 + .03, .35, h * .8, .06, 'metalDark');
    }
    box(parts, x, GROUND + h * .78, z + d / 2 + .05, w * .9, .18, .05, 'glowBlue');
  };
  // Ceilings are collision volumes so the camera cannot climb over a roof into the void and
  // look down through it; they sit far above any reachable jump.
  const ceiling = (x, y, z, w, d) => {
    box(parts, x, y, z, w, .5, d, 'metalDark', solid({ bottom: y - .25 }));
    for (let i = -w / 2 + 3; i < w / 2; i += 6) box(parts, x + i, y - .35, z, 1.4, .12, d * .8, 'glowBlue');
  };
  const consoleBank = (x, z, w, ry = 0) => {
    box(parts, x, GROUND + .5, z, w, 1, 1.4, 'panel', solid({ bottom: GROUND, ry }));
    box(parts, x, GROUND + 1.15, z, w * .92, .25, 1.2, 'steel', { ry });
    for (let i = -w / 2 + .8; i < w / 2; i += 1.6) {
      box(parts, x + i, GROUND + 1.3, z - .1, .5, .06, .5, 'glowRed');
      ball(parts, x + i + .3, GROUND + 1.34, z, .08, 'glowGreen', { seg: 5 });
    }
  };
  const doorway = (x, z, w = 10, h = 9, ry = 0) => {
    box(parts, x, GROUND + h / 2, z, w, h, 1, 'metalDark', { ry });
    box(parts, x, GROUND + .35, z, w * .8, .7, 1.1, 'glowBlue', { ry });
    for (const side of [-1, 1]) {
      box(parts, x + side * w * .55, GROUND + h / 2, z, 1.2, h + 1, 1.4, 'steel', solid({ bottom: GROUND, ry }));
    }
  };

  // Command Deck -----------------------------------------------------------
  const deckZ = -92;
  floor(0, deckZ, 64, 46, 'floorCommand');
  wall(0, deckZ - 23, 64, 16, 1.2);
  wall(-32, deckZ, 1.2, 16, 46);
  wall(32, deckZ, 1.2, 16, 46);
  wall(-18, deckZ + 23, 28, 16, 1.2);
  wall(18, deckZ + 23, 28, 16, 1.2);
  ceiling(0, 16, deckZ, 64, 46);
  // Viewport with stars.
  box(parts, 0, 8, deckZ - 22.2, 44, 11, .3, 'glass', { transparent: true });
  const starRng = mulberry32(424242);
  for (let i = 0; i < 90; i++) {
    ball(parts, (starRng() - .5) * 42, 3 + starRng() * 10, deckZ - 22.6, .05 + starRng() * .05, 'star', { seg: 4 });
  }
  box(parts, 0, .35, deckZ - 12, 26, .7, 12, 'panel', solid({ bottom: GROUND }));
  box(parts, 0, .75, deckZ - 12, 22, .2, 9, 'glowBlue');
  consoleBank(-22, deckZ - 4, 12);
  consoleBank(22, deckZ - 4, 12);
  consoleBank(0, deckZ + 20, 18);
  for (let x = -28; x <= 28; x += 7) box(parts, x, GROUND + .03, deckZ, .12, .04, 44, 'metalDark');
  for (let z = deckZ - 20; z <= deckZ + 20; z += 7) box(parts, 0, GROUND + .03, z, 60, .04, .12, 'metalDark');
  // Officers' chairs and the command dais.
  for (let i = 0; i < 4; i++) {
    box(parts, -14 + i * 9, GROUND + 1.4, deckZ + 8, 2, 2.8, 2, 'dark', solid({ bottom: GROUND }));
    box(parts, -14 + i * 9, GROUND + 3, deckZ + 8, 2.2, 1.2, .3, 'dark');
  }
  catwalk(parts, 0, 7.2, deckZ - 18, 40, 4, { axis: 'x' });
  stairs(parts, -20, deckZ - 14, { steps: 9, width: 4, rise: .8, run: 1, base: GROUND, mat: 'metal', dir: 'z' });
  for (const [x, z] of [[-9, 3], [9, 3]]) {
    box(parts, x, GROUND + .2, deckZ + z, 5, .4, 3, 'glowRed');
  }

  // Hangar -----------------------------------------------------------------
  const hz = 50;
  floor(0, hz, 104, 78, 'floorHangar');
  wall(0, hz - 39, 104, 22, 1.2);
  wall(-52, hz, 1.2, 22, 78);
  wall(52, hz, 1.2, 22, 78);
  wall(-34, hz + 39, 36, 22, 1.2);
  wall(34, hz + 39, 36, 22, 1.2);
  ceiling(0, 22, hz, 104, 78);
  // Landing markings and a launch trench.
  for (let i = 0; i < 6; i++) box(parts, -34 + i * 14, GROUND + .04, hz - 16, 8, .08, .7, 'glowBlue');
  box(parts, 0, GROUND + .02, hz + 22, 60, .06, 12, 'floorStripe');
  // Panel seams break the very large hangar floor into readable plates.
  for (let x = -48; x <= 48; x += 8) box(parts, x, GROUND + .03, hz, .13, .04, 76, 'metalDark');
  for (let z = hz - 36; z <= hz + 36; z += 8) box(parts, 0, GROUND + .03, z, 100, .04, .13, 'metalDark');
  torus(parts, 0, GROUND + .06, hz - 4, 15, .5, 'glowBlue', { rx: Math.PI / 2 });
  // Catwalks and stacks of crates.
  catwalk(parts, -36, 8, hz - 20, 22, 5);
  catwalk(parts, 36, 8, hz + 20, 22, 5);
  stairs(parts, -46, hz - 8, { steps: 9, width: 5, rise: .8, run: 1.1, base: GROUND, mat: 'metal', dir: 'z' });
  for (let i = 0; i < 8; i++) {
    const x = -20 + (i % 4) * 12, z = hz + 12 + Math.floor(i / 4) * 8;
    box(parts, x, GROUND + 1.4, z, 3.2, 2.8, 3.2, 'crate', solid({ bottom: GROUND }));
    box(parts, x, GROUND + 2.85, z, 3.3, .16, 3.3, 'steel');
  }
  // A docked shuttle silhouette.
  box(parts, 26, GROUND + 3.4, hz - 12, 16, 4.4, 8, 'steel', solid({ bottom: GROUND }));
  cone(parts, 26, GROUND + 3.4, hz - 2, 4.4, 9, 'steel', { rx: Math.PI / 2, seg: 6 });
  for (const side of [-1, 1]) {
    box(parts, 26 + side * 5, GROUND + 2.6, hz - 6, 2.4, .6, 12, 'dark');
    cyl(parts, 26 + side * 5, GROUND + 1.4, hz - 6, .5, .6, 2, 'glowRed', { seg: 6 });
  }
  // TIE racks.
  for (let i = 0; i < 4; i++) {
    const x = -42 + i * 5.5;
    cyl(parts, x, GROUND + 6, hz - 30, .4, .4, 10, 'steel');
    for (const side of [-1, 1]) ball(parts, x + side * 2.4, GROUND + 6.5, hz - 30, 2.2, 'metalDark', { seg: 10 });
  }

  // Connecting corridor network -------------------------------------------
  const cz0 = -70, cz1 = 12;
  floor(0, (cz0 + cz1) / 2, 14, cz1 - cz0, 'floorCorridor');
  wall(-7, (cz0 + cz1) / 2, 1.2, 9, cz1 - cz0);
  wall(7, (cz0 + cz1) / 2, 1.2, 9, cz1 - cz0);
  ceiling(0, 9, (cz0 + cz1) / 2, 14, cz1 - cz0);
  for (let z = cz0 + 6; z < cz1; z += 8) {
    for (const side of [-1, 1]) {
      box(parts, side * 6.2, GROUND + 4.5, z, .5, 9, .7, 'metalDark');
      box(parts, side * 6.15, GROUND + 5.6, z, .3, .16, 6, 'glowRed');
    }
    box(parts, 0, GROUND + 8.6, z, 14, .16, .5, 'glowBlue');
  }
  // Junction chamber between corridor and command deck.
  floor(0, -62, 30, 20, 'floorCommand');
  wall(0, -72, 30, 10, 1.2);
  wall(-15, -62, 1.2, 10, 20);
  wall(15, -62, 1.2, 10, 20);
  ceiling(0, 10, -62, 30, 20);
  doorway(0, -72, 9, 9);
  doorway(0, -52, 9, 9);
  consoleBank(-10, -56, 8);
  for (const [x, z] of [[-6, -66], [6, -66]]) {
    box(parts, x, GROUND + .15, z, 4, .3, 4, 'glowBlue');
  }

  // Hangar detail: blast doors, overhead crane rails, floodlights, a control booth and
  // hazard markings. The bay was a lit floor with crates; these give it an Imperial scale.
  for (const side of [-1, 1]) {
    box(parts, side * 27, GROUND + 10, hz + 38, 44, 20, 1.4, 'metalDark', solid({ bottom: GROUND }));
    for (let i = 0; i < 6; i++) box(parts, side * 27, GROUND + 3 + i * 3.2, hz + 37, 42, .3, .9, 'steel');
    box(parts, side * 27, GROUND + 10, hz + 37.6, 42, .5, .3, 'glowBlue');
  }
  box(parts, 0, GROUND + 19, hz + 38, 10, 3, 1.2, 'panel');
  for (let i = 0; i < 4; i++) box(parts, 0, GROUND + 8 + i * 3.4, hz + 38, 11, .35, 1.6, 'steel');
  for (const x of [-40, -14, 14, 40]) {
    box(parts, x, GROUND + 20.4, hz - 22, 7, .8, 3, 'steel');
    box(parts, x, GROUND + 19.4, hz - 22, 6, .5, 2.4, 'glowBlue');
  }
  for (const side of [-1, 1]) {
    box(parts, side * 3.4, GROUND + 21, hz, 1.2, 1.2, 70, 'steel');
    box(parts, side * 3.4, GROUND + 20.3, hz, 1.8, .5, 70, 'metalDark');
  }
  box(parts, 0, GROUND + 17, hz + 6, 5, 1.4, 5, 'steel');
  box(parts, 0, GROUND + 12.4, hz + 6, .4, 9, .4, 'steel');
  box(parts, 44, GROUND + 12, hz + 34, 12, 8, 7, 'panel', solid({ bottom: GROUND }));
  box(parts, 44, GROUND + 12.6, hz + 30.4, 10.5, 5, .3, 'glass');
  box(parts, 44, GROUND + 14.4, hz + 30.2, 11, .3, .4, 'glowBlue');
  for (let i = 0; i < 7; i++) {
    for (const side of [-1, 1]) {
      box(parts, side * 40, GROUND + .06, hz - 30 + i * 10, 12, .05, 1.1, 'floorStripe', { ry: 0 });
    }
  }
  for (let i = 0; i < 5; i++) {
    const z = hz - 28 + i * 14;
    for (const side of [-1, 1]) {
      cyl(parts, side * 47, GROUND + 5, z, .55, .7, 10, 'metalDark', { seg: 8 });
      box(parts, side * 45.4, GROUND + 6.4, z, .5, 2.6, 1.6, 'glowRed');
    }
  }

  // Reactor core -----------------------------------------------------------
  const rz = -152;
  cyl(parts, 0, GROUND - .3, rz, 34, 36, .6, 'floor', solid({ bottom: -1, seg: 28 }));
  for (let i = 0; i < 16; i++) {
    const a = i * TAU / 16;
    const x = Math.cos(a) * 34, z = rz + Math.sin(a) * 34;
    box(parts, x, GROUND + 11, z, 9, 22, 1.6, 'metal', solid({ bottom: GROUND, ry: -a }));
    box(parts, x * .97, GROUND + 15, z * .97, .3, 2, .3, 'glowRed');
  }
  cyl(parts, 0, GROUND + 8, rz, 6, 7.4, 26, 'metalDark', solid({ bottom: GROUND, seg: 16 }));
  ball(parts, 0, GROUND + 9, rz, 8.5, 'core', { seg: 18 });
  torus(parts, 0, GROUND + 17, rz, 10, .5, 'glowGreen', { rx: Math.PI / 2 });
  catwalk(parts, 0, 9, rz + 25, 40, 4, { axis: 'x' });
  catwalk(parts, 0, 9, rz - 25, 40, 4, { axis: 'x' });
  catwalk(parts, 25, 9, rz, 4, 40, { axis: 'z' });
  catwalk(parts, -25, 9, rz, 4, 40, { axis: 'z' });
  for (let i = 0; i < 8; i++) {
    const a = i * TAU / 8;
    box(parts, Math.cos(a) * 20, GROUND + 4.2, rz + Math.sin(a) * 20, .5, 8, .5, 'steel');
    box(parts, Math.cos(a) * 20, GROUND + 8.6, rz + Math.sin(a) * 20, .5, .4, 4, 'steel', { ry: -a });
  }
  for (const side of [-1, 1]) {
    box(parts, side * 44, GROUND + 6, rz, 8, 12, 26, 'metal', solid({ bottom: GROUND }));
    box(parts, side * 40, GROUND + 8, rz, .4, 6, 18, 'glowGreen');
  }
  // Reactor detail: emitter rings climbing the shaft, feed conduits and hazard plating.
  for (let i = 0; i < 5; i++) {
    torus(parts, 0, GROUND + 3.6 + i * 5.4, rz, 12.4 - i * 1.1, .34, 'steel', { rx: Math.PI / 2 });
    torus(parts, 0, GROUND + 4.6 + i * 5.4, rz, 12.4 - i * 1.1, .16, 'glowGreen', { rx: Math.PI / 2 });
  }
  for (let i = 0; i < 12; i++) {
    const a = i * TAU / 12, r = 27;
    box(parts, Math.cos(a) * r, GROUND + 9, rz + Math.sin(a) * r, 1.1, 18, 1.1, 'steel', { ry: -a });
    box(parts, Math.cos(a) * (r - .7), GROUND + 9, rz + Math.sin(a) * (r - .7), .3, 17, .3, 'glowRed', { ry: -a });
  }
  for (let i = 0; i < 16; i++) {
    const a = i * TAU / 16, r = 31;
    box(parts, Math.cos(a) * r, GROUND + .06, rz + Math.sin(a) * r, 6, .04, 1.2, 'floorStripe', { ry: -a });
  }
  for (const side of [-1, 1]) {
    cyl(parts, side * 20, GROUND + 12, rz - 34, 1.2, 1.2, 24, 'metalDark', { seg: 10 });
    cyl(parts, side * 20, GROUND + 12, rz + 34, 1.2, 1.2, 24, 'metalDark', { seg: 10 });
  }
  box(parts, 0, GROUND + 22, rz, 14, 1.2, 14, 'steel');
  box(parts, 0, GROUND + 21.2, rz, 10, .6, 10, 'glowGreen');

  // Superlaser control -----------------------------------------------------
  const sx = 80, sz = -152;
  cyl(parts, sx, GROUND - .3, sz, 24, 26, .6, 'floorCommand', solid({ bottom: -1, seg: 24 }));
  for (let i = 0; i < 12; i++) {
    const a = i * TAU / 12;
    box(parts, sx + Math.cos(a) * 24, GROUND + 8, sz + Math.sin(a) * 24, 8, 16, 1.4, 'metal', solid({ bottom: GROUND, ry: -a }));
  }
  torus(parts, sx, GROUND + 1, sz, 15, .6, 'glowBlue', { rx: Math.PI / 2 });
  cyl(parts, sx, GROUND + 2.4, sz, 4.4, 5.4, 4.8, 'dark', solid({ bottom: GROUND }));
  ball(parts, sx, GROUND + 5.6, sz, 4, 'glowGreen', { seg: 14 });
  for (let i = 0; i < 6; i++) {
    const a = i * TAU / 6;
    consoleBank(sx + Math.cos(a) * 18, sz + Math.sin(a) * 18, 7, -a);
  }
  catwalk(parts, sx, 7, sz + 18, 30, 4, { axis: 'x' });

  // Escape pod bay: its own floor, a hull viewport and the pods themselves.
  floor(-60, -16, 22, 64, 'floorCorridor');
  box(parts, -71.4, GROUND + 4, -16, .4, 7, 22, 'glass');
  for (let i = 0; i < 70; i++) {
    ball(parts, -71.8, 1 + starRng() * 6, -26 + starRng() * 20, .06 + starRng() * .05, 'star', { seg: 4 });
  }
  for (let z = -44; z <= 12; z += 8) box(parts, -60, GROUND + .03, z, 20, .04, .14, 'metalDark');
  for (let i = 0; i < 3; i++) {
    const z = -40 + i * 26;
    box(parts, -60, GROUND + 3, z, 6, 6, 10, 'metal', solid({ bottom: GROUND }));
    ball(parts, -57, GROUND + 3, z, 2.4, 'dark', { sx: .8, seg: 10 });
    box(parts, -56.6, GROUND + 3, z, .3, 3, 6, 'glowRed');
  }

  // Corridor network -------------------------------------------------------
  // A spine runs north out of the hangar, branches east and west to Engineering and the Droid
  // Factory, and continues past the Trench Run to the Imperial City. The rooms are separate
  // battle stages; the corridors are the walkable seams between them that the exits use.
  const corridor = (x, z, w, d, h = 9) => {
    floor(x, z, w, d, 'floorCorridor');
    wall(x, z - d / 2, w, h, 1.2);
    wall(x, z + d / 2, w, h, 1.2);
    ceiling(x, h, z, w, d);
    for (let i = -w / 2 + 3; i < w / 2; i += 4) box(parts, x + i, GROUND + .06, z, .6, .04, d * .82, 'floorStripe');
  };
  // Hangar -> Trench Run (north spine, x = 0).
  box(parts, 0, GROUND - .3, 95, 16, .6, 16, 'floorCorridor', solid({ bottom: -1 }));
  for (const side of [-1, 1]) box(parts, side * 8, GROUND + 4.5, 95, 1.2, 9, 16, 'metal', solid({ bottom: GROUND }));
  box(parts, 0, GROUND + 9, 95, 17.2, .5, 16, 'metalDark', solid({ bottom: GROUND + 8.75 }));
  for (const side of [-1, 1]) box(parts, side * 7.6, GROUND + .04, 95, .4, .06, 14, 'glowBlue');
  // East / west spur at the T-junction (z = 96) feeding Engineering and the Droid Factory.
  for (const side of [-1, 1]) {
    box(parts, side * 34, GROUND - .3, 96, 52, .6, 14, 'floorCorridor', solid({ bottom: -1 }));
    box(parts, 0, GROUND + 4.5, 89, 60, 9, 1.2, 'metal', solid({ bottom: GROUND }));
    box(parts, 0, GROUND + 4.5, 103, 60, 9, 1.2, 'metal', solid({ bottom: GROUND }));
    box(parts, 0, GROUND + 9, 96, 68.4, .5, 14.6, 'metalDark', solid({ bottom: GROUND + 8.75 }));
    for (let i = 0; i < 9; i++) box(parts, side * (14 + i * 5), GROUND + 8.4, 96, .3, .16, 12, 'glowBlue');
    for (let i = 0; i < 8; i++) box(parts, side * (12 + i * 6), GROUND + .05, 96, .5, .1, 12.6, 'floorStripe');
  }
  // Trench Run -> Imperial City (north spine continues past the trench).
  box(parts, 0, GROUND - .3, 200, 14, .6, 24, 'floorCorridor', solid({ bottom: -1 }));
  for (const side of [-1, 1]) box(parts, side * 7, GROUND + 5, 200, 1.2, 10, 24, 'metal', solid({ bottom: GROUND }));
  box(parts, 0, GROUND + 10, 200, 15.2, .5, 24, 'metalDark', solid({ bottom: GROUND + 9.75 }));
  for (let i = 0; i < 5; i++) box(parts, 0, GROUND + 9.4, 192 + i * 4, 13, .16, .6, 'glowBlue');

  // Trench Run -------------------------------------------------------------
  // A sealed channel running north from the hangar spine: deep walls, buttress frames,
  // turbolaser emplacements and a floor marked with launch lanes.
  const tz0 = 104, tz1 = 188, tzMid = (tz0 + tz1) / 2;
  floor(0, tzMid, 26, tz1 - tz0, 'floorCorridor');
  for (const side of [-1, 1]) {
    box(parts, side * 13.6, GROUND + 13, tzMid, 2.6, 26, tz1 - tz0, 'metal', solid({ bottom: GROUND }));
    for (let z = tz0 + 4; z < tz1; z += 8) {
      box(parts, side * 12.2, GROUND + 13, z, 1.2, 25, 1.6, 'metalDark', solid({ bottom: GROUND }));
      box(parts, side * 11.6, GROUND + 17, z, .3, 6, .8, 'glowRed');
    }
    box(parts, side * 12.1, GROUND + 5, tzMid, .4, .3, tz1 - tz0 - 6, 'glowBlue');
  }
  for (let i = 0; i < 6; i++) {
    const z = tz0 + 8 + i * 14;
    box(parts, 0, GROUND + 21, z, 27, 1.2, 2.2, 'metalDark', solid({ bottom: GROUND + 20.4 }));
    for (const side of [-1, 1]) box(parts, side * 9, GROUND + 19.6, z, 1.6, 1.6, 1.6, 'steel');
  }
  for (let i = 0; i < 6; i++) {
    const z = tz0 + 6 + i * 15;
    for (const side of [-1, 1]) {
      cyl(parts, side * 10.4, GROUND + 8, z, 1.8, 2.2, 3.2, 'dark', solid({ bottom: GROUND + 6.4, seg: 10 }));
      cyl(parts, side * 9.4, GROUND + 8, z, .42, .42, 2.2, 'glowRed', { seg: 8 });
    }
  }
  for (const side of [-1, 1]) box(parts, side * 9.4, GROUND + .05, tzMid, 1.2, .06, tz1 - tz0, 'floorStripe');
  for (let z = tz0 + 10; z < tz1; z += 12) box(parts, 0, GROUND + .05, z, 20, .06, 1.1, 'floorStripe');
  // End caps with a lit doorway at each end so the exits read as doors.
  for (const [z, depth] of [[tz0 - 1.5, 3], [tz1 + 1.5, 3]]) {
    for (const side of [-1, 1]) box(parts, side * 8.5, GROUND + 13, z, 9.6, 26, depth, 'metal', solid({ bottom: GROUND }));
    box(parts, 0, GROUND + 15, z, 16, 8, depth, 'metal', solid({ bottom: GROUND + 11 }));
    box(parts, 0, GROUND + .3, z, 7.4, 6, depth * .6, 'glowBlue');
    for (const side of [-1, 1]) box(parts, side * 4, GROUND + 5, z, 1.4, 10, depth * .5, 'steel', solid({ bottom: GROUND }));
  }

  // Engineering ------------------------------------------------------------
  // Two machine halls at different heights, joined by a stair flight and overhead pipes.
  const ex = 86, ez = 134;
  floor(ex, ez, 56, 46, 'floorCommand');
  wall(ex - 28, ez, 1.4, 22, 46);
  wall(ex + 28, ez, 1.4, 22, 46);
  wall(ex, ez - 23, 56, 22, 1.4);
  wall(ex, ez + 23, 56, 22, 1.4);
  ceiling(ex, 22, ez, 56, 46);
  box(parts, ex, GROUND + 3, ez + 12, 38, 6, 16, 'panel', solid({ bottom: GROUND }));
  stairs(parts, ex - 12, ez + 2, { steps: 7, width: 6, rise: .85, run: 1, base: GROUND, mat: 'metal', dir: 'z' });
  for (let i = 0; i < 6; i++) {
    cyl(parts, ex - 22 + i * 9, GROUND + 12, ez - 14, 1.5, 1.5, 26, 'metalDark', { seg: 10 });
    for (let j = 0; j < 4; j++) torus(parts, ex - 22 + i * 9, GROUND + 4 + j * 5, ez - 14, 1.9, .3, 'steel', { rx: Math.PI / 2 });
  }
  for (let i = 0; i < 4; i++) {
    const z = ez - 16 + i * 10;
    box(parts, ex + 20, GROUND + 4, z, 8, 8, 6, 'metal', solid({ bottom: GROUND }));
    box(parts, ex + 20, GROUND + 6, z, 5, 3, .3, 'glowGreen');
  }
  for (const side of [-1, 1]) catwalk(parts, ex + side * 22, 9, ez - 4, 5, 30, { axis: 'z' });
  for (let i = 0; i < 14; i++) box(parts, ex - 24 + i * 3.6, GROUND + .05, ez + 2, .5, .1, 40, 'floorStripe');

  // Droid Factory -----------------------------------------------------------
  // Conveyor lanes, assembly frames and hanging arms.
  const fx = -88, fz = 130;
  floor(fx, fz, 52, 46, 'floorCorridor');
  wall(fx - 26, fz, 1.4, 20, 46);
  wall(fx + 26, fz, 1.4, 20, 46);
  wall(fx, fz - 23, 52, 20, 1.4);
  wall(fx, fz + 23, 52, 20, 1.4);
  ceiling(fx, 20, fz, 52, 46);
  for (const lane of [-19, -11, 11, 19]) {
    box(parts, fx, GROUND + 1.5, fz + lane, 46, .5, 4.4, 'metalDark', solid({ bottom: GROUND + 1.2 }));
    for (let i = 0; i < 22; i++) cyl(parts, fx - 22 + i * 2.1, GROUND + 1.8, fz + lane, .28, .28, 4.2, 'steel', { rx: Math.PI / 2, seg: 8 });
    for (let i = 0; i < 5; i++) box(parts, fx - 16 + i * 8, GROUND + 2.4, fz + lane, 1.6, 1.6, 1.6, 'metal');
  }
  for (let i = 0; i < 5; i++) {
    box(parts, fx - 18 + i * 9, GROUND + 7, fz - 16, .7, 11, .7, 'steel', solid({ bottom: GROUND }));
    box(parts, fx - 18 + i * 9, GROUND + 12.4, fz - 16, 5.4, .6, .6, 'steel');
    box(parts, fx - 18 + i * 9, GROUND + 11.6, fz - 12, .5, 1.4, .5, 'steel');
    box(parts, fx - 18 + i * 9, GROUND + 10.6, fz - 12, .6, .8, .6, 'glowRed');
  }
  for (let i = 0; i < 8; i++) {
    box(parts, fx - 20 + i * 5.6, GROUND + 14, fz + 18, 3.4, .4, 3.4, 'metalDark');
    box(parts, fx - 20 + i * 5.6, GROUND + 13.4, fz + 18, .5, 1.2, .5, 'steel');
  }
  for (let i = 0; i < 16; i++) box(parts, fx - 24 + i * 3.2, GROUND + .05, fz - 20.6, 2.2, .06, .5, 'floorStripe');

  // Imperial City (Habitat) --------------------------------------------------
  // A lit street between habitation blocks, with a raised gallery and a transit spine.
  const ix = 0, iz = 236;
  floor(ix, iz, 76, 52, 'floorCommand');
  for (const side of [-1, 1]) {
    wall(ix + side * 39, iz, 1.4, 34, 52);
    for (let i = 0; i < 6; i++) {
      building(parts, ix + side * 30, iz - 20 + i * 8, { w: 12, d: 7, h: 10 + (i % 3) * 5, base: GROUND, mat: 'panel', roof: 'metalDark', win: 'glassWarm', winRows: 3 });
      box(parts, ix + side * 22, GROUND + 2.4, iz - 20 + i * 8, 4, .3, 6, 'glowBlue');
    }
    for (let i = 0; i < 8; i++) {
      cyl(parts, ix + side * 20, GROUND + 3, iz - 22 + i * 6.4, .2, .3, 6, 'steel', { seg: 6 });
      ball(parts, ix + side * 20, GROUND + 6.2, iz - 22 + i * 6.4, .34, 'glowWarm', { seg: 6 });
    }
  }
  ceiling(ix, 34, iz, 78, 52);
  for (const end of [-1, 1]) {
    box(parts, ix, GROUND + 17, iz + end * 25.2, 78, 34, 1.6, 'metal', solid({ bottom: GROUND }));
    for (let i = 0; i < 7; i++) box(parts, ix - 30 + i * 10, GROUND + 8, iz + end * 24.2, 8, 12, .4, 'metalDark');
    box(parts, ix, GROUND + 2.5, iz + end * 24.4, 12, 5, .5, 'glowBlue');
  }
  box(parts, ix, GROUND + 1.8, iz, 14, 3.6, 44, 'metal', solid({ bottom: GROUND }));
  for (let i = 0; i < 9; i++) {
    box(parts, ix, GROUND + 3.7, iz - 20 + i * 5, 15, .4, .5, 'glowBlue');
    for (const side of [-1, 1]) box(parts, ix + side * 7.4, GROUND + .9, iz - 20 + i * 5, .3, 1.8, .3, 'steel');
  }
  for (let i = 0; i < 10; i++) box(parts, ix - 30 + i * 6.6, GROUND + .05, iz - 24, 3.6, .08, 46, 'floorStripe');

  // Outer Hull ---------------------------------------------------------------
  // Station plating in vacuum: gantries, hull plates and a rail along the drop.
  const ox = -120, oz = 225;
  floor(ox, oz, 58, 48, 'metal');
  for (let i = 0; i < 12; i++) {
    box(parts, ox - 27 + i * 4.9, GROUND + .05, oz - 22, .4, .06, 44, 'metalDark');
    box(parts, ox - 25 + i * 4.9, GROUND + .05, oz + 22, .4, .06, 44, 'metalDark');
  }
  for (let i = 0; i < 6; i++) {
    cyl(parts, ox - 6 + i * 2.4, GROUND + 2, oz + 12, .5, .6, 4, 'steel', { seg: 8 });
    ball(parts, ox - 6 + i * 2.4, GROUND + 4.4, oz + 12, .6, 'glowRed', { seg: 8 });
  }
  for (let i = 0; i < 4; i++) {
    box(parts, ox - 20 + i * 13, GROUND + 3, oz - 18, 8, 6, 8, 'metal', solid({ bottom: GROUND }));
    box(parts, ox - 20 + i * 13, GROUND + 6.2, oz - 18, 5, .4, 5, 'steel');
  }
  catwalk(parts, ox + 16, 7, oz + 2, 18, 5, { axis: 'x' });
  stairs(parts, ox + 10, oz - 6, { steps: 8, width: 4, rise: .9, run: 1, base: GROUND, mat: 'steel', dir: 'z' });
  for (const side of [-1, 1]) railing(parts, ox + side * 28.4, GROUND, oz, 46, 'z');
  for (let i = 0; i < 90; i++) ball(parts, ox + (starRng() - .5) * 240, 8 + starRng() * 60, oz + (starRng() - .5) * 240, .16 + starRng() * .22, 'star', { seg: 4 });
  ball(parts, ox + 70, 18, oz - 40, 16, 'metalDark', { seg: 20, sx: 1.4, sy: .9 });
  // Hull walkway across to the habitat blocks.
  box(parts, -62, GROUND - .3, 225, 58, .6, 10, 'metal', solid({ bottom: -1 }));
  for (const side of [-1, 1]) railing(parts, -62, GROUND, 225 + side * 4.6, 56, 'x', 'steel');
  for (let i = 0; i < 5; i++) box(parts, -84 + i * 11, GROUND + .05, 225, .5, .06, 9, 'glowBlue');
  return parts;
}

// ---- world: Hogwarts -------------------------------------------------------
function buildHogwarts() {
  const parts = [];
  const rng = mulberry32(31415);
  const GROUND = 0.3;

  // Grounds: plateau over the loch, with a lake to the north.
  cyl(parts, 0, -8.5, 0, 156, 172, 17, 'rock', solid({ seg: 34, bottom: -22 }));
  cyl(parts, 0, -.1, 0, 150, 154, .8, 'grass', solid({ seg: 34, bottom: -.6 }));
  // The lake sits just above the grass so it reads as water instead of disappearing under
  // the plateau, and it is kept north of Hogsmeade and the pitch.
  plane(parts, 0, GROUND + .06, 150, 220, 110, 'water');
  for (let i = 0; i < 16; i++) {
    const a = Math.PI * (.06 + i * .055);
    rock(parts, Math.cos(a) * 148, 40 + Math.sin(a) * 120, 3 + rng() * 4, GROUND - 1, rng, 'cliff');
  }

  // Castle: curtain walls, keep, towers, Great Hall range.
  // Castle shell: curtain walls rather than one solid block, so the interior rooms are
  // actually enterable and nothing collides with the Great Hall inside.
  const cz = -108;
  box(parts, 0, GROUND + 11, cz - 42, 132, 22, 3, 'stone', solid({ bottom: GROUND }));
  box(parts, -66, GROUND + 11, cz, 3, 22, 84, 'stone', solid({ bottom: GROUND }));
  box(parts, 66, GROUND + 11, cz, 3, 22, 84, 'stone', solid({ bottom: GROUND }));
  for (const side of [-1, 1]) {
    box(parts, side * 45, GROUND + 11, cz + 42, 42, 22, 3, 'stone', solid({ bottom: GROUND }));
  }
  box(parts, 0, GROUND + 16, cz + 42, 24, 6, 3, 'stoneDark');
  // Battlements, buttresses and tall window rows. The curtain walls were smooth slabs; the
  // crenellations and piers give the castle the jagged skyline of the reference.
  for (let x = -64; x <= 64; x += 4) box(parts, x, GROUND + 22.8, cz - 42, 2.1, 1.7, 3.5, 'stoneDark');
  for (const side of [-1, 1]) {
    for (let z = cz - 38; z <= cz + 38; z += 7) box(parts, side * 66, GROUND + 22.8, z, 3.5, 1.7, 2.6, 'stoneDark');
    for (let z = cz - 34; z <= cz + 34; z += 11) box(parts, side * 68, GROUND + 9, z, 1.4, 17, 3.2, 'stoneDark');
    for (let z = cz - 30; z <= cz + 30; z += 11) {
      box(parts, side * 65.9, GROUND + 13.5, z, .3, 4.2, 1.8, 'glassWarm');
      box(parts, side * 65.7, GROUND + 15.9, z, .4, .4, 2.4, 'stoneLight');
    }
    for (let i = 0; i < 5; i++) {
      tower(parts, side * (44 + (i % 2) * 8), cz - 44 + i * 20, { r: 3.4, h: 22 + (i % 3) * 5, base: GROUND, mat: 'stone', roof: 'roofCastle' });
    }
  }
  for (let i = 0; i < 7; i++) {
    const x = -54 + i * 18;
    // Skip the middle of the south range: that is the gate between the Great Hall and the courtyard.
    if (Math.abs(x) < 24) continue;
    tower(parts, x, cz + 40, { r: 6.5, h: 30 + (i % 3) * 8, base: GROUND, mat: 'stone', roof: 'roofCastle', win: 'glassWarm' });
  }
  for (let i = 0; i < 4; i++) {
    tower(parts, -60 + i * 40, cz - 40, { r: 7.5, h: 34 + (i % 2) * 10, base: GROUND, mat: 'stone', roof: 'roofCastle' });
  }
  // Central keep sits north of the hall, and the clock tower stands beside the courtyard.
  box(parts, 0, GROUND + 22, cz - 36, 40, 44, 18, 'stone', solid({ bottom: GROUND }));
  cone(parts, 0, GROUND + 48, cz - 36, 22, 16, 'roofCastle', { seg: 4, ry: Math.PI / 4 });
  // Keep detail: corner turrets, gable dormers, a lit window band and chimneys.
  for (const side of [-1, 1]) {
    for (const zs of [-1, 1]) {
      tower(parts, side * 20, cz - 36 + zs * 9, { r: 3.2, h: 46, base: GROUND, mat: 'stone', roof: 'roofCastle' });
    }
    box(parts, side * 10, GROUND + 44, cz - 45, 9, 5, 3.4, 'roofHall');
    box(parts, side * 10, GROUND + 41.4, cz - 46.6, 5.4, 3.2, .2, 'glassWarm');
    cyl(parts, side * 15, GROUND + 47, cz - 30, 1.1, 1.3, 7, 'brick', { seg: 8 });
  }
  for (let row = 0; row < 3; row++) {
    for (let i = -3; i <= 3; i++) box(parts, i * 5, GROUND + 14 + row * 6.5, cz - 26.8, 1.4, 3.4, .18, 'glassWarm');
  }
  cyl(parts, -46, GROUND + 40, cz + 52, 7, 8, 64, 'stone', solid({ bottom: GROUND, seg: 10 }));
  cone(parts, -46, GROUND + 76, cz + 52, 9.5, 12, 'roofCastle', { seg: 10 });
  ball(parts, -46, GROUND + 61, cz + 52, 4.6, 'clock');
  for (let i = 0; i < 18; i++) {
    const x = -58 + (i % 9) * 14.5, y = GROUND + 8 + Math.floor(i / 9) * 12;
    if (Math.abs(x) < 26) continue;
    box(parts, x, y, cz + 40.6, 1.1, 3.2, .12, 'glassWarm');
  }
  // Viaduct from the courtyard out over the ravine.
  box(parts, 0, GROUND + .55, 4, 12, .8, 64, 'stone', solid({ bottom: GROUND - 6 }));
  for (let i = 0; i < 6; i++) {
    const z = -20 + i * 10;
    for (const side of [-1, 1]) railing(parts, side * 5.4, GROUND + .95, z, 10, 'z', 'stoneDark');
    box(parts, 0, GROUND + .1, z, 14, 1.2, 2.4, 'stoneDark');
  }
  for (let i = 0; i < 5; i++) {
    const z = -14 + i * 12;
    box(parts, 0, GROUND - 4, z, 3, 10, 2.4, 'stoneDark');
    // Arches springing between the piers, and lamps along the parapet.
    for (const side of [-1, 1]) {
      torus(parts, side * 3.6, GROUND - 1.4, z + 6, 1.5, .3, 'stoneLight', { ry: Math.PI / 2 });
      cyl(parts, side * 5.8, GROUND + 1.9, z + 6, .2, .3, 2, 'dark', { seg: 6 });
      ball(parts, side * 5.8, GROUND + 3.1, z + 6, .26, 'flame', { seg: 6 });
    }
  }

  // Courtyard between castle and viaduct.
  box(parts, 0, GROUND + .06, -52, 54, .12, 26, 'cobble');
  cyl(parts, -14, GROUND + .6, -52, 4.4, 5, .9, 'stoneLight', solid({ bottom: GROUND, seg: 18 }));
  cyl(parts, -14, GROUND + 1.15, -52, 3.6, 3.6, .22, 'water');
  ball(parts, -14, GROUND + 2.2, -52, 1.1, 'stoneLight');
  for (let i = 0; i < 6; i++) {
    const x = -24 + i * 9.6;
    box(parts, x, GROUND + 1.1, -38, 2.2, 2.2, 2.2, 'stoneLight', solid({ bottom: GROUND }));
    ball(parts, x, GROUND + 2.5, -38, .8, 'crystal');
  }
  // Courtyard arcade on the west side, plus the greenhouse against the east range.
  for (let i = 0; i < 6; i++) {
    cyl(parts, -30, GROUND + 2.6, -62 + i * 6, .55, .7, 5.2, 'stoneLight', solid({ bottom: GROUND, seg: 8 }));
    torus(parts, -30, GROUND + 5.2, -62 + i * 6, 2.2, .22, 'stoneLight', { ry: Math.PI / 2 });
  }
  box(parts, -30, GROUND + 5.8, -47, 4, .6, 44, 'stoneDark');
  for (const [x, z, w, d] of [[34, -46, 16, 12], [34, -58, 12, 10]]) {
    box(parts, x, GROUND + 1.8, z, w, 3.6, d, 'glassCool', { transparent: true });
    box(parts, x, GROUND + .25, z, w, .5, d, 'stone', solid({ bottom: GROUND }));
    box(parts, x, GROUND + 3.7, z, w + 1, .4, d + 1, 'stoneDark');
    for (let i = -1; i <= 1; i++) box(parts, x + i * w * .3, GROUND + 2, z, .2, 3.2, d, 'stoneLight');
    for (let i = 0; i < 3; i++) box(parts, x - w * .3 + i * w * .3, GROUND + .6, z + d * .3, w * .24, .5, 2.4, 'leaf');
  }

  // Great Hall interior (its own roof and walls, entered from the courtyard side).
  const hallZ = -100, floorY = GROUND + .22;
  box(parts, 0, floorY - .2, hallZ, 42, .5, 72, 'floorHall', solid({ bottom: GROUND }));
  for (const side of [-1, 1]) {
    box(parts, side * 21, GROUND + 9, hallZ, 1.6, 18, 72, 'stoneDark', solid({ bottom: GROUND }));
    for (let i = 0; i < 7; i++) {
      const z = hallZ - 30 + i * 10;
      box(parts, side * 19.8, GROUND + 9, z, .4, 16, 4, 'glassCool');
      box(parts, side * 20.6, GROUND + 9, z, .9, 18, 1.1, 'stone');
    }
  }
  box(parts, 0, GROUND + 9, hallZ - 36, 42, 18, 1.8, 'stoneDark', solid({ bottom: GROUND }));
  box(parts, 0, GROUND + 18.4, hallZ, 44, .6, 74, 'roofHall', solid({ bottom: GROUND + 18.1 }));
  box(parts, 0, GROUND + 17.6, hallZ, 36, .5, 68, 'ceiling', solid({ bottom: GROUND + 17.35 }));
  // Ribbed vault and clerestory: the hall had a flat ceiling slab, so the room read as a
  // warehouse rather than the Great Hall.
  for (let i = 0; i < 9; i++) {
    const z = hallZ - 34 + i * 8.5;
    box(parts, 0, GROUND + 16.6, z, 38, .7, 1.1, 'stoneDark');
    for (const side of [-1, 1]) {
      box(parts, side * 17.5, GROUND + 15.4, z, .9, 2.6, 1.1, 'stone');
      // Curved ribs read as hanging pipes from inside the hall, so the vault is carried by
      // the cross beams and the clerestory instead.
      box(parts, side * 9, GROUND + 16.2, z, .45, .45, 1.6, 'stoneDark');
    }
  }
  for (let i = 0; i < 8; i++) {
    for (const side of [-1, 1]) {
      box(parts, side * 20.4, GROUND + 13.4, hallZ - 30 + i * 8.6, .3, 5.4, 4.6, 'glassCool');
      box(parts, side * 20.2, GROUND + 16.2, hallZ - 30 + i * 8.6, .4, .4, 5.2, 'stoneLight');
    }
  }
  // Four long house tables and benches (solid enough to jump onto).
  for (const x of [-12, -4, 4, 12]) {
    box(parts, x, floorY + 1.05, hallZ, 3.1, .5, 58, 'wood', solid({ bottom: floorY }));
    box(parts, x, floorY + 1.36, hallZ, 3.5, .14, 58.4, 'wood');
    box(parts, x, floorY + 1.44, hallZ, 1.1, .05, 58.2, 'gold');
    for (const side of [-1, 1]) box(parts, x + side * 2.6, floorY + .45, hallZ, .9, .8, 56, 'wood', solid({ bottom: floorY }));
    for (let z = hallZ - 26; z <= hallZ + 26; z += 7) {
      for (const side of [-1, 1]) cyl(parts, x + side * .7, floorY + 1.46, z, .16, .16, .05, 'gold', { seg: 10 });
    }
  }
  // Teacher's dais, floating candles and house banners.
  box(parts, 0, floorY + .35, hallZ - 30, 32, .7, 7, 'stone', solid({ bottom: floorY }));
  for (let i = 0; i < 6; i++) {
    box(parts, -12 + i * 5, floorY + 1.4, hallZ - 32, 2.6, .7, 2, 'wood');
    box(parts, -12 + i * 5, floorY + 2.6, hallZ - 33, 1.4, 2.4, .3, 'gold');
  }
  for (let i = 0; i < 40; i++) {
    const x = (rng() - .5) * 30, z = hallZ - 30 + rng() * 58, y = GROUND + 12 + rng() * 4;
    cyl(parts, x, y, z, .05, .06, .6, 'gold', { seg: 6 });
    ball(parts, x, y + .38, z, .12, 'flame', { seg: 6 });
  }
  for (let i = 0; i < 4; i++) {
    const x = -15 + i * 10;
    box(parts, x, GROUND + 12, hallZ - 18 + (i % 2) * 22, 3.2, 8, .16, ['bannerRed', 'bannerBlue', 'bannerGold', 'bannerGreen'][i]);
  }

  // Hagrid's Hut.
  cyl(parts, -96, GROUND + 1.6, 6, 6, 6.4, 4.4, 'brick', solid({ bottom: GROUND, seg: 14 }));
  cone(parts, -96, GROUND + 6.4, 6, 7.8, 4.6, 'thatch', { seg: 14 });
  box(parts, -96, GROUND + 1.4, 12.6, 1.6, 2.6, .3, 'wood');
  for (let i = 0; i < 4; i++) rock(parts, -88 + i * 4, 14, .7, GROUND, rng);
  // Pumpkin patch and a fence around Hagrid's garden.
  for (let i = 0; i < 9; i++) {
    const x = -108 + (i % 3) * 5.4, z = 16 + Math.floor(i / 3) * 5;
    ball(parts, x, GROUND + .5, z, .55 + (i % 3) * .12, 'flame', { sy: .8, seg: 8 });
    cyl(parts, x, GROUND + .9, z, .06, .09, .6, 'trunk', { seg: 5 });
  }
  for (let i = 0; i < 10; i++) {
    box(parts, -110 + i * 3.2, GROUND + .7, 28, .16, 1.4, .16, 'wood');
  }
  box(parts, -110, GROUND + 1.3, 28, 30, .12, .12, 'wood');

  // Hogsmeade: pitched cottages, a street and lanterns.
  for (let i = 0; i < 7; i++) {
    const x = -104 + (i % 3) * 16, z = 42 + Math.floor(i / 3) * 22;
    box(parts, x, GROUND + 3.2, z, 10, 6.4, 9, i % 2 ? 'brick' : 'stone', solid({ bottom: GROUND }));
    box(parts, x, GROUND + 7.1, z, 11.6, 1.6, 10.4, 'roofCastle');
    cone(parts, x, GROUND + 8.4, z, 7.4, 3.4, 'roofCastle', { seg: 4, ry: Math.PI / 4 });
    for (const side of [-1, 1]) box(parts, x + side * 2.4, GROUND + 3.4, z + 4.6, 1.1, 1.5, .1, 'glassWarm');
    box(parts, x, GROUND + 1.4, z + 4.6, 1.4, 2.6, .12, 'wood');
    cyl(parts, x + 6.4, GROUND + 2.2, z + 5, .14, .18, 4.4, 'dark', { seg: 6 });
    ball(parts, x + 6.4, GROUND + 4.5, z + 5, .34, 'flame', { seg: 8 });
  }
  box(parts, -86, GROUND + .03, 60, 12, .06, 64, 'cobble');

  // Quidditch pitch.
  const qx = 98, qz = 26;
  cyl(parts, qx, GROUND + .05, qz, 44, 46, .3, 'pitch', solid({ seg: 28, bottom: GROUND - .2 }));
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      cyl(parts, qx + side * 40, GROUND + 8 + i * 1.8, qz, .5, .5, 16 + i * 3, 'gold', { seg: 8 });
      torus(parts, qx + side * 40, GROUND + 17 + i * 1.8, qz, 4.2, .35, 'gold', { ry: 0 });
    }
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      box(parts, qx + side * (48 + i * 2), GROUND + 1.6, qz - 30 + i * 15, 4, 3, 12, 'wood');
    }
  }
  // Spectator stands: three stepped tiers on each long side, with a barrier fence.
  for (const side of [-1, 1]) {
    for (let tier = 0; tier < 3; tier++) {
      const z = qz + side * (44 + tier * 4);
      box(parts, qx, GROUND + .5 + tier * 1.1, z, 86, 1.1, 4, tier % 2 ? 'wood' : 'stoneDark', solid({ bottom: GROUND }));
      for (let i = -40; i <= 40; i += 2.6) {
        box(parts, qx + i, GROUND + 1.5 + tier * 1.1, z, .3, .7, .3, ['bannerRed', 'bannerGold', 'bannerBlue', 'bannerGreen'][(Math.round(i) + tier) % 4 < 0 ? 0 : (Math.abs(Math.round(i)) + tier) % 4]);
      }
    }
    for (let i = 0; i < 5; i++) {
      cyl(parts, qx - 36 + i * 18, GROUND + 4.4, qz + side * 47, .3, .4, 6, 'gold', { seg: 6 });
      ball(parts, qx - 36 + i * 18, GROUND + 7.6, qz + side * 47, .4, 'flame', { seg: 6 });
    }
  }
  // Boathouse and dock on the lake.
  box(parts, 62, GROUND + 2, 96, 16, 4, 12, 'stone', solid({ bottom: GROUND }));
  box(parts, 62, GROUND + 5.2, 96, 18, 1.4, 14, 'roofCastle');
  box(parts, 62, GROUND + .1, 108, 20, .4, 18, 'wood', solid({ bottom: GROUND }));
  for (let i = 0; i < 5; i++) {
    for (const side of [-1, 1]) box(parts, 62 + side * 4.6, GROUND + .8, 100 + i * 4, .3, 1.4, .3, 'wood');
  }

  // Forbidden Forest edge.
  for (let i = 0; i < 46; i++) {
    const x = -120 + rng() * 110, z = -70 + rng() * 70;
    if (Math.hypot(x, z + 108) < 80) continue;
    tree(parts, x, z, 1.1 + rng() * .9, GROUND, rng);
  }
  for (let i = 0; i < 9; i++) rock(parts, -70 + rng() * 50, -30 + rng() * 50, 1 + rng() * 1.4, GROUND, rng, 'moss');

  // Lake shore rocks and a few trees on the grounds.
  for (let i = 0; i < 12; i++) {
    const x = -140 + i * 26;
    rock(parts, x, 34, 1.6 + rng() * 1.6, GROUND, rng, 'moss');
  }
  for (let i = 0; i < 10; i++) tree(parts, -40 + rng() * 90, 10 + rng() * 20, .8 + rng(), GROUND, rng);

  // Dungeons ---------------------------------------------------------------
  // A tall undercroft inside the castle's west range: cells, columns, a water channel and a
  // stair up to the courtyard. It is an interior room at ground level, clear of the curtain
  // wall towers, not a pit under the terrain (a sunken stage put the camera outside the world).
  const dgx = -38, dgz = -94, dgy = GROUND;
  box(parts, dgx, dgy - .3, dgz, 26, .6, 31, 'cobble', solid({ bottom: dgy - .6 }));
  for (const [x, z, w, d] of [[dgx - 12, dgz, 1.6, 28], [dgx + 12, dgz, 1.6, 28], [dgx, dgz - 14, 25.6, 1.6], [dgx, dgz + 14, 25.6, 1.6]]) {
    box(parts, x, dgy + 6.5, z, w, 13, d, 'brick', solid({ bottom: dgy }));
  }
  box(parts, dgx, dgy + 13.4, dgz, 26, .8, 30, 'brick', solid({ bottom: dgy + 13 }));
  for (let i = 0; i < 3; i++) {
    for (const side of [-1, 1]) {
      cyl(parts, dgx + side * 7, dgy + 5, dgz - 9 + i * 9, 1, 1.25, 10, 'stoneDark', solid({ bottom: dgy, seg: 10 }));
      box(parts, dgx + side * 7, dgy + 10.4, dgz - 9 + i * 9, 3, .7, 3, 'stoneDark');
      box(parts, dgx + side * 7, dgy + .2, dgz - 9 + i * 9, 2.8, .4, 2.8, 'stoneDark');
    }
  }
  // Cell row with iron bars along the north wall.
  for (let i = 0; i < 4; i++) {
    const x = dgx - 9 + i * 6;
    box(parts, x, dgy + 2.6, dgz - 12.4, 5, 5.2, 1.6, 'brick', solid({ bottom: dgy }));
    for (let b = 0; b < 5; b++) box(parts, x - 1.9 + b * .95, dgy + 2.4, dgz - 11.5, .18, 4.4, .18, 'dark');
    box(parts, x, dgy + 5.4, dgz - 11.4, 5.6, .3, .3, 'dark');
  }
  // Torches, barrels and a channel of water down the middle.
  for (const [x, z] of [[dgx - 10, dgz - 8], [dgx + 10, dgz - 8], [dgx - 10, dgz + 7], [dgx + 10, dgz + 7], [dgx, dgz - 11]]) {
    cyl(parts, x, dgy + 3.4, z, .16, .22, 1.2, 'wood', { seg: 6 });
    ball(parts, x, dgy + 4.2, z, .28, 'flame', { seg: 6 });
  }
  for (let i = 0; i < 5; i++) cyl(parts, dgx - 9 + i * 1.6, dgy + .55, dgz + 9, .55, .5, 1.1, 'trunk', { seg: 8 });
  box(parts, dgx, dgy + .06, dgz + 3, 18, .12, 3, 'water');
  railing(parts, dgx, dgy, dgz + 1.5, 18, 'x', 'dark');
  railing(parts, dgx, dgy, dgz + 4.5, 18, 'x', 'dark');
  // Stair shaft up towards the courtyard gate.
  stairs(parts, dgx + 9, dgz + 8, { steps: 10, width: 5, rise: .62, run: .9, base: dgy, mat: 'stoneDark', dir: 'z' });
  box(parts, dgx, dgy + 13, dgz, 1.2, .3, 1.2, 'gold');
  return parts;
}

// ---- world: Konoha (Hidden Leaf Village) ------------------------------------
// North is -Z. Hokage Rock closes the valley, the village steps south from it, the gates open
// onto the Land of Fire and the Forest of Death lies beyond them. Everything here is one
// village: a battle location is a rectangle inside it, so moving between districts rebuilds
// nothing and the districts stay physically where the map says they are.
function buildKonoha() {
  const rng = mulberry32(20261025);
  const parts = [];
  const GROUND = 0.6;

  /** Tiled Japanese roof: wide eave, a pyramid of tiles above it, gold ridge finial. */
  function house(x, z, { w = 10, d = 8, h = 5, base = GROUND, mat = 'building', roof = 'roof', door = true } = {}) {
    box(parts, x, base + h / 2, z, w, h, d, mat, solid({ bottom: base }));
    box(parts, x, base + h + .18, z, w + 1.8, .36, d + 1.8, roof);
    cone(parts, x, base + h + 2.1, z, Math.min(w, d) * .95, 3.1, roof, { seg: 4, ry: Math.PI / 4 });
    box(parts, x, base + h + 3.8, z, Math.min(w, d) * .28, .3, .3, 'gold');
    if (door) {
      box(parts, x, base + 1.1, z + d / 2 + .05, 1.6, 2.2, .08, 'wood');
      for (const dx of [-w * .3, w * .3]) box(parts, x + dx, base + Math.max(2.2, h - .7), z + d / 2 + .05, 1.7, 1.2, .08, 'glassWarm');
    }
  }
  function lantern(x, y, z) {
    cyl(parts, x, y + .7, z, .1, .13, 1.4, 'wood', { seg: 6 });
    ball(parts, x, y + 1.62, z, .32, 'glassWarm', { seg: 8 });
  }
  function parkTree(x, z, scale, base = GROUND) { tree(parts, x, z, scale, base, rng); }
  /**
   * Forest-of-Death giant: a 26-40 m trunk whose crown starts about 18 m up, above the
   * overhead camera. The old 5-8 m conifers put their canopy exactly at camera height, so the
   * fight was either hidden behind leaves or (after clearing them) played on bare lawn.
   */
  function giantTree(x, z, scale = 1, base = GROUND) {
    const h = (26 + rng() * 12) * scale;
    cyl(parts, x, base + h * .3, z, 1.05 * scale, 1.7 * scale, h * .6, 'trunk', solid({ bottom: base, seg: 7 }));
    for (let i = 0; i < 3; i++) {
      cone(parts, x, base + h * .6 + i * h * .12, z, (7.6 - i * 1.9) * scale, h * .24, 'leaf', { seg: 9 });
    }
    // Buttress roots where the trunk meets the floor, and moss on the north side.
    for (let i = 0; i < 4; i++) {
      const a = i * TAU / 4 + .55;
      box(parts, x + Math.cos(a) * 2.3 * scale, base + .8 * scale, z + Math.sin(a) * 2.3 * scale,
        2.6 * scale, 1.6 * scale, 2.6 * scale, 'trunk', solid({ bottom: base }));
    }
    ball(parts, x, base + h * .34, z, 1.4 * scale, 'moss', { sx: 1.4, sy: .6, sz: 1.4, seg: 7 });
  }

  // ---- valley, plateau and horizon -----------------------------------------
  plane(parts, 0, -9, -20, 1100, 980, 'grassDark');
  for (let i = 0; i < 26; i++) {
    const a = i * TAU / 26 + .21;
    const r = 300 + rng() * 96;
    const h = 46 + rng() * 58;
    cone(parts, Math.cos(a) * r, -8 + h / 2, Math.sin(a) * r - 10, 42 + rng() * 28, h, i % 3 ? 'mountain' : 'cliff', { seg: 6 });
  }
  // One walkable plateau under every district, long enough to carry the Forest of Death: the
  // old 336 m slab stopped ten metres short of the forest's south edge, so its last trees and
  // the far end of its floor sat over the valley drop.
  box(parts, 0, -1.6, 41, 384, 4.4, 358, 'grass', solid({ bottom: -9 }));
  for (const [x, z, w, d] of [[0, -142, 384, 18], [-198, 41, 18, 358], [198, 41, 18, 358], [0, 226, 384, 18]]) {
    box(parts, x, -6, z, w, 14, d, 'cliff');
  }

  // ---- Hokage Rock ---------------------------------------------------------
  // Three stacked cliff masses. The summit terrace is the front shelf at y = 24, which is a
  // playable vantage point over the whole village.
  box(parts, 0, 12.3, -132, 210, 23.4, 56, 'cliff', solid({ bottom: GROUND }));
  box(parts, 0, 31, -150, 188, 14, 30, 'cliff', solid({ bottom: 24 }));
  box(parts, 0, 42.5, -158, 118, 9, 16, 'cliff', solid({ bottom: 38 }));
  // Rock striations and vegetation ledges so the face is not a flat wall.
  for (let i = 0; i < 9; i++) {
    const y = 2.5 + i * 2.3;
    box(parts, -74 + (i % 3) * 46, y, -105.4, 34 + (i % 4) * 9, .5, 1.6, 'rock');
  }
  // Vegetation hugs the ridge at the back of the terrace, clear of the fighting shelf.
  for (let i = 0; i < 13; i++) {
    const x = -96 + i * 16;
    ball(parts, x, 24.5, -134.4 + (i % 3) * 1.6, 1.15, 'moss', { sx: 1.5, sy: .55, sz: 1.3, seg: 7 });
  }
  // The four carved Hokage faces on the south face of the cliff.
  const FACE_Z = -103.5;
  for (const fx of [-45, -15, 15, 45]) {
    box(parts, fx, 14.6, FACE_Z, 22, 15, 1.4, 'stoneLight');
    box(parts, fx, 16.6, FACE_Z + .95, 13.5, 2.6, .8, 'stoneDark');
    box(parts, fx - 6.6, 15.2, FACE_Z + 1.05, 3.2, 2.2, .7, 'stoneDark');
    box(parts, fx + 6.6, 15.2, FACE_Z + 1.05, 3.2, 2.2, .7, 'stoneDark');
    box(parts, fx, 13.3, FACE_Z + 1.15, 3.4, 4.6, .9, 'stoneDark');
    box(parts, fx, 10.3, FACE_Z + 1.05, 7.4, 1.3, .8, 'stoneDark');
    box(parts, fx, 19.9, FACE_Z + .7, 17.5, 1.6, .7, 'rock');
  }
  railing(parts, 0, 24, -108.6, 62, 'x', 'wood');
  stairs(parts, -70, -100, { steps: 22, width: 8, rise: .95, run: 1.4, base: 3, mat: 'stoneDark', dir: 'z' });

  // ---- Hokage Administration Building --------------------------------------
  const HZ = -74;
  box(parts, 0, 9.6, HZ - 10.5, 28, 18, 1, 'stoneDark', solid({ bottom: GROUND }));
  for (const side of [-1, 1]) box(parts, side * 9.4, 9.6, HZ + 10.5, 9.2, 18, 1, 'stoneDark', solid({ bottom: GROUND }));
  box(parts, -13.5, 9.6, HZ, 1, 18, 22, 'stoneDark', solid({ bottom: GROUND }));
  box(parts, 13.5, 9.6, HZ, 1, 18, 22, 'stoneDark', solid({ bottom: GROUND }));
  for (let row = 0; row < 4; row++) for (const dx of [-8, -4, 0, 4, 8]) box(parts, dx, 3.4 + row * 3.8, HZ + 11.04, 2.4, 1.8, .08, 'glassWarm');
  box(parts, 0, 18.4, HZ, 33, .8, 27, 'roof', solid({ bottom: 18 }));
  cone(parts, 0, 21.3, HZ, 16.5, 5, 'roof', { seg: 4, ry: Math.PI / 4 });
  banner(parts, 0, 15.2, HZ + 11.3, 7, 4.4, 'banner');
  plane(parts, 0, .64, HZ, 8, 20, 'banner');
  box(parts, 0, 1.35, HZ - 8.2, 10, .7, 2.4, 'wood', solid({ bottom: GROUND }));
  box(parts, 0, 2.1, HZ - 9.2, 4.2, 1.3, 1.5, 'wood');
  for (const [dx, dz] of [[-10.5, -5.5], [10.5, -5.5], [-10.5, 6], [10.5, 6]]) {
    box(parts, dx, 1.25, HZ + dz, 3, 1.3, 1.6, 'wood', solid({ bottom: GROUND }));
  }
  for (const [dx, dz] of [[-12.9, -7], [-12.9, 7], [12.9, -7], [12.9, 7]]) lantern(dx, GROUND, HZ + dz);

  // ---- village perimeter, boulevard and plaza ------------------------------
  box(parts, -150, 4.4, 30, 2.4, 7.6, 200, 'stone', solid({ bottom: GROUND }));
  box(parts, 150, 4.4, 30, 2.4, 7.6, 200, 'stone', solid({ bottom: GROUND }));
  for (const side of [-1, 1]) box(parts, side * 88, 4.4, 132, 124, 7.6, 2.4, 'stone', solid({ bottom: GROUND }));
  for (let i = 0; i < 9; i++) {
    for (const side of [-1, 1]) {
      const z = -58 + i * 22;
      cyl(parts, side * 150, 5.4, z, 3.4, 3.8, 11, 'stoneDark', { seg: 8 });
      cone(parts, side * 150, 12.4, z, 4.4, 3.4, 'roofBlue', { seg: 4, ry: Math.PI / 4 });
    }
  }
  plane(parts, 0, .64, -8, 26, 96, 'cobble');
  cyl(parts, 0, .66, -4, 20, 20, .06, 'stoneLight', { seg: 30 });
  for (const [x, z, w, d] of [[-46, -20, 62, 8], [46, -20, 62, 8], [0, 20, 130, 8], [-42, 40, 90, 8]]) plane(parts, x, .64, z, w, d, 'cobble');
  // The river runs south past the village and through the forest.
  box(parts, 38, .63, 128, 14, .06, 152, 'water');
  box(parts, 38, 1.1, 60, 18, .5, 9, 'wood', solid({ bottom: GROUND }));
  for (const side of [-1, 1]) railing(parts, 38, 1.35, 60 + side * 4.4, 18, 'x', 'wood');

  // ---- central commercial district ----------------------------------------
  for (const [z, h, mat, roof] of [[-42, 9, 'building', 'roof'], [-30, 7, 'buildingWarm', 'roofBlue'], [-18, 10, 'buildingBlue', 'roof'], [-6, 6, 'building', 'roofBlue'], [6, 8, 'buildingWarm', 'roof'], [18, 7, 'building', 'roof'], [30, 9, 'buildingBlue', 'roofBlue']]) {
    house(-24, z, { w: 12, d: 9, h, mat, roof });
  }
  // East side of the boulevard: the block opposite Ichiraku stays open, so the ramen shop has
  // its own frontage instead of standing inside a neighbour's footprint.
  for (const [z, h, mat, roof] of [[-42, 9, 'buildingWarm', 'roofBlue'], [-30, 8, 'building', 'roof'], [6, 8, 'buildingWarm', 'roof'], [18, 9, 'buildingBlue', 'roofBlue'], [30, 7, 'building', 'roof']]) {
    house(24, z, { w: 12, d: 9, h, mat, roof });
  }
  for (const [x, z, h, mat, roof] of [[40, -26, 10, 'building', 'roofBlue'], [45, -8, 8, 'buildingWarm', 'roof']]) {
    house(x, z, { w: 12, d: 10, h, mat, roof });
  }
  for (let z = -46; z <= 34; z += 12) {
    lantern(-13.4, GROUND, z); lantern(13.4, GROUND, z);
  }
  for (const [x, z] of [[-20, -36], [20, -26], [-20, 2], [20, 12], [-20, 26]]) stall(parts, x, z, GROUND, x > 0 ? Math.PI : 0);
  for (const z of [-52, 34]) for (const side of [-1, 1]) banner(parts, side * 11.6, 6.2, z, 2.4, 5, side > 0 ? 'bannerBlue' : 'banner', side > 0 ? 0 : Math.PI);
  parkTree(-18, -50, .9); parkTree(19, 38, 1.05);
  for (const [x, z] of [[-9, -46], [9, 30]]) { box(parts, x, GROUND + .45, z, 2.4, .9, .8, 'wood'); }

  // ---- Ichiraku Ramen ------------------------------------------------------
  // A ramen hall big enough to fight in: 40 x 30 m of floor under a 13 m ceiling. The old room
  // was 22 x 17 m with a 5.5 m ceiling, so the overhead camera had nowhere to stand - it hit
  // the roof and the shot collapsed onto the fighters with a wall filling the lens.
  const RX = 34, RZ = -17;                              // hall centre: x 14..54, z -32..-2
  box(parts, RX, 6.5, -32.5, 41, 13, 1, 'wood', solid({ bottom: GROUND }));
  box(parts, 54.5, 6.5, RZ, 1, 13, 31, 'wood', solid({ bottom: GROUND }));
  // West wall, open at z -21..-15 where the street door is.
  box(parts, 13.5, 6.5, -26.5, 1, 13, 11, 'wood', solid({ bottom: GROUND }));
  box(parts, 13.5, 6.5, -8.5, 1, 13, 14, 'wood', solid({ bottom: GROUND }));
  box(parts, RX, 9.6, -18, .9, 2.6, 6.6, 'wood');       // door frame head
  box(parts, RX, 13.5, RZ, 43, .8, 33, 'roof', solid({ bottom: 13.1 }));
  cone(parts, RX, 16.4, RZ, 26, 5.6, 'roof', { seg: 4, ry: Math.PI / 4 });
  plane(parts, RX, .68, RZ, 40, 30, 'wood');
  // Counter along the back wall, stools in front of it, and the kitchen behind.
  box(parts, RX, 1.2, -28, 30, 1.2, 1.5, 'wood', solid({ bottom: GROUND }));
  box(parts, RX, 2.3, -28.9, 26, .5, .5, 'steel');
  for (let i = 0; i < 7; i++) cyl(parts, RX - 12 + i * 4, GROUND + .35, -25.6, .5, .4, .7, 'wood', { seg: 8 });
  box(parts, RX, 3.2, -31.6, 24, 2.2, .7, 'steel');
  for (const dx of [-9, -3, 3, 9]) { cyl(parts, RX + dx, GROUND + 1.5, -31.2, .7, .6, 1.5, 'metal', { seg: 9 }); }
  // Tables: low solid tops so a fighter can vault them, benches beside.
  for (const [tx, tz] of [[23, -11], [45, -11], [34, -22]]) {
    box(parts, tx, GROUND + .6, tz, 4.6, .6, 2.6, 'wood', solid({ bottom: GROUND }));
    for (const side of [-1, 1]) box(parts, tx + side * 3.2, GROUND + .25, tz, .7, .5, 2.6, 'wood');
    for (const side of [-1, 1]) box(parts, tx, GROUND + .25, tz + side * 2, 4.6, .5, .7, 'wood');
  }
  // Noren across the street door, menu boards and lanterns.
  box(parts, 13.2, 6.4, -18, .14, 2.8, 6.4, 'cloth');
  banner(parts, 13.1, 8.4, -18, 1.2, 4.6, 'bannerBlue', Math.PI / 2);
  for (const [lx, lz] of [[16, -30], [16, -4], [52, -30], [52, -4]]) lantern(lx, GROUND, lz);
  lantern(RX, GROUND, -13);
  banner(parts, RX, 9.4, -32.2, 12, 2.6, 'banner');

  // ---- ninja academy -------------------------------------------------------
  house(-68, -18, { w: 20, d: 32, h: 11, mat: 'building', roof: 'roofBlue', door: false });
  box(parts, -58.05, 3.1, -18, .1, 2.4, 3.4, 'wood');
  banner(parts, -58.1, 8.4, -18, 1.8, 4.2, 'bannerBlue', Math.PI / 2);
  for (let i = 0; i < 3; i++) for (const dz of [-30, -18, -6]) box(parts, -58.02, 5.4 + i * 2.6, -18 + dz, .08, 1.3, 2, 'glassWarm');
  parkTree(-43, -30, 1.25);
  for (const [x, z] of [[-52.5, -6.5], [-48.5, -6.5]]) box(parts, x, GROUND + 2.2, z, .35, 4.4, .35, 'wood');
  box(parts, -50.5, GROUND + 4.3, -6.5, 4.4, .25, .3, 'wood');
  box(parts, -50.5, GROUND + .9, -6.5, 1.2, .16, .8, 'wood');
  for (const [x, z] of [[-42, -24], [-40.5, -14]]) cyl(parts, x, GROUND + .8, z, .3, .36, 1.6, 'trunk', { seg: 6 });
  for (const z of [-26, -18, -10]) box(parts, -41, GROUND + .3, z, 4.4, .5, 1.1, 'wood');

  // ---- hospital ------------------------------------------------------------
  box(parts, 57, 6.2, -45.5, 28, 12.4, 1, 'stoneLight', solid({ bottom: GROUND }));
  for (const side of [-1, 1]) box(parts, 57 + side * 9.6, 6.2, -20.5, 9.2, 12.4, 1, 'stoneLight', solid({ bottom: GROUND }));
  box(parts, 43.5, 6.2, -33, 1, 12.4, 26, 'stoneLight', solid({ bottom: GROUND }));
  box(parts, 70.5, 6.2, -33, 1, 12.4, 26, 'stoneLight', solid({ bottom: GROUND }));
  box(parts, 57, 12.6, -33, 30, .7, 28, 'roofBlue', solid({ bottom: 12.2 }));
  box(parts, 57, 1.35, -44.6, 6, 1.5, .4, 'stoneDark');
  box(parts, 57, 2.6, -44.5, 2.2, .5, .2, 'banner');
  box(parts, 57, 2.6, -44.5, .5, 1.4, .2, 'banner');
  for (const z of [-40, -33, -26]) for (const side of [-1, 1]) box(parts, 57 + side * 13.1, 5.4, z, .1, 1.6, 3, 'glassWarm');
  for (const [x, z] of [[65, -40], [65, -33], [65, -26]]) {
    box(parts, x, GROUND + .6, z, 2.4, 1.1, 4.2, 'stoneLight', solid({ bottom: GROUND }));
    box(parts, x, GROUND + 1.3, z, 2.2, .35, 3.8, 'cloth');
  }
  box(parts, 49, 1.15, -42.4, 5.4, 1.1, 1.6, 'wood', solid({ bottom: GROUND }));

  // ---- residential district ------------------------------------------------
  for (const x of [-84, -72, -60]) house(x, 16, { w: 9, d: 9, h: 5, roof: x % 24 === 0 ? 'roofBlue' : 'roof' });
  for (const x of [-84, -70, -56]) house(x, 56, { w: 10, d: 9, h: 6, mat: 'buildingWarm', roof: x % 28 === 0 ? 'roof' : 'roofBlue' });
  for (const [x, z] of [[-76, 34], [-64, 40]]) parkTree(x, z, .85);
  for (const [x, z] of [[-88, 30], [-52, 30]]) { box(parts, x, GROUND + .4, z, 3, .8, .8, 'wood'); lantern(x + 1.6, GROUND, z); }
  for (const [x, z] of [[-72, 46], [-60, 46]]) cyl(parts, x, GROUND + .55, z, .9, .8, 1.1, 'steel', { seg: 10 });

  // ---- Uchiha clan district ------------------------------------------------
  for (const side of [-1, 1]) {
    box(parts, 92.5 + side * 27, 3.4, 17, 54, 5.6, 1.4, 'stoneDark', solid({ bottom: GROUND }));
    box(parts, 92.5 + side * 27, 3.4, 67, 54, 5.6, 1.4, 'stoneDark', solid({ bottom: GROUND }));
  }
  for (const side of [-1, 1]) box(parts, side > 0 ? 119.5 : 65.5, 3.4, 42, 1.4, 5.6, 50, 'stoneDark', solid({ bottom: GROUND }));
  for (const [x, z] of [[78, 26], [100, 26], [78, 58], [100, 58]]) house(x, z, { w: 12, d: 10, h: 6, mat: 'buildingBlue', roof: 'roofBlue' });
  arch(parts, 68.5, 41, { w: 12, h: 6.4, d: 1.2, base: GROUND, mat: 'stoneDark' });
  for (const side of [-1, 1]) banner(parts, 68.8, 6.6, 41 + side * 7.4, 2.2, 4.6, 'banner', Math.PI / 2);
  cyl(parts, 68.8, 8.4, 41, 1.5, 1.5, .25, 'banner', { rx: Math.PI / 2, seg: 12 });
  cyl(parts, 68.8, 8.4, 41, .8, .8, .3, 'stoneLight', { rx: Math.PI / 2, seg: 12 });
  for (const [x, z] of [[88, 42], [108, 42]]) { lantern(x, GROUND, z); box(parts, x, GROUND + .4, z + 2.4, 3, .8, .8, 'wood'); }
  parkTree(112, 58, .9);

  // ---- Hyuga compound ------------------------------------------------------
  for (const side of [-1, 1]) {
    box(parts, 118, 3.4, side > 0 ? -5.5 : -44.5, 46, 5.6, 1.4, 'stoneDark', solid({ bottom: GROUND }));
  }
  for (const side of [-1, 1]) box(parts, side > 0 ? 140.5 : 95.5, 3.4, -25, 1.4, 5.6, 40, 'stoneDark', solid({ bottom: GROUND }));
  house(118, -38, { w: 34, d: 9, h: 8, mat: 'building', roof: 'roofBlue', door: false });
  for (let i = 0; i < 5; i++) box(parts, 106 + i * 6, 3.4, -33.4, 2.4, 2.2, .08, 'glassWarm');
  cyl(parts, 108, .66, -12, 6, 6, .1, 'water', { seg: 20 });
  for (let i = 0; i < 6; i++) rock(parts, 103 + rng() * 12, -14 - rng() * 4, .8 + rng() * .5, GROUND, rng);
  for (const [x, z] of [[128, -30], [134, -14]]) { cyl(parts, x, GROUND + .8, z, .3, .34, 1.6, 'trunk', { seg: 6 }); ball(parts, x, GROUND + 1.9, z, .55, 'cloth2', { seg: 7 }); }
  parkTree(134, -8, .8);
  for (const [x, z] of [[100, -20], [136, -20]]) lantern(x, GROUND, z);

  // ---- training grounds ----------------------------------------------------
  for (const [x, z] of [[-136, -26], [-128, -22], [-120, -28]]) { cyl(parts, x, GROUND + 1.6, z, .34, .42, 3.2, 'trunk', { seg: 6 }); ball(parts, x, GROUND + 3.3, z, .38, 'cloth2', { seg: 6 }); }
  for (let i = 0; i < 16; i++) {
    const tx = -140 + rng() * 42;
    const tz = -30 + rng() * 46;
    const scale = .7 + rng() * .35;
    if (tx > -136 && tx < -104 && tz > -20 && tz < 12) continue;
    parkTree(tx, tz, scale);
  }
  for (let i = 0; i < 5; i++) rock(parts, -138 + rng() * 36, -28 + rng() * 40, .9 + rng() * .45, GROUND, rng);
  box(parts, -120, .64, 14, 44, .06, 6, 'water');
  for (const [x, z] of [[-104, -18], [-102, 10]]) { box(parts, x, GROUND + .4, z, 2.8, .8, .8, 'wood'); }

  // ---- village gates -------------------------------------------------------
  // The gatehouse is the backdrop of its stage, not its corridor: it sits at z = 101 and the
  // courtyard in front of it (z 106..134) is the fighting floor. Standing the pair inside the
  // gate passage put a 13 m tower and its roof between the camera and the fight.
  for (const side of [-1, 1]) {
    box(parts, side * 11, 5.2, 101, 7, 10.4, 8, 'stoneDark', solid({ bottom: GROUND }));
    cone(parts, side * 11, 13.4, 101, 6.6, 4.6, 'roofBlue', { seg: 4, ry: Math.PI / 4 });
    cyl(parts, side * 11, 5.4, 101, 3.2, 3.6, 10.8, 'stoneDark', { seg: 8 });
    for (const dz of [-2.6, 2.6]) box(parts, side * 7.4, 10.4, 101 + dz, .14, 2.4, 1.8, 'glassWarm');
    box(parts, side * 30, 3.4, 101, 31, 5.6, 3, 'stone', solid({ bottom: GROUND }));
    for (let i = 0; i < 3; i++) box(parts, side * (22 + i * 8), 5.4, 101.4, 4, 2.4, .2, 'glassWarm');
    house(side * 40, 120, { w: 8, d: 8, h: 5, mat: 'buildingWarm', roof: 'roof' });
  }
  box(parts, 0, 9.4, 101, 30, 1.4, 2, 'wood');
  box(parts, 0, 10.6, 101, 34, .9, 3.2, 'roofBlue');
  banner(parts, 0, 7.5, 100.4, 14, 3.4, 'banner');
  for (const side of [-1, 1]) { lantern(side * 8, GROUND, 108); lantern(side * 9, GROUND, 118); }
  plane(parts, 0, .64, 120, 40, 36, 'cobble');
  // Courtyard dressing: the checkpoint booth, two market stalls, benches and notice banners.
  box(parts, -18, 2.2, 120, 8, 3.2, 6, 'buildingWarm', solid({ bottom: GROUND }));
  box(parts, -18, 4.1, 120, 9.4, .5, 7, 'roof');
  for (const dz of [-1.6, 1.6]) box(parts, -13.9, 2.4, 120 + dz, .1, 1.4, 1.6, 'glassWarm');
  stall(parts, 18, 114, GROUND, -Math.PI / 2);
  stall(parts, 18, 124, GROUND, -Math.PI / 2);
  for (const [x, z] of [[-6, 130], [6, 130], [-6, 110]]) box(parts, x, GROUND + .45, z, 3, .9, .8, 'wood');
  banner(parts, -21, 6.4, 108, 2.4, 5, 'banner');
  banner(parts, 21, 6.4, 108, 2.4, 5, 'bannerBlue');

  // ---- Forest of Death -----------------------------------------------------
  // The far checkpoint tower sits outside the stage, on the tree line the camera looks at.
  box(parts, 0, 15.6, 216, 16, 30, 12, 'stoneDark', solid({ bottom: GROUND }));
  cone(parts, 0, 33.4, 216, 12, 6, 'roof', { seg: 4, ry: Math.PI / 4 });
  for (let i = 0; i < 4; i++) for (const dx of [-5, 5]) box(parts, dx, 6 + i * 7, 209.9, 1.6, 1.8, .1, 'glassWarm');
  // Leaf litter under the canopy, with the trail through it: bright plateau grass read as a
  // park, not as the Forest of Death.
  plane(parts, 0, .652, 186, 176, 116, 'moss');
  plane(parts, 0, .66, 182, 16, 54, 'road');
  // Giants wall the clearing in. Their crowns start above the overhead camera, so they frame
  // the fight instead of filling the frame with leaves; the floor itself stays clear.
  const clearOfFight = (x, z) => {
    if (Math.abs(x) < 21 && Math.abs(z - 182) < 16) return false;          // fighting floor
    if (Math.hypot(x, z - 156) < 7) return false;                          // gates doorway ring
    if (z < 160 && Math.abs(x) < 22) return false;                         // gate courtyard approach
    if (Math.hypot(x + 24, z - 168) < 8 || Math.hypot(x - 24, z - 190) < 8) return false;  // spawns
    return true;
  };
  for (let i = 0; i < 64; i++) {
    const a = rng() * TAU, r = 30 + rng() * 32;
    const x = Math.cos(a) * r, z = 182 + Math.sin(a) * r;
    if (z > 212 || !clearOfFight(x, z)) continue;
    giantTree(x, z, .85 + rng() * .45);
  }
  // A few mid-distance trunks inside the stage, so the forest continues past the ring.
  for (let i = 0; i < 8; i++) {
    const x = -56 + rng() * 112, z = 156 + rng() * 50;
    if (!clearOfFight(x, z)) continue;
    giantTree(x, z, .8 + rng() * .35);
  }
  // Undergrowth and deadfall at the edge of the clearing.
  for (let i = 0; i < 22; i++) {
    const x = -54 + rng() * 108, z = 158 + rng() * 46;
    if (!clearOfFight(x, z)) continue;
    cone(parts, x, GROUND + .8, z, .9 + rng() * .5, 1.6, 'leaf', { seg: 6 });
  }
  for (const [x, z, ry] of [[-30, 170, .6], [26, 168, -.9], [-18, 196, 1.7]]) {
    cyl(parts, x, GROUND + .55, z, .8, .9, 7, 'trunk', { seg: 7, rx: Math.PI / 2, ry });
  }
  for (let i = 0; i < 10; i++) rock(parts, -54 + rng() * 108, 156 + rng() * 48, 1 + rng() * .4, GROUND, rng);
  box(parts, 40, .64, 178, 8, .06, 60, 'water');

  // ---- distant rooftops and sky -------------------------------------------
  for (let i = 0; i < 18; i++) {
    const a = rng() * TAU;
    const r = 220 + rng() * 90;
    box(parts, Math.cos(a) * r, 6 + rng() * 8, Math.sin(a) * r - 10, 12 + rng() * 12, 12 + rng() * 16, 12 + rng() * 12, 'building');
    cone(parts, Math.cos(a) * r, 16 + rng() * 8, Math.sin(a) * r - 10, 10, 4, 'roof', { seg: 4, ry: Math.PI / 4 });
  }
  for (let i = 0; i < 14; i++) {
    const a = rng() * TAU;
    ball(parts, Math.cos(a) * (190 + rng() * 170), 74 + rng() * 52, Math.sin(a) * (190 + rng() * 170) - 10, 16 + rng() * 22, 'cloud', { sx: 1.7, sy: .48, sz: 1.7, seg: 8 });
  }

  return parts;
}

// ---- palettes, themes and battle locations ---------------------------------
export const PALETTES = {
  dbz: {
    rock: '#6e6552', grass: '#5d8a43', grassDark: '#3f6030', mountain: '#5a6a72',
    stone: '#9d9074', stoneLight: '#b3a68b', stoneDark: '#756b56', gold: '#e8c860', road: '#c9bd9f', sand: '#cbb98c',
    building: '#b9b3a0', buildingWarm: '#b2936f', buildingBlue: '#7fa6b4', roof: '#b5563f',
    roofBlue: '#4f7f9c', wood: '#7a5433', water: '#2f7ba8', cloud: '#eef5f9',
    leaf: '#3f7a44', trunk: '#5a4230', glassWarm: '#ffd79a', glassBlue: '#8fdcff',
    banner: '#d8452f', bannerBlue: '#2f6fd0', skin: '#d9a982', cloth: '#3f6f8c', cloth2: '#c7b26a',
    metal: '#8d9099', crate: '#8a6a44', flame: '#ffd9a0', dark: '#2a2a2e',
    panel: '#cfd8e0', glassCool: '#bfe9ff', steel: '#9aa4b2', floorStripe: '#d5dbe2', moss: '#5f7a45'
  },
  asgard: {
    rock: '#4d4a52', marble: '#b4b1a8', gold: '#d7aa42', goldLight: '#f3d77d',
    stone: '#918e86', stoneDark: '#5f5c56', roofGold: '#a8792c', sand: '#c2b48e',
    wood: '#6b4b30', water: '#54d6ff', crystal: '#7fe8ff', crystalGlow: '#5fd0ff', grass: '#4c7a4a',
    leaf: '#4c7a4a', trunk: '#4a3527', glassWarm: '#ffe6b0', roof: '#6f6a62',
    bannerBlue: '#2f6fd0', banner: '#a8272f', cloth: '#c9b26a', cloth2: '#3f6f8c', skin: '#d9a982', cloud: '#f2f7ff',
    flame: '#ffe6b0', crate: '#7c5c3e', metal: '#9aa0a8', panel: '#7d8188', steel: '#a3a8b0', moss: '#4f7140'
  },
  deathstar: {
    metal: '#5b6572', metalDark: '#333a45', floor: '#4a525d', floorCommand: '#414956',
    floorHangar: '#4d5563', floorCorridor: '#3d4450', floorStripe: '#c9d6e4',
    panel: '#6d7a88', steel: '#93a4b6', dark: '#22272f', crate: '#6b6250',
    glowBlue: '#79dfff', glowRed: '#ff4b3a', glowGreen: '#7dff9c', glass: '#101826',
    star: '#dfe9ff', core: '#a8ffb6', glowWarm: '#ffe3b0', glassWarm: '#ffd79a'
  },
  hogwarts: {
    stone: '#6f6c66', stoneDark: '#4a4844', stoneLight: '#a29c90', brick: '#5a4a42',
    roofCastle: '#3a4450', roofHall: '#2f3742', ceiling: '#1d2430', wood: '#5a4030',
    gold: '#b49a60', glassWarm: '#ffd79a', glassCool: '#8ab6d4', grass: '#4d6a3f',
    leaf: '#2f4d33', trunk: '#3a2c22', water: '#20323c', cobble: '#6b6a63',
    floorHall: '#7d766a', pitch: '#6f8d4a', flame: '#ffe6a6', clock: '#e8d79a',
    bannerRed: '#9e1f2e', bannerBlue: '#1d426d', bannerGold: '#c2a438', bannerGreen: '#2b623d',
    rock: '#59554c', moss: '#4e5a44', thatch: '#5c4a33', crystal: '#9fd7ff',
    cliff: '#5b5850', dark: '#2a2a2e'
  },
  konoha: {
    rock: '#5f5a4e', cliff: '#575248', mountain: '#586a63', grass: '#4f7a42', grassDark: '#365a2f',
    moss: '#4a6340', stone: '#8a8579', stoneLight: '#a7a294', stoneDark: '#635f56',
    cobble: '#7d776a', road: '#9a8f76', sand: '#c4b48c', wood: '#7a5433', trunk: '#4d3826',
    building: '#c9bda4', buildingWarm: '#b9946a', buildingBlue: '#8fb0b8',
    roof: '#a4432f', roofBlue: '#3f6b86', leaf: '#2f6b39', water: '#2f7ba8', cloud: '#eef4f8',
    gold: '#d8b45a', glassWarm: '#ffd79a', banner: '#c02b2b', bannerBlue: '#2f6fd0',
    cloth: '#3f6f8c', cloth2: '#c7b26a', skin: '#d9a982', metal: '#8d9099', steel: '#9aa4b2',
    flame: '#ffd9a0', crate: '#8a6a44', dark: '#2a2a2e', thatch: '#5c4a33'
  }
};

const THEMES = {
  dbz: { sky: 0x2f6ea8, fog: 0xbcd6d8, floor: 0x2f7ba8, platform: 0x8a8064, ringA: 0x58d8ef, ringB: 0xf4c65e, light: 0xfff2d2, sun: 0xffe3b0, density: .0022, skyPreset: 'tournament' },
  asgard: { sky: 0x28477e, fog: 0xffe2a6, floor: 0x4a4a52, platform: 0x8b8578, ringA: 0x58d8ef, ringB: 0xf4c65e, light: 0xfff2e0, sun: 0xffd6a1, density: .0022, skyPreset: 'asgard' },
  deathstar: { sky: 0x070b14, fog: 0x202b3a, floor: 0x424954, platform: 0x262d38, ringA: 0x78cfff, ringB: 0xff453b, light: 0xc8d9ff, sun: 0x8799bb, density: .004, skyPreset: 'deathstar', interior: true },
  hogwarts: { sky: 0x171a2d, fog: 0x41414b, floor: 0x3c3e43, platform: 0x292b31, ringA: 0xe3c477, ringB: 0x9f252e, light: 0xffd59b, sun: 0xd5c4a1, density: .0045, skyPreset: 'hogwarts', interior: true },
  konoha: { sky: 0x3d78b8, fog: 0xd6e2df, floor: 0x2f7ba8, platform: 0x8a8579, ringA: 0x58d8ef, ringB: 0xf4c65e, light: 0xfff3d6, sun: 0xffe2b0, density: .0021, skyPreset: 'konoha' }
};

const loc = (id, label, kind, bounds, spawns, extra = {}) => ({
  id, label, kind,
  bounds: { x0: bounds[0], z0: bounds[1], x1: bounds[2], z1: bounds[3] },
  spawns: [{ x: spawns[0], z: spawns[1], y: spawns[2] }, { x: spawns[3], z: spawns[4], y: spawns[5] }],
  ...extra
});

export const WORLDS = {
  dbz: {
    id: 'dbz', label: 'Dragon Ball Z', subtitle: 'World Tournament Island', paletteKey: 'dbz',
    build: buildDbz, ground: 3.2,
    locations: [
      loc('dbz_grand_prize', 'Grand Prize Stage', 'arena', [-26, -26, 26, 26], [-9, -7, 4.05, 9, 7, 4.05], { ground: 4.05, exits: [
        { x: 0, z: -24, to: 'dbz_main_entrance', label: 'Main Entrance' },
        { x: 0, z: 24, to: 'dbz_dojo', label: 'Martial Arts Dojo' }
      ] }),
      loc('dbz_main_entrance', 'Main Entrance', 'gate', [-18, -46, 18, -24], [-7, -40, 3.2, 7, -34, 3.2], { exits: [
        { x: 0, z: -29, to: 'dbz_grand_prize', label: 'Grand Prize Stage' },
        { x: -14, z: -44, to: 'dbz_west_city', label: 'West City Streets' },
        { x: 14, z: -44, to: 'dbz_training', label: 'Training Grounds' }
      ] }),
      loc('dbz_west_city', 'West City Streets', 'district', [-122, -44, -54, 44], [-78, -6, 3.2, -96, 6, 3.2], { exits: [
        { x: -56, z: -34, to: 'dbz_main_entrance', label: 'Main Entrance' },
        { x: -80, z: -42, to: 'dbz_capsule_corp', label: 'Capsule Corporation' },
        { x: -58, z: 36, to: 'dbz_backstreets', label: 'West City Backstreets' }
      ] }),
      loc('dbz_capsule_corp', 'Capsule Corporation', 'campus', [-82, -98, -42, -50], [-62, -96, 3.55, -62, -52, 3.55], { ground: 3.55, exits: [
        { x: -46, z: -52, to: 'dbz_west_city', label: 'West City Streets' },
        { x: -44, z: -56, to: 'dbz_capsule_lab', label: 'Capsule Research Lab' }
      ] }),
      loc('dbz_dojo', 'Martial Arts Dojo', 'dojo', [-11, 52, 11, 66], [-6, 56, 3.8, 6, 58, 3.8], { ground: 3.8, exits: [
        { x: 0, z: 54, to: 'dbz_grand_prize', label: 'Grand Prize Stage' },
        { x: 0, z: 64, to: 'dbz_rocky_grounds', label: 'Rocky Training Grounds' }
      ] }),
      loc('dbz_training', 'Training Grounds', 'grounds', [28, -84, 92, -28], [44, -70, 3.2, 70, -46, 3.2], { exits: [
        { x: 30, z: -34, to: 'dbz_main_entrance', label: 'Main Entrance' },
        { x: 88, z: -30, to: 'dbz_cliffs', label: 'Ring Out Cliffs' }
      ] }),
      loc('dbz_cliffs', 'Ring Out Cliffs', 'cliff', [-74, -124, 74, -78], [-14, -98, 3.2, 14, -104, 3.2], { ringOut: true, fallBelow: -2, exits: [
        { x: 66, z: -84, to: 'dbz_training', label: 'Training Grounds' },
        { x: 0, z: -118, to: 'dbz_king_kai', label: "King Kai's Planet" }
      ] }),
      loc('dbz_king_kai', "King Kai's Planet", 'sky-island', [-14, -146, 14, -118], [-5, -128, 62.0, 5, -132, 62.0], { ringOut: true, fallBelow: 40, ground: 62.0, exits: [{ x: 0, z: -137, to: 'dbz_cliffs', label: 'Ring Out Cliffs' }] }),
      loc('dbz_rocky_grounds', 'Rocky Training Grounds', 'grounds', [-26, 112, 26, 150], [-10, 120, 3.2, 2, 141, 3.2], { exits: [
        { x: 0, z: 115, to: 'dbz_dojo', label: 'Martial Arts Dojo' },
        { x: 22, z: 118, to: 'dbz_capsule_lab', label: 'Capsule Research Lab' },
        { x: -22, z: 145, to: 'dbz_backstreets', label: 'West City Backstreets' }
      ] }),
      loc('dbz_capsule_lab', 'Capsule Research Lab', 'lab', [72, 88, 100, 106], [78, 100, 3.2, 90, 104, 3.2], { interior: true, camera: { tilt: .12, scale: .62 }, exits: [
        { x: 96, z: 89, to: 'dbz_capsule_corp', label: 'Capsule Corporation' },
        { x: 82, z: 104, to: 'dbz_rocky_grounds', label: 'Rocky Training Grounds' }
      ] }),
      loc('dbz_backstreets', 'West City Backstreets', 'district', [-142, 78, -98, 114], [-126, 88, 3.2, -110, 102, 3.2], { exits: [
        { x: -120, z: 111.5, to: 'dbz_west_city', label: 'West City Streets' },
        { x: -128, z: 82, to: 'dbz_rocky_grounds', label: 'Rocky Training Grounds' }
      ] })
    ]
  },
  asgard: {
    id: 'asgard', label: 'Asgard', subtitle: 'Home of the Æsir', paletteKey: 'asgard',
    build: buildAsgard, ground: 0.5,
    locations: [
      loc('asgard_palace_court', 'Royal Palace Court', 'palace', [-42, -78, 42, -32], [-10, -40, 0.5, 10, -34, 0.5], { exits: [
        { x: 0, z: -34, to: 'asgard_marketplace', label: 'Marketplace Plaza' },
        { x: 0, z: -58, to: 'asgard_throne_hall', label: 'Throne Hall' }
      ] }),
      loc('asgard_throne_hall', 'Throne Hall', 'interior', [-13, -164, 13, -140], [-8, -146, 0.5, 8, -158, 0.5], { interior: true, camera: { tilt: .12, scale: 1.1 }, exits: [{ x: 0, z: -142, to: 'asgard_palace_court', label: 'Royal Palace Court' }] }),
      loc('asgard_marketplace', 'Marketplace Plaza', 'district', [30, -6, 96, 54], [50, 6, 0.5, 72, 30, 0.5], { exits: [
        { x: 46, z: 0, to: 'asgard_palace_court', label: 'Royal Palace Court' },
        { x: 30, z: 48, to: 'asgard_rainbow_bridge', label: 'Rainbow Bridge' }
      ] }),
      loc('asgard_rainbow_bridge', 'Rainbow Bridge', 'bridge', [-9, 34, 9, 132], [0, 44, 1.75, 0, 60, 1.75], { ringOut: true, fallBelow: -8, ground: 1.75, exits: [
        { x: 0, z: 36, to: 'asgard_marketplace', label: 'Marketplace Plaza' },
        { x: 0, z: 130, to: 'asgard_bifrost', label: 'Bifrost Realm' }
      ] }),
      loc('asgard_bifrost', 'Bifrost Realm', 'arena', [-26, 132, 26, 164], [-8, 142, 1.75, 8, 154, 1.75], { ringOut: true, fallBelow: -8, ground: 1.75, exits: [{ x: 0, z: 134, to: 'asgard_rainbow_bridge', label: 'Rainbow Bridge' }] }),
      loc('asgard_floating_isle', 'Outer Floating Isle', 'sky-island', [-162, 36, -112, 92], [-140, 58, 24.5, -128, 72, 24.5], { ringOut: true, fallBelow: 2, ground: 24.5 })
    ]
  },
  deathstar: {
    id: 'deathstar', label: 'Death Star', subtitle: 'Imperial Battle Station', paletteKey: 'deathstar',
    build: buildDeathStar, ground: 0,
    locations: [
      loc('deathstar_command_deck', 'Command Deck', 'interior', [-30, -116, 30, -70], [-12, -84, 0, 12, -80, 0], { interior: true, exits: [{ x: 0, z: -74, to: 'deathstar_corridor', label: 'Corridor Junction' }] }),
      loc('deathstar_hangar', 'Main Hangar', 'interior', [-48, 12, 48, 88], [-16, 40, 0, 16, 52, 0], { interior: true, exits: [
        { x: 0, z: 84, to: 'deathstar_trench', label: 'Trench Run' },
        { x: 0, z: 20, to: 'deathstar_corridor', label: 'Corridor Junction' }
      ] }),
      loc('deathstar_corridor', 'Corridor Junction', 'interior', [-13, -74, 13, 4], [0, -58, 0, 0, -44, 0], { interior: true, exits: [
        { x: 0, z: -70, to: 'deathstar_command_deck', label: 'Command Deck' },
        { x: 0, z: 1, to: 'deathstar_hangar', label: 'Main Hangar' }
      ] }),
      loc('deathstar_reactor', 'Reactor Core', 'interior', [-30, -178, 30, -126], [-12, -152, 0, 12, -146, 0], { interior: true }),
      loc('deathstar_superlaser', 'Superlaser Control', 'interior', [56, -176, 104, -128], [72, -152, 0, 88, -148, 0], { interior: true }),
      loc('deathstar_escape_pods', 'Escape Pod Bay', 'interior', [-70, -30, -50, 2], [-66, -24, 0, -66, -4, 0], { interior: true }),
      loc('deathstar_trench', 'Trench Run', 'trench', [-11, 106, 11, 186], [-5, 118, 0, 5, 174, 0], { interior: true, exits: [
        { x: 0, z: 108, to: 'deathstar_hangar', label: 'Main Hangar' },
        { x: 0, z: 184, to: 'deathstar_imperial_city', label: 'Imperial City' },
        { x: 10, z: 132, to: 'deathstar_engineering', label: 'Engineering' },
        { x: -10, z: 154, to: 'deathstar_droid_factory', label: 'Droid Factory' }
      ] }),
      loc('deathstar_engineering', 'Engineering', 'interior', [59, 112, 113, 156], [70, 122, 0, 100, 132, 0], { interior: true, exits: [{ x: 62, z: 118, to: 'deathstar_trench', label: 'Trench Run' }] }),
      loc('deathstar_droid_factory', 'Droid Factory', 'interior', [-113, 108, -63, 152], [-100, 124, 0, -76, 136, 0], { interior: true, exits: [{ x: -66, z: 130, to: 'deathstar_trench', label: 'Trench Run' }] }),
      loc('deathstar_imperial_city', 'Imperial City', 'district', [-37, 212, 37, 260], [-14, 222, 0, 14, 250, 0], { interior: true, exits: [
        { x: -18, z: 214, to: 'deathstar_trench', label: 'Trench Run' },
        { x: -20, z: 232, to: 'deathstar_outer_hull', label: 'Outer Hull' }
      ] }),
      loc('deathstar_outer_hull', 'Outer Hull', 'hull', [-149, 201, -91, 249], [-132, 214, 0, -108, 236, 0], { ringOut: true, fallBelow: -22, exits: [{ x: -93, z: 228, to: 'deathstar_imperial_city', label: 'Imperial City' }] })
    ]
  },
  hogwarts: {
    id: 'hogwarts', label: 'Hogwarts', subtitle: 'Castle and Grounds', paletteKey: 'hogwarts',
    build: buildHogwarts, ground: 0.3,
    locations: [
      loc('hogwarts_great_hall', 'Great Hall', 'interior', [-19, -132, 19, -64], [-8, -100, 0.57, 8, -92, 0.57], { interior: true, ground: 0.57, exits: [{ x: 0, z: -66, to: 'hogwarts_courtyard', label: 'Castle Courtyard' }] }),
      loc('hogwarts_courtyard', 'Castle Courtyard', 'courtyard', [-30, -62, 30, -30], [-9, -52, 0.3, 9, -46, 0.3], { exits: [
        { x: 0, z: -60, to: 'hogwarts_great_hall', label: 'Great Hall' },
        { x: 0, z: -32, to: 'hogwarts_viaduct', label: 'Viaduct Bridge' },
        { x: -28, z: -50, to: 'hogwarts_dungeons', label: 'The Dungeons' },
        { x: -28, z: -34, to: 'hogwarts_hagrid', label: "Hagrid's Hut" }
      ] }),
      loc('hogwarts_viaduct', 'Viaduct Bridge', 'bridge', [-6, -30, 6, 22], [0, -22, 1.25, 0, -10, 1.25], { ringOut: true, fallBelow: -6, ground: 1.25, exits: [{ x: 0, z: -28, to: 'hogwarts_courtyard', label: 'Castle Courtyard' }] }),
      loc('hogwarts_quidditch', 'Quidditch Pitch', 'arena', [58, -12, 132, 56], [82, 16, 0.5, 112, 34, 0.5], { ground: 0.5 }),
      loc('hogwarts_forest', 'Forbidden Forest', 'forest', [-124, -78, -42, -16], [-96, -56, 0.3, -70, -34, 0.3], { exits: [{ x: -96, z: -18, to: 'hogwarts_hagrid', label: "Hagrid's Hut" }] }),
      loc('hogwarts_boathouse', 'Black Lake Boathouse', 'dock', [54, 101, 70, 115], [58, 105, 0.6, 66, 111, 0.6], { ground: 0.6 }),
      loc('hogwarts_hogsmeade', 'Hogsmeade Village', 'village', [-122, 32, -48, 92], [-96, 50, 0.3, -56, 70, 0.3]),
      loc('hogwarts_dungeons', 'The Dungeons', 'dungeon', [-49, -107, -27, -81], [-44, -100, 0.3, -32, -88, 0.3], { interior: true, exits: [{ x: -38, z: -83, to: 'hogwarts_courtyard', label: 'Castle Courtyard' }] }),
      loc('hogwarts_hagrid', "Hagrid's Hut", 'hut', [-108, -4, -84, 20], [-103, 6, 0.3, -89, 15, 0.3], { exits: [
        { x: -96, z: -2, to: 'hogwarts_forest', label: 'Forbidden Forest' },
        { x: -86, z: -2, to: 'hogwarts_courtyard', label: 'Castle Courtyard' }
      ] })
    ]
  },
  konoha: {
    id: 'konoha', label: 'Konoha', subtitle: 'Hidden Leaf Village', paletteKey: 'konoha',
    build: buildKonoha, ground: 0.6,
    locations: [
      // The Hokage Rock terrace sits 24 m above the village, so the whole valley is the backdrop.
      // Yawed 180 degrees: the camera stands on the mountain side so the shot looks out over the
      // railing at the village below instead of into the cliff behind the terrace.
      loc('konoha_hokage_rock', 'Hokage Rock', 'cliff', [-32, -128, 32, -110], [-8, -115, 24, 8, -123, 24], { ground: 24, camera: { yaw: Math.PI, tilt: .24, scale: 1.35 }, exits: [
        { x: 0, z: -126, to: 'konoha_hokage_office', label: 'Hokage Administration' }
      ] }),
      loc('konoha_hokage_office', 'Hokage Administration', 'interior', [-11.5, -83, 11.5, -65], [-5, -70, 0.6, 5, -77, 0.6], { interior: true, camera: { tilt: .12, scale: .95 }, exits: [
        { x: 0, z: -66, to: 'konoha_main_street', label: 'Main Street' },
        { x: -7, z: -82, to: 'konoha_hokage_rock', label: 'Hokage Rock' }
      ] }),
      loc('konoha_main_street', 'Main Street', 'district', [-12, -54, 12, 38], [-5, -30, 0.6, 5, 6, 0.6], { exits: [
        { x: 0, z: -52, to: 'konoha_hokage_office', label: 'Hokage Administration' },
        { x: -11, z: -34, to: 'konoha_academy', label: 'Ninja Academy' },
        { x: 11, z: -34, to: 'konoha_hyuga', label: 'Hyuga Compound' },
        { x: 11, z: -40, to: 'konoha_hospital', label: 'Konoha Hospital' },
        { x: 11, z: -18, to: 'konoha_ichiraku', label: 'Ichiraku Ramen' },
        { x: -11, z: 20, to: 'konoha_residential', label: 'Residential District' },
        { x: 11, z: 20, to: 'konoha_uchiha', label: 'Uchiha District' },
        { x: 0, z: 36, to: 'konoha_gates', label: 'Village Gates' }
      ] }),
      loc('konoha_ichiraku', 'Ichiraku Ramen', 'shop', [20, -28, 46, -8], [26, -22, 0.6, 40, -14, 0.6], { interior: true, camera: { tilt: .2, scale: 1.45 }, exits: [
        { x: 22, z: -18, to: 'konoha_main_street', label: 'Main Street' }
      ] }),
      loc('konoha_academy', 'Ninja Academy', 'campus', [-56, -34, -38, -2], [-50, -28, 0.6, -44, -8, 0.6], { exits: [
        { x: -40, z: -18, to: 'konoha_main_street', label: 'Main Street' },
        { x: -46, z: -6, to: 'konoha_training', label: 'Training Grounds' }
      ] }),
      loc('konoha_hospital', 'Konoha Hospital', 'interior', [46.5, -44.5, 67.5, -21.5], [52, -30, 0.6, 62, -38, 0.6], { interior: true, camera: { tilt: .12, scale: .95 }, exits: [
        { x: 49, z: -23, to: 'konoha_main_street', label: 'Main Street' }
      ] }),
      loc('konoha_residential', 'Residential District', 'district', [-92, 12, -44, 62], [-80, 22, 0.6, -58, 48, 0.6], { exits: [
        { x: -60, z: 40, to: 'konoha_main_street', label: 'Main Street' },
        { x: -88, z: 40, to: 'konoha_training', label: 'Training Grounds' }
      ] }),
      loc('konoha_uchiha', 'Uchiha District', 'clan', [68, 18, 118, 66], [84, 40, 0.6, 108, 44, 0.6], { exits: [
        { x: 70, z: 41, to: 'konoha_main_street', label: 'Main Street' }
      ] }),
      loc('konoha_hyuga', 'Hyuga Compound', 'clan', [96, -44, 140, -6], [108, -28, 0.6, 130, -12, 0.6], { exits: [
        { x: 98, z: -24, to: 'konoha_main_street', label: 'Main Street' }
      ] }),
      loc('konoha_training', 'Training Grounds', 'grounds', [-142, -32, -98, 18], [-130, -10, 0.6, -112, 6, 0.6], { exits: [
        { x: -100, z: 0, to: 'konoha_academy', label: 'Ninja Academy' },
        { x: -110, z: 14, to: 'konoha_residential', label: 'Residential District' }
      ] }),
      loc('konoha_gates', 'Village Gates', 'gate', [-26, 106, 26, 134], [-8, 114, 0.6, 8, 124, 0.6], { camera: { tilt: .26, scale: 1.7 }, exits: [
        { x: 0, z: 108, to: 'konoha_main_street', label: 'Main Street' },
        { x: 0, z: 132, to: 'konoha_forest_death', label: 'Forest of Death' }
      ] }),
      loc('konoha_forest_death', 'Forest of Death', 'forest', [-60, 152, 60, 212], [-24, 168, 0.6, 24, 190, 0.6], { camera: { tilt: .2, scale: 1.5 }, exits: [
        { x: 0, z: 156, to: 'konoha_gates', label: 'Village Gates' }
      ] })
    ]
  }
};

// Per-world lighting. One shared key/rim/hemisphere rig lit every world with the same
// numbers, so Hogwarts read as grey haze and the Death Star as a lit warehouse. These keep
// sun direction constant per world (so shadows land the same way every match) but separate
// exposure, fill, rim tint and fog.
export const STAGE_LIGHTING = {
  dbz: {
    exterior: { sun: 1.05, shadow: true, rim: .34, rimColor: 0x8fc4ff, hemi: .5, hemiSky: 0x9ecfff, hemiGround: 0x2b3326, exposure: .94, fogScale: 1, sunPos: [34, 46, -52], rimPos: [-18, 26, 30] },
    interior: { sun: .9, shadow: false, rim: .3, rimColor: 0x8fc4ff, hemi: .5, hemiSky: 0x9ecfff, hemiGround: 0x2b3326, exposure: .94, fogScale: 1, sunPos: [34, 46, -52], rimPos: [-18, 26, 30] }
  },
  asgard: {
    exterior: { sun: 1.15, shadow: true, rim: .44, rimColor: 0xffd9a0, hemi: .58, hemiSky: 0xbcd8ff, hemiGround: 0x2f2a33, exposure: 1.0, fogScale: .9, sunPos: [30, 40, -54], rimPos: [-20, 22, 26] },
    interior: { sun: 1.0, shadow: false, rim: .4, rimColor: 0xffd9a0, hemi: .55, hemiSky: 0xbcd8ff, hemiGround: 0x2f2a33, exposure: 1.0, fogScale: .9, sunPos: [30, 40, -54], rimPos: [-20, 22, 26] }
  },
  deathstar: {
    // Interiors only: a cold key from above, strong blue rim off the panelling, and heavy fog
    // scaled back so the far end of the hangar still reads instead of fading to black.
    exterior: { sun: 2.2, shadow: false, rim: 1.0, rimColor: 0x4d7dff, hemi: 1.35, hemiSky: 0xa8c0dc, hemiGround: 0x1b2430, exposure: 1.28, fogScale: .62, sunPos: [8, 40, -14], rimPos: [-16, 24, 28] },
    interior: { sun: 2.2, shadow: false, rim: 1.0, rimColor: 0x4d7dff, hemi: 1.35, hemiSky: 0xa8c0dc, hemiGround: 0x1b2430, exposure: 1.28, fogScale: .62, sunPos: [8, 40, -14], rimPos: [-16, 24, 28] }
  },
  hogwarts: {
    exterior: { sun: 1.4, shadow: true, rim: .5, rimColor: 0x9db8d8, hemi: .62, hemiSky: 0xa8bdd6, hemiGround: 0x2b2f26, exposure: .98, fogScale: .7, sunPos: [30, 42, -44], rimPos: [-18, 22, 30] },
    // The hall is lit by candles and windows: a low shadowless key, warm fill, cool rim.
    interior: { sun: 1.5, shadow: false, rim: .75, rimColor: 0x8aa4d6, hemi: .8, hemiSky: 0x8f8a78, hemiGround: 0x241f18, exposure: 1.04, fogScale: .5, sunPos: [12, 38, -18], rimPos: [-14, 20, 26] }
  },
  konoha: {
    // High midday sun over a green valley: bright key, cool sky bounce, long shadows across
    // the boulevard so the streets read as depth rather than a flat plane.
    exterior: { sun: 1.1, shadow: true, rim: .38, rimColor: 0xa8d2ff, hemi: .58, hemiSky: 0xa8ccea, hemiGround: 0x2c3526, exposure: .97, fogScale: 1, sunPos: [38, 52, -42], rimPos: [-22, 26, 32] },
    interior: { sun: 1.15, shadow: false, rim: .46, rimColor: 0xffd9a0, hemi: .64, hemiSky: 0xbcd0e0, hemiGround: 0x2b2a25, exposure: 1.0, fogScale: .8, sunPos: [24, 44, -30], rimPos: [-18, 24, 30] }
  }
};

export const WORLD_ORDER = ['dbz', 'asgard', 'deathstar', 'hogwarts', 'konoha'];

// Layouts are assembled once: bounds and spawns from the battle location, collision volumes
// derived from the solid parts of the world it belongs to.
const worldPlans = {};
export function worldParts(worldId) {
  if (!worldPlans[worldId]) {
    const world = WORLDS[worldId];
    worldPlans[worldId] = world ? world.build() : [];
  }
  return worldPlans[worldId];
}

/** Collision volumes for solid parts. `bottom` lets overhead decks be walked under. */
export function blocksFromParts(parts) {
  const blocks = [];
  for (const p of parts) {
    if (!p.solid) continue;
    const [x, y, z] = p.p;
    let top, bottom;
    if (p.t === 'box') {
      const [, h] = p.s;
      top = y + h / 2;
      bottom = p.bottom != null ? p.bottom : y - h / 2;
      blocks.push({ x0: x - p.s[0] / 2, x1: x + p.s[0] / 2, z0: z - p.s[2] / 2, z1: z + p.s[2] / 2, top, bottom });
    } else if (p.t === 'cyl' || p.t === 'cone') {
      const spec = p.t === 'cyl' ? p.s : [p.s[0], p.s[0], p.s[1]];
      const [rt, rb, h] = spec;
      top = y + h / 2;
      bottom = p.bottom != null ? p.bottom : y - h / 2;
      blocks.push({ x, z, r: Math.max(rt, rb), top, bottom });
    } else if (p.t === 'sphere') {
      const r = p.s[0] * (p.sy || 1);
      if (!p.solid) continue;
      top = y + r;
      bottom = p.bottom != null ? p.bottom : y - r;
      blocks.push({ x, z, r: p.s[0], top, bottom });
    }
  }
  return blocks;
}

export const WORLD_LOCATIONS = WORLD_ORDER.flatMap(worldId => {
  const world = WORLDS[worldId];
  return world.locations.map(location => {
    const palette = PALETTES[world.paletteKey];
    const theme = { ...THEMES[worldId], ...(location.theme || {}) };
    return {
      ...location,
      world: worldId,
      worldLabel: world.label,
      worldSubtitle: world.subtitle,
      interior: Boolean(location.interior ?? theme.interior),
      paletteKey: world.paletteKey,
      palette,
      theme,
      ground: location.ground ?? world.ground,
      layout: {
        label: `${world.label} · ${location.label}`,
        kind: location.kind,
        bounds: location.bounds,
        ground: location.ground ?? world.ground,
        spawns: location.spawns,
        ringOut: Boolean(location.ringOut),
        fallBelow: location.fallBelow,
        blocks: blocksFromParts(worldParts(worldId))
      }
    };
  });
});

export const WORLD_LOCATION_KEYS = WORLD_LOCATIONS.map(location => location.id);

export function worldLocation(id) {
  return WORLD_LOCATIONS.find(location => location.id === id) || null;
}

export function isWorldLocation(id) {
  return Boolean(worldLocation(id));
}

/** Worlds grouped for the setup screen, with their selectable battle locations. */
export function worldGroups() {
  return WORLD_ORDER.map(worldId => {
    const world = WORLDS[worldId];
    return {
      id: worldId,
      label: world.label,
      subtitle: world.subtitle,
      locations: WORLD_LOCATIONS.filter(location => location.world === worldId).map(location => ({
        key: location.id,
        label: location.label,
        kind: location.kind,
        width: Math.round(location.bounds.x1 - location.bounds.x0),
        depth: Math.round(location.bounds.z1 - location.bounds.z0)
      }))
    };
  });
}

export const WORLD_MATERIAL_SPECS = {
  water: { roughness: .12, metalness: .25, transparent: true, opacity: .88 },
  glass: { roughness: .08, metalness: .3, transparent: true, opacity: .38 },
  glassWarm: { roughness: .2, metalness: .1, emissive: .55 },
  glassCool: { roughness: .2, metalness: .1, emissive: .4 },
  glassBlue: { roughness: .1, metalness: .35, emissive: .3 },
  flame: { emissive: 1.6 },
  crystal: { roughness: .18, metalness: .2, emissive: .9 },
  crystalGlow: { roughness: .1, metalness: .1, transparent: true, opacity: .45, emissive: 1.2 },
  star: { emissive: 1.4 },
  core: { emissive: 1.8 },
  glowBlue: { emissive: 1.6 },
  glowRed: { emissive: 1.5 },
  glowGreen: { emissive: 1.5 },
  clock: { emissive: .3 },
  cloud: { roughness: 1, transparent: true, opacity: .92 },
  gold: { metalness: .5, roughness: .42 },
  goldLight: { metalness: .45, roughness: .46 },
  metal: { metalness: .82, roughness: .3 },
  metalDark: { metalness: .7, roughness: .4 },
  steel: { metalness: .9, roughness: .22 },
  marble: { roughness: .42, metalness: .12 },
  stone: { roughness: .82, metalness: .05 },
  stoneLight: { roughness: .74, metalness: .04 },
  stoneDark: { roughness: .88, metalness: .04 },
  rock: { roughness: .96, metalness: .02 },
  cliff: { roughness: .95, metalness: .02 },
  moss: { roughness: 1 },
  grass: { roughness: 1 },
  leaf: { roughness: .95 },
  trunk: { roughness: 1 },
  wood: { roughness: .85 },
  brick: { roughness: .9 },
  cobble: { roughness: .92 },
  sand: { roughness: 1 },
  road: { roughness: .95 },
  floor: { roughness: .55, metalness: .45 },
  floorCommand: { roughness: .5, metalness: .5 },
  floorHangar: { roughness: .6, metalness: .4 },
  floorCorridor: { roughness: .55, metalness: .45 },
  floorStripe: { roughness: .7, metalness: .1 },
  floorHall: { roughness: .8, metalness: .05 },
  pitch: { roughness: .95 },
  panel: { roughness: .5, metalness: .5 },
  crate: { roughness: .8, metalness: .1 },
  dark: { roughness: .6, metalness: .3 }
};
