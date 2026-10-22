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

Open the local URL printed by Vite. Both the root `index.html` and `public/index.html` entry paths are used by automated smoke tests; keep both consistent.

### Production build

`vite.config.js` uses `public/` as the site root, because that folder already contains the
real entry page and the `/js`, `/assets` and `/models` URLs the game requests. The build
writes a self-contained site to `dist/`:

```sh
npm run build
```

Files that the game fetches by URL at runtime rather than importing (`/models/**` and
`/assets/arenas/**`) are copied verbatim; everything else is bundled and content-hashed.
`three` is a real dependency so the build never depends on a CDN.

## Blender character animation pipeline

Read `assets/blender/CHARACTER_ANIMATION_PIPELINE.md` for complete instructions. The project includes `assets/blender/character_animation_bake.py` and a GitHub Actions workflow that can bake named starter clips once both source models are present.

The generated clips are procedural starter animations, not motion-capture or finished hand-authored animation. Inspect the actual rigs and test the exported GLBs in the browser. Check Blender availability/version before attempting local conversion.

## Animation system

Fighters are animated by a real `AnimationMixer` clip pipeline, not by the old per-joint pose
functions alone. See `docs/ANIMATION_ASSETS.md` for the full workflow.

- `public/js/anim/rig_map.js` binds one canonical 11-bone skeleton onto the prefab joint rig or an
  imported Mixamo/Blender bone rig (`mixamorig:LeftUpLeg`, `upper_arm.L`, `Hips`, `Spine2`, ...).
- `public/js/anim/clip_library.js` authors 39 clips (429 tracks, 1848 keyframes) covering
  locomotion, air, flight, combat, defence and reactions. These are hand-authored keyframes
  generated by this project, **not motion capture**; downloaded packs replace them clip by clip.
- `public/js/anim/animation_controller.js` runs one mixer per fighter with crossfades, priorities
  and one-shot locks, and retimes each attack clip so its strike peak lands exactly on the
  gameplay active window `(start + end) / 2`. Damage and hitboxes stay in `fighter3D.js`.
- `public/js/anim/animation_loader.js` loads installed GLB packs, retargets their clips into
  canonical bone space, strips root motion so physics keeps control of position, and reports what
  matched. Nothing is reported as external unless a real file on disk supplied it.
- `public/data/animation-manifest.json` lists the 39 clip ids and the candidate Mixamo/Sketchfab
  packs with their sources and licence notes. No pack is installed by default.

## Gameplay systems

The fight is simulated at a fixed 60 Hz in `public/js/main.js` (`simulationStep`) and drawn on
the render loop. Combat maths lives in one place, `public/js/combat/combat_rules.js`, so damage,
launch strength, hit stun and round scoring are unit-testable instead of being scattered through
the loop.

### Controls

| Action | Player 1 | Player 2 (local) |
| --- | --- | --- |
| Move | WASD / left stick | Arrow keys / second gamepad |
| Light attack (3-hit chain) | J | `,` |
| Signature move | K | `.` |
| Throw | U | `/` |
| Jump / double jump | Space | Enter |
| Sprint (hold) / dash (tap) | Left Shift | Right Shift |
| Guard (hold) / parry (tap) | E | `;` |
| Anti-air attack | Up + J | Up + `,` |
| Air dive kick | Down + J in the air | Down + `,` |
| Flight toggle / descend | F / C | `[` / `]` |
| Web swing (Spider-Man) | G | `\` |

`2P LOCAL` on the match setup screen hands the second fighter to the second binding set instead
of the CPU. Gamepad 0 drives P1 and gamepad 1 drives P2.

### Combat

- Three-hit strings chain while `comboWindow` is open, with damage scaling down across the chain
  and a launcher on the third hit.
- Hits spawn a short-lived sphere hitbox at the attack's reach; the defender is a capsule at their
  centre with `hurtboxRadius`. Guarded hits take 28% damage and 25% knockback, and never trigger hit-stop.
- Tapping guard opens a 0.22 s parry window that reflects projectiles and stuns the attacker.
- Throws pull the victim in front of the attacker and launch them, rather than dealing a punch.
- Knockback and hit stun scale with accumulated damage and are reduced by fighter weight, so heavy
  characters (Hulk, Doom Slayer) survive longer than light ones (Professor X, Edna Mode).
- Strong hits freeze the simulation for 50-85 ms (`window.requestHitStop`) while VFX and camera
  shake continue.

### Matches

Rounds are best of three (`roundsToWin: 2`) with an 80-second clock and a 150% knockout threshold in
`combat_rules.js`. A round ends on a knockout, a time-out decided on lower damage, or a ring-out; a
drawn round is replayed and awards nothing. Round results show a banner, spawn both fighters at the
arena's spawn points with 1.1 s of invulnerability, and reset damage. Two round wins end the match,
return to the setup screen and offer a rematch.

### Arenas and collision

`public/js/world/arena_layouts.js` gives every arena its own playable rectangle, spawn points,
solid volumes and walkable platform heights instead of the old shared 34 × 16 m box:

| Arena | Playable area | Notable solid geometry / platforms |
| --- | --- | --- |
| Valley of Echoes | 120 × 95 m | landmark rocks, gate posts |
| Obsidian Volcano | 140 × 108 m | caldera cone |
| Frostfall Citadel | 140 × 106 m | citadel |
| Neon Megacity | 132 × 108 m | tower block row |
| Death Star | 112 × 35 m | conference table, throne dais (walkable), consoles |
| Final Valley | 116 × 88 m | authored obstacle list |
| DBZ Tournament | 34 × 30 m | raised ring floor at 0.18 m |
| Helicarrier / Stark Penthouse | 87 × 46 m | penthouse walls, sofa, bar, elevator shaft |
| Asgard | 108 × 86 m | house rows, fountain |
| Hogwarts Great Hall | 42 × 87 m | four jump-on-able house tables, nave columns |

Volumes are resolved with a capsule-vs-box/circle push that strips the inward velocity, so a fighter
slides along walls. Anything whose top is within `STEP_HEIGHT` (0.42 m) of the feet is stood on:
low steps are climbed, tables need a jump, and high walls block. Bounds clamping is the boundary
line; walking out is not possible during a match.

### Match setup screen

`public/js/ui/character_select.js` builds a two-step setup flow (fighters, then arena) from the
roster the game actually has. It writes to the existing `#p1Character`, `#cpuCharacter` and
`#menuMapSelect` elements and dispatches real `change` events, so character swapping and arena
streaming keep using the existing code paths. Choosing an arena loads it behind the menu as a live
preview. Selection cards show each fighter's archetype and signature move, and each arena card shows
its kind and playable size.

### Test hooks

The game exposes a few read-only hooks for automated play-testing:

- `window.__browserSmashMatch()` — round, wins, clock, status, mode and arena.
- `window.__browserSmashStep(seconds)` — advance the fixed-step simulation deterministically.
- `window.__browserSmashTrainingDummy = true` — stop the CPU from blocking or dodging, so hit checks
  are reproducible.
- `window.__browserSmashSelect` — the setup screen controller (`chooseArena`, `select`, `setMode`).

## Validation

- `npm run validate:animations` — compiles all 39 clips against a hierarchical rig and asserts:
  every required clip exists, tracks are sorted/closed for loops, no NaN keys, loops return to their
  opening pose, strike peaks land within one frame of the gameplay hit window, limbs reach the
  intended place in world space (jab extends, guard keeps its elbow bent, front kick lifts the
  shin, flight spreads the arms and trails the legs, knockdown puts the head on the floor), the
  state machine reaches every state and recovers from hits, and the manifest has no orphan clips.
- `npm run validate:assets` — parses every GLB header, checks the character and weapon prefab
  counts the loaders require, checks each arena's marker node and mesh count against the
  loader's own `MODEL_PATHS`, and reports enabled manifest entries that point at missing
  files. Optional assets that are not installed yet are warnings, not failures.
- `npm run build` — production build into `dist/`.
- `npm run test:combat` — node tests for damage, knockback, hit stun, combo chaining, round/match
  flow, arena bounds, spawn placement and box/circle collision (94 checks, no browser needed).
- `npm run test:gameplay` — Playwright play-test that chooses two fighters and an arena, starts a
  match, moves, jumps, double jumps, punches, chains, guards, throws, wins two rounds, switches
  arenas mid-session and verifies local two-player input; 47 checks plus zero page/console errors.
- `npm run test:smoke` — Playwright runtime test (needs `npm install --no-save playwright three@0.152.2`
  and `npx playwright install chromium`). Verifies both entrypoints render, the character and
  weapon libraries load, and an authored arena streams in when its map is selected.
- `npm run audit:roster` — Playwright runtime audit that drives the real character select through
  every launch fighter and asserts the prefab rig (11 joints), its weapon mount and its generated
  surface detail are all present on the live fighter. Prints a machine-readable summary and fails
  on the first fighter that does not mount.
- `.github/workflows/validate-game.yml` — browser-module, roster, cache-version, asset fixture, and Playwright smoke validation.
- `.github/workflows/build-character-animations.yml` — optional Blender bake once the real source models are installed.
- `node scripts/inspect-animation-pack.mjs <file.glb>` — reads a downloaded GLB's clips, skeleton and
  recognised bones, and with `--pack <id> --install` enables it in the animation manifest.

## Camera modes

The camera has four modes in the in-game camera panel, persisted under
`browserSmashCameraMode_v2`:

- **Overhead** (default) — high, steep, anchored on the midpoint of both fighters. Its
  distance is derived from their separation and any altitude gained by jump/flight, so
  neither fighter leaves the frame. Added because the old elevated modes anchored on the
  player and always sat on +Z, which let the opponent drift out of shot.
- **Over P1** — the previous over-the-shoulder follow shot.
- **Forward** — forward-facing arena view.
- **Classic** — wide arena view.

Mouse wheel adjusts distance, right-drag orbits, and impact shake is applied on top. The overhead
mode frames a close duel at roughly 7.5-9 units with a 38-50 degree lens, which keeps a ~2m
fighter at about a fifth of the frame height instead of the speck it became with the old
13-unit/52-degree framing.

## Character rendering and animation

- `public/js/surface_detail.js` bakes tiling detail maps (fabric weave, brushed armour, leather
grain, skin pores) once and applies them to cloned prefab materials, classified by material name.
  The shipped `character_models.glb` and `character_weapons.glb` contain 761 PBR materials and zero
  image textures, so without this every fighter renders as smooth plastic. Per-fighter classes are
  reported at `window.__browserSmashAssets.lastCharacterDetail` and
  `fighter.model.userData.surfaceDetail`.
- `public/js/sky_environment.js` generates an equirectangular sky per arena (gradient, sun disc,
  fill highlight) and uses it as `scene.environment`, so armour and weapons reflect the arena they
  are fighting in instead of a neutral photo-studio box.
- `public/js/smash_render_pipeline.js` uses ACES filmic tone mapping so emissive trim and energy
  attacks roll off instead of clipping. The post-processing bloom chain stays disabled: the r152
  composer pipeline blanked every material in this project, so glows are authored in-material.
- The prefab rigs are authored in a T-pose. `Fighter3D.updateProceduralPose` now drops the
  shoulders additively after the combat pose is written, so every fighter idles with its arms down
  instead of standing in a T-pose, and the menu keeps posing both fighters while the simulation is
  paused.

## Authored arenas

`public/assets/arenas/*.glb` hold the authored Blender versions of the Asgard, Stark
Tower/helicarrier, Death Star, Hogwarts and Tournament maps. `public/js/arenas/cinematic_arenas.js`
streams the selected one lazily and caches it. When it loads it replaces the procedural set
dressing for that map; if the file is missing or fails its structure check the procedural
arena stays up, so a match never depends on the download. Set
`window.__browserSmashAuthoredArenas = false` before choosing a map to compare against the
procedural build. Current loader state is exposed at `window.__browserSmashAssets.authoredArena`
and `window.__browserSmashAssets.arenas`.
- `.github/workflows/build-final-valley.yml` — Final Valley asset workflow.

Always inspect the latest Actions run. Distinguish a passing source/build test from verified gameplay using the real Goku and Iron Man assets.

## Asset licensing

Check each downloaded asset's license and relevant rights before distributing the game. Preserve creator attribution and add entries to `public/ATTRIBUTIONS.md` for assets actually used. Do not commit paid assets or redistribute assets whose license does not permit it.
