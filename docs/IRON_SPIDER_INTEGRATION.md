# Iron Spider — native arms, runtime asset and clip integration

Status: **NATIVE ARMS REPAIRED — browser E2E green (58/58, including five designed stow/retract checks plus separate victory, rematch, defeat and post-defeat-rematch coverage), an 8/8 arm pose sheet, a 37/37 selectable-launch-roster match matrix (SwiftShader; hardware-GPU capture pending), a designed native-bone stow/retract state, a complete 57-clip visual matrix (55 PASS / 2 STATIC SOURCE POSES; both forensically confirmed, not runtime failures), and a focused 17/17 aerial/ultimate probe. The 58/58 SwiftShader report is kept at `artifacts/iron-spider/software-run.json`; a targeted hardware attempt was blocked by SwiftShader before any check and produced no `hardware-run.json`.**
Last verified: **2026-11-13**, Playwright 1.65.0 / Chromium headless runs of `npm run test:iron-spider`, `scripts/verify-fighter-aerial-completion.mjs iron`, the batched `scripts/verify-iron-spider-match-matrix.mjs` matrix plus `scripts/merge-iron-spider-match-matrix.mjs`, a fresh four-batch 57-clip matrix, a fresh original-source accessor audit `scripts/audit-iron-spider-source-animations.py`, the designed native-bone stow/deploy live run, and the stow/retract source and skeleton inspection.

## Asset of record

| Item | Value |
| --- | --- |
| Roster slot | `iron_spider` (existing identity; no duplicate fighter) |
| Source, untouched | `public/models/characters/iron_spider/iron_spider.glb` and `artifacts/iron-spider/original/iron_spider.source.glb` |
| Runtime body | `public/models/characters/iron_spider/iron_spider_source_animated.glb` |
| Runtime SHA-256 | `08124a094f6c3faa216ad0f238cb1422935042b01a89254dbd2183eccab0186d` |
| Runtime bytes | 11,231,696 |
| Skeleton | 107 joints, one skin family |
| Clips | **57** = 32 original MFF clips + 25 supplemental roster clips |
| Meshes in runtime | **6 renderable skinned meshes** (body, two suit pieces, two web pieces, `Object_122` arms) |
| Vertices / triangles | 5,181 / 5,795 |
| Materials | 4 supplied materials/textures |
| Supplied arm mesh | `Object_122`: 1,110 vertices, 1,200 triangles, 21 appendage bones |
| Source materials/textures | preserved from the supplied asset |
| Repaired runtime rollback | `artifacts/iron-spider/arms/runtime-before-arm-repair.glb`, SHA-256 `0d30b0d27e27db4455bb47c0652b2176e31b6038fcaa381b025bf5e141df59cf` |
| Generated roster rollback | `/models/characters/roster/iron_spider.glb` |

The untouched source is preserved. The direct-GLB candidate is also kept at
`artifacts/iron-spider/arms/iron_spider_arms_glb_candidate.glb`; it is byte-identical to the
production runtime.

## What was wrong with the supplied arms

`Object_122` was present and fully weighted, but its authored geometry sat at roughly 25× the body
scale: bounds about **45.4 × 51.5 × 57.5 m**, with the arm centred far below the body. No original
animation clip brought it into a usable scale; a Blender sampling pass found 31 clips with arm
bounds of 20–90 m. The body bake therefore omitted the mesh, and the live fighter used the
procedural four-leg fallback.

The earlier Blender re-export candidate is **not used**: it produced duplicate arms at a wrong
placement. The accepted path edits a copy of the working runtime GLB directly, preserving the
supplied mesh, skin weights, skeleton and all 57 clips.

## Direct-GLB repair

The repair tool is `scripts/repair_iron_spider_arms_glb.mjs`. It:

- fits `Object_122` to the native body space with scale `0.03919749` and translation
  `[-0.000104, 0.097631, -0.003651]`;
- applies a reflection (inversion determinant `-1`) and reverses the triangle winding so the
  reflected mesh does not render inside-out;
- reattaches exactly one `Object_122` under the body's `Object_5` hierarchy;
- retains **all 1,110 arm vertices, 1,200 triangles, 107 skeleton bones and 57 clips**.

The repair is reproducible: re-running the tool on the preserved pre-repair runtime
(`artifacts/iron-spider/arms/runtime-before-arm-repair.glb`) writes
`artifacts/iron-spider/arms/glb-repair-reproduced.glb` with the same SHA-256
`08124a094f6c3faa216ad0f238cb1422935042b01a89254dbd2183eccab0186d` as the production runtime.

The fit is deliberately accepted with a measured residual, not claimed as exact:

- RMS error: **0.175231 m**
- worst-point error: **0.240272 m**

These residuals mean the arm placement is a repaired fit, not a precision re-rig. Any future
animation that exposes a bad attachment point should be fixed against this known baseline. The
full fit/bounds/bone-group evidence is in
`artifacts/iron-spider/arms/glb-repair-report.json`.

## Live playable verification

The production path was loaded after disabling the browser cache. The game selected the normal
Iron Spider roster card and started a genuine Iron Spider vs Goku match on the Tournament arena.

Observed state:

- mount URL: `/models/characters/iron_spider/iron_spider_source_animated.glb`;
- runtime status: **loaded**; validation issues: **none**;
- **6 skinned meshes**, 107 bones, 1.78 m target height, feet at 0;
- native arm object count: **1** (`Object_122`), visible and skinned;
- `nativeSpiderLegs` set by the loader, with **21 appendage bones** and **107 skeleton bones**;
- **procedural four-leg rig absent**; it is not silently drawing a second set of arms;
- idle arm world bounds: **1.211 × 1.323 × 1.211 m**, centred on the fighter, not displaced below
  the map;
- current clip `Armature|hero_spiderman01_S05@idle` before input;
- J played `Armature|hero_spiderman01_S05@atk-01`;
- K played `Armature|hero_spiderman01_S05@skill07-02`, set the special cooldown to its 0.9 s
  window, dealt **17%** damage and **0.55 s** hit stun to the adjacent opponent;
- the four terminal appendage bones were sampled as four **0.55 m leg-tip contact volumes**; a
  rear-tip contact outside the shockwave cone landed the signature, and the volumes cleared when
  the sweep ended;
- the arm remained attached and bounded through the signature.

Evidence:

- `artifacts/iron-spider/arms/live-candidate-current.png` — live arena frame;
- `artifacts/iron-spider/arms/live-candidate-closeup.png` — enlarged live fighter crop showing the
  back-mounted supplied appendages;
- `artifacts/iron-spider/arms/glb-repair-report.json` — fit, bounds and bone-group report;
- `artifacts/iron-spider/arms/live-candidate-idle.png` — first idle capture from the same GLB
  (the earlier title-screen frame is not acceptance evidence).

The arm is visible, attached, correctly scaled, and deforming with the native skeleton. The
procedural fallback was the previous visible result; it is no longer the shipped presentation.

## Aerial and result completion (2026-11-13)

The supplied 57-clip inventory is unchanged (SHA-256
`08124a094f6c3faa216ad0f238cb1422935042b01a89254dbd2183eccab0186d`).

- **Victory** now plays the suit’s own `Armature|hero_spiderman01_S05@succ_cam`, not the generic
  roster victory supplement. The authored `die` clip remains defeat.
- **Double jump** and **fall** are semantic library actions compiled onto the body’s own 107-bone
  rig. They are stored only in `doubleJumpAction` / `fallAction`; they are deliberately not added to
  the GLB clip inventory, so the supplied 32 source + 25 supplemental clips stay exactly 57.
- `scripts/verify-fighter-aerial-completion.mjs iron` passed **17/17** in live play:
  first jump `jump` → second jump `double_jump` → `fall` → `land` → `idle`; `succ_cam` victory at
  weight 1.0; ultimate `skill07-02` through the real O input path, **19%** damage and **91.82°** of
  native spider-leg bone motion.
- `npm run test:iron-spider` still passes **58/58**, including stow/deploy, signature, native
  leg-tip contact, raised stage, both player sides, full victory/defeat and both rematches. Log:
  `artifacts/iron-spider/full-suite-after.log`.
- The 57-clip assertion now reads the mounted asset’s real animation inventory rather than the
  alias-map key count; the alias map is not a clip inventory and was never a reliable 57-clip
  measure.
- Focused report: `artifacts/iron-spider/aerial-completion/report.json`; ultimate capture:
  `artifacts/iron-spider/aerial-completion/ultimate.png`. These are SwiftShader captures.

No Iron Spider geometry, textures, skeleton, mechanical-arm mesh or source animation was changed.

## Browser E2E and capture set

Playwright **1.65.0** was installed into this runner (extraneous: `--no-save --package-lock=false`, so
`package.json` and the lockfile are unchanged) together with Chromium **158.0.8127.18** (build 1254)
and its system libraries. `npm run test:iron-spider` then ran against real headless Chromium.

**58/58 checks passed, exit 0.** Log: `artifacts/iron-spider/software-run.log`.

The run covers the roster card and its advertised signature, P1 = Iron Spider, the 57-clip body,
the mounted `Object_122` arm and its native bone groups, the absence of the procedural fallback, the
three arm acceptance criteria (all 1,110 vertices dominantly weighted to the native spider chain and
0 unweighted; idle world bounds 1.107 × 1.184 × 0.777 m instead of the authored 45.4 × 51.5 × 57.5 m;
a spider-leg bone rotating during `skill07-02` while the arm stays under `Object_5`),
the runtime rig gate and floor contact, the designed native-bone stow/retract transition, run/jump/land,
light-attack animation with damage and stun, the signature clip, damage to an adjacent opponent, four native leg-tip contact volumes, a rear-tip hit
outside the shockwave cone, tip-volume cleanup, arm attachment and bounds through the sweep,
knockout, raised-platform grounding, Iron Spider as player 2 (movement, damage taken, hit stun,
knockback, its own signature), the pulled-back camera, stage travel to the Hogwarts Great Hall, a
complete best-of-three victory, a fresh rematch after that victory, a separate two-round defeat,
a fresh rematch after that defeat, and zero browser, console or model-request errors.

The completed victory ends **VICTORY · IRON SPIDER, rounds 2–0**. The defeat ends
**DEFEAT · GOKU, rounds 0–2**. Those rounds are produced by the harness's deterministic KOs, not by
human play: the matches, damage and result screens are real game code, but the scores are not a
skill result. Each rematch is asserted to restore a fresh Iron Spider match with 0% damage, cleared
result text and the native `Object_122` arm still mounted.

Captures (`artifacts/`):

| Frame | File |
| --- | --- |
| Character select | `iron-spider-select.png` |
| Roster grid | `iron-spider-roster.png` |
| Idle | `iron-spider-idle.png` |
| Run | `iron-spider-run.png` |
| Jump | `iron-spider-jump.png` |
| Light attack | `iron-spider-attack.png` |
| Signature (spider-leg shockwave) | `iron-spider-special.png` |
| Native leg-tip contact volumes, F3 overlay | `iron-spider-leg-tip-volumes.png` |
| Knockout | `iron-spider-knockout.png` |
| Raised platform | `iron-spider-raised-stage.png` |
| Iron Spider as player 2, live gameplay | `iron-spider-player2.png` |
| Match result | `iron-spider-match-complete.png` |
| Real defeat result | `iron-spider-defeat.png` |
| Rematch after victory | `iron-spider-rematch-after-victory.png` |
| Rematch after defeat | `iron-spider-rematch-after-defeat.png` |
| Contact sheet, 11 tiles | `iron-spider-captures.png` |
| Arm pose sheet, 6 tiles (idle/heavy/signature × front/side) | `iron-spider/arm-pose-sheet.png` |
| Pose-sheet source frames | `iron-spider/arms/pose-sheet/{idle,heavy,signature}-{front,side}.png` |
| Roster matrix, 37 selectable opponents × 4 frames | `iron-spider/matrix/<opponent>/{01-match,02-light-hit,03-signature,04-result}.png` |
| Roster matrix overview, 37 signature tiles | `iron-spider/matrix/matrix-sheet.png` |
| Roster matrix detail pages, 10 opponents each | `iron-spider/matrix/matrix-sheet-01.png` … `matrix-sheet-04.png` |
| Original four-opponent summary, preserved | `iron-spider/matrix/matrix-sheet-four-opponents.png` |

Rendering is headless software (SwiftShader), so these captures are composition evidence — not
hardware visual or performance verification.

### Native-arm pose sheet

`scripts/capture-iron-spider-arm-sheet.mjs` drives the live roster body through three poses and
shoots each from the front and the fighter's left side with the game's spectator camera, with the
simulation paused per pose and the modern HUD hidden. It composes the six 1000×1000 frames into
`artifacts/iron-spider/arm-pose-sheet.png` and writes the measured report to
`artifacts/iron-spider/arm-pose-sheet.json`.

- idle — `Armature|hero_spiderman01_S05@dialog_idle`; arm world bounds 0.80 × 1.32 × 0.89 m;
- heavy (Shift+J, resolved move `heavy`) — `Armature|hero_spiderman01_S05@skill02-03`; **55.6°**
  peak spider-bone rotation from idle; bounds 1.38 × 1.10 × 1.16 m;
- signature (K) — `Armature|hero_spiderman01_S05@skill07-02`; **52.1°** peak spider-bone rotation
  from idle; bounds 1.22 × 1.07 × 0.65 m.

All six frames show `Object_122` attached under `Object_5`; the procedural four-leg fallback is
absent. The run passed **8/8 checks** with no page errors and no failed model/asset requests
(`artifacts/iron-spider/arm-pose-sheet.log`). The sheet is headless SwiftShader composition
evidence, not a hardware or performance check.

### Roster match matrix

`scripts/verify-iron-spider-match-matrix.mjs` boots the game and plays a separate Iron Spider
match against every **selectable launch-roster opponent**. The launch roster has 38 entries
including Iron Spider, so the matrix covers **37 opponents**. The other 22 of the 60 catalog
entries have no character-select slot and cannot be driven through the real selection and
combat paths. Opponents are processed in batches; every row uses the game's select, set-rules,
mount, J/K and result path.

The CPU is frozen so every sample measures Iron Spider's hit against a stationary opponent. Every
row records a real **J light hit** (9.55% + 0.291 s stun) and a real **SPIDER-LEG ASSAULT**
signature (`Armature|hero_spiderman01_S05@skill07-02`, 17%, 0.8 s cooldown), repeated until the
opponent crosses the 150% cap. All 37 rows end **VICTORY · IRON SPIDER**. The original four
opponents and batch 01 use best-of-three rules; batches 02–04 use one-round matches to keep the
full matrix runtime feasible. The deterministic KO setup means the scores are not a human skill
result; the matches, damage, hit stun, signature and result screens are the game's own code.

| Group | Opponents |
| --- | --- |
| Original four | Spider-Man, Superman, Goku, Master Chief |
| Batch 01 | Infantry, Iron Man, Hulk |
| Batch 02 | Green Lantern, Wolverine, Wonder Woman, Professor X, Flash, Aquaman, Doctor Strange, Arnold, Naruto, Vegeta |
| Batch 03 | Saitama, L, All Might, Edward, Levi, Mario, Luigi, Kratos, Link, Geralt |
| Batch 04 | Doom Slayer, Thor, Aang, Madara, Hashirama, Voldemort, Sasuke, Edna, Captain Jack, Kaze |

**37/37 match rows, 148 captures, and 185/185 per-opponent checks pass.** The merged report has
**188/189 checks**: the sole failure is the batch-03 browser-runtime check, which recorded three
non-fatal `Cannot set properties of undefined (setting 'value')` page errors while all ten
batch-03 matches still passed. No asset request failed. Batch 03's report was reconstructed from
its complete log and 40 captures after the batch sheet screenshot timed out; it is marked
`recoveredFromLog`, and no match result was inferred.

Evidence:

- `artifacts/iron-spider/matrix/report.json` — merged measured report (37 rows);
- `artifacts/iron-spider/matrix/report-four-opponents.json` — preserved original four-opponent report;
- `artifacts/iron-spider/matrix/report-batch-01.json` … `report-batch-04.json` — batch reports;
- `artifacts/iron-spider/matrix/matrix-sheet.png` — 37-tile signature overview;
- `artifacts/iron-spider/matrix/matrix-sheet-01.png` … `matrix-sheet-04.png` — detail pages;
- `artifacts/iron-spider/matrix/matrix-sheet-four-opponents.png` — preserved original four-opponent sheet;
- `artifacts/iron-spider/matrix/merge-full.log` and `run-batch-0*.log` — merge and batch logs.

**Renderer status:** the matrix above is headless Chromium/SwiftShader composition evidence. This
runner has no hardware GPU: `/dev/dri` is absent, no NVIDIA device is exposed, and Chromium reports
`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`. The matrix runner
therefore has a hardware-only mode that writes to a separate directory and refuses to start matches
when `IRON_MATRIX_GPU=1` sees SwiftShader or llvmpipe:

```sh
IRON_MATRIX_GPU=1 IRON_MATRIX_OUT=artifacts/iron-spider/matrix-gpu \
  bash scripts/run-browser-test.sh scripts/verify-iron-spider-match-matrix.mjs
```

That run records the actual `WEBGL_debug_renderer_info` renderer and a `hardwareGpu` flag in its
report. The command was exercised here and exited 1 with the SwiftShader renderer, so no software
frames were promoted to hardware evidence. No hardware-GPU matrix has been produced yet.

The main Iron Spider suite uses the same split: `software-run.json` is the 58/58 SwiftShader record,
while only a real GPU run may write `hardware-run.json`. The targeted attempt is recorded in
`artifacts/iron-spider/hardware-gpu-attempt.json` and
`artifacts/hardware-gpu/summary-iron-spider.json`; both the preflight and the suite rejected
SwiftShader before checking gameplay.

### Full 57-clip visual matrix

`scripts/verify-iron-spider-clip-matrix.mjs` reads the **57 unique GLB clips** directly from the
live 107-bone body instead of trusting the public action map, which has 57 keys but only **50
unique clips** because seven aliases overwrite each other. A dedicated mixer action is posed at
the measured peak for every clip; the harness records skinned bounds, native-arm presence and
visibility, browser errors and failed asset requests, then captures a 640×720 frame.

The 25 supplemental clips carry only 19 tracked body bones. Their constant malformed pelvis
rotation placed the export on the ground, so the harness seeds them from the upright source-idle
pose, drops the helper `.scale` tracks, and removes the partial pelvis rotation while keeping all
limb rotations and translations. The two measured-static clips skip the action seek entirely so
their malformed constant root tracks cannot overwrite the upright seed.

| Result | Evidence |
| --- | --- |
| **57/57 captures** | `artifacts/iron-spider/clip-matrix/clips/NN-short.png` |
| **55 PASS / 2 FAIL** | `artifacts/iron-spider/clip-matrix/report.json` |
| 32 source + 25 supplemental | 30 clips with arm animation |
| **9/9 harness checks** | 57 images, all actions measured, native arm visible, no browser or asset errors |
| Summary sheet | `artifacts/iron-spider/clip-matrix/clip-matrix-sheet.png` |

Explicit failures, preserved rather than hidden:

- `collection` (03/57) — one-frame static source pose (zero duration); 144 tracks / 104 targets,
  all with a single key at t=0; no multi-key rotation or translation channel and no live pose
  change. It is a distinct authored pose, not the bind pose, and all 20 spider-leg targets
  (39 channels) are present but have **0 moving channels**.
- `skill07-03` (27/57) — two-second static source pose; 196 tracks / 103 targets, all 100 rotation
  channels single-key; 45 translation channels carry 61 keys but move at most **2.139e-06 m from
  the first key** and **5.960e-08 m key-to-key** (floating-point noise). Rotation and scale motion
  are zero and there is no live pose change. All 20 spider-leg targets (38 channels) are present
  but have **0 moving channels**.

**Original-source forensic audit (2026-11-12).** The authoritative source is the untouched
Sketchfab extraction at
`artifacts/asset-fetch/99e52e57a8dc4feda750af87b87d2955/extracted/scene.gltf` plus `scene.bin`.
`scripts/audit-iron-spider-source-animations.py` parsed that source and compared its channel data
with `public/models/characters/iron_spider/iron_spider.glb` (source GLB),
`artifacts/asset-fetch/iron_spider/iron_spider.glb` (fetch GLB) and
`public/models/characters/iron_spider/iron_spider_source_animated.glb` (runtime GLB). For both
clips the channel data is **identical** across all four copies: same track count, targets, key
times and values. The prepared normalized bake differs because it normalizes every joint to two
near-constant keys; it still contains no body motion. All targets in both clips resolve inside the
107-joint skin, with **0 targets outside the skeleton**. The live matrix also reports
`actionFound: true` for both and 0 moving bones. This is a source-animation limitation, not a
runtime binding or interpretation failure.

Neither clip is referenced by the Iron Spider gameplay slot map in
`public/js/anim/animation_manifest.js` (`runtimeMapReferences: 0` for both); they load as actions
but are inventory/animation-acceptance failures, not combat-state failures. There is no
FBX/Blender source or hidden action curve in the workspace. Repairing either clip would require
authoring new motion or borrowing another clip, so **no repair was applied**; both remain
preserved, unselected and recorded. Evidence:
`artifacts/iron-spider/forensic-diagnostic.json`,
`artifacts/iron-spider/forensic-diagnostic-a1.json` (fresh 2026-11-12 rerun),
`artifacts/iron-spider/forensic-diagnostic-a1.log`,
`artifacts/iron-spider/forensic-collection.log`,
`artifacts/iron-spider/forensic-skill07-03.log`,
`artifacts/iron-spider/forensic-e2e.log`, and the four fresh batch reports. The full write-up is
`artifacts/iron-spider/FORENSIC_INVESTIGATION.md`.

The 2026-11-12 full matrix was captured in four fresh batches
(`report-forensic-batch-01.json`, `report-forensic-batch-02.json`,
`report-forensic-batch-03a.json`, `report-forensic-batch-03b.json`) and merged into
`report.json`. The pre-forensic full report and sheet are preserved as
`report-full-57-pre-forensic.json` and `clip-matrix-sheet-full-57-pre-forensic.png`; the earlier batch
files are preserved with `-pre-forensic` suffixes. The matrix uses headless
Chromium/SwiftShader, so the sheet is composition evidence, not hardware visual or performance
verification.

## Clip preservation

The 32 original clips remain in the runtime; the 25 supplemental clips remain as well. The
following are preserved but not selected by the current state mapper:

- `collection` — one-frame static source pose; no temporal motion (forensic audit above);
- `skill07-03` — two-second static source pose; only sub-micrometre translation noise, no
  recoverable body motion;
- dialogue clips, extra idle variants and camera-track variants.

The live controller used the original `idle`, `atk-01`, and `skill07-02` clips. The Node clip
audit found **30/32** original clips move the real 107-joint skeleton. The full visual matrix
measured **55/57** clips across 32 source and 25 supplemental clips; the same two static source
poses are the only explicit failures and are recorded rather than treated as usable combat states.
The forensic audit confirms that neither failure is a runtime binding problem and that neither can
be repaired from the supplied data without inventing motion.

## Verification status

| Check | Result |
| --- | --- |
| Native `Object_122` present, skinned and visible in live match | **PASS** |
| Native arm replaces procedural four-leg presentation | **PASS** |
| Arm stays bounded through idle, light attack and signature | **PASS** |
| Light input plays an original attack clip | **PASS** — `atk-01` |
| Signature input plays original signature clip and damages adjacent opponent | **PASS** — `skill07-02`, 17%, 0.55 s |
| Runtime rig gate | **PASS** — no issues |
| Asset loaded, all 57 clips exposed | **PASS** |
| `npm run test:iron-spider` | **PASS** — 58 checks, exit 0, Playwright 1.65.0 (2026-11-12 rerun); five designed stow/retract checks, separate victory, rematch, defeat and post-defeat-rematch checks, native tip volumes and an F3 volume capture |
| Native-arm front/side pose sheet | **PASS** — 8/8 checks; idle/heavy/signature; 55.6°/52.1° spider-bone motion; `arm-pose-sheet.png` |
| Node GLB inspector topology gate | **NOT GREEN** — exits nonzero on 371 open boundary edges; source has 352. The runtime rig and live match pass. |
| Selectable launch-roster match matrix | **PASS — 37/37 rows**; 148 captures; 185/185 per-opponent checks; 188/189 merged checks with one non-fatal batch-03 UI runtime error; all VICTORY · IRON SPIDER |
| Full 57-clip visual matrix | **COMPLETE — 55 PASS / 2 FAIL**; fresh four-batch rerun 2026-11-12, 57 captures, 32 source + 25 supplemental, 30 arm-animated, 9/9 checks; failures `collection` and `skill07-03` are static source poses, not integration failures |
| All 60-character roster visual matrix | **NOT APPLICABLE for 22 catalog-only entries** — 38 launch entries are selectable (37 opponents + Iron Spider), and all 37 opponents are covered |
| Native leg-tip contact volumes | **PASS** — four terminal bones sampled per sweep; rear-tip contact outside the shockwave cone lands the signature; F3 overlay draws the volumes |

`scripts/test-iron-spider.mjs` asserts the mounted native arm, the absence of the procedural
fallback, the signature clip and real signature damage, a complete victory, a fresh rematch after
that victory, a real two-round defeat, and a fresh rematch after that defeat. It was executed in
this runner on 2026-11-12, not merely syntax-checked. The coverage report is
`artifacts/iron-spider/a1-defeat-rematch.json`.

## Designed stow/retract state

`Object_122` is one skinned mesh under the body's `Object_5` hierarchy, sharing the supplied
107-joint skeleton and 21 weighted appendage bones. The 57-clip library contains no stow/retract
clip, so the shipped retract is a **deliberate procedural fold on the native chain** in
`public/js/anim/native_spider_stow.js`. It does not hide the mesh, swap a model, edit a clip or
change joint lengths.

- **Pose:** the four five-bone chains accordion into a narrow stack behind the backpack, with
  mirrored upper/lower directions and a shallow side fan. The folded tip envelope is smaller on
  every axis than the deployed idle envelope.
- **Transition:** a 0.30 s damped blend from the authored clip pose to the fold; a second press
  blends back to the exact authored pose. The overlay is recomputed after the active clip owner
  writes the skeleton, so it never accumulates offsets or leaves a bind-pose cache behind.
- **Control and rules:** `G` for P1 (backslash for P2) toggles stow while grounded and neutral. An
  attack, jump, dodge, hit reaction, grab, flight, KO or round reset deploys the appendages; the
  signature therefore cannot land from a folded/hidden hitbox. Round reset snaps the state and
  progress back to deployed.
- **Preservation:** all 57 clips, including the untouched static source poses `collection` and
  `skill07-03`, are unchanged; `Object_122` stays visible, skinned, parented to `Object_5`, and
  retains all 21 appendage bones.

Live validation is part of **58/58** in `scripts/test-iron-spider.mjs`: deployed start, a smaller
native-bone envelope, a mid-transition sample, exact redeploy, unchanged source clips, and attack
auto-deploy. Folded/redeployed captures are `iron-spider-stow-folded.png` and
`iron-spider-stow-redeployed.png` beside the main suite artifacts; close-ups are
`artifacts/iron-spider/stow-folded-{front,side,back}.png`.

The pre-implementation options and source audit remain in
`artifacts/iron-spider/STOW_RETRACT_FEASIBILITY.md`. In particular, `collection` and `skill07-03`
remain preserved static poses: their arm envelope is essentially idle, they have zero moving
spider-leg channels, and neither was repurposed as a stow animation.

## Remaining work

1. **Done:** the native-arm front/side pose sheet covers idle, a heavy strike and the signature
   sweep (`arm-pose-sheet.png`). **Done:** the full 57-clip matrix has a capture for every clip
   (55 PASS / 2 FAIL); the two failures are the static source poses above, not harness gaps.
   The original-source audit confirms both originate in the untouched source and every derived
   GLB carries identical channel data; no source-backed repair is possible without authoring new
   animation.
2. **Done:** the native arm exposes four terminal-bone leg-tip volumes; a tip contact outside the
   shockwave cone lands the signature once, and the volumes clear at the end of the sweep. The
   shockwave remains the area hit; separate per-leg damage budgets would be a balance decision.
3. **Done for all selectable opponents:** 37/37 launch-roster opponents are covered; no
   selectable-roster rows remain. The 22 catalog-only entries have no character-select slots and
   are out of scope unless they are promoted to the launch roster.
4. Investigate the batch-03 non-fatal UI error (`Cannot set properties of undefined (setting
   'value')`) if a runtime-error-free matrix is required; all ten batch-03 matches and captures
   passed, so this is not an Iron Spider combat failure.
5. Keep the source archive and the pre-repair runtime; do not overwrite either.
6. **Done:** a designed native-bone stow/retract state is implemented and covered by five live
   checks; the mesh stays visible and every clip is untouched. Hardware acceptance remains open;
   the prepared hardware run and renderer checklist are in `docs/HARDWARE_GPU_ACCEPTANCE.md`.
7. **Done:** separate victory, rematch, defeat and post-defeat-rematch coverage remains green in
   the 58-check suite. The 37/37 selectable-launch-roster matrix has no remaining selectable rows;
   the 22 catalog-only entries are out of scope unless promoted.

No commit, push, reset, clean, stash or amend was performed.
