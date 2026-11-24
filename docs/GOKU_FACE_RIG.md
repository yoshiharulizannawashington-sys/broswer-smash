# Goku baked facial rig

The licensed source body (`public/models/characters/bespoke/goku_body.glb`) ships eyes and a
single eye/brow patch, but no separate mouth, brow or eyelid geometry and no facial morph targets.
The roster now serves a derived file,
`public/models/characters/bespoke/goku_body_face_rigged.glb`, which bakes the authored face
geometry and expression shapes into the GLB. The source body is left untouched and remains the
reference asset.

## What is baked

The derived GLB adds a `Goku_BakedFaceRig` group under the real `Head` bone. It contains nine
non-skinned meshes and 15 morph targets across four target families:

- `Guard` on both brows and the neutral mouth line
- `Hit` on both brows and the neutral mouth line
- `Victory` on both brows and the neutral mouth line
- `Blink` on both eyelids and both lashes
- `Hit` on the open-mouth mesh
- `Victory` on the smile mesh

The neutral mouth line is visible at rest. The open-mouth and smile meshes start collapsed inside
the head and morph onto the face only for their expression. The eye/lid meshes use the same blink
morph for the idle blink and for the hit/victory eye closure.

The two blink lids are almond-shaped, not scaled spheres: each has a slight dome and covers the
eye socket when closed. A separate tapered lash ribbon follows the upper third of each lid, so the
closed eye has a dark lash line instead of a pale oval. Both pieces start collapsed inside the
upper eyelid, which makes partial closure descend from the brow rather than float up from the
cheek. The baked blink weight uses a smoothstep above 0.34 closure; guard's 24% eye narrowing
therefore stays at `Blink: 0` instead of leaving a detached half-lid, while the blink pulse, hit
and victory still close the eyes.

Placement is measured from `DEF_EyeL_07` / `DEF_EyeR_08`, exactly as the runtime layer did. The
group sits at the measured eye midpoint and head-local `eyeZ + 0.055`; the brows, mouth and lids
are seated in front of the source eye/brow patch.

## Runtime contract

`animation_overlays.js` still resolves one named expression from the same gameplay fields on both
animation owners:

- **guard** — `guardHeld` with no guard break: brows lower, mouth compresses; the guard pose's
  24% eye narrowing stays below the baked lid threshold, so the eyes remain open rather than
  showing a floating half-lid.
- **hit** — `hitstun > 0`: brows lift, eyes squeeze, open-mouth shape appears.
- **victory** — `victoryPose > 0`: eyes close and the smile curve appears.
- **neutral** — no guard, hit or victory request: resting brows, mouth line and open eyes.

Priority is hit, then victory, then guard, then neutral. Expression weight is damped at 14/s.
The report exposes `face.expression`, `face.expressionWeight`, `face.baked`,
`face.morphs` and `face.morphWeights`.

`goku_face_rig.js` still contains the runtime installer as a fallback for an unbaked source body.
When it finds the `Goku_BakedFaceRig` marker, it records the baked report and does **not** add a
second set of meshes. `animation_overlays.js` skips its local-transform face-piece collection for
a baked asset and drives the morph targets instead.

## Rebuilding the GLB

The bake uses the browser's `GLTFExporter` because it preserves the source textures; Node has no
canvas for embedded images. Blender is not used for this skeleton: its `Head` bone imports at
local z≈95 while the mesh is around the origin, and the manifest already records that the rig
cannot be posed correctly without rebuilding it.

```sh
node scripts/bake-goku-face-rig.mjs
```

The tool starts a local browser page, imports the source GLB, adds the face meshes and morphs,
exports the derived GLB, and writes `artifacts/goku-face-bake-report.json`. The original source
path is only read.

## Evidence

```sh
npm run test:animation
bash scripts/run-browser-test.sh scripts/verify-animation-overlays.mjs
npm run build
```

The Node suite now parses the registered Goku GLB and verifies the `Goku_BakedFaceRig` marker,
the nine baked meshes and all four morph families. The live proof mounts through character select,
checks `face.baked`, forces the blink pulse, drives guard with the real guard key, hitstun and
victory through the gameplay state, and measures the active morph weights:

- `artifacts/animation-overlays/goku-face-idle.png`
- `artifacts/animation-overlays/goku-face-blink.png`
- `artifacts/animation-overlays/goku-face-blink-eyes-detail.png`
- `artifacts/animation-overlays/goku-face-attack.png`
- `artifacts/animation-overlays/goku-face-guard.png`
- `artifacts/animation-overlays/goku-face-hit.png`
- `artifacts/animation-overlays/goku-face-victory.png`
- `artifacts/animation-overlays/report.json`
- `artifacts/goku-face-bake-report.json`
- `artifacts/goku-baked-face-inspect.json`

Verified results: `npm run test:animation` passed all 280 checks; the live overlay proof passed
20/20; `npm run build` exited 0. At the blink peak the baked `Blink` weight measured 0.982; guard
measured `Blink: 0`, hit 0.67 and victory 0.884. The captures are headless Chromium/SwiftShader
composition evidence, not hardware-GPU visual verification. The licensed source GLB is unchanged,
and the derived face rig uses morph targets rather than a new character download or a Blender
re-export.
