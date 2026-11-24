# Browser Bros — remaining imported migrations: live acceptance

Date: **2026-11-11**. Branch: `freebuff/726ce0c51041fd4f569ce7bd`.

Scope: complete the four outstanding imported-character migrations before the first showcase-world
reconstruction. No showcase world was rebuilt in this pass.

## Result

All four targets were selected through the real character-select path, mounted in a real match and
driven with keyboard input by `scripts/verify-imported-migrations.mjs` under
`bash scripts/run-browser-test.sh`. Each run is **13/13 checks, exit 0**.

| Target | Stable slot | Promoted body | Clips | Equipment | Jab | Signature | Reaction | Clip sweep |
| --- | --- | --- | ---: | --- | ---: | --- | --- | --- |
| Vegeta | `vegeta` | `roster/vegeta_ultra_ego.glb` | 25 | hands free (`KI STRIKE`) | 11.3% | GALICK GUN · 22 | `hit_light` | 25/25 |
| Light Yagami | `l_death_note_style` | `imported/light_yagami_rigged/light_yagami_rigged.glb` | 25 | `Light · Death Note` book | 7.3% | NAME IN THE NOTEBOOK · 8 | `hit_light` | 25/25 |
| Harry Potter | `lord_voldemort` | `imported/harry_potter/harry_potter_animated.glb` | 25 | `Harry · Wand` | 9.2% | EXPECTO PATRONUM · 20 | `hit_light` | 25/25 |
| T-800 | `arnold_schwarzenegger` | `imported/t800/t800_animated.glb` | 25 | `T-800 · heavy shotgun` | 26.9% | CYBERNETIC CANNON · 19 | `hit_light` | 25/25 |

Each target also passed: idle action on the mounted mixer, keyboard walk, keyboard jump, the live
HUD display name, its own moveset key, and a real damage-producing jab. The signatures were checked
through `window.__browserSmashLastShot`, the projectile/beam/curse state and the opponent's damage,
not from the label alone. The hit reaction was checked through the selected `hit_light` clip.

The imported bodies use the legacy mixer rather than `fighter.animationController`; the harness
therefore reads `model.userData.currentClip` / `lastMoveAction`, which is the path that actually
drives these bodies. Reading only the controller would have produced false failures.

The HUD now resolves `fighter.displayName` before the stable identity. Visible names are `VEGETA`,
`LIGHT YAGAMI`, `HARRY POTTER` and `T-800`; the chip width was widened so the longer names are not
ellipsized at the 1366-pixel acceptance viewport.

## Evidence

Per target, under `artifacts/imported-migrations/<target>/`:

- `01-idle.png` … `06-hit-reaction.png`
- `evidence-01-idle.json` … `evidence-06-hit-reaction.json`
- `clip-matrix.json` (25 actions, moved-bone counts and maximum bone rotation)
- `result.json` (mount, equipment, matrix and evidence)

Run logs: `artifacts/imported-migrations/run-vegeta.log`, `run-light.log`, `run-harry.log`,
`run-t800.log`.

Other gates, logged under `artifacts/imported-migrations/gates/`:

- roster models **38/38** (all bodies parse, are skinned and report clips);
- character scale **37/37**;
- equipment state **30/30**;
- animation pipeline **263 checks**;
- solo-rig lanes **134/134 body clips** (Hulk's four non-body findings are pre-existing and unchanged);
- movesets **91/91**, including every launch fighter's live form and ultimate;
- `npm run validate:assets` passed; `npm run build` passed (Vite, 123 modules).

## Source and visual limitations

These are recorded, not hidden:

- **Vegeta** and **T-800** source geometries were repaired on 2026-11-13 to 0 / 0 welded
  open-boundary and non-manifold edges, with no vertices added; the supplied originals are preserved in
  `artifacts/source-topology-before/` and the before/after review is
  `artifacts/a1-combat/source-topology-review.json`. **Harry** still has 498 inherited open boundary
  edges. Runtime rig validation and the live matrices pass.
- T-800 is the 53-joint Sketchfab endoskeleton, normalised from 2.059 m to 1.88 m. Four spec/gloss
  materials were converted to metallic/roughness. The supplied heavy shotgun is the equipped prop;
  the generic procedural fallback would be a blaster, but the live prefab is the shotgun.
- Harry is the 68-joint supplied body. Four zero-area source triangles were removed; 25 clips were
  baked with `--calibrate-arms` (19/19 slots, 0 unresolved). The wand is scaled to hand size.
- Vegeta's Ultra Ego source is a 311-joint DBFZ-style mesh with intentionally simple starter clips.
  Fingers, face and armour bones remain at rest; the 25 clips are hand-authored, not motion capture.
- Light's stable slot and save key remain `l_death_note_style`; only the player-facing identity,
  moveset, abilities and Death Note prop changed. The body is the already-promoted imported
  Light Yagami rig.
- `public/js/anim/shared_rig_family_data.js` remains the **legacy donor-rig audit table**: its
  “L (Death Note Style)” / “Lord Voldemort” labels and authored donor URLs describe the rigs used
  for animation transfer, not the promoted runtime bodies. Runtime identity and model resolution
  come from `public/models/characters/manifest.json` plus `FIGHTER_DISPLAY_ALIASES`.
- No commit, push, reset, clean, stash or amend was performed. All work remains uncommitted.
