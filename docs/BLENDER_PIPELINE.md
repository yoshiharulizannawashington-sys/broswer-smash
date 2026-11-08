# Blender → GLB → game pipeline

How a character goes from a Blender Python script to a rigged, animated, playable fighter in
Browser Smash, and exactly which commands to run. This is the pipeline that produced **Kaze**
(`public/models/characters/kaze/kaze.glb`), the first original fighter authored with Blender.

Verified on 2026-10-26 with **Blender 4.2.23 LTS** (headless, no display server).

## 1. Is Blender installed?

It is **not** part of the base image, and `sudo` is not available. `scripts/install-blender.sh`
installs the official portable Linux build into `.tools/` and extracts the two X libraries Blender
links against but the image lacks (`libSM.so.6`, `libICE.so.6`) into
`node_modules/.system-libs` — the same trick `scripts/install-browser-libs.sh` already used for
Chromium.

```sh
bash scripts/install-blender.sh        # downloads ~335 MB, unpacks ~1.3 GB, then verifies
npm run install:blender                # identical
bash scripts/install-blender.sh --check # report only, change nothing
```

Output of a successful install:

```
Blender 4.2.23 LTS (hash d0cbe84903e8 built 2026-07-21 01:31:03)
```

Always run Blender through the wrapper, which puts the extracted libraries on the loader path:

```sh
bash scripts/blender.sh -b --version
bash scripts/blender.sh -b --python assets/blender/build_anime_fighter.py -- --out <file.glb>
```

`.tools/` is git-ignored: the Blender download is a tool, not a project asset.

### On your own machine (Chromebook / desktop)

You do not need this installer if Blender is already on your PATH:

1. Install Blender 4.2 LTS (or 4.3+) from <https://www.blender.org/download/>.
2. `blender -b --python assets/blender/build_anime_fighter.py -- --out public/models/characters/kaze/kaze.glb`
3. `node scripts/inspect-character-glb.mjs public/models/characters/kaze/kaze.glb`

## 2. What the build script authors

`assets/blender/build_anime_fighter.py` is a self-contained generator. Every vertex is created by
the script — no downloaded mesh, texture, scan or motion clip is involved, which is why there is no
third-party licence to record for this character.

| Piece | What it is |
| --- | --- |
| Geometry kernel | `loft()` builds **real volumes**: elliptical rings stack along the body axis, so every part has width *and* depth. `shell()` adds a second surface plus rim quads, giving fabric real thickness, an optional front opening and a *welded* seam when the band is closed. `axis='Y'` lofs the foot heel-to-toe. `mesh_object()` fixes winding once for every part, so a descending section list cannot leave a limb inside-out. |
| Anatomy | One continuous tube per arm (shoulder → wrist, deltoid swell → elbow → forearm taper) and per leg (hip → ankle, thigh → knee → calf). The torso is a loft with a waist, ribcage and shoulder shelf. 18–26 segments each. |
| Head | Lofted cranium (16.4 cm wide, 19.6 cm deep, 24.6 cm tall) with a jaw taper, plus eye lenses, irises, pupils, lash lines, brows, nose, mouth and ears — every feature placed against `head_front_y()`, the measured face surface. |
| Hair | A crescent cap that follows the skull, open across the forehead and closed over the crown, a **nape/temple wrap** that closes the bald band the cap used to leave above the ears, 13 swept locks and 5 fringe blades. |
| Clothing | Gi jacket as a thick fabric shell with a V opening, **short sleeves** over each deltoid (bound to the same bone as the arm they cover), two lapels seated on the opening rim, collar band, sash band (closed shell) + knot + two tails, a back skirt panel, and forearm wraps that carry the `fighter-accent` material name the form system repaints. |
| Boots | Ankle cuff, a lofted foot from heel to toe, heel block, sole, gold top band and strap per foot. Heel and sole stop short of the boot's own back wall. |
| Hands | Palm loft, four three-ring tapering fingers and an opposed thumb per hand, tips curled rather than splayed. |
| Materials | 13 Principled BSDF materials: skin, skin shade, hair, gi, gi shade, trousers, undershirt, sash, boot, trim (metallic), eye, iris, and `fighter-accent`. Authored UVs on every loft. Palette values are written as sRGB and converted to linear in `make_material()`; glTF stores linear colour, and without the conversion the navy trousers rendered pale mauve and the orange gi pale apricot. |
| Armature | 19 deform bones, Mixamo-style names (`Hips`, `Spine`, `Chest`, `Neck`, `Head`, `LeftShoulder`, `LeftArm`, `LeftForeArm`, `LeftHand`, `LeftUpLeg`, `LeftLeg`, `LeftFoot` + right side). |
| Skinning | Hybrid. The torso, jacket and neck blend smoothly along `Hips → Spine → Chest → Neck` (smoothstep, no crease), each **continuous limb** blends between its two bones across the joint window, and small parts stay rigid to one bone. 1,083 vertices carry two weights. The build **refuses to export** if any vertex is unweighted or any vertex group does not name a real bone (see §2.3). |
| Animation | 8 actions at 60 fps: `idle`, `walk`, `run`, `jump`, `jab`, `heavy_punch`, `block`, `hit_light`. Action names are the game's own clip ids. Every keyframe writes every animated bone, so no clip inherits a stale rotation. |
| Export | GLB with skins and actions (`export_animation_mode='ACTIONS'`, sampled at 60 fps, Y-up). |

Build output for the committed asset:

```
KAZE_BUILD {"materials": 13, "vertices": 6560, "triangles": 12864, "bones": 19,
            "unboundVertices": 0, "multiWeightVertices": 1083, "uvLayers": ["UVMap"],
            "actions": [8], "fps": 60, "heightRange": [0.0, 1.772]}
```

### 2.1 A note on the first version of this file

The first `loft()` built each ring in a vertical plane and stacked the sections along Z anyway, so
every lofted part was a **paper cutout**: measured per 10 cm height band, the model had exactly
0.000 m of depth at the shoulders, the chest, the hands and the knees. The torso loft and the gi
loft were both in that same plane, which is where the dithered "stipple" on the chest came from.
That is fixed, and `scripts/inspect-character-glb.mjs` now fails any GLB whose geometry collapses
into a plane (see §3), so the defect cannot come back unnoticed.

`scripts/test-geometry-kernel.py` (`npm run test:geometry`) keeps the defect itself as a fixture:
it contains `legacy_loft`, the old kernel, and asserts that the depth probe **fails** it for a
torso, a limb and a leg. If the probe ever stops detecting the bug it exists for, that test fails.
The same section data then goes through the repaired `loft()` and must come out solid, closed,
outward-facing and UV-mapped. Current run: **464 checks, 0 failed**.

### 2.2 Three more defects the same audit found

1. **Inside-out limbs.** Sections are authored in whichever direction reads best, so a descending
   list (shoulder → wrist) inverted every quad. Arms, legs, fingers, lapels, fringes, sash tails
   and the back skirt all enclosed *negative* volume: still visible, because the glTF materials are
   double-sided, but lit from inside. `mesh_object()` now recalcs and, as a backstop, flips any part
   whose signed volume is still negative.
2. **Layers in the same plane.** The gi shell's wall was exactly `thickness` outside the torso, so
   its *inner* wall landed on the undershirt — the coplanar pair behind the original stipple. The
   coat now sits 6 mm proud of the shirt (`GI_LIFT`) and follows the chest's forward bulge through a
   `front` parameter on `shell()`. The kernel test samples the jacket against a BVH of the torso and
   fails if any vertex comes within 2 mm; the GLB inspector repeats the check on the export.
3. **Unwelded band seams.** A closed band duplicated its last column instead of wrapping, leaving
   an open split down the back of the sash, the wrist wraps and the new sleeves. Closed shells now
   wrap with `segments` columns, and every part is required to be a closed surface.

### 2.3 The silent bind failure

The limbs did not move at all in the shipped GLB. `weight_parts()` named vertex groups
`LArm`/`LForeArm`/`LUpLeg`, while the armature's bones are `LeftArm`/`LeftForeArm`/`LeftUpLeg`. A
vertex group that does not match a bone binds nothing — silently — and Blender's glTF exporter then
writes those vertices to a generated `neutral_bone`. The result was a body where 2,216 of 5,905
vertices were bound to a placeholder and 2,209 to `Head`: the skeleton existed, every clip played,
and the whole figure moved as a stiff block carried by the spine.

Every earlier check passed it, because they all asked whether the skeleton *exists* and whether the
clips *animate*. What caught it was measuring per-bone influence and posing individual joints. Three
guards now exist:

- `weight_parts()` translates `L`/`R` to `Left`/`Right` through one `SIDE_PREFIX` table.
- The build raises `SystemExit` if any vertex is unweighted or any vertex group names a bone the
  armature does not have (`unboundVertices` in the build report must be 0).
- `npm run test:kaze` asserts no `neutral_bone`, no unweighted vertex, and that each of the twelve
  limb bones influences at least 20 vertices; it also bends each elbow, shoulder, hip and knee and
  measures edge-length change on the skinned mesh.

### 2.4 Materials: UVs yes, image maps no

The generator creates a 128 px procedural fabric weave, a leather grain and a skin tonal map, with
authored UVs. They were **removed from the export**: each material becomes its own glTF primitive
with its own UV island, so a mottled base colour jumped in tone at every seam and the forearm read
as a stack of differently shaded bands in game — visible at gameplay distance, and 300 KB of the
file. The UVs stay (and are verified), and surface variation now comes from PBR roughness/metallic
values, which cannot band across a seam. The texture functions remain in the script behind
`make_material(texture=...)` if a future character wants maps that earn their cost.

## 3. Verify the export before it ships

A GLB that parses is not a working character. `scripts/inspect-character-glb.mjs` loads the file
with the **same three.js `GLTFLoader` the browser uses**, updates world matrices (a missing
`updateMatrixWorld` is what makes every measurement come out wrong), and fails when something a
fighter needs is absent:

```sh
node scripts/inspect-character-glb.mjs public/models/characters/kaze/kaze.glb
```

It reports meshes, skinned-mesh count, materials, bone names, the **canonical rig binding** through
`public/js/anim/rig_map.js`, every clip with its duration and track count, the real bounds
(height, width, feet-on-origin), a **solidity table** (for each 10 cm height band, how deep the
geometry actually is), per-primitive **mesh quality** (zero-area triangles, outward-winding ratio),
a **watertight** count for the welded character, and any pair of **garment layers** whose surfaces
come within 3 mm of each other. It exits non-zero when: no meshes, no skinned mesh, the canonical
11 joints do not resolve, no clips, height outside 1.2–4 m, feet more than 0.25 m off the origin,
any band wider than 12 cm collapsing to less than 4 cm of depth, a zero-area triangle, a part that
winds inward, more than 80 open boundary edges on the welded character, or two garment layers
coinciding over more than 5% of their sampled vertices.

Two of those gates have to be scoped carefully, and the scoping is documented in the file: the
exporter splits the joined body into one primitive per material, so a material seam looks like an
open hole inside a single primitive (watertightness is therefore judged on positions welded across
all primitives), and features that are *meant* to sit millimetres apart — iris on eyeball, fringe
over brow — are excluded from the layer check by an explicit garment allowlist.

Textured GLBs need `scripts/glb-node-compat.mjs` first: three's loader decodes embedded PNGs
through `self`/`createImageBitmap`, which Node does not define. The inspector imports it, so a GLB
with embedded maps parses in Node instead of throwing `self is not defined`.

Current result:

```
OK: 13 mesh(es), 13 skinned, 19 bones, 8 clips, 12864 triangles, 1.77 m tall.
```

`npm run test:kaze` is the second gate: it plays every exported clip and measures **skinned vertex
displacement** (the same bone maths the GPU runs), so a rig that parses but never moves the mesh
fails instead of looking fine in a report. Every clip must pose the body at least 2 cm away from the
bind shape, the six dynamic clips must move across themselves, and the mesh must settle back.

`npm run test:kaze` also verifies **binding** (no `neutral_bone`, no unweighted vertex, every limb
bone influencing real geometry) and **joint deformation**: each elbow is bent 1.75 rad, each
shoulder and hip 1.2–1.4 rad, each knee 1.6 rad, and the length change of the mesh's own edges is
measured. A pose must articulate the limb (58–126 cm of travel), no edge may crush below 0.34× its
rest length or stretch past 2.5×, and the run prints how many edges deform by more than 10% (the
blend activity at that joint). Current run: **74/74 checks passed**.

## 4. Register and integrate

1. **Manifest** — `public/models/characters/manifest.json` maps an identity slug to its file:

   ```json
   "kaze": {
     "url": "/models/characters/kaze/kaze.glb",
     "format": "gltf",
     "enabled": true,
     "yawOffset": 0,
     "source": "Authored in this repository by assets/blender/build_anime_fighter.py",
     "license": "Original work generated by this repository's own script (no third-party assets)"
   }
   ```

   `enabled` is the gate: an entry is only read by the loader when it is `true` **and** the file
   exists. The staged entries for Goku, Iron Man and Iron Spider stay `false` until the real
   source packages are supplied — enabling them without the files would only produce warnings.

2. **Loader** — no new loader code. `public/js/human_fighter.js` (`upgradeFighterModel`) fetches the
   manifest, loads the GLB/FBX, mounts it (`mountImportedCharacter` normalises ground contact and
   facing), builds an `AnimationMixer` and plays `idle`. `main.js` calls it first for every
   spawned fighter, so a manifest asset always wins over the fallback body.

3. **Roster** — the identity must exist in the roster tables in `public/js/main.js`
   (`allRoster` and `roster`) and have a moveset in `public/js/combat/movesets.js`, plus an entry
   in `SPECIAL_MOVES`. Kaze is registered as `["Kaze","warrior"]` with the `kaze` moveset
   (3 lights, 2 heavies, aerial, a Wind-Step transformation and the Thousand-Step Tempest ultimate).

4. **Rig gate** — `window.__browserSmashRigCheck` (main.js) validates a prefab's joint handles and,
   for an imported skinned model, validates structure with `requireJoints:false`, requires
   `resolveRig()` to bind all eleven canonical bones, and measures head-above-pelvis from the real
   bones. `npm run audit:roster` fails if any fighter's mounted body does not pass it.

## 5. Regenerate / iterate

```sh
npm run build:fighter                                  # re-export kaze.glb
npm run inspect:glb                                    # geometry, rig, clips, layers (GLB gate)
npm run test:geometry                                  # kernel regression + every part, in Blender
npm run build                                          # vite build
npm run test:kaze                                      # binding, every clip, joint deformation
npm run test:movesets                                  # 34 fighters, forms + ultimates
bash scripts/run-browser-test.sh scripts/audit-roster.mjs
bash scripts/run-browser-test.sh scripts/browser-smoke.mjs
bash scripts/run-browser-test.sh scripts/_audit-visual.mjs artifacts/close "Kaze"   # close-up shots
bash scripts/run-browser-test.sh scripts/_audit-camera.mjs artifacts/match "Kaze"   # gameplay shots
```

To add another character, copy the script, change `build_materials()`/`build_body()` and the
`BONES` table, export to `public/models/characters/<slug>/<slug>.glb`, add a manifest entry and a
roster/moveset row. Nothing else in the engine needs to change.

## 6. Honest limitations of this first pass

### 6.1 The three flagship exports exist, and are disabled on purpose

`assets/blender/build_roster_models.py` builds the three flagship fighters as real skinned GLBs —
`public/models/characters/original/{goku,iron-man,iron-spider}-alt.glb`. Each is a verified rig
(20 bones, 8 clips, ~4–6k triangles, feet on origin, all eleven canonical bones bound) and each was
integrated, loaded in the game and measured. They are **not enabled**, because they render worse
than the authored bodies in `public/js/characters/sculpted.js`:

- the near-white undershirt shell and the gi shell are coincident over the chest, so they z-fight
  into an orange/white dither (verified as geometry — turning off shadow receiving did not change
  it);
- shoulder and knee seams are covered by spheres that read as balls on the silhouette;
- the gi has no sleeve over the deltoid, so the shoulder sphere is the entire shoulder;
- there is still no UV chart and no texture map, and the skinning is rigid per part.

Full measurements, the rendered comparison and the per-identity verdict are in
[CHARACTER_BODY_AUDIT.md](CHARACTER_BODY_AUDIT.md). Reproduce the comparison with:

```sh
bash scripts/run-browser-test.sh scripts/_compare-bodies.mjs artifacts/body-compare "Goku"
```

**Re-enable checklist**, in order:

1. In `build_roster_models.py`: offset the `gi-jacket` loft cleanly outside the `torso` loft (2 cm,
   not 1 mm), add a short `sleeve` loft over the deltoid, and shrink the `shoulder`/`knee` spheres
   or replace them with cuff lofts.
2. `npm run build:roster` and `npm run inspect:glb -- public/models/characters/original/goku-alt.glb`.
3. `bash scripts/run-browser-test.sh scripts/_compare-bodies.mjs artifacts/body-compare "Goku"`
   and look at the two shots. Only continue if the export wins.
4. Set `enabled: true` for that entry and update its `verified` block.
5. `npm run probe:bodies` — it asserts the enabled GLB is the body on screen.
6. `npm run test:animation` (it pins the disabled/verified state per entry) and
   `bash scripts/run-browser-test.sh scripts/audit-roster.mjs`.

- The body is **stylised and low-detail** (6,076 triangles): it reads as a fighter and holds up at
  the match camera, but it is not production art, has no textures/normal maps, and the jacket shows
  z-fighting mottling under the game's lighting where the torso and jacket shells are coincident.
- Skinning is **rigid per part**, not smooth: good for a segmented design, but the shoulders and
  hips do not have soft deformation. A production rig needs proper weights (Blender's automatic
  weights on a single continuous mesh, or hand-painted weights).
- The 17 clips are **scripted poses**, not motion capture. They are real skeletal animation, drive
  the actual bones, and are named after the game's clip ids — but they are simple, and the game
  still uses its procedural 39-clip library for everything the GLB does not provide.
- The character faces +Z after export, which the loader's `yawOffset: 0` relies on. A model
  authored facing -Z needs `yawOffset: 180`.
- Blender itself is not committed; `.tools/` is ignored. On a machine without network access the
  installer cannot run, and the pipeline can only be exercised where Blender exists.

## Building the whole roster

`assets/blender/build_roster_fighters.py` generates every selectable fighter's body from one
kernel. It imports `build_anime_fighter.py` (the reference fighter, Kaze) and reuses its repaired
geometry kernel, anatomy, 19-bone armature, hybrid skin weights, seventeen clips and UV/material set,
substituting only the per-fighter garment layer, head treatment, hair silhouette, palette and
build. Nothing in the output is third-party: every vertex is generated by these scripts.

```sh
bash scripts/install-blender.sh          # Blender's X libraries land in node_modules/.system-libs
npm run build:roster-fighters            # 58 bodies -> public/models/characters/roster/
node scripts/register-roster-models.mjs  # write the manifest entries
npm run test:roster-models               # every selectable fighter mounts a fully bound model
npm run test:geometry                    # the geometry kernel's own regression suite
```

### What the game does with those bodies

Each selectable fighter mounts its export through `upgradeFighterModel()`: the prefab body stands
in while the GLB streams, the export replaces it (normalised to 2.05 m with its feet on the fighter
origin), the eleven canonical joint names are bound onto its real bones so its signature weapon
re-mounts on the new body, and the generated weave/brushed/grain detail maps are applied to its
materials. The rig gate rejects any body that lands tilted, squashed, empty or off its origin, and
`npm run audit:roster` proves all 38 selectable fighters mounted the file exported for them.

Two integration defects were fixed on the game side after the exports existed: the detail maps were
only ever applied to the prefab body the export replaces (so every fighter shipped as flat
plastic), and the hit-reaction lean was written to the fighter's root transform, which made a
fighter checked mid-hitstun fail the rig gate. Both are described in
[CHARACTER_MODEL_REPORT.md](CHARACTER_MODEL_REPORT.md) §5.

Two defects found while generating the roster, both now gated:

1. **Zero-depth lofts** (the Phase 7 defect): the kernel's lofted shells were built in a plane
   rather than as a volume, so the torso and gi were coplanar and rendered as a stippled mess.
   `scripts/test-geometry-kernel.py` checks every generated body part for depth, degeneracy,
   winding and unexpected open boundaries.
2. **Orphaned parts**: substituting a layer removed a part from the build list without unlinking
   its Blender object, so what was dropped was still exported - unskinned, at the fighter's
   origin. Aang's body shipped 33 meshes of which only 13 were skinned: 20 hair locks hung
   unweighted at the origin while the animated body walked out of them. The generator now deletes
   what it replaces and refuses to export while any part is left unjoined, and
   `scripts/test-roster-models.mjs` asserts `static === 0` for every file - no mesh may be
   exported without a skeleton binding.

## Refinement loop: measure, rebuild, gate

`node scripts/measure-model-refinement.mjs` (`npm run measure:model`) measures every exported body
from the GLB itself: triangles, meshes, materials, UV coverage, degenerate triangles, non-manifold
edges, the per-band depth ratio that catches a paper-flat loft, the clip list, how many bones each
clip actually moves and the key-to-key motion range per bone. It writes `artifacts/model-quality.json`,
and `npm run gate:model` compares a fresh run against that file and exits non-zero on any regression
in geometry, materials, UVs, clips or motion, so a pass that quietly deletes work cannot pass.

Two things the measurement refuses to do: treat a higher triangle count as better art, and measure
animation as angle from identity. The glTF exporter writes absolute node rotations (rest orientation
included) and bakes every deform bone into every action, so rest-relative angles read ~176 degrees
for every clip and bone counts are constant at 19 - both say nothing about how much a clip moves.

The cycle used for the clip-shaping pass (58 bodies, about 50 s of Blender):

1. `npm run measure:model` to record the baseline.
2. Edit the builder (`assets/blender/build_roster_fighters.py`) or the kernel it imports
   (`assets/blender/build_anime_fighter.py`).
3. `bash scripts/blender.sh -b --python assets/blender/build_roster_fighters.py -- --out-dir public/models/characters/roster --group all --report artifacts/roster-build.json`
4. `npm run gate:model` and promote the new report to `artifacts/model-quality.json` only if it passes.
5. `npm run test:roster-models`, `npm run test:kaze`, `npm run test:rig`, `npm run test:geometry`,
   then the browser gates: `bash scripts/run-browser-test.sh scripts/audit-roster.mjs` and
   `bash scripts/run-browser-test.sh scripts/probe-character-bodies.mjs`.
