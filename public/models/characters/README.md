# Character model assets for Browser Bros

The runtime reads `manifest.json` and loads only explicitly registered character-specific GLB/GLTF files. This avoids requests for model files that are not actually in the repository. If a registered asset is missing or fails to parse, the game falls back to its existing Blender/procedural character.

## Register a character model

Add an entry to `public/models/characters/manifest.json` using the fighter's normalized identity key:

```json
{
  "version": 1,
  "characters": {
    "iron_man_tony_stark": {
      "url": "/models/characters/iron-man-mark-v-rig/Iron%20Man%20Mark%20V%20Rig%20Materials.gltf"
    },
    "goku": {
      "url": "/models/characters/goku.glb"
    }
  }
}
```

The paths above are examples; each listed file must exist. A `.gltf` file with external resources must keep its referenced `.bin` and texture files at the relative paths encoded in the GLTF. A single self-contained `.glb` is easiest to deploy.

## Iron Man Mark V package

The supplied Iron Man Mark V package includes a skinned armature, meshes, a binary buffer, and textures, but **zero embedded animation clips**. Once the extracted package is copied to the path above and registered in the manifest, the game uses procedural idle/locomotion/attack/hit reactions for recognized arm, forearm, hand, spine, pelvis, thigh, and shin bones. The loader cross-fades compatible embedded idle, walk, run, jump/fall, attack, and hit clips when those clips exist.

## Goku and other models

- Goku: `public/models/characters/goku.glb` or a registered `.gltf` with its referenced resources.
- Superman: add a model file and a matching `superman` manifest entry if you have a licensed asset.

A rig alone does not contain animation clips. For full animation coverage, use a rigged model with clips or let the procedural skeleton controller supply movement.

## License and attribution

Before distributing downloaded models, verify the current creator license and add the exact source/license attribution to `public/ATTRIBUTIONS.md`. Do not commit paid assets or assets whose licenses prohibit redistribution.

Potential source to verify: [Goku Model Rigged — Sketchfab](https://sketchfab.com/3d-models/goku-model-rig-75b88c3bf6a446df87680b8e7d4ba8e0). The model was not included in the files available for this update, so the existing Blender/procedural Goku remains active until its actual model files are added.
