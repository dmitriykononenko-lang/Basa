-- ============================================================
-- 0043_license_register: реестр лицензий.
-- Сделка = продажа лицензии клиенту (цена продажи). К сделке привязываются
-- закупки у вендора частями (фактическая стоимость известна при покупке).
-- «Висит» = по открытым сделкам сумма продажи, ещё не закрытая закупками,
-- и остаток к закупке относительно ожидаемой стоимости (если задана).
-- ============================================================

create table if not exists public.license_deals (
  id                     uuid primary key default gen_random_uuid(),
  team_id                uuid not null references public.teams(id) on delete cascade,
  client_counterparty_id uuid references public.counterparties(id) on delete set null,
  project_id             uuid references public.projects(id) on delete set null,
  title                  text not null,
  sale_amount            bigint not null default 0,   -- цена продажи, минорные единицы
  currency               char(3) not null default 'RUB',
  sold_on                date not null default current_date,
  expected_cost          bigint,                      -- ожидаемая закупка (опционально)
  status                 text not null default 'open' check (status in ('open','closed')),
  income_transaction_id  uuid references public.transactions(id) on delete set null,
  note                   text,
  created_by             uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now()
);

create table if not exists public.license_purchases (
  id                     uuid primary key default gen_random_uuid(),
  team_id                uuid not null references public.teams(id) on delete cascade,
  deal_id                uuid not null references public.license_deals(id) on delete cascade,
  amount                 bigint not null,             -- стоимость части закупки
  currency               char(3) not null default 'RUB',
  purchased_on           date not null default current_date,
  vendor_counterparty_id uuid references public.counterparties(id) on delete set null,
  expense_transaction_id uuid references public.transactions(id) on delete set null,
  note                   text,
  created_by             uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now()
);

create index if not exists license_deals_team_idx on public.license_deals(team_id, sold_on desc);
create index if not exists license_purchases_deal_idx on public.license_purchases(deal_id);

alter table public.license_deals enable row level security;
alter table public.license_purchases enable row level security;

drop policy if exists ld_select on public.license_deals;
drop policy if exists ld_insert on public.license_deals;
drop policy if exists ld_update on public.license_deals;
drop policy if exists ld_delete on public.license_deals;
create policy ld_select on public.license_deals for select using (public.is_team_member(team_id));
create policy ld_insert on public.license_deals for insert with check (public.can_edit_finance(team_id));
create policy ld_update on public.license_deals for update using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));
create policy ld_delete on public.license_deals for delete using (public.can_edit_finance(team_id));

drop policy if exists lp_select on public.license_purchases;
drop policy if exists lp_insert on public.license_purchases;
drop policy if exists lp_update on public.license_purchases;
drop policy if exists lp_delete on public.license_purchases;
create policy lp_select on public.license_purchases for select using (public.is_team_member(team_id));
create policy lp_insert on public.license_purchases for insert with check (public.can_edit_finance(team_id));
create policy lp_update on public.license_purchases for update using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));
create policy lp_delete on public.license_purchases for delete using (public.can_edit_finance(team_id));
