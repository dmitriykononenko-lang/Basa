-- ============================================================
-- 0006_invites: приглашения участников в команду по email
-- ============================================================

create table if not exists public.invites (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  email      text not null,
  role       public.app_role not null default 'employee',
  status     text not null default 'pending',  -- pending | accepted | revoked
  invited_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index if not exists invites_team_idx  on public.invites (team_id);
create index if not exists invites_email_idx on public.invites (lower(email));

-- Кто может управлять командой (приглашать, менять роли) — владелец/админ
create or replace function public.can_manage_team(_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select public.current_team_role(_team_id) in ('owner', 'admin'); $$;

revoke execute on function public.can_manage_team(uuid) from anon;

-- Email текущего пользователя из JWT
create or replace function public.auth_email()
returns text
language sql stable
as $$ select lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'email', '')); $$;

-- Принять приглашение (вызывает приглашённый пользователь)
create or replace function public.accept_invite(_invite_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  _inv public.invites;
begin
  select * into _inv from public.invites where id = _invite_id;
  if _inv.id is null or _inv.status <> 'pending' then
    raise exception 'Приглашение недействительно';
  end if;
  if lower(_inv.email) <> public.auth_email() then
    raise exception 'Приглашение оформлено на другой email';
  end if;

  insert into public.team_members (team_id, user_id, role)
  values (_inv.team_id, auth.uid(), _inv.role)
  on conflict (team_id, user_id) do update set role = excluded.role;

  update public.invites set status = 'accepted' where id = _invite_id;
end;
$$;

revoke execute on function public.accept_invite(uuid) from anon;

-- ---------- RLS ----------
alter table public.invites enable row level security;

drop policy if exists invites_select on public.invites;
create policy invites_select on public.invites for select
  using (public.can_manage_team(team_id) or lower(email) = public.auth_email());

drop policy if exists invites_insert on public.invites;
create policy invites_insert on public.invites for insert
  with check (public.can_manage_team(team_id) and invited_by = auth.uid());

drop policy if exists invites_update on public.invites;
create policy invites_update on public.invites for update
  using (public.can_manage_team(team_id))
  with check (public.can_manage_team(team_id));

drop policy if exists invites_delete on public.invites;
create policy invites_delete on public.invites for delete
  using (public.can_manage_team(team_id));
