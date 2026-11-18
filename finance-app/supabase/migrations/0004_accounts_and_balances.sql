-- ============================================================
-- 0004_accounts_and_balances: баланс счетов + стартовые
-- справочники при создании команды
-- ============================================================

-- Представление: текущий баланс каждого счёта (в его валюте, минорные единицы).
-- Фильтр по членству в команде заменяет RLS (обычное представление выполняется
-- с правами владельца и обходит RLS базовых таблиц).
create or replace view public.account_balances as
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

-- Пересоздаём create_team: при создании команды добавляем стартовый счёт
-- и базовые категории доходов/расходов.
create or replace function public.create_team(_name text, _base_currency char(3) default 'RUB')
returns public.teams
language plpgsql
security definer set search_path = public
as $$
declare
  _team public.teams;
begin
  insert into public.teams (name, base_currency, created_by)
  values (_name, coalesce(_base_currency, 'RUB'), auth.uid())
  returning * into _team;

  insert into public.team_members (team_id, user_id, role)
  values (_team.id, auth.uid(), 'owner');

  -- Стартовый счёт
  insert into public.accounts (team_id, name, currency, kind)
  values (_team.id, 'Наличные', _team.base_currency, 'cash');

  -- Базовые категории
  insert into public.categories (team_id, name, kind) values
    (_team.id, 'Продажи',        'income'),
    (_team.id, 'Прочие доходы',  'income'),
    (_team.id, 'Зарплата',       'expense'),
    (_team.id, 'Аренда',         'expense'),
    (_team.id, 'Реклама',        'expense'),
    (_team.id, 'Налоги',         'expense'),
    (_team.id, 'Прочие расходы', 'expense');

  return _team;
end;
$$;

revoke execute on function public.create_team(text, char) from anon;
