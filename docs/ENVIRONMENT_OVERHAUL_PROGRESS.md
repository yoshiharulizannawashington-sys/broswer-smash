# Browser Bros — environment overhaul progress (persistent)

> Read this before continuing. This records the real world inventory, evidence, asset decisions and
> the exact next task. **No world is COMPLETE.** The dependency-ordered production plan is in
> `docs/PRODUCTION_ROADMAP.md`; world work is Stage B there and starts only after the fighter gate. Batch 1 was audit + acquisition; Batch 2 mounted one
> detailed asset in New York; Batch 3 ships the first showcase slice: a rebuilt Stark Tower frontage,
> a cleared helipad roof and a verified lazy skyline landmark. Batch 4 (2026-11-14) upgrades the DBZ cities, campus and tournament; the remaining worlds are still AUDITED.

Date: 2026-11-14. Branch `freebuff/726ce0c51041fd4f569ce7bd`. No commits, pushes, resets or discards.
Production work is preserved; this pass changes `public/js/worlds/world_catalog.js`,
`public/js/worlds/nyc_skyline.js`, `docs/`, `artifacts/` and adds `scripts/capture-nyc-showcase.mjs`.
It also adds the DBZ landmark loader, tournament dressing and live verifier (section 6). The earlier imported-character migration changes remain uncommitted in the same worktree.

## 1. The eight worlds as they actually exist

| Required world | Internal system | Real key(s) | Source | State |
| --- | --- | --- | --- | --- |
| Konoha | procedural world + imported landmarks + imported village arena | `konoha` (13 locations), `konoha_overlook` | `public/js/worlds/world_catalog.js`; `public/js/worlds/konoha_landmarks.js`; `public/assets/arenas/konoha_overlook.glb` | **PLAYABLE / VILLAGE-STAGE VERIFIED.** The 13-location procedural village is unchanged. The dedicated Konoha arena now mounts the kyrox village and Hokage cliff with **no authored overlook**: the Blender source exports only the joined imported village and the loader marker — the old 48×34 m terrace, cliff plinth, rails, bridge, gate, banners, lanterns and joints are gone. The fight uses a 22×10 m street/grass intersection inside the village at x −14..8, z −108..−98; a 1 m heightfield follows the imported surface and the village walls bake 31 collision blocks. Live test passes selection, grounded spawns, camera, natural ground under spawns/corners, wall collision and no page errors (`artifacts/environment/arenas/live/konoha_overlook.png`). The older Main Street/Hokage Rock/Village Gates cameras were not rebuilt. |
| Skyloft | authored imported arena | `skyloft` | `public/assets/arenas/skyloft.glb`; `assets/blender/environments/skyloft/` | **PLAYABLE / TERRAIN-GROUNDED.** Dola island, 44×34 m terrace, banners/braziers and authored camera. A runtime heightfield samples the island grass and rock so fighters walk the real rise instead of clipping through it; the plaza deck remains the fallback. Live test verifies a grounded slope and a walking descent; academy and floating village visible. SwiftShader capture only. |
| Mario Kart / Wuhu + Sunshine Airport | authored combined arena | `mariokart` | `public/assets/arenas/mariokart.glb`; `assets/blender/environments/mariokart/` | **PLAYABLE / NATURAL-SURFACE + ATOLL SHELF VERIFIED.** Wuhu's west headland and the Sunshine Airport atoll remain one continuous landmass (28.2 × 68.9 m bounds overlap). At mount the loader removes the reclaimed 33 m-radius apron, runway, taxiway and all 28 associated marking pieces, leaving the imported airport and sea as scenery. A 34×28 m natural battlefield spans Wuhu's west headland and a new grass-and-rock land bridge at x −22.2..−19, z ≈−35.2, whose eastern end lands on and extends past the airport's solid western atoll rim at x −20, z −35..−36. A runtime low atoll shelf (mariokart_atoll_shelf, x −19.4..−9.4, z −38.5..−9.5, top 0.36 m) continues that bridge east across the rim, with a procedural grass top, rock skirt and shoreline boulders; the new east corners are solid shelf ground rather than removed runway. A 1 m terrain heightfield samples the actual grass, rock and bridge (1,015/1,015 valid samples). A one-time collision bake adds 101,798 wall triangles, 2,381 steep-face triangles and 2,183 low-face triangles as 166 solid blocks, including 211 new steep cells and 46 new low-boulder cells; a narrow runtime corridor clears the six tall blocks that crossed the authored land bridge, leaving 160 active blocks; low tops are raised to ground + 0.9 m, and the heightfield skips a steep-face or low-boulder block while the fighter is below it. Both spawns and all four arena corners hit natural, bridge or atoll-shelf geometry; live-step probes push the fighter out of a cliff/rock block, a low boulder and a steep face; the bridge mesh and rising top are asserted live; a live keyboard walk from Wuhu at x -23, z -36.05 crosses the bridge and reaches the airport side beyond x -19; every fight check passes. SwiftShader capture only. |
| Valley of the End | authored arena + procedural location | `finalvalley`; `konoha_valley` | `public/assets/arenas/valley_of_the_end.glb`, `valley_of_the_end.js` | AUDITED. 16 meshes, 5.4×, original preserved. |
| Hogwarts | procedural world + authored arena | `hogwarts` (25 locations); authored `hogwarts` | `world_catalog.js`; `hogwarts.glb` (603 meshes, 0 textures) | AUDITED. Castle is textureless; texture pass is the highest-value next step. |
| Asgard | procedural world + authored arena | `asgard` (6 locations); authored `asgard` | `world_catalog.js`; `asgard.glb` 3.3 MB | AUDITED. Existing material/architecture passes present. |
| New York | procedural world | `nyc` (10 locations) | `world_catalog.js` `buildNYC()` | **FIRST SHOWCASE SLICE — PARTIAL.** Playable Stark Tower has a steel curtain wall, lit STARK wordmark, arc reactor, Stark Expo roundel and a marked helipad/mast roof: 8,557 parts / 37 draw calls / 359 collision blocks. Imported Avengers Tower is a separate skyline landmark at `(-130, 1.2, -200)`, 187,213 tris / 5 meshes / 12.5 MB, with a dusk emissive lift and verified lazy hide/show. The plaza still does not frame the backdrop because the 180 m tower sits behind the playable crown; the roof does. |
| SHIELD Helicarrier | authored arena | `starktower` (`helicarrier.glb`) | `cinematic_arenas.js`, `arena_layouts.js` | AUDITED. 1.8 MB authored deck/interior. |
| Dragon Ball Z | procedural world + authored tournament | `dbz` (12 locations); `tournament` | `world_catalog.js`; `tournament.glb` 1.2 MB | **UPGRADED / LIVE-VERIFIED.** West City, East City and Capsule Corporation rebuilt procedurally; the supplied tournament gate is reused as East City's north entrance; the authored tournament has broadcast dressing. **Planet Namek is not a separate location.** |

Top-level map options: `finalvalley`, `tournament`, `starktower`, `asgard`,
`hogwarts`, `skyloft`, `mariokart`, `konoha_overlook`. World locations load through
`applyMap` / the world-location picker; the three imported arenas load their Blender GLB through
`cinematic_arenas.js`.

## 2. Evidence

| Capture | Path | What it shows |
| --- | --- | --- |
| Konoha first frame | `artifacts/environment/konoha/baseline-konoha-hokage-rock.png` | Camera still transitioning; obstruction. |
| Konoha settled | `artifacts/environment/konoha/baseline-konoha-settled.png` | Playable village/roof baseline. |
| NYC street baseline | `artifacts/environment/new-york/baseline-stark-plaza.png` | Street-level fight view before the skyline pilot. |
| NYC tower, clean diagnostic frame | `artifacts/environment/new-york/after-skyline-tower-clean.png` | Mounted HD tower in the city. Diagnostic camera; HUD hidden; not normal gameplay framing. |
| NYC deck match | `artifacts/environment/new-york/after-stark-deck-match.png` | Match still runs normally; normal camera does not show the backdrop. |
| NYC tower facing, `π` | `artifacts/environment/new-york/tower-facing-pi.png` | South diagnostic view; teal “A” faces the plaza side of the tower. HUD hidden. Not a normal gameplay frame. |
| NYC showcase plaza, live match | `artifacts/environment/new-york/showcase/final-plaza.png` | Stark wordmark, curtain wall and Expo roundel in the real plaza duel camera; loading overlay has faded. |
| NYC showcase roof, live match | `artifacts/environment/new-york/showcase/final-roof.png` | Helipad H, perimeter lights and mast array; imported Avengers Tower behind the crown; solid cloud discs removed. |
| NYC lazy landmark proof | `artifacts/environment/new-york/showcase/final-visibility.json` | Landmark hidden on Konoha Main Street, then visible and still `loaded` from cache back on the plaza. |
| Wuhu expansion, live camera | `artifacts/environment/arenas/wuhu-expansion/live/comparison.png` | Same fixed perspective camera in the live Wuhu match: before, the 22×18 m stage with the land bridge and atoll shelf hidden; after, the current 34×28 m stage with both visible. Goku and Naruto are on the old ground in the before frame and both on the new shelf in the after frame. `live/report.json` asserts camera equality, two-fighter projection on screen, and the hidden/visible expansion objects. |

All captures are cloud-browser/WebGL (SwiftShader) composition evidence, not Chromebook hardware proof.

### Wuhu expansion, live-camera comparison

- Before (`22 × 18 m`): [before.png](../artifacts/environment/arenas/wuhu-expansion/live/before.png)
- After (`34 × 28 m`): [after.png](../artifacts/environment/arenas/wuhu-expansion/live/after.png)
- Same-camera comparison: [comparison.png](../artifacts/environment/arenas/wuhu-expansion/live/comparison.png)

**Method note.** Both frames are captured from the live Three.js `mariokart` match, not from the
orthographic top-down viewer. They use the same fixed perspective camera (`position [0, 15, -38]`,
`target [-27, -1, -24]`, FOV `52`), with the HUD hidden and the CPU frozen.

- The **before** frame hides `mariokart_land_bridge` and `mariokart_atoll_shelf` and frames the
  original `22 × 18 m` play area; Goku and Naruto stand on the old Wuhu ground.
- The **after** frame shows both objects and frames the current `34 × 28 m` play area; both fighters
  stand on the new atoll shelf.

This is a deliberately fixed diagnostic perspective in the live scene, not the default follow
camera, so the two extents can be compared without the camera moving. `live/report.json` records
camera equality, the bridge/shelf visibility flags, both fighters' projected screen positions, and
an empty page-error list. The capture is SwiftShader composition evidence, not hardware or
performance verification.

## 3. Assets acquired, optimised and integrated

| Candidate | World | Licence | Source geometry | Runtime result | Status |
| --- | --- | --- | --- | --- | --- |
| Naruto hiddenly village `bd95c17d…` | Konoha | CC-BY | 56,224 tris | Rock island, not a village | DOWNLOADED / REJECTED |
| Hokage Rock faces `651b82a0…` | Konoha | CC-BY | 16,896 tris | Only two faces | DOWNLOADED / REJECTED |
| Naruto Hokage building `faccc8cc…` | Konoha | CC-BY | 6,664 tris | Lower detail than procedural administration building | DOWNLOADED / REJECTED |
| Asian House Pack `70f36c58…` | Konoha | CC-BY | 3,442 tris | Weaker than existing machiya | DOWNLOADED / REJECTED |
| Avengers Tower 001 `7b0df24b…` | NYC | CC-BY | 147,660 tris, 0 images | Untextured white blockout | DOWNLOADED / REJECTED |
| THE AVENGERS TOWER `c9bcc0ba…` | NYC | CC-BY | 624,048 tris, 12 images | **187,213 tris / 5 meshes / 12.5 MB after decimation and 1K texture cap** | **DOWNLOADED → IMPORTED → OPTIMISED → PARTIALLY INTEGRATED** |

Source archive: `artifacts/asset-fetch/c9bcc0bad326433ea201a2d82aff581d/` (72.2 MB zip,
79 MB extracted, 12 PBR maps at 2K/4K). Original source preserved.
Optimiser: `scripts/prepare_environment_model.py`.
Runtime asset: `public/assets/environments/new-york/avengers_tower.glb`.
Loader: `public/js/worlds/nyc_skyline.js`, hooked once in `applyMap` for `world === 'nyc'`.
Attribution: “THE AVENGERS TOWER” by Mauricio Flores on Sketchfab, CC Attribution.

## 4. What was actually built, and what still looks wrong

Implemented:

- Lazy NYC-only skyline group; no load on other worlds.
- Podium/base block so the tower is grounded outside the authored street grid.
- Placed at `(-130, 1.2, -200)`, outside the roam bounds (`z0 = -140`), so it cannot block fighters,
  exits, camera collision or the playable Stark Tower.
- Playable Stark Tower now has a plaza-scale identity: mullions and floor spandrels, a 31 m STARK
  wordmark, a compact reactor ring, a Stark Expo roundel on the adjacent commercial wall, a
  cantilevered observation ledge and two forecourt repulsor pylons. None of these add collision.
- The 120 m crown is now a helipad: painted H and rings, full perimeter rail, alternating edge
  lights, corner beacons and a three-mast array outside the fight rectangle.
- The sixteen solid cloud ellipsoids that used to sit at roof height were removed; the painted sky
  already supplies cloud and those discs hid the imported tower.
- The imported tower keeps its 5 meshes / 187,213 triangles / 12.5 MB / 1K texture cap and now uses a
  low emissive albedo reuse so it is not a pure black silhouette at dusk.
- Build includes it as `dist/assets/avengers_tower-*.glb`.
- Runtime state exposed at `window.__browserSmashAssets.nycSkyline`.

Runtime measurements:

- Asset request: HTTP 200, 12,506,572 bytes.
- Load duration through the preview proxy: 13.6 s (lazy; first NYC selection).
- World group at the plaza: 37 draw calls, 8,557 parts, 359 collision blocks. The imported landmark
  adds 5 meshes / 187,213 triangles. Final focused capture reported no page or console errors.
- No console errors except the existing `favicon.ico` 404.

Visual review (honest defects):

- The clean frame shows a dark, detailed shaft. The large white shape behind/right of it is **not**
  one of the tower’s five material groups (Vidrio, Metales_2, Helipuesrto, Metlife_03,
  Metlife_Edificio); it is a separate NYC world/background object. It is not part of the landmark.
- **Fixed:** the previous `-π/2` facing hid the “A”. A `π` layer rotation now puts the teal “A”
  on the plaza-facing side; the diagnostic `tower-facing-pi.png` shows it. This is a facing fix, not
  a claim that the A is legible at normal plaza camera distance.
- The duplicate identity is now explicit rather than unexplained: the playable building is branded
  **STARK**, while the backdrop remains the separate Avengers Tower with its teal A. They are not one
  building; unifying or replacing one exterior is still open.
- The roof camera frames the backdrop; the plaza camera does not. Projection checks show the 180 m
  tower's base and mid-section land at or above the top of the plaza frame in every clear placement,
  or behind the financial block. Moving it into the plaza shot would crop the landmark or dwarf the
  playable tower. The plaza is therefore a Stark Tower frontage shot, not an Avengers Tower shot.
- Hide/show is verified in the focused harness: hidden on Konoha, visible and `loaded` from cache on
  return. The earlier “not verified” note is superseded.
- Both final frames are real 1P-match compositions with the loading overlay faded. They are still
  SwiftShader captures, not Chromebook hardware or performance proof.

## 5. Exact next tasks

1. **NYC residual.** Decide the final identity: either scale/reposition the imported backdrop so it
   can enter the plaza frame without dwarfing the playable crown, or replace the playable exterior
   while preserving the lobby/deck/roof colliders. Do not add a second unexplained tower.
2. **Konoha.** Source or author a four-face Hokage Rock relief and textured village architecture.
   Reject the rock-island island asset. Validate scale against a 1.8 m fighter.
3. **Hogwarts.** Texture the authored 603-mesh castle with PBR stone/wood; this is the largest
   visual gain with no new geometry.
4. **Valley of the End.** Baseline captures first; then water/spray/statue surface detail; preserve
   composition and collision.
5. **Asgard, Helicarrier, DBZ.** Continue in the specified order; baseline each before
   edits. Add Planet Namek as a DBZ sub-area, not a new top-level map.
6. **Performance.** Measure in Chrome with the same camera/scene; distinguish software captures from
   hardware results.

## 6. Guardrails

- Preserve all eight worlds and the original Valley of the End.
- Keep source archives and rollback paths; never overwrite the only copy.
- Do not change characters, roster, weapons or combat for environment work.
- Do not call a map upgraded until the asset is mounted, collision/camera checked and captured in the
  actual game.

## 2026-11-11 — Avengers Tower facing/silhouette pass

- Landmark moved from `(0, 1.2, -260)` / `π` to `(-130, 1.2, -200)` / `π + .55`, scale `1`.
  The extra yaw turns the source's broad A-face toward the Stark Tower plaza/roof sightline; it is
  no longer presented edge-on.
- `nyc_stark_plaza` and `nyc_stark_roof` now request `camera: { skyline: true }` and stage yaw
  `.35` / `.6`. `SmashCamera.setStageSkyline()` lowers the authored overhead elevation and adds a
  9° skyline-only FOV opening. Those two stages use `overheadFraming()` directly instead of the
  foreground-composition solver, which otherwise pulled the lens onto the fighters; the generic
  collision shortening still applies.
- The white oval seen behind the tower is procedural sky/cloud, not the imported model: it remains
  after the imported `Helipuesrto` mesh is hidden, and was therefore not removed as tower geometry.
  The imported helipad is retained.
- Evidence: `artifacts/environment/new-york/roof-skyline-final.png` shows the imported dark tower
  and teal A clear of the playable crown from the roof. `plaza-skyline-final.png` is the matching
  plaza capture; the imported tower is still not readable there because the playable tower and
  foreground city occlude it. A right-side trial also failed and was not committed to source.
- Checks: camera 25/25, worlds 73,883 assertions, build, asset validation, `git diff --check` all
  pass. These are cloud/SwiftShader composition captures, not hardware visual or performance proof.
- State remains **PARTIAL / NOT COMPLETE**. Next: solve the plaza sightline without moving the
  playable tower, then recapture both views in a real gameplay session and on hardware.

> The recapture and lazy hide/show work in that note are completed by the showcase slice below;
> the plaza sightline itself remains unresolved for the reasons recorded there.

## 2026-11-11 — First showcase-world slice: Stark Tower frontage

Scope: New York only. No roster, combat, controls, camera solver or playable stage rectangle was
changed. The source diff is `public/js/worlds/world_catalog.js` (+110/−11), the new
`public/js/worlds/nyc_skyline.js` loader refinements, and the new
`scripts/capture-nyc-showcase.mjs` harness.

What shipped:

- **Plaza frontage.** The 70 m base tier now has a steel curtain wall with vertical mullions and
  floor spandrels, a 31 m-wide lit **STARK** wordmark, a compact arc-reactor ring, and two forecourt
  repulsor pylons. The blank commercial side wall west of the forecourt now carries a 12.2 m Stark
  Expo arc-reactor roundel facing the fight.
- **Roof.** The crown is a marked helipad with a painted H, warm and cyan rings, perimeter rail,
  alternating edge lights, four corner beacons and a three-mast array north of the fight deck.
- **Sky.** The sixteen solid cloud ellipsoids at roof height are gone. They read as white discs
  parked beside the duel and hid the imported landmark; the painted sky remains.
- **Imported landmark.** Still scenery-only at `(-130, 1.2, -200)`, outside roam bounds, 5 meshes /
  187,213 triangles / 12.5 MB. Its materials now reuse the albedo as a low emissive map so the dusk
  tower is not a black cut-out, and the asset version is `nyc-skyline-v2-20261111`.
- **Identity.** The playable building is explicitly **STARK**; the backdrop remains a separate
  Avengers Tower with its teal A. The duplicate is now intentional and named, not unexplained, but
  the two exteriors are not unified.

Evidence:

- `artifacts/environment/new-york/showcase/final-plaza.png` — at 1366×768, real 1P Spider-Man vs
  Goku match, real plaza duel camera, loading overlay faded. Shows the wordmark, reactor, roundel
  and curtain wall.
- `artifacts/environment/new-york/showcase/final-roof.png` — real roof match. Shows the helipad,
  mast array, clear sky and the imported Avengers Tower behind the crown.
- `artifacts/environment/new-york/showcase/final-plaza.json` and `final-roof.json` — stage, camera,
  spawn, draw-call and asset facts.
- `artifacts/environment/new-york/showcase/final-visibility.json` — landmark `visible:false` on
  Konoha Main Street, then `visible:true`, `status:'loaded'`, 5 meshes back on the plaza.

Checks actually run:

```
node --check world_catalog.js / nyc_skyline.js / capture-nyc-showcase.mjs   pass
npm run test:worlds           pass  74,227 assertions, 76 locations, NYC 359 blocks
npm run test:camera           pass  25/25
npm run validate:assets       pass  all prefab/scene/manifest assets
npm run build                 pass  (existing models.js dynamic/static warning only)
focused capture + visibility  pass  no page errors
npm run test:worlds:browser   76/76 world stages loaded and passed spawn/collision/camera-block
                              assertions; then the harness failed on its own post-loop
                              character-select click (`#selectScreen [data-nav="next"]` was not
                              visible). That UI failure is outside the world stage loop and is not
                              fixed or claimed as a pass.
git diff --check              pass  on the changed tracked source
```

Limitations:

- The imported Avengers Tower is **not framed by the plaza camera**. Projection checks show a 180 m
  tower that clears the playable crown lands mostly above the top of the plaza frame, or behind the
  financial block. The roof is the skyline view; the plaza is the Stark Tower frontage view.
- The new geometry is decorative and did not change collision: 359 blocks before and after. The
  roof rails and helipad do not fence the fight; the existing bounds still do.
- Captures are SwiftShader cloud-browser frames. No Chromebook hardware frame rate, fill-rate or
  triangle-budget result was measured, so do not quote one.
- No commit, push, reset, clean, stash or amend was performed.


## 5. Konoha imported-landmark pass (2026-11-13)

- Downloaded three genuine Sketchfab assets through the official API: Tigerar1's Konoha village,
  jmartinez20592's Six Hokage Mountain and elre's Hokage Office. SHA-256, licences and attribution
  are recorded in `docs/ENVIRONMENT_ASSET_MANIFEST.md` and `public/ATTRIBUTIONS.md`.
- Rejected the Tigerar1 village as a playable primary environment after rendering it: it is a
  193 × 197 m tabletop diorama with a painted sky dome and display base. The inspection captures
  are in `artifacts/environment/konoha/source/`.
- Assembled the mountain and office in Blender 4.2.23 LTS. The mountain's 558 disconnected pieces
  were per-part decimated to 32%; a single decimation on the joined mesh collapsed its faces into
  one cluster and was rejected. The final runtime GLB has 29 meshes / 99,524 triangles / 13 MB.
- Added `public/js/worlds/konoha_landmarks.js`, called from `applyMap()` only for the `konoha`
  world. It lazy-loads, hides on other worlds, adds no collision, and falls back silently to the
  procedural village if loading fails.
- Real-game capture confirms `status: loaded`, 29 meshes, 99,524 triangles, no page errors. The
  captured Main Street, Hokage Rock and Village Gates duel cameras do **not** frame the imported
  cliff; the asset is currently verified as loaded scenery, not as a delivered landmark view.
  The dedicated Konoha village stage now ships without the authored overlook and stages the fight on the
  imported streets and cliff; the remaining work is the older procedural Main Street/Hokage Rock
  cameras, not more asset downloads.


## 6. DBZ city, campus and tournament pass (2026-11-14)

This pass upgrades the existing DBZ world rather than replacing the game, roster, combat, camera or
rendering path. The only supplied Dragon Ball environment asset in the repository is the authored
tournament asset (`public/assets/arenas/tournament.glb`, with its Blender source); no separate West
City, East City or Capsule Corporation environment GLBs were supplied, so those three are procedural
Capsule-age architecture.

What shipped:

- **West City Streets** — a paved Capsule-age boulevard with four setback glass towers, lit
  shopfronts, a monorail, two skybridges, central fountain, Capsule branch tower and logo, lamps,
  benches and trees. Spawns are `(-96, 0)` and `(-76, 0)`.
- **East City Market** (new location) — a paved market plaza with a pagoda, tea house, side stalls,
  lantern strings, produce carts, trees and a north entrance. The entrance clones the authored gate
  pieces from `tournament.glb` through `public/js/worlds/dbz_landmarks.js`; it adds no collision and
  falls back to the procedural market if loading fails. Spawns are `(73, 19)` and `(83, 27)`.
- **Capsule Corporation** — a central capsule tower, four research domes with beacons, landing pads,
  capsule shuttles, a branded blue entrance with a white capsule and orange band, a forecourt
  fountain, path lights, benches, trees and a giant capsule sculpture. Spawns are `(-70, -56)` and
  `(-54, -56)`.
- **Authored tournament** — `tournament_architecture.js` adds two rear broadcast screens (text is
  fitted to the screen), four corner pylons, a four-star-ball beacon, a painted centre medallion and
  apron boards. The camera is `yaw 0, tilt .18, scale 1.9, skyline true`.
- **Grand Prize Stage** — the King Kai planet is lifted to `y=100` so its underside no longer hangs
  over the stage; the camera is raised to clear the ring apron.
- **Shared world build** — random island trees, rim rocks and cliff-ledge boxes are excluded from
  `PROTECTED_COURTS`, and paving extends under the low city/campus duel cameras.

Evidence:

- `artifacts/dbz-upgrade/live/dbz_west_city.png`
- `artifacts/dbz-upgrade/live/dbz_east_city.png`
- `artifacts/dbz-upgrade/live/dbz_capsule_corp.png`
- `artifacts/dbz-upgrade/live/tournament.png`
- `artifacts/dbz-upgrade/live/dbz_grand_prize.png`
- `artifacts/dbz-upgrade/live/verification.json`

Checks actually run:

```
npm run test:worlds                 pass  67,970 assertions, 66 locations, dbz 12 locations / 257 blocks
bash scripts/run-browser-test.sh scripts/_verify-dbz-upgrade.mjs
                                    pass  five maps: keyboard movement, light-attack damage,
                                          both fighters framed, camera above court, labels,
                                          East gate loaded, tournament dressing 38 meshes; 0 page errors
```

Limitations:

- The city and campus are procedural: no supplied DBZ city/Capsule environment assets were present.
  The reused tournament gate is decorative scenery and does not add collision.
- Captures are SwiftShader cloud-browser frames. They are composition evidence, not hardware frame
  rate, fill-rate or triangle-budget results.
- The loading overlay is hidden by the capture harness only after both character rigs are confirmed
  loaded; on a slow SwiftShader page a secondary asset can still be waiting when the frame is taken.
- Work is uncommitted. No commit, push, reset, clean, stash or amend was performed.
