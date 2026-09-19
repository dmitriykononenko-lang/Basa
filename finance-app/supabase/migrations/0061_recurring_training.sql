-- ============================================================
-- 0061_recurring_training: повторное обучение / ресертификация.
--
-- academy_assignments получает периодичность: recur_months (0 = разово; 1/3/12 —
-- ежемесячно/квартал/год) и last_issued_on (когда цикл был выдан в последний раз).
-- Крон /api/cron/recurring находит назначения, у которых пора начать новый цикл,
-- и вызывает academy_reissue(): пере-разворачивает курс на актуальный состав
-- (как academy_assign), сбрасывает прогресс назначенных в not_started, ставит новый
-- срок и обновляет last_issued_on. Уведомление «пройти заново» прилетит обычным
-- крон-механизмом уведомлений (training_due) после сброса прогресса.
-- ============================================================

alter table public.academy_assignments
  add column if not exists recur_months int not null default 0,
  add column if not exists last_issued_on date;

-- Базовая точка отсчёта для уже существующих назначений.
update public.academy_assignments set last_issued_on = created_at::date where last_issued_on is null;

-- Пере-выдача одного назначения (вызывается кроном под service_role).
create or replace function public.academy_reissue(_assignment_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  _a public.academy_assignments;
begin
  select * into _a from public.academy_assignments where id = _assignment_id;
  if _a.id is null or coalesce(_a.recur_months, 0) = 0 then
    return;
  end if;

  -- Сброс/выдача прогресса актуальному составу обучаемых (тот же разворот, что в academy_assign 0055).
  insert into public.academy_progress (team_id, course_id, item_id, user_id, status)
  select _a.team_id, _a.course_id, ci.id, u.user_id, 'not_started'
  from public.academy_course_items ci
  cross join (
    select _a.user_id as user_id where _a.assignee_type = 'user'
    union
    select c.user_id
    from public.counterparties c
    where _a.assignee_type = 'department'
      and c.team_id = _a.team_id
      and c.user_id is not null
      and c.archived = false
      and c.kinds @> array['employee']
      and c.unit_id in (
        with recursive sub as (
          select id from public.kb_departments where id = _a.department_id and team_id = _a.team_id
          union all
          select d.id from public.kb_departments d join sub s on d.parent_id = s.id
        )
        select id from sub
      )
  ) u
  where ci.course_id = _a.course_id and u.user_id is not null
  on conflict (item_id, user_id) do update set status = 'not_started', completed_at = null;

  -- Новый цикл: следующий срок и отметка выдачи.
  update public.academy_assignments
  set last_issued_on = current_date,
      due_date = (current_date + (_a.recur_months * interval '1 month'))::date
  where id = _assignment_id;
end;
$$;
revoke execute on function public.academy_reissue(uuid) from anon, authenticated;

-- Расширяем academy_assign параметром периодичности (обратносовместимо: default 0).
drop function if exists public.academy_assign(uuid, academy_assignee_type, uuid, uuid, date);
create or replace function public.academy_assign(
  _course_id uuid,
  _assignee_type academy_assignee_type,
  _department_id uuid default null,
  _user_id uuid default null,
  _due_date date default null,
  _recur_months int default 0
)
returns uuid
language plpgsql security definer set search_path = public
as $function$
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

  insert into public.academy_assignments (team_id, course_id, assignee_type, department_id, user_id, due_date, assigned_by, recur_months, last_issued_on)
  values (_team_id, _course_id, _assignee_type, _department_id, _user_id, _due_date, auth.uid(), greatest(coalesce(_recur_months, 0), 0), current_date)
  returning id into _assignment_id;

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
$function$;
revoke execute on function public.academy_assign(uuid, academy_assignee_type, uuid, uuid, date, int) from anon;
