# Widget types — what's specific to each

The same widget package can register in multiple locations. This doc breaks down what's unique to each of the four families: which locations to declare, which callbacks to implement, what assets are required, and what fails most often.

## Right-panel (card) widgets

**Use when:** showing data or controls inside a lead, contact, company, or customer card. The widget appears in the right-side panel; clicking the widget icon expands it.

### Locations

Pick the cards you target. The `-1` suffix tells the loader to actually paint the right-panel block; `-0` loads the JS without painting (used when you only want list-view bulk actions).

```json
"locations": [
  "lcard-1",     "lcard-0",       // lead card
  "ccard-1",     "ccard-0",       // contact card
  "comcard-1",   "comcard-0",     // company card
  "cuscard-1",   "cuscard-0",     // customer (loyalty) card
  "llist-1",     "llist-0",       // lead list view
  "clist-1",     "clist-0",       // contact list view
  "comlist-1",   "comlist-0",     // company list view
  "card_sdk"                      // mount point for modern Vue card SDK
]
```

You almost always want either `-1` or `-0` per card type, not both.

### Required callbacks

- `render` — synchronously decide whether to paint, call `self.render_template` with `templates/card.twig`.
- `init` — pull the current entity (`AMOCRM.data.current_card`), fetch related data from your backend.
- `bind_actions` — wire the buttons inside the card panel.
- `destroy` — if you keep timers or sockets per-card, kill them here. Card widgets are re-instantiated on each navigation.

For list-view bulk actions, also implement:

```js
this.callbacks.leads = {
  selected: function () {
    var ids = AMOCRM.data.current_card_filter; // selected lead ids
    // bulk-modify via REST API or your backend
  }
};
// or .contacts.selected, .companies.selected
```

### Reading the current entity

```js
init: function () {
  var card = AMOCRM.data.current_card; // { id, type, name, model: {...} }
  if (!card) return true; // not on a card page
  // card.type === 1 (lead), 2 (contact), 3 (company), 12 (customer)
  self.entity_id = card.id;
  return true;
}
```

`model` is a Backbone-like wrapper around the live card state — listen to `change` events to react to user edits:

```js
card.model.on('change:cf', function () { /* custom field changed */ });
```

### Templates

`templates/card.twig` renders the panel body. Keep it small (cards are vertically constrained); use modals for big UI. Variables you usually pass to it:

```js
self.render_template(
  { caption: { class_name: 'js-mw__cap', html: self.i18n('card').title }, body: '', render: self.params.tmpl('templates/card') },
  { settings: self.get_settings(), entity: AMOCRM.data.current_card, user: AMOCRM.constant('user') }
);
```

### Pitfalls

- Forgetting that `render` must return `true` synchronously, or a deferred. Returning `undefined` silently aborts the widget.
- Putting heavy logic in `render` — UI freezes. Do prefetches in `init`, render skeleton in `render`, hydrate in `bind_actions`.
- Stacking duplicate event handlers: always namespace (`'click.mywidget'`) and `.off` before `.on`.
- Reading `current_card` before `init`. It's available, but the user might be on a list page where it's `null`.

## Settings widgets

**Use when:** the widget needs a configuration UI — either during install (activation form, almost always) or after install (advanced settings page).

### Locations

```json
"locations": ["settings", "advanced_settings"]
```

`settings` is for the install-time activation modal (it's added implicitly when `installation: "y"` and you declare a `settings` block in manifest, but list it explicitly to be safe). `advanced_settings` adds a separate full-page settings UI accessible from the widget tile.

### Required callbacks

- `settings($modal_body)` — render the activation modal body if you have custom (`type: "custom"`) fields, or wire validation. For all-built-in-types widgets, you can skip implementing this — amoCRM handles the form automatically from `manifest.settings`.
- `advancedSettings()` — render the full advanced settings page. The mount point varies by amoCRM version; consult `self.params.advancedSettingsRender` or the modal helper.

### When `settings` callback is actually called

- On install: after the user clicks "Install" on the marketplace listing.
- On reconfigure: when an admin clicks "Settings" on the installed widget tile.

The `$modal_body` jQuery object is the form's body — `manifest.settings`'s built-in fields are already inside it; you append custom fields below.

```js
settings: function ($modal_body) {
  var saved = self.get_settings();
  var customHtml = self.render({ render: self.params.tmpl('templates/settings_custom') }, { saved: saved });
  $modal_body.find('.widget_settings_block').append(customHtml);

  // Custom validation:
  $modal_body.on('click', '.widget_settings_block__btn_save', function (e) {
    if (!validate($modal_body)) {
      e.preventDefault();
      $modal_body.find('.js-error').text(self.i18n('errors').required);
      return false;
    }
  });

  return true;
}
```

### Pitfalls

- `manifest.settings` declares the fields, but the **labels** come from i18n. If the labels show literally as `settings.api_key`, your i18n file is missing the key.
- Custom fields (`type: "custom"`) don't auto-save — you have to post them yourself via `self.crm_post` or write them into the form's hidden input before submit.
- `required: true` only validates on built-in types; enforce custom requireds yourself.
- The activation modal can't be wider than ~600px reliably. Don't try to fit dashboards in there — use `advanced_settings`.

## Digital Pipeline (Salesbot adjacent) widgets

**Use when:** the widget should be triggerable from the visual pipeline (e.g., "when a lead enters stage X, send an SMS via this widget").

### Locations

```json
"locations": ["digital_pipeline"]
```

Often combined with `lcard-1` or `settings` because most DP widgets also want a per-card UI and shared settings.

### Required manifest blocks

```json
"dp": {
  "settings": {
    "template_id": { "name": "dp.template_id", "type": "list", "values": { "1": "dp.tpl_1" } }
  }
}
```

`dp.settings` declares default fields that show up in the DP step config modal. You can render additional fields in the `dpSettings` callback.

### Required assets

- `images/logo_dp.png` at **exactly 174×109 px**. If wrong size, the DP action appears with a broken image and won't pass marketplace review.

### Required callbacks

- `dpSettings()` — render the DP step config UI. Like `settings`, but the modal is the DP step's modal.
- A backend endpoint registered in the developer cabinet: when the pipeline step runs, amoCRM POSTs to this URL with the lead/contact, account info, and the saved field values.

```js
dpSettings: function () {
  var $modal = $('.modal-body');
  $modal.html(self.render({ render: self.params.tmpl('templates/dp_settings') }, { saved: $modal.data('config') || {} }));
  // Wire field changes — they auto-persist into the pipeline config when the modal saves
  return true;
}
```

### How the backend webhook works

When the pipeline fires the step, your endpoint receives a POST with form-urlencoded body like:

```
account[id]=12345
account[subdomain]=mycompany
leads[status][0][id]=999
leads[status][0][status_id]=142
leads[status][0][pipeline_id]=10
... + your config fields
```

Validate the `amohash` if you've set up signature verification. Respond `200 OK` to acknowledge.

### Pitfalls

- Wrong `logo_dp.png` size — the most common DP submission rejection.
- Forgetting that DP fires for every pipeline movement matching the trigger — idempotency matters. Store a job key in your backend so re-fires don't double-send.
- `dpSettings` modal: the saved config is per-step, not per-widget. Different pipeline steps using the same widget action have independent configs.
- The DP step config is sent to your webhook as `params[<field_id>]`. Don't expect the same names as `self.get_settings()` (which is global widget settings).

### Salesbot designer integration

If you want the widget action to be available inside the Salesbot bot designer (newer than DP, separate UI), declare:

```json
"salesbot_designer": {
  "send_message": {
    "handler_code": "my_widget_send_message",
    "params": {
      "text": { "type": "text", "name": "sb.text" }
    }
  }
}
```

Backend endpoint receives the params and bot context (current lead, conversation id) and returns the next step.

## SSO and channel / lead-source widgets

**Use when:** the widget is a messenger / SMS / telephony / chat integration, an OAuth SSO bridge, or a "source of leads" (the widget appears in the *Sources of Leads* section).

### Locations

```json
"locations": [
  "lead_sources",   // appears in Settings → Sources of Leads
  "chats",          // chats sidebar integration (Chats API)
  "sms",            // SMS provider
  "settings"        // for the OAuth/credentials config
]
```

For pure SSO (auth-only, no UI), you might just register `settings` and rely on the backend OAuth flow.

### Required manifest

For Chats API integrations (omnichannel — WhatsApp, Telegram, web chat, etc.), also include:

```json
"version": "1.0.0",
"chat_settings": {
  "amojo": true
}
```

`amojo` is amoCRM's chat backend. With this flag, the widget is registered as a chat channel and gets a `scope_id` after install — use it to send/receive messages via the Chats API (`https://amojo.amocrm.ru/...`).

### Required callbacks

- `settings` — the OAuth or API-key config UI.
- `init` — register the source via `self.add_source` (for `lead_sources`):

```js
init: function () {
  self.add_source('mywidget', {
    name: self.i18n('source').name,
    code: 'mywidget',
    icon: self.params.path + '/images/source_icon.png',
    settings: self.get_settings()
  });
  return true;
}
```

For chat channels, the wiring is in the backend (Chats API) — the widget's job is to capture credentials in `settings` and then *not* render UI in cards (the chat UI is provided by amoCRM itself once the channel is connected).

### OAuth flow

If the widget uses amoCRM's OAuth 2.0:

1. Set `"oauth": "Y"` in manifest top-level.
2. In dev cabinet, configure redirect URI (e.g., `https://my.backend/oauth/callback`).
3. In `settings` callback, render a "Connect" button that opens `https://www.amocrm.ru/oauth?client_id=<uuid>&state=<csrf>&mode=post_message`.
4. Backend handles the OAuth callback, exchanges the `code` for tokens, stores them.
5. The widget's JS context then has access to `AMOCRM.constant('account')` for the connected account.

If the widget is an SSO bridge for the *other* direction (amoCRM → third-party app):

- Render a "Login to <service>" button in `card` or `settings`.
- Backend handles SAML/OIDC; redirect user to the third-party login.

### Pitfalls

- `lead_sources` widgets aren't card widgets — they appear in *Settings → Sources of Leads*, not in the right panel. Don't add `lcard-*` unless you also want a card view.
- Chats API: the `scope_id` is only available after the channel is connected by an admin. Don't try to send messages before the connect callback fires.
- OAuth redirect URI mismatch: the URI in `manifest`'s widget config must exactly equal what's in the dev cabinet. `http` vs `https`, trailing slash, port — all break the flow.
- SSO widgets often need `everywhere` to inject auth context on every page; this is allowed but slows the app. Prefer scoping to specific cards if possible.

## Combining multiple types

A real example: a CRM telephony widget with click-to-call in cards, settings for SIP creds, DP automation ("call this number when lead enters stage X"), and a chat channel for SMS replies. The manifest:

```json
{
  "widget": { ... },
  "locations": ["lcard-1", "ccard-1", "settings", "advanced_settings", "digital_pipeline", "lead_sources", "chats"],
  "settings": { "sip_user": { ... }, "sip_pass": { ... } },
  "dp": { "settings": { "call_script": { ... } } },
  "advanced": { "log_level": { ... } },
  "chat_settings": { "amojo": true }
}
```

And `script.js` implements `render`/`init`/`bind_actions`/`settings`/`advancedSettings`/`dpSettings`/`destroy` plus `add_source` in `init`. This is fine — the widget loader runs the right callback for the right surface, you don't have to gate by location yourself.
