-- Откат 0091. Снимает новые RPC и индексы 0091. Хелперы прав (SEC-008) остаются
-- в состоянии production до 0091, то есть с hotfix SEC-008/010.
begin;

drop function if exists public.obligation_pay(uuid, uuid, bigint, date, text, uuid);
drop function if exists public.transaction_insert(jsonb, uuid);
drop function if exists public.transaction_delete(uuid, integer, uuid);
drop function if exists public.transactions_convert_to_transfer(uuid[], uuid, uuid, uuid);
drop function if exists public.transactions_bulk_patch(uuid[], jsonb, uuid);

drop index if exists public.transactions_recurring_slot_uniq;
drop index if exists public.project_periods_project_month_uniq;

-- can_edit_finance / can_write_tx / can_manage_team НЕ трогаем: в production
-- ЧАСТЬ A уже применена hotfix'ом SEC-008/010 (hotfix/SEC008_SEC010_hotfix.sql)
-- до 0091, и тела совпадают с 0091. Откат 0091 должен вернуть состояние до 0091,
-- то есть с hotfix'ом. Прежние уязвимые тела — только в SEC008_SEC010_before.sql.

-- Снятые гранты anon/PUBLIC НЕ восстанавливаются намеренно: приложение их не
-- использует (проверено grep'ом), а возвращать их — значит возвращать риск.
commit;
