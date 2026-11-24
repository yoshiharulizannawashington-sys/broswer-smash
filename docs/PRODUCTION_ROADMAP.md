# Browser Bros — production roadmap and current-state audit

Date: **2026-11-12**  
Branch: `freebuff/726ce0c51041fd4f569ce7bd`  
Status: **audit and roadmap only — no launch fighter or world is declared complete by this document.**

The per-fighter master checklist is in `docs/LAUNCH_ROSTER_ACCEPTANCE.md`. This roadmap is based on the repository's live manifest, current roster arrays, animation lanes,
world catalog, existing acceptance reports and the dirty working tree. It preserves every working
system and every approved roster identity. It is ordered so characters are finished before map
production, and so the complete game flow is connected before open-world expansion.

## 1. What is actually in the project

| Area | Audited baseline |
| --- | --- |
| Selectable roster | **60 identities: 38 launch + 22 DLC** in `public/js/main.js`. |
| Manifest | **80 identities**; 60 selectable plus archive, rollback and showcase entries. |
| File resolution | **60/60 selectable identities resolve to an existing file** (`docs/ROSTER_MAPPING.md`, reconciled 2026-11-11). |
| Body provenance | **20** use imported or promoted bodies; the rest use authored original bodies or special roster bodies. |
| Measured GLB clips | **35 of 38 launch bodies contain embedded clips** (2–57). Goku’s 46 clips are in the separate `goku_animated.glb`; only Superman and Doctor Strange have no clip library. The manifest’s `verified.clips` field underreports most authored original bodies as 0 even though the current GLBs measure 25 clips each. |
| Animation runtime | Shared retargeter, bind-pose mapping, solo rig lanes, body masks, transition policy, additive face/weapon overlays and per-body mixers are already implemented. |
| Combat | Shared frame data, hitboxes, damage, knockback, blocking, guard resource, parry, dodge, throws, projectiles/beams, transformations, ultimates and KO/round flow already exist. |
| Worlds | **8 world families**; New York has the first partial showcase slice. **No world is complete.** |
| Game flow | Title, character select, map/world selection, match rules, loading, pause, results and rematch paths exist; they still need end-to-end acceptance. |
| Hardware evidence | Cloud Chromium/WebGL is **SwiftShader**. No hardware-GPU frame-rate, fill-rate or compatibility result exists for the final content. Prepared run/checklist: `docs/HARDWARE_GPU_ACCEPTANCE.md` (preflight rejects SwiftShader; no hardware result yet). A targeted Iron Spider attempt was rejected before any suite ran; see `artifacts/iron-spider/hardware-gpu-attempt.json`. |

The repository is therefore **not** a blank game. The gap is production completion and proof.

## 2. Completion rules

These rules apply to every subsequent batch:

1. **A file loading is not completion.** A fighter must be selected through the real character-select
   path and played in a real match.
2. **A clip name is not proof.** The selected clip must move the mounted skeleton, and the gameplay
   state must consume the expected input and produce the expected damage/reaction.
3. **No fallback body counts as finished.** If the promoted body fails validation and the prefab falls
   back, the fighter is blocked.
4. **No placeholder counts as finished.** Authored original bodies may remain during development, but
   they must meet the same model, animation, combat and match gate before launch sign-off.
5. **A map is not complete until it is played.** Loading, collision, camera framing, lighting,
   missing-texture checks and a real match are required.
6. **Only measured results are claims.** SwiftShader captures are composition evidence. Hardware
   performance and browser compatibility require a separate run on supported hardware.
7. **Preserve the roster and rollback path.** Keep display identities, stable manifest keys, source
   archives and prior promoted assets.

## 3. Launch roster readiness

The per-fighter master checklist is [LAUNCH_ROSTER_ACCEPTANCE.md](LAUNCH_ROSTER_ACCEPTANCE.md).
It records all 38 rows, measured clip counts, height warnings, live evidence and immediate blockers.


Counts below use the current measured bodies where available, not the manifest's stale
`verified.clips` metadata. Most authored original bodies already contain **25 embedded clips**;
they still need a per-fighter quality review and full launch acceptance. Goku's clips are separate
from the body GLB. Superman and Doctor Strange genuinely have no clip library.

### 3.1 Live-proven imported bodies — finish the remaining gaps

These have real browser evidence. They are the fastest path to a complete first launch cohort, but
none is declared launch-complete by this audit.

| Fighter | Measured clips | Existing live evidence | Remaining gap |
| --- | ---: | --- | --- |
| Goku | 46 | A1 live 9/9; 43/43 active state matrix; direct ultimate 4/4; Kamehameha, transformations, KO; baked face 20/20 | Guard-sclera hardware review; hardware pass |
| Naruto | 49 | A1 software-pass core: 37/37 live match, 49/49 live state, 21/21 signatures, 18/18 keyboard combat, 7/7 focused A1 probe, 2/2 transformed KO/rematch; coat repaired | Hardware pass; full sign-off |
| Vegeta | 25 | A1 software pass: 42/42 live matrix, 25/25 moving retargeted clips, SUPER SAIYAN source charge/exit and KO during form, victory/defeat/rematch; 13/13 migration; source topology repaired to 0 open / 0 non-manifold | Hardware |
| T-800 | 25 | A1 software pass: 42/42 live matrix, 25/25 moving retargeted clips, COMBAT CHASSIS OVERDRIVE source charge/exit and KO during form, victory/defeat/rematch; 13/13 migration; source topology repaired to 0 open / 0 non-manifold | Hardware; point-blank shotgun guard interaction |
| Light Yagami | 25 | 13/13 real-match acceptance, Death Note, signature | Full launch matrix; stable `l_death_note_style` key must remain |
| Harry Potter | 25 | 13/13 real-match acceptance, wand, Expecto Patronum | Full launch matrix; stable `lord_voldemort` key must remain |
| Spider-Man / Miles | 83 (26 Miles + 57 Iron Spider) | Bone map 19/19, live 40/40 gameplay + 21/21 import A1 (web kit, ultimate, heavy/defeat/BO3), 13/13 animation merge + 6/6 playback, textured body | Hardware pass |
| Iron Spider | 57 | Core 58/58 (designed stow/retract, victory, rematch, defeat, rematch), 8/8 arm sheet, 37/37 selectable roster; clips 55/57; arm mounted/bounded through the sweep; SwiftShader report separated at `artifacts/iron-spider/software-run.json` | `collection` + `skill07-03` are preserved static source poses, not temporal animations; no integration failure and no repair without invented keys; all 55 animated clips pass; designed native-bone stow/deploy 5/5; 37/37 roster; separate victory/rematch/defeat/rematch covered; hardware attempt blocked by SwiftShader; no `hardware-run.json` |

**Immediate fixes in this group:** Goku guard sclera/hardware; Miles hardware; Naruto hardware;
Vegeta and T-800 hardware (their ten-criterion matrices are software-pass at 42/42 each and their
source topology is repaired to the 80-edge budget); Iron Spider hardware. Iron Spider's designed
native-bone stow/retract, separate victory/rematch/defeat/rematch coverage and 37/37 selectable
roster coverage are now verified. The two static Iron Spider source poses have no recoverable
motion; their original source, source GLB, fetch GLB and runtime GLB are channel-identical, so
there is no binding failure to repair. They are preserved as non-combat references; repair would
require authoring new animation.

### 3.2 Imported bodies with clips but no recorded full match gate

Aquaman (43), Hulk (19), The Flash (12), Green Lantern (4), Saitama (25), Madara (25), Sasuke (25),
Thor (25), Aang (25), Hashirama (25), Wonder Woman (25).

These need, in order:

1. A full launch-match acceptance run on the promoted file.
2. Confirmation that every required locomotion, attack, defense, reaction, KO, victory and defeat
   state selects a real clip or a deliberate shared lane.
3. Any missing retarget/authoring work.
4. A hardware visual/performance check.

The Flash and Green Lantern are special cases: 12 and 4 declared clips are below the expected
coverage, so assume missing states until the gate proves otherwise. Wonder Woman's 51 MB body also
needs a texture/mesh budget review because it is an outlier.

### 3.3 Imported bodies with no declared clips

Superman (0), Doctor Strange (0).

They have identifiable bodies but not a complete authored animation library. They need either a
validated retargeted clip package or an explicitly approved shared donor set, followed by the same
match gate. A static body must not pass.


### 3.4b Supplied Mario and Luigi bodies — promoted with a live partial

The exact Dola bodies now occupy the stable Mario and Luigi slots. Mario was auto-rigged from the
supplied T-pose to 19 bones (zero unweighted vertices), Luigi kept its 91-bone rig, and both carry
the project's 25-clip set. Real selection, character-select preview and a landed-hit match pass 7/7
for each (`scripts/verify-mario-live.mjs`, `scripts/verify-luigi-live.mjs`). Mario's auto-rig has
5,097 non-manifold edges and Luigi's supplied open shell has 181 boundary / 6 non-manifold edges;
both are recorded in their provenance. The full 37/42 combat matrix and hardware sign-off remain open.

### 3.4 Authored/original launch bodies — final model and clip pass

Infantry, Iron Man, Wolverine, Professor X, All Might, Edward Elric, Levi Ackerman, Kratos,
Link, Master Chief, Geralt of Rivia, Doom Slayer, Edna Mode, Captain Jack Sparrow, Kaze.

Most measured bodies contain **25 embedded clips**; Infantry has 2 and Kaze has 17. They are not
generic empty placeholders, but they are **not final-quality launch fighters** under the new
definition. Each needs:

- a final, character-specific body and silhouette review;
- verification that raw height and runtime normalization agree;
- a quality review of the measured clip set, not just a nonzero count;
- face/hair/equipment quality appropriate to the chosen art direction;
- the same moveset, transformation, ultimate, reaction and match gate as imported fighters.

Batch these by shared skeleton and pipeline, not one fighter at a time, but accept them one by one.

## 4. Stage A — finish the fighters

### A0. Launch acceptance gate

**Status 2026-11-12:** `scripts/verify-launch-roster.mjs` is built and has run all 38 launch
fighters. The expanded gate now has **38/38 A0 PASS** (Goku 40 checks; every other row 37), with
0 failures, 0 skips and 0 timeouts. The master evidence is
`artifacts/launch-acceptance/report-all.json` and `artifacts/launch-acceptance/expanded-38-summary.json`;
per-fighter idle and result captures are alongside it. The expanded harness covers the select-card
preview, run/fall/land, five-input light chains, anti-air/dive, throw follow-through,
parry/counter/dodge/guard break, the unforced heavy-hit knockdown/get-up collision and a second
completed match. Hardware GPU checks remain unavailable. A0 PASS is therefore not full launch
sign-off.

Create one real-match harness that runs every launch fighter through the same sequence. It must
record JSON plus screenshots for:

1. Character-select preview and mounted body.
2. Textures/materials, height, feet contact, skeleton and no fallback.
3. Idle, walk, run, sprint, jump/fall/land.
4. Light chain, heavy, aerial, anti-air/dive, grab/throw.
5. Guard, parry, dodge, counter and guard break.
6. Light hit, heavy hit, knockdown, get-up and defeat.
7. Signature move, transformation (where applicable), ultimate and damage.
8. KO, round result, victory/defeat, rematch and a second completed match.
9. No page errors, no failed asset requests and no fallback flags.

The harness must be usable on one fighter for iteration and on the full 38-fighter launch roster for
sign-off. It must distinguish **clip selected** from **skeleton moved** and **gameplay effect
observed**.

**Exit gate:** the harness exists and all 8 live-proven fighters pass it end to end.  
**Measured:** the expanded gate is live-proven on **all 38 rows**: Goku 40/40, every other row
37/37. The report records 0 failures, 0 skips and 0 timeouts. Hardware evidence remains open.

### A1. Close the live-proven cohort

Reusable standard: `docs/A1_CHARACTER_LAUNCH_CHECKLIST.md` (ten criteria, evidence classes and
sign-off rule).

- Goku: **A1 software evidence complete** — live match **9/9**, state matrix **43/43**, direct ultimate **4/4**;
  `DoubleJump`, `Fall` and `FlyForward` are wired, while `Punch3`, `Special` and `Air` are retired
  as an alternate and aliases. The direct ultimate probe moved 8 joints and returned control and
  camera. Guard reports `Guard 0.996`, `Blink 0`; guard-sclera hardware review and hardware remain open.
- Spider-Man: **A1 software evidence complete** at **40/40 live gameplay + 21/21 import** (import rerun after the fix) — authored
  Web Zip, Web Shot, Web Pull, Web Swing Strike, held web-swing, three-beat ultimate and Spider-Sense
  form with real damage/control; live heavy, real defeat (`PLAYER 2 WINS`) and best-of-three
  (`wins [2,0]`). Hardware remains open.
- Naruto: **A1 software-pass core** — fresh **37/37** live match, **49/49** live state matrix,
  **21/21** signatures (five forms transform, fire their own special and exit), **18/18** keyboard
  combat and **7/7** focused A1 probe. Sprint settles to grounded `run` after the Shift dodge;
  `RASENSHURIKEN` originates from `RightHand` with no fallback; the ultimate returns control with
  meter spent; unforced knockdown/get-up passes. A focused **2/2** transformed-KO suite now proves
  a live KO during SAGE MODE reaches `VICTORY · NARUTO UZUMAKI` and that the result-screen rematch
  starts fresh with the form cleared. Hardware and full sign-off remain open.
- Iron Spider: **A1 software evidence complete** — core **58/58**, clip matrix **55/57**,
  selectable-roster matrix **37/37**. The untouched original `scene.gltf`/`scene.bin` matches the
  source, fetch and runtime GLBs channel-for-channel: both `collection` (0 s, 144 tracks / 104
  targets) and `skill07-03` (2 s, 196 tracks / 103 targets) contain static poses, not temporal
  motion. All clip targets resolve inside the 107-joint skin (0 outside), both actions load live,
  and neither is mapped to gameplay; this is not a binding failure. No asset repair was applied
  because the supplied source cannot support one without invented keys. Expanded live coverage
  separately passes **VICTORY · IRON SPIDER (2–0)**, rematch after victory, **DEFEAT · GOKU
  (0–2)** and rematch after defeat, with fresh state and the native arm still mounted. The
  designed stow/retract is a reversible 0.30 s native-bone fold behind the backpack; `G` toggles it
  while grounded and neutral, and attacks/jumps/dodges/hit reactions/grabs/flight/KO/round reset
  auto-deploy. `Object_122` stays visible and skinned, all 57 clips are untouched, and five live
  checks cover the fold, redeploy, source clips and attack auto-deploy. Hardware remains open.
- Vegeta, T-800: **A1 software pass** — **42/42** live combat each (**84/84** combined), **13/13**
  migration checks and **25/25** moving retargeted clips. Both use source `charge` for their forms,
  exit naturally and delivered a KO during form; victory, defeat and both rematches pass. Source
  topology is repaired to 0 / 0 for both Vegeta and T-800; T-800's point-blank shotgun/guard
  interaction and hardware remain open. The 70-frame visual review was refreshed on the idle-guard
  build and remains clean for fighter state (software-only).
- Light, Harry: full launch matrix and hardware; preserve their recorded signature/damage evidence.

**Measured 2026-11-12:** Goku, Spider-Man, Naruto and Iron Spider have complete A1 software
evidence; Goku still has a guard-sclera review and Naruto's transformed-KO edge is closed by a 2/2
live suite. Spider-Man's web-kit presentation is 40/40 live gameplay checks. Iron Spider's core is
58/58 with a designed native-bone stow/retract, separate victory/rematch/defeat/rematch coverage,
and all 37 selectable opponents covered. Its clip matrix remains 55/57: the two static source poses
are unrepairable without invented motion, and the original source confirms this is not a runtime
binding defect; both are preserved and unselected. Its 58/58 SwiftShader report is separate from
hardware at `artifacts/iron-spider/software-run.json`; the targeted hardware attempt was blocked
before any check, so no `hardware-run.json` exists. At that date Vegeta and T-800 were A1 partial
at 13/13 migration plus 25/25 moving clips; this was superseded on 2026-11-13 by their 42/42
matrices, with source topology repaired. Hardware is still 0/6 for this cohort, and the A1 exit
gate remains open.

**Exit gate:** 8/8 live-proven fighters pass A0 with no fallback.

### A2. Complete the imported middle cohort

Run A0 on Aquaman, Hulk, Flash, Green Lantern, Saitama, Madara, Sasuke, Thor, Aang, Hashirama and
Wonder Woman. Fix only the failures the gate exposes: missing states, retarget defects, scale,
material, surfaces, signature damage and reactions.

**Exit gate:** 11/11 imported fighters pass A0, or are explicitly moved to a blocked list with a
named missing asset/clip.

### A3. Complete the two no-clip imported fighters

Superman and Doctor Strange get a validated clip package (retargeted or authored) and pass A0.

**Exit gate:** 2/2 pass A0.

### A4. Complete the authored/original launch bodies

Work in batches by shared rig family:

1. The 19-bone roster bodies that share the authored pipeline.
2. Kaze and Infantry, which already have special lanes.
3. Any body requiring a bespoke rig or equipment attachment.

For each: final body review, complete clip set, equipment, moveset, transformation, ultimate and A0.
Do not mass-promote a batch without individual match evidence.

**Exit gate:** 17/17 original launch slots pass A0.

### A5. Character-specific combat experience

Once the animation and match foundations pass, deepen each fighter using the existing systems:

- signature move behavior and timing;
- weapon/equipment attachment and hit volumes;
- movement and flight profile;
- transformation visuals and stat/move changes;
- cinematic ultimate sequence;
- archetype-specific reactions and victory/defeat presentation.

Do not add a second combat engine per character. Extend the shared frame-data, projectile, hitbox,
state-machine and camera systems.

### A6. Launch roster sign-off

- 38/38 launch fighters selected from the real roster and played in a real match.
- 0 fallback bodies, 0 missing animations, 0 placeholder sign-offs.
- A completed best-of-three per fighter and at least one multi-opponent match matrix.
- Full hardware visual/performance pass.
- DLC identities preserved but not used to inflate launch completion.

**Stage A exit:** all 38 launch fighters are demonstrably playable, distinct and complete.

## 5. Stage B — build the worlds

### B0. World acceptance and asset budget

For every world define the visual reference, playable footprint, collision strategy, camera staging,
texture/mesh budget, load strategy, fallback and capture points. Reuse the existing world catalog,
authored arenas, stage camera, skyline loader and lazy-loading pattern.

**Asset sourcing rule:** research the real location, prefer owned or clearly licensed GLB/glTF
assets, record author/source/licence, stage the untouched archive, measure it against the existing
scene and optimize only after acceptance. Reject candidates that are worse than the current
foundation. Do not substitute generic procedural geometry for a finished location.

### B1. New York — finish the showcase slice

Current state: Stark Tower frontage, roof helipad, branded plaza and imported Avengers Tower
landmark; playable match captures exist. The imported tower is not framed by the plaza camera, and
the plaza/roof identity still needs a final decision.

Tasks: resolve the duplicate tower identity or the plaza sightline; final façade/interior/roof
cohesion; collision/camera; hardware performance capture.

**Exit:** one complete New York stage with a real match and a resolved landmark composition.

### B2. Konoha

Replace rejected rock-island assets with a real Hokage Rock relief and textured village architecture.
Preserve the playable street/roof layout. Validate scale against 1.8 m fighters and capture a real
match.

### B3. Hogwarts

Texture and detail the authored 603-mesh castle first; then add selected interior/exterior assets.
Preserve collision and the existing interior work. Capture both a duel and an exploration pass.

### B4. Valley of the End

Preserve the original authored arena. Add water/spray, statue and terrain surface detail; verify
composition, collision and the original source. Capture before/after.

### B5. Asgard

Improve the existing authored architecture and materials with recognizable palace/rainbow-bridge
landmarks; preserve the playable arena and camera.

### B6. SHIELD Helicarrier

Upgrade the authored deck/interior with recognizable carrier structure, turbines, aircraft and
cloud-sea atmosphere; preserve the arena footprint.

### B7. Dragon Ball Z / Tournament

Upgrade the tournament stage and add **Planet Namek as a DBZ sub-area**, not a new top-level map.
Keep the existing tournament rules.

### B8. World sign-off

Every map: no missing assets, color-managed materials, collision/edge cases, camera framing,
loading and unloading, real match, exploration pass where applicable, hardware performance and
captures. **No world is complete until all of that is demonstrated.**

## 6. Stage C — complete the game experience

The systems exist; the work is integration and polish, not a rebuild.

### C1. Core flow

Title → character select (P1/P2/CPU, forms/variants) → map/world select → rules/difficulty →
loading → match → pause → results → rematch. Every transition must preserve selections and handle
back/cancel/error states.

### C2. Loading and failure handling

Per-asset progress, character/map names, cancel/retry, missing-asset fallback messaging, no frozen
loading screen, no duplicate requests and no silent texture/model failures.

### C3. Pause, settings and accessibility

Resume, restart, controls, audio, graphics presets, camera options, reduced motion where practical,
readable HUD, remappable inputs and persistent settings.

### C4. Match endings and progression

KO/ring-out/time rules, rounds, victory/defeat, statistics, rematch without stale models or textures,
tournament progression and unlock/selection state where applicable.

### C5. Presentation

HUD clarity, hit feedback, VFX/audio timing, character intro/victory poses, cinematic ultimates,
camera behavior and arena-specific atmosphere.

**Stage C exit:** one complete game loop can be played from first launch through repeated rematches
without developer intervention.

## 7. Stage D — exploration and open-world expansion

This is deliberately last. It must not delay the fighting game.

1. **Flight and traversal:** shared flight controller, aerial camera, collision, landing and recovery.
2. **Explorable spaces:** walkable/roof/air routes attached to completed maps; no empty traversal.
3. **Interactions:** pickups, destructible props, environmental hazards, traversal points.
4. **World content:** missions/encounters/collectibles only after the core maps are complete.
5. **Performance:** streaming/LOD/culling budgets measured on supported hardware.

## 8. Existing systems and assets to reuse

| Need | Reuse first |
| --- | --- |
| Roster resolution | `public/models/characters/manifest.json`, roster arrays and display aliases |
| Imported body preparation | `scripts/install-character-assets.mjs`, Blender scripts, GLB packing and material conversion |
| Retargeting | `public/js/anim/bind_pose_retargeter.js`, rig-family maps and solo lanes |
| Animation runtime | `animation_controller.js`, body masks, transition policy and facial/weapon overlays |
| Combat | existing frame data, hitboxes, projectiles, movesets, abilities, transformations and ultimates |
| Match flow | existing title/select/arena/loading/pause/result/rematch code |
| Camera | `SmashCamera.js`, stage framing, skyline staging and collision shortening |
| Worlds | `world_catalog.js`, `cinematic_arenas.js`, authored GLBs, NYC skyline loader |
| Validation | `validate:assets`, roster/model/rig/moveset/animation gates, Playwright harnesses |
| Evidence | existing `artifacts/` conventions and JSON reports; keep SwiftShader vs hardware distinct |

## 9. Execution order and first milestones

1. **A0:** launch acceptance gate — **38/38 expanded A0 pass**, 0 failures/skips/timeouts; hardware
   and full launch sign-off remain open.
2. **A1:** close Goku guard-sclera/hardware, Spider-Man hardware, Naruto hardware, Vegeta/T-800
   hardware (their source topology is repaired), and Iron Spider hardware. Vegeta and T-800 now pass
   the full 42/42 matrix; their repaired source topology is 0 / 0 for both Vegeta and T-800,
within the 80-edge budget.
   Iron Spider's designed native-bone
   stow/retract, separate victory/rematch/defeat/rematch coverage and 37/37 selectable roster
   coverage are complete. The two static Iron Spider source poses have no recoverable motion and
   every derived GLB is channel-identical; preserve them as non-combat references rather than
   authoring replacement keys.
3. **A2:** finish hardware/full-gate acceptance for the imported supplement rows; their expanded A0
   animation coverage now passes (Hulk, Green Lantern, Flash, Aquaman, Superman, Doctor Strange, Kaze).
4. **A3:** finish remaining full-gate and hardware acceptance for the imported supplement rows.
5. **A4:** finish the authored original launch bodies in shared batches.
6. **A6:** 38/38 launch sign-off on hardware, then freeze the fighter contract.
7. **B1–B9:** worlds in the stated order, starting with finishing New York.
8. **C1–C5:** connect the complete game loop.
9. **D1–D5:** exploration only after the core game stands on its own.

The next concrete task is to close the A1 live-proven residuals, not to start map production. Every later batch depends on the same real-match evidence shape.

## 10. Current blockers and recorded limitations

- **No hardware GPU evidence.** All current WebGL captures are SwiftShader composition evidence.
- **Dirty worktree.** The repository carries extensive uncommitted work; do not reset, clean, stash,
  commit or force-checkout while executing this roadmap.
- **Source asset gaps.** Saitama and Hashirama had author-disabled downloads during acquisition;
  several supplied bodies are static or have incompatible rest poses. Do not claim those exact source
  assets were integrated when they were not.
- **Source geometry defects.** Vegeta and T-800 were both repaired to 0 / 0 welded
  open-boundary and non-manifold edges; Harry (498) and Naruto (352) retain source limitations. Runtime validation and animation can pass; do not describe
  the meshes as clean production topology.
- **Clip coverage is uneven.** Superman and Doctor Strange have no declared clips; Flash has 12 and
  Green Lantern 4. The launch gate must prove missing states rather than assume them.
- **Original launch bodies are unfinished by the new standard.** Shared procedural motion is not a
  substitute for a complete per-fighter clip set and final model review.
- **World completeness is low.** Only New York has a partial showcase slice. The other seven worlds
  are audited foundations with incomplete asset/texture/detail passes.
- **NYC composition.** The imported Avengers Tower is not framed by the plaza camera; the duplicate
  Stark/Avengers identity is explicit but unresolved.
- **Performance is unverified.** Wonder Woman alone is a 51 MB body; map and character budgets must be
  measured on hardware, not inferred from cloud frames.

## 11. Progress record

| Date | Work | Evidence | Claim |
| --- | --- | --- | --- |
| 2026-11-12 | Goku baked face rig refined: almond lids, tapered lash, guard partial-lid suppression | `artifacts/animation-overlays/goku-face-blink-eyes-detail.png`, 280 Node checks, 20/20 live, build 0 | Goku face refinement complete; launch gate still open |
| 2026-11-12 | A0 launch acceptance gate built and run across the 38 launch fighters | `scripts/verify-launch-roster.mjs`, `artifacts/launch-acceptance/report-all.json`, 76 captures | 31/38 A0 PASS; 7 animation-blocked; 0/38 full sign-off; SwiftShader only |
| 2026-11-12 | A0 gate expanded to select/air/chain/defence/knockdown/second-match checks | `report-ten-section-goku-5.json`, `report-ten-section-naruto.json`, `report-ten-section-vegeta.json` | Goku 40/40, Naruto/Vegeta 37/37; other 35 rows await rerun; hardware open |
| 2026-11-12 | Goku state bindings, full-state matrix and six-fighter guard/offhand audit | `artifacts/goku-state-matrix/report.json`, `artifacts/phase22-5/offhand-guard-audit.json` | Goku 43/43 active + 3 retired; guard audit 6/6 |
| 2026-11-12 | Seven A0 animation gaps closed with compiled state clips | `artifacts/a0-library-*.log` | Seven rows individually A0 PASS; later 28-row expanded completion made the master 38/38 expanded |
| 2026-11-12 | Expanded A0 rerun completed for the 28 baseline rows | `artifacts/launch-acceptance/report-expanded-28a.json`, `report-expanded-28b.json`, `expanded-38-summary.json` | 38/38 expanded A0 pass; 0 failures/skips/timeouts; full sign-off 0/38 |
| 2026-11-12 | Forced knockdown probe replaced by a real unforced P2 heavy collision | `artifacts/launch-acceptance/unforced-38.json`, `report-all.json` | 38/38 unforced knockdown/get-up pass; master 38/38 A0; full sign-off 0/38 |
| 2026-11-12 | Character-scale warning audit and body-only height check | `artifacts/launch-acceptance/report-scale-*.json`, `artifacts/a0-scale-*.log` | Raw warnings are source units; Green Lantern 1.88, Aquaman 1.93, Strange 1.88, Flash 1.83 |
| 2026-11-12 | Phase 2 launch audit: 38-row checklist and current body measurement | `docs/LAUNCH_ROSTER_ACCEPTANCE.md`, `artifacts/roster-bodies.json`; 280 Node checks, validate:assets, build | 0/38 fully signed; 8 live-proven; implementation gate still open |

### Verification actually run for this audit

- `npm run test:animation` — 280 checks passed.
- Goku overlay live proof — 20/20 passed.
- `npm run validate:assets` — pass.
- `npm run build` — exit 0.
- `git diff --check` — clean for the Goku changes.

The broader acceptance counts quoted in section 3 come from the repository's recorded reports
(`ROSTER_MAPPING.md`, `ROSTER_INTEGRATION_PROGRESS.md`, `IMPORTED_MIGRATIONS_ACCEPTANCE.md`,
`ENVIRONMENT_OVERHAUL_PROGRESS.md`); they were not all re-run for this audit.

## 12. Continuation instructions

Read, in order:

1. This document.
2. `docs/ROSTER_INTEGRATION_PROGRESS.md` for the latest character-session facts.
3. `docs/ENVIRONMENT_OVERHAUL_PROGRESS.md` for world facts.
4. `docs/IMPORTED_MIGRATIONS_ACCEPTANCE.md` for the signature/acceptance contract.

Then execute **A0**. Do not start map reconstruction while launch fighters still lack the real-match
gate. Do not commit, push, reset, clean, stash or force-checkout without explicit authorization.
Keep source archives, rollback URLs, captures, JSON reports, exact commands and remaining blockers in
the progress record as each batch closes.
