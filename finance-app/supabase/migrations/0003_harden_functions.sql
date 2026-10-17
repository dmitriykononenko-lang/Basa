-- ============================================================
-- 0003_harden_functions: закрываем прямой вызов служебных
-- SECURITY DEFINER функций для роли anon (используются только в RLS)
-- ============================================================

-- Триггерная функция — не должна вызываться через API вообще
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- RLS-хелперы и create_team — недоступны для неавторизованных (anon)
revoke execute on function public.is_team_member(uuid)       from anon;
revoke execute on function public.current_team_role(uuid)    from anon;
revoke execute on function public.can_edit_finance(uuid)     from anon;
revoke execute on function public.can_write_tx(uuid)         from anon;
revoke execute on function public.create_team(text, char)    from anon;
