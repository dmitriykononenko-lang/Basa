-- Откат 0086. Снимает ограничения целостности.
-- ВНИМАНИЕ: после отката возвращаются T2/T4/T5/CONC-08 — инвойс может
-- расходиться с позициями, обязательство переплачиваться, номер дублироваться.
begin;
drop trigger if exists obligation_payments_cap_ck on public.obligation_payments;
drop function if exists public.assert_obligation_not_overpaid();
drop trigger if exists transaction_splits_total_ck on public.transaction_splits;
drop function if exists public.assert_splits_total();
drop trigger if exists invoices_total_ck on public.invoices;
drop function if exists public.assert_invoice_total_matches_items();
drop trigger if exists invoice_items_total_ck on public.invoice_items;
drop function if exists public.assert_invoice_items_total();
drop trigger if exists invoice_items_recalc on public.invoice_items;
drop function if exists public.trg_invoice_items_recalc();
drop function if exists public.invoice_recalc_totals(uuid);
drop index if exists public.invoices_team_number_uniq;
commit;
