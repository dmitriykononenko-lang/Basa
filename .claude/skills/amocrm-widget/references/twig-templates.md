# Twig templates in amoCRM widgets

amoCRM's frontend uses a Twig-compatible template engine (the JS port — twig.js). Templates live in `templates/` with the `.twig` extension. Load them in `script.js` via `self.params.tmpl('templates/<name>')` (no extension).

## File layout

```
templates/
├── card.twig                 # right-panel card body
├── settings.twig             # custom controls inside the activation form
├── advanced_settings.twig    # advanced-settings page body
├── dp_settings.twig          # digital-pipeline step config modal
└── sso.twig                  # SSO connect button etc.
```

You can have any names — just keep the `.twig` extension and pass the path without it to `tmpl()`.

## Loading and rendering

In `script.js`:

```js
// Compile template into a function
var tmpl = self.params.tmpl('templates/card');

// Option A: render directly to a string
var html = self.render({ render: tmpl }, { entity: AMOCRM.data.current_card });

// Option B: render into the widget's mount point (typical for card widgets)
self.render_template(
  { caption: { class_name: 'js-cap', html: self.i18n('card').title }, body: '', render: tmpl },
  { settings: self.get_settings() }
);
```

Whatever object you pass as the second argument becomes the template's variable scope.

## Syntax basics (what's supported)

Standard Twig syntax works:

```twig
{# This is a comment — stripped at compile time #}

<div class="my-widget">
  <h3>{{ settings.title }}</h3>

  {% if entity %}
    <p>{{ entity.name|escape }}</p>
  {% else %}
    <p>{{ langs.card.no_entity }}</p>
  {% endif %}

  <ul>
  {% for user in users %}
    <li data-id="{{ user.id }}">{{ user.name }}</li>
  {% endfor %}
  </ul>

  <button class="js-save button-input button-input-blue">
    {{ langs.card.save }}
  </button>
</div>
```

Supported tags: `if`/`elseif`/`else`/`endif`, `for`/`endfor`, `set`, `include`, `block`/`extends`, `raw`/`endraw`.

Common filters: `escape` (aliased `e`), `upper`, `lower`, `length`, `trim`, `default`, `date`, `replace`.

## i18n inside templates: `langs`

The current language file is exposed as a `langs` variable in every template:

```twig
<p>{{ langs.settings.help_text }}</p>
```

This resolves to `i18n/<currentLocale>.json` → `settings.help_text`. You don't need to pass i18n explicitly when rendering — `langs` is always available.

If you also want to interpolate values, use `replace` or just compose in JS first:

```twig
<p>{{ langs.welcome|replace({"%name%": user.name}) }}</p>
```

## Passing data from script.js

Templates only see what you put in the data object:

```js
self.render({ render: tmpl }, {
  settings: self.get_settings(),
  entity: AMOCRM.data.current_card,
  user: AMOCRM.constant('user'),
  custom: { now: Date.now(), feature_flag: self.is_pro }
});
```

In the template:

```twig
{{ settings.api_key|default('not set') }}
{{ entity.id }} — {{ entity.type }}
{{ custom.now|date('Y-m-d') }}
```

## Embedding script tags — DON'T

The widget loader strips `<script>` tags from templates in some contexts (notably card panels). Put behavior in `script.js` and template the *markup only*. If you absolutely need to evaluate JS from a template (e.g., a third-party embed snippet), wrap in `{% raw %}` and inject via `$('.mount').html(self.render(...))` from `bind_actions`:

```twig
{% raw %}
<div id="vendor-mount"></div>
<script>VendorSDK.init({ key: "{{ settings.key }}" });</script>
{% endraw %}
```

…but really, prefer pulling the SDK in `init` and calling its init function from JS.

## Common patterns

### Render a list of options for a dropdown

```twig
<select class="js-pipeline">
  {% for p in pipelines %}
    <option value="{{ p.id }}"{% if p.id == settings.pipeline_id %} selected{% endif %}>
      {{ p.name|escape }}
    </option>
  {% endfor %}
</select>
```

### Show different markup based on permissions

```twig
{% if user.is_admin %}
  <button class="js-reset">{{ langs.card.reset }}</button>
{% else %}
  <p class="caption">{{ langs.card.admin_only }}</p>
{% endif %}
```

### Inline CSS — avoid

Don't put `<style>` in templates. amoCRM's CSS is loaded globally; your styles will leak. Instead, prefix your CSS classes (`mw-${widget_code}__elem`) and put them in `widget.css` if you ship CSS as a static asset, or inject via JS at init.

## Twig.js limitations to know

amoCRM uses [twig.js](https://github.com/twigjs/twig.js) — a JS port of Twig that supports a deliberate subset. Verified against the project's Implementation Notes:

**Supported tags:** `block`, `embed`, `extends`, `for`, `from`, `if`, `import`, `include`, `macro`, `set`, `use`, `verbatim` (alias of `raw`), `with`.

**Supported filters (partial list, the most useful):** `abs`, `batch`, `capitalize`, `date`, `date_modify`, `default`, `escape` (`e`), `first`, `format`, `join`, `json_encode`, `keys`, `last`, `length`, `lower`, `merge`, `nl2br`, `number_format`, `raw`, `replace`, `reverse`, `round`, `slice`, `sort`, `split`, `striptags`, `title`, `trim`, `upper`, `url_encode`.

**Not supported or unreliable:**

- **Named arguments in filters** — `{{ x|filter(param=value) }}` is not supported. Use positional arguments: `{{ x|filter(value) }}`.
- **Custom filters / functions / tags from inside the template** — you can't `{% extension %}` register them. They have to be registered globally via `Twig.extendFilter()` in JS code, which the amoCRM loader doesn't expose to widgets. Do transforms in JS before passing data into the template.
- **Arrow functions as filter parameters** — `{{ items|filter(item => item.active) }}` won't parse. Filter the array in JS first.
- **No method calls on variables** — `{{ user.getName() }}` won't work; only property access does (`{{ user.name }}`). Build the shape you need in JS.
- **No automatic output escaping** — twig.js does *not* auto-escape like PHP Twig. Apply `|escape` (or `|e`) explicitly to any user-supplied data you render. This matters more than it looks — it's the #1 source of XSS in amoCRM widgets.

**`{% spaceless %}`** is technically supported but behaviour varies across twig.js versions amoCRM ships. Prefer manual whitespace control.

For the canonical list (which expands over time as twig.js evolves), see the [Implementation Notes wiki](https://github.com/twigjs/twig.js/wiki/Implementation-Notes).

## Debugging templates

If a template renders blank or with `{{ literally }}`:

1. Check the browser console — twig.js logs parse errors with line numbers.
2. Validate the JSON of your data object — if it's malformed JS object, the variables come through as undefined.
3. Verify the file path: `self.params.tmpl('templates/card')` looks for `templates/card.twig`. Typos = silent fail.
4. Wrap suspicious sections in `{% raw %}...{% endraw %}` to see if Twig is over-parsing escape sequences.

## Performance

- Compiled templates are cached by twig.js — calling `self.params.tmpl(name)` multiple times is fine.
- Templates over ~500 lines start to feel slow at compile. Split into multiple via `{% include %}` if you hit that.
- Avoid deep `{% for %}` over thousands of items in the template — paginate or virtualize in JS.
