-- ============================================================
-- 0097_remove_dup_salary_kutishko_2026_09 — удаление дубля начисления оклада
-- Решение Дмитрия 2026-10-22: начисление b6bf091e (Станислав Кутишко, оклад
-- 40 000,00 ₽ за 2026-09, origin manual, создано 2026-10-22 15:30 UTC,
-- created_by null) — дубль: за сентябрь уже есть автоначисление 415caa25 на
-- полную ставку 40 000,00 ₽, полностью погашенное. Ставка — 40 000,00 ₽/мес.
-- Погашений и операций у строки нет.
-- Одна транзакция: guard → архив `obligations_removed` → delete → проверка.
-- Откат: rollback/0097_down.sql (возвращает строку с тем же id).
-- ============================================================

create table if not exists public.obligations_removed as
  select o.*, now() as archived_at, ''::text as reason from public.obligations o where false;
alter table public.obligations_removed enable row level security;
revoke all on public.obligations_removed from anon, authenticated, public;

do $$
declare n int; total bigint;
begin
  select count(*) into n from obligations
   where id = 'b6bf091e-9263-4de8-b3e0-ed7477ac5064'
     and counterparty_id = 'e922a1ca-3828-420a-99cf-b44e0169d249'
     and amount = 4000000 and currency = 'RUB' and pay_part = 'fixed'
     and period_month = '2026-09-01' and origin = 'manual';
  if n <> 1 then raise exception '0097: строка не найдена или изменилась (%)', n; end if;

  if exists (select 1 from obligation_payments where obligation_id = 'b6bf091e-9263-4de8-b3e0-ed7477ac5064')
     or exists (select 1 from transactions where obligation_id = 'b6bf091e-9263-4de8-b3e0-ed7477ac5064')
     or exists (select 1 from invoice_documents where obligation_id = 'b6bf091e-9263-4de8-b3e0-ed7477ac5064') then
    raise exception '0097: на начисление есть ссылки — прервано';
  end if;
  -- оставляемое автоначисление оклада за сентябрь на месте
  if (select count(*) from obligations where counterparty_id = 'e922a1ca-3828-420a-99cf-b44e0169d249'
        and pay_part = 'fixed' and period_month = '2026-09-01' and origin = 'auto' and amount = 4000000) <> 1 then
    raise exception '0097: не найдено автоначисление оклада за сентябрь — прервано';
  end if;

  select sum(amount) into total from obligations where counterparty_id = 'e922a1ca-3828-420a-99cf-b44e0169d249';

  insert into obligations_removed
    select o.*, now(), 'дубль оклада 2026-09 (решение Дмитрия 2026-10-22), 0097'
      from obligations o where o.id = 'b6bf091e-9263-4de8-b3e0-ed7477ac5064';
  delete from obligations where id = 'b6bf091e-9263-4de8-b3e0-ed7477ac5064';
  get diagnostics n = row_count;
  if n <> 1 then raise exception '0097: удалено % строк вместо 1', n; end if;

  if (select sum(amount) from obligations where counterparty_id = 'e922a1ca-3828-420a-99cf-b44e0169d249') <> total - 4000000 then
    raise exception '0097: начислено у сотрудника изменилось не на 40 000,00';
  end if;

  if current_setting('fin.rehearsal', true) = 'on' then
    raise exception 'REHEARSAL OK — откат: начислено % -> %', total, total - 4000000;
  end if;
end $$;
