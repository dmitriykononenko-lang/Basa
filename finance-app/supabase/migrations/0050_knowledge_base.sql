-- ============================================================
-- 0050_knowledge_base: База знаний — регламенты, статьи, чек-листы,
-- проверочные вопросы и попытки прохождения проверки.
--
-- Идентичность/роли переиспользуются из 0001_foundation и 0002_finance_core:
--   is_team_member(team_id)   — участник команды
--   current_team_role(team_id)— роль участника (app_role)
--   can_edit_finance(team_id) — owner/admin/manager (используем как «авторы/управление»)
--
-- Принципы доступа:
--   • Заполнять базу знаний может любой сотрудник (кроме viewer): создаёт черновики.
--   • Публиковать / править/удалять чужое — менеджер+ (can_edit_finance).
--   • Читать опубликованное — все участники команды.
--   • Правильные ответы (is_correct) НЕ видны обучаемым: вопросы выдаются и
--     проверяются через security-definer функции kb_get_quiz()/kb_submit_quiz().
-- ============================================================

-- ---------- Enum-типы ----------
do $$ begin create type public.kb_article_kind as enum ('regulation', 'article', 'checklist');
exception when duplicate_object then null; end $$;

do $$ begin create type public.kb_article_status as enum ('draft', 'published', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin create type public.kb_question_type as enum ('single', 'multiple', 'boolean');
exception when duplicate_object then null; end $$;

-- ---------- Helper: кто может наполнять базу знаний (любой, кроме viewer) ----------
create or replace function public.kb_can_contribute(_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.current_team_role(_team_id) in ('owner', 'admin', 'manager', 'employee');
$$;
revoke execute on function public.kb_can_contribute(uuid) from anon;

-- ---------- Триггер обновления updated_at ----------
create or replace function public.kb_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ============================================================
-- Справочник отделов
-- ============================================================
create table if not exists public.kb_departments (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  name        text not null,
  parent_id   uuid references public.kb_departments (id) on delete set null,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now()
);
create index if not exists kb_departments_team_idx on public.kb_departments (team_id);

alter table public.kb_departments enable row level security;
drop policy if exists kb_departments_select on public.kb_departments;
create policy kb_departments_select on public.kb_departments for select
  using (public.is_team_member(team_id));
drop policy if exists kb_departments_insert on public.kb_departments;
create policy kb_departments_insert on public.kb_departments for insert
  with check (public.can_edit_finance(team_id));
drop policy if exists kb_departments_update on public.kb_departments;
create policy kb_departments_update on public.kb_departments for update
  using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));
drop policy if exists kb_departments_delete on public.kb_departments;
create policy kb_departments_delete on public.kb_departments for delete
  using (public.can_edit_finance(team_id));

-- ============================================================
-- Статьи / регламенты / чек-листы
-- ============================================================
create table if not exists public.kb_articles (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  kind        public.kb_article_kind   not null default 'regulation',
  status      public.kb_article_status not null default 'draft',
  title       text not null,
  body        text not null default '',
  pass_score  int  not null default 80 check (pass_score between 0 and 100),
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists kb_articles_team_idx   on public.kb_articles (team_id);
create index if not exists kb_articles_status_idx on public.kb_articles (team_id, status);

drop trigger if exists kb_articles_touch on public.kb_articles;
create trigger kb_articles_touch before update on public.kb_articles
  for each row execute function public.kb_touch_updated_at();

alter table public.kb_articles enable row level security;
-- читать: опубликованное — все участники; черновики — автор и менеджер+
drop policy if exists kb_articles_select on public.kb_articles;
create policy kb_articles_select on public.kb_articles for select
  using (
    public.is_team_member(team_id)
    and (
      status = 'published'
      or created_by = auth.uid()
      or public.can_edit_finance(team_id)
    )
  );
-- создавать: любой сотрудник (кроме viewer), только от своего имени
drop policy if exists kb_articles_insert on public.kb_articles;
create policy kb_articles_insert on public.kb_articles for insert
  with check (public.kb_can_contribute(team_id) and created_by = auth.uid());
-- править: автор (своё) или менеджер+
drop policy if exists kb_articles_update on public.kb_articles;
create policy kb_articles_update on public.kb_articles for update
  using (public.can_edit_finance(team_id) or created_by = auth.uid())
  with check (public.can_edit_finance(team_id) or created_by = auth.uid());
-- удалять: автор (своё) или менеджер+
drop policy if exists kb_articles_delete on public.kb_articles;
create policy kb_articles_delete on public.kb_articles for delete
  using (public.can_edit_finance(team_id) or created_by = auth.uid());

-- ============================================================
-- Пункты чек-листа
-- ============================================================
create table if not exists public.kb_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  article_id  uuid not null references public.kb_articles (id) on delete cascade,
  content     text not null,
  position    int  not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists kb_checklist_items_article_idx on public.kb_checklist_items (article_id, position);

alter table public.kb_checklist_items enable row level security;
-- читать пункты разрешено тем, кому доступна сама статья
drop policy if exists kb_checklist_items_select on public.kb_checklist_items;
create policy kb_checklist_items_select on public.kb_checklist_items for select
  using (exists (select 1 from public.kb_articles a where a.id = article_id));
drop policy if exists kb_checklist_items_cud on public.kb_checklist_items;
create policy kb_checklist_items_cud on public.kb_checklist_items for all
  using (
    exists (
      select 1 from public.kb_articles a
      where a.id = article_id
        and (public.can_edit_finance(a.team_id) or a.created_by = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.kb_articles a
      where a.id = article_id
        and a.team_id = kb_checklist_items.team_id
        and (public.can_edit_finance(a.team_id) or a.created_by = auth.uid())
    )
  );

-- ============================================================
-- Привязка статьи к отделам / должностям (целевая аудитория)
-- ============================================================
create table if not exists public.kb_article_targets (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams (id) on delete cascade,
  article_id    uuid not null references public.kb_articles (id) on delete cascade,
  department_id uuid references public.kb_departments (id) on delete cascade,
  position      text,
  created_at    timestamptz not null default now(),
  check (department_id is not null or position is not null)
);
create index if not exists kb_article_targets_article_idx on public.kb_article_targets (article_id);

alter table public.kb_article_targets enable row level security;
drop policy if exists kb_article_targets_select on public.kb_article_targets;
create policy kb_article_targets_select on public.kb_article_targets for select
  using (public.is_team_member(team_id));
drop policy if exists kb_article_targets_cud on public.kb_article_targets;
create policy kb_article_targets_cud on public.kb_article_targets for all
  using (
    exists (
      select 1 from public.kb_articles a
      where a.id = article_id
        and (public.can_edit_finance(a.team_id) or a.created_by = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.kb_articles a
      where a.id = article_id
        and a.team_id = kb_article_targets.team_id
        and (public.can_edit_finance(a.team_id) or a.created_by = auth.uid())
    )
  );

-- ============================================================
-- Проверочные вопросы и варианты ответов
-- ВНИМАНИЕ: эти таблицы НЕ читаются рядовыми сотрудниками напрямую —
-- доступ на чтение только у авторов/менеджеров. Обучаемые получают вопросы
-- (без is_correct) через функцию kb_get_quiz().
-- ============================================================
create table if not exists public.kb_questions (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  article_id  uuid not null references public.kb_articles (id) on delete cascade,
  prompt      text not null,
  qtype       public.kb_question_type not null default 'single',
  position    int  not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists kb_questions_article_idx on public.kb_questions (article_id, position);

create table if not exists public.kb_answer_options (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  question_id uuid not null references public.kb_questions (id) on delete cascade,
  content     text not null,
  is_correct  boolean not null default false,
  position    int  not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists kb_answer_options_question_idx on public.kb_answer_options (question_id, position);

-- RLS: вопросы и варианты видят/правят только авторы статьи и менеджеры
alter table public.kb_questions enable row level security;
drop policy if exists kb_questions_authors on public.kb_questions;
create policy kb_questions_authors on public.kb_questions for all
  using (
    exists (
      select 1 from public.kb_articles a
      where a.id = article_id
        and (public.can_edit_finance(a.team_id) or a.created_by = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.kb_articles a
      where a.id = article_id
        and a.team_id = kb_questions.team_id
        and (public.can_edit_finance(a.team_id) or a.created_by = auth.uid())
    )
  );

alter table public.kb_answer_options enable row level security;
drop policy if exists kb_answer_options_authors on public.kb_answer_options;
create policy kb_answer_options_authors on public.kb_answer_options for all
  using (
    exists (
      select 1 from public.kb_questions q
      join public.kb_articles a on a.id = q.article_id
      where q.id = question_id
        and (public.can_edit_finance(a.team_id) or a.created_by = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.kb_questions q
      join public.kb_articles a on a.id = q.article_id
      where q.id = question_id
        and q.team_id = kb_answer_options.team_id
        and (public.can_edit_finance(a.team_id) or a.created_by = auth.uid())
    )
  );

-- ============================================================
-- Попытки прохождения проверки и ответы
-- ============================================================
create table if not exists public.kb_quiz_attempts (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  article_id  uuid not null references public.kb_articles (id) on delete cascade,
  course_id   uuid,  -- FK добавляется в 0051_academy (мягкая связь до создания таблицы курсов)
  user_id     uuid not null references auth.users (id) on delete cascade,
  score       int  not null default 0 check (score between 0 and 100),
  passed      boolean not null default false,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists kb_quiz_attempts_user_idx    on public.kb_quiz_attempts (user_id, article_id);
create index if not exists kb_quiz_attempts_article_idx on public.kb_quiz_attempts (article_id);

create table if not exists public.kb_quiz_answers (
  id                 uuid primary key default gen_random_uuid(),
  attempt_id         uuid not null references public.kb_quiz_attempts (id) on delete cascade,
  question_id        uuid not null references public.kb_questions (id) on delete cascade,
  selected_option_ids uuid[] not null default '{}',
  created_at         timestamptz not null default now()
);
create index if not exists kb_quiz_answers_attempt_idx on public.kb_quiz_answers (attempt_id);

alter table public.kb_quiz_attempts enable row level security;
-- свои попытки видит сотрудник; все попытки команды — менеджер+
drop policy if exists kb_quiz_attempts_select on public.kb_quiz_attempts;
create policy kb_quiz_attempts_select on public.kb_quiz_attempts for select
  using (user_id = auth.uid() or public.can_edit_finance(team_id));
-- запись попыток — только через kb_submit_quiz() (security definer); прямой доступ закрыт
drop policy if exists kb_quiz_attempts_no_direct_write on public.kb_quiz_attempts;
create policy kb_quiz_attempts_no_direct_write on public.kb_quiz_attempts for insert
  with check (false);

alter table public.kb_quiz_answers enable row level security;
drop policy if exists kb_quiz_answers_select on public.kb_quiz_answers;
create policy kb_quiz_answers_select on public.kb_quiz_answers for select
  using (
    exists (
      select 1 from public.kb_quiz_attempts t
      where t.id = attempt_id
        and (t.user_id = auth.uid() or public.can_edit_finance(t.team_id))
    )
  );

-- ============================================================
-- Функция выдачи вопросов обучаемому (без правильных ответов)
-- ============================================================
create or replace function public.kb_get_quiz(_article_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  _team_id uuid;
  _result  jsonb;
begin
  select team_id into _team_id from public.kb_articles where id = _article_id;
  if _team_id is null then
    raise exception 'Статья не найдена';
  end if;
  if not public.is_team_member(_team_id) then
    raise exception 'Нет доступа';
  end if;

  select coalesce(jsonb_agg(q order by q.position), '[]'::jsonb) into _result
  from (
    select
      ques.id,
      ques.prompt,
      ques.qtype,
      ques.position,
      coalesce((
        select jsonb_agg(jsonb_build_object('id', o.id, 'content', o.content)
                         order by o.position)
        from public.kb_answer_options o
        where o.question_id = ques.id
      ), '[]'::jsonb) as options
    from public.kb_questions ques
    where ques.article_id = _article_id
  ) q;

  return _result;
end;
$$;
revoke execute on function public.kb_get_quiz(uuid) from anon;

-- ============================================================
-- Функция приёма и оценки проверки
-- _answers: [{"question_id": "...", "selected_option_ids": ["...","..."]}, ...]
-- ============================================================
create or replace function public.kb_submit_quiz(
  _article_id uuid,
  _answers    jsonb,
  _course_id  uuid default null
)
returns public.kb_quiz_attempts
language plpgsql security definer set search_path = public
as $$
declare
  _team_id    uuid;
  _pass_score int;
  _total      int := 0;
  _correct    int := 0;
  _score      int := 0;
  _attempt    public.kb_quiz_attempts;
  _ans        jsonb;
  _q          public.kb_questions;
  _selected   uuid[];
  _correct_ids uuid[];
  _is_right   boolean;
begin
  select team_id, pass_score into _team_id, _pass_score
  from public.kb_articles where id = _article_id;
  if _team_id is null then
    raise exception 'Статья не найдена';
  end if;
  if not public.is_team_member(_team_id) then
    raise exception 'Нет доступа';
  end if;

  -- создаём попытку
  insert into public.kb_quiz_attempts (team_id, article_id, course_id, user_id, started_at)
  values (_team_id, _article_id, _course_id, auth.uid(), now())
  returning * into _attempt;

  -- оцениваем по всем вопросам статьи
  for _q in select * from public.kb_questions where article_id = _article_id loop
    _total := _total + 1;

    -- выбранные пользователем варианты по этому вопросу
    _selected := '{}';
    for _ans in select * from jsonb_array_elements(coalesce(_answers, '[]'::jsonb)) loop
      if (_ans ->> 'question_id')::uuid = _q.id then
        select array_agg((v)::uuid) into _selected
        from jsonb_array_elements_text(coalesce(_ans -> 'selected_option_ids', '[]'::jsonb)) v;
        _selected := coalesce(_selected, '{}');
      end if;
    end loop;

    -- правильные варианты
    select coalesce(array_agg(id), '{}') into _correct_ids
    from public.kb_answer_options where question_id = _q.id and is_correct;

    -- вопрос засчитан, если множества выбранных и правильных совпадают
    _is_right := (
      coalesce(array_length(_selected, 1), 0) = coalesce(array_length(_correct_ids, 1), 0)
      and not exists (select unnest(_selected) except select unnest(_correct_ids))
      and not exists (select unnest(_correct_ids) except select unnest(_selected))
    );
    if _is_right then
      _correct := _correct + 1;
    end if;

    -- сохраняем ответ
    insert into public.kb_quiz_answers (attempt_id, question_id, selected_option_ids)
    values (_attempt.id, _q.id, _selected);
  end loop;

  if _total > 0 then
    _score := round(100.0 * _correct / _total);
  end if;

  update public.kb_quiz_attempts
     set score = _score,
         passed = (_score >= _pass_score),
         finished_at = now()
   where id = _attempt.id
   returning * into _attempt;

  return _attempt;
end;
$$;
revoke execute on function public.kb_submit_quiz(uuid, jsonb, uuid) from anon;
