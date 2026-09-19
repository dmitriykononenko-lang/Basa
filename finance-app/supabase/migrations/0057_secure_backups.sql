-- 0057_secure_backups.sql
-- Закрытие security-дыры: backup/audit-таблицы (_audit_*, _bak_*, _mrgbak_*) в схеме public
-- были созданы с ВЫКЛЮЧЕННЫМ RLS, то есть читались/писались по публичному anon-ключу.
-- Включаем RLS БЕЗ политик: anon/authenticated теряют доступ к этим таблицам,
-- а service_role (обслуживание/миграции) продолжает работать в обход RLS.
-- Данные не трогаем (не дропаем) — только закрываем доступ.

do $$
declare
  t record;
begin
  for t in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and rowsecurity = false
      and (
        tablename like '\_audit\_%'  escape '\'
        or tablename like '\_bak\_%'    escape '\'
        or tablename like '\_mrgbak\_%' escape '\'
      )
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;
