Attributions and Licenses

HDRI (CC0, Poly Haven)
- studio_small_03_1k.hdr — Poly Haven (CC0)
  https://polyhaven.com/hdris/studio_small_03

glTF Sample Models (Khronos Group) — permissive sample models
- Fox (2.0) — https://github.com/KhronosGroup/glTF-Sample-Models/tree/master/2.0/Fox
- CesiumMan (2.0) — https://github.com/KhronosGroup/glTF-Sample-Models/tree/master/2.0/CesiumMan

## Iron Spider — staged asset, NOT bundled

- Title: **Iron Spider - Avengers: Infinity War**
- Creator: **Kabiidev** — https://sketchfab.com/kabiidev
- Source: https://sketchfab.com/3d-models/iron-spider-avengers-infinity-war-99e52e57a8dc4feda750af87b87d2955
- Licence: the model listing states **CC Attribution**. The exact licence version and Sketchfab's
  generated credit line could not be verified from this environment (the model page does not
  return readable text to an automated fetch). Open the page while signed in and copy the
  attribution Sketchfab generates into this file before publishing a build.
- Listing details seen in search results: "Download Free 3D model", tagged **Animated**,
  5.8k triangles / 3.1k vertices. The downloadable formats, the rig/clip contents and whether
  the mechanical spider legs are part of the mesh are all **unconfirmed** until the file is
  downloaded and inspected with `scripts/install-character-model.mjs`.
- Status: **not committed**. `public/models/characters/manifest.json` keeps `iron_spider`
  disabled until the file is installed, so the game renders its procedural fallback rather
  than a broken import. A Sketchfab licence does not by itself settle rights to the underlying
  Marvel character, so confirm that separately before distributing the game.

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
