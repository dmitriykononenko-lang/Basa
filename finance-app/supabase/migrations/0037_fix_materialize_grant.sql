-- Закрываем анонимный доступ к materialize_auto_accruals: только авторизованные
-- (внутри функции дополнительно проверяется can_edit_finance).
revoke execute on function public.materialize_auto_accruals(uuid) from public, anon;
grant execute on function public.materialize_auto_accruals(uuid) to authenticated;
