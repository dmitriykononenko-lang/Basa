-- ============================================================
-- 0026_category_rules: правила авто-категоризации (импорт)
-- ============================================================

create table if not exists public.category_rules (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  match_field text not null default 'any',   -- counterparty | note | any
  pattern     text not null,                 -- подстрока (регистронезависимо)
  category_id uuid references public.categories (id) on delete cascade,
  project_id  uuid references public.projects (id) on delete set null,
  priority    int not null default 0,
  active      boolean not null default true,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now()
);
create index if not exists category_rules_team_idx on public.category_rules (team_id, priority desc);

alter table public.category_rules enable row level security;
drop policy if exists category_rules_select on public.category_rules;
create policy category_rules_select on public.category_rules for select using (public.is_team_member(team_id));
drop policy if exists category_rules_insert on public.category_rules;
create policy category_rules_insert on public.category_rules for insert with check (public.can_edit_finance(team_id));
drop policy if exists category_rules_update on public.category_rules;
create policy category_rules_update on public.category_rules for update using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));
drop policy if exists category_rules_delete on public.category_rules;
create policy category_rules_delete on public.category_rules for delete using (public.can_edit_finance(team_id));
