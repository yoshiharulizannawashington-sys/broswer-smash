# Codex Instructions — Browser Smash

## Mission and priorities

You are working in the existing Browser Smash repository, not a new game. Preserve its roster, controls, combat, camera, arenas, and current rendering path. Implement and validate code directly; do not stop at a plan or replace the game with a generic demo.

**Priority order**
1. Keep the existing game booting and tests passing.
2. Integrate the user's actual rigged Goku and Iron Man assets when their source files are available.
3. Make those fighters animate, move, fight, and use their signature attacks through the existing game systems.
4. Generalize the asset pipeline for future roster models.
5. Improve the world renderer and camera without destabilizing gameplay.
6. Later integrate large environment packages (New York/Avengers Tower, Hogwarts, Death Star, Valley of the End, and other supplied maps).

The pulled-back cinematic camera and high-quality 3D environments are long-term non-negotiable goals, but character integration is the current priority. Do not spend the first pass building every future world.

## Repository facts to verify, not assume

- Repository: `yoshiharulizannawashington-sys/broswer-smash`
- Browser app is a Three.js/Vite project. `package.json` currently provides `dev`, `start`, and `build` scripts.
- Main entry/game loop: `public/js/main.js`; both `index.html` and `public/index.html` are supported entry points.
- Camera: `public/js/SmashCamera.js`
- Rendering/material helpers: `public/js/smash_render_pipeline.js`
- Fighter construction/rigs: `public/js/human_fighter.js`, `public/js/fighter3D.js`, `public/js/CharacterController.js`
- Character model loader: `public/js/models.js`; manifest-driven user character loader is in `public/js/human_fighter.js`.
- Reusable impact/dash/landing VFX: `public/js/combat_vfx.js`
- Blender character setup: `assets/blender/character_models.py`, `assets/blender/character_animation_bake.py`
- Animation pipeline notes: `assets/blender/CHARACTER_ANIMATION_PIPELINE.md`
- Character package installer: `scripts/install-character-assets.mjs`
- Runtime browser smoke test: `scripts/browser-smoke.mjs`
- Asset validator: `scripts/validate-assets.mjs` (`npm run validate:assets`)
- Runtime roster audit: `scripts/audit-roster.mjs` (`npm run audit:roster`) — mounts every selectable fighter's prefab rig, weapon and surface detail.
- Generated surface detail: `public/js/surface_detail.js`. Per-arena sky IBL: `public/js/sky_environment.js`.
- Build config: `vite.config.js` — the site root is `public/`, output goes to `dist/`
- Authored arena loader: `public/js/arenas/cinematic_arenas.js` (wired into `applyMap` in `public/js/main.js`)
- CI: `.github/workflows/validate-game.yml`, `.github/workflows/build-character-animations.yml`, and `.github/workflows/build-final-valley.yml`.

These are known repository paths, not a substitute for checking the current branch. Read relevant code and git status before editing.

## Current asset readiness

The repository already contains environment/Blender assets, including:
- `public/assets/character_models.glb`
- `public/assets/character_weapons.glb`
- `public/assets/final_valley.glb`
- `public/assets/arenas/asgard.glb`
- `public/assets/arenas/deathstar.glb`
- `public/assets/arenas/helicarrier.glb`
- `public/assets/arenas/hogwarts.glb`
- `public/assets/arenas/tournament.glb`
- Corresponding Blender source projects under `assets/blender/`.

The actual user-supplied Goku/Iron Man source package is **not present in the repository by default**. The committed `public/models/characters/manifest.json` intentionally has both entries disabled until source assets are installed. Do not claim those exact user models are loaded unless the files are present and verified.

Expected source package paths (check the manifest and installer before changing):
- `public/models/characters/goku/Goku.fbx` plus its supplied texture files.
- `public/models/characters/iron-man-mark-v-rig/Iron Man Mark V Rig Materials.gltf`, its `.bin`, and referenced textures.

Install an extracted package using:
```sh
node scripts/install-character-assets.mjs /path/to/extracted-package
```
The script validates required files and enables the manifest. Do not enable paths to missing files. Do not commit placeholder/empty model binaries as real assets.

The Blender bake script is intended to export:
- `public/models/characters/animated/goku-animated.glb`
- `public/models/characters/animated/iron-man-animated.glb`

It creates named procedural starter clips, not motion-captured or final-quality animation. State this distinction honestly. The animation workflow can skip baking when source assets are absent. Inspect its latest run before diagnosing a failure.

## Required character behavior

- Integrate Goku and Iron Man through the existing roster and fighter instantiation path; do not add duplicate roster identities or bypass character selection.
- Preserve the other fighters and their fallback implementations.
- Use the manifest and shared loader rather than separate one-off loading code for each character.
- Validate mesh, materials, textures, skeleton, clip list, model scale/orientation, ground contact, and browser loading.
- Connect movement states (idle, walk/run, jump/fall/land), attacks, block, dodge, hit reactions, recovery, and signature moves to gameplay state.
- Goku's known signature move is Kamehameha. Iron Man's known signature move is Repulsor Blast. Reuse the existing signature-move/projectile/damage system and synchronize hit windows with animation where feasible.
- Use available attachment bones for palm/hand effects when possible; otherwise use a documented character-relative fallback.
- Reuse the current flight system for Iron Man if compatible; do not add a competing controller.
- Avoid repeated damage every frame, broken cooldowns, doubled root motion, foot/floor mismatch, stuck states, and leaked VFX/resources.
- Missing or invalid assets must fail gracefully and be reported as fallback, never falsely as loaded.

## Blender rules

Check whether Blender is installed and inspect its version before attempting Blender operations. Use the existing Python scripts and pipeline docs first. Preserve original source files and write exports to a separate output directory. Verify exported GLBs by loading them in the actual browser pipeline. If Blender is unavailable, do not claim that rigging, retargeting, or export was performed.

The current bake script authors procedural starter animations based on rig/bone-name heuristics. Different skeletons may require axis corrections or manual retargeting. Do not promise that generated starter clips are production motion capture.

## Camera, rendering, and future worlds

- Keep the default camera pulled back, elevated, stable, and able to frame both fighters and meaningful portions of the arena. Avoid solving every framing issue with extreme FOV.
- Preserve the working direct Three.js renderer. Do not re-enable previously problematic post-processing blindly; verify actual rendering after any pipeline change.
- Keep cache-busting query versions consistent across main module imports, InputManager dependencies, and both HTML entrypoints when the project requires it.
- Preserve existing arenas and their procedural content.
- Later environments should use supplied real assets when available and include terrain/architecture detail, PBR materials, lighting, atmospheric depth, collision proxies, scale/LOD strategy, and performance checks. Future targets include a NYC skyline with a major Avengers Tower landmark, Hogwarts Castle, Death Star interiors/exteriors, and Valley of the End. Do not mislabel a prototype as a finished photorealistic world.
- Large map assets should be loaded on demand, not all loaded simultaneously.

## Safe workflow

1. Check `git status`, branch, latest commit, and latest Actions results. Do not discard or overwrite user changes.
2. Read the specific code and existing tests before editing.
3. Make one coherent, reviewable change at a time.
4. Run `npm run build`, relevant syntax checks, and existing validation scripts (`npm run validate:assets`, `npm run audit:roster`, `npm run test:smoke`); use Playwright/browser smoke tests when available.
5. Check actual runtime asset requests, browser errors, character animation, and gameplay where tools permit. Distinguish source inspection from verified runtime behavior.
6. Inspect the diff and rerun tests after fixes.
7. Commit coherent changes only when appropriate and permitted. Never claim tests, Blender, model integration, or commits succeeded unless they did.
8. If a source asset is missing, complete independent infrastructure tasks and report the exact missing files; do not stop with only a plan.
9. Avoid unrelated HUD/mobile polish. Focus on character integration, world rendering, camera, combat, and reliability.

## Completion standard

A successful first character milestone means the **actual supplied** Goku and Iron Man models load through the normal selection path; both can move, animate, attack, take damage, guard/dodge, use their signature moves, and complete a match; the camera remains pulled back; and browser tests show no critical failures. If the actual source assets are unavailable, report the pipeline as prepared, not the milestone as complete.
