-- ============================================================
-- 0015_employee_payment: платёжные реквизиты сотрудников
-- ============================================================

alter table public.employees add column if not exists payment_method text not null default 'bank'; -- bank | crypto
alter table public.employees add column if not exists legal_status   text;   -- самозанятый | ИП | физлицо | ООО
alter table public.employees add column if not exists payee_name     text;   -- ФИО/наименование получателя
alter table public.employees add column if not exists inn            text;
alter table public.employees add column if not exists bank_account   text;   -- Р/С
alter table public.employees add column if not exists bank_name      text;
alter table public.employees add column if not exists bik            text;
alter table public.employees add column if not exists wallet_address text;
alter table public.employees add column if not exists wallet_network text;   -- TRC20 | ERC20 | ...
