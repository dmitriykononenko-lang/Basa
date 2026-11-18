-- ============================================================
-- 0035_obligation_planning: «Запланировать платёж» по обязательству
-- Плановая операция связывается с обязательством; при проведении
-- (planned → actual) обязательство автоматически гасится.
-- ============================================================

alter table public.transactions
  add column if not exists obligation_id uuid references public.obligations(id) on delete set null;

create index if not exists transactions_obligation_idx
  on public.transactions(obligation_id);

-- Один запланированный платёж на обязательство (чтобы не задваивать).
create unique index if not exists transactions_obl_planned_uniq
  on public.transactions(obligation_id)
  where obligation_id is not null and status = 'planned';

-- Для апсерта платежа по конкретной транзакции.
create unique index if not exists obligation_payments_tx_uniq
  on public.obligation_payments(transaction_id)
  where transaction_id is not null;

-- Проведение/правка/снятие плановой операции, привязанной к обязательству.
create or replace function public.settle_obligation_on_tx()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.obligation_id is not null and new.status = 'actual' then
    -- провели платёж → создаём/обновляем запись погашения
    insert into public.obligation_payments (obligation_id, amount, paid_on, transaction_id, created_by)
    values (new.obligation_id, new.amount, new.occurred_on, new.id, new.created_by)
    on conflict (transaction_id) where transaction_id is not null
    do update set obligation_id = excluded.obligation_id,
                  amount        = excluded.amount,
                  paid_on       = excluded.paid_on;
  elsif new.obligation_id is not null and new.status is distinct from 'actual' then
    -- операция снова стала плановой (или не actual) → снимаем погашение
    delete from public.obligation_payments where transaction_id = new.id;
  end if;
  return new;
end;
$$;

-- Удаление операции → снимаем погашение, остаток обязательства восстанавливается.
create or replace function public.unsettle_obligation_on_tx_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.obligation_payments where transaction_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_settle_obligation on public.transactions;
create trigger trg_settle_obligation
  after insert or update of status, amount, occurred_on, obligation_id
  on public.transactions
  for each row execute function public.settle_obligation_on_tx();

drop trigger if exists trg_unsettle_obligation on public.transactions;
create trigger trg_unsettle_obligation
  before delete on public.transactions
  for each row execute function public.unsettle_obligation_on_tx_delete();

revoke all on function public.settle_obligation_on_tx() from public, anon, authenticated;
revoke all on function public.unsettle_obligation_on_tx_delete() from public, anon, authenticated;
