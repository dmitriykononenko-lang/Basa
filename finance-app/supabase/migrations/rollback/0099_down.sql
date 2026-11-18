-- ============================================================
-- Откат 0099_obligation_link_currency (BASA:Q-09)
--
-- ПОРЯДОК: сначала откатить код приложения на деплой до Q-09 (новый фронт зовёт
-- obligation_link и читает payment_amount), потом этот файл.
--
-- Тела settle_obligation_on_tx / obligation_pay / obligation_allocate / op_begin /
-- assert_obligation_not_overpaid / bybit_apply_parties, список колонок
-- trg_settle_obligation и политика obligation_payments_insert — сняты с production
-- 2026-10-22 до 0099 (pg_get_functiondef / pg_get_triggerdef / pg_policies), а не из исходников.
--
-- Данные: amount не трогается. Новые колонки перед удалением копируются в
-- obligation_payments_fx_0099_archive (RLS без политик, без грантов клиентам).
-- Строки, созданные obligation_link после 0099, остаются: их amount корректен
-- (валюта начисления), теряются только payment_*/fx_* — они в архиве.
-- Проверка после отката: колонок payment_amount/fx_* нет, функций obligation_link,
-- obligation_payments_fill_fx, obligation_payments_tx_cap, transactions_alloc_guard,
-- assert_tx_allocation нет; integrity audit — версия без проверок Q-09.
-- ============================================================

-- ─── триггеры и функции 0099 ────────────────────────────────────────────────
drop trigger if exists obligation_payments_fill_fx on public.obligation_payments;
drop trigger if exists obligation_payments_tx_cap_ck on public.obligation_payments;
drop trigger if exists transactions_alloc_ck on public.transactions;
drop trigger if exists transaction_splits_alloc_ck on public.transaction_splits;
drop trigger if exists obligations_alloc_ck on public.obligations;
drop function if exists public.obligation_payments_fill_fx();
drop function if exists public.obligation_payments_tx_cap();
drop function if exists public.transactions_alloc_guard();
drop function if exists public.transaction_splits_alloc_guard();
drop function if exists public.obligations_alloc_guard();
drop function if exists public.assert_tx_allocation(uuid);

-- ─── op_begin — тело production до 0099 ─────────────────────────────────────
create or replace function public.op_begin(_request_id uuid, _team uuid, _command text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _res jsonb;
begin
  if _request_id is null then
    return null; -- вызов без ключа идемпотентности (обратная совместимость)
  end if;
  begin
    insert into operation_requests (request_id, team_id, command, created_by)
    values (_request_id, _team, _command, auth.uid());
    return null;
  exception when unique_violation then
    -- Параллельный/повторный вызов: INSERT ждал первую транзакцию, она
    -- закоммитилась — возвращаем её результат, ничего не выполняя.
    select coalesce(result, jsonb_build_object('ok', true, 'duplicate', true))
      into _res from operation_requests where request_id = _request_id;
    return coalesce(_res, jsonb_build_object('ok', true, 'duplicate', true));
  end;
end $function$;

-- ─── bybit_apply_parties — тело production до 0099 ──────────────────────────
create or replace function public.bybit_apply_parties()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with upd as (
    update public.transactions t
    set counterparty_id = m.counterparty_id
    from public.bybit_tx_party p
    join public.bybit_party_map m on m.party = p.party
    where t.source='bybit' and t.external_id = p.external_id
      and t.counterparty_id is distinct from m.counterparty_id
    returning 1
  ) select count(*)::int from upd;
$function$;

-- ─── assert_obligation_not_overpaid (кэп 0086) — тело production до 0099 ─────
create or replace function public.assert_obligation_not_overpaid()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _obl uuid; _paid bigint; _amount bigint;
begin
  _obl := coalesce(new.obligation_id, old.obligation_id);
  select amount into _amount from obligations where id = _obl;
  if _amount is null then return null; end if;
  select coalesce(sum(amount),0) into _paid from obligation_payments where obligation_id = _obl;
  if _paid > _amount then
    raise exception 'Обязательство %: разнесено % при сумме % — переплата', _obl, _paid, _amount
      using errcode = '23514';
  end if;
  return null;
end $function$;

-- ─── obligation_allocate — тело production до 0099 (сначала, т.к. зовёт obligation_link) ─
create or replace function public.obligation_allocate(p_obligation uuid, p_transaction uuid, p_amount bigint, p_paid_on date DEFAULT NULL::date, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _team uuid; _amount bigint; _paid bigint; _dup jsonb; _id uuid; _tx_team uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Сумма должна быть больше нуля' using errcode = '22023';
  end if;

  -- FOR UPDATE: два параллельных разнесения на одно обязательство сериализуются,
  -- поэтому второй видит уже учтённую сумму первого.
  select team_id, amount into _team, _amount from obligations where id = p_obligation for update;
  if _team is null then raise exception 'Обязательство не найдено' using errcode = '42704'; end if;
  if not coalesce(public.can_edit_finance(_team), false) then raise exception 'Недостаточно прав' using errcode = '42501'; end if;

  _dup := public.op_begin(p_request_id, _team, 'obligation_allocate');
  if _dup is not null then return _dup; end if;

  if p_transaction is not null then
    select team_id into _tx_team from transactions where id = p_transaction;
    if _tx_team is null or _tx_team <> _team then
      raise exception 'Операция не найдена' using errcode = '42704';
    end if;
  end if;

  select coalesce(sum(amount), 0) into _paid from obligation_payments where obligation_id = p_obligation;
  if _paid + p_amount > _amount then
    raise exception 'Переплата: уже разнесено %, сумма обязательства %, попытка добавить %',
      _paid, _amount, p_amount using errcode = '23514';
  end if;

  insert into obligation_payments (obligation_id, amount, paid_on, transaction_id, created_by)
  values (p_obligation, p_amount,
          coalesce(p_paid_on, (select occurred_on from transactions where id = p_transaction), current_date),
          p_transaction, auth.uid())
  returning id into _id;

  return public.op_finish(p_request_id,
    jsonb_build_object('ok', true, 'id', _id, 'paid', _paid + p_amount, 'amount', _amount,
                       'outstanding', _amount - (_paid + p_amount)));
end $function$;

drop function if exists public.obligation_link(uuid, uuid, bigint, bigint, text, date, uuid, numeric);
drop function if exists public.obligation_link(uuid, uuid, bigint, bigint, text, date, uuid);
drop function if exists public.tx_counterparty_share(uuid, uuid);

-- ─── obligation_pay — тело production до 0099 ───────────────────────────────
create or replace function public.obligation_pay(p_obligation uuid, p_account uuid, p_amount bigint, p_occurred_on date DEFAULT NULL::date, p_note text DEFAULT NULL::text, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

-- ─── settle_obligation_on_tx — тело production до 0099 + прежний список колонок ─
create or replace function public.settle_obligation_on_tx()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'UPDATE' and old.obligation_id is not null
     and (new.obligation_id is distinct from old.obligation_id
          or new.status <> 'actual'
          or new.type = 'transfer') then
    delete from public.obligation_payments
      where transaction_id = new.id and obligation_id = old.obligation_id;
  end if;

  if new.obligation_id is not null and new.status = 'actual' and new.type <> 'transfer' then
    insert into public.obligation_payments (obligation_id, amount, paid_on, transaction_id, created_by)
    values (new.obligation_id, new.amount, new.occurred_on, new.id, new.created_by)
    on conflict (transaction_id, obligation_id) where transaction_id is not null
    do update set amount  = excluded.amount,
                  paid_on = excluded.paid_on;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_settle_obligation on public.transactions;
create trigger trg_settle_obligation
  after insert or update of status, amount, occurred_on, obligation_id, type on public.transactions
  for each row execute function public.settle_obligation_on_tx();

-- ─── политика insert — как в pg_policies до 0099 ────────────────────────────
drop policy if exists obligation_payments_insert on public.obligation_payments;
create policy obligation_payments_insert on public.obligation_payments
  for insert with check (
    exists (select 1 from public.obligations o
             where o.id = obligation_payments.obligation_id
               and public.can_edit_finance(o.team_id)));

-- ─── гранты — как в production до 0099 (proacl) ─────────────────────────────
revoke all on function public.obligation_allocate(uuid, uuid, bigint, date, uuid) from public, anon;
grant execute on function public.obligation_allocate(uuid, uuid, bigint, date, uuid) to authenticated, service_role;
revoke all on function public.obligation_pay(uuid, uuid, bigint, date, text, uuid) from public, anon;
grant execute on function public.obligation_pay(uuid, uuid, bigint, date, text, uuid) to authenticated, service_role;
revoke all on function public.settle_obligation_on_tx() from public, anon, authenticated;
grant execute on function public.settle_obligation_on_tx() to service_role;
revoke all on function public.op_begin(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.op_begin(uuid, uuid, text) to service_role;
revoke all on function public.assert_obligation_not_overpaid() from public, anon, authenticated;
grant execute on function public.assert_obligation_not_overpaid() to service_role;
revoke all on function public.bybit_apply_parties() from public, anon, authenticated;
grant execute on function public.bybit_apply_parties() to service_role;

-- ─── колонки: архив → удаление ──────────────────────────────────────────────
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'obligation_payments' and column_name = 'fx_method') then
    create table if not exists public.obligation_payments_fx_0099_archive (
      id uuid primary key, obligation_id uuid, transaction_id uuid, amount bigint,
      payment_amount bigint, payment_currency varchar(8), fx_rate numeric(20,10),
      fx_rate_date date, fx_method text, archived_at timestamptz not null default now());
    insert into public.obligation_payments_fx_0099_archive
      (id, obligation_id, transaction_id, amount, payment_amount, payment_currency, fx_rate, fx_rate_date, fx_method)
    select id, obligation_id, transaction_id, amount, payment_amount, payment_currency, fx_rate, fx_rate_date, fx_method
      from public.obligation_payments
     where fx_method is not null
    on conflict (id) do nothing;
  end if;
  -- служебная таблица: RLS без политик, без грантов клиентским ролям
  if to_regclass('public.obligation_payments_fx_0099_archive') is not null then
    alter table public.obligation_payments_fx_0099_archive enable row level security;
    revoke all on table public.obligation_payments_fx_0099_archive from public, anon, authenticated;
  end if;
end $$;

alter table public.obligation_payments
  drop constraint if exists obligation_payments_fx_filled_ck,
  drop constraint if exists obligation_payments_identity_ck,
  drop constraint if exists obligation_payments_fx_method_ck,
  drop constraint if exists obligation_payments_fx_rate_ck,
  drop constraint if exists obligation_payments_payment_amount_ck,
  drop constraint if exists obligation_payments_payment_currency_fkey;
alter table public.obligation_payments
  drop column if exists payment_amount,
  drop column if exists payment_currency,
  drop column if exists fx_rate,
  drop column if exists fx_rate_date,
  drop column if exists fx_method;
comment on column public.obligation_payments.amount is null;

-- ─── самопроверка после отката ──────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.obligation_allocate(uuid,uuid,bigint,date,uuid)', 'public.obligation_pay(uuid,uuid,bigint,date,text,uuid)',
    'public.settle_obligation_on_tx()', 'public.op_begin(uuid,uuid,text)', 'public.assert_obligation_not_overpaid()',
    'public.bybit_apply_parties()'
  ] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception '0099_down self-check: у anon есть EXECUTE на %', f;
    end if;
  end loop;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
              and proname in ('obligation_link','obligation_payments_fill_fx','obligation_payments_tx_cap','transactions_alloc_guard',
                              'transaction_splits_alloc_guard','obligations_alloc_guard','assert_tx_allocation','tx_counterparty_share')) then
    raise exception '0099_down self-check: остались функции 0099';
  end if;
  if exists (select 1 from pg_trigger where tgname in ('obligation_payments_fill_fx','obligation_payments_tx_cap_ck',
              'transactions_alloc_ck','transaction_splits_alloc_ck','obligations_alloc_ck')) then
    raise exception '0099_down self-check: остались триггеры 0099';
  end if;
end $$;
