# Goku — zero-area triangle repair

Date: 2026-11-13. Runtime body: `public/models/characters/bespoke/goku_body_face_rigged.glb`.

## Defect

`npm run test:roster-models` failed with **444 zero-area triangles**. The derived face-rigged GLB
contains 14 meshes, 4 skins and nine morph-target meshes; the invalid triangles were in its index
buffer, not a missing body or a broken skin.

## Repair

The game's existing imported-GLB finalizer was used unchanged:

```sh
node scripts/finalize-imported-glb.mjs \
  public/models/characters/bespoke/goku_body_face_rigged.glb \
  artifacts/character-repair/goku_body_face_rigged.repaired.glb
```

It filters index triples whose position cross-product is below `1e-9`, then writes the cleaned
index buffer back into the same GLB. Skin indices/weights, UVs, normals, materials, morph targets
and the node hierarchy are untouched; no height normalisation was requested. The pre-repair
derived file is archived at `artifacts/character-repair/goku_body_face_rigged.pre-repair.glb`.

Reported: `degenerateRemoved: 444`, 3,622,016 bytes, height 1.9305 m, feet −0.015 m, 14 meshes,
4 skins, nine morph meshes (same structure as before).

## Verification

`npm run test:roster-models` → **OK: every roster fighter mounts a fully bound, animated model**
(38/38). Goku reports 4 skinned meshes / 14 meshes and no zero-area failure. The validator was not
weakened or excluded. This is a parse/rig gate; the live match was not re-captured in this pass.
