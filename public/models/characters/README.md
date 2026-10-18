# Character model assets for Browser Smash

This directory is the destination for character-specific rigged GLB files.

## Expected filenames

- `goku.glb`
- `superman.glb`

The current character loader checks `/models/characters/<character_slug>.glb` first, then falls back to the sample Three.js Soldier model. The downloaded GLB should include its mesh, textures/materials, and skeleton. Confirm that animation clips are embedded before expecting the GLB to provide animations; the current fighter controller may still need retargeting/custom animation logic.

## Selected candidate downloads to inspect

1. **Goku Model Rigged** — Oup77, Sketchfab: https://sketchfab.com/3d-models/goku-model-rig-75b88c3bf6a446df87680b8e7d4ba8e0  
   Listing describes textures, a simple rig, and facial shape keys. Listed under CC Attribution. If used, preserve the model's required attribution and verify the current download/license details on the page.

2. **Superman | MultiVersus** — King_45, Sketchfab: https://sketchfab.com/3d-models/superman-multiversus-339ed9e6d8ff438fa82de22ecc314cf1  
   Listing describes 2K PBR. Listed under CC Attribution. Verify that the current download is available and that the uploader's license covers your intended use. The character itself remains third-party intellectual property.

Alternative Superman candidate: **Superman (Textured) (Rigged)** — 3D MODELS, Sketchfab: https://sketchfab.com/3d-models/superman-textured-rigged-61ecb87e712a437ba18930378d7aeb0e

## Install

Download using the model page's official Download button, extract the archive, and copy the selected GLB to this folder using the exact filenames above. If the download is FBX/BLEND only, export to GLB in Blender with textures and armature preserved. Test the model in a GLB viewer before launching the game.

Do not commit paid assets or assets whose license does not permit redistribution. Add the exact creator/license attribution to `public/ATTRIBUTIONS.md` before sharing a build.
