#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "Usage: scripts/capture-screenshot.sh <url> <width> <height> <output-png-path>" >&2
  exit 1
fi

url="$1"
width="$2"
height="$3"
out="$4"

if ! [[ "$width" =~ ^[0-9]+$ ]] || ! [[ "$height" =~ ^[0-9]+$ ]] || [ "$width" -le 0 ] || [ "$height" -le 0 ]; then
  echo "Width and height must be positive integers." >&2
  exit 1
fi

mkdir -p "$(dirname "$out")"

npx playwright screenshot \
  --browser chromium \
  --full-page \
  --viewport-size "${width},${height}" \
  "$url" \
  "$out"

echo "$out"
