-- ============================================================
-- 0088_financial_rpcs — шаг 3 REMEDIATION_PLAN
-- «Одна бизнес-команда → один RPC → одна транзакция → COMMIT целиком или
-- ROLLBACK целиком». Закрывает T2, T3, T4, T5, T9.
--
-- У Supabase JS нет клиентских транзакций, поэтому единственный способ сделать
-- многошаговую финансовую операцию атомарной — выполнить её внутри функции.
-- Все функции SECURITY DEFINER (значит RLS их не ограничивает), поэтому каждая
-- ОБЯЗАНА сама проверять права и принадлежность каждой переданной сущности
-- команде вызывающего. Это сделано в начале каждой функции.
-- ============================================================

-- ─── Идемпотентность команд ─────────────────────────────────────────────────
-- Защита от double submit и от ретрая после таймаута: повторный вызов с тем же
-- request_id не выполняет операцию второй раз, а возвращает результат первой.
create table if not exists public.operation_requests (
  request_id uuid primary key,
  team_id    uuid not null references public.teams(id) on delete cascade,
  command    text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  result     jsonb
);
alter table public.operation_requests enable row level security;
do $$ begin
  create policy operation_requests_select on public.operation_requests
    for select using (public.is_team_member(team_id));
exception when duplicate_object then null; end $$;
-- Пишет только SECURITY DEFINER-функция; напрямую клиенту запись не нужна.

-- Вернуть сохранённый результат, если команда уже выполнялась.
-- NULL => это первый вызов, можно работать.
create or replace function public.op_begin(_request_id uuid, _team uuid, _command text)
returns jsonb language plpgsql security definer set search_path = public as $$
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
end $$;

create or replace function public.op_finish(_request_id uuid, _result jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if _request_id is not null then
    update operation_requests set result = _result where request_id = _request_id;
  end if;
  return _result;
end $$;

-- ─── Право менять конкретную операцию (семантика RLS transactions) ──────────
-- ВАЖНО про NULL: can_edit_finance()/can_write_tx() в production возвращают NULL
-- для не-участника команды (`role in (...)` при role IS NULL). Для RLS это
-- равносильно отказу, но в plpgsql `if not f() then raise` при NULL НЕ срабатывает.
-- Поэтому все проверки прав ниже обёрнуты в coalesce(..., false).
create or replace function public.can_modify_tx(_tx uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare _team uuid; _by uuid;
begin
  select team_id, created_by into _team, _by from transactions where id = _tx;
  if _team is null then return false; end if;
  if coalesce(public.can_edit_finance(_team), false) then return true; end if;
  if public.current_team_role(_team) = 'employee' and _by is not null and _by = auth.uid() then
    return true;
  end if;
  return false;
end $$;

-- ============================================================
-- T5 — атомарная выдача номера инвойса
-- ============================================================
create table if not exists public.invoice_counters (
  team_id uuid not null references public.teams(id) on delete cascade,
  series  text not null,               -- сквозной номер проекта NNN
  last_no integer not null default 0,
  primary key (team_id, series)
);
alter table public.invoice_counters enable row level security;

-- Выдаёт следующий свободный номер KO-<series>-INV-NN. Счётчик инкрементируется
-- одним оператором UPDATE (строка блокируется), поэтому два параллельных вызова
-- получают разные значения. Дополнительно пропускаются номера, уже занятые
-- вручную заведёнными инвойсами.
create or replace function public.next_invoice_number(_team uuid, _series text)
returns text language plpgsql security definer set search_path = public as $$
declare _no int; _num text; _guard int := 0;
begin
  insert into invoice_counters (team_id, series, last_no)
  select _team, _series,
         coalesce(max((regexp_match(number, '^KO-' || _series || '-INV-(\d+)$'))[1]::int), 0)
    from invoices
   where team_id = _team and number like 'KO-' || _series || '-INV-%'
  on conflict (team_id, series) do nothing;

  loop
    update invoice_counters set last_no = last_no + 1
     where team_id = _team and series = _series
    returning last_no into _no;
    _num := 'KO-' || _series || '-INV-' || lpad(_no::text, 2, '0');
    exit when not exists (select 1 from invoices where team_id = _team and number = _num);
    _guard := _guard + 1;
    if _guard > 1000 then raise exception 'Не удалось выдать номер инвойса для серии %', _series; end if;
  end loop;
  return _num;
end $$;

-- ============================================================
-- T2 / T3 — сохранение инвойса одной транзакцией
-- p_payload: { id?, number?, counterparty_id?, buyer_name?, buyer_inn?, buyer_kpp?,
--              project_id?, purpose?, issue_date?, payment_expiry_date?, note?,
--              currency?, items: [{name, quantity, unit, price, vat_rate}] }
-- Итоги (amount/vat_amount) не принимаются от клиента: их считает триггер
-- invoice_items_recalc из позиций (миграция 0086).
-- ============================================================
create or replace function public.invoice_save(p_payload jsonb, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _team uuid; _id uuid; _dup jsonb; _number text; _series text;
  _cp uuid; _prj uuid; _buyer_name text; _buyer_inn text; _items jsonb; _n int;
begin
  _id := nullif(p_payload->>'id','')::uuid;
  _cp := nullif(p_payload->>'counterparty_id','')::uuid;
  _prj := nullif(p_payload->>'project_id','')::uuid;

  -- команда: у существующего инвойса — его, иначе из payload
  if _id is not null then
    select team_id into _team from invoices where id = _id;
    if _team is null then raise exception 'Инвойс не найден' using errcode = '42704'; end if;
  else
    _team := nullif(p_payload->>'team_id','')::uuid;
  end if;
  if _team is null then raise exception 'Не указана команда' using errcode = '22023'; end if;
  if not coalesce(public.can_edit_finance(_team), false) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;

  _dup := public.op_begin(p_request_id, _team, 'invoice_save');
  if _dup is not null then return _dup; end if;

  -- принадлежность связанных сущностей той же команде (SECURITY DEFINER обходит RLS)
  if _cp is not null and not exists (select 1 from counterparties where id = _cp and team_id = _team) then
    raise exception 'Контрагент не найден' using errcode = '42704';
  end if;
  if _prj is not null and not exists (select 1 from projects where id = _prj and team_id = _team) then
    raise exception 'Проект не найден' using errcode = '42704';
  end if;

  _items := coalesce(p_payload->'items', '[]'::jsonb);
  select count(*) into _n from jsonb_array_elements(_items);
  if _n = 0 then raise exception 'Добавьте хотя бы одну позицию' using errcode = '22023'; end if;

  _buyer_name := coalesce(nullif(btrim(p_payload->>'buyer_name'),''), (select name from counterparties where id = _cp));
  _buyer_inn  := coalesce(nullif(btrim(p_payload->>'buyer_inn'),''),  (select inn  from counterparties where id = _cp), '');
  if _buyer_name is null then
    raise exception 'Укажите плательщика' using errcode = '22023';
  end if;

  _number := coalesce(btrim(p_payload->>'number'), '');
  if _id is null and _prj is not null
     and (_number = '' or _number ~ '^KO-\d+-INV-\d+$') then
    select (regexp_match(name, '^\s*\[(\d+)\]'))[1] into _series from projects where id = _prj;
    if _series is not null then
      _number := public.next_invoice_number(_team, _series);
    end if;
  end if;

  if _id is null then
    insert into invoices (team_id, number, counterparty_id, buyer_name, buyer_inn, buyer_kpp,
                          project_id, currency, amount, vat_amount, purpose, issue_date,
                          payment_expiry_date, note, status, created_by)
    values (_team, _number, _cp, _buyer_name, _buyer_inn, coalesce(btrim(p_payload->>'buyer_kpp'),''),
            _prj, coalesce(nullif(p_payload->>'currency',''),'RUB'), 0, 0,
            coalesce(btrim(p_payload->>'purpose'),''),
            coalesce(nullif(p_payload->>'issue_date','')::date, current_date),
            nullif(p_payload->>'payment_expiry_date','')::date,
            coalesce(btrim(p_payload->>'note'),''), 'payment_waiting', auth.uid())
    returning id into _id;
  else
    -- блокировка строки: два параллельных сохранения одного инвойса выстраиваются
    perform 1 from invoices where id = _id for update;
    update invoices set
      number = _number, counterparty_id = _cp, buyer_name = _buyer_name, buyer_inn = _buyer_inn,
      buyer_kpp = coalesce(btrim(p_payload->>'buyer_kpp'),''), project_id = _prj,
      currency = coalesce(nullif(p_payload->>'currency',''), currency),
      purpose = coalesce(btrim(p_payload->>'purpose'),''),
      issue_date = coalesce(nullif(p_payload->>'issue_date','')::date, issue_date),
      payment_expiry_date = nullif(p_payload->>'payment_expiry_date','')::date,
      note = coalesce(btrim(p_payload->>'note'),'')
     where id = _id;
  end if;

  delete from invoice_items where invoice_id = _id;
  insert into invoice_items (invoice_id, team_id, name, quantity, unit, price, vat_rate, amount, sort)
  select _id, _team,
         coalesce(btrim(it->>'name'),''),
         coalesce(nullif(it->>'quantity','')::numeric, 1),
         coalesce(nullif(btrim(it->>'unit'),''), 'шт'),
         coalesce(nullif(it->>'price','')::bigint, 0),
         coalesce(nullif(it->>'vat_rate',''), 'none'),
         round(coalesce(nullif(it->>'quantity','')::numeric, 1) * coalesce(nullif(it->>'price','')::bigint, 0)),
         (ord - 1)::int
    from jsonb_array_elements(_items) with ordinality as e(it, ord);

  if not exists (select 1 from invoice_items where invoice_id = _id and amount > 0) then
    raise exception 'Добавьте хотя бы одну позицию с суммой' using errcode = '22023';
  end if;

  return public.op_finish(p_request_id,
    jsonb_build_object('ok', true, 'id', _id,
      'number', (select number from invoices where id = _id),
      'amount', (select amount from invoices where id = _id),
      'vat_amount', (select vat_amount from invoices where id = _id)));
end $$;

-- ============================================================
-- T4 — разнесение выплаты по обязательству
-- ============================================================
create or replace function public.obligation_allocate(
  p_obligation uuid, p_transaction uuid, p_amount bigint, p_paid_on date default null,
  p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
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
end $$;

-- ============================================================
-- T9 — разбиение операции на части (insert новых + delete исходной атомарно)
-- p_parts: [{ amount, category_id?, counterparty_id?, project_id?, note? }]
-- ============================================================
create or replace function public.transaction_split(
  p_transaction uuid, p_parts jsonb, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _t transactions; _team uuid; _sum bigint; _dup jsonb; _ids uuid[]; _first uuid;
begin
  select * into _t from transactions where id = p_transaction for update;
  if _t.id is null then raise exception 'Операция не найдена' using errcode = '42704'; end if;
  _team := _t.team_id;
  if not coalesce(public.can_modify_tx(p_transaction), false) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;

  _dup := public.op_begin(p_request_id, _team, 'transaction_split');
  if _dup is not null then return _dup; end if;

  select coalesce(sum((p->>'amount')::bigint), 0) into _sum from jsonb_array_elements(p_parts) p;
  if _sum <> _t.amount then
    raise exception 'Сумма частей (%) должна совпасть с суммой операции (%)', _sum, _t.amount
      using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(p_parts) p where (p->>'amount')::bigint <= 0) then
    raise exception 'У каждой части сумма должна быть больше нуля' using errcode = '22023';
  end if;

  with ins as (
    insert into transactions (team_id, type, amount, currency, account_id, transfer_account_id,
                              category_id, counterparty_id, project_id, occurred_on, accrual_date,
                              note, status, created_by)
    select _team, _t.type, (p->>'amount')::bigint, _t.currency, _t.account_id, null,
           case when _t.type = 'transfer' then null
                else coalesce(nullif(p->>'category_id','')::uuid, _t.category_id) end,
           coalesce(nullif(p->>'counterparty_id','')::uuid, _t.counterparty_id),
           coalesce(nullif(p->>'project_id','')::uuid, _t.project_id),
           _t.occurred_on, _t.accrual_date,
           coalesce(nullif(p->>'note',''), _t.note), _t.status, auth.uid()
      from jsonb_array_elements(p_parts) p
    returning id
  ) select array_agg(id) into _ids from ins;

  _first := _ids[1];
  update attachments set transaction_id = _first where transaction_id = p_transaction;
  delete from transaction_splits where transaction_id = p_transaction;

  delete from transactions where id = p_transaction;
  if not found then
    raise exception 'Не удалось удалить исходную операцию — изменения отменены' using errcode = '55000';
  end if;

  return public.op_finish(p_request_id,
    jsonb_build_object('ok', true, 'created', _ids, 'removed', p_transaction));
end $$;

-- ============================================================
-- T9 — склейка расход+приход в перевод между своими счетами
-- ============================================================
create or replace function public.transactions_merge_transfer(
  p_expense uuid, p_income uuid, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _e transactions; _i transactions; _team uuid; _dup jsonb; _id uuid; _n int;
begin
  -- Порядок блокировок фиксирован (по id), чтобы исключить deadlock при
  -- встречной склейке той же пары.
  if p_expense < p_income then
    select * into _e from transactions where id = p_expense for update;
    select * into _i from transactions where id = p_income  for update;
  else
    select * into _i from transactions where id = p_income  for update;
    select * into _e from transactions where id = p_expense for update;
  end if;
  if _e.id is null or _i.id is null then raise exception 'Операция не найдена' using errcode = '42704'; end if;
  if _e.team_id <> _i.team_id then raise exception 'Операции разных команд' using errcode = '42501'; end if;
  _team := _e.team_id;
  if not coalesce(public.can_edit_finance(_team), false) then raise exception 'Недостаточно прав' using errcode = '42501'; end if;
  if _e.type <> 'expense' or _i.type <> 'income' then
    raise exception 'Ожидались расход и приход' using errcode = '22023';
  end if;
  if _e.amount <> _i.amount or _e.currency <> _i.currency then
    raise exception 'Суммы или валюты не совпадают' using errcode = '22023';
  end if;

  _dup := public.op_begin(p_request_id, _team, 'transactions_merge_transfer');
  if _dup is not null then return _dup; end if;

  insert into transactions (team_id, type, amount, currency, account_id, transfer_account_id,
                            occurred_on, status, note, created_by)
  values (_team, 'transfer', _e.amount, _e.currency, _e.account_id, _i.account_id,
          _e.occurred_on, _e.status, coalesce(_e.note, _i.note), auth.uid())
  returning id into _id;

  delete from transactions where id in (p_expense, p_income);
  get diagnostics _n = row_count;
  if _n <> 2 then
    raise exception 'Удалены не обе исходные операции (%) — изменения отменены', _n using errcode = '55000';
  end if;

  return public.op_finish(p_request_id, jsonb_build_object('ok', true, 'id', _id));
end $$;

-- ============================================================
-- T9 — сверка план↔факт: перенести аналитику на фактическую, удалить плановую
-- ============================================================
create or replace function public.transaction_match_planned(
  p_planned uuid, p_actual uuid, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _p transactions; _a transactions; _team uuid; _dup jsonb;
begin
  if p_planned < p_actual then
    select * into _p from transactions where id = p_planned for update;
    select * into _a from transactions where id = p_actual  for update;
  else
    select * into _a from transactions where id = p_actual  for update;
    select * into _p from transactions where id = p_planned for update;
  end if;
  if _p.id is null or _a.id is null then raise exception 'Операция не найдена' using errcode = '42704'; end if;
  if _p.team_id <> _a.team_id then raise exception 'Операции разных команд' using errcode = '42501'; end if;
  _team := _p.team_id;
  if not coalesce(public.can_edit_finance(_team), false) then raise exception 'Недостаточно прав' using errcode = '42501'; end if;
  if _p.status <> 'planned' or _a.status <> 'actual' then
    raise exception 'Ожидались плановая и фактическая операции' using errcode = '22023';
  end if;

  _dup := public.op_begin(p_request_id, _team, 'transaction_match_planned');
  if _dup is not null then return _dup; end if;

  update transactions set
    category_id     = coalesce(_a.category_id, _p.category_id),
    project_id      = coalesce(_a.project_id, _p.project_id),
    counterparty_id = coalesce(_a.counterparty_id, _p.counterparty_id),
    note            = coalesce(nullif(_a.note,''), _p.note)
   where id = p_actual;

  delete from transactions where id = p_planned;
  if not found then
    raise exception 'Плановая операция не удалена — изменения отменены' using errcode = '55000';
  end if;

  return public.op_finish(p_request_id, jsonb_build_object('ok', true, 'id', p_actual));
end $$;

-- ─── права ──────────────────────────────────────────────────────────────────
revoke all on function public.op_begin(uuid, uuid, text) from public;
revoke all on function public.op_finish(uuid, jsonb) from public;
do $$ begin
  execute 'grant execute on function public.invoice_save(jsonb, uuid) to authenticated';
  execute 'grant execute on function public.obligation_allocate(uuid, uuid, bigint, date, uuid) to authenticated';
  execute 'grant execute on function public.transaction_split(uuid, jsonb, uuid) to authenticated';
  execute 'grant execute on function public.transactions_merge_transfer(uuid, uuid, uuid) to authenticated';
  execute 'grant execute on function public.transaction_match_planned(uuid, uuid, uuid) to authenticated';
  execute 'grant execute on function public.next_invoice_number(uuid, text) to authenticated';
  execute 'grant execute on function public.can_modify_tx(uuid) to authenticated';
end $$;
