/**
 * example-widget — a fully-wired sample.
 *
 * Demonstrates: card widget + settings + advanced settings + DP step + lead_source.
 * Real backend calls are stubbed so the widget loads without a server; replace
 * `apiCall` with your own and `BACKEND_URL` with the real host.
 */

define(['jquery', 'lib/components/base/modal', 'underscore'], function ($, Modal, _) {

  return function () {
    var self = this;

    var BACKEND_URL = 'https://your-backend.example.com';

    function apiCall(path, payload) {
      var dfd = $.Deferred();
      $.ajax({
        url: BACKEND_URL + path,
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify(_.extend({
          account_id:  AMOCRM.constant('account').id,
          subdomain:   AMOCRM.constant('account').subdomain,
          user_id:     AMOCRM.constant('user').id,
          widget_code: self.params.widget_code
        }, payload || {}))
      }).done(dfd.resolve).fail(dfd.reject);
      return dfd.promise();
    }

    function notify(key, color) {
      var dict = self.i18n('notify') || {};
      AMOCRM.notifications.add_alert({
        text: dict[key] || key,
        color: color || 'white'
      });
    }

    function renderCard(state) {
      self.render_template(
        {
          caption: { class_name: 'js-mw-cap-' + self.params.widget_code, html: self.i18n('card').title },
          body:    '',
          render:  self.params.tmpl('templates/card')
        },
        {
          settings: self.get_settings(),
          entity:   AMOCRM.data.current_card,
          user:     AMOCRM.constant('user'),
          state:    state || {}
        }
      );
    }

    this.callbacks = {

      render: function () {
        var area = self.system().area;

        // Card surfaces — render skeleton; init() will hydrate.
        if (/^(lead|contact|company)-card$/.test(area)) {
          renderCard({ loading: true });
        }
        return true;
      },

      init: function () {
        // Self-attribute as a lead source if location is active for this account.
        if (self.add_source) {
          self.add_source(self.params.widget_code, {
            name:     self.i18n('source').name,
            code:     self.params.widget_code,
            icon:     self.params.path + '/images/logo_small.png',
            settings: self.get_settings()
          });
        }

        var card = AMOCRM.data.current_card;
        var settings = self.get_settings();

        if (!settings || !settings.api_key) {
          // Widget installed but not configured — show prompt to open settings.
          if (card) renderCard({ loading: false, configured: false });
          return true;
        }

        if (!card || !card.id) return true;

        apiCall('/widget/card-init', { entity_type: card.type, entity_id: card.id })
          .done(function (resp) {
            self.entity_state = resp;
            renderCard({ loading: false, configured: true, data: resp });
          })
          .fail(function () {
            notify('init_failed', 'red');
            renderCard({ loading: false, configured: true, error: true });
          });

        return true;
      },

      bind_actions: function () {
        var ns = '.mw-' + self.params.widget_code;
        var $root = $(self.render_object || document);

        $root.off('click' + ns).on('click' + ns, '.js-mw-refresh', function () {
          self.callbacks.init();
        });

        $root.off('click' + ns + '-save').on('click' + ns + '-save', '.js-mw-save', function () {
          if (!self.entity_state) { notify('init_failed', 'red'); return; }
          apiCall('/widget/save', { state: self.entity_state })
            .done(function () { notify('saved'); })
            .fail(function () { notify('save_failed', 'red'); });
        });

        return true;
      },

      settings: function ($modal_body) {
        // Custom help text appended above the built-in fields.
        var existing = $modal_body.find('.widget_settings_block__descr-mw-' + self.params.widget_code);
        if (existing.length === 0) {
          $modal_body.find('.widget_settings_block').prepend(
            $('<p class="widget_settings_block__descr widget_settings_block__descr-mw-' + self.params.widget_code + '"></p>')
              .text(self.i18n('settings').help_text)
          );
        }

        // Validate api_key before save.
        $modal_body.off('click.mw-save').on('click.mw-save', '.widget_settings_block__btn_save', function (e) {
          var key = $modal_body.find('input[name="api_key"]').val();
          if (!key || key.length < 8) {
            e.preventDefault();
            e.stopImmediatePropagation();
            $modal_body.find('.js-mw-error').text(self.i18n('errors').invalid_key);
            return false;
          }
        });

        return true;
      },

      advancedSettings: function () {
        var saved = self.get_settings() || {};
        var $mount = $('.list-pipelines__hidden, .widget_advanced_settings');
        $mount.html(self.render({ render: self.params.tmpl('templates/advanced_settings') }, { saved: saved }));

        $mount.off('click.mw-adv').on('click.mw-adv', '.js-mw-adv-save', function () {
          var interval = $mount.find('[name="sync_interval"]').val();
          apiCall('/widget/advanced-save', { sync_interval: interval })
            .done(function () { notify('saved'); })
            .fail(function () { notify('save_failed', 'red'); });
        });

        return true;
      },

      dpSettings: function () {
        var $modal = $('.modal-body');
        var stepConfig = $modal.data('config') || {};
        $modal.find('.dp_action__params').html(self.render({
          render: self.params.tmpl('templates/dp_settings')
        }, { saved: stepConfig }));
        return true;
      },

      destroy: function () {
        var ns = '.mw-' + self.params.widget_code;
        $(self.render_object || document).off(ns + ' ' + ns + '-save click.mw-save click.mw-adv');
      },

      leads:    { selected: function () { apiCall('/widget/bulk-leads',     { lead_ids:    AMOCRM.data.current_card_filter }); } },
      contacts: { selected: function () { apiCall('/widget/bulk-contacts',  { contact_ids: AMOCRM.data.current_card_filter }); } },
      companies:{ selected: function () { apiCall('/widget/bulk-companies', { company_ids: AMOCRM.data.current_card_filter }); } }
    };

    return this;
  };
});
