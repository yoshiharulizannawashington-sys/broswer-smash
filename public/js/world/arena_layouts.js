// Playable geometry for every selectable arena.
//
// The procedural and authored arenas in main.js are built at a much larger scale than the
// old fight bounds (a fixed 34 x 16 metre box), so a fight staged in Asgard's plaza, the
// Hogwarts nave or the Death Star briefing room was confined to a strip in the middle of
// the room while the rest of the environment sat outside an invisible wall.
//
// A layout is plain data plus three small pure functions, which is why it can be unit
// tested in node without a browser or a WebGL context:
//   bounds     playable rectangle; fighters are clamped inside it, so it doubles as the
//              ring-out line for stages that want one.
//   blocks     solid volumes the fighters collide with. `top` is how high the volume is:
//              feet above `top - step` can stand on it, anything lower is pushed out.
//   ground     height of the arena floor at spawn.
//   spawns     where each fighter starts, rather than one shared offset for all maps.
//   camera     distance hint used by the selection screen for its map cards.

export const STEP_HEIGHT = 0.42;

const k = (x0, z0, x1, z1, top) => ({ x0, z0, x1, z1, top });
const c = (x, z, r, top) => ({ x, z, r, top });

export const ARENA_LAYOUTS = Object.freeze({
  valley: {
    label: 'Valley of Echoes',
    kind: 'open',
    bounds: { x0: -60, x1: 60, z0: -55, z1: 40 },
    ground: 0,
    spawns: [{ x: -6, z: 0 }, { x: 6, z: 0.7 }],
    blocks: [
      c(-27, -24, 8, 13), c(25, -24, 8, 13),
      k(-8.1, -49, -0.2, -47, 9.3), k(-4.3, -49.1, 4.3, -46.9, 9.3),
      c(-22, -16, 2, 8), c(22, -18, 2, 10), c(-36, 8, 2.5, 12), c(36, 12, 2.5, 9),
      c(-12, -32, 2, 7), c(15, -38, 2, 11), c(48, -5, 2.4, 13), c(-50, -10, 2.4, 10)
    ]
  },
  volcano: {
    label: 'Obsidian Volcano',
    kind: 'open',
    bounds: { x0: -70, x1: 70, z0: -74, z1: 34 },
    ground: 0,
    spawns: [{ x: -6, z: -20 }, { x: 6, z: -19.3 }],
    blocks: [
      { x: -42, z: -38, r: 12, top: 23 },
      c(-90, -65, 11, 30)
    ]
  },
  ice: {
    label: 'Frostfall Citadel',
    kind: 'open',
    bounds: { x0: -70, x1: 70, z0: -72, z1: 34 },
    ground: 0,
    spawns: [{ x: -6, z: -20 }, { x: 6, z: -19.3 }],
    blocks: [c(-34, -35, 9, 22), c(95, -75, 12, 30)]
  },
  neon: {
    label: 'Neon Megacity',
    kind: 'open',
    bounds: { x0: -66, x1: 66, z0: -74, z1: 34 },
    ground: 0,
    spawns: [{ x: -6, z: -20 }, { x: 6, z: -19.3 }],
    blocks: [
      k(-40.5, -40.5, -35.5, -35.5, 18), k(-31.5, -40.5, -26.5, -35.5, 21),
      k(-22.5, -40.5, -17.5, -35.5, 24), k(-13.5, -40.5, -8.5, -35.5, 27),
      k(-4.5, -40.5, 0.5, -35.5, 30), c(0, -100, 12, 40)
    ]
  },
  deathstar: {
    label: 'Death Star',
    kind: 'interior',
    bounds: { x0: -55, x1: 57, z0: -49, z1: -14 },
    ground: 0,
    spawns: [{ x: -38, z: -22 }, { x: -38, z: -40 }],
    blocks: [
      c(-38, -31, 7.6, 0.55),
      k(32, -43, 46, -35, 0.72),
      k(33.2, -42.7, 44.8, -41.2, 4.2),
      k(20.4, -46, 21, -38, 10),
      k(-20.6, -46, -20, -38, 10)
    ]
  },
  finalvalley: {
    label: 'Final Valley',
    kind: 'open',
    bounds: { x0: -58, x1: 58, z0: -66, z1: 22 },
    ground: 0,
    spawns: [{ x: -6.4, z: -30 }, { x: 6.4, z: -29.3 }],
    blocks: []
  },
  tournament: {
    label: 'DBZ World Tournament',
    kind: 'stage',
    bounds: { x0: -17.2, x1: 17.2, z0: -27.2, z1: 3.2 },
    ground: 0.18,
    spawns: [{ x: -7, z: -12 }, { x: 7, z: -11.3 }],
    blocks: []
  },
  starktower: {
    label: 'Helicarrier / Stark Penthouse',
    kind: 'interior',
    bounds: { x0: -35, x1: 52, z0: -49, z1: -3 },
    ground: 0.05,
    spawns: [{ x: -11, z: -24 }, { x: 15, z: -23.3 }],
    blocks: [
      k(16.5, -42.2, 53.6, -41.1, 13.5), k(53.4, -41, 54.4, -7, 13.5),
      { x0: 27.4, z0: -29.5, x1: 36.6, z1: -28.1, top: 1.7 },
      { x0: 39.5, z0: -15.3, x1: 48.5, z1: -13.7, top: 1.0 },
      { x0: 41.6, z0: -31.1, x1: 44.4, z1: -28.9, top: 1.4 },
      { x0: 15.8, z0: -26.3, x1: 20.2, z1: -21.7, top: 9.1 }
    ]
  },
  asgard: {
    label: 'Asgard',
    kind: 'open',
    bounds: { x0: -54, x1: 54, z0: -40, z1: 46 },
    ground: 0,
    spawns: [{ x: -7, z: -20 }, { x: 7, z: -19.3 }],
    blocks: [
      { x: -16, z: -1, r: 4.2, top: 0.7 },
      // Small houses flanking the avenue: two rings of them, mirrored either side.
      ...[-1, 1].flatMap(side => [0, 1, 2, 3, 4, 5, 6].map(i => {
        const x = side * (18 + (i % 3) * 7);
        const z = 26 - i * 10;
        const w = (7 + (i % 2) * 2) * 0.5;
        return { x0: x - w, z0: z - w, x1: x + w, z1: z + w, top: 6 + (i % 4) * 1.5 + 3.8 };
      }))
    ]
  },
  hogwarts: {
    label: 'Hogwarts Great Hall',
    kind: 'interior',
    bounds: { x0: -21, x1: 21, z0: -75, z1: 12 },
    ground: 0,
    spawns: [{ x: -8, z: -8 }, { x: 8, z: -7.3 }],
    blocks: [
      // The four house tables are low enough to jump onto and high enough to block a walk.
      { x0: -13.7, z0: -65.5, x1: -10.3, z1: 1.5, top: 1.3 },
      { x0: -5.7, z0: -65.5, x1: -2.3, z1: 1.5, top: 1.3 },
      { x0: 2.3, z0: -65.5, x1: 5.7, z1: 1.5, top: 1.3 },
      { x0: 10.3, z0: -65.5, x1: 13.7, z1: 1.5, top: 1.3 },
      // Nave columns.
      ...[-66, -54.7, -43.4, -32.1, -20.8, -9.5, 1.8].flatMap(z => [
        c(-20, z, 1.6, 19), c(20, z, 1.6, 19)
      ])
    ]
  }
});

const DEFAULT_KEY = 'valley';

export function layoutFor(key) {
  return ARENA_LAYOUTS[key] || ARENA_LAYOUTS[DEFAULT_KEY];
}

export function layoutKeys() {
  return Object.keys(ARENA_LAYOUTS);
}

/** Walkable height at a point: the floor, or the highest surface the feet can reach. */
export function groundHeightAt(x, z, layout, feetY = 0, step = STEP_HEIGHT) {
  let height = layout?.ground ?? 0;
  for (const block of layout?.blocks || []) {
    const top = block.top;
    if (top == null || top > feetY + step) continue;
    if (block.r != null) {
      if (Math.hypot(x - block.x, z - block.z) <= block.r) height = Math.max(height, top);
    } else if (x >= block.x0 && x <= block.x1 && z >= block.z0 && z <= block.z1) {
      height = Math.max(height, top);
    }
  }
  return height;
}

/** True when the point is inside a solid volume the fighter's feet cannot stand on. */
function insideSolid(block, x, z, feetY, step) {
  if (block.top == null || feetY >= block.top - step) return 0;
  if (block.r != null) {
    const dx = x - block.x, dz = z - block.z;
    const d = Math.hypot(dx, dz);
    return d < block.r ? { dx, dz, d, penetration: block.r - d, circle: true } : null;
  }
  if (x > block.x0 && x < block.x1 && z > block.z0 && z < block.z1) {
    const left = x - block.x0, right = block.x1 - x;
    const near = z - block.z0, far = block.z1 - z;
    const min = Math.min(left, right, near, far);
    if (min === left) return { dx: -1, dz: 0, d: 0, penetration: left };
    if (min === right) return { dx: 1, dz: 0, d: 0, penetration: right };
    if (min === near) return { dx: 0, dz: -1, d: 0, penetration: near };
    return { dx: 0, dz: 1, d: 0, penetration: far };
  }
  return null;
}

/**
 * Push a fighter out of every solid volume it overlaps and drop the inward part of its
 * velocity, so walking into a wall slides along it instead of stopping dead.
 */
export function resolveCollision(position, velocity, radius, layout) {
  if (!layout || !position) return position;
  const feetY = position.y ?? 0;
  for (const block of layout.blocks || []) {
    const hit = insideSolid(block, position.x, position.z, feetY, STEP_HEIGHT);
    if (!hit) continue;
    let nx = hit.dx, nz = hit.dz;
    let push = hit.penetration + radius;
    if (hit.circle) {
      if (hit.d < 1e-4) { nx = 1; nz = 0; } else { nx = hit.dx / hit.d; nz = hit.dz / hit.d; }
      push = (block.r + radius) - hit.d;
    }
    position.x += nx * push;
    position.z += nz * push;
    if (velocity) {
      const inward = velocity.x * nx + velocity.z * nz;
      if (inward < 0) { velocity.x -= inward * nx; velocity.z -= inward * nz; }
    }
  }
  return position;
}

/** Keep the fighter inside the playable rectangle, which doubles as the ring-out line. */
export function clampToBounds(position, velocity, radius, layout) {
  const b = layout?.bounds;
  if (!b) return position;
  const x0 = b.x0 + radius, x1 = b.x1 - radius, z0 = b.z0 + radius, z1 = b.z1 - radius;
  if (position.x < x0) { position.x = x0; if (velocity && velocity.x < 0) velocity.x = 0; }
  if (position.x > x1) { position.x = x1; if (velocity && velocity.x > 0) velocity.x = 0; }
  if (position.z < z0) { position.z = z0; if (velocity && velocity.z < 0) velocity.z = 0; }
  if (position.z > z1) { position.z = z1; if (velocity && velocity.z > 0) velocity.z = 0; }
  return position;
}

/** A fighter this far outside the playable rectangle counts as a ring-out. */
export function isOutOfBounds(position, layout, margin = 4) {
  const b = layout?.bounds;
  if (!b || !position) return false;
  return position.x < b.x0 - margin || position.x > b.x1 + margin
    || position.z < b.z0 - margin || position.z > b.z1 + margin;
}

/** Spawn positions in metres, mirrored either side of the arena's centre line. */
export function spawnPoints(layout) {
  const spawns = layout?.spawns || [{ x: -6, z: 0 }, { x: 6, z: 0 }];
  return spawns.map(spawn => ({ x: spawn.x, z: spawn.z, y: groundHeightAt(spawn.x, spawn.z, layout) }));
}

/** Human-readable footprint, used by the arena selection cards. */
export function layoutSize(layout) {
  const b = layout?.bounds;
  if (!b) return { width: 0, depth: 0 };
  return { width: Math.round(b.x1 - b.x0), depth: Math.round(b.z1 - b.z0) };
}
