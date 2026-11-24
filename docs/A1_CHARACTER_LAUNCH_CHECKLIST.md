# Browser Bros — A1 character-level launch acceptance standard

Date: **2026-11-12**  
Applies to: every fighter in the 38-identity launch roster  
Relationship to A0: **A0 is a prerequisite and is not sufficient for A1.** A passing A0 row proves
that the automated live gate ran; it does not prove that the character is visually, mechanically or
commercially ready.

## Purpose

A1 is the per-character release review. It converts the roster-wide A0 baseline into a defensible
answer for one fighter at a time:

> Is this character's production model, rig, complete animation set, movement, combat kit,
> defensive states, transformations, match outcomes and runtime presentation ready to ship?

The standard is deliberately explicit about the difference between **implemented**, **automated-test
verified**, **live-browser verified** and **fully accepted**. A feature that exists in code but has
never moved the mounted production body is not verified. A software-rendered screenshot is not
hardware acceptance. A passing A0 row is not a full launch sign-off.

## Evidence classes

Record one class for every requirement, not a single class for the whole fighter.

| Class | Meaning | Minimum evidence |
|---|---|---|
| **Implemented** | Code, clip, asset and wiring exist in the working tree. | Source reference plus a static/asset inspection. |
| **Automated-test verified** | A repeatable harness exercises the real game page and asserts the live result. | Command, exit status, JSON/log, pass count and failures. |
| **Live-browser verified** | The production body was observed in the running game through the real select and match path. | Named screenshots or live probe output tied to the exact build. |
| **Hardware accepted** | The same evidence was captured on a hardware GPU at the target frame-rate and visual quality. | Hardware/renderer identification, capture log and screenshots. Runbook: [`docs/HARDWARE_GPU_ACCEPTANCE.md`](HARDWARE_GPU_ACCEPTANCE.md). |
| **Fully accepted** | Every applicable A1 criterion is verified at the required evidence class, with no open blocker, and the row is explicitly signed off. | Complete evidence index and a written sign-off decision. |

Rules:

1. **SwiftShader is software rendering.** It may support automated and live-browser software
   evidence, but it must never be recorded as hardware acceptance. The hardware run is gated by
   `scripts/probe-hardware-gpu.mjs` and documented in `docs/HARDWARE_GPU_ACCEPTANCE.md`.
2. **A clip count is not animation coverage.** Each required clip must move the mounted skeleton in
   the real state that selects it.
3. **A selected state is not contact.** Attacks, abilities and projectiles must show the expected
   damage, hit reaction, displacement, guard interaction and cleanup.
4. **A match result is not a rematch.** KO, victory, defeat, round transition, best-of-three and
   rematch are separate checks.
5. **Do not fabricate missing source motion.** If a source clip has no usable body motion, record the
   asset defect and keep the row partial rather than hiding it with a fallback pose.
6. **Do not replace the production body with a fallback** to make a test pass. Preserve the identity's
   model, skeleton, proportions, equipment and authored clips.
7. **Do not weaken a passing A0 test** to admit an A1 regression. Fix the cause or record the
   regression as an open blocker.

## The ten A1 criteria

Every launch fighter is reviewed against all ten. A criterion is marked `N/A` only with a written
reason (for example, a fighter with no transformation system).

### 1. Production model quality and identity

- The promoted production GLB is the selected body in a live match, not a procedural placeholder.
- Textures, materials, face/eyes and identity-specific details render without flat, missing or
  incorrectly mapped surfaces.
- The body is the intended character; name, silhouette, colours and signature features match the
  approved identity.
- No detached, floating, intersecting or incorrectly scaled equipment or body parts.

Evidence: select-screen capture, mounted-body capture, material/texture inspection, identity note.

### 2. Character-relative proportions

- Mounted height and body bounds agree with the identity profile within the accepted tolerance.
- Feet are grounded; the head, hands and equipment are in proportion to the body.
- Height normalisation does not distort the model or break contact points.
- Equipment extents are excluded from body-height validation where appropriate.

Evidence: runtime height/feet assertion, body-bounds JSON, front/side capture.

### 3. Skeleton and rig integrity

- The production skeleton resolves the required bones; the rig report has no unresolved required
  tracks.
- The mounted mesh deforms, with no frozen bind pose, collapsed joints or detached limbs.
- Facial or auxiliary rigs (eyes, jaw, fingers, mechanical arms) behave as declared.
- The clip owner is singular: no second mixer overwrites the same bones on the same frame.

Evidence: rig map report, bone count, live pose samples at multiple times, joint-position probe.

### 4. Complete animation coverage

- Idle, locomotion, jump/fall/land, hit reactions, knockdown/get-up, guard, dodge, victory and
  defeat have usable clips or a deliberately validated shared lane.
- Every declared attack slot, special, ability, ultimate and transformation clip is bound to the
  production body.
- The required state selects the expected clip in a live match; a clip that exists but is never
  selected fails.
- Transition, cleanup and return-to-control are verified, including interruption by hitstun and KO.

Evidence: clip inventory, state matrix, live state-selection probe, transition log.

### 5. Ground and aerial movement

- Idle, walk, run and sprint are reachable through real input and visibly animate.
- Jump takeoff, airborne/fall, landing and recovery are all observed, with the body grounded again.
- Turning, acceleration, braking and air control preserve facing and do not snap the model.
- Flight or web-swing movement, where applicable, has its own authored pose and clean entry/exit.

Evidence: keyboard-driven live probe, clip names and grounded/velocity samples, captures.

### 6. Character-specific attacks and abilities

- The complete light chain (including finishers), heavy, aerial, anti-air/dive, grab and throw are
  reachable and deal real damage.
- Signature special and kit abilities play their authored presentation and produce the declared
  projectile, contact, displacement, stun or guard interaction.
- Projectile origins come from the correct hand/weapon/equipment anchor, not a generic world point.
- Cooldowns, resource costs and control return are correct; no cast is silently swallowed or left
  locked.
- Equipment used by the move is attached and positioned correctly for the whole action.

Evidence: live match probe with damage/contact traces, projectile-origin sample, captures.

### 7. Defensive mechanics

- Guard is reachable and reduces or blocks the declared damage; shield/guard meter behaviour is
  correct.
- Parry has a real window and a visible read; dodge has invulnerability/positioning as declared.
- Counter strike, guard break and guard stun resolve and return control.
- Light hit, heavy hit, launch, knockdown, landing and get-up are distinct where the kit declares
  them.
- Unforced knockdown evidence is supplemental until it is reliable for the whole roster; forced
  state checks must not be presented as unforced collision evidence.

Evidence: guard/parry/dodge probe, damage comparison, state trace, unforced collision log if run.

### 8. Transformations and ultimate

- The transformation or form is a real state change with the declared cost, duration, visuals and
  stat/ability effect.
- The activation clip plays on the production body and the form's locomotion/combat presentation is
  coherent.
- The ultimate spends the correct resource, plays its authored sequence, lands its full damage or
  effect chain, and returns control.
- No ultimate or form leaves the body in a generic beam/idle pose, a frozen action or a second
  animation owner.
- Restore/exit behaviour is verified, including KO or match end during the state.

Evidence: state transition trace, clip names, damage chain, resource values, before/after captures.

### 9. KO, victory, defeat and rematch

- A real KO selects the correct victory and defeat presentations for both fighters.
- Round win/loss, match win/loss and the results text are correct.
- A complete best-of-three reaches the declared round count and winner.
- Rematch resets health, meter, positions, states, projectiles and animation owners; the next match
  is playable.
- No stale pose, frozen input, duplicate result or lingering VFX survives the transition.

Evidence: match-result JSON, wins array, results text, rematch capture and post-rematch live state.

### 10. Visual, audio and runtime integrity

- No page errors, uncaught exceptions or failed asset requests during select, match and rematch.
- Frame pacing and rendering are acceptable for the evidence class; software results are labelled.
- Camera framing, lighting, shadows, transparency and VFX do not hide the character or break the
  silhouette.
- Audio cues, if declared, are present and correctly triggered; missing audio is an explicit gap.
- Input latency, hit-stop and cinematic timing do not prevent control return.
- Runtime cleanup releases mixers, controllers, materials and projectiles without leaks or stale
  listeners.

Evidence: console/network log, performance capture, audio check, cleanup/disposal inspection.

## Per-fighter record format

Use this shape in `artifacts/launch-acceptance/a1-status.json` and the master documents:

```yaml
fighter: <stable identity key>
model: <production body + source>
rig: <bone count / rig family>
criteria:
  model_identity: implemented | automated | live | hardware | accepted | N/A
  proportions: ...
  rig_integrity: ...
  animation_coverage: ...
  ground_air_movement: ...
  attacks_abilities: ...
  defence: ...
  transformation_ultimate: ...
  match_outcomes: ...
  runtime_integrity: ...
evidence:
  commands: []
  artifacts: []
open_requirements: []
status: partial | software_pass | hardware_pass | fully_accepted
```

`status: software_pass` means every applicable criterion has automated and live software evidence
and no known software blocker. It still requires hardware acceptance and explicit sign-off before
`fully_accepted`.

## Sign-off rule

A fighter may be marked **fully accepted** only when:

1. All ten criteria are satisfied or explicitly `N/A` with a reason.
2. The evidence index is complete and reproducible.
3. Hardware acceptance has been captured on the target renderer, not inferred from software.
4. No open blocker remains in the per-fighter record.
5. The sign-off is written into the master records with the date and evidence revision.

Until then the correct labels are **A0 PASS**, **A1 SOFTWARE PASS**, **A1 PARTIAL** or
**A1 BLOCKED**. None of those labels means the character is finished.

## Current application

This standard is applied first to Goku, Spider-Man / Miles Morales, Iron Spider, Naruto Uzumaki,
Vegeta and T-800. Results and exact remaining requirements are maintained in
`docs/LAUNCH_ROSTER_ACCEPTANCE.md`, `docs/PRODUCTION_ROADMAP.md`,
`docs/ROSTER_INTEGRATION_PROGRESS.md` and `artifacts/launch-acceptance/a1-status.json`. The remaining
32 launch fighters stay visible in the A1 queue; completing the first six does not complete the
roster.
