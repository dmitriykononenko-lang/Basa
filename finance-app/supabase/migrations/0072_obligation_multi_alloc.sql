-- Разрешаем привязывать одну выплату-операцию к НЕСКОЛЬКИМ обязательствам.
-- Раньше уникальный индекс obligation_payments_tx_uniq(transaction_id) допускал
-- только одну привязку на операцию, из-за чего дробные/валютные выплаты сводили
-- фиктивными ручными записями (без операции). Меняем ограничение на пару
-- (transaction_id, obligation_id): операция может закрывать много обязательств,
-- но не дублируется в рамках одного обязательства.

drop index if exists public.obligation_payments_tx_uniq;

create unique index if not exists obligation_payments_tx_obl_uniq
  on public.obligation_payments(transaction_id, obligation_id)
  where transaction_id is not null;
