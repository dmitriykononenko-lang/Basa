-- Откат 0094 (FIN-03): возвращает 252 CSV-строки с теми же id и прежние opening_balance.
-- Одна транзакция; после неё детектор FIN-03 снова = 126, остатки счетов не меняются.
do $$
declare cols text; n int;
begin
  -- все колонки transactions, кроме generated (bank_event_id и отпечатки пересчитаются сами)
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema='public' and table_name='transactions' and is_generated='NEVER';
  execute format('insert into public.transactions (%s) select %s from public.fin03_removed_transactions
                  where reason like %L on conflict (id) do nothing', cols, cols, '%0094%');
  get diagnostics n = row_count;
  if n <> 252 then raise exception 'откат 0094: возвращено % строк вместо 252', n; end if;

  update public.accounts a set opening_balance = b.opening_before
    from public.fin03_opening_balance_before b
   where a.id = b.account_id and a.opening_balance = b.opening_after;
  get diagnostics n = row_count;
  if n <> 9 then raise exception 'откат 0094: восстановлено % opening_balance вместо 9 (их меняли после 0094?)', n; end if;
end $$;
