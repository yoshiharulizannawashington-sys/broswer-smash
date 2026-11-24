# Attack animation production plan

Status: **plan only.** No new clips are claimed here. The audit below is the measured starting
point; the stages list what must exist before any of them can be called differentiated animation.

## Measured starting point

`node scripts/audit-animation-coverage.mjs` (writes `artifacts/audits/animation-coverage.json`):

| Measure | Value |
| --- | --- |
| Roster models audited | 58 |
| Roster identities with a moveset and ability kit | 38 |
| Average clips per model | 25 |
| Moves needing presentation | 378 (11.1 per identity) |
| Distinct attack clips per fighter | 3 (`air_attack`, `heavy_punch`, plus one light/punch clip) |
| Fighters with 5+ distinct attack clips | **0** |
| Locomotion / defence / reaction coverage | 58/58 for idle, walk, run, jump, fall, land, block, dodge, hurt, ko, victory, transform, throw, special |

So the rigs and the capability set are complete; what is missing is **horizontal** variety inside
combat. Every light step, heavy and aerial draw from three shared clips, which is why fighters read
as recolours in motion even though their models, stats, dialogue and effects differ.

## What already exists and must be reused

- Rigs: `public/models/characters/roster/*.glb`, each with the same 25-clip capability skeleton and a
  11-bone minimum (one prefab binds 19).
- Clip loading and playback: `public/js/anim/clip_library.js`, `public/js/anim/animation_loader.js`.
- Move → clip resolution: `public/js/fighter3D.js` (`applyAttackMotion`, `lightLabelFor`,
  `heavyLabelFor`), `public/js/combat/movesets.js` (`lights`, `heavy`, `forms`, `ultimate`).
- Authoring: `assets/blender/character_animation_bake.py` (procedural starter clips),
  `assets/blender/CHARACTER_ANIMATION_PIPELINE.md`.
- Form overlays: `public/js/anim/form_costume.js` (bone-anchored, verified 38/38).

Nothing in the plan replaces a rig, a clip name that already works, or a control path.

## Stage 1 — Name the vocabulary before authoring (no visual change)

1. Fix a combat clip vocabulary: `light_1..light_5`, `heavy_1..heavy_3`, `air_attack`,
   `signature_<identity>`, `ultimate_<identity>`, `form_<form>`.
2. Extend `clip_library.js` to expose these names per identity and make `fighter3D` resolve
   light steps by index (1–5) rather than by a single fallback clip.
3. Add a validation gate that fails when a moveset references a clip the GLB does not contain.
   Today `heavyLabelFor`/`lightLabelFor` fall back silently to the same three clips.
4. Report coverage per identity (not per roster) so partial work is visible.

Exit criteria: the audit reports 3 → 8+ distinct attack clips for one pilot identity, with the
loader proving each is addressable, and the fallback still renders if a clip is missing.

## Stage 2 — One pilot fighter, authored by hand

Pick **Naruto Uzumaki** (already has form and Rasenshuriken presentation, and a verified costume
rig). Author five lights, three heavies, one air attack, signature and ultimate in Blender through
`character_animation_bake.py`, with hand-tuned key poses rather than randomised sine motion.

Retarget to every other rig first in a measurement-only pass (`scripts/blender_retarget_kaykit.py`
exists): report per-bone error, foot drift, and hand-to-weapon offset. Do not accept a retarget that
moves the root or breaks the guard pose.

Exit criteria: pilot plays 10 distinct attack clips in-game at gameplay distance, with a capture
sheet (front/side/gameplay) and no foot sliding beyond the locomotion tolerance.

## Stage 3 — Archetypes with identity, not clones

Group the roster into 5–6 motion archetypes by body type and weapon: brawler, weapon-two-hand,
weapon-one-hand, caster, ninja/agile, huge. Author the clip set once per archetype, then add a
per-identity **flourish layer** that is character-visible:

- weapon-specific start/end poses (trident, hammer, sword, ring constructs),
- cape/coat follow-through,
- caster release pose vs melee follow-through,
- form variants where the costume already exists (`form_costume.js`).

Exit criteria: two fighters of the same archetype are visibly distinguishable at gameplay distance
from silhouette alone in a side-by-side capture.

## Stage 4 — Ultimate choreography

Ultimates currently reuse attack clips plus VFX. Give each identity an ultimate clip with a wind-up,
a hold, and a recovery that matches the damage window in `movesets.js`. This is where the
per-identity budget should go after Stage 3, not more lights.

## Stage 5 — Rollout and budget

- Per model: 25 existing + 11 new clips ≈ 36; keep clip count under 40 and each clip under 2 s to
  protect load time and memory on integrated GPUs.
- Load clips on demand per match, not for the whole roster (`animation_loader.js` already loads per
  character).
- Keep the three-clip fallback forever: a missing clip must never leave a fighter frozen.

## Verification required for every stage

1. `node scripts/audit-animation-coverage.mjs` — distinct attack clips per identity.
2. `npm run test:animation` and `npm run test:animation-coverage`.
3. `npm run test:combat` (489 checks) — movesets still deal the damage they declare.
4. Gameplay-distance captures of two different fighters mid-combo, inspected by eye.
5. No hardware performance claim: this VM renders through SwiftShader.

## What this plan explicitly does not do

- It does not generate hundreds of placeholder clips and count filenames as animation.
- It does not make every fighter share one clip set and call it differentiated.
- It does not touch Green Lantern's mask, ring or gloves, or any verified rig, to save authoring time.
