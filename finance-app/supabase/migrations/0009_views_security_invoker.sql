-- ============================================================
-- 0009_views_security_invoker: представления балансов соблюдают
-- RLS вызывающего пользователя (убирает ERROR security_definer_view)
-- ============================================================

alter view public.account_balances    set (security_invoker = on);
alter view public.obligation_balances  set (security_invoker = on);
