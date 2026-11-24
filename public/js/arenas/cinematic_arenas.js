import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { tuneAsgardMaterials } from './asgard_materials.js';
import { tuneArchitecturalStone } from './architectural_materials.js';
import { buildAsgardArchitecture, buildAsgardCourtyard } from './asgard_architecture.js';
import { buildHogwartsArchitecture } from './hogwarts_architecture.js';
import { buildTournamentBroadcast } from './tournament_architecture.js';

// The map key is the id the game selects by; `marker` is the node the Blender exporter
// writes as the arena's root, which is not always the same word (the Stark Tower map is
// built from the helicarrier scene). Validating the marker against the map key instead of
// the file made every starktower load fail its own structure check.
const MODEL_PATHS = Object.freeze({
  asgard: { file: 'asgard.glb', marker: 'arena_asgard' },
  starktower: { file: 'helicarrier.glb', marker: 'arena_helicarrier' },
  hogwarts: { file: 'hogwarts.glb', marker: 'arena_hogwarts' },
  tournament: { file: 'tournament.glb', marker: 'arena_tournament' },
  // Imported environment arenas assembled from multiple source creators. Konoha and Skyloft
  // are joined meshes, so their valid mesh count is lower than the hand-authored 300-900 mesh
  // scenes; each entry states its own floor rather than weakening the global check.
  skyloft: { file: 'skyloft.glb', marker: 'arena_skyloft', minMeshes: 40 },
  // Wuhu and Sunshine Airport are joined into one landmass. The source GLB still carries the
  // reclaimed apron and runway, but stripMariokartApron removes them at mount so the fight uses
  // Wuhu's own grass and rock. Material splitting makes the runtime count larger than 31 meshes.
  mariokart: { file: 'mariokart.glb', marker: 'arena_mariokart', minMeshes: 100 },
  // Konoha's Blender source is now only the joined imported village plus the loader marker;
  // the old 48 x 34 m authored overlook is no longer exported. One runtime mesh is expected.
  konoha_overlook: { file: 'konoha_overlook.glb', marker: 'arena_konoha_overlook', minMeshes: 1 }
});
// The authored scenes are dense (300-900 meshes). Anything much smaller means the export
// is truncated or the wrong file, so treat it as unavailable and keep the procedural arena.
const MIN_ARENA_MESHES = 80;
const ASSET_VERSION = 'cinematic-arena-library-v5-20261114';
const loader = new GLTFLoader();
const loadedArenas = new Map();
let arenaLayer = null;
let activeArenaKey = null;

function stateRoot() {
  if (typeof window === 'undefined') return {};
  window.__browserSmashAssets = window.__browserSmashAssets || {};
  window.__browserSmashAssets.arenas = window.__browserSmashAssets.arenas || {};
  return window.__browserSmashAssets;
}

function hideAllArenaAssets() {
  for (const item of loadedArenas.values()) {
    if (item.group) item.group.visible = false;
  }
}

// The island already carries a natural paved courtyard at the same height as the plaza. The
// imported flat slab duplicated that surface and left a grey box edge cutting through the grass.
// Remove the slab and its separate joint strips, leaving the authored courtyard, compass and rails.
function stripSkyloftPlazaSlab(group) {
  const removed = [];
  const plaza = group.getObjectByName('skyloft_plaza');
  if (plaza) {
    removed.push(plaza.name);
    plaza.parent?.remove(plaza);
  }
  const joints = [];
  group.traverse(node => {
    if (node !== group && /^skyloft_joint_/.test(node.name || '')) joints.push(node);
  });
  for (const joint of joints) {
    removed.push(joint.name);
    joint.parent?.remove(joint);
  }
  const result = { plazaRemoved: Boolean(plaza), jointsRemoved: joints.length, removed };
  const root = stateRoot();
  root.skyloftDeck = result;
  if (typeof window !== 'undefined') window.__browserSmashSkyloftDeck = result;
  return result;
}

// The reclaimed apron was a 66 m asphalt disc laid over the airport lagoon. It made a clean
// runway, but it hid the island and floated kilometres of artificial deck above Wuhu's coast.
// The fight now uses Wuhu's own grass and rock; remove the disc and every procedural runway
// marking that depended on it, while keeping the imported airport and island as scenery.
// Konoha's Blender source now contains only konoha_village and the invisible loader marker; the
// old terrace, cliff plinth, rails, bridge, gate, banners and lanterns are not exported anymore.
// Keep this defensive cleanup for a cached older export, but a normal v4 load removes zero pieces.
function stripKonohaOverlook(group) {
  const removed = [];
  const targets = [];
  group.traverse(node => {
    const name = node.name || '';
    // `konoha_village` is the imported mesh; `konoha_village_bridge` is authored and must go.
    if (node !== group && /^konoha_/.test(name) && name !== 'konoha_village') targets.push(node);
  });
  for (const node of new Set(targets)) {
    removed.push(node.name);
    node.parent?.remove(node);
  }
  const result = {
    removedCount: removed.length,
    removed,
    villageRetained: Boolean(group.getObjectByName('konoha_village')),
    markerRetained: Boolean(group.getObjectByName('arena_konoha_overlook'))
  };
  const root = stateRoot();
  root.konohaOverlook = result;
  if (typeof window !== 'undefined') window.__browserSmashKonohaOverlook = result;
  return result;
}

function stripMariokartApron(group) {
  const targets = [];
  const collect = name => {
    const node = group.getObjectByName(name);
    if (node) targets.push(node);
  };
  for (const name of [
    'mariokart_apron', 'mariokart_runway', 'mariokart_runway_edge_n', 'mariokart_runway_edge_s',
    'mariokart_taxiway', 'mariokart_taxi_line'
  ]) collect(name);
  group.traverse(node => {
    if (/^mariokart_(?:runway_dash|threshold_[we])_/.test(node.name || '')) targets.push(node);
  });
  const apron = targets.find(node => node.name === 'mariokart_apron');
  const runway = targets.find(node => node.name === 'mariokart_runway');
  for (const node of new Set(targets)) node.parent?.remove(node);
  const removed = [...new Set(targets.map(node => node.name))];
  const result = { apronRemoved: Boolean(apron), runwayRemoved: Boolean(runway), removedCount: removed.length, removed };
  const root = stateRoot();
  root.mariokartApron = result;
  if (typeof window !== 'undefined') window.__browserSmashMariokartApron = result;
  return result;
}

// The airport's natural western atoll rim is only a narrow ledge; immediately east of it is
// the lagoon. Extend the existing grass-and-rock isthmus with a low atoll shelf, built from
// the same two materials, so the play rectangle can include more of the atoll without letting
// fighters walk on the reclaimed runway. The outline is deliberately irregular rather than a
// rectangular deck, and its top stays below the Mario terrain ceiling (ground + 5 m).
function buildMariokartAtollShelf(group) {
  let rock = null;
  group.traverse(node => {
    if (!node.isMesh) return;
    for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
      if (material?.name === 'mariokart_bridge_rock') rock = rock || material;
    }
  });
  rock = rock || new THREE.MeshStandardMaterial({ name: 'mariokart_bridge_rock', color: 0x817d73, roughness: .96, side: THREE.DoubleSide });

  // A small procedural grass field gives the large shelf a ground read at gameplay distance.
  // The imported Wuhu materials are 2x2 building atlases, not seamless grass tiles; sampling one
  // directly painted a repeating facade across the extension in the live close-up.
  const grassCanvas = document.createElement('canvas');
  grassCanvas.width = 256;
  grassCanvas.height = 256;
  const grassContext = grassCanvas.getContext('2d');
  grassContext.fillStyle = '#6c8750';
  grassContext.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i += 1) {
    const shade = 56 + ((i * 37) % 42);
    grassContext.fillStyle = `rgba(${shade},${shade + 28},${shade - 10},.34)`;
    grassContext.fillRect((i * 73) % 256, (i * 151) % 256, 1 + (i % 3), 1);
  }
  grassContext.strokeStyle = 'rgba(38,58,26,.18)';
  grassContext.lineWidth = 2;
  for (let y = 0; y < 256; y += 48) {
    grassContext.beginPath();
    grassContext.moveTo(0, y);
    grassContext.lineTo(256, y);
    grassContext.stroke();
  }
  const grassTexture = new THREE.CanvasTexture(grassCanvas);
  grassTexture.wrapS = THREE.RepeatWrapping;
  grassTexture.wrapT = THREE.RepeatWrapping;
  grassTexture.colorSpace = THREE.SRGBColorSpace;
  const topMaterial = new THREE.MeshStandardMaterial({
    name: 'mariokart_atoll_grass', map: grassTexture, roughness: 1, metalness: 0,
    side: THREE.DoubleSide
  });

  // The west edge overlaps the existing land bridge at x -19.4; the east and south edges sit
  // beyond the new -11 / -38 stage corners so all four downward corner rays land on the top.
  const outline = [
    [-19.4, -38.3], [-16.8, -38.5], [-14.3, -38.2], [-12.1, -38.45], [-9.8, -38.2],
    [-9.5, -36.2], [-9.8, -34.1], [-9.4, -32.0], [-9.7, -29.8], [-9.4, -27.6],
    [-9.7, -25.4], [-9.4, -23.2], [-9.7, -21.0], [-9.4, -18.8], [-9.7, -16.6],
    [-9.4, -14.4], [-9.7, -12.2], [-9.6, -9.7], [-12.4, -9.5], [-15.1, -9.7],
    [-17.6, -9.5], [-19.4, -9.7]
  ];
  const topY = .36;
  const bottomY = -4.45;
  const contour = outline.map(([x, z]) => new THREE.Vector2(x, z));
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);
  const positions = [];
  const uvs = [];
  const indices = [];
  for (const [x, z] of outline) {
    positions.push(x, topY, z);
    uvs.push(x * .2, z * .2);
  }
  for (const face of faces) {
    let [a, b, c] = face;
    const crossY = (outline[b][1] - outline[a][1]) * (outline[c][0] - outline[a][0])
      - (outline[b][0] - outline[a][0]) * (outline[c][1] - outline[a][1]);
    if (crossY < 0) [b, c] = [c, b];
    indices.push(a, b, c);
  }
  const topGeometry = new THREE.BufferGeometry();
  topGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  topGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  topGeometry.setIndex(indices);
  topGeometry.computeVertexNormals();

  // Build the rock skirt as independent quads. The material is double-sided, so the winding
  // does not hide the outer face from the camera or the collision bake.
  const sidePositions = [];
  const sideUvs = [];
  const sideIndices = [];
  for (let i = 0; i < outline.length; i += 1) {
    const [ax, az] = outline[i];
    const [bx, bz] = outline[(i + 1) % outline.length];
    const base = sidePositions.length / 3;
    sidePositions.push(ax, topY, az, bx, topY, bz, ax, bottomY, az, bx, bottomY, bz);
    sideUvs.push(0, 0, 1, 0, 0, 1, 1, 1);
    sideIndices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const sideGeometry = new THREE.BufferGeometry();
  sideGeometry.setAttribute('position', new THREE.Float32BufferAttribute(sidePositions, 3));
  sideGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(sideUvs, 2));
  sideGeometry.setIndex(sideIndices);
  sideGeometry.computeVertexNormals();

  const shelf = new THREE.Group();
  shelf.name = 'mariokart_atoll_shelf';
  const top = new THREE.Mesh(topGeometry, topMaterial);
  top.name = 'mariokart_atoll_shelf_top';
  top.receiveShadow = true;
  top.castShadow = false;
  const skirt = new THREE.Mesh(sideGeometry, rock);
  skirt.name = 'mariokart_atoll_shelf_rock';
  skirt.receiveShadow = true;
  skirt.castShadow = false;

  // Low rock outcrops sit outside the new rectangle's corners and break up the flat silhouette
  // without adding obstacles to the playable centre.
  const rocks = new THREE.Group();
  rocks.name = 'mariokart_atoll_shelf_rocks';
  for (const [x, z, size, squash] of [
    [-10.2, -35.2, 1.7, .62], [-10.4, -29.8, 1.25, .56], [-9.9, -13.7, 1.45, .58],
    [-17.0, -37.6, 1.15, .54], [-12.0, -37.8, .9, .5]
  ]) {
    const boulder = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), rock);
    boulder.name = 'mariokart_atoll_shelf_boulder';
    boulder.position.set(x, topY - .08, z);
    boulder.scale.set(1, squash, .82);
    boulder.rotation.y = (x + z) * .37;
    boulder.receiveShadow = true;
    boulder.castShadow = false;
    rocks.add(boulder);
  }
  shelf.add(top, skirt, rocks);
  group.add(shelf);

  const result = {
    name: shelf.name,
    stageTop: topY,
    bounds: { x0: -19.4, x1: -9.4, z0: -38.5, z1: -9.5 },
    vertices: outline.length,
    faces: faces.length
  };
  const root = stateRoot();
  root.mariokartAtollShelf = result;
  if (typeof window !== 'undefined') window.__browserSmashMariokartAtollShelf = result;
  return result;
}

/**
 * Lazily load only the selected authored Blender arena. Existing Three.js set dressing
 * stays visible as a fallback; a failed GLB never prevents a match from loading.
 */
export async function setCinematicArena(key, scene) {
  activeArenaKey = key;
  hideAllArenaAssets();

  const config = MODEL_PATHS[key];
  if (!scene || !config) {
    stateRoot().activeArena = key;
    return null;
  }

  if (!arenaLayer) {
    arenaLayer = new THREE.Group();
    arenaLayer.name = 'Blender cinematic arena assets';
    scene.add(arenaLayer);
  } else if (arenaLayer.parent !== scene) {
    arenaLayer.parent?.remove(arenaLayer);
    scene.add(arenaLayer);
  }

  stateRoot().activeArena = key;
  const cached = loadedArenas.get(key);
  if (cached?.group) {
    cached.group.visible = activeArenaKey === key;
    stateRoot().arenas[key] = { status: 'loaded', meshCount: cached.meshCount, url: cached.url, cached: true };
    return cached.group;
  }

  if (cached?.promise) return cached.promise;

  const url = new URL('../../assets/arenas/' + config.file, import.meta.url);
  url.searchParams.set('v', ASSET_VERSION);
  stateRoot().arenas[key] = { status: 'loading', url: url.href };

  const promise = new Promise((resolve, reject) => {
    loader.load(url.href, gltf => {
      const group = gltf.scene;
      group.name = 'Blender arena · ' + key;
      let meshCount = 0;
      // The imported islands, cliffs and airport are backdrops kilometres across. Letting them
      // cast shadows put the whole duel deck in their shade (blue ambient-only stone) and made
      // the shadow pass rasterise terrain that cannot realistically shade the fighters.
      const backdropNodes = new Set(['konoha_village', 'skyloft_island', 'wuhu_island', 'sunshine_airport']);
      group.traverse(node => {
        if (node.isMesh) {
          meshCount++;
          node.castShadow = !backdropNodes.has(node.name);
          node.receiveShadow = true;
          if (node.material) {
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            for (const material of materials) {
              material.needsUpdate = true;
            }
          }
        }
      });
      if (meshCount < (config.minMeshes ?? MIN_ARENA_MESHES) || !group.getObjectByName(config.marker)) {
        const error = new Error('Arena GLB failed structure check for ' + key + ' (' + meshCount + ' meshes)');
        stateRoot().arenas[key] = { status: 'error', message: error.message, url: url.href };
        loadedArenas.delete(key);
        reject(error);
        return;
      }
      // The courtyard capture needs the uncleaned placeholder for its before frame. Keep this
      // opt-out test-only; normal matches always strip the duplicate slab.
      if (key === 'skyloft' && globalThis.window?.__browserSmashSkyloftDeckCleanup !== false) {
        stripSkyloftPlazaSlab(group);
      }
      if (key === 'mariokart') {
        stripMariokartApron(group);
        buildMariokartAtollShelf(group);
      }
      if (key === 'konoha_overlook') stripKonohaOverlook(group);
      // Asgard is the one authored arena whose look is driven by material balance rather than by
      // geometry: seven untextured materials, four of them emissive across 87% of the primitives.
      // `__browserSmashAsgardTuning = false` renders the untouched materials so a before/after can be
      // shot with an identical camera.
      if (key === 'asgard' && globalThis.window?.__browserSmashAsgardTuning !== false) {
        const tuning = tuneAsgardMaterials(group);
        stateRoot().asgardTuning = tuning;
        // Real geometry, built on the mounted palace's own measured surfaces: plinths, cornices,
        // pilasters, panel bands, fountain rim blocks, pier bases and capitals.
        const architecture = buildAsgardArchitecture(group);
        stateRoot().asgardArchitecture = architecture;
        globalThis.window.__browserSmashAsgardArchitecture = architecture;
        globalThis.window.__browserSmashAsgardArchitectureMeshes = group.userData.asgardArchitectureMeshes || [];
        // Measured courtyard rim on the real town-square edge. Stays opt-in (?courtyardBand=1) until the
        // stone reads as monumental Asgardian construction at gameplay distance.
        // The measured gilt-inlay square (46 x 46) turned out to be a floor motif inside a much larger
        // marble plaza, not the courtyard edge: in the captured frames the band reads as a low dark
        // kerb in mid-plaza instead of the retaining wall this pass was meant to build. The geometry
        // and its tests are kept for the corrected placement, but it must not ship as a visible
        // defect. Visual architecture only: collision stays with world/arena_layouts.js.
        const courtyardBand = /(?:^|[?&])courtyardBand=1(?:&|$)/.test(globalThis.location?.search || '');
        if (courtyardBand) {
          const courtyard = buildAsgardCourtyard(group);
          stateRoot().asgardCourtyard = courtyard;
          globalThis.window.__browserSmashAsgardCourtyard = courtyard;
          globalThis.window.__browserSmashAsgardCourtyard = courtyard;
          globalThis.window.__browserSmashAsgardCourtyardMeshes = group.userData.asgardCourtyardMeshes || [];
        }
        console.info('Asgard material tuning applied', tuning.tuned.length, 'materials;',
          architecture.added, 'architecture parts in', architecture.meshCount, 'meshes');
      }
      // Hogwarts: real stone geometry on the hall's own named parts (piers, arches, keystones,
      // capitals, ribs, lancet frames). `__browserSmashHogwartsArchitecture = false` mounts the hall
      // untouched so a capture can shoot the same camera with and without the detail.
      if (key === 'hogwarts' && globalThis.window?.__browserSmashHogwartsArchitecture !== false) {
        const architecture = buildHogwartsArchitecture(group);
        stateRoot().hogwartsArchitecture = architecture;
        globalThis.window.__browserSmashHogwartsArchitecture = architecture;
        globalThis.window.__browserSmashHogwartsArchitectureMeshes = group.userData.hogwartsArchitectureMeshes || [];
        console.info('Hogwarts architecture built:', architecture.added, 'parts in', architecture.meshCount, 'meshes');
      }
      group.visible = activeArenaKey === key;
      // Read-only handle for the title composition and its verification: the title camera has to be
      // authored against the geometry that actually mounted, not against remembered coordinates.
      globalThis.window.__browserSmashAuthoredGroup = group;
      globalThis.window.__browserSmashAuthoredKey = key;
      arenaLayer.add(group);
      // Architectural stone has to be tuned on the group that actually contains the arena meshes.
      // The caller used to pass a different container, so the pass traversed an empty tree and every
      // Great Hall surface kept its flat untextured factor.
      if (key !== 'asgard' && globalThis.window?.__browserSmashStoneTuning !== false) {
        const stone = tuneArchitecturalStone(group, key);
        stateRoot().stoneTuning = stone;
        globalThis.window.__browserSmashStoneTuning = stone;
        // The imported Florida sky and water IBL tint the airport asphalt blue and draw caustic
        // ripples across it. Keep the runway a flat dark service surface so the markings and the
        // aircraft read cleanly; this is the only arena with a large man-made apron.
        if (key === 'mariokart') {
          const flat = new THREE.MeshBasicMaterial({ name: 'mariokart_asphalt', color: 0x50545a });
          group.traverse(node => {
            if (!node.isMesh) return;
            const mats = Array.isArray(node.material) ? node.material : [node.material];
            if (!mats.some(mat => mat?.name === 'mariokart_asphalt')) return;
            node.material = Array.isArray(node.material)
              ? node.material.map(mat => (mat?.name === 'mariokart_asphalt' ? flat : mat))
              : flat;
          });
        }
        console.info('Architectural stone applied to ' + key + ':', stone.tuned.length, 'materials');
      }
      // Broadcast furniture is real geometry on the authored ring: screens, a four-star-ball
      // beacon, pylons and a centre medallion. It is opt-out for before/after captures.
      if (key === 'tournament' && globalThis.window?.__browserSmashTournamentBroadcast !== false) {
        const broadcast = buildTournamentBroadcast(group);
        stateRoot().tournamentBroadcast = broadcast;
        globalThis.window.__browserSmashTournamentBroadcast = broadcast;
        console.info('Tournament broadcast dressing:', broadcast.added, 'parts in', broadcast.meshes, 'meshes');
      }
      loadedArenas.set(key, { group, meshCount, url: url.href, promise: null });
      stateRoot().arenas[key] = { status: 'loaded', meshCount, url: url.href, cached: false };
      resolve(group);
    }, undefined, error => {
      stateRoot().arenas[key] = { status: 'fallback', message: String(error?.message || error), url: url.href };
      loadedArenas.delete(key);
      reject(error);
    });
  });

  loadedArenas.set(key, { group: null, meshCount: 0, url: url.href, promise });
  try {
    return await promise;
  } catch (error) {
    // Keep the procedural map alive; allow a later selection to retry the GLB.
    loadedArenas.delete(key);
    console.warn('Blender arena asset failed; procedural arena remains enabled:', key, error);
    return null;
  }
}
