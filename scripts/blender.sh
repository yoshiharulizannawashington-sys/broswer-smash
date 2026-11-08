#!/usr/bin/env bash
# Run the workspace Blender (installed by scripts/install-blender.sh) with the extracted
# X/GL libraries on the loader path. Blender links libSM/libICE, which this image does not ship;
# everything else comes from node_modules/.system-libs or the Blender bundle itself.
#
#   bash scripts/blender.sh -b --python assets/blender/build_anime_fighter.py
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
PREFIX="$ROOT/node_modules/.system-libs"
BLENDER="${BLENDER_BIN:-$(ls -d "$ROOT"/.tools/blender-*/blender 2>/dev/null | sort -V | tail -1)}"

if [ -z "${BLENDER:-}" ] || [ ! -x "$BLENDER" ]; then
  echo "Blender is not installed. Run: bash scripts/install-blender.sh" >&2
  exit 127
fi

ARCHDIR="$(basename "$(ls -d "$PREFIX"/usr/lib/*/ 2>/dev/null | head -1)" 2>/dev/null || echo '')"
if [ -n "$ARCHDIR" ]; then
  export LD_LIBRARY_PATH="$PREFIX/usr/lib/$ARCHDIR:$PREFIX/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
# Headless only: no display, no audio device.
export BLENDER_USER_CONFIG="${BLENDER_USER_CONFIG:-$ROOT/.tools/blender-config}"
export BLENDER_USER_SCRIPTS="${BLENDER_USER_SCRIPTS:-$ROOT/.tools/blender-scripts}"
exec "$BLENDER" "$@"
