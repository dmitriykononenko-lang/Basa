-- ============================================================
-- 0081_invoice_paid_link: связь инвойса с оплатившей операцией.
--
-- Авто-статус «оплачен» по факту прихода: реконсиляция сопоставляет входящую
-- операцию (из выписки Точки/BMI) с открытым инвойсом по сумме + плательщику,
-- и фиксирует ссылку, чтобы один платёж не закрыл два инвойса.
-- ============================================================

alter table public.invoices
  add column if not exists paid_transaction_id uuid references public.transactions (id) on delete set null;

create index if not exists invoices_paid_tx_idx on public.invoices (paid_transaction_id);
