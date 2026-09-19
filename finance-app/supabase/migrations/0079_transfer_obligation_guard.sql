-- ============================================================
-- 0079_transfer_obligation_guard: перевод не гасит обязательство + фикс триггера.
--
-- Триггер settle_obligation_on_tx автоматически ведёт платёж по обязательству,
-- на которое ПРЯМО ссылается операция (transactions.obligation_id). Ручные
-- мульти-привязки (obligation_payments с transaction_id к ДРУГИМ обязательствам,
-- 0072) создаются отдельно и триггер их трогать не должен.
--
-- Что чиним:
--   1) ON CONFLICT (transaction_id) не соответствовал реальному индексу
--      (transaction_id, obligation_id) из 0072 — расход с obligation_id падал с
--      ошибкой «no unique constraint». Исправляем цель конфликта.
--   2) Перевод (в т.ч. полученный конвертацией) не должен числиться платежом —
--      добавляем условие type <> 'transfer' и снимаем свой авто-платёж.
--   3) Триггер не срабатывал на смену только типа — добавляем type в колонки.
--
-- Управляем строго СВОИМ платежом — парой (transaction_id, OLD/ NEW.obligation_id),
-- поэтому ручные мульти-привязки к другим обязательствам не затрагиваются.
-- ============================================================

create or replace function public.settle_obligation_on_tx()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Снять прежний авто-платёж, если операция перестала быть фактическим
  -- погашением своего обязательства (сменилось/убрано обязательство, стала
  -- плановой или переводом). Удаляем только пару (эта операция, её прежнее
  -- обязательство) — ручные привязки к другим обязательствам не трогаем.
  if tg_op = 'UPDATE' and old.obligation_id is not null
     and (new.obligation_id is distinct from old.obligation_id
          or new.status <> 'actual'
          or new.type = 'transfer') then
    delete from public.obligation_payments
      where transaction_id = new.id and obligation_id = old.obligation_id;
  end if;

  -- Создать/обновить авто-платёж для текущего обязательства операции.
  if new.obligation_id is not null and new.status = 'actual' and new.type <> 'transfer' then
    insert into public.obligation_payments (obligation_id, amount, paid_on, transaction_id, created_by)
    values (new.obligation_id, new.amount, new.occurred_on, new.id, new.created_by)
    on conflict (transaction_id, obligation_id) where transaction_id is not null
    do update set amount  = excluded.amount,
                  paid_on = excluded.paid_on;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_settle_obligation on public.transactions;
create trigger trg_settle_obligation
  after insert or update of status, amount, occurred_on, obligation_id, type on public.transactions
  for each row execute function public.settle_obligation_on_tx();
