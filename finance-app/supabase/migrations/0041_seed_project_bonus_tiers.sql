-- ============================================================
-- 0041_seed_project_bonus_tiers
-- Ступени мотивации (project_bonus_tiers) сеялись в 0038 только для команд,
-- существовавших на момент миграции. Команды, созданные позже (и survivor
-- после слияния команд), оставались без ступеней — тогда триггер
-- accrue_project_bonus берёт pct = 100%, и бонус за сдачу начисляется
-- полностью, без учёта просрочки. Это и есть «мотивация считается неверно».
--
-- Чиним: 1) досеваем стандартные ступени всем командам без ступеней
--        2) авто-сев для новых команд (триггер на teams)
-- Вставка ступеней запускает trg_project_tiers_changed → пересчёт бонусов
-- уже сданных проектов по правильным процентам.
-- ============================================================

-- 1) Бэкфилл: команды без ступеней получают стандартный набор
insert into public.project_bonus_tiers(team_id, max_overrun_wd, percent)
select t.id, v.wd, v.pct
from public.teams t
cross join (values (0,100),(2,90),(5,75),(10,50),(2147483647,0)) as v(wd, pct)
where not exists (select 1 from public.project_bonus_tiers p where p.team_id = t.id);

-- 2) Авто-сев стандартных ступеней при создании новой команды
create or replace function public.seed_project_bonus_tiers()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_bonus_tiers(team_id, max_overrun_wd, percent)
  values (new.id, 0, 100), (new.id, 2, 90), (new.id, 5, 75), (new.id, 10, 50), (new.id, 2147483647, 0);
  return new;
end;
$$;
revoke all on function public.seed_project_bonus_tiers() from public, anon, authenticated;

drop trigger if exists trg_seed_project_bonus_tiers on public.teams;
create trigger trg_seed_project_bonus_tiers
  after insert on public.teams
  for each row execute function public.seed_project_bonus_tiers();
