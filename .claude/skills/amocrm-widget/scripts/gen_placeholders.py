#!/usr/bin/env python3
"""
Generate placeholder PNG logos for an amoCRM widget at the exact sizes required:
  - logo.png      (90 x 90)   — main widget icon
  - logo_small.png (30 x 30)  — small icon (lists)
  - logo_dp.png  (174 x 109)  — Digital Pipeline tile (mandatory if dp is in locations)

Usage: python3 gen_placeholders.py <path-to-widget-folder> [WIDGET_LABEL]

Requires Pillow: pip install Pillow
"""

import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("Install Pillow first: pip install Pillow", file=sys.stderr)
    sys.exit(1)


SIZES = {
    "logo.png":       (90, 90),
    "logo_small.png": (30, 30),
    "logo_dp.png":    (174, 109),
}

# Colors loosely matching amoCRM's brand palette.
BG = (37, 89, 149, 255)       # amo blue
FG = (255, 255, 255, 255)


def draw_placeholder(size, label):
    img = Image.new("RGBA", size, BG)
    draw = ImageDraw.Draw(img)

    # Try a sensible TTF; fall back to default bitmap font.
    font = None
    for path in [
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "C:\\Windows\\Fonts\\arial.ttf",
    ]:
        if Path(path).exists():
            try:
                font = ImageFont.truetype(path, max(10, min(size) // 4))
                break
            except OSError:
                continue
    if font is None:
        font = ImageFont.load_default()

    # Compute text size in a way that works with new + old Pillow
    try:
        bbox = draw.textbbox((0, 0), label, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    except AttributeError:
        tw, th = draw.textsize(label, font=font)

    draw.text(((size[0] - tw) / 2, (size[1] - th) / 2), label, font=font, fill=FG)
    return img


def main(root, label):
    images_dir = Path(root) / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    for name, size in SIZES.items():
        out = images_dir / name
        img = draw_placeholder(size, label)
        img.save(out, "PNG", optimize=True)
        print(f"✅ {out} ({size[0]}x{size[1]})")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: gen_placeholders.py <widget-folder> [LABEL]", file=sys.stderr)
        sys.exit(1)
    label = sys.argv[2] if len(sys.argv) >= 3 else "W"
    main(sys.argv[1], label)
