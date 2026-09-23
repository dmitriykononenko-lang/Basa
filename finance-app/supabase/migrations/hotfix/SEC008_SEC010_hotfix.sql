-- SEC-008 + SEC-010 — минимальный production hotfix ДО развёртывания PR #99.
-- Применён к production 2026-09-23. Идемпотентен.
--
-- ЧАСТЬ A — дословно ЧАСТЬ A миграции 0091 (проверенный вариант; альтернативной
-- реализации не пишем). Инвариант: не-участник → false, никогда NULL.
-- Семантика RLS не меняется: там NULL и false равнозначны, поэтому все политики
-- (110 с can_edit_finance, 3 с can_write_tx, 8 с can_manage_team) ведут себя как прежде.
--
-- ЧАСТЬ B — SEC-010: снять EXECUTE у anon и PUBLIC с двух функций, которые пишут
-- и удаляют финансовые данные. `authenticated` сохраняется: подтверждено по коду —
-- src/components/SupportPeriods.tsx:66,109 вызывает обе RPC браузерным клиентом
-- (@/lib/supabase/client), то есть непосредственно от роли authenticated.
-- После ЧАСТИ A внутренний guard `if not can_edit_finance(...)` в этих функциях
-- начинает работать и для не-участников.
--
-- Идемпотентность относительно последующего 0091:
--   * ЧАСТЬ A — create or replace, тела совпадают дословно → повторное применение no-op;
--   * ЧАСТЬ B — revoke отсутствующего гранта no-op. 0091 ЧАСТЬ B снимает те же гранты
--     с тех же двух функций и затем возвращает authenticated на support_delete_period —
--     это ровно то состояние, которое остаётся после hotfix.
--   * Известный дефект 0091 ЧАСТЬ B: сигнатуры next_document_number(uuid, text) и
--     bybit_sync_logged() не существуют (фактические — (uuid,text,text) и (integer)),
--     их revoke уходит в ветку undefined_function и молча пропускается. На SEC-008/010
--     это не влияет; SEC-009 уже закрыт отдельным hotfix, SEC-011 вынесен отдельно.

-- ЧАСТЬ A. SEC-008
create or replace function public.can_edit_finance(_team_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members
     where team_id = _team_id and user_id = auth.uid()
       and role in ('owner','admin','manager')
  )
$$;

create or replace function public.can_write_tx(_team_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members
     where team_id = _team_id and user_id = auth.uid()
       and role in ('owner','admin','manager','employee')
  )
$$;

create or replace function public.can_manage_team(_team_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members
     where team_id = _team_id and user_id = auth.uid()
       and role in ('owner','admin')
  )
$$;

-- ЧАСТЬ B. SEC-010 (сигнатуры фактические, из pg_proc)
revoke execute on function public.support_open_period(uuid, bigint, uuid, uuid) from anon, public;
revoke execute on function public.support_delete_period(uuid) from anon, public;
