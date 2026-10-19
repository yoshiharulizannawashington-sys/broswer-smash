# Character model assets for Browser Smash

The runtime reads `manifest.json` and loads only explicitly registered character-specific GLB/GLTF/FBX files. If a registered asset fails to load, the game falls back to its existing procedural character.

## Install the supplied Goku + Iron Man package

1. Extract `browser-bros-goku-ironman-one-run-setup.zip` somewhere **outside** the repository. Keep the extracted `browser-bros-ready-setup/public/models/characters/` folder structure intact.
2. From the repository root, run:

   ```sh
   node scripts/install-character-assets.mjs /path/to/browser-bros-ready-setup
   ```

   On Windows, run the included `SETUP-WINDOWS.ps1`; on macOS/Linux, run `SETUP-MAC-LINUX.sh`. Those scripts pull the latest repository, install the supplied files, commit them, and push the active branch.
3. Inspect the generated diff before committing if you use the installer manually. The installer copies only the model folders, validates the GLTF's referenced binary/textures, merges the Goku and Iron Man entries into the existing manifest, and preserves this README and any other character registrations.
4. After the character source files are pushed, open the [GitHub Actions workflows](https://github.com/yoshiharulizannawashington-sys/broswer-smash/actions) and inspect the **Bake Goku and Iron Man animation clips** run.

The model binaries are not included in the repository until the package has actually been installed and pushed. The checked-in manifest keeps those entries disabled until then so the game can continue using its existing fallback models.

## Goku model and procedural animation

The supplied Goku package contains a rigged FBX plus browser-optimized texture maps. The FBX has a skeleton but no baked animation clips, so the controller supplies procedural idle, locomotion, attack, hit-react, and airborne poses. The optional Blender workflow can generate named starter clips; they are procedural, not motion capture.

## Iron Man Mark V model

The supplied Iron Man Mark V package includes a skinned armature, meshes, a binary buffer, and textures, but zero embedded animation clips. Once the asset package is installed and registered, the procedural controller supplies movement and combat motion.

## Add another character

Add an entry in this manifest with the fighter's normalized identity key and a path to the model. GLB is usually the simplest distribution format; FBX is supported for rigged characters. Keep any referenced external resources beside the model.

## License and attribution

Before distributing downloaded models, verify the original creator's license and include exact attribution in `public/ATTRIBUTIONS.md`. Do not commit paid assets or assets whose licenses prohibit redistribution.
