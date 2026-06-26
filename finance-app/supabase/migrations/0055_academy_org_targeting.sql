-- ============================================================
-- 0055_academy_org_targeting: назначение курса «на отдел» работает по
-- оргструктуре (узел = поддерево), а обучаемые = сотрудники-с-доступом.
--
-- Раньше «отдел» = таблица kb_user_departments (ручное членство user↔department).
-- Теперь сотрудник = counterparties (kinds @> {employee}, archived=false), его
-- узел = counterparties.unit_id (узел kb_departments), а «доступ» =
-- counterparties.user_id (связь с auth.users). Назначение «department» к узлу D
-- разворачивается на сотрудников-с-доступом, чей unit_id лежит в поддереве D.
--
-- kb_user_departments НЕ удаляется (оставлен как deprecated, без чтения/записи).
-- Сигнатура academy_assign и enum academy_assignee_type не меняются — меняется
-- только семантика _department_id (теперь это узел оргструктуры).
-- ============================================================

create or replace function public.academy_assign(
  _course_id     uuid,
  _assignee_type public.academy_assignee_type,
  _department_id uuid default null,
  _user_id       uuid default null,
  _due_date      date default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  _team_id uuid;
  _assignment_id uuid;
begin
  select team_id into _team_id from public.academy_courses where id = _course_id;
  if _team_id is null then
    raise exception 'Курс не найден';
  end if;
  if not public.can_edit_finance(_team_id) then
    raise exception 'Недостаточно прав';
  end if;

  insert into public.academy_assignments (team_id, course_id, assignee_type, department_id, user_id, due_date, assigned_by)
  values (_team_id, _course_id, _assignee_type, _department_id, _user_id, _due_date, auth.uid())
  returning id into _assignment_id;

  -- целевые пользователи:
  --   user       — конкретная учётка;
  --   department — сотрудники-с-доступом, чей узел (unit_id) входит в поддерево _department_id.
  insert into public.academy_progress (team_id, course_id, item_id, user_id, status)
  select _team_id, _course_id, ci.id, u.user_id, 'not_started'
  from public.academy_course_items ci
  cross join (
    select _user_id as user_id where _assignee_type = 'user'
    union
    select c.user_id
    from public.counterparties c
    where _assignee_type = 'department'
      and c.team_id = _team_id
      and c.user_id is not null
      and c.archived = false
      and c.kinds @> array['employee']
      and c.unit_id in (
        with recursive sub as (
          select id from public.kb_departments where id = _department_id and team_id = _team_id
          union all
          select d.id from public.kb_departments d join sub s on d.parent_id = s.id
        )
        select id from sub
      )
  ) u
  where ci.course_id = _course_id and u.user_id is not null
  on conflict (item_id, user_id) do nothing;

  return _assignment_id;
end;
$$;
revoke execute on function public.academy_assign(uuid, public.academy_assignee_type, uuid, uuid, date) from anon;

comment on table public.kb_user_departments is
  'DEPRECATED (0055): членство учёток в отделах больше не используется обучением. '
  'Обучаемые отдела = counterparties с unit_id в поддереве и непустым user_id.';
