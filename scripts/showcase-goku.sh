#!/usr/bin/env bash
# Build the Blender showcase fighter and export it through the game's GLB pipeline.
#
# Resolves Blender from either install location used in this repo:
#   .tools/blender-*/            (scripts/install-blender.sh, the documented path)
#   artifacts/tools/blender-*/   (installed here without root, held in the gitignored artifacts tree)
# and puts whichever extracted X libraries exist on the loader path, because the runner image has
# no Blender and no root to install its X dependencies.
#
#   bash scripts/showcase-goku.sh                 # build, export GLB, render four inspection views
#   bash scripts/showcase-goku.sh --no-render     # build and export only (fast iteration)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

BLENDER="${BLENDER_BIN:-}"
if [ -z "$BLENDER" ]; then
  BLENDER="$(ls -d "$ROOT"/.tools/blender-*/blender "$ROOT"/artifacts/tools/blender-*/blender 2>/dev/null | sort -V | tail -1 || true)"
fi
if [ -z "${BLENDER:-}" ] || [ ! -x "$BLENDER" ]; then
  cat >&2 <<'EOF'
Blender is not installed. Either
  bash scripts/install-blender.sh                     # documented location: .tools/
or install the official tarball under artifacts/tools/ and extract the X libraries it links.
EOF
  exit 127
fi

LIBPATHS=()
for prefix in "$ROOT/node_modules/.system-libs" "$ROOT/artifacts/tools/libs/root"; do
  [ -d "$prefix" ] || continue
  while IFS= read -r dir; do LIBPATHS+=("$dir"); done < <(find "$prefix" -name '*.so*' -printf '%h\n' 2>/dev/null | sort -u)
done
if [ "${#LIBPATHS[@]}" -gt 0 ]; then
  JOINED="$(IFS=:; echo "${LIBPATHS[*]}")"
  export LD_LIBRARY_PATH="$JOINED${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
export BLENDER_USER_CONFIG="${BLENDER_USER_CONFIG:-$ROOT/artifacts/tools/blender-config}"
export BLENDER_USER_SCRIPTS="${BLENDER_USER_SCRIPTS:-$ROOT/artifacts/tools/blender-scripts}"

mkdir -p artifacts/blender-out
echo "blender: $BLENDER"
exec "$BLENDER" --background --python assets/blender/showcase_goku.py -- --out artifacts/blender-out "$@"
