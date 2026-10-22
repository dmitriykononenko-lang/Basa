-- Откат 0088. Удаляет атомарные финансовые команды.
-- ВНИМАНИЕ: operation_requests хранит ключи идемпотентности выполненных команд.
-- После удаления таблицы повторная отправка тех же форм создаст дубли.
begin;
drop function if exists public.transaction_match_planned(uuid, uuid, uuid);
drop function if exists public.transactions_merge_transfer(uuid, uuid, uuid);
drop function if exists public.transaction_split(uuid, jsonb, uuid);
drop function if exists public.obligation_allocate(uuid, uuid, bigint, date, uuid);
drop function if exists public.invoice_save(jsonb, uuid);
drop function if exists public.next_invoice_number(uuid, text);
drop function if exists public.can_modify_tx(uuid);
drop function if exists public.op_finish(uuid, jsonb);
drop function if exists public.op_begin(uuid, uuid, text);
drop table if exists public.invoice_counters;
drop table if exists public.operation_requests;
commit;
