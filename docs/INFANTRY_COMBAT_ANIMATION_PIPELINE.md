# Combat animation pipeline (proven on Infantry)

Infantry is an *imported* body: a 279k-triangle GLB with its own 24-joint skeleton and only the
walk and run clips that shipped inside the file. This document is the pipeline that gave it six
authored attack clips **on that same rig**, and the steps for repeating it on another imported
fighter (Naruto, Superman, Goku, Spider-Man, …).

Nothing here regenerates or replaces a body. The source GLB is read, never written.

---

## 1. What the pipeline produces

Two files per fighter:

| File | Contents | Why |
| --- | --- | --- |
| `public/models/characters/roster_hd/<fighter>_cc0.glb` | the imported body, untouched | identity, geometry, textures, materials, bones |
| `public/models/characters/roster_hd/<fighter>_combat.glb` | armature + animation clips only, ~130 KB | clips bind onto the mounted bones by name |

The clip asset deliberately ships **no mesh**. Re-exporting the 13 MB body just to add animation
would risk the identity the whole feature depends on, and it would ship the same textures twice.

## 2. Inspect the rig before authoring

```bash
node scripts/inspect-character-glb.mjs public/models/characters/roster_hd/infantry_cc0.glb
node scripts/inspect-animation-glb.mjs public/models/characters/roster_hd/infantry_combat.glb
```

`inspect-animation-glb.mjs` prints per-clip channel counts, the bones each clip actually drives and
each clip's duration, and exits non-zero on an empty clip. Use it as the first smoke test after
every export — a GLB with a clip *name* and zero channels is the failure mode this catches.

## 3. Author the clips in Blender

Blender 4.2 LTS is installed in this workspace; run it through the wrapper so the libraries resolve:

```bash
bash scripts/blender.sh -b --python assets/blender/infantry_combat_animations.py
```

The script is generic:

```bash
bash scripts/blender.sh -b --python assets/blender/infantry_combat_animations.py -- \
    --source public/models/characters/roster_hd/naruto_cc0.glb \
    --out    public/models/characters/roster_hd/naruto_combat.glb \
    --prefix Naruto_
```

### The one technical trap: rolled rest axes

The imported limb bones carry a rolled rest orientation, so a bone-local Euler angle is not readable
(`+X` on `RightArm` is not "swing forward"). Every pose in the script is therefore written in
**armature space** and converted per bone:

```
Q_local = M_rest⁻¹ · R_armature · M_rest
```

This is ordinary FK: the armature-space rotation is reproduced relative to the bone's animated
parent. Author poses the way an animator describes them (−Y forward, +Z up, character right −X) and
let the conversion handle the roll.

### What each clip must contain

Anticipation → contact → follow-through → recovery, with the whole body involved. The script builds
each pose from a shared fighting `STANCE` plus per-bone deltas, keys it with BEZIER / AUTO_CLAMPED,
and starts and ends every clip in that stance so it blends back into locomotion instead of snapping
upright on the last frame.

| Clip | Move | Beats |
| --- | --- | --- |
| `Infantry_RifleButt` | light 1 | wind-up, rifle thrust, contact, recover |
| `Infantry_CombatCross` | light 2 | weight shift, hip/shoulder drive, cross punch, recover |
| `Infantry_BootKick` | light 3 | knee chamber, hip rotation, full extension, foot back down |
| `Infantry_ArmourBreaker` | heavy | wide stance, long anticipation, committed strike, heavy recovery |
| `Infantry_StockSlam` | up + heavy | weapon lifted overhead, full-body drop, impact, balanced finish |
| `Infantry_JumpKnee` | aerial | knee driven up, torso folded, contact, leg extends to land |

Rules the export relies on: **no root displacement** (the game owns position), **no floor
penetration** (the lowest foot stays on the stance plane), and the rifle is never animated as a
separate object — it is parented to the hands, so it follows whatever the arms do.

### Export mechanics

Each action is pushed onto its own **NLA track named exactly like the clip** and the file is exported
with `export_animation_mode="NLA_TRACKS"`. That is what makes the exporter emit six separate clips
rather than one baked strip. Geometry is dropped before export (`drop_geometry`), so only the
armature and its clips leave Blender.

## 4. Wire the clips into the game

Three edits, all already in place for Infantry:

1. **`public/js/anim/animation_manifest.js`** — add the fighter to `IMPORTED_ATTACK_CLIP_SETS`:

   ```js
   infantry: {
     url: 'models/characters/roster_hd/infantry_combat.glb',
     slots: { light1: 'Infantry_RifleButt', light2: 'Infantry_CombatCross', /* … */ }
   }
   ```

   `importedAttackClipsFor()` and `importedStrikeSlotFor()` read that table, and `attackClipsFor()`
   merges imported slots last so they win over generated names.

2. **`public/js/human_fighter.js`** — `ensureImportedStrikeClips()` loads the clip GLB with the
   existing loader, creates one `mixer.clipAction(clip)` per slot (`LoopOnce`, `clampWhenFinished`),
   stores them on `userData.importedStrikeActions`, and publishes a report at
   `window.__browserSmashAssets.importedStrikes.<fighter>`. It is called from `bindAuthoredClips()`.

3. **Strike selection** — `authoredStrikeSlotFor(...) || importedStrikeSlotFor(...)` picks the slot
   for the current attack id, so imported clips slot into the same selection the generated fighters
   use. Gameplay timing is untouched: the action is retimed against the attack's own progress and
   clamped at the end.

Imported fighters take the **legacy mixer path** in `human_fighter.js`, not `AnimationController`
(`attachAnimation` returns `null` when the body already brings its own mixer and clips). That is why
the binding lives in `human_fighter.js`.

## 5. Verify — three kinds of evidence

A GLB containing a clip name proves nothing. `scripts/verify-infantry-attack-animations.mjs` checks
three independent things:

```bash
bash scripts/run-browser-test.sh scripts/verify-infantry-attack-animations.mjs
```

1. **Wiring** — every moveset slot the animator can select from resolves to the expected clip.
2. **Live play** — real key presses into a real match; the string is advanced in pure simulation
   steps so the combo window behaves as it does at 60 fps, while the animator (which only runs in
   `requestAnimationFrame`) is given real frames during the measured attack. A write-time hook on the
   animator's strike record captures which clip it selected; damage is read from the live resolver.
   A measurement that records nothing is retried, because this software renderer can drop a frame
   across an entire 0.5 s attack — a recorded *wrong* clip is never retried away.
3. **Skeletal motion on the mounted rig** — each clip is bound to the fighter's own skeleton through
   a throwaway mixer and sampled across its duration, so bone travel is measured independently of
   frame rate. Infantry's six clips move the striking bone 0.68–1.41 m and no two share a motion.

`scripts/test-infantry-combat-clips.mjs` complements that at file level: it reads the accessors out
of the GLB's binary chunk and asserts 24 animated bones, the required movers, no duplicate motion and
real total travel per clip — no browser, no renderer.

Regression suite for this feature:

```bash
npm run build && npm run validate:assets && npm run audit:roster
npm run test:smoke && npm run test:combat && npm run test:motion && npm run test:locomotion
npm run test:abilities && npm run test:movesets && npm run test:rig
node scripts/verify-infantry-roster.mjs
node scripts/accept-infantry-melee.mjs
node scripts/test-infantry-combat-clips.mjs
bash scripts/run-browser-test.sh scripts/verify-infantry-attack-animations.mjs
```

Anything that drives a browser must go through `scripts/run-browser-test.sh`; plain `node` fails on
`libnspr4.so` in this workspace.

## 6. Repeating this for another fighter

1. `node scripts/inspect-character-glb.mjs <fighter GLB>` — confirm the joint names. The authoring
   script fails loudly on a missing bone; a rig with different bone names needs the `STANCE` and
   `CLIPS` bone keys renamed, not the math rewritten.
2. Export clips with `--source/--out/--prefix`.
3. Confirm with `inspect-animation-glb.mjs` (six clips, 24 channels per bone, sane durations).
4. Add the entry to `IMPORTED_ATTACK_CLIP_SETS` with the fighter's slots.
5. Copy the verification script, point it at the fighter and its expected clip names, run it.
6. Run the regression suite; the melee and roster acceptance tests are the guard that identity,
   moveset and damage balance are untouched.

## 7. Limits worth knowing

- The clips are authored **for this rig's proportions**. Reusing them on a very different skeleton
  (different limb lengths, quadruped, extra twist bones) needs retargeting, not just renaming.
- Clip-only GLBs bind by bone name. If a body's joints are renamed by a re-import, the binding
  silently does nothing — which is exactly why the wiring check exists.
- The low frame rate of the software renderer is a *test harness* problem, not a gameplay one: the
  animator runs on real frames and the simulation runs on fixed steps, so both were measured
  separately rather than conflated.
- Reaction clips (idle, jump, land, light/heavy hit, knockdown, get-up, victory, defeat) are
  authored by `assets/blender/reaction_animations.py`, which shares the armature-space module
  `assets/blender/rig_authoring.py` with the attack pass. They are wired through the *existing*
  state actions in `human_fighter.js` (`idleAction`, `jumpAction`, `hitLightAction`, ...), so a
  reaction is selected by the same branch that already handled hitstun, landing, KO and victory.
- The reaction script carries rig adapters: `--rig mixamo` for the Grab3D soldier, `--rig rigify`
  for Naruto's 567-bone deform chain. The same nine clips were exported for both, proving the
  authoring path is not Infantry-specific:
  `public/models/characters/roster_hd/infantry_reactions.glb` and
  `public/models/characters/naruto_uzumaki/naruto_reactions.glb`.
- Naruto's reaction GLB is exported as a pipeline proof, not wired: his imported body already ships
  its own `idle` / `hit_light` / `knockdown` / `victory` clips, and body clips win.

### Verified reaction evidence

`bash scripts/run-browser-test.sh scripts/verify-infantry-reaction-animations.mjs` passes **17/17**
(three consecutive runs). Bone travel is measured on the mounted skeleton, so a bound-but-empty
clip cannot pass:

| slot | clip | seconds | max bone travel (m) |
| --- | --- | --- | --- |
| idle | `Infantry_idle` | 2.00 | 0.024 |
| jump | `Infantry_jump` | 0.67 | 0.288 |
| land | `Infantry_land` | 0.67 | 0.302 |
| hit_light | `Infantry_hit_light` | 0.50 | 0.347 |
| hit_heavy | `Infantry_hit_heavy` | 0.92 | 0.732 |
| knockdown | `Infantry_knockdown` | 1.08 | 1.478 |
| get_up | `Infantry_get_up` | 1.00 | 1.470 |
| victory | `Infantry_victory` | 1.25 | 0.809 |
| defeat | `Infantry_defeat` | 1.33 | 1.219 |

Live selection was driven through the real inputs where possible: Space selected `Infantry_jump`, a
forced grounded transition selected `Infantry_land`, a real J attack still dealt damage (11.74) with
the reaction set active, hitstun selected the hit actions, and KO/victory selected `Infantry_defeat`
/ `Infantry_victory`. The body kept its own identity, 24 bones, 7 meshes and 279,075 triangles.

One real bug fell out of this pass: the state machine only swaps a clip when the target action
changes, so an idle that had been stopped (clamped one-shot, mixer pause, reaction GLB landing
mid-action) stayed stopped until an unrelated state change. `human_fighter.js` now restarts the
looping idle when it is the selected state and is no longer running; one-shot reactions are
explicitly left alone so they cannot be restarted on their final frame.
