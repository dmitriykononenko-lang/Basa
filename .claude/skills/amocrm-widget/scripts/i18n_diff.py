#!/usr/bin/env python3
"""
Diff i18n locale files in an amoCRM widget. Prints keys present in one locale but missing in others.

Usage: python3 i18n_diff.py <path-to-widget-folder>
"""

import json
import sys
from pathlib import Path


def flatten_keys(d, prefix=""):
    out = set()
    if not isinstance(d, dict):
        return out
    for k, v in d.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out |= flatten_keys(v, key)
        else:
            out.add(key)
    return out


def main(widget_root):
    i18n = Path(widget_root) / "i18n"
    files = sorted(i18n.glob("*.json"))
    if len(files) < 2:
        print(f"Need at least 2 locale files in {i18n}; found {len(files)}")
        return 0

    locales = {}
    for f in files:
        try:
            locales[f.stem] = flatten_keys(json.loads(f.read_text(encoding="utf-8")))
        except json.JSONDecodeError as e:
            print(f"❌ {f.name}: invalid JSON — {e}")
            return 1

    union = set().union(*locales.values())
    any_mismatch = False
    for loc, keys in locales.items():
        missing = sorted(union - keys)
        if missing:
            any_mismatch = True
            print(f"❌ {loc}: missing {len(missing)} keys")
            for k in missing:
                print(f"    - {k}")

    if not any_mismatch:
        print(f"✅ All {len(locales)} locales have identical key sets ({len(union)} keys each)")
        return 0
    return 1


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: i18n_diff.py <path-to-widget-folder>", file=sys.stderr)
        sys.exit(1)
    sys.exit(main(sys.argv[1]))
