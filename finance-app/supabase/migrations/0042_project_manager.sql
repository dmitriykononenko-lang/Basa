-- ============================================================
-- 0042_project_manager: у проекта появляется менеджер (помимо аналитика).
-- Аналитик (responsible_counterparty_id) получает бонус за сдачу; менеджер —
-- информационное поле (ответственный со стороны продаж/ведения клиента).
-- ============================================================

alter table public.projects
  add column if not exists manager_counterparty_id uuid references public.counterparties(id) on delete set null;

create index if not exists projects_manager_idx on public.projects(manager_counterparty_id);
