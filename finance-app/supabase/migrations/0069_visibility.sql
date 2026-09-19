-- ============================================================
-- 0069_visibility: настраиваемая видимость разделов по ролям.
--
-- Владелец/админ задаёт, какие роли видят «ресурс» (остатки, финансы,
-- показатели, обучение, пароли). По умолчанию (нет строки) — видно всем
-- участникам команды, поэтому на деплое поведение не меняется.
--
-- Остатки по счетам (account_balances) — единственный ресурс с enforcement на
-- уровне БД: вью остаётся SECURITY DEFINER (нужно для корректной суммы по всем
-- проводкам команды, т.к. employee по RLS видит только свои), но теперь строки
-- отдаются только ролям, которым разрешено правило 'balances'.
-- ============================================================

create table if not exists public.team_visibility (
  team_id       uuid not null references public.teams (id) on delete cascade,
  resource      text not null,
  allowed_roles public.app_role[] not null
                default array['owner','admin','manager','employee','viewer']::public.app_role[],
  updated_by    uuid references auth.users (id),
  updated_at    timestamptz not null default now(),
  primary key (team_id, resource)
);

alter table public.team_visibility enable row level security;
drop policy if exists team_visibility_select on public.team_visibility;
create policy team_visibility_select on public.team_visibility for select
  using (public.is_team_member(team_id));
drop policy if exists team_visibility_write on public.team_visibility;
create policy team_visibility_write on public.team_visibility for all
  using (public.can_manage_team(team_id)) with check (public.can_manage_team(team_id));

-- Может ли текущий пользователь видеть ресурс. owner — всегда; нет строки — да.
create or replace function public.can_view_resource(_team_id uuid, _resource text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.current_team_role(_team_id) is null then false
    when public.current_team_role(_team_id) = 'owner' then true
    else coalesce(
      (select public.current_team_role(_team_id) = any(allowed_roles)
         from public.team_visibility where team_id = _team_id and resource = _resource),
      true)
  end;
$$;
revoke execute on function public.can_view_resource(uuid, text) from public;
grant execute on function public.can_view_resource(uuid, text) to authenticated, service_role;

-- Enforcement остатков: та же логика суммы, но с проверкой правила 'balances'.
create or replace view public.account_balances as
 select a.id as account_id,
    a.team_id,
    a.currency,
    (a.opening_balance::numeric + coalesce(sum(
        case
            when t.status is distinct from 'actual'::text then 0::bigint
            when t.type = 'income'::tx_type and t.account_id = a.id then t.amount
            when t.type = 'expense'::tx_type and t.account_id = a.id then - t.amount
            when t.type = 'transfer'::tx_type and t.account_id = a.id then - t.amount
            when t.type = 'transfer'::tx_type and t.transfer_account_id = a.id then t.amount
            else 0::bigint
        end), 0::numeric))::bigint as balance
   from public.accounts a
     left join public.transactions t on t.account_id = a.id or t.transfer_account_id = a.id
  where public.is_team_member(a.team_id) and public.can_view_resource(a.team_id, 'balances')
  group by a.id, a.team_id, a.currency, a.opening_balance;
