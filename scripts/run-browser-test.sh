#!/usr/bin/env bash
# Run a node/Playwright test with the libraries the browser needs.
#
# The cloud runner has no root, no system Chromium libraries beyond a few, no fonts and no
# fontconfig, and a missing font makes Chromium crash while laying out the roster <select>.
# scripts/install-browser-libs.sh unpacks everything into node_modules/.system-libs; this wrapper
# points the loader and fontconfig at it and then runs the test unchanged.
#
#   bash scripts/run-browser-test.sh scripts/test-movesets.mjs
set -euo pipefail

cd "$(dirname "$0")/.."
PREFIX="$PWD/node_modules/.system-libs"
# The library directory is the multiarch triplet (x86_64-linux-gnu), not the dpkg arch name.

if [ ! -d "$PREFIX/usr/share/fonts" ]; then
  bash scripts/install-browser-libs.sh >/dev/null
fi

ARCHDIR="$(basename "$(ls -d "$PREFIX"/usr/lib/*/ 2>/dev/null | head -1)")"
export LD_LIBRARY_PATH="$PREFIX/usr/lib/${ARCHDIR}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export FONTCONFIG_FILE="$PREFIX/fonts.conf"
exec node "$@"
