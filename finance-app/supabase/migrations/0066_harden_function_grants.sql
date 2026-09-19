-- ============================================================
-- 0066_harden_function_grants: сузить доступ к SECURITY DEFINER-функциям.
--
-- Причина: у функций EXECUTE по умолчанию выдан роли PUBLIC (в неё входит anon),
-- поэтому прежние `revoke ... from anon` не закрывали доступ. Снимаем EXECUTE с
-- PUBLIC и явно возвращаем только тем ролям, кому он реально нужен.
--
-- НЕ трогаем RLS-хелперы (is_team_member, can_edit_finance, can_manage_team,
-- can_write_tx, current_team_role): они вызываются внутри RLS-политик и обязаны
-- быть исполняемы вызывающей ролью — иначе доступ к данным сломается.
-- НЕ трогаем финансовое ядро (вью account_balances) — отдельно и осторожно.
-- ============================================================

-- 1) Триггерные функции: как RPC не вызываются никогда. Триггеры срабатывают
--    без проверки EXECUTE, поэтому снятие гранта их работу не ломает.
revoke execute on function public.log_transaction_change() from public;
revoke execute on function public.trg_project_bonus() from public;
revoke execute on function public.vault_log_entry_change() from public;
revoke execute on function public.vault_log_grant_change() from public;

-- 2) Только для крона (service_role): пере-выдача обучения.
revoke execute on function public.academy_reissue(uuid) from public;
grant execute on function public.academy_reissue(uuid) to service_role;

-- 3) Прикладные RPC: доступны только залогиненным (authenticated) и бэкенду
--    (service_role); anon исключаем. У всех внутри уже есть проверки прав.
do $$
declare
  fn text;
  sigs text[] := array[
    'public.academy_assign(uuid, public.academy_assignee_type, uuid, uuid, date, integer)',
    'public.academy_complete_item(uuid)',
    'public.kb_get_quiz(uuid)',
    'public.kb_submit_quiz(uuid, jsonb, uuid)',
    'public.kb_can_contribute(uuid)',
    'public.accept_invite(uuid)',
    'public.create_team(text, character)',
    'public.merge_counterparties(uuid, uuid)',
    'public.materialize_auto_accruals(uuid)',
    'public.vault_can_reveal(uuid)',
    'public.vault_log_reveal(uuid)'
  ];
begin
  foreach fn in array sigs loop
    execute format('revoke execute on function %s from public', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;

notify pgrst, 'reload schema';
