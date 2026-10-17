-- ============================================================
-- 0008_harden_functions_2: закрываем служебные SECURITY DEFINER
-- функции от PUBLIC/anon (доступ только authenticated, где нужно)
-- ============================================================

-- Фиксируем search_path у auth_email
create or replace function public.auth_email()
returns text
language sql stable
set search_path = public
as $$ select lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'email', '')); $$;

-- Триггерная функция — недоступна через API вообще
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- RLS-хелперы и RPC: убираем у PUBLIC (а значит и anon), оставляем authenticated
do $$
declare
  f text;
  sigs text[] := array[
    'public.is_team_member(uuid)',
    'public.current_team_role(uuid)',
    'public.can_edit_finance(uuid)',
    'public.can_write_tx(uuid)',
    'public.can_manage_team(uuid)',
    'public.auth_email()',
    'public.create_team(text, char)',
    'public.accept_invite(uuid)'
  ];
begin
  foreach f in array sigs loop
    execute format('revoke execute on function %s from public, anon;', f);
    execute format('grant execute on function %s to authenticated;', f);
  end loop;
end $$;
