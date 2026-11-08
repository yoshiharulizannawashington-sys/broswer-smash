#!/usr/bin/env bash
# Install a headless Blender into .tools/ (no root, no system packages) so character GLBs can be
# authored and exported on this machine.
#
# The cloud runner image has no sudo and no Blender. This downloads the official portable Linux
# build from download.blender.org, unpacks it inside the workspace, and extracts the two X
# libraries Blender links against but the image lacks (libSM, libICE) from the Ubuntu archive.
# `scripts/blender.sh` then sets LD_LIBRARY_PATH and runs it.
#
#   bash scripts/install-blender.sh            # install / verify
#   bash scripts/install-blender.sh --check    # report only, change nothing
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
TOOLS="$ROOT/.tools"
PREFIX="$ROOT/node_modules/.system-libs"
CACHE="$PREFIX/debs"
ARCH="$(dpkg --print-architecture)"
CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME:-noble}")"
MIRROR="${UBUNTU_MIRROR:-http://archive.ubuntu.com/ubuntu}"

BLENDER_SERIES="${BLENDER_SERIES:-4.2}"
BLENDER_VERSION="${BLENDER_VERSION:-4.2.23}"
TARBALL="blender-${BLENDER_VERSION}-linux-x64.tar.xz"
BLENDER_DIR="$TOOLS/blender-${BLENDER_VERSION}-linux-x64"

check_only=0
[ "${1:-}" = "--check" ] && check_only=1

archdir() { basename "$(ls -d "$PREFIX"/usr/lib/*/ 2>/dev/null | head -1)" 2>/dev/null || true; }

verify() {
  local dir
  LD_LIBRARY_PATH="${PREFIX}/usr/lib/$(archdir):${PREFIX}/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
    "$1" -b --version 2>&1 | head -2
}

if [ -x "$BLENDER_DIR/blender" ] && verify "$BLENDER_DIR/blender" >/dev/null 2>&1; then
  echo "blender present: $("$ROOT/scripts/blender.sh" --version 2>/dev/null | head -1)"
  exit 0
fi

if [ "$check_only" = 1 ]; then
  echo "blender is not installed at $BLENDER_DIR"
  exit 1
fi

mkdir -p "$TOOLS" "$CACHE"
if [ ! -x "$BLENDER_DIR/blender" ]; then
  if [ ! -s "$TOOLS/$TARBALL" ]; then
    echo "downloading https://download.blender.org/release/Blender${BLENDER_SERIES}/${TARBALL}"
    curl -fL --retry 3 -o "$TOOLS/$TARBALL" "https://download.blender.org/release/Blender${BLENDER_SERIES}/${TARBALL}"
  fi
  # A truncated download is the usual failure; the real tarball is ~330 MB.
  size=$(stat -c %s "$TOOLS/$TARBALL")
  if [ "$size" -lt 200000000 ]; then
    echo "downloaded tarball is only $size bytes - deleting it; re-run to retry" >&2
    rm -f "$TOOLS/$TARBALL"
    exit 1
  fi
  tar xf "$TOOLS/$TARBALL" -C "$TOOLS"
fi

# Blender links libSM.so.6 and libICE.so.6; the image ships neither and there is no root.
missing=()
for soname in libSM.so.6 libICE.so.6 libX11.so.6 libXext.so.6 libXxf86vm.so.1 libXi.so.6 \
              libXrender.so.1 libXfixes.so.3 libxkbcommon.so.0; do
  if ! LD_LIBRARY_PATH="${PREFIX}/usr/lib/$(archdir):${PREFIX}/usr/lib" ldd "$BLENDER_DIR/blender" 2>/dev/null | grep -q "$soname =>"; then
    continue
  fi
  if [ -e "$PREFIX/usr/lib/$(archdir)/$soname" ] || [ -e "$PREFIX/usr/lib/$soname" ]; then
    continue
  fi
  missing+=("$soname")
done

if [ "${#missing[@]}" -gt 0 ]; then
  INDEX="$CACHE/Packages"
  if [ ! -s "$INDEX" ]; then
    : > "$INDEX"
    for suite in "$CODENAME" "$CODENAME-updates"; do
      for component in main universe; do
        curl -fsSL "$MIRROR/dists/$suite/$component/binary-$ARCH/Packages.gz" | gunzip >> "$INDEX" || true
      done
    done
  fi
  # soname -> providing package
  for soname in "${missing[@]}"; do
    case "$soname" in
      libSM.so.6) pkg=libsm6 ;;
      libICE.so.6) pkg=libice6 ;;
      libX11.so.6) pkg=libx11-6 ;;
      libXext.so.6) pkg=libxext6 ;;
      libXxf86vm.so.1) pkg=libxxf86vm1 ;;
      libXi.so.6) pkg=libxi6 ;;
      # libXrender/libXfixes/libxkbcommon only surface on images whose node_modules was
      # restored without .system-libs; keep them mapped so setup stays one command.
      libXrender.so.1) pkg=libxrender1 ;;
      libXfixes.so.3) pkg=libxfixes3 ;;
      libxkbcommon.so.0) pkg=libxkbcommon0 ;;
      *) continue ;;
    esac
    rel="$(awk -v want="$pkg" '/^Package: / { name = $2 } /^Filename: / { if (name == want) file = $2 } END { if (file) print file }' "$INDEX" | tail -1)"
    if [ -z "$rel" ]; then
      echo "WARN: no archive entry for $pkg ($soname)" >&2
      continue
    fi
    deb="$CACHE/$(basename "$rel")"
    [ -s "$deb" ] || curl -fsSL "$MIRROR/$rel" -o "$deb"
    dpkg-deb -x "$deb" "$PREFIX"
    echo "unpacked $pkg for $soname"
  done
fi

echo "verifying:"
verify "$BLENDER_DIR/blender"
cat <<EOF

Blender installed at $BLENDER_DIR
Run it through the wrapper so the extracted libraries are on the loader path:

  bash scripts/blender.sh -b --python assets/blender/build_anime_fighter.py

EOF
