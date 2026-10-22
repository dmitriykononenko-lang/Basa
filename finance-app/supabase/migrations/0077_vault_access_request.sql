-- ============================================================
-- 0077_vault_access_request: кнопка «Запросить доступ» на закрытых паролях.
--
-- Сотрудник, у которого нет доступа к паролю, может запросить его. Владельцам и
-- админам команды приходит in-app уведомление (колокольчик). Повторный запрос
-- не плодит дубли — обновляет существующее уведомление (снимает «прочитано»).
-- ============================================================

-- Разрешаем новый тип уведомления.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'cash_gap','debt_overdue','budget_over','transfer_short',
    'training_due','metric_missing','metric_below_plan',
    'vault_access_request'
  ));

-- ============================================================
-- Запрос доступа к паролю. Возвращает число оповещённых получателей.
-- ============================================================
create or replace function public.vault_request_access(_entry_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  _team_id uuid;
  _title   text;
  _who     text;
  _cnt     integer := 0;
begin
  select team_id, title into _team_id, _title
  from public.vault_entries where id = _entry_id;
  if _team_id is null then
    raise exception 'Запись не найдена';
  end if;
  if not public.is_team_member(_team_id) then
    raise exception 'Нет доступа';
  end if;

  select coalesce(nullif(trim(p.full_name), ''), 'Сотрудник') into _who
  from public.profiles p where p.id = auth.uid();
  _who := coalesce(_who, 'Сотрудник');

  insert into public.notifications (team_id, user_id, type, severity, title, body, link, dedupe_key)
  select
    _team_id, tm.user_id, 'vault_access_request', 'info',
    'Запрос доступа к паролю',
    _who || ' просит доступ к «' || _title || '»',
    '/vault',
    'vault_request:' || _entry_id::text || ':' || auth.uid()::text
  from public.team_members tm
  where tm.team_id = _team_id
    and tm.role in ('owner', 'admin')
    and tm.user_id <> auth.uid()
  on conflict (user_id, dedupe_key)
  do update set read_at = null, created_at = now(), body = excluded.body;

  get diagnostics _cnt = row_count;
  return _cnt;
end;
$$;
revoke execute on function public.vault_request_access(uuid) from anon;
