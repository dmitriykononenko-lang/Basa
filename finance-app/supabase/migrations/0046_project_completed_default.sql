-- ============================================================
-- 0046_project_completed_default: при переводе проекта в «Сдан» дата сдачи
-- по умолчанию = срок сдачи (старт + план / due_date), а не сегодняшняя дата.
-- Так «Шло раб. дней», просрочка и бонус считаются от старта до финиша
-- автоматически. Реальную дату сдачи можно задать вручную (если позже срока).
-- ============================================================

create or replace function public.project_set_completed()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'done' and new.completed_on is null then
    new.completed_on := coalesce(
      new.due_date,
      public.business_day_add(new.start_date, new.plan_work_days),
      current_date
    );
  elsif new.status is distinct from 'done' then
    new.completed_on := null;
  end if;
  return new;
end;
$$;
