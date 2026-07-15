/**
 * Boss's Eye — Manager Monitoring Module
 * Handles violation tracking and telegram notifications
 */
define(['jquery', 'underscore'], function($, _) {
    'use strict';

    return function(widget) {
        var self = this;
        var $container = null;
        var violationsList = [];
        var pollInterval = null;
        var pollDelay = 5000; // 5 seconds

        self.render = function($panel, settings, system) {
            $container = $panel;

            var html = [
                '<div class="monitor-section">',
                '  <div class="monitor-toolbar">',
                '    <div class="monitor-filters">',
                '      <select class="js-filter-status monitor-select" style="width: auto;">',
                '        <option value="">Все статусы</option>',
                '        <option value="new">Новое</option>',
                '        <option value="sent_to_telegram">Отправлено в ТГ</option>',
                '        <option value="resolved">Разрешено</option>',
                '      </select>',
                '      <select class="js-filter-manager monitor-select" style="width: auto;">',
                '        <option value="">Все менеджеры</option>',
                '      </select>',
                '    </div>',
                '    <div class="monitor-actions">',
                '      <button type="button" class="js-monitor-refresh monitor-btn">⟳ Обновить</button>',
                '    </div>',
                '  </div>',

                '  <table class="monitor-table">',
                '    <thead>',
                '      <tr>',
                '        <th>Менеджер</th>',
                '        <th>Тип нарушения</th>',
                '        <th>Сделка</th>',
                '        <th>Описание</th>',
                '        <th>Время</th>',
                '        <th>Статус</th>',
                '        <th>Действия</th>',
                '      </tr>',
                '    </thead>',
                '    <tbody class="js-violations-list">',
                '      <tr><td colspan="7" style="text-align:center; padding: 20px;">Загрузка...</td></tr>',
                '    </tbody>',
                '  </table>',
                '</div>'
            ].join('');

            $container.html(html);
            bindEvents(settings, system);
            loadViolations(settings, system);
        };

        function bindEvents(settings, system) {
            $container.on('click', '.js-monitor-refresh', function() {
                loadViolations(settings, system);
            });

            $container.on('change', '.js-filter-status, .js-filter-manager', function() {
                renderViolationsTable();
            });

            $container.on('click', '.js-action-forgive', function() {
                var violationId = $(this).data('violation-id');
                resolveViolation(violationId, 'forgive', settings, system, function() {
                    loadViolations(settings, system);
                });
            });

            $container.on('click', '.js-action-punish', function() {
                var violationId = $(this).data('violation-id');
                resolveViolation(violationId, 'punish', settings, system, function() {
                    loadViolations(settings, system);
                });
            });

            $container.on('click', '.js-action-view', function() {
                var leadId = $(this).data('lead-id');
                // Open lead in AmoCRM
                if (window.AMOCRM && AMOCRM.data && AMOCRM.data.account) {
                    var accountId = AMOCRM.data.account.id;
                    window.open('https://' + accountId + '.amocrm.ru/leads/detail/' + leadId, '_blank');
                }
            });

            $container.on('click', '.js-action-send-telegram', function() {
                var violationId = $(this).data('violation-id');
                var $btn = $(this);
                $btn.prop('disabled', true).text('Отправка...');

                sendToTelegram(violationId, settings, system, function(success) {
                    $btn.prop('disabled', false).text('📱 В ТГ');
                    if (success) {
                        loadViolations(settings, system);
                    }
                });
            });
        }

        function loadViolations(settings, system) {
            var serverUrl = $.trim(settings.server_url).replace(/\/$/, '');
            if (!serverUrl) {
                showError('URL сервера не настроен. Откройте настройки виджета.');
                return;
            }

            $.ajax({
                url: serverUrl + '/api/violations',
                type: 'GET',
                dataType: 'json',
                headers: {
                    'X-Account-Id': system.account_id || ''
                },
                success: function(response) {
                    if (response.status === 'ok' && response.violations) {
                        violationsList = response.violations;
                        populateManagerFilters();
                        renderViolationsTable();
                    }
                },
                error: function() {
                    showError('Ошибка загрузки нарушений');
                }
            });
        }

        function populateManagerFilters() {
            var managers = {};
            _.each(violationsList, function(v) {
                if (v.manager_id && v.manager_name) {
                    managers[v.manager_id] = v.manager_name;
                }
            });

            var $select = $container.find('.js-filter-manager');
            var currentValue = $select.val();

            $select.find('option:not(:first)').remove();
            _.each(managers, function(name, id) {
                $select.append('<option value="' + id + '">' + _.escape(name) + '</option>');
            });

            if (currentValue) {
                $select.val(currentValue);
            }
        }

        function renderViolationsTable() {
            var statusFilter = $container.find('.js-filter-status').val();
            var managerFilter = $container.find('.js-filter-manager').val();

            var filtered = _.filter(violationsList, function(v) {
                if (statusFilter && v.status !== statusFilter) return false;
                if (managerFilter && String(v.manager_id) !== managerFilter) return false;
                return true;
            });

            var $tbody = $container.find('.js-violations-list');

            if (filtered.length === 0) {
                $tbody.html(
                    '<tr><td colspan="7" style="text-align:center; padding: 20px;">Нарушений не найдено</td></tr>'
                );
                return;
            }

            var rows = _.map(filtered, function(v) {
                var typeLabel = getViolationTypeLabel(v.type);
                var statusLabel = getStatusLabel(v.status);
                var createdDate = new Date(v.created_at).toLocaleString('ru-RU');

                var actionsHtml = [
                    '<div style="display: flex; gap: 5px; flex-wrap: wrap;">',
                ];

                if (v.status === 'new') {
                    actionsHtml.push(
                        '<button class="js-action-forgive monitor-btn monitor-btn--sm" data-violation-id="' + v.id + '">✓</button>',
                        '<button class="js-action-punish monitor-btn monitor-btn--sm monitor-btn--danger" data-violation-id="' + v.id + '">✗</button>'
                    );
                } else if (v.status === 'sent_to_telegram') {
                    actionsHtml.push(
                        '<button class="js-action-forgive monitor-btn monitor-btn--sm" data-violation-id="' + v.id + '">✓</button>',
                        '<button class="js-action-punish monitor-btn monitor-btn--sm monitor-btn--danger" data-violation-id="' + v.id + '">✗</button>'
                    );
                }

                actionsHtml.push(
                    '<button class="js-action-view monitor-btn monitor-btn--sm" data-lead-id="' + v.lead_id + '">🔍</button>'
                );

                if (v.status === 'new') {
                    actionsHtml.push(
                        '<button class="js-action-send-telegram monitor-btn monitor-btn--sm" data-violation-id="' + v.id + '">📱</button>'
                    );
                }

                actionsHtml.push('</div>');

                return [
                    '<tr>',
                    '<td>' + _.escape(v.manager_name) + '</td>',
                    '<td>' + typeLabel + '</td>',
                    '<td><a href="javascript:void(0)" data-lead-id="' + v.lead_id + '" class="js-action-view" style="cursor: pointer; color: #0066cc;">#' + v.lead_id + ' ' + _.escape(v.lead_title) + '</a></td>',
                    '<td>' + _.escape(v.message) + '</td>',
                    '<td><small>' + createdDate + '</small></td>',
                    '<td><span class="monitor-status monitor-status--' + v.status + '">' + statusLabel + '</span></td>',
                    '<td>' + actionsHtml.join('') + '</td>',
                    '</tr>'
                ].join('');
            });

            $tbody.html(rows.join(''));
        }

        function resolveViolation(violationId, action, settings, system, callback) {
            var serverUrl = $.trim(settings.server_url).replace(/\/$/, '');
            if (!serverUrl) {
                showError('URL сервера не настроен');
                return;
            }

            $.ajax({
                url: serverUrl + '/api/violations/' + violationId,
                type: 'PUT',
                dataType: 'json',
                contentType: 'application/json',
                headers: {
                    'X-Account-Id': system.account_id || ''
                },
                data: JSON.stringify({ action: action }),
                success: function(response) {
                    if (response.status === 'ok') {
                        showSuccess('Нарушение обработано');
                        if (callback) callback();
                    }
                },
                error: function() {
                    showError('Ошибка обработки нарушения');
                }
            });
        }

        function sendToTelegram(violationId, settings, system, callback) {
            var serverUrl = $.trim(settings.server_url).replace(/\/$/, '');
            if (!serverUrl) {
                showError('URL сервера не настроен');
                if (callback) callback(false);
                return;
            }

            $.ajax({
                url: serverUrl + '/api/violations/' + violationId + '/send-telegram',
                type: 'POST',
                dataType: 'json',
                contentType: 'application/json',
                headers: {
                    'X-Account-Id': system.account_id || ''
                },
                success: function(response) {
                    if (response.status === 'ok') {
                        showSuccess('Отправлено в Telegram');
                        if (callback) callback(true);
                    }
                },
                error: function() {
                    showError('Ошибка отправки в Telegram');
                    if (callback) callback(false);
                }
            });
        }

        function getViolationTypeLabel(type) {
            var labels = {
                'delay_response': 'Задержка ответа',
                'client_waiting': 'Клиент ждёт',
                'delay_kp': 'Задержка КП'
            };
            return labels[type] || type;
        }

        function getStatusLabel(status) {
            var labels = {
                'new': 'Новое',
                'sent_to_telegram': 'В ТГ',
                'resolved': 'Разрешено'
            };
            return labels[status] || status;
        }

        function showError(message) {
            if (window.AMOCRM && AMOCRM.notifications) {
                AMOCRM.notifications.show_message({
                    header: 'Ошибка',
                    text: message,
                    timeout: 3000
                });
            }
        }

        function showSuccess(message) {
            if (window.AMOCRM && AMOCRM.notifications) {
                AMOCRM.notifications.show_message({
                    header: 'Успешно',
                    text: message,
                    timeout: 2000
                });
            }
        }

        return self;
    };
});
