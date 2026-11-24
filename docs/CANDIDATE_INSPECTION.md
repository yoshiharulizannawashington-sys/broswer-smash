# Browser Bros — supplied candidate inspection (Batch 1)

Date: 2026-11-10. Every figure below was measured from the actual downloaded file with
`artifacts/roster-audit/gltf-summary.mjs` / `glb-summary.mjs`, not taken from the Sketchfab page.

Environment verified first:

- `bash scripts/blender.sh -b --version` → **Blender 4.2.23 LTS** (workspace install, `.tools/blender-4.2.23-linux-x64`).
- `node scripts/fetch-character-model.mjs --check-auth` → token accepted, authenticated downloads allowed.
- Downloads used `--stage-only`, so the archives are preserved under `artifacts/asset-fetch/<uid>/`
  and nothing has replaced a production manifest entry.

## 1. Downloaded primary candidates

| Fighter / slot | Supplied model | Author · licence | Geometry | Rig | Shipped clips | Native bounds | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Naruto Uzumaki / `naruto_uzumaki` | [Naruto Sage](https://sketchfab.com/3d-models/naruto-sage-161369399a0d4b6e9657023a1bcbfb31) | ninjatorrent · CC-BY | 4,316 tris · 2,420 verts · 3 meshes · 3 materials · 3 textures | **none** (0 skins, 5 nodes) | **0** | 0.534 units tall | Downloaded. Unrigged static scene. Needs an authored humanoid rig, weights and the full 19+ state animation set. Not a drop-in replacement. |
| Spider-Man / `spider_man` | [Miles Morales rig](https://sketchfab.com/3d-models/miles-morales-rig-rigged-bone-free-ee031644239745028ce6b19a3d9ee0f7) | KenzoDkohno22T · CC-BY | 14,356 tris · 7,207 verts · 3 meshes · 2 textures | 178 joints, 196 nodes | **1** (`FearlessFlight_Male_idle`) | 1.669 m, feet at 0 | Downloaded. Real rig, one supplied idle. **Bone-mapped:** 19/19 canonical slots with the supplied idle retained, and the spine chain verified during a landed jab in a live browser match. Do not add a Miles roster entry. |
| Vegeta / `vegeta` | [Ultra Ego Vegeta (DBFZ)](https://sketchfab.com/3d-models/rigged-vegeta-ultra-ego-dbfz-dbs-manga-1109297eb49c4500897ca831ddd78c9d) | shamus · CC-BY | 27,106 tris · 23,415 verts · 3 meshes · 3 textures (repaired) | 311 joints, 324 nodes | **25 retargeted** (source 0) | 1.808 m, feet at 0 | **PROMOTED + LIVE 13/13:** supplied mesh/materials/textures preserved; 25-clip roster set baked onto the 311-joint skeleton (19/19 slots, 0 unresolved). Hands free; Galick Gun deals 22. |
| Arnold / `arnold_schwarzenegger` | [T-800 Terminator 2](https://sketchfab.com/3d-models/t-800-blood-yes-rigged-bone-terminator-2-b72e4bad70084e53b38f139f0d9bf178) | KenzoDkohno22T · CC-BY | 21,535 tris · 21,874 verts · 4 meshes · 4 textures (repaired) | 53 joints, 73 nodes | **0** | 81.06 units (cm scale), feet ≈ 0 | **PROMOTED + LIVE 13/13:** normalised to 1.88 m, four PBR conversions, 25 clips, heavy shotgun, HUD `T-800`. |
| Iron Spider / `iron_spider` | [Iron Spider — Infinity War](https://sketchfab.com/3d-models/iron-spider-avengers-infinity-war-99e52e57a8dc4feda750af87b87d2955) | Kabiidev · CC-BY | 5,795 tris · 3,130 verts · 6 meshes · 4 textures | **107 joints** | **32** | 54.264 units, feet at −50.152 | Downloaded **and already present** at `public/models/characters/iron_spider/iron_spider.glb`. Prepared build exported to `artifacts/iron-spider/prepared/iron_spider_normalized.glb`: 1.85 m, feet at 0, **32/32 clips and 107 joints retained**. Not yet mounted in the game; native scale/pivot caused the earlier runtime rejection. |

Staged archives:

- `artifacts/asset-fetch/161369399a0d4b6e9657023a1bcbfb31/` — Naruto Sage, 163,617 B zip, sha256 `d79d07fc…`
- `artifacts/asset-fetch/ee031644239745028ce6b19a3d9ee0f7/` — Miles, 2,310,141 B zip, sha256 `98e72eb2…`
- `artifacts/asset-fetch/1109297eb49c4500897ca831ddd78c9d/` — Ultra Ego Vegeta, 813,347 B zip, sha256 `b8d510f8…`
- `artifacts/asset-fetch/b72e4bad70084e53b38f139f0d9bf178/` — T-800, 2,457,654 B zip, sha256 `7dc574e6…`
- `artifacts/asset-fetch/99e52e57a8dc4feda750af87b87d2955/` — Iron Spider, 4,516,735 B zip, sha256 `d4bb27ac…`

## 2. Iron Spider original animation preservation

Requirement: enumerate every supplied clip before any conversion.

- Source archived unchanged: `artifacts/iron-spider/original/iron_spider.source.glb`
  (sha256 `bc8fafa250b7709a…`, 10,973,124 B, 107 joints).
- Full inventory: `artifacts/iron-spider/original/clip-inventory.json` — 32 clips with duration,
  channel count, sampler count and per-target node/property lists.
- Sample: `@idle` 2.0 s / 266 channels, `@walk` 0.633 s / 306, `@dash` 0.4 s / 304,
  `@hit` 0.667 s / 306, `@die` 1.467 s / 303, `@skill07-02` 4.867 s / 312,
  `@collection` 0 s / 144 (single-pose collection clip).

Status: **MODEL PREPARED, not integrated.** The archived source was imported into Blender 4.2.23,
uniformly scaled by 0.034206 to 1.85 m with feet at z=0, and exported to
`artifacts/iron-spider/prepared/iron_spider_normalized.glb`. The export still reports
**32 clips, 0 missing, 0 extra, 107 joints** (`prepared/preservation-report.json`), with every
original clip name present. No manifest or runtime change has been made; the source archive remains
untouched.

## 3. Existing on-disk candidates re-inspected

| Fighter | File | Joints | Clips | Triangles | Height | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Harry Potter | `imported/harry_potter/harry_potter_animated.glb` | 68 | **25** | 16,316 | 1.876 m, feet at 0 | Promoted and live 13/13; HUD `HARRY POTTER`, hand-sized wand, Expecto Patronum. |
| Hulk | `imported/hulk/hulk.glb` | 65 | 19 | 15,252 | 2.371 m native | Integrated; source clips are MFF names (`atk01`, `skill01`…). |
| Saitama | `imported/saitama/saitama.glb` | 158 | 25 | 308,979 | 1.762 m | Integrated with the shared 25-clip package. |
| Light Yagami | `imported/light_yagami_rigged/light_yagami_rigged.glb` | 19 | 25 | 106,002 | 1.82 m | Live 13/13; displayed as Light Yagami, Light moveset and scaled Death Note. |
| Hashirama | `imported/hashirama_senju/hashirama_senju.glb` | 19 | 25 | 16,471 | bounds 187.7 units | 100× scale defect in the promoted file; normalised build exists at `artifacts/asset-fetch/final/hashirama_final.glb` (1.851 m). |
| Naruto (current) | `naruto_uzumaki/naruto_uzumaki.glb` | 567 | 19 | 2,823 | 1.808 m | Integrated, low-poly body; the supplied Sage candidate is also low-poly and must be rebuilt. |

## 4. Honest classification

| Fighter | Classification | Why |
| --- | --- | --- |
| Naruto | MODEL DOWNLOADED | Files acquired; no rig exists yet on the Sage mesh, nothing prepared or integrated. |
| Spider-Man / Miles | **PROMOTED, BONE-MAPPED 19/19 — browser combat verified** | Supplied 178-joint Miles body, 26 original clips plus 57 retargeted Iron Spider clips, two embedded textures; live-mounted with all 19 reaction and 20 strike slots bound. The browser E2E now passes 12/12 after the spine bone-map fix; the reaction/air/ultimate damage matrix remains outstanding. See `docs/MILES_MORALES_INTEGRATION.md`. |
| Vegeta | **LIVE ACCEPTANCE 13/13** | Supplied Ultra Ego appearance + 25 retargeted clips; idle/walk/jump, jab, Galick Gun and hit reaction played in a real match. |
| Arnold / T-800 | **LIVE ACCEPTANCE 13/13** | 1.88 m T-800 body, 25 clips, heavy shotgun, jab and Cybernetic Cannon verified in a real match. |
| Iron Spider | MODEL PREPARED | Source and 32-clip library archived; normalised export retains all 32 clips and 107 joints. Runtime mount/playback and gameplay verification outstanding. |
| Harry | **LIVE ACCEPTANCE 13/13** | 68-joint body, 25 baked clips, wand, HUD and Expecto Patronum verified in a real match. |
| Light | **IDENTITY + MOVESET COMPLETE — 13/13** | HUD, moveset, abilities, ultimate and Death Note prop are Light-themed; stable key retained. |

No supplied candidate is claimed complete in this batch. Miles is promoted and live-mounted, but
its remaining reaction/air/ultimate matrix and E2E gate are explicitly outstanding.

## 5. Post-inspection acceptance (2026-11-11)

The Batch 1 classifications above are historical. Vegeta, T-800, Harry Potter and Light Yagami
were subsequently promoted and accepted in real matches at **13/13 each**. The T-800 source was
normalised to 1.88 m and its four spec/gloss materials were converted to metallic/roughness; Harry's
25-clip package was baked onto its 68-joint skeleton after removing four zero-area triangles; Light
kept the stable `l_death_note_style` key while receiving the Light identity, moveset and equipment.

Inherited source defects were recorded and then repaired for Vegeta and T-800: Vegeta is now **0**
open / **0** non-manifold (from 407 / 3,862) and T-800 **0** open / **0** non-manifold (from
2,198 / 45). Harry still has **498** open boundary edges. Full evidence is in
`docs/IMPORTED_MIGRATIONS_ACCEPTANCE.md`, `artifacts/source-topology-before/`,
`artifacts/source-topology-after/` and `artifacts/a1-combat/source-topology-review.json`.
