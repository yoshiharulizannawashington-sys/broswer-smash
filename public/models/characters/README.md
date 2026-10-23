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

## Iron Spider (staged, not bundled)

`manifest.json` already carries an `iron_spider` entry for
["Iron Spider - Avengers: Infinity War" by Kabiidev](https://sketchfab.com/3d-models/iron-spider-avengers-infinity-war-99e52e57a8dc4feda750af87b87d2955),
but it is **disabled** and the binary is **not in the repository**. The fighter is selectable
now and renders its procedural fallback until the real file is installed.

The game expects a **binary glTF** at:

```
public/models/characters/iron_spider/iron_spider.glb
```

You do not have to place it there by hand. Download the model from Sketchfab while signed in
(glTF/GLB if offered, otherwise the download ZIP containing it), then from the repository root:

```sh
node scripts/install-character-model.mjs ~/Downloads/iron-spider.zip --identity "Iron Spider" \
  --facing 0 --license "<licence shown on the model page>" \
  --attribution "<credit line Sketchfab generates>" \
  --source https://sketchfab.com/3d-models/iron-spider-avengers-infinity-war-99e52e57a8dc4feda750af87b87d2955
```

The installer finds the `.glb`/`.gltf`/`.fbx` inside the download (preferring GLB), refuses an
empty or lying-down mesh, copies the model and any sibling buffers/textures into
`public/models/characters/iron_spider/`, prints the mesh/skin/bone/clip/height report and enables
the manifest entry. Add `--dry-run` to inspect a download without writing anything. If the asset
is authored facing -Z, pass `--facing 180`; the value is stored in the manifest as `yawOffset`.

After installing, reload the game and select **Iron Spider**: `upgradeFighterModel` mounts the
file through the same validated path as Goku and Iron Man, and
`window.__browserSmashAssets.characterModels.iron_spider` reports `loaded` or `rejected` with the
rig-validation issues. A rejected import keeps the procedural body instead of showing a broken
one.

`SPIDER-LEG ASSAULT` does not depend on the download: it is implemented in `SPECIAL_MOVES` as a
radial ground sweep with four animated leg shafts, so the fighter is complete without the file.

## Add another character

Add an entry in this manifest with the fighter's normalized identity key and a path to the model. GLB is usually the simplest distribution format; FBX is supported for rigged characters. Keep any referenced external resources beside the model.

## License and attribution

Before distributing downloaded models, verify the original creator's license and include exact attribution in `public/ATTRIBUTIONS.md`. Do not commit paid assets or assets whose licenses prohibit redistribution.
