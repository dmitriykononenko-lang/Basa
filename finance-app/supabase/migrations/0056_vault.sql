-- ============================================================
-- 0056_vault: парольница «Пароли» — зашифрованное хранение паролей с
-- контролируемой выдачей доступа и неизменяемым аудитом.
--
-- Доступ выдаётся пользователю (subject_type='user') либо узлу оргструктуры
-- (subject_type='unit', kb_departments) — grant на узел покрывает узел и всё его
-- поддерево (это и есть «отдел/должность» одним механизмом, как в academy 0055).
-- Секрет шифруется на сервере ключом VAULT_KEY (в БД лежит только шифртекст).
--
-- Право «Показать» (vault_can_reveal): владелец/админ команды, автор записи,
-- прямой grant пользователю или grant на узел, покрывающий узел сотрудника.
-- Создавать/править записи — менеджер+ (can_edit_finance); выдавать/снимать
-- доступ — владелец/админ (can_manage_team). Лог пишут только триггеры/функции.
-- ============================================================

-- ---- Записи ----
create table if not exists public.vault_entries (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams (id) on delete cascade,
  title         text not null,
  login         text not null default '',
  url           text not null default '',
  note          text not null default '',
  secret_cipher text,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists vault_entries_team_idx on public.vault_entries (team_id);

drop trigger if exists vault_entries_touch on public.vault_entries;
create trigger vault_entries_touch before update on public.vault_entries
  for each row execute function public.kb_touch_updated_at();

-- ---- Выдачи доступа ----
create table if not exists public.vault_grants (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams (id) on delete cascade,
  entry_id     uuid not null references public.vault_entries (id) on delete cascade,
  subject_type text not null check (subject_type in ('user','unit')),
  user_id      uuid references auth.users (id) on delete cascade,
  unit_id      uuid references public.kb_departments (id) on delete cascade,
  granted_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  check (
    (subject_type = 'user' and user_id is not null and unit_id is null) or
    (subject_type = 'unit' and unit_id is not null and user_id is null)
  )
);
create index if not exists vault_grants_entry_idx on public.vault_grants (entry_id);
create unique index if not exists vault_grants_entry_user_uniq
  on public.vault_grants (entry_id, user_id) where user_id is not null;
create unique index if not exists vault_grants_entry_unit_uniq
  on public.vault_grants (entry_id, unit_id) where unit_id is not null;

-- ---- Аудит (неизменяемый) ----
create table if not exists public.vault_access_log (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  entry_id   uuid references public.vault_entries (id) on delete set null,
  user_id    uuid references auth.users (id) on delete set null,
  action     text not null check (action in ('reveal','create','update','delete','grant','revoke')),
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists vault_access_log_entry_idx on public.vault_access_log (entry_id, created_at desc);
create index if not exists vault_access_log_team_idx on public.vault_access_log (team_id, created_at desc);

-- ============================================================
-- Может ли текущий пользователь раскрыть (расшифровать) запись.
-- ============================================================
create or replace function public.vault_can_reveal(_entry_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.vault_entries e
    where e.id = _entry_id
      and (
        public.can_manage_team(e.team_id)
        or e.created_by = auth.uid()
        or exists (
          select 1 from public.vault_grants g
          where g.entry_id = e.id and g.subject_type = 'user' and g.user_id = auth.uid()
        )
        or exists (
          -- grant на узел, поддерево которого содержит узел сотрудника текущего пользователя
          select 1
          from public.vault_grants g
          join public.counterparties c
            on c.team_id = e.team_id
           and c.user_id = auth.uid()
           and c.archived = false
           and c.kinds @> array['employee']
           and c.unit_id is not null
          where g.entry_id = e.id and g.subject_type = 'unit'
            and c.unit_id in (
              with recursive sub as (
                select id from public.kb_departments where id = g.unit_id
                union all
                select d.id from public.kb_departments d join sub s on d.parent_id = s.id
              )
              select id from sub
            )
        )
      )
  );
$$;
revoke execute on function public.vault_can_reveal(uuid) from anon;

-- ============================================================
-- Журналирование показа пароля (вызывается reveal-роутом).
-- ============================================================
create or replace function public.vault_log_reveal(_entry_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  _team_id uuid;
begin
  select team_id into _team_id from public.vault_entries where id = _entry_id;
  if _team_id is null then
    raise exception 'Запись не найдена';
  end if;
  if not public.is_team_member(_team_id) or not public.vault_can_reveal(_entry_id) then
    raise exception 'Нет доступа';
  end if;
  insert into public.vault_access_log (team_id, entry_id, user_id, action)
  values (_team_id, _entry_id, auth.uid(), 'reveal');
end;
$$;
revoke execute on function public.vault_log_reveal(uuid) from anon;

-- ============================================================
-- Триггеры аудита для записей и выдач доступа (security definer).
-- ============================================================
create or replace function public.vault_log_entry_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.vault_access_log (team_id, entry_id, user_id, action, details)
    values (new.team_id, new.id, auth.uid(), 'create', jsonb_build_object('title', new.title));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.vault_access_log (team_id, entry_id, user_id, action, details)
    values (new.team_id, new.id, auth.uid(), 'update',
            jsonb_build_object('title', new.title,
                               'secret_changed', new.secret_cipher is distinct from old.secret_cipher));
    return new;
  else
    insert into public.vault_access_log (team_id, entry_id, user_id, action, details)
    values (old.team_id, null, auth.uid(), 'delete', jsonb_build_object('title', old.title));
    return old;
  end if;
end;
$$;

drop trigger if exists trg_vault_log_entry on public.vault_entries;
create trigger trg_vault_log_entry
  after insert or update or delete on public.vault_entries
  for each row execute function public.vault_log_entry_change();

create or replace function public.vault_log_grant_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.vault_access_log (team_id, entry_id, user_id, action, details)
    values (new.team_id, new.entry_id, auth.uid(), 'grant',
            jsonb_build_object('subject_type', new.subject_type, 'user_id', new.user_id, 'unit_id', new.unit_id));
    return new;
  else
    insert into public.vault_access_log (team_id, entry_id, user_id, action, details)
    values (old.team_id, old.entry_id, auth.uid(), 'revoke',
            jsonb_build_object('subject_type', old.subject_type, 'user_id', old.user_id, 'unit_id', old.unit_id));
    return old;
  end if;
end;
$$;

drop trigger if exists trg_vault_log_grant on public.vault_grants;
create trigger trg_vault_log_grant
  after insert or delete on public.vault_grants
  for each row execute function public.vault_log_grant_change();

-- ============================================================
-- RLS
-- ============================================================
alter table public.vault_entries enable row level security;
-- видят запись те, кто может её раскрыть, плюс менеджеры (для управления)
drop policy if exists vault_entries_select on public.vault_entries;
create policy vault_entries_select on public.vault_entries for select
  using (public.vault_can_reveal(id) or public.can_edit_finance(team_id));
drop policy if exists vault_entries_cud on public.vault_entries;
create policy vault_entries_cud on public.vault_entries for all
  using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));

alter table public.vault_grants enable row level security;
-- матрицу доступа видят и меняют владелец/админ
drop policy if exists vault_grants_select on public.vault_grants;
create policy vault_grants_select on public.vault_grants for select
  using (public.can_manage_team(team_id));
drop policy if exists vault_grants_cud on public.vault_grants;
create policy vault_grants_cud on public.vault_grants for all
  using (public.can_manage_team(team_id)) with check (public.can_manage_team(team_id));

alter table public.vault_access_log enable row level security;
-- лог читают менеджеры+; пишут только триггеры/функции (insert/update/delete-политик нет)
drop policy if exists vault_access_log_select on public.vault_access_log;
create policy vault_access_log_select on public.vault_access_log for select
  using (public.can_edit_finance(team_id));
