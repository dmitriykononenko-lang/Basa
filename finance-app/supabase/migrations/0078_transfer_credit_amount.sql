-- ============================================================
-- 0078_transfer_credit_amount: кросс-валютные переводы (расход + приход).
--
-- Перевод — одна строка transactions (type='transfer'): amount/currency — сумма
-- СПИСАНИЯ со счёта account_id. Раньше счёт зачисления кредитовался тем же
-- числом, что ломало перевод между счетами в разных валютах (наличные RUB →
-- крипта USDT). Теперь можно указать отдельную сумму ЗАЧИСЛЕНИЯ.
--
-- transfer_amount/transfer_currency — сумма и валюта прихода на transfer_account_id.
-- Если не заданы (перевод внутри одной валюты) — приход равен списанию (обратная
-- совместимость со всеми существующими переводами).
-- ============================================================

alter table public.transactions
  add column if not exists transfer_amount   bigint,
  add column if not exists transfer_currency varchar(8);

-- Пересчёт остатков по счетам: счёт зачисления получает сумму прихода.
create or replace view public.account_balances as
  select
    a.id AS account_id,
    a.team_id,
    a.currency,
    (a.opening_balance::numeric + coalesce(sum(
        case
            when t.status is distinct from 'actual'::text then 0::bigint
            when t.type = 'income'::tx_type   and t.account_id = a.id          then t.amount
            when t.type = 'expense'::tx_type  and t.account_id = a.id          then - t.amount
            when t.type = 'transfer'::tx_type and t.account_id = a.id          then - t.amount
            when t.type = 'transfer'::tx_type and t.transfer_account_id = a.id then coalesce(t.transfer_amount, t.amount)
            else 0::bigint
        end), 0::numeric))::bigint AS balance
  from accounts a
    left join transactions t on t.account_id = a.id or t.transfer_account_id = a.id
  where is_team_member(a.team_id) and can_view_resource(a.team_id, 'balances'::text)
  group by a.id, a.team_id, a.currency, a.opening_balance;
