-- ============================================================
-- 0091_write_paths_and_authz — pre-production review, пункты 2 и 3
--
-- ЧАСТЬ A. SEC-008 (HIGH, существует в production прямо сейчас).
-- `can_edit_finance()/can_write_tx()/can_manage_team()` возвращают **NULL**
-- для того, кто не состоит в команде (`role in (...)` при role IS NULL).
-- Для RLS это отказ, но в plpgsql `if not can_edit_finance(t) then raise`
-- при NULL НЕ срабатывает — защита молча пропускает вызывающего.
-- Проверено на production (только чтение):
--   auth.uid() = NULL → can_edit_finance(team) = NULL,
--   (not can_edit_finance(team)) IS NULL = true.
-- Такой guard стоит в 6 SECURITY DEFINER функциях:
--   support_open_period, support_delete_period, merge_counterparties,
--   materialize_auto_accruals, materialize_support_cycles, academy_assign.
-- При этом support_open_period и support_delete_period имеют EXECUTE у PUBLIC
-- и anon, а они пишут в project_periods/obligations/transactions.
-- Исправление сделано в одном месте — в самих хелперах: теперь они NOT NULL,
-- поэтому все вызывающие (включая ещё не написанные) защищены автоматически.
-- Семантика RLS не меняется: там NULL и false равнозначны.
-- ============================================================

create or replace function public.can_edit_finance(_team_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members
     where team_id = _team_id and user_id = auth.uid()
       and role in ('owner','admin','manager')
  )
$$;

create or replace function public.can_write_tx(_team_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members
     where team_id = _team_id and user_id = auth.uid()
       and role in ('owner','admin','manager','employee')
  )
$$;

create or replace function public.can_manage_team(_team_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members
     where team_id = _team_id and user_id = auth.uid()
       and role in ('owner','admin')
  )
$$;

-- ЧАСТЬ B. Лишние EXECUTE-гранты на функции, которые пишут данные.
-- anon/PUBLIC не должны иметь права вызывать их вообще.
do $$
declare f text;
begin
  foreach f in array array[
    'public.support_open_period(uuid, bigint, uuid, uuid)',
    'public.support_delete_period(uuid)',
    'public.next_document_number(uuid, text)',
    'public.next_project_code(uuid)',
    'public.bybit_sync_logged()'
  ] loop
    begin
      execute format('revoke all on function %s from public', f);
      execute format('revoke all on function %s from anon', f);
    exception when undefined_function then
      raise notice 'функция % отсутствует — пропущено', f;
    end;
  end loop;
end $$;
-- authenticated/service_role гранты сохраняются как были.
do $$ begin
  execute 'grant execute on function public.support_delete_period(uuid) to authenticated';
exception when undefined_function then null; end $$;

-- ЧАСТЬ C. Гонка в support_open_period: функция считает существующие периоды и
-- вставляет следующий. Вместо переписывания большой функции ставим ограничение
-- в схеме (текущих дублей в проде 0 — проверено db_integrity_audit.sql).
do $$ begin
  if to_regclass('public.project_periods') is not null
     and exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='project_periods' and column_name='period_month') then
    execute 'create unique index if not exists project_periods_project_month_uniq
               on public.project_periods (project_id, period_month)';
  end if;
end $$;

-- ЧАСТЬ C2. Гонка в материализации регулярных операций.
-- RecurringManager читает уже созданные слоты, строит Set и вставляет
-- недостающие — классический check-then-insert без ограничения. Два
-- одновременных нажатия «создать плановые» дают дубли плановых платежей.
-- Ограничение в схеме превращает гонку в ошибку 23505 вместо дублей.
-- Текущих дублей в проде 0 (проверено; строк с recurring_rule_id пока 0).
create unique index if not exists transactions_recurring_slot_uniq
  on public.transactions (recurring_rule_id, occurred_on)
  where recurring_rule_id is not null and status = 'planned';

-- ============================================================
-- ЧАСТЬ D. Пункт 2 — закрыть обходы CAS.
-- Прямые `.update()` из клиента заменяются узкими RPC: они (а) ограничивают
-- набор изменяемых полей, (б) проверяют право на каждую строку, (в) двигают
-- version, (г) идемпотентны по request_id.
-- ============================================================

-- D1. Массовая правка «аналитических» полей (категория/проект/контрагент/счёт/
-- статус/заметка). Сумма, дата, тип и валюта через этот путь НЕ меняются вообще:
-- их можно править только по одной операции через transaction_save с версией.
create or replace function public.transactions_bulk_patch(
  p_ids uuid[], p_patch jsonb, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _team uuid; _dup jsonb; _n int; _forbidden int; _teams int;
  _touches_money boolean;
begin
  if p_ids is null or array_length(p_ids, 1) is null then
    return jsonb_build_object('ok', true, 'updated', 0);
  end if;

  -- min(uuid) в Postgres нет, поэтому команда берётся отдельным запросом
  select count(distinct team_id) into _teams from transactions where id = any(p_ids);
  select team_id into _team from transactions where id = any(p_ids) limit 1;
  if coalesce(_teams, 0) = 0 then raise exception 'Операции не найдены' using errcode = '42704'; end if;
  if _teams > 1 then raise exception 'Операции разных команд' using errcode = '42501'; end if;

  -- account_id и status меняют размещение/признание денег — только финансовые роли
  _touches_money := (p_patch ? 'account_id') or (p_patch ? 'status');
  if _touches_money and not public.can_edit_finance(_team) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;
  if not public.can_write_tx(_team) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;

  -- запрещённые поля отсекаются явно, а не «по невнимательности»
  if p_patch ?| array['amount','currency','type','occurred_on','transfer_amount',
                      'transfer_currency','transfer_account_id','team_id','id','version'] then
    raise exception 'Через массовую правку нельзя менять сумму, валюту, тип, дату и перевод'
      using errcode = '22023';
  end if;

  _dup := public.op_begin(p_request_id, _team, 'transactions_bulk_patch');
  if _dup is not null then return _dup; end if;

  if nullif(p_patch->>'account_id','') is not null
     and not exists (select 1 from accounts where id = (p_patch->>'account_id')::uuid and team_id = _team) then
    raise exception 'Счёт не найден' using errcode = '42704'; end if;
  if nullif(p_patch->>'category_id','') is not null
     and not exists (select 1 from categories where id = (p_patch->>'category_id')::uuid and team_id = _team) then
    raise exception 'Статья не найдена' using errcode = '42704'; end if;
  if nullif(p_patch->>'counterparty_id','') is not null
     and not exists (select 1 from counterparties where id = (p_patch->>'counterparty_id')::uuid and team_id = _team) then
    raise exception 'Контрагент не найден' using errcode = '42704'; end if;
  if nullif(p_patch->>'project_id','') is not null
     and not exists (select 1 from projects where id = (p_patch->>'project_id')::uuid and team_id = _team) then
    raise exception 'Проект не найден' using errcode = '42704'; end if;

  select count(*) into _forbidden from transactions
   where id = any(p_ids) and not coalesce(public.can_modify_tx(id), false);

  with upd as (
    update transactions t set
      category_id     = case when p_patch ? 'category_id'     then nullif(p_patch->>'category_id','')::uuid     else t.category_id end,
      project_id      = case when p_patch ? 'project_id'      then nullif(p_patch->>'project_id','')::uuid      else t.project_id end,
      counterparty_id = case when p_patch ? 'counterparty_id' then nullif(p_patch->>'counterparty_id','')::uuid else t.counterparty_id end,
      account_id      = case when p_patch ? 'account_id'      then nullif(p_patch->>'account_id','')::uuid      else t.account_id end,
      status          = case when p_patch ? 'status'          then coalesce(nullif(p_patch->>'status',''), t.status) else t.status end,
      note            = case when p_patch ? 'note'            then nullif(p_patch->>'note','')                   else t.note end
     where t.id = any(p_ids) and coalesce(public.can_modify_tx(t.id), false)
    returning t.id
  ) select count(*) into _n from upd;

  return public.op_finish(p_request_id,
    jsonb_build_object('ok', true, 'updated', _n, 'skipped_forbidden', _forbidden));
end $$;

-- D2. Превращение существующих операций в перевод (правило «сделать переводом»
-- в RulesManager и реконсиляция встречных в ImportWizard). Раньше — `update`
-- по фильтру без списка id и без версии; теперь только по явному списку id,
-- одной транзакцией, с проверкой прав.
create or replace function public.transactions_convert_to_transfer(
  p_ids uuid[], p_transfer_account uuid, p_account uuid default null, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _team uuid; _teams int; _dup jsonb; _n int;
begin
  if p_ids is null or array_length(p_ids, 1) is null then
    return jsonb_build_object('ok', true, 'updated', 0);
  end if;
  select count(distinct team_id) into _teams from transactions where id = any(p_ids);
  select team_id into _team from transactions where id = any(p_ids) limit 1;
  if coalesce(_teams,0) = 0 then raise exception 'Операции не найдены' using errcode = '42704'; end if;
  if _teams > 1 then raise exception 'Операции разных команд' using errcode = '42501'; end if;
  if not public.can_edit_finance(_team) then raise exception 'Недостаточно прав' using errcode = '42501'; end if;
  if not exists (select 1 from accounts where id = p_transfer_account and team_id = _team) then
    raise exception 'Счёт зачисления не найден' using errcode = '42704'; end if;
  if p_account is not null and not exists (select 1 from accounts where id = p_account and team_id = _team) then
    raise exception 'Счёт списания не найден' using errcode = '42704'; end if;

  _dup := public.op_begin(p_request_id, _team, 'transactions_convert_to_transfer');
  if _dup is not null then return _dup; end if;

  with upd as (
    update transactions t set
      type = 'transfer',
      account_id = coalesce(p_account, t.account_id),
      transfer_account_id = p_transfer_account,
      category_id = null,
      counterparty_id = null,
      obligation_id = null
     where t.id = any(p_ids)
    returning t.id
  ) select count(*) into _n from upd;

  return public.op_finish(p_request_id, jsonb_build_object('ok', true, 'updated', _n));
end $$;

-- D3. Удаление одной операции с проверкой версии: нельзя удалить строку,
-- которую кто-то изменил после того, как её открыли.
create or replace function public.transaction_delete(
  p_transaction uuid, p_expected_version integer default null, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _t transactions; _dup jsonb;
begin
  select * into _t from transactions where id = p_transaction for update;
  if _t.id is null then return jsonb_build_object('ok', true, 'already_deleted', true); end if;
  if not coalesce(public.can_modify_tx(p_transaction), false) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;
  if p_expected_version is not null and _t.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'conflict', true,
      'expected_version', p_expected_version, 'current_version', _t.version, 'current', to_jsonb(_t));
  end if;
  _dup := public.op_begin(p_request_id, _t.team_id, 'transaction_delete');
  if _dup is not null then return _dup; end if;
  delete from transactions where id = p_transaction;
  return public.op_finish(p_request_id, jsonb_build_object('ok', true, 'id', p_transaction));
end $$;

-- D4. Создание операции с ключом идемпотентности. Нужно там, где создаётся
-- движение денег и повторный клик/ретрай стоит дорого: выплаты агентам,
-- выплаты по зарплате, ручное добавление операции, плановый платёж.
create or replace function public.transaction_insert(
  p_payload jsonb, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _team uuid; _dup jsonb; _id uuid; _type tx_type; _status text;
begin
  _team := nullif(p_payload->>'team_id','')::uuid;
  if _team is null then raise exception 'Не указана команда' using errcode = '22023'; end if;
  if not public.can_write_tx(_team) then raise exception 'Недостаточно прав' using errcode = '42501'; end if;

  _dup := public.op_begin(p_request_id, _team, 'transaction_insert');
  if _dup is not null then return _dup; end if;

  _type := (p_payload->>'type')::tx_type;
  _status := coalesce(nullif(p_payload->>'status',''), 'actual');

  if nullif(p_payload->>'account_id','') is not null
     and not exists (select 1 from accounts where id = (p_payload->>'account_id')::uuid and team_id = _team) then
    raise exception 'Счёт не найден' using errcode = '42704'; end if;
  if nullif(p_payload->>'transfer_account_id','') is not null
     and not exists (select 1 from accounts where id = (p_payload->>'transfer_account_id')::uuid and team_id = _team) then
    raise exception 'Счёт зачисления не найден' using errcode = '42704'; end if;
  if nullif(p_payload->>'category_id','') is not null
     and not exists (select 1 from categories where id = (p_payload->>'category_id')::uuid and team_id = _team) then
    raise exception 'Статья не найдена' using errcode = '42704'; end if;
  if nullif(p_payload->>'counterparty_id','') is not null
     and not exists (select 1 from counterparties where id = (p_payload->>'counterparty_id')::uuid and team_id = _team) then
    raise exception 'Контрагент не найден' using errcode = '42704'; end if;
  if nullif(p_payload->>'project_id','') is not null
     and not exists (select 1 from projects where id = (p_payload->>'project_id')::uuid and team_id = _team) then
    raise exception 'Проект не найден' using errcode = '42704'; end if;
  if nullif(p_payload->>'obligation_id','') is not null
     and not exists (select 1 from obligations where id = (p_payload->>'obligation_id')::uuid and team_id = _team) then
    raise exception 'Обязательство не найдено' using errcode = '42704'; end if;

  insert into transactions (team_id, type, amount, currency, account_id, transfer_account_id,
                            transfer_amount, transfer_currency, category_id, counterparty_id,
                            project_id, occurred_on, accrual_date, note, status, obligation_id,
                            created_by, origin)
  values (_team, _type, (p_payload->>'amount')::bigint,
          coalesce(nullif(p_payload->>'currency',''),'RUB'),
          nullif(p_payload->>'account_id','')::uuid,
          nullif(p_payload->>'transfer_account_id','')::uuid,
          nullif(p_payload->>'transfer_amount','')::bigint,
          nullif(p_payload->>'transfer_currency',''),
          nullif(p_payload->>'category_id','')::uuid,
          nullif(p_payload->>'counterparty_id','')::uuid,
          nullif(p_payload->>'project_id','')::uuid,
          coalesce(nullif(p_payload->>'occurred_on','')::date, current_date),
          nullif(p_payload->>'accrual_date','')::date,
          nullif(p_payload->>'note',''), _status,
          nullif(p_payload->>'obligation_id','')::uuid,
          auth.uid(),
          coalesce(nullif(p_payload->>'origin',''), 'manual'))
  returning id into _id;

  return public.op_finish(p_request_id, jsonb_build_object('ok', true, 'id', _id));
end $$;

-- D5. Выплата по обязательству: создание расходной/приходной операции И её
-- разнесение на обязательство — одной транзакцией. Раньше это были два
-- независимых insert'а (выплаты агентам и зарплаты): при сбое второго деньги
-- списаны, а обязательство осталось открытым. Ключ идемпотентности делает
-- повторный прогон «выплатить всё» безопасным.
create or replace function public.obligation_pay(
  p_obligation uuid,
  p_account uuid,
  p_amount bigint,
  p_occurred_on date default null,
  p_note text default null,
  p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _o obligations; _dup jsonb; _paid bigint; _tx uuid; _type tx_type; _cur text; _day date;
begin
  select * into _o from obligations where id = p_obligation for update;
  if _o.id is null then raise exception 'Обязательство не найдено' using errcode = '42704'; end if;
  if not public.can_edit_finance(_o.team_id) then raise exception 'Недостаточно прав' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Сумма должна быть больше нуля' using errcode = '22023'; end if;
  if p_account is not null and not exists (select 1 from accounts where id = p_account and team_id = _o.team_id) then
    raise exception 'Счёт не найден' using errcode = '42704';
  end if;

  _dup := public.op_begin(p_request_id, _o.team_id, 'obligation_pay');
  if _dup is not null then return _dup; end if;

  select coalesce(sum(amount), 0) into _paid from obligation_payments where obligation_id = p_obligation;
  if _paid + p_amount > _o.amount then
    raise exception 'Переплата: уже разнесено %, сумма обязательства %', _paid, _o.amount using errcode = '23514';
  end if;

  -- payable закрывается расходом, receivable — приходом
  _type := case when _o.type = 'payable' then 'expense' else 'income' end::tx_type;
  _cur  := coalesce((select currency from accounts where id = p_account), _o.currency);
  _day  := coalesce(p_occurred_on, current_date);

  if p_account is not null then
    insert into transactions (team_id, type, amount, currency, account_id, counterparty_id,
                              occurred_on, note, status, created_by, origin)
    values (_o.team_id, _type, p_amount, _cur, p_account, _o.counterparty_id,
            _day, coalesce(p_note, _o.note), 'actual', auth.uid(), 'manual')
    returning id into _tx;
  end if;

  insert into obligation_payments (obligation_id, amount, paid_on, transaction_id, created_by)
  values (p_obligation, p_amount, _day, _tx, auth.uid());

  return public.op_finish(p_request_id, jsonb_build_object(
    'ok', true, 'transaction_id', _tx, 'paid', _paid + p_amount, 'amount', _o.amount,
    'outstanding', _o.amount - (_paid + p_amount)));
end $$;

do $$ begin
  execute 'grant execute on function public.obligation_pay(uuid, uuid, bigint, date, text, uuid) to authenticated';
  execute 'grant execute on function public.transactions_bulk_patch(uuid[], jsonb, uuid) to authenticated';
  execute 'grant execute on function public.transactions_convert_to_transfer(uuid[], uuid, uuid, uuid) to authenticated';
  execute 'grant execute on function public.transaction_delete(uuid, integer, uuid) to authenticated';
  execute 'grant execute on function public.transaction_insert(jsonb, uuid) to authenticated';
end $$;
