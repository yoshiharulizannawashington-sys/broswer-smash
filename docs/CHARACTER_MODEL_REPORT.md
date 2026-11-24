# Character model report

> **Current roster note (2026-11-08):** this report was measured during the 34-fighter
> pre-promotion phase. The live launch contract is now **38 launch / 22 DLC / 60 catalog**
> (the 35-fighter pre-promotion roster plus Wolverine, Geralt and Doom Slayer). Some historical
> counts below still read 34/58 and are retained as the original measurement; current gates assert
> 38/38 and the 38/22/60 catalog. — Browser Smash

Status of the playable fighters' *bodies*: what is authored geometry, what is still a primitive
prefab, what was fixed in this pass, and what is blocked. Written against the working tree and the
tests that were actually run, not against intent.

## 1. The hard constraint this pass works inside

- **Blender is available through a project script, not the base image** (`scripts/install-blender.sh`
  unpacks portable Blender 4.2.23 LTS into `.tools/` plus the two X libraries it needs; always run
  it through `scripts/blender.sh`). It runs headless here, but its renderers do not: EEVEE and
  Workbench both need `libEGL`, which this container does not have, so all visual judgement comes
  from the game running in headless Chromium, not from an offline Blender render.
- **No third-party character model has been downloaded, and none will be.** The repository has no
  record of a licence for one, and inventing a download link or bundling an unlicensed model is
  explicitly out of bounds.
- The committed character prefab library (`public/assets/character_models.glb`) is **primitive
  assemblies** (cylinders for limbs, spheres for hands and heads): 45 meshes, ~9.3k triangles per
  body. It is not a high-detail model, and describing it as one would be false.
- The three manifest entries that expect *supplied* rigged source files are still empty:

  | Identity | Expected file | State |
  | --- | --- | --- |
  | Goku | `public/models/characters/goku/Goku.fbx` | not installed |
  | Iron Man | `public/models/characters/iron-man-mark-v-rig/Iron Man Mark V Rig Materials.gltf` | not installed |
  | Iron Spider | `public/models/characters/iron_spider/iron_spider.glb` | not installed |

  `npm run validate:assets` reports all three as fallbacks and passes.

So the only honest way to raise model quality in this pass was to **author better geometry in
code**. That is what `public/js/characters/sculpted.js` is: original work by this repository, no
third-party mesh, texture or scan, and therefore no external licence to record.

## 2. What is authored (and what replaced what)

`public/js/models.js` → `makeProceduralCharacter()` builds a sculpted body for three identities and
returns it before the prefab swap, so the primitive assembly is never mounted for them:

| Identity | Body | Triangles | Meshes | Materials |
| --- | --- | --- | --- | --- |
| Goku | `sculpted:goku` | ~31.9k | 122 | 15 |
| Iron Man | `sculpted:iron_man_tony_stark` | ~29k | 118 | 14 |
| Iron Spider | `sculpted:iron_spider` | ~26k | 110 | 13 |

(Measured in the live game by `scripts/_audit-visual.mjs`; the count includes the four-leg rig for
Iron Spider.)

### Goku
- Lofted chest/waist/hip volume with pectorals, three rows of abdominal blocks and a trapezius
  wedge — real front-plane anatomy rather than a box.
- **Open-front gi jacket**: a partial loft (fabric over the back and flanks, nothing across the
  sternum) with two crossed lapel bands, a blue undershirt panel behind the opening, a raised
  collar, sash with knot and hanging end, and three gi skirt panels.
- Sleeveless arms with modelled deltoids, bicep/forearm taper, blue wristbands, gi shoulder cuffs.
- Trousers lofted into the boot cuff; boots with a lofted ankle cuff, foot box, toe cap and
  outsole; accent trim rings.
- Hands: palm plate, four two-phalanx fingers and an opposed thumb (10 parts per hand).
- Head: lofted cranium with a real jaw taper, eyes with irises and pupils, brows, a nose wedge, a
  mouth bar and ears.
- Hair: a scalp cap plus **13 individually shaped spikes** and three fringe locks, with a second,
  taller 17-spike set built as its own geometry (`goku-hair-ascended`) that the Kaioken form swaps
  in.

### Iron Man
- Under-suit torso with separate chest plate, collar plate, three abdominal bands, back plate and
  two thruster nozzles with emissive discs.
- Helmet shell with a gold faceplate loft, glowing eye slits, mouth vent, crest and side pods.
- **Arc reactor as geometry**: housing cylinder, lens, six gold bolts.
- Pauldrons, bicep bands, forearm bracers, gauntlets with a knuckle guard, wrist collar and a
  palm **repulsor disc**; boot repulsors in the soles; thigh, knee and shin plates over the armour
  loft.
- Materials split painted red armour (metalness 0.62, roughness 0.30), gold trim (0.95 / 0.18),
  steel, under-suit, and two different emissive materials for reactor vs accents.

### Iron Spider
- Suit panels: gold sternum strip, chest plates, lower-rib plates, web seam lines, gold belt loft.
- **Spider emblem as geometry**: body, abdomen and eight angled legs raised off the chest.
- Masked head: suit-coloured cranium, gold brow trim, angular lens rims, dark seam lines.
- Gold forearm cuffs and **wrist web-shooter housings**, gold shin cuffs.
- **Four articulated mechanical legs**, mounted on the body itself (`attachSpiderLegs`) — each a
  hip yaw group plus coxa → femur → tibia joint chain with joint spheres and a tip, i.e. 12 driven
  joints, the same rig the prefab path used and the same one `updateSpiderLegs()` poses from combat
  state (folded / flare / strike / guard / stagger / recover). These are not decorative: the
  leg-sweep move drives them and the hit volume is resolved by the existing combat pipeline.

## 3. Rig contract

The authored bodies reproduce the project's existing rig contract exactly — `pelvis` at y=1.02,
`torso` +0.28, `neck` +0.25, `head` +0.06, shoulders ±0.185/+0.20, elbows −0.28, wrists −0.26,
hips ±0.105, knees −0.42, ankles −0.40 — and expose `leftArm/rightArm/leftFore/rightFore/
leftLeg/rightLeg/leftShin/rightShin/leftHand/rightHand/leftFoot/rightFoot`. That is why the 39-clip
procedural library, `updateProceduralPose()`, the animation controller's retiming and every attack
pose apply to them unchanged, with **no second animation system**.

`userData.rigKind` stays `'procedural'` (the poses are rotation-only) and `userData.sculptedBody`
names the body. `npm run audit:roster` rig-checks every selectable fighter's live model; the three
authored bodies are reported as `body: "sculpted"` and pass the same ground-contact, height,
upright-silhouette, head-above-pelvis and joint-inside-bounds gates as the prefabs.

## 4. Transformation presentation (what is real)

`public/js/anim/form_presentation.js` retargets the body's own declared surfaces and restores every
recorded original on expiry, interruption, KO and rematch:

| Fighter | Form | Real change | Verified by |
| --- | --- | --- | --- |
| Goku | Kaioken ×3 | hair material emissive red + lift (scale), accent emissive, **and the taller alternate hair mesh swapped in** | `npm run test:animation` |
| Iron Man | Overdrive | arc-reactor lens white-hot, reactor emissive intensity, accent (eyes/repulsors) | `npm run test:animation` |
| Iron Spider | Assault protocol | appendage gold material (all twelve leg joints, joint spheres, tips) | `npm run test:animation`, `npm run test:iron-spider` |

Honest limits: Goku's build has **only Kaioken**, there is no Super Saiyan form in this project, so
a golden Super Saiyan hair variant is not claimed. The alternate hair mesh exists and the swap is
wired to `formVariants.kaioken`; what it changes is the silhouette and the hair/shoulder glow, not
the hair colour to gold (that would need a second material or a separate form).

The form burns a real resource (`cost`/`drain`/`cooldown` in `public/js/combat/movesets.js`), the
HUD timer is authoritative, and expiry restores base colour, emissive intensity and hair scale —
proven by the restore assertions in the animation test.

## 5. Defects found and fixed in this pass

1. **Fighters wore a visible checkerboard.** `public/js/surface_detail.js` baked a 5-texel weave at
   repeat 3.2 with a 0.55 normal scale across every prefab, which printed a grid on skin and cloth
   at fighting distance (clearly visible on Hulk in the pre-fix screenshots). Repeats raised to
   4.5–7.5, normal scales cut to 0.12–0.24, weave albedo contrast reduced ~8×. Surface break-up
   remains; the grid is gone.
2. **Authored bodies were being smeared by that same pass.** Lofted geometry has no UV chart, so
   sampling a tiling map put one texel over a whole limb. Sculpted bodies now skip procedural
   surface detail and record `{ applied: false, reason: 'authored geometry, no UV chart' }`.
3. **Goku's gi hid his anatomy.** The jacket was a closed shell, so the chest never read. It is now
   an open partial loft with lapels and an undershirt panel.
4. **Goku's calves were bare skin** below the trouser cuff. The shin loft takes the trouser
   material, so the leg reads as one orange gi leg into the boot.
5. **Shoulders used the undershirt colour**, giving two blue balls at the deltoids. They now use
   skin, with a gi cuff ring at the shoulder seam.
6. **Iron Spider's legs were mounted late**, by a per-frame check in `main.js`, so a body built
   without a frame of gameplay had no appendages. The body now mounts them itself (idempotent), and
   the per-frame check simply reuses the rig.
7. **Two gates assumed every fighter is a prefab**: `audit:roster` and `browser-smoke.mjs` required
   a node named `Blender fighter …` with an equipped weapon. Both now accept an authored body that
   is fully articulated (joint handles present, rig check passing) while keeping their original
   guarantee for the other 30 prefab-backed fighters.
8. **The exported bodies shipped with no surface detail at all.** `enhanceSurfaceMaterials()` was
   only called on the prefab body in `models.js`, and every fighter's own GLB replaces that body a
   frame later — so the detail was applied (and its material maps allocated) for a body nobody ever
   saw, and the 34 fighters that do ship rendered as smooth flat plastic. The roster audit reported
   `withSurfaceDetail: 0` and `detailClasses: []`. `human_fighter.js` now applies the same generated
   weave/brushed/grain maps to the imported body before it is mounted, and the audit asserts every
   mounted fighter reports detail (34/34, classes `armor`/`fabric`/`generic`/`skin`).
9. **The hit-reaction lean was written to the fighter root, so the rig gate rejected valid bodies.**
   `animateHumanFighter()` damped `rotation.z` on the fighter's model root for the hitstun/attack
   lean. That root is the fighter's physics transform and the object every structural rig gate
   measures, so a fighter that happened to be checked while mid-hitstun reported "root is tilted 7.4
   degrees off world up; run scripts/normalize-character-rig.mjs" — a real failure of
   `test:iron-spider`'s stage-travel check, with nothing wrong with the rig. The lean is now written
   to the imported asset *inside* the holder (an offset from the asset's own authored roll), which is
   the same transform composition as before, so the silhouette is unchanged and the holder stays
   upright.

## 5b. The Blender export of the three flagships (this pass)

`assets/blender/build_roster_models.py` builds Goku, Iron Man and Iron Spider as real skinned GLBs
(`public/models/characters/original/*-alt.glb`): 20 bones, 8 named clips, ~4–6k triangles each, feet
on the origin, all eleven canonical bones bound, loaded and measured in the live game. The exports
are **verified and disabled on purpose** — shipped side by side with the authored bodies they render
worse (coincident torso/gi shells z-fighting, ball-shaped shoulder and knee spheres, no sleeves, no
UVs). The evidence, defect list and re-enable checklist are in
[CHARACTER_BODY_AUDIT.md](CHARACTER_BODY_AUDIT.md); Kaze stays enabled as the working proof of the
pipeline.

One real rider on that work is kept: the clip lookup in `public/js/human_fighter.js` now searches
clip words in priority order. It used to test every word against every clip at once, so a rig
shipping `jab` and `heavy_punch` bound *both* the light and heavy attack to `heavy_punch` (because
that name contains `punch`). Kaze's light attack now binds and plays `jab`, asserted live by
`npm run probe:bodies`.

## 6. What is still not AAA quality, and exactly what is needed

The authored bodies are a genuine step up from cylinder assemblies — real silhouettes, layered
clothing and armour, modelled hands and faces, twelve-joint appendages — but **code-authored
primitives cannot reach Xenoverse/Injustice quality**. Missing, specifically:

- **Sculpted organic detail** (nose/lip/eyelid forms, cloth folds, hair as strands) — needs a
  DCC tool (Blender) and sculpted meshes, not lofted ellipses.
- **Real skeletons** (`SkinnedMesh` + weighted vertex groups) so joints deform instead of
  interpenetrating; the current bodies are rigid segment hierarchies.
- **Image textures** (albedo/normal/ORM at 1–2k) — there is not one character texture in the repo.
- **Licensed animation clips** — the 39-clip library is procedural (correctly labelled as such).
- **A licensed model source** for the three fighters. To supply one: drop the extracted package in
  and run `node scripts/install-character-assets.mjs /path/to/extracted-package`; it validates the
  required files and enables the manifest entry. Nothing else changes: the loader, rig validation,
  clip retargeting and transformation surfaces already exist and are tested, and the sculpted body
  is only used when no validated manifest asset exists.

A believable next quality step that does *not* need a licence: continue the authored pipeline over
the rest of the roster (each identity needs its own proportions, clothing and signature equipment),
and add a skinned-variant path so authored bodies can be exported as GLB with vertex weights.

## 7. Commands run for this report (2026-10-27)

```sh
npm run build                                                         # ok
npm run validate:assets                                               # pass
npm run validate:animations                                           # pass
npm run test:roster-models                                            # 34/34 fighters, 405 skinned meshes, 393,342 tris
npm run test:geometry                                                 # pass (kernel regression, incl. the flat-loft fixture)
npm run test:animation                                                # 199 checks pass
npm run test:rig                                                      # pass
npm run test:kaze                                                     # 74/74 checks pass
npm run test:combat                                                   # 394 checks pass
npm run test:worlds                                                   # 47,329 assertions, 60 locations
bash scripts/run-browser-test.sh scripts/audit-roster.mjs             # pass — 34/34 own body, 34 with surface detail
bash scripts/run-browser-test.sh scripts/probe-character-bodies.mjs   # 40 checks pass
bash scripts/run-browser-test.sh scripts/browser-smoke.mjs            # pass, both entry points
bash scripts/run-browser-test.sh scripts/test-movesets.mjs            # 79 checks pass
bash scripts/run-browser-test.sh scripts/test-gameplay.mjs            # 48 checks pass
bash scripts/run-browser-test.sh scripts/test-mechanics.mjs           # 74 assertions pass
bash scripts/run-browser-test.sh scripts/test-explore.mjs             # 49 assertions pass
bash scripts/run-browser-test.sh scripts/test-iron-spider.mjs         # 39 checks pass
bash scripts/run-browser-test.sh scripts/test-stage-feel.mjs           # 138 checks across 4 stages
```

Not re-run in this pass: `test:worlds:browser` (world geometry untouched; its last recorded run is
in `docs/WORLD_RESTORATION_REPORT.md`). `probe:bodies`' live light-attack check samples animation
frames, and a starved `requestAnimationFrame` under load can return an empty sample even though the
attack played; it now retries that measurement instead of failing on a single starved frame. That is
the one flake seen while driving the whole roster: it failed once while `test:combat` was running
beside it ("clips":[], "landed":false) and passed 40/40 on both standalone runs.

The browser tests need `scripts/run-browser-test.sh`; plain `node` lacks the Chromium libraries and
fontconfig in this container (that is an environment failure, not a product failure).

## 8. Seeing it in the running game

```sh
npm ci
npm run dev            # http://localhost:3000
```

Pick Goku, Iron Man (Tony Stark) or Iron Spider in the roster, in the DBZ Tournament arena, and look
at the character from the default match camera. `I` activates the form, `O` the ultimate, `K` the
signature special, `F3` the combat debug overlay. Visual audit harnesses:

```sh
bash scripts/run-browser-test.sh scripts/_audit-camera.mjs artifacts/cam "Iron Spider"
bash scripts/run-browser-test.sh scripts/_audit-visual.mjs artifacts/close "Goku"
```

## 9. Remaining known issues (not fixed here)

- The three flagship Blender exports are lower quality than the authored bodies and stay disabled
  (§5b). Re-enabling them needs the exporter fixes listed in CHARACTER_BODY_AUDIT.md §3.

- The form activation burst is a large white flash that can hide the fighter for ~0.4 s — the
  transformation is unmistakable, but its readability should be reduced.
- The match camera can end up close to one fighter, so the opponent can fill the frame; framing is
  functional but not cinematic in every position.
- Scene exposure is bright in daylight arenas, which flattens the authored material contrast.
- Only three of 33 identities have authored bodies; the other 30 still use prefab/procedural
  bodies at the quality level described in §1.

## 10. Kaze: the Blender-authored reference fighter

`public/models/characters/kaze/kaze.glb` is generated by `assets/blender/build_anime_fighter.py`
(original geometry — no downloaded mesh, texture or motion clip) and is registered in the character
manifest, so it loads through `upgradeFighterModel()` and is selectable as **Kaze**.

**Shipped asset (verified):** 13 skinned primitives, 13 materials, 12,864 triangles, 19 deform bones
(20 nodes), 8 clips, all 6,560 vertices weighted (1,083 with two weights, 0 unbound), authored UVs,
1.77 m tall, feet on the origin.

### 10.1 What the Phase 7 rework fixed

| Defect | Evidence | Fix |
| --- | --- | --- |
| Every lofted part was a flat shell | 10 cm height-band depth was exactly 0.000 m at the shoulders, chest, hands and knees | `loft()` now stacks rings across the body's width *and* depth; `inspect-character-glb.mjs` fails any collapsed band |
| Torso and gi were coplanar | dithered z-fight "stipple" across the chest | gi is a separate shell 10–14 mm outside the torso, with its own thickness |
| No visible undershirt | gi was a closed loft despite the comment | gi is an open shell with a V opening; lapels are seated on the measured opening rim |
| Face was blank | eyes, brows and mouth were authored at constants *inside* the skull | every feature is placed with `head_front_y()`, the measured head surface |
| Hair read as a helmet with a slot | sphere scalp reaching below the eye line, fringe covering the brows | crescent shell open across the forehead, closing over the crown; fringe above the brows |
| Arms and legs looked like stacked bands | 4 separate lofts per arm with non-matching radii, elbow/knee balls | one continuous loft per limb with two-bone weights across the joint |
| Wrist had a 45 mm hole | forearm ended at z 0.84, palm started at 0.795 | continuous arm loft to the wrist, palm overlapping it |
| Walk bob moved the fighter forward | hip offset written into bone-local axes | `hips_offset()` converts world offsets through the bone's rest basis |
| Clips inherited stale rotations | each keyframe wrote only the bones it changed | every key writes every animated bone |
| Block/jab had no anticipation | single-hit keys | anticipation → drive → contact hold → recoil → return, with hip drive |

### 10.1b The continuation pass: four defects the first rework left behind

The Phase 7 rework above was itself audited with per-part and per-bone measurements, which found
four problems that a render could not show:

| Defect | Evidence | Fix |
| --- | --- | --- |
| **Limbs did not move at all** | The exported GLB had *no* arm/leg/hand/foot influences: 2,216 of 5,905 vertices on the exporter's generated `neutral_bone`, 2,209 on `Head`. `weight_parts()` wrote groups named `LArm`/`LForeArm` while the bones are `LeftArm`/`LeftForeArm`; a group that does not match a bone binds nothing, silently | One `SIDE_PREFIX` table (`L`→`Left`), a hard build failure on any unweighted vertex or orphan group, and a `neutral_bone`/influence assertion in `npm run test:kaze`. Joint travel went from 4 cm of block movement to 58–126 cm of real articulation |
| **Inside-out geometry** | Arms, legs, fingers, lapels, fringes, sash tails and back skirt enclosed negative signed volume: sections authored top-down inverted every quad | `mesh_object()` recalcs normals and flips any part still enclosing negative volume |
| **Coplanar garment layers** | 149 of 496 jacket vertices sat within 2 mm of the torso surface — the lining landed exactly on the undershirt, which is the original stipple | `GI_LIFT` (6 mm) plus a `front` bulge on `shell()` so the coat clears a chest that swells 7%; verified by BVH nearest-surface queries in the Blender test and by a layer check on the export |
| **Unwelded band seams** | Sash, wrists wraps and the new sleeves had an open split down the back (20 boundary edges each) from a duplicated seam column | `shell()` wraps closed bands with `segments` columns; every part is now a closed surface |
| **Washed-out colours** | Navy trousers rendered pale mauve and the gi pale apricot | Palette values are sRGB; glTF stores linear. `make_material()` converts once |

Visual changes in the same pass, chosen from the in-game close-ups: a **nape/temple hair wrap** (the
cap alone left a bald band above the ears), **short gi sleeves** bound to the arm bones, heel and
sole shortened so no spur sticks out behind each boot, and finger tips curled instead of splayed.

**Added gates:** `npm run test:geometry` (464 checks) keeps the old flat kernel as a fixture and
asserts the probe still fails it, checks every generated part for depth/degenerate faces/manifold
edges/outward winding/UVs, checks the gi-to-torso clearance, and checks binding. `npm run test:kaze`
grew to 74 checks with per-bone influence and joint-deformation assertions. The GLB inspector gained
zero-area triangle, outward-winding, welded-watertight and garment-layer checks.

### 10.2 What is real and what is not

**Real:** the geometry, the skeleton, the skin weights, the eight clips, the material split, the UVs,
and the in-game behaviour — the body mounts through the normal loader, the clips drive the mesh
(`npm run test:kaze` measures 4–23 cm of skinned vertex displacement per clip), and Wind-Step
repaints `kaze-hair` and `fighter-accent` and restores them exactly
(`npm run probe:bodies`, 33 checks, including 4 new imported-body form checks).

**Not production art.** This is a clean, readable *stylised* fighter built from lofts: it has no
sculpted muscle definition, no cloth simulation, no facial animation and no texture maps (tried and
removed — see BLENDER_PIPELINE §2.2). It is not comparable to a hand-modelled Xenoverse character,
and it should not be described as AAA. What it is: a complete, verified pipeline artefact, and the
standard the next original fighters should be built to.

### 10.3 Known visual defects

- Hem of the gi and the sash read as two separate layers at the hip; a longer jacket would sit better.
- The hairline still reads as a cap edge across the temple in close-up: the nape wrap closes the bald
  band but its top rim and the cap's bottom rim meet in a visible line. Fixing this properly needs a
  shaped hairline shell rather than two concentric bands.
- Hands are simplified: four fingers read as a mitten at gameplay distance; the lapel reads as a thin
  cord with a loop rather than a folded cloth band.
- Hair is shells plus blades — the silhouette is spiky but individual locks merge at the crown.
- Boots are rounded, with no ankle articulation in the mesh (the Foot bone still rotates them).
- At the game's pulled-back camera the face reads as eyes + brows; the mouth and nose are only
  visible in close-ups.
- The pose-sheet screenshots under `artifacts/kaze/` are unreliable in this environment: software
  WebGL renders this scene at roughly a quarter frame per second, so the captured frame can precede
  the pose request. Animation correctness is therefore asserted numerically (bones *and* skinned
  vertices), not from those images.

## Roster-wide generated bodies

Every selectable fighter mounts its own exported body from
`public/models/characters/roster/<slug>.glb` (58 files; 34 for the launch roster), generated by
`assets/blender/build_roster_fighters.py` on the same kernel as the reference fighter. They are
original work by this project: 19 bones, 8 clips, 13 skinned meshes, ~12k triangles, 600-690 kB
each, sRGB-correct PBR materials with authored UVs.

How a fighter gets its body (`upgradeFighterVisual` in `public/js/main.js`):

1. The prefab library body mounts first. It is the instant body, the fallback if the character GLB
   is missing or fails the rig gate, and the source of each identity's signature weapon.
2. The character's own GLB replaces it (`public/js/human_fighter.js`), normalised to 2.05 m with
   its feet on the fighter origin and facing the fighter's heading.
3. The weapon is re-mounted on the new body. That required the imported skeleton to answer to the
   same joint names the game already read, so `human_fighter.js` binds `userData.rightArm`,
   `rightFore`, `pelvis`, `head`, ... onto the real bones. The three hand-attack identities are
   unarmed by design and carry `unarmed` across the swap so they do not gain a blade.

Every one of those bodies also receives the generated surface-detail maps
(`public/js/surface_detail.js`) before it is mounted, so the exported geometry reads as cloth,
brushed armour and skin rather than flat plastic at fighting distance; the roster audit asserts it
per fighter instead of reporting it as information.

Browser-verified by `npm run audit:roster` (every selectable fighter on the body exported for it,
one unique asset per fighter, 11 canonical joints bound, resolved skeleton, weapon or documented
unarmed, feet on origin, head above pelvis, surface detail present on all 34), `npm run probe:bodies`,
`npm run test:smoke`, `npm run test:iron-spider` and `npm run test:feels`-equivalent
`test:stage-feel`.

Honest limits: these are stylised, procedurally authored fighting-game bodies built from lofted
cross-sections - not scanned, sculpted or motion-captured character art, and not the equal of a
commercial fighting game's roster. The seventeen scripted clips are procedurally authored, not
motion capture. A human visual pass on the running game has not been done from this environment;
the automated gates prove structure, binding, mounting and animation activity, not visual quality.

## Movement identity

A body that animates is not yet a character that moves like itself. Movement was one generic table
(walk 5.1 / run 8.8 / sprint 12.5 m/s, one acceleration, one jump impulse, one gravity) plus two
hard-coded identity checks inside `Fighter3D.handleInput` — The Flash and Spider-Man got a speed
multiplier, and nobody else got anything. A 500 kg brawler and a speedster accelerated at exactly
the same rate.

`public/js/combat/locomotion.js` now carries an explicit profile for every one of the 34 launch
identities: top speed (arena and free-roam), ground and air acceleration, braking, jump impulse,
gravity and a reversal commitment factor. The fighter reads it every frame (resolved per frame
rather than cached, because the same fighter instance is reused when the player switches
characters), and a form's own speed multiplier still stacks on top.

The values are deliberate rather than decorative. The Flash is the fastest fighter in the game with
the hardest braking and the fastest reversal (15.5 m/s sprint, turn 1.5); Hulk is the slowest to
accelerate (10.5) and slowest to stop (6.5), with the highest jump and the hardest fall, and cannot
pivot like a lightweight (turn 0.62); Professor X is the slowest fighter alive (9.25 m/s) because
he is seated; the armoured fliers brake hard because thrusters and weight stop them; the ninjas
(Naruto, Sasuke, Levi, Spider-Man, Iron Spider, Kaze) have the best air control in the game.

Two related defects were found in the same area and fixed:

1. **Dead move profiles.** `CHARACTER_MOVE_PROFILES` keyed two entries as `hulk` and `iron_man`,
   which can never match the identity slugs `hulk_bruce_banner` / `iron_man_tony_stark`. The Hulk's
   slower startup (1.22) and heavier knockback (1.2) were dead data that had never applied. Every
   launch identity now has an entry.
2. **A roster gate that silently skipped two fighters.** The first version of the locomotion test
   parsed only 32 of the 34 roster entries from `main.js`. It now asserts the entry count as well as
   the parsed count, so a roster gate fails loudly instead of auditing 32 fighters and passing.

`npm run test:locomotion` (61 checks) is the gate: roster coverage, no dead keys in either
profile table, at least 10 distinct sprint speeds and 6 distinct accelerations, the directional
assertions above, and a simulation of the real integration (the same damp-toward-target the
fighter runs) proving the differences actually appear — a speedster more than 30% clear of the
bruiser after half a second, every fighter reaching 90% of its own top speed within 1.5 s, and the
heavyweight keeping several times more of its momentum when the stick is released.

## Clip-coverage and clip-shaping passes

Two passes are recorded here: the clip-shaping pass (stride and stance follow each fighter's own
movement) and the clip-coverage pass that followed it (the state set went from eight clips, with an
idle that moved no bones at all, to seventeen clips with no static pose left in the roster).

## Clip-shaping pass — every fighter's animation now follows its own movement

The eight clips were authored once and exported byte-identical for all 58 built bodies, so a 500 kg
brawler and a speedster walked with the same stride, the same crouch and the same swing. That
contradicted the per-character movement the game applies at runtime, and it is the animation half of
"a recoloured controller instead of a movement identity".

`build_animations(armature, clip_profile)` in `assets/blender/build_anime_fighter.py` now takes
multipliers - stride, swing, lean, crouch, stance - and `assets/blender/build_roster_fighters.py`
derives them per fighter:

- **stride** is the identity's own speed multiplier, read out of `public/js/combat/locomotion.js`
  (the number the movement system uses), clamped to 0.86-1.28. 18 distinct strides exist across the
  roster: The Flash steps 1.24x, Professor X 0.86x.
- **crouch / lean / stance / swing** by archetype: brawlers plant wider and lower, ninjas stay
  narrow and quick, mages keep the torso upright, cyborgs sit between the two.

No clip name, count or duration changed, the armature and the skin weights are untouched, and Kaze's
own export - which passes no profile - is unchanged.

Measured per body from the exported GLBs with `npm run measure:model` (key-to-key deviation, not
angle from identity):

| Fighter | Speed x | Walk swing | Run swing |
| --- | --- | --- | --- |
| The Flash | 1.24 | 64.5 deg | 133.9 deg |
| Goku | 1.08 | 56.2 deg | 116.6 deg |
| Superman | 1.06 | 55.1 deg | 114.5 deg |
| Hulk | 0.92 | 47.8 deg | 105.4 deg |
| Professor X | 0.86 | 44.7 deg | 99.4 deg |

Honest limits: these are still scripted clips per body, not captured or hand-animated motion, and the
pass changes how far the authored poses travel rather than how many states exist. Measured before and
after on the same rig: 8 clips per body, 11.1 bones moving per clip, 63.4 deg mean motion range,
roster detail index 70.6.

## Clip-coverage pass - eight states became seventeen

The exported bodies carried eight clips and the game asks for far more. In the legacy mixer path in
`public/js/human_fighter.js`, a missing clip is not an error: the search falls back to idle or jump,
so dodge, charge, beam, land and sprint were silently playing the wrong animation. Nine states were
authored in `build_animations()` and every consumer was rebound:

`land`, `dodge`, `charge`, `beam`, `sprint`, `block`, `heavy_punch`, `launcher`, `knockdown`, `get_up`,
`hit_light`, `jab` (kept as the light-attack clip) - exported per body: **8 -> 17 clips**.

The exported clip set is now: beam, block, charge, dodge, fly, get_up, heavy_punch, hit_light, idle,
jab, jump, knockdown, land, launcher, run, sprint, walk. `npm run test:kaze` was widened from 60 to
92 checks so each clip is asserted for presence, bone binding and real pose deviation rather than just
for existing, and the mixer bindings were re-read in the same pass.

Measured after the pass: 17 clips per body, 12.3 bones moving per clip, roster detail index 72.3.

## Static-pose floor pass - a held clip may no longer ship frozen

`npm run measure:model` then exposed a defect the clip count had hidden: **idle moved 0 bones** - every
key in it was identical, so the roster stood perfectly still - while block moved 7 and the other held
states (fly, charge) barely moved at all. Held states are on screen for seconds at a time.

| Clip | Moving bones before | after | max angle after |
| --- | --- | --- | --- |
| idle | 0 | 17 | 19.0 deg |
| block | 7 | 19 | 12.6 deg |
| fly | - | 16 | 11.4 deg |
| charge | - | 11 | 14.1 deg |

Idle is now a live weight shift with breathing, block braces and rocks on the loaded leg, hover
drifts, and the charge pulses. Roster means: **11.1 -> 14.4 bones moving per clip**, mean motion range
63.4 -> 72.3 deg, roster detail index 70.6 -> 75.4, with `npm run gate:model` reporting no regression
against the previous baseline and **zero static clips** across all 59 measured bodies.

The gate itself was hardened at the same time: as well as comparing against the stored baseline, any
clip with fewer than 6 moving bones now fails outright, so a frozen held state cannot ship again even
if the baseline that day happens to be low.

Remaining honest limits: 17 scripted clips per body, roughly 14 of 19 bones moving in a typical clip,
no image textures (materials are authored PBR values), no facial or finger animation because the rig has
no such bones, and the performance numbers below were measured under software WebGL rather than on
Chromium hardware. The next thing this loop should raise turned out to be visual, and the capture pass found it:

## Presentation pass - the shockwave front no longer covers the fight

Rendering Iron Spider's signature special to a frame showed a ring 5.4 m out with a roughly 1 m thick,
near-white band lying across most of the arena and hiding both fighters. The cause was in
`window.performSignatureMove` / `window.updateSignatureMoves` in `public/js/main.js`: the shockwave
rings were authored as `.78`-radius tori and then scaled by `radius / .78`, so their tube thickness grew
with the radius (0.186 x radius - about 1.0 m at a 5.4 m special and 1.6 m at Saitama's 8.4 m) while the
inner ring stayed at colour 0xfff2ca and opacity .9. The same materials also set `emissive` and
`emissiveIntensity` on `MeshBasicMaterial`, which has no emissive response: dead data.

The rings are now unit-radius with thin tubes (outer .055, inner .032), expanded to the move's own radius
at run time, tinted from the profile colour at opacity .62 / .44 and faded over the move's life. The
gameplay radius, damage, stun, knockback, hit test and the Iron Spider leg-tip contact test are
unchanged - this is a presentation fix only. Verified by rebuilding and re-capturing the same special:
the front now reads as a compact expanding ring at the fighter's feet with both fighters and the arena
visible. The same code path drives every shockwave special on the roster (Hulk, Saitama, All Might,
Iron Spider and their transformed variants), so the readability fix is roster-wide.

## Per-identity detail geometry (Goku, Iron Man)

The launch bodies are generated from one shared anatomy plus a garment/head/hair/extra spec, so two
fighters with the same spec were the same model in another colour. `build_signature_details()` in
`assets/blender/build_roster_fighters.py` now adds the details that belong to a single identity
rather than an archetype, for the two visual benchmarks:

- **Goku** — a forward anime fringe on the measured brow line (the `spikes` hairstyle deliberately
  skips the shared fringe), sideburn locks tying the hair mass to the jaw, and blue forearm wraps
  with a knot that close the gi sleeve onto the wrist.
- **Iron Man** — emissive palm repulsors (housing ring, lit lens, wrist slit) so the suit reads as
  powered armour and a firing pose has a visible emitter, plus three chest vents under the reactor so
  the breastplate reads as machined panel work instead of one smooth shell with one glow.

Only those two exports were rebuilt:

```
bash scripts/blender.sh -b --python assets/blender/build_roster_fighters.py \
  -- --out-dir public/models/characters/roster --only goku,iron_man_tony_stark
```

| Export | bytes | vertices | triangles | bones | canonical joints | clips |
| --- | --- | --- | --- | --- | --- | --- |
| `roster/goku.glb` before | 842,428 | 6,775 | 12,430 | 19 | 11/11 | 17 |
| `roster/goku.glb` after | 892,260 | 7,568 | 13,862 | 19 | 11/11 | 17 |
| `roster/iron_man_tony_stark.glb` before | 801,756 | 6,210 | 11,216 | 19 | 11/11 | 17 |
| `roster/iron_man_tony_stark.glb` after | 856,920 | 7,116 | 12,556 | 19 | 11/11 | 17 |

A kernel defect surfaced while doing this: Blender appends `.001` when a part name is already taken,
and `wrap-L.001` resolved to `NoneForeArm`, failing the bind check with `groups with no bone`.
`bone_for_part()` now accepts a side token followed by a dot, so a duplicate name cannot silently
mis-bind a part.

Captures through the real gameplay camera: `artifacts/gallery/goku-detail` and
`artifacts/gallery/ironman-detail` (idle, light, special; 0 page errors). These are original
stylised bodies authored by this repository, not licensed reproductions of the characters.
