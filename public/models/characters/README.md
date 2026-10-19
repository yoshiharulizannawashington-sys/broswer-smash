# Character model assets for Browser Bros

The runtime reads `manifest.json` and loads only explicitly registered character-specific GLB/GLTF/FBX files. If a registered asset fails to load, the game falls back to its existing procedural character.

## Goku model package

The Goku package is a rigged FBX plus the supplied texture set. Place the prepared asset folder at `public/models/characters/goku/` and keep these files together:

- `Goku.fbx`
- `cloth_c.webp`, `cloth_n.webp`, `cloth_ORM.webp`
- `skin_c.webp`, `skin_n.webp`, `skin_ORM.webp`
- `face_ss_c.webp`, `face_ss_n.webp`, `face_ss_ORM.webp`
- `hair_c.webp`, `hair_ss_n.webp`

The FBX loader uses the rigged model and the game applies the matching color, normal, and packed occlusion/roughness/metalness maps by material name. The provided FBX contains a skeleton but no baked animation clips, so the character controller supplies procedural idle, locomotion, attack, hit-react, and airborne poses. If you later add authored animation clips, the runtime can cross-fade matching idle/walk/run/jump/attack/hit clips.

The model is registered under the `goku` fighter identity. The game normalizes imported model height to fit the existing fighter scale.

## Iron Man Mark V package

Register or install the supplied Iron Man Mark V GLTF package at `public/models/characters/iron-man-mark-v-rig/`. The rig has no embedded animation clips, so the procedural controller supplies movement and combat motion.

## Add another character

Add an entry in this manifest with the fighter's normalized identity key and a path to the model. GLB is usually the simplest distribution format; FBX is supported for rigged characters. Keep any referenced external resources beside the model.

## License and attribution

Before distributing downloaded models, verify the original creator's license and include exact attribution in `public/ATTRIBUTIONS.md`. Do not commit paid assets or assets whose licenses prohibit redistribution.
