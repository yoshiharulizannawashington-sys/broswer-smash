#!/usr/bin/env bash
# Materialise the shared libraries Playwright's Chromium needs, without root.
#
# The cloud VM is archived between sessions, which drops distro packages such as
# libnspr4, libnss3 and fontconfig (and apt cannot be used because there is no root).
# This script downloads the .deb files into .browser-libs/ and unpacks them into a
# local sysroot. Without fontconfig's config file Chromium's Skia aborts with
# "Not implemented" on the first page that renders text, which looks like the whole
# browser dying on navigation. Tests then run with:
#   source <(bash scripts/setup-browser-libs.sh --env)
#
# Usage: bash scripts/setup-browser-libs.sh
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
libs="$root/.browser-libs"
arch="$(dpkg --print-architecture 2>/dev/null || echo amd64)"

PACKAGES=(
  libnspr4 libnss3 libasound2t64 libatk1.0-0t64 libatk-bridge2.0-0t64
  libatspi2.0-0t64 libxcomposite1 libxdamage1 libxfixes3 libxrandr2
  libxrender1 libxkbcommon0 libdbus-1-3 libx11-6 libxcb1 libxext6 libxi6
  libglib2.0-0t64 fontconfig fontconfig-config fonts-dejavu-core
)

mkdir -p "$libs/lists" "$libs/cache/archives/partial" "$libs/debs" "$libs/sysroot"

APTOPT=(
  -o "Dir::State::lists=$libs/lists"
  -o "Dir::Cache=$libs/cache"
  -o "Dir::State::status=/var/lib/dpkg/status"
  -o "Debug::NoLocking=1"
  -o "APT::Sandbox::User=$(id -un)"
)

apt-get "${APTOPT[@]}" update >/dev/null

missing=()
for package in "${PACKAGES[@]}"; do
  if ! compgen -G "$libs/debs/${package}_*.deb" >/dev/null; then missing+=("$package"); fi
done
if [ ${#missing[@]} -gt 0 ]; then
  ( cd "$libs/debs" && apt-get "${APTOPT[@]}" download "${missing[@]}" >/dev/null )
fi

for deb in "$libs"/debs/*.deb; do dpkg -x "$deb" "$libs/sysroot"; done

# fontconfig refuses to use its own prefix unless the config is rewritten to it, and
# Skia hard-aborts (SIGTRAP) when it cannot load a font config.
sysroot="$libs/sysroot"
mkdir -p "$sysroot/var/cache/fontconfig"
sed -e "s#<dir>[^<]*</dir>#<dir>$sysroot/usr/share/fonts</dir>#" \
    -e "s#<cachedir>[^<]*</cachedir>#<cachedir>$sysroot/var/cache/fontconfig</cachedir>#" \
    "$sysroot/etc/fonts/fonts.conf" > "$libs/fonts.conf"

export LD_LIBRARY_PATH="$sysroot/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export FONTCONFIG_FILE="$libs/fonts.conf"
export FONTCONFIG_PATH="$sysroot/etc/fonts"
browser="$(find "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}" -name chrome-headless-shell -type f 2>/dev/null | head -1)"
if [ -n "$browser" ]; then
  count="$(ldd "$browser" | grep -c 'not found' || true)"
  # Diagnostics go to stderr so `--env` output can be sourced or eval'd directly.
  echo "chromium missing libraries: $count ($arch)" >&2
  [ "$count" = "0" ] || ldd "$browser" | grep 'not found' >&2
fi
if [ "${1:-}" = "--env" ]; then
  echo "export LD_LIBRARY_PATH=$libs/sysroot/usr/lib/x86_64-linux-gnu"
  echo "export FONTCONFIG_FILE=$libs/fonts.conf"
  echo "export FONTCONFIG_PATH=$libs/sysroot/etc/fonts"
else
  echo "run tests with: source <(bash scripts/setup-browser-libs.sh --env)"
fi
