-- ============================================================
-- 0028_obligation_category: статья у обязательства (для ОПиУ по методу начисления)
-- ============================================================
-- Позволяет относить начисленные обязательства (в т.ч. неоплаченные) к статье ОПиУ.

alter table public.obligations
  add column if not exists category_id uuid references public.categories (id) on delete set null;
