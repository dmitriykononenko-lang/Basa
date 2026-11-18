-- Аванс + остаток по окладу с реальными сроками выплат.
-- Политика: аванс — фиксированная сумма на сотрудника (counterparties.advance_amount),
-- выплачивается 25-го числа месяца; остаток (оклад − аванс) — 15-го числа СЛЕДУЮЩЕГО месяца.
-- Только вперёд: прошлые месяцы, уже начисленные одним обязательством, не трогаем.

alter table public.counterparties
  add column if not exists advance_amount bigint not null default 0;

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
  v_adv bigint;
  v_fin bigint;
  v_adv_due date;
  v_fin_due date;
begin
  if not public.can_edit_finance(p_team) then
    return 0;
  end if;

  for emp in
    select c.id, c.start_date, c.end_date, coalesce(c.advance_amount, 0) as advance_amount
    from public.counterparties c
    where c.team_id = p_team
      and c.auto_accrue = true
      and c.archived = false
      and exists (select 1 from public.employee_salaries s where s.counterparty_id = c.id)
  loop
    select greatest(
             date_trunc('month', coalesce(emp.start_date, '1900-01-01'::date)),
             (select date_trunc('month', min(s.effective_from)) from public.employee_salaries s where s.counterparty_id = emp.id)
           )::date
      into m;
    if m is null then continue; end if;

    v_last_month := least(v_cur_month, date_trunc('month', coalesce(emp.end_date, v_cur_month))::date);

    while m <= v_last_month loop
      select s.amount, s.currency into rate
      from public.employee_salaries s
      where s.counterparty_id = emp.id and s.effective_from <= m
      order by s.effective_from desc
      limit 1;

      -- Уже есть начисление оклада за этот месяц (одно или два) — не трогаем.
      if rate.amount is not null
         and not exists (
           select 1 from public.obligations o
           where o.counterparty_id = emp.id
             and o.type = 'payable'
             and o.pay_part = 'fixed'
             and o.period_month = m
         )
      then
        if m < v_cur_month then
          -- Прошлые (ещё не начисленные) месяцы — как раньше, одним обязательством.
          insert into public.obligations
            (team_id, counterparty_id, type, amount, currency, due_date, period_month, pay_part, status, note)
          values
            (p_team, emp.id, 'payable', rate.amount, rate.currency, m, m, 'fixed', 'open', 'Начисление ЗП (авто)');
          v_created := v_created + 1;
        else
          -- Текущий и будущие месяцы — аванс (25-е) + остаток (15-е следующего).
          v_adv := least(emp.advance_amount, rate.amount);
          v_fin := rate.amount - v_adv;
          v_adv_due := make_date(extract(year from m)::int, extract(month from m)::int, 25);
          v_fin_due := make_date(extract(year from (m + interval '1 month'))::int,
                                 extract(month from (m + interval '1 month'))::int, 15);

          if v_adv > 0 then
            insert into public.obligations
              (team_id, counterparty_id, type, amount, currency, due_date, period_month, pay_part, status, note)
            values
              (p_team, emp.id, 'payable', v_adv, rate.currency, v_adv_due, m, 'fixed', 'open', 'Начисление ЗП аванс (авто)');
            v_created := v_created + 1;
          end if;
          if v_fin > 0 then
            insert into public.obligations
              (team_id, counterparty_id, type, amount, currency, due_date, period_month, pay_part, status, note)
            values
              (p_team, emp.id, 'payable', v_fin, rate.currency, v_fin_due, m, 'fixed', 'open', 'Начисление ЗП остаток (авто)');
            v_created := v_created + 1;
          end if;
        end if;
      end if;

      m := (m + interval '1 month')::date;
    end loop;
  end loop;

  return v_created;
end;
$$;

revoke execute on function public.materialize_auto_accruals(uuid) from public, anon;
grant execute on function public.materialize_auto_accruals(uuid) to authenticated;
