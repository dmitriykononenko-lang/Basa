-- ============================================================
-- 0059_metrics: модуль «Показатели» — числовые KPI по сотрудникам/отделам с
-- планом/фактом по периодам (как «Показатели» в Platrum).
--
-- metrics — определение показателя: ответственный (owner_user_id), отдел/узел
-- оргструктуры (unit_id → kb_departments), периодичность, направление (рост/снижение
-- лучше), способ агрегации, план.
-- metric_values — факт за конкретный период (period_start), уникально на показатель.
--
-- RLS (хелперы is_team_member/can_edit_finance): смотрят все члены команды; вводят/
-- правят значения ответственный показателя ИЛИ менеджер+; определения CRUD — менеджер+.
-- ============================================================

-- ---- Определения показателей ----
create table if not exists public.metrics (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams (id) on delete cascade,
  name          text not null,
  unit          text not null default '',
  owner_user_id uuid references auth.users (id) on delete set null,
  unit_id       uuid references public.kb_departments (id) on delete set null,
  period        text not null default 'week' check (period in ('day','week','month')),
  direction     text not null default 'up_good' check (direction in ('up_good','down_good')),
  aggregation   text not null default 'last' check (aggregation in ('sum','avg','last')),
  plan          numeric,
  is_active     boolean not null default true,
  sort          int not null default 0,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists metrics_team_idx on public.metrics (team_id);
create index if not exists metrics_owner_idx on public.metrics (owner_user_id);

drop trigger if exists metrics_touch on public.metrics;
create trigger metrics_touch before update on public.metrics
  for each row execute function public.kb_touch_updated_at();

-- ---- Значения (факт за период) ----
create table if not exists public.metric_values (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  metric_id   uuid not null references public.metrics (id) on delete cascade,
  period_start date not null,
  value       numeric not null,
  note        text not null default '',
  entered_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists metric_values_metric_period_uniq
  on public.metric_values (metric_id, period_start);
create index if not exists metric_values_team_idx on public.metric_values (team_id);

drop trigger if exists metric_values_touch on public.metric_values;
create trigger metric_values_touch before update on public.metric_values
  for each row execute function public.kb_touch_updated_at();

-- ============================================================
-- RLS
-- ============================================================
alter table public.metrics enable row level security;
drop policy if exists metrics_select on public.metrics;
create policy metrics_select on public.metrics for select
  using (public.is_team_member(team_id));
drop policy if exists metrics_cud on public.metrics;
create policy metrics_cud on public.metrics for all
  using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));

alter table public.metric_values enable row level security;
drop policy if exists metric_values_select on public.metric_values;
create policy metric_values_select on public.metric_values for select
  using (public.is_team_member(team_id));
-- Ввод/правка/удаление значений: ответственный показателя или менеджер+.
drop policy if exists metric_values_insert on public.metric_values;
create policy metric_values_insert on public.metric_values for insert
  with check (
    public.is_team_member(team_id)
    and (
      public.can_edit_finance(team_id)
      or exists (select 1 from public.metrics m
                 where m.id = metric_id and m.team_id = metric_values.team_id
                   and m.owner_user_id = auth.uid())
    )
  );
drop policy if exists metric_values_update on public.metric_values;
create policy metric_values_update on public.metric_values for update
  using (
    public.can_edit_finance(team_id)
    or exists (select 1 from public.metrics m
               where m.id = metric_id and m.owner_user_id = auth.uid())
  )
  with check (
    public.is_team_member(team_id)
    and (
      public.can_edit_finance(team_id)
      or exists (select 1 from public.metrics m
                 where m.id = metric_id and m.owner_user_id = auth.uid())
    )
  );
drop policy if exists metric_values_delete on public.metric_values;
create policy metric_values_delete on public.metric_values for delete
  using (
    public.can_edit_finance(team_id)
    or exists (select 1 from public.metrics m
               where m.id = metric_id and m.owner_user_id = auth.uid())
  );
