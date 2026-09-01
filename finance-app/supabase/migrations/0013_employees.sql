-- ============================================================
-- 0013_employees: сотрудники, начисления и привязка выплат
-- ============================================================

do $$ begin create type public.employment_type as enum ('salary', 'project', 'mixed');
exception when duplicate_object then null; end $$;

do $$ begin create type public.accrual_kind as enum ('fixed', 'variable');
exception when duplicate_object then null; end $$;

create table if not exists public.employees (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams (id) on delete cascade,
  name            text not null,
  start_date      date,
  employment_type public.employment_type not null default 'salary',
  payout_currency varchar(8) not null default 'RUB' references public.currencies (code),
  status          text not null default 'active',
  note            text,
  created_at      timestamptz not null default now()
);
create index if not exists employees_team_idx on public.employees (team_id);

create table if not exists public.payroll_accruals (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams (id) on delete cascade,
  employee_id  uuid not null references public.employees (id) on delete cascade,
  period_month date not null,
  kind         public.accrual_kind not null default 'fixed',
  amount       bigint not null check (amount > 0),
  currency     varchar(8) not null references public.currencies (code),
  note         text,
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now()
);
create index if not exists accruals_emp_idx on public.payroll_accruals (employee_id);

alter table public.transactions add column if not exists employee_id uuid references public.employees (id) on delete set null;
alter table public.transactions add column if not exists pay_part    public.accrual_kind;
create index if not exists transactions_employee_idx on public.transactions (employee_id);

alter table public.employees enable row level security;
drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees for select using (public.is_team_member(team_id));
drop policy if exists employees_insert on public.employees;
create policy employees_insert on public.employees for insert with check (public.can_edit_finance(team_id));
drop policy if exists employees_update on public.employees;
create policy employees_update on public.employees for update using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));
drop policy if exists employees_delete on public.employees;
create policy employees_delete on public.employees for delete using (public.can_edit_finance(team_id));

alter table public.payroll_accruals enable row level security;
drop policy if exists accruals_select on public.payroll_accruals;
create policy accruals_select on public.payroll_accruals for select using (public.is_team_member(team_id));
drop policy if exists accruals_insert on public.payroll_accruals;
create policy accruals_insert on public.payroll_accruals for insert with check (public.can_edit_finance(team_id));
drop policy if exists accruals_update on public.payroll_accruals;
create policy accruals_update on public.payroll_accruals for update using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));
drop policy if exists accruals_delete on public.payroll_accruals;
create policy accruals_delete on public.payroll_accruals for delete using (public.can_edit_finance(team_id));
