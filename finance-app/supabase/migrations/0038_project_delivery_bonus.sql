-- ============================================================
-- 0038_project_delivery_bonus: сроки внедрения проектов (рабочие дни)
-- и авто-бонус ответственному аналитику при сдаче, со ступенчатой
-- поправкой за просрочку.
-- ============================================================

-- ── Поля проекта ──
alter table public.projects
  add column if not exists start_date     date not null default current_date,
  add column if not exists plan_work_days int,
  add column if not exists due_date       date,
  add column if not exists completed_on   date,
  add column if not exists bonus_amount   bigint not null default 0,
  add column if not exists bonus_currency char(3) not null default 'RUB';

-- ── Ступени мотивации ──
create table if not exists public.project_bonus_tiers (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams(id) on delete cascade,
  max_overrun_wd int not null,                 -- до скольких просроченных раб. дней включительно
  percent       numeric(6,3) not null check (percent >= 0),
  created_at    timestamptz not null default now()
);
alter table public.project_bonus_tiers enable row level security;
drop policy if exists pbt_select on public.project_bonus_tiers;
drop policy if exists pbt_insert on public.project_bonus_tiers;
drop policy if exists pbt_update on public.project_bonus_tiers;
drop policy if exists pbt_delete on public.project_bonus_tiers;
create policy pbt_select on public.project_bonus_tiers for select using (public.is_team_member(team_id));
create policy pbt_insert on public.project_bonus_tiers for insert with check (public.can_edit_finance(team_id));
create policy pbt_update on public.project_bonus_tiers for update using (public.can_edit_finance(team_id)) with check (public.can_edit_finance(team_id));
create policy pbt_delete on public.project_bonus_tiers for delete using (public.can_edit_finance(team_id));

-- Сид по умолчанию для существующих команд: 0→100%, 2→90%, 5→75%, 10→50%, ∞→0%
insert into public.project_bonus_tiers(team_id, max_overrun_wd, percent)
select t.id, v.wd, v.pct
from public.teams t
cross join (values (0,100),(2,90),(5,75),(10,50),(2147483647,0)) as v(wd, pct)
where not exists (select 1 from public.project_bonus_tiers p where p.team_id = t.id);

-- ── Идемпотентность бонуса по проекту ──
alter table public.obligations
  add column if not exists source_project_id uuid references public.projects(id) on delete cascade;
create unique index if not exists obligations_source_project_key
  on public.obligations(source_project_id) where source_project_id is not null;

-- ── Рабочие дни (пн–пт) ──
create or replace function public.business_days(d_from date, d_to date)
returns int language sql immutable set search_path = public as $$
  select case when d_to is null or d_from is null or d_to <= d_from then 0 else
    (select count(*)::int from generate_series(d_from + 1, d_to, interval '1 day') g
     where extract(isodow from g) < 6)
  end;
$$;

create or replace function public.business_day_add(d date, n int)
returns date language plpgsql immutable set search_path = public as $$
declare cur date := d; lft int := n;
begin
  if n is null then return null; end if;
  if n <= 0 then return d; end if;
  while lft > 0 loop
    cur := cur + 1;
    if extract(isodow from cur) < 6 then lft := lft - 1; end if;
  end loop;
  return cur;
end;
$$;

-- ── Начисление бонуса за сдачу проекта ──
create or replace function public.accrue_project_bonus(p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  pr record; eff_due date; overrun int; pct numeric; amt bigint;
begin
  select * into pr from public.projects where id = p_project;
  if not found then return; end if;

  if pr.status = 'done' and pr.responsible_counterparty_id is not null and pr.bonus_amount > 0 then
    eff_due := coalesce(pr.due_date, public.business_day_add(pr.start_date, pr.plan_work_days));
    if eff_due is null or pr.completed_on is null then
      overrun := 0;
    else
      overrun := greatest(0, public.business_days(eff_due, pr.completed_on));
    end if;
    select percent into pct from public.project_bonus_tiers
      where team_id = pr.team_id and max_overrun_wd >= overrun
      order by max_overrun_wd asc limit 1;
    if pct is null then pct := 100; end if;
    amt := round(pr.bonus_amount * pct / 100.0);

    if amt <= 0 then
      delete from public.obligations where source_project_id = p_project;
    else
      insert into public.obligations(team_id, counterparty_id, type, amount, currency, project_id,
        due_date, period_month, pay_part, status, note, source_project_id)
      values (pr.team_id, pr.responsible_counterparty_id, 'payable', amt, pr.bonus_currency, pr.id,
        pr.completed_on, date_trunc('month', coalesce(pr.completed_on, current_date))::date,
        'variable', 'open', 'Бонус за сдачу проекта', pr.id)
      on conflict (source_project_id) where source_project_id is not null
      do update set counterparty_id = excluded.counterparty_id,
                    amount = excluded.amount,
                    currency = excluded.currency,
                    project_id = excluded.project_id,
                    due_date = excluded.due_date,
                    period_month = excluded.period_month,
                    note = excluded.note;
    end if;
  else
    delete from public.obligations where source_project_id = p_project;
  end if;
end;
$$;

-- Проставление/снятие даты сдачи по статусу
create or replace function public.project_set_completed()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'done' and new.completed_on is null then
    new.completed_on := current_date;
  elsif new.status is distinct from 'done' then
    new.completed_on := null;
  end if;
  return new;
end;
$$;

create or replace function public.trg_project_bonus()
returns trigger language plpgsql set search_path = public as $$
begin
  perform public.accrue_project_bonus(new.id);
  return new;
end;
$$;

-- Пересчёт всех сданных проектов команды при изменении ступеней
create or replace function public.recompute_team_project_bonuses()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_team uuid; r record;
begin
  v_team := coalesce(new.team_id, old.team_id);
  for r in select id from public.projects where team_id = v_team and status = 'done' loop
    perform public.accrue_project_bonus(r.id);
  end loop;
  return null;
end;
$$;

drop trigger if exists trg_project_set_completed on public.projects;
create trigger trg_project_set_completed
  before insert or update on public.projects
  for each row execute function public.project_set_completed();

drop trigger if exists trg_project_bonus on public.projects;
create trigger trg_project_bonus
  after insert or update of status, completed_on, due_date, plan_work_days, start_date,
    responsible_counterparty_id, bonus_amount, bonus_currency
  on public.projects
  for each row execute function public.trg_project_bonus();

drop trigger if exists trg_project_tiers_changed on public.project_bonus_tiers;
create trigger trg_project_tiers_changed
  after insert or update or delete on public.project_bonus_tiers
  for each row execute function public.recompute_team_project_bonuses();

revoke all on function public.accrue_project_bonus(uuid) from public, anon, authenticated;
revoke all on function public.recompute_team_project_bonuses() from public, anon, authenticated;
