---
name: amocrm-widget
description: Build, scaffold, and ship widgets for amoCRM / Kommo — including right-panel card widgets (lcard/ccard/comcard), settings widgets, Salesbot & Digital Pipeline widgets, and SSO / chat-channel / lead-source integrations. Use this skill whenever the user mentions amoCRM, Kommo, "виджет", widget manifest.json, AMOCRM.widgets, callbacks.render/init/bind_actions/settings/dpSettings, custom_fields with widget code, digital pipeline integration, lead_sources, chat channel, salesbot, или просит "сделать виджет для амо", "написать манифест для kommo", "упаковать виджет в zip", "опубликовать виджет в маркетплейсе amo". Trigger even when the user names only a fragment (e.g., "manifest для амо", "callbacks render", "twig в амо"), or asks for help debugging a widget that isn't loading — those are all in scope.
---

# amoCRM / Kommo Widget Builder

A skill for building production-ready widgets for amoCRM (now branded as Kommo internationally). It covers the full lifecycle: choosing the right widget type, scaffolding the file tree, writing `manifest.json` and `script.js`, rendering Twig templates, wiring i18n, packaging the zip, and uploading to the developer cabinet / marketplace.

This is written for developers who already know JS — it explains amoCRM-specific behavior, not JavaScript basics.

## When this skill applies

Use it whenever the deliverable is a widget that will be installed inside amoCRM/Kommo. The four widget families this skill supports:

1. **Right-panel widgets in entity cards** — leads (`lcard`), contacts (`ccard`), companies (`comcard`), customers, lists. Shown when a user opens a deal/contact/company.
2. **Settings widgets** — the configuration UI shown when a user activates or reconfigures the widget under *Settings → Integrations*.
3. **Salesbot / Digital Pipeline widgets** — actions that fire from the visual pipeline automation, including the `dpSettings` modal that lets admins configure each step.
4. **SSO and channel integrations** — single sign-on, chat channels (omnichannel "Chats" API), `lead_sources` widgets. These widgets often have minimal UI but heavy backend wiring.

Most real widgets combine several of these (e.g., a settings UI + a card panel + a DP action). The same `manifest.json` and `script.js` cover all of them — you just register multiple `locations` and multiple callbacks.

## Process

Run the steps in this order. Each one corresponds to a section of the reference docs.

### Step 1 — Clarify what's being built

Before writing any code, confirm with the user:

- **Which locations** does the widget need? (list of `locations` keys — see `references/manifest.md`)
- **Backend** — is there a backend the widget talks to (OAuth integration, webhook receivers, REST API)? Or is the widget pure-frontend (e.g., a button that calls a third-party JS SDK)?
- **Auth model** — does it use amoCRM's OAuth 2.0 (client_uuid / `oauth` flag in manifest), or just an API key the user enters in settings?
- **Single-account vs marketplace** — private widget installed by code/secret, or public widget for the marketplace (different review and signing rules).
- **Locales required** — at minimum `ru` and `en`; `es` and `pt` for Kommo's LATAM/BR markets.

If the user already gave answers in earlier turns, don't re-ask — just confirm the summary and move on.

### Step 2 — Scaffold the file tree

The canonical layout that the amoCRM widget loader expects:

```
widget/
├── manifest.json          # required, at archive root
├── script.js              # required, AMOCRM.widgets entry point
├── i18n/                  # required
│   ├── ru.json
│   ├── en.json
│   ├── es.json            # optional
│   └── pt.json            # optional
├── images/                # required
│   ├── logo.png           # 90x90 (or as defined in manifest)
│   ├── logo_small.png     # 30x30
│   └── logo_dp.png        # 174x109, required if widget appears in DP
└── templates/             # Twig templates loaded by script.js
    ├── settings.twig
    ├── advanced_settings.twig
    ├── dp_settings.twig
    └── card.twig
```

When generating the scaffold, copy the templates from `assets/`:

- `assets/manifest.json.template` → `manifest.json`
- `assets/script.js.template` → `script.js`
- `assets/i18n/ru.json` and `assets/i18n/en.json` → `i18n/`
- `assets/templates/*.twig` → `templates/`

The templates are annotated with comments explaining each block; strip the comments before shipping to production.

### Step 3 — Fill in `manifest.json`

The manifest is the single most error-prone file — most "widget doesn't appear" tickets trace back to it. Read `references/manifest.md` for the full field reference, then adjust three things per widget:

- **`widget` block** — `code` (matches developer-cabinet integration code), `secret_key` (generated in the cabinet, paste here), `version` (semver), `interface_version` (current spec, see ref), `locale`, `installation` (`y`/`n`), `support` (contact info shown in marketplace).
- **`locations` array** — pick from the canonical list in `references/widget-types.md`. The values `1` or `0` after `lcard-1`/`ccard-1`/`comcard-0` etc. control whether the widget appears in the right-side panel of that card type. Don't confuse them with booleans — they're location names that *include* the panel flag as a suffix.
- **`settings` object** — declares the fields that appear in the activation form. Each field is keyed by id; supported types are `text`, `pass`, `custom`, `users`, `users_lp`, `list`. The values are picked up in `script.js` via `self.get_settings()`.

For widgets that need OAuth 2.0 against the amoCRM API itself (not third-party), set the top-level `oauth: "Y"` flag — this enables `AMOCRM.constant('account')` to return the right keys.

### Step 4 — Write `script.js`

The entry point is always `define(['jquery', 'lib/components/base/modal'], function ($, Modal) { return function () { ... } })`. Inside the constructor you populate `this.callbacks = { ... }`. Read `references/script-js.md` for the full callback reference. The four most important callbacks:

- **`render`** — runs first when the widget is shown. Must `return true` or nothing else fires. This is where you call `self.render_template({ caption, body, ref })` to inject Twig output.
- **`init`** — talk to your backend, prefetch data, set up state. Must `return true`.
- **`bind_actions`** — attach event listeners. Must `return true`.
- **`settings`** — fires when the user opens the widget's settings modal. Use it to render `templates/settings.twig` into the modal and wire the save button.

For DP widgets add **`dpSettings`** (configures the action inside Digital Pipeline). For widgets that need a config screen beyond the default activation form, add **`advancedSettings`** and register `advanced_settings.twig`.

### Step 5 — Templates (Twig)

amoCRM's frontend renders templates with a Twig-compatible engine. Templates live in `templates/*.twig` and are loaded via `self.render_template`. The available variables and filters (and the gotchas — e.g., `{% raw %}` for embedded Vue, escaping rules) are documented in `references/twig-templates.md`. Don't put script tags inside Twig templates — the loader strips them in some contexts.

### Step 6 — Localization

Every user-facing string must come from `i18n/<locale>.json`, not be hardcoded. In `script.js`, access via `self.i18n('section').key` or `self.i18n('section.key')`. In `manifest.json`, reference strings by JSON path (e.g., `"widget.name": { "ru": "Мой виджет", "en": "My widget" }` if you embed them, or use the `name` field as an i18n key). See `references/i18n.md` for the exact resolution order and the `set_lang()` escape hatch.

### Step 7 — Package and upload

Zip the contents — **not** the parent folder. The archive root must contain `manifest.json` directly. Then upload to the developer cabinet (`https://www.amocrm.ru/developers` / `https://www.kommo.com/developers`). See `references/packaging.md` for the exact zip command, gotchas around hidden `.DS_Store` files, version bumping, and the marketplace review checklist.

## Choosing the right widget type

When in doubt, follow this decision tree:

- **Show data in a deal/contact/company card** → right-panel widget (`lcard-1` / `ccard-1` / `comcard-1`). Read `references/widget-types.md#right-panel`.
- **Configure third-party service credentials once at install time** → settings widget. The activation form covers most cases; for richer UI add `advancedSettings`. Read `references/widget-types.md#settings`.
- **Trigger an action from pipeline automation** → Digital Pipeline widget. Requires `digital_pipeline` in locations, `dpSettings` callback, `logo_dp.png`, and a backend endpoint that receives the DP webhook. Read `references/widget-types.md#digital-pipeline`.
- **Add a messenger / SMS / call channel** → chat channel or `lead_sources` widget. Different from card widgets — they integrate with the Chats API or the Lead Sources mechanism. Read `references/widget-types.md#sso-and-channels`.

A single widget can register in several of these locations at once; just list them all in `manifest.locations` and implement the matching callbacks.

## Reference files

Read these on demand — they're too detailed to keep in working memory.

**Frontend / widget itself:**

- `references/manifest.md` — every field of `manifest.json`, all `locations` values with explanations of which UI surface each one paints.
- `references/script-js.md` — full callback reference, `self.*` API, AMOCRM globals, modal helpers, async patterns.
- `references/widget-types.md` — type-by-type breakdown: required locations, callbacks, assets, common pitfalls for the four families.
- `references/twig-templates.md` — Twig syntax in amoCRM's renderer (verified against twig.js), gotchas, variable passing.
- `references/i18n.md` — locale file structure, lookup order, `set_lang` runtime override.

**Backend / production / marketplace:**

- `references/backend.md` — OAuth 2.0 flow (authorize + refresh + JWT claims), REST API v4 basics, webhook signature verification, DP and Salesbot payload formats, security checklist.
- `references/chats-api.md` — amojo channel lifecycle (`scope_id`), HMAC-SHA1 request signing, message envelopes, inbound/outbound webhooks.
- `references/packaging.md` — zip rules, code/secret, marketplace categories, submission review checklist, CI patterns.

**End-to-end:**

- `references/walkthrough.md` — full worked example: build a "company revenue" widget from manifest to backend to upload, in one file.

## Asset templates

Copy and adapt — these are working starting points.

- **`assets/example-widget/`** — fully-wired working sample, all four surfaces in one tree. `cp -r assets/example-widget my-widget` is the fastest way to start. See its README for the customization steps.
- `assets/manifest.json.template`, `assets/script.js.template` — standalone annotated templates if you'd rather build piece by piece.
- `assets/i18n/{ru,en}.json` — minimal locale skeleton with the most common keys.
- `assets/templates/{card,settings,advanced_settings,dp_settings,sso}.twig` — twig snippets for each callback surface.

## Helper scripts

These live in `scripts/` and exist to prevent the most common mistakes that get widgets rejected.

- `scripts/validate.py <widget-dir>` — checks manifest JSON validity, required fields, locale parity, `logo_dp.png` dimensions (174×109), referenced templates exist, placeholder values were replaced. Exits non-zero on errors. Run before every package.
- `scripts/package.sh <widget-dir> [<out-dir>]` — runs validator, then zips with correct exclusions (`.DS_Store`, `__MACOSX/`, `.git/`, `node_modules/`, `scripts/`, markdown), placing `manifest.json` at archive root and naming the output `<code>-<version>.zip`.
- `scripts/i18n_diff.py <widget-dir>` — lists keys present in some locales but missing in others. Run any time you add or rename i18n keys.
- `scripts/gen_placeholders.py <widget-dir> [LABEL]` — generates the three required PNG sizes (90×90, 30×30, 174×109) so the widget validates even before final branding lands. Requires Pillow.

## Common pitfalls (read this once)

- **Widget doesn't appear after upload.** Almost always: wrong `code` or `secret_key`, wrong `locations` value, missing `interface_version`, or zip contains a parent folder instead of the manifest at root.
- **`callbacks.init` never runs.** `render` didn't return `true`. Check the browser console for the actual error; amoCRM's loader swallows some errors.
- **i18n keys show literally as `widget.name`.** The `i18n/<locale>.json` file is missing or malformed JSON (use `python -m json.tool` to validate).
- **DP widget configured but the pipeline step has no settings modal.** Missing `dpSettings` callback, or `logo_dp.png` isn't 174×109.
- **OAuth: token requests return 401.** `oauth: "Y"` not set in manifest, or the integration's redirect URI in the developer cabinet doesn't match what `AMOCRM.constant('account')` resolves to.
- **Card widget shows on the right but is empty.** `self.render_template` was called before the template loaded, or `render_template` was called outside `render()`/`bind_actions()` (timing issue — wrap async parts in promises and resolve before returning true).

## A note on terminology

amoCRM rebranded internationally to **Kommo** in 2022. The Russian product is still amoCRM; the docs at `developers.kommo.com` and the legacy docs at `amocrm.ru/developers` describe the same widget system, with the same `AMOCRM.widgets` JS namespace and the same `manifest.json` schema. If a user says either name, treat them as the same platform. The English docs at kommo.com are more current; the Russian docs at amocrm.ru are sometimes lagged but cover Russian-specific features.
