# Browser Bros — Combat System Report

Status of the fighting mechanics after the Phase 1 (defence/projectiles), Phase 2 (state model,
frame data, combos, grabs, cover, swept collision) and Phase 3 (per-character movesets,
transformations, ultimates) passes. Every claim below was checked by the command named next to it
or by inspecting the running code; nothing is listed as working because it "looks right".

Section 18 onwards covers Phase 3; `CHARACTER_MOVESET_AUDIT.md` (repository root) is the
per-character roster and move list.

Last updated: 2026-10-26 · branch `work/gameplay-and-polish` · **changes are uncommitted** in the
working tree (all three passes).

Status labels: **IMPLEMENTED AND TESTED** · **IMPLEMENTED — BROWSER TEST NEEDED** (needs a human
look or a physical device) · **PARTIAL** · **NOT IMPLEMENTED** · **BLOCKED BY MISSING ASSET**.

---

## 1. What exists now, by subsystem

| Area | File | Status |
| --- | --- | --- |
| Fighter movement, attacks, hitboxes, guard, grabs, flight | `public/js/fighter3D.js` | IMPLEMENTED AND TESTED |
| Frame-based move table and cancel table | `public/js/combat/move_data.js` | IMPLEMENTED AND TESTED |
| Canonical states, armour, reaction rules | `public/js/combat/fighter_state.js` | IMPLEMENTED AND TESTED |
| Combo scaling, chain wrapping, juggle limit | `public/js/combat/combo.js` | IMPLEMENTED AND TESTED |
| Swept projectile collision | `public/js/combat/projectile_hit.js` | IMPLEMENTED AND TESTED |
| Damage/knockback/hitstun/shield/matches | `public/js/combat/combat_rules.js` | IMPLEMENTED AND TESTED |
| Hitbox/hurtbox overlay + text readout | `public/js/combat/combat_debug.js` | IMPLEMENTED AND TESTED |
| Solid volumes, ground, cover test | `public/js/world/arena_layouts.js` | IMPLEMENTED AND TESTED |
| Keyboard + gamepad input, buffering | `public/js/smash_input.js` | IMPLEMENTED AND TESTED (fake pad, not a physical controller) |
| Projectiles, specials, rounds, HUD | `public/js/main.js` | IMPLEMENTED AND TESTED |

The six worlds, 60 battle locations, free roam, doorway travel, spawns and the duel camera were
not modified. `test:explore` (49) and `test:gameplay` (48) pass unchanged.

## 2. Combat state model

`fighter_state.js` derives a single canonical `state` from the timers the simulation already
owns, and every fighter now carries `fighter.state` plus `fighter.activeMoveId`. The precedence is
deliberate and tested:

```
ko > grabbed > hitstun/launched > guard-broken > dodge > attack-startup/active/recovery
   > block > flight > jump/fall > dash > run > walk > idle
```

- **Attack phases come from move data**, not from animation playback: a resurrected animation
  cannot create or cancel a hit window.
- **A hit outranks the interrupted attack**, so `stateOf` reports `hitstun` even while a stale
  queue entry is still ticking down.
- **Hard locks**: `canAct()` is false during hitstun, a grab hold, a guard break and a KO. The
  simulation already gated inputs on hitstun/guard break; the helper names the rule so the tests
  and the HUD agree.
- **Armour** is limited to four moves — heavy, the 3-hit finisher, the counter strike and the air
  finisher — and only inside their active frames. An armoured target still takes the damage; it
  loses most of the hitstun and 70% of the knockback instead of being interrupted. A light hit
  (under 18 base damage) is what armour is allowed to eat.
- **KO**: `stateOf` supports a `ko` flag, and round end already clears queues, hitboxes and shots
  in flight, but `main.js` does not set `fighter.ko` today — the round machinery is the actual KO
  path. **PARTIAL**, and stated as such.

There is still no formal transition table that rejects an invalid assignment; the state is
derived, and the rules live in the timers plus `canCancel`. This is the honest shape of it.

## 3. Frame-based move data

`move_data.js` holds the move table once, in 60 Hz frames, with a single conversion
(`seconds(frames)`); the simulation runs a fixed 1/60 s step, so combat timing does not drift with
render rate.

| Move | Frames (startup/active/recovery) | Damage | Reach | Notes |
| --- | --- | --- | --- | --- |
| `light1` jab | 4 / 8 / 9 | 9 × style | archetype | chain step 1 |
| `light2` | 4 / 8 / 9 | 10 × style | archetype | chain step 2 |
| `finisher` | 9 / 10 / 14 | 20 × style | ×1.42 | launcher, armour |
| `heavy` | 9 / 10 / 14 | 17 × style | archetype | armour, hitstop |
| `antiAir` | 4 / 8 / 9 | 9 × style | archetype | launch 10.4 |
| `air` | 5 / 14 / 7 | 10.1 × style | 4.6 m | airborne |
| `airFinisher` | 5 / 19 / 9 | 22.4 × style | 6.0 m | armour, launch 11.2 |
| `dive` | 5 / 14 / 7 | 10.1 × style | 4.6 m | drives attacker down |
| `counter` | 2 / 18 / 13 | 12.8 × style | ×1.35 | from a parry |
| `grab` | 6 / 10 / 13 | 16 | 1.45 m | 0.2 s hold, escape window |

Frame counts are multiplied by the archetype's `windup` and the character's `startup` profile, so
a ninja's jab is faster than a brawler's without duplicating the table.

**Cancel table** (`CANCELS`): recovery frames of a move may be cancelled into the documented
follow-up only — `light1 → light2/heavy/finisher/antiAir/grab`, `light2 → finisher/heavy/antiAir/grab`,
`air → airFinisher/air/dive`, `finisher`/`heavy`/`grab` cannot be cancelled back into a jab. A
queued attack outside that table waits for the current move to finish. This is tested both as a
pure table and through real input.

**Per-character move profiles** (timing/reach/knockback only): Goku 0.88 startup / 1.04 reach,
Vegeta 0.92, Iron Man 1.04 startup / 1.03 reach, Iron Spider 0.94 / 1.06, Spider-Man 0.9 / 1.08,
Flash 0.7 / 0.96, Hulk 1.22 / 1.05 / 1.2 knockback, Saitama 0.8 / 1.02 / 1.15, Superman 1.02 /
1.08 knockback, Naruto 0.86. Damage stays in `COMBAT_PROFILES` and the special tables so nothing is
multiplied twice.

## 4. Combos

`combo.js` owns the numbers; the fighter owns the counters.

- Combo window 0.82 s, chain wraps after 3 grounded hits.
- Damage scaling −7% per hit past the first, capped at −24% (the 5th hit is the first fully
  scaled one).
- Air juggle limit: the 5th air hit on a target is a **spike** (`velocity.y = −6.4`) instead of a
  float, and air hitstun shrinks with each juggle hit (×0.82, then −0.06 per hit, floor 0.55).
  That is the anti-infinite rule, and it is tested by exceeding the limit.
- The combo counter only grows on a confirmed hit (`afterHit` is called from the hit resolver,
  after block/invulnerability/cover checks), so mashing does not build a combo against air.
- Air attacks chase a launched target 1.6–14 m away, which is what lets a launcher actually be
  followed up.

Damage scaling and the chain are tested in the browser; an automated ground→air→finisher route is
**not** scripted end to end, only its pieces.

## 5. Blocking, guard break, parry

Unchanged from Phase 1 and still tested: shield 100, 11/s held drain, per-hit cost scaled by
damage and knockback, 26/s regen after 0.55 s, 1.15 s guard break, 22 shield on recovery, 0.14 s
block stun that no longer sets `guardBreak`.

- Guarding requires shield > 0; a broken guard cannot be held (tested).
- Blocked damage 28%, knockback 25%; guard is **omnidirectional** — there is no frontal cone.
  **NOT IMPLEMENTED** as directional blocking, and documented rather than faked.
- Parry: tap E, 0.22 s window, 0.32 s cooldown, 1.2 s counter window at ×1.42, reflects
  projectiles. **IMPLEMENTED**, exercised indirectly (counter move exists and is in the move table);
  the parry timing itself is not separately scripted in the test suite.

## 6. Dodging

- i-frames start immediately, last 0.20 s of a 0.48 s dodge (0.62 s in free roam), then 0.4 s
  before the next dodge. There is no dodge startup, so a dodge is a commitment in duration, not a
  delayed i-frame window. Documented as the chosen rule.
- One air dodge per airtime, reset on landing.
- A hit inside the window misses; the same hit after it lands — both asserted in the browser.
- Dodging cannot put a fighter inside a wall: movement still runs through the stage's solid
  volumes, and the test places a fighter inside a wall and asserts the real loop ejects it.

## 7. Grabs and throws

New in this pass: a grab is a **held interaction**, not an instant teleport.

1. Grab connects → `beginThrow` holds the victim for 0.2 s and records the aim.
2. During the 0.2 s escape window, attack / dodge / jump on the victim releases the hold
   (`escapeGrab`), puts the grabber on a 0.45 s cooldown and gives the victim 0.18 s of
   invulnerability.
3. Otherwise `releaseThrow` applies 16% damage and the aimed arc: up 12.6 m/s, down −9.4 m/s,
   forward 6.4 m/s out + 9.4 up.
4. The throw is also dropped if the grabber is hit by a projectile (`dropGrab`), and round end
   clears both sides' grab state.

Both fighters are always released; there is no persistent attachment, which is what made the old
implementation safe and stays true here. A guarded grab does not hold: 28% damage plus shield cost.
Tests cover up/down/forward, the hold, the escape, and the attacker's cooldown.

## 8. Movement, cover and world interaction

- Ground/air movement, sprint, jump/double jump (triple in free roam), dash and stage bounds are
  unchanged and still pass `test:gameplay` and `test:explore`.
- **Cover**: a melee or grab no longer reaches through a wall. The resolver samples the line
  between the two chests against the stage's solid volumes (`solidBetween`) and reports
  `BLOCKED BY COVER`. Tested on the Death Star: blocked across a 0.6 m wall, hitting on the same
  side at the same 1.2 m gap.
- Cover is a line test, so a swing around a corner still hits if the straight line is clear; it is
  not a full occlusion model.

## 9. Flight

The existing flight mode was audited and tested rather than rewritten:

- Toggle on/off, vertical targets 13 m/s (sprint ascend) / 8.5 / −7.5 / 0 hover, damped, a 4.2 m/s
  takeoff nudge until 1.25 m, 14 m altitude cap in a match (72 m in free roam).
- Tested: toggles on, climbs > 2 m, reports `state === 'flight'`, and once the climb is damped the
  hover drifts < 0.3 m over 0.75 s with no vertical input. Releasing flight lands the fighter.
- Hitting a flying fighter uses the same knockback/launch/hitstun path, no flight invulnerability.
- Flight collision uses the same stage resolve as walking; the wall-ejection test covers it.
- **An automated flight-into-wall-under-input test is not scripted** — the collision path is tested
  by placing a fighter inside a wall and by `test:combat`'s arena collision checks, not by flying
  into one with the stick held.

## 10. Character movesets and assets

| Character | Melee identity | Signature special | Rig |
| --- | --- | --- | --- |
| Goku | 0.88 startup, 1.04 reach, 1.14 damage profile | KAMEHAMEHA — beam, 22 dmg, speed 31, 1.12 s cooldown | procedural fallback (**assets absent**) |
| Iron Man (Tony Stark) | 1.04 startup, 1.03 reach, heavier knockback | REPULSOR BLAST — beam, 14 dmg, speed 34, 0.72 s cooldown | procedural fallback (**assets absent**) |
| Iron Spider | 0.94 startup, 1.06 reach | web special via the webslinger branch | procedural fallback |
| Others | archetype styles + per-character profiles | per-character `SPECIAL_MOVES` table | procedural + shared GLB prefabs |

The user's rigged Goku and Iron Man packages are **still not in the repository**; the manifest
entries remain disabled. Their moves are real (same pipeline, real hitboxes/projectiles), but the
animation is the procedural fallback. **BLOCKED BY MISSING ASSET** for the rigged presentation.
Iron Spider has no mechanical-leg controller; the legs are decorative, so **NOT IMPLEMENTED** and
not advertised in the HUD.

## 11. Projectiles

- Ownership is explicit; a shot only ever targets the other fighter.
- **Swept collision now**: the frame's movement is tested as a segment against the target sphere
  (`sweptSphere`) and against solid volumes (`segmentSolid`), so a 1.5 m per-frame jump no longer
  tunnels through a fighter or a wall. Unit tested with a 10 m segment whose end point is 5 m past
  the target.
- A target with `invulnerable > 0` (dodge i-frames, spawn protection, item shield) is skipped.
- Wall collision has a 1.6 m muzzle grace so a shot fired against a wall still leaves the hand.
- Blocked shots do 30% damage / 25% knockback; parry reflects them; grenades respect invulnerability.
- Lifetime is 1.28–1.6 s; every removal path removes the mesh; round end clears all shots.
- Beams still damage along their travel with a sphere, not along the full drawn beam.
  **PARTIAL** on "visual and damage volumes agree".

## 12. Hit feedback and polish

Unchanged and present: hitstop 0.05 s (0.085 s for 13+ damage, never on block), impact sparks
scaled by damage, launch/spike callouts, guard-break callout and flash, shield bars, combo counter
and finisher callout, signature-move cooldown in the HUD. The camera remains the pulled-back duel
rig; no new shake was added because none was missing.

**No audio exists in the project** (no `AudioContext` / `Audio`), so no hit/block/launch sounds are
claimed. **NOT IMPLEMENTED**.

## 13. Debugging

`F3` toggles a pooled wireframe overlay (hurtboxes blue, melee red, grabs gold, projectiles green)
and a monospace readout showing, per fighter: state name, active move id + phase + frame, shield
and regen wait, hitstun, combo count and scaling, air hits, i-frames, velocity and grounded flag,
plus grab-hold lines. Off by default, hidden when switched off, no per-frame allocation beyond a
short string.

## 14. Files touched in Phase 2

- `public/js/combat/move_data.js` — **new** move table, cancel table, character profiles, grab timing.
- `public/js/combat/fighter_state.js` — **new** states, precedence, armour, reaction rules.
- `public/js/combat/combo.js` — **new** scaling, chain, juggle limit, air hitstun.
- `public/js/combat/projectile_hit.js` — **new** swept sphere / segment-solid helpers.
- `public/js/combat/combat_debug.js` — text readout beside the volumes.
- `public/js/fighter3D.js` — move-data attack queue, cancel gating, armour/juggle reactions,
  grab hold/escape/drop, cover check, state and move id, shot/grab interaction.
- `public/js/world/arena_layouts.js` — `solidBetween`.
- `public/js/main.js` — swept projectile tests, grab drop on projectile hit, fighter layout,
  extra round cleanup, input test hook, cache version `v41`.
- `index.html`, `public/index.html` — cache version `v41`.
- `scripts/test-mechanics.mjs` — 74 assertions (was 30).
- `README.md` — test description.

Phase 1 files (shield rules, shield HUD, first debug overlay, hitbox/round fixes) are also still
in this uncommitted diff.

## 15. Test commands and results

```
source <(bash scripts/setup-browser-libs.sh --env)
npm run build                 → built in 3.38 s
npm run test:mechanics        → 74 assertions passed
npm run test:combat           → 394 checks passed
npm run test:gameplay         → 48 checks passed
npm run test:explore          → 49 assertions passed
npm run test:worlds           → 47,329 assertions across 60 battle locations
```

Not run this pass: `test:worlds:browser`, `test:smoke`, `audit:roster`, `validate:assets`. No world geometry or rig code changed, but that is a reason they were skipped,
not evidence they would pass.

No human play-test was performed this turn; the browser evidence comes from headless Chromium
driving the real game (Playwright). Visual confirmation in the user's Browser panel is still worth
doing.

## 16. Known defects and remaining work

1. **No formal transition rejection** — states are derived; invalid combinations are prevented by
   timers and the cancel table, not by an asserted state graph.
2. **Dodge has no startup frames** — i-frames begin on the input frame.
3. **Guard is omnidirectional**; no frontal cone, no cross-up rule.
4. **Armour is four moves and light-hit only**; no armour-break move.
5. **Grab escape is a single input inside 0.2 s**, not a struggle meter.
6. **Beam damage volume is shorter than the drawn beam.**
7. **Cover is a straight-line sample**; thin railings and corner swings are approximate.
8. **No audio, no pause menu, no remap UI.** Gamepad mapping is verified with a synthetic pad.
9. **Goku/Iron Man rigs absent**; Iron Spider legs are decorative.
10. **No automated ground→air juggle route test**; those pieces are tested separately.
11. The 818-check world browser suite (`test:worlds:browser`) was not rerun; the node world
    suite (47,329 assertions, 60 locations) was, and the six worlds' block counts are unchanged.

## 17. Next three highest-priority improvements

1. Wire `fighter.ko` through round end and respawn so KO is a state, not just a pause, and test it.
2. Add a frontal guard cone plus one armour-break move, with the debug overlay drawing the guard
   arc, so defence has a spatial rule instead of a binary one.
3. Script a full launcher→air→finisher route in the browser test and tune hitstun so the route is
   possible but escapable, using the juggle limit that is already in place.

---

# Phase 3 — per-character movesets, transformations and ultimates

## 18. What Phase 3 added

| System | State | Where |
| --- | --- | --- |
| 33 per-character movesets (named light chain, heavies, aerial, signature, form, ultimate) | **IMPLEMENTED AND TESTED** | `public/js/combat/movesets.js` |
| Ultimate meter, validated activation, 7 attack behaviours | **IMPLEMENTED AND TESTED** | `public/js/combat/ultimate.js` |
| Transformation resource, duration, stat mods, per-form aura | **IMPLEMENTED AND TESTED** | `public/js/combat/transformation.js` |
| Shared ultimate hit resolution (guard, cover, i-frames, meter) | **IMPLEMENTED AND TESTED** | `public/js/combat/combat_powers.js` |
| Ultimate meter + form gauge in the HUD | **IMPLEMENTED AND TESTED** | `combat_powers.js` `drawHud`, called from `main.js` `updateHud` |
| Key / gamepad bindings for both | **IMPLEMENTED AND TESTED** | `public/js/smash_input.js` |
| Per-fighter move list in the select screen | **IMPLEMENTED AND TESTED** (renders without page errors; not visually reviewed by a human) | `public/js/ui/character_select.js` |
| F3 readout extended with meter, power, casting and form | **IMPLEMENTED AND TESTED** | `public/js/combat/combat_debug.js` |
| Unique animation clip per ultimate | **NOT IMPLEMENTED** | no clips exist; see §21 |
| Cinematic ultimate camera | **NOT IMPLEMENTED** | camera shake only |
| Sound | **NOT IMPLEMENTED** | the project has no audio at all |

The roster audit (internal id, selectability, model/animation status, named moves, form, ultimate
and per-item status) is in **`CHARACTER_MOVESET_AUDIT.md`** at the repository root.

## 19. The two systems are separate

**Transformation** (key **I** / D-pad up, P2 **N**): a timed mode with its own resource `power`
(0–100, earned only from real damage: `0.52 × damage dealt`, `0.38 × damage taken`, `+0.8` per
blocked hit — no passive regeneration). Entering spends the character's `cost` (40–50), applies real
multipliers for `duration` (8–10 s), optionally drains `4–7 power/s`, and starts a `cooldown`
(8–10 s + 0.6 s fatigue) when it ends. Refused with a named reason when KO'd, grabbed, in hitstun,
guard-broken, already transformed, cooling down or short of power.

Modifiers actually applied by the simulation, not only displayed:

- `speed` → ground/air top speed in `Fighter3D.handleInput`.
- `jump` → jump and double-jump impulse.
- `damage` / `kbs` → every queued attack through `Fighter3D.scaleAttack`.
- `startup` → scales all three phases of a move (a speed form really does attack faster).
- `defense` → incoming damage multiplier applied at every damage site (`incomingDamage`).
- each form also **replaces the signature move** with a second, stronger move (label, damage,
  cooldown, colour, and for several characters a different behaviour).

**Ultimate** (key **O** / D-pad down, P2 **M**): a one-shot attack with its own meter (0–100, spent
exactly once). Meter fills from damage dealt `2 + 0.9 × damage`, damage taken
`1.2 + 0.55 × damage`, `+1.2` per blocked hit. An ultimate deliberately does **not** feed its own
meter; only the victim earns from it, which removes the "ultimate pays for the next ultimate" loop.

## 20. Ultimate behaviours

Every ultimate is one of seven behaviours in `ultimate.js`. Each one resolves damage by calling the
game's hit resolver (`combatPowers.hit`), so guarding, shield cost, invulnerability, wall cover and
meter accounting behave exactly as they do for melee:

| Behaviour | What actually happens | Characters |
| --- | --- | --- |
| `beam` | A lane from the caster along its facing, stopped by the first solid volume, with distance falloff and a lateral width test | Iron Man, Goku, Vegeta, Sasuke |
| `rush` | N sequential closes; each needs range and line of sight and moves the caster in, then a launch | Flash, Naruto, Saitama, All Might, Levi, Mario, Kratos, Jack |
| `slam` | The caster jumps on cast, then lands on the marked point for a radial hit with falloff | Superman, Hulk |
| `storm` | N strikes on the mark captured at cast time; a target that leaves the circle takes nothing | Aquaman, Edward, Link, Master Chief, Thor, Aang, Madara, Hashirama |
| `zone` | A damaging field anchored where the target stood, ticking N times with a stronger final tick | Green Lantern, Professor X, Dr Strange, L, Luigi, Voldemort, Edna |
| `grab` | A pull that must connect (range + line of sight), then a short finishing chain | Wonder Woman, Spider-Man, Iron Spider |
| `barrage` | N aimed shells, each needing range and line of sight | Arnold |

Rules shared by all of them:

- **Meter spent once**, at the accepted activation.
- **No free invulnerability.** The startup is a real punish window.
- **Interruption**: a clean hit before anything has connected cancels the ultimate and refunds the
  meter in full. After the first hit connects the move completes (documented, consistent rule).
- **Walls**: the beam stops at the first solid volume; every other behaviour refuses to damage a
  target behind cover (verified on the Death Star: a block between the fighters gives `landed:false`
  and zero damage).
- **Cleanup**: KO, round end, rematch and character swap all clear running ultimates, their
  generated effects and the caster's lock.

## 21. Assets, animation and honest gaps

- All 33 fighters are **procedurally built bodies** with the shared Blender prefab upgrade path.
  The user's Goku and Iron Man packages and the Iron Spider GLB remain **disabled** in
  `public/models/characters/manifest.json`; the Mixamo pack is `not-supplied`. **BLOCKED BY
  MISSING ASSET** for rigged characters and hand-authored attack clips.
- The 39 procedural clips in `public/data/animation-manifest.json` still drive idle/locomotion and
  combat poses. No clip is claimed for any ultimate or transformation.
- A transformation's visual is a **generated aura** (`flame`, `lightning`, `ring`, `construct`,
  `steam`, `wind`, `holy`, `shadow`), not a model swap. Nine silhouettes, 33 distinct colours and
  ids — distinct enough to read as separate forms, but **PARTIAL** on "changes the model".
- Ultimates are original effects built from rings, cones, cylinders and lines. There is **no
  cinematic camera cut and no bespoke choreography**; several characters share a behaviour and
  differ by damage, geometry, colour and label. **PARTIAL** on "unique signature move".
- Iron Spider's legs are still effect-only geometry in the special; its ultimate is a `grab`
  behaviour, not articulated legs. **PARTIAL**.
- No directional specials (only the neutral signature move), and no per-move cancel table beyond
  the Phase 2 chain.
- **No audio.**

## 22. Files touched in Phase 3

- `public/js/combat/movesets.js` — **new**: all 33 movesets, forms, ultimates, resolution helpers.
- `public/js/combat/ultimate.js` — **new**: meter, activation gate, runner, 7 behaviours, visuals.
- `public/js/combat/transformation.js` — **new**: power, form lifecycle, mods, auras.
- `public/js/combat/combat_powers.js` — **new**: hit resolution, cleanup, HUD drawing, snapshots.
- `public/js/smash_input.js` — transform/ultimate bindings for both players and gamepads.
- `public/js/fighter3D.js` — form ticking, casting lock, stat scaling, meter/power on real hits.
- `public/js/main.js` — powers instance, simulation hook, round/reset/swap cleanup, AI use, HUD hook,
  test hooks (`__browserSmashPowers`, `__browserSmashTryForm`, `__browserSmashTryUltimate`).
- `public/js/combat/combat_debug.js` — meter/power/form lines.
- `public/js/ui/character_select.js` — per-fighter move list.
- `public/index.html`, `index.html` — control legend; cache-busting version bumped to
  `browser-smash-movesets-v42-20261026` across all entry points and imports.
- `scripts/test-movesets.mjs` — **new** suite; `scripts/install-browser-libs.sh` and
  `scripts/run-browser-test.sh` — **new** helper scripts for the bare cloud image.
- `package.json` — `test:movesets`.
- `CHARACTER_MOVESET_AUDIT.md`, this report, `docs/COMBAT_TEST_MATRIX.md`.

## 23. Test commands and results (Phase 3)

Run in this order; browser suites need the wrapper because the cloud image has no fonts or
Chromium libraries and a missing font crashes the renderer.

| Command | Result |
| --- | --- |
| `npm run test:movesets` (`bash scripts/run-browser-test.sh scripts/test-movesets.mjs`) | **74 checks passed** |
| `npm run test:mechanics` | 74 assertions passed |
| `npm run test:combat` | 394 checks passed |
| `npm run test:gameplay` | 48 checks passed |
| `npm run test:explore` | 49 assertions passed |
| `npm run test:worlds` | 47,329 assertions across 60 battle locations |
| `node scripts/test-stage-feel.mjs` | 138 checks across 4 stages |
| `node scripts/test-rig.mjs` | 31/31 |
| `node scripts/test-iron-spider.mjs` | 33 checks |
| `npm run build` | clean (51 modules, 1,278 kB bundle) |

`test:movesets` proves, in the live game: roster coverage against the roster parsed out of
`main.js`; every moveset complete and using an implemented behaviour; no ultimate one-shots a fresh
fighter; form activation/spend/mod swap/expiry/cooldown; refusal paths; keyboard and gamepad
bindings for both players; a transformed signature dealing damage through the projectile pipeline;
a full meter casting the right ultimate, spending once, refusing a double cast, landing damage and
returning control; interruption refund; wall cover blocking an ultimate; round reset and rematch
cleanup; and **all 33 fighters forming and casting with distinct labels** in the running game.

## 24. Known defects and remaining work

1. **PARTIAL** — ultimates share seven behaviours; they are not 33 unique choreographies, and there
   is no cinematic camera.
2. **NOT IMPLEMENTED** — per-character attack animations and transformation model changes
   (**BLOCKED BY MISSING ASSET**).
3. **NOT IMPLEMENTED** — sound.
4. **PARTIAL** — balance is data-driven but untuned by human play: meter rates, form costs and
   ultimate damage are reasoned values, not play-tested ones.
5. **PARTIAL** — the CPU casts ultimates and forms on a per-frame probability when in range; it does
   not choose them tactically.
6. **NOT IMPLEMENTED** — directional specials (`UP+K`, `DOWN+K`), and no per-move cancel table for
   specials.
7. **NOT IMPLEMENTED** — Iron Spider's articulated legs in combat.
8. **BROWSER TEST NEEDED** — the select-screen move list and the HUD gauges have not been looked at
   by a human on a real display; only structural checks and no-page-error assertions cover them.

## 25. Next three highest-priority improvements

1. Install the rigged Goku / Iron Man / Iron Spider packages and bind the existing 39 procedural
   clip names to real clips, so attacks and forms are animated rather than posed.
2. Give the three most-played characters (Goku, Iron Man, Superman) bespoke ultimate choreography
   and a short, skippable camera move that returns to the duel rig.
3. Play-tune the meter/power economy across a full three-round match, then add directional
   specials so each character's kit has two distinct specials instead of one.

## 26. Phase 3 — startup crash fix and combat readability

### 26.1 The reported crash (fixed)

Symptom: the menu overlay printed `Startup error: Uncaught TypeError: combatPowers.drawHud is not a
function` and the game never reached the arena.

Cause: `main.js` calls `combatPowers.drawHud(...)` every frame, but the module graph under the entry
script was served from the browser's cache under an unchanged query token, so the page ran a newer
`main.js` against an older `combat_powers.js` that predated `drawHud`.

Fix, in three parts:

1. The cache-busting token is bumped to `browser-smash-phase3-v43-20261026` in `index.html`,
   `public/index.html` and all 23 imports in `main.js`, so the entry chain is re-fetched.
2. `updatePowerHud()` now checks `typeof combatPowers.drawHud === 'function'` and warns once instead
   of throwing. A HUD helper can no longer abort the frame or block the fight.
3. The token is deliberately **not** added to deep `public/js` imports. Doing that gives Node a
   second module instance of `worlds/world_catalog.js`, which empties the arena registry and fails
   60 world checks — verified, and reverted.

Verification: `scripts/probe-boot.mjs` loads the dev server, enters free roam, starts a match, fires
a form and an ultimate, and asserts zero page errors, zero console errors and a live HUD.

### 26.2 Readability changes

| Change | File | Why |
| --- | --- | --- |
| Hit-stop for every confirmed damage source, not just heavy melee | `combat/combat_powers.js` (`hit`, `award`) | A landed ultimate or signature now has the same weight as a heavy swing. Guarded hits get a token freeze only. |
| `EVADED · INVULNERABLE` callout and a guaranteed miss | `combat/combat_powers.js` | A dodge or respawn window used to swallow the hit silently, which read as a broken hitbox. |
| Beam drawn at its real damage width | `combat/ultimate.js` | The beam cylinder was ~0.3 m across while the damage lane is 2.4–2.8 m; players judged spacing off the picture. Radius now derives from `def.width`. |
| Beam aim line during startup | `combat/ultimate.js` | Draws the firing lane, wall stop included, before the beam fires. Hidden once active. |
| Ultimate wind-up ramp | `combat/ultimate.js` | Mark rings start small and dim and fill out across startup; previously every telegraph looked identical at cast and at fire. |
| Projectile halo sized to the hit sphere | `main.js` (`spawnProjectile`) | Collision is a 0.95 m swept sphere; halos were 0.48 m (and web shots had none), so real hits looked like near misses. |
| Form state on the HUD | `combat/combat_powers.js` (`drawHud`) | The FORM row now reads `ON`, the gauge and panel tint change, and the row carries the form name as a tooltip. |
| Camera weight on transformation | `combat/transformation.js` | Activation now shakes the camera like a heavy connect, matching the callout and impact burst it already had. |

Nothing above changes damage, meter, cost or timing numbers. The only balance-adjacent edit is the
miss/callout path, which cannot deal damage.

### 26.3 Tests added

`scripts/test-movesets.mjs` gained five checks (79 total):

1. a hit voided by an invulnerability window deals no damage and reports `EVADED`;
2. a landed ultimate hit requests hit-stop exactly once;
3. a beam ultimate is drawn as wide as the volume that damages;
4. a beam ultimate telegraphs its lane during startup, hides the line and shows the beam when active;
5. the HUD marks an active form and clears it afterwards.

`scripts/probe-boot.mjs` (new) is the end-to-end boot/play regression probe described above.

## 27. Phase 4 — real fighters, transformations and animation

This pass worked on the body, not on the numbers. Nothing here changes damage, meter, costs,
cooldowns or frame data; `npm run test:movesets` (79 checks) and `test:mechanics` (74 assertions)
still pass unchanged.

### 27.1 Iron Spider's legs are a jointed rig, not spawned VFX

The four mechanical legs used to be created inside `performSignatureMove` as one-shot cylinders
added to the scene, scaled along one axis, then disposed. They were decoration: the damage was
the shared radial shockwave and the legs added nothing.

`public/js/anim/spider_legs.js` now builds them on the fighter body as four chains of three
joints each (12 joints, hips → coxa → femur → tibia → tip), attached in `models.js` when the
Iron Spider body is constructed and re-attached after any model swap. Eight pose presets
(`folded idle flare strike guard stagger flight land`) are damped toward from the fighter's real
combat state, and the rig reports its tip positions.

The sweep (`main.js`, `behaviour: 'shockwave'` with `legs: 4`) now:

- sets `owner.legStrike`, which drives `strike → flare → fold` on the rig;
- fires one ground impact per leg at the tip position that frame;
- accepts a **leg-tip contact** as a hit in addition to the existing arc test, so a target the
  limbs are physically touching is hit even outside the facing cone. Each target still takes
  exactly one hit per sweep (`hitTargets`), so damage per swing is unchanged.

The pose update runs inside `simulationStep` (not the render loop) because the sweep's hit test
reads the tips in the same step; running it on a render frame left the hit one frame behind the
visual. Cost is four damped rotations per fighter per step and no allocation.

**Status: IMPLEMENTED AND TESTED** (`npm run test:iron-spider`, 37 checks;
`npm run test:animation`). Browser test needs a human look for feel.

### 27.2 Transformations change surfaces the body actually has

`public/js/anim/form_presentation.js` applies an authored `look` to the fighter's declared
surfaces, and records every original value so restoration is exact. `models.js` now tags:

- `fighter-hair` — the character's spike-hair meshes (Goku, Vegeta, and every other hair body),
- `arc-reactor` — Iron Man's chest disc,
- `fighter-accent` — the emissive trim material,
- `appendage` — every segment and joint of the Iron Spider rig.

Authored in `combat/movesets.js`, four forms carry a look this pass:

| Form | Real change |
| --- | --- |
| Goku `KAIOKEN ×3` | hair and suit accents burn red at 1.7/2.4 emissive, hair lifts 3% |
| Vegeta `SUPER SAIYAN` | hair turns gold (0xf7d452), emissive 1.35, silhouette +12% |
| Iron Man `OVERDRIVE PROTOCOL` | reactor goes white-hot (0xe8feff, 3.4), seams brighten |
| Iron Spider `SPIDER ASSAULT PROTOCOL` | appendages heat to 0xffe89a at 2.6 emissive |

Every other form keeps its generated aura and its stat/move changes and touches no material —
`applyFormPresentation` returns `applied: false` when a form has no `look`. Expiry, interruption,
KO, round reset and rematch all restore the authored colour, emissive intensity and scale
(`clearFormPresentation`, called from `endTransform`, which every exit path goes through).

Honest limits: this is not a model swap. Goku does not get a second head mesh, the suit is not
replaced, and an imported rig only changes where a material or mesh name clearly identifies hair
or a reactor. Those are documented rather than faked.

**Status: IMPLEMENTED AND TESTED** (`npm run test:animation`, 21 presentation checks).

### 27.3 Combat audio (new)

The project had no audio system at all. `public/js/audio/combat_audio.js` synthesises every sound
with Web Audio — no files, so no licensing question and no download — and follows four rules:

1. nothing plays before a real user gesture (the context is created on first pointer/key/touch);
2. each event is throttled and a per-frame voice budget caps stacking, so a 24-spark hit is one
   sound;
3. muting is optional and persisted (`browserSmashAudioMuted`), toggled with **Ctrl+M**, volume
   stored separately;
4. it can never throw into the frame loop — no `AudioContext` means the module quietly disables.

Eleven voices: `impactLight impactHeavy guard projectile form formEnd ultimate ko jump land
whoosh`. Wired to the real events: `spawnImpact` (melee + signature impacts, scaled by the same
intensity the VFX uses), guarded signature hits, projectile launch (pitched by move type), round
KO, landings, form start/end, and ultimate activation. `window.combatAudio.describe()` reports
plays, throttles and drops for QA.

**Status: IMPLEMENTED — BROWSER TEST NEEDED.** Headless Chromium runs with `--mute-audio`, so the
synthesis path is exercised but nobody has listened to it yet.

### 27.4 The animation pipeline is now proven against a real skinned glTF

`scripts/make-rig-fixture.mjs` generates an 11-joint Mixamo-named skinned GLB (4.1 KiB, our own
geometry, deliberately not in the character manifest). `npm run test:animation` runs 63 checks:
rig binding, retargeting, root-motion stripping, the 39-clip library, real bone rotation, attack
peak retiming, hitstun ownership, the leg rig and every form surface change and restore. Details
in `docs/ANIMATION_PIPELINE_READINESS.md`.

What it does **not** prove: that a Marvel/Toei character model renders, because none is present.
All three manifest entries stay disabled and `npm run validate:assets` still reports them as
optional missing assets with procedural fallbacks.

### 27.5 Files touched this pass

New: `public/js/anim/spider_legs.js`, `public/js/anim/form_presentation.js`,
`public/js/audio/combat_audio.js`, `scripts/make-rig-fixture.mjs`,
`scripts/test-animation-pipeline.mjs`, `public/models/characters/_fixture/rig-test.glb`,
`public/models/characters/_fixture/README.md`.

Modified: `public/js/models.js` (surface tags, accent material name, appendage attach, decorative
legs removed), `public/js/main.js` (leg rig in the simulation step, leg-tip hit test, audio),
`public/js/combat/transformation.js` (form surfaces + audio), `public/js/combat/ultimate.js`
(audio), `public/js/combat/movesets.js` (four authored `look`s), `scripts/test-iron-spider.mjs`
(leg assertions rewritten for the rig), `package.json` (`test:animation`, `make:rig-fixture`),
`README.md`, `docs/ANIMATION_PIPELINE_READINESS.md`, this report and the test matrix.

### 27.6 Remaining work, in priority order

1. Install a licensed rigged Goku (or Iron Man) and confirm it in the browser end to end: the
   pipeline is ready, the asset is not.
2. Listen to the new audio and tune levels/mix on real speakers (headless runs are muted).
3. Give the legs' strike pose a real animation clip once a rigged Iron Spider exists; the
   procedural pose is the fallback, not the finished product.
