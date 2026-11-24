Attributions and Licenses

HDRI (CC0, Poly Haven)
- studio_small_03_1k.hdr — Poly Haven (CC0)
  https://polyhaven.com/hdris/studio_small_03

glTF Sample Models (Khronos Group) — permissive sample models
- Fox (2.0) — https://github.com/KhronosGroup/glTF-Sample-Models/tree/master/2.0/Fox
- CesiumMan (2.0) — https://github.com/KhronosGroup/glTF-Sample-Models/tree/master/2.0/CesiumMan

## Iron Spider — animation donor (57 clips embedded in Miles)

- Title: **Iron Spider - Avengers: Infinity War**
- Creator: **Kabiidev** — https://sketchfab.com/kabiidev
- Source: https://sketchfab.com/3d-models/iron-spider-avengers-infinity-war-99e52e57a8dc4feda750af87b87d2955
- Licence: **CC BY 4.0** (`http://creativecommons.org/licenses/by/4.0/`) — attribution required.
- Runtime body: `public/models/characters/iron_spider/iron_spider_source_animated.glb`
  (107 joints, 57 clips, SHA-256 `08124a094f6c3faa216ad0f238cb1422935042b01a89254dbd2183eccab0186d`).
- Animation contribution: all **57** clips were retargeted onto the Miles Morales body and embedded
  under the `IronSpider__` prefix. No Iron Spider geometry, materials or textures were copied into
  Miles; only body-joint animation channels were retained. See
  `docs/MILES_IRON_SPIDER_ANIMATION_MERGE.md`.
- Status: the Iron Spider body and the merged Miles body are local runtime assets in this
  worktree, not a published build. A CC BY licence to the uploader's asset does not settle rights
  to the underlying Marvel character; confirm that separately before distributing the game.

## Miles Morales — supplied Spider-Man body, retargeted animation

- Title: **miles morales Rig rigged bone free**
- Creator: **KenzoDkohno2013** — https://sketchfab.com/KenzoDkohno2013
- Source: https://sketchfab.com/3d-models/miles-morales-rig-rigged-bone-free-ee031644239745028ce6b19a3d9ee0f7
- Licence: **CC BY 4.0** — attribution required; modified asset.
- Modifications: the supplied `.gltf` was packed into a self-contained GLB without rewriting geometry
  or skin weights; its spec/gloss materials were converted to metallic/roughness using the supplied
  textures as base-color maps. The project's 25-clip Spider-Man animation package was retargeted onto
  the supplied 178-joint skeleton with `scripts/rig-clips-to-body.mjs`, retaining the supplied
  `FearlessFlight_Male_idle`. All 57 Iron Spider clips by **Kabiidev** (CC BY 4.0, source above) were
  then retargeted onto the same skeleton and appended under the `IronSpider__` prefix; no Iron
  Spider geometry, materials or textures were added to Miles. The previous `spider_man_rigged.glb`
  body and `backup/miles_morales_pre_iron_spider_20261113.glb` remain rollback assets.
- Rights scope: the CC BY licence covers the uploader's model and animation channels; it does not
  grant rights to the Spider-Man, Miles Morales or Iron Spider characters. Confirm permission for
  the intended distribution.

## Naruto Uzumaki — imported body, local prototype only

- Title: **Naruto & Sasuke Low Poly + Rig + Texture**
- Creator: **ronildo.facanha** — https://sketchfab.com/ronildo.facanha
- Source: https://sketchfab.com/3d-models/naruto-sasuke-low-poly-rig-texture-b650b60a7bbd4f11b05a435e65116168
- Licence: **CC BY 4.0**. Required credit: “Naruto & Sasuke Low Poly + Rig + Texture by ronildo.facanha,
  licensed CC BY 4.0.” The files were published by the creator in the project folder linked from the
  model description and retrieved on 2026-11-06.
- What was used: the Naruto half of the supplied FBX (5,444 tris on a 567-bone rig) and the five PNG
  maps that accompany it. Sasuke, the render backdrop and the extra face variants were not installed.
- Modifications: `assets/blender/naruto_from_fbx.py` keeps Naruto alone, rebuilds each material around
  its supplied texture, removes the inverted-hull ink shell (glTF cannot mark a material back-side, so
  it drew the body as a black silhouette) and normalises the 6.15 m source to 1.80 m.
  `assets/blender/naruto_animations.py` adds 19 animation clips authored on that rig. Modified files
  are marked as such under CC BY 4.0.
- **Rights scope.** A CC BY licence covers the creator's own work; it does **not** grant rights to the
  Naruto franchise, its characters or its designs. This body is therefore local-prototype-only art and
  must not be shipped or published as a cleared asset. The in-game rosters and movesets still derive
  from the project's own original designs; the model is an art swap for development.

All procedural characters and UI code currently included in this repo are original and created for this demo.

No third-party Superman or Goku character model files are currently bundled. Candidate model pages and their listed license information are documented in public/models/characters/README.md. A listing's uploader-selected license does not necessarily grant rights to the underlying copyrighted character. Verify permission for your intended use before redistributing or publishing a build.

## Vegeta — Ultra Ego (supplied body, retargeted animation)

- Title: **(RIGGED) Vegeta Ultra Ego (DBFZ).|| DBS MANGA**
- Creator: **shamus** — https://sketchfab.com/consistent_models
- Source: https://sketchfab.com/3d-models/rigged-vegeta-ultra-ego-dbfz-dbs-manga-1109297eb49c4500897ca831ddd78c9d
- Licence: **CC BY 4.0** — attribution required; modified asset.
- Modifications: the supplied mesh, skin weights, materials and three texture maps are preserved.
  The project's 25-clip Vegeta animation set was baked onto the supplied 311-joint skeleton with
  `scripts/rig-clips-to-body.mjs`; the original authored Vegeta body remains as rollback.
- Rights scope: the CC BY licence covers the uploader's model; it does not grant rights to the
  Dragon Ball franchise or its characters. Confirm permission for the intended distribution.

## Naruto Sage — current Naruto body

- Title: **Naruto Sage**
- Creator: **ninjatorent13** — https://sketchfab.com/ninjatorent13
- Source: https://sketchfab.com/3d-models/naruto-sage-161369399a0d4b6e9657023a1bcbfb31
- Licence: **CC BY 4.0**. Required credit: “Naruto Sage” by ninjatorent13, licensed CC BY 4.0.
  Downloaded on 2026-11-10 through the Sketchfab download API with the account owner's token; the
  source archive is preserved at `artifacts/asset-fetch/161369399a0d4b6e9657023a1bcbfb31/`.
- What was used: the supplied three-mesh, 4,316-triangle static scene and its three PNG maps.
- Modifications: the source was packed into a GLB, auto-rigged to this repository's 19-bone
  humanoid skeleton by `scripts/autorig_batch.py`, and the existing 49-clip shinobi set was
  retargeted onto it at 30 fps with `scripts/rig-clips-to-body.mjs --calibrate-arms`. The previous
  ronildo.facanha body remains the manifest `rollbackUrl`.
- **Rights scope.** The CC BY licence covers the creator's own work; it does not grant rights to the
  Naruto franchise, its characters or its designs. This body is local-prototype-only art and must not
  be shipped or published as a cleared asset.

## Konoha imported landmarks — Six Hokage Mountain and Hokage Office

- **Six Hokage Mountain** by **jmartinez20592** — https://sketchfab.com/3d-models/six-hokage-mountain-c9cc3357a6ee46c2bff49c94e409fa99 — **CC BY 4.0**.
  Modified for this project: 558 source parts joined, per-part collapse-decimated to 32% of the
  source faces, redundant UV sets removed and the relief normalised to 180 m width. The modified
  asset remains available under CC BY 4.0. Source SHA-256: `2f39525239be16811de5bc19849d409074478e10d04662afff74c143ab804e6e`.
- **Hokage Office** by **elre** — https://sketchfab.com/3d-models/hokage-office-07512299acb64f40a4b36d63286de7cf — **CC BY 4.0**.
  Modified for this project: the office, two silos and lamp posts were retained; the display base,
  perimeter wall and presentation trees were removed; the cluster was normalised to 8 m height.
  The modified asset remains available under CC BY 4.0. Source SHA-256: `097b1313c7fa47b740070e3dfec6eee42e45a66c079420d64926a224a1839197`.
- Combined runtime asset: `public/assets/environments/konoha/hokage_landmarks.glb`; manifest and
  rejected-asset decision: `docs/ENVIRONMENT_ASSET_MANIFEST.md`.
- **Rights scope.** These CC BY licences cover the uploaders' models. They do not grant rights to
  the Naruto franchise, its characters or its designs. Treat this as local prototype art and
  confirm permission before distributing or publishing a build.

## Imported environment arenas — Skyloft, Wuhu Island, Sunshine Airport, Konoha village

- **The legend of zelda : sky word sword - sky loft** by **Dola** — https://sketchfab.com/3d-models/the-legend-of-zelda-sky-word-sword-sky-loft-d3efeec729644b67a444f900815b33d9 — **CC BY 4.0**.
  Modified for this project: the supplied island was recentred on its lower plaza, the terrace deck,
  bridges, banners, braziers and spawn marker were authored in Blender, and the mesh was joined and
  exported as `public/assets/arenas/skyloft.glb`. Runtime: `Skyloft · Skyward Isle`.
- **Wuhu Island** by **Dola** — https://sketchfab.com/3d-models/wuhu-island-bc6367ba43ac4af9939e99beac3493a0 — **CC BY 4.0**.
  Modified for this project: the 1.4 km source ocean plane was removed and replaced with a bounded
  sea; the island was scaled and positioned as the western half of the Mario Kart arena.
- **Mario kart 8 - Sunshine airport** by **Dola** — https://sketchfab.com/3d-models/mario-kart-8-sunshine-airport-cca07d1f6600401691170b825b6220cc — **CC BY 4.0**.
  Modified for this project: the source sea plane was removed, the airport was raised on an authored
  rock base, and a runway promenade/causeway was built to connect it to Wuhu Island. Both assets ship
  together as `public/assets/arenas/mariokart.glb`; runtime: `Mario Kart · Wuhu Sunshine Speedway`.
- **Naruto hiddenly village** by **kyrox** — https://sketchfab.com/3d-models/naruto-hiddenly-village-bd95c17d67c44756b4fa5097bce9a547 — **CC BY 4.0**.
  Modified for this project: the supplied village and Six Hokage relief were scaled, positioned behind
  an authored cliff terrace, joined with a timber bridge and exported as
  `public/assets/arenas/konoha_overlook.glb`; runtime: `Konoha · Hokage Overlook`.
- Source archives remain in `artifacts/asset-fetch/<uid>/`; Blender sources are in
  `assets/blender/environments/`. The owner has authorized use of the supplied models in this project;
  the CC BY metadata is retained and the modified assets remain available under the same licence.
  The CC BY licences cover the uploaders' models, not the Zelda, Mario Kart or Naruto franchises.

## Mario and Luigi — supplied bodies, promoted

- **Mario kart tour - Mario (Happi)** by **Dola** — https://sketchfab.com/3d-models/mario-kart-tour-mario-happi-269c8e889d6440c284034898440919c0 — **CC BY 4.0**.
  The supplied 6,984-triangle body had no skeleton and no clips. It was auto-rigged in Blender 4.2.23
  to the project's 19-bone skeleton, normalised to 1.754 m with feet at 0, and the project's 25-clip
  Luigi animation set was retargeted onto it with `scripts/rig-clips-to-body.mjs --calibrate-arms`.
  The authored `roster/mario.glb` remains the manifest `rollbackUrl`. Source faces -Z; the manifest
  applies a 180° facing offset. Runtime evidence: `artifacts/hd-fighter/mario/`.
- **Dr Mario World - Dr Luigi** by **Dola** — https://sketchfab.com/3d-models/dr-mario-world-dr-luigi-2e7016d3f03c4433a34a59095db805e2 — **CC BY 4.0**.
  The supplied 91-bone, 5,489-triangle body already had all 19 canonical roles bound but no clips.
  The project's 25-clip Luigi set was retargeted onto it; height 1.756 m, feet at 0.001. The authored
  `roster/luigi.glb` remains the manifest `rollbackUrl`. Source faces -Z; the manifest applies a 180°
  facing offset. Known open-shell limitation: 181 boundary edges / 6 non-manifold edges in the sash
  and wrap hems. Runtime evidence: `artifacts/hd-fighter/luigi/`.
- Provenance and hashes: `public/models/characters/imported/mario_happi/provenance.json` and
  `public/models/characters/imported/dr_luigi/provenance.json`.
- **Rights scope.** These CC BY licences cover Dola's models, not the Mario franchise or its
  characters. Confirm permission before distributing or publishing a build.

## Link — full-size Super Smash Bros. Ultimate body, Master Sword, Hylian Shield and Bow of Light

- **Super Smash Bros ultimate - Link** by **Dola** — https://sketchfab.com/3d-models/super-smash-bros-ultimate-link-4a3d7152e1ea4e80b6f32a7d1f7c1626 — **CC BY 4.0**.
  Downloaded through the Sketchfab API with the owner's token (4,885,095 bytes; source SHA-256
  `9c9b6fab9fd165e978cc721315c448fc4a2ff9f1dfdf53276b4e93f4c2b3dadb`), converted from
  spec/gloss to core metallic-roughness PBR, and repacked without changing geometry, skin weights,
  UVs or textures. The body's 202-joint skeleton was reduced to the project's 19 canonical roles and
  the existing 25-clip moveset was retargeted onto it; the source's back-mounted sword, shield and
  scabbard were removed so the held equipment is separate. Normalised to 1.70 m with feet at 0.
  Runtime body: `public/models/characters/roster/link.glb` (10 skinned meshes, 10,592 vertices,
  12,755 triangles, 25 clips, 13 textures). Source clips: 0.
- **The Legend of Zelda - Bow of Light** by **toytrovert** — https://sketchfab.com/3d-models/the-legend-of-zelda-bow-of-light-8798fb78b25a490b8773adbfcf7b8da9 — **CC BY 4.0**.
  Bow, string and arrow were extracted from the supplied archive, split into separate bow and arrow
  props, and normalised for the left-hand mount. Runtime: `weapon_link_bow.glb` and
  `weapon_link_arrow.glb`. The Master Sword and Hylian Shield are extracted from Dola's Link source
  as `weapon_link_right.glb` and `weapon_link_left.glb`.
- Rollback body: `public/models/characters/backup/link-pre-smash-20261113.glb`. Source reports:
  `artifacts/link-upgrade/retarget-fixed.json` and `artifacts/link-upgrade/inspect-retarget.json`.
- **Rights scope.** These CC BY licences cover the uploaders' models, not The Legend of Zelda
  franchise, Nintendo's character designs, or the Super Smash Bros. name. This is local prototype
  art; confirm permission before distributing or publishing a build.
