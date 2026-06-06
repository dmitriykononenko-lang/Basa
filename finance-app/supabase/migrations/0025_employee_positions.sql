-- ============================================================
-- 0025_employee_positions: история должности (действует с даты)
-- ============================================================

create table if not exists public.employee_positions (
  id               uuid primary key default gen_random_uuid(),
  team_id          uuid not null references public.teams (id) on delete cascade,
  counterparty_id  uuid not null references public.counterparties (id) on delete cascade,
  effective_from   date not null,
  position         text not null,
  created_by       uuid references auth.users (id),
  created_at       timestamptz not null default now()
);
create index if not exists employee_positions_cp_idx
  on public.employee_positions (counterparty_id, effective_from desc);

alter table public.employee_positions enable row level security;
drop policy if exists employee_positions_select on public.employee_positions;
create policy employee_positions_select on public.employee_positions for select using (public.is_team_member(team_id));
drop policy if exists employee_positions_insert on public.employee_positions;
create policy employee_positions_insert on public.employee_positions for insert with check (public.can_edit_finance(team_id));
drop policy if exists employee_positions_update on public.employee_positions;
create policy employee_positions_update on public.employee_positions for update using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));
drop policy if exists employee_positions_delete on public.employee_positions;
create policy employee_positions_delete on public.employee_positions for delete using (public.can_edit_finance(team_id));
