-- Внутренние части операции (split): одна операция остаётся единой записью
-- (баланс/ДДС по сумме не меняются), но распределяется на части по статьям,
-- проектам/направлениям и контрагентам. Часть можно пометить как обязательство.

create table if not exists public.transaction_splits (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams(id) on delete cascade,
  transaction_id  uuid not null references public.transactions(id) on delete cascade,
  amount          bigint not null check (amount > 0),
  category_id     uuid references public.categories(id) on delete set null,
  project_id      uuid references public.projects(id) on delete set null,
  counterparty_id uuid references public.counterparties(id) on delete set null,
  is_obligation   boolean not null default false,
  note            text,
  created_at      timestamptz not null default now()
);

create index if not exists transaction_splits_tx_idx on public.transaction_splits(transaction_id);
create index if not exists transaction_splits_team_idx on public.transaction_splits(team_id);

alter table public.transaction_splits enable row level security;
drop policy if exists ts_select on public.transaction_splits;
drop policy if exists ts_cud on public.transaction_splits;
create policy ts_select on public.transaction_splits
  for select using (public.is_team_member(team_id));
create policy ts_cud on public.transaction_splits
  for all using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));

-- Эффективные строки для отчётов: если у операции есть части — по одной строке на
-- часть с её статьёй/проектом/контрагентом; иначе — сама операция целиком.
-- Сумма строк по операции всегда равна сумме операции.
create or replace view public.transaction_lines
with (security_invoker = on) as
select
  t.id                                            as transaction_id,
  t.team_id,
  t.type,
  t.currency,
  t.status,
  t.occurred_on,
  t.accrual_date,
  t.account_id,
  coalesce(s.amount, t.amount)                    as amount,
  coalesce(s.category_id, t.category_id)          as category_id,
  coalesce(s.project_id, t.project_id)            as project_id,
  coalesce(s.counterparty_id, t.counterparty_id)  as counterparty_id,
  (s.id is not null)                              as is_split,
  coalesce(s.note, t.note)                        as note
from public.transactions t
left join public.transaction_splits s on s.transaction_id = t.id;
