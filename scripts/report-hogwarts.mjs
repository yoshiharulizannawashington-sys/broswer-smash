// Machine-readable Hogwarts quality report.
//
// For every room in the castle range this measures the things a player actually cares about,
// using the same functions the fighter controller runs:
//   * does a standable floor exist at the room's declared height,
//   * what fraction of the room's floor is walkable (not blocked by walls/furniture),
//   * how many real door openings pierce its boundary walls,
//   * which automated route covers it.
//
// "connected" is measured, not copied from a comment: an opening only counts when a probe on
// the room's boundary at floor height is outside every solid volume.
//
//   node scripts/report-hogwarts.mjs > artifacts/hogwarts-quality.json
import { existsSync } from 'node:fs';
import { WORLDS, worldParts, blocksFromParts } from '../public/js/worlds/world_catalog.js';
import { layoutFor, groundHeightAt, resolveCollision } from '../public/js/world/arena_layouts.js';
import { HOGWARTS_CONNECTIONS, HOGWARTS_GRAPH_NOTES, HOGWARTS_INTERIOR_AREAS, HOGWARTS_INTERIOR_LOCATIONS, HOGWARTS_NAV_ROUTES } from '../public/js/worlds/hogwarts_interior.js';

const STAGE = 'hogwarts_entrance_hall';
const layout = layoutFor(STAGE);
const blocks = layout.blocks;

/** Probe the world for a solid volume at a point, at the given floor height. */
function solidAtPoint(x, z, feet) {
  const probe = { x, y: feet, z };
  resolveCollision(probe, { x: 0, y: 0, z: 0 }, 0.7, layout);
  return Math.hypot(probe.x - x, probe.z - z) > 0.05;
}

const insideRoom = (room, x, z) => x > room.x0 && x < room.x1 && z > room.z0 && z < room.z1;

/** Count distinct openings (>= 2.4 m) along one side of a room, at floor height. */
function openingsOnSide(room, side, height) {
  const along = side === 'north' || side === 'south'
    ? { from: room.x0 + 1, to: room.x1 - 1, fixed: side === 'north' ? room.z0 + .55 : room.z1 - .55 }
    : { from: room.z0 + 1, to: room.z1 - 1, fixed: side === 'west' ? room.x0 + .55 : room.x1 - .55 };
  let openings = 0;
  let run = 0;
  for (let t = along.from; t <= along.to; t += 0.25) {
    const x = side === 'north' || side === 'south' ? t : along.fixed;
    const z = side === 'north' || side === 'south' ? along.fixed : t;
    if (solidAtPoint(x, z, height)) {
      if (run >= 2.4) openings++;
      run = 0;
    } else {
      run += 0.25;
    }
  }
  if (run >= 2.4) openings++;
  return openings;
}

const shots = [
  ['01-entrance-hall', 'entrance_hall'],
  ['02-grand-staircase', 'stair_hall'],
  ['03-library', 'library'],
  ['04-gryffindor', 'gryffindor'],
  ['05-astronomy', 'astronomy'],
  ['06-kitchens', 'kitchens'],
  ['08-dungeon-passage', null]
];
const captured = new Set(shots.filter(([file]) => existsSync(`artifacts/hogwarts/${file}.png`)).map(([, area]) => area));

const areas = HOGWARTS_INTERIOR_AREAS.map(area => {
  const { room, height } = area;
  const centreX = (room.x0 + room.x1) / 2;
  const centreZ = (room.z0 + room.z1) / 2;
  const centreGround = groundHeightAt(centreX, centreZ, layout, height + 2.1);

  // Walkable fraction on a 1 m grid, inset from the walls.
  let cells = 0, walkable = 0;
  for (let x = room.x0 + 1; x <= room.x1 - 1; x += 1) {
    for (let z = room.z0 + 1; z <= room.z1 - 1; z += 1) {
      cells++;
      const ground = groundHeightAt(x, z, layout, height + 0.42);
      if (Math.abs(ground - height) > 0.32) continue;
      if (solidAtPoint(x, z, height)) continue;
      walkable++;
    }
  }

  const openings = ['north', 'south', 'east', 'west']
    .map(side => openingsOnSide(room, side, height))
    .reduce((sum, count) => sum + count, 0);

  const routes = HOGWARTS_NAV_ROUTES
    .filter(route => route.points.some(point => insideRoom(room, point.x, point.z)))
    .map(route => route.name);

  return {
    id: area.id,
    label: area.label,
    floor: area.floor,
    height,
    room: area.room,
    stage: HOGWARTS_INTERIOR_LOCATIONS.some(location => location.id === `hogwarts_${area.id}`)
      ? `hogwarts_${area.id}` : null,
    centreGround: +centreGround.toFixed(2),
    floorVerified: Math.abs(centreGround - height) <= 0.8,
    walkableCells: walkable,
    sampledCells: cells,
    walkablePercent: cells ? Math.round(walkable / cells * 100) : 0,
    boundaryOpenings: openings,
    connected: openings > 0,
    nodeRoutes: routes,
    browserVerified: Boolean(captured.has(area.id)),
    capture: captured.has(area.id) ? `artifacts/hogwarts/${shots.find(([, id]) => id === area.id)[0]}.png` : null
  };
});


// ---- traversal graph -------------------------------------------------------
const graphNodes = [...HOGWARTS_INTERIOR_AREAS.map(area => area.id), ...Object.keys(HOGWARTS_GRAPH_NOTES)];
const reached = new Set(['entrance_hall']);
for (let pass = 0; pass < graphNodes.length; pass++) {
  for (const edge of HOGWARTS_CONNECTIONS) {
    if (reached.has(edge.a)) reached.add(edge.b);
    if (reached.has(edge.b)) reached.add(edge.a);
  }
}
const graph = {
  nodes: graphNodes,
  edges: HOGWARTS_CONNECTIONS.length,
  provenByWalkedRoute: HOGWARTS_CONNECTIONS.filter(edge => edge.route).length,
  walkedRoutes: HOGWARTS_NAV_ROUTES.map(route => route.name),
  unreachableFromEntranceHall: graphNodes.filter(id => !reached.has(id)),
  externalSpaces: Object.entries(HOGWARTS_GRAPH_NOTES).map(([id, note]) => ({ id, note })),
  connections: HOGWARTS_CONNECTIONS.map(edge => ({
    a: edge.a, b: edge.b, via: edge.via, proven: Boolean(edge.route), route: edge.route || null
  }))
};

const parts = worldParts('hogwarts');
const worldBlocks = blocksFromParts(parts);
const report = {
  world: 'hogwarts',
  worldLabel: WORLDS.hogwarts.label,
  generatedBy: 'scripts/report-hogwarts.mjs',
  stageKeys: WORLDS.hogwarts.locations.map(location => location.id),
  graph,
  stageCount: WORLDS.hogwarts.locations.length,
  interiorStages: HOGWARTS_INTERIOR_LOCATIONS.length,
  geometry: {
    parts: parts.length,
    collisionVolumes: worldBlocks.length,
    // The whole world is merged into one mesh per material (worlds/world_builder.js), so draw
    // calls do not grow with room count; the count is recorded at runtime instead.
    drawCallsNote: 'merged per material at runtime; see window.__browserSmashWorld.drawCalls'
  },
  totals: {
    areas: areas.length,
    withStage: areas.filter(area => area.stage).length,
    connected: areas.filter(area => area.connected).length,
    floorVerified: areas.filter(area => area.floorVerified).length,
    browserVerified: areas.filter(area => area.browserVerified).length,
    averageWalkablePercent: Math.round(areas.reduce((sum, area) => sum + area.walkablePercent, 0) / areas.length)
  },
  areas
};

console.log(JSON.stringify(report, null, 2));
