-- ============================================================
-- 0012_currency_widen: расширяем код валюты до varchar(8) (для USDT)
-- Пересоздаём зависимые представления балансов.
-- ============================================================

drop view if exists public.account_balances;
drop view if exists public.obligation_balances;

alter table public.accounts     drop constraint if exists accounts_currency_fkey;
alter table public.transactions drop constraint if exists transactions_currency_fkey;
alter table public.obligations  drop constraint if exists obligations_currency_fkey;
alter table public.budgets      drop constraint if exists budgets_currency_fkey;
alter table public.fx_rates     drop constraint if exists fx_rates_currency_fkey;

alter table public.currencies   alter column code     type varchar(8);
alter table public.accounts     alter column currency type varchar(8);
alter table public.transactions alter column currency type varchar(8);
alter table public.obligations  alter column currency type varchar(8);
alter table public.budgets      alter column currency type varchar(8);
alter table public.fx_rates     alter column currency type varchar(8);

alter table public.accounts     add constraint accounts_currency_fkey     foreign key (currency) references public.currencies (code);
alter table public.transactions add constraint transactions_currency_fkey foreign key (currency) references public.currencies (code);
alter table public.obligations  add constraint obligations_currency_fkey  foreign key (currency) references public.currencies (code);
alter table public.budgets      add constraint budgets_currency_fkey      foreign key (currency) references public.currencies (code);
alter table public.fx_rates     add constraint fx_rates_currency_fkey     foreign key (currency) references public.currencies (code);

-- Пересоздаём представления (security_invoker = on)
create view public.account_balances with (security_invoker = on) as
select
  a.id       as account_id,
  a.team_id  as team_id,
  a.currency as currency,
  coalesce(sum(
    case
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

create view public.obligation_balances with (security_invoker = on) as
select
  o.id, o.team_id, o.counterparty_id, o.type, o.amount, o.currency,
  o.project_id, o.due_date, o.status, o.note, o.created_at,
  coalesce(sum(p.amount), 0)::bigint              as paid,
  (o.amount - coalesce(sum(p.amount), 0))::bigint as outstanding
from public.obligations o
left join public.obligation_payments p on p.obligation_id = o.id
where public.is_team_member(o.team_id)
group by o.id;

grant select on public.obligation_balances to authenticated;

insert into public.currencies (code, name, symbol, minor_unit)
values ('USDT', 'Tether USDT', '₮', 2)
on conflict (code) do nothing;
