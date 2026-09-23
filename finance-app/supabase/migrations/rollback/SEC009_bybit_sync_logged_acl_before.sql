-- SEC-009 rollback artifact — снято с production 2026-09-23 перед REVOKE.
-- Источник: pg_proc.proacl функции public.bybit_sync_logged(integer).
--
-- Фактический ACL ДО изменения (не предположение, дословно из каталога):
--   {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--
-- Прочие атрибуты функции (изменению не подлежат и не менялись):
--   owner            = postgres
--   security_definer = true
--   language         = plpgsql, volatility = volatile, leakproof = false
--   proconfig        = {search_path=public, extensions}
--
-- Выполненное изменение:
--   revoke execute on function public.bybit_sync_logged(integer) from anon, authenticated, public;
--
-- ACL ПОСЛЕ изменения:
--   {postgres=X/postgres,service_role=X/postgres}
--
-- ВОССТАНОВЛЕНИЕ строго исходного состояния. Выполнять от роли postgres —
-- она и владелец функции, и грантор всех исходных записей (суффикс `/postgres`),
-- поэтому ACL восстановится байт-в-байт.
--
-- ВНИМАНИЕ: восстанавливать этот ACL целиком НЕ следует. Записи anon и PUBLIC —
-- и есть уязвимость SEC-009: функция SECURITY DEFINER, публикуемая PostgREST как
-- POST /rest/v1/rpc/bybit_sync_logged, читает ключи Bybit из vault и пишет в
-- public.transactions мимо RLS. Файл существует как честный артефакт отката,
-- а не как рекомендация.

grant execute on function public.bybit_sync_logged(integer) to public;
grant execute on function public.bybit_sync_logged(integer) to anon;
grant execute on function public.bybit_sync_logged(integer) to authenticated;
