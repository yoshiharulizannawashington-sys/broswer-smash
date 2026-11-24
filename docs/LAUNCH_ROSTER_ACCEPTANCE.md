# Browser Bros — 38-fighter launch acceptance checklist

Date: **2026-11-13**  
Branch: `freebuff/726ce0c51041fd4f569ce7bd`  
Status: **A0 expanded gate: 38/38 rows pass (Goku 40 checks; the other 37 rows 37 checks),
with 0 failures, 0 skips and 0 timeouts. Full launch sign-off remains 0/38.** Hardware GPU and the
complete ten-section sign-off remain open. The seven former animation-gap rows are included.
Wonder Woman, Thor, Saitama, Hulk, Aquaman, The Flash, Vegeta and T-800 now also pass the full live
A1 combat matrix at **42/42 each (336/336 combined across eight fighters)**. Their records are
software pass with hardware still open; Vegeta and T-800 source topology is repaired to the 80-edge budget.
The 70-frame post-fix visual review for Hulk, Aquaman, The Flash, Vegeta and T-800 is clean after
the shared Wonder Woman weapon-attachment fix. Those five matrices were rerun again on the current
idle-guard build at 19:11–19:29 UTC on 2026-11-13, all at **42/42**, and the 70-frame review was
refreshed with 70/70 new capture hashes; contact sheets are in
`artifacts/a1-combat/visual-review-idleguard/` and the review record is
`artifacts/a1-combat/visual-review.json`.

This is the Phase 2 master checklist. It uses the current 38-entry launch roster in
`public/js/main.js`, the current manifest and freshly measured bodies from
`artifacts/roster-bodies.json`. DLC and catalog-only identities are excluded from launch sign-off,
but must remain preserved. Where a stable roster name differs from the player-facing name, the row
shows both.

## Gate definition

Every launch fighter must pass all ten sections in a real match before the row can be marked
`COMPLETE`:

1. **Body/model** — promoted production body, textured, no fallback.
2. **Proportions/height** — raw and runtime-normalized height agree, feet grounded.
3. **Animation bank** — complete clips or a deliberately validated shared lane.
4. **Movement** — idle, walk, run, sprint, jump, fall, land, turn and recovery.
5. **Basic combat** — light chain, heavy, aerial, anti-air/dive, grab/throw.
6. **Defence/reactions** — guard, parry, dodge, counter, light hit, heavy hit, knockdown, get-up.
7. **Special/ultimate** — signature and ultimate visibly play and deal real damage.
8. **Transformation** — real state change, cost/drain, visuals and restore, where applicable.
9. **Match result** — KO, round win/loss, victory/defeat and rematch.
10. **Evidence** — screenshots, JSON, no page errors, no failed asset requests, hardware pass.

A clip count is not a pass. A selected clip must move the mounted skeleton, and the gameplay state
must produce the expected damage, reaction or result. Imported source bodies must pass
`npm run audit:source-motion -- <model>` before acceptance: clips that are named but empty,
one-key/constant (`static`), or driven only by non-joint nodes (`skeleton-hollow`) fail unless a
documented static pose is named with `--allow-static`.

## A0 automated gate result — 2026-11-12

Harness: `scripts/verify-launch-roster.mjs`. It boots the real game page, selects through the live
character-select API, and runs each fighter through a real match. It records one JSON report and
`01-select.png`, `00-idle.png`, `03-result.png` and `05-rematch-result.png` per fighter under
`artifacts/launch-acceptance/<slug>/`.

**Result: 38/38 rows pass the expanded A0 gate; 0 failures, 0 skips, 0 timeouts.** Goku has 40
checks; every other row has 37. Master evidence: `artifacts/launch-acceptance/report-all.json` and
`artifacts/launch-acceptance/expanded-38-summary.json`. All runs used Chromium with SwiftShader;
this is **not** hardware-GPU acceptance and is **not** full launch sign-off. The prepared
hardware run, renderer-capture requirements and checklist are in `docs/HARDWARE_GPU_ACCEPTANCE.md`;
the preflight rejects SwiftShader before any fighter suite runs.

An A0 PASS means the following passed live: select-card preview with an idle model, mounted body
and textures, runtime height/feet, clip inventory coverage, idle skeleton motion, walk, sprint,
run, full jump/fall/land, five-input light chain, heavy, air attack, anti-air, dive, grab and
damaging throw follow-through, guard/shield, parry, counter strike, dodge, guard break, light hit,
unforced heavy-hit knockdown/get-up, signature damage, ultimate cast, declared transformation,
KO/victory, rematch, defeat, a second completed match, and no page errors or failed requests.

**All 38 rows pass the expanded gate with zero required failures.** Goku has 40 required checks
because the live transition probes add his double-jump, fall and fly-forward states; every other
row has 37. Evidence: `report-ten-section-goku-5.json`, `report-naruto-fall-fix2.json`,
`report-ten-section-vegeta.json`, plus `expanded-38-summary.json` for every row. The required
knockdown/get-up probe is now an **unforced P2 heavy collision**: P1 is placed at 120%, P2 enters a
real heavy input through the live simulate path, and the check requires actual damage, an airborne
sample, a knockdown clip, a landing and a get-up clip. No hitstun, groundLevel or animation state is
forced. The probe passed 38/38 rows; evidence: `unforced-38.json`.

**The queued knockdown-hardening task is already closed. Do not rerun it as A1 work:** the
required check is present and passing in all 38 master rows, and reopening it would duplicate A0.

A0 PASS is **not** full launch sign-off. Hardware GPU/frame-rate acceptance is still unavailable
(SwiftShader only); the unforced knockdown requirement is now closed for the automated A0 gate, but
it does not replace the full launch matrix.

### Seven animation-gap repairs

The seven rows that were A0 OPEN for animation coverage now pass their live A0 rows individually:
Superman, Hulk, Green Lantern, The Flash, Aquaman, Doctor Strange and Kaze. Their production models
are unchanged. `public/js/human_fighter.js` compiles only the missing semantic states from the
project's authored `clip_library` onto each mounted rig, preserving every supplied clip that was
already real. Hulk's late reaction load was replacing the semantic knockdown with `stun`; forced
state slots now win that load. Aquaman's motionless `HeroicIdleV2` is replaced by the authored
library idle so its idle-skeleton check is real motion, not a frozen pose.
The seven rows are included in the final **38/38 master**; individual pre-merge evidence is in
`artifacts/a0-library-*.log` and `artifacts/launch-acceptance/seven-gap-summary.json`.

| Former A0 OPEN fighter | Current individually verified state |
| --- | --- |
| Superman | **A0 PASS** after library state supplement; full launch sign-off still open. |
| Hulk | **A0 PASS** after library state supplement and late-reaction override fix. |
| Green Lantern | **A0 PASS** after library state supplement. |
| The Flash | **A0 PASS** after library state supplement. |
| Aquaman | **A0 PASS**; library idle replaces the motionless `HeroicIdleV2`. |
| Doctor Strange | **A0 PASS** after library state supplement. |
| Kaze | **A0 PASS** after library victory/defeat bindings. |

The master checklist below still records the full ten-section `Gate` state. Its `OPEN` values mean
"not fully signed off", even where the A0 row now says PASS.

### Goku launch-state matrix — 43/43 active, 3 retired

`scripts/verify-goku-state-matrix.mjs` mounts Goku through the live select path and plays every
active clip in `goku_animated.glb` on the 73-joint body. It sampled **43/43 active clips** with
finite motion and zero unresolved tracks. `DoubleJump`, `Fall` and `FlyForward` are wired into
the live state machine and were separately probed through real input: falling selects `Goku_Fall`,
a second jump selects `Goku_DoubleJump`, and forward flight selects `Goku_FlyForward`.

The three remaining authored clips are **retired by documented decision**: `Goku_Special` is an
exact alias of `Goku_Kamehameha`, `Goku_Air` is an exact alias of `Goku_AirPunch`, and
`Goku_Punch3` is an alternate straight replaced in the declared moveset by Rising Dragon Kick.
They remain in the source GLB but are not counted as launch states. Evidence:
`artifacts/goku-state-matrix/report.json` and `sheet.png`.

Direct ultimate probe: **4/4** live checks, authored-set motion moving 8 joints, cinematic active,
control and camera returned. Guard face probe passed: baked face, `expression: guard`, `Guard: 0.996`, `Blink: 0`; the
head close-up `artifacts/goku-state-matrix/guard-face.png` shows narrowed eyes with no detached
sclera. The previous guard-sclera symptom was not reproduced on the current baked asset. Hardware
visual review remains open.

### Spider-Man A1 gameplay presentation — 40/40

`scripts/verify-spider-man-gameplay.mjs` initially measured **20/40**. The failures exposed a real
presentation gap, not only harness drift: Miles's 26-clip imported body had no authored web-kit
casts, so Web Zip, Web Shot, Web Pull, Web Swing and Maximum Web Takedown fell back to the generic
`charge`/`beam` pair. The fix binds the existing canonical Spider-Man procedural clips onto the same
mixer and prevents the later imported strike pack from overwriting them with `beam`. It also binds
the held `web_swing` pendulum and semantic `fall`/`land` states.

Final live evidence (**SwiftShader**): **40/40**, including Web Zip damage 13 with return control;
Web Shot projectile from the right hand (`dealt: 9`); Web Pull damage with target displacement; Web
Swing Strike damage; held web-swing `web_swinging:true` with the authored pendulum; the three-beat
ultimate at 36% with meter spend, grab trace and control return; Spider-Sense activation and control
return; guard, dodge, hit reaction, knockdown/get-up and no page/asset errors. The second combo hit
is correctly asserted as the authored `heavy_punch` rather than an absent kick clip. Hardware
remains **OPEN**.

### Naruto A1 live acceptance — software-pass core, 37/37 + transformed KO

`A0_LABEL=naruto-a1 bash scripts/run-browser-test.sh scripts/verify-launch-roster.mjs "Naruto Uzumaki"`
produced a fresh **37/37** live match with no page errors or failed requests. The production
`naruto_sage_animated.glb` mounted with 19 bones, 3 skinned meshes, 9 textured materials, 1.80 m
height and grounded feet at 0.18. The fresh 49-state matrix was **49/49** with no missing or extra
clips; the baked GLB gate was **91/91**; the solo lane was **49/49** for Naruto and **134/134**
overall.

The corrected signature harness is **21/21**: all five forms transform (`SAGE MODE`,
`NINE-TAILS CHAKRA MODE`, `KURAMA LINK MODE`, `SIX PATHS SAGE MODE`, `BARYON MODE`), fire their own
signature, and exit back to the base `RASENSHURIKEN`. Keyboard combat is **18/18**: five-input light
chain, heavy/launcher/slam, CPU motion mapping and no page errors.

The focused `verify-naruto-a1.mjs` probe is **7/7**. It records walk (`walk`, 5.51), then sprint
input entering a dodge (`Naruto_jump`, 0.44 s remaining) and settling to a grounded `run` at 12.57
with `dodgeTimer:0`; this resolves the A0 sprint sample as a dodge-window sample, not a missing
sprint lane. It also records `RASENSHURIKEN` spawning from `RightHand` (`policy:"rightHand"`,
`fallback:false`, self-distance 0.605), form exit restoring `RASENSHURIKEN`, and the ultimate
returning from `casting:"ultimate"` to idle with meter spent. A0 supplies the unforced knockdown
(141.71%, 1.159 hitstun, hit → knockdown → get-up), victory, defeat, rematch and second complete
match.

The previously open transformed-KO edge is now covered by the focused
`verify-naruto-transformed-ko.mjs` suite: **2/2**. It activates SAGE MODE through the real `I`
input, confirms the form is landed, forces a real one-round KO, requires `VICTORY · NARUTO UZUMAKI`
with `winner: p1`, then clicks `REMATCH` and requires a fresh match with the form cleared, 0%
health and the result text gone. Evidence: `artifacts/a1-naruto/transformed-ko.json` and
`artifacts/a1-naruto/transformed-ko-result.png`. This closes the software edge; it does not establish
hardware acceptance.

All of this is **SwiftShader software evidence**, not hardware acceptance. Hardware and full launch
sign-off remain open; Naruto is **not fully accepted**.

### A1 cohort — Vegeta, T-800 (software pass; source topology repaired, hardware open)

Selected as the remaining A1 partial fighters with complete 25-clip semantic kits. Both use their
promoted supplied bodies: Vegeta's 311-joint Ultra Ego mesh and T-800's 53-joint endoskeleton.
The migration and the full live matrix were kept separate evidence; the matrix is **42/42 each,
84/84 combined**, with **0 page errors and 0 failed requests**.

| Fighter | A0 | A1 software result | Source / motion | Still open |
| --- | --- | --- | --- | --- |
| Vegeta | **37/37** | **42/42**; light chain 5/5 for 61.56%; heavies, anti-air, air/dive/finisher, grab and both throws; guard/parry/counter/break/dodge; knockdown/get-up; jump/land; GALICK GUN, BIG BANG ATTACK, FINAL FLASH and ultimate; **SUPER SAIYAN** entry from source `charge`, natural exit and KO during form; victory, defeat and both rematches | 25/25 retargeted clips moving; 19/19 roles; 0 unresolved nodes. Source supplied 0 clips. `G_root_309` has zero-quaternion keys in all 25 clips (482 keys), treated as identity. Max retarget step 95.6° (`air_attack`). **0 welded open-boundary edges / 0 non-manifold vs 80 budget** (repaired from 407 / 3,862; source preserved in `artifacts/source-topology-before/`) | Hardware; full sign-off |
| T-800 | **37/37** | **42/42**; five-hit chain (64.77% melee plus five shotgun shots, target 139.77%); heavies, anti-air, air/dive/finisher, grab and both throws; guard/parry/counter/break/dodge on the melee heavy; knockdown/get-up; jump/land; CYBERNETIC CANNON, SUPPRESSIVE ATTACK, EXPLOSIVE LAUNCHER and ultimate; **COMBAT CHASSIS OVERDRIVE** entry from source `charge`, natural exit and KO during form; victory, defeat and both rematches | 25/25 retargeted clips moving; 19/19 roles; 0 unresolved nodes; 0 motion warnings. Source supplied 0 clips. Max retarget step 105° (`throw`). **0 welded open-boundary edges / 0 non-manifold** (repaired from 2,198 / 45; the final 49 hand/finger-joint edges were closed with existing-vertex caps) | Hardware; point-blank shotgun hitstun can drop a held guard before light melee; full sign-off |

The T-800 light attack fires its equipped shotgun in addition to the melee hit. At point-blank the
shot applies 0.1 s hitstun to a held guard, so the follow-up light lands unguarded; a dodge armed at
the same instant is interrupted. That is a live kit interaction, not a matrix pass. The guard and
dodge checks therefore use T-800's real melee heavy, which blocks and is dodged under the normal
mechanics. Both fighters' form KOs were delivered while the form was active.

The source-topology review is `artifacts/a1-combat/source-topology-review.json`. Both promoted
meshes are now inside the 80-edge welded boundary budget: Vegeta 0 open / 0 non-manifold and T-800
0 / 0. The repair removed duplicate and non-manifold faces and capped boundaries with existing loop
vertices; no vertex was created. The supplied originals and before/after measurements are preserved
in `artifacts/source-topology-before/` and `artifacts/source-topology-after/`. Only hardware remains
as a blocker.

### A1 cohort — Aquaman, Hulk, The Flash (software pass; hardware open)

Selected because each has a recognizable production body, a live equipment/ability identity and
specific remaining work rather than a full unrun matrix: Hulk's bound source attack/locomotion table
was not actually being selected, Aquaman had no source sprint lane and one hollow cosmetic clip, and
The Flash's supplied punch was never played.

**Live matrix result: 42/42 for each fighter, 126/126 combined.** The same harness
(`scripts/verify-a1-combat-matrix.mjs`) uses the real character-select and match path, real P1
keyboard input and the real P2 input handler. Only positioning/reset and the game's own fixed step
are used between cases; damage, hitstun, guard, parry, throws, knockdown and KO are resolved by the
shipping combat code.

| Fighter | A0 | A1 software result | Source | Still open |
| --- | --- | --- | --- | --- |
| Aquaman | **37/37** | **42/42**; light chain 5/5 for 54.96%; all three heavies, anti-air, air, dive, air finisher, grab, forward and spike throws; guard/parry/counter/break/dodge; forced and unforced knockdown/get-up; form entry/exit and KO during form; victory and defeat; ultimate 30 | 43 clips: 42 moving; `DashLoop` supplies sprint; no source walk/run or strike clips; one unused skeleton-hollow `UI_DailySpin_Flying` | Hardware; authored trident attacks; one hollow cosmetic clip |
| Hulk (Bruce Banner) | **37/37** | **42/42**; light chain 5/5 for 82.90%; all three heavies, anti-air, air, dive, air finisher, grab and both throws; guard/parry/counter/break/dodge; forced and unforced knockdown/get-up; form entry/exit and KO during form; victory and defeat; ultimate 27 | 19 clips: 18 moving; source `atk01`/`atk02`, `skill01`-`05`, `dash`, hit/stun and `die` now play; one static `@collection` waived | Hardware; library jump/double-jump/fall/land/knockdown/get-up; authored `succ_cam` victory |
| The Flash (Barry Allen) | **37/37** | **42/42**; light chain 5/5 for 38.83%; all three heavies, anti-air, air, dive, air finisher, grab and both throws; guard/parry/counter/break/dodge; forced and unforced knockdown/get-up; form entry/exit and KO during form; victory and defeat; ultimate 32 | 12 clips: 10 moving; source `punch` owns heavy/heavyFinisher, `run` owns locomotion, `jumpDown` owns jump/land; two static poses waived | Hardware; library light chain/reactions/defeat |

The matrix covers the five-hit ground string, neutral/up/down heavies, anti-air, aerial, dive, aerial
finisher, grab, forward throw, spike throw, held guard, parry into counter, guard break, dodge
invulnerability, jump/air control/landing, turn/brake, signature, both kit abilities, ultimate, form
entry/exit and a real KO during the active form. Each fighter completes a live victory and a live
defeat, followed by a fresh rematch. The form KO is proved three ways: a pre-final hit is taken while
the form is live, the final hit deals real damage past 150%, and the shipping `endTransform(ko)`
callout fires. Hulk's form KO was observed at 145% pre-final; Aquaman at 138%; The Flash at 140%.

The jump probe reaches 2.25 m for all three, with measured air control of 1.02 m (Hulk), 1.35 m
(Aquaman) and 1.94 m (The Flash). The unforced heavy knockdown observes `maxHitstun` 1.143 s and
recovers through knockdown → get-up → the body's idle (`stand` for The Flash). No percentage was
forced to obtain the victory, defeat or form-KO result.

The first pass bound these source clips but still asked the authored roster motion first, so Hulk's
source attacks and The Flash's supplied punch could not play. Strike selection now prefers a bound
imported slot and falls back to authored motion only for slots the source pack does not cover. The
rerun proves the selected clip in the live report and capture: Hulk's neutral heavy plays
`Armature|hero_hulk01_S09@atk02`; The Flash's plays `punch` (`punch__upper` masked); Hulk's sprint
plays `@dash` at **11.94 m/s**, Aquaman's plays `DashLoop` at **13.54 m/s** and The Flash's plays
`run` at **7.68 / 17.52 / 7.69 m/s**. A second defect kept the loser in the killing-blow flinch:
the KO froze hitstun above zero, so the hit-reaction branch outranked the defeat pose. The defeat
pose now wins once the KO body is grounded; Hulk ends on `@die`, Aquaman on `GroundDeathB` and The
Flash on `defeat`. The A1 report now records the selected strike slot/clip, a locomotion snapshot
and the defeat pose clip so these claims are checkable rather than inferred.

Production defects closed by this cohort:

- **Imported strike selection:** bound source strikes were skipped because authored motion was
  requested first; imported slots now take precedence, with authored motion as the fallback.
- **Defeat pose priority:** frozen post-KO hitstun outranked the death pose; the grounded KO now
  plays the defeat clip instead of holding the final hit reaction.
- **Form presentation:** bodies with no authored transformation sequence and no source charge could
  enter a form on an idle pose. A shared semantic `charge` clip (crouch, gather, burst, settle) is
  now bound as the form action only when no source charge exists. Hulk, Aquaman and The Flash all
  report `clip: charge`, `source: library-charge`; authored form actions still win.
- **Aerial chain:** slow/heavy bodies landed before a third aerial press could become the air
  finisher. Aerial strings now cancel from the previous air attack once its active frames end,
  while grounded chains keep the full-recovery rule. All three resolve `air` → `air` →
  `airFinisher`.
- **Fall presentation:** bodies without a source fall action fell through to idle while descending.
  The shared semantic `fall` clip is now bound when no source fall exists; the movement probe sees
  `fall` airborne and a separate `land` on touchdown.

Hulk's previously open height review is closed: the source body measures **2.541 m**, normalized to
the **2.45 m** identity profile; the A0 check reports measured **2.45 m**, feet **0.18 m** on the
**0.18 m** ground, inside the 8% tolerance. Aquaman remains **1.93 m** body (2.52 m with the
trident) and The Flash **1.83 m**; their raw source bounds are normalized.

Residual source use is explicit. Hulk still plays library jump, double-jump, fall, land, knockdown
and get-up, while victory is the authored `succ_cam` success animation; Aquaman still plays library
idle/walk/run and its authored trident attacks because the pack
has no strike clips; The Flash still plays its authored light chain, reactions and library defeat
pose. One Aquaman source clip (`UI_DailySpin_Flying`) is skeleton-hollow and unused; one Hulk static
pose and two Flash static poses are waived. These are recorded limits, not claimed coverage.

Harness-level evidence fixes in this pass were kept honest rather than weakening assertions: slow
grabs and aerial steps wait on live state instead of fixed short delays; the form KO uses the form's
real signature (the Flash's 8 s form cannot finish with neutral heavies); projectile signature
damage is proved from the target percent trace because projectiles do not create a melee ledger
entry; and get-up accepts the authored `stand` idle clip. The reports still require real damage,
real knockdown/get-up, a live form, the `ENDED` end-transform callout and an actual match-over
result.

The original 42-capture review was conditional: Wonder Woman's sword stayed world-vertical while
her body was lifted and a small grey equipment block also separated. The shared holder orientation
was fixed in `syncEquippedWeapons()`; all five affected matrices (Hulk, Aquaman, The Flash, Vegeta,
T-800) were rerun at **42/42 each**, and all **70** post-fix captures were reviewed again. No frame
is blank, wrong-fighter, T-pose/detached, missing HUD or missing result. The grab/throw and
knockdown/get-up frames now show the sword and shield riding the torso, with no separate equipment
block. The review is **clean for fighter state**: `artifacts/a1-combat/visual-review.json`, with
regenerated contact sheets in `artifacts/a1-combat/visual-review-after-fix/`. The five matrices were
rerun again on the current idle-guard build on 2026-11-13 (Hulk 19:11, Aquaman 19:15, The Flash
19:19, Vegeta 19:22, T-800 19:29 UTC), each at **42/42** with 0 page errors and 0 failed requests.
All 70 captures were regenerated and reviewed (14 per fighter; 70/70 hashes differ from the
preserved pre-idle-guard set); the refreshed contact sheets and frame index are under
`artifacts/a1-combat/visual-review-idleguard/`. The review remains **PASS for fighter state**, with
the same software-only, effect-occlusion and valley-stage limits; the form `ENDED` callout is
recorded in each report rather than legible under the result panel. The separate 38-fighter
weapon-attachment regression also passes **38/38**, with 0 failures and 0 page errors
(`artifacts/phase22-3/acceptance/attachment.json`). Hardware-result validation for the A1 trio is
checklisted in `docs/HARDWARE_GPU_RESULT_VERIFICATION_CHECKLIST.md`; no hardware result exists yet.
The earlier six
source-binding frames remain valid: heavy frames show the selected attack pose and a readable target
reaction; defeat frames are result-state captures, with report `poseClip` fields (`@die`,
`GroundDeathB`, `defeat`) carrying the death-pose evidence. Flash's aerial/throw frames remain a
post-action timing note, not a defect. All captures are SwiftShader software evidence, and the live
`valley` stage cannot certify arena art or hardware visual quality; the reports and matrix states are
unaffected by the resolved attachment defect.

Evidence: `artifacts/a1-combat/summary.json`; per-fighter reports and 14 captures each under
`artifacts/a1-combat/{hulk,aquaman,the-flash}/`; run logs
`artifacts/a1-combat/{hulk,aquaman,the-flash}-sourcebinding-run.log`; A0 reports
`artifacts/launch-acceptance/report-a1-final-{hulk,aquaman,flash}.json`; height evidence
`artifacts/launch-acceptance-strict-01.log` and `artifacts/a1-cohort-final2.log`. All captures are
**SwiftShader software evidence**, not hardware acceptance.

The first slice is now a complete presentation pass: **Hulk vs Aquaman in Final Valley**. The real
title → VERSUS flow selected Hulk (P1) and Aquaman (CPU) through the fighter cards, selected Final
Valley through the arena card, set first-to-one / 60 seconds through the rule controls, and started
through START FIGHT. The cinematic entrance was captured while it owned the frame — both nameplates,
the VS beat, the arena/round tag, the authored Hulk/Aquaman exchange and the hidden gameplay HUD — and
it completed without being skipped, handing off to **round 1** with the round clock preserved. The
round was decided by combat: Aquaman won **0–1** in 18 s; Hulk dealt **127%** and took **153%** over
**4 hits**. No percentage was forced, no fighter was teleported, and the AI was not frozen. The
capture reports **25/25 checks**, 0 page errors and 0 failed requests, including a real click on the
result screen's REMATCH control: the fresh round starts at round 1, wins **0–0**, both fighters at
**0%**, no result text, and Final Valley preserved. This pass fixed two real
presentation defects: the intro now waits for the loading-ready edge instead of playing behind the
loader, and its clock starts on its first rendered frame; the setup line now reflects the selected
rules. Evidence: `artifacts/a1-cohort/slice-presentation/` and
`artifacts/a1-cohort/slice-presentation/slice-presentation.json`; harness:
`scripts/capture-vertical-slice-presentation.mjs`. The earlier forced-999 slice remains preserved
under `artifacts/a1-cohort/slice/` as the historical baseline.

The second slice is **Wonder Woman vs Thor in Asgard**, captured through the same parameterized
harness. The real title → VERSUS flow selected Wonder Woman (P1) and Thor (CPU) through the fighter
cards, selected Asgard through the arena card, kept first-to-one / 60 seconds, and started through
START FIGHT. The cinematic intro was captured while it owned the frame: both nameplates, the VS
beat, `ASGARD · GOLDEN CITY & ROYAL PALACE · ROUND 01`, the authored Wonder Woman/Thor exchange and
a hidden gameplay HUD. It completed without being skipped and handed off to round 1 with the clock
preserved. The round was decided by real combat: **Thor won 0–1 in 12 s**, with Wonder Woman dealing
**20%** and taking **154%**; no percentage was forced, no fighter was teleported and the AI was not
frozen. The capture reports **24/24 checks**, 0 page errors and 0 failed requests.

Asgard is materially slower under SwiftShader than Final Valley. The test-only intro duration was
raised from 8 s to 30 s (the first attempt captured a gameplay frame instead of the intro because
screenshot encoding outlasted the 8 s hold; the player default remains 5 s), and the wall-clock
round/result budgets were extended.
Neither change alters combat, damage, AI or the real 60 s round. Evidence:
`artifacts/a1-cohort/slice-presentation-wonder-woman-thor-asgard/` and its
`slice-presentation.json`; log `artifacts/a1-cohort/slice-wonder-woman-thor-asgard.log`. The arena
selection snapshot was taken at 900 ms and still reported `authored: procedural`; the frame shows
the Asgard stage and architecture, but this run does not claim that the authored `asgard.glb` had
finished mounting. The JSON's `selection.state.arena` and `selection.matchline` are the fighter-step
snapshot taken before the arena card; `arena.mapSelect`, `arena.title`, the live match and every
arena check are Asgard. The result is a real defeat, not a cherry-picked victory.

The selection screen's live 3D preview renders Hulk correctly once the model settles. `SwiftShader`
remains software-only evidence and no fighter is fully accepted.

### A1 cohort — Wonder Woman, Thor, Saitama (software pass; hardware open)

Selected for the A1 production cohort because each has a 25-clip production body, a distinct
equipment/ability identity and no prior character-level A1 record. The Aquaman/Hulk/Flash and
Naruto/Vegeta/T-800/Iron Spider evidence was preserved and not rerun.

**Live matrix result: 42/42 for each fighter, 126/126 combined.** The harness
`scripts/verify-a1-combat-matrix.mjs` uses the real character-select and match path, real P1
keyboard input and the real P2 input handler; damage, hitstun, guard, parry, throws, knockdown and
KO are all resolved by the shipping combat code. The only helpers position/reset fighters between
cases and advance the game's own fixed step.

| Fighter | A0 | A1 software result | Source | Still open |
| --- | --- | --- | --- | --- |
| Wonder Woman | **37/37** | **42/42**; light chain 5/5 for 54.96%; all three heavies, anti-air, air, dive, air finisher, grab, forward and spike throws; guard/parry/counter/break/dodge; forced and unforced knockdown/get-up; form entry/exit and KO during form; victory and defeat; ultimate 52 | 25/25 moving | Hardware; full visual sign-off; 938k triangles |
| Thor | **37/37** | **42/42**; light chain 5/5 for 64.84%; every attack branch; guard/parry/counter/break/dodge; forced and unforced knockdown/get-up; form entry/exit and KO during form; victory and defeat; ultimate 45 | 25/25 moving | Hardware; full visual sign-off |
| Saitama | **37/37** | **42/42**; light chain 5/5 for 89.38%; every attack branch; guard/parry/counter/break/dodge; forced and unforced knockdown/get-up; form entry/exit and KO during form; victory and defeat; ultimate 52 | 25/25 moving | Hardware; full visual sign-off |

The matrix covers the five-hit ground string (`light1 → light2 → light3 → light4 → finisher`),
neutral/up/down heavies, anti-air, aerial, dive, aerial finisher, grab, forward throw, spike throw,
held guard, parry into counter, guard break, dodge invulnerability, jump/air control/landing,
turn/brake, signature, both kit abilities and the ultimate. It also completes one real victory by a
KO during the active form and one real defeat, each followed by a fresh rematch. The form KO is
proved three ways: the pre-final hit is taken while the form is live, the final hit deals real
damage past 150%, and the shipping `endTransform(ko)` callout fires.

Two production defects were found and fixed by this matrix:

- Resolved hitboxes discarded the queued move id and label, so the combat ledger and attack
  presenter could only report the generic kind `melee`. `spawnHitbox` now carries `moveId` and
  `label`, which is what makes the per-move evidence above possible.
- The down throw applied negative velocity while the victim was already on the floor with 0.92 s
  hitstun, so it dealt damage but never produced a knockdown/get-up. A down throw now lifts the
  victim clear of the floor, uses 1.15 s hitstun and resolves through the normal landing/get-up
  path; forward and up throws are unchanged.

Evidence: `artifacts/a1-combat/summary.json`; per-fighter reports and 14 captures each under
`artifacts/a1-combat/{wonder-woman,thor,saitama}/`; run logs
`artifacts/a1-combat/{wonder-woman,thor,saitama}-run.log`; prior A0/runtime evidence under
`artifacts/launch-acceptance/report-a1-next-final-*.json` and `artifacts/a1-next/`. All captures
are **SwiftShader software evidence**, not hardware acceptance. Representative combat, ultimate,
form, victory, defeat and rematch captures were reviewed; this is not a hardware frame-by-frame
visual sign-off.

### Character-scale warnings — raw units, not runtime metres

The four raw measurements in the manifest audit are authored source units, not mounted heights:

| Fighter | Raw authored bounds | Runtime body | Runtime with equipment |
|---|---:|---:|---:|
| Green Lantern | 0.019 m | **1.88 m** | 1.88 m |
| Aquaman | 0.024 m | **1.93 m** | 2.52 m (trident) |
| Doctor Strange | 0.765 m | **1.88 m** | 1.88 m |
| The Flash | 3.214 m | **1.83 m** | 1.83 m |

The A0 gate now measures the mounted **mesh body** with equipped weapons excluded and enforces an 8%
tolerance around each identity profile. All four pass both the target-height and body-height checks.
No global rescale was applied; Aquaman's larger box is the trident's extent, not a 2.52 m body.
Evidence: `artifacts/launch-acceptance/scale-audit.json`, `artifacts/launch-acceptance/report-scale-*.json`,
`artifacts/a0-scale-*.log`. The body-only check has been run on the nine suspect rows; the other
29 keep the earlier target/feet check until the next full gate run.

### Six-fighter guard/offhand audit — 6/6

`AUDIT_SCOPE=guard bash scripts/run-browser-test.sh scripts/audit-offhand-guard.mjs` completed
six live rows with no page errors. Shield bearers: Wonder Woman and Link at **1.39% guarded /
7.74% open (0.18)**; bare-handed Captain Jack Sparrow, Kaze, Thor and Aquaman at **2.17% guarded /
7.74% open (0.28)**. All six entered guard, used a block clip (`block__upper`, or Aquaman's
authored `CombatBlockLeft`) and landed both measurement hits. Evidence:
`artifacts/phase22-5/offhand-guard-audit.json`, `artifacts/offhand-guard-audit.log`.
The deeper stripped/parry/economy/break/projectile sections were not run in this bounded pass.

## Audit summary

| Cohort | Count | Current state |
| --- | ---: | --- |
| A0 expanded gate | 38 | 38/38 pass; Goku 40 checks, the other 37 rows 37 checks; 0 failures/skips/timeouts |
| Live-proven imported | 8 | Real browser evidence, but none has passed the complete ten-section gate |
| Imported middle | 11 | Clip libraries exist; full match acceptance not recorded |
| Imported, no authored clips | 2 | Superman, Doctor Strange; both now have library-compiled state coverage |
| Authored/original launch bodies | 17 | Most measure 25 clips; final quality and full match acceptance open |

**Measured clip correction:** most authored original bodies already contain 25 embedded clips. The
manifest's `verified.clips: 0` is stale for those bodies. Use `artifacts/roster-bodies.json`, not the
manifest metadata, for the current count. Goku's 46 clips are separate from his body GLB.

**Raw height warning:** measurement is the whole loaded bounding box, so hair, weapons and raised
arms can inflate it. It is still useful for catching source-scale defects. Green Lantern (0.019),
Aquaman (0.024), Doctor Strange (0.765) and The Flash (3.214) need runtime-normalization review
before their proportions can pass.

## Master checklist

`Live` records existing browser evidence only. `Gate` is the new ten-section acceptance state.
`OPEN` means no complete gate has been recorded, not that every subsystem is absent.

| # | Fighter | Body | Raw height | Clips | Live evidence | Gate | Immediate blocker |
| ---: | --- | --- | ---: | ---: | --- | --- | --- |
| 01 | Infantry | authored | 1.800 | 2 | **A0 PASS (expanded 37)** | OPEN | Only 2 clips; 279k triangles; full sign-off |
| 02 | Superman | imported | 1.924 | 0 | **A0 PASS (expanded 37)** | OPEN | Full launch matrix; hardware |
| 03 | Iron Man (Tony Stark) | authored | 1.791 | 25 | **A0 PASS (expanded 37)** | OPEN | Full sign-off; final body/armour review |
| 04 | Hulk (Bruce Banner) | imported | 2.541 | 19 | **A0 PASS (expanded 37); A1 SOFTWARE PASS (combat 42/42; source attacks/locomotion/death bound)** | OPEN | Hardware; library jump/double-jump/fall/land/knockdown/get-up; authored success victory; one static pose waived |
| 05 | Green Lantern (Hal Jordan) | imported | 0.019 | 4 | **A0 PASS (expanded 37)** | OPEN | Full launch matrix; hardware |
| 06 | Wolverine (Logan) | authored | 1.868 | 25 | **A0 PASS (expanded 37)** | OPEN | Full sign-off; final body review |
| 07 | Wonder Woman | imported | 1.800 | 25 | **A0 PASS (expanded 37); A1 SOFTWARE PASS (combat 42/42)** | OPEN | Hardware; full visual sign-off; 938k triangles |
| 08 | Professor X (Charles Xavier) | authored | 1.749 | 25 | **A0 PASS (expanded 37)** | OPEN | Full sign-off; final body review |
| 09 | The Flash (Barry Allen) | imported | 3.214 | 12 | **A0 PASS (expanded 37); A1 SOFTWARE PASS (combat 42/42; source punch/locomotion bound)** | OPEN | Hardware; library light chain/reactions/defeat; two static poses waived |
| 10 | Aquaman | imported | 0.024 | 43 | **A0 PASS (expanded 37); A1 SOFTWARE PASS (combat 42/42; source sprint/death bound)** | OPEN | Hardware; no source walk/run or strike clips; authored trident attacks; one hollow cosmetic clip |
| 11 | Doctor Strange | imported | 0.765 | 0 | **A0 PASS (expanded 37)** | OPEN | Full launch matrix; hardware |
| 12 | Arnold Schwarzenegger / T-800 | imported | 1.880 | 25 | **A0 PASS (expanded 37); A1 SOFTWARE PASS (combat 42/42; retargeted clips/form; 0-edge watertight source)** | OPEN | Hardware; point-blank shotgun guard interaction |
| 13 | Goku | imported + face rig | 1.931 | 46 separate | **A0 PASS (40 checks); A1 software 9/9 + 43/43 state** | OPEN | Hardware; guard sclera review; full launch sign-off |
| 14 | Naruto Uzumaki | imported | 1.800 | 49 | **A0 PASS (37); A1 SOFTWARE PASS (core + transformed KO)** | OPEN | Hardware; full launch sign-off |
| 15 | Vegeta | imported | 1.596 | 25 | **A0 PASS (expanded 37); A1 SOFTWARE PASS (combat 42/42; retargeted clips/form; 0-edge repaired source)** | OPEN | Hardware |
| 16 | Saitama | imported | 1.750 | 25 | **A0 PASS (expanded 37); A1 SOFTWARE PASS (combat 42/42)** | OPEN | Hardware; full visual sign-off |
| 17 | L (Death Note Style) / Light Yagami | imported | 1.820 | 25 | **A0 PASS (expanded 37); PASS 13/13** | OPEN | Full sign-off; hardware |
| 18 | All Might | authored | 2.363 | 25 | **A0 PASS (expanded 37)** | OPEN | Full sign-off; height/body review |
| 19 | Edward Elric | authored | 1.756 | 25 | **A0 PASS (expanded 37)** | OPEN | Full sign-off |
| 20 | Levi Ackerman | authored | 1.756 | 25 | **A0 PASS (expanded 37)** | OPEN | Full sign-off |
| 21 | Mario | imported, auto-rigged supplied body | 1.754 | 25 | **LIVE PARTIAL: real selection/preview/match 7/7** | OPEN | Full 37/42 matrix; hardware |
| 22 | Luigi | imported supplied body | 1.756 | 25 | **LIVE PARTIAL: real selection/preview/match 7/7** | OPEN | Full 37/42 matrix; hardware |
| 23 | Kratos | authored | 2.025 | 25 | **A0 PASS (expanded 37)** | OPEN | Full sign-off |
| 24 | Link | authored | 1.790 | 25 | **A0 PASS (expanded 37)** | OPEN | Full sign-off |
| 25 | Master Chief | authored | 2.001 | 25 | **A0 PASS (expanded 37)** | OPEN | Full sign-off |
| 26 | Geralt of Rivia | authored | 1.877 | 25 | **A0 PASS (expanded 37)** | OPEN | Full sign-off |
| 27 | Doom Slayer | authored | 2.036 | 25 | **A0 PASS (expanded 37)** | OPEN | Full sign-off |
| 28 | Thor | imported | 1.880 | 25 | **A0 PASS (expanded 37); A1 SOFTWARE PASS (combat 42/42)** | OPEN | Hardware; full visual sign-off |
| 29 | Aang | imported | 1.720 | 25 | **A0 PASS (expanded 37)** | OPEN | Full sign-off |
| 30 | Madara Uchiha | imported | 1.820 | 25 | **A0 PASS (expanded 37)** | OPEN | Full sign-off |
| 31 | Hashirama Senju | imported | 1.850 | 25 | **A0 PASS (expanded 37)** | OPEN | Full sign-off |
| 32 | Lord Voldemort / Harry Potter | imported | 1.877 | 25 | **PASS 13/13** | OPEN | Full launch matrix; hardware |
| 33 | Sasuke Uchiha | imported | 1.800 | 25 | **A0 PASS (expanded 37)** | OPEN | Full sign-off |
| 34 | Edna Mode | authored | 1.510 | 25 | **A0 PASS (expanded 37)** | OPEN | Full sign-off; proportion review |
| 35 | Captain Jack Sparrow | authored | 1.756 | 25 | **A0 PASS (expanded 37)** | OPEN | Full sign-off |
| 36 | Spider-Man / Miles Morales | imported | 1.657 | 83 (26 Miles + 57 Iron Spider) | **A0 PASS (37); A1 software 40/40 gameplay + 21/21 import; merge 13/13 + playback 6/6** | OPEN | Hardware; full launch sign-off |
| 37 | Iron Spider | imported | 2.287 | 57 | **A0 PASS (37); A1 SOFTWARE EVIDENCE COMPLETE** (58/58 core; designed stow/retract; victory/rematch/defeat/rematch; 37/37 roster; 55/57 clips) | OPEN | Two `collection` / `skill07-03` static source poses are preserved and unselected; all 55 animated clips pass; designed native-bone stow/deploy 5/5; separate victory/rematch/defeat/rematch; all 37 selectable opponents covered; hardware remains |
| 38 | Kaze | authored | 1.772 | 17 | **A0 PASS (expanded 37)** | OPEN | Full launch matrix; hardware |

**A0 scope for this table:** every row now has expanded evidence. Goku has 40 checks; the other
37 rows have 37 checks. The master report records 38 passes, zero failures, zero skips and zero
timeouts. The unforced knockdown requirement is now closed across all 38 bodies. No row is fully
launch-accepted: hardware capture and the complete ten-section review remain open. A1 character
acceptance has begun: Goku, Spider-Man, Naruto, Iron Spider, Wonder Woman, Thor, Saitama, Hulk,
Aquaman, The Flash, Vegeta and T-800 have complete software evidence. The last eight each pass
**42/42** live combat checks (**336/336** combined); their remaining blocker is hardware — not the
combat matrix, their repaired source topology or the now-clean 70-frame visual review. Hulk's 2.45 m height review is closed;
Aquaman's unused skeleton-hollow clip, lack of source walk/run and authored trident attacks, Hulk's
library jump/double-jump/fall/land/knockdown/get-up, authored `succ_cam` victory and waived static pose, and The Flash's library light
chain/reactions/defeat and two waived static poses remain recorded source limits. The Hulk/Aquaman
Final Valley slice now passes **25/25**, including a real rematch click that starts a fresh 0–0
round. Iron Spider's 58/58 core includes five designed native-bone stow/retract checks, its separate
victory, rematch, defeat and post-defeat-rematch paths, and all 37 selectable launch opponents are
covered by the match matrix. Its two `collection` / `skill07-03` static source poses are preserved
and unselected (forensically confirmed from the original `scene.gltf`; no runtime binding failure
and no recoverable motion); all 55 animated clips pass. Vegeta and T-800 are now A1 software pass at
42/42 each with 25/25 moving clips; their repaired source topology is Vegeta 0 open / 0
non-manifold and T-800 0 open / 0 non-manifold, both fully closed. Iron Spider
hardware remains open.

## Per-fighter trait board

Use this board when a fighter enters implementation. Mark a cell only with evidence:

| Trait | Status | Required evidence |
| --- | --- | --- |
| Body | OPEN | Promoted model, textures, no fallback |
| Height/proportions | OPEN | Raw normalized bounds and grounded feet |
| Clip bank | OPEN | All required states present and moving |
| Movement | OPEN | Live idle/walk/run/sprint/jump/fall/land |
| Basic combat | OPEN | Live chain/heavy/aerial/throw damage |
| Defence/reactions | OPEN | Live guard/parry/dodge/hit/knockdown/get-up |
| Signature | OPEN | Live clip, hit and damage |
| Ultimate | OPEN | Live meter spend, cinematic/sequence, damage |
| Transformation | N/A or OPEN | Live cost, duration, visual/state change, restore |
| Match result | OPEN | KO, victory/defeat, rematch |
| Hardware | OPEN | Supported-hardware capture and frame measurement |

## First implementation order

1. **A0 gate** — built and expanded; **38/38 expanded A0 pass** (Goku 40 checks, other rows 37),
   with 0 failures, 0 skips and 0 timeouts. Hardware sign-off and full launch acceptance remain
   open. The seven former animation gaps are included.
2. **Goku** — A1 software evidence complete: live match **9/9**, state matrix **43/43 active** with
   `DoubleJump`, `Fall` and `FlyForward` wired and three duplicates retired. Guard reports
   `Guard 0.996`, `Blink 0`; sclera review and hardware remain open.
3. **Spider-Man** — A1 software evidence complete: **40/40 live gameplay checks** plus **21/21**
   import checks (rerun after the web-kit fix). Web Zip, Web Shot, Web Pull, Web Swing Strike, held web-swing, the three-beat
   ultimate and the Spider-Sense form all play authored clips with real contact; heavy (15.34%),
   defeat (`PLAYER 2 WINS`, `wins [0,1]`) and best-of-three (`wins [2,0]`) pass. Hardware remains open.
4. **Iron Spider** — **A1 software evidence complete**: core **58/58**, clip matrix **55/57**,
   selectable-roster matrix **37/37**. The untouched `scene.gltf`/`scene.bin` and every derived GLB
   (source, fetch and runtime) contain identical channel data for the two failures. `collection` is
   a 0 s, one-key static pose (144 tracks / 104 targets); `skill07-03` is a 2 s static pose (196
   tracks / 103 targets; 100 single-key rotations; translation moves only 2.139e-06 m from the first
   key and 5.960e-08 m key-to-key). All targets resolve in the 107-joint skin (0 outside), both
   actions load live, and neither is mapped to a gameplay slot. This is a source-animation
   limitation, not a runtime interpretation failure; no repair is possible without invented motion
   or a borrowed clip, and neither clip was changed. The expanded core separately covers
   **VICTORY · IRON SPIDER (2–0)**, rematch after victory, **DEFEAT · GOKU (0–2)** and rematch after
   defeat, with fresh health and the native arm still mounted. The designed stow/retract is a
   procedural native-bone fold (`public/js/anim/native_spider_stow.js`): `G` toggles it while
   grounded and neutral, attacks/jumps/dodges/hit reactions/grabs/flight/KO/round reset deploy, and
   the 0.30 s blend preserves the visible `Object_122` mesh and all 57 clips. Five live checks cover
   deployed start, folded envelope, transition, exact redeploy, clip immutability and attack
   auto-deploy. Hardware remains open. The **58/58** SwiftShader report is at
   `artifacts/iron-spider/software-run.json`; the targeted hardware attempt was blocked by
   SwiftShader before any check and wrote no `hardware-run.json`.
5. **A1 standard** — reusable ten-criterion checklist and evidence classes: `docs/A1_CHARACTER_LAUNCH_CHECKLIST.md`.
6. **Naruto** — A1 software-pass core: **37/37** live match, **49/49** state matrix, **21/21**
   signatures, **18/18** keyboard combat, **7/7** focused A1 probe and **2/2** transformed-KO/
   rematch. All five forms and exits, right-hand Rasenshuriken, ultimate return, unforced knockdown,
   victory during SAGE MODE and a fresh rematch pass. Hardware and full sign-off remain open.
7. **Vegeta, T-800** — A1 software pass: **42/42** live combat each (**84/84** combined), 25/25
   moving retargeted clips, source charge forms, KO during form, victory/defeat and both rematches.
   Their source topology is repaired to Vegeta 0 / 0 and T-800 0 / 0.
   T-800 retains the point-blank shotgun guard interaction. Hardware remains open; the 28-frame
   visual review is clean after the weapon-attachment fix.
8. **Wonder Woman, Thor, Saitama, Hulk, Aquaman, The Flash** — A1 software pass: **42/42** live
   combat each; with Vegeta/T-800 the eight software-pass fighters total **336/336**, 37/37 A0,
   form exit, KO during form, victory/defeat/rematch. Hulk now plays source attacks/`@dash`/`@die`,
   Aquaman plays source `DashLoop`/`GroundDeathB`, and The Flash plays source `punch` for heavy plus
   `run`/`jumpDown` locomotion. The Hulk/Aquaman Final Valley slice passes **25/25** including a real
   rematch click. Hardware remains open; Hulk/Aquaman/The Flash have a clean 42-frame visual review
   after the weapon-attachment fix, while Wonder Woman/Thor/Saitama retain representative-only visual
   coverage. Wonder Woman's 938k triangles need a performance review; the six rows keep their
   recorded residual source limits.
9. **Remaining imported middle cohort** — Green Lantern, Madara, Sasuke, Aang and Hashirama still
   need full A1. Iron Spider remains partial only because its two static source poses are preserved
   and unselected; no further A1 fighter cohort was started after Vegeta/T-800.
10. **Superman and Doctor Strange** — clip packages.
11. **Authored cohort** — final art/proportion review and full gate.

## Evidence basis

- `artifacts/launch-acceptance/a1-status.json` — A1 per-fighter status for Goku, Spider-Man, Iron Spider, Naruto, Wonder Woman, Thor, Saitama, Hulk, Aquaman, The Flash, Vegeta and T-800, with exact remaining work.
- `artifacts/a1-combat/summary.json` — combined **336/336** live combat matrix across eight fighters (Wonder Woman, Thor, Saitama, Hulk, Aquaman, The Flash, Vegeta, T-800), including light-chain damage, knockdown samples, form-KO traces, defeat/rematch results, production fixes and source/height records.
- `artifacts/a1-combat/{wonder-woman,thor,saitama,hulk,aquaman,the-flash,vegeta,t800}/report.json` and 14 PNG captures each — per-fighter 42/42 reports, move ids, reactions, form/KO and match outcomes; Hulk/Aquaman/Flash source-binding logs are `artifacts/a1-combat/{slug}-sourcebinding-run.log`, Vegeta/T-800 logs are `artifacts/a1-combat/{slug}-matrix-run.log`, and the earlier logs remain `{slug}-run.log`.
- `artifacts/a1-combat/source-topology-review.json` — repaired Vegeta 0 open / 0 non-manifold and T-800 0 open / 0 non-manifold (including the final 49 hand/finger-joint edges), with before/after counts, repair method and per-mesh diagnostics; originals under `artifacts/source-topology-before/`.
- `artifacts/launch-acceptance-strict-01.log` and `artifacts/a1-cohort-final2.log` — Hulk height closure: target 2.45 m, measured 2.45 m, feet 0.18 m on the 0.18 m ground, inside the 8% tolerance.
- `artifacts/a1-goku-state-matrix.log` — Goku 43/43 active live state matrix; 3 retired clips.
- `artifacts/a1-goku-ultimate.log` — Goku direct ultimate 4/4: authored-set multi-joint motion, cinematic and control/camera return.
- `artifacts/a1-spider-gameplay-final.log` — Spider-Man 40/40 live gameplay: authored Web Zip, shot, pull, swing, held swing, three-beat ultimate, form, damage and control return.
- `artifacts/launch-acceptance/report-a1-spider-regression.json` — focused A0 regression after the web-kit fix: Spider-Man 37/37 required checks, 0 failures, unforced knockdown/get-up included.
- `artifacts/a1-spider-import-final-after-webkit.log` — Spider-Man 21/21 import/state harness rerun after the web-kit fix, including heavy, defeat and complete BO3.
- `artifacts/iron-spider/clip-matrix/report.json` — Iron Spider fresh 57-clip matrix 55/57 (9/9 harness checks), with 32 source + 25 supplemental clips.
- `artifacts/iron-spider/software-run.json` and `artifacts/iron-spider/software-run.log` — current 58/58 live E2E: designed stow/deploy, separate victory, rematch after victory, real two-round defeat and rematch after defeat, with fresh state and the native arm still mounted; SwiftShader only.
- `artifacts/iron-spider/hardware-gpu-attempt.json` and `artifacts/hardware-gpu/summary-iron-spider.json` — targeted hardware attempt blocked by SwiftShader before any suite ran; no `hardware-run.json` exists.
- `artifacts/iron-spider/forensic-diagnostic.json` and `artifacts/iron-spider/forensic-diagnostic-a1.json`, `artifacts/iron-spider/FORENSIC_INVESTIGATION.md`, `artifacts/iron-spider/forensic-collection.log` and `artifacts/iron-spider/forensic-skill07-03.log` — original-source audit: `collection` and `skill07-03` are static poses; source, fetch and runtime channel data are identical; all targets resolve; no binding failure; no repair without invented motion.
- `artifacts/iron-spider/STOW_RETRACT_FEASIBILITY.md` — stow/retract design and implementation: native-bone fold preserves the production model and all clips; hiding is not used.
- `artifacts/iron-spider/clip-recovery-audit.json`, `artifacts/iron-spider/clip-motion-source.log` and `artifacts/iron-spider/clip-motion-runtime.log` — earlier accessor/moving-bone audit retained as corroborating evidence.
- `artifacts/goku-state-matrix/report.json` — Goku 43/43 active live clip matrix, 3 retired clips, contact sheet and guard face.
- `artifacts/launch-acceptance/expanded-38-summary.json` — final 38-row expanded A0 table and evidence paths.
- `artifacts/launch-acceptance/report-ten-section-goku-5.json` — expanded 40-check Goku pass.
- `artifacts/launch-acceptance/report-naruto-a1.json` and `artifacts/a1-naruto/live-match.log` — fresh focused Naruto A0 37/37 live match (`A0_LABEL=naruto-a1`), SwiftShader, no errors/failed requests.
- `artifacts/launch-acceptance/report-naruto-a1-readiness.json` — Naruto ten-criterion A1 record, evidence index, renderer label and open requirements.
- `artifacts/naruto-49-state/report.json` and `artifacts/a1-naruto/49-state.log` — fresh 49/49 live state matrix, no missing/extra clips.
- `artifacts/a1-naruto/signatures.log` — 21/21 signatures: all five forms transform, fire their own special and exit to base `RASENSHURIKEN`.
- `artifacts/a1-naruto/keyboard-combat.log` — 18/18 keyboard combat: chain, three heavies and CPU motion mapping.
- `artifacts/a1-naruto/live-a1-probe.json` and `.log` — 7/7 focused A1 probe: walk/run vs dodge sample, form exit, right-hand `RASENSHURIKEN` origin, ultimate return.
- `artifacts/launch-acceptance/report-naruto-fall-fix2.json` — earlier 37-check Naruto pass retained as supplemental history.
- `artifacts/launch-acceptance/report-ten-section-vegeta.json` — expanded 37-check Vegeta pass.
- `artifacts/launch-acceptance/scale-audit.json` — nine-row body-only height audit.
- `artifacts/launch-acceptance/report-scale-*.json` — body-only height rechecks for the raw-scale warnings.
- `artifacts/phase22-5/offhand-guard-audit.json` — six-fighter guard table (6/6 pass).
- `artifacts/launch-acceptance/report-all.json` — A0 master report across 38 launch fighters; 38/38, 1,409 checks, 0 failures. The focused Spider regression had regenerated it with partial rows; it was restored from `report-all-before-unforced-merge.json` plus `unforced-38.json`, with the corrupt copy retained.
- `artifacts/launch-acceptance/<slug>/` — select, idle, result and second-result captures per fighter.
- `scripts/verify-launch-roster.mjs` — real-match A0 harness (single fighter, named list or batch).
- `artifacts/roster-bodies.json` — freshly measured current manifest bodies (2026-11-12).
- `docs/ROSTER_MAPPING.md` — 38 launch + 22 DLC identities and stable keys.
- `docs/A1_CHARACTER_LAUNCH_CHECKLIST.md` — reusable A1 character-level launch standard and evidence classes.
- `docs/ROSTER_INTEGRATION_PROGRESS.md` — Naruto/Vegeta/T-800/Light/Harry/Spider-Man acceptance.
- `docs/IRON_SPIDER_INTEGRATION.md` — 58/58 E2E with designed stow/retract and separate
  victory/rematch/defeat/rematch coverage, 37/37 match rows, 188/189 merged matrix, 55/57 clip
  matrix, the 2026-11-12 original-source forensic audit, and the stow/retract implementation.
- `artifacts/miles/` — Miles 18/18 browser clip matrix.
- `artifacts/animation-overlays/` — Goku face proof and 20/20 overlay checks.
- `artifacts/imported-migrations/` — Vegeta, Light, Harry and T-800 13/13 evidence.
- `artifacts/a1-naruto/transformed-ko.json` — Naruto transformed-KO **2/2**: form landed, `VICTORY · NARUTO UZUMAKI` and a fresh rematch with the form cleared.
- `artifacts/naruto-49-state/` — Naruto 49/49 live state matrix.

The A0 counts above were produced in this session. The broader recorded counts elsewhere were not
all re-run. The checklist still does not claim full launch sign-off for any fighter.

No commit, push, reset, clean, stash or amend was performed.
