-- Откат 0096. Триггер снимается; заполненные поля провайдера у строк Bybit
-- остаются (они верные и совпадают с backfill 0090). Права возвращаются к
-- состоянию до 0096 (EXECUTE у PUBLIC/anon), то есть вместе с уязвимостью.
drop trigger if exists transactions_bank_identity on public.transactions;
drop function if exists public.trg_bank_identity_from_source();

do $$
declare f text;
begin
  foreach f in array array[
    'public.next_invoice_number(uuid, text)', 'public.invoice_recalc_totals(uuid)',
    'public.can_modify_tx(uuid)', 'public.trg_invoice_items_recalc()',
    'public.assert_invoice_items_total()', 'public.assert_invoice_total_matches_items()',
    'public.assert_splits_total()', 'public.assert_obligation_not_overpaid()',
    'public.invoice_save(jsonb, uuid)', 'public.obligation_allocate(uuid, uuid, bigint, date, uuid)',
    'public.transaction_split(uuid, jsonb, uuid)', 'public.transactions_merge_transfer(uuid, uuid, uuid)',
    'public.transaction_match_planned(uuid, uuid, uuid)', 'public.transaction_save(uuid, jsonb, integer, jsonb, uuid)',
    'public.transactions_bulk_patch(uuid[], jsonb, uuid)', 'public.transactions_convert_to_transfer(uuid[], uuid, uuid, uuid)',
    'public.transaction_delete(uuid, integer, uuid)', 'public.transaction_insert(jsonb, uuid)',
    'public.obligation_pay(uuid, uuid, bigint, date, text, uuid)', 'public.bank_import_commit(uuid, jsonb, jsonb, jsonb, uuid)',
    'public.bank_sync_claim(uuid, text, interval)'
  ] loop
    execute format('grant execute on function %s to public, anon, authenticated', f);
  end loop;
  -- op_begin/op_finish до 0096 были без PUBLIC, но с anon/authenticated
  execute 'grant execute on function public.op_begin(uuid, uuid, text) to anon, authenticated';
  execute 'grant execute on function public.op_finish(uuid, jsonb) to anon, authenticated';
end $$;
