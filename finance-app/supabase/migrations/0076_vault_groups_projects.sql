-- ============================================================
-- 0076_vault_groups_projects: группировка паролей, привязка к проекту,
-- общий справочник записей и авто-доступ по проекту.
--
-- 1) Записи получают необязательную «группу» (папку) и привязку к проекту.
-- 2) vault_can_reveal расширен: пароль, привязанный к проекту, автоматически
--    открывается ответственному и менеджеру этого проекта (по учётной записи).
-- 3) vault_directory(_team_id): серверный справочник ВСЕХ записей команды — все
--    участники видят, что пароль существует (название/группа/проект), но логин,
--    ссылку и заметку получают только при наличии доступа. Секрет (шифртекст)
--    через справочник не отдаётся никогда; расшифровка — только через reveal-роут.
-- ============================================================

-- ---- Новые поля записи ----
alter table public.vault_entries
  add column if not exists group_name text not null default '',
  add column if not exists project_id uuid references public.projects (id) on delete set null;

create index if not exists vault_entries_project_idx on public.vault_entries (project_id);

-- ============================================================
-- Право «Показать» — с учётом авто-доступа по проекту.
-- Открывается: владелец/админ, автор, прямой grant, grant на узел оргструктуры,
-- а также ответственный/менеджер проекта, к которому привязан пароль.
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
        or exists (
          -- авто-доступ: пароль привязан к проекту, а пользователь — его ответственный/менеджер
          select 1
          from public.projects p
          join public.counterparties c
            on c.id in (p.responsible_counterparty_id, p.manager_counterparty_id)
          where p.id = e.project_id
            and c.user_id = auth.uid()
            and c.archived = false
        )
      )
  );
$$;
revoke execute on function public.vault_can_reveal(uuid) from anon;

-- ============================================================
-- Общий справочник записей команды. Каждый участник видит факт наличия
-- пароля (название/группа/проект). Логин/ссылку/заметку возвращаем только при
-- доступе (reveal) или праве управления (менеджер+). Секрет не отдаётся.
-- ============================================================
create or replace function public.vault_directory(_team_id uuid)
returns table (
  id           uuid,
  title        text,
  login        text,
  url          text,
  note         text,
  group_name   text,
  project_id   uuid,
  project_name text,
  has_secret   boolean,
  can_reveal   boolean,
  can_manage   boolean,
  created_by   uuid,
  updated_at   timestamptz
)
language sql stable security definer set search_path = public
as $$
  select
    e.id,
    e.title,
    case when f.rv or f.mg then e.login else '' end,
    case when f.rv or f.mg then e.url   else '' end,
    case when f.rv or f.mg then e.note  else '' end,
    e.group_name,
    e.project_id,
    p.name,
    (e.secret_cipher is not null),
    f.rv,
    f.mg,
    case when f.rv or f.mg then e.created_by else null end,
    e.updated_at
  from public.vault_entries e
  left join public.projects p on p.id = e.project_id
  cross join lateral (
    select public.vault_can_reveal(e.id) as rv,
           public.can_edit_finance(e.team_id) as mg
  ) f
  where e.team_id = _team_id
    and public.is_team_member(_team_id)
  order by (nullif(e.group_name, '') is null), lower(e.group_name), lower(e.title);
$$;
revoke execute on function public.vault_directory(uuid) from anon;
