# World restoration report

Baseline branch: `work/gameplay-and-polish` (461 commits, ahead of `origin/main` at `38cd77c`).
This report covers what exists for each world, what was recovered, what was built, and what
actively blocks the rest. It is deliberately blunt: a world is only marked playable where a test
loaded it and spawned fighters on it.

## How worlds are built here

There is one world registry, `public/js/worlds/world_catalog.js`. It owns:

- a geometry builder per world (`buildKonoha`, `buildNYC`, …) that appends primitive parts;
- a palette, a theme (sky/fog/light colours), stage lighting, and a sky preset per world;
- a list of battle locations: a playable rectangle, two spawn points, a camera hint, a list of
  exits to neighbouring stages, and (optionally) `ringOut`/`fallBelow`;
- collision volumes derived from the solid parts of that world (`blocksFromParts`).

`world_builder.js` merges those parts into one draw call per material, so a whole world costs
17–31 draw calls. `public/js/world/arena_layouts.js` turns every location into an
`ARENA_LAYOUTS` entry: the map pickers, the arena select screen, and the match code all read that
one registry, which is why a stage added to the catalog appears in the menu with no extra wiring.

Locations inside a world are rectangles over the same built geometry. Moving through a marked
doorway (lit ring + light column) starts the destination stage's round on its own spawns. That is
a deliberate stage-to-stage transition, **not** a streaming open world.

## The six worlds

| # | World | Original implementation found | Files recovered / reused | Existing assets reused | New assets installed | Playable status | Collision & spawns | Map selection | Flight / aerial | Tests actually run | Remaining blockers |
|---|-------|-------------------------------|--------------------------|------------------------|----------------------|-----------------|--------------------|---------------|-----------------|--------------------|--------------------|
| 1 | **Asgard** — 6 locations | Yes: `buildAsgard` in `world_catalog.js` (commit `f536a07`), plus the authored `public/assets/arenas/asgard.glb` | `world_catalog.js`, `arenas/cinematic_arenas.js`, `mapThemes` in `main.js` | `asgard.glb` (authored arena), shared surface textures | None needed | PLAYABLE — NEEDS POLISH | 246 solid volumes; Royal Palace Court, Throne Hall, Marketplace, Rainbow Bridge, Bifrost Realm, Outer Floating Isle all pass spawn/collision checks | Six stage cards under the Asgard tab; the walled city, terraces and royal approach are walkable in free roam | Flight works (shared flight controller); bridge and isle give real aerial room | `test:worlds`, `test:worlds:browser` (loads every Asgard stage, spawns fighters, fights), `test:feel` | Ziggurat and distant spires are facade; no continuous walk from palace to isle |
| 2 | **Hogwarts** — 9 locations | Yes: `buildHogwarts`, plus `hogwarts.glb` | Same registry path; `roofCastle`/`floorHall` surfaces | `hogwarts.glb` | None needed | PLAYABLE — NEEDS POLISH | 254 solid volumes; Great Hall is a real interior with a floor, tables and candles | Nine stage cards; the wall-walk and cliff path are walkable on foot | Flight works; courtyards and lake give outdoor room | `test:worlds`, `test:worlds:browser`, `test:smoke` | Castle exterior beyond the named stages is backdrop; Hagrid's Hut / Forbidden Forest / Quidditch exist as themed areas, not full interiors |
| 3 | **Death Star** — 11 locations | Yes: `buildDeathStar`, plus `deathstar.glb` | Same registry path | `deathstar.glb` | None needed | PLAYABLE — NEEDS POLISH | 368 solid volumes (the densest world); hangar spine and trench corridor are built as geometry | Eleven stage cards; hangar mezzanine and command gallery are second levels | Flight works; interior ceilings use the non-shadowing interior lighting rig | `test:worlds`, `test:worlds:browser`, `test:smoke` | No moving turbolifts; outer-hull stage is a deck, not a station exterior |
| 4 | **Dragon Ball World Tournament** — 11 locations | Yes: `buildDragonBall` (island + districts) and `tournament.glb` | Same registry path | `tournament.glb` | None needed | PLAYABLE — NEEDS POLISH | 225 solid volumes; Ring Out Cliffs use `ringOut` + `fallBelow`, so knockback past the edge scores a ring-out | Eleven stage cards | Flight works; King Kai's planet is a real 62 m sky island | `test:worlds` (including ring-out assertions), `test:worlds:browser`, `test:combat` | No breakable scenery; crowd is scenery, not NPCs |
| 5 | **Hidden Leaf Village** — 13 locations | Yes, as of commit `e09e215` (built in this session on the existing registry) | `world_catalog.js`, `sky_environment.js`, `SmashCamera.js` | Shared surface textures, shared prefab fighters | None needed | RESTORED AND TESTED (village) | 563 solid volumes; Hokage Rock is a real 24 m terrace; Forest of Death has 26–40 m giants with trunk collision | Thirteen stage cards under the Konoha tab (Valley of the End included) | Flight works; Hokage Rock and the forest canopy give vertical room | `test:worlds` (47,329 assertions), `test:worlds:browser` (831 checks across all 60 stages), `test:explore`, screenshots of the village, rooftops and the valley | Valley of the End is now stage 13 of this world (doorway from the Forest of Death, and walkable in free roam), as a bridge arena in a canyon with two 34 m statues. The separate authored `finalvalley` arena (`final_valley.glb`) still exists for the legacy map key |
| 6 | **New York / Stark Tower** — 10 locations | Partly: the legacy `starktower` arena (Helicarrier deck / Stark penthouse) only | `buildNYC` rebuilt in this pass: three districts (financial/commercial/residential), street furniture, Stark Tower lobby interior | `helicarrier.glb` remains the legacy arena; shared surface maps | 11 CC0 PBR surface families (Poly Haven, `public/assets/textures/`) | PLAYABLE, TESTED — NEEDS POLISH | 359 solid volumes; street, avenue, times square, park, docks, midtown roof (44.6 m), Stark deck (80.6 m), Stark crown (120.6 m), bridge (16 m) and the tower lobby all pass spawn/collision checks | Ten stage cards under the New York tab | Flight is the point of the map: tower, bridge and roof decks sit in open air with building collision | `test:worlds` (38,667 assertions), `test:worlds:browser` (818 checks, all 59 stages), `test:explore`, screenshots of plaza, avenue, Times Square and the lobby | No upper-floor tower interiors; vehicles static; far shore backdrop only |

Totals after this session: **6 worlds, 60 battle locations, 2,015 solid collision volumes.**

## Recovery findings from Git history and older branches

- `origin/main` is **behind** this branch. It sits at `38cd77c` and does not contain the world
  system at all. Nothing was lost by that: this branch (`work/gameplay-and-polish`) is strictly
  newer and every commit listed below is intact.
- `origin/feature/iconic-3d-worlds`, `origin/work/worlds-and-environments` and
  `origin/work/gameplay-and-polish` all carry the same early stage system: root-level
  `mapLoader.js` + `maps.json` describing three GLB stages (`rainbow_road`,
  `grand_archive`, `valley_of_ends`) that load `/assets/stages/*.glb` and an HDRI from
  `/assets/envs/`.
- **Those files do not exist.** `public/assets/stages/` and `public/assets/envs/` are absent, and
  the only import of the loader (root `main.js`, which is not the served entry point) points at
  them. The three stage definitions are therefore recovered *metadata*, not recovered maps, and
  they are not wired into the live game. They are left in place rather than deleted; adopting them
  would mean supplying the three GLBs and the HDRI.
- The five authored arena GLBs that do exist (`asgard`, `deathstar`, `helicarrier`, `hogwarts`,
  `tournament`) plus `final_valley.glb` are all present and load (`Authored arena loaded:
  hogwarts.glb, 603 meshes` in the smoke test). They are used as the visible arena for their map
  keys and are never required — a missing GLB falls back to the procedural build.
- Character models: `character_models.glb` (26 MB) and `character_weapons.glb` (3.7 MB) are
  present and load. The **user-supplied Goku FBX and Iron Man Mark V glTF are still absent**, and
  the manifest keeps both entries disabled. Iron Spider is staged against a Sketchfab model that
  is not downloaded. All three fall back to procedural fighters and say so at runtime.

## What changed in this session

| File | Change |
|------|--------|
| `public/js/worlds/world_catalog.js` | Added `buildKonoha` (12 locations) and `buildNYC` (9 locations), their palettes, themes, stage lighting, and both world entries; the Konoha polish pass (Ichiraku hall, gates courtyard, Forest of Death giants, wider plateau) |
| `public/js/SmashCamera.js` | The overhead camera no longer opens below a raised stage's floor and aims at the fighters' chest instead of a fraction of their height (Hokage Rock 24 m, Stark crown 120 m, King Kai 62 m) |
| `public/js/sky_environment.js` | `konoha` and `nyc` sky presets |
| `public/js/main.js` | World list comments updated; every added location is picked up by the existing `WORLD_LOCATIONS` loop |
| `public/js/world/arena_layouts.js` | Comment updated (five → six worlds) |
| `scripts/test-worlds.mjs` | Six worlds, 59 locations; Konoha and New York material assertions; New York lookup assertion; free-roam contract checks (roam rectangle, recovery floor) |
| `public/js/worlds/world_catalog.js` | New York detail pass: three districts with their own massing (stepped financial towers, storefront blocks, brick walk-ups with stoops/fire escapes/water towers), rooftop kits, street furniture (hydrants, bins, shelters, carts, taxis, trucks, lane dashes), Stark Tower base rebuilt as walls + roof slab around a walkable lobby interior, new `nyc_stark_lobby` stage, wheel-friendly palette tuning |
| `public/js/worlds/world_textures.js` | CC0 photographic surface pipeline: loads albedo/normal/roughness per family, upgrades materials in place, keeps the procedural canvas fallback |
| `public/js/worlds/world_builder.js` | UV projection now divides by the material's surface tile size, so one texture instance serves a whole family; applies normal/roughness maps |
| `public/assets/textures/**`, `scripts/fetch-world-textures.py` | 11 CC0 PBR families (1.6 MB) from Poly Haven with `manifest.json` recording asset ids, authors, licence and source, and the reproducible fetch/prep script |
| `vite.config.js` | Copies `/assets/textures/**` into the build |
| `public/js/SmashCamera.js` | Explore mode uses a 54° walk-around lens instead of the duel lens |
| `scripts/test-worlds-browser.mjs` | Six world tabs; every world must expose at least five stages |
| `README.md` | World counts, Konoha stage list, material notes |
| `docs/WORLD_RESTORATION_REPORT.md`, `docs/RECOVERY_STATUS.md` | This report and the feature status ledger |

## Second pass: all six worlds, not just New York

New York was the first world to get the district treatment; this pass carries the same work into
the other five, and adds the one world-level destination that was still missing.

| World | Solid volumes before → after | What was built |
|---|---|---|
| Dragon Ball Z | 178 → 225 | ~150 spectators seated on all four terrace tiers, vendor carts, crate stacks, festival-light strings around the plaza, a market street on the approach road, shop awnings/signs/lantern strings in East City, tyre stacks and a heavy bag on the training ground, and a railed cliff lookout |
| Asgard | 142 → 246 | A 48-segment crenellated city wall with towers and two gatehouses, two residential terraces (16 gold-roofed houses, lanterns, gardens), a processional stair with statue plinths and braziers up to the palace, market awnings/crates/lantern posts, and 18 distant towers beyond the wall |
| Death Star | 254 → 368 | A full-width hangar mezzanine with a glazed control booth, fuel drums, missile racks, floodlight rig and stairs at both ends; a parked turbolift shaft with open doors and a maintenance ladder; a two-sided command-deck gallery with console rows and bridges to the central catwalk; a gantry crane, hanging droid shells, welding arms, a supervisor booth and parts bins in the droid factory |
| Hogwarts | 141 → 254 | Arcaded cloisters from the courtyard to both castle ranges (kept outside the stage rectangle), a switchback stair tower up to a battlement wall-walk with crenellations, braziers and two tower decks, and a plank cliff path with lookouts on the western rim |
| Hidden Leaf | 309 → 563 | A rooftop route over Main Street: timber roof decks, plank bridges with steps between them, a cross-boulevard bridge, and a street stair up to the first deck. Plus the **Valley of the End** as a real stage: canyon walls, river, waterfall and spray, two 34 m guardian statues with stone blades, a central stone crossing, a ruined footbridge, banks with moss/grass edges, boulder piles against the cliffs, and a trail from the Forest of Death |
| New York | 359 | Unchanged in this pass (built in the previous one) |

The Valley of the End is stage 13 of the Hidden Leaf world, reached by the doorway south out of the
Forest of Death and by walking there in free roam — inside the same geometry and the same exit
graph, so the earlier "no route to the valley" gap is closed without a cross-world transition. It is
a bridge arena: both spawns are on the stone crossing over the river.

Death Star lighting was also corrected. The rig ran at sun 2.2 / hemisphere 1.35 / exposure 1.28,
which washed the hangar floor to pale lavender and hid the new CC0 plate texture; it is now
1.7 / 0.98 / 1.14 with a steel-blue rim and slightly deeper plating, so the panels, seams and
light strips separate again.

## Verification actually performed

```
npm run build                 pass  (1,196 kB bundle, 3.1 s)
npm run test:worlds           pass  47,329 assertions, 60 locations, 6 worlds
npm run test:worlds:browser   pass  831 checks, 60 locations, 6 worlds, no page errors
npm run test:explore          pass  49 checks (free roam + explore-only mouse look)
npm run test:combat           pass  394 checks
npm run test:gameplay         pass  48 checks
npm run test:smoke            pass  both entry points, authored Hogwarts arena loaded
```

Screenshots of the new work were rendered from the running game and inspected: the DBZ market and
ring, the Asgard terraces and market, the Hogwarts courtyard/cloister, the Death Star hangar and
droid factory, and the Valley of the End (bridge duel plus free-roam walk). Two problems the
screenshots caught were fixed in the same pass: the Hogwarts cloister originally intruded 6 m into
the courtyard fight rectangle, and the Death Star floor was blown out.

## Honest gaps against the reference images

1. **Art direction.** Worlds are still procedural primitives, now surfaced with CC0 photographic
   albedo/normal/roughness maps (11 families, Poly Haven). That closes the "plastic" gap but not
   the geometry gap: no authored mesh kits (building pieces, props, foliage) exist in the repo, so
   silhouettes remain simple boxes, cylinders and cones. Closing that needs a GLB kit pipeline.
2. **No world-overview screen.** The arena select screen lists stages as cards grouped by world
   tab. There is no numbered map overview with per-location previews like the reference sheets.
   The data to drive one exists (`WORLD_LOCATIONS`, each with `world`, `label`, `kind`, `layout`);
   the UI does not.
3. **Elevated areas and routes.** The Hogwarts wall-walk, the Death Star mezzanine and gallery and
   the Konoha rooftop chain are all reachable on foot, but Asgard's raised terraces and the
   Valley of the End's rims are not linked to the ground by stairs yet.
4. **Interiors.** Konoha (Hokage Administration, Ichiraku, Hospital), the Great Hall, the Throne
   Hall, the Stark Tower lobby and the Death Star rooms are real interiors. The tower still has no
   upper-floor rooms, the Death Star spaces beyond the hangar mezzanine and command gallery are
   single-storey, and the turbolift is parked (static geometry, not a moving car).
5. **Characters.** The user's Goku and Iron Man packages are not in the repository. Until they are
   installed (`node scripts/install-character-assets.mjs <package>`), those fighters use
   procedural bodies and the game reports the fallback.
