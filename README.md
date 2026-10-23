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
- `npm run test:worlds` — node checks for the four large worlds: every battle location is
  registered, its bounds and spawn points are valid and separated, spawns stand on a real
  surface and not inside a wall, the shared collision volumes are finite and consistent, raised
  decks are overhead rather than walls, and ring-out stages report falls and knock-offs.
- `npm run test:worlds:browser` — Playwright test that loads every world battle location in
  Chromium, places both fighters on the stage's real spawn points, and asserts the world
  geometry is mounted (one merged group, bounded draw calls), fighters stand on the world
  surface, movement and attacks still connect, switching world replaces the geometry without
  adding lights, and a classic arena unloads it again.
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

## Worlds, stages and travel

The four reference worlds now hold 33 battle locations (Dragon Ball Z 8, Asgard 5, Death Star 11,
Hogwarts 9). Each world is one built environment; the locations inside it are rectangles over that
same geometry, so switching stages within a world does not rebuild the map.

Stages are joined by marked doorways: a lit ring and light column at the edge of a stage that
leads to a neighbouring stage. Walking into one moves the match there (callout, then the new
stage's spawns). That is a deliberate transition between separate stages, **not** one streaming
open world: `WORLD_LOCATIONS` carries the `exits` graph, `scripts/test-worlds.mjs` checks every
exit for a real destination, same-world containment, distance from spawns, solid-geometry overlap
and a reciprocal return exit, and the browser test drives a fighter into a doorway and asserts the
match moved, the fighters landed on the new spawns and only one world group stayed mounted.

Death Star stages: Command Deck, Main Hangar, Corridor Junction, Reactor Core, Superlaser Control,
Escape Pod Bay, Trench Run, Engineering, Droid Factory, Imperial City, Outer Hull. The hangar
spine, the east/west spur and the Trench Run-to-city corridor are built as geometry, so the rooms
are visibly joined even though each remains its own battle stage.

Hogwarts stages: Great Hall, Castle Courtyard, Viaduct Bridge, Quidditch Pitch, Forbidden Forest,
Black Lake Boathouse, Hogsmeade, The Dungeons (a vaulted undercroft with cells and a water channel)
and Hagrid's Hut (a real walkable stage around the hut and pumpkin patch).

What is still scenery rather than a stage: Asgard's palace is a facade with a lit colonnade, not a
walkable interior; the shipyards and grounds beyond the named stages are decoration, and there is
no continuous walk from one end of a world to the other.

## Large world materials

`public/js/worlds/world_textures.js` draws the tileable surface maps the four reference worlds
are built from: stone courses, riveted metal panels, timber planks, grass, marble veining and
shingles. Each world part is merged per material, so per-object tiling is impossible; instead
`world_builder.js` projects every vertex's UV from its own world position, and the texture repeat
turns those metre-space UVs into a fixed tile size per surface family (3-8 m). One 256px canvas
per family is shared by every material that asks for the same tile size, so the four worlds still
render in roughly 17-31 draw calls each and no external texture assets are required. Palette
colours stay authoritative, which is how the same stone map reads as DBZ sandstone, Asgard marble
and Hogwarts granite. `STAGE_LIGHTING` in `world_catalog.js` gives each world its own key strength,
rim tint, hemisphere fill, exposure and fog scale, and `SmashCamera.setStageBounds()` keeps the
camera out of the stage's solid volumes on the large maps.

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

## Large worlds

Four reference worlds are built as playable environments, not pictures. Each is one large
map with several named battle locations (26 in total); a location is a rectangle inside the
same geometry, so switching stages inside a world does not rebuild anything.

| World | Battle locations |
|---|---|
| Dragon Ball Z — World Tournament Island | Grand Prize Stage, Main Entrance, West City Streets, Capsule Corporation, Martial Arts Dojo, Training Grounds, Ring Out Cliffs, King Kai's Planet |
| Asgard — Home of the Æsir | Royal Palace Court, Marketplace Plaza, Rainbow Bridge, Bifrost Realm, Outer Floating Isle |
| Death Star — Imperial Battle Station | Command Deck, Main Hangar, Corridor Junction, Reactor Core, Superlaser Control, Escape Pod Bay |
| Hogwarts — Castle and Grounds | Great Hall, Castle Courtyard, Viaduct Bridge, Quidditch Pitch, Forbidden Forest, Black Lake Boathouse, Hogsmeade Village |

- `public/js/worlds/world_catalog.js` holds the worlds as deterministic geometry plans plus
  palettes, themes, battle-location bounds and spawn points. It is plain data with no Three.js
  or DOM, which is why node can validate all of it.
- `public/js/worlds/world_builder.js` merges every part that shares a material into one mesh:
  a whole world is ~12-18 draw calls. Worlds are cached while the player stays in them and
  their geometry is disposed on leaving.
- Collision volumes come from the same parts (`blocksFromParts`). `bottom` marks the underside
  of a raised deck or roof, so a catwalk is walkable from above and does not act as a wall for
  someone standing under it.
- Ring-out stages (`ringOut`, `fallBelow`) skip the arena clamp: falling off the Rainbow
  Bridge, the viaduct, the cliffs or King Kai's planet loses the round.
- The worlds appear in both map pickers and in the setup screen, grouped under a world tab.
  Their themes drive background, fog, sun/rim/hemisphere colour and interior exposure, so no
  per-map code is needed when adding another location.
- `SmashCamera` pulls back and lowers its angle on these stages (`setStageTilt(tilt, scale)`),
  and derives a minimum distance from the fighters' separation so a wide spawn cannot push one
  fighter out of frame.

Adding another location to an existing world is a catalog entry: bounds, two spawn points,
and the collision volumes are shared automatically.

### Running the browser tests on a bare Linux box

`npm run test:smoke`, `test:gameplay` and `test:worlds:browser` need Chromium's shared
libraries and a fontconfig file. On a machine without root, stage them locally and point the
runner at them:

```sh
export LD_LIBRARY_PATH=$HOME/pwlibs/root/usr/lib/x86_64-linux-gnu
export FONTCONFIG_FILE=$HOME/pwlibs/fonts.conf
```

Without `FONTCONFIG_FILE`, Skia aborts with `SkFontMgr_FontConfigInterface.cpp Not implemented`
as soon as the HUD renders text.
