-- ============================================================
-- 0096_bybit_identity_and_rpc_grants
--
-- ЧАСТЬ A. Идентичность банковского события для строк, которые пишутся мимо
-- bank_import_commit (bybit_ingest вставляет напрямую с source/external_id и не
-- знает про поля 0090). BEFORE INSERT-триггер заполняет bank_provider /
-- bank_provider_tx_id / origin из source + external_id — ровно как backfill в 0090.
-- Generated-колонки (bank_event_id, отпечатки) вычисляются уже после BEFORE-триггера.
-- Строки bank_import_commit (bank_provider уже задан) триггер не трогает.
--
-- ЧАСТЬ B. Права на функции 0086–0093. Supabase по умолчанию даёт EXECUTE на
-- новые функции public роли anon (и PUBLIC). Большинство SECURITY DEFINER-функций
-- проверяют права сами, но op_finish / op_begin / next_invoice_number /
-- invoice_recalc_totals — нет: анонимный вызов мог переписать результат команды,
-- сдвинуть счётчик номеров инвойсов или пересчитать чужой инвойс.
--   * внутренние функции (вызываются только из других SECURITY DEFINER-функций и
--     триггеров) — EXECUTE только у владельца и service_role;
--   * RPC, которые зовёт приложение, — authenticated + service_role, без anon/PUBLIC.
-- Триггерам EXECUTE при срабатывании не нужен, вызовы изнутри DEFINER-функций идут
-- от имени владельца — поведение приложения не меняется.
-- Откат: rollback/0096_down.sql.
-- ============================================================

-- ─── A ────────────────────────────────────────────────────────────────────────
create or replace function public.trg_bank_identity_from_source()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.bank_provider is null and new.source in ('tochka','bybit') and new.external_id is not null then
    new.bank_provider := new.source;
    new.bank_provider_tx_id := new.external_id;
    if new.origin = 'manual' then new.origin := 'bank'; end if;
  end if;
  return new;
end $$;
revoke all on function public.trg_bank_identity_from_source() from public, anon, authenticated;

drop trigger if exists transactions_bank_identity on public.transactions;
create trigger transactions_bank_identity before insert on public.transactions
  for each row execute function public.trg_bank_identity_from_source();

-- backfill строк, вставленных после 0090 мимо bank_import_commit (Bybit с 16.10)
update public.transactions
   set origin = case when origin = 'manual' then 'bank' else origin end,
       bank_provider = source,
       bank_provider_tx_id = external_id
 where bank_provider is null and source in ('tochka','bybit') and external_id is not null;

-- ─── B ────────────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  -- внутренние: никаким клиентским ролям
  foreach f in array array[
    'public.op_begin(uuid, uuid, text)',
    'public.op_finish(uuid, jsonb)',
    'public.next_invoice_number(uuid, text)',
    'public.invoice_recalc_totals(uuid)',
    'public.can_modify_tx(uuid)',
    'public.trg_invoice_items_recalc()',
    'public.assert_invoice_items_total()',
    'public.assert_invoice_total_matches_items()',
    'public.assert_splits_total()',
    'public.assert_obligation_not_overpaid()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;

  -- RPC приложения: только вошедшим пользователям и service_role
  foreach f in array array[
    'public.invoice_save(jsonb, uuid)',
    'public.obligation_allocate(uuid, uuid, bigint, date, uuid)',
    'public.transaction_split(uuid, jsonb, uuid)',
    'public.transactions_merge_transfer(uuid, uuid, uuid)',
    'public.transaction_match_planned(uuid, uuid, uuid)',
    'public.transaction_save(uuid, jsonb, integer, jsonb, uuid)',
    'public.transactions_bulk_patch(uuid[], jsonb, uuid)',
    'public.transactions_convert_to_transfer(uuid[], uuid, uuid, uuid)',
    'public.transaction_delete(uuid, integer, uuid)',
    'public.transaction_insert(jsonb, uuid)',
    'public.obligation_pay(uuid, uuid, bigint, date, text, uuid)',
    'public.bank_import_commit(uuid, jsonb, jsonb, jsonb, uuid)',
    'public.bank_sync_claim(uuid, text, interval)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
