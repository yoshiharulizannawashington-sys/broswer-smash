# Browser Bros — Combat Test Matrix

Every row is a test that was actually executed, or is explicitly marked as not run. Commands were
run from the repository root on 2026-10-25 on branch `work/gameplay-and-polish` (uncommitted).

```
source <(bash scripts/setup-browser-libs.sh --env)   # Chromium's shared libs, no root
npm run build
npm run test:mechanics    # 74 assertions (Phase 1 + 2)
npm run test:combat       # 394 checks
npm run test:gameplay     # 48 checks
npm run test:explore      # 49 assertions
```

Status legend: **PASS** · **FAIL** · **PARTIAL** · **NOT RUN** · **NOT IMPLEMENTED** ·
**BLOCKED BY MISSING ASSET**.

---

## 1. Frame data, move ids and cancels (pure, `test:mechanics`)

| # | Test | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| M1 | Frame timing stored in 60 Hz frames, converted once | total == frames×1/60 | exact | PASS |
| M2 | Startup < active < total | monotonic | 0.0667 / 0.2 / 0.35 s | PASS |
| M3 | Active window equals the active-frame count | 8 frames | 0.1333 s | PASS |
| M4 | One attack instance starts unhit | `hit === false` | false | PASS |
| M5 | Move ids resolve from context | dive / airFinisher / finisher / antiAir / counter / light1 / light2 / heavy | all 8 correct | PASS |
| M6 | Cancel table allows light→light, not finisher→jab | true/false | matched | PASS |
| M7 | Air chains into air finisher, nothing leaves it | true/false | matched | PASS |
| M8 | Only heavy/finisher/counter/air-finisher are armoured | 4 moves | matched | PASS |
| M9 | Grab has hold + escape + cooldown values | all > 0 | 0.2 / 0.2 / 0.45 s | PASS |

## 2. Combos (pure)

| # | Test | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| C1 | Damage scaling per hit and cap | 1 → 0.93 → cap 0.76 | matched | PASS |
| C2 | Chain wraps after 3 hits / window closed resets | 1,2,3→1 | matched | PASS |
| C3 | Closed window restarts hit count | 3→1, open → 4 | matched | PASS |
| C4 | Juggle limit blocks the 5th air hit | limitReached | true | PASS |
| C5 | Air hitstun shortens with juggle count | declining, floor 0.55 | matched | PASS |

## 3. States, armour and reactions (pure)

| # | Test | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| S1 | idle / walk / run / jump | 4 states | matched | PASS |
| S2 | hit outranks a stale attack; launch outranks hit | hitstun, launched | matched | PASS |
| S3 | guard-break, grabbed, ko precedence | matched | matched | PASS |
| S4 | Attack phases come from move data | startup/active/recovery | matched | PASS |
| S5 | Armour only inside armour frames | heavy yes, jab no | matched | PASS |
| S6 | Armoured hit: reduced stun/knockback, damage kept | stun < 0.1, kb < 3, launch 0 | matched | PASS |
| S7 | Juggle-exhausted reaction is a spike | launch < 0 | −6.4 | PASS |

## 4. Swept projectile collision (pure)

| # | Test | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| P1 | Segment hits a target its end point jumped past | true (end 5 m away) | true | PASS |
| P2 | Segment misses an off-line target | false | false | PASS |
| P3 | Starting inside the sphere | true | true | PASS |
| P4 | Segment through a solid volume | true, and false when short | matched | PASS |

## 5. Shield and defence (pure + browser)

| # | Test | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| D1 | Hold drain, regen, cap, broken-at-zero | documented rates | matched | PASS |
| D2 | Heavy blocked hit costs more than light | heavy > light | 34.2 vs 24.9 | PASS |
| D3 | Minimum blocked-hit cost | ≥ 6 | 6 | PASS |
| D4 | Break when shield empties | broke, shield 0 | matched | PASS |
| D5 | Guarding cuts damage, spends shield | < 50%, shield < 100 | 28%, 76 | PASS |
| D6 | Repeated blocked hits break the guard | break fires, shield 0 | 1.15 s break | PASS |
| D7 | Broken guard cannot be held | false | false | PASS |
| D8 | Shield returns after a break | regen > 0 | 22 → 61 | PASS |
| D9 | Shield input raises guard and drains it | held, drained | matched | PASS |
| D10 | Hit inside dodge i-frames misses | 0 damage | 0 | PASS |
| D11 | Same hit after the window lands | > 0 | 11.3% | PASS |
| D12 | Directional block cone | frontal only | — | NOT IMPLEMENTED |

## 6. Grabs and throws (browser)

| # | Test | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| G1 | UP grab holds then throws upward | hold, aim up, vy > 8, damage | 12.6 m/s, 16% | PASS |
| G2 | DOWN grab spikes | aim down, vy < 0 | −9.4 m/s | PASS |
| G3 | Neutral grab throws forward | |vx| > 4 | 6.4 m/s | PASS |
| G4 | Struggle during the hold escapes | no throw, no damage, cooldown | matched | PASS |
| G5 | Grab range / guard-blocked grab | overlap only | covered by hitbox test | PARTIAL (no explicit out-of-range grab test) |
| G6 | Grab released on KO/round end | cleared | round-end cleanup tested | PASS |

## 7. Attacks, cover, trades and combos (browser, real `Fighter3D`)

| # | Test | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| A1 | In-range attack lands through the input path | damage > 0 | 9% | PASS |
| A2 | Landed attack produces knockback | > 0 | matched | PASS |
| A3 | Same attack at 6 m misses | 0 | 0 | PASS |
| A4 | Jab sets its move id | `light1` | matched | PASS |
| A5 | Second press in recovery chains to `light2` | queue + step 2 | matched | PASS |
| A6 | Chain is hit-confirmed (counter grows only on hits) | hits 2, damage up | matched | PASS |
| A7 | Armoured heavy keeps its attack, reduced hitstun | queue intact, stun lower | matched | PASS |
| A8 | Juggle limit spikes the airborne target | vy < 0 | matched | PASS |
| A9 | Two fighters attacking on the same frame trade | both damaged | matched | PASS |
| A10 | Fifth combo hit is weaker than the first | < 85% | matched | PASS |
| A11 | Melee does not reach through a wall | blocked across 0.6 m | 0 damage | PASS |
| A12 | Same swing connects on the same side | > 0 | matched | PASS |
| A13 | Attacks through thin railings/corners | approximate | line sample | PARTIAL |

## 8. Movement, flight and world collision (browser)

| # | Test | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| F1 | Flight toggles on | true | true | PASS |
| F2 | Ascend climbs | y > 2 | matched | PASS |
| F3 | State reports `flight` | `flight` | matched | PASS |
| F4 | Hover is stable without input | vy < 0.6, drift < 0.3 m | 0.27 m | PASS |
| F5 | Releasing flight lands | grounded at y ≤ 0.01 | matched | PASS |
| F6 | Fighter placed inside a wall is ejected | outside volume | matched | PASS |
| F7 | Flight into a wall with the stick held | no penetration | — | PARTIAL (covered by F6 + arena collision checks, not scripted as a flight input) |
| F8 | Walk/run/jump/land on two real maps | working | `test:gameplay`, `test:explore`, mechanics on Valley + Death Star | PASS |

## 9. Projectiles and invulnerability (browser)

| # | Test | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| R1 | Wall in line of fire detected | clear spawn, solid ahead | matched (Death Star) | PASS |
| R2 | Shot destroyed by geometry | live +1 then removed | 1 → 0 | PASS |
| R3 | Invulnerable fighter not damaged by a shot | 0 damage | 0 | PASS |
| R4 | Same shot lands after the window | > 0 | matched | PASS |
| R5 | Round end clears shots, hitboxes, queues | all zero | matched | PASS |
| R6 | Low-frame-rate projectile tunnelling | swept hit | unit-tested sweep | PASS (unit) / PARTIAL (no forced large-dt browser test) |
| R7 | Beam damage matches the drawn beam | equal | shorter volume | PARTIAL |

## 10. Debug tooling (browser)

| # | Test | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| X1 | Overlay off by default | 0 objects | 0 | PASS |
| X2 | Overlay draws hurtboxes + every live hitbox | drawn ≥ 2 + hitboxes | matched | PASS |
| X3 | Overlay off hides everything | hidden | matched | PASS |
| X4 | Readout prints state, move, shield, i-frames | all present | matched | PASS |
| X5 | Readout hidden when disabled | hidden | matched | PASS |
| X6 | F3 keyboard toggle | works | inspected in code; `F3` handler present | PARTIAL (not key-pressed in test) |

## 11. HUD, input, rounds

| # | Test | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| H1 | Shield bar tracks the live value | 42% | `42%` | PASS |
| H2 | Keyboard P2 controls (arrows, `,`, `;`) | all respond | matched | PASS |
| H3 | Gamepad maps attack/special/jump/guard/grab + stick for both pads | all true | matched with a synthetic pad | PASS (synthetic) |
| H4 | Physical controller on real hardware | works | — | NOT RUN |
| H5 | Pause menu / remapping UI | exists | none | NOT IMPLEMENTED |
| H6 | Round end cleanup (attacks, hitboxes, shots) | zero | zero | PASS |
| H7 | KO as a first-class state | `ko` set by round end | round machinery only | PARTIAL |
| H8 | Full rematch cycle with no stale state | no leaks | rematch not automated this pass | NOT RUN |

## 12. Regression suites

| Command | Result |
| --- | --- |
| `npm run build` | PASS (3.38 s) |
| `npm run test:combat` | PASS — 394 checks |
| `npm run test:gameplay` | PASS — 48 checks |
| `npm run test:explore` | PASS — 49 assertions |
| `npm run test:mechanics` | PASS — 74 assertions |
| `npm run test:worlds` | PASS — 47,329 assertions across 60 battle locations (block counts unchanged) |
| `npm run test:worlds:browser` | NOT RUN this pass (818-check suite, skipped) |
| `npm run test:smoke` | NOT RUN this pass |
| `npm run audit:roster` | NOT RUN this pass |
| `npm run validate:assets` | NOT RUN this pass |

## 13. Not implemented / blocked

| Feature | Status | Reason |
| --- | --- | --- |
| Rigged Goku / Iron Man animation | BLOCKED BY MISSING ASSET | source packages absent, manifest entries disabled |
| Iron Spider mechanical-leg attacks | NOT IMPLEMENTED | no rigged leg controller; keeping the legs decorative rather than faking attacks |
| Directional guard cone | NOT IMPLEMENTED | guard is omnidirectional, documented |
| Armour-break move | NOT IMPLEMENTED | armour limited to four moves |
| Grab struggle meter | NOT IMPLEMENTED | single-input escape inside 0.2 s |
| Combat audio | NOT IMPLEMENTED | the project has no audio system at all |
| Beam hitbox matching visual length | PARTIAL | sphere along travel, shorter than the beam |
| Pause / remap UI | NOT IMPLEMENTED | no such menu exists |
| Manual visual play-test of Phase 2 | NOT RUN | only headless Chromium this pass |

---

# Phase 3 — movesets, transformations, ultimates

Suite: `npm run test:movesets` → **74 checks passed**. Everything marked PASS below was asserted by
that suite (pure data checks, or the live game in headless Chromium) unless stated otherwise.

## 14. Roster and moveset data

| # | Test | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| R1 | Launch roster size | 33 selectable | 33 parsed from `main.js` | PASS |
| R2 | Every selectable fighter has a moveset | 33/33 | 33/33 | PASS |
| R3 | No movesets outside the roster | 0 | 0 | PASS |
| R4 | Display-name lookup resolves | all 33 | all 33 | PASS |
| R5 | Each moveset: 3 lights, 2 heavies, 1 aerial, style line | complete | complete | PASS |
| R6 | Each form: id/label/aura/colour/duration/cost/drain/cooldown/mods/empowered special | complete | complete | PASS |
| R7 | Each ultimate: label, implemented behaviour, positive damage, recovery, note | complete | complete | PASS |
| R8 | 33 distinct form ids | 33 | 33 | PASS |
| R9 | Forms are visually distinct | ≥6 aura silhouettes, ≥20 colours | 9 aura types, 33 colours | PASS |
| R10 | Ultimates spread across behaviours | ≥6 | 7 (`beam`,`rush`,`slam`,`storm`,`zone`,`grab`,`barrage`) | PASS |
| R11 | No ultimate one-shots a fresh fighter | 0 lethal | 0 | PASS |
| R12 | Heaviest single ultimate hit under half the round limit | < 75 | 40 | PASS |

## 15. Transformation rules

| # | Test | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| T1 | Refuses without enough power | refuse | `not-ready` | PASS |
| T2 | Refuses in hitstun | refuse | `locked` | PASS |
| T3 | Refuses during cooldown | refuse | `cooldown` | PASS |
| T4 | Refuses a second activation while active | refuse | `active` | PASS |
| T5 | Activation spends power once | 100 − cost | 56 (cost 44) | PASS |
| T6 | Applies real stat mods | `incomingDamage` = form defence, `transformMods` live | 1.08 / damage 1.18 | PASS |
| T7 | Swaps the signature move | KAMEHAMEHA → KAMEHAMEHA · KAIOKEN | yes | PASS |
| T8 | HUD snapshot counts down | active, remaining > 0 | yes | PASS |
| T9 | Drain ends the form early | ends | ends | PASS |
| T10 | Expiry ends the form on its own duration | ends at 8 s | ends | PASS |
| T11 | Ending restores defence and base move | 1 / KAMEHAMEHA | yes | PASS |
| T12 | Ending starts a cooldown | > 0 | 9.6 s | PASS |
| T13 | Power is clamped | ≤ 100 | ≤ 100 | PASS |
| T14 | Power earned from damage both ways | > 0 | yes | PASS |
| T15 | Aura is the character's own form | name contains form id | `aura:kaioken` | PASS |
| T16 | Aura removed on reset | `null` | `null` | PASS |
| T17 | Empowered signature damages through the projectile pipeline | percent rises | rises | PASS |

## 16. Ultimate meter, activation and delivery

| # | Test | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| U1 | Meter fills from damage dealt | larger hit → more meter | yes | PASS |
| U2 | Taking damage builds meter | > 0 | yes | PASS |
| U3 | Empty meter refuses | `not-ready` | `not-ready` | PASS |
| U4 | Casting spends the whole meter once | 100 → 0 | 0 | PASS |
| U5 | Repeated cast cannot run twice | `active` | `active` | PASS |
| U6 | Caster is locked into the move | `casting = 'ultimate'` | yes | PASS |
| U7 | Refuses while stunned | refuse | yes | PASS |
| U8 | Refuses while grabbed | refuse | yes | PASS |
| U9 | Ultimate lands real damage | percent rises | rises | PASS |
| U10 | Caster regains control when it ends | `casting = null` | null | PASS |
| U11 | Interrupted before connecting refunds the meter | 100 back | 100 | PASS |
| U12 | Interrupted ultimate deals no damage | 0 | 0 | PASS |
| U13 | A wall between fighters blocks the ultimate | `landed:false`, 0 damage | yes (Death Star block) | PASS |
| U14 | Cover is detected by the wall query | true | true | PASS |
| U15 | An ultimate does not feed its own meter | caster unchanged | unchanged (victim still earns) | PASS |
| U16 | Transformed variant changes label, damage and colour | all three | yes | PASS |
| U17 | All 33 fighters cast in the live game | 33/33 | 33/33 | PASS |
| U18 | All 33 ultimate labels distinct | 33 | 33 | PASS |

## 17. HUD, input and cleanup

| # | Test | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| P1 | Ultimate meter and form gauge exist in the HUD | two rows | `ult`, `form` | PASS |
| P2 | HUD names both resources | ULT / FORM | yes | PASS |
| P3 | Both fighters report their own ultimate | Goku vs Vegeta labels | yes | PASS |
| P4 | Empty meter shows not ready | false | false | PASS |
| P5 | Form cost shown in the snapshot | 44 | 44 | PASS |
| P6 | `I` transforms P1 | true | true | PASS |
| P7 | `O` casts P1 | true | true | PASS |
| P8 | P1 keys do not leak to P2 | false | false | PASS |
| P9 | `N` / `M` are P2 transform / ultimate | true / true | true / true | PASS |
| P10 | Gamepad D-pad up / down bind transform / ultimate | true / true | true / true | PASS |
| P11 | Round reset ends the form and removes the aura | cleared | cleared | PASS |
| P12 | Round reset releases the caster, clears form power | cleared | cleared | PASS |
| P13 | Round reset keeps earned ultimate meter | 60 | 60 | PASS |
| P14 | Rematch clears the meter | 0 | 0 | PASS |
| P15 | Debug overlay shows meter / power / form | lines present | present (code + no page errors) | PASS |
| P16 | Select-screen move list renders | no page error | no page error | PASS |
| P17 | No page errors during the whole suite | 0 | 0 | PASS |

## 18. Regression suites after Phase 3

| Command | Result |
| --- | --- |
| `npm run test:movesets` | PASS — 74 checks |
| `npm run test:mechanics` | PASS — 74 assertions |
| `npm run test:combat` | PASS — 394 checks |
| `npm run test:gameplay` | PASS — 48 checks |
| `npm run test:explore` | PASS — 49 assertions |
| `npm run test:worlds` | PASS — 47,329 assertions across 60 battle locations |
| `node scripts/test-stage-feel.mjs` | PASS — 138 checks across 4 stages (run before the final meter tweak; mechanics + movesets were re-run after) |
| `node scripts/test-rig.mjs` | PASS — 31/31 |
| `node scripts/test-iron-spider.mjs` | PASS — 33 checks |
| `npm run build` | PASS — 51 modules, 1,278 kB |
| `npm run test:worlds:browser` | NOT RUN this pass |
| `npm run test:smoke` | NOT RUN this pass |
| `npm run audit:roster` | NOT RUN this pass |
| `npm run validate:assets` | NOT RUN this pass |

## 19. Not implemented / blocked after Phase 3

| Feature | Status | Reason |
| --- | --- | --- |
| Per-character attack, form and ultimate animation | BLOCKED BY MISSING ASSET | no clip packages; 39 procedural clips only |
| Transformation model / material change | PARTIAL | generated aura per form, no model swap |
| 33 bespoke ultimate choreographies | PARTIAL | 7 shared, fully implemented behaviours |
| Cinematic ultimate camera | NOT IMPLEMENTED | camera shake only |
| Iron Spider articulated legs in combat | NOT IMPLEMENTED | legs are effect geometry |
| Directional specials | NOT IMPLEMENTED | one neutral special per fighter |
| Ultimate/form audio | NOT IMPLEMENTED | no audio system |
| Tactical CPU ultimate choice | PARTIAL | probability + range gated |
| Human visual check of HUD gauges and move list | NOT RUN | headless Chromium only |
| Balance play-test across a full match | NOT RUN | values reasoned, not tuned by play |

## 14. Phase 3 — startup fix and readability

| ID | Test | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| P1 | Boot the dev server, enter free roam, start a match, fire a form and an ultimate | no page errors, live HUD | zero page errors, zero console errors, `p1power` present | PASS |
| P2 | Hit a target inside an invulnerability window | no damage, `EVADED` callout | `false`, 0 damage, callout emitted, no hit-stop | PASS |
| P3 | Land an ultimate hit | exactly one hit-stop request, damage applied | 1 request, damage applied | PASS |
| P4 | Cast a beam ultimate and inspect the drawn beam | radius = `width × 0.42` | matches for Goku (`width` 2.8 → 1.176) | PASS |
| P5 | Beam startup vs active frames | aim line visible while charging, hidden when firing; beam hidden until active | as expected | PASS |
| P6 | Transform and read the HUD | FORM row `ON`, panel marked, cleared after reset | as expected | PASS |
| P7 | World/arena registry after the cache-token change | 70 layouts, 47,329 assertions | 70 layouts, all pass | PASS |
| P8 | Human visual review of the new telegraphs, halos and HUD tint | reads correctly on a real display | not performed — needs you | BROWSER TEST NEEDED |

Commands run for this pass:

| Command | Result |
| --- | --- |
| `npm run build` | PASS (4.06 s) |
| `npm run test:movesets` | PASS — 79 checks |
| `bash scripts/run-browser-test.sh scripts/test-mechanics.mjs` | PASS — 74 assertions |
| `bash scripts/run-browser-test.sh scripts/test-gameplay.mjs` | PASS — 48 checks |
| `bash scripts/run-browser-test.sh scripts/test-explore.mjs` | PASS — 49 assertions |
| `npm run test:combat` | PASS — 394 checks |
| `npm run test:worlds` | PASS — 47,329 assertions, 60 battle locations |
| `npm run validate:assets` | PASS — fallbacks confirmed for goku / iron_man / iron_spider |
| `bash scripts/run-browser-test.sh scripts/probe-boot.mjs` | PASS — no errors through boot, free roam, match, form and ultimate |

## 15. Phase 4 — fighters, transformations and animation

| ID | Test | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| Q1 | Fixture GLB loads through `GLTFLoader` | one skinned mesh, 11 bones in the scene, 2 clips | 1 / 11 / `Idle,Punch` | PASS |
| Q2 | `resolveRig()` on a real skeleton | `kind: bone`, all 11 canonical bones, no gaps | `bone`, 11 bound, `missing: []` | PASS |
| Q3 | `retargetClip()` on an external clip | tracks rewritten to `bs_*`, root motion dropped | 2 quaternion tracks, 0 position tracks | PASS |
| Q4 | 39-clip library compiles onto the imported rig | 39 clips | 39 | PASS |
| Q5 | Mixer drives bones | joint rotation changes with playback | 0.05 rad+ per step | PASS |
| Q6 | Attack clip retimed to the move | strike peak on the active window | retimed, `retimes > 0` | PASS |
| Q7 | Hitstun vs attack clip priority | hit clip owns the body, then releases | `hit_heavy` held, then airborne clip | PASS |
| Q8 | Model with no skeleton | clip layer refuses, no throw | `attachAnimation()` → `null` | PASS |
| Q9 | Iron Spider leg rig | 4 legs × 3 joints on the body, 12 joints | 12 joints, only Iron Spider | PASS |
| Q10 | Sweep drives the legs | `strike` pose, tips further out | 1.19 m → 1.45 m horizontal reach | PASS |
| Q11 | Legs return to rest | not striking, tips pulled in | `idle`, tips in | PASS |
| Q12 | Guard / hitstun / flight / fall poses | four distinct poses | guard, stagger, flight, land | PASS |
| Q13 | Leg-tip hit test in the browser | adjacent target damaged once | damage applied, one hit per sweep | PASS |
| Q14 | Legs belong to the fighter | parent is the model, no VFX leg meshes | as expected, 0 VFX legs | PASS |
| Q15 | Goku form look | hair gold/red, emissive, scale change | colour + intensity + scale changed | PASS |
| Q16 | Iron Man form look | reactor white-hot, then restored | 0xe8feff / 3.4, restored | PASS |
| Q17 | Iron Spider form look | appendage materials heat, then restore | as expected | PASS |
| Q18 | Form restore on expiry | colour, intensity and scale exactly restored | bit-identical | PASS |
| Q19 | Form with no `look` | leaves the body untouched | `applied: false` | PASS |
| Q20 | Form `look` keys | only known surface tags | 4 forms, all valid | PASS |
| Q21 | Character manifest | all three rigged entries stay disabled | `false`, `false`, `false` | PASS |
| Q22 | Audio engine | synthesises, throttles, never throws, mute persists | `describe()` reports plays/drops | IMPLEMENTED — BROWSER TEST NEEDED |
| Q23 | Audio audibility on real speakers | impacts/forms/ultimates audible and balanced | headless runs muted | BROWSER TEST NEEDED |
| Q24 | Rigged Goku / Iron Man / Iron Spider render | real model in the arena | files absent | BLOCKED BY MISSING ASSET |
| Q25 | Leg strike pose under a real Iron Spider rig | clip-driven legs | no rigged asset | BLOCKED BY MISSING ASSET |

Commands run for this pass:

| Command | Result |
| --- | --- |
| `npm run build` | PASS (4.19 s) |
| `npm run test:animation` | PASS — 63 checks (new) |
| `bash scripts/run-browser-test.sh scripts/test-iron-spider.mjs` | PASS — 37 checks (leg assertions rewritten) |
| `npm run test:movesets` | PASS — 79 checks |
| `bash scripts/run-browser-test.sh scripts/test-mechanics.mjs` | PASS — 74 assertions |
| `bash scripts/run-browser-test.sh scripts/test-gameplay.mjs` | PASS — 48 checks |
| `bash scripts/run-browser-test.sh scripts/test-explore.mjs` | PASS — 49 assertions |
| `bash scripts/run-browser-test.sh scripts/probe-boot.mjs` | PASS — zero page/console errors through boot, roam, match, form, ultimate |
| `npm run test:combat` | PASS — 394 checks |
| `npm run test:worlds` | PASS — 47,329 assertions over 60 battle locations |
| `npm run validate:assets` | PASS — 3 optional assets missing, fallbacks confirmed |
| `npm run test:worlds:browser` | NOT RUN this pass |
| `npm run test:smoke` | NOT RUN this pass |
| `npm run audit:roster` | NOT RUN this pass |
| `npm run validate:animations` | NOT RUN this pass |
