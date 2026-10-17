-- ============================================================
-- 0051_academy: Академия — курсы из материалов базы знаний,
-- назначение на отдел/сотрудника, прогресс прохождения.
--
-- Переиспользуем: is_team_member, can_edit_finance (owner/admin/manager),
-- статусы курса — enum kb_article_status (draft/published/archived).
-- ============================================================

-- ---------- Enum-типы ----------
do $$ begin create type public.academy_assignee_type as enum ('department', 'user');
exception when duplicate_object then null; end $$;

do $$ begin create type public.academy_progress_status as enum ('not_started', 'in_progress', 'done');
exception when duplicate_object then null; end $$;

-- ============================================================
-- Связка «сотрудник ↔ отдел» (пользователи приложения по отделам)
-- ============================================================
create table if not exists public.kb_user_departments (
  team_id       uuid not null references public.teams (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  department_id uuid not null references public.kb_departments (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (department_id, user_id)
);
create index if not exists kb_user_departments_user_idx on public.kb_user_departments (user_id);
create index if not exists kb_user_departments_team_idx on public.kb_user_departments (team_id);

alter table public.kb_user_departments enable row level security;
drop policy if exists kb_user_departments_select on public.kb_user_departments;
create policy kb_user_departments_select on public.kb_user_departments for select
  using (public.is_team_member(team_id));
drop policy if exists kb_user_departments_cud on public.kb_user_departments;
create policy kb_user_departments_cud on public.kb_user_departments for all
  using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));

-- ============================================================
-- Курсы
-- ============================================================
create table if not exists public.academy_courses (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  status      public.kb_article_status not null default 'draft',
  title       text not null,
  description text not null default '',
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists academy_courses_team_idx on public.academy_courses (team_id);

drop trigger if exists academy_courses_touch on public.academy_courses;
create trigger academy_courses_touch before update on public.academy_courses
  for each row execute function public.kb_touch_updated_at();

alter table public.academy_courses enable row level security;
-- читать опубликованные курсы — все участники; черновики — менеджер+
drop policy if exists academy_courses_select on public.academy_courses;
create policy academy_courses_select on public.academy_courses for select
  using (public.is_team_member(team_id) and (status = 'published' or public.can_edit_finance(team_id)));
drop policy if exists academy_courses_cud on public.academy_courses;
create policy academy_courses_cud on public.academy_courses for all
  using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));

-- ============================================================
-- Элементы курса = ссылки на статьи базы знаний
-- ============================================================
create table if not exists public.academy_course_items (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  course_id   uuid not null references public.academy_courses (id) on delete cascade,
  article_id  uuid not null references public.kb_articles (id) on delete cascade,
  position    int  not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists academy_course_items_course_idx on public.academy_course_items (course_id, position);

alter table public.academy_course_items enable row level security;
drop policy if exists academy_course_items_select on public.academy_course_items;
create policy academy_course_items_select on public.academy_course_items for select
  using (public.is_team_member(team_id));
drop policy if exists academy_course_items_cud on public.academy_course_items;
create policy academy_course_items_cud on public.academy_course_items for all
  using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));

-- ============================================================
-- Назначения курса (на отдел или конкретного сотрудника)
-- ============================================================
create table if not exists public.academy_assignments (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams (id) on delete cascade,
  course_id     uuid not null references public.academy_courses (id) on delete cascade,
  assignee_type public.academy_assignee_type not null,
  department_id uuid references public.kb_departments (id) on delete cascade,
  user_id       uuid references auth.users (id) on delete cascade,
  due_date      date,
  assigned_by   uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  check (
    (assignee_type = 'department' and department_id is not null and user_id is null) or
    (assignee_type = 'user' and user_id is not null and department_id is null)
  )
);
create index if not exists academy_assignments_course_idx on public.academy_assignments (course_id);

alter table public.academy_assignments enable row level security;
-- участник видит назначения команды (свои курсы); управляет — менеджер+
drop policy if exists academy_assignments_select on public.academy_assignments;
create policy academy_assignments_select on public.academy_assignments for select
  using (public.is_team_member(team_id));
drop policy if exists academy_assignments_cud on public.academy_assignments;
create policy academy_assignments_cud on public.academy_assignments for all
  using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));

-- ============================================================
-- Прогресс прохождения (по элементам курса, на пользователя)
-- ============================================================
create table if not exists public.academy_progress (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams (id) on delete cascade,
  course_id    uuid not null references public.academy_courses (id) on delete cascade,
  item_id      uuid not null references public.academy_course_items (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  status       public.academy_progress_status not null default 'not_started',
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (item_id, user_id)
);
create index if not exists academy_progress_user_idx on public.academy_progress (user_id, course_id);
create index if not exists academy_progress_course_idx on public.academy_progress (course_id);

drop trigger if exists academy_progress_touch on public.academy_progress;
create trigger academy_progress_touch before update on public.academy_progress
  for each row execute function public.kb_touch_updated_at();

alter table public.academy_progress enable row level security;
-- свой прогресс видит сотрудник; весь прогресс команды — менеджер+
drop policy if exists academy_progress_select on public.academy_progress;
create policy academy_progress_select on public.academy_progress for select
  using (user_id = auth.uid() or public.can_edit_finance(team_id));
-- сотрудник пишет/обновляет только свои строки; менеджер — любые (сброс)
drop policy if exists academy_progress_insert on public.academy_progress;
create policy academy_progress_insert on public.academy_progress for insert
  with check ((user_id = auth.uid() and public.is_team_member(team_id)) or public.can_edit_finance(team_id));
drop policy if exists academy_progress_update on public.academy_progress;
create policy academy_progress_update on public.academy_progress for update
  using (user_id = auth.uid() or public.can_edit_finance(team_id))
  with check (user_id = auth.uid() or public.can_edit_finance(team_id));
drop policy if exists academy_progress_delete on public.academy_progress;
create policy academy_progress_delete on public.academy_progress for delete
  using (public.can_edit_finance(team_id));

-- ============================================================
-- Привязка попыток проверки к курсу (мягкое поле course_id из 0050)
-- ============================================================
do $$ begin
  alter table public.kb_quiz_attempts
    add constraint kb_quiz_attempts_course_fk
    foreign key (course_id) references public.academy_courses (id) on delete set null;
exception when duplicate_object then null; end $$;

-- ============================================================
-- Назначить курс и развернуть прогресс (одной транзакцией)
-- Возвращает id назначения. Создаёт строки academy_progress (not_started)
-- для всех целевых пользователей × элементов курса.
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

  -- целевые пользователи
  insert into public.academy_progress (team_id, course_id, item_id, user_id, status)
  select _team_id, _course_id, ci.id, u.user_id, 'not_started'
  from public.academy_course_items ci
  cross join (
    select _user_id as user_id where _assignee_type = 'user'
    union
    select ud.user_id from public.kb_user_departments ud
      where _assignee_type = 'department' and ud.department_id = _department_id
  ) u
  where ci.course_id = _course_id
  on conflict (item_id, user_id) do nothing;

  return _assignment_id;
end;
$$;
revoke execute on function public.academy_assign(uuid, public.academy_assignee_type, uuid, uuid, date) from anon;

-- ============================================================
-- Отметить элемент курса пройденным текущим пользователем.
-- Если у статьи есть вопросы — требуется ранее пройденная проверка
-- (kb_quiz_attempts.passed). Идемпотентно (upsert).
-- ============================================================
create or replace function public.academy_complete_item(_item_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  _team_id uuid;
  _course_id uuid;
  _article_id uuid;
  _has_questions boolean;
  _passed boolean;
begin
  select ci.team_id, ci.course_id, ci.article_id
    into _team_id, _course_id, _article_id
  from public.academy_course_items ci where ci.id = _item_id;
  if _team_id is null then
    raise exception 'Элемент курса не найден';
  end if;
  if not public.is_team_member(_team_id) then
    raise exception 'Нет доступа';
  end if;

  select exists (select 1 from public.kb_questions q where q.article_id = _article_id)
    into _has_questions;

  if _has_questions then
    select exists (
      select 1 from public.kb_quiz_attempts a
      where a.article_id = _article_id and a.user_id = auth.uid() and a.passed
    ) into _passed;
    if not _passed then
      raise exception 'Сначала пройдите проверку по материалу';
    end if;
  end if;

  insert into public.academy_progress (team_id, course_id, item_id, user_id, status, completed_at)
  values (_team_id, _course_id, _item_id, auth.uid(), 'done', now())
  on conflict (item_id, user_id)
  do update set status = 'done', completed_at = now();
end;
$$;
revoke execute on function public.academy_complete_item(uuid) from anon;
