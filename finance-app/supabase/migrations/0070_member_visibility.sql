-- ============================================================
-- 0070_member_visibility: индивидуальная видимость разделов для сотрудника.
--
-- Порядок разрешения (в can_view_resource):
--   1) owner — всегда видит всё;
--   2) индивидуальная настройка сотрудника (member_visibility) — если задана;
--   3) шаблон по роли (team_visibility);
--   4) по умолчанию — видно.
-- Так «индивидуальная роль» (переопределение на человека) имеет приоритет над
-- шаблоном роли.
-- ============================================================

create table if not exists public.member_visibility (
  team_id    uuid not null references public.teams (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  resource   text not null,
  visible    boolean not null,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  primary key (team_id, user_id, resource)
);

alter table public.member_visibility enable row level security;
drop policy if exists member_visibility_select on public.member_visibility;
create policy member_visibility_select on public.member_visibility for select
  using (public.is_team_member(team_id));
drop policy if exists member_visibility_write on public.member_visibility;
create policy member_visibility_write on public.member_visibility for all
  using (public.can_manage_team(team_id)) with check (public.can_manage_team(team_id));

-- Переопределяем разрешение: индивидуально → по роли → по умолчанию.
create or replace function public.can_view_resource(_team_id uuid, _resource text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.current_team_role(_team_id) is null then false
    when public.current_team_role(_team_id) = 'owner' then true
    else coalesce(
      (select visible from public.member_visibility
         where team_id = _team_id and user_id = auth.uid() and resource = _resource),
      (select public.current_team_role(_team_id) = any(allowed_roles)
         from public.team_visibility where team_id = _team_id and resource = _resource),
      true)
  end;
$$;
revoke execute on function public.can_view_resource(uuid, text) from public;
grant execute on function public.can_view_resource(uuid, text) to authenticated, service_role;
