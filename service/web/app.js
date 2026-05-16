'use strict';

/* ============================================================
 * Basa SPA — vanilla JS, hash-router.
 *
 * Роли (из ТЗ §1.3):
 *   admin       — всё
 *   accountant  — выплаты + экспорт XLSX
 *   analyst     — свои проекты, выплаты, метрики
 * ============================================================ */

const API = '/api/v1';
const TOKEN_KEY = 'basa.access_token';
const REFRESH_KEY = 'basa.refresh_token';
const USER_KEY = 'basa.user';

const STATUS_LABELS = {
    in_progress: 'В работе',
    done: 'Завершён',
    paid: 'Оплачен',
    cancelled: 'Отменён',
    accrued: 'Начислено',
    ready: 'К выплате',
    active: 'Активен',
    archived: 'В архиве',
};

const TABS = [
    { id: 'projects', label: 'Проекты', roles: ['admin', 'accountant', 'analyst'] },
    { id: 'payments', label: 'Выплаты', roles: ['admin', 'accountant', 'analyst'] },
    { id: 'metrics', label: 'Эффективность', roles: ['admin', 'accountant', 'analyst'] },
    { id: 'analysts', label: 'Аналитики', roles: ['admin'] },
    { id: 'users', label: 'Пользователи', roles: ['admin'] },
    { id: 'amocrm', label: 'AmoCRM', roles: ['admin'] },
    { id: 'webhook-log', label: 'Журнал AmoCRM', roles: ['admin'] },
    { id: 'settings', label: 'Настройки', roles: ['admin'] },
];

const state = {
    analystsCache: null,
};

/* ----------------------- Auth ----------------------- */

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function getRefresh() { return localStorage.getItem(REFRESH_KEY); }
function getUser() { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } }

function setSession(tokens, user) {
    localStorage.setItem(TOKEN_KEY, tokens.access_token);
    localStorage.setItem(REFRESH_KEY, tokens.refresh_token);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
}

async function api(path, options = {}) {
    const opts = { headers: { ...(options.headers || {}) }, ...options };
    if (opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData)) {
        opts.body = JSON.stringify(opts.body);
        opts.headers['Content-Type'] = 'application/json';
    }
    const token = getToken();
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;

    let res = await fetch(API + path, opts);
    if (res.status === 401 && getRefresh()) {
        // пробуем refresh
        const ok = await tryRefresh();
        if (ok) {
            opts.headers['Authorization'] = `Bearer ${getToken()}`;
            res = await fetch(API + path, opts);
        }
    }
    if (res.status === 401) {
        clearSession();
        location.hash = '';
        showLogin();
        throw new Error('Сессия истекла');
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    const body = ct.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) {
        const msg = typeof body === 'string' ? body : (body.detail || JSON.stringify(body));
        throw new Error(msg);
    }
    return body;
}

async function tryRefresh() {
    try {
        const res = await fetch(API + '/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: getRefresh() }),
        });
        if (!res.ok) return false;
        const tokens = await res.json();
        setSession(tokens);
        return true;
    } catch { return false; }
}

/* ----------------------- Bootstrap ----------------------- */

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('login-form').addEventListener('submit', onLogin);
    document.getElementById('logout-btn').addEventListener('click', () => {
        clearSession();
        showLogin();
    });
    window.addEventListener('hashchange', route);

    if (getToken()) {
        try {
            const me = await api('/auth/me');
            setSession({ access_token: getToken(), refresh_token: getRefresh() }, me);
            showApp(me);
        } catch {
            showLogin();
        }
    } else {
        showLogin();
    }
});

async function onLogin(e) {
    e.preventDefault();
    const errEl = document.getElementById('login-error');
    errEl.hidden = true;
    const form = e.target;
    try {
        const tokens = await fetch(API + '/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: form.email.value, password: form.password.value }),
        }).then(r => r.ok ? r.json() : r.json().then(b => { throw new Error(b.detail || 'login failed'); }));

        setSession(tokens);
        const me = await api('/auth/me');
        setSession(tokens, me);
        showApp(me);
    } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
    }
}

function showLogin() {
    document.getElementById('login-screen').hidden = false;
    document.getElementById('app').hidden = true;
}

function showApp(user) {
    document.getElementById('login-screen').hidden = true;
    document.getElementById('app').hidden = false;
    document.getElementById('user-email').textContent = user.email;
    const roleBadge = document.getElementById('user-role');
    roleBadge.textContent = user.role;
    roleBadge.className = `badge role-${user.role}`;
    // Кнопка «Сменить пароль» — добавляем в user-info один раз
    const userInfo = document.querySelector('.user-info');
    if (!userInfo.querySelector('[data-action=change-password]')) {
        const btn = el('button', {
            'data-action': 'change-password',
            class: 'btn-link',
            on: { click: changeOwnPassword },
        }, 'Сменить пароль');
        userInfo.insertBefore(btn, document.getElementById('logout-btn'));
    }
    renderTabs(user);
    if (!location.hash) location.hash = '#/projects';
    route();
}

function renderTabs(user) {
    const tabs = document.getElementById('tabs');
    tabs.innerHTML = '';
    TABS.filter(t => t.roles.includes(user.role)).forEach(t => {
        const btn = document.createElement('button');
        btn.className = 'tab';
        btn.dataset.id = t.id;
        btn.textContent = t.label;
        btn.addEventListener('click', () => { location.hash = `#/${t.id}`; });
        tabs.appendChild(btn);
    });
}

function route() {
    if (!getToken()) return;
    const id = (location.hash || '#/projects').replace(/^#\//, '');
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.id === id));
    const handler = {
        projects: renderProjects,
        payments: renderPayments,
        metrics: renderMetrics,
        analysts: renderAnalysts,
        users: renderUsers,
        amocrm: renderAmocrm,
        'webhook-log': renderWebhookLog,
        settings: renderSettings,
    }[id];
    if (handler) handler();
    else document.getElementById('main').innerHTML = `<p class="empty-state">Раздел не найден</p>`;
}

/* ----------------------- Helpers ----------------------- */

function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
        if (k === 'class') e.className = v;
        else if (k === 'on') Object.entries(v).forEach(([ev, fn]) => e.addEventListener(ev, fn));
        else if (v === true) e.setAttribute(k, '');
        else if (v === false || v == null) {} // skip
        else e.setAttribute(k, v);
    });
    // children всегда уходят через textNode — никакой строки не интерпретируется как HTML
    children.flat().forEach(c => {
        if (c == null || c === false) return;
        e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
}

function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

function fmtMoney(v) {
    const n = Number(v) || 0;
    return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
}

function fmtDuration(seconds) {
    if (seconds == null) return '—';
    const s = Math.round(seconds);
    if (s < 60) return s + ' сек';
    if (s < 3600) return Math.round(s / 60) + ' мин';
    if (s < 86400) return (s / 3600).toFixed(1) + ' ч';
    return (s / 86400).toFixed(1) + ' дн';
}

function statusBadge(status) {
    return el('span', { class: `status-badge status-${status}` }, STATUS_LABELS[status] || status);
}

function toast(message, kind = '') {
    const t = document.getElementById('toast');
    t.textContent = message;
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { t.hidden = true; }, 3500);
}

async function loadAnalysts() {
    if (state.analystsCache) return state.analystsCache;
    state.analystsCache = await api('/analysts');
    return state.analystsCache;
}

function clearAnalystsCache() { state.analystsCache = null; }

function setMain(...children) {
    const main = document.getElementById('main');
    main.innerHTML = '';
    children.forEach(c => main.appendChild(c));
}

function openModal(title, body) {
    document.querySelectorAll('.modal').forEach(m => m.remove());
    const modal = el('div', { class: 'modal' },
        el('div', { class: 'modal-content' },
            el('div', { class: 'modal-header' },
                el('h3', {}, title),
                el('button', { class: 'modal-close', on: { click: () => modal.remove() } }, '×')
            ),
            el('div', { class: 'modal-body' }, body)
        )
    );
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
    return modal;
}

/* ----------------------- Projects ----------------------- */

async function renderProjects() {
    const user = getUser();
    const canEdit = user.role === 'admin';
    const header = el('div', { class: 'page-header' },
        el('h2', {}, 'Проекты'),
        el('div', { class: 'page-actions' },
            statusFilter('projects', renderProjects),
            canEdit ? el('button', { class: 'btn btn-primary', on: { click: () => openProjectModal() } }, '+ Новый проект') : null,
        )
    );

    const main = document.getElementById('main');
    main.innerHTML = '';
    main.appendChild(header);
    main.appendChild(el('div', { class: 'card' }, el('p', { class: 'empty-state' }, 'Загружаем…')));

    try {
        const filters = readFilters('projects');
        const qs = buildQs(filters);
        const [projects, analysts] = await Promise.all([
            api(`/projects${qs}`),
            loadAnalysts(),
        ]);
        const byId = Object.fromEntries(analysts.map(a => [a.id, a.full_name]));

        const tbody = el('tbody');
        projects.forEach(p => {
            tbody.appendChild(el('tr', {},
                el('td', {}, p.name),
                el('td', {}, fmtDate(p.started_at)),
                el('td', {}, byId[p.analyst_id] || '—'),
                el('td', {}, statusBadge(p.status)),
                el('td', { class: 'text-right' }, fmtMoney(p.payment_amount)),
                el('td', {}, p.amo_deal_id ? `Amo #${p.amo_deal_id}` : '—'),
                el('td', { class: 'row-actions' },
                    canEdit ? el('button', { class: 'btn btn-icon', on: { click: () => openProjectModal(p) } }, 'Изменить') : null,
                )
            ));
        });

        const table = projects.length === 0
            ? el('p', { class: 'empty-state' }, 'Пока пусто')
            : el('table', {},
                el('thead', {}, el('tr', {},
                    el('th', {}, 'Название'),
                    el('th', {}, 'Старт'),
                    el('th', {}, 'Аналитик'),
                    el('th', {}, 'Статус'),
                    el('th', { class: 'text-right' }, 'Сумма'),
                    el('th', {}, 'AmoCRM'),
                    el('th', {}, ''),
                )),
                tbody
            );

        const card = main.querySelector('.card');
        card.innerHTML = '';
        card.appendChild(table);
    } catch (e) {
        toast(e.message, 'error');
    }
}

function openProjectModal(project = null) {
    loadAnalysts().then(analysts => {
        const form = el('form', { on: { submit: async (e) => {
            e.preventDefault();
            const data = Object.fromEntries(new FormData(form).entries());
            if (!data.amo_deal_id) delete data.amo_deal_id;
            if (data.payment_amount === '') data.payment_amount = 0;
            data.payment_amount = Number(data.payment_amount);
            if (data.amo_deal_id) data.amo_deal_id = Number(data.amo_deal_id);
            try {
                if (project) await api(`/projects/${project.id}`, { method: 'PATCH', body: data });
                else await api('/projects', { method: 'POST', body: data });
                toast('Сохранено', 'success');
                document.querySelector('.modal').remove();
                renderProjects();
            } catch (err) { toast(err.message, 'error'); }
        }}},
            field('Название', el('input', { name: 'name', required: true, value: project?.name || '' })),
            field('Аналитик', selectFrom('analyst_id', analysts.map(a => ({ value: a.id, label: a.full_name })), project?.analyst_id)),
            field('Статус', selectFrom('status', [
                { value: 'in_progress', label: 'В работе' },
                { value: 'done', label: 'Завершён' },
                { value: 'paid', label: 'Оплачен' },
                { value: 'cancelled', label: 'Отменён' },
            ], project?.status || 'in_progress')),
            field('Сумма выплаты, ₽', el('input', { name: 'payment_amount', type: 'number', step: '0.01', min: '0', value: project?.payment_amount ?? 0 })),
            field('AmoCRM deal id (необязательно)', el('input', { name: 'amo_deal_id', type: 'number', value: project?.amo_deal_id || '' })),
            el('div', { class: 'form-actions' },
                el('button', { type: 'button', class: 'btn', on: { click: () => document.querySelector('.modal').remove() } }, 'Отмена'),
                el('button', { type: 'submit', class: 'btn btn-primary' }, 'Сохранить'),
            )
        );
        openModal(project ? 'Редактировать проект' : 'Новый проект', form);
    });
}

/* ----------------------- Payments ----------------------- */

async function renderPayments() {
    const user = getUser();
    const canExport = user.role === 'admin' || user.role === 'accountant';
    const canPay = canExport;

    const header = el('div', { class: 'page-header' },
        el('h2', {}, 'Выплаты'),
        el('div', { class: 'page-actions' },
            statusFilter('payments', renderPayments, [
                { value: '', label: 'Все статусы' },
                { value: 'accrued', label: 'Начислено' },
                { value: 'ready', label: 'К выплате' },
                { value: 'paid', label: 'Выплачено' },
                { value: 'cancelled', label: 'Отменено' },
            ]),
            canExport ? el('button', { class: 'btn', on: { click: () => exportPaymentsXlsx() } }, 'Экспорт XLSX') : null,
        )
    );

    const main = document.getElementById('main');
    main.innerHTML = '';
    main.appendChild(header);
    main.appendChild(el('div', { class: 'card' }, el('p', { class: 'empty-state' }, 'Загружаем…')));

    try {
        const filters = readFilters('payments');
        const qs = buildQs(filters);
        const [payments, analysts] = await Promise.all([api(`/payments${qs}`), loadAnalysts()]);
        const byId = Object.fromEntries(analysts.map(a => [a.id, a.full_name]));

        const tbody = el('tbody');
        payments.forEach(p => {
            tbody.appendChild(el('tr', {},
                el('td', {}, fmtDate(p.accrued_at)),
                el('td', {}, byId[p.analyst_id] || '—'),
                el('td', { class: 'text-right' }, fmtMoney(p.amount)),
                el('td', {}, statusBadge(p.status)),
                el('td', {}, fmtDate(p.paid_at)),
                el('td', {}, p.comment || ''),
                el('td', { class: 'row-actions' },
                    canPay && (p.status === 'ready' || p.status === 'accrued')
                        ? el('button', { class: 'btn btn-icon btn-primary', on: { click: () => markPaid(p.id) } }, 'Отметить выплату')
                        : null,
                )
            ));
        });

        const table = payments.length === 0
            ? el('p', { class: 'empty-state' }, 'Нет выплат')
            : el('table', {},
                el('thead', {}, el('tr', {},
                    el('th', {}, 'Начислена'),
                    el('th', {}, 'Аналитик'),
                    el('th', { class: 'text-right' }, 'Сумма'),
                    el('th', {}, 'Статус'),
                    el('th', {}, 'Выплачена'),
                    el('th', {}, 'Комментарий'),
                    el('th', {}, ''),
                )),
                tbody
            );

        const card = main.querySelector('.card');
        card.innerHTML = '';
        card.appendChild(table);
    } catch (e) { toast(e.message, 'error'); }
}

async function markPaid(id) {
    const comment = prompt('Комментарий (например, № платёжки):', '') || '';
    try {
        await api(`/payments/${id}/mark-paid`, { method: 'POST', body: { comment } });
        toast('Выплата отмечена', 'success');
        renderPayments();
    } catch (e) { toast(e.message, 'error'); }
}

async function exportPaymentsXlsx() {
    const filters = readFilters('payments');
    const qs = buildQs(filters);
    const res = await fetch(API + '/payments/export.xlsx' + qs, {
        headers: { 'Authorization': `Bearer ${getToken()}` },
    });
    if (!res.ok) {
        toast('Не удалось получить файл', 'error');
        return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (res.headers.get('content-disposition') || '').match(/filename="?([^";]+)"?/)?.[1] || 'payments.xlsx';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
}

/* ----------------------- Metrics ----------------------- */

async function renderMetrics() {
    const main = document.getElementById('main');
    main.innerHTML = '';

    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    const fromInput = el('input', { type: 'date', value: monthAgo.toISOString().slice(0, 10) });
    const toInput = el('input', { type: 'date', value: now.toISOString().slice(0, 10) });

    const header = el('div', { class: 'page-header' },
        el('h2', {}, 'Эффективность'),
        el('div', { class: 'page-actions' },
            field('С', fromInput),
            field('По', toInput),
            el('button', { class: 'btn btn-primary', on: { click: () => load() } }, 'Обновить'),
        )
    );
    const grid = el('div', { class: 'card' }, el('p', { class: 'empty-state' }, 'Загружаем…'));

    main.appendChild(header);
    main.appendChild(grid);

    async function load() {
        try {
            const from = fromInput.value + 'T00:00:00Z';
            const to = toInput.value + 'T23:59:59Z';
            const data = await api(`/metrics/dashboard?from=${from}&to=${to}`);
            renderDashboard(grid, data);
        } catch (e) { toast(e.message, 'error'); }
    }
    load();
}

function renderDashboard(container, data) {
    container.innerHTML = '';
    if (!data.rows || data.rows.length === 0) {
        container.appendChild(el('p', { class: 'empty-state' }, 'Нет данных за выбранный период'));
        return;
    }
    const tbody = el('tbody');
    data.rows.forEach(r => {
        const pctClass = r.overdue_pct === 0 ? 'success' : r.overdue_pct > 20 ? 'danger' : 'warning';
        tbody.appendChild(el('tr', {},
            el('td', {}, r.analyst_name),
            el('td', { class: 'text-right' }, String(r.closed_total)),
            el('td', { class: 'text-right' }, String(r.closed_overdue)),
            el('td', { class: 'text-right' },
                el('span', { class: `metric-card-pct value ${pctClass}` }, r.overdue_pct.toFixed(2) + ' %')
            ),
            el('td', { class: 'text-right' }, fmtDuration(r.avg_overdue_seconds)),
            el('td', { class: 'text-right' }, String(r.open_overdue)),
            el('td', { class: 'text-right' }, String(r.open_no_deadline)),
        ));
    });
    container.appendChild(el('table', {},
        el('thead', {}, el('tr', {},
            el('th', {}, 'Аналитик'),
            el('th', { class: 'text-right' }, 'Закрыто'),
            el('th', { class: 'text-right' }, 'С просрочкой'),
            el('th', { class: 'text-right' }, '% просрочек'),
            el('th', { class: 'text-right' }, 'Средняя задержка'),
            el('th', { class: 'text-right' }, 'Открытых просрочено'),
            el('th', { class: 'text-right' }, 'Без срока'),
        )),
        tbody
    ));
}

/* ----------------------- Analysts (admin) ----------------------- */

async function renderAnalysts() {
    const header = el('div', { class: 'page-header' },
        el('h2', {}, 'Аналитики'),
        el('div', { class: 'page-actions' },
            el('button', { class: 'btn btn-primary', on: { click: () => openAnalystModal() } }, '+ Новый аналитик'),
        )
    );
    const card = el('div', { class: 'card' }, el('p', { class: 'empty-state' }, 'Загружаем…'));
    setMain(header, card);

    try {
        clearAnalystsCache();
        const analysts = await loadAnalysts();
        if (analysts.length === 0) {
            card.innerHTML = '';
            card.appendChild(el('p', { class: 'empty-state' }, 'Аналитиков пока нет'));
            return;
        }
        const tbody = el('tbody');
        analysts.forEach(a => {
            tbody.appendChild(el('tr', {},
                el('td', {}, a.full_name),
                el('td', {}, a.email),
                el('td', {}, a.amo_user_id ? String(a.amo_user_id) : '—'),
                el('td', { class: 'text-right' }, fmtMoney(a.default_rate)),
                el('td', {}, statusBadge(a.status)),
                el('td', { class: 'row-actions' },
                    el('button', { class: 'btn btn-icon', on: { click: () => openAnalystModal(a) } }, 'Изменить'),
                )
            ));
        });
        card.innerHTML = '';
        card.appendChild(el('table', {},
            el('thead', {}, el('tr', {},
                el('th', {}, 'ФИО'),
                el('th', {}, 'Email'),
                el('th', {}, 'AmoCRM user id'),
                el('th', { class: 'text-right' }, 'Ставка'),
                el('th', {}, 'Статус'),
                el('th', {}, ''),
            )),
            tbody
        ));
    } catch (e) { toast(e.message, 'error'); }
}

function openAnalystModal(analyst = null) {
    const form = el('form', { on: { submit: async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());
        if (!data.amo_user_id) delete data.amo_user_id;
        else data.amo_user_id = Number(data.amo_user_id);
        data.default_rate = Number(data.default_rate || 0);
        try {
            if (analyst) await api(`/analysts/${analyst.id}`, { method: 'PATCH', body: data });
            else await api('/analysts', { method: 'POST', body: data });
            toast('Сохранено', 'success');
            document.querySelector('.modal').remove();
            renderAnalysts();
        } catch (err) { toast(err.message, 'error'); }
    }}},
        field('ФИО', el('input', { name: 'full_name', required: true, value: analyst?.full_name || '' })),
        field('Email', el('input', { name: 'email', type: 'email', required: true, value: analyst?.email || '' })),
        field('AmoCRM user id', el('input', { name: 'amo_user_id', type: 'number', value: analyst?.amo_user_id || '' })),
        field('Ставка по умолчанию, ₽', el('input', { name: 'default_rate', type: 'number', step: '0.01', min: '0', value: analyst?.default_rate ?? 0 })),
        field('Статус', selectFrom('status', [
            { value: 'active', label: 'Активен' },
            { value: 'archived', label: 'В архиве' },
        ], analyst?.status || 'active')),
        el('div', { class: 'form-actions' },
            el('button', { type: 'button', class: 'btn', on: { click: () => document.querySelector('.modal').remove() } }, 'Отмена'),
            el('button', { type: 'submit', class: 'btn btn-primary' }, 'Сохранить'),
        )
    );
    openModal(analyst ? 'Редактировать аналитика' : 'Новый аналитик', form);
}

/* ----------------------- Webhook log (admin) ----------------------- */

async function renderWebhookLog() {
    const header = el('div', { class: 'page-header' },
        el('h2', {}, 'Журнал AmoCRM'),
        el('div', { class: 'page-actions' },
            el('button', { class: 'btn', on: { click: () => requeueUnprocessed() } }, 'Переотправить необработанные'),
        )
    );
    const card = el('div', { class: 'card' }, el('p', { class: 'empty-state' }, 'Загружаем…'));
    setMain(header, card);

    try {
        const [logs, alerts] = await Promise.all([
            api('/webhook-log?limit=100'),
            api('/alerts/status').catch(() => null),
        ]);
        const alertBlock = alerts
            ? el('div', { class: 'metric-grid' },
                metricCard('Ошибок за последний час', String(alerts.errors_last_hour),
                    alerts.triggered ? 'danger' : (alerts.errors_last_hour > 0 ? 'warning' : 'success')),
                metricCard('Порог алерта', String(alerts.threshold), ''),
            )
            : null;

        const tbody = el('tbody');
        logs.forEach(l => {
            const row = el('tr', {},
                el('td', {}, fmtDate(l.received_at)),
                el('td', {}, l.event_type),
                el('td', {}, l.processed ? '✓' : '—'),
                el('td', {}, l.error ? el('span', { class: 'status-badge status-cancelled', title: l.error }, 'Ошибка') : ''),
                el('td', { class: 'row-actions' },
                    el('button', { class: 'btn btn-icon', on: { click: () => showLogDetails(l.id) } }, 'Посмотреть'),
                    el('button', { class: 'btn btn-icon', on: { click: () => reprocessOne(l.id) } }, 'Переобработать'),
                )
            );
            tbody.appendChild(row);
        });

        card.innerHTML = '';
        if (alertBlock) { setMain(header, alertBlock, card); }
        if (logs.length === 0) {
            card.appendChild(el('p', { class: 'empty-state' }, 'Пока ничего нет'));
        } else {
            card.appendChild(el('table', {},
                el('thead', {}, el('tr', {},
                    el('th', {}, 'Время'),
                    el('th', {}, 'Событие'),
                    el('th', {}, 'Обработано'),
                    el('th', {}, ''),
                    el('th', {}, ''),
                )),
                tbody
            ));
        }
    } catch (e) { toast(e.message, 'error'); }
}

async function showLogDetails(id) {
    try {
        const log = await api(`/webhook-log/${id}`);
        openModal(`Событие ${log.event_type}`,
            el('div', { class: 'json-box' }, JSON.stringify(log, null, 2))
        );
    } catch (e) { toast(e.message, 'error'); }
}

async function reprocessOne(id) {
    try {
        const r = await api(`/webhook-log/${id}/reprocess?sync=true`, { method: 'POST' });
        toast('Переобработано: ' + (r.facts_count || 0) + ' лидов / ' + (r.tasks_count || 0) + ' задач', 'success');
        renderWebhookLog();
    } catch (e) { toast(e.message, 'error'); }
}

async function requeueUnprocessed() {
    try {
        const r = await api('/webhook-log/reprocess-unprocessed?limit=500', { method: 'POST' });
        toast(`Переотправлено: ${r.requeued}`, 'success');
        renderWebhookLog();
    } catch (e) { toast(e.message, 'error'); }
}

/* ----------------------- Users (admin) ----------------------- */

const ROLE_LABELS = { admin: 'Админ', accountant: 'Бухгалтер', analyst: 'Аналитик' };

async function renderUsers() {
    const header = el('div', { class: 'page-header' },
        el('h2', {}, 'Пользователи'),
        el('div', { class: 'page-actions' },
            el('button', { class: 'btn btn-primary', on: { click: () => openUserModal() } }, '+ Новый пользователь'),
        )
    );
    const card = el('div', { class: 'card' }, el('p', { class: 'empty-state' }, 'Загружаем…'));
    setMain(header, card);
    try {
        const users = await api('/users');
        if (users.length === 0) {
            card.innerHTML = '';
            card.appendChild(el('p', { class: 'empty-state' }, 'Пока пусто'));
            return;
        }
        const tbody = el('tbody');
        users.forEach(u => {
            tbody.appendChild(el('tr', {},
                el('td', {}, u.email),
                el('td', {}, u.full_name || '—'),
                el('td', {}, ROLE_LABELS[u.role] || u.role),
                el('td', {}, u.is_active ? '✓' : '—'),
                el('td', { class: 'row-actions' },
                    el('button', { class: 'btn btn-icon', on: { click: () => openUserModal(u) } }, 'Изменить'),
                    el('button', { class: 'btn btn-icon', on: { click: () => resetPassword(u) } }, 'Сбросить пароль'),
                )
            ));
        });
        card.innerHTML = '';
        card.appendChild(el('table', {},
            el('thead', {}, el('tr', {},
                el('th', {}, 'Email'),
                el('th', {}, 'ФИО'),
                el('th', {}, 'Роль'),
                el('th', {}, 'Активен'),
                el('th', {}, ''),
            )),
            tbody
        ));
    } catch (e) { toast(e.message, 'error'); }
}

function openUserModal(user = null) {
    const form = el('form', { on: { submit: async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());
        try {
            if (user) {
                const patch = { full_name: data.full_name, role: data.role, is_active: data.is_active === 'true' };
                await api(`/users/${user.id}`, { method: 'PATCH', body: patch });
            } else {
                await api('/users', { method: 'POST', body: data });
            }
            toast('Сохранено', 'success');
            document.querySelector('.modal').remove();
            renderUsers();
        } catch (err) { toast(err.message, 'error'); }
    }}},
        field('Email', el('input', { name: 'email', type: 'email', required: true, value: user?.email || '', disabled: !!user })),
        user ? null : field('Пароль (минимум 8 символов)', el('input', { name: 'password', type: 'password', minlength: '8', required: true })),
        field('ФИО', el('input', { name: 'full_name', value: user?.full_name || '' })),
        field('Роль', selectFrom('role', [
            { value: 'admin', label: 'Админ' },
            { value: 'accountant', label: 'Бухгалтер' },
            { value: 'analyst', label: 'Аналитик' },
        ], user?.role || 'analyst')),
        user ? field('Активен', selectFrom('is_active', [
            { value: 'true', label: 'Активен' },
            { value: 'false', label: 'Деактивирован' },
        ], String(user.is_active))) : null,
        el('div', { class: 'form-actions' },
            el('button', { type: 'button', class: 'btn', on: { click: () => document.querySelector('.modal').remove() } }, 'Отмена'),
            el('button', { type: 'submit', class: 'btn btn-primary' }, 'Сохранить'),
        )
    );
    openModal(user ? `Пользователь ${user.email}` : 'Новый пользователь', form);
}

async function resetPassword(user) {
    const pwd = prompt(`Новый пароль для ${user.email} (минимум 8 символов):`);
    if (!pwd) return;
    if (pwd.length < 8) return toast('Минимум 8 символов', 'error');
    try {
        await api(`/users/${user.id}/password`, { method: 'POST', body: { new_password: pwd } });
        toast('Пароль обновлён', 'success');
    } catch (e) { toast(e.message, 'error'); }
}

async function changeOwnPassword() {
    const cur = prompt('Текущий пароль:');
    if (cur == null) return;
    const next = prompt('Новый пароль (минимум 8 символов):');
    if (!next || next.length < 8) return toast('Минимум 8 символов', 'error');
    try {
        await api('/users/me/password', {
            method: 'POST',
            body: { current_password: cur, new_password: next },
        });
        toast('Пароль обновлён', 'success');
    } catch (e) { toast(e.message, 'error'); }
}

/* ----------------------- AmoCRM (admin) ----------------------- */

async function renderAmocrm() {
    const header = el('div', { class: 'page-header' }, el('h2', {}, 'Интеграция с AmoCRM'));
    const grid = el('div', { class: 'metric-grid' });
    const actions = el('div', { class: 'card', style: 'padding: 16px; margin-bottom: 16px; display: flex; gap: 8px; flex-wrap: wrap;' });
    const mappingBox = el('div', { class: 'card', style: 'padding: 16px; margin-bottom: 16px;' },
        el('h3', { style: 'margin: 0 0 8px;' }, 'Сопоставление пользователей AmoCRM ↔ Аналитики'),
        el('p', { class: 'muted', style: 'margin: 0 0 12px;' },
            'Подтягиваем список пользователей AmoCRM и показываем, кто из ваших аналитиков уже привязан. Без привязки автосоздание проектов по вебхукам не работает — сделка приходит с responsible_user_id, мы не знаем, кому это назначать.'),
        el('div', { id: 'amo-mapping' }, el('p', { class: 'muted' }, 'Подключите AmoCRM, чтобы увидеть список.')),
    );
    const syncBox = el('div', { class: 'card', style: 'padding: 16px;' },
        el('h3', { style: 'margin: 0 0 8px;' }, 'Ручная синхронизация'),
        el('p', { class: 'muted', style: 'margin: 0 0 12px;' }, 'Подтягивает изменения за последние 24 часа. Безопасно запускать в любой момент — повтор не создаёт дублей.'),
        el('div', { style: 'display: flex; gap: 8px; flex-wrap: wrap;' },
            el('button', { class: 'btn', on: { click: () => runSync('/amo/sync/run', 'Сделки') } }, 'Подтянуть сделки'),
            el('button', { class: 'btn', on: { click: () => runSync('/amo/sync/tasks', 'Задачи') } }, 'Подтянуть задачи'),
        ),
        el('div', { id: 'sync-result', class: 'json-box', style: 'margin-top: 12px; display: none;' }),
    );
    setMain(header, grid, actions, mappingBox, syncBox);

    try {
        const status = await api('/amo/oauth/status');
        grid.innerHTML = '';
        grid.appendChild(metricCard('Env настроен', status.configured ? 'Да' : 'Нет', status.configured ? 'success' : 'danger'));
        grid.appendChild(metricCard('Подключено', status.connected ? 'Да' : 'Нет', status.connected ? 'success' : 'warning'));
        grid.appendChild(metricCard('Token expires', status.access_token_expires_at ? fmtDate(status.access_token_expires_at) : '—',
            status.access_token_expired ? 'danger' : ''));
        grid.appendChild(metricCard('Account base url', status.base_url || '—', ''));

        actions.innerHTML = '';
        if (!status.configured) {
            actions.appendChild(el('p', { class: 'muted' }, 'Сначала задайте AMO_CLIENT_ID, AMO_CLIENT_SECRET, AMO_REDIRECT_URI и AMO_BASE_URL в .env и перезапустите контейнер. См. AMOCRM_SETUP.md.'));
        } else {
            const btn = el('button', {
                class: 'btn btn-primary',
                on: { click: async () => {
                    try {
                        const r = await api('/amo/oauth/start');
                        location.href = r.url;
                    } catch (e) { toast(e.message, 'error'); }
                }},
            }, status.connected ? 'Переподключить' : 'Подключить AmoCRM');
            actions.appendChild(btn);

            actions.appendChild(el('button', {
                class: 'btn',
                on: { click: () => pingAmo() },
            }, 'Проверить связь'));

            if (status.connected) {
                actions.appendChild(el('button', {
                    class: 'btn btn-danger',
                    on: { click: () => disconnectAmo() },
                }, 'Отключить'));
                // Сразу подгружаем маппинг для удобства
                loadAmoMapping();
            }
        }
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function loadAmoMapping() {
    const box = document.getElementById('amo-mapping');
    if (!box) return;
    box.innerHTML = '';
    box.appendChild(el('p', { class: 'muted' }, 'Загружаем список пользователей AmoCRM…'));

    let amoUsers, analysts;
    try {
        amoUsers = (await api('/amo/users')).users;
        analysts = await api('/analysts');
    } catch (e) {
        box.innerHTML = '';
        box.appendChild(el('p', { class: 'muted' }, 'Не удалось получить список: ' + e.message));
        return;
    }

    if (amoUsers.length === 0) {
        box.innerHTML = '';
        box.appendChild(el('p', { class: 'empty-state' }, 'AmoCRM не вернул ни одного пользователя.'));
        return;
    }

    const analystById = Object.fromEntries(analysts.map(a => [a.id, a]));
    const analystByEmail = Object.fromEntries(analysts.filter(a => a.email).map(a => [a.email.toLowerCase(), a]));

    const tbody = el('tbody');
    amoUsers.forEach(u => {
        const linkedAnalyst = u.analyst_id ? analystById[u.analyst_id] : null;
        const emailSuggest = !linkedAnalyst && u.email ? analystByEmail[u.email.toLowerCase()] : null;

        const select = el('select', { 'data-amo-id': String(u.amo_user_id) });
        select.appendChild(el('option', { value: '' }, '— не привязан —'));
        analysts.forEach(a => {
            const opt = el('option', { value: a.id }, `${a.full_name} (${a.email})`);
            // приоритет: уже привязан > совпадает по email
            if (linkedAnalyst && linkedAnalyst.id === a.id) opt.setAttribute('selected', '');
            else if (!linkedAnalyst && emailSuggest && emailSuggest.id === a.id) opt.setAttribute('selected', '');
            select.appendChild(opt);
        });

        const suggestHint = emailSuggest && !linkedAnalyst
            ? el('div', { class: 'muted', style: 'font-size: 11px; margin-top: 2px;' },
                `подсказка: совпадает по email — ${emailSuggest.full_name}`)
            : null;

        const saveBtn = el('button', { class: 'btn btn-icon', on: { click: () => bindAmoUser(u.amo_user_id, select.value) } }, 'Привязать');
        if (linkedAnalyst) saveBtn.textContent = 'Переназначить';

        tbody.appendChild(el('tr', {},
            el('td', {}, String(u.amo_user_id)),
            el('td', {}, u.name || '—'),
            el('td', {}, u.email || '—'),
            el('td', {},
                linkedAnalyst
                    ? el('span', { class: 'status-badge status-paid' }, linkedAnalyst.full_name)
                    : el('span', { class: 'muted' }, '—'),
                suggestHint,
            ),
            el('td', {}, select),
            el('td', { class: 'row-actions' }, saveBtn),
        ));
    });

    box.innerHTML = '';
    box.appendChild(el('table', {},
        el('thead', {}, el('tr', {},
            el('th', {}, 'AmoCRM id'),
            el('th', {}, 'Имя в AmoCRM'),
            el('th', {}, 'Email'),
            el('th', {}, 'Привязка сейчас'),
            el('th', {}, 'Аналитик'),
            el('th', {}, ''),
        )),
        tbody
    ));
}

async function bindAmoUser(amoUserId, analystId) {
    // Если выбран «не привязан» (пустой) — нужно снять привязку у того аналитика,
    // у которого сейчас этот amo_user_id.
    try {
        if (!analystId) {
            const current = (await api('/analysts')).find(a => a.amo_user_id === amoUserId);
            if (!current) {
                toast('Никто и так не привязан', 'success');
                return;
            }
            await api(`/analysts/${current.id}`, { method: 'PATCH', body: { amo_user_id: null } });
            toast('Привязка снята', 'success');
        } else {
            // 1) Снимаем amo_user_id у любого другого аналитика, у которого он стоит (избегаем UNIQUE-конфликта).
            const others = (await api('/analysts')).filter(a => a.amo_user_id === amoUserId && a.id !== analystId);
            for (const o of others) {
                await api(`/analysts/${o.id}`, { method: 'PATCH', body: { amo_user_id: null } });
            }
            // 2) Ставим выбранному аналитику.
            await api(`/analysts/${analystId}`, { method: 'PATCH', body: { amo_user_id: amoUserId } });
            toast('Сопоставление сохранено', 'success');
        }
        clearAnalystsCache();
        loadAmoMapping();
    } catch (e) { toast(e.message, 'error'); }
}

async function runSync(path, label) {
    const out = document.getElementById('sync-result');
    out.style.display = 'block';
    out.textContent = 'Запускаем…';
    try {
        const r = await api(path, { method: 'POST' });
        out.textContent = JSON.stringify(r, null, 2);
        toast(`${label}: готово`, 'success');
    } catch (e) {
        out.textContent = e.message;
        toast(e.message, 'error');
    }
}

async function pingAmo() {
    try {
        const r = await api('/amo/oauth/ping', { method: 'POST' });
        toast(`Связь есть. Видим пользователей: ${r.users_visible}`, 'success');
    } catch (e) { toast(e.message, 'error'); }
}

async function disconnectAmo() {
    if (!confirm('Отключить AmoCRM? Сохранённые токены будут стёрты.')) return;
    try {
        await api('/amo/oauth/disconnect', { method: 'POST' });
        toast('AmoCRM отключён', 'success');
        renderAmocrm();
    } catch (e) { toast(e.message, 'error'); }
}

/* ----------------------- Settings (admin) ----------------------- */

async function renderSettings() {
    const header = el('div', { class: 'page-header' }, el('h2', {}, 'Настройки'));
    setMain(header,
        settingCard('Маппинг статусов воронки', 'amo_status_map',
            'JSON вида `{"<stage_id>": "<action>"}`. Допустимые действия: start_project, mark_done, mark_ready_for_payout, cancel, none.'),
        settingCard('Учёт типов задач в метриках', 'tracked_task_types',
            'JSON `{"types": [int, ...]}`. Пустой массив или отсутствие ключа = все типы.'),
        settingCard('IP-whitelist для вебхуков AmoCRM', 'amo_webhook_allowed_ips',
            'JSON `{"ips": ["<CIDR>" или "<IP>"]}`. Пустой массив = пропускаем всех.'),
    );
}

function settingCard(title, key, help) {
    const card = el('div', { class: 'card', style: 'padding: 16px; margin-bottom: 16px;' },
        el('h3', { style: 'margin: 0 0 8px;' }, title),
        el('p', { class: 'muted', style: 'margin: 0 0 12px;' }, help),
        el('p', {}, 'Загружаем…')
    );

    api(`/settings/${key}`).then(data => {
        const ta = el('textarea', { rows: 8, style: 'width: 100%; font-family: ui-monospace, monospace;' });
        ta.value = JSON.stringify(data.value || {}, null, 2);
        const save = el('button', { class: 'btn btn-primary', on: { click: async () => {
            let parsed;
            try { parsed = JSON.parse(ta.value); } catch (err) { return toast('Невалидный JSON: ' + err.message, 'error'); }
            try {
                await api(`/settings/${key}`, { method: 'PUT', body: parsed });
                toast('Сохранено', 'success');
            } catch (e) { toast(e.message, 'error'); }
        }}}, 'Сохранить');
        card.lastChild.remove();
        card.appendChild(ta);
        card.appendChild(el('div', { class: 'form-actions' }, save));
    }).catch(e => toast(e.message, 'error'));

    return card;
}

/* ----------------------- Common UI ----------------------- */

function field(label, input) {
    return el('label', {}, label, input);
}

function selectFrom(name, options, selected) {
    const s = el('select', { name });
    options.forEach(o => {
        const opt = el('option', { value: o.value }, o.label);
        if (o.value === selected) opt.setAttribute('selected', '');
        s.appendChild(opt);
    });
    return s;
}

function metricCard(label, value, kind) {
    return el('div', { class: 'metric-card' },
        el('div', { class: 'label' }, label),
        el('div', { class: `value ${kind || ''}` }, value),
    );
}

function statusFilter(scope, onChange, opts = null) {
    const options = opts || [
        { value: '', label: 'Все статусы' },
        { value: 'in_progress', label: 'В работе' },
        { value: 'done', label: 'Завершён' },
        { value: 'paid', label: 'Оплачен' },
        { value: 'cancelled', label: 'Отменён' },
    ];
    const key = `basa.filter.${scope}.status`;
    const current = localStorage.getItem(key) || '';
    const sel = el('select', { on: { change: (e) => { localStorage.setItem(key, e.target.value); onChange(); } } });
    options.forEach(o => {
        const opt = el('option', { value: o.value }, o.label);
        if (o.value === current) opt.setAttribute('selected', '');
        sel.appendChild(opt);
    });
    return sel;
}

function readFilters(scope) {
    return { status: localStorage.getItem(`basa.filter.${scope}.status`) || '' };
}

function buildQs(filters) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
    const s = params.toString();
    return s ? '?' + s : '';
}
