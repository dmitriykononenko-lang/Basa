-- Откат 0095_tochka_reconciliation. Одна транзакция; повторный запуск безопасен.
do $$
begin
  if not exists (select 1 from recon0095_transactions_before) then
    raise exception '0095_down: архив пуст — откатывать нечего';
  end if;
  -- 1. строки, добавленные из выписки
  delete from transactions where id in (select transaction_id from recon0095_inserted);
  delete from import_batches where id in (select distinct import_batch_id from recon0095_inserted);
  -- 2. изменённые строки: вернуть поля «до»
  update transactions t
     set type = b.type, account_id = b.account_id, transfer_account_id = b.transfer_account_id,
         counterparty_id = b.counterparty_id
    from recon0095_transactions_before b where b.id = t.id and b.action <> 'delete';
  -- 3. удалённые строки: вернуть целиком (без generated-колонок bank_event_*)
  insert into transactions (id, team_id, type, amount, currency, account_id, transfer_account_id, category_id, counterparty_id, project_id, occurred_on, note, created_by, created_at, status, import_batch_id, accrual_date, recurring_rule_id, obligation_id, external_id, source, transfer_amount, transfer_currency, version, origin, bank_provider, bank_provider_account, bank_provider_tx_id)
  select id, team_id, type, amount, currency, account_id, transfer_account_id, category_id, counterparty_id, project_id, occurred_on, note, created_by, created_at, status, import_batch_id, accrual_date, recurring_rule_id, obligation_id, external_id, source, transfer_amount, transfer_currency, version, origin, bank_provider, bank_provider_account, bank_provider_tx_id from recon0095_transactions_before b
   where b.action = 'delete' and not exists (select 1 from transactions t where t.id = b.id);
  -- 4. платёж по лицензии и opening_balance
  update license_payments lp set income_transaction_id = b.income_transaction_id
    from recon0095_license_payments_before b where b.id = lp.id;
  update accounts a set opening_balance = b.opening_before from recon0095_accounts_before b where b.account_id = a.id;
  -- 5. журнал применения очищается, архивы остаются для аудита
  delete from recon0095_inserted where true;
end $$;
