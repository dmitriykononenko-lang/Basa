# Packaging and publishing

## Creating the integration in the developer cabinet

Before you upload any zip:

1. Go to `https://www.amocrm.ru/developers` (RU) or `https://www.kommo.com/developers` (international). Log in with the same account that will own the widget.
2. Click "Create integration". Pick the right type — most widgets are "Widget for amoCRM" or "Public widget" (marketplace).
3. Fill in: name, descriptions, redirect URI (only if OAuth), permissions / scopes, support contacts.
4. The cabinet generates a **code** (the integration's machine id) and a **secret key**. Copy both — these go into `manifest.json` (`widget.code` and `widget.secret_key`).
5. If the widget is OAuth-based, also copy the `client_uuid` and configure the redirect URI to match exactly what your backend handles.

You can't change `code` after creation. `secret_key` can be rotated, but you'll need to re-upload the widget archive with the new value.

## Zipping the widget

The archive's **root** must contain `manifest.json` directly — *not* a parent folder with everything inside. This is the single most common packaging bug.

From the widget directory:

```bash
cd /path/to/widget
zip -r ../mywidget.zip . -x "*.DS_Store" -x "__MACOSX/*" -x ".git/*" -x "node_modules/*"
```

Cross-check by listing the archive contents:

```bash
unzip -l ../mywidget.zip
```

You should see entries like `manifest.json`, `script.js`, `i18n/ru.json` — not `widget/manifest.json`.

On macOS, `zip` adds `.DS_Store` and `__MACOSX/` resource forks by default; the `-x` flags above strip them. The marketplace review will flag a zip with `__MACOSX/` as non-conformant.

## Uploading

In the developer cabinet, on your integration's page:

1. Click "Upload widget" / "Upload archive".
2. Choose the zip.
3. The cabinet validates the manifest (JSON syntax + required fields) and signs the archive.
4. Status flips to "uploaded". For private widgets, the integration is now installable on accounts you authorize. For marketplace widgets, you also click "Send for review".

## Versioning

`manifest.widget.version` must be bumped on every re-upload. Semver:

- Patch (`1.0.0` → `1.0.1`) — bug fix, no behavior change.
- Minor (`1.0.1` → `1.1.0`) — new feature, backward compatible.
- Major (`1.1.0` → `2.0.0`) — breaking change (e.g., manifest schema, settings shape).

The cabinet rejects uploads where `version` ≤ the latest uploaded version.

Recommended workflow: bump version in the same commit as the change, tag the commit (`git tag v1.2.0`), then upload from the tagged checkout. This makes "what's in production?" answerable.

## Private vs public widgets

**Private** (in-account or single-customer):

- No marketplace listing.
- Installable via the integration's install URL or by widget code+secret.
- No marketplace review.
- Use when the widget is for one specific account or a customer-specific integration.

**Public** (marketplace):

- Listed at `marketplace.amocrm.ru` / `kommo.com/marketplace`.
- Marketplace team reviews the archive, manifest, descriptions, screenshots.
- Reviewers test install + uninstall flow, check for hardcoded strings, validate that `description` matches actual behavior.
- Approval typically 3–10 business days.
- Required fields beyond private widgets: `free` flag, `countries`, `category`, marketplace-quality screenshots (1280×800 px), at least one demo video for complex widgets.

## Marketplace review checklist

The review fails for these reasons most often. Run through this before submitting:

- **Hardcoded strings.** Every visible string comes from i18n. Reviewers grep the code.
- **Missing locales.** `manifest.locale` declares `en` but no `i18n/en.json`. Or vice versa.
- **`description` inflates capabilities.** Don't promise features the widget doesn't deliver. Reviewers actually install and try.
- **No support contact.** `support.link` returns 404 or the email bounces — auto-rejected.
- **Wrong `logo_dp.png` size** (for DP widgets). Must be 174×109 px.
- **Console errors on install.** Reviewers install the widget on a test account and watch the console. JS errors during `render`/`init` = rejected.
- **Doesn't uninstall cleanly.** Widget leaves DOM artifacts, timers running after `destroy`. Implement `destroy` properly.
- **Permission overreach.** Widget asks for OAuth scopes it doesn't actually need.

## OAuth-specific gotchas

If `oauth: "Y"` in manifest:

- Redirect URI in dev cabinet must exactly match the URL your backend listens on. `http` vs `https`, trailing slash, port — all break the flow.
- Access tokens expire after 24 hours; implement refresh-token rotation.
- The `client_uuid` is your widget's integration id, not the account id. Don't mix them up in backend logs.
- Store tokens encrypted at rest — marketplace reviewers may ask about your security model.

## Updating an already-installed widget

For accounts that have your widget installed:

- Patch / minor: silent update. Users see new behavior next page load.
- Major: amoCRM does not auto-uninstall — old version keeps running until the user reinstalls. If you make breaking manifest changes (e.g., remove a setting), provide a migration in `init` that handles both old and new shapes.

Plan major bumps deliberately. For widely-installed widgets, support both old and new settings shapes for at least one release cycle.

## Local development tips

- amoCRM doesn't natively support "dev mode" loading from localhost. Workarounds:
  - Iterate quickly: edit files, zip, re-upload. Tedious but reliable.
  - Use a reverse proxy / Charles to intercept the widget asset requests and serve from your local filesystem.
  - For backend logic, run the backend on a public URL (ngrok, cloudflared) so DP webhooks reach it during dev.
- Test on a fresh free-tier account before submitting — your dev account often has elevated scopes and surface area that hide bugs visible to new users.
- Clear browser cache aggressively between iterations — the loader caches `script.js` and templates.

## CI / build automation

For non-trivial widgets, set up:

1. JSON-lint `manifest.json` and every `i18n/*.json` in pre-commit.
2. A diff check that fails if `i18n/en.json` has a key that other locales don't.
3. A version-bump check that fails if `manifest.widget.version` wasn't bumped since the previous commit.
4. A `package.sh` that zips with the right exclusions and outputs a versioned archive name (`mywidget-1.2.0.zip`).

```bash
#!/usr/bin/env bash
set -e
VERSION=$(python -c 'import json; print(json.load(open("manifest.json"))["widget"]["version"])')
NAME=$(python -c 'import json; print(json.load(open("manifest.json"))["widget"]["code"])')
OUT="dist/${NAME}-${VERSION}.zip"
mkdir -p dist
rm -f "$OUT"
zip -r "$OUT" . \
  -x "*.DS_Store" -x "__MACOSX/*" -x ".git/*" -x "node_modules/*" \
  -x "dist/*" -x "*.md" -x "package.sh"
echo "Built $OUT"
```

Run before each upload. Keep the dist directory under git-ignore.
