-- ============================================================
-- 0047_license_deal_items: позиции (товары) внутри сделки.
-- Лёгкий чек-лист: что входит в сделку, чтобы по каждому пункту
-- было видно план закупки и не забыть купить. Сумма планов позиций
-- = ожидаемая закупка сделки (когда позиции заданы).
-- ============================================================

create table if not exists public.license_deal_items (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams(id) on delete cascade,
  deal_id       uuid not null references public.license_deals(id) on delete cascade,
  name          text not null,
  qty           int  not null default 1 check (qty > 0),
  planned_cost  bigint,                       -- план закупки по позиции, минорные единицы (в валюте сделки)
  is_purchased  boolean not null default false,
  sort          int not null default 0,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists license_deal_items_deal_idx on public.license_deal_items(deal_id, sort, created_at);

alter table public.license_deal_items enable row level security;

drop policy if exists ldi_select on public.license_deal_items;
drop policy if exists ldi_insert on public.license_deal_items;
drop policy if exists ldi_update on public.license_deal_items;
drop policy if exists ldi_delete on public.license_deal_items;
create policy ldi_select on public.license_deal_items for select using (public.is_team_member(team_id));
create policy ldi_insert on public.license_deal_items for insert with check (public.can_edit_finance(team_id));
create policy ldi_update on public.license_deal_items for update using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));
create policy ldi_delete on public.license_deal_items for delete using (public.can_edit_finance(team_id));
