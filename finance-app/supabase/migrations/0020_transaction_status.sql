-- ============================================================
-- 0020_transaction_status: плановые / фактические операции
-- ============================================================

alter table public.transactions
  add column if not exists status text not null default 'actual'; -- actual | planned

create index if not exists transactions_status_idx on public.transactions (team_id, status);

-- Баланс счёта считаем только по фактическим операциям
drop view if exists public.account_balances;
create view public.account_balances with (security_invoker = on) as
select
  a.id       as account_id,
  a.team_id  as team_id,
  a.currency as currency,
  coalesce(sum(
    case
      when t.status is distinct from 'actual'                    then 0
      when t.type = 'income'   and t.account_id = a.id          then t.amount
      when t.type = 'expense'  and t.account_id = a.id          then -t.amount
      when t.type = 'transfer' and t.account_id = a.id          then -t.amount
      when t.type = 'transfer' and t.transfer_account_id = a.id then t.amount
      else 0
    end
  ), 0)::bigint as balance
from public.accounts a
left join public.transactions t
  on t.account_id = a.id or t.transfer_account_id = a.id
where public.is_team_member(a.team_id)
group by a.id, a.team_id, a.currency;

grant select on public.account_balances to authenticated;
