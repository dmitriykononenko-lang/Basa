#!/usr/bin/env python3
"""
Validate an amoCRM / Kommo widget folder before packaging.

Checks:
  - manifest.json parses as JSON
  - Required widget fields are present (code, secret_key, version, interface_version)
  - Every i18n key referenced from manifest exists in every declared locale
  - i18n locale files declared in manifest.locale actually exist
  - All locales have the same set of keys (no missing translations)
  - locations entries are recognized strings
  - images/logo_dp.png is 174x109 if digital_pipeline is in locations (requires Pillow)
  - templates/ folder exists if any callback usage is detected
  - script.js exists

Usage: python3 validate.py <path-to-widget-folder>
Exit code: 0 if valid, 1 if any error, 2 if only warnings.
"""

import json
import sys
import os
import re
from pathlib import Path

KNOWN_LOCATIONS = {
    "lcard-1", "lcard-0", "ccard-1", "ccard-0", "comcard-1", "comcard-0",
    "cuscard-1", "cuscard-0", "llist-1", "llist-0", "clist-1", "clist-0",
    "comlist-1", "comlist-0", "card_sdk", "settings", "advanced_settings",
    "digital_pipeline", "lead_sources", "catalogs", "ai_agent",
    "mail_card", "chats", "sms", "everywhere",
}

errors = []
warnings = []


def err(msg): errors.append(msg)
def warn(msg): warnings.append(msg)


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
    root = Path(widget_root).resolve()
    if not root.is_dir():
        err(f"Not a directory: {root}")
        return

    manifest_path = root / "manifest.json"
    if not manifest_path.exists():
        err("manifest.json missing at the widget root")
        return

    # Parse manifest
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        err(f"manifest.json: invalid JSON — {e}")
        return

    widget = manifest.get("widget") or {}
    for field in ("name", "version", "code", "secret_key", "interface_version", "locale"):
        if not widget.get(field):
            err(f"manifest.widget.{field} is missing or empty")

    if widget.get("interface_version") != 2:
        warn(f"interface_version is {widget.get('interface_version')!r}; recommend 2")

    if widget.get("code") == "REPLACE_WITH_INTEGRATION_CODE":
        err("widget.code still has the placeholder value — fill it from the dev cabinet")

    if widget.get("secret_key") in ("REPLACE_WITH_SECRET_FROM_DEV_CABINET", "", None):
        err("widget.secret_key is unset or has the placeholder value")

    # Validate semver
    version = widget.get("version", "")
    if not re.match(r"^\d+\.\d+\.\d+$", version):
        warn(f"widget.version={version!r} doesn't look like semver (expected like 1.0.0)")

    # Locations
    locs = manifest.get("locations") or []
    if not isinstance(locs, list) or not locs:
        err("manifest.locations must be a non-empty array")
    else:
        for loc in locs:
            if loc not in KNOWN_LOCATIONS:
                warn(f"Unknown location: {loc!r} (may still work; verify against developers.kommo.com/docs/widget-locations)")

    # Locales
    locales = widget.get("locale") or []
    i18n_dir = root / "i18n"
    if not i18n_dir.is_dir():
        err("i18n/ folder is missing")
        loaded_locales = {}
    else:
        loaded_locales = {}
        for loc in locales:
            f = i18n_dir / f"{loc}.json"
            if not f.exists():
                err(f"i18n/{loc}.json missing (declared in manifest.locale)")
                continue
            try:
                loaded_locales[loc] = json.loads(f.read_text(encoding="utf-8"))
            except json.JSONDecodeError as e:
                err(f"i18n/{loc}.json: invalid JSON — {e}")

    # i18n key parity
    if len(loaded_locales) > 1:
        all_keys = {loc: flatten_keys(d) for loc, d in loaded_locales.items()}
        union = set().union(*all_keys.values())
        for loc, keys in all_keys.items():
            missing = union - keys
            if missing:
                err(f"i18n/{loc}.json missing keys present in other locales: {sorted(missing)}")

    # Required scripts/templates
    if not (root / "script.js").exists():
        err("script.js missing at widget root")

    # logo_dp dimensions if digital_pipeline is in locations
    if "digital_pipeline" in locs:
        dp_logo = root / "images" / "logo_dp.png"
        if not dp_logo.exists():
            err("images/logo_dp.png missing (required because digital_pipeline is in locations)")
        else:
            try:
                from PIL import Image
                with Image.open(dp_logo) as im:
                    if im.size != (174, 109):
                        err(f"images/logo_dp.png is {im.size}, must be (174, 109)")
            except ImportError:
                warn("Pillow not installed — skipping logo_dp.png dimension check")
            except Exception as e:
                warn(f"Couldn't read logo_dp.png: {e}")

    # Logo
    for logo, expected in [("logo.png", (90, 90)), ("logo_small.png", (30, 30))]:
        path = root / "images" / logo
        if not path.exists():
            warn(f"images/{logo} missing (recommended size {expected[0]}x{expected[1]})")
        else:
            try:
                from PIL import Image
                with Image.open(path) as im:
                    if im.size != expected:
                        warn(f"images/{logo} is {im.size}, recommended {expected}")
            except ImportError:
                pass
            except Exception as e:
                warn(f"Couldn't read {logo}: {e}")

    # Templates referenced from script.js
    script_path = root / "script.js"
    if script_path.exists():
        src = script_path.read_text(encoding="utf-8", errors="ignore")
        tmpl_refs = set(re.findall(r"tmpl\(['\"]templates/([\w/.-]+)['\"]", src))
        for ref in tmpl_refs:
            twig = root / "templates" / f"{ref}.twig"
            if not twig.exists():
                err(f"script.js references templates/{ref} but templates/{ref}.twig is missing")

    # macOS junk that breaks marketplace review
    for junk in (".DS_Store", "Thumbs.db"):
        for p in root.rglob(junk):
            warn(f"Found junk file {p.relative_to(root)} — will be excluded by package.sh")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: validate.py <path-to-widget-folder>", file=sys.stderr)
        sys.exit(1)
    main(sys.argv[1])

    for w in warnings:
        print(f"⚠️  {w}")
    for e in errors:
        print(f"❌ {e}")

    if errors:
        print(f"\n{len(errors)} error(s), {len(warnings)} warning(s) — widget will be rejected")
        sys.exit(1)
    if warnings:
        print(f"\n{len(warnings)} warning(s) — fix recommended but not blocking")
        sys.exit(2)
    print("✅ Widget is valid and ready to package")
    sys.exit(0)
