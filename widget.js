define(['jquery', 'underscore'], function($, _) {
    'use strict';

    var CustomWidget = function() {
        var self = this,
            lang = self.i18n('userLang'),
            system = self.system();

        // ─── Constants ────────────────────────────────────────────────────────
        var DISTRIBUTION_METHODS = {
            ROUND_ROBIN: 'round_robin',
            WORKLOAD:    'workload'
        };

        var DEFAULT_SETTINGS = {
            server_url:          '',
            distribution_method: DISTRIBUTION_METHODS.ROUND_ROBIN,
            rules:               []
        };

        // ─── Helpers ──────────────────────────────────────────────────────────
        function getSettings() {
            return $.extend(true, {}, DEFAULT_SETTINGS, self.params);
        }

        function saveToLocalStorage(key, value) {
            try {
                localStorage.setItem('amo_dist_' + key, JSON.stringify(value));
            } catch(e) {}
        }

        function loadFromLocalStorage(key) {
            try {
                var raw = localStorage.getItem('amo_dist_' + key);
                return raw ? JSON.parse(raw) : null;
            } catch(e) {
                return null;
            }
        }

        function notify(text, type) {
            // type: 'success' | 'error' | 'info'
            type = type || 'info';
            if (window.AMOCRM && AMOCRM.notifications) {
                AMOCRM.notifications.show_message({
                    header:  self.i18n('notifications.' + type + '_header'),
                    text:    text,
                    timeout: 3000
                });
            }
        }

        // ─── API calls to our backend ─────────────────────────────────────────
        function apiRequest(path, data, method) {
            var settings  = getSettings();
            var serverUrl = $.trim(settings.server_url).replace(/\/$/, '');

            if (!serverUrl) {
                console.warn('[DealDist] server_url is not configured');
                return $.Deferred().reject('no_server_url').promise();
            }

            return $.ajax({
                url:         serverUrl + path,
                type:        method || 'POST',
                contentType: 'application/json',
                dataType:    'json',
                data:        JSON.stringify(data || {}),
                headers: {
                    'X-Account-Id': system.account_id || '',
                    'X-Widget-Version': '1.0.0'
                }
            });
        }

        // ─── Settings page rendering ──────────────────────────────────────────
        function renderSettings() {
            var settings = getSettings();
            var tpl      = self.getTemplate({ name: 'settings', base_path: 'templates/', load: true });

            return tpl.then(function(template) {
                var html = $(template).tmpl({
                    settings: settings,
                    i18n:     self.i18n('settings'),
                    methods:  [
                        { id: DISTRIBUTION_METHODS.ROUND_ROBIN, label: self.i18n('settings.method_round_robin') },
                        { id: DISTRIBUTION_METHODS.WORKLOAD,    label: self.i18n('settings.method_workload')    }
                    ]
                });

                var $container = $('.widget-settings__fields[data-widget="' + self.get_settings().widget_code + '"]');
                $container.html(html);
                bindSettingsEvents($container, settings);
            });
        }

        function bindSettingsEvents($container, settings) {
            // "Add rule" button
            $container.on('click', '.js-add-rule', function() {
                addRuleRow($container, {});
            });

            // "Remove rule" button
            $container.on('click', '.js-remove-rule', function() {
                $(this).closest('.dist-rule-row').remove();
                recalcRuleIndexes($container);
            });

            // Render existing rules
            _.each(settings.rules || [], function(rule) {
                addRuleRow($container, rule);
            });

            // Pipeline selector change → reload stages
            $container.on('change', '.js-rule-pipeline', function() {
                var $row      = $(this).closest('.dist-rule-row');
                var pipelineId = $(this).val();
                loadStages(pipelineId, $row);
            });
        }

        function addRuleRow($container, rule) {
            var $rulesContainer = $container.find('.js-rules-list');
            var rowHtml = buildRuleRowHtml(rule);
            $rulesContainer.append(rowHtml);
            var $row = $rulesContainer.find('.dist-rule-row').last();

            loadPipelinesIntoRow($row, rule);
        }

        function buildRuleRowHtml(rule) {
            var f = rule.filters || {};
            return [
                '<div class="dist-rule-row">',
                '  <div class="dist-rule-row__header">',
                '    <span class="dist-rule-row__title"><span class="rule-number"></span></span>',
                '    <button type="button" class="js-remove-rule dist-btn dist-btn--danger dist-btn--sm">&#x2715;</button>',
                '  </div>',
                '  <div class="dist-rule-row__body">',

                // Pipeline + Stage
                '    <div class="dist-row-2col">',
                '      <div class="dist-field">',
                '        <label class="dist-label">Воронка</label>',
                '        <select class="js-rule-pipeline dist-select" name="pipeline_id">',
                '          <option value="">— выберите —</option>',
                '        </select>',
                '      </div>',
                '      <div class="dist-field">',
                '        <label class="dist-label">Этап</label>',
                '        <select class="js-rule-stage dist-select" name="stage_id">',
                '          <option value="">Любой</option>',
                '        </select>',
                '      </div>',
                '    </div>',

                // Managers
                '    <div class="dist-field">',
                '      <label class="dist-label">Ответственные менеджеры</label>',
                '      <div class="js-managers-list dist-managers-list"></div>',
                '      <button type="button" class="js-add-manager dist-btn dist-btn--secondary dist-btn--sm">+ Добавить менеджера</button>',
                '    </div>',

                // Checkboxes
                '    <div class="dist-row-2col">',
                '      <div class="dist-field">',
                '        <label class="dist-label">',
                '          <input type="checkbox" class="js-check-history" ' + (rule.check_history ? 'checked' : '') + ' />',
                '          Учитывать историю контакта/компании',
                '        </label>',
                '      </div>',
                '      <div class="dist-field">',
                '        <label class="dist-label">',
                '          <input type="checkbox" class="js-check-schedule" ' + (rule.check_schedule ? 'checked' : '') + ' />',
                '          Учитывать рабочее расписание',
                '        </label>',
                '      </div>',
                '    </div>',

                // Filters collapsible section
                '    <div class="dist-filters-section">',
                '      <button type="button" class="js-toggle-filters dist-toggle-btn">',
                '        <span class="dist-toggle-icon">&#9656;</span> Фильтры сделок',
                '      </button>',
                '      <div class="js-filters-body dist-filters-body" style="display:none;">',
                '        <div class="dist-row-2col">',
                '          <div class="dist-field">',
                '            <label class="dist-label">Бюджет от (₽)</label>',
                '            <input type="number" class="js-filter-budget-min dist-input" min="0" placeholder="0" value="' + (f.budget_min || '') + '" />',
                '          </div>',
                '          <div class="dist-field">',
                '            <label class="dist-label">Бюджет до (₽)</label>',
                '            <input type="number" class="js-filter-budget-max dist-input" min="0" placeholder="без ограничений" value="' + (f.budget_max || '') + '" />',
                '          </div>',
                '        </div>',
                '        <div class="dist-field">',
                '          <label class="dist-label">Название содержит</label>',
                '          <input type="text" class="js-filter-name dist-input" placeholder="например: доставка" value="' + _.escape(f.name_contains || '') + '" />',
                '        </div>',
                '        <div class="dist-field">',
                '          <label class="dist-label">Теги (через запятую)</label>',
                '          <input type="text" class="js-filter-tags dist-input" placeholder="vip, wholesale" value="' + _.escape((f.tags || []).join(', ')) + '" />',
                '          <small class="dist-hint">Сделка должна содержать ВСЕ указанные теги.</small>',
                '        </div>',
                '        <div class="dist-field">',
                '          <label class="dist-label">Дополнительные поля</label>',
                '          <div class="js-cf-list dist-cf-list"></div>',
                '          <button type="button" class="js-add-cf dist-btn dist-btn--secondary dist-btn--sm">+ Добавить условие</button>',
                '        </div>',
                '      </div>',
                '    </div>',

                '  </div>',
                '</div>'
            ].join('');
        }

        function bindFilterEvents($row, filters) {
            // Toggle filters section
            $row.on('click', '.js-toggle-filters', function() {
                var $body = $row.find('.js-filters-body');
                var $icon = $(this).find('.dist-toggle-icon');
                $body.toggle();
                $icon.html($body.is(':visible') ? '&#9662;' : '&#9656;');
            });

            // Show filters panel if any filter is already set
            var f = filters || {};
            if (f.budget_min || f.budget_max || f.name_contains || (f.tags && f.tags.length) || (f.custom_fields && f.custom_fields.length)) {
                $row.find('.js-filters-body').show();
                $row.find('.dist-toggle-icon').html('&#9662;');
            }

            // Add custom field condition
            $row.on('click', '.js-add-cf', function() {
                addCfRow($row, {});
            });
            $row.on('click', '.js-remove-cf', function() {
                $(this).closest('.dist-cf-row').remove();
            });

            // Render existing custom field conditions
            _.each(f.custom_fields || [], function(cf) {
                addCfRow($row, cf);
            });
        }

        function addCfRow($row, cf) {
            var html = [
                '<div class="dist-cf-row">',
                '  <input type="number" class="js-cf-field-id dist-input dist-input--sm" placeholder="ID поля" value="' + (cf.field_id || '') + '" />',
                '  <select class="js-cf-operator dist-select dist-select--sm">',
                '    <option value="eq"'       + (cf.operator === 'eq'       ? ' selected' : '') + '>равно</option>',
                '    <option value="contains"' + (cf.operator === 'contains' ? ' selected' : '') + '>содержит</option>',
                '    <option value="gte"'      + (cf.operator === 'gte'      ? ' selected' : '') + '>≥</option>',
                '    <option value="lte"'      + (cf.operator === 'lte'      ? ' selected' : '') + '>≤</option>',
                '  </select>',
                '  <input type="text" class="js-cf-value dist-input dist-input--sm" placeholder="значение" value="' + _.escape(cf.value || '') + '" />',
                '  <button type="button" class="js-remove-cf dist-btn dist-btn--danger dist-btn--sm">&#x2715;</button>',
                '</div>'
            ].join('');
            $row.find('.js-cf-list').append(html);
        }

        function recalcRuleIndexes($container) {
            $container.find('.dist-rule-row .rule-number').each(function(i) {
                $(this).text('Правило ' + (i + 1));
            });
        }

        function loadPipelinesIntoRow($row, rule) {
            if (window.AMOCRM && AMOCRM.data && AMOCRM.data.pipelines) {
                var pipelines = AMOCRM.data.pipelines;
                var $select   = $row.find('.js-rule-pipeline');

                _.each(pipelines, function(pipeline) {
                    var option = $('<option>', {
                        value:    pipeline.id,
                        text:     pipeline.name,
                        selected: rule.pipeline_id && String(rule.pipeline_id) === String(pipeline.id)
                    });
                    $select.append(option);
                });

                if (rule.pipeline_id) {
                    loadStages(rule.pipeline_id, $row, rule.stage_id);
                }
            }

            // managers
            _.each(rule.managers || [], function(manager) {
                addManagerRow($row, manager);
            });

            $row.on('click', '.js-add-manager', function() {
                addManagerRow($row, {});
            });

            $row.on('click', '.js-remove-manager', function() {
                $(this).closest('.dist-manager-row').remove();
            });

            // filters
            bindFilterEvents($row, rule.filters || {});
        }

        function loadStages(pipelineId, $row, selectedStageId) {
            var $stageSelect = $row.find('.js-rule-stage');
            $stageSelect.empty().append('<option value="">Любой</option>');

            if (!pipelineId) return;

            var pipelines = (AMOCRM.data && AMOCRM.data.pipelines) || [];
            var pipeline  = _.find(pipelines, function(p) { return String(p.id) === String(pipelineId); });
            if (!pipeline || !pipeline.statuses) return;

            _.each(pipeline.statuses, function(status) {
                if (status.type === 0) return; // skip system statuses
                $stageSelect.append($('<option>', {
                    value:    status.id,
                    text:     status.name,
                    selected: selectedStageId && String(selectedStageId) === String(status.id)
                }));
            });
        }

        function addManagerRow($row, manager) {
            var $list = $row.find('.js-managers-list');
            var users = (AMOCRM.data && AMOCRM.data.users) || [];

            var options = _.map(users, function(user) {
                var sel = manager.id && String(manager.id) === String(user.id) ? ' selected' : '';
                return '<option value="' + user.id + '"' + sel + '>' + _.escape(user.name) + '</option>';
            }).join('');

            var html = [
                '<div class="dist-manager-row">',
                '  <select class="js-manager-select dist-select dist-select--inline" name="manager_id">',
                '    <option value="">— выберите —</option>',
                     options,
                '  </select>',
                '  <button type="button" class="js-remove-manager dist-btn dist-btn--danger dist-btn--sm">&#x2715;</button>',
                '</div>'
            ].join('');

            $list.append(html);
        }

        // ─── Collect settings from UI before save ─────────────────────────────
        function collectRules($container) {
            var rules = [];

            $container.find('.dist-rule-row').each(function() {
                var $row = $(this);

                // Managers
                var managers = [];
                $row.find('.dist-manager-row').each(function() {
                    var id = $(this).find('.js-manager-select').val();
                    if (id) managers.push({ id: id });
                });

                // Filters
                var filters = {};
                var budgetMin = $.trim($row.find('.js-filter-budget-min').val());
                var budgetMax = $.trim($row.find('.js-filter-budget-max').val());
                var nameContains = $.trim($row.find('.js-filter-name').val());
                var tagsRaw = $.trim($row.find('.js-filter-tags').val());

                if (budgetMin !== '')   filters.budget_min    = parseInt(budgetMin, 10);
                if (budgetMax !== '')   filters.budget_max    = parseInt(budgetMax, 10);
                if (nameContains)       filters.name_contains = nameContains;
                if (tagsRaw) {
                    filters.tags = _.compact(_.map(tagsRaw.split(','), function(t) {
                        return $.trim(t);
                    }));
                }

                var customFields = [];
                $row.find('.dist-cf-row').each(function() {
                    var fieldId  = $.trim($(this).find('.js-cf-field-id').val());
                    var operator = $(this).find('.js-cf-operator').val();
                    var value    = $.trim($(this).find('.js-cf-value').val());
                    if (fieldId && value) {
                        customFields.push({ field_id: parseInt(fieldId, 10), operator: operator, value: value });
                    }
                });
                if (customFields.length) filters.custom_fields = customFields;

                var rule = {
                    pipeline_id:    $row.find('.js-rule-pipeline').val() || null,
                    stage_id:       $row.find('.js-rule-stage').val()    || null,
                    check_history:  $row.find('.js-check-history').is(':checked'),
                    check_schedule: $row.find('.js-check-schedule').is(':checked'),
                    managers:       managers,
                    filters:        filters
                };

                if (rule.pipeline_id && rule.managers.length) {
                    rules.push(rule);
                }
            });

            return rules;
        }

        // ─── Digital Pipeline ─────────────────────────────────────────────────
        function handleDpEvent(eventData, dpSettings) {
            var settings = getSettings();
            var leadId   = eventData.lead && eventData.lead.id;

            if (!leadId) return;

            apiRequest('/api/distribute', {
                account_id:          system.account_id,
                lead_id:             leadId,
                pipeline_id:         eventData.pipeline_id || null,
                stage_id:            eventData.lead_status_id || null,
                distribution_method: settings.distribution_method,
                rules:               settings.rules || [],
                dp_settings:         dpSettings || {}
            }).done(function(response) {
                if (response && response.assigned_to) {
                    notify(
                        'Сделка #' + leadId + ' назначена на: ' + response.assigned_to,
                        'success'
                    );
                }
            }).fail(function(xhr) {
                console.error('[DealDist] Distribution failed', xhr);
                notify('Ошибка распределения сделки #' + leadId, 'error');
            });
        }

        // ═════════════════════════════════════════════════════════════════════
        //   AmoCRM Widget API methods
        // ═════════════════════════════════════════════════════════════════════

        /** Called when widget renders anywhere */
        self.render = function() {
            return true;
        };

        /** Called once during initialization */
        self.init = function() {
            return true;
        };

        /** Bind UI events after render */
        self.bind_actions = function() {
            return true;
        };

        /** Render settings page */
        self.settings = function($container) {
            if (!$container) return false;

            var settings = getSettings();

            $container.html([
                '<div class="dist-settings">',
                '  <h3 class="dist-settings__title">Распределение сделок</h3>',

                '  <div class="dist-section">',
                '    <div class="dist-field">',
                '      <label class="dist-label">URL сервера распределения <span class="dist-required">*</span></label>',
                '      <input type="text" class="js-server-url dist-input" placeholder="https://your-server.com" value="' + _.escape(settings.server_url) + '" />',
                '      <small class="dist-hint">Адрес бэкенд-сервиса, обрабатывающего распределение сделок.</small>',
                '    </div>',

                '    <div class="dist-field">',
                '      <label class="dist-label">Метод распределения</label>',
                '      <select class="js-dist-method dist-select">',
                '        <option value="round_robin"' + (settings.distribution_method === 'round_robin' ? ' selected' : '') + '>Round Robin (по очереди)</option>',
                '        <option value="workload"'   + (settings.distribution_method === 'workload'    ? ' selected' : '') + '>По загруженности</option>',
                '      </select>',
                '    </div>',
                '  </div>',

                '  <div class="dist-section">',
                '    <h4 class="dist-section__title">Правила распределения</h4>',
                '    <p class="dist-hint">Каждое правило задаёт, на каком этапе воронки и каким менеджерам назначать сделки.</p>',
                '    <div class="js-rules-list dist-rules-list"></div>',
                '    <button type="button" class="js-add-rule dist-btn dist-btn--primary">+ Добавить правило</button>',
                '  </div>',
                '</div>'
            ].join(''));

            bindSettingsEvents($container, settings);

            return true;
        };

        /** Called before settings are saved — collect values */
        self.onSave = function() {
            var $container = $('.widget-settings__fields[data-widget="' + self.get_settings().widget_code + '"]');

            self.params.server_url          = $.trim($container.find('.js-server-url').val());
            self.params.distribution_method = $container.find('.js-dist-method').val();
            self.params.rules               = collectRules($container);

            // Save queue state to backend
            if (self.params.server_url) {
                apiRequest('/api/settings', {
                    account_id: system.account_id,
                    settings:   self.params
                }, 'PUT');
            }

            return true;
        };

        /** Digital Pipeline — settings panel */
        self.dpSettings = function() {
            var settings = getSettings();

            return {
                render: function($container, dpSettings) {
                    $container.html([
                        '<div class="dist-dp-settings">',
                        '  <div class="dist-field">',
                        '    <label class="dist-label">Менеджеры для этого этапа</label>',
                        '    <div class="js-dp-managers-list dist-managers-list"></div>',
                        '    <button type="button" class="js-dp-add-manager dist-btn dist-btn--secondary dist-btn--sm">',
                        '      + Добавить менеджера',
                        '    </button>',
                        '  </div>',
                        '  <div class="dist-field">',
                        '    <label class="dist-label">',
                        '      <input type="checkbox" class="js-dp-check-history" ',
                                    ((dpSettings && dpSettings.check_history) ? 'checked' : '') + ' />',
                        '      Учитывать историю контакта/компании',
                        '    </label>',
                        '  </div>',
                        '  <div class="dist-field">',
                        '    <label class="dist-label">',
                        '      <input type="checkbox" class="js-dp-check-schedule" ',
                                    ((dpSettings && dpSettings.check_schedule) ? 'checked' : '') + ' />',
                        '      Учитывать рабочее расписание',
                        '    </label>',
                        '  </div>',
                        '</div>'
                    ].join(''));

                    // Render saved managers
                    _.each((dpSettings && dpSettings.managers) || [], function(manager) {
                        addManagerRow({ find: function(s) { return $container.find('.js-dp-managers-list'); } }, manager);
                    });

                    // Replace addManagerRow helper for dp context
                    $container.on('click', '.js-dp-add-manager', function() {
                        var users = (AMOCRM.data && AMOCRM.data.users) || [];
                        var options = _.map(users, function(u) {
                            return '<option value="' + u.id + '">' + _.escape(u.name) + '</option>';
                        }).join('');
                        $container.find('.js-dp-managers-list').append(
                            '<div class="dist-manager-row">' +
                            '<select class="js-dp-manager-select dist-select dist-select--inline">' +
                            '<option value="">— выберите —</option>' + options +
                            '</select>' +
                            '<button type="button" class="js-dp-remove-manager dist-btn dist-btn--danger dist-btn--sm">&#x2715;</button>' +
                            '</div>'
                        );
                    });

                    $container.on('click', '.js-dp-remove-manager', function() {
                        $(this).closest('.dist-manager-row').remove();
                    });
                },

                collect: function($container) {
                    var managers = [];
                    $container.find('.js-dp-manager-select').each(function() {
                        var id = $(this).val();
                        if (id) managers.push({ id: id });
                    });
                    return {
                        managers:       managers,
                        check_history:  $container.find('.js-dp-check-history').is(':checked'),
                        check_schedule: $container.find('.js-dp-check-schedule').is(':checked')
                    };
                }
            };
        };

        /** Digital Pipeline — action triggered on event */
        self.dpInit = function(pipeline, status, lead) {
            var dpSettings = self.params.dp || {};
            handleDpEvent({
                lead:           lead,
                pipeline_id:    pipeline.id,
                lead_status_id: status.id
            }, dpSettings);
            return true;
        };

        /** Called when lead is created/updated (non-DP hook) */
        self.lead_selected = function() {
            return true;
        };

        /** Called to destroy / clean up */
        self.destroy = function() {
            return true;
        };

        /** Called when widget loaded on a page but not yet initialized */
        self.contacts = {
            selected: function() { return true; }
        };

        return self;
    };

    return CustomWidget;
});
