# Hardware-GPU result verification checklist — Hulk, Aquaman and The Flash

Use this checklist only when a run has been made on the target physical GPU with the current
working tree. It validates the **targeted A1-trio summary and its three reports**:

| Role | Expected path |
| --- | --- |
| Machine-readable summary | `artifacts/hardware-gpu/summary-hulk-a1-aquaman-a1-the-flash-a1.json` |
| Renderer preflight | `artifacts/hardware-gpu/preflight.json` |
| Preflight screenshot | `artifacts/hardware-gpu/preflight.png` |
| Hulk report | `artifacts/a1-combat/hulk/report.json` |
| Aquaman report | `artifacts/a1-combat/aquaman/report.json` |
| The Flash report | `artifacts/a1-combat/the-flash/report.json` |
| Hulk result frame | `artifacts/a1-combat/hulk/11-victory-ko-during-form.png` |
| Aquaman result frame | `artifacts/a1-combat/aquaman/11-victory-ko-during-form.png` |
| The Flash result frame | `artifacts/a1-combat/the-flash/11-victory-ko-during-form.png` |

A full nine-fighter run writes `artifacts/hardware-gpu/summary.json` instead of the targeted
summary. The same checks apply to its three A1 suite entries.

**Current status: no hardware result exists.** The checked-in summary and preflight were produced
on SwiftShader, the preflight failed, and no fighter suite launched. Do not mark any box below from
the current software captures, from an old report, or from a copied/renamed JSON file. A SwiftShader
run is never hardware acceptance.

## 0. Run identity and command

Record the command that actually produced the evidence:

```sh
# Normal targeted run, headed on a real display
HARDWARE_GPU_ONLY=hulk-a1,aquaman-a1,the-flash-a1 \
  HARDWARE_GPU=1 npm run accept:hardware-gpu
```

- [ ] The command included `HARDWARE_GPU=1` and selected exactly the three A1 suites.
- [ ] The run used the intended checkout and current working tree; record `git rev-parse HEAD` and
      the dirty-worktree state.
- [ ] The operator recorded the run date/time in UTC, machine or cloud host, physical GPU model,
      driver version, browser version, display mode and operator name.
- [ ] A headed run is the default. If `HARDWARE_GPU_HEADLESS=1` was used, the host was separately
      proven to expose the physical renderer headlessly, and that proof is attached.
- [ ] No screenshot, JSON file, report or summary was copied from an earlier run. Confirm the
      `generatedAt` values and file modification times are inside the run window.

## 1. Preflight is the hard gate

Open `preflight.json` and `preflight.png` before looking at any fighter result.

### Renderer object

- [ ] `preflight.hardwareMode === true`.
- [ ] `preflight.hardwareGpu === true`.
- [ ] `preflight.softwareRenderer === false`.
- [ ] `preflight.pass === true`.
- [ ] `preflight.gpu.available === true`.
- [ ] `preflight.gpu.webgl2 === true`.
- [ ] `preflight.gpu.debugRendererInfo === true`.
- [ ] `preflight.gpu.vendor` and `preflight.gpu.unmaskedVendor` are non-empty.
- [ ] `preflight.gpu.renderer` and `preflight.gpu.unmaskedRenderer` are non-empty.
- [ ] The renderer string does **not** match
      `/swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i`.
- [ ] The renderer is the actual target GPU, not an integrated fallback or a remote/virtual
      renderer that was not the intended acceptance target.
- [ ] `gpu.version`, `gpu.shadingLanguageVersion`, `gpu.maxTextureSize`,
      `gpu.maxRenderbufferSize`, `gpu.canvas`, `gpu.viewport`, `gpu.devicePixelRatio`,
      `gpu.userAgent` and `gpu.capturedAt` are present and internally consistent.
- [ ] `preflight.launch.headless` matches the documented launch mode. A normal acceptance run
      must be headed (`false`); a headless run is accepted only with the separate host proof above.
- [ ] `preflight.launch.args` contains no SwiftShader/software-rendering opt-in.

### Preflight checks and errors

- [ ] All five `preflight.checks` are `true`: `webglContext`, `webgl2`, `debugRendererInfo`,
      `hardwareVendor`, `noPageErrors`.
- [ ] `preflight.errors` is an empty array.
- [ ] `preflight.png` exists, is larger than 1 KiB, is a nonblank live-game frame, and was captured
      at the required 1366×768 viewport for this preflight.
- [ ] The preflight log (`artifacts/hardware-gpu/logs/preflight.log`) contains no page error,
      console error, missing asset request or renderer mismatch.

**Stop here if any preflight item fails.** A suite report cannot repair a failed preflight.

## 2. Summary gate

Open the summary that belongs to this run. For a targeted run it is
`summary-hulk-a1-aquaman-a1-the-flash-a1.json`; for a full run it is `summary.json`.

- [ ] `summary.hardwareMode === true`.
- [ ] `summary.pass === true`.
- [ ] `summary.target` names the three A1 suites (`hulk-a1 + aquaman-a1 + the-flash-a1`) or is the
      full nine-fighter target whose `suites` array includes those three.
- [ ] `summary.preflight.exitCode === 0`.
- [ ] `summary.preflight.pass === true`.
- [ ] `summary.preflight.hardwareGpu === true`.
- [ ] `summary.preflight.screenshotBytes > 1024`.
- [ ] `summary.preflight.renderer` exactly equals the `preflight.gpu.renderer` string.
- [ ] `summary.headed === true` for the normal run. If `false`, the explicit headless-GPU proof is
      attached and `preflight.launch.headless === true`; otherwise this is a fail.
- [ ] `summary.suites` contains exactly one entry for each of `hulk-a1`, `aquaman-a1` and
      `the-flash-a1`; no suite is missing, duplicated, skipped or replaced.
- [ ] Every suite entry has all of:
      - `exitCode === 0`
      - `expected === 42`
      - `actual === 42`
      - `passed === true`
      - `rendererMatches === true`
      - `renderer` equal to the preflight renderer string
      - `screenshotBytes > 1024`
      - an existing `report` path and `log` path
- [ ] `summary.generatedAt` is after every suite report's `generatedAt`, and the suite logs belong
      to this run. Do not accept a summary assembled from stale reports.
- [ ] The three suite logs exist and contain `A1 COMBAT MATRIX 42/42 checks passed`, with no
      `PAGEERROR`, `CHECK FAIL`, failed request or non-zero browser-suite exit.

## 3. Three report gate

Repeat every item for Hulk, Aquaman and The Flash. The expected identities are:

| Suite | `fighter` | `identityKey` | Expected form |
| --- | --- | --- | --- |
| Hulk | `Hulk (Bruce Banner)` | `hulk_bruce_banner` | `WORLDBREAKER RAGE` |
| Aquaman | `Aquaman` | `aquaman` | `KING OF THE DEEP` |
| The Flash | `The Flash (Barry Allen)` | `the_flash_barry_allen` | `SPEED FORCE ASCENDANT` |

Exact defeat `poseClip` values: Hulk `Armature&#124;hero_hulk01_S09@die`, Aquaman `GroundDeathB`,
The Flash `defeat`.

### Hardware identity

- [ ] `report.hardwareMode === true`.
- [ ] `report.hardwareVerified === true`.
- [ ] `report.softwareRenderer === false`.
- [ ] `report.evidenceClass` contains `hardware` and does not contain `software`.
- [ ] `report.renderer` is an object with the same non-empty fields as the preflight renderer.
- [ ] `report.renderer.renderer` exactly equals `preflight.gpu.renderer`.
- [ ] `report.renderer.available === true`, `report.renderer.webgl2 === true`,
      `report.renderer.debugRendererInfo === true`.
- [ ] `report.renderer.softwareRenderer === false`.
- [ ] `report.renderer.vendor` and `report.renderer.unmaskedVendor` are non-empty.
- [ ] `report.renderer.capturedAt` is inside this run window.
- [ ] `report.generatedAt` is inside this run window and before `summary.generatedAt`.
- [ ] `report.fighter`, `report.identityKey` and `report.opponent` match the table above
      (`opponent` must be `Wonder Woman`).

### Check completion

- [ ] `report.total === 42`.
- [ ] `report.passed === 42`.
- [ ] `report.failed` is an empty array.
- [ ] `report.checks.length === 42`.
- [ ] Every check has `ok === true`.
- [ ] The seven sections are all present:
      `match` (6), `attack` (11), `defence` (10), `movement` (5), `abilities` (4), `form` (4),
      `runtime` (2).
- [ ] No check was edited, removed, renamed or skipped to obtain 42/42. Compare the check names
      with the current `scripts/verify-a1-combat-matrix.mjs`; a shortened suite is a fail.
- [ ] `report.errors` is an empty array.
- [ ] `report.failedRequests` is an empty array.
- [ ] The 14 capture paths in `report.captures` all exist, are unique, are named
      `01-light-chain.png` through `14-rematch-after-defeat.png`, are larger than 1 KiB, and are
      1280×800 PNGs.

### Form and KO evidence in the report

- [ ] `report.observations.formKO.activated.id` and `.label` match the expected form in the table.
- [ ] `beforeFight` and `preFinal.form` both show the form still active before the final hit.
- [ ] `formKO.result.text` is the exact victory headline:
      `VICTORY · HULK (BRUCE BANNER)`, `VICTORY · AQUAMAN`, or
      `VICTORY · THE FLASH (BARRY ALLEN)`.
- [ ] `formKO.result.winner === "p1"`.
- [ ] `formKO.callouts` contains the KO form-ending callout:
      `WORLDBREAKER RAGE ENDED`, `KING OF THE DEEP ENDED`, or
      `SPEED FORCE ASCENDANT ENDED`.
- [ ] The KO trace ends `status: "match-over"` with the target at or above 150% and `form: null`.
      Do not accept a natural `... FADED` or `... DRAINED` exit as the KO form-ending event.
- [ ] `report.observations.defeat.poseClip` is the expected grounded defeat clip in the table.
- [ ] The defeat result is `DEFEAT · WONDER WOMAN` with `winner: "p2"`.
- [ ] Both rematch checks record a fresh round 1, wins `[0, 0]`, both fighters at 0%, no result
      text, and the form cleared.

## 4. Visual review of every screenshot

The runner's summary only checks that one result screenshot exists. That is not enough for
acceptance: the runbook requires a human to review every screenshot. For this targeted run that is
**126 A1 captures** (14 × 3) plus `preflight.png`.

### Required minimum before signing

- [ ] `preflight.png` shows the live game, not a blank canvas, loading screen or unrelated page.
- [ ] Each fighter's `11-victory-ko-during-form.png` shows the correct fighter's result headline and
      a result panel that is actually on screen.
- [ ] Each fighter's `13-defeat.png` shows `DEFEAT · WONDER WOMAN`, not a frozen hit reaction or a
      blank frame.
- [ ] Each fighter's `12-rematch.png` and `14-rematch-after-defeat.png` show a fresh round at 0–0
      and 0%.
- [ ] All 14 frames for all three fighters are nonblank, show the correct body and costume, and
      show no T-pose, detached model, missing HUD or missing result panel.
- [ ] The grab/throw frames show Wonder Woman's sword and shield following the body; no separate
      equipment block is visible.
- [ ] Effect-heavy ultimate/form frames are readable enough to identify the fighters and HUD.
      A translucent effect that partially covers a body is a composition note, not a blank-frame
      pass if the state is genuinely visible.
- [ ] The result screenshot may not show the `... ENDED` callout because the result panel covers
      it. In that case the report's `formKO.callouts` is the direct callout evidence and the
      screenshot is the result-state evidence. Do not claim the screenshot proves the callout.
- [ ] Any screenshot that fails the claimed state is a fail, even if all JSON checks are true.
      Preserve it as a failed artifact; never replace it with a screenshot from another run.

### Frame-by-frame reference

| Frame | What to verify |
| --- | --- |
| `01-light-chain.png` | Light string and combo finisher/HUD; both bodies intact |
| `02-heavy.png` | Selected heavy pose and target reaction; no fallback body |
| `03-aerial.png` | Attacker airborne above target; both bodies and HUD readable |
| `04-grab-throw.png` | Grab/throw state; both bodies present; equipment stays attached |
| `05-guard-block.png` | Guard contact and shield/percent state; HUD present |
| `06-parry-counter.png` | Counter state and target percent; HUD present |
| `07-knockdown-getup.png` | Knockdown/get-up aftermath; no missing body. Valley water/rock geometry may intrude; that is stage-art scope, not a fighter defect |
| `08-jump-land.png` | Airborne and landing states; body and shadow readable |
| `09-ultimate.png` | Ultimate callout/effect; both fighters framed; effect may partially occlude |
| `10-form.png` | Live form aura/effect; body and HUD readable |
| `11-victory-ko-during-form.png` | Correct `VICTORY · …` result; form callout is checked in report |
| `12-rematch.png` | Fresh rematch after victory: 0–0, 0%, no result text |
| `13-defeat.png` | `DEFEAT · WONDER WOMAN` and grounded defeat pose/result |
| `14-rematch-after-defeat.png` | Fresh rematch after defeat: 0–0, 0%, form cleared |

## 5. Fail conditions

Any one of these rejects the run:

- preflight missing, failed, or produced without `HARDWARE_GPU=1`;
- SwiftShader, llvmpipe, softpipe, software WebGL, WebGL1-only, missing unmasked renderer, or a
  renderer mismatch between preflight and any report;
- summary `pass` false, missing suite, non-zero suite exit, wrong check count, or any `ok: false`;
- an empty/missing screenshot, a blank/wrong-fighter screenshot, or a screenshot that does not show
  the claimed state;
- page/console/asset errors or failed requests in any report;
- a form KO whose `ENDED` callout is absent, or a test that ended in a natural `FADED`/`DRAINED`
  exit and called it a KO;
- a defeat frame that is not the grounded defeat pose;
- a rematch that retains the previous result, percent or round count;
- any suite reported as 13/13 migration checks while claiming the complete ten-criterion A1 pass;
- any copied, renamed or hand-edited evidence file.

Do not weaken a check or omit a suite to obtain a pass. Rerun the affected suite after a repair and
preserve the failed logs alongside the replacement evidence.

## 6. Quick audit commands

Run these from the repository root after the hardware run. They print the fields the checklist
relies on; they do not replace the visual review.

```sh
node - <<'NODE'
const read = p => JSON.parse(require('node:fs').readFileSync(p, 'utf8'));
const summaryPath = process.env.SUMMARY || 'artifacts/hardware-gpu/summary-hulk-a1-aquaman-a1-the-flash-a1.json';
const s = read(summaryPath);
console.log('summary', {
  generatedAt: s.generatedAt, target: s.target, hardwareMode: s.hardwareMode,
  headed: s.headed, pass: s.pass, preflight: s.preflight
});
for (const x of s.suites || []) {
  console.log('suite', {
    id: x.id, exitCode: x.exitCode, expected: x.expected, actual: x.actual,
    passed: x.passed, rendererMatches: x.rendererMatches,
    screenshotBytes: x.screenshotBytes, renderer: x.renderer
  });
}
NODE
```

```sh
node - <<'NODE'
const fs = require('node:fs');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const preflight = read('artifacts/hardware-gpu/preflight.json');
const expected = {
  hulk: { fighter: 'Hulk (Bruce Banner)', form: 'WORLDBREAKER RAGE', pose: 'Armature|hero_hulk01_S09@die' },
  aquaman: { fighter: 'Aquaman', form: 'KING OF THE DEEP', pose: 'GroundDeathB' },
  'the-flash': { fighter: 'The Flash (Barry Allen)', form: 'SPEED FORCE ASCENDANT', pose: 'defeat' }
};
for (const [slug, want] of Object.entries(expected)) {
  const r = read(`artifacts/a1-combat/${slug}/report.json`);
  const checks = r.checks || [];
  console.log(slug, {
    generatedAt: r.generatedAt, fighter: r.fighter,
    hardwareMode: r.hardwareMode, hardwareVerified: r.hardwareVerified,
    softwareRenderer: r.softwareRenderer, evidenceClass: r.evidenceClass,
    renderer: r.renderer?.renderer, rendererMatchesPreflight: r.renderer?.renderer === preflight.gpu?.renderer,
    total: r.total, passed: r.passed, failed: r.failed?.length,
    checks: checks.length, failedChecks: checks.filter(c => !c.ok).length,
    errors: r.errors?.length, failedRequests: r.failedRequests?.length,
    captures: r.captures?.length,
    form: r.observations?.formKO?.activated?.label,
    formKO: r.observations?.formKO?.callouts?.find(x => x.endsWith(' ENDED')),
    pose: r.observations?.defeat?.poseClip,
    expected: want
  });
}
NODE
```

Machine-validate these fields, then inspect the images. A clean JSON audit alone is not a visual
acceptance.

## 7. Acceptance record

Copy this block into the handover record and fill it only from the actual hardware run:

```text
Run date/time (UTC):
Operator:
Machine / cloud host:
Physical GPU:
Driver version:
Browser / user agent:
Display / launch mode:
Repository commit:
Working-tree state:
Run command:
Summary path:
Summary SHA-256:
Preflight renderer:
Preflight pass / hardwareGpu / softwareRenderer:
Hulk report: 42/42, hardwareMode true, rendererMatches true, errors 0, captures 14
Aquaman report: 42/42, hardwareMode true, rendererMatches true, errors 0, captures 14
The Flash report: 42/42, hardwareMode true, rendererMatches true, errors 0, captures 14
Preflight screenshot reviewed:
Three 11-victory screenshots reviewed:
All 126 A1 captures reviewed:
Failed artifacts / notes:
Decision: HARDWARE ACCEPTED / REJECTED / BLOCKED
Signed:
```

Only the combination of a passing preflight, a passing summary, the three 42/42 hardware reports,
human review of the required screenshots and this record supports the label **Hardware accepted**.
Software evidence remains separately labelled and cannot be promoted by editing this record.
