-- ============================================================
-- 0084_employee_product_functions: карточка должности сотрудника.
-- product_text — продукт (ЦКП), что сотрудник производит.
-- functions_text — функции (по строкам/запятым), показываются тегами.
-- ============================================================

alter table public.counterparties
  add column if not exists product_text text,
  add column if not exists functions_text text;

comment on column public.counterparties.product_text is 'Продукт (ЦКП) сотрудника — что он производит.';
comment on column public.counterparties.functions_text is 'Функции сотрудника (по строкам/запятым) — теги в карточке должности.';
