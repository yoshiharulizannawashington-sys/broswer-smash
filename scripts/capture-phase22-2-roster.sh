#!/usr/bin/env bash
# Resumable Phase 22.2 roster capture: one browser process per fighter.
#
#   bash scripts/capture-phase22-2-roster.sh              # every launch fighter not yet captured
#   bash scripts/capture-phase22-2-roster.sh thor hulk_bruce_banner   # named fighters only
#
# Each fighter is a separate `node` process, so a timeout or crash fails exactly one fighter and
# leaves every completed metadata.json in place. Re-running skips fighters whose metadata says
# complete. The command cap is five minutes: this script stops cleanly when the caller's timeout
# fires and the next invocation resumes from the first fighter without metadata.
set -uo pipefail
cd "$(dirname "$0")/.."

LAUNCH=(
  superman iron_man_tony_stark hulk_bruce_banner green_lantern_hal_jordan wonder_woman
  professor_x_charles_xavier the_flash_barry_allen aquaman doctor_strange arnold_schwarzenegger
  goku naruto_uzumaki vegeta saitama l_death_note_style all_might edward_elric levi_ackerman
  mario luigi kratos link master_chief thor aang madara_uchiha hashirama_senju lord_voldemort
  sasuke_uchiha edna_mode captain_jack_sparrow spider_man iron_spider kaze
)

if [ "$#" -gt 0 ]; then
  TARGETS=("$@")
else
  TARGETS=("${LAUNCH[@]}")
fi

pass=0; fail=0
for slug in "${TARGETS[@]}"; do
  if [ -f "artifacts/phase22-2/roster/$slug/metadata.json" ] && \
     node -e "const m=require('./artifacts/phase22-2/roster/$slug/metadata.json');process.exit(m.status==='complete'&&m.current?0:1)" 2>/dev/null; then
    echo "skip    $slug"
    continue
  fi
  echo "capture $slug"
  timeout 90 bash scripts/run-browser-test.sh scripts/capture-phase22-2.mjs --only="$slug" \
    > "artifacts/phase22-2/log-$slug.txt" 2>&1
  code=$?
  if [ "$code" -eq 0 ]; then
    pass=$((pass + 1))
    tail -1 "artifacts/phase22-2/log-$slug.txt"
  else
    fail=$((fail + 1))
    echo "FAILED  $slug (exit $code)"
    tail -4 "artifacts/phase22-2/log-$slug.txt"
  fi
done
echo "done: $pass captured, $fail failed"
