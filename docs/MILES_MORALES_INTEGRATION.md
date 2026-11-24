# Miles Morales — promoted Spider-Man body

Status: **BONE-MAPPED 19/19 AND VERIFIED IN A LIVE BROWSER MATCH (21/21 checks), INCLUDING THE
AERIAL, THROW, HIT-REACTION, KNOCKDOWN, GET-UP AND VICTORY CLIPS.**
This is not a claim that every Spider-Man category, reaction or damage state is complete: heavy
reactions, defeat, combo/ultimate damage and a full best-of-three match remain outstanding.

## Identity and files

| Item | Value |
| --- | --- |
| Existing roster slot | `spider_man` |
| Display identity | **Spider-Man** (unchanged; no Miles roster entry) |
| Runtime body | `public/models/characters/imported/miles_morales/miles_morales_animated.glb` |
| Runtime bytes | 6,384,724 |
| Runtime SHA-256 | `77a4ed1d0a30292c5f51cd1f34d98d91016547d99cb0169136d9032b2fcef577` |
| Rollback | `/models/characters/imported/spider_man_rigged/spider_man_rigged.glb` (the previous 19-joint, 25-clip body) |
| Source archive | `artifacts/asset-fetch/ee031644239745028ce6b19a3d9ee0f7/model.zip` |
| Source author | KenzoDkohno2013 (Sketchfab), CC BY 4.0 |
| Geometry | 3 skinned meshes, 7,945 vertices, 14,356 triangles |
| Skeleton | 178 joints, 19/19 canonical gameplay slots bound |
| Clips | **83**: 26 Miles clips (supplied `FearlessFlight_Male_idle` + 25 retargeted gameplay clips) + 57 retargeted Iron Spider clips |
| Height / ground | 1.657 m (inspector), feet at 0; runtime placement scales to the 1.78 m stage target |

The source is a `.gltf` with external textures, not a GLB. It was packed into a self-contained GLB
without rewriting geometry or skin weights. The supplied materials use the unsupported
`KHR_materials_pbrSpecularGlossiness` extension and have black diffuse factors, so they were
converted to `pbrMetallicRoughness` using the two supplied textures as base-color maps. The
conversion is a compatibility step, not a claim that the source material model was preserved
byte-for-byte. The textures are embedded (2048×2048 body, 2048×1024 face/default) and render in
the live match.

## Retarget

- Donor: `public/models/characters/imported/spider_man_rigged/spider_man_rigged.glb` (19 joints,
  25 clips).
- Original output: 26 clips on the Miles skeleton, produced by `scripts/rig-clips-to-body.mjs retarget ...
  --append --calibrate-arms`; all 57 Iron Spider clips were later appended under `IronSpider__`.
- **Bone map: 19/19 canonical slots, `missing: []` on every clip.** Report:
  `artifacts/miles/prepared/retarget-spinefix.log`.
- The first bake was **not** a complete map: it recorded `missing: ["spine"]` on all 25 clips.
  `trunkKey()` in `public/js/anim/bind_pose_retargeter.js` read the exporter's trailing bone id
  (`spine_01_142_12`) as the spine index, so all five Miles segments classified as `torso`; the
  lowest bone took the only torso slot and the donor `Chest` drove it, while the donor `Spine`
  track had no destination at all. The index is now parsed from the number immediately after
  `spine`, so `spine_01` fills `spine` and `spine_02` fills `torso`, and both carry a track in all
  25 retargeted clips. `spine_03`–`spine_05` inherit `torso` and keep their bind rotation.
- The retarget target is the packed, pre-material-conversion runtime GLB, so the re-baked file had
  its material/texture JSON restored from the promoted body: all three materials reference the
  supplied base-colour textures again (body 0, face/default 1) with `metallicFactor 0` and
  `roughnessFactor 0.55`.
- The supplied idle is retained as `FearlessFlight_Male_idle`; the 25 gameplay clips are appended.
- Inspector after the Iron Spider merge: `OK: 3 mesh(es), 3 skinned, 178 bones, 83 clips, 14356 triangles, 1.66 m tall`.

## Live verification

### Browser E2E — 21/21 checks (current merged body)

`scripts/verify-spider-man-import.mjs` was run through `scripts/run-browser-test.sh` on
and passed **21/21**, exit 0 (`artifacts/miles/iron-spider-animation-merge/live-import.log`):

- the select preview and the live match both mount the 178-joint Miles body (3 skinned meshes,
  14,356 triangles) through the roster path, with runtime validation `{ ok: true, issues: [] }`;
- 27 loaded actions (26 clips + web zip) carry a spine destination track, and all five spine bones
  are present;
- a J press resolves to `light1` / `jab`, moves the mounted wrist about 0.18 m and deals **8.12%**
  to the CPU; the live torso moves during that strike (`spine_01` about **15.7°**, `spine_02`
  about **29.6°**);
- both supplied textures are attached (4 texture references across all 3 materials);
- the HUD names Spider-Man and the run produced no page or request errors.

#### Clip matrix

Each clip is selected by the live state branch that owns it, and each check also records the
largest bone-quaternion change between samples, so a bind pose or missing action cannot pass on
the clip name alone.

| State | How it was driven | Selected clip | Measured evidence |
| --- | --- | --- | --- |
| Aerial | real Space, then real J while airborne | `air_attack` | airborne 1.64 m above ground; 180° pose delta |
| Throw | real U grab at melee range | `throw` | grab/held target true; 180° pose delta |
| Light reaction | live `hitstun` field (0.4 s) | `hit_light` | hitstun active; 180° pose delta |
| Knockdown | live `hitstun` + airborne launch | `knockdown` | 1.85 m above ground; 180° pose delta |
| Get-up | landed, stun-spent `wasKnockedDown` recovery state | `get_up` | `getUpTime` 0.65 s remaining; 180° pose delta |
| Victory | live `victoryPose` field | `victory` | `victoryPose` 1; 90° pose delta |

The aerial check exposed a real selector defect: Miles' imported manifest maps airborne to
`air_attack`, but `human_fighter.js` asked the generic authored table first, which returned the
ground `light3`/jab slot. Airborne strikes on a body that owns an air clip now bypass the authored
and airborne `light4` fallbacks so the live air branch plays its own `air_attack`.

- Captures: `artifacts/spider-man-import/1-select-spider-man.png`,
  `2-match-spider-man.png`, `3-attack-spider-man.png`, `4-aerial-spider-man.png`,
  `5-throw-spider-man.png`, `6-hit-reaction-spider-man.png`,
  `7-knockdown-spider-man.png`, `8-get-up-spider-man.png`,
  `9-victory-spider-man.png`.

### Manual probe — 2026-11-11 (historical, before the Iron Spider merge)

The live select preview and a real Spider-Man vs Goku match were driven in the Cloud browser at
`https://pv-726ce0c51041-80b4e8b5-3ab8-4e46-9b2f-5a51e4837c9a.style.dev/`.

- Asset status: `loaded`; URL is the Miles runtime GLB; runtime validation `{ ok: true, issues: [] }`.
- Mounted: 3 skinned meshes, 178 bones, 27 action bindings (26 clips + existing web-zip action) in the pre-merge body.
- Reaction binder: all 19 slots bound, `missing: []`; idle action `FearlessFlight_Male_idle`.
- Strike binder: all 20 attack slots bound, `missing: []`.
- Input-driven playback observed through the real input handler:
  - idle — supplied clip
  - walk — `walk`
  - sprint after dash — `sprint`, 12.54 m/s
  - jump — `jump`, 0.83 m rising / 1.92 m falling
  - landing — grounded again; returns to supplied idle
  - block — `block`
  - dodge — `dodge`
  - light attack — `jab`, 0.442 m right-hand travel, 8.12% damage, 0.30 s hitstun
  - heavy — `heavy_punch`, 15.3% damage
  - special — `beam`
  - ultimate — `beam` beneath `MAXIMUM WEB TAKEDOWN`, meter spent to 0; the probe did not deal damage
    (range/target state in that probe), so ultimate damage is **not** claimed
- Evidence:
  - `artifacts/miles/live-select.png`
  - `artifacts/miles/live-front-clean.png`
  - `artifacts/miles/live-front-face.png`
  - `artifacts/miles/live-jab-peak.png`
  - `artifacts/miles/prepared/promoted-inspect.log`
  - `artifacts/miles/prepared/retarget.log`

The close-up captures use the same live mounted fighter and a public spectator camera; P2 was moved
or hidden only for composition. They are software-rendered Cloud-browser captures, not hardware or
performance evidence.

## Gates run

| Check | Result |
| --- | --- |
| `node scripts/inspect-character-glb.mjs` on the merged GLB | pass; 178 bones, 83 clips, 1.657 m, 14,356 triangles |
| `scripts/verify-spider-man-import.mjs` (browser match) | **21/21 checks, exit 0**; jab 8.12%, spine about 16.1°/25.1° |
| `npm run test:animation` | 249 checks passed |
| `npm run test:animation-coverage` | 91 checks passed |
| `npm run test:roster-models` | 38/38 fighters, Spider-Man 83 clips |
| `npm run validate:assets` | pass |
| `npm run build` | pass |
| `git diff --check` | clean |

## Iron Spider animation merge

All **57** Iron Spider clips have been retargeted onto the same 178-joint Miles skeleton and
appended under `IronSpider__`; the original 26 Miles clips and the model payload are unchanged.
This is an animation-library merge: the live state mappings still select the original Miles clips.
See `docs/MILES_IRON_SPIDER_ANIMATION_MERGE.md`, the 13/13 static report in
`artifacts/miles/iron-spider-animation-merge/verification.json`, and the 21/21 live import log.

## Remaining work / limits

- The harness covers one landed jab plus the aerial, throw, light-reaction, knockdown, get-up and
  victory branches. Hit-heavy, defeat, dodge timing, full combos and ultimate damage are still not
  captured, and the best-of-three match has not been played end to end for Miles.
- Only two trunk slots exist, so `spine_03`–`spine_05` follow `torso` instead of being driven
  independently; the captures are software-rendered (SwiftShader) and are composition evidence.
- The harness's earlier three failures were its own assumptions: it looked for a `RightHand`-style
  name (Miles uses `hand_r`), read the hidden legacy `#hud` instead of `#bbHudLayer`, and measured
  damage after the pair had drifted out of reach during a screenshot.
- The clip matrix proves clip selection and skeleton motion, not frame-by-frame animation quality:
  the knockdown capture is a launched airborne reaction rather than a fully prone body, and all
  captures are software-rendered (SwiftShader) composition evidence. The asset is not marked
  COMPLETE.
- The supplied texture's spec/gloss semantics were converted rather than preserved; inspect the
  body/face in a non-software renderer before treating appearance as final.
- Iron Spider's supplied `Object_122` arm mesh was repaired and mounted on 2026-11-11; the
  procedural fallback is no longer used. Full E2E/matrix remains outstanding.
- No commit, push, reset, clean, stash or amend was performed.
