-- Откат 0090. Удаляет модель идентичности банковского события.
-- Перед откатом выгрузи bank_reconciliation_conflicts, если конфликты уже разбирались:
--   \copy (select * from public.bank_reconciliation_conflicts) to 'conflicts.csv' csv header
begin;

drop function if exists public.bank_import_commit(uuid, jsonb, jsonb, jsonb, uuid);
drop function if exists public.bank_sync_claim(uuid, text, interval);
drop function if exists public.is_service_role();

drop table if exists public.bank_reconciliation_conflicts;

drop index if exists public.transactions_bank_event_fp_strong_idx;
drop index if exists public.transactions_bank_event_fp_idx;
drop index if exists public.transactions_bank_event_id_uidx;

-- Удаление generated-колонок перезаписи таблицы НЕ требует (это только правка
-- каталога), в отличие от их добавления.
alter table public.transactions drop column if exists bank_event_fp_strong;
alter table public.transactions drop column if exists bank_event_fp;
alter table public.transactions drop column if exists bank_event_id;
alter table public.transactions drop column if exists bank_provider_tx_id;
alter table public.transactions drop column if exists bank_provider_account;
alter table public.transactions drop column if exists bank_provider;
alter table public.transactions drop column if exists origin;

drop function if exists public.bank_note_norm(text);
commit;
