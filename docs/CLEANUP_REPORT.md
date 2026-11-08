# PART 10 — Old UI, unwanted procedural stages and dead-code cleanup

Status: implemented and verified in the live game. Nothing was committed or pushed; the working
tree already carried unrelated user changes, so this phase is kept as one clearly separated
implementation phase rather than split into commits that could not be cleanly isolated.

Acceptance harness: `bash scripts/run-browser-test.sh scripts/verify-part10-cleanup.mjs` — **30/30
checks pass**, no page errors and no console errors. Machine-readable result:
`artifacts/part10/cleanup-checks.json`. Captures: `artifacts/part10/result.png`, `artifacts/part10/match.png`
(software-rendered Chromium — composition evidence only, not hardware visual verification).

---

## 1. Old UI removed

Removed from `public/index.html` (the active Vite entry):

| Removed | What it was |
| --- | --- |
| `#hud` | The whole legacy top bar: `.fighter` plates, `.name`, `#p1name`/`#p2name`, `#p1damage`/`#p2damage`, `#p1bar`/`#p2bar`, `#p1special`/`#p2special`, `#clockstack`, `.bottom` control legend |
| `#energyHUD` | Second signature-move meter (`#specialLabel`, `.energyTrack`, `#energyFill`) floating above the fighters |
| `#comboNotice` (old markup) | Old combo banner; replaced by the same id inside the new match bar |
| Old menu sheet | `.eyebrow`, `.title`, `.sub`, the three hardcoded `<label>ARENA/PLAYER/CPU` rows, and the old `.actions` button row (24 arena options + 32 + 32 roster options) |
| Visible `#cameraSettings` | Camera/arena/settings panel that main.js revealed during a match |
| Inline `<style>` | The ~6.5 kB legacy HUD/menu stylesheet, including its mobile overrides |

Removed from `public/js/main.js`:

- `roundScoreEl` creation and inline styling (the element is now static markup in the new bar).
- `updatePowerHud()`, `ensureShieldBar()`, `updateShieldBars()` and `powerHudWarned` — they injected
  `.power-hud` rows and shield bars into the deleted `.fighter` panels.
- Every legacy write in `updateHud()` (`#p1damage`, `#p2damage`, `#p1name`, `#p2name`, `#p1special`,
  `#p2special`, `#p1bar`, `#p2bar`, `#energyFill`, `#energyHUD`).
- `#cameraSettings` `display:block`/`display:none` toggles (4 sites) and `#energyHUD` opacity writes (2 sites).
- The `.fighter` label/badge writes in `fighterTypeRefresh()`.

Removed from `public/css/browserbros.css`:

- The legacy HUD block: `#hud .top`, `.fighter`, `.fighter.right`, `.fighter .name`, `.damage-readout`,
  `.fighter.right .damage-readout`, `.meter`, `.fill`, `.fighter.right .fill`, `.special-readout`,
  `.fighter.right .special-readout`, `#clockstack`, the old `#timer`/`#roundScore`/`.energyHUD`/
  `#comboNotice` rules, and their responsive variants.

Removed from `public/js/combat/combat_powers.js`: the cinematic HUD rule now hides `#bbMatchBar`
instead of `#hud, #energyHUD, #comboNotice, #roundScore`.

Removed from `public/js/ui/pause_menu.js`: the pause rule now dims `#bbMatchBar` instead of `#energyHUD`
and `#comboNotice`.

`index.html` (repository root) was a second full copy of the legacy interface and is not the Vite
entry (`vite.config.js` uses `public/` as root). It is now a redirect to `public/index.html`; the
original is archived.

## 2. New UI implemented

- `public/index.html` is now a shell: canvas, vignette, one match bar, one menu sheet, and a single
  hidden adapter block. 193 → 59 element tags; 17,018 → 4,438 bytes.
- `#bbMatchBar` (clock, `#roundScore`, `#status`, `#comboNotice`) is adopted into `#bbHudLayer` at
  boot, so there is exactly one match HUD instead of the old top bar plus the modern layer.
- `ui/bbb_interface.js` supplies the title screen, settings (audio, graphics preset, camera
  distance/view, controls), loading gate and result actions (REMATCH / CHARACTER SELECT / MAIN MENU).
- `ui/character_select.js` supplies the 38-fighter roster grid, per-fighter move list, match rules,
  arena tabs and 3D fighter preview.
- Legacy `<select>`/button elements survive only as **hidden** data adapters (`#bbAdapters[hidden]`
  and `#cameraSettings[hidden]`) because `main.js` still owns character swapping, map loading and
  rules. They are never painted and `#play`/`#practice`/`#explore` are moved into the modern panel.
- Fixed a real HUD defect found during acceptance: `#bbHudLayer` treated the mere existence of
  `#browserSmashCinematic` as "intro running", but that node outlives the intro by seconds, so the
  match HUD stayed hidden after the entrance. It now reads
  `__browserSmashPresentation.report().intro.active`.
- Combat pickups previously overwrote the shared `#status` line permanently with
  "PICKED UP …". They now use the callout layer, so the arena/round line survives.

## 3. Procedural stages removed from active selection

Removed completely (no authored counterpart, no GLB):

| Key | Stage | What was deleted |
| --- | --- | --- |
| `volcano` | Obsidian Volcano | layout, floor material, theme, cone/vent props, 22 random rocks, 28 landmark cones, ambience `volcanic` |
| `ice` | Frostfall Citadel | layout, floor material, theme, citadel, 26 crystals, 36 landmark crystals, ambience `ice` |
| `neon` | Neon Megacity | layout, floor material, theme, 5 towers, 30 window-strip blocks, 45 landmark towers, ambience `city`, `neon` footstep surface |
| `valley` | Valley of Echoes | removed from **selection only** — kept as `DEFAULT_KEY` and as the free-roam world/horizon host, because deleting it would break explore mode |

Also removed from the pickers: 14 hardcoded `hogwarts_<room>` options that duplicated the real
`hogwarts_interior.js` locations (the duplicates produced repeated arena cards). The arena grid now
has 82 entries, all unique; every one resolves to a real layout.

`layoutFor()` no longer has any removed key to fall back from, so the silent "unknown arena becomes
the valley layout" path is no longer reachable from the UI. A stale saved arena key is now validated
against the actual `<option>` list and falls back to `finalvalley` instead of selecting nothing.

**Preserved:** `finalvalley` — the authored `public/assets/final_valley.glb` Valley of the End.
Its layout (`bounds`, `spawns`), floor material, lighting block, obstacle list and default-arena
role are untouched. `konoha_valley` ("Valley of the End" in the Konoha world) is also untouched.
Verified in the harness: `finalvalley` is selectable, `finalValley.status === "loaded"`, and the
status line reads `FINAL VALLEY · HASHIRAMA & MADARA · SHINOBI CLIFFS`.

## 4. Files archived (not loaded)

All under `archive/part10-legacy/`:

- `legacy-entry.html` — full pre-cleanup `public/index.html`.
- `root-index.html` — the duplicate root `index.html`.
- `procedural-stages.md` — exact removed stage code/layout data for restoration.
- `README.md` — what each file is, what was deliberately kept, and the restore path.

## 5. Files permanently deleted

**None.** No source file, model, texture or arena asset was deleted. Every removal above was inline
code or markup whose behaviour was replaced; the originals are archived. No asset was proven unused
enough to delete, so none was.

## 6. Unused assets removed

**None.** `public/assets/final_valley.glb` (9.82 MB) is preserved and still loaded. The seven authored
arena GLBs and every character model remain referenced. Because the removed procedural arenas had no
asset files (they were generated in code), there was no orphaned texture/model to delete.

## 7. Code and dependencies removed

- ~180 lines of procedural stage construction (meshes, materials, landmarks, ambience/footstep branches).
- 24 lines of procedural arena layout data.
- The legacy HUD write path: 3 helper functions, 1 element factory, ~15 DOM writes per frame.
- ~170 lines of legacy HUD/menu CSS.
- No dependency was removed: `three` and `vite` are both still required. `package.json` is unchanged.

## 8. Performance measurements before/after

Measured on the same machine, same lockfile, `npm run build` (Vite 6, `vite build`):

| Artifact | Before | After | Delta |
| --- | --- | --- | --- |
| `public/index.html` (source) | 17,018 B | 4,438 B | **−12,580 B (−73.9%)** |
| `dist/index.html` | 16,793 B / 4.97 kB gzip | 4,212 B / 1.73 kB gzip | **−74.9% raw, −65.2% gzip** |
| Entry DOM element tags | 193 | 59 | **−134 (−69.4%)** |
| JS bundle | 1,851,817 B / 551.89 kB gzip | 1,844,400 B / 549.50 kB gzip | −7,417 B (−0.40%); −2.39 kB gzip |
| CSS bundle | 19,259 B / 5.00 kB gzip | 19,364 B / 4.95 kB gzip | +105 B raw (base shell moved out of inline HTML into the stylesheet), −0.05 kB gzip |
| HTML + CSS combined | 36,277 B | 23,802 B | **−12,475 B (−34.4%)** |
| `main.js` | 2,247 lines | 2,211 lines | −36 lines |

Per-frame work removed, counted in source (not a timing measurement): `updateHud()` previously made
15+ DOM property writes plus a per-fighter shield-bar loop every frame; it now makes 2 text writes
and 1 class toggle. The three removed arenas each built roughly 100–120 individual meshes with their
own materials on load (22–45 scattered props, 22–45 landmark props, plus a shared 42-rock scatter);
that construction no longer exists.

**Not measured:** draw calls, triangles, GPU frame time, FPS and time-to-interactive before/after.
The pre-cleanup bundle was rebuilt in place during this pass, so a true before/after rendering
comparison is no longer possible without checking out the previous build. **No runtime speedup is
claimed** — only the artifact-size and per-frame-work reductions above, which are measured or counted
directly. A draw-call comparison should be captured with `npm run probe:audit` on both builds before
any performance claim is made.

## 9. Remaining obsolete systems

1. **`valley` / Valley of Echoes procedural world.** Its layout, `explorationWorld`, `horizon` and
   per-key dressing still exist in `main.js` and `arena_layouts.js`. It is no longer selectable as a
   versus arena, but it is still the free-roam host and `DEFAULT_KEY`. Removing it needs the explore
   mode migrated to a world location first.
2. **`combatPowers.drawHud()`** (≈120 lines in `public/js/combat/combat_powers.js`) targeted the
   deleted `.fighter` panels, so it is a no-op in the game. It was **not** deleted because
   `scripts/test-movesets.mjs` still calls it directly; removing it requires porting that test to the
   modern ability cluster first.
3. **Legacy compatibility selectors.** `#p1Character`, `#cpuCharacter`, `#menuMapSelect`, `#mapSelect`,
   `#cameraMode`, `#cameraZoom`, `#play`, `#practice`, `#explore`, `#result` remain as hidden adapters.
   They are the data contract `main.js` owns; replacing them with a JS API is a separate refactor.
4. **Old entrypoint aliases.** `index.html` is a redirect rather than a deletion because repository
   docs list it as a supported entry point.
5. **Obsolete capture/verification scripts.** Several scripts under `scripts/` still query `#hud`,
   `#energyHUD`, `#p1bar` or `#cameraSettings` (e.g. `verify-camera-hud-responsive.mjs`,
   `capture-ui-pass.mjs`, `verify-victory-flow.mjs` reads `#hud` visibility). They are historical
   evidence harnesses, not part of the game; they will need updating or archiving before reuse.
6. **`combatPowers` `.power-hud` stylesheet.** Its `<style id="powerHudStyles">` is only injected when
   `drawHud()` runs, so it no longer appears in the live game.

## Reproduce the verification

```sh
npm run build
bash scripts/run-browser-test.sh scripts/verify-part10-cleanup.mjs
```

The harness checks: legacy markup absent from source and DOM, modern title/HUD present, 38 roster
cards, 82 unique arenas with no `volcano`/`ice`/`neon`/`valley`, `finalvalley` present and its GLB
loaded, a real match on Final Valley, live clock/status/health chips/7 ability slots, pause and
resume, a real fight to VICTORY or DEFEAT, the three result actions, rematch, and zero page/console
errors.
