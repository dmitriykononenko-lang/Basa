-- ============================================================
-- 0045_license_payments: оплаты клиента по сделке могут быть несколькими
-- операциями (частичные платежи). Раньше у сделки была одна привязка к
-- доходной операции (income_transaction_id) — переносим в отдельную таблицу,
-- как закупки у вендора (license_purchases).
-- ============================================================

create table if not exists public.license_payments (
  id                     uuid primary key default gen_random_uuid(),
  team_id                uuid not null references public.teams(id) on delete cascade,
  deal_id                uuid not null references public.license_deals(id) on delete cascade,
  amount                 bigint not null,
  currency               char(3) not null default 'RUB',
  paid_on                date not null default current_date,
  income_transaction_id  uuid references public.transactions(id) on delete set null,
  note                   text,
  created_by             uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now()
);

create index if not exists license_payments_deal_idx on public.license_payments(deal_id);

alter table public.license_payments enable row level security;
drop policy if exists lpay_select on public.license_payments;
drop policy if exists lpay_insert on public.license_payments;
drop policy if exists lpay_update on public.license_payments;
drop policy if exists lpay_delete on public.license_payments;
create policy lpay_select on public.license_payments for select using (public.is_team_member(team_id));
create policy lpay_insert on public.license_payments for insert with check (public.can_edit_finance(team_id));
create policy lpay_update on public.license_payments for update using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));
create policy lpay_delete on public.license_payments for delete using (public.can_edit_finance(team_id));

-- Перенос существующей одиночной привязки дохода в оплаты
insert into public.license_payments (team_id, deal_id, amount, currency, paid_on, income_transaction_id)
select team_id, id, sale_amount, currency, sold_on, income_transaction_id
from public.license_deals
where income_transaction_id is not null
  and not exists (select 1 from public.license_payments p where p.deal_id = license_deals.id);
