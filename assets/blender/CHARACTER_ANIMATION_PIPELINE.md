# Goku + Iron Man animation and VFX pipeline

## What is included

- `public/js/combat_vfx.js`: reusable additive hit flashes, directional sparks, expanding impact rings, projectile muzzle bursts, dash streaks, and landing shockwaves.
- `assets/blender/character_animation_bake.py`: a Blender batch script that imports the supplied Goku FBX and Iron Man GLTF, authors named in-place animation clips on each existing rig, and exports animated GLBs.
- `scripts/install-character-assets.mjs`: installs the extracted model/texture package into `public/models/characters`, validates the files, and enables the model manifest. It prefers the baked GLBs when they exist.

The baked clips are authored procedural starter animation, not motion capture. They are meant to give the existing rig controller named clips to blend, then be refined in Blender's Dope Sheet/Action Editor. The web runtime still has procedural fallback poses if no baked GLB is present. Once the character source files are in the repository, the `Bake Goku and Iron Man animation clips` GitHub Actions workflow can run on asset changes or be started manually from Actions; it bakes the GLBs, updates the manifest, and uploads an artifact as a fallback if GitHub permissions prevent the generated binaries from being committed.

## 1. Install the supplied asset ZIP

Extract `browser-bros-goku-iron-man-character-assets.zip` into a temporary folder, keeping its `public/models/characters` structure. From the repository root run:

```sh
node scripts/install-character-assets.mjs /path/to/extracted-package
```

If you extracted the ZIP directly into the repository root, run:

```sh
node scripts/install-character-assets.mjs
```

The script turns the manifest entries on only after it finds the required FBX, GLTF, binary buffer, and textures. Until the asset files are installed, the manifest intentionally keeps those entries disabled so the game falls back cleanly.

## 2. Bake named clips in Blender

Install Blender 3.6+ with FBX and glTF import/export support. From the repository root, run:

```sh
blender --background --python assets/blender/character_animation_bake.py -- \
  --goku public/models/characters/goku/Goku.fbx \
  --ironman "public/models/characters/iron-man-mark-v-rig/Iron Man Mark V Rig Materials.gltf" \
  --output public/models/characters/animated
```

This writes:

- `public/models/characters/animated/goku-animated.glb`
- `public/models/characters/animated/iron-man-animated.glb`

Then rerun the installer. It detects those files and registers them instead of the source FBX/GLTF.

The starter action set is: `Idle`, `Walk`, `Run`, `Jump`, `Land`, `Punch`, `HeavyAttack`, `HitReact`, `Block`, `Dodge`, `Charge`, `BeamAttack`, and `Flight`. The controller crossfades those actions based on movement, guarding, dodging, landing, attack combo stage, and special-move cooldown start.

## 3. What to refine in Blender

Open each generated GLB or the original rig in Blender and preview the NLA strips. The script uses bone-name heuristics to author broad starter poses, so different skeleton axes may require small rotations/retiming. Save refined actions only after confirming feet remain planted and the character faces the correct forward axis. Prefer compatible retargeted motion-capture clips later for higher fidelity.

## 4. Browser VFX

The game calls the VFX module from melee/projectile impacts, signature move launches, dash-strike movement, and fighter landings. Materials are additive and depth-write-disabled for readable sparks and energy flashes. Effects self-dispose after their lifetime to avoid accumulating meshes and materials during long fights.
