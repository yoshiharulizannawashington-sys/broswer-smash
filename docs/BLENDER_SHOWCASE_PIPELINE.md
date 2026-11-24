# Blender showcase pipeline

A reproducible path from a Blender script to a rigged, animated character that loads in the game.
It exists because the runner image ships **no Blender and no root**, and because Blender itself
lives in a gitignored directory that is discarded whenever the workspace is archived.

Status: the pipeline is proven end to end. The character it currently produces is a **stylised
blockout**, not production art. Do not describe it as AAA.

## 1. Install Blender (reproducible after archival)

Two supported locations; the wrapper finds either.

```sh
bash scripts/install-blender.sh          # documented path: .tools/blender-4.2.23-linux-x64
```

That script downloads the official Blender 4.2.23 LTS tarball, unpacks it inside the workspace, and
extracts the X libraries it links but the image lacks (libSM, libICE, libXrender, …) from the Ubuntu
archive into `node_modules/.system-libs`, because there is no root to `apt install` them.

If you install by hand instead, put the tarball under `artifacts/tools/` and extract the missing
`.deb`s into `artifacts/tools/libs/root`. `scripts/showcase-goku.sh` builds `LD_LIBRARY_PATH` from
whichever of the two prefixes exists, so both layouts work.

Verify:

```sh
bash scripts/blender.sh --version        # or: bash scripts/showcase-goku.sh --no-render
```

Expected: `Blender 4.2.23 LTS`.

## 2. Build and export

```sh
bash scripts/showcase-goku.sh             # build, export GLB, render front/side/back/three-quarter
bash scripts/showcase-goku.sh --no-render # build and export only
```

Outputs:

| Path | What it is |
| --- | --- |
| `artifacts/blender-out/goku_showcase.glb` | Skinned mesh + 20-bone armature + 7 actions |
| `artifacts/blender-out/goku_{front,side,back,threequarter}.png` | Cycles inspection renders |

## 3. Rig and export conventions

These are the rules `assets/blender/showcase_goku.py` follows, and the ones a new character must
follow to load without retargeting.

- **Root origin at the feet, +Z up in Blender.** The exporter turns that into the game's convention,
  so the body stands on y=0. Measured in game: feet `y = 0.000`, head `y = 1.732`.
- **Bone names carry a side suffix** (`upperarm.L`, `shin.R`, `hips`, `chest`). `resolveRig` in
  `public/js/anim/rig_map.js` and the joint search in `human_fighter.js` both read these names; a rig
  that answers to none of them loses its weapon mount and its procedural fallback.
- **Weights are deterministic vertex groups, one per body part** (`bone_for()`), not bone-heat
  auto-weights. Automatic weights fail across the disconnected primitive islands this body is built
  from, and silently detach limbs.
- **Subdivision must be `SIMPLE`, not Catmull-Clark**, or each island shrinks away from its
  neighbours and the silhouette falls apart.
- **Scale is applied per part before joining.** A joined mesh inherits the first part's non-uniform
  scale and shears the skinning.
- **Blender cylinder `depth` is a full height while sphere `scale` is a radius.** Mixing the two
  readings is what left 10 cm gaps between thigh and shin. Limb lengths are written for the former.
- **Clip names are plain words**: `Idle`, `Walk`, `Run`, `Jump`, `Punch`, `Kick`, `Kamehameha`. The
  loader lowercases them and binds by substring, so `Kamehameha` resolves to the signature beam and
  `Kick` resolves to the light kick.

## 4. Validate the export

```sh
node scripts/inspect-character-glb.mjs artifacts/blender-out/goku_showcase.glb
```

Confirms joints, clip list, materials, UVs, skin attributes and triangles before the game ever loads
it. Expected for the current build: 20 bones, 7 clips, 9 materials, UV + `JOINTS_0`/`WEIGHTS_0`
present, ~23.7k triangles, 1.06 MB.

## 5. Load it in the game (opt-in, roster untouched)

`public/models/characters/manifest.json` carries the export as its **own** entry, `goku_showcase`,
pointing at `/models/characters/showcase/goku_showcase.glb`. The roster body
(`roster/goku.glb`, 19 bones, 17 clips) remains the default; nothing is overwritten.

Enable the showcase body for review:

```
http://localhost:3000/?showcaseGoku=1
```

or `localStorage.browserSmashShowcaseGoku = '1'`. `human_fighter.js` then resolves the `goku_showcase`
entry through the same `loadCharacterModel` path as every other fighter.

Re-copy the export after a rebuild:

```sh
node artifacts/dev/register-showcase-goku.mjs
```

## 6. Verify in a match

```sh
bash scripts/run-browser-test.sh artifacts/dev/verify-showcase-in-game.mjs
```

Reports, from a real PRACTICE match: mounted bone count, the clips the loader bound and to which
action, feet/head world height, whether bones move over time, and per-clip skin displacement. It also
writes `artifacts/dev/showcase-integration/{in-match,closeup,front}.png`.

## 7. What this body is not

- No image textures: nine flat Principled materials. UVs exist but nothing samples them.
- No facial sculpt, no individual fingers, blocky boots and hands.
- Seven coarse clips authored with blocking poses, not hand-keyed motion.
- Not a replacement for the roster Goku, and not a quality benchmark for the roster.
