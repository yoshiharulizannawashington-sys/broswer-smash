# Miles Morales + Iron Spider animation merge

Status: **MERGED AND LIVE-WIRED.** Miles Morales keeps his exact promoted model and all 26
existing clips. The complete 57-clip Iron Spider animation library is retargeted onto his
178-joint skeleton and appended under an `IronSpider__` prefix.

This is an **animation-library merge with a live selection pass**. Locomotion, idle, walk, run,
jump and land remain on Miles's original clips. His attacks and reaction/defensive states now
select the retargeted Iron Spider clips through the normal input path. The file still contains
all 26 original clips under their original names, unchanged.

## Files

| Item | Value |
| --- | --- |
| Runtime body | `public/models/characters/imported/miles_morales/miles_morales_animated.glb` |
| Runtime SHA-256 | `77a4ed1d0a30292c5f51cd1f34d98d91016547d99cb0169136d9032b2fcef577` |
| Runtime bytes | 6,384,724 |
| Pre-merge backup | `public/models/characters/imported/miles_morales/backup/miles_morales_pre_iron_spider_20261113.glb` |
| Backup SHA-256 | `5974879f1854089fc58ce61fce63d7e63582addede8528dd4be12837d35f38f3` |
| Animation donor | `public/models/characters/iron_spider/iron_spider_source_animated.glb` |
| Donor SHA-256 | `08124a094f6c3faa216ad0f238cb1422935042b01a89254dbd2183eccab0186d` |
| Retarget tool | `scripts/rig-clips-to-body.mjs` |
| Static verifier | `scripts/verify-miles-iron-spider-animations.mjs` |
| Retarget log | `artifacts/miles/iron-spider-animation-merge/retarget.log` |
| Static report | `artifacts/miles/iron-spider-animation-merge/verification.json` |

## What changed

The promoted Miles GLB was used as the target. The merge **only appends animation entries**:

- **26 -> 83 clips**: 26 original Miles clips + 57 Iron Spider clips.
- All original animation JSON objects are byte-for-byte unchanged and remain at the front of the
  animation list.
- All original accessors, buffer views and the original 5,045,692-byte binary payload remain an
  exact prefix of the merged file.
- The mesh, skin, node, material, texture and image JSON sections are unchanged.
- Geometry remains **3 skinned meshes, 7,945 vertices, 14,356 triangles, 178 joints**.
- The model is still 1.657 m tall with feet at 0; no geometry, material, texture or skin weight was
  re-exported.

The 57 added clips are prefixed:

```text
IronSpider__Armature|hero_spiderman01_S05@atk-01
...
IronSpider__Armature|hero_spiderman01_S05@walk
IronSpider__idle
IronSpider__walk
...
IronSpider__victory
```

The prefix prevents the donor's generic `idle`, `walk`, `run`, `jump`, `victory` and similar names
from colliding with Miles's existing clips.

## Retarget

Donor rig: **107 joints** (MFF `Bip001` + 21 mechanical appendage bones).
Target rig: **178 joints** (Miles).

- **19/19 canonical slots mapped, 0 missing** on every one of the 57 clips.
- Each added clip has **20 channels**: 19 canonical joint rotations plus the pelvis translation
  track that keeps the retargeted pose grounded.
- Mapping:
  - `Bip001_Spine_012` -> `spine_01_142_12`
  - `Bip001_Spine1_014` -> `spine_02_141_13`
  - `Bip001_Pelvis_03` -> `pelvis_173_11`
  - `Bip001_{L,R}_{Thigh,Calf,Foot}...` -> the matching Miles leg bones
  - `Bip001_{L,R}_{Clavicle,UpperArm,Forearm,Hand}...` -> the matching Miles arm bones
  - `Bip001_Neck_040` / `Bip001_Head_041` -> `neck_01_36_19` / `head_34_21`
- The MFF trunk mapping was corrected in `public/js/anim/bind_pose_retargeter.js`: the trailing
  exporter id on `Bip001_Spine_012` is not a semantic spine index. Without that fix the retarget
  mapped only 17/19 joints and dropped the lower spine.
- The 21 Iron Spider mechanical-leg bones have no counterpart on Miles. Their rotation and
  translation tracks are deliberately not invented or remapped; Miles therefore plays the body
  motion of the Iron Spider clips, without the Iron Spider appendages.
- Two donor clips (`collection` and `skill07-03`) are preserved static source poses from the
  original asset. `collection` is zero-duration and is skipped by the existing static-clip guard;
  `skill07-03` has a two-second duration and is loaded, but has no temporal motion and is not
  selected by a state.

## Live result

`scripts/verify-spider-man-import.mjs` was run against the merged body through the real roster
selection and live match path:

- **24/24 checks passed**, **0 page errors**.
- Mounted asset: `/models/characters/imported/miles_morales/miles_morales_animated.glb`.
- 3 skinned meshes, 178 bones, 14,356 triangles, runtime validation `{ ok: true, issues: [] }`.
- **83 clips** in the body: 26 original + 57 Iron Spider.
- **82 playable actions** on the live mixer: 26 original + 56 Iron Spider actions. The zero-duration
  `collection` pose is skipped by the existing static-clip guard; `skill07-03` remains loaded but
  is a static source pose. The existing `spider_man_web_zip` authored action remains separate.
- All 26 original actions are present by their original names (`FearlessFlight_Male_idle`, `jab`,
  `heavy_punch`, `walk`, `run`, `jump`, `victory`, `defeat`, etc.).
- All 56 playable new actions are present under `IronSpider__`; the 57th GLB clip is the skipped
  `collection` pose.
- The original Spine chain, textures, movement, attack, reactions, victory and full best-of-three
  flow still pass.
- Normal J plays `@atk-01`; heavy (`Shift+J`) plays `@skill02-03`; airborne J plays `@skill04-02`;
  a live grab uses `@skill04-02` for the throw; light hitstun uses `@hit`; airborne heavy hit uses
  `IronSpider__knockdown`; recovery uses `IronSpider__get_up`; victory uses `@succ_cam`.

## Live attack and reaction selection

`public/js/anim/animation_manifest.js` now maps Miles's combat slots to the retargeted donor
clips. `public/js/human_fighter.js` binds those clips synchronously from the actions already on
the mounted mixer, so the first input of a round does not race a second GLB fetch:

| State | Selected clip |
| --- | --- |
| Light chain | `@atk-01`, `@atk-02`, `@skill01-01`, `@skill01-02`, `@skill02-01` |
| Finisher / heavy | `@skill02-02`, `@skill02-03` |
| Launcher / slam / heavy finisher | `@skill03-01`, `@skill03-02`, `@skill04-01` |
| Air / air finisher | `@skill04-02`, `@skill05` |
| Counter / special / ultimate | `@skill07-04`, `@skill07-02` |
| Grab / throw | `@skill05`, `@skill04-02` |
| Hit light / hit heavy / knockdown | `@hit`, `@stun`, `IronSpider__knockdown` |
| Get up / victory / defeat | `IronSpider__get_up`, `@succ_cam`, `@die` |
| Block / dodge / parry | `IronSpider__block`, `IronSpider__dodge`, `IronSpider__parry` |

Idle, fighting idle, walk, run, sprint, jump, fall and land stay on Miles's original clips. The
imported strike table is merged after the procedural kit actions, so the donor heavy, special and
ultimate cannot be replaced by the older web/procedural fallback. The strike latch also includes
the resolved move signature, so a fresh heavy input is selected even if the queue was cleared
between render frames.

The live import log is `artifacts/miles/iron-spider-animation-merge/live-import.log`.

A second live probe pauses the match, plays the new `atk-01` action directly on the mounted Miles
mixer, and measures the wrist moving **171.19 degrees** while the body remains visible:
`scripts/verify-miles-iron-spider-playback.mjs` (6/6, no errors). Capture:
`artifacts/miles/iron-spider-animation-merge/live/iron-spider-clip-on-miles.png`.

## Gates

| Check | Result |
| --- | --- |
| `node scripts/verify-miles-iron-spider-animations.mjs` | **13/13 PASS**; model payload and all 26 original clip payloads unchanged |
| `node scripts/inspect-character-glb.mjs` on the merged body | PASS; 83 clips, 178 bones, 14,356 triangles, 1.66 m |
| `bash scripts/run-browser-test.sh scripts/verify-spider-man-import.mjs` | **24/24 PASS**, 0 page errors |
| `bash scripts/run-browser-test.sh scripts/verify-miles-iron-spider-playback.mjs` | **6/6 PASS**; wrist 171.19°, no errors |
| `npm run build` | PASS |
| `npm run test:roster-models` | PASS, 38/38 fighters; Spider-Man 83 clips |
| `npm run test:animation` | PASS, 280 checks |
| `npm run test:animation-coverage` | PASS, 91 checks |
| `npm run test:rig-solo` | PASS, 134/134; 0 failed clips |
| `git diff --check` | clean |

## Reproduction

```sh
# Backup first. The target supplied to the retarget is the pre-merge file.
node scripts/rig-clips-to-body.mjs retarget \
  public/models/characters/iron_spider/iron_spider_source_animated.glb \
  public/models/characters/imported/miles_morales/backup/miles_morales_pre_iron_spider_20261113.glb \
  public/models/characters/imported/miles_morales/miles_morales_animated.glb \
  --append --prefix=IronSpider__

node scripts/verify-miles-iron-spider-animations.mjs
bash scripts/run-browser-test.sh scripts/verify-spider-man-import.mjs
bash scripts/run-browser-test.sh scripts/verify-miles-iron-spider-playback.mjs
```

## Limits

- Locomotion and the web-kit casts remain on Miles's original clips; the live combat selection
  covers melee attacks, air/throw states and reactions. Applying donor clips to locomotion or the
  web-kit casts would be a separate presentation decision.
- The retarget transfers body-joint motion only. Iron Spider's mechanical appendages and their
  weighted mesh are not part of Miles and are not fabricated onto him.
- `collection` is skipped as zero-duration and `skill07-03` is loaded but static; both remain
  preserved, matching the donor's existing forensic finding.
- Captures from the browser suite are SwiftShader composition evidence, not hardware-GPU or
  performance verification.
- No commit, push, reset, clean or stash was performed.
