'use strict';

const API_BASE = 'api/';

const STATUS_LABELS = {
    launched:   'Запущен',
    in_progress:'В работе',
    completed:  'Завершён',
    cancelled:  'Отменён',
};

const state = {
    projects: [],
    analysts: [],
    stats: [],
    filters: { search: '', status: '' },
};

document.addEventListener('DOMContentLoaded', () => {
    bindTabs();
    bindProjectUi();
    bindAnalystUi();
    bindModalClose();
    refreshAll();
});

/* ---------- API ---------- */

async function api(path, options = {}) {
    const opts = { headers: { 'Content-Type': 'application/json' }, ...options };
    if (opts.body && typeof opts.body !== 'string') {
        opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(API_BASE + path, opts);
    if (res.status === 204) return null;
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
        throw new Error((data && data.error) || `HTTP ${res.status}`);
    }
    return data;
}

async function refreshAll() {
    try {
        const [analysts, projects, stats] = await Promise.all([
            api('analysts'),
            api('projects'),
            api('stats'),
        ]);
        state.analysts = analysts;
        state.projects = projects;
        state.stats = stats;
        renderProjects();
        renderAnalysts();
        renderStats();
        populateAnalystSelect();
    } catch (e) {
        toast(e.message, 'error');
    }
}

/* ---------- Tabs ---------- */

function bindTabs() {
    document.querySelectorAll('.tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        });
    });
}

/* ---------- Projects ---------- */

function bindProjectUi() {
    document.getElementById('btn-add-project').addEventListener('click', () => openProjectModal());

    document.getElementById('project-search').addEventListener('input', e => {
        state.filters.search = e.target.value.toLowerCase();
        renderProjects();
    });

    document.getElementById('project-status-filter').addEventListener('change', e => {
        state.filters.status = e.target.value;
        renderProjects();
    });

    document.getElementById('project-form').addEventListener('submit', async e => {
        e.preventDefault();
        const form = e.target;
        const data = Object.fromEntries(new FormData(form).entries());
        const id = data.id || null;
        delete data.id;
        if (data.custom_bonus === '') data.custom_bonus = null;
        if (data.budget === '') data.budget = 0;

        try {
            if (id) {
                await api('projects/' + id, { method: 'PUT', body: data });
                toast('Проект обновлён', 'success');
            } else {
                await api('projects', { method: 'POST', body: data });
                toast('Проект добавлен', 'success');
            }
            closeModal('project-modal');
            await refreshAll();
        } catch (err) {
            toast(err.message, 'error');
        }
    });
}

function openProjectModal(project = null) {
    if (state.analysts.length === 0) {
        toast('Сначала добавьте хотя бы одного аналитика', 'error');
        return;
    }
    const modal = document.getElementById('project-modal');
    const form = document.getElementById('project-form');
    form.reset();
    document.getElementById('project-modal-title').textContent =
        project ? 'Редактировать проект' : 'Новый проект';

    populateAnalystSelect();

    if (project) {
        form.id.value = project.id;
        form.name.value = project.name;
        form.started_at.value = project.started_at;
        form.analyst_id.value = project.analyst_id;
        form.status.value = project.status;
        form.budget.value = project.budget;
        form.custom_bonus.value = project.custom_bonus ?? '';
        form.notes.value = project.notes || '';
    } else {
        form.id.value = '';
        form.started_at.value = new Date().toISOString().slice(0, 10);
        form.status.value = 'launched';
        form.budget.value = 0;
    }
    modal.hidden = false;
}

function renderProjects() {
    const tbody = document.querySelector('#projects-table tbody');
    const empty = document.getElementById('projects-empty');
    tbody.innerHTML = '';

    const filtered = state.projects.filter(p => {
        if (state.filters.status && p.status !== state.filters.status) return false;
        if (state.filters.search && !p.name.toLowerCase().includes(state.filters.search)) return false;
        return true;
    });

    if (filtered.length === 0) {
        empty.hidden = false;
        empty.textContent = state.projects.length === 0
            ? 'Пока нет ни одного проекта. Добавьте первый.'
            : 'По заданным фильтрам ничего не найдено.';
        return;
    }
    empty.hidden = true;

    filtered
        .slice()
        .sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''))
        .forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(p.name)}</td>
                <td>${formatDate(p.started_at)}</td>
                <td>${escapeHtml(p.analyst_name || '—')}</td>
                <td><span class="badge badge-${p.status}">${STATUS_LABELS[p.status] || p.status}</span></td>
                <td class="text-right">${formatMoney(p.budget)}</td>
                <td class="text-right">${formatMoney(p.bonus)}</td>
                <td class="row-actions">
                    <button class="btn btn-icon" data-edit="${p.id}">Изменить</button>
                    <button class="btn btn-icon btn-danger" data-delete="${p.id}">Удалить</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

    tbody.querySelectorAll('[data-edit]').forEach(btn => {
        btn.addEventListener('click', () => {
            const project = state.projects.find(p => p.id === btn.dataset.edit);
            if (project) openProjectModal(project);
        });
    });

    tbody.querySelectorAll('[data-delete]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const project = state.projects.find(p => p.id === btn.dataset.delete);
            if (!project) return;
            if (!confirm(`Удалить проект «${project.name}»?`)) return;
            try {
                await api('projects/' + project.id, { method: 'DELETE' });
                toast('Проект удалён', 'success');
                await refreshAll();
            } catch (err) {
                toast(err.message, 'error');
            }
        });
    });
}

function populateAnalystSelect() {
    const select = document.querySelector('#project-form select[name="analyst_id"]');
    if (!select) return;
    const current = select.value;
    select.innerHTML = state.analysts
        .map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`)
        .join('');
    if (current) select.value = current;
}

/* ---------- Analysts ---------- */

function bindAnalystUi() {
    document.getElementById('btn-add-analyst').addEventListener('click', () => openAnalystModal());

    document.getElementById('analyst-form').addEventListener('submit', async e => {
        e.preventDefault();
        const form = e.target;
        const data = Object.fromEntries(new FormData(form).entries());
        const id = data.id || null;
        delete data.id;

        try {
            if (id) {
                await api('analysts/' + id, { method: 'PUT', body: data });
                toast('Аналитик обновлён', 'success');
            } else {
                await api('analysts', { method: 'POST', body: data });
                toast('Аналитик добавлен', 'success');
            }
            closeModal('analyst-modal');
            await refreshAll();
        } catch (err) {
            toast(err.message, 'error');
        }
    });
}

function openAnalystModal(analyst = null) {
    const modal = document.getElementById('analyst-modal');
    const form = document.getElementById('analyst-form');
    form.reset();
    document.getElementById('analyst-modal-title').textContent =
        analyst ? 'Редактировать аналитика' : 'Новый аналитик';

    if (analyst) {
        form.id.value = analyst.id;
        form.name.value = analyst.name;
        form.rate_type.value = analyst.rate_type;
        form.rate_value.value = analyst.rate_value;
    } else {
        form.id.value = '';
        form.rate_type.value = 'percent';
        form.rate_value.value = '';
    }
    modal.hidden = false;
}

function renderAnalysts() {
    const tbody = document.querySelector('#analysts-table tbody');
    const empty = document.getElementById('analysts-empty');
    tbody.innerHTML = '';

    if (state.analysts.length === 0) {
        empty.hidden = false;
        return;
    }
    empty.hidden = true;

    state.analysts
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach(a => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(a.name)}</td>
                <td>${a.rate_type === 'percent' ? '% от бюджета' : 'Фикс. сумма'}</td>
                <td class="text-right">${a.rate_type === 'percent' ? a.rate_value + ' %' : formatMoney(a.rate_value)}</td>
                <td class="row-actions">
                    <button class="btn btn-icon" data-edit="${a.id}">Изменить</button>
                    <button class="btn btn-icon btn-danger" data-delete="${a.id}">Удалить</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

    tbody.querySelectorAll('[data-edit]').forEach(btn => {
        btn.addEventListener('click', () => {
            const analyst = state.analysts.find(a => a.id === btn.dataset.edit);
            if (analyst) openAnalystModal(analyst);
        });
    });

    tbody.querySelectorAll('[data-delete]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const analyst = state.analysts.find(a => a.id === btn.dataset.delete);
            if (!analyst) return;
            if (!confirm(`Удалить аналитика «${analyst.name}»?`)) return;
            try {
                await api('analysts/' + analyst.id, { method: 'DELETE' });
                toast('Аналитик удалён', 'success');
                await refreshAll();
            } catch (err) {
                toast(err.message, 'error');
            }
        });
    });
}

/* ---------- Stats ---------- */

function renderStats() {
    const container = document.getElementById('stats-cards');
    container.innerHTML = '';

    if (state.stats.length === 0) {
        container.innerHTML = '<p class="empty-state">Нет данных для статистики.</p>';
        return;
    }

    state.stats
        .slice()
        .sort((a, b) => (b.bonus_accrued + b.bonus_pending) - (a.bonus_accrued + a.bonus_pending))
        .forEach(row => {
            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `
                <h3>${escapeHtml(row.analyst_name)}</h3>
                <div class="metric"><span class="label">Всего проектов</span><span class="value">${row.projects_total}</span></div>
                <div class="metric"><span class="label">Активных</span><span class="value">${row.projects_active}</span></div>
                <div class="metric"><span class="label">Завершено</span><span class="value">${row.projects_completed}</span></div>
                <div class="metric highlight"><span class="label">Бонус начислен</span><span class="value">${formatMoney(row.bonus_accrued)}</span></div>
                <div class="metric pending"><span class="label">Ожидается</span><span class="value">${formatMoney(row.bonus_pending)}</span></div>
            `;
            container.appendChild(card);
        });
}

/* ---------- Modal helpers ---------- */

function bindModalClose() {
    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });
    document.querySelectorAll('.modal').forEach(m => {
        m.addEventListener('click', e => {
            if (e.target === m) closeModal(m.id);
        });
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal:not([hidden])').forEach(m => closeModal(m.id));
        }
    });
}

function closeModal(id) {
    document.getElementById(id).hidden = true;
}

/* ---------- Utils ---------- */

function escapeHtml(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatMoney(value) {
    const n = Number(value) || 0;
    return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
}

function formatDate(iso) {
    if (!iso) return '—';
    const parts = iso.split('-');
    if (parts.length !== 3) return iso;
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

function toast(message, kind = '') {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 3500);
}
