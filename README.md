# Browser Smash

Browser Smash is an existing Three.js/Vite 3D fighting game. This repository is the source of truth: extend the game already here rather than starting over with a generic demo.

## Start here (especially for Codex)

1. Read [AGENTS.md](./AGENTS.md) before making changes. It contains the project mission, current asset status, priorities, and implementation/validation rules.
2. Read [the Goku + Iron Man Blender animation pipeline](./assets/blender/CHARACTER_ANIMATION_PIPELINE.md).
3. Read [the Sketchfab asset integration checklist](./public/models/ASSET_INTEGRATION_CHECKLIST.md).
4. Inspect the current branch, working tree, latest GitHub Actions runs, and code paths before editing.

## Current development priorities

**First:** integrate the actual user-provided Goku and Iron Man models into the existing roster, validate their rigs/materials, make them animate and move, and connect Kamehameha and Repulsor Blast to existing combat systems.

**Next:** generalize the character asset pipeline and polish camera framing, rendering, physics, combat feedback, and performance.

**Later:** use the world and asset pipeline for larger detailed environments such as New York City with Avengers Tower, Hogwarts Castle, the Death Star, and the Valley of the End. Keep the default camera pulled back and cinematic. Do not let future map construction delay the first playable character milestone.

## Current asset inventory

The repository already includes substantial Blender source files and browser-ready environment/character-library assets:

- `public/assets/character_models.glb` — existing character model library.
- `public/assets/character_weapons.glb` — existing weapon library.
- `public/assets/final_valley.glb` — Final Valley scene asset.
- `public/assets/arenas/asgard.glb`
- `public/assets/arenas/deathstar.glb`
- `public/assets/arenas/helicarrier.glb`
- `public/assets/arenas/hogwarts.glb`
- `public/assets/arenas/tournament.glb`
- `assets/blender/` — Blender source scenes, model/weapon scripts, and export scripts.

These assets provide a foundation; their presence alone does not prove every asset is used or every map is a finished, photorealistic world. Verify actual runtime integration before making that claim.

### Goku and Iron Man source files

The separate user-supplied character package is **not included by default**. Until it is added, `public/models/characters/manifest.json` intentionally leaves Goku and Iron Man disabled so the game can use its existing fallback models.

Expected source files include:

- Goku: `public/models/characters/goku/Goku.fbx` and its supplied textures.
- Iron Man: `public/models/characters/iron-man-mark-v-rig/Iron Man Mark V Rig Materials.gltf`, its referenced `.bin`, and textures.

Extract the supplied package while preserving its folder structure, then from the repository root run:

```sh
node scripts/install-character-assets.mjs /path/to/extracted-package
```

The installer checks for required files before enabling the manifest. Do not enable missing files or commit empty placeholder binaries. After installation, use the Blender workflow below to produce browser-ready animated GLBs.

## Local development

Requirements: a recent Node.js version compatible with Vite 6.

```sh
npm install
npm run dev
```

Build check:

```sh
npm run build
```

Open the local URL printed by Vite. Both the root `index.html` and `public/index.html` entry paths are used by automated smoke tests; keep both consistent.

## Blender character animation pipeline

Read `assets/blender/CHARACTER_ANIMATION_PIPELINE.md` for complete instructions. The project includes `assets/blender/character_animation_bake.py` and a GitHub Actions workflow that can bake named starter clips once both source models are present.

The generated clips are procedural starter animations, not motion-capture or finished hand-authored animation. Inspect the actual rigs and test the exported GLBs in the browser. Check Blender availability/version before attempting local conversion.

## Validation

- `npm run build`
- `.github/workflows/validate-game.yml` — browser-module, roster, cache-version, asset fixture, and Playwright smoke validation.
- `.github/workflows/build-character-animations.yml` — optional Blender bake once the real source models are installed.
- `.github/workflows/build-final-valley.yml` — Final Valley asset workflow.

Always inspect the latest Actions run. Distinguish a passing source/build test from verified gameplay using the real Goku and Iron Man assets.

## Asset licensing

Check each downloaded asset's license and relevant rights before distributing the game. Preserve creator attribution and add entries to `public/ATTRIBUTIONS.md` for assets actually used. Do not commit paid assets or redistribute assets whose license does not permit it.
