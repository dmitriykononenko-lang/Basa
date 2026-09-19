-- ============================================================
-- 0067_lock_trigger_functions: снять EXECUTE с триггерных функций.
--
-- У них были явные гранты anon/authenticated (помимо PUBLIC), поэтому
-- 0066 (revoke from public) их не закрыл. Триггеры срабатывают без проверки
-- EXECUTE, так что снятие всех грантов безопасно и убирает их из REST-API.
-- ============================================================

revoke execute on function public.log_transaction_change() from anon, authenticated;
revoke execute on function public.trg_project_bonus() from anon, authenticated;
revoke execute on function public.vault_log_entry_change() from anon, authenticated;
revoke execute on function public.vault_log_grant_change() from anon, authenticated;

notify pgrst, 'reload schema';
