# Phase 23 — rig audit and animation quality plan

Written after measuring the actual code, not from intent. Numbers below are from
`public/js/anim/rig_map.js`, `public/js/models.js`, `public/js/characters/sculpted.js`,
`scripts/make-rig-fixture.mjs` and the tests named next to each claim.

## 1. What the rig is today (measured)

| Path | Joints | Drivable by clips | Evidence |
| --- | --- | --- | --- |
| Canonical contract | **19** = 11 core + 8 extensions | yes | `rig_map.js` `CANONICAL_BONES` |
| Core joints | pelvis, torso, head, 2×(arm, forearm), 2×(thigh, shin) | yes | `npm run test:animation` |
| Extension joints | spine, 2× clavicle, neck, 2× wrist, 2× ankle | yes, since Phase 23 step 1 | `npm run test:rig-architecture` binds 19/19 |
| Sculpted bodies (Goku, Iron Man, Iron Spider) | 19 driven joints + static finger/thumb/toe meshes | yes | `artifacts/dev/probe-rig16.mjs` |
| Prefab bodies (`models.js`) | 19 articulation points, end geometry on forearm/shin | yes (wrist/ankle points carry no geometry) | `npm run test:rig` |
| Rig capability layer | per-role groups + character-owned specialized rigs | n/a | `public/js/anim/rig_profile.js`, `npm run test:rig-architecture` |
| Blender roster GLBs | 19-bone armature, 8 baked clips each | via their own named-action mixer, not the library | `docs/ANIMATION_PIPELINE_READINESS.md` |

### What step 1 changed

Before: the clips bound 11 bones. The authored bodies already **built** a neck, a wrist per arm
and an ankle per leg, and `sculpted.js` already published `leftHand`/`rightHand`/`leftFoot`/
`rightFoot` on `userData` — but `rig_map.js` had no key for them and its bone classifier
explicitly returned `null` for anything called a hand or foot. So a Kamehameha pose could not angle
a wrist, and no walk cycle could roll a foot. Those joints now bind, and every stance in
`clip_library.js` poses them, including heel/toe attitude in the fight stance and toe-point in
flight.

### What is still missing for AAA body mechanics

| Gap | Why it blocks AAA motion | What it needs |
| --- | --- | --- |
| **No spine chain** | Weight transfer, back arch, twist and slump are single-segment. A punch cannot rotate the chest ahead of the hips. | 2–3 spine segments between pelvis and chest, in `buildSkeleton` and the prefab builder |
| **No clavicles** | Shoulder roll and shrug are impossible; punches read as arm-only. | clavicle joint per side between torso and arm |
| **Fingers are static children** | Grips, open-palm Kamehameha, repulsor palm and weapon holds cannot articulate. | per-finger joints, or a hand bone with a pre-authored fist/open blend |
| **No facial rig** | No brow, jaw or eye motion, so taunts and victory poses stay body-only. | blendshape or bone-driven face, plus a controller track |
| **No IK** | Feet are posed forward-kinematically, so contact is approximate and foot slide is bounded only by cadence matching. | two-bone leg IK with foot targets from gameplay ground contact |
| **No root motion** | Downloadable clips have translation stripped; position is gameplay-owned. | a root-motion channel that gameplay consumes rather than a translation track that fights physics |
| **Authored keys, not mocap** | Timing and overlap are hand-set at 30 fps, so nothing has real capture nuance. | a licensed mocap pack (Mixamo/Sketchfab) installed through `animation_loader.js` |

## 2. The honest ceiling of the current path

The 34 fighters share one authored clip library. Per-identity style (`motion_style.js`) changes
cadence, sway, bounce, stride, arm opposition and turn banking on top of those clips. That makes
bodies read as different characters, but it cannot make a move that does not exist: no clip library
entry for a Kamehameha stance, an axe swing, a web pull or a repulsor release means the pose has to
be built, not styled. **Character-specific combat animation is therefore authoring work per move,
not another modifier layer.**

## 3. Staged plan, Goku and Iron Man first

The user's instruction is to perfect two characters before touching the other 32. Acceptance for
each stage is listed with its evidence, because "it compiled" is not evidence of animation quality.

### Stage 1 — rig (in progress)
- [x] Bind neck, wrists and ankles; pose them in every clip stance.
- [x] One spine joint + clavicles in `sculpted.js` and the prefab builder: chest arches mid-spine,
  shoulders roll independently of it, and world offsets are preserved so existing poses are unchanged.
- [x] Declarative capability layer so the shared interface is not a ceiling: per-role bone groups,
  identity/archetype rig profiles, and character-owned specialized rigs (Iron Spider's appendages).
- [ ] More spine segments (chest/abdomen split) once the geometry can be weighted to them.
- [ ] Foot IK against gameplay ground contact.
- Evidence: `npm run test:animation`, `npm run validate:animations`, `artifacts/dev/probe-rig16.mjs`,
  and a visual check of front/side/rear/close-up views.

### Stage 2 — Goku and Iron Man, character-specific motion
- Goku: martial-arts stance set, chain-combo poses, Kamehameha charge/release, Instant Transmission
  recovery, Saiyan flight posture.
- Iron Man: armoured weight, repulsor palm/release, thruster hover and boost, landing absorption,
  suit-servo idle.
- New library clips, not renamed generic ones. Evidence: per-move clip ids listed in
  `docs/ANIMATION_ASSETS.md`, plus strike-peak alignment asserted against the move's active window.

### Stage 3 — combat animation depth
- Directional light/heavy attacks, parry, dodge, grab/throw, hit reactions, stagger, knockback,
  knockdown/recovery, air combo and flight combat transitions, with crossfade and foot-contact rules.
- Evidence: state matrix in `docs/COMBAT_TEST_MATRIX.md` plus browser captures.

### Stage 4 — aerial and flight
- Take-off, hover, dive, air combo, aerial dodge, knockback recovery, landing absorption.

### Stage 5 — cinematics
- Per-character intro, victory, defeat and taunt clips. **Also resolves the 2 known failures**:
  `validate:animations` reports `manifest has no orphan clip victory` / `defeat` because the clips
  exist in `clip_library.js` but are missing from `public/data/animation-manifest.json`. Either add
  them to the manifest or remove them from the library — this plan adds them.

### Stage 6 — roster rollout and visual verification
Only after Goku and Iron Man hold the standard. Verification must be visual (front, side, rear,
close-up, full-body movement, combat transitions, weapon attachment, flight) with captured
evidence; node tests alone do not satisfy this.

## 4. Known blockers, stated plainly

- **No browser driver in this VM.** `playwright`/`puppeteer` are not installed, so browser tests
  (`npm run test:smoke`, `audit:roster`) and any screenshot evidence cannot run here until a driver
  and Chromium are installed.
- **No Blender.** Rebuilding geometry (spine, clavicles, fingers, face) cannot be done here; the
  JS-side skeleton can gain segments, but the meshes that skin to them must be authored.
- **No licensed character assets.** `public/models/characters/goku/Goku.fbx` and the Iron Man glTF
  are absent; the roster entries stay disabled and the authored bodies stand in.
- **The `victory`/`defeat` orphan failure is pre-existing** and unchanged by this work; it is
  reported separately, never counted as resolved.
