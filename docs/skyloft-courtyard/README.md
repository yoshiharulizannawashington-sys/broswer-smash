# Skyloft courtyard golden frame

`after-baseline.png` is the reviewed, fighter-free courtyard after the Skyloft plaza/joint cleanup.
The capture pins graphics quality to High and hides imported character nodes so renderer and
idle-pose variance cannot masquerade as an environment change.

`npm run capture:skyloft-courtyard` writes `before.png`, `after.png` and `report.json` under
`artifacts/environment/arenas/skyloft-courtyard/`. It fails when the after frame differs from this
baseline by more than **1% of pixels** at a **channel delta above 16**. Repeated clean runs measured
roughly 0.2–0.3% changed pixels; the pre-cleanup frame differs by about 17.6%.

Update the baseline only after visually reviewing an intentional cleanup change, then rerun the
capture twice to confirm the new frame is stable.
