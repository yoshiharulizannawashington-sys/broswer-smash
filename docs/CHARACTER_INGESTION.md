# Drop-in character ingestion

`scripts/ingest-character.mjs` turns a third-party rigged character into a Browser Smash body
**without touching its geometry**. It is the counterpart to `assets/blender/build_anime_fighter.py`:
that script authors a character, this one prepares somebody else's.

Nothing is re-exported, re-skinned or re-baked. Every change lives in the GLB's JSON chunk, and the
binary chunk is copied byte for byte, so skin weights, UVs, textures and animation curves survive
exactly as the author made them.

## 1. Usage

```sh
node scripts/ingest-character.mjs --profile assets/ingest/quaternius-base-character.json
node scripts/ingest-character.mjs --profile assets/ingest/<name>.json --dry-run   # report only
```

Exit code is 0 only when the ingest gate passes. A failure prints the exact reason and leaves the
previously ingested file alone unless it got as far as writing.

## 2. What it does

| Step | Behaviour |
| --- | --- |
| Provenance gate | Refuses to run without `creator`, `license`, `provenance.sourceUrl` and `provenance.licenseUrl`. A body with no recorded licence is not ingestible by design. |
| Bone remap | Renames source bones to the names `public/js/anim/rig_map.js` classifies (`LeftArm`, `LeftForeArm`, `LeftUpLeg`, `Hips`, `Chest`, …). Comparison is punctuation-insensitive, so `DEF-upper_arm.L`, `DEF-upper_armL` and `mixamorig:LeftArm` can all be mapped by one profile. |
| Clip remap | Selects exactly seven clips and renames them `Idle`, `Walk`, `Run`, `Jump`, `Punch`, `Kick`, `Kamehameha`. Unmapped clips are dropped — otherwise a stray `Idle_Torch_Loop` could win the loader's substring match. |
| Facing / scale / ground | Parents the model's existing roots under one `ingest_root` node carrying a uniform scale to `targetHeight` and a translation that puts the lowest vertex at y = 0. The source's own transforms are untouched. |
| Provenance in the file | Writes `asset.copyright` and `asset.extras.browserBrosIngest` into the GLB, plus a `<name>.provenance.json` sidecar next to it. |
| Verification | Re-loads its own output and fails unless: all 19 canonical bones bind, feet are within 2 cm of 0, the height matches, and all seven states are present. |

## 3. Profile schema

```json
{
  "id": "quaternius_base",
  "source": "artifacts/dev/ingest-source/base-character.glb",
  "output": "public/models/characters/ingested/quaternius_base.glb",
  "targetHeight": 1.78,
  "creator": "Quaternius",
  "license": "CC BY 3.0",
  "provenance": { "sourceUrl": "…", "licenseUrl": "…", "attribution": "…", "notes": "…" },
  "boneMap": { "DEF-upper_arm.L": "LeftArm", "…": "…" },
  "clipMap": { "Idle": "Rig|Idle_Loop", "…": "…" },
  "clipNotes": { "Kick": "why this substitution is not a real kick" }
}
```

`clipMap` is **game state → source clip**. `clipNotes` is where any substitution is admitted in
writing; a stand-in clip must never be described as the real move.

### Naming traps this pipeline exists to avoid

Two real failures happened while building it, both worth knowing:

1. **Renaming a forearm to `leftFore` detached it.** The rig classifier matches keywords, so
   `leftFore` contains neither "forearm" nor "arm" and bound to nothing — 15/19 bones. The correct
   target names are semantic (`LeftForeArm`).
2. **Renaming a thigh to `leftLeg` turned it into a second shin.** `/leg/` classifies as shin, so the
   thigh disappeared and `leftLeg` went missing. Thighs must be `LeftUpLeg`.
3. **Bones whose names already classify correctly should not be renamed by guesswork.** The model's
   hips/neck/head are `DEF-hips`/`DEF-neck`/`DEF-head`; the profile must use those exact source keys,
   otherwise the rename silently falls back to keyword classification (which happened until the
   profile was corrected, at which point all 19 renamed explicitly).

## 4. Review it in a real match

Any manifest entry can be loaded as a review body without touching the roster:

```
http://localhost:3000/?showcaseCharacter=<manifestKey>
```

or `localStorage.browserSmashShowcaseCharacter = '<manifestKey>'`. `human_fighter.js` resolves that
key through the normal manifest path, so the same loader, mixer, retargeting and ground alignment are
exercised. Verification harness: `artifacts/dev/verify-ingested.mjs <key> [fighter]` — it reports
mounted bones, bound clips, feet/head height, live bone motion, screenshots and any console or
network errors.

## 5. Current result: Quaternius "Animated Base Character" (CC BY 3.0)

```
ingest:   19/19 canonical bones bound   renamedBones 19   height 1.780   feetY 0.000
          clips: Idle, Walk, Run, Jump, Punch, Kick, Kamehameha
          source 2,266,136 bytes -> output 2,017,660 bytes (binary chunk unchanged)
geometry: FAILED — 6,584 zero-area triangles (Mannequin_2 6,580, Mannequin_1 4) of 13,744
live:     loads in a practice match, 53 bones, 17 bones moving over 0.9 s, feet grounded,
          no console errors, no failed requests
visual:   generic yellow mannequin, 2 flat materials, no texture maps; faces -Z, so the manifest
          carries yawOffset 180. Not an art-direction pass and not promoted to the roster.
```

## 6. Limits

- It cannot fix bad geometry. Zero-area triangles, inside-out faces and collapsed volumes are the
  author's export and must be repaired in Blender (or the asset rejected).
- It does not synthesise missing animation. A pack with no kick gets a documented substitute, or it
  waits for a real clip.
- It does not retarget motion between skeletons. Bones are renamed, not re-solved: if the source clip
  was authored in a different rest pose, the pose will be wrong and needs Blender-side correction.
- Scale/ground are applied as a wrapper node, so a consumer that ignores the GLB scene hierarchy (or
  reparents the mesh without the wrapper) loses them.
