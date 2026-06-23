-- ============================================================
-- 0044_automation_rules: правила автоматизации.
-- Если выполняются ВСЕ условия (контрагент / назначение содержит / тип / счёт),
-- то выполнить действие (назначить статью, назначить проект, сделать переводом).
-- conditions: jsonb-массив [{field, op, value}], action: jsonb {type, ...}.
-- ============================================================

create table if not exists public.automation_rules (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  name        text,
  enabled     boolean not null default true,
  conditions  jsonb not null default '[]'::jsonb,
  action      jsonb not null default '{}'::jsonb,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists automation_rules_team_idx on public.automation_rules(team_id, created_at desc);

alter table public.automation_rules enable row level security;
drop policy if exists ar_select on public.automation_rules;
drop policy if exists ar_insert on public.automation_rules;
drop policy if exists ar_update on public.automation_rules;
drop policy if exists ar_delete on public.automation_rules;
create policy ar_select on public.automation_rules for select using (public.is_team_member(team_id));
create policy ar_insert on public.automation_rules for insert with check (public.can_edit_finance(team_id));
create policy ar_update on public.automation_rules for update using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));
create policy ar_delete on public.automation_rules for delete using (public.can_edit_finance(team_id));
