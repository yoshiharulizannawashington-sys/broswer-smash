# Recovery status

Living ledger for the Browser Smash / Browser Bros project. Update it as work lands.
Baseline: `work/gameplay-and-polish` (461 commits, ahead of `origin/main`).

## Working (implemented and verified)

**Boot and build**
- Vite build serves `public/` and both entry points (`index.html`, `public/index.html`).
- `npm run build` passes; the bundle is ~1.15 MB (330 kB gzip) plus the shared character GLBs.
- Runtime smoke test loads both entry points with no page errors (`npm run test:smoke`).

**Roster and selection**
- 33 selectable fighters on the launch roster (`roster`), 32 + Iron Spider; the rest sit in
  `dlcRoster`.
- Character select screen with 1P vs CPU / 2P local, a two-step flow (fighter → arena), a combat
  style and signature move per fighter, and an arena grid grouped by world.
- Roster audit mounts every selectable fighter's prefab rig, weapon and surface detail
  (`npm run audit:roster`).

**Fighters**
- 57 shipped prefab characters in `public/assets/character_models.glb` with weapons in
  `character_weapons.glb`, driven by an animation clip pipeline (`animation-manifest.json`,
  39 clips with 39 required ids).
- Rig validation: root tilt, joints, drawable meshes, height, silhouette, feet on origin, head
  above pelvis, every joint inside the body (`npm run test:rig`, 31 checks).
- Procedural fallback bodies for identities with no prefab (currently Iron Spider only).

**Combat and movement**
- Movement, sprint, dash, jump/double jump, air dodge, guard/parry, light and heavy attacks,
  signature ("special") moves, throws, hit stun, knockback, knockdown, KO, ring-outs.
- Frame data with startup/active/recovery windows, hit-stop, cooldowns, per-fighter projectiles.
- Flight (F to toggle, C to descend) with collision against the world; web-swinging for Spider-Man.
- Item pickups (e.g. "Goku picked up overdrive core"), energy meters, HUD.
- `npm run test:combat` (339 checks), `test:gameplay` (48), `test:iron-spider` (33).

**Camera**
- `SmashCamera.js`: elevated overhead fighting camera with fighter-separation framing, zoom,
  stage tilt/yaw/scale hints, stage-bounds collision, impact shake.
- Never opens under a raised stage; aims at the fighters' chest.
- `test:gameplay` asserts "camera stays pulled back and elevated"; `test:feel` (138 checks) covers
  framing, elevation and scenery clipping on four stages.

**Worlds (six, 58 battle locations)**
- Asgard (6), Hogwarts (9), Death Star (11), World Tournament (11), Hidden Leaf Village (12),
  New York / Stark Tower (9).
- One registry drives geometry, collision, spawns, map pickers, stage cards and lighting.
- Doorway travel between stages of a world; one world group mounted at a time.
- Ground + world tests: 26,672 assertions; browser test 805 checks across all 58 locations.

**Environments and assets**
- Five authored arena GLBs (asgard, deathstar, helicarrier, hogwarts, tournament) plus
  `final_valley.glb`; all load, and a missing GLB falls back to the procedural build.
- Tileable canvas surface textures (stone, panel, plank, grass, marble, roof) projected from world
  position, shared per material family.
- Per-world sky presets and image-based lighting.

## Incomplete or broken

- **New York interiors.** Stark Tower has a glass lobby shell only; no explorable floors.
- **Valley of the End is not connected to Konoha.** It exists as the standalone `finalvalley`
  arena + `final_valley.glb`; the exit graph is per-world, so there is no doorway from the village.
- **No world-overview screen.** Stages are cards in tabs; there is no numbered map overview with
  per-location previews. The registry already carries everything such a screen needs.
- **Legacy map system.** Root `mapLoader.js` + `maps.json` describe `rainbow_road`,
  `grand_archive`, `valley_of_ends` and load `/assets/stages/*.glb` + `/assets/envs/*.hdr`. Those
  asset folders do not exist and nothing in the served bundle imports the loader, so the three
  definitions are dead metadata. Recoverable only if the GLBs are supplied.
- **Legacy arenas still listed.** `starktower` (Helicarrier deck / Stark penthouse) predates the
  New York world and remains selectable; it and the New York stages overlap in theme.
- **Art direction.** Worlds are procedural primitives with generated textures: stylised, not the
  photoreal reference art. Closing that gap needs authored GLB kits and PBR textures, not more
  procedural geometry.
- **Crowds, traffic, NPCs.** Absent by design (static props only).
- **Vehicles** in New York are static boxes; no animation.

## Missing

- **User-supplied Goku package** (`public/models/characters/goku/Goku.fbx` + textures) and
  **Iron Man Mark V** (`Iron Man Mark V Rig Materials.gltf` + `.bin` + textures). Both manifest
  entries stay disabled; the game falls back to procedural fighters and reports it at runtime.
  Install with `node scripts/install-character-assets.mjs /path/to/extracted-package`.
- **Iron Spider model.** Manifest entry staged against
  `https://sketchfab.com/3d-models/iron-spider-avengers-infinity-war-99e52e57a8dc4feda750af87b87d2955`
  (Kabiidev, CC Attribution, exact version unconfirmed). Not bundled — a signed-in Sketchfab
  download is required, then `node scripts/install-character-model.mjs <file.glb> --identity
  "Iron Spider" --facing 0 --attribution … --license … --source …`.
- **Stage GLBs for the legacy map system** (`/assets/stages/*.glb`) and its HDRI
  (`/assets/envs/studio_small_03_1k.hdr`).
- **Mixamo clips.** The clip library is procedural/baked today; no Mixamo FBX files exist in the
  repo, so retargeting to them has never been done.
- **Iron Spider's four mechanical legs.** No leg rig exists; only the humanoid body is animated.

## Test commands

```
npm run build                 vite production build
npm run test:worlds           world registry, geometry, collision, spawns, exits, ring-outs
npm run test:worlds:browser   loads every stage through the real selection API and fights in it
npm run test:combat           frame data, hitboxes, projectiles, ring-outs
npm run test:gameplay         full match loop, both players, camera framing
npm run test:feel             per-stage camera and combat feel
npm run test:rig              character rig validation
npm run test:iron-spider      Iron Spider identity, model slot and travel
npm run test:smoke            both entry points, runtime errors, asset requests
npm run audit:roster          mounts every selectable fighter's rig on the live fighter
npm run validate:assets       asset manifest vs files on disk
npm run validate:animations   animation manifest vs clips
```

Browser suites need Chromium's shared libraries, which the cloud VM drops between sessions:
`source <(bash scripts/setup-browser-libs.sh --env)` before running them.
