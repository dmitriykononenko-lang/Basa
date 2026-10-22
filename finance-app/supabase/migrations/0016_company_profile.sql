-- ============================================================
-- 0016_company_profile: реквизиты компании на команде
-- ============================================================

alter table public.teams add column if not exists legal_name text;
alter table public.teams add column if not exists inn        text;
alter table public.teams add column if not exists kpp        text;
alter table public.teams add column if not exists ogrn       text;
alter table public.teams add column if not exists address    text;
