# Naruto Uzumaki: from imported body to Naruto Sage

The production `naruto_uzumaki` slot now mounts the supplied **Naruto Sage** mesh on a project-built
19-bone skeleton. The full 49-clip shinobi set was retargeted onto that skeleton at 30 fps. The
previous ronildo.facanha body remains the manifest `rollbackUrl`; its import notes are preserved
below for rollback and provenance.

Rights are recorded in two places and deliberately narrow: [ATTRIBUTIONS.md](../public/ATTRIBUTIONS.md)
and the `naruto_uzumaki` entry of the character manifest.

## Current production: Naruto Sage (2026-11-11)

| Field | Value |
| --- | --- |
| Production file | `public/models/characters/imported/naruto_sage/naruto_sage_animated.glb` |
| Size / SHA-256 | 1,121,652 B / `1d660ada83b4ef95f0301c2961806e607e4332683176f69f0f49338e9061a90b` |
| Source | Naruto Sage by ninjatorent13, CC BY 4.0; archive at `artifacts/asset-fetch/161369399a0d4b6e9657023a1bcbfb31/` |
| Body | 3 skinned meshes, 5,248 vertices, 4,316 triangles, 3 supplied texture maps |
| Rig | 19 bones, exact canonical names; 0 unweighted vertices; max 4 influences; 1.80 m; feet at Y=0 |
| Clips | 49/49: 19 body states, 9 reactions, 20 authored strike/form clips, 1 kunai |
| A1 record | `artifacts/launch-acceptance/report-naruto-a1-readiness.json` — software-pass core + transformed KO/rematch 2/2; hardware open |
| Rollback | `/models/characters/naruto_uzumaki/naruto_uzumaki.glb` (old 567-bone body) |
| Build inputs | `artifacts/naruto-sage/naruto_sage_source.glb`, `artifacts/rig-batch/rigged/naruto_sage/naruto_sage.glb`, `artifacts/rig-batch/rigged/naruto_sage/rig-report.json` |

The static Sage source (277,312 B, 5,080 vertices, 4,316 triangles, T-pose, facing -Y) was packed
to `naruto_sage_source.glb` and auto-rigged with the `naruto_sage` entry in
`scripts/autorig_batch.py`: shoulder height 0.75 m, hand target `(0.45, 0.75)`, hip 0.47 m, target
height 1.80 m. The Blender 4.2.23 rig report records 19 bones, zero unweighted vertices, a maximum
of four influences, 0.0 left/right symmetry error and deform weights on every limb.

### Retarget

`scripts/rig-clips-to-body.mjs` was run for each of the four shinobi source groups with
`--append --calibrate-arms`. The retargeter now explicitly maps the Rigify `DEF-spine` chain
(`DEF-spine` -> pelvis, `.001` -> spine, `.003` -> torso, `.004` -> neck, `.005` -> head) and ranks
`DEF-*` above `ORG-*`, `MCH-*` and `VIS-*`. Every pass reported **19/19 mapped bones and 0 unresolved
tracks**. The resulting GLB contains all 49 clips, including the authored forms and `Naruto_kunai`.

### Verification

```bash
node scripts/test-naruto-baked-glb.mjs  # 91 checks
npm run test:rig-architecture           # 26/26
npm run test:animation-coverage # 91
npm run test:rig-solo                   # Naruto 49/49, full lane 134/134
npm run test:naruto-49-state            # live browser 49/49
npm run validate:assets
npm run build
```

The live match mounted the Sage file at
`/models/characters/imported/naruto_sage/naruto_sage_animated.glb` with 3 skinned meshes,
19 bones and `rig.bound: 19` (no missing bones). The reaction, authored-strike and ability reports
were all `ready` with `missing: []` and 49 clips. Idle played `Naruto_idle`; an input-driven light
attack played `authored_light1` and returned to idle. The only console error was an unrelated
missing `favicon.ico`.

The shared transition policy was later exercised on the same Sage body: `run → walk` recorded a
phase-synced gait blend, a light hit used a `0.045 s` reaction fade, and recovery used the `0.16 s`
idle blend. The live transition probe details are in
[ANIMATION_PIPELINE_READINESS.md](ANIMATION_PIPELINE_READINESS.md).

### A1 acceptance — 2026-11-12

A fresh focused live match (`A0_LABEL=naruto-a1`) passed **37/37** checks with no page errors or
failed requests. The fresh 49-state matrix passed **49/49** with no missing or extra clips; the
baked GLB gate passed **91/91**; the solo lane passed **49/49** for Naruto and **134/134** overall.
All runs used the SwiftShader software renderer.

The signature harness now waits out `FORM.activationLock` (0.62 s) and passes **21/21**: all five
forms transform, fire their own signature, and exit back to base `RASENSHURIKEN`. Keyboard combat
passes **18/18** (chain, three heavies, CPU motion mapping). The focused `verify-naruto-a1.mjs`
probe passes **7/7**: walk is `walk` at 5.51; sprint enters the Shift dodge (`Naruto_jump`) and
settles to grounded `run` at 12.57; `RASENSHURIKEN` launches from `RightHand` with
`fallback:false` after its authored wind-up; form exit restores `RASENSHURIKEN`; the ultimate
returns from `casting:ultimate` to idle with meter spent. A0 supplies the unforced knockdown
(141.71%, 1.159 hitstun, hit → knockdown → get-up), victory, defeat, rematch and second complete
match.

This is **A1 software-pass core**, not full acceptance. KO/match-end during a transformation or
ultimate was not separately asserted; hardware-GPU acceptance is unavailable; and full launch
sign-off remains open. Evidence: `artifacts/launch-acceptance/report-naruto-a1-readiness.json`,
`artifacts/launch-acceptance/report-naruto-a1.json`, `artifacts/a1-naruto/live-a1-probe.json`,
`artifacts/a1-naruto/signatures.log`, `artifacts/a1-naruto/keyboard-combat.log` and
`artifacts/naruto-49-state/report.json`.

### Known limitations

The supplied low-poly garment topology has **352 open boundary edges**, above the inspector's
budget of 80. `scripts/inspect-character-glb.mjs` therefore exits 1 even though skinning, bones and
clips pass; this is a source-mesh limitation, not an unweighted-rig failure.

The original `Naruto_defeat` finding was a coat/garment seam collapsing to **0.088x** because the
auto-rig mixed shoulder and thigh influences into two adjacent coat panels. `npm run fix:naruto-coat`
rewrites those two connected panels to the torso chain (`Spine`/`Chest`/`Hips`/`Neck`) and verifies
the mesh, accessor layout and target membership before writing. `npm run test:rig-solo` now passes
Naruto **49/49** clips, with the former coat collapse cleared and the new worst sampled garment edge
at **0.155x** against the unchanged 0.15x gate. The repaired coat edge itself measures about
**0.76x**. The full solo lane is **134/134** body clips.

The live browser pass (`npm run test:naruto-49-state`) mounted the patched Sage GLB, played all
**49/49** clips on the live 19-bone rig, measured zero unresolved tracks and finite motion, and
captured a 7 x 7 contact sheet. The defeat clip's worst sampled garment edge is **0.1555x** (a
shoulder/sleeve fold); the repaired coat edge itself is about **0.76x**. The seam is unobstructed in
`artifacts/naruto-49-state/defeat-coat.png`. The live pass had no page errors and
no failed asset requests. The source still has 352 open boundary edges, so the GE topology inspection
remains a source-mesh limitation; the aggregate solo suite's Hulk lane is now structurally clean but
its four cinematic/static rows remain non-body entries, not failures.

## Historical: previous imported body (rollback)

> The sections from **1. What was acquired** onward describe the superseded 567-bone body. They are
> retained because that file is still the rollback and its provenance remains part of the record.

## 1. What was acquired, and how

| Field | Value |
| --- | --- |
| Title | Naruto & Sasuke Low Poly + Rig + Texture |
| Creator | ronildo.facanha (Sketchfab) |
| Model page | https://sketchfab.com/3d-models/naruto-sasuke-low-poly-rig-texture-b650b60a7bbd4f11b05a435e65116168 |
| Licence | CC BY 4.0 |
| Delivery | Google Drive folder linked from the model description — no account, no payment, no gate |
| Retrieved | 2026-11-06 |
| Package | `naruto-sasuke-low-poly-rig-texture.zip`, 23,575,903 bytes |
| Inside | `source/Naruto & Sasuke.fbx` (19,158,620 bytes) + 11 PNG maps |
| Installed | `public/models/characters/naruto_uzumaki/naruto_uzumaki.glb` |

The Sketchfab download button itself requires a signed-in account, and that was not circumvented.
The creator separately published the project files in the description, which is why this asset could
be retrieved lawfully without one.

Evidence is kept in `artifacts/asset-fetch/naruto_sasuke/`: the downloaded zip, the extracted source
and textures, and `inspect_fbx.py` (the scene inspector used before conversion).

### What the source actually contained

One FBX holding **two** characters on separate 567-bone Rigify rigs plus a render backdrop:

| Object | Geometry | Notes |
| --- | --- | --- |
| Naruto | 2,706 verts / 5,444 tris, 73 skin groups | 6 materials incl. an `Outline` ink shell |
| Sasuke | 3,272 verts / 6,508 tris, 73 skin groups | not installed |
| rig / rig.001 | 567 deform bones each | `DEF-spine…DEF-hand`, `DEF-thigh…DEF-foot` |
| Actions | `Anim_Naruto`, `Anim_Sasuke` | 60-frame source clips |
| Images | 11 PNGs, external | the FBX referenced them but carried no image nodes |

## 2. Conversion

```bash
bash scripts/blender.sh -b --python assets/blender/naruto_from_fbx.py   # body only
bash scripts/blender.sh -b --python assets/blender/naruto_animations.py # body + 19 clips
```

`naruto_from_fbx.py` keeps Naruto's mesh and rig, deletes Sasuke and the backdrop, and does three
things the raw file needed:

1. **Rebuilds every material.** The FBX named its materials after maps it shipped separately and
   imported with no image nodes at all, so an untouched export produced a completely untextured
   model. Each material is rebuilt around the PNG it belongs to: `tex01` and `tex02` (922×922),
   `hands` and `palms` (64×64), and `face`, which has no file of that name — the supplied face map
   is `smiling.png` (128×128).
2. **Removes the `Outline` shell.** It is an inverted-hull ink layer whose faces are reversed. glTF
   has no per-material culling side, so Three.js drew that shell *in front of* the body and the
   character rendered as a black silhouette in the first in-game screenshots. Dropping its 2,621
   faces leaves 3,989 fully textured triangles.
3. **Normalises scale.** The source is 6.15 m tall; the rig is scaled by 0.293 to 1.80 m with feet
   essentially on the origin (0.006 m).

## 3. Animation

The rig's limb rest axes are rolled, so bone-local Euler angles are unreadable. Poses are written in
armature space and converted per bone with `Q_local = M_rest⁻¹ · R_armature · M_rest`, the same
technique documented for Infantry. Naruto faces −Y, up is +Z, his left is +X: thigh forward is −X,
knee bend is +X, the left arm swings forward on −Z and the right on +Z.

Nineteen clips are exported as NLA tracks named exactly as the gameplay state, so the legacy mixer
binds each state by name rather than pointing every state at one clip:

| State | Clip | State | Clip |
| --- | --- | --- | --- |
| Idle | `idle` | Hit light | `hit_light` |
| Walk | `walk` | Hit heavy | `hit_heavy` |
| Run | `run` | Knockback | `knockdown` |
| Jump | `jump` | Block | `block` |
| Fall | `fall` | Victory | `victory` |
| Land | `land` | Defeat | `defeat` |
| Light punch | `jab` | Rasengan | `rasengan` |
| Heavy punch | `heavy_punch` | Shadow Clone | `shadow_clone` |
| Light kick | `front_kick` | Transformation | `transformation` |
| Heavy kick | `spinning_kick` | | |

No clip moves the root: the game owns position, so the clips animate limbs only.

### Why abilities used to play nothing

`bindAuthoredClips` compiled each ability from the **procedural** motion sets, which are authored for
the generated roster rig's bone names (`RightArm`, `LeftLeg`). Those tracks bind no bones on a
Rigify skeleton, so a cast fired its projectile while the body froze in its rest pose — the T-pose
seen in the first round of screenshots.

The fix is data, not a special case: `BODY_CLIP_SLOTS` in `public/js/anim/animation_manifest.js`
declares which slot a body already ships a clip for, and `human_fighter.js` uses that clip before
compiling a motion. Naruto's `rasengan`, `shadow_clone`, `jab`, `front_kick`, `spinning_kick`,
`heavy_punch` and `transformation` therefore drive his own skeleton.

## 4. Installation

```bash
node scripts/install-character-model.mjs public/models/characters/naruto_uzumaki/naruto_uzumaki.glb \
  --identity "Naruto Uzumaki" --license "CC BY 4.0" --attribution "ronildo.facanha (Sketchfab)" \
  --source "https://sketchfab.com/3d-models/naruto-sasuke-low-poly-rig-texture-b650b60a7bbd4f11b05a435e65116168"
```

The installer merged its entry over the previous generated-body record, so the manifest's provenance
fields were then corrected by hand: `assetKind: imported`, creator, licence, source URL, retrieval
date, the byte count and SHA-256 of the installed GLB, and the verification commands.

## 5. Verification

```bash
bash scripts/run-browser-test.sh scripts/verify-naruto-roster.mjs
```

18/18 checks pass. The results that matter, all measured in the running game:

| Check | Result |
| --- | --- |
| Roster | one card, one identity, 38 cards total |
| Select preview | `MODEL READY`, 25 clip entries |
| Match mount | `naruto_uzumaki.glb`, 3,989 tris, 5 skinned meshes, 567 bones |
| Textures | 5 unique texture maps on 5 textured materials |
| HUD | `P1 · NARUTO UZUMAKI`, signature `RASENSHURIKEN` |
| Clip coverage | all 19 clips present; 18 required states each have their own |
| Skeletal motion | every clip moves the rig 0.095–1.313 m; 18 distinct magnitudes |
| Punch vs kick | `jab` moves the arms 0.368 m; `front_kick` moves the legs 1.126 m |
| Damage | light attack takes the opponent 0 → 7.74% |
| Signature | fires, plays `rasengan`, enters cooldown |
| Shadow Clone | `cast slot 1`, plays `shadow_clone`, real clone bodies appear |
| Rasengan | `cast slot 2`, plays `rasengan` on the imported rig |
| Transformation | form state flips true |
| Jump | leaves the ground (y = 1.73) |
| Console | no page errors, no failed asset requests |

Screenshots: `artifacts/naruto-roster/` (`1-select-naruto.png` … `9-hud.png`), with the raw numbers
in `report.json`.

## 6. Repeating this for Superman, Goku and Spider-Man

The same shape applies, and the only unreliable step is step 0:

1. Find a creator-published download that does not need an account, a payment or a bypass.
2. Inspect the source before converting (the inspector script is a good template).
3. Split the wanted character out, rebuild materials around the supplied maps, strip any inverted
   hull, normalise the height, and author clips on the rig that actually arrived.
4. Add the slot mapping to `BODY_CLIP_SLOTS` if the body ships its own ability clips.
5. Install with the installer and correct the manifest's provenance fields.
6. Verify with a harness of this shape and keep the screenshots.
