-- ============================================================
-- 0036_salary_auto_accrue: авто-начисление зарплаты каждый месяц
-- Сотрудник помечается auto_accrue=true; функция materialize_auto_accruals
-- создаёт фиксированные начисления по окладу за все непокрытые месяцы.
-- ============================================================

alter table public.counterparties
  add column if not exists auto_accrue boolean not null default false;

create or replace function public.materialize_auto_accruals(p_team uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created int := 0;
  v_cur_month date := date_trunc('month', current_date)::date;
  emp record;
  m date;
  rate record;
begin
  if not public.can_edit_finance(p_team) then
    return 0;
  end if;

  for emp in
    select c.id, c.start_date
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

    while m <= v_cur_month loop
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
