# Hulk — animation completion and live evidence

Date: 2026-11-13

Status: **software-complete for the previously open states; hardware-GPU acceptance still open.**

The existing Hulk body is preserved unchanged:
`public/models/characters/imported/hulk/hulk.glb` — 6,361,632 bytes, 5 skinned meshes,
11,437 vertices, 15,252 triangles, 5 materials, **65 bones**, **19 clips**. No Hulk model,
texture, source GLB or combat slot was replaced in this pass.

## What was open before this pass

The imported Hulk GLB already supplied `idle`, `walk`, `dash`, `atk01`, `atk02`,
`skill01`–`skill05`, `hit`, `stun`, `die` and `wait`. The game already played those through the
normal imported-strike and imported-reaction paths, and the existing A1 report records **42/42**
live combat checks.

Three states were still using generic motion:

| State | Before | Why |
| --- | --- | --- |
| Victory | semantic library `victory` | `LIBRARY_STATE_OVERRIDES` forced the library pose even though `succ_cam` was in the supplied pack |
| Double jump | first-jump `jump` action | Hulk had no `doubleJumpAction`, so the second jump replayed the first pose |
| Falling | first-jump `jump` action | Hulk had no `fallAction` |

`land`, `knockdown` and `get_up` were also library motion. That remains deliberate: the pack has no
authored landing, knockdown or get-up clip, and the supplied `stun` is a stagger, not a floor pose.
The live response set reports those three as `missing` because they are supplied by the semantic
library on the same mixer; they are not being silently claimed as source clips.

## After: state mapping

| Gameplay state | Live action | Provenance | Evidence |
| --- | --- | --- | --- |
| Idle | `Armature\|hero_hulk01_S09@idle` | supplied source | live mount |
| Walk | `Armature\|hero_hulk01_S09@walk` | supplied source | live mount |
| Run / sprint | `Armature\|hero_hulk01_S09@dash` | supplied source | A1 42/42; live probe |
| First jump | `jump` | semantic library on Hulk's 65-bone rig | 12/12 aerial probe |
| **Double jump** | **`double_jump`** | semantic library on Hulk's rig | live `jumps=2`, current clip `double_jump` |
| **Falling** | **`fall`** | semantic library on Hulk's rig | live clip transition `double_jump → fall` |
| Landing | `land` | semantic library | live clip transition `fall → land → idle` |
| Block | `Armature\|hero_hulk01_S09@wait` | supplied source | live response bind |
| Dodge | `Armature\|hero_hulk01_S09@dash` | supplied source | live response bind |
| Light hit | `Armature\|hero_hulk01_S09@hit` | supplied source | live response bind |
| Heavy hit / stagger | `Armature\|hero_hulk01_S09@stun` | supplied source | live response bind |
| Knockdown | `knockdown` | semantic library (no source floor clip) | A1 42/42 |
| Get up | `get_up` | semantic library (no source floor clip) | A1 42/42 |
| **Victory** | **`Armature\|hero_hulk01_S09@succ_cam`** | **supplied source** | live match end, weight 1 |
| Defeat | `Armature\|hero_hulk01_S09@die` | supplied source | live match end |

Combat slots are unchanged and still use the supplied clips:
`atk01`, `atk02`, `skill01`, `skill02`, `skill03`, `skill04`, `skill05` across light 1–5,
finisher, heavy, heavy launcher, heavy slam, heavy finisher, air, air finisher, counter, special,
ultimate, grab, throw, dive and anti-air. The signature remains `skill03`, the ultimate `skill04`,
the grab/throw `skill05`, and the heavy `atk02`.

## Live verification

- `npm run build` — **PASS**, 128 modules, built in 5.70 s.
- `scripts/verify-hulk-live.mjs` — **PASS**, exit 0. Imported body mounted, 65-bone rig valid,
  **20/20** strike slots bound, heavy 29%, slam 32%, signature `skill03` 23%, ultimate
  `skill04` 27%, no page errors. Log: `artifacts/hulk-live-after.log`.
- `scripts/verify-hulk-victory-clean.mjs` — **12/12 PASS**, exit 0. A real match end plays
  `Armature|hero_hulk01_S09@succ_cam` at full weight, the gauntlet is stowed for the celebration,
  the full body is framed, rematch re-equips it, and the real defeat path still plays `@die`.
  Log: `artifacts/hulk-victory-after.log`.
- `scripts/verify-fighter-aerial-completion.mjs hulk` — **12/12 PASS**, exit 0. Live Space input:
  first jump `jump` → second jump `double_jump` → descending `fall` → `land` → `idle`; apex
  **3.52 m**, landed at y=0, no page errors. Report:
  `artifacts/hulk/aerial-completion/report.json`.
- `scripts/verify-hulk-camera-scenarios.mjs` — **65/65 PASS**, exit 0. All four victory headings,
  arena boundaries, tree band, close opponent, airborne defeat and rematch keep the whole body on
  screen and the lens outside geometry; every victory case reports `succ_cam` at weight 1. Log:
  `artifacts/hulk-camera-after.log`.

Capture evidence from the real match-end branch:
`artifacts/hulk-camera/A-default-victory.png`,
`artifacts/hulk-victory-real/victory-pose.png` and `artifacts/hulk-victory-real/victory-full.png`.
The pose is Hulk’s authored success roar with both arms up. These are SwiftShader composition
captures, not hardware-GPU proof.

The prior A1 Hulk report (`artifacts/a1-combat/hulk/report.json`, **42/42**) is preserved. This
pass did not recreate any working attack, locomotion, reaction, form or ultimate clip.

## Remaining limits

- No hardware GPU is available in this workspace; every capture is headless SwiftShader.
- The supplied pack has no authored single jump, double jump, falling, landing, knockdown or
  get-up clip. Those six states use the project’s semantic library compiled onto Hulk’s own
  65-bone rig; they are explicitly not counted as source clips.
- `collection` is a zero-second static pose and is not selected. `skill03_cam`,
  `skill07-01_cam` and the camera variants are authored cinematic variants; they are preserved but
  not used as gameplay states. `skill07-02` remains preserved and unused by the current strike map.
- No model, texture, source archive, rig, combat hitbox or Miles Morales asset was modified.
