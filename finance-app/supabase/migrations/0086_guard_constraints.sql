-- ============================================================
-- 0086_guard_constraints — шаг 1 REMEDIATION_PLAN
-- Инварианты, которые до сих пор держались только кодом, переносятся в схему.
-- На момент написания текущих нарушений в проде 0 по всем четырём (проверено
-- scripts/db_integrity_audit.sql), поэтому миграция ничего не ломает.
--   T5  — уникальность номера инвойса в команде
--   T2  — invoices.amount = Σ invoice_items.amount (пересчёт + проверка)
--   CONC-08 — Σ transaction_splits = transactions.amount (или частей нет)
--   T4  — Σ obligation_payments.amount ≤ obligations.amount
-- Агрегатные инварианты нельзя выразить CHECK, поэтому используются
-- CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED: внутри транзакции
-- промежуточное состояние разрешено, на COMMIT — нет.
-- ============================================================

-- ─── T5: номер документа уникален внутри команды ────────────────────────────
create unique index if not exists invoices_team_number_uniq
  on public.invoices (team_id, number)
  where coalesce(number, '') <> '';

-- ─── T2: итоги инвойса считаются из позиций (единственный источник истины) ───
-- Формула повторяет src/lib/invoices.ts: amount = Σ amount позиций,
-- vat_amount = Σ round(amount * r / (100 + r)) по каждой позиции (цена с НДС).
create or replace function public.invoice_recalc_totals(_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from invoices where id = _invoice) then
    return; -- инвойс удалён (каскад по invoice_items) — пересчитывать нечего
  end if;
  update invoices i
     set amount = t.amount, vat_amount = t.vat_amount
    from (
      select coalesce(sum(it.amount), 0)::bigint as amount,
             coalesce(sum(round(it.amount::numeric * nullif(it.vat_rate,'none')::numeric
                                / (100 + nullif(it.vat_rate,'none')::numeric))), 0)::bigint as vat_amount
        from invoice_items it where it.invoice_id = _invoice
    ) t
   where i.id = _invoice
     and exists (select 1 from invoice_items it2 where it2.invoice_id = _invoice)
     and (i.amount, i.vat_amount) is distinct from (t.amount, t.vat_amount);
end $$;

create or replace function public.trg_invoice_items_recalc()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.invoice_recalc_totals(coalesce(new.invoice_id, old.invoice_id));
  return null;
end $$;

drop trigger if exists invoice_items_recalc on public.invoice_items;
create trigger invoice_items_recalc
  after insert or update or delete on public.invoice_items
  for each row execute function public.trg_invoice_items_recalc();

-- Проверка на COMMIT: если у инвойса есть позиции, их сумма обязана совпадать
-- с суммой инвойса. Инвойсы без позиций (исторические/пакетные) допускаются.
create or replace function public.assert_invoice_items_total()
returns trigger language plpgsql security definer set search_path = public as $$
declare _inv uuid; _sum bigint; _amount bigint; _cnt int;
begin
  _inv := coalesce(new.invoice_id, old.invoice_id);
  select amount into _amount from invoices where id = _inv;
  if _amount is null then return null; end if;
  select count(*), coalesce(sum(amount),0) into _cnt, _sum from invoice_items where invoice_id = _inv;
  if _cnt > 0 and _sum <> _amount then
    raise exception 'Инвойс %: сумма позиций (%) не совпадает с суммой инвойса (%)', _inv, _sum, _amount
      using errcode = '23514';
  end if;
  return null;
end $$;

drop trigger if exists invoice_items_total_ck on public.invoice_items;
create constraint trigger invoice_items_total_ck
  after insert or update or delete on public.invoice_items
  deferrable initially deferred
  for each row execute function public.assert_invoice_items_total();

-- ВАЖНО: DEFERRED-триггер срабатывает на COMMIT, но NEW — это снимок строки на
-- момент того оператора, который его поставил в очередь. Поэтому сумму инвойса
-- нужно перечитать из таблицы, иначе триггер сравнивает устаревшее значение
-- (например 0 сразу после INSERT, до пересчёта из позиций).
create or replace function public.assert_invoice_total_matches_items()
returns trigger language plpgsql security definer set search_path = public as $$
declare _sum bigint; _cnt int; _amount bigint;
begin
  select amount into _amount from invoices where id = new.id;
  if _amount is null then return null; end if; -- инвойс удалён в той же транзакции
  select count(*), coalesce(sum(amount),0) into _cnt, _sum from invoice_items where invoice_id = new.id;
  if _cnt > 0 and _sum <> _amount then
    raise exception 'Инвойс %: сумма инвойса (%) не совпадает с суммой позиций (%)', new.id, _amount, _sum
      using errcode = '23514';
  end if;
  return null;
end $$;

drop trigger if exists invoices_total_ck on public.invoices;
create constraint trigger invoices_total_ck
  after insert or update of amount on public.invoices
  deferrable initially deferred
  for each row execute function public.assert_invoice_total_matches_items();

-- ─── CONC-08: части операции либо отсутствуют, либо в сумме равны операции ───
create or replace function public.assert_splits_total()
returns trigger language plpgsql security definer set search_path = public as $$
declare _tx uuid; _sum bigint; _amount bigint; _cnt int;
begin
  _tx := coalesce(new.transaction_id, old.transaction_id);
  select amount into _amount from transactions where id = _tx;
  if _amount is null then return null; end if; -- операция удалена каскадом
  select count(*), coalesce(sum(amount),0) into _cnt, _sum from transaction_splits where transaction_id = _tx;
  if _cnt > 0 and _sum <> _amount then
    raise exception 'Операция %: сумма частей (%) не равна сумме операции (%)', _tx, _sum, _amount
      using errcode = '23514';
  end if;
  return null;
end $$;

drop trigger if exists transaction_splits_total_ck on public.transaction_splits;
create constraint trigger transaction_splits_total_ck
  after insert or update or delete on public.transaction_splits
  deferrable initially deferred
  for each row execute function public.assert_splits_total();

-- ─── T4: обязательство нельзя переплатить ───────────────────────────────────
-- Внимание: obligation_payments.amount хранится в валюте обязательства
-- (см. src/lib/unallocated.ts). Кросс-валютные разнесения (FIN-02) этот
-- инвариант не отменяют: сравнение идёт в одной валюте — валюте обязательства.
create or replace function public.assert_obligation_not_overpaid()
returns trigger language plpgsql security definer set search_path = public as $$
declare _obl uuid; _paid bigint; _amount bigint;
begin
  _obl := coalesce(new.obligation_id, old.obligation_id);
  select amount into _amount from obligations where id = _obl;
  if _amount is null then return null; end if;
  select coalesce(sum(amount),0) into _paid from obligation_payments where obligation_id = _obl;
  if _paid > _amount then
    raise exception 'Обязательство %: разнесено % при сумме % — переплата', _obl, _paid, _amount
      using errcode = '23514';
  end if;
  return null;
end $$;

drop trigger if exists obligation_payments_cap_ck on public.obligation_payments;
create constraint trigger obligation_payments_cap_ck
  after insert or update on public.obligation_payments
  deferrable initially deferred
  for each row execute function public.assert_obligation_not_overpaid();
