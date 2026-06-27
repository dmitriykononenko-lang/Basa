-- ============================================================
-- 0027_recurring_rules: регулярные (повторяющиеся) операции
-- ============================================================

create table if not exists public.recurring_rules (
  id                  uuid primary key default gen_random_uuid(),
  team_id             uuid not null references public.teams (id) on delete cascade,
  type                public.tx_type not null,
  amount              bigint not null check (amount > 0),
  currency            varchar(8) not null references public.currencies (code),
  account_id          uuid references public.accounts (id) on delete set null,
  transfer_account_id uuid references public.accounts (id) on delete set null,
  category_id         uuid references public.categories (id) on delete set null,
  counterparty_id     uuid references public.counterparties (id) on delete set null,
  project_id          uuid references public.projects (id) on delete set null,
  note                text,
  frequency           text not null default 'monthly',  -- monthly | weekly
  day_of_month        int,                              -- для monthly (1..31)
  weekday             int,                              -- для weekly (0=Пн..6=Вс)
  start_date          date not null default current_date,
  end_date            date,
  active              boolean not null default true,
  created_by          uuid references auth.users (id),
  created_at          timestamptz not null default now()
);
create index if not exists recurring_rules_team_idx on public.recurring_rules (team_id, active);

alter table public.transactions
  add column if not exists recurring_rule_id uuid references public.recurring_rules (id) on delete set null;
create index if not exists transactions_recurring_idx on public.transactions (recurring_rule_id, occurred_on);

alter table public.recurring_rules enable row level security;
drop policy if exists recurring_rules_select on public.recurring_rules;
create policy recurring_rules_select on public.recurring_rules for select using (public.is_team_member(team_id));
drop policy if exists recurring_rules_insert on public.recurring_rules;
create policy recurring_rules_insert on public.recurring_rules for insert with check (public.can_edit_finance(team_id));
drop policy if exists recurring_rules_update on public.recurring_rules;
create policy recurring_rules_update on public.recurring_rules for update using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));
drop policy if exists recurring_rules_delete on public.recurring_rules;
create policy recurring_rules_delete on public.recurring_rules for delete using (public.can_edit_finance(team_id));
