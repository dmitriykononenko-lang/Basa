# Walkthrough — building a real widget end-to-end

This walkthrough builds a complete, marketplace-quality widget so you can see how the pieces fit. The widget:

- Shows the **annual revenue** of the company linked to the current contact, fetched from a third-party data provider.
- Has a **settings page** where the admin enters the data provider's API key.
- Has a **Digital Pipeline action** "Refresh revenue when lead enters stage" that re-pulls the revenue and writes it into a custom field.
- Registers itself as a **lead_source** so deals created from "revenue research" attribute correctly.

Call the widget code `revcheck`.

## 0 — Account preparation

Before writing code:

1. Create an integration in the dev cabinet → "Widget" type → save.
2. Copy the **integration code** (`revcheck_xxxxx`) and **secret_key**.
3. In *Settings → Custom fields → Companies*, add a numeric field "Annual Revenue (USD)". Note the field id (let's say `987654`).
4. In *Settings → Pipelines*, find the pipeline / stage you want the DP action to fire on. Note the pipeline id and status id.

## 1 — File tree

```
revcheck/
├── manifest.json
├── script.js
├── i18n/
│   ├── ru.json
│   └── en.json
├── images/
│   ├── logo.png        (90x90)
│   ├── logo_small.png  (30x30)
│   └── logo_dp.png     (174x109)
└── templates/
    ├── card.twig
    ├── settings.twig
    └── dp_settings.twig
```

## 2 — manifest.json

```json
{
  "widget": {
    "name": "widget.name",
    "short_description": "widget.short_description",
    "description": "widget.description",
    "version": "1.0.0",
    "interface_version": 2,
    "init_once": false,
    "locale": ["ru", "en"],
    "installation": "y",
    "support": {
      "link":  "https://revcheck.example.com/support",
      "email": "support@revcheck.example.com"
    },
    "code": "revcheck_xxxxx",
    "secret_key": "PASTE_FROM_CABINET"
  },
  "oauth": "Y",
  "locations": ["ccard-1", "comcard-1", "settings", "digital_pipeline", "lead_sources"],
  "settings": {
    "provider_api_key": {
      "name": "settings.provider_api_key",
      "type": "pass",
      "required": true
    }
  },
  "dp": {
    "settings": {
      "field_id": {
        "name": "dp.field_id",
        "type": "list",
        "values": {
          "987654": "dp.field_revenue"
        },
        "default": "987654"
      }
    }
  },
  "free": "Y",
  "countries": ["*"],
  "category": "sales"
}
```

`oauth: "Y"` because we read company custom fields via the amoCRM REST API — we need a real bearer token.

## 3 — i18n/ru.json

```json
{
  "widget": {
    "name": "RevCheck",
    "short_description": "Подтягивает годовую выручку компании в карточку контакта",
    "description": "RevCheck автоматически показывает выручку компании, связанной с контактом, прямо в карточке. Также доступна автоматизация Digital Pipeline: обновить выручку при переходе сделки на стадию."
  },
  "settings": {
    "provider_api_key": "Ключ API провайдера",
    "help_text": "Получите ключ на dashboard.revprovider.com → Settings → API"
  },
  "card": {
    "title": "Выручка компании",
    "no_company": "Контакт не связан с компанией",
    "no_data": "Нет данных по этой компании",
    "refresh": "Обновить",
    "loading": "Загрузка..."
  },
  "dp": {
    "field_id": "Куда записать значение",
    "field_revenue": "Annual Revenue"
  },
  "source": { "name": "RevCheck research" },
  "errors": {
    "required": "Обязательное поле",
    "network":  "Ошибка сети",
    "no_key":   "Введите ключ API в настройках"
  },
  "notify": {
    "refreshed": "Выручка обновлена",
    "failed":    "Не удалось получить данные"
  }
}
```

(`en.json` mirrors the structure with English values — every key from `ru.json` must appear there.)

## 4 — templates/card.twig

```twig
<div class="revcheck-card">
  {% if not entity.company %}
    <p class="revcheck-card__placeholder">{{ langs.card.no_company }}</p>
  {% elseif state.loading %}
    <p class="revcheck-card__placeholder">{{ langs.card.loading }}</p>
  {% elseif state.revenue is null %}
    <p class="revcheck-card__placeholder">{{ langs.card.no_data }}</p>
  {% else %}
    <div class="revcheck-card__row">
      <span class="revcheck-card__label">{{ langs.card.title }}:</span>
      <span class="revcheck-card__value">${{ state.revenue|number_format(0, '.', ',') }}</span>
    </div>
    <p class="revcheck-card__meta">
      {{ entity.company.name|escape }} · updated {{ state.updated_at|date('Y-m-d') }}
    </p>
  {% endif %}

  <button type="button" class="button-input button-input-white revcheck-card__refresh js-revcheck-refresh">
    {{ langs.card.refresh }}
  </button>
</div>
```

## 5 — script.js

```js
define(['jquery', 'lib/components/base/modal', 'underscore'], function ($, Modal, _) {
  return function () {
    var self = this;
    var BACKEND = 'https://revcheck.example.com';

    function callBackend(path, payload) {
      var dfd = $.Deferred();
      $.ajax({
        url: BACKEND + path,
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify(_.extend({
          account_id: AMOCRM.constant('account').id,
          subdomain:  AMOCRM.constant('account').subdomain,
          widget_code: self.params.widget_code
        }, payload))
      }).done(dfd.resolve).fail(dfd.reject);
      return dfd.promise();
    }

    function notify(key, color) {
      AMOCRM.notifications.add_alert({
        text: self.i18n('notify')[key] || key,
        color: color || 'white'
      });
    }

    function renderCard(state) {
      self.render_template(
        {
          caption: { class_name: 'js-revcheck-cap', html: self.i18n('card').title },
          body:    '',
          render:  self.params.tmpl('templates/card')
        },
        {
          entity: AMOCRM.data.current_card,
          state:  state
        }
      );
    }

    this.callbacks = {
      render: function () {
        var area = self.system().area;
        if (area === 'contact-card' || area === 'company-card') {
          renderCard({ loading: true });
        }
        return true;
      },

      init: function () {
        var settings = self.get_settings();
        if (!settings || !settings.provider_api_key) {
          renderCard({ loading: false, revenue: null });
          return true;
        }

        var card = AMOCRM.data.current_card;
        if (!card) return true;

        // For contacts, resolve linked company first. For company cards, use it directly.
        var companyId;
        if (card.type === 2) {
          // contact — read linked company from card model
          var linked = (card.model && card.model.get && card.model.get('linked_companies')) || [];
          companyId = linked[0] && linked[0].id;
        } else if (card.type === 3) {
          companyId = card.id;
        }

        if (!companyId) { renderCard({ loading: false, revenue: null }); return true; }

        callBackend('/api/revenue', { company_id: companyId })
          .done(function (resp) {
            renderCard({ loading: false, revenue: resp.revenue, updated_at: resp.updated_at });
          })
          .fail(function () {
            notify('failed', 'red');
            renderCard({ loading: false, revenue: null });
          });

        // Self-attribute as a lead source.
        if (self.add_source) {
          self.add_source(self.params.widget_code, {
            name: self.i18n('source').name,
            code: self.params.widget_code,
            icon: self.params.path + '/images/logo_small.png',
            settings: settings
          });
        }

        return true;
      },

      bind_actions: function () {
        $(self.render_object || document)
          .off('click.revcheck')
          .on('click.revcheck', '.js-revcheck-refresh', function () {
            self.callbacks.init();
          });
        return true;
      },

      settings: function ($modal_body) {
        var saved = self.get_settings() || {};
        var help = $('<p class="widget_settings_block__descr"></p>').text(self.i18n('settings').help_text);
        $modal_body.find('.widget_settings_block').append(help);

        $modal_body.off('click.revcheck-save').on('click.revcheck-save', '.widget_settings_block__btn_save', function (e) {
          var key = $modal_body.find('input[name="provider_api_key"]').val();
          if (!key) {
            e.preventDefault();
            return false;
          }
        });

        return true;
      },

      dpSettings: function () {
        var $modal = $('.modal-body');
        $modal.find('.dp_action__params').html(self.render({
          render: self.params.tmpl('templates/dp_settings')
        }, {
          saved: $modal.data('config') || {}
        }));
        return true;
      },

      destroy: function () {
        $(self.render_object || document).off('.revcheck .revcheck-save');
      }
    };

    return this;
  };
});
```

## 6 — Backend endpoints

Your service exposes three endpoints:

**`POST /oauth/callback`** — handles the OAuth code exchange (see `backend.md` §1). Stores `{ account_id, access_token, refresh_token }`.

**`POST /api/revenue`** — called from the widget JS.

```python
@app.post("/api/revenue")
def get_revenue():
    body = request.get_json()
    account_id = body["account_id"]
    company_id = body["company_id"]

    # Look up provider key (stored at install via the settings save).
    api_key = db.get_provider_key(account_id)
    if not api_key:
        return {"error": "no_key"}, 400

    # Look up the company in the account to get its name / domain.
    token = oauth.get_token(account_id)  # refreshes if needed
    company = amocrm_api.get(f"/api/v4/companies/{company_id}", token=token)
    domain = extract_domain(company)

    # Call the data provider.
    revenue = provider.lookup_revenue(domain, api_key=api_key)
    return {"revenue": revenue, "updated_at": now_iso()}
```

**`POST /dp/hook`** — registered in the cabinet as the DP webhook URL. Receives DP payload, refreshes revenue, writes it to the company's custom field.

```python
@app.post("/dp/hook")
def dp_hook():
    if not verify_signature(request):
        return ("invalid signature", 401)

    form = request.form  # form-urlencoded DP payload
    account_id = int(form["account[id]"])
    lead_id    = int(form["leads[status][0][id]"])
    field_id   = int(form["params[field_id]"])

    token = oauth.get_token(account_id)
    lead = amocrm_api.get(f"/api/v4/leads/{lead_id}?with=contacts", token=token)
    company_id = (lead.get("_embedded", {}).get("companies") or [{}])[0].get("id")
    if not company_id:
        return {"result": "no_company"}

    api_key = db.get_provider_key(account_id)
    company = amocrm_api.get(f"/api/v4/companies/{company_id}", token=token)
    domain = extract_domain(company)
    revenue = provider.lookup_revenue(domain, api_key=api_key)

    amocrm_api.patch(f"/api/v4/companies/{company_id}", token=token, json={
        "custom_fields_values": [
            {"field_id": field_id, "values": [{"value": revenue}]}
        ]
    })

    return {"result": "ok", "message": f"Set ${revenue:,.0f}"}
```

## 7 — Package and ship

```bash
cd revcheck
zip -r ../revcheck-1.0.0.zip . -x "*.DS_Store" -x "__MACOSX/*"
unzip -l ../revcheck-1.0.0.zip | head        # verify manifest.json is at root
```

Upload to the dev cabinet → status "uploaded". Install on a test account → confirm the contact card shows revenue → click the DP action through a stage → confirm the company custom field updates → uninstall → confirm cleanup. Submit for marketplace review.

## 8 — What this example teaches

- **`init` is where work happens.** `render` paints the skeleton; `init` fetches data and re-renders.
- **Card type detection.** `card.type === 2` is a contact; `3` is a company. The walkthrough handles both card surfaces from the same widget.
- **Two backend surfaces.** Widget JS hits `/api/revenue` for read-on-demand. DP webhook hits `/dp/hook` for write-on-event. They share the same OAuth tokens / provider-key store.
- **Three-way data flow.** Widget JS ↔ your backend ↔ amoCRM REST API ↔ data provider. Each leg is independently authenticated.
- **Self-attribution as lead_source.** One line in `init`: `self.add_source(...)`. The widget shows up as a source filter in the leads list.

Real widgets diverge from this in many directions — more fields, more DP variants, multi-step flows, websockets for live updates. But the skeleton above is reusable for ~80% of widget projects.
