-- SEC-008 / SEC-010 rollback artifact — снято с production 2026-09-23 перед hotfix.
-- Источник: pg_get_functiondef() и pg_proc.proacl. Восстанавливает состояние ДО hotfix.
--
-- ВНИМАНИЕ: восстановление возвращает уязвимости SEC-008 и SEC-010.
-- Файл существует как честный артефакт отката, а не как рекомендация.
--
-- Фактический ACL ДО hotfix:
--   can_edit_finance(uuid)                        {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   can_write_tx(uuid)                            {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   can_manage_team(uuid)                         {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   support_open_period(uuid,bigint,uuid,uuid)    {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   support_delete_period(uuid)                   {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- ACL хелперов hotfix не меняет: CREATE OR REPLACE сохраняет привилегии.
-- Выполнять от роли postgres — она владелец и грантор всех исходных записей.

-- ЧАСТЬ A. Тела хелперов ДО hotfix (семантика NULL для не-участника).
CREATE OR REPLACE FUNCTION public.can_edit_finance(_team_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ select public.current_team_role(_team_id) in ('owner', 'admin', 'manager'); $function$;

CREATE OR REPLACE FUNCTION public.can_write_tx(_team_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ select public.current_team_role(_team_id) in ('owner', 'admin', 'manager', 'employee'); $function$;

CREATE OR REPLACE FUNCTION public.can_manage_team(_team_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ select public.current_team_role(_team_id) in ('owner', 'admin'); $function$;

-- ЧАСТЬ B. Гранты ДО hotfix для support_*.
grant execute on function public.support_open_period(uuid, bigint, uuid, uuid) to public;
grant execute on function public.support_open_period(uuid, bigint, uuid, uuid) to anon;
grant execute on function public.support_delete_period(uuid) to public;
grant execute on function public.support_delete_period(uuid) to anon;
