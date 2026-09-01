-- ============================================================
-- 0014_accrual_project: привязка начислений к проектам
-- (переменная оплата за конкретные проекты)
-- ============================================================

alter table public.payroll_accruals
  add column if not exists project_id uuid references public.projects (id) on delete set null;

create index if not exists accruals_project_idx on public.payroll_accruals (project_id);
