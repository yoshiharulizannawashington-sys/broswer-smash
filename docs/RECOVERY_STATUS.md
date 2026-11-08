# Recovery status

Living ledger for the Browser Smash / Browser Bros project. Update it as work lands.
Baseline: `work/gameplay-and-polish` (461 commits, ahead of `origin/main`).

## Working (implemented and verified)

**Boot and build**
- Vite build serves `public/` and both entry points (`index.html`, `public/index.html`).
- `npm run build` passes; the bundle is ~1.15 MB (330 kB gzip) plus the shared character GLBs.
- Runtime smoke test loads both entry points with no page errors (`npm run test:smoke`).

**Roster and selection**
- 38 selectable fighters on the launch roster (`roster`), including the three restored promotions
  **Wolverine**, **Geralt** and **Doom Slayer**; the remaining 22 names sit in `dlcRoster`.
- Character select screen with 1P vs CPU / 2P local, a two-step flow (fighter → arena), a combat
  style and signature move per fighter, and an arena grid grouped by world.
- Roster audit mounts every selectable fighter's *own exported body* on the live fighter and
  asserts the rig, the eleven canonical joints, the resolved skeleton, the weapon (or one of the
  three documented unarmed identities), feet on the origin, head above the pelvis and the generated
  surface detail. Latest run: 38/38 mounted on the file exported for them, one unique asset per
  fighter, 34 weaponed / 4 unarmed by design, 38 with `armor`/`fabric`/`generic`/`skin` detail,
  0 page errors.

**Fighters**
- All 38 selectable identities mount a real skinned, rigged GLB from
  `public/models/characters/roster/` (58 generated in total, including the DLC roster), plus
  **Kaze** from `public/models/characters/kaze/kaze.glb` — the reference export. Every body is
  19 bones, 8 clips, authored UVs and sRGB-correct PBR materials, and every mesh in every file is
  bound to the skeleton. `npm run test:roster-models` asserts that per fighter, straight from the
  roster list in `public/js/main.js`. The generated bodies are original work by this project,
  produced by `assets/blender/build_roster_fighters.py` on the same kernel as Kaze; see
  `docs/BLENDER_PIPELINE.md`. Everything runs on the same `animation-manifest.json` clip layer
  (39 clips, 39 required ids).
- `public/js/characters/sculpted.js` still builds the authored Goku / Iron Man / Iron Spider
  bodies before the manifest swap, so they remain the pre-swap body and the fallback if an import
  is ever rejected. The first-generation exports that rendered worse than them are retained as
  disabled entries (`goku-alt`, `iron-man-alt`, `iron-spider-alt`).
- Rig validation: root tilt, joints, drawable meshes, height, silhouette, feet on origin, head
  above pelvis, every joint inside the body (`npm run test:rig`, 31 checks); imported bodies are
  additionally gated on binding all eleven canonical bones.
- Every exported body also receives the generated weave/brushed/grain detail maps
  (`public/js/surface_detail.js`). They used to be applied only to the prefab body that the
  fighter's own export replaces a frame later, so all 34 fighters rendered as smooth flat plastic
  under their real bodies; they now report surface detail in the roster audit.
- The hit-reaction lean is authored on the imported asset *under* the fighter holder, not on the
  fighter root. Writing roll on the root made a fighter that happened to be checked mid-hitstun
  fail the structural rig gate ("root is tilted 7.4 degrees off world up"), which is what broke
  `test:iron-spider`'s stage-travel check.
- `npm run probe:bodies` asserts that whatever the manifest says is the body on screen is the
  body on screen, for every manifest character, on the live fighter. Old `original/*.glb` exports
  are superseded and disabled; their reason is recorded in the manifest entry and in
  `docs/CHARACTER_BODY_AUDIT.md`.
- Environment restore, because `node_modules` is disposable and `npm ci` removes it: re-run
  `bash scripts/install-blender.sh` (Blender's X libraries live in `node_modules/.system-libs`),
  and install the browser test dependency with `npm install --no-save playwright` plus
  `npx playwright install chromium` before the browser suites. `npm ci` also deletes
  `node_modules/.system-libs`, which is where *both* Blender's X libraries and Chromium's shared
  libraries live, so a restored session needs `bash scripts/install-browser-libs.sh` as well - it is
  what `scripts/run-browser-test.sh` calls when the prefix is missing. Without it every browser
  suite dies with `libnspr4.so: cannot open shared object file`, and `node scripts/test-mechanics.mjs`
  run directly (outside the wrapper) dies the same way, which reads like a test failure but is not.

**Per-identity detail geometry (Goku, Iron Man)**
- The launch bodies are one shared anatomy plus a garment/head/hair/extra spec, so two fighters with
the same spec are the same model in another colour. `build_signature_details()` in
`assets/blender/build_roster_fighters.py` now adds the details that are identity-specific rather
than archetype-specific, for the two visual benchmarks: **Goku** gets a forward anime fringe on the
measured brow line (the `spikes` hairstyle deliberately skips the shared fringe), sideburn locks,
and blue forearm wraps with a knot that close the gi sleeve onto the wrist; **Iron Man** gets
emissive palm repulsors (housing ring, lit lens, wrist slit) and three chest vents so the
breastplate reads as machined panel work.
- Rebuilt only those two exports:
`bash scripts/blender.sh -b --python assets/blender/build_roster_fighters.py -- --out-dir public/models/characters/roster --only goku,iron_man_tony_stark`.
Goku `roster/goku.glb` 842,428 -> 892,260 bytes, 6,775 -> 7,568 vertices, 12,430 -> 13,862
triangles; Iron Man `roster/iron_man_tony_stark.glb` 801,756 -> 856,920 bytes, 6,210 -> 7,116
vertices, 11,216 -> 12,556 triangles. Both keep 19 bones, all eleven canonical joints bound and
their 17 clips.
- `kernel.bone_for_part()` now accepts a side token followed by a dot. Blender appends `.001` when a
part name is already taken, and `wrap-L.001` resolved to `NoneForeArm`, which failed the bind check
with `groups with no bone`. That is exactly the silent-mis-binding failure the function exists to
catch, so the regex tolerates the suffix instead of relying on every caller choosing unique names.
- `npm run audit:roster` in `package.json` now runs through `scripts/run-browser-test.sh` like the
other browser suites. Run directly through `node`, it dies on `libnspr4.so: cannot open shared
object file` and looks like a game failure; the audit itself passes 38/38.
- Evidence: `artifacts/gallery/goku-detail`, `artifacts/gallery/ironman-detail` (idle / light /
special each, 0 page errors). Through the real gameplay camera Goku reads as the orange gi over the
blue undersash with spiked hair and dark boots, Iron Man as the red-and-gold armour with helmet and
reactor. Worst effect/fighter ratio in those runs: Goku light 0.95, Goku special 0.40, Iron Man
light 0.38, Iron Man special 0.52.

**Arena floor contrast and contact shadows**
- The tournament dojo floor was the worst readability problem in the captures: a near-white limestone
  tile (`0xe7ddc8`) on a 700 m plane under 1.22 exposure and three lights, so a 104-260 px fighter had
  almost no edge against the ground. Fixed at the source, in `assets/blender/cinematic_arenas.py`:
  the tile is now `0xb9ad94` and the tile joints `0x8a7f6b`, and `tournament.glb` was re-exported.
  The builder gained a `--only=` filter (`bash scripts/blender.sh -b --python
  assets/blender/cinematic_arenas.py -- --only=tournament`) because rebuilding one arena used to mean
  rebuilding all five and silently churning the other four GLBs.
- `public/js/main.js` also darkens the base plane's tournament material (`#c9b895` -> `#8c8067`) and
  lowers the outdoor light budget (sun 2.8 -> 2.3, rim 2.5 -> 2.05, hemisphere 1.5 -> 1.12, exposure
  1.22 -> 1.02; interiors and the Valley keep their own values).
- Every fighter now has a real contact shadow: one soft radial-gradient quad that stays on the floor,
  scales with the fighter and fades out as they leave the ground (`updateContactShadow` in
  `main.js`, called from the render loop). The directional shadow map spans a 220 m camera at 2048 px,
  so a fighter's own shadow is too diffuse to say where the feet are; the blob is a single transparent
  plane and costs nothing measurable.
- Measured on identical camera, arena, zoom and fighter position (PIL on the gallery PNGs):
  floor median luminance **240 -> 224** for both Goku and Iron Man idle captures, with the near-white
  floor no longer dominating the frame. Frames: `artifacts/gallery/goku-arena`,
  `artifacts/gallery/ironman-arena` against `artifacts/gallery/goku-detail`,
  `artifacts/gallery/ironman-detail`.
- Correction to an earlier attempt in this cycle: I first measured a "fighter vs floor" delta from a
  fixed box, then found the gallery's `percent` field is a per-shot delta rather than an absolute
  screen position, so that box was not on the fighter and the number was meaningless. The recorded
  evidence is now the floor luminance plus inspected frames, not that invalid ratio.

**Browser suites under the wrapper**
- `test:mechanics`, `test:explore`, `test:smoke`, `test:worlds:browser`, `test:iron-spider`,
  `test:feel` and `audit:roster` now run through `scripts/run-browser-test.sh` in `package.json`. Run
  under plain `node` each dies on `libnspr4.so: cannot open shared object file` (exit 127 inside
  Playwright), which reads like a game failure. With the wrapper they pass: mechanics 74, explore 49,
  smoke both entry points, worlds-browser 831 across 60 locations, iron-spider 39, roster audit 38/38.

**Combat and movement**
- Movement, sprint, dash, jump/double jump, air dodge, guard/parry, light and heavy attacks,
  signature ("special") moves, throws, hit stun, knockback, knockdown, KO, ring-outs.
- Per-character movement identity: every launch fighter has an explicit locomotion profile in
  `public/js/combat/locomotion.js` — walk/run/sprint top speed, ground and air acceleration,
  braking, jump impulse, gravity and reversal commitment. It replaced one generic speed table with
  two hard-coded identity checks (The Flash, Spider-Man) and nothing else, so The Flash, Hulk,
  Professor X and Iron Man no longer accelerate at the same rate. `npm run test:locomotion` (61
  checks) asserts every roster identity has a profile, that no profile key is dead data, and that
  the real integration produces the differences: a speedster is 30%+ clear of the bruiser after
  half a second, a heavyweight carries more momentum when the stick is released, and Hulk's jump
  apex is higher than The Flash's.
- The per-character move table (`CHARACTER_MOVE_PROFILES`) had two dead keys — `hulk` and
  `iron_man` could never match the identity slugs `hulk_bruce_banner` / `iron_man_tony_stark` — so
  the Hulk's slower startup and heavier knockback had never applied. Both are fixed, every launch
  identity now has its own move profile, and `test:locomotion` fails if a key stops matching a real
  identity.
- Frame data with startup/active/recovery windows, hit-stop, cooldowns, per-fighter projectiles.
- Flight (F to toggle, C to descend) with collision against the world; web-swinging for Spider-Man.
- Item pickups (e.g. "Goku picked up overdrive core"), energy meters, HUD.
- `npm run test:combat` (394 checks), `test:gameplay` (88), `test:iron-spider` (39),
  `test:mechanics` (74).

**Match loop, pause and difficulty**
- Full journey: title → fighter select → arena select → match → round banners → KO → result
  ("VICTORY · <fighter>") → rematch, with the arena streaming in behind the menu.
- The result screen reports real numbers accumulated by the simulation: series score, match clock,
  damage dealt and taken, biggest single hit and hits landed (`resultMarkup` in `main.js`).
- Training mode (`PRACTICE MODE`): the round clock and round endings are off, and an overlay
  (`public/js/ui/training_panel.js`) reads the live simulation — damage dealt, hits, biggest hit,
  combo, current move and phase, hitstun, power/meter, and the dummy's damage/hitstun/knockback
  speed. The opponent can stand still, hold guard, pace, fight back, or be invulnerable; positions
  reset on **R**, damage resets on **T**, and the panel exits to the menu.
- Training damage is accumulated by sampling the live damage totals each step, so melee hits,
  projectiles, signature moves and ultimates are counted by one rule instead of per call site
  (`trackMatchSample`).
- Match rules are configurable in the setup screen and are read by the live round loop: rounds to
  win (first to 1/2/3) and round length (60/80/120 s). A shorter round cannot leave the clock
  showing more time than the round now allows.
- In-match pause menu (**Esc**): resume, restart series, character select, return to title, plus the
  controller reference and audio mute/volume. Opening it clears the edge-trigger input buffers and
  freezes the simulation, the round clock, projectiles and particles, and suspends the combat audio,
  so a key pressed while paused cannot fire an attack on the first frame back. Escape is owned by
  `main.js` rather than by the overlay, so one press cannot both open and close the menu.
- "Return to title" hands the Start / Practice / Explore buttons back to the original panel and
  re-shows the title markup, so the title screen is not a dead end (`showTitle()` in
  `public/js/ui/character_select.js`).
- CPU skill (ROOKIE / FIGHTER / ACE) lives in `public/js/combat/cpu_skill.js` and is a
  decision-quality setting only: attack cooldown, notice distance, startup read-ahead,
  parry/block/dodge chance, attack hesitation and how often the CPU spends a special, a form or the
  meter. It never touches health, damage, weight or knockback. The AI re-reads the profile on every
  decision, so a change applies to the running match, and the level is persisted in
  `localStorage.browserSmashCpuSkill`.
- `npm run test:cpu-skill` (43 checks, no browser) pins the ordering, the completeness, the absence
  of any stat multiplier, and that `main.js` reads the table instead of keeping its own numbers.

**Camera**
- `SmashCamera.js`: elevated overhead fighting camera with fighter-separation framing, zoom,
  stage tilt/yaw/scale hints, stage-bounds collision, impact shake.
- Never opens under a raised stage; aims at the fighters' chest.
- `test:gameplay` asserts "camera stays pulled back and elevated"; `test:feel` (138 checks) covers
  framing, elevation and scenery clipping on four stages.

**Impact VFX readability**
- The hit burst no longer buries a fighter. `public/js/combat_vfx.js` used one shared formula for
  every hit: the flash radius grew with the attack intensity and was then multiplied by up to 4.2x
  during its life, so a 23-intensity explosion built a ~2 m additive sphere at .98 opacity sitting on
  the target - the white puff that covered the fighter in gameplay captures. It is now graded
  (`light` / `heavy` / `guard` / `ultimate`) with a hard radius ceiling (`flashMax`), a short life,
  layered thin rings that expand with the square of their age, directional sparks, and no post-creation
  scaling of the additive flash. The effect reads the intensity it is handed and writes nothing back:
  hit radius, damage, hitstun and hit detection are unchanged.
- Measured, not eyeballed: `bash scripts/run-browser-test.sh scripts/visual-gallery.mjs` captures the
  real game through its own camera at a fixed viewport, zoom and arena, and reports the largest live
  effect near a fighter as a ratio against that fighter's projected height. Goku light attack 0.71
  with 275 effect meshes before, 0.65 with 80 after; special 0.66 -> 0.55; transformation 0.30 ->
  0.19; the targeted 23-intensity probe (the case that buried a fighter) 0.69 with 71 particles ->
  0.61 with 45. Frames in `artifacts/gallery/before2` (before) and `artifacts/gallery/after` (after),
  inspected: the before frame shows the fighter under an opaque white mass with head and torso
  unreadable, the after frame shows him fully visible with a contact spark and thin rings.
- Form pass on contrasting fighters through the gameplay camera: Goku (KAIOKEN), Iron Spider
  (SPIDER ASSAULT PROTOCOL), Hulk (WORLDBREAKER RAGE) and Kaze (WIND-STEP) all keep a readable
  silhouette; worst effect/fighter ratio in those runs is 0.78 (Iron Spider light attack), 0.61
  (Hulk) and 0.60 (Kaze). Captures in `artifacts/gallery/forms-hulk`, `forms-kaze`,
  `after-ironspider`.
- Camera framing was re-measured on the real controller (`scripts/measure-camera.mjs`, 14 samples,
  two arenas): 0 fighters out of frame, specials framed at fov 39.5-42.6 rather than a distant
  pull-back, smallest fighter height 104 px. No attack-specific camera limit was added, because
  nothing measured needed one; the render pipeline (`public/js/smash_render_pipeline.js`) was not
  touched.

**Worlds (six, 59 battle locations)**
- Asgard (6), Hogwarts (9), Death Star (11), World Tournament (11), Hidden Leaf Village (12),
  New York / Stark Tower (10).
- One registry drives geometry, collision, spawns, map pickers, stage cards and lighting.
- Doorway travel between stages of a world; one world group mounted at a time.
- Ground + world tests: 38,667 assertions; browser test 818 checks across all 59 locations.
- Free roam: `test:explore` (49 checks) walks out of stages, checks the world fence in all six
  worlds and asserts the mouse only turns the camera in explore mode.

**Environments and assets**
- Five authored arena GLBs (asgard, deathstar, helicarrier, hogwarts, tournament) plus
  `final_valley.glb`; all load, and a missing GLB falls back to the procedural build.
- Photographic CC0 surface maps (11 Poly Haven families: albedo/normal/roughness; ids, authors and
  licence in `public/assets/textures/manifest.json`), projected from world position and shared per
  material family, with the procedural canvas maps as the fallback.
- Per-world sky presets and image-based lighting.

## Incomplete or broken

- **New York upper floors.** The Stark Tower lobby is a real interior stage; the tower's office
  floors above it are not modelled.
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
- **Art direction.** Surfaces now use photographic PBR maps, but geometry is still procedural
  primitives. Closing the silhouette gap needs authored GLB kits; no such kit is in the repo.
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
- **Iron Spider's four mechanical legs are procedural, not a rigged appendage asset.**
  `public/js/anim/spider_legs.js` mounts four articulated legs (12 joints) on the body, poses them
  from the simulation state and drives the leg-tip sweep hit test; `test:iron-spider` covers it.
  There is still no authored leg rig in any exported GLB.

## Test commands

```
npm run build                 vite production build
npm run test:worlds           world registry, geometry, collision, spawns, exits, ring-outs
npm run test:worlds:browser   loads every stage through the real selection API and fights in it
npm run test:combat           frame data, hitboxes, projectiles, ring-outs
npm run test:locomotion       per-character movement profiles, roster coverage, dead-profile keys
npm run test:cpu-skill        difficulty levels are decision-based, never stat multipliers
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

## Hogwarts interior range (latest pass)

- `public/js/worlds/hogwarts_interior.js` builds a walkable three-storey range (x 22–64,
  z −148 – −70) behind the Great Hall: Entrance Hall, Kitchens, DADA, Library (+ gallery),
  Charms, Hospital Wing, Grand Staircase, three house common rooms, History of Magic,
  Headmaster's Office, Room of Requirement, Restricted Archive and Astronomy Tower.
- Real openings, not fake doors: the Great Hall's east wall is pierced at z −94, the corridor
  has a 4 m doorway into every room, and the Dungeons now have a lit passage through a new gate
  in the west curtain wall and the cloister.
- Repaired: flanking towers were generated inside the ranges; the dungeon stair dead-ended in a
  wall; `fighter3D.js` clamped the fighter to last frame's `groundLevel`, so no multi-floor
  interior could be descended (now computed from the layout at the current position).
- Verification: `npm run test:worlds` (53,504 assertions incl. five walked routes),
  `npm run test:hogwarts` (42 assertions in the browser + 8 screenshots in `artifacts/hogwarts/`),
  `node scripts/report-hogwarts.mjs` → `artifacts/hogwarts-quality.json`.
- Still missing: moving staircases, the Chamber of Secrets, Potions/Transfiguration/Herbology
  classrooms, Hufflepuff common room, and an interaction layer (doors/books/switches).
