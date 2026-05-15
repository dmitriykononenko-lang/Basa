# script.js reference — callbacks, self.* API, AMOCRM globals

`script.js` is the runtime entry point. amoCRM loads it via RequireJS (AMD), so the wrapping is fixed:

```js
define(['jquery', 'lib/components/base/modal', 'underscore'], function ($, Modal, _) {
  return function () {
    var self = this;

    this.callbacks = {
      render:        function () { /* ... */ return true; },
      init:          function () { /* ... */ return true; },
      bind_actions:  function () { /* ... */ return true; },
      settings:      function ($modal_body) { /* ... */ return true; },
      advancedSettings: function () { /* ... */ return true; },
      dpSettings:    function () { /* ... */ return true; },
      destroy:       function () { /* ... */ }
      // ...plus selection callbacks for list views
    };

    return this;
  };
});
```

`self` is the widget instance — the same object the loader binds to. Use `self.<method>` instead of `this.<method>` inside async callbacks to avoid losing context.

## Callback lifecycle

The order is fixed and (mostly) one-way:

1. **`render`** — fires when the widget surface activates (the user opens a card, the settings page, the DP designer, etc.). Sync code only; if you need to wait for data, return a `$.Deferred()` instead of `true` and resolve it later. If you return `false` or nothing, the loader stops — `init` and `bind_actions` never run.
2. **`init`** — fires immediately after `render` resolves. Do API calls here, set up app state. Return `true` (or a deferred).
3. **`bind_actions`** — fires after `init`. Attach event listeners (`$(self.render_object).on(...)`). Return `true`.
4. Other callbacks (`settings`, `dpSettings`, `advancedSettings`, selection handlers) fire later in response to user actions.
5. **`destroy`** — fires when the user navigates away. Clean up timers, sockets, listeners. No return value expected.

A common bug: doing the AJAX call inside `render` and not waiting for it. Fix is to return a deferred:

```js
render: function () {
  var dfd = $.Deferred();
  self.crm_post('https://my.api/data', { account: AMOCRM.constant('account').subdomain }, function (resp) {
    self.data = resp;
    self.render_template({ caption: { class_name: 'js-cap', html: 'My widget' }, body: '', render: self.params.tmpl('templates/card') });
    dfd.resolve();
  });
  return dfd.promise();
}
```

## The `self.*` API

Methods the loader injects on every widget instance.

### `self.params`

The parsed manifest, plus runtime context. Useful keys:

- `self.params.widget_code` — the `code` from manifest.
- `self.params.path` — base URL of the widget's static assets (use to construct image / template URLs).
- `self.params.system` — same data as `self.system()` (see below).
- `self.params.tmpl(name)` — loads a Twig template from `templates/<name>.twig` and returns the compiled function. Pass to `render_template`'s `render` field.

### `self.get_settings()`

Returns the settings object filled in by the user during install (merge of `manifest.settings` and `manifest.advanced` values). Returns `null` if the widget isn't installed yet (i.e., you're in the activation form). Always null-check before using.

```js
var settings = self.get_settings();
if (settings && settings.api_key) { /* ... */ }
```

### `self.render_template(opts)`

Mounts content into the widget's render surface. Most-used pattern:

```js
self.render_template({
  caption: { class_name: 'js-my-widget__caption', html: self.i18n('card').title },
  body:    '',
  render:  self.params.tmpl('templates/card')
}, /* template context */ { settings: self.get_settings(), user: AMOCRM.constant('user') });
```

The first object is the wrapper config; the second is the data passed to the Twig template (accessible as variables in the .twig file). Returns the rendered DOM node — capture it and stash on `self` if you need to query into it later.

### `self.render({ render: tmpl }, data)`

Lower-level than `render_template` — just compiles a template against data, returns HTML string. Use for content that goes into modals or sub-areas where you've already established the mount point.

### `self.system()`

Returns `{ amouser, amouser_id, amohash, domain, subdomain, server, version, language, area }`. Use to get the current user, hash for backend auth, current language, etc.

### `self.i18n(section)`

Returns the dict at `i18n.<currentLocale>.<section>` from the loaded language file. So `self.i18n('settings').save_button` resolves to `i18n/ru.json` → `settings.save_button`. Returns `undefined` if missing (won't throw, but the UI will show literal `undefined`).

### `self.set_lang(obj)`

Merge additional translations into the runtime language dict at install time — useful when a backend ships translated strings.

### `self.crm_post(url, data, cb, type)`

Wrapper around `$.ajax` that injects amoCRM's CSRF token and handles auth cookies. Use this instead of raw `fetch` for requests to amoCRM's own API or to your backend if the backend trusts amoCRM-signed requests. `type` defaults to `json`.

### `self.add_action(type, handler)`

Programmatic event binding alternative to wiring through `bind_actions`. Type is a string like `chat:send`. Use for cross-widget messaging.

### `self.add_source(name, source)`

Register a `lead_source` (for chat / channel widgets). See `widget-types.md#sso-and-channels`.

## AMOCRM globals

These exist on `window.AMOCRM` regardless of widget; safe to use after `define()` has run.

- **`AMOCRM.constant('account')`** — `{ id, subdomain, currency, date_format, ... }`. The account the widget is installed in.
- **`AMOCRM.constant('user')`** — `{ id, name, lang, is_admin, ... }`. The current user viewing the page.
- **`AMOCRM.constant('users')`** — array of all users in the account (for user-picker UI).
- **`AMOCRM.data.current_card`** — current entity context. For card widgets: `{ id, type, name, model: ... }`. `type` is `1` (lead), `2` (contact), `3` (company), `12` (customer).
- **`AMOCRM.widgets.list`** — registered widget instances.
- **`AMOCRM.lang`** — current account/user language code.
- **`AMOCRM.notifications.add_alert({ text, ... })`** — show a toast.
- **`AMOCRM.notifications.show_message({ header, text, ... })`** — full notification.
- **`AMOCRM.router.cur_page`** — current SPA route name (use to detect navigation in `everywhere` widgets).

## Modal helper

```js
define(['jquery', 'lib/components/base/modal'], function ($, Modal) {
  // inside a callback:
  var modal = new Modal({
    class_name: 'modal-window--mini',
    init: function ($modal) {
      $modal.trigger('modal:loaded');
      $modal.html(self.render({ render: self.params.tmpl('templates/my_modal') }, { /* data */ }));
      $modal.trigger('modal:centrify');
    },
    destroy: function () { /* cleanup */ }
  });
});
```

The modal helper auto-handles closing, ESC key, click-outside, etc. Use it instead of building modals from scratch — custom modals miss accessibility wiring.

## Callback reference

### `render`

Decide whether the widget should appear. Return `false` to skip rendering entirely (e.g., the widget has no settings yet and you don't want to bug the user). Return `true` to mount synchronously; return `$.Deferred().promise()` for async mount.

### `init`

Fetch initial data, set instance state. Don't attach DOM events here — that's for `bind_actions`. Don't render UI here — `render` already did. Use `init` for: API hello calls, loading user prefs, setting up sockets.

### `bind_actions`

Attach event handlers. amoCRM SPA-routes between pages and re-instantiates widgets on each navigation (unless `init_once: true`), so handlers attached here are scoped correctly. Always namespace your handlers:

```js
$(self.render_object).off('click.mywidget').on('click.mywidget', '.js-save', function () { /* ... */ });
```

Otherwise you stack duplicate handlers across navigations.

### `settings($modal_body)`

Receives the jQuery object for the settings modal body. Render the contents and wire save:

```js
settings: function ($modal_body) {
  $modal_body.html(self.render({ render: self.params.tmpl('templates/settings') }, { current: self.get_settings() || {} }));

  $modal_body.on('click', '.js-save-settings', function () {
    // validate, then either let amo save (return true from this callback chain)
    // or do a custom save via crm_post and close the modal
  });

  return true;
}
```

The save button in the default activation form auto-collects `manifest.settings` field values and submits them; you don't need to do anything for those. Custom UI (`type: "custom"`) you handle yourself.

### `advancedSettings()`

Fires when the user clicks "Advanced settings" on the widget tile. The mount point is a full page, not a modal. Render the full UI into `self.render_object` (or however the loader exposes it for advanced).

### `dpSettings()`

Fires when the user adds your action to a Digital Pipeline step and opens its config. Similar to `settings` but the modal is the DP step's config modal. The values are saved into the pipeline's step config (not the widget's global settings), and they're sent to your backend webhook each time the step fires.

### `destroy()`

Called on navigation away. Clean up: unbind handlers, clear intervals, close sockets, remove temp DOM. amoCRM doesn't await this — make it synchronous.

### Selection callbacks (list views)

Only fire if the widget is in `llist-1` / `clist-1` / `comlist-1` and the user selects rows + clicks the widget's bulk action button.

```js
this.callbacks.leads.selected = function () {
  var ids = AMOCRM.data.current_card_filter; // selected lead ids
  // do bulk action
};
// also: this.callbacks.contacts.selected, this.callbacks.companies.selected
```

For per-row action buttons:

```js
this.callbacks.contacts.add_handler = function (data) { /* called when "add" pressed for a contact */ };
```

## Async patterns: `$.Deferred` returns

When a callback needs to wait, return a promise from `$.Deferred()`. The loader awaits any callback that returns a promise. Don't return a native `Promise` — older amoCRM loaders don't recognize it (modern ones do, but stick to deferreds for safety).

```js
init: function () {
  var dfd = $.Deferred();
  $.ajax({ url: 'https://my.api/init', ... })
    .done(function (data) { self.app_state = data; dfd.resolve(); })
    .fail(function () { dfd.reject(); });
  return dfd.promise();
}
```

If you reject, downstream callbacks don't fire — the widget halts and the loader logs a console error.

## Where to handle errors

- **Network errors**: show `AMOCRM.notifications.add_alert` with i18n text. Don't `console.log` and call it a day — the user has no way to see logs.
- **Settings validation**: in `settings` callback, return `false` from the save handler chain (or short-circuit with your own `crm_post`). Show inline errors in the form.
- **DP webhook fails**: the webhook backend is responsible for returning a proper HTTP status; amoCRM retries on 5xx and logs failures.

## Performance notes

- `everywhere` widgets run on every page including dashboards. Heavy `init` work here visibly slows the app. Defer to first user interaction if possible.
- Don't poll the amoCRM API on a timer from `init` — use the WebSocket events bus (`AMOCRM.realtime`) or rely on user-triggered refreshes.
- Twig template compilation is cached per `tmpl()` call. Calling `self.params.tmpl('foo')` multiple times is cheap.
