-- ============================================================
-- 0023_employee_salary: история оклада, дата увольнения, отдел
-- ============================================================

-- Дата увольнения и отдел у сотрудника (сотрудник = counterparties.kind='employee')
alter table public.counterparties add column if not exists end_date date;
alter table public.counterparties add column if not exists department text;

-- История оклада: ставка действует с effective_from
create table if not exists public.employee_salaries (
  id               uuid primary key default gen_random_uuid(),
  team_id          uuid not null references public.teams (id) on delete cascade,
  counterparty_id  uuid not null references public.counterparties (id) on delete cascade,
  effective_from   date not null,
  amount           bigint not null check (amount > 0),
  currency         varchar(8) not null references public.currencies (code),
  created_by       uuid references auth.users (id),
  created_at       timestamptz not null default now()
);
create index if not exists employee_salaries_cp_idx
  on public.employee_salaries (counterparty_id, effective_from desc);

alter table public.employee_salaries enable row level security;
drop policy if exists employee_salaries_select on public.employee_salaries;
create policy employee_salaries_select on public.employee_salaries for select using (public.is_team_member(team_id));
drop policy if exists employee_salaries_insert on public.employee_salaries;
create policy employee_salaries_insert on public.employee_salaries for insert with check (public.can_edit_finance(team_id));
drop policy if exists employee_salaries_update on public.employee_salaries;
create policy employee_salaries_update on public.employee_salaries for update using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));
drop policy if exists employee_salaries_delete on public.employee_salaries;
create policy employee_salaries_delete on public.employee_salaries for delete using (public.can_edit_finance(team_id));
