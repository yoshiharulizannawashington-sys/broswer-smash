# Browser Bros — roster integration progress (persistent)

> Read this first in any continuation session. It records what is actually done, what is not,
> and the exact next task. Nothing here is aspirational. The dependency-ordered production plan is
> in `docs/PRODUCTION_ROADMAP.md`; the 38-fighter checklist is `docs/LAUNCH_ROSTER_ACCEPTANCE.md`.
> A0, the launch acceptance gate, is built and has run all 38 launch fighters. Both two-fighter
> vertical slices are live, and eight fighters (Wonder Woman, Thor, Saitama, Hulk, Aquaman, The
> Flash, Vegeta and T-800) have completed the A1 combat matrix at **42/42 each**. Hulk, Aquaman and
> The Flash now also play their available source attacks/locomotion/death, and the Final Valley
> slice verifies a real rematch click. The next milestone is hardware-GPU acceptance for the
> software-pass fighters; Vegeta/T-800 source topology is now repaired to the 80-edge budget — not another A0 run. The
> shared Wonder Woman equipment defect has been fixed, and the 70-frame A1 visual review is clean for
> Hulk, Aquaman, The Flash, Vegeta and T-800. The five matrices were rerun again on the current
> idle-guard build and the 70-frame review was refreshed; the A1 hardware-result checklist is
> `docs/HARDWARE_GPU_RESULT_VERIFICATION_CHECKLIST.md`.

## Session 2026-11-13 — idle-guard build recheck; hardware-result checklist

- **Rerun:** the five affected A1 matrices were rerun against the current idle-guard worktree:
  Hulk **42/42** (216 s), Aquaman **42/42** (210 s), The Flash **42/42** (196 s), Vegeta
  **42/42** (209 s) and T-800 **42/42** (202 s). Every report has 0 page errors and 0 failed
  requests; logs are `artifacts/a1-combat/{slug}-idleguard-run.log`.
- **Visual refresh:** all 70 captures were regenerated, 14 per fighter, and all 70 hashes differ
  from the preserved pre-idle-guard baseline (`artifacts/a1-combat/pre-idle-guard/`). Every frame
  passed the nonblank guard and was reviewed on fresh labeled contact sheets; ambiguous
  form/stage/result frames were opened at native 1280×800. Review record:
  `artifacts/a1-combat/visual-review.json`; sheets and frame index:
  `artifacts/a1-combat/visual-review-idleguard/`.
- **Verdict:** **PASS for fighter state (software-only)**. No blank, wrong-fighter, T-pose/detached,
  missing HUD or missing result frame. Wonder Woman's sword and shield continue to follow the torso
  through grab/throw. Notes: effect-heavy ultimate/form frames partially occlude the target; the
  result stills do not show the form `ENDED` callout (the reports' `formKO.callouts` do); the live
  `valley` stage and pulled-back camera are not arena-art acceptance.
- **Hardware:** still **blocked/not run**. `docs/HARDWARE_GPU_RESULT_VERIFICATION_CHECKLIST.md`
  validates a future targeted summary and the Hulk/Aquaman/The Flash 42/42 reports; it is not
  evidence that a hardware run occurred. No hardware result, commit, push or worktree cleanup was
  performed.

## Session 2026-11-13 — shared Wonder Woman weapon attachment fixed; 70-frame visual review clean

- **Root cause:** `syncEquippedWeapons()` tracked the hand position but pinned the weapon holder's
  orientation to body yaw. When Wonder Woman was lifted or inverted, the sword and shield stayed
  world-upright and the shield's center block appeared detached. This affected every fighter whose
  A1 set uses her as the thrown opponent.
- **Fix:** the holder now follows the torso's animation-space tilt, using an equip-time torso
  reference so rest orientation and normal facing stay unchanged. An angular deadband filters small
  idle breathing/sway while full leans, throws and inversions carry the props; hand position still
  comes from the hand bone. No animation, hitbox or moveset was invented.
- **Verification:** the five affected matrices were rerun at **42/42 each** (Hulk, Aquaman, The
  Flash, Vegeta, T-800) with 0 page errors and 0 failed requests. A live probe read sword holder to
  right hand **0** and shield holder to left hand **0**, with non-identity holder quaternions during
  the throw. All **70** post-fix captures were reviewed; grab/throw and knockdown/get-up frames show
  both props riding the body, and no separate equipment block remains. After the idle-sway guard,
  the full 38-fighter attachment regression also passed **38/38, 0 failures, 0 page errors**. Record:
  `artifacts/a1-combat/visual-review.json`; contact sheets:
  `artifacts/a1-combat/visual-review-after-fix/`; before/after throw:
  `artifacts/a1-combat/visual-review-after-fix/hulk-throw-before-after.png`.
- **Still open:** hardware-GPU acceptance, T-800's point-blank
  shotgun/guard interaction, and arena-art coverage. The captures are SwiftShader software evidence;
  the clean review is for fighter state, not hardware visual quality.

## Session 2026-11-13 — A1 cohort: Vegeta and T-800 (matrix + source topology)

Selected the two remaining A1 partial fighters. Both already had 13/13 migration checks and 25/25
moving retargeted clips; this pass added the complete semantic matrix and the source-topology
review. Existing Hulk/Aquaman/Flash and Wonder Woman/Thor/Saitama evidence was preserved.

- **Live matrix: 42/42 each, 84/84 combined**, real character-select and match flow, 0 page errors,
  0 failed requests. Coverage: five-hit light string, all heavies, anti-air, air/dive/finisher,
  grab and both throws, guard/parry/counter/guard break/dodge, unforced and forced
  knockdown/get-up, jump/land, signature, both kit abilities, ultimate, form entry/exit, KO during
  form, victory/defeat and both rematches.
- **Vegeta:** light chain 5/5 for 61.56%; GALICK GUN, BIG BANG ATTACK, FINAL FLASH; **SUPER SAIYAN**
  entered from source `charge`, expired naturally and delivered the KO. Source body 311 joints,
  19/19 canonical roles, 0 unresolved retarget nodes; 25/25 clips moving. Max retarget step 95.6°
  (`air_attack`). The 25 clips carry zero-quaternion `G_root_309` keys (482 keys), treated as
  identity; no clip is static or hollow.
- **T-800:** HUD `T-800`, stable key `arnold_schwarzenegger`; CYBERNETIC CANNON, SUPPRESSIVE
  ATTACK, EXPLOSIVE LAUNCHER; **COMBAT CHASSIS OVERDRIVE** entered from source `charge`, expired
  naturally and delivered the KO. Source body 53 joints, 19/19 roles, 0 unresolved; 25/25 clips
  moving, 0 motion warnings; max retarget step 105° (`throw`).
- **T-800 kit interaction:** every non-heavy, non-aerial light attack fires the equipped shotgun.
  The five-input chain records 64.77% melee damage while the target ends at 139.77%, the difference
  being five 15-damage shots. At point-blank the shot applies 0.1 s hitstun to a held guard, so the
  follow-up light melee lands unguarded; a dodge armed at the same instant is interrupted. Guard and
  dodge were therefore verified against the real melee heavy, which blocks and is evaded. This is
  documented, not hidden, and remains an open kit interaction.
- **Source topology:** repaired on 2026-11-13. Vegeta is **0 welded open-boundary edges / 0
  non-manifold** (from 407 / 3,862); T-800 is **0 / 0** (from 2,198 / 45); both inside the 80-edge
  budget. No vertices were added; caps reuse existing boundary vertices. Supplied originals and
  before/after evidence: `artifacts/source-topology-before/`, `artifacts/source-topology-after/` and
  `artifacts/a1-combat/source-topology-review.json`.
- **Visual review:** 28 new captures reviewed. Both bodies are coherent, animate, take damage and
  complete victory/defeat/rematch. T-800 is the supplied endoskeleton with its intentionally large
  shotgun; Vegeta keeps the Ultra Ego body and Super Saiyan aura. No T-pose, detached body, wrong
  fighter or blank frame. The throw frames were subsequently re-reviewed clean after the weapon fix;
  see the weapon-attachment session above.

Status: **A1 SOFTWARE PASS** for both: 42/42 live matrix, 25/25 moving retargeted clips, source
charge forms, KO during form, complete victory/defeat/rematch, 0 page/asset errors. Source topology
is repaired to the 80-edge budget; hardware-GPU acceptance and T-800's point-blank shotgun/guard
interaction remain open; the post-fix
70-frame visual review is clean. Evidence: `artifacts/a1-combat/{vegeta,t800}/report.json`,
`{slug}-matrix-run.log`, `artifacts/a1-combat/summary.json`,
`artifacts/a1-combat/source-topology-review.json` and 14 captures each.

## Session 2026-11-13 — Asgard slice, A1 visual review, hardware package

- **Wonder Woman vs Thor · Asgard** now runs through the same real flow as the first slice. The
  parameterized harness kept the Hulk/Aquaman/Final Valley defaults. Asgard completed **24/24**
  checks with 0 page errors and 0 failed requests; Thor won **0–1** in 12 s (Wonder Woman dealt 20%,
  took 154%). The cinematic frame was recovered by raising the test-only intro duration to 30 s
  after the 8 s hold produced a gameplay frame; the player default remains 5 s and combat was
  untouched. Evidence:
  `artifacts/a1-cohort/slice-presentation-wonder-woman-thor-asgard/`.
- **All 42 A1 captures reviewed** (14 each for Hulk, Aquaman, The Flash). No blank/wrong-body/T-pose
  frame, missing HUD or missing result panel. Sign-off was **conditional** at the time: Wonder Woman's spear stayed
  vertical while she is lifted/inverted and a small equipment block separates; Flash's aerial/throw
  frames are post-action; all 42 use the live `valley` stage, not arena art. Record:
  `artifacts/a1-combat/visual-review.json`; contact sheets: `artifacts/a1-review/`. This historical
  finding was resolved by the later weapon-attachment session; the clean 70-frame review supersedes
  this conditional result.
- **Hardware package extended** with `hulk-a1`, `aquaman-a1` and `the-flash-a1` (42 checks each). The
  2026-11-13 preflight detected SwiftShader, exited 1 and launched zero suites. Package:
  `artifacts/a1-combat/hardware-package.json`; attempt:
  `artifacts/hardware-gpu/summary-hulk-a1-aquaman-a1-the-flash-a1.json`.
- All work remains uncommitted; no commit, push, reset, clean or stash was performed.

## Session 2026-11-13 — A1 cohort: Hulk, Aquaman, The Flash (combat matrix complete)

Selected **Hulk (Bruce Banner)**, **Aquaman** and **The Flash (Barry Allen)** as the next
near-complete A1 cohort. Each already had A0 37/37 and a live ultimate; the remaining gaps were
specific rather than a missing combat path: Hulk's imported attack/locomotion table was bound but
not selected, Aquaman had no source sprint lane and one hollow cosmetic clip, and The Flash's
supplied punch was not being played. The existing Naruto, Vegeta, T-800 and Iron Spider evidence was
preserved.

Production changes:

- **Form presentation:** bodies with no authored transformation sequence and no source charge could
  enter a form on an idle pose. Added a shared semantic `charge` clip (crouch, gather, burst,
  settle) and bound it as `chargeAction` only when no source charge exists. The runtime records
  `library-charge` versus `source-charge`; authored form sequences still win. Hulk, Aquaman and The
  Flash all report `clip: charge`, `source: library-charge`.
- **Aerial chain:** slow/heavy bodies landed before a third aerial press could become the air
  finisher. Aerial strings now cancel from the previous air attack once its active frames end,
  while grounded chains keep the full-recovery rule. All three resolve `air` → `air` →
  `airFinisher`.
- **Fall presentation:** bodies without a source fall action fell through to idle while descending.
  The shared semantic `fall` clip is now bound when no source fall exists; the movement probe sees
  `fall` airborne and a separate `land` on touchdown.
- **Hulk height review closed:** the source body measures 2.541 m and is normalized to the 2.45 m
  identity profile. A0 reports measured 2.45 m, feet 0.18 m on the 0.18 m ground, inside the 8%
  tolerance. No global rescale was applied; Aquaman remains 1.93 m (2.52 m with trident) and The
  Flash 1.83 m.

Evidence:

- A0 expanded gate: **37/37** for each of the three, clean exit and no page/asset errors. Reports:
  `artifacts/launch-acceptance/report-a1-final-{aquaman,hulk,flash}.json`.
- Live combat matrix: **42/42 for each fighter, 126/126 combined**. Real P1 keyboard input and the
  real P2 input handler, with only positioning/reset and the game's own fixed step between cases.
  Coverage: 5-hit light string, heavy/launcher/slam, anti-air, air, dive, air finisher, grab and
  both throws, guard, parry into counter, guard break, dodge, unforced and forced knockdown/get-up,
  jump/land/air control/turn/brake, signature, both kit abilities, ultimate, form entry/exit, KO
  during form, victory/defeat and two rematches. Measured 5-hit damage: **Hulk 82.90%, Aquaman
  54.96%, The Flash 38.83%**. Jump maxY **2.25 m**; air control **1.02 / 1.35 / 1.94 m**.
- Form KO was real in all three: pre-final target percent **145% / 138% / 140%** while the form was
  live, final hit past 150%, victory `p1`, and the shipping `endTransform(ko)` callout fired. The
  form's own signature is used for the KO; the Flash's 8 s window cannot finish with neutral
  heavies.
- Defeat paths: `DEFEAT · WONDER WOMAN`, wins `[0,1]`, followed by a fresh rematch. All three
  reports record **0 page errors, 0 failed requests** and 14 captures each.
- Source binding: Hulk's neutral heavy and attack branches now play `@atk01`/`@atk02` and
  `skill01`-`05`, `@dash` owns run/sprint at **11.94 m/s**, and `@die` owns defeat. Aquaman's
  `DashLoop` owns sprint at **13.54 m/s** and `GroundDeathB` owns defeat; its attacks remain the
  authored trident motion because the pack has no strike clips. The Flash's `punch` now plays for
  heavy/heavyFinisher, `run` owns walk/run/sprint at **7.68 / 17.52 / 7.69 m/s**, and `jumpDown`
  owns jump/land. The A1 report records the selected strike slot/clip, a locomotion snapshot and
  the defeat pose clip.
- Defeat presentation: a KO froze hitstun above zero, so the hit-reaction branch outranked the
  death pose and the loser stayed in the killing-blow flinch. The grounded KO now plays `@die`
  (Hulk), `GroundDeathB` (Aquaman) and `defeat` (The Flash).
- Source audits remain recorded: Aquaman **42/43 moving** with one unused skeleton-hollow
  `UI_DailySpin_Flying` and no walk/run or strike clips; Hulk **18/19 moving** with one explicitly
  waived static `@collection`, library jump/double-jump/fall/land/knockdown/get-up and authored `succ_cam` victory; The Flash
  **10/12 moving** with static `mixamo.com` and `jumpUp` waived and a library light chain,
  reactions and defeat pose.
- Harness evidence was tightened without weakening checks: slow grabs and aerial steps wait on live
  state, the form KO uses the form signature, projectile damage is proved from the target percent
  trace, and get-up accepts the authored `stand` idle clip. Reports still require real damage, real
  knockdown/get-up, a live form, the `ENDED` callout and an actual match-over result.
- Regressions after the source-binding and defeat-pose fixes: build **pass in 9.07 s**, combat
  **474/474**, animation **280/280**, animation coverage **91/91**. Locomotion and equipment were
  not rerun in this final pass; their prior 65/65 and 30/30 results remain recorded. The broad
  mechanics run still stops on the pre-existing stale `#p2shield` HUD assertion and was not rerun.

Status: **A1 SOFTWARE PASS** for all three: 37/37 A0, **42/42 live combat**, form entry with semantic
charge, natural exit, KO during form, complete victory/defeat/rematch paths, 0 page errors and 0
failed requests. Hardware-GPU acceptance remains open; all captures are
SwiftShader software composition evidence. Aquaman's missing source walk/run and strike clips plus
one hollow cosmetic clip, Hulk's library jump/double-jump/fall/land/knockdown/get-up and waived static
pose, with victory now the authored `succ_cam` success animation, and The Flash's library light chain/reactions/defeat and two waived static poses remain
recorded source limits.

The next A1 pair was **Vegeta** and **T-800**; both are now **A1 SOFTWARE PASS** at 42/42 with
repaired source topology recorded above. No further A1 cohort was started. Iron Spider remains
partial only because its two static source poses are preserved and unselected.

## Session 2026-11-13 — A1 cohort: Wonder Woman, Thor, Saitama (combat matrix complete)

Selected **Wonder Woman**, **Thor** and **Saitama** for the A1 cohort. All three have a
production 25-clip body, a distinct equipment/ability identity and no previous character-level A1
record. Aquaman/Hulk/Flash and the earlier Naruto, Vegeta, T-800 and Iron Spider evidence were
preserved and not rerun.

Production changes:

- **Form activation**: all three declared forms previously selected `idle` and left
  `lastFormAnimation` null. `human_fighter.js` now binds the body's own moving `charge` clip on the
  existing mixer for the form window when no authored form sequence exists, and stops/resets it at
  form end. The live probe now reports `charge` with `source: body-charge` for all three; authored
  form actions still take precedence.
- **Thor equipment**: the MCU Stormbreaker prefab measured **2.18 m tall × 1.93 m wide** at 1.05
  scale and floated above Thor's 1.98 m body. `models.js` now scales the prefab to 0.55; the live
  weapon box is **1.14 m × 1.01 m**, still gripped on `RightHand`.
- **Locomotion**: Shift was both dash and sprint, so the run lane was skipped after the dash, and a
  0.91/frame ground drag capped sustained speed below the sprint animation threshold. Shift now
  holds the run target for 0.7 s before sprint, and grounded drag is 0.97 (roam) / 0.95 (non-roam).
  The real keyboard probe selects walk, run, dash and sprint for all three; sprint speeds are
  **Wonder Woman 14.1, Thor 13.0, Saitama 13.1 m/s**.
- **Move identity**: resolved hitboxes dropped the queued `moveId`/`label`, so the combat ledger
  and attack presenter could only report `melee`. `spawnHitbox` now preserves both, which is what
  lets the live matrix prove `light1` → `light2` → `light3` → `light4` → `finisher` and every
  special branch by name.
- **Down throw**: the spike branch applied a downward velocity while the victim was already on the
  floor with 0.92 s hitstun, producing damage but no knockdown/get-up. A down throw now lifts the
  victim clear, uses 1.15 s hitstun and resolves through the normal landing/get-up path; forward
  and up throws are unchanged.

Evidence:

- Source audits: **25/25 moving** for each body, 0 static/hollow/invalid
  (`artifacts/a1-next/*-source-motion.json`).
- A0 final: **37/37, 0 required failures** for each; reports
  `artifacts/launch-acceptance/report-a1-next-final-{wonder-woman,thor,saitama}.json`.
- Live probe: **0 page errors, 0 failed requests**. Forms: `champion-of-themyscira`,
  `all-fathers-storm`, `serious-mode`, all playing `charge`. Ultimates: **52 / 45 / 52 damage**,
  `authored_ultimate`, meter 0, casting cleared. Evidence: `artifacts/a1-next/runtime-probe.json`,
  `probe.log`, `a1-results.json` and the idle/form/ultimate captures.
- Live combat matrix: **42/42 for each fighter, 126/126 combined**. Real P1 keyboard input and the
  real P2 input handler, with only positioning/reset between cases. Coverage: 5-hit light string,
  heavy/launcher/slam, anti-air, air, dive, air finisher, grab and both throws, guard, parry into
  counter, guard break, dodge, unforced and forced knockdown/get-up, jump/land/air control/turn/brake,
  signature, both kit abilities, ultimate, form entry/exit, KO during form, victory/defeat and two
  rematches. Measured 5-hit damage: **54.96% / 64.84% / 89.38%**. Jump maxY **2.25 m**; air control
  **1.52 / 1.36 / 1.33 m**. Evidence: `artifacts/a1-combat/summary.json`, per-fighter reports and
  14 captures each, plus `artifacts/a1-combat/{slug}-run.log`.
- Regressions: locomotion 65/65, equipment 30/30, animation 280/280, combat 474/474, build pass.
  The broad mechanics run passed 49 checks and stopped on a pre-existing stale HUD assertion for
  `#p2shield`, which no longer exists in the current HUD; this is recorded, not hidden.

Status: **A1 SOFTWARE PASS** for all three: 37/37 A0, **42/42 live combat**, form exit and
KO-during-form, complete victory/defeat/rematch paths, 0 page errors and 0 failed requests.
Hardware-GPU acceptance and full visual sign-off remain open; the reviewed captures are SwiftShader
composition evidence, not hardware acceptance. Wonder Woman's 938k-triangle body is a performance
review target, not a combat blocker.

The cohort selected at that point was **Hulk (Bruce Banner)**, **Aquaman** and **The Flash (Barry
Allen)**. That cohort now passes **42/42** live combat each (126/126 combined) with form exit,
KO-during-form, victory/defeat/rematch, Hulk's height review closed and the available source
attacks/locomotion/death selected; see the 2026-11-13 session above. Vegeta and T-800 subsequently
passed the full matrix at 42/42 each; their low-poly source topology is repaired to 0 / 0 and 0 / 0
within the 80-edge budget.

## Session 2026-11-13 — A1 cohort: Aquaman, Hulk, The Flash + first slice

Selected **Aquaman**, **Hulk (Bruce Banner)** and **The Flash (Barry Allen)** for the next A1 cohort.
Each has a production body, a live equipment/ability identity and real remaining work; the existing
Naruto, Vegeta, T-800 and Iron Spider evidence was preserved and not rerun.

Production changes:

- **Hulk**: source `atk01`/`atk02` and `skill01`-`05` now own the attack/ability slots; `@dash`
  owns run/sprint and `@die` owns defeat. `grab` and `throw` use `skill05`; the static `@collection`
  pose is filtered out. The live ultimate was observed through recovery at **27 damage**, with
  casting cleared and control returned. Jump/land/knockdown/get-up/victory/fall remain library
  because the pack has no honest clip for them.
- **Aquaman**: authored reactions own fighting idle (`CombatIdle`), jump/land, block, dodge,
  light/heavy hit reactions, knockdown, victory and defeat; `DashLoop` now owns sprint. Idle/walk/run
  use the library because the source idles leave the left hand still and there is no walk/run cycle.
  Attacks are authored trident motion because the pack has no strike clips. Source audit is
  **42/43 moving**; `UI_DailySpin_Flying` is skeleton-hollow and unused, recorded as a limitation
  rather than accepted as motion. Ultimate: **30**.
- **The Flash**: source `stand`, `walk`, `run` and `jumpDown` are bound; `punch` now plays for
  heavy/heavyFinisher. Static `jumpUp` and `mixamo.com` are excluded. The light chain, reactions and
  defeat pose remain authored/library. The dash signature carries a gold Speed Force ribbon.
  Ultimate: **32**.
- **Strike selection and defeat priority**: imported source strikes now outrank authored motion when
  bound. Once a KO body is grounded, the defeat pose outranks frozen hitstun, so Hulk ends on
  `@die`, Aquaman on `GroundDeathB` and The Flash on `defeat` instead of holding the killing-blow
  flinch.
- **Shared animation bank**: static source clips are now filtered out and recorded in
  `model.userData.staticClipsSkipped`, so a static pose cannot be selected as gameplay motion.
- **Rematch defect**: `resetMatch()` cleared wins but `reset()` did not refresh `#roundScore`, so a
  rematch could show the previous `1 - 0`. `reset()` now calls `roundHud()` immediately; the slice
  verifies `ROUND 1 · 0 - 0 · FIRST TO 1`.

Verification:

- A0 expanded gate: **37/37** for each of the three; clean exit 0 and no page/asset errors. Reports:
  `artifacts/launch-acceptance/report-a1-final-{aquaman,hulk,flash}.json`.
- Runtime probe: **0** page errors, **0** failed requests; all three ultimates dealt damage, spent the
  meter to zero, cleared `casting` and returned control within the recovery window.
- Regressions after the source-binding and defeat-pose fixes: build **9.07 s**, combat **474/474**,
  animation **280/280**, animation coverage **91/91**. Earlier in the pass, source-motion was **18**
  and equipment **30/30**.
- Vertical slice: **Hulk vs Aquaman · Final Valley**, complete presentation pass. The real fighter
  cards selected Hulk/Aquaman, the arena card switched the live map to Final Valley, and the real
  rule controls set first-to-one / 60 s. The cinematic intro was active with both nameplates, the VS
  beat, arena/round tag, authored exchange and hidden HUD; it completed unskipped, handed off to
  round 1 and preserved the 60 s clock. The round was real combat: Aquaman won **0–1** in 18 s;
  Hulk dealt **127%**, took **153%** and landed **4 hits**, with no forced percentage, teleport or
  frozen AI. Capture: **25/25 checks**, 0 page errors, 0 failed requests, including a real REMATCH
  click that starts a fresh round 1 at wins **0–0**, both fighters at **0%**, no result text and
  Final Valley preserved. The pass also fixed the loader/intro race and started the intro clock on
  its first rendered frame; the setup line now reports the selected rules. Evidence: `artifacts/a1-cohort/slice-presentation/` and
  `artifacts/a1-cohort/slice-presentation/slice-presentation.json`; harness:
  `scripts/capture-vertical-slice-presentation.mjs`. The earlier forced-999 slice is preserved under
  `artifacts/a1-cohort/slice/`.

Open, not hidden:

- The character-select 3D preview renders Hulk correctly after the model settles; the capture waits
  3 s, so the earlier blank frame was a loading-timing artifact rather than a menu defect.
- The intro capture holds the authored sequence for 8 s on SwiftShader (the player default remains
  5 s); it is software composition evidence, not hardware visual sign-off.
- Aquaman now uses source `DashLoop` sprint and `GroundDeathB` defeat, but has no source walk/run
  or strike clips, so walk/run and the authored trident attacks remain; `UI_DailySpin_Flying` is a
  skeleton-hollow unused clip. Hulk now plays source attacks, `@dash` locomotion, hit/stun and
  `@die`; library jump/double-jump/fall/land/knockdown/get-up remain, while `succ_cam` now owns victory. The Flash now plays source `punch`
  for heavy/heavyFinisher and `run`/`jumpDown` locomotion; the light chain, reactions and defeat pose
  remain library. Hulk's height review is closed; all three pass the 42/42 A1 matrix. These remaining
  source limits and the hardware/visual gates are recorded, not hidden.
- Hardware-GPU acceptance is still **0** and SwiftShader is not hardware evidence. All changes remain
  uncommitted; no commit, push, reset, clean or stash was performed.

At that point the next A2 cohort was **Wonder Woman, Thor and Saitama** — each had 25 source clips
and no A1 character-level evidence. They now pass 42/42 live combat each; see the session above.
Green Lantern (4 clips), Superman (0) and Doctor Strange (0) still need a validated clip package
before A1.

## Session 2026-11-12 — A0 launch acceptance gate

- Added `scripts/verify-launch-roster.mjs`, a selectable/batchable real-match gate. It boots the
  live game, selects fighters through the character-select API, runs movement/combat/defence/
  signature/ultimate/transformation/KO/rematch/defeat checks, and writes JSON + idle/result
  screenshots. It checks actual skeleton motion and damage, not just clip names.
- Initial run across **all 38 launch fighters**: **31 A0 PASS, 7 A0 OPEN** (later closed
  individually; see the seven-gap session below). Open: Superman, Hulk, Green Lantern,
  The Flash, Aquaman, Doctor Strange and Kaze, all on animation-slot coverage. Master report:
  `artifacts/launch-acceptance/report-all.json`; 38 idle + 38 result captures under
  `artifacts/launch-acceptance/<slug>/`.
- The 8 live-proven fighters all pass A0. This is **not full launch sign-off**: hardware GPU and the
  remaining ten-section states (select preview, light chains, anti-air/dive, throw, parry/dodge/
  counter/guard break, heavy-hit knockdown/get-up, second full match) are still open. SwiftShader
  remains the only renderer used.
- Fixed a real material crash exposed by Saitama: `surface_detail.js` was assigning a normal map to
  `MeshBasicMaterial` surfaces (including the `OH_Outline_Material`). The pass now only enhances
  lit PBR materials. Saitama and Iron Spider then completed clean matches with no page errors.
- The old Iron Spider UI error `Cannot set properties of undefined (setting 'value')` is the same
  Three.js normal-map uniform crash; it was not a settings UI bug. The fix is in
  `public/js/surface_detail.js`.
- A0 gate design detail: bounded batches reload the page between fighters so mixer/track state
  cannot leak across rows. The report keeps a latest-row-wins master across batches.
- Regression checks after the fix: `npm run test:animation` 280 passed; `npm run validate:assets`
  passed; `npm run build` exit 0; `git diff --check` clean. No commit, push, reset, clean or stash.

## Session 2026-11-12 — expanded A0 ten-section gate

- Extended `scripts/verify-launch-roster.mjs` in place with select-card preview, full jump/fall/land,
  five-input light chain, anti-air/dive, damaging throw follow-through, parry then counter, dodge,
  guard break, knockdown/get-up and a second completed match. Each row records 37 base checks and
  captures select, idle, result and second-result screenshots.
- **Goku passes 40/40 required checks; Naruto and Vegeta pass 37/37.** Goku's extra checks are the
  live fall, double-jump and forward-flight transition probes. Evidence:
  `artifacts/launch-acceptance/report-ten-section-goku-5.json`,
  `artifacts/launch-acceptance/report-ten-section-naruto.json`,
  `artifacts/launch-acceptance/report-ten-section-vegeta.json`.
- The knockdown/get-up probe now uses a real unforced P2 heavy collision. P1 is placed at 120%,
  P2 enters a heavy attack through the live simulate path, and the assertion requires actual damage,
  an airborne sample, a knockdown clip, a landing and a get-up clip. No hitstun or groundLevel is
  forced.
- The 35 other master rows were later rerun under the expanded checks. The master is **38/38 expanded A0 PASS** and **0/38 full sign-off**; hardware GPU evidence is still unavailable (SwiftShader).

## Session 2026-11-12 — close seven A0 animation gaps

- Added a targeted state-clip supplement in `public/js/human_fighter.js` for the seven imported
  rows that were A0 OPEN. It compiles only missing semantic states from the project's authored
  `clip_library` onto each mounted production rig; supplied clips that already describe a state are
  preserved. No fallback body is mounted and no unrelated clip is relabelled.
- **Superman, Hulk, Green Lantern, The Flash, Aquaman, Doctor Strange and Kaze now pass their live
  A0 rows individually.** Hulk also exposed a real late-load race: the imported reaction set was
  replacing the semantic knockdown with `stun`; forced state slots are now protected from that
  override. Aquaman's `HeroicIdleV2` was motionless, so the authored library idle now owns that
  slot and the idle-skeleton probe measures real movement.
- The Hulk row also needed a longer forced high-hitstun value and a held floor offset while the
  old state-machine probe was still in use. The replacing unforced heavy-collision probe passes on
  Hulk without either workaround.
- Evidence: `artifacts/a0-library-*.log`. A later controlled two-session rerun completed the
  remaining rows; the master is now 38/38 expanded A0 (see the next session). Full sign-off remains
  0/38.

## Session 2026-11-12 — expanded A0 rerun for the remaining 28

- Derived the target set from per-row evidence, not roster order: 28 rows had only 24/25-check
  baseline reports. They were **Infantry, Iron Man, Wolverine, Wonder Woman, Professor X, Arnold
  Schwarzenegger, Saitama, L, All Might, Edward Elric, Levi, Mario, Luigi, Kratos, Link, Master
  Chief, Geralt, Doom Slayer, Thor, Aang, Madara, Hashirama, Voldemort, Sasuke, Edna, Jack Sparrow,
  Spider-Man and Iron Spider**.
- Ran two sequential 14-fighter sessions with one Chromium instance each: `expanded-28a` and
  `expanded-28b`. Both completed **14/14 pass**. Combined with the ten earlier expanded rows, the
  master is **38/38 expanded A0**, 0 failures, 0 skips, 0 timeouts (Goku 40 checks; all other rows
  37). Evidence: `report-expanded-28a.json`, `report-expanded-28b.json`, `expanded-38-summary.json`.
- Aquaman parry race investigated: the old check read `p2hitstun` at the end of a 0.5 s window, by
  which time the attacker's 0.48 s hitstun had already decayed. The trace now records
  `maxP2Hitstun`; Aquaman passes with `maxAttackerHitstun: 0.48`. This was a harness race, not a
  combat defect.
- Unforced knockdown is now the required check, not a diagnostic. P2 enters a real heavy input
  (`attack + run`) through the same simulate path as a controller; P1 must take real damage, become
  airborne, play a knockdown clip, land and play get-up within 4.0 s. The focused 38-row run passed
  **38/38** with no forced hitstun or groundLevel. Aquaman reports `p1percent` 141.71 and
  `maxP1Hitstun` 1.159; Hulk and every other body also pass. Evidence: `unforced-38.json`.
- Full A0 master was rebuilt by replacing only this required check in the 38 preceding expanded rows; the other 1,371 checks are carried from the expanded reports. The master is 38/38 A0 PASS (1,409 checks), 0 failures, 0 skips, 0 timeouts, and full launch sign-off remains 0/38.
- Final regression: animation 280, rig-solo, movesets 91, combat 474, equipment 30, keyboard-combat,
  validate:assets and production build pass; `git diff --check` clean. No commit, push, reset,
  clean or stash.

## Session 2026-11-12 — A1 character-level acceptance (Goku, Spider-Man, Iron Spider)

- Preserved the completed **38/38 expanded A0** master (1,409 checks; 0 failures, 0 skips, 0
  timeouts). The focused Spider regression briefly regenerated the master with partial rows; its
  intended content was restored from the pre-merge master plus `unforced-38.json` (38 rows, 1,409
  checks, 0 failures), and the corrupt copy is retained for audit. No A0 row was otherwise rerun or
  replaced for this phase.
- Goku: `verify-goku-hd-match.mjs` **9/9**, software renderer, natural KO winner p2. The live state
  matrix passed **43/43 active** with 3 clips retired by documented decision. The direct ultimate
  probe passed **4/4**, with authored-set motion moving 8 joints and control/camera return. Guard
  reports `Guard 0.996`, `Blink 0`; hardware remains open.
- Spider-Man: extended `verify-spider-man-import.mjs` **21/21**. The newly closed A1 checks are a
  live heavy (15.34% on P2), a real defeat result (`PLAYER 2 WINS`, `wins [0,1]`) and a complete
  best-of-three (`wins [2,0]`, round 2). The first heavy attempt can miss; the harness retries up
  to three times and records the successful attempt. Hardware remains open.
- Spider-Man gameplay presentation: `verify-spider-man-gameplay.mjs` initially **20/40**, then
  **40/40** after binding Miles's existing authored web-kit clips onto his own mixer; the 21/21 import harness was rerun and stayed **21/21**. Web Zip,
  Web Shot (right-hand projectile, dealt 9), Web Pull (damage and displacement), Web Swing Strike,
  held `web_swing`, the three-beat Maximum Web Takedown (36%, meter spent, grab trace, control
  return) and Spider-Sense activation all pass with authored clips. The async imported strike pack
  no longer overwrites the web kit with generic `beam`; semantic fall/land are bound as well. The
  second combo hit is asserted as the authored `heavy_punch`, not a missing kick. Hardware remains
  open.
- Iron Spider: core harness **48/48**; full 57-clip matrix **55/57**. The two real failures are
  `Armature|hero_spiderman01_S05@collection` (0 s; 144 tracks / 104 targets; one key at t=0) and
  `Armature|hero_spiderman01_S05@skill07-03` (2 s; 196 tracks / 103 targets; 100 single-key
  rotations; 45 translation tracks with 61 keys). The untouched original `scene.gltf`/`scene.bin`
  has channel data **identical** to the source, fetch and runtime GLBs for both clips; all clip
  targets resolve inside the 107-joint skin (0 outside) and both actions load live. `collection` has 0 motion;
  `skill07-03` moves at most 2.139e-06 m from its first key and 5.960e-08 m key-to-key. Both carry
  all 20 spider-leg targets (39 and 38 channels respectively) with **0 moving channels**, and neither is
  mapped to gameplay. This is a source-animation limitation, not a harness property-path or
  runtime binding failure. Repairing them would require inventing keys or borrowing a clip, so
  both remain preserved and unselected. Object_122 is verified mounted, skinned, bounded,
  articulated and attached through the signature. At this point the design was permanently
  deployed with no stow/retract state; the later designed stow session below supersedes that gap.
  Hardware remains open.
- A1 standard: `docs/A1_CHARACTER_LAUNCH_CHECKLIST.md` defines all ten criteria, the
  implemented/automated/live/hardware/accepted evidence classes and the full-sign-off rule for all
  38 launch fighters.
- Evidence: `artifacts/launch-acceptance/a1-status.json`, `artifacts/a1-goku.log`, `artifacts/a1-goku-state-matrix.log`,
  `artifacts/a1-goku-ultimate.log`, `artifacts/a1-spider-import-final-after-webkit.log`, `artifacts/a1-spider-gameplay-final.log`,
  `artifacts/launch-acceptance/report-a1-spider-regression.json`,
  `artifacts/iron-spider/forensic-e2e.log`, `artifacts/iron-spider/forensic-diagnostic.json`,
  `artifacts/iron-spider/clip-matrix/report.json`,
  `artifacts/iron-spider/clip-recovery-audit.json`.
- A1 result at this point: Goku, Spider-Man and Naruto had complete software evidence; Goku still
  has a guard-sclera review and Naruto's transformed-KO edge is now closed at 2/2. Spider-Man is
  40/40 gameplay plus 21/21 import. Iron Spider was partial here; the later designed stow session
  below closes its A1 software gaps. Vegeta and T-800 are partial with 13/13 migration evidence.
  Software renderer (SwiftShader) is not hardware-GPU acceptance. No commit, push, reset, clean or
  stash.

## Session 2026-11-12 — Iron Spider defeat/rematch coverage and stow/retract feasibility

- Expanded `scripts/test-iron-spider.mjs` from **48/48** to **53/53**, exit 0. The added checks
  assert the full victory payload (`VICTORY · IRON SPIDER`, winner p1, wins [2,0]), the `REMATCH`
  action and a fresh post-victory match, a real two-round defeat (`DEFEAT · GOKU`, winner p2,
  wins [0,2]) and a fresh post-defeat match. Both rematches restore 0% health, clear the result
  text and keep native `Object_122` mounted. Log: `artifacts/iron-spider/a1-defeat-rematch.log`.
- Re-ran the original-source audit into `artifacts/iron-spider/forensic-diagnostic-a1.json`. It
  again found `collection` (0 s; 144 tracks / 104 targets; 0 arm channels moving) and
  `skill07-03` (2 s; 196 tracks / 103 targets; maximum translation 2.139249e-06 m; 0 arm channels
  moving) static in the original glTF, source GLB, fetch GLB and runtime GLB. No repair was applied.
- Stow/retract feasibility: **technically possible without replacing the model, but not available
  from the existing clips.** The 57-clip inventory has no stow/retract/deploy/fold clip; both
  suspect clips have a 1.239 × 1.313 × 1.239 m arm envelope, essentially idle, not folded. Hiding
  `Object_122.visible` is an on/off pop, not a production retract. A native-bone fold or new
  authored stow/deploy clip is feasible only as new work. Assessment:
  `artifacts/iron-spider/STOW_RETRACT_FEASIBILITY.md`.
- No production body, skeleton, arm, clip identity or gameplay code was changed. Hardware-GPU
  acceptance remains open; all browser evidence is SwiftShader.

## Session 2026-11-12 — Iron Spider designed stow/retract and A1 gap closure

- Implemented `public/js/anim/native_spider_stow.js`: a reversible 0.30 s procedural fold of the
  four native five-bone appendage chains. At progress 0 it is a no-op; at full fold the tips form a
  compact back-mounted stack. It never edits a clip, changes joint lengths, hides `Object_122` or
  replaces the 107-joint body.
- Input/state rules: `G` (P1) / `\` (P2) toggles while grounded and neutral. Attack, jump, dodge,
  hit reaction, grab, flight, KO and round reset deploy; the signature cannot land from a folded
  hitbox. Round reset snaps back to deployed.
- Expanded `scripts/test-iron-spider.mjs` from **53/53** to **58/58**, exit 0. New checks prove the
  deployed start, folded tip envelope, mid-transition blend, exact redeploy, unchanged
  `collection`/`skill07-03` clip signatures (all 57 clips), and attack auto-deploy. The original
  separate victory/rematch/defeat/rematch checks remain in the same run.
- Roster coverage is closed for the launch roster: the existing matrix report has **37/37**
  selectable opponents, 148 captures, 185/185 per-opponent checks and 188/189 merged checks (one
  non-fatal batch-03 UI error; every match row passed). No selectable rows remain; the 22
  catalog-only entries have no character-select slots.
- Evidence: `artifacts/iron-spider/software-run.json`, `artifacts/iron-spider/software-run.log`,
  `artifacts/iron-spider-stow-folded.png`, `artifacts/iron-spider-stow-redeployed.png`,
  `artifacts/iron-spider/matrix/report.json`, and the updated
  `artifacts/iron-spider/STOW_RETRACT_FEASIBILITY.md`.
- All browser evidence is SwiftShader. Hardware-GPU acceptance remains open; no
  `artifacts/iron-spider/hardware-run.json` exists.

## Session 2026-11-12 — Naruto A1 acceptance

- Ran a focused live match with `A0_LABEL=naruto-a1` so the 38-fighter A0 master was not overwritten:
  **37/37** checks, 0 page errors and 0 failed requests. The production Sage body mounted at 19
  bones, 3 skinned meshes, 9 textured materials, 1.80 m, feet/ground 0.18. Evidence:
  `artifacts/launch-acceptance/report-naruto-a1.json` and `artifacts/a1-naruto/live-match.log`.
- Fresh 49-state matrix: **49/49**, missing/extra `[]`, 0 errors/failed requests; baked GLB
  **91/91**; solo lane **49/49** for Naruto and **134/134** overall. Evidence:
  `artifacts/naruto-49-state/report.json`, `artifacts/a1-naruto/49-state.log`,
  `artifacts/a1-naruto/baked-glb.log`, `artifacts/a1-naruto/rig-solo.log`.
- Fixed the signature harness timing: it pressed `K` at 0.5 s while `FORM.activationLock` is 0.62 s,
  causing four false form failures. It now waits 0.8 s and records `landed`/`formLock`; all five
  forms pass and each has an explicit exit check restoring base `RASENSHURIKEN`. Final signatures:
  **21/21**. Evidence: `artifacts/a1-naruto/signatures.log`.
- Keyboard combat: **18/18** — five-input chain, heavy/launcher/slam, signature, CPU motion mapping,
  no page errors. Evidence: `artifacts/a1-naruto/keyboard-combat.log`.
- Added `scripts/verify-naruto-a1.mjs` for the states the roster-wide A0 gate does not prove. It is
  **7/7**: walk (`walk`, 5.51); sprint enters the Shift dodge (`Naruto_jump`) and settles to
  grounded `run` at 12.57 with `dodgeTimer:0`; form exit restores `RASENSHURIKEN`; the authored
  wind-up launches `RASENSHURIKEN` from `RightHand` (`fallback:false`, self-distance 0.605); the
  ultimate casts `authored_ultimate`, spends 100 meter and returns to idle; no page/asset errors.
  The A0 sprint sample was therefore a dodge-window sample, not a missing sprint/run lane.
- Evidence record: `artifacts/launch-acceptance/report-naruto-a1-readiness.json`. All evidence is
  **SwiftShader software**, not hardware acceptance. Open: KO/match-end during a transformation or
  ultimate was not separately asserted (form exit and ultimate return are verified); hardware-GPU
  acceptance; full launch sign-off. `a1-status.json` now records software-pass core, not full
  acceptance.
- Regression gates: build, rig-architecture **26/26**, animation **280**, animation-coverage **91**,
  rig **31/31**, validate-assets and `git diff --check` pass. No production code changed; only the
  two Naruto verification scripts changed. No commit, push, reset, clean or stash.

## Session 2026-11-12 — Naruto transformed KO, Vegeta/T-800 hardware preparation

- Closed Naruto's open transformed-KO edge with `scripts/verify-naruto-transformed-ko.mjs`: **2/2**.
  The real `I` input lands SAGE MODE, a one-round KO then reaches a live match result with
  `VICTORY · NARUTO UZUMAKI` (`winner: p1`), and the result-screen `REMATCH` starts with the form
  cleared, 0% health and no stale result text. Evidence: `artifacts/a1-naruto/transformed-ko.json`,
  `artifacts/a1-naruto/transformed-ko-result.png` and `artifacts/a1-naruto/transformed-ko.log`.
  This is SwiftShader software evidence; hardware and full sign-off remain open.
- Wired `verify-naruto-a1.mjs` and `verify-imported-migrations.mjs` to the shared renderer helper,
  so their reports now contain the real GPU object and `hardwareMode` instead of a hardcoded
  SwiftShader label.
- Re-ran Vegeta and T-800 through the migration suite: **13/13 each** with no page or asset errors.
  Vegeta: 11-bone / 1.65 m body, 25/25 moving clips, 11.3% jab, 22-damage GALICK GUN from
  `GD_hand_R_186` with no fallback, hands free. T-800: 1.88 m body, 25/25 moving clips, 26.9% jab,
  19-damage CYBERNETIC CANNON from `arm_right_wrist_027_37`, heavy shotgun equipped. Logs:
  `artifacts/imported-migrations/vegeta-a1.log`, `t800-a1.log`; report renderer capture is
  SwiftShader, so this is not hardware acceptance.
- Added Naruto (A1 probe + transformed KO), Vegeta and T-800 to
  `scripts/run-hardware-gpu-acceptance.mjs`, with expected counts 7, 2, 13 and 13, report paths and
  signature/result screenshots. Runbook updated in `docs/HARDWARE_GPU_ACCEPTANCE.md`. No hardware
  acceptance run succeeded in this workspace; the preflight remains the hard gate.
- `artifacts/launch-acceptance/a1-status.json` recorded Naruto as A1 software pass including the
  transformed KO, and Vegeta/T-800 as **A1 partial** at that time (13/13 migration, 25/25 clips,
  full ten-criterion matrix and hardware open). This was superseded on 2026-11-13: both now pass
  the full **42/42** matrix with source topology repaired; hardware remains open. Neither imported fighter
  is fully accepted.
- Added `HARDWARE_GPU_ONLY` targeting to the hardware runner. The Iron Spider targeted attempt
  (`HARDWARE_GPU_ONLY=iron-spider HARDWARE_GPU=1 HARDWARE_GPU_HEADLESS=1 npm run accept:hardware-gpu`)
  wrote `artifacts/hardware-gpu/summary-iron-spider.json`, detected SwiftShader in the preflight,
  exited 1 and launched no suite. The direct Iron Spider suite also rejected the renderer before its
  first check. The current **58/58** SwiftShader result is kept as
  `artifacts/iron-spider/software-run.json`; no `hardware-run.json` exists. Blocked-attempt record:
  `artifacts/iron-spider/hardware-gpu-attempt.json`.

## Session 2026-11-12 — character-scale warning audit

- Rechecked the four raw-height warnings in the live match path. The manifest values are authored
  source units, not metres. Runtime bodies: Green Lantern **1.88 m**, Aquaman **1.93 m**,
  Doctor Strange **1.88 m**, The Flash **1.83 m**.
- Aquaman's full-object bounds are 2.52 m because the trident is included; his body is 1.93 m.
  No character was rescaled to a universal height.
- Added a required body-only height check to `scripts/verify-launch-roster.mjs`: equipped weapons
  are excluded from the measured mesh box and the body must be within 8% of the identity target.
  Nine rechecked rows (including Wonder Woman, Thor, Aang, Madara and Hashirama) pass. The other
  29 rows still carry the earlier target/feet check until the next full gate run.
- Evidence: `artifacts/launch-acceptance/scale-audit.json`, `artifacts/launch-acceptance/report-scale-*.json`,
  `artifacts/a0-scale-*.log`.

## Session 2026-11-12 — Goku bindings, matrix and six-fighter guard audit

- Added `scripts/verify-goku-state-matrix.mjs`. It mounts Goku in a real match and plays every
  active authored clip on the live 73-bone body. After the binding work the result is **43/43
  active**, with zero unresolved tracks. Report: `artifacts/goku-state-matrix/report.json`, contact
  sheet `sheet.png`.
- Wired Goku's real `DoubleJump`, `Fall` and `FlyForward` clips into the reaction manifest and the
  shared state machine. Live probes now confirm falling selects `Goku_Fall`, a second jump selects
  `Goku_DoubleJump`, and forward flight selects `Goku_FlyForward`; the three checks were added to
  the Goku A0 row (40 checks total).
- Retired `Goku_Special` (exact alias of `Goku_Kamehameha`), `Goku_Air` (exact alias of
  `Goku_AirPunch`) and `Goku_Punch3` (alternate straight; the declared light-3 is Rising Dragon
  Kick). They remain in the source GLB but are not counted as launch states; the matrix reports
  them separately rather than faking 46/46.
- Guard face probe passed: baked face, `expression: guard`, `Guard 0.996`, `Blink 0`; the head
  close-up `artifacts/goku-state-matrix/guard-face.png` has narrowed eyes and no detached sclera.
  The reported guard-sclera symptom did not reproduce on the current baked asset.
- Re-ran the six-fighter guard/offhand audit with `AUDIT_SCOPE=guard`. **6/6 measured**: Wonder
  Woman and Link (shield) 1.39% guarded vs 7.74% open (0.18); Jack, Kaze, Thor and Aquaman (bare)
  2.17% guarded (0.28). All six engaged guard, used a block clip and landed both probes; no page
  errors. Evidence: `artifacts/phase22-5/offhand-guard-audit.json`.
- The audit needed harness repairs, not combat repairs: its server wrote headers before reading a
  missing file, it clicked hidden select-screen buttons, it required the queue to be observable
  after a fast hit, it expected the literal clip `block` instead of `block__upper`, and it sampled
  the post-hit reaction pose. Those are fixed. The deeper stripped/parry/economy/break/projectile
  cases remain to be rerun.
- Regression after the Goku binding: animation 280, rig-solo, movesets 91, combat 474, equipment 30,
  keyboard-combat, `validate:assets` and production build pass; `git diff --check` clean. The action
  also exposed and fixed a matrix-harness exit-code bug (`browser.close()` ran before `finally`),
  so a fully passing matrix now exits 0.

## Session 2026-11-12 — Phase 2 launch audit

- Added the 38-row launch checklist (`docs/LAUNCH_ROSTER_ACCEPTANCE.md`) and the dependency-ordered
  roadmap (`docs/PRODUCTION_ROADMAP.md`). **0/38 were fully signed off** under the new ten-section
  gate; this is an audit result, not a claim that the game is unplayable. The A0 automated gate now
  records **31/38 A0 PASS**; full sign-off is still 0/38.
- Current cohort: **8 imported fighters have live evidence**, **11 imported fighters have clip
  libraries but no full gate**, **Superman and Doctor Strange have no clips**, and **17 authored
  launch bodies** need final quality/acceptance. DLC identities remain preserved but are excluded
  from launch sign-off.
- `node scripts/measure-roster-bodies.mjs` was re-run against the current manifest. It corrected a
  major metadata error: most authored original launch bodies already contain **25 embedded clips**;
  the manifest's `verified.clips: 0` is stale. Goku's body measures no embedded clips because his
  46 clips live in the separate `goku_animated.glb`.
- Raw bounds expose scale review targets: Green Lantern 0.019 m, Aquaman 0.024 m, Doctor Strange
  0.765 m and The Flash 3.214 m before runtime normalization. These are checklist flags, not yet
  claimed runtime failures.
- Iron Spider's recorded 188/189 matrix is one **non-combat batch-03 UI pageerror**
  (`Cannot set properties of undefined (setting 'value')`); all ten batch-03 matches, signatures and
  result screens passed. The 57-clip matrix remains 55 PASS / 2 FAIL on the static source poses
  `collection` and `skill07-03` (forensically confirmed; no runtime binding failure).
- No six-failure guard report exists in the current artifacts. The available
  `scripts/audit-offhand-guard.mjs` covers six shield/offhand fighters but has no saved result here;
  it must be rerun rather than claimed fixed.
- Regression gates in this runner: `npm run test:animation` **280**, `validate:assets` pass, `build`
  exit 0, checklist 38/38 rows, `git diff --check` clean. No commit, push, reset, clean or stash.

## Session 2026-11-10 — Batch 1: audit and candidate acquisition

### Environment

| Item | State |
| --- | --- |
| Branch | `freebuff/726ce0c51041fd4f569ce7bd` |
| Working tree | ~54 uncommitted entries carried over; nothing committed, pushed, reset, stashed or amended |
| Blender | 4.2.23 LTS at `.tools/blender-4.2.23-linux-x64`, run through `bash scripts/blender.sh` (verified with `-b --version`) |
| Sketchfab token | `SKETCHFAB_TOKEN` present; `--check-auth` accepted; no value written to any file |
| Dev server | port 3000, host `pv-726ce0c51041-ea1ea8cc-f332-4204-b27c-9d060919ce10.style.dev` |

### Completed in this batch

1. **Roster audit.** 60 selectable identities, 80 manifest identities, 38 launch + 22 DLC.
   All 60 resolve to an existing file; 10 use imported bodies; 17 declare clips.
   Data: `artifacts/roster-audit/roster-mapping.json` and `docs/ROSTER_MAPPING.md`.
2. **Body measurement.** `npm run measure:bodies` exit 0 (`artifacts/roster-bodies.json`),
   `npm run audit:rigs` exit 0 (`artifacts/roster-audit/rigs.log`).
3. **Supplied candidates downloaded** with `--stage-only` (archives preserved, no manifest writes):
   Naruto Sage, Miles Morales, Ultra Ego Vegeta, T-800, Iron Spider.
   Details: `docs/CANDIDATE_INSPECTION.md`, `artifacts/roster-audit/candidates.json`.
4. **Iron Spider original animation preservation started correctly.** Unmodified source copied to
   `artifacts/iron-spider/original/iron_spider.source.glb`; all 32 clips enumerated with duration,
   channels and target nodes in `artifacts/iron-spider/original/clip-inventory.json`.
5. **Iron Spider prepared without losing clips.** Blender normalise (uniform ×0.034206 → 1.85 m,
   feet at 0) exported `artifacts/iron-spider/prepared/iron_spider_normalized.glb`; post-export
   inventory reports **32/32 clips, 0 missing, 0 extra, 107 joints**
   (`artifacts/iron-spider/prepared/preservation-report.json`). Not yet mounted or played.
5. **Existing candidates re-inspected:** Harry (68 joints, 0 clips), Hulk (19 clips),
   Saitama (25), Light rigged (25), Hashirama (25, 100× scale defect), current Naruto (567 joints, 19 clips).

### Not done in this batch

- No supplied candidate has been prepared, rigged, retargeted, imported into the game, or played.
- Naruto Sage is an unrigged 4.3k-triangle static scene; it needs a full humanoid rig, weights and animation set.
- Miles had a 178-joint rig and one idle clip at that point; the bone map and promotion landed in
  the 2026-11-11 Batch 2b session below, and the spine slot was repaired and verified later the
  same day.
- Vegeta now has the supplied 311-joint Ultra Ego body with 25 retargeted clips; T-800 still has a 53-joint rig, zero clips and cm-scale bounds.
- Iron Spider's 32 clips are archived **and survive the normalising export**, but the prepared body
  is not mounted in the game or played; its native 54.26-unit scale with feet at −50.15 was the
  recorded cause of the earlier runtime rejection.
- The Light slot still displays **L (Death Note Style)**. The body is already Light; the display
  identity and L-themed moveset are unchanged.
- Harry is not integrated; Voldemort's authored body remains production.
- No character-specific movesets, weapons, abilities, transformations, ultimates or cinematic work
  has been done for the new candidates.

## Session 2026-11-11 — Naruto Sage rig and 49-clip retarget

- The supplied Sage static scene was packed to `artifacts/naruto-sage/naruto_sage_source.glb`, then
auto-rigged by `scripts/autorig_batch.py` to the exact 19-bone canonical skeleton. The rig report
records 19 bones, 0 unweighted vertices and at most 4 influences.
- The Rigify retarget map was corrected to prefer `DEF-*` deform bones, with explicit spine-chain
mapping. All four `--calibrate-arms` passes reported 19/19 mapped bones and 0 unresolved tracks.
- Production `naruto_uzumaki` now points at
`/models/characters/imported/naruto_sage/naruto_sage_animated.glb` (1,121,652 B, SHA-256
`1d660ada…`, 3 skinned meshes, 5,248 vertices, 4,316 triangles, 49 clips). The old 567-bone body is
retained as `rollbackUrl`; display identity and internal ID are unchanged.
- Manifest provenance now credits **Naruto Sage by ninjatorent13, CC BY 4.0**. `public/ATTRIBUTIONS.md`
records the same credit and the modification.
- Live match verified the Sage mount: 3 skinned meshes, 19 bones, `rig.bound: 19`, 0 validation
issues. Idle played `Naruto_idle`; an input-driven light attack played `authored_light1` and returned
to idle. Reaction, authored and ability reports were all `ready`, with `missing: []`.
- Green: `node scripts/test-naruto-baked-glb.mjs` (91 checks), `test:rig-architecture` (26/26),
`test:animation-coverage` (91), `validate:assets`, `build`. Logs are under
`artifacts/naruto-sage/final-gates/`.
- **Coat repair:** the two adjacent auto-rigged coat panels that collapsed in `Naruto_defeat` now
use the torso chain. `npm run fix:naruto-coat` records the repaired components and verifies the GLB.
`test:rig-solo` is **49/49** for Naruto (full lane **134/134**), with the worst defeat seam at
**0.155x** against the unchanged 0.15x gate; the repaired coat edge itself is about **0.76x**.
- **Live 49-state acceptance:** `npm run test:naruto-49-state` played all **49/49** clips on the
live mounted 19-bone Sage rig, rendered a 7 x 7 contact sheet, and remeasured the defeat coat at
**0.1555x** (a shoulder/sleeve fold; the repaired coat edge is about **0.76x**). Evidence:
`artifacts/naruto-49-state/sheet.png`, `defeat-coat.png` and `report.json`.
No page errors or failed asset requests. The source still has 352 open boundary edges, so the GE
topology inspection remains a source limitation, not a failed animation state.
- No commit, push, reset, stash or clean was performed.

## Session 2026-11-11 — Shared animation transition foundation

- Added `public/js/anim/transition_policy.js`: semantic clip families, family-aware crossfade
  lengths, and gait phase transfer. Both the legacy action mixer in `human_fighter.js` and
  `AnimationController` call the same policy.
- Gait-to-gait changes (`run → walk`, `walk → run`) now copy the outgoing normalized cycle phase
  instead of restarting at frame zero. Attack, hit, airborne and idle transitions deliberately do
  not inherit a gait phase.
- Live Naruto Sage proof on the imported 19-bone body: `idle → run` at `0.13 s`; `run → walk`
  recorded `syncPhase: true`; `hit_light` used `0.045 s`; recovery to idle used `0.16 s`. The live
  probe paused simulation for one frame so physics could not overwrite the configured test speed;
  the same mixer, state selection and clip actions ran.
- Green: `test:animation` (249 checks), `test:locomotion` (65), `test:motion` (34),
  `test:animation-coverage` (91), `build`, `git diff --check`.
- **Completed later:** upper/lower-body masks and the Naruto Sage 49-state live acceptance matrix.
  The additive facial/weapon overlay pass is also implemented in
  `public/js/anim/animation_overlays.js`; other imported characters, combat mechanics, and
  environment reconstruction remain outside that session.

## Session 2026-11-11 — Batch 2b: Miles Morales promoted into Spider-Man

- The supplied Miles GLB was packed from the source `.gltf`, its spec/gloss materials were
  converted for Three.js, and the 25-clip Spider-Man package was retargeted onto its 178-joint
  skeleton while retaining the supplied `FearlessFlight_Male_idle` (26 clips total).
- Production `spider_man` now points at
  `/models/characters/imported/miles_morales/miles_morales_animated.glb`; display identity is still
  **Spider-Man** and the previous `spider_man_rigged.glb` remains the rollback.
- Live select and a real Spider-Man vs Goku match loaded the file with runtime validation `ok`,
  178 bones, three skinned meshes, and all reaction/strike slots bound. Input-driven idle, walk,
  sprint, jump, landing, block, dodge, jab, heavy, special and ultimate animation were observed.
- **Not complete:** air attack, throw/grab, hit/knockdown/get-up, victory/defeat and ultimate damage
  were not all captured. Playwright was absent at the time, so the updated E2E harness was not run
  then (it was installed later; see the Playwright session below). Iron Spider's native arm was
  repaired and live-tested on 2026-11-11; full matrix remains.
- Exact record and evidence: `docs/MILES_MORALES_INTEGRATION.md`, `artifacts/miles/`.

## Session 2026-11-11 — Miles bone map repaired and verified in a browser match

- The first Miles retarget was **not** a complete bone map: `artifacts/miles/prepared/retarget.log`
  recorded `missing: ["spine"]` on all 25 clips. `trunkKey()` read the exporter's trailing bone id
  (`spine_01_142_12`) as the spine index, classified all five segments as `torso`, and left the
  donor `Spine` track with no destination while `Chest` drove the lowest lumbar bone.
- Fixed the index parse in `public/js/anim/bind_pose_retargeter.js` and re-baked the 25-clip
  package onto the 178-joint body: **19/19 slots, `missing: []`**, with both `spine_01` and
  `spine_02` animated in every clip. The re-bake restores the promoted material/texture JSON,
  because the retarget source is the pre-material-conversion packed GLB.
- `scripts/verify-spider-man-import.mjs` now asserts the spine track and live torso motion; it
  passed **12/12** at that point (superseded by 18/18 below) in a real Spider-Man vs Goku match:
  `jab` 8.12% damage, 0.202 m wrist travel,
  `spine_01` 15.3° and `spine_02` 30.1° during the strike, all three materials textured.
- Green: `test:animation` (249), `test:roster-models` (38/38), `validate:assets`, `build`,
  `git diff --check`.
- **Not done at that point:** aerial/throw/hit-reaction/knockdown/victory damage matrix (closed by
  the next session), a full best-of-three match, all-roster matches, and a hardware-renderer check.

## Session 2026-11-11 — Miles clip matrix green (18/18)

- `scripts/verify-spider-man-import.mjs` now drives and asserts the aerial, throw, light hit
  reaction, knockdown, get-up and victory clips in a live Spider-Man vs Goku match. Each check
  records the selected clip plus the largest bone-quaternion change between samples, so a missing
  or bind-pose action cannot pass on its name.
- **18/18 checks, exit 0** (`artifacts/miles/prepared/browser-clip-matrix.log`): `air_attack`
  while 1.64 m airborne, `throw` from a real U grab, `hit_light` from a live 0.4 s stun,
  `knockdown` while 1.85 m airborne, `get_up` from the landed stun-spent recovery state, and
  `victory` from `victoryPose`. The settled jab still deals 8.12%.
- The aerial check found and fixed a selector defect: imported bodies with their own air clip were
  routed to the generic authored `light3`/airborne `light4` fallback and played a ground jab/heavy
  punch. An airborne strike on such a body now leaves the authored path so the live branch plays
  its own `air_attack`.
- Captures: `artifacts/spider-man-import/4-aerial-spider-man.png` through
  `9-victory-spider-man.png`; the earlier select/match/attack frames are unchanged.
- Green: browser E2E 18/18, `npm run build`, `npm run validate:assets`, `git diff --check`.
- **Not done:** hit-heavy/defeat captures, dodge timing, full combo/ultimate damage, a complete
  best-of-three match, all-roster matches, and a hardware-renderer check. The knockdown capture is
  a launched airborne reaction, not a fully prone body.

### Character status (honest)

| Fighter | Classification | Next requirement |
| --- | --- | --- |
| Naruto | **A1 SOFTWARE-PASS CORE — 37/37 LIVE; 49/49 SOLO + 49/49 LIVE; TRANSFORMED KO 2/2; coat repaired** | Sage body on the 19-bone rig with all 49 clips bound. Two coat panels were reweighted with `fix:naruto-coat`; `test:rig-solo` and the live browser pass are 49/49, and the worst remaining garment edge measures 0.1555×; the repaired coat edge is ~0.76×. A1 adds 37/37 live match, 21/21 signatures (all five forms and exits), 18/18 keyboard combat, 7/7 focused probe, 2/2 transformed KO/rematch, right-hand Rasenshuriken and ultimate return. Hardware and full sign-off remain open. |
| Vegeta | **A1 SOFTWARE PASS — 42/42 LIVE + 25/25 RETARGETED CLIPS; SOURCE TOPOLOGY REPAIRED** | Ultra Ego body and all 25 retargeted clips played in the full matrix: five-hit chain, heavies, aerial, grab/throws, defence, knockdown/get-up, jump/land, GALICK GUN,   both kit abilities, ultimate, SUPER SAIYAN entry/exit and KO during form, victory/defeat and both rematches. Source mesh is repaired to 0 open / 0 non-manifold; 25 root-key warnings. Hardware remains; the post-fix 70-frame visual review is clean. |
| Spider-Man / Miles | **BONE-MAPPED 19/19 — A1 software 40/40 gameplay + 21/21 import** | Miles body, textures, 26 original clips and 57 retargeted Iron Spider clips load in live select/match; aerial, throw, hit reaction, knockdown, get-up and victory clips are selected with pose evidence, and the landed jab still deals 8.12%. A1 adds authored web-kit casts, held swing, three-beat ultimate, live heavy (15.34%), real defeat (`PLAYER 2 WINS`) and a complete best-of-three (`wins [2,0]`). Hardware capture remains. |
| Arnold / T-800 | **A1 SOFTWARE PASS — 42/42 LIVE + 25/25 RETARGETED CLIPS; SOURCE TOPOLOGY REPAIRED** | 1.88 m T-800 endoskeleton, HUD `T-800`, heavy shotgun, CYBERNETIC CANNON, both kit abilities, ultimate and COMBAT CHASSIS OVERDRIVE, complete defence/knockdown/rematch coverage. Five light hits deal 64.77% melee plus 75% from five shotgun shots; point-blank shot hitstun can drop a held guard. Source mesh is repaired to 0 open / 0 non-manifold, with the final 49 hand/finger-joint edges closed by existing-vertex caps. Hardware remains. |
| Iron Spider | **A1 SOFTWARE EVIDENCE COMPLETE — 58/58 E2E + DESIGNED STOW/RETRACT + 37/37 ROSTER** | Core 58/58: five native-bone stow/deploy checks, separate victory, rematch after victory, two-round defeat and post-defeat-rematch coverage. The full 57-clip matrix is 55/57; the two failures are static source poses. The original `scene.gltf` confirms `collection` and `skill07-03` are static; every derived GLB is channel-identical, all targets resolve, and both actions load, so this is not a binding failure. Stow/retract is a reversible 0.30 s fold of the existing 21 appendage bones; `G` toggles, attacks/jumps/dodges/hit reactions/grabs/flight/KO/round reset deploy, the mesh stays visible, and no clip changes. Roster is 37/37. Hardware remains. |
| Harry | **LIVE ACCEPTANCE COMPLETE — 13/13** | 68-joint body, 25 baked clips, HUD `HARRY POTTER`, hand-sized wand, 9.2% jab and 20-damage Expecto Patronum. 498 source boundary edges remain. |
| Light | **IDENTITY + MOVESET COMPLETE — 13/13** | HUD `LIGHT YAGAMI`, Light/Keikaku moveset, scaled Death Note, 7.3% jab and 8-damage Name in the Notebook. Stable key remains `l_death_note_style`. |
| Hulk / Saitama / others | Existing integrated fighters | Preserve; verify after any loader change |

### Exact next task (Batch 2a)

> **Historical:** this batch was superseded by the 2026-11-11 native-arm repair session below;
> the body and supplied arm are now promoted. This section is kept for provenance.

Prepare Iron Spider first, because its original clips are the hardest preservation constraint and
the defect is measured:

1. Import `artifacts/iron-spider/original/iron_spider.source.glb` in Blender 4.2.23.
2. Normalise uniformly by `1.85 / 54.264` and translate so the lowest foot vertex sits at y = 0;
   do not apply non-uniform scale.
3. ~~Export a runtime GLB~~ **Done:** `artifacts/iron-spider/prepared/iron_spider_normalized.glb`
   reports 32 clips / 107 joints, 0 missing, 0 extra.
4. Load the prepared GLB in Three.js and play `@idle`, `@walk`, `@hit`, `@skill07-02`; capture playback evidence.
5. Only then change the `iron_spider` manifest URL, keeping `roster/iron_spider.glb` as rollback.

**Closed 2026-11-11:** T-800, Harry, Light and Vegeta are live-accepted at 13/13 each; see the acceptance session at the end of this file. Iron Spider's native-arm blocker was closed on 2026-11-11 (see the later session below).
The Vegeta runtime acceptance is complete; no imported migration remains open.

### Blockers

- None for acquisition or Blender work. The only limiting factor is execution time per batch.
- Existing known issue: the height lineup's isolated render path throws in Three's uniform refresh;
  use `isolate:false` for visual captures.

### Guardrails for the next session

- Do not commit, push, reset, clean, stash, amend or force-checkout.
- Never overwrite the only copy of a source model; keep archives under `artifacts/`.
- Do not claim a clip preserved until it is in the prepared asset **and** demonstrably plays.
- Do not rename a display name without adding a display→slot alias; roster lookup is by display string.


## Session continuation 2026-11-10 — Iron Spider promoted body (PARTIAL)

- Production URL is now `/models/characters/iron_spider/iron_spider_source_animated.glb` — 11,231,688 bytes, 107 joints, 57 clips (32 original + 25 supplemental), 5 renderable meshes.
- The untouched source is preserved at `public/models/characters/iron_spider/iron_spider.glb` and `artifacts/iron-spider/original/iron_spider.source.glb`. The generated 19-joint body remains the rollback.
- Live Cloud-browser mount verified: `loaded`, no validation issues, head-above-pelvis 0.63 m, feet at 0, all 57 actions exposed, 16/16 reaction slots and 20/20 strike slots bound, four-leg articulated fallback attached.
- 30/32 original clips measurably animate the skeleton. `collection` is 0 s and `skill07-03` has no motion; both are preserved but not used. The 2026-11-12 original `scene.gltf` accessor audit confirmed identical static data in every source copy, 0 targets outside the 107-joint skin, and no source-backed repair. Counter remapped to `skill07-04`; block uses original `wait`.
- **Not complete:** the supplied `Object_122` mechanical-arm mesh has authored skinned bounds of 45.4 × 51.5 × 57.5 m and is displaced below the body. It is preserved but excluded from the production bake; the visible appendages are the existing four-leg procedural rig. The supplied mechanical-arm mesh/rigging requirement is therefore unmet.
- Green Node gates: build, validate:assets, test:animation (240), test:animation-coverage (91), test:rig-architecture (26), test:equipment (30), test:projectile (27), test:roster-models (38/38).
- Not run at the time (superseded by the 2026-11-11 Playwright session below): `npm run test:iron-spider` / browser E2E and match captures. Playwright was absent from the restarted runner then; the live app was inspected and driven through the Cloud browser instead. No full matches against Spider-Man, Superman, Goku or Master Chief were completed for this integration.
- Evidence: `artifacts/iron-spider/runtime-mounted-clean.png`, `artifacts/iron-spider/runtime-probe.json`, `docs/IRON_SPIDER_INTEGRATION.md`.

## Session 2026-11-11 — Iron Spider native mechanical arms repaired and played

- The supplied `Object_122` arm mesh was repaired with the direct-GLB path: fit scale
  `0.03919749`, translation `[-0.000104, 0.097631, -0.003651]`, reflection determinant `-1`,
  reversed triangle winding, and one reattached `Object_122` under the body. The failed Blender
  candidate was not used.
- Production `iron_spider_source_animated.glb` is now 11,231,696 B, SHA-256
  `08124a094f6c3faa216ad0f238cb1422935042b01a89254dbd2183eccab0186d`: 6 skinned meshes, 5,181
  vertices, 5,795 triangles, 107 bones and 57 clips. The supplied arm has 1,110 vertices, 1,200
  triangles and 21 appendage bones.
- Live Cloud-browser match (Iron Spider vs Goku, Tournament): loaded with no validation issues;
  native arm visible; no procedural four-leg rig. Idle arm bounds were 1.211 × 1.323 × 1.211 m.
  J played `atk-01`; K played `skill07-02`, dealt 17% damage and 0.55 s stun to the adjacent
  opponent. Evidence: `artifacts/iron-spider/arms/live-candidate-current.png` and
  `live-candidate-closeup.png`.
- `scripts/test-iron-spider.mjs` now asserts the native arm and the absence of the procedural
  fallback, and was **run green (41/41, exit 0)** once Playwright was installed; the current suite is
  **44/44** after the arm-acceptance checks were added (see the Playwright session below). The Node
  inspector still exits nonzero on 371 open boundary edges (source 352);
  runtime rig validation and live play pass.
- Remaining: the full 57-clip visual matrix, all-roster match captures, and a dedicated native-arm
  combat contact layer. The signature's damage currently resolves through the working shockwave
  arc; the native leg mesh is visual presentation, not a bespoke leg-tip hit volume. No commit,
  push, reset, clean, stash or amend was performed.
- Added `scripts/capture-iron-spider-arm-sheet.mjs`: it pauses the live body in idle, a heavy
  strike (`skill02-03`) and the signature sweep (`skill07-02`), shoots each from the front and left
  side, and composes `artifacts/iron-spider/arm-pose-sheet.png`. 8/8 checks, no page errors.
- Added `scripts/verify-iron-spider-match-matrix.mjs`: **22/22 checks** across Spider-Man, Superman,
  Goku and Master Chief. Each match earns two real signature KOs and reaches
  **VICTORY · IRON SPIDER**; captures are under `artifacts/iron-spider/matrix/` with the summary
  `matrix-sheet.png` and report `report.json`.

## Session 2026-11-11 — Playwright installed; Iron Spider browser E2E green

- Playwright **1.65.0** is installed in this runner (extraneous: `--no-save --package-lock=false`, so
  `package.json` and the lockfile are untouched) with Chromium **158.0.8127.18** (build 1254) and
  its system libraries, so the browser suites can run here.
- `npm run test:iron-spider` → **44/44 checks, exit 0**. Log: `artifacts/iron-spider-e2e.log`.
- Three explicit arm-acceptance checks were added after reproducing the repair from the preserved
  pre-repair runtime (byte-identical SHA-256 to production): all 1,110 arm vertices are dominantly
  weighted to the native spider-leg chain with 0 unweighted, idle arm world bounds are
  1.107 × 1.184 × 0.777 m instead of the authored 45.4 × 51.5 × 57.5 m, and a sampled spider-leg bone
  rotates during `skill07-02` while the arm stays under `Object_5`.
- The run contains a complete best-of-three match that reaches the result screen:
  **VICTORY · IRON SPIDER, rounds 2–0**. The rounds come from the harness's deterministic KOs, not
  human play.
- Captures: `artifacts/iron-spider-{select,roster,idle,run,jump,attack,special,knockout,raised-stage,player2,match-complete}.png`
  and the 11-tile contact sheet `artifacts/iron-spider-captures.png`.
- Two runtime defects had to be fixed to get there: the Three r152 `BufferAttribute.getComponent`
  call that aborted P1's model mount (replaced with `getX/getY/getZ/getW` in
  `public/js/human_fighter.js`), and the test's title-screen entry, which now clicks the VERSUS
  control before selecting cards. The signature damage sample moved to 0.28 s because the repaired
  native arm has no procedural leg-tip contacts, so damage resolves through the shockwave.
- Still open: full 57-clip visual matrix, all-roster matches, an arm-specific pose sheet, and a
  native-arm combat contact layer. The Node inspector still exits nonzero on 371 open boundary
  edges (source 352). No commit, push, reset, clean, stash or amend was performed.

## Session 2026-11-11 — Vegeta, T-800, Harry and Light accepted in real matches

All four remaining imported migrations were selected through the real character-select path and
driven in real matches with keyboard input. Each target passed **13/13** checks, exit 0, under
`bash scripts/run-browser-test.sh scripts/verify-imported-migrations.mjs`.

| Target | Body / clips | Equipment | Jab | Signature | HUD |
| --- | --- | --- | ---: | --- | --- |
| Vegeta | Ultra Ego / 25 | hands free | 11.3% | GALICK GUN · 22 | VEGETA |
| Light Yagami | imported Light rig / 25 | Light · Death Note | 7.3% | NAME IN THE NOTEBOOK · 8 | LIGHT YAGAMI |
| Harry Potter | imported Harry rig / 25 | Harry · Wand | 9.2% | EXPECTO PATRONUM · 20 | HARRY POTTER |
| T-800 | T-800 endoskeleton / 25 | T-800 · heavy shotgun | 26.9% | CYBERNETIC CANNON · 19 | T-800 |

Each also passed idle, keyboard walk, keyboard jump, `hit_light`, its own moveset key, and a 25/25
clip sweep with every clip moving at least 19 bones. Signatures were checked through the live
projectile/beam/curse state and opponent damage, not labels.

Runtime fixes made in this pass:

- The live HUD now reads `fighter.displayName` before the stable identity; `loading`, cinematic
  plates and the floating chips therefore show the player-facing names.
- The T-800 display alias is `T-800`; the stable `arnold_schwarzenegger` key and save are unchanged.
- Vegeta's oversized energy-gauntlet prefab was removed: his hands are free, matching his ki moves.
- Light's and Harry's prefabs were scaled to hand size (book and wand instead of body-sized props).
- The harness reads the imported bodies' `model.userData.currentClip` / `lastMoveAction` because
  these bodies use the legacy mixer, not `animationController`.

Regression gates: roster models **38/38**, character scale **37/37**, equipment **30/30**,
animation pipeline **263**, solo-rig lanes **134/134 body clips**, movesets **91/91**,
`validate:assets` passed, `build` passed. Evidence and source limitations are recorded in
`docs/IMPORTED_MIGRATIONS_ACCEPTANCE.md`.

No showcase-world reconstruction was started. No commit, push, reset, clean, stash or amend was
performed.
