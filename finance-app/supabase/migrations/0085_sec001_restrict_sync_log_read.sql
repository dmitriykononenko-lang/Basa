-- ============================================================
-- 0085_sec001_restrict_sync_log_read (SEC-001)
-- Убирает кросс-тенант чтение операционных логов синка: политики SELECT
-- tochka_sync_log_read / bybit_sync_log_read имели USING(true) для роли
-- authenticated — любой залогиненный видел логи всех команд (teamId + тексты
-- ошибок API в detail). RLS на таблицах остаётся включён → клиентам deny-all;
-- сервис-ключ (cron) не затрагивается (RLS его не касается), приложение эти
-- таблицы под сессией пользователя не читает (только cron пишет через admin).
-- Идемпотентно и безопасно на свежей БД (таблицы созданы вне миграций).
-- ============================================================
do $$
begin
  if to_regclass('public.tochka_sync_log') is not null then
    drop policy if exists tochka_sync_log_read on public.tochka_sync_log;
  end if;
  if to_regclass('public.bybit_sync_log') is not null then
    drop policy if exists bybit_sync_log_read on public.bybit_sync_log;
  end if;
end $$;
