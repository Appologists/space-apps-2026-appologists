#!/usr/bin/env bash
# Rebuilds globe/moon-texture.js from a Moon map JPEG.
# The map is wrapped as a data: URL inside a script so the globe also works when
# index.html is opened straight from disk (browsers refuse file:// images in WebGL).
#
# Usage: tools/make-texture-js.sh [path/to/map.jpg]
#   default map: assets/lroc_color_poles_4k.jpg
set -euo pipefail
cd "$(dirname "$0")/.."
src="${1:-assets/lroc_color_poles_4k.jpg}"
out="globe/moon-texture.js"
{
  printf 'window.MOON_TEXTURE_URL="data:image/jpeg;base64,'
  base64 -i "$src" | tr -d '\n'
  printf '";\n'
} > "$out"
echo "Wrote $out from $src ($(wc -c < "$out" | tr -d ' ') bytes)"
