# Hardware-GPU acceptance run — Goku, Spider-Man, Iron Spider, Naruto, Vegeta, T-800, Hulk, Aquaman and The Flash

Status: **runbook ready; not executed on hardware.** This workspace has no GPU and renders through
SwiftShader, so every result produced here remains software evidence. A hardware pass exists only
after a run on the target GPU produces the evidence below with `HARDWARE_GPU=1`.

When a hardware summary and the three A1 reports are available, validate them with
`docs/HARDWARE_GPU_RESULT_VERIFICATION_CHECKLIST.md`. That checklist is a verification procedure,
not a hardware result.

The A1-trio package was executed again on 2026-11-13 at **13:55 UTC**. This runner has no
`nvidia-smi`, no `/dev/dri` and no PCI display device; Chromium again reported
`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) ...), SwiftShader driver)`. The preflight
exited **1** and **zero fighter suites launched**. Current receipt:
`artifacts/hardware-gpu/summary-hulk-a1-aquaman-a1-the-flash-a1.json`; log:
`artifacts/hardware-gpu/a1-attempt-gpu-rerun.log`. This is a blocked attempt, not hardware evidence.

The A1 trio — Hulk, Aquaman and The Flash — was added to this package on 2026-11-13. Each already
has a live **42/42** software matrix report with the source clips each pack actually supplies
selected (attacks where present, plus locomotion and death), and each hardware suite is wired to the
same hard renderer gate as the six earlier targets. None of the three has hardware evidence yet. The
machine-readable package record is `artifacts/a1-combat/hardware-package.json`; it points to the
actual preflight attempt, suite paths and the software baseline.

## 1. Target prerequisites

- A physical GPU (NVIDIA, AMD or Intel) with a current vendor driver. Hardware acceleration must be
  enabled in Chromium; software WebGL is not acceptable.
- Chromium/Chrome with WebGL2, on a display for the normal headed run. Use the same browser build
  for all nine fighters.
- A checkout with the current working tree, `node_modules` installed, and the existing browser
  libraries installed by `scripts/run-browser-test.sh`.
- No `--use-angle=swiftshader`, no `--enable-unsafe-swiftshader`, no `llvmpipe`/softpipe fallback.
- A writable `artifacts/hardware-gpu/` directory.

## 2. Exact command

```sh
cd /path/to/browser-smash
HARDWARE_GPU=1 npm run accept:hardware-gpu
```

To run only the three completed A1 fighters into a separate ledger:

```sh
HARDWARE_GPU_ONLY=hulk-a1,aquaman-a1,the-flash-a1 \
  HARDWARE_GPU=1 npm run accept:hardware-gpu
```

To run only Iron Spider:

```sh
HARDWARE_GPU_ONLY=iron-spider HARDWARE_GPU=1 npm run accept:hardware-gpu
```

A targeted run writes `artifacts/hardware-gpu/summary-<suite-ids>.json`; it does not replace the
full nine-fighter `summary.json`.

The runner leaves the browser **headed by default** so it uses the real display driver. If the host
is a verified headless-GPU host, opt in explicitly:

```sh
HARDWARE_GPU=1 HARDWARE_GPU_HEADLESS=1 npm run accept:hardware-gpu
```

Do not set `HARDWARE_GPU_HEADLESS=1` on a machine that has not been shown to expose a hardware
renderer in that mode.

The runner performs this order:

1. `scripts/probe-hardware-gpu.mjs` — renderer preflight and screenshot.
2. `scripts/verify-goku-hd-match.mjs` — Goku live match/captures.
3. `scripts/verify-spider-man-gameplay.mjs` — Spider-Man gameplay.
4. `scripts/verify-spider-man-import.mjs` — Spider-Man import/state/result.
5. `scripts/test-iron-spider.mjs` — Iron Spider live match, designed stow/retract, signature, victory/rematch/defeat/rematch.
6. `scripts/verify-naruto-a1.mjs` — Naruto movement/form/signature/ultimate probe.
7. `scripts/verify-naruto-transformed-ko.mjs` — Naruto KO during SAGE MODE and the result-screen rematch.
8. `scripts/verify-imported-migrations.mjs` with `MIGRATION_ONLY=vegeta` — Vegeta live migration/body/clip checks.
9. `scripts/verify-imported-migrations.mjs` with `MIGRATION_ONLY=t800` — T-800 live migration/body/clip checks.
10. `scripts/verify-a1-combat-matrix.mjs "Hulk (Bruce Banner)"` — Hulk live 42-check A1 matrix.
11. `scripts/verify-a1-combat-matrix.mjs "Aquaman"` — Aquaman live 42-check A1 matrix.
12. `scripts/verify-a1-combat-matrix.mjs "The Flash (Barry Allen)"` — The Flash live 42-check A1 matrix.

Direct equivalents, if a single suite needs to be rerun:

```sh
HARDWARE_GPU=1 bash scripts/run-browser-test.sh scripts/probe-hardware-gpu.mjs
HARDWARE_GPU=1 bash scripts/run-browser-test.sh scripts/verify-goku-hd-match.mjs
HARDWARE_GPU=1 bash scripts/run-browser-test.sh scripts/verify-spider-man-gameplay.mjs
HARDWARE_GPU=1 bash scripts/run-browser-test.sh scripts/verify-spider-man-import.mjs
HARDWARE_GPU=1 bash scripts/run-browser-test.sh scripts/test-iron-spider.mjs
HARDWARE_GPU=1 bash scripts/run-browser-test.sh scripts/verify-naruto-a1.mjs
HARDWARE_GPU=1 bash scripts/run-browser-test.sh scripts/verify-naruto-transformed-ko.mjs
HARDWARE_GPU=1 MIGRATION_ONLY=vegeta bash scripts/run-browser-test.sh scripts/verify-imported-migrations.mjs
HARDWARE_GPU=1 MIGRATION_ONLY=t800 bash scripts/run-browser-test.sh scripts/verify-imported-migrations.mjs
HARDWARE_GPU=1 bash scripts/run-browser-test.sh scripts/verify-a1-combat-matrix.mjs "Hulk (Bruce Banner)"
HARDWARE_GPU=1 bash scripts/run-browser-test.sh scripts/verify-a1-combat-matrix.mjs "Aquaman"
HARDWARE_GPU=1 bash scripts/run-browser-test.sh scripts/verify-a1-combat-matrix.mjs "The Flash (Barry Allen)"
```

## 3. Renderer capture requirements

The preflight is the gate. It must call the game's actual renderer context, not a separately created
probe canvas, and must write `artifacts/hardware-gpu/preflight.json` plus
`artifacts/hardware-gpu/preflight.png`.

### Required fields in `preflight.json`

| Field | Requirement |
| --- | --- |
| `hardwareMode` | `true`; the runner sets `HARDWARE_GPU=1` |
| `launch.headless` | `false` for the normal headed run; record the exact launch mode |
| `gpu.available` | `true` |
| `gpu.webgl2` | `true` |
| `gpu.debugRendererInfo` | `true` (WEBGL_debug_renderer_info was available) |
| `gpu.vendor` / `gpu.unmaskedVendor` | Non-empty unmasked vendor from `WEBGL_debug_renderer_info`; fallback `VENDOR` only if the extension is unavailable |
| `gpu.renderer` / `gpu.unmaskedRenderer` | Non-empty unmasked renderer from `WEBGL_debug_renderer_info`; fallback `RENDERER` only if the extension is unavailable |
| `gpu.version` | WebGL version string |
| `gpu.shadingLanguageVersion` | GLSL version string |
| `gpu.maxTextureSize` / `gpu.maxRenderbufferSize` | Numeric limits from the live context |
| `gpu.canvas` | Backing-store and client dimensions |
| `gpu.viewport` | `innerWidth` / `innerHeight` |
| `gpu.devicePixelRatio` | Actual DPR |
| `gpu.userAgent` | Exact browser user agent |
| `gpu.capturedAt` | ISO timestamp |
| `checks.webglContext` | `true` |
| `checks.webgl2` | `true` |
| `checks.debugRendererInfo` | `true` |
| `checks.hardwareVendor` | `true`; the renderer string must not match software rendering |
| `checks.noPageErrors` | `true` |
| `pass` | `true` |

**Software-renderer rejection.** The renderer/vendor strings must not match:

```text
/swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i
```

The exact observed renderer string must be recorded in `preflight.json` and every suite report. A
suite whose renderer string differs from the preflight's renderer is a fail, even if its checks pass.

### Required screenshots

Screenshots must be PNG captures of the real game canvas/viewport, not crops, upscales or a
separate clean render. Keep the game HUD/result state visible where the suite includes it.

| Evidence | Exact path | Viewport | Requirement |
| --- | --- | --- | --- |
| Preflight | `artifacts/hardware-gpu/preflight.png` | 1366×768 | Nonblank live game frame; file exists |
| Goku KO | `artifacts/goku-hd/16-ko.png` | 1280×720 | Goku KO/result frame from the live match |
| Spider-Man gameplay | `artifacts/spider-man-gameplay/25-after-ultimate.png` | 1366×768 | Post-ultimate live gameplay frame |
| Spider-Man import/result | `artifacts/spider-man-import/12-bo3-result-spider-man.png` | 1366×768 | Best-of-three result screen |
| Iron Spider result | `artifacts/iron-spider-rematch-after-defeat.png` | 1280×800 | Post-defeat rematch frame; defeat evidence also remains in `iron-spider-defeat.png` |
| Naruto A1 ultimate | `artifacts/a1-naruto/live-ultimate.png` | 1280×800 | Live ultimate frame from the focused A1 probe |
| Naruto transformed KO | `artifacts/a1-naruto/transformed-ko-result.png` | 1280×800 | `VICTORY · NARUTO UZUMAKI` result while SAGE MODE had been active; the rematch is checked in JSON |
| Vegeta signature | `artifacts/imported-migrations/vegeta/05-signature.png` | 1366×768 | Live GALICK GUN signature frame |
| T-800 signature | `artifacts/imported-migrations/t800/05-signature.png` | 1366×768 | Live CYBERNETIC CANNON signature frame |
| Hulk form KO | `artifacts/a1-combat/hulk/11-victory-ko-during-form.png` | 1280×800 | Live WORLDBREAKER RAGE form active through the match-ending KO, result visible |
| Aquaman form KO | `artifacts/a1-combat/aquaman/11-victory-ko-during-form.png` | 1280×800 | Live KING OF THE DEEP form active through the match-ending KO, result visible |
| The Flash form KO | `artifacts/a1-combat/the-flash/11-victory-ko-during-form.png` | 1280×800 | Live SPEED FORCE ASCENDANT form active through the match-ending KO, result visible |

The runner requires each file to exist and be larger than 1 KiB. File size is only a basic
non-empty guard; a human must inspect the frame for the claimed state. A blank, black, cropped or
wrong-fighter frame is a fail even if the JSON checks pass.

### Per-suite report fields

Each suite must write a report containing:

- `hardwareMode: true`
- `gpu` with the same renderer object as the preflight
- `softwareRenderer: false`
- the complete `checks` array (or, for Iron Spider, `checks` names plus `passed`)
- page/console/asset errors (empty arrays for a pass)

Expected paths:

- `artifacts/goku-hd/report.json`
- `artifacts/spider-man-gameplay/report.json`
- `artifacts/spider-man-import/report.json`
- `artifacts/iron-spider/software-run.json` — SwiftShader 58/58 evidence (including designed stow/retract); never hardware acceptance
- `artifacts/iron-spider/hardware-run.json` — only a real GPU run may create or replace this file
- `artifacts/a1-naruto/live-a1-probe.json`
- `artifacts/a1-naruto/transformed-ko.json`
- `artifacts/imported-migrations/report-vegeta.json`
- `artifacts/imported-migrations/report-t800.json`
- `artifacts/a1-combat/hulk/report.json`
- `artifacts/a1-combat/aquaman/report.json`
- `artifacts/a1-combat/the-flash/report.json`

## 4. Pass/fail checklist

Copy this checklist into the acceptance record and mark it only from the actual run.

### Renderer and environment

- [ ] `HARDWARE_GPU=1` was set for every command.
- [ ] Browser ran on the target physical GPU, not SwiftShader, llvmpipe, softpipe or another software renderer.
- [ ] `preflight.json` parsed and `pass === true`.
- [ ] `gpu.webgl2 === true`, `gpu.debugRendererInfo === true`, and unmasked vendor/renderer are non-empty.
- [ ] Preflight renderer string is not in the software-renderer denylist.
- [ ] Preflight renderer string equals the renderer recorded by every suite.
- [ ] Exact browser user agent, DPR, viewport, WebGL/GLSL versions and driver renderer are recorded.
- [ ] `preflight.png` exists, is nonblank, and shows the live game.
- [ ] No page errors, console errors or failed asset/model requests in the preflight.

### Goku

- [ ] `artifacts/goku-hd/report.json` exists and `hardwareMode === true`.
- [ ] **9/9** Goku checks pass.
- [ ] Select preview plays authored idle; promoted body is mounted; textures and authored clips are active.
- [ ] Kamehameha charge/release/recovery and the three transformations pass.
- [ ] A natural KO and round result are present.
- [ ] `16-ko.png` exists and shows the claimed Goku state.
- [ ] No page/console/asset errors.

### Spider-Man

- [ ] `artifacts/spider-man-gameplay/report.json` exists and `hardwareMode === true`.
- [ ] **40/40** gameplay checks pass: locomotion, jab/combo/heavy/aerial, guard/dodge/hit/knockdown/get-up, web signature kit, ultimate and transformation.
- [ ] `25-after-ultimate.png` exists and matches the measured post-ultimate state.
- [ ] `artifacts/spider-man-import/report.json` exists and `hardwareMode === true`.
- [ ] **21/21** import/state/result checks pass, including heavy, defeat and best-of-three.
- [ ] `12-bo3-result-spider-man.png` exists and shows the claimed result.
- [ ] No page/console/asset errors.

### Iron Spider

- [ ] `artifacts/iron-spider/hardware-run.json` exists and `hardwareMode === true`; a SwiftShader report at `software-run.json` is not accepted in its place.
- [ ] **58/58** Iron Spider checks pass, including the five designed stow/retract checks.
- [ ] Native `Object_122` arm is mounted, skinned, visible and bounded; the procedural fallback is absent.
- [ ] Stow folds a compact native-bone envelope without hiding `Object_122`; a second press redeploys; attacks auto-deploy; all 57 clips stay unchanged.
- [ ] Signature, leg-tip contacts, stage travel and player-2 path pass.
- [ ] Separate `VICTORY · IRON SPIDER` (`[2,0]`), rematch after victory, `DEFEAT · GOKU` (`[0,2]`) and rematch after defeat all pass.
- [ ] Both rematches have fresh 0% health, cleared result text and the native arm still mounted.
- [ ] `iron-spider-rematch-after-defeat.png` exists; `iron-spider-defeat.png`, `iron-spider-rematch-after-victory.png` and `iron-spider-rematch-after-defeat.png` are retained.
- [ ] No browser runtime errors, console errors or missing model requests.

### Naruto

- [ ] `artifacts/a1-naruto/live-a1-probe.json` exists and `hardwareMode === true`.
- [ ] **7/7** focused A1 checks pass: walk, sprint after the dodge window, form exit, right-hand Rasenshuriken, ultimate return, no page errors and no failed assets.
- [ ] `artifacts/a1-naruto/transformed-ko.json` exists and `hardwareMode === true`.
- [ ] **2/2** transformed-KO checks pass: the form is landed before the KO, the result is `VICTORY · NARUTO UZUMAKI` with `winner: p1`, and the result-screen rematch is fresh with the form cleared.
- [ ] `live-ultimate.png` and `transformed-ko-result.png` exist and show the claimed states.
- [ ] No page/console/asset errors.

### Hulk, Aquaman and The Flash (A1)

- [ ] `artifacts/a1-combat/{hulk,aquaman,the-flash}/report.json` exist and each has `hardwareMode === true`.
- [ ] Each report is **42/42** with `total: 42` and an empty `failed` array.
- [ ] `renderer` is the same object/string as the preflight; `softwareRenderer === false`.
- [ ] Every matrix section passes for each fighter: light chain, heavy, aerial, grab/throw, guard/block, parry/counter, knockdown/get-up, jump/land, ultimate, form, victory-during-form, rematch, defeat and rematch-after-defeat.
- [ ] The form KO shows the form's `... ENDED` callout, not a natural `... FADED` exit.
- [ ] The neutral heavy runs the selected source clip where one exists: Hulk `@atk02`, The Flash `punch`; Aquaman reports the authored trident heavy because no source strike exists.
- [ ] The defeat capture shows the grounded defeat pose (`@die`, `GroundDeathB`, `defeat`), not the frozen killing-blow hit reaction.
- [ ] The result-screen REMATCH control starts a fresh round 1 at wins 0–0 and both fighters at 0%.
- [ ] `11-victory-ko-during-form.png` exists for each fighter and shows the live form and the correct result headline.
- [ ] No page/console/asset errors and no failed requests.
- [ ] Do not describe these 42-check matrices as arena-art acceptance; they run in the live `valley` combat stage, as they do in software.

### Vegeta and T-800

- [ ] `artifacts/imported-migrations/report-vegeta.json` and `report-t800.json` exist with `hardwareMode === true`.
- [ ] **13/13** migration checks pass for each fighter, including the promoted body, HUD name, moveset, weapon state, keyboard locomotion, authored jab damage, signature state/damage, hit reaction and all 25/25 baked clips moving the skeleton.
- [ ] Vegeta keeps empty hands and fires GALICK GUN from `GD_hand_R_186` with `fallback:false`; T-800 equips the heavy shotgun and fires CYBERNETIC CANNON from `arm_right_wrist_027_37` with `fallback:false`.
- [ ] `05-signature.png` exists for each fighter and shows the claimed signature.
- [ ] The full ten-criterion A1 matrix remains separately open for these two; 13/13 migration checks must not be presented as full A1 acceptance.
- [ ] No page/console/asset errors.

### Runner result

- [ ] `summary.json` has `pass: true`.
- [ ] Every suite has `exitCode: 0`, the expected check count, `rendererMatches: true`, and a non-empty screenshot.
- [ ] A human reviewed every screenshot; no fallback model, blank frame or wrong-fighter image is accepted.
- [ ] The run is labelled **Hardware accepted** only in the hardware evidence class. Software evidence remains separately labelled.

## 5. Fail conditions

Any one of these fails the whole run:

- preflight missing, failing, or launched without `HARDWARE_GPU=1`;
- software renderer, WebGL1-only context, missing unmasked renderer evidence, or renderer mismatch
  between preflight and a suite;
- suite exit code non-zero, missing report, wrong check count, or a check marked false;
- missing/empty screenshot, or a screenshot that does not show the claimed state;
- page error, console error, failed asset request, or fallback body/arm;
- a Naruto transformed-KO run that does not show the form before the KO, a `p1` victory result, or a fresh rematch;
- a Vegeta/T-800 migration run misreported as the complete ten-criterion A1 pass;
- any attempt to count a SwiftShader run as hardware acceptance.

Do not weaken checks or omit a suite to obtain a pass. Rerun the affected suite after a repair and
preserve the failed logs.

## 6. Evidence record

Keep the complete directory:

```text
artifacts/hardware-gpu/
  preflight.json
  preflight.png
  summary.json
  summary-hulk-a1-aquaman-a1-the-flash-a1.json
  a1-attempt.log
  logs/
    preflight.log
    goku.log
    spider-man-gameplay.log
    spider-man-import.log
    iron-spider.log
    iron-spider-attempt.log
    naruto-a1.log
    naruto-transformed-ko.log
    vegeta.log
    t800.log
    hulk-a1.log
    aquaman-a1.log
    the-flash-a1.log
```

Record the date, machine/GPU model, driver version, browser version, display mode and operator in
the acceptance record. The JSON renderer capture is the machine-readable proof; the screenshots and
the human review are the visual proof.

## 7. Current status

The runbook and runner are prepared for nine fighters, but **no hardware-GPU acceptance result
exists in this workspace**. All existing Goku, Spider-Man, Iron Spider, Naruto, Vegeta, T-800,
Hulk, Aquaman and The Flash evidence is SwiftShader software evidence and must not be promoted to
hardware accepted. The full-run, targeted Iron Spider and both A1-trio attempts stopped at the
renderer preflight. The 13:55 UTC rerun again detected SwiftShader, exited 1 and launched zero
fighter suites.

Hulk, Aquaman and The Flash each have a fresh live **42/42** software matrix report dated
2026-11-13 (`artifacts/a1-combat/<fighter>/report.json`, `hardwareMode: false`,
`softwareRenderer: true`). Hulk's report proves `@atk02` heavy, `@dash` sprint and `@die` defeat;
Aquaman's proves `DashLoop` sprint and `GroundDeathB` defeat; The Flash's proves `punch` heavy,
`run` locomotion and its `defeat` pose. Their 14 captures per fighter are the visual evidence
reviewed in `artifacts/a1-combat/visual-review.json`; the 70-frame review was refreshed on the
idle-guard build on 2026-11-13 (all 70 hashes new, all five matrices 42/42) and remains clean for
fighter state after the shared Wonder Woman weapon-attachment fix. Contact sheets and frame index:
`artifacts/a1-combat/visual-review-idleguard/`. The captures remain software evidence, not hardware
visual sign-off. Validate a future hardware summary and these three reports with
`docs/HARDWARE_GPU_RESULT_VERIFICATION_CHECKLIST.md`. The three new hardware suites are registered in
`scripts/run-hardware-gpu-acceptance.mjs`; a hardware pass still requires a real-GPU preflight,
not a SwiftShader rerun.

Naruto's previously open transformed-KO edge now has software evidence: **2/2** in
`artifacts/a1-naruto/transformed-ko.json` (form landed, `VICTORY · NARUTO UZUMAKI`, fresh rematch
with the form cleared). Vegeta and T-800 now have hardware-run entries, fresh **13/13** migration
reports with real renderer capture, and full **42/42** live A1 matrices each. They remain **A1
software pass**, not fully accepted: no hardware run exists yet. Their source topology is now
repaired to the 80-edge budget: Vegeta 0 open / 0 non-manifold (from 407 / 3,862) and T-800 0
open / 0 non-manifold (from 2,198 / 45; the final 43 edges in `Object_63` and 6 in `Object_69`, on
the segmented hand/finger-joint strips, were closed with 49 existing-vertex cap faces). T-800's point-blank shotgun hitstun can also drop a held
guard before its light melee; the matrix verifies guard/dodge on its melee heavy and records that
interaction as a kit limitation.

The negative guard was exercised here on 2026-11-12 with
`HARDWARE_GPU=1 HARDWARE_GPU_HEADLESS=1 npm run accept:hardware-gpu`. The preflight detected
`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`, exited 1 and did
not launch any fighter suite. Evidence: `artifacts/hardware-gpu/preflight.json`,
`artifacts/hardware-gpu/summary.json`, and `artifacts/hardware-gpu/logs/preflight.log`.
The new Naruto transformed-KO suite was also invoked directly with the same environment and exited
1 at its own renderer assertion before running a check; evidence:
`artifacts/a1-naruto/transformed-ko-hardware-guard.log`. The negative runs are **not** hardware
acceptance results.

The A1 trio was attempted on 2026-11-13 with
`HARDWARE_GPU_ONLY=hulk-a1,aquaman-a1,the-flash-a1 HARDWARE_GPU=1 HARDWARE_GPU_HEADLESS=1 npm run accept:hardware-gpu`.
The preflight again detected the same SwiftShader renderer, exited 1 and launched **zero** fighter
suites (`suites: []`). Evidence: `artifacts/hardware-gpu/a1-attempt.log`,
`artifacts/hardware-gpu/summary-hulk-a1-aquaman-a1-the-flash-a1.json`,
`artifacts/hardware-gpu/preflight.json`, `artifacts/hardware-gpu/preflight.png`, and
`artifacts/a1-combat/hardware-package.json`. This is a blocked attempt, not an A1 hardware result.

Iron Spider was attempted separately on 2026-11-12 with
`HARDWARE_GPU_ONLY=iron-spider HARDWARE_GPU=1 HARDWARE_GPU_HEADLESS=1 npm run accept:hardware-gpu`.
The preflight again detected SwiftShader, exited 1 and launched no suite. The direct Iron Spider
suite was also refused by `assertHardwareGpu` before its first check. There is **no**
`artifacts/iron-spider/hardware-run.json`; the prior **58/58** SwiftShader result (including designed stow/retract) is preserved at
`artifacts/iron-spider/software-run.json`. Blocked-attempt evidence:
`artifacts/iron-spider/hardware-gpu-attempt.json`,
`artifacts/iron-spider/hardware-gpu-attempt.log` and
`artifacts/hardware-gpu/summary-iron-spider.json`.
