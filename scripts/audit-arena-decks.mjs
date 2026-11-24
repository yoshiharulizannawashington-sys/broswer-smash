// Reusable audit for authored decks layered over imported arena terrain.
//
// The imported environment arenas add flat play surfaces in front of large imported meshes:
// Skyloft's plaza slab, Konoha's overlook terrace and Mario Kart's reclaimed apron/runway.
// Some are duplicates of ground the imported geometry already provides; others could be the
// only floor under a stage. Removing a deck without checking that distinction is how a stage
// ends up with a hole in it.
//
// This audit is deliberately data-driven:
//   · it parses the shipped GLBs, so it sees what the game actually loads;
//   · it finds deck-like meshes by name and thin horizontal footprint;
//   · it groups duplicate decks across arenas (same authored role and shape) and within an
//     arena (overlapping surfaces at the same height);
//   · it checks the current stage layout and raycasts the imported terrain below the deck.
//     A deck is load-bearing only when it covers the stage, sits at stage-ground height, and
//     has no imported terrain at that height to stand on.
//
// It is read-only. Run it with:
//   npm run audit:arena-decks
//   node scripts/audit-arena-decks.mjs --arena skyloft --fail-on-load-bearing
//
// The pure helpers are exported for reuse by arena tooling and focused tests.

import './glb-node-compat.mjs';

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ARENA_LAYOUTS } from '../public/js/world/arena_layouts.js';

const ROOT = process.cwd();
const DEFAULT_MIN_AREA = 100;
const DEFAULT_OUT = 'artifacts/arena-decks/audit.json';
const NATURAL_SUPPORT_TOLERANCE = 0.45;
const STAGE_GROUND_TOLERANCE = 0.45;
const STAGE_COVERAGE_THRESHOLD = 0.5;

/** Imported arenas that have authored deck surfaces. Add an entry when another imported arena
 *  gains a deck; layouts are read from the same ARENA_LAYOUTS data the game uses. */
export const IMPORTED_ARENAS = Object.freeze([
  {
    key: 'skyloft',
    file: 'public/assets/arenas/skyloft.glb',
    terrainNames: ['skyloft_island'],
  },
  {
    key: 'konoha_overlook',
    file: 'public/assets/arenas/konoha_overlook.glb',
    terrainNames: ['konoha_village'],
  },
  {
    key: 'mariokart',
    file: 'public/assets/arenas/mariokart.glb',
    terrainNames: ['wuhu_island', 'sunshine_airport'],
  },
]);

// A deck-like name says "deck", "plaza", "apron", "runway" and similar. Markings, rails and
// joints are deliberately excluded: they sit on decks but are not the load-bearing surface.
const DECK_NAME = /(^|[_\s-])(deck|plaza|apron|runway|taxiway|causeway|platform|terrace)([_\s-]|$)/i;
const NON_DECK_NAME = /(joint|rail|edge|line|dash|threshold|marking|compass|banner|lantern|sea|water|cliff|gate|post|pier|base|root)/i;

const ROLE_PATTERNS = [
  ['plaza-deck', /(plaza|deck|terrace)/i],
  ['apron', /apron/i],
  ['runway', /(runway|taxiway)/i],
  ['platform', /platform/i],
  ['causeway', /causeway/i],
];

function roleFor(name) {
  for (const [role, pattern] of ROLE_PATTERNS) {
    if (pattern.test(name)) return role;
  }
  return 'surface';
}

function isDeckName(name) {
  return DECK_NAME.test(name) && !NON_DECK_NAME.test(name);
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function rounded(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function boundsFor(box) {
  return {
    minX: box.min.x,
    maxX: box.max.x,
    minY: box.min.y,
    maxY: box.max.y,
    minZ: box.min.z,
    maxZ: box.max.z,
  };
}

function insideBounds(bounds, x, z, margin = 0) {
  return x >= bounds.minX - margin
    && x <= bounds.maxX + margin
    && z >= bounds.minZ - margin
    && z <= bounds.maxZ + margin;
}

function overlaps(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

function overlapRatio(a, b) {
  if (!overlaps(a, b)) return 0;
  const overlapWidth = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const overlapDepth = Math.max(0, Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ));
  const smaller = Math.min(
    (a.maxX - a.minX) * (a.maxZ - a.minZ),
    (b.maxX - b.minX) * (b.maxZ - b.minZ),
  );
  return smaller > 0 ? (overlapWidth * overlapDepth) / smaller : 0;
}

/** Stage sample points: centre, both spawns and the four corners of the current layout. */
export function stageSamples(layout) {
  if (!layout?.bounds) return [];
  const { x0, x1, z0, z1 } = layout.bounds;
  const samples = [
    ['centre', (x0 + x1) / 2, (z0 + z1) / 2],
    ['spawn-1', layout.spawns?.[0]?.x, layout.spawns?.[0]?.z],
    ['spawn-2', layout.spawns?.[1]?.x, layout.spawns?.[1]?.z],
    ['corner-x0-z0', x0, z0],
    ['corner-x1-z0', x1, z0],
    ['corner-x0-z1', x0, z1],
    ['corner-x1-z1', x1, z1],
  ];
  return samples
    .filter(([, x, z]) => Number.isFinite(x) && Number.isFinite(z))
    .map(([label, x, z]) => ({ label, x, z }));
}

function meshesNamed(scene, names = []) {
  const meshes = [];
  for (const name of names) {
    const object = scene.getObjectByName(name);
    if (!object) continue;
    object.traverse((child) => {
      if (child.isMesh) meshes.push(child);
    });
  }
  return [...new Set(meshes)];
}

function allMeshes(scene) {
  const meshes = [];
  scene.traverse((child) => {
    if (child.isMesh) meshes.push(child);
  });
  return meshes;
}

function materialNames(mesh) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.filter(Boolean).map((material) => material.name).filter(Boolean);
}

async function loadArenaScene(file) {
  const bytes = await readFile(resolve(ROOT, file));
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return await new Promise((resolveScene, rejectScene) => {
    new GLTFLoader().parse(arrayBuffer, '', (gltf) => {
      gltf.scene.updateMatrixWorld(true);
      resolveScene(gltf.scene);
    }, rejectScene);
  });
}

function raycastGround(meshes, x, z, top) {
  if (!meshes.length) return null;
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(x, top + 50, z),
    new THREE.Vector3(0, -1, 0),
    0,
    100,
  );
  const hits = raycaster.intersectObjects(meshes, false);
  return hits.length ? hits[0].point.y : null;
}

function findPropsRestingOnDeck(meshes, deck, deckBox) {
  const props = [];
  const centre = new THREE.Vector3();
  for (const mesh of meshes) {
    if (mesh === deck) continue;
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) continue;
    box.getCenter(centre);
    if (!insideBounds(boundsFor(deckBox), centre.x, centre.z, 0.25)) continue;
    if (box.min.y < deckBox.max.y - 0.25 || box.min.y > deckBox.max.y + 2.25) continue;
    props.push(mesh.name || '(unnamed)');
  }
  return props;
}

function findDecks(scene, arena, minArea) {
  const meshes = allMeshes(scene);
  let terrainMeshes = meshesNamed(scene, arena.terrainNames || []);
  // A custom arena may not know the backdrop node names yet. Falling back to all non-deck
  // meshes still gives the height test something useful to raycast, while the built-in imported
  // arenas use the explicit island/village/airport nodes above.
  if (!terrainMeshes.length) terrainMeshes = meshes.filter((mesh) => !isDeckName(mesh.name || ''));
  const layout = ARENA_LAYOUTS[arena.key] || null;
  const samples = stageSamples(layout);
  const decks = [];

  for (const mesh of meshes) {
    const name = mesh.name || '';
    if (!isDeckName(name)) continue;

    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) continue;
    const size = box.getSize(new THREE.Vector3());
    const width = Math.abs(size.x);
    const depth = Math.abs(size.z);
    const height = Math.abs(size.y);
    const area = width * depth;
    if (area < minArea || height > 2.5) continue;

    const top = box.max.y;
    const bottom = box.min.y;
    const bounds = boundsFor(box);
    const deckSamples = samples.filter((sample) => insideBounds(bounds, sample.x, sample.z, 0.05));
    const stageCoverage = samples.length ? deckSamples.length / samples.length : 0;
    const stageFloor = Boolean(layout)
      && stageCoverage >= STAGE_COVERAGE_THRESHOLD
      && Math.abs(top - layout.ground) <= STAGE_GROUND_TOLERANCE;

    let naturalSupport = null;
    let naturalSamples = 0;
    if (stageFloor) {
      const terrainHits = deckSamples
        .map((sample) => raycastGround(terrainMeshes, sample.x, sample.z, top));
      naturalSamples = terrainHits.filter((value) => value != null).length;
      if (naturalSamples) {
        const supported = terrainHits.filter((value) => value != null
          && Math.abs(value - top) <= NATURAL_SUPPORT_TOLERANCE).length;
        // Missing terrain samples count against support: a deck cannot be assumed safe just
        // because the ray happened to miss the imported mesh at some stage points.
        naturalSupport = supported / deckSamples.length;
      }
    }

    const loadBearing = stageFloor && naturalSupport !== 1;
    const props = findPropsRestingOnDeck(meshes, mesh, box);

    decks.push({
      arena: arena.key,
      name,
      role: roleFor(name),
      material: materialNames(mesh).join(', '),
      width: rounded(width),
      depth: rounded(depth),
      height: rounded(height),
      bottom: rounded(bottom, 3),
      top: rounded(top, 3),
      areaM2: rounded(area, 1),
      bounds,
      stage: layout ? {
        coverage: rounded(stageCoverage, 2),
        samples: deckSamples.length,
        totalSamples: samples.length,
        ground: rounded(layout.ground, 3),
        floorMatch: stageFloor,
      } : null,
      naturalSupport: naturalSupport == null ? null : rounded(naturalSupport, 2),
      naturalSamples,
      loadBearing,
      loadBearingReason: loadBearing
        ? (naturalSupport == null
          ? 'stage floor; imported terrain support could not be measured'
          : 'stage floor; imported terrain is below the deck')
        : stageFloor
          ? 'stage floor has imported terrain at deck height'
          : 'does not cover the current stage floor',
      supportsProps: props.length > 0,
      propCount: props.length,
      props: props.slice(0, 12),
      duplicateGroupIds: [],
    });
  }

  return decks;
}

function nearDimension(a, b, relative = 0.15, absolute = 3) {
  return Math.abs(a - b) <= Math.max(absolute, Math.max(a, b) * relative);
}

function buildDuplicateGroups(decks) {
  const parent = decks.map((_, index) => index);
  const kinds = decks.map(() => new Set());

  const find = (index) => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };

  const union = (a, b, kind) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
    kinds[a].add(kind);
    kinds[b].add(kind);
  };

  for (let i = 0; i < decks.length; i += 1) {
    for (let j = i + 1; j < decks.length; j += 1) {
      const a = decks[i];
      const b = decks[j];
      if (a.arena === b.arena
        && overlapRatio(a.bounds, b.bounds) >= 0.5
        && Math.abs(a.top - b.top) <= 0.6) {
        union(i, j, 'same-arena-overlap');
      }
      if (a.arena !== b.arena
        && a.role === b.role
        && nearDimension(a.width, b.width)
        && nearDimension(a.depth, b.depth)
        && Math.abs(a.top - b.top) <= 0.75) {
        union(i, j, 'cross-arena-archetype');
      }
    }
  }

  const groups = new Map();
  decks.forEach((deck, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push({ deck, kinds: kinds[index] });
  });

  let groupNumber = 0;
  const duplicateGroups = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    groupNumber += 1;
    const id = `deck-group-${groupNumber}`;
    const kindSet = new Set();
    for (const member of members) {
      for (const kind of member.kinds) kindSet.add(kind);
      member.deck.duplicateGroupIds.push(id);
    }
    duplicateGroups.push({
      id,
      kinds: [...kindSet].sort(),
      role: members[0].deck.role,
      decks: members.map(({ deck }) => `${deck.arena}/${deck.name}`),
      loadBearing: members.filter(({ deck }) => deck.loadBearing).map(({ deck }) => `${deck.arena}/${deck.name}`),
    });
  }

  return duplicateGroups;
}

/** Run the audit over one or more imported arenas. */
export async function auditArenaDecks({
  arenas = IMPORTED_ARENAS,
  minArea = DEFAULT_MIN_AREA,
} = {}) {
  if (!Array.isArray(arenas) || arenas.length === 0) {
    throw new Error('auditArenaDecks needs at least one imported arena');
  }
  if (!Number.isFinite(minArea) || minArea <= 0) {
    throw new Error('minArea must be a positive number');
  }

  const reports = [];
  const decks = [];
  for (const arena of arenas) {
    const scene = await loadArenaScene(arena.file);
    const arenaDecks = findDecks(scene, arena, minArea);
    decks.push(...arenaDecks);
    reports.push({
      key: arena.key,
      file: arena.file,
      deckCount: arenaDecks.length,
      decks: arenaDecks,
    });
  }

  const duplicateGroups = buildDuplicateGroups(decks);
  const loadBearingDecks = decks.filter((deck) => deck.loadBearing);
  const supportDecks = decks.filter((deck) => deck.supportsProps);

  return {
    generatedAt: new Date().toISOString(),
    minArea,
    arenas: reports,
    duplicateGroups,
    summary: {
      decks: decks.length,
      duplicateDecks: decks.filter((deck) => deck.duplicateGroupIds.length > 0).length,
      duplicateGroups: duplicateGroups.length,
      loadBearingDecks: loadBearingDecks.map((deck) => `${deck.arena}/${deck.name}`),
      supportsPropDecks: supportDecks.map((deck) => `${deck.arena}/${deck.name}`),
    },
  };
}

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
}

function usage() {
  console.log(`Usage: node scripts/audit-arena-decks.mjs [options]

Options:
  --arena <key>              limit to one imported arena (${IMPORTED_ARENAS.map((arena) => arena.key).join(', ')})
  --min-area <m2>            minimum horizontal deck area to inspect (default ${DEFAULT_MIN_AREA})
  --out <path>               JSON report path (default ${DEFAULT_OUT})
  --fail-on-load-bearing     exit 1 when a deck is load-bearing
  --help                     show this help`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    return;
  }

  const arenaFilter = argValue('--arena', null);
  const selected = arenaFilter
    ? IMPORTED_ARENAS.filter((arena) => arena.key === arenaFilter)
    : IMPORTED_ARENAS;
  if (!selected.length) {
    throw new Error(`Unknown arena "${arenaFilter}"; expected one of ${IMPORTED_ARENAS.map((arena) => arena.key).join(', ')}`);
  }

  const minAreaValue = argValue('--min-area', String(DEFAULT_MIN_AREA));
  const minArea = Number(minAreaValue);
  if (!Number.isFinite(minArea) || minArea <= 0) {
    throw new Error(`--min-area must be a positive number, got "${minAreaValue}"`);
  }

  const out = argValue('--out', DEFAULT_OUT);
  const failOnLoadBearing = args.includes('--fail-on-load-bearing');
  const report = await auditArenaDecks({ arenas: selected, minArea });

  await mkdir(dirname(resolve(ROOT, out)), { recursive: true });
  await writeFile(resolve(ROOT, out), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Arena deck audit · ${report.summary.decks} deck-like surface(s) · ${report.summary.duplicateDecks} duplicate(s) in ${report.summary.duplicateGroups} group(s)`);
  for (const arena of report.arenas) {
    console.log(`\n${arena.key} (${arena.file})`);
    if (!arena.decks.length) {
      console.log('  no deck-like meshes');
      continue;
    }
    for (const deck of arena.decks) {
      const duplicate = deck.duplicateGroupIds.length ? deck.duplicateGroupIds.join(', ') : '-';
      const natural = deck.naturalSupport == null ? 'n/a' : deck.naturalSupport;
      const flags = [
        deck.loadBearing ? 'LOAD-BEARING' : null,
        deck.supportsProps ? 'supports-props' : null,
        deck.duplicateGroupIds.length ? `duplicate:${duplicate}` : null,
      ].filter(Boolean).join(' · ') || 'none';
      console.log(`  ${deck.name} [${deck.role}] ${deck.width}×${deck.depth} m, top ${deck.top}, stage ${deck.stage?.coverage ?? 0}, natural ${natural} · ${flags}`);
      if (deck.loadBearing) console.log(`    ${deck.loadBearingReason}`);
    }
  }

  if (report.duplicateGroups.length) {
    console.log('\nDuplicate groups');
    for (const group of report.duplicateGroups) {
      console.log(`  ${group.id} [${group.kinds.join(', ')}] ${group.decks.join(' ↔ ')}${group.loadBearing.length ? ` · LOAD-BEARING: ${group.loadBearing.join(', ')}` : ''}`);
    }
  }

  console.log(`\nLoad-bearing decks: ${report.summary.loadBearingDecks.length ? report.summary.loadBearingDecks.join(', ') : 'none'}`);
  console.log(`Wrote ${out}`);

  if (failOnLoadBearing && report.summary.loadBearingDecks.length) {
    process.exitCode = 1;
  }
}

const isEntry = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isEntry) {
  main().catch((error) => {
    console.error(`arena deck audit failed: ${error?.stack || error}`);
    process.exitCode = 1;
  });
}
