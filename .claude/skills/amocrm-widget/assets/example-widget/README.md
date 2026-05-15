# example-widget

A working amoCRM / Kommo widget skeleton wiring up all four main surfaces in one file tree:

- **Card panel** in leads, contacts, companies (`lcard-1`, `ccard-1`, `comcard-1`)
- **Settings** activation modal with API-key validation
- **Advanced settings** page with a sync-interval picker
- **Digital Pipeline** action with a per-step template selector
- **Lead source** self-registration via `add_source()`

## How to use this template

```bash
# 1. Copy this folder to your project
cp -r example-widget my-widget
cd my-widget

# 2. Create the integration in the dev cabinet (https://www.amocrm.ru/developers).
#    Copy the integration code and secret_key from there.

# 3. Edit manifest.json:
#    - widget.code → your integration code (e.g., "my_widget_12345")
#    - widget.secret_key → the secret from the cabinet
#    - widget.support.link / .email → your URLs
#    - widget.name keys in i18n/{ru,en}.json → your widget name
#    - locations → trim to what you actually need
#    - settings, advanced, dp.settings → adapt fields

# 4. Validate
python3 ../scripts/validate.py .

# 5. Generate proper placeholder images (or replace with real branding)
python3 ../scripts/gen_placeholders.py . MY

# 6. Package
../scripts/package.sh . ./dist
# → dist/my_widget_12345-1.0.0.zip ready to upload to the cabinet
```

## File map

```
example-widget/
├── manifest.json           # all four surfaces declared
├── script.js               # AMD module, every callback implemented
├── i18n/
│   ├── ru.json             # 32 keys
│   └── en.json             # same 32 keys
├── images/
│   ├── logo.png            # 90x90
│   ├── logo_small.png      # 30x30
│   └── logo_dp.png         # 174x109 — required for DP
├── templates/
│   ├── card.twig           # card-panel body
│   ├── advanced_settings.twig
│   └── dp_settings.twig
└── README.md               # this file
```

## Backend expected

`script.js` makes POST requests to `BACKEND_URL` (a constant at the top of the file). Endpoints expected:

| Path | When called |
| --- | --- |
| `/widget/card-init` | On entering a card, to hydrate the panel |
| `/widget/save` | When user clicks "Save" in the card |
| `/widget/advanced-save` | When user saves advanced settings |
| `/widget/bulk-leads`, `/widget/bulk-contacts`, `/widget/bulk-companies` | List-view bulk actions |

DP webhook URL is configured separately in the dev cabinet (Integration → Hooks tab), not in `script.js`. See `references/backend.md` in the parent skill for payload formats.

## Validation expectations

After replacing `secret_key`, `validate.py` should print "✅ Widget is valid and ready to package". The placeholder template intentionally fails validation so you don't forget this step.
