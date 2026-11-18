-- Откат 0089. Снимает оптимистичную блокировку.
begin;
drop function if exists public.transaction_save(uuid, jsonb, integer, jsonb, uuid);
drop trigger if exists invoices_bump_version on public.invoices;
drop trigger if exists transactions_bump_version on public.transactions;
drop function if exists public.trg_bump_version();
alter table public.invoices     drop column if exists version;
alter table public.transactions drop column if exists version;
commit;
