#!/usr/bin/env bash
# Install the Chromium shared libraries the Playwright browser needs, without root.
#
# The cloud runner image has no sudo, and Ubuntu's package lists are empty for the workspace
# user, so `playwright install-deps` cannot run. This downloads only the missing library
# packages from the Ubuntu archive for this release and unpacks them into node_modules/.system-libs.
# Every browser test then runs with that directory on LD_LIBRARY_PATH (see scripts/run-browser-test.sh).
#
#   bash scripts/install-browser-libs.sh
set -euo pipefail

cd "$(dirname "$0")/.."
PREFIX="$PWD/node_modules/.system-libs"
CACHE="$PREFIX/debs"
ARCH="$(dpkg --print-architecture)"
CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME:-noble}")"
MIRROR="${UBUNTU_MIRROR:-http://archive.ubuntu.com/ubuntu}"

PACKAGES=(
  libnspr4 libnss3 libxcomposite1 libxdamage1 libxfixes3 libxrandr2
  libasound2t64 libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 libxkbcommon0
  libxrender1 libxi6 libcups2t64 libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libpangoft2-1.0-0
  libavahi-common3 libavahi-client3 libpng16-16t64 libfontconfig1 libfreetype6
  libxcb-render0 libpixman-1-0 libthai0 libharfbuzz0b libgraphite2-3 libdatrie1 libbrotli1
  fonts-dejavu-core
  # Blender, not Chromium: scripts/blender.sh documents that the Blender bundle links libSM/libICE
  # and that this image does not ship them. They were missing from this list, so after a runner
  # restart every Blender invocation failed with "libSM.so.6: cannot open shared object file" and
  # the whole roster build was unrunnable until they were fetched by hand.
  libsm6 libice6 libxt6 libuuid1
)

mkdir -p "$CACHE"
INDEX="$CACHE/Packages"
if [ ! -s "$INDEX" ]; then
  : > "$INDEX"
  for suite in "$CODENAME" "$CODENAME-updates"; do
    for component in main universe; do
      url="$MIRROR/dists/$suite/$component/binary-$ARCH/Packages.gz"
      echo "index $url"
      curl -fsSL "$url" | gunzip >> "$INDEX" || true
    done
  done
fi

# Stamp each package that was actually unpacked. The previous check globbed for the package name
# with its version digits stripped, so `libsm6` looked satisfied by libnss3's libsmime3.so and
# Blender kept failing on the missing libSM.so.6; `libice6` had the same collision waiting.
STAMPS="$PREFIX/.installed"
mkdir -p "$STAMPS"

for pkg in "${PACKAGES[@]}"; do
  if [ -f "$STAMPS/$pkg" ]; then
    echo "have $pkg"
    continue
  fi
  # Take the last (highest) match for this package name from the merged index.
  rel="$(awk -v want="$pkg" '
    /^Package: / { name = $2 }
    /^Filename: / { if (name == want) file = $2 }
    END { if (file) print file }
  ' "$INDEX" | tail -1)"
  if [ -z "$rel" ]; then
    echo "WARN no archive entry for $pkg"
    continue
  fi
  deb="$CACHE/$(basename "$rel")"
  [ -s "$deb" ] || curl -fsSL "$MIRROR/$rel" -o "$deb"
  dpkg-deb -x "$deb" "$PREFIX"
  touch "$STAMPS/$pkg"
  echo "unpacked $pkg"
done

# The image has no /etc/fonts and no fonts at all, which makes Chromium crash while laying out
# text (a <select> with many options is enough). Point fontconfig at the fonts we just unpacked.
FONTCONF="$PREFIX/fonts.conf"
cat > "$FONTCONF" <<CONF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir>$PREFIX/usr/share/fonts</dir>
  <cachedir>$PREFIX/fontcache</cachedir>
  <match target="pattern">
    <edit name="family" mode="assign" binding="strong"><string>DejaVu Sans</string></edit>
  </match>
</fontconfig>
CONF
mkdir -p "$PREFIX/fontcache"

echo
echo "library prefix: $PREFIX"
echo "fontconfig:     $FONTCONF"
find "$PREFIX/usr/lib" -name '*.so*' | sed -n '1,5p'
echo "next:   bash scripts/run-browser-test.sh scripts/test-movesets.mjs"
