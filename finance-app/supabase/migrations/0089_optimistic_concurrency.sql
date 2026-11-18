-- ============================================================
-- 0089_optimistic_concurrency — шаг 4 REMEDIATION_PLAN (T8)
-- Проблема: карточка операции отправляла UPDATE всей строки без версии, поэтому
-- второе сохранение молча затирало правку первого (доказано тестом T8).
-- Решение: версия строки + CAS. При несовпадении версии RPC ничего не меняет и
-- возвращает конфликт с актуальными данными — вместо тихой перезаписи.
-- ============================================================

do $$ begin
  alter table public.transactions add column version integer not null default 1;
exception when duplicate_column then null; end $$;
do $$ begin
  alter table public.invoices add column version integer not null default 1;
exception when duplicate_column then null; end $$;

create or replace function public.trg_bump_version()
returns trigger language plpgsql set search_path = public as $$
begin
  new.version := coalesce(old.version, 0) + 1;
  return new;
end $$;

drop trigger if exists transactions_bump_version on public.transactions;
create trigger transactions_bump_version before update on public.transactions
  for each row execute function public.trg_bump_version();

drop trigger if exists invoices_bump_version on public.invoices;
create trigger invoices_bump_version before update on public.invoices
  for each row execute function public.trg_bump_version();

-- ─── Сохранение операции вместе с её частями, одной транзакцией ─────────────
-- p_patch — только разрешённые поля (whitelist ниже); версия обязательна.
-- p_parts — массив частей (split) или null, если части не менялись; [] — удалить.
create or replace function public.transaction_save(
  p_transaction uuid,
  p_patch jsonb,
  p_expected_version integer,
  p_parts jsonb default null,
  p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _t transactions; _team uuid; _dup jsonb; _sum bigint; _is_transfer boolean;
begin
  select * into _t from transactions where id = p_transaction for update;
  if _t.id is null then raise exception 'Операция не найдена' using errcode = '42704'; end if;
  _team := _t.team_id;
  if not coalesce(public.can_modify_tx(p_transaction), false) then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;

  -- CAS: чужая правка между чтением формы и сохранением => конфликт, не перезапись
  if p_expected_version is not null and _t.version <> p_expected_version then
    return jsonb_build_object(
      'ok', false, 'conflict', true,
      'expected_version', p_expected_version, 'current_version', _t.version,
      'current', to_jsonb(_t));
  end if;

  _dup := public.op_begin(p_request_id, _team, 'transaction_save');
  if _dup is not null then return _dup; end if;

  -- принадлежность справочников той же команде
  if nullif(p_patch->>'account_id','') is not null
     and not exists (select 1 from accounts where id = (p_patch->>'account_id')::uuid and team_id = _team) then
    raise exception 'Счёт не найден' using errcode = '42704'; end if;
  if nullif(p_patch->>'transfer_account_id','') is not null
     and not exists (select 1 from accounts where id = (p_patch->>'transfer_account_id')::uuid and team_id = _team) then
    raise exception 'Счёт зачисления не найден' using errcode = '42704'; end if;
  if nullif(p_patch->>'category_id','') is not null
     and not exists (select 1 from categories where id = (p_patch->>'category_id')::uuid and team_id = _team) then
    raise exception 'Статья не найдена' using errcode = '42704'; end if;
  if nullif(p_patch->>'counterparty_id','') is not null
     and not exists (select 1 from counterparties where id = (p_patch->>'counterparty_id')::uuid and team_id = _team) then
    raise exception 'Контрагент не найден' using errcode = '42704'; end if;
  if nullif(p_patch->>'project_id','') is not null
     and not exists (select 1 from projects where id = (p_patch->>'project_id')::uuid and team_id = _team) then
    raise exception 'Проект не найден' using errcode = '42704'; end if;

  _is_transfer := coalesce(p_patch->>'type', _t.type::text) = 'transfer';

  update transactions set
    type                = coalesce((p_patch->>'type')::tx_type, type),
    amount              = coalesce((p_patch->>'amount')::bigint, amount),
    currency            = coalesce(nullif(p_patch->>'currency',''), currency),
    account_id          = case when p_patch ? 'account_id' then nullif(p_patch->>'account_id','')::uuid else account_id end,
    transfer_account_id = case when p_patch ? 'transfer_account_id' then nullif(p_patch->>'transfer_account_id','')::uuid else transfer_account_id end,
    transfer_amount     = case when p_patch ? 'transfer_amount' then nullif(p_patch->>'transfer_amount','')::bigint else transfer_amount end,
    transfer_currency   = case when p_patch ? 'transfer_currency' then nullif(p_patch->>'transfer_currency','') else transfer_currency end,
    category_id         = case when _is_transfer then null
                               when p_patch ? 'category_id' then nullif(p_patch->>'category_id','')::uuid else category_id end,
    counterparty_id     = case when _is_transfer then null
                               when p_patch ? 'counterparty_id' then nullif(p_patch->>'counterparty_id','')::uuid else counterparty_id end,
    project_id          = case when p_patch ? 'project_id' then nullif(p_patch->>'project_id','')::uuid else project_id end,
    occurred_on         = coalesce(nullif(p_patch->>'occurred_on','')::date, occurred_on),
    accrual_date        = case when p_patch ? 'accrual_date' then nullif(p_patch->>'accrual_date','')::date else accrual_date end,
    note                = case when p_patch ? 'note' then nullif(p_patch->>'note','') else note end,
    status              = coalesce(nullif(p_patch->>'status',''), status),
    obligation_id       = case when _is_transfer then null
                               when p_patch ? 'obligation_id' then nullif(p_patch->>'obligation_id','')::uuid else obligation_id end
   where id = p_transaction;

  -- части операции сохраняются в той же транзакции, что и сама операция
  if p_parts is not null then
    delete from transaction_splits where transaction_id = p_transaction;
    if jsonb_array_length(p_parts) > 0 then
      if _is_transfer then raise exception 'Перевод нельзя делить на части' using errcode = '22023'; end if;
      insert into transaction_splits (team_id, transaction_id, amount, category_id, project_id, counterparty_id, note)
      select _team, p_transaction, (p->>'amount')::bigint,
             nullif(p->>'category_id','')::uuid, nullif(p->>'project_id','')::uuid,
             nullif(p->>'counterparty_id','')::uuid, nullif(p->>'note','')
        from jsonb_array_elements(p_parts) p;
      select coalesce(sum(amount),0) into _sum from transaction_splits where transaction_id = p_transaction;
      if _sum <> (select amount from transactions where id = p_transaction) then
        raise exception 'Сумма частей (%) не равна сумме операции' , _sum using errcode = '23514';
      end if;
    end if;
  end if;

  return public.op_finish(p_request_id,
    jsonb_build_object('ok', true, 'id', p_transaction,
                       'version', (select version from transactions where id = p_transaction)));
end $$;

do $$ begin
  execute 'grant execute on function public.transaction_save(uuid, jsonb, integer, jsonb, uuid) to authenticated';
end $$;
