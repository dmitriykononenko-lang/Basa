-- ============================================================
-- 0030_agent_commissions: агентские комиссии (клиент → агент → комиссия)
-- ============================================================

-- 1) Клиент указывает своего агента
alter table public.counterparties
  add column if not exists agent_id uuid references public.counterparties (id) on delete set null;
create index if not exists counterparties_agent_idx on public.counterparties (agent_id);

-- 2) Правила комиссии у агента (статья → %); category_id IS NULL = ставка по умолчанию
create table if not exists public.agent_commission_rules (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  agent_id    uuid not null references public.counterparties (id) on delete cascade,
  category_id uuid references public.categories (id) on delete cascade,
  percent     numeric(6,3) not null check (percent >= 0),
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now()
);
create index if not exists agent_commission_rules_idx on public.agent_commission_rules (agent_id, team_id);

alter table public.agent_commission_rules enable row level security;
drop policy if exists agent_commission_rules_select on public.agent_commission_rules;
create policy agent_commission_rules_select on public.agent_commission_rules for select using (public.is_team_member(team_id));
drop policy if exists agent_commission_rules_insert on public.agent_commission_rules;
create policy agent_commission_rules_insert on public.agent_commission_rules for insert with check (public.can_edit_finance(team_id));
drop policy if exists agent_commission_rules_update on public.agent_commission_rules;
create policy agent_commission_rules_update on public.agent_commission_rules for update using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));
drop policy if exists agent_commission_rules_delete on public.agent_commission_rules;
create policy agent_commission_rules_delete on public.agent_commission_rules for delete using (public.can_edit_finance(team_id));

-- 3) Привязка обязательства к операции-источнику (идемпотентность + каскадное снятие)
alter table public.obligations
  add column if not exists source_transaction_id uuid references public.transactions (id) on delete cascade;
do $$ begin
  alter table public.obligations add constraint obligations_source_tx_key unique (source_transaction_id);
exception when duplicate_object then null; end $$;

-- 4) Триггер авто-начисления комиссии
create or replace function public.accrue_agent_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent uuid;
  v_pct numeric;
  v_amt bigint;
  v_cat uuid;
begin
  if NEW.type <> 'income' or NEW.status <> 'actual' or NEW.counterparty_id is null then
    delete from public.obligations where source_transaction_id = NEW.id;
    return NEW;
  end if;

  select agent_id into v_agent from public.counterparties where id = NEW.counterparty_id;
  if v_agent is null then
    delete from public.obligations where source_transaction_id = NEW.id;
    return NEW;
  end if;

  select percent into v_pct
  from public.agent_commission_rules
  where agent_id = v_agent and team_id = NEW.team_id
    and (category_id = NEW.category_id or category_id is null)
  order by (category_id is not null) desc
  limit 1;

  if v_pct is null then
    delete from public.obligations where source_transaction_id = NEW.id;
    return NEW;
  end if;

  v_amt := round(NEW.amount * v_pct / 100.0)::bigint;
  if v_amt <= 0 then
    delete from public.obligations where source_transaction_id = NEW.id;
    return NEW;
  end if;

  select id into v_cat from public.categories
   where team_id = NEW.team_id and name = 'Агентская комиссия' and kind = 'expense'
   limit 1;
  if v_cat is null then
    insert into public.categories (team_id, name, kind)
    values (NEW.team_id, 'Агентская комиссия', 'expense')
    returning id into v_cat;
  end if;

  insert into public.obligations
    (team_id, counterparty_id, type, amount, currency, project_id, due_date, status, note, created_by, source_transaction_id, category_id)
  values
    (NEW.team_id, v_agent, 'payable', v_amt, NEW.currency, NEW.project_id, NEW.occurred_on, 'open', 'Агентская комиссия', NEW.created_by, NEW.id, v_cat)
  on conflict (source_transaction_id) do update
    set amount = excluded.amount,
        currency = excluded.currency,
        due_date = excluded.due_date,
        counterparty_id = excluded.counterparty_id,
        project_id = excluded.project_id,
        category_id = excluded.category_id;

  return NEW;
end;
$$;

revoke all on function public.accrue_agent_commission() from public, anon, authenticated;

drop trigger if exists trg_agent_commission on public.transactions;
create trigger trg_agent_commission
after insert or update of status, amount, counterparty_id, category_id, occurred_on, project_id, type
on public.transactions
for each row execute function public.accrue_agent_commission();

-- 5) Сидинг статьи «Агентская комиссия» для существующих команд
insert into public.categories (team_id, name, kind)
select t.id, 'Агентская комиссия', 'expense' from public.teams t
where not exists (
  select 1 from public.categories c where c.team_id = t.id and c.name = 'Агентская комиссия'
);
