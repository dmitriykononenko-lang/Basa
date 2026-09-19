-- ============================================================
-- 0059_accrual_respect_end_date: авто-начисление оклада не идёт
-- после даты увольнения (counterparties.end_date). Месяцы
-- начисляются с max(приём, первая ставка) по
-- min(текущий месяц, месяц увольнения).
-- ============================================================

create or replace function public.materialize_auto_accruals(p_team uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created int := 0;
  v_cur_month date := date_trunc('month', current_date)::date;
  v_last_month date;
  emp record;
  m date;
  rate record;
begin
  if not public.can_edit_finance(p_team) then
    return 0;
  end if;

  for emp in
    select c.id, c.start_date, c.end_date
    from public.counterparties c
    where c.team_id = p_team
      and c.auto_accrue = true
      and c.archived = false
      and exists (select 1 from public.employee_salaries s where s.counterparty_id = c.id)
  loop
    -- первый месяц = max(месяц приёма, месяц первой ставки)
    select greatest(
             date_trunc('month', coalesce(emp.start_date, '1900-01-01'::date)),
             (select date_trunc('month', min(s.effective_from)) from public.employee_salaries s where s.counterparty_id = emp.id)
           )::date
      into m;
    if m is null then continue; end if;

    -- последний месяц = min(текущий, месяц увольнения). После увольнения оклад не начисляется.
    v_last_month := least(v_cur_month, date_trunc('month', coalesce(emp.end_date, v_cur_month))::date);

    while m <= v_last_month loop
      select s.amount, s.currency into rate
      from public.employee_salaries s
      where s.counterparty_id = emp.id and s.effective_from <= m
      order by s.effective_from desc
      limit 1;

      if rate.amount is not null
         and not exists (
           select 1 from public.obligations o
           where o.counterparty_id = emp.id
             and o.type = 'payable'
             and o.pay_part = 'fixed'
             and o.period_month = m
         )
      then
        insert into public.obligations
          (team_id, counterparty_id, type, amount, currency, due_date, period_month, pay_part, status, note)
        values
          (p_team, emp.id, 'payable', rate.amount, rate.currency, m, m, 'fixed', 'open', 'Начисление ЗП (авто)');
        v_created := v_created + 1;
      end if;

      m := (m + interval '1 month')::date;
    end loop;
  end loop;

  return v_created;
end;
$$;

grant execute on function public.materialize_auto_accruals(uuid) to authenticated;
