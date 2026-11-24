# Browser Bros — Exact Character Model Import Report (Checkpoint)

Date: 2026-11-10
Branch: `freebuff/726ce0c51041fd4f569ce7bd`
Scope: Phase 1–2 of the supplied character specification — roster/asset audit and acquisition of the exact supplied Sketchfab models.
Not in this checkpoint: rig authoring, animation authoring/retargeting, gameplay promotion of most models, map realism work, combat-engine changes.

## 1. Acquisition result

- Blender 4.2.23 LTS is installed at `.tools/blender-4.2.23-linux-x64`; `bash scripts/blender.sh -b --version` works.
- 32 of the 32 downloadable supplied models are staged as raw GLBs under `artifacts/asset-fetch/<key>/<key>.glb`.
- Total staged size: **333.9 MB**, **3,385,306 triangles**, **2,531,663 vertices** across the 32 files.
- Two supplied models cannot be fetched without bypassing author-disabled downloads and were not bypassed:
  - Saitama — `94092067f03a47fe97f4575bd923e02e`
  - Hashirama Senju — `52c192ab8cd24eeda270b1dbae2bc743`
- The initial 14 HTTP 429 rate-limit failures were retried with backoff and all 14 downloaded successfully (`retry-report.json`, `retry.log`).
- Manifests/evidence:
  - `artifacts/asset-fetch/inventory.json` — per-file geometry, joints, animation count, materials, images, sha256.
  - `artifacts/asset-fetch/triangle-stats.json` — per-model triangles/vertices and totals.
  - `artifacts/asset-fetch/mount-check.json` / `mount-check.log` — structural mount gate result per model.
  - `artifacts/asset-fetch/download-report.json` / `retry-report.json` — download status.

## 2. Structural mount result — not animation readiness

The mount gate checks scale, orientation, feet/hip placement, silhouette and the eleven canonical Browser Bros joints. It is a structural gate only: a PASS does **not** mean the model has a usable animation set.

**27 PASS / 5 FAIL**

FAIL:

| Model | Reason |
| --- | --- |
| `injustice_collection` | Multi-character collection, silhouette not upright (1.71 × 2.05 × 10.49 m); must be split into individual characters. |
| `kratos_weapons` | Weapon/prop pack, not a single fighter silhouette (0.45 × 2.05 × 7.15 m); use for weapon extraction, not as a body. |
| `edna_mode` | Hip at 0.00 m and shin joints outside the body bounds. |
| `iron_spider` | Head only 0.02 m above the pelvis; hip at 2.02 m. Orientation/rest-pose repair needed. |
| `spider_man_alt` | Head only 0.00 m above the pelvis; hip at 1.60 m. Orientation/rest-pose repair needed. |

PASS but **no usable skeleton** (0 joints / 0 clips; requires Blender auto-rigging):
`wonder_woman`, `spider_man`, `light_yagami`, `madara`, `madara_alt`, `sasuke`, `thor`, `aang`.

PASS with a skeleton but **zero author clips** (needs animation authoring/retargeting):
`professor_x` (163 bones), `doctor_strange` (195), `edward_elric` (135), `levi` (105), `iron_man_mk85` (66), `mario` (91), `kratos` (105), `master_chief` (66), `jack_sparrow` (113), `goku_lightk` (395), `goku_oup77` (73), `luigi` (38), `link` (112), `all_might` (1 bone), `harry_potter` (68).

Models with author clips:

| Model | Clips |
| --- | --- |
| `hulk` | 19 |
| `iron_spider` | 32 (fails mount) |
| `spider_man_alt` | 20 (fails mount) |
| `green_lantern` | 4 |
| `naruto_monhoo` | 1 |
| `robot_police` | 1 |

`hulk` is byte-identical to the Hulk body already installed in the committed build, so the exact supplied Hulk is already live.

## 3. What is actually live in the game

- The committed 38-launch-fighter build is intact; no roster size, selection, combat or map system was changed.
- Three trial promotions were attempted:
  - **Professor X** — rejected. The supplied model is a 0.538 m seated figure/wheelchair prop; scaling the whole prop to 2.05 m produced a 2.47 m-wide chair (close-up evidence: `bb-professorx-close.png`). The manifest was restored to the existing procedural body.
  - **Edward Elric** and **Levi Ackerman** — structurally valid, but live visual acceptance did not complete (the showcase page stalled during load). Their manifest entries were restored to HEAD; their raw GLBs remain staged.
- No commit and no push. The staged GLBs live in `artifacts/asset-fetch/`, which is gitignored and is not part of the built bundle.
- Final known-good build: `npm run build` passes (117 modules, 1,860.89 kB JS, 13.71 s). `public/models/characters/manifest.json` has no diff from HEAD, so none of the rejected trial bodies are live.

## 4. Blockers and the next batch

1. **Rigging:** auto-rig the unrigged bodies in Blender 4.2.23, with weights and joint placement validated per model, not with one generic skeleton.
2. **Animation:** author/retarget the complete per-character set (idle, locomotion, jump/fall/land, light/heavy/aerial, block/dodge, hit reactions, knockdown/get-up, victory/defeat, weapon actions, abilities, ultimate). The current game can only procedurally animate the canonical joints, which is not the required animation set.
3. **Splitting:** split the Injustice collection into individual characters; extract Kratos' weapons from the prop pack; separate Professor X's body from the wheelchair.
4. **Repair:** fix `iron_spider` and `spider_man_alt` rest-pose/orientation, and `edna_mode` hip/shin bounds.
5. **Promotion:** promote only visually verified bodies into the manifest, one batch at a time, with a live match screenshot and real damage/KO evidence.
6. **Still blocked:** Saitama and Hashirama (author-disabled downloads).
7. **Maps:** not started in this checkpoint. The map realism pass comes after the character pipeline is proven, in the user-specified order Konoha → Valley of the End → Hogwarts → Asgard → New York → Helicarrier → Dragon Ball Z world.
8. **Fighting mechanics:** the shared combat engine already exists (frame data, hitboxes, damage, knockback, blocking, dodging, throws, KOs). The next work there is character-specific movesets/abilities on top of that shared engine, not a new engine per fighter.
