-- ============================================================
-- 0011_category_attributes: атрибуты статей для ДДС и ОПиУ
-- ============================================================

-- Вид деятельности (для ДДС): операционная / инвестиционная / финансовая
do $$ begin create type public.cf_activity as enum ('operating', 'investing', 'financial');
exception when duplicate_object then null; end $$;

-- Правило учёта в ОПиУ
do $$ begin create type public.pnl_treatment as enum ('auto', 'direct', 'indirect', 'other', 'excluded');
exception when duplicate_object then null; end $$;

alter table public.categories add column if not exists cf_activity   public.cf_activity   not null default 'operating';
alter table public.categories add column if not exists pnl_treatment public.pnl_treatment not null default 'auto';
alter table public.categories add column if not exists note          text;
