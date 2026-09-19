-- Реквизиты счёта (как в банковской карточке) + начальный остаток как поле.
-- Раньше начальный остаток заводился корректирующей операцией; теперь это поле
-- accounts.opening_balance, а вью баланса прибавляет его к обороту.

alter table public.accounts
  add column if not exists number text,            -- номер счёта (для матчинга при импорте)
  add column if not exists bank_name text,         -- банк
  add column if not exists bik text,               -- БИК
  add column if not exists corr_account text,      -- корр. счёт (к/с)
  add column if not exists legal_entity text,      -- юр.лицо (ИП/ООО) — для группировки
  add column if not exists account_group text,     -- произвольная группа счетов
  add column if not exists opening_balance bigint not null default 0, -- начальный остаток (минорные единицы)
  add column if not exists opening_date date,       -- дата начального остатка
  add column if not exists closed boolean not null default false; -- счёт закрыт

-- номер счёта: исторически имена счетов = номера, бэкфиллим
update public.accounts set number = name where number is null;

-- переносим ранее заведённые входящие остатки из операций в поле opening_balance
update public.accounts a set
  opening_balance = s.signed,
  opening_date = date '2025-12-31'
from (
  select account_id, sum(case when type = 'income' then amount else -amount end)::bigint as signed
  from public.transactions
  where note = 'Входящий остаток на 01.01.2026'
  group by account_id
) s
where a.id = s.account_id;

delete from public.transactions where note = 'Входящий остаток на 01.01.2026';

-- вью баланса теперь учитывает начальный остаток
create or replace view public.account_balances as
select a.id as account_id, a.team_id, a.currency,
  (a.opening_balance + coalesce(sum(
    case
      when t.status is distinct from 'actual' then 0
      when t.type = 'income'   and t.account_id = a.id then t.amount
      when t.type = 'expense'  and t.account_id = a.id then -t.amount
      when t.type = 'transfer' and t.account_id = a.id then -t.amount
      when t.type = 'transfer' and t.transfer_account_id = a.id then t.amount
      else 0
    end), 0))::bigint as balance
from public.accounts a
left join public.transactions t on t.account_id = a.id or t.transfer_account_id = a.id
where is_team_member(a.team_id)
group by a.id, a.team_id, a.currency, a.opening_balance;
