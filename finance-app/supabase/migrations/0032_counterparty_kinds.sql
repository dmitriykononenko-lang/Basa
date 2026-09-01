-- ============================================================
-- 0032_counterparty_kinds: несколько статусов у контрагента
-- ============================================================
-- kind остаётся «основным» статусом (для совместимости и отображения),
-- kinds — полный набор статусов (клиент/поставщик/агент/…).

alter table public.counterparties add column if not exists kinds text[] not null default '{}';
update public.counterparties set kinds = array[kind::text]
  where (kinds is null or kinds = '{}') and kind is not null;
create index if not exists counterparties_kinds_idx on public.counterparties using gin (kinds);
