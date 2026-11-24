# Browser Bros — authoritative roster mapping

Generated 2026-11-10 from `public/js/main.js`, `public/models/characters/manifest.json` and the on-disk files; reconciled 2026-11-11 after the imported-migration live-acceptance pass. Regenerate after roster changes; until a generator is restored, keep this table in sync by hand. The `Clips` column is manifest metadata; `npm run measure:bodies` now measures most authored original bodies with 25 embedded clips, so use `artifacts/roster-bodies.json` for the current library size.

- Live catalog: **60** identities (38 launch + 22 DLC).
- Manifest identities: **80** (the manifest also holds archive/alternative keys that are not selectable fighters).
- Every catalog identity resolves to an existing file: **60/60**; **20** use an imported or promoted body; **21** declare a nonzero clip library.
- Internal ID convention: lowercase snake_case of the display name (e.g. `Hulk (Bruce Banner)` → `hulk_bruce_banner`). The ID is the manifest key and the slug used by combat, scale, animation and ability tables. It is **not** the model filename.

## 1. Selectable roster

| # | Display name | Internal ID | Model URL | Kind | Clips | MB | Tier |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | Infantry | `infantry` | `/models/characters/roster_hd/infantry_cc0.glb` | roster-body | 2 | 12.9 | launch |
| 02 | The Rock | `the_rock` | `/models/characters/roster/the_rock.glb` | original-alternative | 0 | 0.9 | DLC |
| 03 | Samuel L. Jackson | `samuel_l_jackson` | `/models/characters/roster/samuel_l_jackson.glb` | original-alternative | 0 | 1.1 | DLC |
| 04 | Bruce Lee | `bruce_lee` | `/models/characters/roster/bruce_lee.glb` | original-alternative | 0 | 1.1 | DLC |
| 05 | Jean-Claude Van Damme | `jean_claude_van_damme` | `/models/characters/roster/jean_claude_van_damme.glb` | original-alternative | 0 | 1.0 | DLC |
| 06 | Lucy Liu | `lucy_liu` | `/models/characters/roster/lucy_liu.glb` | original-alternative | 0 | 1.0 | DLC |
| 07 | Sigourney Weaver | `sigourney_weaver` | `/models/characters/roster/sigourney_weaver.glb` | original-alternative | 0 | 1.1 | DLC |
| 08 | Keanu Reeves | `keanu_reeves` | `/models/characters/roster/keanu_reeves.glb` | original-alternative | 0 | 1.0 | DLC |
| 09 | Burt Reynolds | `burt_reynolds` | `/models/characters/roster/burt_reynolds.glb` | original-alternative | 0 | 1.0 | DLC |
| 10 | Grace Jones | `grace_jones` | `/models/characters/roster/grace_jones.glb` | original-alternative | 0 | 1.0 | DLC |
| 11 | T-800 | `arnold_schwarzenegger` | `/models/characters/imported/t800/t800_animated.glb` | imported-rigged-promoted | 25 | 3.5 | launch |
| 12 | Superman | `superman` | `/models/characters/superman/superman.glb` | imported-licensed | 0 | 1.3 | launch |
| 13 | Iron Man (Tony Stark) | `iron_man_tony_stark` | `/models/characters/roster/iron_man_tony_stark.glb` | original-alternative | 0 | 1.0 | launch |
| 14 | Hulk (Bruce Banner) | `hulk_bruce_banner` | `/models/characters/imported/hulk/hulk.glb` | imported-licensed | 19 | 6.1 | launch |
| 15 | Green Lantern (Hal Jordan) | `green_lantern_hal_jordan` | `/models/characters/green_lantern_hal_jordan/green_lantern_hal_jordan.glb` | imported-licensed | 4 | 1.6 | launch |
| 16 | Wolverine (Logan) | `wolverine_logan` | `/models/characters/roster/wolverine_logan.glb` | original-alternative | 0 | 1.1 | launch |
| 17 | Wonder Woman | `wonder_woman` | `/models/characters/imported/wonder_woman_rigged/wonder_woman_rigged.glb` | imported-rigged-promoted | 25 | 51.1 | launch |
| 18 | Professor X (Charles Xavier) | `professor_x_charles_xavier` | `/models/characters/roster/professor_x_charles_xavier.glb` | original-alternative | 0 | 0.9 | launch |
| 19 | The Flash (Barry Allen) | `the_flash_barry_allen` | `/models/characters/the_flash_barry_allen/the_flash_barry_allen.glb` | imported-licensed | 12 | 1.4 | launch |
| 20 | Aquaman | `aquaman` | `/models/characters/aquaman/aquaman.glb` | imported-licensed | 43 | 6.4 | launch |
| 21 | Doctor Strange | `doctor_strange` | `/models/characters/doctor_strange/doctor_strange.glb` | imported-licensed | 0 | 1.5 | launch |
| 22 | Goku | `goku` | `/models/characters/bespoke/goku_body_face_rigged.glb` | imported-licensed | 46 | 3.5 | launch |
| 23 | Naruto Uzumaki | `naruto_uzumaki` | `/models/characters/imported/naruto_sage/naruto_sage_animated.glb` | imported-rigged-promoted | 49 | 1.1 | launch |
| 24 | Vegeta | `vegeta` | `/models/characters/roster/vegeta_ultra_ego.glb` | imported-rigged-promoted | 25 | 2.8 | launch |
| 25 | Saitama | `saitama` | `/models/characters/imported/saitama/saitama.glb` | imported-licensed | 25 | 13.9 | launch |
| 26 | Light Yagami | `l_death_note_style` | `/models/characters/imported/light_yagami_rigged/light_yagami_rigged.glb` | imported-rigged-promoted | 25 | 17.5 | launch |
| 27 | Levi Ackerman | `levi_ackerman` | `/models/characters/roster/levi_ackerman.glb` | original-alternative | 0 | 1.2 | launch |
| 28 | Edward Elric | `edward_elric` | `/models/characters/roster/edward_elric.glb` | original-alternative | 0 | 1.2 | launch |
| 29 | Roronoa Zoro | `roronoa_zoro` | `/models/characters/roster/roronoa_zoro.glb` | original-alternative | 0 | 1.1 | DLC |
| 30 | All Might | `all_might` | `/models/characters/roster/all_might.glb` | original-alternative | 0 | 1.1 | launch |
| 31 | Jotaro Kujo | `jotaro_kujo` | `/models/characters/roster/jotaro_kujo.glb` | original-alternative | 0 | 1.0 | DLC |
| 32 | Mario | `mario` | `/models/characters/imported/mario_happi/mario_happi_animated.glb` | imported-auto-rigged-promoted | 25 | 1.0 | launch |
| 33 | Luigi | `luigi` | `/models/characters/imported/dr_luigi/dr_luigi_animated.glb` | imported-rigged-promoted | 25 | 1.0 | launch |
| 34 | Solid Snake | `solid_snake` | `/models/characters/roster/solid_snake.glb` | original-alternative | 0 | 1.1 | DLC |
| 35 | Geralt of Rivia | `geralt_of_rivia` | `/models/characters/roster/geralt_of_rivia.glb` | original-alternative | 0 | 1.1 | launch |
| 36 | Kratos | `kratos` | `/models/characters/roster/kratos.glb` | original-alternative | 0 | 1.1 | launch |
| 37 | Link | `link` | `/models/characters/roster/link.glb` | model-upgrade | 0 | 1.1 | launch |
| 38 | Lara Croft | `lara_croft` | `/models/characters/roster/lara_croft.glb` | original-alternative | 0 | 1.0 | DLC |
| 39 | Sephiroth | `sephiroth` | `/models/characters/roster/sephiroth.glb` | original-alternative | 0 | 1.1 | DLC |
| 40 | Master Chief | `master_chief` | `/models/characters/roster/master_chief.glb` | original-alternative | 0 | 1.0 | launch |
| 41 | Doom Slayer | `doom_slayer` | `/models/characters/roster/doom_slayer.glb` | original-alternative | 0 | 0.9 | launch |
| 42 | Shrek | `shrek` | `/models/characters/roster/shrek.glb` | original-alternative | 0 | 0.9 | DLC |
| 43 | Aladdin | `aladdin` | `/models/characters/roster/aladdin.glb` | original-alternative | 0 | 1.1 | DLC |
| 44 | Ariel | `ariel` | `/models/characters/roster/ariel.glb` | original-alternative | 0 | 1.0 | DLC |
| 45 | Ursula | `ursula` | `/models/characters/roster/ursula.glb` | original-alternative | 0 | 0.9 | DLC |
| 46 | Edna Mode | `edna_mode` | `/models/characters/roster/edna_mode.glb` | original-alternative | 0 | 1.1 | launch |
| 47 | Captain Jack Sparrow | `captain_jack_sparrow` | `/models/characters/roster/captain_jack_sparrow.glb` | original-alternative | 0 | 1.2 | launch |
| 48 | Sesshomaru | `sesshomaru` | `/models/characters/roster/sesshomaru.glb` | original-alternative | 0 | 1.1 | DLC |
| 49 | Norman Bates | `norman_bates` | `/models/characters/roster/norman_bates.glb` | original-alternative | 0 | 1.0 | DLC |
| 50 | Han Solo | `han_solo` | `/models/characters/roster/han_solo.glb` | original-alternative | 0 | 1.0 | DLC |
| 51 | Indiana Jones | `indiana_jones` | `/models/characters/roster/indiana_jones.glb` | original-alternative | 0 | 1.1 | DLC |
| 52 | Sasuke Uchiha | `sasuke_uchiha` | `/models/characters/imported/sasuke_rigged/sasuke_rigged.glb` | imported-rigged-promoted | 25 | 8.1 | launch |
| 53 | Hashirama Senju | `hashirama_senju` | `/models/characters/imported/hashirama_senju/hashirama_senju.glb` | imported-licensed | 25 | 1.1 | launch |
| 54 | Madara Uchiha | `madara_uchiha` | `/models/characters/imported/madara_rigged/madara_rigged.glb` | imported-rigged-promoted | 25 | 2.0 | launch |
| 55 | Harry Potter | `lord_voldemort` | `/models/characters/imported/harry_potter/harry_potter_animated.glb` | imported-rigged-promoted | 25 | 5.2 | launch |
| 56 | Thor | `thor` | `/models/characters/imported/thor_rigged/thor_rigged.glb` | imported-rigged-promoted | 25 | 2.8 | launch |
| 57 | Aang | `aang` | `/models/characters/imported/aang_rigged/aang_rigged.glb` | imported-rigged-promoted | 25 | 3.2 | launch |
| 58 | Spider-Man | `spider_man` | `/models/characters/imported/miles_morales/miles_morales_animated.glb` | imported-rigged-promoted | 83 (26 Miles + 57 Iron Spider) | 6.1 | launch |
| 59 | Iron Spider | `iron_spider` | `/models/characters/iron_spider/iron_spider_source_animated.glb` | imported-rigged-promoted | 57 | 10.7 | launch |
| 60 | Kaze | `kaze` | `/models/characters/kaze/kaze.glb` |  | 17 | 0.8 | launch |

## 2. Required identity mappings from the integration spec

These are the authoritative slot decisions. The internal ID stays; only the displayed identity/model changes.

| Requested fighter | Existing slot ID | Current display | Current production model | Rule |
| --- | --- | --- | --- | --- |
| Light Yagami | `l_death_note_style` | Light Yagami | `imported/light_yagami_rigged/light_yagami_rigged.glb` (25 clips) | Stable ID and save key retained; HUD, moveset, abilities, ultimate and Death Note prop are Light-themed. Live 13/13. |
| Harry Potter | `lord_voldemort` | Harry Potter | `imported/harry_potter/harry_potter_animated.glb` (68 joints, 25 baked clips) | Supplied body promoted; stable ID kept; wand and Harry moveset. Live 13/13. |
| Arnold / T-800 | `arnold_schwarzenegger` | T-800 | `imported/t800/t800_animated.glb` (53 joints, 25 baked clips) | Supplied T-800 endoskeleton promoted; stable ID kept; heavy shotgun. Live 13/13. |
| Spider-Man (Miles skin) | `spider_man` | Spider-Man | `imported/miles_morales/miles_morales_animated.glb` (178 joints, 26 Miles clips + 57 Iron Spider clips) | Supplied Miles model becomes the regular Spider-Man body; display stays Spider-Man; no Miles roster entry. The Iron Spider body-joint clips are retargeted and appended; model payload and all 26 Miles clips are preserved. Rollback is the previous `imported/spider_man_rigged/spider_man_rigged.glb` (25 clips) and `backup/miles_morales_pre_iron_spider_20261113.glb` (26 clips). |
| Iron Spider | `iron_spider` | Iron Spider | `roster/iron_spider.glb` (authored body, 32 clips) | Supplied Iron Spider model with its original 32 clips; separate from Spider-Man. |
| Naruto Uzumaki | `naruto_uzumaki` | Naruto Uzumaki | `imported/naruto_sage/naruto_sage_animated.glb` (19 joints, 49 clips) | Sage body is production on the project 19-bone rig; old 567-bone body is rollback. Both defeat coat panels were reweighted with `fix:naruto-coat`; solo and live 49/49 passes; the repaired coat edge is ~0.76× and the worst remaining garment edge is 0.1555×. |
| Vegeta | `vegeta` | Vegeta | `roster/vegeta_ultra_ego.glb` (supplied Ultra Ego body, 311 joints, 25 retargeted clips) | Supplied appearance promoted; authored `roster/vegeta.glb` retained as rollback. Live 13/13, hands free. |

## 3. Non-target identities preserved

The remaining 53 catalog entries (including Infantry, The Rock, Samuel L. Jackson, Bruce Lee, Wolverine, Geralt, Doom Slayer, Kaze and the other DLC fighters) are preserved with their existing IDs and models. The spec's 33-character list is a subset of this catalog; no entry is deleted or merged.

## 4. Known mapping hazards

- Display names are the roster key: `fighterDisplay`/`normalizeFighter` compare by display string, and slugging produces the internal ID. Renaming a display name without an alias changes which manifest entry loads. Light/Harry renames therefore require an explicit display→slot alias, not a bare string edit.
- `public/js/anim/shared_rig_family_data.js` is the legacy donor-rig audit table: its “L (Death Note Style)” / “Lord Voldemort” labels and authored donor URLs describe the rigs used for animation transfer, not the promoted runtime bodies. Runtime identity/model resolution uses `manifest.json` and `FIGHTER_DISPLAY_ALIASES`.
- The manifest contains archive keys (`iron-man-alt`, `iron-spider-alt`, `light_yagami_rigged`) that are not selectable fighters. Do not treat them as roster entries.

## 5. Post-acceptance status (2026-11-11)

The four outstanding imported migrations are live-accepted in real matches: Vegeta **13/13**,
Light Yagami **13/13**, Harry Potter **13/13** and T-800 **13/13**. Each mounted 25 baked clips,
played idle/walk/jump/hit, produced jab and signature damage, and wrote its display name to the HUD.
The T-800 slot displays **T-800** while keeping `arnold_schwarzenegger` as the stable key.

Evidence: `artifacts/imported-migrations/` and `docs/IMPORTED_MIGRATIONS_ACCEPTANCE.md`.
No showcase-world reconstruction was started in this pass.
