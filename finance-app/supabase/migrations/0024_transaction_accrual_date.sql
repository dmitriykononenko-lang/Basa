-- ============================================================
-- 0024_transaction_accrual_date: дата начисления (метод начисления для ОПиУ)
-- ============================================================
-- occurred_on  — дата движения денег (кассовый метод): ДДС, баланс счёта.
-- accrual_date — дата начисления (метод начисления): ОПиУ. Если NULL — берётся occurred_on.

alter table public.transactions add column if not exists accrual_date date;
create index if not exists transactions_accrual_idx on public.transactions (team_id, accrual_date);
