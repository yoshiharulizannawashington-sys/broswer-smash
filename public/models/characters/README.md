# Character model assets for Browser Bros

The runtime reads `manifest.json` and loads only explicitly registered character-specific GLB/GLTF/FBX files. If a registered asset fails to load, the game falls back to its existing procedural character.

## Install the supplied character package

Extract the prepared Goku + Iron Man character-assets ZIP at the repository root so its `public/` directory merges into the existing `public/` directory. That package contains the actual model binaries, their textures, and a manifest that registers both fighters. The source repository keeps an empty manifest until those binary assets are installed; this prevents missing model requests and keeps the game smoke test clean.

## Goku model and procedural animation

The supplied Goku package contains a rigged FBX plus browser-optimized texture maps. The FBX has a skeleton but no baked animation clips, so the controller supplies procedural idle, locomotion, attack, hit-react, and airborne poses. If you later add authored animation clips, the runtime can cross-fade matching idle/walk/run/jump/attack/hit clips.

## Iron Man Mark V model

The supplied Iron Man Mark V package includes a skinned armature, meshes, a binary buffer, and textures, but zero embedded animation clips. Once the asset package is installed and registered, the procedural controller supplies movement and combat motion.

## Add another character

Add an entry in this manifest with the fighter's normalized identity key and a path to the model. GLB is usually the simplest distribution format; FBX is supported for rigged characters. Keep any referenced external resources beside the model.

## License and attribution

Before distributing downloaded models, verify the original creator's license and include exact attribution in `public/ATTRIBUTIONS.md`. Do not commit paid assets or assets whose licenses prohibit redistribution.
