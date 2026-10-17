-- ============================================================
-- 0022_project_owner: ответственный сотрудник у проекта
-- ============================================================

alter table public.projects
  add column if not exists responsible_counterparty_id uuid
  references public.counterparties (id) on delete set null;
create index if not exists projects_responsible_idx
  on public.projects (responsible_counterparty_id);
