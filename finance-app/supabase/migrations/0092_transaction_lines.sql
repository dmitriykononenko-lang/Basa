-- ============================================================
-- 0092_transaction_lines — SPLIT-01: единый канонический слой
-- управленческой аналитики.
--
-- Два РАЗНЫХ уровня учёта, которые нельзя смешивать:
--
--   CASH LAYER — исходная банковская операция (таблица transactions).
--     Источник истины о движении денег: остаток счёта, фактический приток/отток,
--     сверка с банком. Считается РОВНО ОДИН РАЗ, разнесение на неё не влияет.
--
--   MANAGEMENT LAYER — это представление.
--     Источник истины об управленческой аналитике: проекты, сотрудники,
--     подрядчики/контрагенты, статьи и любые другие разрезы.
--     Правило: если у операции есть части (transaction_splits) — аналитику дают
--     ЧАСТИ, и сама операция в аналитике дополнительно не участвует; если частей
--     нет — операция даёт ровно одну строку на полную сумму.
--
-- Ключевое свойство: SUM(amount) строк одной операции ВСЕГДА равна её сумме.
--   • части есть  → Σ частей = сумме операции (гарантирует deferrable-триггер
--     transaction_splits_total_ck из миграции 0086);
--   • частей нет  → одна строка на полную сумму.
-- Поэтому двойной учёт (200 000 вместо 100 000) в этом слое невозможен
-- по построению, а не по внимательности вызывающего кода.
--
-- Трассировка: transaction_id ведёт к исходной операции, а через неё —
-- к банковскому событию (bank_event_id, миграция 0090); split_id — к части.
--
-- Безопасность: security_invoker = on, то есть RLS таблиц transactions и
-- transaction_splits применяется к ВЫЗЫВАЮЩЕМУ, а не к владельцу вью.
-- Без этого представление отдавало бы операции всех команд.
--
-- ВНИМАНИЕ: в production такое представление уже существует (создано вне
-- миграций, с security_invoker=on, приложением не использовалось). Здесь оно
-- кодифицируется и расширяется. Порядок колонок сохранён — create or replace
-- умеет только дописывать колонки в конец.
-- ============================================================

create or replace view public.transaction_lines
with (security_invoker = on) as
select
  t.id                                            as transaction_id,
  t.team_id,
  t.type,
  t.currency,
  t.status,
  t.occurred_on,
  t.accrual_date,
  t.account_id,
  coalesce(s.amount, t.amount)                    as amount,
  coalesce(s.category_id, t.category_id)          as category_id,
  coalesce(s.project_id, t.project_id)            as project_id,
  coalesce(s.counterparty_id, t.counterparty_id)  as counterparty_id,
  (s.id is not null)                              as is_split,
  coalesce(s.note, t.note)                        as note,
  -- дописанные колонки (порядок существующих выше менять нельзя)
  t.amount                                        as transaction_amount,
  t.note                                          as transaction_note,
  s.id                                            as split_id,
  t.transfer_account_id,
  t.source,
  t.created_by
from public.transactions t
left join public.transaction_splits s on s.transaction_id = t.id;

comment on view public.transaction_lines is
  'Management accounting layer: одна строка на часть операции (transaction_splits), '
  'либо одна строка на саму операцию, если частей нет. SUM(amount) по строкам '
  'операции всегда равна её сумме. Для денежного движения и остатков счетов '
  'использовать transactions/account_balances, а не это представление.';

-- Представление не обновляемое (join), но лишние права всё равно снимаем.
revoke insert, update, delete, truncate on public.transaction_lines from authenticated;
revoke insert, update, delete, truncate on public.transaction_lines from anon;
grant select on public.transaction_lines to authenticated;
