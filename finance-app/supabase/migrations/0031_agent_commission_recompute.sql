-- ============================================================
-- 0031_agent_commission_recompute: ретроспективный пересчёт комиссий
-- ============================================================
-- Комиссии пересчитываются не только при изменении операции, но и при:
--  - назначении/смене агента у клиента (все его прошлые приходы);
--  - изменении ставок комиссии у агента (все приходы его клиентов).

-- Ядро: пересчитать комиссию по одной операции (идемпотентно).
create or replace function public.recompute_commission(p_tx uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  v_agent uuid;
  v_pct numeric;
  v_amt bigint;
  v_cat uuid;
begin
  select * into t from public.transactions where id = p_tx;
  if not found then return; end if;

  if t.type <> 'income' or t.status <> 'actual' or t.counterparty_id is null then
    delete from public.obligations where source_transaction_id = p_tx;
    return;
  end if;

  select agent_id into v_agent from public.counterparties where id = t.counterparty_id;
  if v_agent is null then
    delete from public.obligations where source_transaction_id = p_tx;
    return;
  end if;

  select percent into v_pct
  from public.agent_commission_rules
  where agent_id = v_agent and team_id = t.team_id
    and (category_id = t.category_id or category_id is null)
  order by (category_id is not null) desc
  limit 1;

  if v_pct is null then
    delete from public.obligations where source_transaction_id = p_tx;
    return;
  end if;

  v_amt := round(t.amount * v_pct / 100.0)::bigint;
  if v_amt <= 0 then
    delete from public.obligations where source_transaction_id = p_tx;
    return;
  end if;

  select id into v_cat from public.categories
   where team_id = t.team_id and name = 'Агентская комиссия' and kind = 'expense' limit 1;
  if v_cat is null then
    insert into public.categories (team_id, name, kind)
    values (t.team_id, 'Агентская комиссия', 'expense') returning id into v_cat;
  end if;

  insert into public.obligations
    (team_id, counterparty_id, type, amount, currency, project_id, due_date, status, note, created_by, source_transaction_id, category_id)
  values
    (t.team_id, v_agent, 'payable', v_amt, t.currency, t.project_id, t.occurred_on, 'open', 'Агентская комиссия', t.created_by, p_tx, v_cat)
  on conflict (source_transaction_id) do update
    set amount = excluded.amount, currency = excluded.currency, due_date = excluded.due_date,
        counterparty_id = excluded.counterparty_id, project_id = excluded.project_id, category_id = excluded.category_id;
end;
$$;
revoke all on function public.recompute_commission(uuid) from public, anon, authenticated;

-- Триггер на операцию теперь просто делегирует в ядро
create or replace function public.accrue_agent_commission()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_commission(NEW.id);
  return NEW;
end;
$$;
revoke all on function public.accrue_agent_commission() from public, anon, authenticated;

-- При смене агента у клиента — пересчитать все его фактические приходы
create or replace function public.recompute_client_commissions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_commission(tx.id)
  from public.transactions tx
  where tx.counterparty_id = NEW.id and tx.type = 'income' and tx.status = 'actual';
  return NEW;
end;
$$;
revoke all on function public.recompute_client_commissions() from public, anon, authenticated;

drop trigger if exists trg_client_agent_changed on public.counterparties;
create trigger trg_client_agent_changed
after update of agent_id on public.counterparties
for each row when (NEW.agent_id is distinct from OLD.agent_id)
execute function public.recompute_client_commissions();

-- При изменении ставок агента — пересчитать приходы всех его клиентов
create or replace function public.recompute_agent_commissions()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_agent uuid;
begin
  v_agent := coalesce(NEW.agent_id, OLD.agent_id);
  perform public.recompute_commission(tx.id)
  from public.transactions tx
  join public.counterparties c on c.id = tx.counterparty_id
  where c.agent_id = v_agent and tx.type = 'income' and tx.status = 'actual';
  return null;
end;
$$;
revoke all on function public.recompute_agent_commissions() from public, anon, authenticated;

drop trigger if exists trg_commission_rules_changed on public.agent_commission_rules;
create trigger trg_commission_rules_changed
after insert or update or delete on public.agent_commission_rules
for each row execute function public.recompute_agent_commissions();
