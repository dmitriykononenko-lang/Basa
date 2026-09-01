-- ============================================================
-- 0001_foundation: профили, команды, роли, RLS-фундамент
-- ============================================================

-- Роли участников команды
do $$ begin
  create type public.app_role as enum ('owner', 'admin', 'manager', 'employee', 'viewer');
exception when duplicate_object then null; end $$;

-- ---------- Профили пользователей ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

-- Автосоздание профиля при регистрации пользователя
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Команды ----------
create table if not exists public.teams (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  base_currency  char(3) not null default 'RUB',
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now()
);

-- ---------- Участники команд ----------
create table if not exists public.team_members (
  team_id    uuid not null references public.teams (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.app_role not null default 'employee',
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index if not exists team_members_user_idx on public.team_members (user_id);

-- ---------- Вспомогательные функции (обходят RLS, security definer) ----------
create or replace function public.is_team_member(_team_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where team_id = _team_id and user_id = auth.uid()
  );
$$;

create or replace function public.current_team_role(_team_id uuid)
returns public.app_role
language sql
stable
security definer set search_path = public
as $$
  select role from public.team_members
  where team_id = _team_id and user_id = auth.uid();
$$;

-- Создание команды + назначение создателя владельцем (одной транзакцией)
create or replace function public.create_team(_name text, _base_currency char(3) default 'RUB')
returns public.teams
language plpgsql
security definer set search_path = public
as $$
declare
  _team public.teams;
begin
  insert into public.teams (name, base_currency, created_by)
  values (_name, coalesce(_base_currency, 'RUB'), auth.uid())
  returning * into _team;

  insert into public.team_members (team_id, user_id, role)
  values (_team.id, auth.uid(), 'owner');

  return _team;
end;
$$;

-- ---------- RLS ----------
alter table public.profiles     enable row level security;
alter table public.teams        enable row level security;
alter table public.team_members enable row level security;

-- profiles: пользователь видит/правит свой профиль; участники одной команды видят профили друг друга
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (
    id = auth.uid()
    or exists (
      select 1 from public.team_members tm_self
      join public.team_members tm_other on tm_other.team_id = tm_self.team_id
      where tm_self.user_id = auth.uid() and tm_other.user_id = profiles.id
    )
  );

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert
  with check (id = auth.uid());

-- teams: видят участники; правят owner/admin
drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select
  using (public.is_team_member(id));

drop policy if exists teams_update on public.teams;
create policy teams_update on public.teams for update
  using (public.current_team_role(id) in ('owner', 'admin'))
  with check (public.current_team_role(id) in ('owner', 'admin'));

drop policy if exists teams_delete on public.teams;
create policy teams_delete on public.teams for delete
  using (public.current_team_role(id) = 'owner');

-- team_members: видят участники команды; управляют owner/admin
drop policy if exists team_members_select on public.team_members;
create policy team_members_select on public.team_members for select
  using (public.is_team_member(team_id));

drop policy if exists team_members_insert on public.team_members;
create policy team_members_insert on public.team_members for insert
  with check (public.current_team_role(team_id) in ('owner', 'admin'));

drop policy if exists team_members_update on public.team_members;
create policy team_members_update on public.team_members for update
  using (public.current_team_role(team_id) in ('owner', 'admin'))
  with check (public.current_team_role(team_id) in ('owner', 'admin'));

drop policy if exists team_members_delete on public.team_members;
create policy team_members_delete on public.team_members for delete
  using (public.current_team_role(team_id) in ('owner', 'admin'));
