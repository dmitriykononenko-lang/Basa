-- ============================================================
-- 0010_counterparty_details: реквизиты и контакты контрагента
-- ============================================================

alter table public.counterparties add column if not exists inn            text;
alter table public.counterparties add column if not exists kpp            text;
alter table public.counterparties add column if not exists contact_person text;
alter table public.counterparties add column if not exists phone          text;
alter table public.counterparties add column if not exists email          text;
