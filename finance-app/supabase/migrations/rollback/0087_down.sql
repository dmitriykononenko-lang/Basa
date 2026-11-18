-- Откат 0087. Возвращает прежние версии функций начисления (без advisory-lock
-- и без on conflict do nothing) и снимает дискриминатор origin.
-- ВНИМАНИЕ: после отката возвращается T1 — двойное начисление ЗП при двух
-- параллельных прогонах. Тела функций взяты из production до ремедиации; если
-- за это время их меняли — сверь с pg_get_functiondef перед откатом.
begin;
drop index if exists public.obligations_auto_accrual_uniq;
alter table public.obligations drop column if exists origin;
-- Функции не восстанавливаются автоматически: их прежние тела зависят от
-- состояния production на момент применения. Порядок действий:
--   1) перед деплоем сохранить:
--      select pg_get_functiondef('public.materialize_auto_accruals(uuid)'::regprocedure);
--      select pg_get_functiondef('public.materialize_support_cycles(uuid)'::regprocedure);
--   2) при откате выполнить сохранённый текст.
-- Без шага 1 откат 0087 неполный: останутся новые тела функций, которые
-- ссылаются на obligations.origin и упадут после удаления колонки.
commit;
