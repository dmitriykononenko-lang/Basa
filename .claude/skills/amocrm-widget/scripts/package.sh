#!/usr/bin/env bash
# Package an amoCRM widget folder into a versioned .zip ready for the dev cabinet.
#
# Usage:
#   ./package.sh /path/to/widget [/path/to/output-dir]
#
# The zip's root contains manifest.json directly (no parent folder wrap).
# Filename: <widget_code>-<version>.zip from manifest.json.

set -euo pipefail

WIDGET_DIR="${1:-.}"
OUT_DIR="${2:-.}"

if [[ ! -f "$WIDGET_DIR/manifest.json" ]]; then
  echo "❌ No manifest.json at $WIDGET_DIR" >&2
  exit 1
fi

# Run validator first if it's next to this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/validate.py" ]]; then
  echo "→ Validating widget..."
  if ! python3 "$SCRIPT_DIR/validate.py" "$WIDGET_DIR"; then
    echo "❌ Validation failed — fix errors above before packaging" >&2
    exit 1
  fi
fi

VERSION=$(python3 -c "import json,sys; print(json.load(open('$WIDGET_DIR/manifest.json'))['widget']['version'])")
NAME=$(python3 -c "import json,sys; print(json.load(open('$WIDGET_DIR/manifest.json'))['widget']['code'])")

mkdir -p "$OUT_DIR"
OUT_FILE="$OUT_DIR/${NAME}-${VERSION}.zip"
rm -f "$OUT_FILE"

# cd into widget dir so manifest.json ends up at archive root
( cd "$WIDGET_DIR" && zip -r "$OUT_FILE" . \
    -x "*.DS_Store" \
    -x "__MACOSX/*" \
    -x ".git/*" \
    -x "node_modules/*" \
    -x "dist/*" \
    -x "*.md" \
    -x "scripts/*" \
    -x "evals/*" \
)

# Verify archive root
ROOT_ENTRY=$(unzip -l "$OUT_FILE" | awk 'NR==4 { print $4 }')
if [[ "$ROOT_ENTRY" != "manifest.json" && "$ROOT_ENTRY" != "./" ]]; then
  echo "⚠️  Archive root entry is '$ROOT_ENTRY' — manifest.json must be at root for amoCRM to accept it"
fi

echo "✅ Built $OUT_FILE"
unzip -l "$OUT_FILE" | tail -n +4 | head -20
