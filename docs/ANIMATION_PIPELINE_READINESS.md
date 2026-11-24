# Animation pipeline readiness — Browser Smash

Status of skeletal animation, transformation presentation and appendage support, written from the
code in `public/js/anim/` and from the tests that actually run, not from intent.

## 1. What exists and works

| Piece | File | State | Proven by |
| --- | --- | --- | --- |
| Clip manifest | `public/data/animation-manifest.json` | Present. 39 canonical clip ids, each with a fallback rule and a Mixamo clip-name hint. | `npm run validate:assets` |
| Pack loader | `public/js/anim/animation_loader.js` | Present. `loadAnimationManifest()` (fetch, `no-cache`), `loadAnimationPacks()` (HEAD-verifies every pack before loading), `bootstrapAnimationPacks()` called once from `main.js`. | `npm run test:gameplay` |
| Retargeting | `public/js/anim/animation_loader.js` → `retargetClip()` | Present. Rewrites track paths onto canonical bone names and strips position/scale tracks so a downloaded clip cannot fight gameplay physics. | `npm run test:animation` |
| Skeleton adapter | `public/js/anim/rig_map.js` | Present. `classifyBone()` maps Mixamo / Blender / Sketchfab bone names onto canonical names, with the Mixamo `LeftLeg`-means-shin trap handled. `resolveRig()` binds the canonical rig to either a prefab or a real skeleton. | `npm run test:animation` |
| Procedural library | `public/js/anim/clip_library.js` | Present. 39 hand-authored clips built at runtime for whatever rig exists: `idle walk run sprint turn stop strafe_left strafe_right jump double_jump fall land fly_start fly_loop fly_boost fly_turn fly_land fighting_idle jab cross_punch heavy_punch uppercut front_kick spinning_kick combo_1 combo_2 special_attack block dodge_left dodge_right grab throw hit_light hit_heavy launch aerial_recovery knockdown get_up knockout`. | `npm run test:animation` |
| Playback | `public/js/anim/animation_controller.js` | Present. One `THREE.AnimationMixer`; whole-body states use one action, while guard and basic attacks use two disjoint masked lanes (lower locomotion plus upper guard/strike). Cross-fade on state change, one-shot locks released by time (never by an animation event that might not fire), `setExternalClips()` swaps a library clip for a downloaded one, `retimeClip()` lands a one-shot's strike peak on the move's real active window. | `npm run test:animation`, `npm run test:body-mask` |
| Body masks | `public/js/anim/body_mask.js` | Present. Track-level upper/lower masks with disjoint pelvis/leg and spine/head/arm sets; used by both the controller and the legacy imported-body mixer. | `npm run test:animation`, live `test:body-mask` |
| Form surfaces | `public/js/anim/form_presentation.js` | Present. A form retargets the body's own declared surfaces (hair material, arc reactor, mechanical appendages) and restores every recorded original on expiry, interruption, KO and rematch. | `npm run test:animation` |
| Appendage rig | `public/js/anim/spider_legs.js` | Fallback only. The repaired native `Object_122` mesh is used when mounted; the procedural four-leg rig (12 joints) still covers a missing mesh. | `npm run test:animation`, `npm run test:iron-spider` |
| Authored bodies | `public/js/characters/sculpted.js` | Present. Goku, Iron Man and Iron Spider ship lofted, hand-authored geometry instead of the primitive prefab, on the same eleven-joint contract, so every clip, pose writer and form surface above drives them unchanged (see `docs/CHARACTER_MODEL_REPORT.md`). | `npm run test:animation`, `audit:roster`, `browser-smoke.mjs` |
| Asset report | `main.js` → `window.__browserSmashAssets` | Present. Reports which packs and character models loaded, which were rejected, and each fighter's active clip and provenance. | `probe-boot.mjs`, `audit:roster` |
| Source-motion audit | `scripts/audit-source-motion.mjs` | Present. Reads raw GLB/glTF accessors and flags named-but-empty, one-key, constant multi-key and non-joint-only clips before acceptance; supports explicit static-pose waivers and JSON reports. | `npm run test:source-motion` |
| Transition policy | `public/js/anim/transition_policy.js` | Present. Clip-family crossfade choices and gait-phase transfer, shared by both action owners. | `npm run test:animation` (272 checks), live Sage probe |
| Additive face + weapon overlays | `public/js/anim/animation_overlays.js` | Present. Shared post-mixer pass for head/neck and optional facial geometry, jaw/morph channels, plus local weapon grip sway, brace and recoil. It never widens a body-mask lane and never moves the hand bone. | `npm run test:animation`, `scripts/verify-animation-overlays.mjs` |

### Shared transition policy (2026-11-11)

`human_fighter.js` (imported/baked clip bodies) and `AnimationController` (bodies without a clip
library) now make the same transition decision through `resolveTransition()`. The policy classifies
clip names into semantic families, chooses a fade appropriate to the incoming family, and records
the decision on the body:

| Transition | Result |
| --- | --- |
| idle → run | live Sage: gait fade `0.13 s`, no phase copy |
| run → walk | live Sage: gait fade `0.13 s`, `syncPhase: true` at the outgoing cycle phase |
| idle → hit | live Sage: reaction fade `0.045 s` |
| hit → idle | live Sage: idle fade `0.16 s` |
| attack | node policy check: target-family fade `0.055 s`; live attack was not re-captured in this pass |

Gait-to-gait transitions copy the normalized cycle position instead of resetting the incoming
clip to frame zero. The decision is exposed as `model.userData.lastAnimationTransition` and the last
16 events as `animationTransitions`; the clip controller exposes `describe().lastTransition`.

The live gait probe paused simulation for one frame so physics could not overwrite the configured
speed; the same mixer, state selection and clip actions ran. This is whole-body transition work.

### Upper/lower body masks (2026-11-11)

`body_mask.js` filters a clip's quaternion tracks into disjoint **upper** (spine, torso, neck,
head, clavicles, arms, forearms, hands) and **lower** (pelvis, thighs, shins, feet) views. Both
actions still run through the normal `AnimationMixer`, so this is real skeletal animation rather
than a shader or material trick. A mask with no matching tracks returns `null` and the caller falls
back to a whole-body action.

| State | Lower lane | Upper lane |
| --- | --- | --- |
| Walk + guard | `walk` lower | `block` upper |
| Walk + punch | `walk` lower | authored/imported strike upper |
| Kick | fighting stance upper | kick lower |
| Hit, knockdown, air, flight, dodge, specials | full-body action | none |

The controller and the legacy imported-body mixer both use the split. The first live probe had
Naruto on the legacy imported-body mixer for both captures; the guard layered as
`walk__lower + block__upper` and the punch as `walk__lower + authored_light1__upper`. Because
Naruto ships 49 baked clips, that run is **legacy-mixer evidence**, not controller evidence.
Its live check was **14/14** with no page errors or failed asset requests. Evidence:
`artifacts/body-mask/01-walk-guard.png`, `02-punch-walk.png`, `03-full-body.png`, `report.json`
and `run.log`.

A separate live probe on **Superman** is the controller-owned proof. The mounted body is
`/models/characters/superman/superman.glb`: a skeleton with **0 baked clips** and **19/19** canonical
roles, so `attachAnimation()` gives the rig to `AnimationController`. The recorded owner was
`controller` at boot, walk+guard, walk+punch and release; the layers were `walk__lower +
block__upper` and `walk__lower + jab__upper`, with disjoint masks (7 + 12 bones) and both weights
at 1.0. The live check was **17/17** with no page errors or failed asset requests. The frame capture
hides Superman's correctly hand-mounted solar-impact gauntlet, which otherwise covers the face in
the guard/idle stance; the game's equipment state is unchanged. Evidence:
`artifacts/body-mask/superman/01-walk-guard.png`, `02-punch-walk.png`, `03-full-body.png`,
`report.json` and `run.log`.

### Selectable-roster guard/attack sweep (2026-11-11)

`scripts/verify-roster-body-mask.mjs` drove all **38 launch identities exposed by character select**
through the real match path. Each row was selected in a live match, walked for 0.8 s with guard
held, then punched while still walking; the script recorded owner, clip layers, masks, weights and
bone counts, and captured both frames. The 22 archive/DLC identities are not included because
`applyFighterSelection()` rejects anyone outside the selectable launch roster.

**32/38 pass both states, 32/38 guard, 36/38 attack.** The owner split is three controller-owned
bodies (Superman, Doctor Strange and Goku) and 35 legacy-mixer bodies. All 76 frames exist and no
asset request failed. Evidence: `artifacts/body-mask/roster/sheet.png`, `sheet.html`, `report.json`
and `<slug>/{guard,attack}.png`.

The six guard exceptions are measured action gaps, not skipped rows:

- **Infantry, Hulk and The Flash** do produce disjoint masks, but the upper lane falls back to
  `run__upper`, `idle__upper` and `strafeLeft__upper` respectively. These bodies expose no legacy
  `blockAction`, so the split is real but the pose is not a guard.
- **Green Lantern and Aquaman** have no live walk+block or walk+strike pair, so neither state can
  form a mask. Both also fail the attack check; their frames remain whole-body.
- **Goku** is controller-owned and walking, but the live controller exposes no guard layer. His
  `walk + jab` attack split passes, so this is specific to the guard lane rather than the whole
  controller.

The controller probe also exposed a real fallback gap: Superman's resolved move id `light1` is not
a controller clip key, so `attackClipId()` returned no clip and the controller left both lanes
torn down. It now falls through to the style/combo selection (`jab`), with a regression check in
the Node suite. The Node suite is **272 checks** and exercises `walk + jab`, `walk + block` and the
reversed kick split directly.

The roster sweep above deliberately measures only upper/lower mask composition; it does not add
finger overlays or fabricate tracks a clip does not carry. The additive face/weapon pass documented
below leaves every one of these 32/38 mask results unchanged. The 22 archive/DLC identities remain
outside character select and outside this matrix.

### Additive face and weapon overlays (2026-11-11)

`public/js/anim/animation_overlays.js` is the shared post-mixer pass. `AnimationController.update()`
calls it after `_applyPersonality()`; the legacy imported-body mixer calls it after
`applyFingerFist()` and grounding. Both calls happen after the mask lanes are written, so the
overlay cannot widen, replace or steal either lane. It snapshots local transforms and restores them
through `resetAnimationOverlays()`, which runs on controller disposal and on body replacement.

| Channel | Driven additively | Asset contract and limit |
| --- | --- | --- |
| Face | Head/neck gaze, pitch and roll, a deterministic blink, optional `fighter-brow`, `fighter-mouth` and `fighter-eye-*` meshes, optional jaw/brow bones and mouth/eye/brow morph targets. | Head/neck work whenever the rig exposes them. Brow/mouth/eye geometry, jaw and morphs only work where the body authors them; the shipped imported Goku is a single textured face with no separate brow/mouth nodes, so its live motion is head/neck gaze, not a deforming mouth. No face geometry is fabricated. |
| Weapon | Local sway, guard brace and attack recoil around each equipped right-hand, left-hand or pickup grip. | The hand bone is never moved; `syncEquippedWeapons()` still places the holder. Stowed or faded-out props are skipped and keep their authored transform. |

The face effort rises with attacks, guard, hitstun and speed; the blink is deterministic. Weapon
pulses restart on a new attack key and decay, while guard adds a brace offset. These are local-space
offsets over the body clip, not a second mixer or a replacement pose.

`scripts/verify-animation-overlays.mjs` passed **14/14** live checks with no page errors and no
failed asset requests:

- Goku's `Goku_Idle__lower + Goku_Jab__upper` attack kept both mask lanes while the head/neck face
  channel recorded weight `0.978` and effort `0.80`.
- Superman's controller-owned `fighting_idle__lower + block__upper` guard kept a visible solar
  gauntlet; the live grip offset was `0.0316 rad` / `0.0136 m`, and attack recoil reached `0.65`.
- Wonder Woman's legacy `idle__lower + block__upper` guard kept the sword and shield; the legacy
  sword grip also received `0.0316 rad` / `0.0136 m` of additive offset.

Evidence: `artifacts/animation-overlays/report.json` plus the six `goku-face-*`,
`superman-weapon-*` and `wonder-woman-weapon-*` frames. The Node suite is **272 checks** and
includes a synthetic brow/mouth/eye rig, controller mask coexistence, reset/idempotency and a
weapon-grip check. Finger animation is still not implemented.

**Nothing above is a stub.** The mixer, retargeting, peak alignment, form surfaces and the leg rig
all run in the live game.

## 2. How the pipeline is verified without a character asset

`scripts/make-rig-fixture.mjs` generates `public/models/characters/_fixture/rig-test.glb`: a
skinned GLB with **eleven Mixamo-named joints**, a skinned mesh and two clips. It is original
geometry authored by this project (no third-party licence applies), it is **not registered in the
character manifest**, and it exists so the pipeline is tested against a real skinned glTF rather
than mocks. `npm run test:animation` loads it through `GLTFLoader` and asserts that:

- the mesh is a real `SkinnedMesh` with an 11-bone skeleton reachable from the scene,
- `resolveRig()` binds all eleven canonical bones (`kind: 'bone'`, `missing: []`),
- `retargetClip()` rewrites an external clip onto `bs_*` bones and drops root motion,
- the 39-clip library compiles against that skeleton and the controller really rotates bones,
- an attack clip is retimed to the move's active window, and hitstun owns the body while it lasts,
- a model with no skeleton refuses the clip layer instead of throwing.

Regenerate it with `npm run make:rig-fixture`.

## 3. What is *not* there

- **No downloaded animation pack is installed.** `public/data/animation-manifest.json` lists one
  pack, `mixamo-humanoid-core`, with `"status": "not-supplied"` and `"enabled": false`. Its file
  (`public/models/animations/mixamo-humanoid-core.glb`) does not exist.
- **No hand-authored attack or ultimate clips.** Attack motion is generated by `clip_library.js`
  from the move's phase. It is procedural motion, not motion capture, and is not claimed to be.
- **No alternate meshes.** A form retints and re-shapes surfaces the body already has (Goku's
  hair meshes go gold and lift, Iron Man's reactor disc goes white-hot, Iron Spider's appendage
  materials heat up). There is no second head, no replacement skin, and no model swap.
- **Iron Spider's source-backed body is now enabled** with the repaired native arm; see
  `docs/IRON_SPIDER_INTEGRATION.md`. Remaining imported-body work for Goku and Iron Man is tracked
  separately.
- **No victory or defeat clip** in the library; the KO clip covers the end of a round.
- **No finger additive overlays, and no fabricated face geometry.** The additive face/weapon pass
  exists; on imported Goku the live face channel is head/neck gaze because the asset has no separate
  brow/mouth meshes. Sculpted or face-rigged bodies can drive the optional geometry, jaw and morph
  channels. Secondary weapon motion is a local grip offset, not a second animation clip.
- **No articulated leg *attack* hitbox of its own size.** The sweep's damage volume is still the
  propagated shockwave arc; the legs add contact points at their real tips (see
  `docs/COMBAT_SYSTEM_REPORT.md` §27).

## 4. Exactly what to supply

### 4.1 Rigged characters

| Character | Expected path | Format | Notes |
| --- | --- | --- | --- |
| Goku | `public/models/characters/goku/Goku.fbx` + its texture set | FBX | Textures must sit beside it; the loader already applies `applyGokuTextures`. |
| Iron Man (Mark V) | `public/models/characters/iron-man-mark-v-rig/Iron Man Mark V Rig Materials.gltf` + `.bin` + textures | glTF (separate) | Every referenced file must be copied, not just the `.gltf`. |
| Iron Spider | `public/models/characters/iron_spider/iron_spider.glb` | glTF binary | Source recorded in the manifest: Sketchfab model `99e52e57a8dc4feda750af87b87d2955` by Kabiidev. |

Install with the existing installers, both of which validate before enabling:

```sh
node scripts/install-character-assets.mjs /path/to/extracted-package
node scripts/install-character-model.mjs <downloaded .glb> --identity "Iron Spider" \
  --facing 0 --attribution "<credit>" --license "<licence>" --source <model url>
```

The rig an imported model needs, for the pipeline to drive it without per-character code:

1. A skinned mesh (not a rigid hierarchy) with the mesh bound to a skeleton.
2. Bones whose names resolve through `rig_map.js` — Mixamo, Blender (`upper_arm.L`) or plain
   `LeftArm`/`LeftUpLeg` naming all work; at minimum hips, spine/chest, head and both arms and legs.
3. Authored facing +Z (or pass `--facing 180` for -Z assets, which is stored as `yawOffset`).
4. Height independent of the model: the loader normalises to the 2.05 m fighter and validates the
   result, rejecting squashed, buried or empty rigs in favour of the procedural body.
5. Embedded clips are optional. A skeleton with no clips is driven by the authored library; a rig
   with baked clips keeps its own named-action mixer.

**Licensing requirements before install**

- Goku: no permissive licence exists for the character or most fan-made rigs. Only install a model
  you can document (own work, or a licence that explicitly permits redistribution).
- Iron Man Mark V rig: record the original asset page, author and licence in
  `public/ATTRIBUTIONS.md`; Marvel character rights are not granted by a 3D model licence.
- Iron Spider (Kabiidev): **CC Attribution** — the exact version still needs confirming on the
  model page before shipping, and the credit line must be visible in the project's attributions.

### 4.2 Animation packs

Drop a single GLB containing the required clips and enable it in the manifest:

```jsonc
// public/data/animation-manifest.json
"packs": [
  {
    "id": "mixamo-humanoid-core",
    "file": "/models/animations/mixamo-humanoid-core.glb",
    "status": "installed",
    "enabled": true,
    "license": "Adobe Mixamo — free for commercial and personal use; redistribution of the raw
                clips as a standalone asset library is not permitted. Ship them inside the game
                build only after checking the current Mixamo terms.",
    "clips": { "idle": "Idle", "walk": "Walking", "run": "Running", "jab": "Punching" }
  }
]
```

Rules the loader enforces (`validationRules` in the manifest):

1. A clip id only counts as external once a real file on disk supplies it; `HEAD` is checked
   before the engine loads it.
2. The source skeleton and target skeleton must be recorded.
3. Name, duration, scale and root-motion behaviour must be confirmed.
4. Retarget only after compatibility is verified; otherwise the procedural clip stays.
5. Never label hand-authored keyframes as motion capture.

A one-shot clip is retimed so its strike peak lands on the move's active frame — if a supplied
clip's contact moment is wrong, the timing is what breaks, not the damage.

## 5. What a supplied pack actually changes

1. `bootstrapAnimationPacks()` loads the pack and calls `setExternalClips()` on every fighter.
2. `AnimationController` prefers the external clip for that id, keeping the procedural one as the
   fallback for ids the pack does not cover.
3. The mixer cross-fades between states as it already does; combat state stays authoritative — a
   missing or broken animation can never stall the state machine.
4. `window.__browserSmashAssets.animationPacks` reports what actually loaded, so "the pack is
   installed" is verifiable rather than assumed.
