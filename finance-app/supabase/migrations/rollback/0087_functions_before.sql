-- ============================================================
-- 0087_functions_before.sql — ТЕЛА ФУНКЦИЙ ДО ПРИМЕНЕНИЯ 0087
-- Снято с production 2026-09-23 (PRECHECK, шаг §1 runbook) через
-- pg_get_functiondef(). Нужно для полного отката миграции 0087:
-- 0087_down.sql удаляет колонку obligations.origin, но НЕ восстанавливает
-- прежние тела функций — они здесь.
-- Порядок отката 0087: сначала выполнить этот файл, затем 0087_down.sql.
-- ============================================================

CREATE OR REPLACE FUNCTION public.materialize_auto_accruals(p_team uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
          insert into public.obligations
            (team_id, counterparty_id, type, amount, currency, due_date, period_month, pay_part, status, note)
          values
            (p_team, emp.id, 'payable', rate.amount, rate.currency, m, m, 'fixed', 'open', 'Начисление ЗП (авто)');
          v_created := v_created + 1;
        else
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
$function$;

CREATE OR REPLACE FUNCTION public.materialize_support_cycles(p_team uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      exit when v_last is null or v_last >= current_date;
      exit when v_guard >= 24;
      perform public.support_open_period(pr.id);
      v_created := v_created + 1;
      v_guard := v_guard + 1;
    end loop;
  end loop;

  return v_created;
end;
$function$;
