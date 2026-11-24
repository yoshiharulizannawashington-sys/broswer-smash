# Vegeta — Ultra Ego body + 25-clip retarget

Status: **LIVE ACCEPTANCE COMPLETE — 13/13 IN A REAL MATCH.**
This is not a claim that every animation is production-quality.

## What changed

- Supplied body: **(RIGGED) Vegeta Ultra Ego (DBFZ)**, shamus, CC BY 4.0.
- Source preserved at `artifacts/asset-fetch/1109297eb49c4500897ca831ddd78c9d/`.
- Source layout converted to a single GLB with `scripts/gltf-to-glb.mjs` without re-exporting or
  rewriting geometry, skin weights, materials or texture pixels:
  `artifacts/vegeta-ultra-ego/vegeta_source.glb` (2,682,188 B).
- Animation donor: the existing authored Vegeta body,
  `public/models/characters/roster/vegeta.glb` (19 bones, 25 clips).
- Baked result: `public/models/characters/roster/vegeta_ultra_ego.glb` (2.9 MB) via
  `scripts/rig-clips-to-body.mjs retarget ... --calibrate-arms`.
- The authored body is retained unchanged as the manifest `rollbackUrl`.

## Supplied body / baked result

| property | value |
| --- | --- |
| joints | 311 |
| nodes | 324 |
| skinned meshes | 3 (repaired; transparent duplicate removed) |
| source triangles | 29,102 |
| promoted vertices | 23,415 |
| promoted triangles | 27,106 |
| materials | 4 |
| embedded textures | 3 PNG (body, decal, decal variant) |
| source clips | 0 |
| baked clips | 25 |
| mapped canonical joints | 19 / 19 |
| unresolved target nodes | 0 |
| retarget fps | 30 |
| root motion | omitted; gameplay owns position |
| grounded correction | one constant pelvis lift per grounded clip |
| source height | 1.808 m (Blender inspection, feet at 0) |
| GLTFLoader bounds | 1.596 m, lowest point −0.036 m; the runtime mount normalises height and ground contact |

Every baked clip has 20 channels: 19 bone rotations plus one pelvis translation. Clip names are
unchanged from the donor set: `idle walk run sprint jump land dodge charge beam launcher jab
heavy_punch block hit_light hit_heavy knockdown get_up fly hover air_attack parry strafe throw
victory defeat`.

## Rig mapping

The DBFZ skeleton uses `G_*` / `GD_*` names. The shared classifier needed explicit handling for:

- `G_lowarm_L/R` → `leftFore` / `rightFore` (the broad `arm` rule previously called it an upper arm);
- `G_stomach` → `spine` (`G_chest` takes the torso slot; the waist remains under the pelvis chain).

Other mapped slots: `G_pelvis` → pelvis; `G_waist` is left to the pelvis chain; `G_chest` → torso;
`G_neck`/`G_head`; `GD_clavicle_*` → clavicle; `G_uparm_*` → upper arm; `GD_hand_*` → hand;
`G_thigh_*` → thigh; `G_calf_*` → shin; `GD_foot_*` → foot. Fingers, face, tail, scouter and armour
bones are preserved at their rest transforms and inherit the mapped chain.

## Honest defects / limits

- The 25 clips are hand-authored starter animation, not motion capture. Retargeting preserves
  timing and rotation, not the donor's exact silhouette on a 311-joint body.
- Finger, face, tail and armour bones are not animated, so the hands/face remain in bind pose.
- `inspect-character-glb.mjs` now reports **0 open boundary edges and 0 non-manifold edges** on the
  repaired promoted mesh (budget 80), down from 407 / 3,862. The repair removed the fully transparent
  duplicate `Object_9` face overlay and capped loops with existing vertices; no vertex was added. The
  supplied original is preserved in `artifacts/source-topology-before/`, with the repaired copy and
  measurements in `artifacts/source-topology-after/`.
- The source's face material has a transparent base-color factor; the embedded textures and
  materials are preserved byte-for-byte, but the rendered face must be checked in the game.
- Runtime acceptance is **complete for the requested scope**: in a real Vegeta vs Goku match the
  HUD read `VEGETA`, the body mounted with 25 clips, idle/keyboard walk/keyboard jump selected the
  expected clips, a jab dealt 11.3%, GALICK GUN dealt 22 damage, `hit_light` played after a real
  hit, and all 25/25 baked clips moved the skeleton (minimum 19 bones). Vegeta's hands are free
  (`KI STRIKE`); the oversized energy-gauntlet prefab was removed.
- Evidence: `artifacts/imported-migrations/vegeta/`, `artifacts/imported-migrations/run-vegeta.log`
  and `docs/IMPORTED_MIGRATIONS_ACCEPTANCE.md`. The source remains a low-poly DBFZ-style body; this
  pass proves playability, not film-quality deformation.
