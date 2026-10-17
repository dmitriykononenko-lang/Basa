-- ============================================================
-- 0082_tochka_invoice_config: параметры для выставления счетов в Точке.
--
-- customerCode — идентификатор клиента (вашей организации) в Точке, нужен для
-- invoice-API: POST /invoice/v1.0/bills и GET .../bills/{customerCode}/{documentId}/payment_status.
-- tax_system_code — код системы налогообложения (SecondSide.taxSystemCode / для счёта).
-- Хранится в подключении банка рядом с токеном.
-- ============================================================

alter table public.bank_connections
  add column if not exists customer_code text,
  add column if not exists tax_system_code integer;
