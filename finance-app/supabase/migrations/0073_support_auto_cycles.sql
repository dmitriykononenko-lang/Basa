-- Авто-начисление бонуса аналитику по ТП: когда месяц поддержки закончился
-- (услуга оказана), автоматически открывается следующий цикл и создаётся
-- обязательство-бонус аналитику. Работает ТОЛЬКО вперёд и ТОЛЬКО для проектов,
-- которые уже реально «крутятся» (есть хотя бы один открытый цикл), чтобы не
-- начислять задним числом за месяцы, которые поддержкой не велись.
--
-- Вызывается при заходе finance-пользователя (рядом с materialize_auto_accruals
-- по ЗП). Оплату за цикл привязывают отдельно — здесь только начисление.

create or replace function public.materialize_support_cycles(p_team uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created int := 0;
  pr record;
  v_last date;
  v_guard int;
begin
  if not public.can_edit_finance(p_team) then
    return 0;
  end if;

  for pr in
    select p.id
    from public.projects p
    where p.team_id = p_team
      and p.type = 'support'
      and p.status <> 'done'
      and p.archived = false
      and p.responsible_counterparty_id is not null
      and coalesce(p.bonus_amount, 0) > 0
      and exists (select 1 from public.project_periods pp where pp.project_id = p.id)
  loop
    v_guard := 0;
    loop
      select max(pp.period_end) into v_last
      from public.project_periods pp where pp.project_id = pr.id;
      -- Текущий цикл ещё идёт (месяц не закончился) — не открываем следующий.
      exit when v_last is null or v_last >= current_date;
      exit when v_guard >= 24; -- предохранитель от разгона
      perform public.support_open_period(pr.id); -- следующий цикл + бонус аналитику, без оплаты
      v_created := v_created + 1;
      v_guard := v_guard + 1;
    end loop;
  end loop;

  return v_created;
end;
$$;

revoke execute on function public.materialize_support_cycles(uuid) from public, anon;
grant execute on function public.materialize_support_cycles(uuid) to authenticated;
