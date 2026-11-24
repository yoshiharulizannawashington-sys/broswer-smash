# Environment Asset Manifest — Konoha and imported open-world arenas

Generated 2026-11-13. This is the production record for assets actually inspected/downloaded
for Konoha, Skyloft and the Mario Kart arena. Source archives remain under `artifacts/asset-fetch/<uid>/`.

## Runtime set

| Asset | Creator | Licence | Download | Source geometry | Runtime | Textures / materials | Cleanup and placement | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Six Hokage Mountain (`c9cc3357a6ee46c2bff49c94e409fa99`) | jmartinez20592 | CC BY 4.0 | GLB, 20,292,832 B, SHA-256 `2f3952…04e6e` | 307,686 faces, 179,142 verts, 23 images (6.8 MB) | 95,476 triangles, 180 × 67.8 × 62.3 m | Textures packed; six UV sets reduced to one | 558 parts joined; per-part collapse decimation at 32%; redundant UVs removed; normalised to 180 m; mounted behind the Hokage Rock terrace with a dark rock backing | Imported and lazy-loaded at runtime; **not verified as a framed gameplay landmark** |
| Hokage Office (`07512299acb64f40a4b36d63286de7cf`) | elre | CC BY 4.0 | GLB, 1,788,720 B, SHA-256 `097b13…19197` | 10,739 faces, 16,034 verts, 8 images | 4,048 triangles, 22.7 × 30.3 × 8 m | 8 source textures | Display base, wall and tree props removed; office/silos/lamps kept; normalised to 8 m height; placed at the north-east village edge | Imported in the same lazy GLB; not collision-bearing |

Combined runtime GLB: `public/assets/environments/konoha/hokage_landmarks.glb` — 13,034,124 B,
29 meshes, 99,524 triangles. Blender source: `assets/blender/environments/konoha/hokage_landmarks.blend`.
Assembly evidence: `artifacts/environment/konoha/` and `artifacts/environment/konoha/source/`.

## Downloaded but not used

| Asset | Creator | Licence | Reason |
| --- | --- | --- | --- |
| Konoha Hidden Leaf Village (`d9830d4348e94e32a9745b8bc130fd19`) | Tigerar1 | Sketchfab Free Standard | Rendered inspection shows a tabletop diorama with a painted sky dome and display base (193 × 197 × 74 m, 14,157 triangles). It cannot serve as a closed playable environment without rebuilding its base and boundary. Preserved, not mounted. |

## Imported open-world arenas — 2026-11-13

| Asset | Creator | Licence | Download / source geometry | Runtime asset | Placement / modifications | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| Naruto hiddenly village (`bd95c17d67c44756b4fa5097bce9a547`) | kyrox | CC BY 4.0 | GLB 6.2 MiB, 56,224 triangles | `public/assets/arenas/konoha_overlook.glb` — 6,463,660 B, 1 runtime mesh, 56,202 triangles | Scaled 26×; the imported village and Hokage cliff are the entire stage. The Blender source exports only the joined village mesh and the invisible loader marker — no authored terrace, cliff plinth, rails, bridge, gate, banners, lanterns or joints. The fight sits on a 22×10 m street/grass intersection at x −14..8, z −108..−98. Blender source `assets/blender/environments/konoha_overlook/`. | Mounted; no authored overlook is present; both spawns and all four corners raycast onto imported village ground; village walls provide 31 collision blocks; camera outside solid; no page errors; live capture `artifacts/environment/arenas/live/konoha_overlook.png`. |
| The legend of zelda : sky word sword - sky loft (`d3efeec729644b67a444f900815b33d9`) | Dola | CC BY 4.0 | GLB 5.5 MiB, 53,568 triangles | `public/assets/arenas/skyloft.glb` — 5,554,348 B, 48 Blender meshes / 133 runtime nodes, 54,739 triangles | Island recentred on its lower plaza; 44×34 m terrace deck, banners, braziers, rails and marker authored. Source ocean/sky geometry preserved. Blender source `assets/blender/environments/skyloft/`. A runtime heightfield samples the mounted island's actual grass and rock surfaces so fighters follow the rises outside the deck. | Mounted, spawns grounded on the plaza at y = 0.14 m, walkers follow the raised island surface, camera outside solid, academy plaza visible; live capture `artifacts/environment/arenas/live/skyloft.png`. |
| Wuhu Island (`bc6367ba43ac4af9939e99beac3493a0`) | Dola | CC BY 4.0 | GLB 6.0 MiB, 63,544 triangles | Combined into `public/assets/arenas/mariokart.glb` — 19,017,028 B, 32 Blender meshes / 147 runtime nodes, 220,917 triangles | Scaled 0.55; 1.4 km source ocean plane (`Object_37.001`) hidden and replaced with a bounded sea. Its west headland is the play surface: a 34×28 m natural battlefield at x −45..−11, z −38..−10. A new grass-and-rock land bridge (`mariokart_land_bridge`, x −22.2..−19, centred at z −35.2, top rising −0.35 → 0.38 m) spans the gap to and one metre past the airport's solid western atoll rim, so the stage is continuous from Wuhu to the airport rather than merely adjacent. A runtime low atoll shelf (mariokart_atoll_shelf, x −19.4..−9.4, z −38.5..−9.5, top 0.36 m) extends that bridge east across the rim with a procedural grass top, rock skirt and shoreline boulders, making the new east corners solid atoll ground instead of removed runway. A 1 m runtime heightfield samples the imported grass/rock and the bridge (1,015/1,015 valid samples). A one-time 0.75 m collision bake adds the vertical cliffs, 2,381 steep-face triangles and 2,183 low-face triangles into 166 blocks, including 211 new steep cells and 46 new low-boulder cells; a narrow runtime corridor clears the six tall blocks that crossed the authored land bridge, leaving 160 active blocks; low-face block tops are raised to ground + 0.9 m so a boulder is an obstacle rather than a step. The heightfield skips a steep-face or low-boulder block while the fighter is below its top, letting the block stop the approach instead of lifting the fighter onto it. Both spawn footprints stay clear. | Mounted; both spawns and all four arena corners raycast onto natural, bridge and atoll-shelf geometry; the bridge mesh exists and its height rises from Wuhu to the airport; a live keyboard walk starts on Wuhu at x -23, z -36.05 and reaches x < -19 on the airport side without leaving the ground; a live-step block probe pushes a fighter out of a generated cliff/rock block, and dedicated low-boulder and steep-face probes pass; camera outside solid; no page errors; live capture `artifacts/environment/arenas/live/mariokart.png`; shelf close-up `artifacts/environment/arenas/live/mariokart-atoll-shelf.png`. |
| Mario kart 8 - Sunshine airport (`cca07d1f6600401691170b825b6220cc`) | Dola | CC BY 4.0 | GLB 14.5 MiB, 161,116 triangles | Combined into `public/assets/arenas/mariokart.glb` | Scaled 0.8; source sea (`Object_16.001`) hidden. The atoll is moved so its western solid rim meets Wuhu's east edge and the new natural land bridge; the old rock base, deck, causeway, gantry and promenade are deleted. The reclaimed 33 m-radius apron and 25×9 m runway remain in the source GLB but are removed at mount with their markings, so they never become the play surface. Blender source `assets/blender/environments/mariokart/`. | Mounted; the airport's western solid ledge and new atoll shelf are under the expanded east edge; apron/runway absence asserted live; camera outside solid; no page errors; live capture above. |

All three assets are assembled by `scripts/assemble-environment-arenas.py` (`skyloft`, `konoha`,
`mariokart`) and are selectable through both map pickers. The owner authorized use of the supplied
models; CC BY 4.0 metadata and modified-source availability are retained.

## Deck audit

`npm run audit:arena-decks` parses the shipped GLBs and reports deck-like meshes, cross-arena
archetype duplicates, overlapping surfaces inside one arena, and whether the current stage actually
depends on each deck. The report is written to `artifacts/arena-decks/audit.json`. A deck is marked
load-bearing only when it covers the stage at stage-ground height and the imported terrain below it
is lower or missing. The audit is read-only and does not change the runtime cleanup.

`--arena <key>` limits the scan to one imported arena, and `--fail-on-load-bearing` makes the
command exit 1 when any deck is load-bearing. The current inventory flags `skyloft_plaza` as
load-bearing because the imported island surface sits below it, and groups the overlapping
`mariokart_apron` and `mariokart_runway` surfaces. Konoha no longer contributes an authored deck.

## Live verification

Command: `bash scripts/run-browser-test.sh scripts/verify-environment-arenas.mjs`

CI: `.github/workflows/environment-arenas.yml` runs the same full suite on every change to the
arena loader, layouts, main loop, imported arena assets and their Blender sources.

Result on 2026-11-14: **PASS** for all three arenas — both pickers resolve to the requested key,
the authored GLB mounts, mesh counts are within the assembled range, both fighters spawn grounded,
both are visible, the match camera reports no geometry intersection, and no uncaught page errors
are recorded. For Mario Kart the live test also asserts that the Wuhu and Sunshine Airport bounds
overlap, the deck/causeway/base are absent, the apron and runway are removed at mount, Wuhu's
natural terrain and the new grass-and-rock land bridge are baked into a walkable heightfield over
the expanded 34×28 m battlefield, and downward rays at both spawns and all four arena corners hit
natural island, bridge or atoll-shelf ground. Captures:
`artifacts/environment/arenas/live/{konoha_overlook,skyloft,mariokart}.png`; authored views
`artifacts/environment/arenas/mariokart-work/final-{top,perspective}.png`.

Death Star remains archived only under `archive/cancelled/death-star/`; it has no active map option,
runtime key, asset or source reference. The live test asserts its absence.

## Supplied character assets — promoted

Goku’s derived face-rigged GLB (`public/models/characters/bespoke/goku_body_face_rigged.glb`) was repaired on 2026-11-13 with `scripts/finalize-imported-glb.mjs`: 444 zero-area triangles were removed from the index buffer while 14 meshes, 4 skins, nine morph-target meshes and the node hierarchy were preserved. Pre-repair backup: `artifacts/character-repair/goku_body_face_rigged.pre-repair.glb`. `npm run test:roster-models` now passes 38/38.

| Asset | Creator | Licence | Geometry / rig | Result |
| --- | --- | --- | --- | --- |
| Mario Kart Tour — Mario (Happi) (`269c8e889d6440c284034898440919c0`) | Dola | CC BY 4.0 | 6,984 triangles, 4 meshes, **no skeleton, no clips**, 14.81 authored units tall | **PROMOTED.** Auto-rigged to 19 canonical bones at 1.754 m; 25-clip Luigi set retargeted with `--calibrate-arms`; 0 unweighted vertices. Live selection/preview/match 7/7. Authored body remains rollback. |
| Dr. Mario World — Dr. Luigi (`2e7016d3f03c4433a34a59095db805e2`) | Dola | CC BY 4.0 | 5,489 triangles, 3 skinned meshes, 91 bones, 19/19 canonical roles, **no clips**, 1.756 m | **PROMOTED.** 25-clip Luigi set retargeted; manifest facing offset 180°. Known open-shell: 181 boundary / 6 non-manifold edges. Live selection/preview/match 7/7. Authored body remains rollback. |

## Attribution requirements

Credit every environment creator in `public/ATTRIBUTIONS.md` wherever the build is distributed.
The CC BY licences cover the uploaders' models, not the Naruto franchise. Mario and Luigi are
third-party character designs as well; confirm distribution permission separately.

## Integration status

- Lazy-loader added at `public/js/worlds/konoha_landmarks.js`.
- Mounted only when the active world is `konoha`; hidden otherwise; no collision or spawn changes.
- Runtime load confirmed in the real game with 29 meshes / 99,524 triangles and no page errors.
- **Dedicated fight:** `konoha_overlook` mounts the kyrox village and Six Hokage relief and stages
  the fight inside the imported village. The Blender source no longer authors a cliff terrace or props.
  The older 13-location procedural Konoha world and its Main Street/Hokage Rock/Village Gates
  cameras remain unchanged, so those locations are not retrofitted by this stage.
