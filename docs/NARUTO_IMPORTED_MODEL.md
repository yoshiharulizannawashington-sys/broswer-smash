# Naruto Uzumaki: the imported body, end to end

Naruto is no longer a repository-generated stand-in. A creator-published model was downloaded, split
out of its source pack, given textures and a 19-clip animation set on its own skeleton, installed
through the existing installer and verified in a live match.

Rights are recorded in two places and deliberately narrow: [ATTRIBUTIONS.md](../public/ATTRIBUTIONS.md)
and the `naruto_uzumaki` entry of the character manifest.

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
