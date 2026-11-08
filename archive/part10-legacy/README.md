# PART 10 archive — removed UI and procedural stages

Nothing in this folder is loaded by the game. It exists so a regression caused by the PART 10
cleanup can be rolled back without reconstructing deleted markup or geometry by hand.

## Files

| File | What it is |
| --- | --- |
| `legacy-entry.html` | The full `public/index.html` before cleanup: `#hud` health plates, `#energyHUD`, `#comboNotice`, the old menu title/sub/roster/arena rows, the visible `#cameraSettings` panel, and all 24 hardcoded arena `<option>`s (including the three procedural arenas and 14 Hogwarts room keys that never resolved to a layout). |
| `root-index.html` | The duplicate root `index.html`. It was a second copy of the legacy interface and was not the Vite entry (`vite.config.js` uses `public/` as the site root). It is now a redirect to `public/index.html`. |
| `procedural-stages.md` | The exact procedural stage code and layout data removed from `main.js` and `world/arena_layouts.js`, so the volcano/ice/neon arenas can be restored if required. |

## The original Valley of the End is NOT archived or removed

`finalvalley` is the authored `public/assets/final_valley.glb` arena (`createFinalValley`). It is
still the default versus arena, still selectable, and its layout, floor material, lighting block
and obstacle list are untouched. `konoha_valley` ("Valley of the End" inside the Konoha world) is
also untouched.

## Old keys that were removed from selection

`volcano`, `ice`, `neon` (fully procedural arenas) and the 14 `hogwarts_<room>` keys that were
listed in the entry HTML but had no entry in `WORLD_LOCATIONS`, so `layoutFor()` silently fell back
to the valley layout while `mapThemes[key]` was `undefined`.

`valley` (Valley of Echoes) is no longer offered as a versus arena. It remains in
`arena_layouts.js` as `DEFAULT_KEY` and still backs the free-roam world/horizon, so removing it
would break explore mode; see `docs/CLEANUP_REPORT.md`.
